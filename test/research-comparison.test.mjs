import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createResearcher } from '../com.github.copilot/extensions/explorer/research.mjs';
import { operationEvidence } from '../com.github.copilot/extensions/explorer/operation-recovery.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { sameResearchSources, sameResearchDestination } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { comparisonInput, prepareReconsideration, comparisonResult, parseReconsideration, COMPARISON_RESULT_LIMIT } from '../com.github.copilot/extensions/explorer/research-comparison.mjs';

const criteria = [{ id: 'coordination', label: 'Coordination effort', priority: 'high' }, { id: 'variety', label: 'Variety 🌿', priority: 'normal' }];
function document() {
  const doc = createDocument('Neighborhood tool library');
  addQuestions(doc, doc.rootId, [{ question: 'Who should join the pilot?', category: 'Scope' }]);
  doc.nodes[1].research = {
    basis: 'reasoning', summary: 'Two possible scopes',
    options: [
      { title: 'One block', description: 'Start close to home', pros: ['Fewer handovers'], cons: ['Fewer tools'], details: [{ label: 'Coordination effort', value: 'Fewer people to coordinate' }] },
      { title: 'Whole neighborhood', description: 'Invite broadly', pros: ['Potential variety'], cons: ['More coordination'] },
    ],
    recommendation: 'Start with one block', uncertainty: 'Actual participation is unknown', sources: [],
    claims: [{ id: 'c1', text: 'A smaller group may be easier to coordinate', basis: 'reasoning', evidence: [], limitations: 'Not verified' }],
  };
  return doc;
}
function ready(doc = document()) { return prepareReconsideration(doc, doc.nodes[1].id, { criteria }); }
function result(prepared) {
  return {
    cells: prepared.comparison.criteria.flatMap(criterion => prepared.comparison.options.map(option => ({ criterionId: criterion.id, optionId: option.id, explanation: 'Unknown without a local pilot', basis: 'unknown', claimIds: [] }))),
    recommendation: { optionId: prepared.comparison.options[0].id, reason: 'Fits the hypothetical coordination priority', changed: 'Coordination has explicit priority', unchanged: 'Participation remains unknown' },
    uncertainty: 'This is model reasoning using prior information only',
  };
}

test('comparison priorities are bounded, distinct, literal and do not mutate their input', () => {
  const input = { criteria: [{ id: 'custom', label: '🌿'.repeat(80), priority: 'low' }] }, before = structuredClone(input);
  assert.deepEqual(comparisonInput(input), input); assert.deepEqual(input, before);
  for (const invalid of [null, { criteria: [] }, { criteria, extra: true }, { criteria: [...criteria, criteria[0]] },
    { criteria: [{ ...criteria[0], label: ' ' }] }, { criteria: [{ ...criteria[0], label: '🌿'.repeat(81) }] },
    { criteria: [{ ...criteria[0], priority: 'critical' }] }, { criteria: [{ ...criteria[0], weight: 5 }] },
    { criteria: [{ ...criteria[0], id: 'bad id' }] },
    { criteria: [criteria[0], { ...criteria[1], label: 'ＣＯＯＲＤＩＮＡＴＩＯＮ EFFORT' }] },
    { criteria: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, label: `Criterion ${i}`, priority: 'normal' })) },
  ]) assert.throws(() => comparisonInput(invalid), /criteri|priorit/i);
});

