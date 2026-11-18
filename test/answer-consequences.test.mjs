import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { viewerSnapshot } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
import { prepareResearch } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { prepareBrief, parseBrief, acceptBrief, BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareHandoff, captureHandoff } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';
import { prepareChallenge, captureCheck } from '../com.github.copilot/extensions/explorer/answer-check.mjs';
import { createDocument, addQuestions, addDirection, addDependency, answerNode, validateDocument, DecisionImpact } from '../com.github.copilot/extensions/explorer/model.mjs';

function map() {
  const doc = createDocument('Topic');
  const [a, b] = addQuestions(doc, doc.rootId, [{ question: 'A?', category: 'Scope' }, { question: 'B?', category: 'Scope' }]);
  const direction = addDirection(doc, a.id, 'Direction'), [child] = addQuestions(doc, direction.id, [{ question: 'Child?', category: 'Scope' }]);
  addDependency(doc, b.id, a.id);
  return { doc, a, b, direction, child };
}
test('answer invalidation matches combined decision impact and retains bounded saved-base causes', () => {
  const { doc, a, b, child, direction } = map(), impact = new DecisionImpact(doc).analyze(a.id);
  answerNode(doc, a.id, 'New choice', 'decided');
  assert.deepEqual(doc.nodes.filter(n => n.review && n.kind !== 'direction').map(n => n.id).sort(), impact.affected.map(n => n.id).sort());
  for (const n of [b, child, direction]) {
    assert.equal(n.review, true); assert.equal(n.reviewCauses.changes[0].sourceId, a.id);
    assert.match(n.reviewCauses.changes[0].baseDigest, /^[a-f0-9]{64}$/);
  }
  for (let i = 0; i < 40; i++) answerNode(doc, a.id, `Choice ${i}`, 'decided');
  assert.equal(b.reviewCauses.changes.length, 32); assert.equal(b.reviewCauses.earlier, true);
  assert.deepEqual(validateDocument(doc), doc);
  answerNode(doc, b.id, 'Reviewed', 'decided'); assert.equal(b.review, false); assert.equal(b.reviewCauses, undefined);
  assert.equal(child.review, true);
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'answer-consequences-')), file = join(dir, 'map.explore.json'), values = map();
  await writeFile(file, JSON.stringify(values.doc, null, 2));
  const e = await new Explorer({ file, send: async () => {}, target: { instanceId: 'test' } }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const input = { revision: e.doc.revision, nodeId: values.a.id, answer: '  Exact choice\n', answerState: 'assumption' };
  const prepare = (extra = {}) => e.answerChangeRequest({ action: 'prepare', journey: e.doc.id, ...input, ...extra });
  return { ...values, e, file, input, prepare };
}
test('read-only consequence preview and confirmed atomic save have exactly the same affected set', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), p = await f.prepare();
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(p.requiresConfirmation, true);
  assert.equal(p.counts.total, 2); assert.equal(p.directions, 1); assert.equal(p.total, 3);
  assert.match(p.adr, /No recorded ADR associations/);
  await assert.rejects(f.e.command('answer', f.input), /consequences/);
  await assert.rejects(f.e.command('answer', { ...f.input, answerPreview: p.token }), /preview/);
  await f.e.command('answer', { ...f.input, answerPreview: p.token, confirmConsequences: true });
  assert.deepEqual(f.e.doc.nodes.filter(n => n.review).map(n => n.id).sort(), p.items.map(n => n.id).sort());
  assert.equal(f.e.doc.nodes[1].answer, f.input.answer);
  await assert.rejects(f.e.command('answer', { ...f.input, revision: f.e.doc.revision, answerPreview: p.token, confirmConsequences: true }), /preview/);
});
test('changed proposal, changed dependencies, late proposal and replaced same-revision file cannot reuse confirmation', async t => {
  const f = await fixture(t), p = await f.prepare();
  const save = extra => f.e.command('answer', { ...f.input, answerPreview: p.token, confirmConsequences: true, ...extra });
  await assert.rejects(save({ answer: 'Different' }), /preview/);
  f.e.preview = { id: 'late', nodeId: f.a.id, questions: [], stale: false };
  await assert.rejects(save({}), /preview/); f.e.preview = null;
  const disk = JSON.parse(await readFile(f.file, 'utf8')); disk.dependencies = [];
  await writeFile(f.file, JSON.stringify(disk)); await assert.rejects(save({}), /changed/);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[1].answer, '');
});
test('draft revision and content changes reject confirmation without discarding the newer draft', async t => {
  const f = await fixture(t), draft = { journey: f.e.doc.id, nodeId: f.a.id, base: f.a, text: f.input.answer, answerState: f.input.answerState, stateSelected: true, revision: 0 };
  const first = await f.e.writeDraft(draft), extra = { draftRevision: first.revision, draftJourney: f.e.doc.id }, p = await f.prepare(extra);
  await f.e.writeDraft({ ...draft, revision: first.revision, text: 'Newer draft' });
  await assert.rejects(f.e.command('answer', { ...f.input, ...extra, answerPreview: p.token, confirmConsequences: true }), /preview/);
  assert.equal((await f.e.readDrafts(f.e.doc.id)).entries[0].text, 'Newer draft'); assert.equal(f.e.doc.nodes[1].answer, '');
});
test('discard, no-op and failure before replacement preserve saved content and history semantics', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), p = await f.prepare();
  await f.e.answerChangeRequest({ action: 'discard', token: p.token });
  await assert.rejects(f.e.command('answer', { ...f.input, answerPreview: p.token, confirmConsequences: true }), /preview/);
  await f.e.command('answer', { ...f.input, answer: '', answerState: 'unanswered' }); assert.equal(await readFile(f.file, 'utf8'), before);
  const fresh = await f.prepare(); f.e.history = async () => ({ commit: async () => { throw Error('Fixture failure before replacement'); } });
  await assert.rejects(f.e.command('answer', { ...f.input, answerPreview: fresh.token, confirmConsequences: true }), /Fixture/);
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.e.doc.nodes[1].answer, '');
});
test('preview endpoint requires origin and bounds pages; leaf no-impact saves stay lightweight', async t => {
  const f = await fixture(t), server = await startServer(f.e), origin = new URL(server.url).origin;
  t.after(() => server.close());
  const post = (body, headers = {}) => fetch(new URL('api/answer-change', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...headers }, body: JSON.stringify(body) });
  const input = { action: 'prepare', journey: f.e.doc.id, ...f.input };
  assert.equal((await post(input)).status, 403); assert.equal((await post(input, { Origin: 'https://example.org' })).status, 403);
  const response = await post(input, { Origin: origin }); assert.equal(response.status, 200); const p = await response.json();
  await assert.rejects(f.e.answerChangeRequest({ action: 'page', token: p.token, page: -1, targetId: null, pathPage: 0 }), /page/);
  const leaf = await f.prepare({ nodeId: f.b.id }); assert.equal(leaf.requiresConfirmation, false);
  await f.e.command('answer', { ...f.input, nodeId: f.b.id }); assert.equal(f.e.doc.nodes[2].answer, f.input.answer);
});
test('bounded HTTP pages preserve maximum escaped answer text and complete path pages', async t => {
  const f = await fixture(t), doc = structuredClone(f.e.doc); doc.nodes[1].answer = '\u0001'.repeat(20000);
  let parent = f.a.id;
  for (let i = 0; i < 70; i++) { const id = `page-${i}`; doc.nodes.push({ id, parentId: parent, question: '\u0001'.repeat(600), category: 'Scope', answer: '', research: null, review: false }); parent = id; }
  await f.e.save(doc); const server = await startServer(f.e), origin = new URL(server.url).origin; t.after(() => server.close());
  const post = body => fetch(new URL('api/answer-change', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin }, body: JSON.stringify(body) });
  const prepared = await post({ action: 'prepare', journey: f.e.doc.id, ...f.input, revision: f.e.doc.revision, answer: '\u0002'.repeat(20000) }); assert.equal(prepared.status, 200);
  const p = await prepared.json(), response = await post({ action: 'page', token: p.token, page: 0, targetId: parent, pathPage: 1 });
  assert.equal(response.status, 200); const page = await response.json(); assert.equal(page.items.length, 50); assert.equal(page.path.length, 30);
  assert.equal(page.current.answer, '\u0001'.repeat(20000)); assert.equal(page.proposed.answer, '\u0002'.repeat(20000));
});
test('confirmation is checked again after history preparation and rejects expiry or a journey switch', async t => {
  const f = await fixture(t), p = await f.prepare(), before = await readFile(f.file, 'utf8');
  f.e.history = async () => ({ commit: async (_old, _next, _label, replace) => { f.e.preview = { id: 'late result' }; await replace(); } });
  await assert.rejects(f.e.command('answer', { ...f.input, answerPreview: p.token, confirmConsequences: true }), /preview/);
  assert.equal(await readFile(f.file, 'utf8'), before); f.e.preview = null;
  f.e.answerChanges.entry.expires = 0;
  await assert.rejects(f.e.command('answer', { ...f.input, answerPreview: p.token, confirmConsequences: true }), /preview/);
  const again = await f.prepare(); f.e.activeKey = 'different-journey-binding';
  await assert.rejects(f.e.command('answer', { ...f.input, answerPreview: again.token, confirmConsequences: true }), /preview/);
});
test('acknowledging review requires confirmation when captured work becomes stale but never invalidates descendants', async t => {
  for (const kind of ['research', 'questions']) {
    const f = await fixture(t), doc = structuredClone(f.e.doc); doc.nodes[1].review = true; await f.e.save(doc);
    const dependencies = prepareResearch(f.e.doc, f.a.id, { operation: kind }).dependencies;
    if (kind === 'research') { f.e.pending = { id: 'owned-research', kind: 'research', nodeId: f.a.id }; f.e.researchWork = { dependencies }; f.e.researchAbort = new AbortController(); }
    else { f.e.preview = { id: 'staged-questions', nodeId: f.a.id, questions: [], stale: false }; f.e.questionSource = { journey: f.e.doc.id, dependencies }; }
    const abort = f.e.researchAbort, input = { ...f.input, revision: f.e.doc.revision, answer: '', answerState: 'unanswered' }, p = await f.prepare(input);
    assert.equal(p.changed, false); assert.equal(p.acknowledgment, true); assert.equal(p.requiresConfirmation, true); assert.equal(p.counts.total, 0);
    await assert.rejects(f.e.command('answer', input), /consequences/); assert.equal(f.e.doc.nodes[1].review, true);
    await f.e.command('answer', { ...input, answerPreview: p.token, confirmConsequences: true });
    assert.equal(f.e.doc.nodes[1].review, false); assert.equal(f.e.doc.nodes[3].review, false);
    if (kind === 'research') assert.equal(abort.signal.aborted, true); else assert.equal(f.e.uiSnapshot().preview.stale, true);
  }
});
test('retained research is conservatively flagged without inventing cross-branch answer dependencies', async t => {
  const f = await fixture(t), result = { basis: 'reasoning', summary: 'Summary', options: [{ title: 'A', description: 'A', pros: [], cons: [] }, { title: 'B', description: 'B', pros: [], cons: [] }], recommendation: 'A', uncertainty: 'Unknown', sources: [] };
  const next = structuredClone(f.e.doc); next.nodes[1].research = result; next.nodes[2].research = result; await f.e.save(next);
  const input = { ...f.input, revision: f.e.doc.revision, nodeId: f.child.id }, p = await f.prepare(input);
  assert.equal(p.counts.total, 0); assert.equal(p.research, 2); assert.equal(p.items.every(item => !item.review), true);
  await f.e.command('answer', { ...input, answerPreview: p.token, confirmConsequences: true });
  assert.equal(f.e.doc.nodes[1].researchStale, true); assert.equal(f.e.doc.nodes[2].researchStale, true); assert.equal(f.e.doc.nodes[1].review, false);
  const copied = prepareSharedMigration(JSON.stringify(f.e.doc));
  assert.equal(readSharedDocument(copied.content).document.journey.nodes[1].researchStale, true);
  assert.equal(viewerSnapshot(f.e.doc, [{ nodeId: f.a.id, answer: false, research: true }]).nodes[0].researchStale, true);
  assert.equal(viewerSnapshot(f.e.doc, [{ nodeId: f.a.id, answer: false, research: false }]).nodes[0].researchStale, undefined);
  const bad = structuredClone(f.e.doc); bad.nodes[1].research = null; assert.throws(() => validateDocument(bad), /stale/);
});

