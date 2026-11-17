import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createCleaner, cleanupText, parseCleanup } from '../com.github.copilot/extensions/explorer/cleanup.mjs';
import { DraftClient } from '../com.github.copilot/extensions/explorer/web/drafts.mjs';

test('cleanup validates exact Unicode, maximum characters and strict bounded JSON without truncation', () => {
  const text = ' 😀 Élodie 42, maybe?\n';
  assert.equal(cleanupText(text), text);
  assert.equal(cleanupText('界'.repeat(20000)).length, 20000);
  for (const value of ['', ' \n', null, 'a'.repeat(20001)]) assert.throws(() => cleanupText(value));
  assert.equal(parseCleanup(JSON.stringify({ text })), text);
  assert.equal(parseCleanup('{"text":"' + '\\u754c'.repeat(20000) + '"}').length, 20000);
  for (const value of ['{}', '{"text":""}', '{"text":"ok","other":1}', '```json\n{"text":"ok"}\n```', JSON.stringify({ text: 'x'.repeat(20001) }), ' '.repeat(121001)]) assert.throws(() => parseCleanup(value));
});

test('draft text identity ignores state and focus but catches A-B-A and restored replacements', async () => {
  const drafts = new Map(), node = { id: 'n', question: 'Q', answer: '', answerState: 'unanswered' };
  const client = new DraftClient({ drafts, changed() {}, restored() {}, fetch: async (_, options) => ({ ok: true, json: async () => options ? { revision: 1 } : { entries: [] } }) });
  client.reset('j', [node]); await client.ready;
  client.edit('n', 'A'); const start = client.entries.get('n').textGeneration;
  assert.equal(typeof start, 'number');
  client.selectState('n', 'assumption', 'A'); client.touch('n');
  assert.equal(client.entries.get('n').textGeneration, start);
  client.edit('n', 'B'); client.edit('n', 'A');
  assert.equal(client.entries.get('n').textGeneration, start + 2);
  await client.choose('n', 'discard', node);
  assert.ok(client.entries.get('n').textGeneration > start + 2);
});

const auth = { isAuthenticated: true, login: 'fixture', host: 'github.com' };
const model = { id: 'fixture', provider: { kind: 'copilot' }, policy: { state: 'enabled' } };
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-cleanup-test-')), calls = { sends: 0, stops: 0 };
  const parent = { rpc: { model: { getCurrent: async () => ({ modelId: model.id }), list: async () => ({ list: [options.model ?? model] }) }, gitHubAuth: { getStatus: async () => auth } } };
  const runtime = async () => ({ path: process.execPath, sdk: { RuntimeConnection: { forStdio: value => value }, CopilotClient: class {
    constructor(config) { calls.client = config; }
    async start() { options.start?.(); }
    async forceStop() { calls.stops++; }
    async createSession(config) {
      calls.config = config;
      return { sessionId: config.sessionId, rpc: { ...parent.rpc, gitHubAuth: { getStatus: async () => options.auth ?? auth },
        model: { ...parent.rpc.model, getCurrent: async () => ({ modelId: options.selectedModel ?? model.id }) },
        metadata: { snapshot: async () => ({ workingDirectory: options.wrongWorkspace ? dir : calls.client.workingDirectory, isRemote: options.remote ?? false }) },
        tools: { initializeAndValidate: async () => { calls.initialized = true; }, getCurrentMetadata: async () => ({ tools: options.tools ?? [] }) },
      }, sendAndWait: async input => {
        assert.equal(calls.initialized, true); calls.sends++; calls.prompt = input.prompt; await options.send?.(calls);
        config.onEvent({ id: 'receipt1', type: 'assistant.usage', timestamp: new Date().toISOString(), data: { inputTokens: 12, accounting: { sourceSessionId: config.sessionId, usageId: 'u1', sequence: 1 } } });
        return { data: { content: options.content ?? '{"text":"Maybe Élodie needs 42."}' } };
      } };
    }
  } } });
  const cleaner = createCleaner(parent, { runtime, usageDirectory: join(dir, 'usage'), ...(options.usageRecorder ? { usageRecorder: options.usageRecorder } : {}) });
  t.after(async () => { await cleaner.close(); if (calls.client) { const owned = dirname(calls.client.workingDirectory); assert.equal(dirname(resolve(owned)), resolve(tmpdir())); await rm(owned, { recursive: true, force: true }); } await rm(dir, { recursive: true, force: true }); });
  return { cleaner, calls, dir };
}

test('cleanup sends only captured text and fixed conservative instructions with zero initialized tools', async t => {
  const { cleaner, calls, dir } = await fixture(t);
  assert.equal(await cleaner.run('maybe Élodie needs 42'), 'Maybe Élodie needs 42.');
  assert.deepEqual(JSON.parse(calls.prompt), { text: 'maybe Élodie needs 42' });
  for (const word of ['meaning', 'uncertainty', 'names', 'numbers', 'voice', 'data']) assert.ok(calls.config.systemMessage.content.includes(word));
  assert.deepEqual(calls.config.availableTools, []); assert.equal(calls.config.enableConfigDiscovery, false);
  for (const flag of ['enableSkills', 'enableFileHooks', 'requestExtensions', 'enableSessionStore', 'enableHostGitOperations']) assert.equal(calls.config[flag], false);
  assert.equal((await calls.config.onPermissionRequest({ kind: 'url' })).kind, 'denied-by-rules');
  assert.equal((await calls.config.hooks.onPreToolUse({ toolName: 'read_file' })).permissionDecision, 'deny');
  assert.equal(calls.stops, 1); await assert.rejects(stat(calls.client.workingDirectory));
  const [id] = await readdir(join(dir, 'usage', 'session-state'));
  const journal = await readFile(join(dir, 'usage', 'session-state', id, 'events.jsonl'), 'utf8');
  assert.match(journal, /Explorer Answer Cleanup/); assert.match(journal, /session.usage_record/); assert.ok(!journal.includes('Élodie'));
});

test('cleanup fails closed before inference for tools/accounts and preserves input on errors/cancel', async t => {
  for (const options of [{ tools: [{ name: 'read_file' }] }, { auth: { ...auth, login: 'other' } }, { model: { ...model, provider: { kind: 'external' } } }, { model: { ...model, policy: { state: 'disabled' } } }, { selectedModel: 'other' }, { remote: true }, { wrongWorkspace: true }]) {
    const f = await fixture(t, options); await assert.rejects(f.cleaner.run('private')); assert.equal(f.calls.sends, 0);
  }
  const cancelled = new AbortController();
  const f = await fixture(t, { start: () => cancelled.abort() });
  await assert.rejects(f.cleaner.run('private', { signal: cancelled.signal }), /cancelled/); assert.equal(f.calls.sends, 0);
  const malformed = await fixture(t, { content: '{"text":"ok","answerState":"decided"}' });
  await assert.rejects(malformed.cleaner.run('private'), /invalid/); assert.equal(malformed.calls.sends, 1);
  const accounting = await fixture(t, { usageRecorder: async () => ({ record() {}, flush: async () => { throw Error('private'); } }) });
  await assert.rejects(accounting.cleaner.run('private'), /accounting failed/); assert.equal(accounting.calls.sends, 1);
  assert.ok((await readdir(join(accounting.dir, 'usage'))).some(name => name.startsWith('recovery-')));
});