test('reconsideration captures all compared options and prior evidence with measured immutable exact inputs', () => {
  const doc = document(), before = structuredClone(doc), prepared = ready(doc);
  assert.equal(prepared.operation, 'research-reconsideration');
  assert.deepEqual(prepared.limits, { timeLimitMs: 180000, toolAttemptLimit: 0 });
  assert.deepEqual(prepared.comparison.criteria, criteria);
  assert.deepEqual(prepared.comparison.options.map(option => option.id), ['legacy-1', 'legacy-2']);
  assert.deepEqual(prepared.comparison.prior.claims, doc.nodes[1].research.claims);
  assert.equal(prepared.comparison.prior.recommendation, doc.nodes[1].research.recommendation);
  assert.match(prepared.instructions, /no new retrieval/i); assert.match(prepared.instructions, /hypothetical/i);
  assert.ok(prepared.prompt.includes(JSON.stringify(prepared.comparison)));
  assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
  assert.ok(prepared.bytes <= 131072); assert.ok(Object.isFrozen(prepared.comparison.criteria[0]));
  assert.deepEqual(doc, before);
  assert.equal(sameResearchSources(prepared.dependencies, doc), true); assert.equal(sameResearchDestination(prepared.dependencies, doc), true);
  doc.nodes[1].research.options[0].description = 'Changed choice';
  assert.equal(sameResearchDestination(prepared.dependencies, doc), false);
  doc.nodes[1].answer = 'New saved assumption';
  assert.equal(sameResearchSources(prepared.dependencies, doc), false);
});

test('reconsideration retains versioned option IDs and rejects missing or stale comparisons', () => {
  const doc = document(), research = doc.nodes[1].research;
  research.optionsVersion = 1;
  research.options.forEach((option, i) => Object.assign(option, { id: `choice-${i}`, fit: 'Hypothetical fit', proposedAnswer: `Choose option ${i}` }));
  assert.deepEqual(ready(doc).comparison.options.map(option => option.id), ['choice-0', 'choice-1']);
  doc.nodes[1].researchStale = true; assert.throws(() => ready(doc), /stale|current|research again/i);
  delete doc.nodes[1].researchStale; doc.nodes[1].research = null; assert.throws(() => ready(doc), /research/i);
  assert.throws(() => prepareReconsideration(doc, doc.rootId, { criteria }), /question/i);
});

test('reconsideration preserves whole mandatory comparisons while optional map context is omitted', () => {
  const doc = document();
  for (let i = 0; i < 20; i++) doc.nodes.push({ id: `extra-${i}`, parentId: doc.rootId, question: `Coordination constraint ${i}?`, category: 'Scope', answer: 'Large saved context '.repeat(1000), answerState: 'assumption', research: null, review: false });
  const prepared = ready(doc);
  assert.ok(prepared.coverage.omitted.budget > 0);
  assert.equal(prepared.comparison.options.length, 2); assert.equal(prepared.comparison.criteria.length, 2);
  assert.equal(prepared.comparison.prior.claims.length, 1);
  doc.nodes[1].answer = '\0'.repeat(20000); doc.objective = '\0'.repeat(4000);
  assert.throws(() => ready(doc), /mandatory|128 KiB/);
});

test('comparison result requires one complete criterion-by-option grid and known recommendation identity', () => {
  const prepared = ready(), value = result(prepared);
  assert.deepEqual(comparisonResult(value, prepared), value);
  assert.deepEqual(parseReconsideration(JSON.stringify(value), prepared), value);
  for (const patch of [
    { cells: value.cells.slice(1) }, { cells: [...value.cells, value.cells[0]] },
    { cells: value.cells.map((cell, i) => i ? cell : { ...cell, criterionId: 'absent' }) },
    { cells: value.cells.map((cell, i) => i ? cell : { ...cell, optionId: 'absent' }) },
    { recommendation: { ...value.recommendation, optionId: 'absent' } },
    { recommendation: { ...value.recommendation, changed: '' } },
    { recommendation: { ...value.recommendation, unchanged: ' ' } },
    { score: 99 }, { uncertainty: '' },
  ]) assert.throws(() => comparisonResult({ ...value, ...patch }, prepared), /comparison|recommendation/i);
  value.recommendation.optionId = null; assert.equal(comparisonResult(value, prepared).recommendation.optionId, null);
});