test('brief and check results arriving after preview require fresh confirmation; progress alone does not', async t => {
  for (const kind of ['brief', 'answer-check']) {
    const f = await fixture(t), doc = structuredClone(f.e.doc); doc.nodes[2].answer = 'Original'; doc.nodes[2].answerState = 'decided'; await f.e.save(doc);
    let finish; const helper = { run(prepared, { signal }) { return new Promise(resolve => { finish = () => resolve(kind === 'brief' ? parseBrief(JSON.stringify(Object.fromEntries(BRIEF_SECTIONS.map(s => [s, []]))), prepared) : { findings: [] }); signal.addEventListener('abort', finish, { once: true }); }); }, close() {} };
    f.e[kind === 'brief' ? 'briefHelper' : 'checkHelper'] = helper;
    t.after(() => finish?.());
    const request = { action: 'start', id: 'answer-consequence-helper-00001', journey: f.e.doc.id };
    await (kind === 'brief' ? f.e.briefRequest(request) : f.e.checkRequest(request));
    await new Promise(setImmediate);
    const input = { ...f.input, nodeId: f.b.id, revision: f.e.doc.revision }, p = await f.prepare(input);
    assert.equal(p.counts.total, 0); assert.equal(p.requiresConfirmation, true); assert.deepEqual(p.artifacts, [{ kind, state: 'pending' }]);
    const work = kind === 'brief' ? f.e.briefWork : f.e.checkWork; work.progress = 'Different progress';
    await f.e.answerChangeRequest({ action: 'page', token: p.token, page: 0, targetId: null, pathPage: 0 });
    finish(); await f.e.toolFreeTask;
    await assert.rejects(f.e.command('answer', { ...input, answerPreview: p.token, confirmConsequences: true }), /preview/);
    const fresh = await f.prepare(input); assert.deepEqual(fresh.artifacts, [{ kind, state: kind === 'brief' ? 'proposal' : 'result' }]);
    await f.e.command('answer', { ...input, answerPreview: fresh.token, confirmConsequences: true }); assert.equal(work.status, 'stale');
  }
});

