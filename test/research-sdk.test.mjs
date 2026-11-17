import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createResearcher, publicUrl, boundedContext, hostRuntime } from '../com.github.copilot/extensions/explorer/research.mjs';

test('bounded research context retains committed guidance inside its total budget', () => {
  const compact = boundedContext({ topic: 'A plan', objective: 'Decide for neighbors 🌿', successCriteria: 'Accessible to all', path: [{ question: 'Current question', answer: '' }], decisionsElsewhere: [] });
  assert.equal(compact.objective, 'Decide for neighbors 🌿');
  assert.equal(compact.successCriteria, 'Accessible to all');
  const large = boundedContext({ topic: 'A plan', objective: 'x'.repeat(2000), successCriteria: 'y'.repeat(4000), path: Array.from({ length: 200 }, (_, i) => ({ question: `Question ${i}`, answer: 'a'.repeat(1000) })), decisionsElsewhere: [] });
  assert.equal(large.objective.length, 2000);
  assert.equal(large.successCriteria.length, 4000);
  assert.ok(JSON.stringify(large).length <= 75000);
  assert.equal(large.truncated, true);
});

const result = { basis: 'reasoning', summary: 'Comparison', options: [
  { title: 'Small', description: 'Pilot', pros: ['Simple'], cons: ['Limited'] },
  { title: 'Large', description: 'Launch', pros: ['Reach'], cons: ['Cost'] },
], recommendation: 'Pilot first.', uncertainty: 'No pages read.', sources: [] };
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
  const parent = { rpc: { model: { getCurrent: async () => ({ modelId: model.id }), list: async () => ({ list: [model] }) }, gitHubAuth: { getStatus: async () => auth } } };
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
      }, sendAndWait: async input => { calls.sends++; calls.prompt = input.prompt; await options.send?.(calls); return { data: { content: JSON.stringify(options.result ?? result) } }; } };
    }
  } } });
  const researcher = createResearcher(parent, { usageDirectory: join(dir, 'usage'), runtime, ...(options.usageRecorder ? { usageRecorder: options.usageRecorder } : {}) });
  t.after(async () => {
    await researcher.close();
    if (calls.client) { const owned = dirname(calls.client.workingDirectory); assert.equal(dirname(resolve(owned)), resolve(tmpdir())); assert.match(owned, /explorer-research-/); await rm(owned, { recursive: true, force: true }); }
    assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true });
  });
  return { researcher, calls, dir };
}

test('helper uses isolated configuration, explicit research instructions, exact tools and no parent send', async t => {
  const { researcher, calls } = await fixture(t);
  assert.deepEqual(await researcher.run(context), result);
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
  const sourced = { ...result, basis: 'sources', sources: [{ title: 'Source', url: 'https://8.8.8.8/reference' }] };
  const bad = await fixture(t, { result: sourced });
  await assert.rejects(bad.researcher.run(context), /sources/);
  const good = await fixture(t, { result: sourced, send: async ({ config }) => {
    const input = { toolName: 'web_fetch', toolArgs: { url: sourced.sources[0].url }, toolCallId: 'read1' };
    assert.notEqual((await config.hooks.onPreToolUse(input))?.permissionDecision, 'deny');
    await config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: 'Reference content' } });
  } });
  assert.deepEqual(await good.researcher.run(context), sourced);
});

test('overlapping fetches without hook IDs cannot credit an unread page', async t => {
  const sourced = { ...result, basis: 'sources', sources: [{ title: 'Unread B', url: 'https://8.8.8.8/b' }] };
  const { researcher } = await fixture(t, { result: sourced, send: async ({ config }) => {
    const a = { toolName: 'web_fetch', toolArgs: { url: 'https://8.8.8.8/a' } };
    const b = { toolName: 'web_fetch', toolArgs: { url: 'https://8.8.8.8/b' } };
    await config.hooks.onPreToolUse(a); await config.hooks.onPreToolUse(b);
    config.hooks.onPostToolUse({ ...a, toolResult: { resultType: 'success', textResultForLlm: 'Only A was read' } });
    config.hooks.onPostToolUse({ ...b, toolResult: { resultType: 'failure', textResultForLlm: 'B failed' } });
  } });
  await assert.rejects(researcher.run(context), /tracking|sources/);
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
  assert.ok(JSON.stringify(compact).length < 90000); assert.equal(compact.path.at(-1).question, 'Question 199'); assert.equal(compact.truncated, true);
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
  const sourced = { ...result, basis: 'sources', sources: [{ title: 'Reference', url: 'https://8.8.8.8/reference' }] };
  const { researcher } = await fixture(t, { result: sourced, send: async ({ config }) => {
    const input = { toolName: 'web_fetch', toolArgs: { url: sourced.sources[0].url }, toolCallId: 'failed-read' };
    await config.hooks.onPreToolUse(input);
    config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'failure', textResultForLlm: 'Unable to retrieve' } });
  } });
  await assert.rejects(researcher.run(context), /sources/);
  const unsafe = await fixture(t, { send: () => { throw new Error('SECRET prompt endpoint token'); } });
  await assert.rejects(unsafe.researcher.run(context), error => !error.message.includes('SECRET') && /could not finish/.test(error.message));
});
