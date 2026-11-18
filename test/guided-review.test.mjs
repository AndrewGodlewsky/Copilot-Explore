import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';
import { savedDigest } from '../com.github.copilot/extensions/explorer/review-causes.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

async function fixture(t) {
  const values = map(), { doc, a, b } = values;
  model.answerNode(doc, a.id, 'First upstream change', 'assumption'); model.answerNode(doc, a.id, 'Second upstream change', 'decided');
  const dir = await mkdtemp(join(tmpdir(), 'guided-review-')), file = join(dir, 'map.explore.json');
  await writeFile(file, JSON.stringify(doc, null, 2));
  const e = await new Explorer({ file, send: async () => {}, target: { instanceId: 'test' } }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const input = (extra = {}) => ({ revision: e.doc.revision, nodeId: b.id, answer: b.answer, answerState: 'decided', operation: 'reaffirm-review', reviewCause: e.doc.nodes.find(n => n.id === b.id).reviewCauses.changes[0], ...extra });
  const prepare = input => e.answerChangeRequest({ action: 'prepare', journey: e.doc.id, ...input });
  return { ...values, e, file, input, prepare };
}

function map() {
  const doc = model.createDocument('Review');
  const [a, b, outside] = model.addQuestions(doc, doc.rootId, ['A?', 'B?', 'Outside?'].map(question => ({ question, category: 'Scope' })));
  const [child] = model.addQuestions(doc, b.id, [{ question: 'Child?', category: 'Scope' }]);
  for (const n of [a, b, outside, child]) { n.answer = `Saved ${n.question}`; n.answerState = 'decided'; }
  model.addDependency(doc, b.id, a.id);
  return { doc, a, b, child, outside };
}

test('guided reaffirm removes exactly one cause and preserves text, state, other causes and stale research', () => {
  const { doc, a, b, child, outside } = map();
  b.research = { basis: 'reasoning', summary: 'Saved reasoning', options: [{ title: 'A', description: 'A', pros: [], cons: [] }, { title: 'B', description: 'B', pros: [], cons: [] }], recommendation: 'A', uncertainty: 'Unknown', sources: [] };
  model.answerNode(doc, a.id, 'First', 'assumption'); model.answerNode(doc, a.id, 'Second', 'decided');
  const causes = structuredClone(b.reviewCauses.changes), original = b.answer, unchanged = structuredClone(outside);
  assert.equal(model.reaffirmReview(doc, b.id, causes[0]), true);
  assert.equal(b.review, true); assert.deepEqual(b.reviewCauses.changes, [causes[1]]);
  assert.equal(b.answer, original); assert.equal(b.answerState, 'decided'); assert.deepEqual(outside, unchanged); assert.equal(child.reviewCauses.changes.length, 2);
  assert.throws(() => model.reaffirmReview(doc, b.id, causes[0]), /cause/);
  model.reaffirmReview(doc, b.id, causes[1]); assert.equal(b.review, false); assert.equal(b.reviewCauses, undefined);
  assert.equal(b.researchStale, true); assert.equal(b.research.summary, 'Saved reasoning'); assert.deepEqual(model.validateDocument(doc), doc);
  assert.throws(() => model.reaffirmReview(doc, b.id, 'earlier'), /review/);
});

test('guided reaffirm keeps the legacy remainder explicit and validates retained dependency provenance', () => {
  const { doc, a, b } = map(); b.review = true;
  model.answerNode(doc, a.id, 'Changed', 'decided'); const cause = structuredClone(b.reviewCauses.changes[0]);
  assert.equal(b.reviewCauses.earlier, true);
  model.reaffirmReview(doc, b.id, cause); assert.equal(b.review, true); assert.equal(b.reviewCauses, undefined);
  model.reaffirmReview(doc, b.id, 'earlier'); assert.equal(b.review, false);
  b.review = true; model.answerNode(doc, a.id, 'Again', 'decided');
  model.reaffirmReview(doc, b.id, 'earlier'); assert.equal(b.review, true); assert.equal(b.reviewCauses.earlier, false);
  const legacy = structuredClone(doc); assert.deepEqual(model.validateDocument(legacy), legacy);
});

test('user dependency edits record both endpoints and flag only the dependent side once', () => {
  const { doc, a, b, child, outside } = map(), digest = savedDigest(doc);
  model.changeDependency(doc, 'remove', b.id, a.id);
  for (const n of [b, child]) {
    assert.equal(n.reviewCauses.changes.length, 1);
    assert.deepEqual(n.reviewCauses.changes[0], { sourceId: a.id, baseDigest: digest, revision: doc.revision, kind: 'dependency-removed', dependentId: b.id });
    assert.match(n.answer, /^Saved/);
  }
  assert.equal(a.review, false); assert.equal(outside.review, false);
  model.changeDependency(doc, 'add', b.id, outside.id, 'An explicit premise');
  assert.equal(b.reviewCauses.changes.length, 2); assert.equal(child.reviewCauses.changes.length, 2);
  assert.equal(b.reviewCauses.changes[1].kind, 'dependency-added');
  assert.match(model.toMarkdown(doc), /dependency-removed/);
  assert.match(model.toMarkdown(doc), new RegExp(b.id));
  const valid = model.validateDocument(doc); assert.deepEqual(valid, doc);
  const shared = prepareSharedMigration(JSON.stringify(doc));
  assert.deepEqual(readSharedDocument(shared.content).document.journey.nodes, doc.nodes);
  for (const field of ['kind', 'dependentId']) { const bad = structuredClone(doc); delete bad.nodes[2].reviewCauses.changes[1][field]; assert.throws(() => model.validateDocument(bad), /review causes/i); }
  const bad = structuredClone(doc); bad.nodes[2].reviewCauses.changes[1].kind = 'unknown'; assert.throws(() => model.validateDocument(bad), /review causes/i);
});

test('guided reaffirm binds one current cause, records history and preserves private drafts', async t => {
  const f = await fixture(t), before = structuredClone(f.e.doc), input = f.input();
  await f.e.writeDraft({ journey: f.e.doc.id, nodeId: f.b.id, base: f.b, stateSelected: true, text: 'Keep my different draft', answerState: 'tentative', revision: 0 });
  const drafts = await f.e.readDrafts(f.e.doc.id);
  const p = await f.prepare(input); assert.equal(p.requiresConfirmation, true); assert.equal(p.operation, 'reaffirm-review');
  assert.equal(p.reviewResolution.remaining, 1); assert.deepEqual(p.reviewResolution.selected, input.reviewCause);
  await assert.rejects(f.e.command('reaffirm-review', input), /consequences/);
  await assert.rejects(f.e.command('reaffirm-review', { ...input, reviewCause: 'earlier', answerPreview: p.token, confirmConsequences: true }), /cause|preview/);
  await f.e.command('reaffirm-review', { ...input, answerPreview: p.token, confirmConsequences: true });
  const saved = f.e.doc.nodes.find(n => n.id === f.b.id);
  assert.equal(saved.review, true); assert.equal(saved.reviewCauses.changes.length, 1); assert.equal(saved.answer, f.b.answer);
  assert.deepEqual(await f.e.readDrafts(f.e.doc.id), drafts);
  const history = await f.e.history(f.e.doc.id), old = await history.list(f.e.doc, before.revision);
  assert.deepEqual(old.document, before); assert.equal(f.e.doc.revision, before.revision + 1);
  const input2 = f.input(), p2 = await f.prepare(input2);
  await f.e.command('reaffirm-review', { ...input2, answerPreview: p2.token, confirmConsequences: true });
  assert.equal(f.e.doc.nodes.find(n => n.id === f.b.id).review, false); assert.equal(f.e.doc.nodes.find(n => n.id === f.child.id).review, true);
});

test('obsolete review and changed source reject before commit; ordinary answer acknowledgments require explicit review', async t => {
  const f = await fixture(t), input = f.input(), p = await f.prepare(input), before = await readFile(f.file, 'utf8');
  const forged = { ...input, operation: 'answer', answerPreview: p.token, confirmConsequences: true }; delete forged.reviewCause;
  await assert.rejects(f.e.command('answer', forged), /preview/);
  await assert.rejects(f.e.command('answer', { revision: f.e.doc.revision, nodeId: f.b.id, answer: f.b.answer, answerState: 'decided' }), /consequences/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  const external = structuredClone(f.e.doc); external.nodes[1].answer = 'Externally revised upstream'; external.revision++;
  await writeFile(f.file, JSON.stringify(external));
  await assert.rejects(f.e.command('reaffirm-review', { ...input, answerPreview: p.token, confirmConsequences: true }), /changed|preview|canvas/i);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), external);
});

