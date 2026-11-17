import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createResearcher, researchFraming, publicUrl, boundedContext, hostRuntime } from '../com.github.copilot/extensions/explorer/research.mjs';
import { prepareResearch } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { researchSettings, researchLimits } from '../com.github.copilot/extensions/explorer/web/research-policy.mjs';

test('research helper sends the exact prepared context without reselecting or clipping sources', async t => {
  const { researcher, calls } = await fixture(t), doc = createDocument('Unicode 🌿');
  addQuestions(doc, doc.rootId, [{ question: 'Target?', category: 'Target' }]);
  for (let i = 0; i < 8; i++) doc.nodes.push({ ...structuredClone(doc.nodes[1]), id: `source-${i}`, answer: '🌿'.repeat(10000) });
  doc.nodes[2].answer = 'EXCLUDED-SDK-CANARY\u0000\ud83c\udf3f<script>';
  const prepared = prepareResearch(doc, doc.nodes[1].id, { ...researchFraming(doc), excluded: [doc.nodes[2].id] });
  await researcher.run(prepared.context, { prepared });
  assert.equal(calls.prompt, prepared.prompt);
  assert.ok(!calls.prompt.includes('EXCLUDED-SDK-CANARY'));
  assert.equal(calls.config.systemMessage.content, prepared.instructions);
  assert.equal(Buffer.byteLength(calls.prompt) + Buffer.byteLength(calls.config.systemMessage.content), prepared.bytes);
  assert.equal(calls.prompt.split('EXPLORATION DATA\n')[1], JSON.stringify(prepared.context));
  assert.ok(prepared.context.truncated); assert.ok(prepared.bytes <= 131072);
});

test('bounded research context retains committed guidance inside its total budget', () => {
  const compact = boundedContext({ topic: 'A plan', objective: 'Decide for neighbors 🌿', successCriteria: 'Accessible to all', path: [{ question: 'Current question', answer: '' }], decisionsElsewhere: [] });
  assert.equal(compact.objective, 'Decide for neighbors 🌿');
  assert.equal(compact.successCriteria, 'Accessible to all');
  const large = boundedContext({ topic: 'A plan', objective: 'x'.repeat(2000), successCriteria: 'y'.repeat(4000), path: Array.from({ length: 200 }, (_, i) => ({ question: `Question ${i}`, answer: 'a'.repeat(1000) })), decisionsElsewhere: [] });
  assert.equal(large.objective.length, 2000);
  assert.equal(large.successCriteria.length, 4000);
  assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 131072);
  assert.equal(large.truncated, true);
});

const result = { basis: 'reasoning', summary: 'Comparison', options: [
  { title: 'Small', description: 'Pilot', pros: ['Simple'], cons: ['Limited'] },
  { title: 'Large', description: 'Launch', pros: ['Reach'], cons: ['Cost'] },
], recommendation: 'Pilot first.', uncertainty: 'No pages read.', sources: [], claims: [{ id: 'c1', text: 'Pilot first', basis: 'reasoning', evidence: [], limitations: 'No externally supported claim.' }] };
const auth = { isAuthenticated: true, login: 'fixture', host: 'github.com' };
const model = { id: 'fixture-model', provider: { kind: 'copilot' }, policy: { state: 'enabled' } };
const expectedTools = [{ name: 'web_fetch' }, { name: 'web_search', namespacedName: 'github-mcp-server/web_search', mcpServerName: 'github-mcp-server', mcpToolName: 'web_search' }];
const context = { topic: 'Pilot', path: [{ question: 'Who first?', answer: 'My decision' }], decisionsElsewhere: [] };