test('comparison support can cite only included prior claims and cannot invent sources or scores', () => {
  const prepared = ready(), value = result(prepared), cell = value.cells[0];
  Object.assign(cell, { basis: 'prior-claim', claimIds: ['c1'] });
  assert.deepEqual(comparisonResult(value, prepared).cells[0].claimIds, ['c1']);
  for (const patch of [{ claimIds: ['missing'] }, { claimIds: ['c1', 'c1'] }, { claimIds: [] },
    { basis: 'sources' }, { basis: 'reasoning' }, { basis: 'unknown' }, { sourceUrl: 'https://example.com/invented' }, { score: 10 },
  ]) assert.throws(() => comparisonResult({ ...value, cells: [{ ...cell, ...patch }, ...value.cells.slice(1)] }, prepared), /comparison|claim/i);
  const literal = '<script>literal 日本語 🌿</script>';
  value.cells[0].explanation = literal;
  assert.equal(comparisonResult(value, prepared).cells[0].explanation, literal);
});

test('comparison parsing rejects oversized, malformed and unknown payload fields without partial acceptance', () => {
  const prepared = ready(), value = result(prepared);
  assert.throws(() => parseReconsideration('{', prepared), /comparison/i);
  assert.throws(() => parseReconsideration(' '.repeat(COMPARISON_RESULT_LIMIT + 1), prepared), /comparison/i);
  value.cells[0].explanation = 'x'.repeat(601);
  assert.throws(() => comparisonResult(value, prepared), /comparison/i);
  const doc = document(); doc.nodes[1].research.options.push(...structuredClone(doc.nodes[1].research.options));
  const large = prepareReconsideration(doc, doc.nodes[1].id, { criteria: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `Criterion ${i}`, priority: 'normal' })) });
  const oversized = result(large); oversized.cells.forEach(cell => { cell.explanation = '\0'.repeat(600); });
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > COMPARISON_RESULT_LIMIT);
  assert.throws(() => comparisonResult(oversized, large), /comparison/i);
});

async function helperFixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-comparison-test-')), prepared = ready(), calls = { sends: 0, stops: 0 };
  const auth = { isAuthenticated: true, login: 'fixture', host: 'github.com' };
  const models = ['fixture-chat', 'fixture-dedicated'].map(id => ({ id, provider: { kind: 'copilot' }, policy: { state: 'enabled' } }));
  const mode = options.mode ?? 'dedicated', selected = mode === 'chat' ? models[0] : models[1];
  const captured = { ...prepared, modelCapture: { mode, revision: 1, model: { id: selected.id, name: selected.id }, account: auth } };
  const parent = { rpc: { model: { getCurrent: async () => ({ modelId: models[0].id }), list: async () => ({ list: options.unavailable ? [] : models }) }, gitHubAuth: { getStatus: async () => options.parentAuth ?? auth } } };
  let finish;
  const runtime = async () => ({ path: process.execPath, sdk: { RuntimeConnection: { forStdio: value => value }, CopilotClient: class {
    constructor(config) { calls.client = config; }
    async start() {}
    async forceStop() { calls.stops++; finish?.(); }
    async createSession(config) {
      calls.config = config;
      return { sessionId: config.sessionId, rpc: { ...parent.rpc,
        model: { ...parent.rpc.model, getCurrent: async () => ({ modelId: options.wrongModel ? 'wrong-model' : config.model }) },
        metadata: { snapshot: async () => ({ workingDirectory: calls.client.workingDirectory, isRemote: false }) },
        tools: { initializeAndValidate: async () => { calls.initialized = true; }, getCurrentMetadata: async () => ({ tools: options.tools ?? [] }) },
      }, sendAndWait: async (input, timeout) => {
        assert.equal(calls.initialized, true); calls.sends++; calls.prompt = input.prompt; calls.timeout = timeout;
        config.onEvent({ id: 'receipt1', type: 'assistant.usage', timestamp: new Date().toISOString(), data: { inputTokens: 12, accounting: { sourceSessionId: config.sessionId, usageId: 'u1', sequence: 1 } } });
        if (options.hold) await new Promise(resolve => { finish = resolve; options.started?.(); });
        return { data: { content: options.content ?? JSON.stringify(result(prepared)) } };
      } };
    }
  } } });
  const helper = createResearcher(parent, { runtime, usageDirectory: join(dir, 'usage') });
  t.after(async () => {
    await helper.close();
    if (calls.client) { const owned = dirname(calls.client.workingDirectory); assert.equal(dirname(resolve(owned)), resolve(tmpdir())); await rm(owned, { recursive: true, force: true }); }
    assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true });
  });
  return { helper, calls, dir, prepared: captured, expected: result(prepared) };
}