test('review queue is unique tree order, explains overlapping and removed relationships and tolerates legacy history', async () => {
  const { reviewQueue, reviewContext } = await import('../com.github.copilot/extensions/explorer/web/review-queue.mjs');
  const { doc, a, b, child, outside } = map(); model.addDependency(doc, child.id, a.id);
  model.answerNode(doc, a.id, 'Changed', 'decided'); outside.review = true;
  assert.deepEqual(reviewQueue(doc).map(n => n.id), [b.id, child.id, outside.id]);
  const cause = child.reviewCauses.changes[0], context = reviewContext(doc, child.id, cause);
  assert.equal(context.source.answer, 'Changed'); assert.equal(context.confirmed, true); assert.equal(context.mixed, false);
  model.changeDependency(doc, 'remove', b.id, a.id);
  const removed = reviewContext(doc, b.id, b.reviewCauses.changes.at(-1)); assert.equal(removed.dependent.id, b.id); assert.equal(removed.linkPresent, false);
  assert.equal(reviewContext(doc, outside.id, 'earlier').legacy, true);
  const missing = structuredClone(cause); missing.sourceId = 'removed-source'; assert.equal(reviewContext(doc, child.id, missing).source, null);
  const deep = model.createDocument('Deep'); let parent = deep.rootId;
  for (let i = 0; i < 4500; i++) { const id = `n${i}`; deep.nodes.push({ id, parentId: parent, question: id, category: 'Scope', answer: '', research: null, review: true }); parent = id; }
  assert.equal(reviewQueue(deep).length, 4500);
});