test('research distinguishes provisional states and carries no-text choices and review flags', async t => {
  const { researcher, calls } = await fixture(t);
  await researcher.run({ ...context, path: [{ question: 'Who first?', answer: 'Neighbors', answerState: 'assumption', review: true }], decisionsElsewhere: [{ question: 'When?', answer: '', answerState: 'revisit-later', review: false }, { question: 'What?', answer: '', answerState: 'needs-evidence', review: false }] });
  const supplied = JSON.parse(calls.prompt.split('EXPLORATION DATA\n')[1]);
  assert.equal(supplied.path[0].answerState, 'assumption'); assert.equal(supplied.path[0].review, true);
  assert.equal(supplied.decisionsElsewhere[0].answerState, 'revisit-later'); assert.equal(supplied.decisionsElsewhere[0].answer, '');
  assert.match(calls.prompt, /never external verification/); assert.match(calls.prompt, /Tentative is provisional/); assert.match(calls.prompt, /needs-review/);
});
test('research receives each fixed exploration strategy in its isolated prompt', async t => {
  const { researcher, calls } = await fixture(t);
  const strategies = {
    understand: /concepts, stakeholders and unknowns/i,
    decide: /choices, criteria and tradeoffs/i,
    design: /outcomes, constraints, interfaces and feasibility/i,
    diagnose: /symptoms, reproduction, evidence and alternative causes/i,
    challenge: /assumptions, counterexamples and possible failure conditions/i,
  };
  for (const [mode, strategy] of Object.entries(strategies)) {
    await researcher.run({ ...context, mode });
    assert.match(calls.prompt, strategy);
    assert.match(calls.prompt, new RegExp(`"mode":"${mode}"`));
  }
  assert.equal(calls.sends, 5);
  assert.equal(calls.stops, 5);
});

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-sdk-test-'));
  const calls = { sends: 0, stops: 0 };
  const parent = { rpc: { model: { getCurrent: async () => ({ modelId: model.id }), list: async () => ({ list: options.models ?? [model] }) }, gitHubAuth: { getStatus: async () => auth } } };
  const runtime = async () => ({ path: process.execPath, sdk: { RuntimeConnection: { forStdio: value => value }, CopilotClient: class {
    constructor(config) { calls.client = config; }
    async start() { await options.start?.(calls); }
    async forceStop() { calls.stops++; await options.stop?.(calls); }
    async createSession(config) {
      calls.config = config;
      return { sessionId: config.sessionId, rpc: { ...parent.rpc,
        gitHubAuth: { getStatus: async () => options.auth ?? auth },
        metadata: { snapshot: async () => ({ workingDirectory: calls.client.workingDirectory, isRemote: false }) },
        tools: { initializeAndValidate: async () => {}, getCurrentMetadata: async () => ({ tools: options.tools ?? expectedTools }) },
      }, sendAndWait: async (input, timeout) => { calls.sends++; calls.prompt = input.prompt; calls.timeout = timeout; await options.send?.(calls); return { data: { content: options.content ?? JSON.stringify(options.result ?? result) } }; } };
    }
  } } });
  const researcher = createResearcher(parent, { usageDirectory: join(dir, 'usage'), runtime, ...(options.usageRecorder ? { usageRecorder: options.usageRecorder } : {}), ...(options.clock ? { clock: options.clock } : {}), ...(options.resolve ? { resolve: options.resolve } : {}), ...(options.stopTimeoutMs ? { stopTimeoutMs: options.stopTimeoutMs } : {}) });
  t.after(async () => {
    await researcher.close();
    if (calls.client) { const owned = dirname(calls.client.workingDirectory); assert.equal(dirname(resolve(owned)), resolve(tmpdir())); assert.match(owned, /explorer-research-/); await rm(owned, { recursive: true, force: true }); }
    assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true });
  });
  return { researcher, calls, dir };
}

test('helper uses isolated configuration, explicit research instructions, exact tools and no parent send', async t => {
  const { researcher, calls } = await fixture(t);
  assert.deepEqual(await researcher.run(context), { ...result, settings: researchSettings() });
  assert.ok(calls.timeout > 170000 && calls.timeout <= 180000);
  assert.equal(calls.sends, 1); assert.equal(calls.stops, 1);
  assert.equal(calls.config.requestExtensions, false); assert.equal(calls.config.enableFileHooks, false);
  assert.equal(calls.config.enableConfigDiscovery, true); assert.equal(calls.client.useLoggedInUser, true);
  assert.match(calls.config.systemMessage.content, /explorer-research/);
  assert.match(calls.prompt, /My decision/);
  assert.deepEqual(calls.config.availableTools, ['builtin:web_fetch', 'mcp:web_search']);
  await assert.rejects(stat(calls.client.workingDirectory), { code: 'ENOENT' });
});

test('missing search or mismatched account prevents inference', async t => {
  for (const options of [{ tools: [{ name: 'web_fetch' }] }, { auth: { ...auth, login: 'other' } }]) {
    const { researcher, calls } = await fixture(t, options);
    await assert.rejects(researcher.run(context)); assert.equal(calls.sends, 0); assert.equal(calls.stops, 1);
  }
});

