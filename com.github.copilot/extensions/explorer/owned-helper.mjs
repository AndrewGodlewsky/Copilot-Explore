import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createUsageRecorder, reconcileUsageJournal } from './research-usage.mjs';

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
const eligible = model => model?.provider?.kind === 'copilot' && typeof model.id === 'string' && (!model.policy || model.policy.state === 'enabled');
const sameAccount = (a, b) => a?.isAuthenticated === true && b?.isAuthenticated === true && !!a.login && !!a.host && a.login.toLowerCase() === b.login?.toLowerCase() && a.host.toLowerCase() === b.host?.toLowerCase();

// Only fixtures inject a runtime. Production resolves the pair supplied by the desktop bootstrap.
export function createOwnedHelper(parent, operation, prepare, { usageDirectory, runtime = desktopRuntime, usageRecorder = createUsageRecorder, stopTimeoutMs = 10000 } = {}) {
  if (!['research', 'decision-brief', 'cleanup', 'question-help-rephrase', 'question-help-example', 'question-help-terms'].includes(operation)) throw new Error('Invalid helper operation.');
  const label = { 'decision-brief': 'Decision brief', research: 'Research', cleanup: 'Answer cleanup', 'question-help-rephrase': 'Question rephrase', 'question-help-example': 'Question example', 'question-help-terms': 'Question terms' }[operation];
  const fail = message => new HelperError(message.replaceAll('Research', label).replaceAll('research', label.toLowerCase()));
  const cancelled = () => fail('Research was cancelled or timed out. Your answers are saved.');
  const active = new Map();
  function run(context, { signal, onProgress = () => {} } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const task = execute(context, controller, onProgress).finally(() => { signal?.removeEventListener('abort', abort); active.delete(controller); });
    active.set(controller, task);
    return task;
  }
  async function execute(context, controller, progress) {
    let client, directory, usage, stop, stopAttempt, phase = 'preparing the SDK';
    const sessionId = randomUUID();
    let terminalFailure;
    const stopWith = message => { terminalFailure ??= fail(message); controller.abort(); };
    const check = () => { if (terminalFailure) throw terminalFailure; if (controller.signal.aborted) throw cancelled(); };
    const stopClient = () => {
      if (client && !stop) {
        stopAttempt = Promise.resolve().then(() => client.forceStop()).then(() => true, () => false);
        stop = deadline(stopAttempt, stopTimeoutMs).then(value => value, () => false);
      }
      return stop;
    };
    controller.signal.addEventListener('abort', () => void stopClient(), { once: true });
    const timer = setTimeout(() => controller.abort(), 180000); timer.unref?.();
    const stage = value => { phase = value; progress(value); check(); };
    try {
      check(); stage('Checking Copilot access');
      const { sdk, path } = await deadline(runtime(), 15000); check();
      const [selected, catalog, auth] = await deadline(Promise.all([
        parent.rpc.model.getCurrent(), parent.rpc.model.list({ refresh: true }), parent.rpc.gitHubAuth.getStatus(),
      ]), 20000); check();
      const model = catalog.list?.find(m => eligible(m) && m.id === selected.modelId);
      if (!auth.isAuthenticated) throw fail('Sign in to Copilot before using this helper.');
      if (!model) throw fail('Research needs an enabled Copilot model. Select one in the main chat and try again.');
      const work = await prepare(context, { controller, progress, stopWith, fail });
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
        sessionId, onEvent: event => usage.record(event), workingDirectory: workspace, configDirectory: home, model: model.id,
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
        session.rpc.gitHubAuth.getStatus(), session.rpc.model.list({ refresh: true }), session.rpc.metadata.snapshot(),
      ]), 20000); check();
      if (!sameAccount(auth, helperAuth)) throw fail('The research account differs from the main Copilot account. Check your Copilot sign-in.');
      if (!helperModels.list?.some(m => eligible(m) && m.id === model.id)) throw fail('The selected model is unavailable for research. Choose an enabled Copilot model.');
      if (metadata.isRemote !== false || await realpath(metadata.workingDirectory) !== await realpath(workspace)) throw fail('Copilot could not isolate the research workspace.');
      stage(operation === 'research' ? 'Checking web research tools' : `Verifying ${label.toLowerCase()} has no tools`);
      await deadline(session.rpc.tools.initializeAndValidate(), 30000); check();
      const [tools, current, parentAuth, currentHelperAuth] = await deadline(Promise.all([
        session.rpc.tools.getCurrentMetadata(), session.rpc.model.getCurrent(), parent.rpc.gitHubAuth.getStatus(), session.rpc.gitHubAuth.getStatus(),
      ]), 15000); check();
      work.validateTools(tools);
      if (current.modelId !== model.id || !sameAccount(auth, parentAuth) || !sameAccount(auth, currentHelperAuth)) throw fail('The Copilot account or model changed while research was starting. Try again.');
      stage(work.stage);
      const response = await session.sendAndWait({ prompt: work.prompt }, 180000);
      check(); stage('Checking result');
      return work.parse(response?.data?.content);
    } catch (error) {
      if (terminalFailure) throw terminalFailure;
      if (controller.signal.aborted) throw cancelled();
      if (error instanceof HelperError) throw fail(error.message);
      // SDK errors may contain prompts or credentials; only our stage labels reach the UI.
      throw fail(`Research could not finish: ${phase}. Your answers are saved; try again after checking Copilot.`);
    } finally {
      clearTimeout(timer);
      const stopped = await stopClient();
      try {
        if (usage) {
          if (stopped !== false && directory) await reconcileUsageJournal(join(directory, 'home', 'session-state', sessionId, 'events.jsonl'), usage);
          await usage.flush();
        }
        if (stopped === false) throw new Error('Helper did not stop');
      } catch {
        // Retain the original journal and a discoverable recovery pointer; never retry inference.
        if (directory && usageDirectory) {
          await mkdir(usageDirectory, { recursive: true }).then(() => writeFile(join(usageDirectory, `recovery-${sessionId}.json`), JSON.stringify({ sessionId, directory }), { mode: 0o600 })).catch(() => {});
        }
        const error = fail('Helper cleanup or usage accounting failed. Recovery files were retained locally; no additional model call was made.');
        if (stopped === false) error.releaseConfirmed = stopAttempt;
        throw error;
      }
      if (directory) {
        const inside = relative(tmpdir(), directory);
        if (!inside || isAbsolute(inside) || inside.startsWith('..') || !basename(directory).startsWith(`explorer-${operation}-`)) throw fail('Research cleanup path could not be verified.');
        await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => { throw fail('Research finished but temporary files could not be removed.'); });
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
