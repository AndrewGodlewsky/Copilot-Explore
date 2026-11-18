import { waitFor } from './helpers/wait-for.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions, validateDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareContext, prepareResearch, sameResearchSources } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { helpContext, sameHelpContext } from '../com.github.copilot/extensions/explorer/web/question-help-context.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { researchFraming } from '../com.github.copilot/extensions/explorer/research.mjs';
import { randomUUID } from 'node:crypto';

const pin = { id: 'pin-01234567890123456789', text: '  User constraint 🌿\n\tkeep exactly  ' };
test('preparation freezes its capture without mutating or freezing caller-owned input', () => {
  const source = { topic: 'Topic', identity: { id: 'original' }, path: [{ id: 'target', question: 'Question' }], pins: [structuredClone(pin)] };
  const prepared = prepareContext(source); assert.ok(Object.isFrozen(prepared.context)); assert.ok(Object.isFrozen(prepared.context.identity));
  source.identity.id = 'changed'; source.path[0].question = 'Changed'; source.pins[0].text = 'Changed';
  assert.equal(prepared.context.identity.id, 'original'); assert.equal(prepared.context.path[0].question, 'Question'); assert.equal(prepared.context.pins[0].text, pin.text);
});
function fixture() { const doc = createDocument('Topic'); const [node] = addQuestions(doc, doc.rootId, [{ question: 'Target?', category: 'One' }]); return { doc, node }; }
test('pins are sparse, exact, strictly validated and exported with user provenance', () => {
  const { doc } = fixture(); assert.equal(Object.hasOwn(validateDocument(doc), 'pins'), false);
  doc.pins = [structuredClone(pin)]; assert.deepEqual(validateDocument(doc).pins, [pin]);
  assert.match(toMarkdown(doc), /User-supplied constraints/); assert.match(toMarkdown(doc), /not verified/);
  for (const pins of [[pin, pin], [{ ...pin, extra: true }], [{ id: 'bad id', text: 'x' }], [{ ...pin, text: ' ' }], [{ ...pin, text: 'x'.repeat(1001) }], Array.from({ length: 11 }, (_, i) => ({ id: `pin-01234567890123456789-${i}`, text: 'x' }))]) assert.throws(() => validateDocument({ ...doc, pins }));
});
test('preparation counts actual UTF-8 prompt plus instructions at limit and +/-1', () => {
  const { doc } = fixture(); const node = doc.nodes[0]; doc.pins = [structuredClone(pin)]; node.answer = '\0🌿\n';
  const base = prepareResearch(doc, node.id, { scope: 'path', instructions: 'fixed🌿', prefix: 'DATA\n' });
  assert.equal(base.bytes, Buffer.byteLength(base.instructions) + Buffer.byteLength(base.prompt));
  for (const delta of [-1, 0, 1]) {
    const options = { scope: 'path', instructions: 'fixed🌿', prefix: 'DATA\n' + 'x'.repeat(131072 - base.bytes + delta) };
    if (delta > 0) assert.throws(() => prepareResearch(doc, node.id, options), /mandatory|target and guidance/i);
    else { const result = prepareResearch(doc, node.id, options); assert.equal(result.bytes, 131072 + delta); }
  }
});
test('scope and freshness include only actual transmitted values, all pins and identity', () => {
  const { doc, node } = fixture(); doc.pins = [structuredClone(pin)];
  const [other] = addQuestions(doc, doc.rootId, [{ question: 'Other?', category: 'Two' }]); other.answer = 'saved';
  const path = prepareResearch(doc, node.id, { scope: 'path' });
  assert.deepEqual(path.context.pins, [pin]); assert.equal(path.context.decisionsElsewhere.length, 0);
  assert.equal(path.coverage.omitted.scope, 1); other.answer = 'changed'; assert.ok(sameResearchSources(path.dependencies, doc));
  const all = prepareResearch(doc, node.id, { scope: 'decisions' }); assert.equal(all.context.decisionsElsewhere[0].id, other.id);
  doc.pins[0].text += '!'; assert.equal(sameResearchSources(path.dependencies, doc), false);
});
test('question help includes bounded explicit pins without selected answer or other branches', () => {
  const { doc, node } = fixture(); doc.pins = [structuredClone(pin)]; node.answer = 'secret selected answer';
  const input = helpContext(doc, node.id); assert.deepEqual(input.pins, [pin]); assert.equal(JSON.stringify(input).includes(node.answer), false);
  doc.pins[0].text += '!'; assert.equal(sameHelpContext(input, doc), false);
  doc.pins = Array.from({ length: 10 }, (_, i) => ({ id: `pin-01234567890123456789-${i}`, text: '\0'.repeat(1000) }));
  assert.throws(() => helpContext(doc, node.id), /guidance.*limit/);
});

