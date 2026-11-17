import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { branchView } from '../com.github.copilot/extensions/explorer/web/layout.mjs';

test('direction preserves original Unicode and excludes structural nodes from every question count', () => {
  const doc = model.createDocument('Garden'), original = '  水 🌱\n <script> a missing direction  ';
  const seed = model.addDirection(doc, doc.rootId, original);
  assert.equal(seed.kind, 'direction'); assert.equal(seed.question, original);
  const [question] = model.addQuestions(doc, seed.id, [{ question: 'Who?', category: 'People' }]);
  model.answerNode(doc, question.id, 'Us', 'decided');
  assert.deepEqual(model.validateDocument(JSON.parse(JSON.stringify(doc))), doc);
  assert.deepEqual(model.questionCounts(doc), { total: 1, answered: 1, resolved: 1, deferred: 0, unresolved: 0 });
  assert.deepEqual(branchView(doc.nodes, doc.rootId, new Set()).descendants.get(doc.rootId), { total: 1, unresolved: 0 });
  assert.equal(model.contextFor(doc, seed.id).path.at(-1).kind, 'direction');
  assert.equal(model.contextFor(doc, seed.id).path.at(-1).answerState, undefined);
  assert.match(model.toMarkdown(doc), /Direction \(user supplied\)/);
  assert.throws(() => model.answerNode(doc, seed.id, 'Fake'), /question/i);
  for (const value of ['', ' \n ', null, {}, 'x'.repeat(601)]) assert.throws(() => model.addDirection(doc, doc.rootId, value));
  assert.equal(model.addDirection(doc, doc.rootId, 'x'.repeat(600)).question.length, 600);
  for (const patch of [{ kind: 'unknown' }, { answer: 'Fake' }, { answerState: 'unanswered' }, { generation: {} }, { research: {} }]) {
    const invalid = structuredClone(doc); Object.assign(invalid.nodes[1], patch); assert.throws(() => model.validateDocument(invalid));
  }
  const invalidRoot = structuredClone(doc); invalidRoot.nodes[0].kind = 'direction'; assert.throws(() => model.validateDocument(invalidRoot));
  assert.equal(model.isQuestion(question), true); assert.equal(model.isQuestion(seed), false); assert.equal(model.isQuestion(doc.nodes[0]), false);
});

test('direction seed insertion rejects near-byte-limit documents atomically', () => {
  const doc = model.createDocument('Bytes');
  for (let i = 0; i < 480; i++) doc.nodes.push({ id: `n${i}`, parentId: doc.rootId, question: `Q${i}`, category: 'Scope', answer: 'x'.repeat(19000), research: null, review: false });
  let remaining = model.MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(doc, null, 2)) - 20;
  for (const node of doc.nodes.slice(1)) { const add = Math.min(remaining, 20000 - node.answer.length); node.answer += 'x'.repeat(add); remaining -= add; if (!remaining) break; }
  model.validateDocument(doc); const original = JSON.stringify(doc);
  assert.throws(() => model.addDirection(doc, doc.rootId, 'Missing direction'), /9 MiB/);
  assert.equal(JSON.stringify(doc), original);
});

