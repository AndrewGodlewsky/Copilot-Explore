import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createUsageRecorder, reconcileUsageJournal } from './research-usage.mjs';
import { eligibleCopilotModel as eligible, sameCopilotAccount as sameAccount, validResearchModelId } from './research-model.mjs';

class HelperError extends Error {}
const fail = message => new HelperError(message);
export function hostRuntime(executable = process.execPath, argv = process.argv, parentPid = process.ppid, env = process.env) {
  if (!isAbsolute(executable) || !['copilot.exe', 'copilot', 'copilot-runtime.exe', 'copilot-runtime'].includes(basename(executable).toLowerCase()) ||
    !argv.some(arg => arg === 'extension_bootstrap.mjs' || (isAbsolute(arg) && basename(arg) === 'extension_bootstrap.mjs')) ||
    !env.COPILOT_SDK_PATH || !Number.isSafeInteger(parentPid) || parentPid <= 0 || String(parentPid) !== env.COPILOT_EXTENSION_PARENT_PID) {
    throw fail('Research requires the installed Copilot desktop runtime. Update Copilot and reopen Explorer.');
  }
  return executable;
}
async function desktopRuntime() {
  const path = await realpath(hostRuntime());
  const sdk = await import('@github/copilot-sdk');
  if (typeof sdk.CopilotClient !== 'function' || typeof sdk.RuntimeConnection?.forStdio !== 'function') throw fail('This Copilot SDK does not support isolated research. Update Copilot.');
  return { path, sdk };
}
export function runtimeEnvironment(source = process.env) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|XDG_CONFIG_HOME|XDG_CACHE_HOME|LANG|LC_ALL|GH_TOKEN|GITHUB_TOKEN|GH_HOST|GITHUB_HOST|GH_CONFIG_DIR|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/i;
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.test(key) && typeof value === 'string'));
}