test('deep and near-cap wide maps select whole records deterministically by distance then ID', () => {
  const { doc, node } = fixture();
  for (let i = 0; i < 3998; i++) doc.nodes.push({ ...node, id: `wide-${String(i).padStart(4, '0')}`, answer: 'x'.repeat(2000) });
  assert.ok(Buffer.byteLength(JSON.stringify(validateDocument(doc), null, 2)) > 8 * 1024 * 1024);
  const prepared = prepareResearch(doc, node.id, researchFraming(doc));
  assert.equal(prepared.context.decisionsElsewhere[0].id, 'wide-0000');
  doc.nodes.reverse(); assert.equal(prepareResearch(doc, node.id, researchFraming(doc)).prompt, prepared.prompt);
  assert.ok(prepared.bytes <= 131072); assert.ok(prepared.coverage.omitted.budget > 3900);
  assert.ok(prepared.context.decisionsElsewhere.every(item => item.answer.length === 2000));
  const deep = fixture().doc;
  for (let i = 0; i < 1498; i++) deep.nodes.push({ ...deep.nodes[1], id: `deep-${i}`, parentId: deep.nodes.at(-1).id, answer: '🌿'.repeat(1000) });
  validateDocument(deep);
  const nearest = prepareResearch(deep, deep.nodes.at(-1).id, researchFraming(deep));
  assert.equal(nearest.context.path.at(-2).id, deep.nodes.at(-2).id);
  assert.ok(nearest.coverage.omitted.path > 1400);
  assert.equal(nearest.context.path[0].parentId, deep.nodes.find(n => n.id === nearest.context.path[0].id).parentId);
});

test('many large pins and escaped mandatory answers fit completely or fail explicitly', () => {
  const { doc, node } = fixture(); doc.pins = Array.from({ length: 10 }, (_, i) => ({ id: `constraint-000000000000-${i}`, text: '🌿'.repeat(500) }));
  node.answer = '\0'.repeat(20000);
  assert.throws(() => prepareResearch(doc, node.id, researchFraming(doc)), /mandatory.*128 KiB/);
  node.answer = '🌿'.repeat(10000);
  const prepared = prepareResearch(doc, node.id, researchFraming(doc));
  assert.deepEqual(prepared.context.pins, doc.pins); assert.equal(prepared.context.path.at(-1).answer, node.answer);
  assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
});

test('generation retains bounded child/direction cues and historical rationale with exact included-field freshness', () => {
  const { doc, node } = fixture();
  node.rationale = 'Model explanation'; node.generation = { requestId: 'old', originalQuestion: node.question, originalCategory: node.category, adjusted: false };
  doc.nodes.push({ ...node, id: 'direction', kind: 'direction', question: '  User direction  ', rationale: undefined, generation: undefined });
  const all = prepareResearch(doc, doc.rootId, { operation: 'questions' });
  const cue = all.context.generationContext.find(item => item.id === node.id);
  assert.equal(cue.historicalRationale.rationale, node.rationale); assert.match(cue.historicalRationale.provenance, /not a user fact/);
  assert.equal(all.context.generationContext.find(item => item.id === 'direction').origin, 'user');
  node.answer = 'A newly saved answer was not sent'; assert.ok(sameResearchSources(all.dependencies, doc));
  const path = prepareResearch(doc, doc.rootId, { operation: 'questions', scope: 'path' });
  assert.equal(path.context.generationContext.length, 0); assert.equal(path.coverage.omitted.generationContext, 2); assert.equal(path.coverage.omitted.scope, 3);
  node.rationale = 'Changed historical explanation'; assert.equal(sameResearchSources(all.dependencies, doc), false); assert.ok(sameResearchSources(path.dependencies, doc));
  const research = prepareResearch(doc, doc.rootId); assert.equal(research.context.generationContext, undefined);
  const base = prepareResearch(doc, doc.rootId, { operation: 'questions' });
  const bounded = prepareResearch(doc, doc.rootId, { operation: 'questions', prefix: 'x'.repeat(131072 - base.bytes + 1) });
  assert.ok(bounded.coverage.omitted.generationContext > 0); assert.ok(bounded.bytes <= 131072);
  for (const item of bounded.context.generationContext) assert.ok(doc.nodes.some(n => n.id === item.id && n.question === item.question));
});

async function controllerFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-pins-')), file = join(dir, 'map.explore.json'), { doc, node } = fixture();
  await writeFile(file, JSON.stringify(doc)); const sends = [];
  const e = await new Explorer({ file, target: { instanceId: 'test' }, send: async input => sends.push(input) }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const command = (action, input = {}) => e.command(action, { revision: e.doc.revision, ...input });
  const guidance = pins => command('guidance', { objective: '', successCriteria: '', pins });
  return { e, doc, node, sends, command, guidance, file };
}

