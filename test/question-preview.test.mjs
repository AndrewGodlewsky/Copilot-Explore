import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { contextFor, toMarkdown, validateDocument, createDocument, candidateQuestions, acceptQuestions, MAX_NODES, MAX_DOCUMENT_BYTES } from '../com.github.copilot/extensions/explorer/model.mjs';

const questions = [{ question: 'Who first?', category: 'People' }, { question: 'When?', category: 'Time' }];
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-proposals-'));
  const e = await new Explorer({ file: join(dir, 'map.explore.json'), send: async () => {} }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const command = (action, input = {}) => e.command(action, { revision: e.doc?.revision, ...input });
  await command('start', { topic: 'Garden' });
  const stage = async () => { const id = e.pending.id; await e.receive('questions', { requestId: id, questions }); return id; };
  return { e, command, stage };
}
test('question preview stages legacy callbacks without saving, then accepts an edited subset once', async t => {
  const { e, command, stage } = await fixture(t), before = structuredClone(e.doc), disk = await readFile(e.file, 'utf8');
  const id = await stage();
  assert.deepEqual(e.doc, before); assert.equal(await readFile(e.file, 'utf8'), disk);
  assert.equal(e.uiSnapshot().preview.id, id); assert.equal(e.snapshot().preview, undefined);
  assert.equal(toMarkdown(e.doc).includes('Who first?'), false); assert.deepEqual(contextFor(e.doc, e.doc.rootId).existingQuestions, []);
  const result = await command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Who will join first? 🌿' }] });
  assert.equal(result.acceptedIds.length, 1); assert.equal(e.doc.revision, before.revision + 1); assert.equal(e.doc.nodes.length, 2);
  assert.deepEqual(e.doc.nodes[1].generation, { requestId: id, originalQuestion: 'Who first?', originalCategory: 'People', adjusted: true });
  assert.deepEqual(validateDocument(e.doc), e.doc); assert.equal(e.uiSnapshot().preview, null);
  assert.equal((await e.readHistory(e.doc.id)).current.label, 'Questions accepted');
  await assert.rejects(command('accept-questions', { batchId: id, selected: [{ index: 1, question: 'When?' }] }), /preview/i);
});
test('question preview dismissal is a no-op, prevents silent replacement and cannot revive on late callback', async t => {
  const { e, command, stage } = await fixture(t), id = await stage(), before = structuredClone(e.doc);
  await assert.rejects(command('questions', { nodeId: e.doc.rootId }), /dismiss/i);
  await assert.rejects(command('import', { document: e.doc }), /dismiss/i);
  await command('dismiss-questions', { batchId: id }); assert.deepEqual(e.doc, before);
  await assert.rejects(e.receive('questions', { requestId: id, questions }), /cancelled/);
  assert.equal((await e.readHistory(e.doc.id)).entries.length, 0);
  await command('questions', { nodeId: e.doc.rootId }); await stage();
  const reopened = await new Explorer({ file: e.file }).load(); assert.equal(reopened.uiSnapshot().preview, null); await reopened.close();
  await e.close(); assert.equal(e.uiSnapshot().preview, null);
});
test('question preview invalid edits and duplicate selections reject atomically', async t => {
  const { e, command, stage } = await fixture(t), id = await stage(), before = structuredClone(e.doc);
  for (const selected of [[], [{ index: 0, question: '' }], [{ index: 0, question: 'x'.repeat(601) }], [{ index: 2, question: 'Bad' }], [{ index: 0, question: 'One' }, { index: 0, question: 'Two' }], [{ index: 0, question: 'Same' }, { index: 1, question: 'same' }]]) {
    await assert.rejects(command('accept-questions', { batchId: id, selected })); assert.deepEqual(e.doc, before); assert.equal(e.uiSnapshot().preview.id, id);
  }
});
test('question preview source changes invalidate staging and acceptance including another canvas', async t => {
  const { e, command, stage } = await fixture(t), other = await new Explorer({ file: e.file }).load();
  const stale = e.pending.id;
  await other.command('guidance', { revision: other.doc.revision, objective: 'New objective', successCriteria: '' });
  await assert.rejects(stage(), /changed|stale/i); assert.equal(e.pending, null);
  await assert.rejects(e.receive('questions', { requestId: stale, questions }), /cancelled/);
  await command('refresh-answer'); await command('questions', { nodeId: e.doc.rootId }); const id = await stage();
  await command('guidance', { objective: 'Another objective', successCriteria: '' });
  await assert.rejects(command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Who?' }] }), /changed|stale/i);
  assert.equal(e.doc.nodes.length, 1); assert.equal(e.uiSnapshot().preview.stale, true);
});
test('question preview model bounds, provenance and atomic node/file limits', () => {
  const doc = createDocument('Limits'), batch = { id: 'request', questions };
  for (const values of [[], Array.from({ length: 7 }, () => questions[0]), [{ question: 'x'.repeat(601), category: 'c' }], [{ question: 'q', category: 'c'.repeat(61) }], [questions[0], questions[0]]]) assert.throws(() => candidateQuestions(doc, doc.rootId, values));
  const exact = { id: 'r'.repeat(100), questions: [{ question: 'x'.repeat(600), category: 'c'.repeat(60) }] };
  const accepted = acceptQuestions(doc, doc.rootId, exact, [{ index: 0, question: exact.questions[0].question }]);
  assert.equal(accepted.document.nodes[1].generation.adjusted, false);
  for (const generation of [{ ...accepted.document.nodes[1].generation, adjusted: 'true' }, { ...accepted.document.nodes[1].generation, requestId: 'r'.repeat(101) }, { ...accepted.document.nodes[1].generation, originalQuestion: 'x'.repeat(601) }, { ...accepted.document.nodes[1].generation, originalCategory: 'c'.repeat(61) }, { ...accepted.document.nodes[1].generation, context: 'private' }]) {
    const invalid = structuredClone(accepted.document); invalid.nodes[1].generation = generation; assert.throws(() => validateDocument(invalid));
  }
  for (let i = 1; i < MAX_NODES - 1; i++) doc.nodes.push({ id: `n${i}`, parentId: doc.rootId, question: `Q${i}`, category: 'Scope', answer: '', research: null, review: false });
  const before = JSON.stringify(doc);
  assert.throws(() => acceptQuestions(doc, doc.rootId, batch, questions.map((q, index) => ({ index, question: q.question }))), /5000/);
  assert.equal(JSON.stringify(doc), before);
  assert.equal(acceptQuestions(doc, doc.rootId, batch, [{ index: 0, question: 'Accepted?' }]).document.nodes.length, 5000);
  const full = createDocument('Bytes');
  for (let i = 0; i < 480; i++) full.nodes.push({ id: `n${i}`, parentId: full.rootId, question: `Q${i}`, category: 'Scope', answer: 'x'.repeat(19000), research: null, review: false });
  let remaining = MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(full, null, 2)) - 20;
  for (const node of full.nodes.slice(1)) { const add = Math.min(remaining, 20000 - node.answer.length); node.answer += 'x'.repeat(add); remaining -= add; if (!remaining) break; }
  validateDocument(full); const original = JSON.stringify(full);
  assert.throws(() => acceptQuestions(full, full.rootId, batch, [{ index: 0, question: 'Who?' }]), /9 MiB/);
  assert.equal(JSON.stringify(full), original);
});
test('question preview tracks captured ancestors and stateful answers, not newly answered omitted records or presentation', async t => {
  const { e, command, stage } = await fixture(t);
  let id = await stage(); await command('accept-questions', { batchId: id, selected: questions.map((q, index) => ({ index, question: q.question })) });
  const parent = e.doc.nodes[1], elsewhere = e.doc.nodes[2];
  await command('answer', { nodeId: parent.id, answer: 'Saved', answerState: 'decided', expand: true });
  await stage(); id = e.preview.id;
  await command('answer', { nodeId: elsewhere.id, answer: '', answerState: 'needs-evidence' });
  assert.equal(e.uiSnapshot().preview.stale, false);
  await command('dismiss-questions', { batchId: id });
  await command('questions', { nodeId: parent.id }); await stage(); id = e.preview.id;
  await command('checkpoint', { journey: e.doc.id, snapshotRevision: e.doc.revision, name: 'Presentation checkpoint' });
  await command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Next?' }] });
  assert.equal(e.doc.nodes.at(-1).parentId, parent.id); assert.equal(e.doc.nodes[1].answerState, 'decided');
  await command('questions', { nodeId: parent.id });
  const requestId = e.pending.id;
  await assert.rejects(e.receive('questions', { requestId, questions: [{ question: 'Next?', category: 'Duplicate' }] }), /Duplicate/);
  assert.equal(e.pending.id, requestId); await command('cancel');
});
test('question preview disk changes after staging reject acceptance without touching either saved version', async t => {
  const { e, command, stage } = await fixture(t), id = await stage();
  const other = await new Explorer({ file: e.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: 'Disk update', successCriteria: '' });
  const disk = await readFile(e.file, 'utf8');
  await assert.rejects(command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Who?' }] }), /context changed/);
  assert.equal(await readFile(e.file, 'utf8'), disk); assert.equal(e.doc.nodes.length, 1); assert.equal(e.uiSnapshot().preview.stale, true);
});


test('question preview survives refresh after another canvas removes its parent as dismissible stale work', async t => {
  const { e, command, stage } = await fixture(t); let id = await stage();
  const initial = structuredClone(e.doc);
  await command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Who?' }] });
  await command('answer', { nodeId: e.doc.nodes[1].id, answer: 'Saved', expand: true }); await stage(); id = e.preview.id;
  const other = await new Explorer({ file: e.file }).load(); initial.revision = other.doc.revision;
  await other.command('import', { revision: other.doc.revision, document: initial });
  await command('refresh-answer'); assert.equal(e.uiSnapshot().preview.stale, true);
  await command('dismiss-questions', { batchId: id }); assert.equal(e.doc.nodes.length, 1);
});