test('cancelling during startup never sends and stops the owned client', async t => {
  const controller = new AbortController();
  const { researcher, calls } = await fixture(t, { start: () => controller.abort() });
  await assert.rejects(researcher.run(context, { signal: controller.signal }), /cancelled/);
  assert.equal(calls.sends, 0); assert.equal(calls.stops, 1);
});

test('unread citations are rejected; successful page reads are required for sourced findings', async t => {
  const sourced = { ...result, basis: 'sources', sources: [{ id: 's1', title: 'Source', url: 'https://8.8.8.8/reference' }] };
  const bad = await fixture(t, { result: sourced });
  await assert.rejects(bad.researcher.run(context), /sources/);
  const good = await fixture(t, { result: sourced, send: async ({ config }) => {
    const input = { toolName: 'web_fetch', toolArgs: { url: sourced.sources[0].url }, toolCallId: 'read1' };
    assert.notEqual((await config.hooks.onPreToolUse(input))?.permissionDecision, 'deny');
    await config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: 'Reference content' } });
  } });
  const observed = await good.researcher.run(context);
  assert.equal(observed.sources[0].provenance, 'recorded-read'); assert.ok(Number.isFinite(Date.parse(observed.sources[0].retrievedAt)));
  assert.deepEqual(observed, { ...sourced, sources: [{ ...sourced.sources[0], retrievedAt: observed.sources[0].retrievedAt, provenance: 'recorded-read' }], settings: researchSettings() });
});

test('overlapping fetches without hook IDs cannot credit an unread page', async t => {
  const sourced = { ...result, basis: 'sources', sources: [{ id: 's1', title: 'Unread B', url: 'https://8.8.8.8/b' }] };
  const { researcher } = await fixture(t, { result: sourced, send: async ({ config }) => {
    const a = { toolName: 'web_fetch', toolArgs: { url: 'https://8.8.8.8/a' } };
    const b = { toolName: 'web_fetch', toolArgs: { url: 'https://8.8.8.8/b' } };
    await config.hooks.onPreToolUse(a); await config.hooks.onPreToolUse(b);
    config.hooks.onPostToolUse({ ...a, toolResult: { resultType: 'success', textResultForLlm: 'Only A was read' } });
    config.hooks.onPostToolUse({ ...b, toolResult: { resultType: 'failure', textResultForLlm: 'B failed' } });
  } });
  await assert.rejects(researcher.run(context), /tracking|sources/);
});

test('claim provenance uses actual successful read time, requested URL and this request only', async t => {
  const url = 'https://8.8.8.8/reference?q=1', sourced = { ...result, basis: 'sources', sources: [{ id: 's1', title: 'Reference', url, retrievedAt: '1900-01-01T00:00:00.000Z', provenance: 'forged' }], claims: [{ id: 'c1', text: 'A model assertion', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'A model interpretation of content' }], limitations: 'Read does not verify meaning.' }] };
  let afterRead, beforeRead, runs = 0;
  const f = await fixture(t, { result: sourced, send: async ({ config }) => {
    if (++runs > 1) return;
    const input = { toolName: 'web_fetch', toolArgs: { url: url + '#part' }, toolCallId: 'read-exact' };
    await config.hooks.onPreToolUse(input);
    beforeRead = Date.now();
    config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: 'Actual content', finalUrl: 'https://other.example/redirect' } });
    afterRead = Date.now();
  } });
  const observed = await f.researcher.run(context), source = observed.sources[0];
  assert.equal(source.url, url); assert.equal(source.provenance, 'recorded-read');
  assert.ok(Date.parse(source.retrievedAt) >= beforeRead && Date.parse(source.retrievedAt) <= afterRead);
  assert.deepEqual(observed.claims, sourced.claims); assert.equal(source.finalUrl, undefined);
  await assert.rejects(f.researcher.run(context), /sources.*read/);
});

test('search, blank, failed, mismatched and duplicate fetch IDs cannot fabricate claim provenance', async t => {
  const source = { id: 's1', title: 'Source', url: 'https://8.8.8.8/a' };
  for (const mode of ['search', 'blank', 'failed', 'mismatched', 'duplicate']) {
    const f = await fixture(t, { result: { ...result, basis: 'sources', sources: [source] }, send: async ({ config }) => {
      const input = { toolName: mode === 'search' ? 'web_search' : 'web_fetch', toolArgs: { url: source.url }, toolCallId: 'read' };
      await config.hooks.onPreToolUse(input);
      if (mode === 'duplicate') await config.hooks.onPreToolUse({ ...input, toolArgs: { url: 'https://8.8.8.8/b' } });
      if (mode === 'failed') config.hooks.onPostToolUseFailure({ ...input, error: 'Fetch failed' });
      config.hooks.onPostToolUse({ ...input, toolCallId: mode === 'mismatched' ? 'other' : 'read', toolResult: { resultType: 'success', textResultForLlm: mode === 'blank' ? '  ' : 'Page' } });
    } });
    await assert.rejects(f.researcher.run(context), /sources.*read|tracking/, mode);
  }
});

