import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startResearch } from './helpers/research-review.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

function fixture() {
  const doc = model.createDocument('Restart');
  const [source, outside] = model.addQuestions(doc, doc.rootId, [{ question: 'Assumption?', category: 'Scope' }, { question: 'Outside?', category: 'Scope' }]);
  const direction = model.addDirection(doc, source.id, 'Direction');
  const [child] = model.addQuestions(doc, direction.id, [{ question: 'Detail?', category: 'Scope' }]);
  model.addDependency(doc, outside.id, child.id);
  return { doc, source, outside, direction, child };
}
test('restart removes exact descendants and dangling links, preserves outside answers and records review even for an unchanged assumption', () => {
  assert.equal(typeof model.restartBranch, 'function');
  const { doc, source, outside, direction, child } = fixture(); outside.answer = 'Keep exact answer'; outside.answerState = 'decided';
  assert.equal(model.restartBranch(doc, source.id, '', 'unanswered'), true);
  assert.deepEqual(doc.nodes.map(n => n.id), [doc.rootId, source.id, outside.id]); assert.equal(doc.dependencies, undefined);
  assert.equal(outside.answer, 'Keep exact answer'); assert.equal(outside.review, true); assert.equal(outside.reviewCauses.changes[0].sourceId, source.id);
  assert.equal(doc.nodes.some(n => [direction.id, child.id].includes(n.id)), false); assert.deepEqual(model.validateDocument(doc), doc);
});
test('leaf restart saves replacement state, rejects roots/directions and leaves a true no-op unchanged', () => {
  assert.equal(typeof model.restartBranch, 'function');
  const { doc, outside, direction } = fixture();
  assert.equal(model.restartBranch(doc, outside.id, '  Exact\nchoice ', 'assumption'), true);
  const saved = JSON.stringify(doc); assert.equal(model.restartBranch(doc, outside.id, '  Exact\nchoice ', 'assumption'), false); assert.equal(JSON.stringify(doc), saved);
  assert.throws(() => model.restartBranch(doc, doc.rootId, '', 'unanswered'), /question/); assert.throws(() => model.restartBranch(doc, direction.id, '', 'unanswered'), /question/);
});
test('deep restart is iterative and preserves sibling branches', () => {
  assert.equal(typeof model.restartBranch, 'function');
  const { doc, source, outside, child } = fixture(); let parent = child.id;
  for (let i = 0; i < 4000; i++) { const id = `deep-${i}`; doc.nodes.push({ id, parentId: parent, question: 'Detail?', category: 'Scope', answer: '', research: null, review: false }); parent = id; }
  model.validateDocument(doc); model.restartBranch(doc, source.id, 'Corrected', 'decided');
  assert.deepEqual(doc.nodes.map(n => n.id), [doc.rootId, source.id, outside.id]);
});