test('saved briefs and selected handoff or challenge work appear only when their captured inputs change', async t => {
  const f = await fixture(t), doc = structuredClone(f.e.doc); doc.nodes[2].answer = 'Original'; doc.nodes[2].answerState = 'decided';
  doc.brief = acceptBrief(parseBrief(JSON.stringify(Object.fromEntries(BRIEF_SECTIONS.map(s => [s, []]))), prepareBrief(doc)), []); await f.e.save(doc);
  const prepared = prepareHandoff(f.e.doc, { nodeIds: [f.b.id], format: 'plan', includeEvidence: false });
  f.e.briefWork = { id: 'selected-handoff', journey: f.e.doc.id, operation: 'handoff', status: 'pending', abort: new AbortController(), dependencies: captureHandoff(prepared), format: prepared.format, formatFingerprint: prepared.formatFingerprint, includeEvidence: false, evidence: [] };
  f.e.checkWork = { id: 'challenge', journey: f.e.doc.id, operation: 'challenge-review', status: 'result', abort: new AbortController(), dependencies: captureCheck(prepareChallenge(f.e.doc)), findings: [], dismissed: new Set() };
  const p = await f.prepare({ nodeId: f.b.id, revision: f.e.doc.revision });
  assert.deepEqual(p.artifacts, [{ kind: 'brief', state: 'saved' }, { kind: 'handoff', state: 'pending' }, { kind: 'challenge-review', state: 'result' }]);
  const unrelated = await f.prepare({ nodeId: f.child.id, revision: f.e.doc.revision }); assert.deepEqual(unrelated.artifacts, [{ kind: 'brief', state: 'saved' }]);
});
test('no-op and acknowledgment do not invalidate descendants; legacy causes and retained research stay honest', () => {
  const { doc, a, child } = map();
  a.review = true; answerNode(doc, a.id, '', 'unanswered'); assert.equal(child.review, false);
  const before = JSON.stringify(doc); assert.equal(answerNode(doc, a.id, '', 'unanswered'), false); assert.equal(JSON.stringify(doc), before);
  child.review = true; answerNode(doc, a.id, 'A', 'decided'); assert.equal(child.reviewCauses.earlier, true);
  const bad = structuredClone(doc); bad.nodes[3].reviewCauses.changes[0].baseDigest = 'bad'; assert.throws(() => validateDocument(bad), /review/i);
});