test('pin saves preserve sparse no-ops, finish state, history, restore, exact exports and failed writes', async t => {
  const { e, command, guidance, file } = await controllerFixture(t);
  await command('finish'); const finished = structuredClone(e.doc);
  await guidance([]); assert.deepEqual(e.doc, finished); assert.equal(Object.hasOwn(e.doc, 'pins'), false);
  await guidance([pin]); assert.equal(e.doc.finishedAt, null); const pinnedRevision = e.doc.revision;
  await guidance([pin]); assert.equal(e.doc.revision, pinnedRevision);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).pins, [pin]);
  assert.deepEqual(validateDocument(e.doc).pins, [pin]); assert.ok(toMarkdown(e.doc).includes(pin.text));
  const history = await e.history(e.doc.id), commit = history.commit.bind(history);
  history.commit = () => { throw Error('Injected pin save failure'); };
  await assert.rejects(guidance([{ ...pin, text: 'Failed replacement' }]), /Injected/);
  assert.deepEqual(e.doc.pins, [pin]); assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).pins, [pin]); history.commit = commit;
  await guidance([]); assert.equal(Object.hasOwn(e.doc, 'pins'), false);
  await command('restore', { journey: e.doc.id, snapshotRevision: pinnedRevision }); assert.deepEqual(e.doc.pins, [pin]);
});

test('scope inspection sends nothing; generation bytes and captured pin freshness survive no-ops and reject edits', async t => {
  const { e, sends, command, guidance } = await controllerFixture(t); await guidance([pin]);
  const inspected = await command('context-coverage', { kind: 'questions', nodeId: e.doc.rootId, scope: 'path' });
  assert.equal(sends.length, 0); assert.equal(e.pending, null);
  await command('questions', { nodeId: e.doc.rootId, scope: 'path' }); await waitFor(() => sends.length === 1);
  assert.equal(sends[0].mode, 'enqueue'); assert.equal(Buffer.byteLength(sends[0].prompt), inspected.contextCoverage.bytes);
  assert.deepEqual(JSON.parse(sends[0].prompt.split('EXPLORATION DATA\n')[1]).pins, [pin]);
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'Next?', category: 'Next' }] });
  await guidance([pin]); assert.equal(e.uiSnapshot().preview.stale, false);
  await guidance([{ ...pin, text: 'Changed' }]); assert.equal(e.uiSnapshot().preview.stale, true);
  await assert.rejects(command('accept-questions', { batchId: e.preview.id, selected: [{ index: 0, question: 'Next?' }] }), /changed/);
});

test('whole optional records fit at the exact byte boundary and are omitted at +1 without becoming dependencies', () => {
  const { doc, node } = fixture(); node.answer = '\0🌿';
  const base = prepareResearch(doc, doc.rootId, { prefix: 'DATA\n' });
  for (const delta of [-1, 0, 1]) {
    const prepared = prepareResearch(doc, doc.rootId, { prefix: 'DATA\n' + 'x'.repeat(131072 - base.bytes + delta) });
    assert.ok(prepared.bytes <= 131072);
    if (delta <= 0) { assert.equal(prepared.bytes, 131072 + delta); assert.equal(prepared.context.decisionsElsewhere[0].answer, node.answer); }
    else { assert.equal(prepared.coverage.omitted.budget, 1); node.answer += '!'; assert.ok(sameResearchSources(prepared.dependencies, doc)); }
  }
});

test('pin edits invalidate in-flight and retained help, while failed and no-op writes preserve valid help', async t => {
  const { e, node, guidance, command } = await controllerFixture(t); await guidance([pin]);
  const runs = []; e.questionHelper = { run(operation, context, options) { return new Promise(resolve => runs.push({ context, ...options, resolve })); }, close() {} };
  const base = { journey: e.doc.id, nodeId: node.id, operation: 'rephrase' }, first = { ...base, id: randomUUID() };
  await e.helpRequest({ ...first, action: 'start' }); await new Promise(setImmediate);
  const history = await e.history(e.doc.id), commit = history.commit.bind(history);
  history.commit = () => { throw Error('Injected save failure'); };
  await assert.rejects(guidance([{ ...pin, text: 'Failed' }]), /Injected/); history.commit = commit;
  await guidance([pin]); assert.equal(runs[0].signal.aborted, false);
  runs[0].resolve('Explanation'); await e.toolFreeTask;
  assert.equal((await e.helpRequest({ ...first, action: 'poll' })).status, 'result');
  await guidance([{ ...pin, text: 'Changed' }]);
  assert.deepEqual((await e.helpRequest({ action: 'check', journey: e.doc.id, nodeId: node.id, ids: [{ id: first.id, operation: 'rephrase' }] })).staleIds, [first.id]);
  const second = { ...base, id: randomUUID() }; await e.helpRequest({ ...second, action: 'start' }); await new Promise(setImmediate);
  await guidance([]); assert.equal(runs[1].signal.aborted, true); runs[1].resolve('Late'); await e.toolFreeTask;
  assert.equal((await e.helpRequest({ ...second, action: 'poll' })).status, 'cancelled');
  assert.equal(e.doc.nodes[1].answer, ''); await command('refresh-answer');
});
