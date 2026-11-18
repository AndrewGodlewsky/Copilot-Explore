import { waitFor } from './helpers/wait-for.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { actionSchemas } from '../com.github.copilot/extensions/explorer/canvas.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { acceptQuestions, candidateQuestions, createDocument, importedDocument, MAX_DOCUMENT_BYTES, toMarkdown, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareResearch, sameResearchSources } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { visualSnapshot, visualExport } from '../com.github.copilot/extensions/explorer/visual-export.mjs';
import { viewerSnapshot, viewerDigest, viewerArtifact } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';

const reason = '  Goal: a viable garden; limited time makes ownership consequential. <script>🌱</script>\r\n';
const candidate = { question: 'Who owns watering?', category: 'People', importance: 'high', importanceReason: reason };
function ranked(importance = 'high') {
  const doc = createDocument('Garden', { objective: 'PRIVATE_GUIDANCE' });
  return acceptQuestions(doc, doc.rootId, { id: 'request', questions: [{ ...candidate, importance }] }, [{ index: 0, question: 'Who owns daily watering?' }]).document;
}
test('importance callback pair is optional, exact and bounded without inventing legacy ranks', () => {
  const schema = actionSchemas.submit_questions.properties.questions.items;
  assert.deepEqual(schema.required, ['question', 'category']);
  assert.deepEqual(schema.properties.importance.enum, ['low', 'medium', 'high']);
  assert.equal(schema.properties.importanceReason.maxLength, 600);
  const doc = createDocument('Legacy'), legacy = { question: 'When?', category: 'Time' };
  assert.deepEqual(candidateQuestions(doc, doc.rootId, [legacy]), [legacy]);
  for (const importance of ['low', 'medium', 'high']) {
    const q = { ...candidate, importance };
    assert.deepEqual(candidateQuestions(doc, doc.rootId, [q]), [q], 'reason text remains exact');
    assert.equal(validateDocument(ranked(importance)).nodes[1].importance, importance);
  }
  for (const pair of [{ importance: 'high' }, { importanceReason: 'Why' }, ...['High', 'urgent', '', null, 1].map(importance => ({ importance, importanceReason: 'Why' })), ...['', ' ', null, 1, [], 'x'.repeat(601)].map(importanceReason => ({ importance: 'low', importanceReason }))]) {
    assert.throws(() => candidateQuestions(doc, doc.rootId, [{ ...legacy, ...pair }]), /importance/i);
  }
  assert.equal(candidateQuestions(doc, doc.rootId, [{ ...candidate, importanceReason: '🌱'.repeat(300) }])[0].importanceReason.length, 600);
  for (const mutate of [d => Object.assign(d.nodes[0], candidate), d => { delete d.nodes[1].generation; }, d => { d.nodes[1].kind = 'direction'; delete d.nodes[1].generation; }, d => { delete d.nodes[1].importance; }, d => { delete d.nodes[1].importanceReason; }]) {
    const d = ranked(); mutate(d); assert.throws(() => validateDocument(d), /importance/i);
  }
});
test('importance is server-owned historical assessment through accepted edits, disk, history and import', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-importance-')), messages = [];
  const e = await new Explorer({ file: join(dir, 'map.explore.json'), send: async m => messages.push(m) }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const command = (action, input = {}) => e.command(action, { revision: e.doc?.revision, ...input });
  await command('start', { topic: 'Garden', objective: 'Pilot', successCriteria: 'Cheap' });
  await waitFor(() => messages.length === 1); assert.match(messages.at(-1).prompt, /importanceReason/); assert.match(messages.at(-1).prompt, /constraints.*consequences/);
  const id = e.pending.id, before = await readFile(e.file, 'utf8');
  await assert.rejects(e.receive('questions', { requestId: id, questions: [{ ...candidate, importanceReason: undefined }] }), /importance/i);
  assert.equal(e.pending.id, id);
  await e.receive('questions', { requestId: id, questions: [candidate] });
  assert.equal(e.uiSnapshot().preview.questions[0].importanceReason, reason); assert.equal(await readFile(e.file, 'utf8'), before);
  for (const override of [{ importance: 'low' }, { importanceReason: 'Forged' }]) await assert.rejects(command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Edited?', ...override }] }), /selection/);
  await command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Edited?' }] });
  const revision = e.doc.revision; assert.equal(e.doc.nodes[1].importance, 'high'); assert.equal(e.doc.nodes[1].generation.adjusted, true);
  await command('answer', { nodeId: e.doc.nodes[1].id, answer: 'Perhaps Ada', answerState: 'tentative' });
  assert.equal((await e.readHistory(e.doc.id, revision)).document.nodes[1].importanceReason, reason);
  assert.equal(importedDocument(JSON.parse(await readFile(e.file, 'utf8'))).nodes[1].importanceReason, reason);
  const context = prepareResearch(e.doc, e.doc.rootId, { operation: 'questions' });
  assert.match(context.prompt, /historicalImportance/); assert.match(context.prompt, /tentative/); assert.match(context.prompt, /not a user fact or decision/);
  const changed = structuredClone(e.doc); changed.nodes[1].importanceReason = 'Changed assessment';
  assert.equal(sameResearchSources(context.dependencies, changed), false);
  await command('guidance', { objective: 'Conflicting new objective', successCriteria: '' });
  assert.equal(e.doc.nodes[1].importanceReason, reason);
});
test('importance exports preserve selected assessments as literal historical model reasoning and bind viewer freshness', () => {
  const doc = ranked(), node = doc.nodes[1];
  const markdown = toMarkdown(doc); assert.match(markdown, /Importance: high/); assert.match(markdown, /Historical model assessment/); assert.match(markdown, /original suggested wording/i);
  assert.equal(visualSnapshot(doc, { scope: 'branch', nodeId: node.id }).nodes[0].importanceReason, reason.replace(/\r\n/g, '\n'));
  for (const format of ['canvas', 'svg', 'print', 'mermaid']) {
    const artifact = visualExport(doc, { format, scope: 'branch', nodeId: node.id });
    assert.match(artifact.content, /Importance/); assert.ok(!artifact.content.includes('PRIVATE_GUIDANCE')); assert.ok(!artifact.content.includes('<script>🌱</script>'));
  }
  const selection = [{ nodeId: node.id, answer: false, research: false }], snapshot = viewerSnapshot(doc, selection), input = { journey: doc.id, revision: doc.revision, selection };
  assert.equal(snapshot.nodes[0].importanceReason, reason);
  const digest = viewerDigest(input, snapshot); doc.nodes[1].importanceReason += '!';
  assert.notEqual(viewerDigest(input, viewerSnapshot(doc, selection)), digest);
  const dom = new JSDOM(viewerArtifact(snapshot).content, { runScripts: 'dangerously' });
  try { assert.match(dom.window.document.getElementById('detail').textContent, /Importance: high/); assert.match(dom.window.document.getElementById('detail').textContent, /Historical model assessment/); assert.equal(dom.window.document.querySelector('#detail script'), null); assert.ok(dom.window.document.getElementById('detail').textContent.includes(reason)); } finally { dom.window.close(); }
  assert.equal(viewerSnapshot(doc, [{ nodeId: doc.rootId, answer: false, research: false }]).nodes[0].importance, undefined);
});
test('importance acceptance near the saved-byte cap fails atomically without changing legacy questions', () => {
  const doc = createDocument('Near cap');
  for (let i = 0; i < 480; i++) doc.nodes.push({ id: `n${i}`, parentId: doc.rootId, question: `Q${i}`, category: 'Scope', answer: 'x'.repeat(19000), research: null, review: false });
  let remaining = MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(doc, null, 2)) - 20;
  for (const node of doc.nodes.slice(1)) { const add = Math.min(remaining, 20000 - node.answer.length); node.answer += 'x'.repeat(add); remaining -= add; if (!remaining) break; }
  validateDocument(doc); const before = JSON.stringify(doc);
  assert.throws(() => acceptQuestions(doc, doc.rootId, { id: 'request', questions: [candidate] }, [{ index: 0, question: candidate.question }]), /9 MiB/);
  assert.equal(JSON.stringify(doc), before); assert.ok(doc.nodes.every(n => !Object.hasOwn(n, 'importance')));
});