test('new helper results require claim records and enforce raw UTF-8 output envelope', async t => {
  const missing = { ...result }; delete missing.claims;
  const f = await fixture(t, { result: missing }); await assert.rejects(f.researcher.run(context), /invalid comparison/);
  const huge = { ...result, summary: '界'.repeat(5000), recommendation: '界'.repeat(5000), options: Array.from({ length: 4 }, () => ({ title: 'Option', description: '界'.repeat(3000), pros: Array(6).fill('界'.repeat(1000)), cons: [], proposedAnswer: '界'.repeat(5000) })) };
  assert.ok(JSON.stringify(huge).length < 80000); assert.ok(Buffer.byteLength(JSON.stringify(huge)) > 160000);
  const h = await fixture(t, { result: huge }); await assert.rejects(h.researcher.run(context), /invalid comparison/);
});

test('raw Unicode bytes and SDK character envelope accept their exact boundaries and reject one over', async t => {
  const value = { ...result, summary: '界'.repeat(5000), recommendation: '界'.repeat(5000), proposedAnswer: '界'.repeat(5000), options: Array.from({ length: 4 }, () => ({ title: 'Option', description: '界'.repeat(3000), pros: Array(6).fill('界'.repeat(1000)), cons: [] })) };
  const json = JSON.stringify(value), raw = json + ' '.repeat(160000 - Buffer.byteLength(json));
  assert.ok(raw.length < 80000); assert.equal(Buffer.byteLength(raw), 160000);
  const exact = await fixture(t, { content: raw }); assert.deepEqual(await exact.researcher.run(context), { ...value, settings: researchSettings() });
  const over = await fixture(t, { content: raw + ' ' }); await assert.rejects(over.researcher.run(context), /invalid comparison/);
  const small = JSON.stringify(result), chars = small + ' '.repeat(80000 - small.length);
  const exactChars = await fixture(t, { content: chars }); assert.deepEqual(await exactChars.researcher.run(context), { ...result, settings: researchSettings() });
  const overChars = await fixture(t, { content: chars + ' ' }); await assert.rejects(overChars.researcher.run(context), /invalid comparison/);
});

test('helper denies managed approval, sandbox bypass and unrelated permissions', async t => {
  const { researcher, calls } = await fixture(t); await researcher.run(context);
  const permit = calls.config.onPermissionRequest;
  for (const request of [{ kind: 'shell' }, { kind: 'read' }, { kind: 'url', url: 'http://127.0.0.1' }, { kind: 'url', url: 'https://8.8.8.8', managedApprovalRequired: true }, { kind: 'url', url: 'https://8.8.8.8', requestSandboxBypass: true }, { kind: 'mcp', serverName: 'other', toolName: 'web_search' }]) assert.equal((await permit(request, {})).kind, 'denied-by-rules');
  assert.equal((await permit({ kind: 'url', url: 'https://8.8.8.8' }, { promptRequest: { managedApprovalRequired: true } })).kind, 'denied-by-rules');
});

test('managed human approval or sandbox bypass terminates research visibly even if the model returns reasoning', async t => {
  for (const restriction of [{ managedApprovalRequired: true }, { requestSandboxBypass: true }]) {
    const { researcher, calls } = await fixture(t, { send: async ({ config }) => {
      assert.equal((await config.onPermissionRequest({ kind: 'url', url: 'https://8.8.8.8', ...restriction }, {})).kind, 'denied-by-rules');
    } });
    await assert.rejects(researcher.run(context), /requires.*approval|sandbox/i);
    assert.equal(calls.sends, 1); assert.equal(calls.stops, 1);
  }
});