for (const mode of ['chat', 'dedicated']) test(`reconsideration helper uses reviewed ${mode} model, exact strings, zero tools and attributed private usage`, async t => {
  const f = await helperFixture(t, { mode });
  assert.deepEqual(await f.helper.runReconsideration(f.prepared.context, { prepared: f.prepared }), f.expected);
  assert.equal(f.calls.config.model, f.prepared.modelCapture.model.id);
  assert.equal(f.calls.prompt, f.prepared.prompt); assert.equal(f.calls.config.systemMessage.content, f.prepared.instructions);
  assert.deepEqual(f.calls.config.availableTools, []); assert.equal(f.calls.config.enableConfigDiscovery, false);
  for (const flag of ['enableSkills', 'enableFileHooks', 'requestExtensions', 'enableSessionStore', 'enableHostGitOperations']) assert.equal(f.calls.config[flag], false);
  assert.equal((await f.calls.config.onPermissionRequest({ kind: 'url', url: 'https://example.com' })).kind, 'denied-by-rules');
  assert.equal((await f.calls.config.hooks.onPreToolUse({ toolName: 'web_fetch' })).permissionDecision, 'deny');
  assert.ok(f.calls.timeout > 0 && f.calls.timeout <= 180000); assert.equal(f.calls.stops, 1);
  await assert.rejects(stat(f.calls.client.workingDirectory));
  const [id] = await readdir(join(f.dir, 'usage', 'session-state'));
  const journal = await readFile(join(f.dir, 'usage', 'session-state', id, 'events.jsonl'), 'utf8');
  assert.match(journal, /Explorer Research Reconsideration/); assert.match(journal, /session.usage_record/);
  const operation = JSON.parse(await readFile(join(f.dir, 'usage', 'session-state', id, 'operation.json'), 'utf8'));
  assert.equal(operation.model, f.prepared.modelCapture.model.id); assert.equal(operation.status, 'completed');
  assert.deepEqual(await operationEvidence(f.dir), [], 'completed comparison is not mistaken for unknown interrupted work');
  assert.ok(!journal.includes('Neighborhood tool library')); assert.ok(!journal.includes('Coordination effort'));
});

for (const options of [{ tools: [{ name: 'web_fetch' }] }, { unavailable: true }, { wrongModel: true }, { parentAuth: { isAuthenticated: true, login: 'different', host: 'github.com' } }]) test(`reconsideration rejects unavailable isolation or reviewed identity ${JSON.stringify(options)}`, async t => {
  const f = await helperFixture(t, options);
  await assert.rejects(f.helper.runReconsideration(f.prepared.context, { prepared: f.prepared }));
  assert.equal(f.calls.sends, 0);
});

test('reconsideration cancellation stops only its owned helper and rejects a late result', async t => {
  let started; const pending = new Promise(resolve => { started = resolve; });
  const f = await helperFixture(t, { hold: true, started }), controller = new AbortController();
  const task = f.helper.runReconsideration(f.prepared.context, { prepared: f.prepared, signal: controller.signal });
  await pending; controller.abort(); await assert.rejects(task, /cancelled|timed out/i);
  assert.equal(f.calls.sends, 1); assert.equal(f.calls.stops, 1);
  assert.deepEqual(await operationEvidence(f.dir), []);
});

test('failed reconsideration remains attributed in recovery without exposing comparison input', async t => {
  const f = await helperFixture(t, { content: '{"unexpected":"result"}' });
  await assert.rejects(f.helper.runReconsideration(f.prepared.context, { prepared: f.prepared }), /comparison/i);
  const evidence = await operationEvidence(f.dir);
  assert.equal(evidence.length, 1); assert.equal(evidence[0].kind, 'research-reconsideration'); assert.equal(evidence[0].status, 'failed');
  assert.deepEqual(Object.keys(evidence[0]).sort(), ['id', 'kind', 'status']); assert.equal(f.calls.sends, 1);
});
