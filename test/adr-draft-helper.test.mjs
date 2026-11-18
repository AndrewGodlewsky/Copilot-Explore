import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBriefHelper } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareAdrDraft } from '../com.github.copilot/extensions/explorer/adr-draft.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareAdrScope, captureAdrScope } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'adr-helper-test-')), calls = { sends: 0, stops: 0 }, doc = createDocument('Helper ADR fixture');
  const [node] = addQuestions(doc, doc.rootId, [{ question: 'Which option λ?', category: 'Design' }]);
  doc.adrScope = captureAdrScope(prepareAdrScope(doc, { focalId: node.id, nodeIds: [node.id], includeEvidence: false }, { scenario: null }));
  const prepared = prepareAdrDraft(doc, { scenario: null });
  const content = { title: 'Proposed fixture λ', status: 'proposed', sections: { context: [], drivers: [], alternatives: [], outcome: [], consequences: [], confirmation: [], optionDetails: [] } };
  const auth = { isAuthenticated: true, login: 'fixture', host: 'github.com' }, model = { id: 'fixture', provider: { kind: 'copilot' }, policy: { state: 'enabled' } };
  const parent = { rpc: { model: { getCurrent: async () => ({ modelId: model.id }), list: async () => ({ list: [model] }) }, gitHubAuth: { getStatus: async () => auth } } };
  const runtime = async () => ({ path: process.execPath, sdk: { RuntimeConnection: { forStdio: value => value }, CopilotClient: class {
    constructor(config) { calls.client = config; }
    async start() {}
    async forceStop() { calls.stops++; }
    async createSession(config) {
      calls.config = config;
      return { sessionId: config.sessionId, rpc: { ...parent.rpc, gitHubAuth: { getStatus: async () => options.wrongAccount ? { ...auth, login: 'different' } : auth },
        metadata: { snapshot: async () => ({ workingDirectory: calls.client.workingDirectory, isRemote: false }) },
        tools: { initializeAndValidate: async () => { calls.initialized = true; }, getCurrentMetadata: async () => ({ tools: options.tools ?? [] }) } },
        sendAndWait: async input => {
          assert.equal(calls.initialized, true); calls.sends++; calls.prompt = input.prompt;
          config.onEvent({ id: 'receipt1', type: 'assistant.usage', timestamp: new Date().toISOString(), data: { inputTokens: 12, accounting: { sourceSessionId: config.sessionId, usageId: 'u1', sequence: 1 } } });
          return { data: { content: JSON.stringify(options.content ?? content) } };
        } };
    }
  } } });
  const helper = createBriefHelper(parent, { runtime, usageDirectory: join(dir, 'usage') });
  t.after(async () => { await helper.close(); await rm(dir, { recursive: true, force: true }); });
  return { helper, prepared, calls, dir };
}
test('ADR owned helper sends exact reviewed input with no tools and retains distinctly attributed usage receipts', async t => {
  const f = await fixture(t), result = await f.helper.run(f.prepared);
  assert.equal(result.status, 'proposed'); assert.equal(f.calls.prompt, f.prepared.prompt); assert.equal(f.calls.config.systemMessage.content, f.prepared.instructions);
  assert.deepEqual(f.calls.config.availableTools, []); assert.equal(f.calls.config.enableConfigDiscovery, false); assert.equal(f.calls.config.enableSkills, false);
  assert.equal((await f.calls.config.onPermissionRequest({ kind: 'url' })).kind, 'denied-by-rules'); assert.equal((await f.calls.config.hooks.onPreToolUse({ toolName: 'read_file' })).permissionDecision, 'deny');
  assert.equal(f.calls.sends, 1); assert.equal(f.calls.stops, 1); await assert.rejects(stat(f.calls.client.workingDirectory), { code: 'ENOENT' });
  const [id] = await readdir(join(f.dir, 'usage', 'session-state')), journal = await readFile(join(f.dir, 'usage', 'session-state', id, 'events.jsonl'), 'utf8');
  assert.match(journal, /Explorer ADR Draft/); assert.match(journal, /session.usage_record/); assert.doesNotMatch(journal, /Proposed fixture|Which option/);
});
test('ADR helper refuses tools and changed accounts before inference and rejects unsupported generated status', async t => {
  for (const options of [{ tools: [{ name: 'web_fetch' }] }, { wrongAccount: true }]) {
    const f = await fixture(t, options); await assert.rejects(f.helper.run(f.prepared)); assert.equal(f.calls.sends, 0); assert.equal(f.calls.stops, 1);
  }
  const f = await fixture(t, { content: { title: 'Accepted', status: 'accepted', sections: {} } }); await assert.rejects(f.helper.run(f.prepared), /ADR|Invalid/i); assert.equal(f.calls.sends, 1);
});