test('public URL guard rejects local addresses, credentials, unusual ports and DNS answers', async () => {
  for (const url of ['file:///private', 'http://localhost', 'http://127.1', 'http://169.254.169.254', 'http://[::1]', 'http://10.1.2.3', 'https://user:secret@example.com', 'https://example.com:8443', 'https://local.test']) assert.equal(await publicUrl(url, async () => [{ address: '192.168.1.1' }]), false, url);
  assert.equal(await publicUrl('https://8.8.8.8'), true);
});

test('bounded context prioritizes the current question and marks omissions; runtime rejects ordinary node', () => {
  const large = { ...context, path: Array.from({ length: 200 }, (_, i) => ({ question: `Question ${i}`, answer: 'x'.repeat(20000) })), decisionsElsewhere: [] };
  const compact = boundedContext(large);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= 131072); assert.equal(compact.path.at(-1).question, 'Question 199'); assert.equal(compact.truncated, true);
  assert.throws(() => hostRuntime(process.execPath, ['node', 'script.mjs'], process.ppid, {}));
});

test('accounting failure preserves the helper journal and recovery pointer without retrying inference', async t => {
  const { researcher, calls, dir } = await fixture(t, {
    usageRecorder: async () => ({ record() {}, async flush() { throw new Error('private failure'); } }),
    send: async ({ client, config }) => {
      const folder = join(client.baseDirectory, 'session-state', config.sessionId); await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'events.jsonl'), JSON.stringify({ type: 'assistant.message', data: { content: 'recoverable private transcript' } }) + '\n');
    },
  });
  await assert.rejects(researcher.run(context), /accounting failed/);
  assert.equal(calls.sends, 1); assert.equal(calls.stops, 1);
  assert.ok(await stat(calls.client.workingDirectory));
  const pointer = (await readdir(join(dir, 'usage'))).find(name => name.startsWith('recovery-'));
  const recovery = JSON.parse(await readFile(join(dir, 'usage', pointer), 'utf8'));
  assert.equal(recovery.directory, dirname(calls.client.workingDirectory));
  assert.equal(recovery.sessionId, calls.config.sessionId);
});

test('failed page reads cannot validate sources and arbitrary SDK errors stay out of the UI', async t => {
  const sourced = { ...result, basis: 'sources', sources: [{ id: 's1', title: 'Reference', url: 'https://8.8.8.8/reference' }] };
  const { researcher } = await fixture(t, { result: sourced, send: async ({ config }) => {
    const input = { toolName: 'web_fetch', toolArgs: { url: sourced.sources[0].url }, toolCallId: 'failed-read' };
    await config.hooks.onPreToolUse(input);
    config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'failure', textResultForLlm: 'Unable to retrieve' } });
  } });
  await assert.rejects(researcher.run(context), /sources/);
  const unsafe = await fixture(t, { send: () => { throw new Error('SECRET prompt endpoint token'); } });
  await assert.rejects(unsafe.researcher.run(context), error => !error.message.includes('SECRET') && /could not finish/.test(error.message));
});
test('operation eligibility never replaces the enabled Copilot model checks', async t => {
  for (const candidate of [{ ...model, provider: { kind: 'external' } }, { ...model, policy: { state: 'disabled' } }]) {
    const { researcher, calls } = await fixture(t, { models: [candidate] });
    await assert.rejects(researcher.run(context), /enabled Copilot model/); assert.equal(calls.sends, 0); assert.equal(calls.config, undefined);
  }
});