async function controller(t) {
  const f = fixture(), dir = await mkdtemp(join(tmpdir(), 'branch-restart-')), file = join(dir, 'map.explore.json');
  await writeFile(file, JSON.stringify(f.doc)); const e = await new Explorer({ file, send: async () => {}, target: { instanceId: 'fixture' } }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const input = { revision: e.doc.revision, nodeId: f.source.id, answer: 'Corrected premise', answerState: 'decided' };
  const prepare = () => e.answerChangeRequest({ action: 'prepare', operation: 'restart-branch', journey: e.doc.id, ...input });
  return { ...f, e, file, input, prepare };
}
test('confirmed restart saves one mutation with protected preimage, preserves orphan drafts and references, and restores exactly', async t => {
  const f = await controller(t), original = structuredClone(f.e.doc);
  await f.e.writeDraft({ journey: f.e.doc.id, nodeId: f.child.id, base: f.child, text: 'Private deleted-node draft', answerState: 'tentative', stateSelected: true, revision: 0 });
  await f.e.writeReferences({ journey: f.e.doc.id, nodeIds: [f.child.id], revision: 0 });
  const p = await f.prepare(); assert.equal(p.removed, 2); assert.equal(p.removedReferences, 1); assert.equal(p.linkTotal, 1); assert.equal(p.links[0].external, true); assert.equal(p.requiresConfirmation, true);
  await assert.rejects(f.e.command('restart-branch', f.input), /preview|confirm|consequences/i);
  await f.e.command('restart-branch', { ...f.input, answerPreview: p.token, confirmConsequences: true });
  assert.equal(f.e.doc.revision, original.revision + 1); assert.equal(f.e.doc.nodes.length, 3); assert.equal(f.e.doc.nodes[1].answer, f.input.answer);
  const history = await f.e.readHistory(f.e.doc.id); assert.equal(history.entries[0].checkpoints.includes(p.checkpoint), true);
  const preimage = await f.e.readHistory(f.e.doc.id, original.revision); assert.deepEqual(preimage.document, original);
  assert.equal((await f.e.readDrafts(f.e.doc.id)).entries[0].text, 'Private deleted-node draft'); assert.deepEqual((await f.e.readReferences(f.e.doc.id)).nodeIds, [f.child.id]);
  await f.e.command('restore', { journey: f.e.doc.id, revision: f.e.doc.revision, snapshotRevision: original.revision }); assert.deepEqual(f.e.doc.nodes, original.nodes); assert.deepEqual(f.e.doc.dependencies, original.dependencies);
});
test('checkpoint and precommit failures leave the original map intact; changed references reject old proof', async t => {
  const f = await controller(t), original = await readFile(f.file, 'utf8'), p = await f.prepare(), history = await f.e.history(f.e.doc.id), checkpoint = history.checkpoint.bind(history);
  history.checkpoint = async () => { throw Error('Checkpoint fixture failure'); };
  await assert.rejects(f.e.command('restart-branch', { ...f.input, answerPreview: p.token, confirmConsequences: true }), /Checkpoint fixture/); assert.equal(await readFile(f.file, 'utf8'), original);
  history.checkpoint = checkpoint;
  await f.e.writeReferences({ journey: f.e.doc.id, nodeIds: [f.child.id], revision: 0 });
  await assert.rejects(f.e.command('restart-branch', { ...f.input, answerPreview: p.token, confirmConsequences: true }), /preview/); assert.equal(await readFile(f.file, 'utf8'), original);
  const fresh = await f.prepare(), commit = f.e.commitCurrentLocked;
  f.e.commitCurrentLocked = async () => { throw Error('Precommit fixture failure'); };
  await assert.rejects(f.e.command('restart-branch', { ...f.input, answerPreview: fresh.token, confirmConsequences: true }), /Precommit fixture/); assert.equal(await readFile(f.file, 'utf8'), original);
  f.e.commitCurrentLocked = commit;
  await f.e.command('restart-branch', { ...f.input, answerPreview: fresh.token, confirmConsequences: true });
  const historyAfter = await f.e.readHistory(f.e.doc.id); assert.deepEqual(historyAfter.entries[0].checkpoints, [fresh.checkpoint], 'retry reuses its exact protected checkpoint');
});

test('pending and staged question work must be explicitly cancelled or dismissed; late callbacks cannot restore removed nodes', async t => {
  const f = await controller(t), next = structuredClone(f.e.doc); next.nodes.at(-1).answer = 'Old detail'; await f.e.save(next); f.input.revision = f.e.doc.revision;
  await f.e.command('questions', { revision: f.e.doc.revision, nodeId: f.child.id }); const requestId = f.e.pending.id;
  await assert.rejects(f.prepare(), /Cancel/);
  await f.e.receive('questions', { requestId, questions: [{ question: 'Late detail?', category: 'Scope' }] });
  await assert.rejects(f.prepare(), /dismiss/); await f.e.command('dismiss-questions', { batchId: requestId });
  await f.e.command('questions', { revision: f.e.doc.revision, nodeId: f.child.id }); const cancelled = f.e.pending.id;
  await f.e.command('cancel', {}); const p = await f.prepare();
  await f.e.command('restart-branch', { ...f.input, answerPreview: p.token, confirmConsequences: true });
  await assert.rejects(f.e.receive('questions', { requestId: cancelled, questions: [{ question: 'Late detail?', category: 'Scope' }] }), /cancelled/);
  assert.equal(f.e.doc.nodes.length, 3); assert.equal(f.e.preview, null);
});
test('cancelled owned research cannot commit a late result after restart', async t => {
  let release; t.after(() => release?.()); const f = await controller(t);
  const evidence = { basis: 'reasoning', summary: 'Old result', options: [{ title: 'A', description: 'A', pros: [], cons: [] }, { title: 'B', description: 'B', pros: [], cons: [] }], recommendation: 'A', uncertainty: 'Unknown', sources: [] };
  f.e.researcher = { run() { return new Promise(resolve => { release = () => resolve(evidence); }); } };
  await startResearch(f.e, { revision: f.e.doc.revision, nodeId: f.child.id }); await new Promise(setImmediate);
  await assert.rejects(f.prepare(), /Cancel/); await f.e.command('cancel', {});
  const p = await f.prepare(); await f.e.command('restart-branch', { ...f.input, answerPreview: p.token, confirmConsequences: true }); const saved = await readFile(f.file, 'utf8');
  release(); await Promise.all([...f.e.researchTasks]); assert.equal(await readFile(f.file, 'utf8'), saved); assert.equal(f.e.doc.nodes.some(n => n.id === f.child.id), false);
});
test('restart proofs cannot be used for ordinary answers or changed drafts, and final checkpoint work rechecks file freshness', async t => {
  const f = await controller(t), p = await f.prepare();
  await assert.rejects(f.e.command('answer', { ...f.input, operation: 'restart-branch', answerPreview: p.token, confirmConsequences: true }), /preview/);
  await assert.rejects(f.e.command('restart-branch', { ...f.input, answer: 'Other edit', answerPreview: p.token, confirmConsequences: true }), /preview/);
  const history = await f.e.history(f.e.doc.id), checkpoint = history.checkpoint.bind(history);
  history.checkpoint = async (...args) => { await checkpoint(...args); const changed = JSON.parse(await readFile(f.file, 'utf8')); changed.nodes[2].answer = 'External winner'; await writeFile(f.file, JSON.stringify(changed)); };
  await assert.rejects(f.e.command('restart-branch', { ...f.input, answerPreview: p.token, confirmConsequences: true }), /changed|preview|History recovery/);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[2].answer, 'External winner');
});
test('restart HTTP pages include every boundary link and reject missing Origin', async t => {
  const f = await controller(t), doc = structuredClone(f.e.doc);
  for (let i = 0; i < 55; i++) { const id = `outside-${i}`; doc.nodes.push({ id, parentId: doc.rootId, question: `Outside ${i}?`, category: 'Scope', answer: '', research: null, review: false }); model.addDependency(doc, id, f.child.id, 'Recorded relation'); }
  await f.e.save(doc); f.input.revision = f.e.doc.revision;
  const server = await startServer(f.e), origin = new URL(server.url).origin; t.after(() => server.close());
  const post = (route, value, includeOrigin = true) => fetch(new URL(route, server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...(includeOrigin ? { Origin: origin } : {}) }, body: JSON.stringify(value) });
  assert.equal((await post('api/action', { action: 'restart-branch', ...f.input }, false)).status, 403);
  const response = await post('api/answer-change', { action: 'prepare', operation: 'restart-branch', journey: f.e.doc.id, ...f.input }); assert.equal(response.status, 200); const p = await response.json();
  assert.equal(p.linkTotal, 56); assert.equal(p.links.length, 25);
  const last = await post('api/answer-change', { action: 'page', token: p.token, page: 0, targetId: null, pathPage: 0, linkPage: 2 }).then(r => r.json()); assert.equal(last.links.length, 6); assert.ok(last.links.every(link => link.external));
});

test('full checkpoint protection blocks restart without deleting data; a leaf no-op creates no checkpoint', async t => {
  const f = await controller(t), history = await f.e.history(f.e.doc.id);
  for (let i = 0; i < 10; i++) await history.checkpoint(f.e.doc, f.e.doc.revision, `Protected ${i}`);
  const before = await readFile(f.file, 'utf8'), p = await f.prepare();
  await assert.rejects(f.e.command('restart-branch', { ...f.input, answerPreview: p.token, confirmConsequences: true }), /10 named checkpoints/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  const input = { ...f.input, nodeId: f.outside.id, answer: '', answerState: 'unanswered' };
  const noop = await f.e.answerChangeRequest({ action: 'prepare', operation: 'restart-branch', journey: f.e.doc.id, ...input }); assert.equal(noop.checkpoint, null); assert.equal(noop.removed, 0);
  await f.e.command('restart-branch', { ...input, answerPreview: noop.token, confirmConsequences: true }); assert.equal(await readFile(f.file, 'utf8'), before);
});
