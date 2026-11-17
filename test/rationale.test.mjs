import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actionSchemas } from '../com.github.copilot/extensions/explorer/canvas.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { acceptQuestions, candidateQuestions, contextFor, createDocument, MAX_DOCUMENT_BYTES, toMarkdown, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';

const rationale = 'It is unclear who can join; that affects the first pilot for the garden objective.';
const candidate = { question: 'Who can join?', category: 'People', rationale };

test('canvas callback keeps question and category required while rationale is optional', () => {
  const schema = actionSchemas.submit_questions.properties.questions.items;
  assert.deepEqual(schema.required, ['question', 'category']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.rationale.maxLength, 1000);
});

test('rationale is sparse, bounded and restricted to ordinary questions', () => {
  const doc = createDocument('Garden');
  assert.deepEqual(candidateQuestions(doc, doc.rootId, [{ question: 'Legacy?', category: 'Scope' }]), [{ question: 'Legacy?', category: 'Scope' }]);
  assert.deepEqual(candidateQuestions(doc, doc.rootId, [candidate]), [candidate]);
  for (const value of ['', '   ', 5, null, [], 'x'.repeat(1001)]) {
    assert.throws(() => candidateQuestions(doc, doc.rootId, [{ ...candidate, rationale: value }]), /rationale/i);
  }
  const accepted = acceptQuestions(doc, doc.rootId, { id: 'request', questions: [candidate] }, [{ index: 0, question: 'Who can join first?' }]).document;
  assert.equal(accepted.nodes[1].rationale, rationale);
  assert.equal(accepted.nodes[1].generation.originalQuestion, candidate.question);
  assert.deepEqual(validateDocument(accepted), accepted);
  for (const index of [0, 1]) {
    const invalid = structuredClone(accepted); invalid.nodes[index].rationale = '';
    assert.throws(() => validateDocument(invalid), /rationale/i);
  }
  const root = structuredClone(accepted); root.nodes[0].rationale = rationale;
  assert.throws(() => validateDocument(root), /rationale/i);
  const unprovenanced = structuredClone(accepted); delete unprovenanced.nodes[1].generation;
  assert.throws(() => validateDocument(unprovenanced), /rationale/i);
  const direction = structuredClone(accepted); direction.nodes[1].kind = 'direction'; delete direction.nodes[1].generation;
  assert.throws(() => validateDocument(direction), /direction|rationale/i);
  assert.match(toMarkdown(accepted), /Why this question\?/);
  assert.match(toMarkdown(accepted), /original suggested wording/i);
  assert.match(toMarkdown(accepted), /Who can join\?/);
});

test('staged rationale is trusted, survives acceptance and history, and never mutates a failed save', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-rationale-'));
  const messages = [];
  const e = await new Explorer({ file: join(dir, 'map.explore.json'), send: async value => { messages.push(value); } }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  await e.command('start', { topic: 'Garden', objective: 'Start a pilot' });
  const before = structuredClone(e.doc), disk = await readFile(e.file, 'utf8');
  const id = e.pending.id;
  await e.receive('questions', { requestId: id, questions: [candidate, { question: 'When?', category: 'Time' }] });
  assert.equal(e.uiSnapshot().preview.questions[0].rationale, rationale);
  assert.deepEqual(e.doc, before); assert.equal(await readFile(e.file, 'utf8'), disk);
  await assert.rejects(e.command('accept-questions', { revision: e.doc.revision, batchId: id, selected: [{ index: 0, question: 'Changed?', rationale: 'Forged' }] }), /selection/i);
  assert.deepEqual(e.doc, before);
  await e.command('accept-questions', { revision: e.doc.revision, batchId: id, selected: [{ index: 0, question: 'Who can join first?' }] });
  assert.equal(e.doc.nodes[1].rationale, rationale);
  assert.equal(e.doc.nodes.length, 2);
  assert.equal(contextFor(e.doc, e.doc.rootId).historicalRationales[0].rationale, rationale);
  const exported = JSON.parse(await readFile(e.file, 'utf8'));
  assert.equal(validateDocument(exported).nodes[1].rationale, rationale);
  const history = await e.readHistory(e.doc.id);
  assert.ok(history.entries.length);
  const acceptedRevision = e.doc.revision;
  await e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: 'Maybe neighbors', answerState: 'tentative' });
  assert.equal((await e.readHistory(e.doc.id, acceptedRevision)).document.nodes[1].rationale, rationale);
  await e.command('restore', { revision: e.doc.revision, journey: e.doc.id, snapshotRevision: acceptedRevision });
  assert.equal(e.doc.nodes[1].rationale, rationale);
  const imported = structuredClone(e.doc); imported.objective = 'Imported objective';
  await e.command('import', { revision: e.doc.revision, document: imported });
  assert.equal(e.doc.nodes[1].rationale, rationale);
  await e.command('questions', { revision: e.doc.revision, nodeId: e.doc.rootId });
  await Promise.resolve();
  assert.match(messages.at(-1).prompt, /Historical model explanation/);
  assert.match(messages.at(-1).prompt, /not a user fact or decision/);
  const staleRequest = e.pending.id;
  const other = await new Explorer({ file: e.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: 'A different objective', successCriteria: '' });
  await other.close();
  await assert.rejects(e.receive('questions', { requestId: staleRequest, questions: [candidate] }), /changed|stale/i);
  assert.equal(e.doc.nodes[1].rationale, rationale);
  const nearCap = createDocument('Near cap');
  for (let i = 0; i < 480; i++) nearCap.nodes.push({ id: `n${i}`, parentId: nearCap.rootId, question: `Q${i}`, category: 'Scope', answer: 'x'.repeat(19000), research: null, review: false });
  let remaining = MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(nearCap, null, 2)) - 20;
  for (const node of nearCap.nodes.slice(1)) { const add = Math.min(remaining, 20000 - node.answer.length); node.answer += 'x'.repeat(add); remaining -= add; if (!remaining) break; }
  const original = JSON.stringify(nearCap);
  assert.throws(() => acceptQuestions(nearCap, nearCap.rootId, { id, questions: [candidate] }, [{ index: 0, question: candidate.question }]), /9 MiB/);
  assert.equal(JSON.stringify(nearCap), original);
});