function manualClock() {
  let now = 0, timer;
  return { now: () => now, setTimeout(fn, ms) { timer = { fn, ms }; return timer; }, clearTimeout(value) { assert.equal(value, timer); },
    advance(ms, fire = false) { now += ms; if (fire) timer.fn(); }, get limit() { return timer.ms; } };
}
for (const depth of ['quick', 'standard', 'deeper']) {
  const settings = researchSettings({ depth, sourceFocus: 'primary', recency: 'recent' }), limits = researchLimits(settings);
  test(`${depth} counts startup and sends only remaining milliseconds with trusted settings`, async t => {
    const clock = manualClock();
    const { researcher, calls } = await fixture(t, { clock, start: () => clock.advance(1234), result: { ...result, settings: { depth: 'forged' } } });
    const output = await researcher.run(context, { settings });
    assert.equal(clock.limit, limits.timeLimitMs); assert.equal(calls.timeout, limits.timeLimitMs - 1234);
    assert.deepEqual(output.settings, settings); assert.equal(calls.sends, 1);
    assert.match(calls.config.systemMessage.content, new RegExp(`${limits.toolAttemptLimit} tool attempts`));
    assert.match(calls.config.systemMessage.content, /Prioritize original studies/); assert.match(calls.config.systemMessage.content, /do not.*invent dates/);
    assert.doesNotMatch(calls.config.systemMessage.content, /at most 4 searches/);
  });
  test(`${depth} rejects at the exact startup deadline and allows one millisecond before`, async t => {
    for (const delta of [-1, 0, 1]) {
      const clock = manualClock(), f = await fixture(t, { clock, start: () => clock.advance(limits.timeLimitMs + delta) });
      if (delta < 0) { await f.researcher.run(context, { settings }); assert.equal(f.calls.timeout, 1); }
      else { await assert.rejects(f.researcher.run(context, { settings }), /timed out/); assert.equal(f.calls.sends, 0); }
      assert.equal(f.calls.stops, 1);
    }
  });
  test(`${depth} inference timer cancels and rejects late results without retry`, async t => {
    const clock = manualClock(), f = await fixture(t, { clock, send: () => clock.advance(limits.timeLimitMs, true) });
    await assert.rejects(f.researcher.run(context, { settings }), /timed out/); assert.equal(f.calls.sends, 1); assert.equal(f.calls.stops, 1);
  });
  test(`${depth} allows exactly the attempt ceiling and counts denied attempts`, async t => {
    for (const denied of [false, true]) {
      const f = await fixture(t, { send: async ({ config }) => {
        const hook = config.hooks.onPreToolUse;
        for (let i = 1; i <= limits.toolAttemptLimit; i++) {
          const response = await hook({ toolName: denied && i === 1 ? 'shell' : 'web_search' });
          assert.equal(response.permissionDecision, denied && i === 1 ? 'deny' : undefined);
        }
        assert.equal((await hook({ toolName: 'web_search' })).permissionDecision, 'deny');
      } });
      await assert.rejects(f.researcher.run(context, { settings }), /cancelled/); assert.equal(f.calls.sends, 1); assert.equal(f.calls.stops, 1);
    }
    const atLimit = await fixture(t, { send: async ({ config }) => { for (let i = 0; i < limits.toolAttemptLimit; i++) assert.deepEqual(await config.hooks.onPreToolUse({ toolName: 'web_search' }), {}); } });
    await atLimit.researcher.run(context, { settings });
  });
}
test('held DNS callbacks cannot approve after deadline, explicit cancellation or an overlapping over-budget attempt', async t => {
  for (const reason of ['timeout', 'cancel', 'attempts']) {
    const clock = manualClock(), controller = new AbortController(), releases = [];
    const f = await fixture(t, { clock, resolve: () => new Promise(resolve => releases.push(() => resolve([{ address: '8.8.8.8' }]))), send: async ({ config }) => {
      const fetch = config.hooks.onPreToolUse({ toolName: 'web_fetch', toolCallId: 'held', toolArgs: { url: 'https://public.example/read' } });
      const permission = config.onPermissionRequest({ kind: 'url', url: 'https://public.example/read' });
      assert.equal(releases.length, 2);
      if (reason === 'timeout') clock.advance(60000);
      if (reason === 'cancel') controller.abort();
      if (reason === 'attempts') for (let i = 0; i < 8; i++) await config.hooks.onPreToolUse({ toolName: 'shell' });
      releases.forEach(release => release());
      assert.equal((await fetch).permissionDecision, 'deny'); assert.equal((await permission).kind, 'denied-by-rules');
    } });
    await assert.rejects(f.researcher.run(context, { settings: { depth: 'quick', sourceFocus: 'balanced', recency: 'any' }, signal: controller.signal }), /cancelled/);
    assert.equal(f.calls.sends, 1); assert.equal(f.calls.stops, 1);
  }
});
test('a timed-out research run exposes late actual release instead of retrying inference', async t => {
  const clock = manualClock(); let release;
  const f = await fixture(t, { clock, stopTimeoutMs: 5, stop: () => new Promise(resolve => { release = resolve; }), send: () => clock.advance(60000, true) });
  let error;
  try { await f.researcher.run(context, { settings: { depth: 'quick', sourceFocus: 'balanced', recency: 'any' } }); } catch (value) { error = value; }
  assert.match(error.message, /cleanup or usage accounting/); assert.ok(error.releaseConfirmed); assert.equal(f.calls.sends, 1);
  release(); assert.equal(await error.releaseConfirmed, true); assert.equal(f.calls.stops, 1);
});
