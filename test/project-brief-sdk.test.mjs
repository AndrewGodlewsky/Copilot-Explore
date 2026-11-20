import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createProjectBriefHelper, prepareProjectBrief, PROJECT_BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/project-brief.mjs';
import { waitFor } from './helpers/wait-for.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-project-brief-test-')), calls = { sends: 0, stops: 0 };
  const auth = { isAuthenticated: true, login: 'fixture', host: 'github.com' }, model = { id: 'selected-fixture', provider: { kind: 'copilot' }, policy: { state: 'enabled' } };
  const parent = { rpc: { model: { getCurrent: async () => ({ modelId: model.id }), list: async () => ({ list: [model] }) }, gitHubAuth: { getStatus: async () => auth } } };
  const output = Object.fromEntries(PROJECT_BRIEF_SECTIONS.map(section => [section, [{ id: section, text: `${section} remains unknown.`, kind: 'unknown', sources: [] }]]));
  const runtime = async () => ({ path: process.execPath, sdk: { RuntimeConnection: { forStdio: value => value }, CopilotClient: class {
    constructor(config) { calls.client = config; }
    async start() {}
    async forceStop() { calls.stops++; calls.release?.(); }
    async createSession(config) {
      calls.config = config;
      return { sessionId: config.sessionId, rpc: { ...parent.rpc, gitHubAuth: { getStatus: async () => options.auth ?? auth },
        metadata: { snapshot: async () => ({ workingDirectory: calls.client.workingDirectory, isRemote: false }) },
        tools: { initializeAndValidate: async () => { calls.initialized = true; }, getCurrentMetadata: async () => ({ tools: options.tools ?? [] }) },
      }, sendAndWait: async input => {
        assert.equal(calls.initialized, true); calls.sends++; calls.prompt = input.prompt;
        if (options.hold) await new Promise(resolve => { calls.release = resolve; });
        config.onEvent({ id: 'receipt', type: 'assistant.usage', timestamp: new Date().toISOString(), data: { inputTokens: 12, accounting: { sourceSessionId: config.sessionId, usageId: 'usage1', sequence: 1 } } });
        return { data: { content: options.content ?? JSON.stringify(output) } };
      } };
    }
  } } });
  let helper;
  t.after(async () => {
    await helper?.close();
    if (calls.client) { const owned = dirname(calls.client.workingDirectory); assert.equal(dirname(resolve(owned)), resolve(tmpdir())); assert.ok(basename(owned).startsWith('explorer-project-brief-')); await rm(owned, { recursive: true, force: true }); }
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('explorer-project-brief-test-')); await rm(directory, { recursive: true, force: true });
  });
  helper = createProjectBriefHelper(parent, { runtime, usageDirectory: join(directory, 'usage') });
  const excerpt = 'PRIVATE_PROJECT_BRIEF_CANARY 🌿', fingerprint = createHash('sha256').update(excerpt).digest('hex');
  const prepared = prepareProjectBrief({ id: randomUUID(), sources: [{ id: randomUUID(), name: 'README.md', fingerprint, excerptFingerprint: fingerprint, bytes: Buffer.byteLength(excerpt), excerptBytes: Buffer.byteLength(excerpt), truncated: false, excerpt }] });
  const journal = async () => { const [id] = await readdir(join(directory, 'usage/session-state')); return readFile(join(directory, 'usage/session-state', id, 'events.jsonl'), 'utf8'); };
  return { helper, prepared, calls, journal };
}

test('project brief uses the selected model with zero tools, exact reviewed input and content-free retained usage', async t => {
  const f = await fixture(t); const brief = await f.helper.run(f.prepared); assert.equal(brief.sections.purpose[0].kind, 'unknown');
  assert.equal(f.calls.config.model, 'selected-fixture'); assert.equal(f.calls.prompt, f.prepared.prompt); assert.equal(f.calls.config.systemMessage.content, f.prepared.instructions);
  assert.deepEqual(f.calls.config.availableTools, []);
  for (const flag of ['enableConfigDiscovery', 'enableSkills', 'enableFileHooks', 'requestExtensions', 'enableSessionStore', 'enableHostGitOperations']) assert.equal(f.calls.config[flag], false);
  assert.equal((await f.calls.config.onPermissionRequest({ kind: 'url' })).kind, 'denied-by-rules');
  assert.equal((await f.calls.config.hooks.onPreToolUse({ toolName: 'read_file' })).permissionDecision, 'deny');
  assert.equal(f.calls.stops, 1); const journal = await f.journal(); assert.match(journal, /Explorer Project Brief/); assert.match(journal, /session.usage_record/); assert.ok(!journal.includes('PRIVATE_PROJECT_BRIEF_CANARY'));
});

test('project brief rejects unexpected tools or mismatched helper account before inference', async t => {
  for (const options of [{ tools: [{ name: 'read_file' }] }, { auth: { isAuthenticated: true, login: 'other', host: 'github.com' } }]) {
    const f = await fixture(t, options); await assert.rejects(f.helper.run(f.prepared)); assert.equal(f.calls.sends, 0); assert.equal(f.calls.stops, 1);
  }
});

test('project brief cancellation stops only its owned helper and malformed model output never becomes a brief', async t => {
  const f = await fixture(t, { hold: true }), abort = new AbortController(), pending = f.helper.run(f.prepared, { signal: abort.signal }), rejected = assert.rejects(pending, /cancelled|timed out/i);
  await waitFor(() => f.calls.release); abort.abort(); await rejected; assert.equal(f.calls.stops, 1);
  const malformed = await fixture(t, { content: '{"invented":true}' }); await assert.rejects(malformed.helper.run(malformed.prepared), /Invalid project brief/); assert.equal(malformed.calls.sends, 1);
});