test('direction source changes reject pending and staged callbacks while preserving user seeds and legacy questions', async t => {
  const { e, command } = await fixture(t);
  await command('add', { nodeId: e.doc.rootId, question: 'A legacy manual direction', category: 'Direction' });
  assert.equal(model.isQuestion(e.doc.nodes[1]), true);
  await command('answer', { nodeId: e.doc.nodes[1].id, answer: 'Saved', answerState: 'decided' });
  await command('add-direction', { nodeId: e.doc.rootId, direction: 'Safety' }); const seed = e.doc.nodes.at(-1), requestId = e.pending.id;
  const other = await new Explorer({ file: e.file }).load(); t.after(() => other.close());
  await other.command('guidance', { revision: other.doc.revision, objective: 'Changed', successCriteria: '' });
  await assert.rejects(e.receive('questions', { requestId, questions: [{ question: 'Safe?', category: 'Safety' }] }), /context changed/);
  await command('refresh-answer'); await command('questions', { nodeId: seed.id });
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'Safe?', category: 'Safety' }] });
  await command('guidance', { objective: 'Changed again', successCriteria: '' });
  await assert.rejects(command('accept-questions', { batchId: e.preview.id, selected: [{ index: 0, question: 'Safe?' }] }), /context changed/);
  assert.equal(e.doc.nodes.length, 3); assert.equal(e.doc.nodes[1].answer, 'Saved'); assert.equal(e.doc.nodes[2].question, 'Safety');
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-directions-')), sent = [];
  const e = await new Explorer({ file: join(dir, 'map.explore.json'), send: async payload => { sent.push(payload); } }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const command = (action, input = {}) => e.command(action, { revision: e.doc?.revision, ...input });
  await command('start', { topic: 'Garden' }); await command('cancel');
  return { e, command, sent };
}
test('direction commits before no-answer generation, stages acceptance, retains cancellation and failure retries', async t => {
  const { e, command, sent } = await fixture(t), before = e.doc.revision;
  const result = await command('add-direction', { nodeId: e.doc.rootId, direction: '  Safety 🌱  ' });
  const seed = e.doc.nodes[1]; assert.equal(result.directionId, seed.id); assert.equal(e.doc.revision, before + 1);
  assert.equal(seed.answer, ''); assert.equal(seed.answerState, undefined); assert.equal(seed.generation, undefined);
  assert.equal((await e.readHistory(e.doc.id)).current.label, 'Direction added');
  assert.equal(e.pending.nodeId, seed.id); await new Promise(resolve => setImmediate(resolve));
  assert.match(sent.at(-1).prompt, /user-supplied direction/); assert.equal(sent.at(-1).mode, 'enqueue');
  const late = e.pending.id; await command('cancel');
  await assert.rejects(e.receive('questions', { requestId: late, questions: [{ question: 'Late?', category: 'Late' }] }), /cancelled/);
  for (const action of ['answer', 'research']) await assert.rejects(command(action, { nodeId: seed.id, answer: 'Fake' }), /question/i);
  e.send = async () => { throw new Error('offline'); }; await command('questions', { nodeId: seed.id });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(e.pending, null); assert.equal(e.doc.nodes[1].question, '  Safety 🌱  ');
  e.send = async () => {}; await command('questions', { nodeId: seed.id });
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'How safe?', category: 'Safety' }] });
  assert.equal(e.doc.nodes.length, 2);
  await command('accept-questions', { batchId: e.preview.id, selected: [{ index: 0, question: 'How safe?' }] });
  assert.equal(e.doc.nodes[2].parentId, seed.id); assert.equal(e.doc.nodes[2].generation.adjusted, false);
  assert.equal(model.questionCounts(e.doc).total, 1);
  assert.deepEqual(model.validateDocument(JSON.parse(await readFile(e.file, 'utf8'))), e.doc);
});

test('direction duplicate, limit and stale-writer failures leave committed history and document intact', async t => {
  const { e, command } = await fixture(t);
  await command('add-direction', { nodeId: e.doc.rootId, direction: 'Safety' }); await command('cancel');
  const before = JSON.stringify(e.doc);
  await assert.rejects(command('add-direction', { nodeId: e.doc.rootId, direction: ' safety ' }), /already|duplicate/i);
  assert.equal(JSON.stringify(e.doc), before);
  const other = await new Explorer({ file: e.file }).load(); t.after(() => other.close());
  await other.command('guidance', { revision: other.doc.revision, objective: 'Updated', successCriteria: '' });
  await assert.rejects(command('add-direction', { nodeId: e.doc.rootId, direction: 'Time' }), /Another canvas/);
  assert.equal(JSON.stringify(e.doc), before); assert.equal(e.pending, null);
  const full = model.createDocument('Full');
  for (let i = 1; i < model.MAX_NODES; i++) full.nodes.push({ id: String(i), parentId: full.rootId, question: String(i), category: 'Q', answer: '', research: null, review: false });
  const saved = JSON.stringify(full); assert.throws(() => model.addDirection(full, full.rootId, 'Too many'), /5000/); assert.equal(JSON.stringify(full), saved);
});