test('clear reviewed answer previews all causes, keeps orphan-free private draft and requires Origin', async t => {
  const f = await fixture(t), input = f.input({ operation: 'clear-review-answer', answer: '', answerState: 'unanswered' }); delete input.reviewCause;
  const p = await f.prepare(input); assert.equal(p.reviewResolution.remaining, 0); assert.equal(p.reviewResolution.total, 2);
  const server = await startServer(f.e); t.after(() => server.close());
  const origin = new URL(server.url).origin, url = new URL('api/action', server.url);
  const body = { action: 'clear-review-answer', ...input, answerPreview: p.token, confirmConsequences: true };
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
  await f.e.command('clear-review-answer', body);
  const node = f.e.doc.nodes.find(n => n.id === f.b.id); assert.equal(node.answer, ''); assert.equal(node.answerState, 'unanswered'); assert.equal(node.review, false);
  assert.equal(f.e.doc.nodes.find(n => n.id === f.child.id).review, true);
  assert.equal(f.e.doc.nodes.find(n => n.id === f.outside.id).answer, f.outside.answer);
});

test('dependency actions persist review provenance and failed reaffirm replacement keeps saved map', async t => {
  const f = await fixture(t);
  await f.e.command('remove-dependency', { revision: f.e.doc.revision, nodeId: f.b.id, prerequisiteId: f.a.id });
  assert.equal(f.e.doc.nodes.find(n => n.id === f.b.id).reviewCauses.changes.at(-1).kind, 'dependency-removed');
  const input = f.input(), p = await f.prepare(input), before = await readFile(f.file, 'utf8');
  const original = f.e.commitCurrentLocked.bind(f.e);
  f.e.commitCurrentLocked = async () => { throw Error('Injected save failure'); };
  await assert.rejects(f.e.command('reaffirm-review', { ...input, answerPreview: p.token, confirmConsequences: true }), /Injected/);
  assert.equal(await readFile(f.file, 'utf8'), before); f.e.commitCurrentLocked = original;
  await f.e.command('reaffirm-review', { ...input, answerPreview: p.token, confirmConsequences: true });
  assert.equal(f.e.doc.nodes.find(n => n.id === f.b.id).review, true);
});