// Only fixtures inject a runtime. Production resolves the pair supplied by the desktop bootstrap.
export function createOwnedHelper(parent, operation, prepare, { usageDirectory, runtime = desktopRuntime, usageRecorder = createUsageRecorder, stopTimeoutMs = 10000, clock = { now: () => performance.now(), setTimeout, clearTimeout } } = {}) {
  if (!['research', 'research-follow-up', 'research-reconsideration', 'decision-brief', 'implementation-handoff', 'adr-draft', 'project-brief', 'answer-check', 'challenge-review', 'cleanup', 'question-help-rephrase', 'question-help-example', 'question-help-terms'].includes(operation)) throw new Error('Invalid helper operation.');
  const webResearch = operation === 'research' || operation === 'research-follow-up';
  const reviewedResearch = webResearch || operation === 'research-reconsideration';
  const label = { 'decision-brief': 'Decision brief', 'implementation-handoff': 'Implementation handoff', 'adr-draft': 'ADR draft', 'project-brief': 'Project brief', 'answer-check': 'Answer check', 'challenge-review': 'Challenge review', research: 'Research', 'research-follow-up': 'Research follow-up', 'research-reconsideration': 'Research reconsideration', cleanup: 'Answer cleanup', 'question-help-rephrase': 'Question rephrase', 'question-help-example': 'Question example', 'question-help-terms': 'Question terms' }[operation];
  const fail = message => new HelperError(message.replaceAll('Research', label).replaceAll('research', label.toLowerCase()));
  const cancelled = () => fail('Research was cancelled or timed out. Your answers are saved.');
  const active = new Map();
  function run(context, { signal, onProgress = () => {}, onReport = () => {} } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const receiptDirectory = typeof usageDirectory === 'function' ? usageDirectory() : usageDirectory;
    const task = execute(context, controller, onProgress, receiptDirectory, onReport).finally(() => { signal?.removeEventListener('abort', abort); active.delete(controller); });
    active.set(controller, task);
    return task;
  }
  async function execute(context, controller, progress, usageDirectory, report) {
    const timeLimitMs = reviewedResearch ? context.limits.timeLimitMs : 180000;
    const started = clock.now();
    const remaining = () => Math.max(0, timeLimitMs - (clock.now() - started));
    let ended = false, terminalReason, work, inferenceStarted = false;
    const expire = () => { if (!controller.signal.aborted) { terminalReason ??= 'deadline'; controller.abort(); } };
    const operationEligible = () => { if (reviewedResearch && remaining() <= 0) expire(); return !ended && !controller.signal.aborted; };
    let client, directory, usage, stop, stopAttempt, phase = 'preparing the SDK', outcome = 'failed';
    const sessionId = randomUUID();
    let terminalFailure;
    const stopWith = (message, reason = 'helper-failure') => { terminalFailure ??= fail(message); terminalReason ??= reason; controller.abort(); };
    const check = () => { if (terminalFailure) throw terminalFailure; if (!operationEligible()) throw cancelled(); };
    const stopClient = () => {
      if (client && !stop) {
        stopAttempt = Promise.resolve().then(() => client.forceStop()).then(() => true, () => false);
        stop = deadline(stopAttempt, stopTimeoutMs).then(value => value, () => false);
      }
      return stop;
    };
    controller.signal.addEventListener('abort', () => void stopClient(), { once: true });
    const timer = clock.setTimeout(expire, timeLimitMs); timer.unref?.();
    const stage = value => { phase = value; progress(value); check(); };
    try {
      check(); stage('Checking Copilot access');
      const { sdk, path } = await deadline(runtime(), 15000); check();
      const captured = reviewedResearch ? context.modelCapture : null;
      if (captured && (!['chat', 'dedicated'].includes(captured.mode) || !Number.isSafeInteger(captured.revision) || captured.revision < 0 || !validResearchModelId(captured.model?.id))) throw fail('The reviewed Research model is invalid. Refresh the review before starting.');
      const [selected, catalog, auth] = await deadline(Promise.all([
        captured ? { modelId: captured.model.id } : parent.rpc.model.getCurrent(), parent.rpc.model.list({ skipCache: true }), parent.rpc.gitHubAuth.getStatus(),
      ]), 20000); check();
      const model = catalog.list?.find(m => eligible(m) && m.id === selected.modelId);
      if (!auth.isAuthenticated) throw fail('Sign in to Copilot before using this helper.');
      if (captured && !sameAccount(captured.account, auth)) throw fail('The Copilot account changed after review. Refresh the Research review before starting.');
      if (captured && !model) throw fail('The reviewed Research model is unavailable for this account or policy. Review Research model settings; no replacement was selected.');
      if (!model) throw fail('Research needs an enabled Copilot model. Select one in the main chat and try again.');
      work = await prepare(context, { controller, progress, stopWith, fail, eligible: operationEligible, remaining });
      directory = await mkdtemp(join(tmpdir(), `explorer-${operation}-`));
      const workspace = join(directory, 'workspace'), home = join(directory, 'home');
      await mkdir(workspace); check();
      client = new sdk.CopilotClient({ mode: 'empty', workingDirectory: workspace, baseDirectory: home,
        connection: sdk.RuntimeConnection.forStdio({ path, args: ['--no-auto-update'] }),
        env: runtimeEnvironment(), useLoggedInUser: true, logLevel: 'error', builtinPluginDirectories: [] });
      await deadline(client.start(), 30000); check();
      usage = await usageRecorder(sessionId, usageDirectory, operation); check();
      stage('Starting isolated helper');
      const session = await deadline(client.createSession({
        sessionId, onEvent: event => { usage.record(event); if (inferenceStarted && operationEligible()) work.onEvent?.(event); }, workingDirectory: workspace, configDirectory: home, model: model.id,
        systemMessage: { mode: 'replace', content: work.instructions },
        requestExtensions: false, requestCanvasRenderer: false, pluginDirectories: [], mcpServers: {},
        enableConfigDiscovery: false, skipCustomInstructions: true, enableSkills: false, enableFileHooks: false,
        enableOnDemandInstructionDiscovery: false, enableSessionStore: false, enableHostGitOperations: false,
        skipEmbeddingRetrieval: true, embeddingCacheStorage: 'in-memory', enableSessionTelemetry: false,
        memory: { enabled: false }, skillDirectories: [], agentDirectories: [], instructionDirectories: [], hookDirectories: [],
        infiniteSessions: { enabled: false }, enableManagedSettings: true, enforceManagedModelDefaults: true,
        ...work.config,
      }), 30000); check();
      if (session.sessionId !== sessionId) throw fail('Copilot could not isolate the research session.');
      const [helperAuth, helperModels, metadata] = await deadline(Promise.all([
        session.rpc.gitHubAuth.getStatus(), session.rpc.model.list({ skipCache: true }), session.rpc.metadata.snapshot(),
      ]), 20000); check();
      if (!sameAccount(auth, helperAuth)) throw fail('The research account differs from the main Copilot account. Check your Copilot sign-in.');
      if (!helperModels.list?.some(m => eligible(m) && m.id === model.id)) throw fail('The selected model is unavailable for research. Choose an enabled Copilot model.');
      if (metadata.isRemote !== false || await realpath(metadata.workingDirectory) !== await realpath(workspace)) throw fail('Copilot could not isolate the research workspace.');
      stage(webResearch ? 'Checking web research tools' : `Verifying ${label.toLowerCase()} has no tools`);
      await deadline(session.rpc.tools.initializeAndValidate(), 30000); check();
      const [tools, current, parentAuth, currentHelperAuth] = await deadline(Promise.all([
        session.rpc.tools.getCurrentMetadata(), session.rpc.model.getCurrent(), parent.rpc.gitHubAuth.getStatus(), session.rpc.gitHubAuth.getStatus(),
      ]), 15000); check();
      work.validateTools(tools);
      if (current.modelId !== model.id || !sameAccount(auth, parentAuth) || !sameAccount(auth, currentHelperAuth)) throw fail('The Copilot account or model changed while research was starting. Try again.');
      await usage.captureModel?.(current.modelId); check();
      stage(work.stage);
      work.validateBeforeSend?.();
      inferenceStarted = true;
      const response = await session.sendAndWait({ prompt: work.prompt }, reviewedResearch ? remaining() : 180000);
      check(); stage('Checking result');
      const result = work.parse(response?.data?.content); outcome = 'completed'; return result;
    } catch (error) {
      if (terminalFailure) { if (['attempt-limit', 'repeated-request', 'result-text-limit'].includes(terminalReason)) outcome = 'cancelled'; throw terminalFailure; }
      if (controller.signal.aborted) { outcome = 'cancelled'; throw cancelled(); }
      if (error instanceof HelperError) throw fail(error.message);
      // SDK errors may contain prompts or credentials; only our stage labels reach the UI.
      throw fail(`Research could not finish: ${phase}. Your answers are saved; try again after checking Copilot.`);
    } finally {
      ended = true;
      const elapsed = Math.floor(clock.now() - started);
      clock.clearTimeout(timer);
      const stopped = await stopClient();
      try {
        if (usage) {
          if (stopped !== false && directory) await reconcileUsageJournal(join(directory, 'home', 'session-state', sessionId, 'events.jsonl'), usage);
          await usage.flush();
        }
        if (stopped === false) throw new Error('Helper did not stop');
        await usage?.finish?.(outcome);
      } catch {
        // Retain the original journal and a discoverable recovery pointer; never retry inference.
        if (directory && usageDirectory) {
          await mkdir(usageDirectory, { recursive: true }).then(() => writeFile(join(usageDirectory, `recovery-${sessionId}.json`), JSON.stringify({ sessionId, directory }), { mode: 0o600 })).catch(() => {});
        }
        await usage?.finish?.('failed').catch(() => {});
        const error = fail('Helper cleanup or usage accounting failed. Recovery files were retained locally; no additional model call was made.');
        if (stopped === false) error.releaseConfirmed = stopAttempt;
        throw error;
      }
      if (directory) {
        const inside = relative(tmpdir(), directory);
        if (!inside || isAbsolute(inside) || inside.startsWith('..') || !basename(directory).startsWith(`explorer-${operation}-`)) throw fail('Research cleanup path could not be verified.');
        await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => { throw fail('Research finished but temporary files could not be removed.'); });
      }
      if (work?.report && (outcome === 'completed' || terminalReason)) {
        try { report(work.report({ reason: outcome === 'completed' ? 'model-completed' : terminalReason, elapsedMs: Number.isSafeInteger(elapsed) && elapsed >= 0 && elapsed <= 3600000 ? elapsed : null })); }
        catch { throw fail('Research could not retain its effort summary. Previous findings were kept.'); }
      }
    }
  }
  return { run, async close() { for (const controller of active.keys()) controller.abort(); await Promise.allSettled([...active.values()]); } };
}

export async function deadline(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(fail('Research setup timed out. Try again after checking Copilot.')), ms); })]); }
  finally { clearTimeout(timer); }
}
