import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { prepareHandoff, parseHandoff, acceptHandoff } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';
import { createDocument, addQuestions, addDirection, validateDocument, importedDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { prepareAdrScope, captureAdrScope, validateAdrScope, adrScopeFreshness } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';

function fixture() {
  const doc = createDocument('Choose a storage approach λ', { objective: 'Keep constraints visible', successCriteria: 'Unknowns stay open' });
  const [parent, cross, omitted] = addQuestions(doc, doc.rootId, [
    { question: 'Which storage?', category: 'Design' }, { question: 'Who maintains it?', category: 'People' }, { question: 'UNSELECTED_QUESTION', category: 'Other' },
  ]);
  const [focal, child] = addQuestions(doc, parent.id, [{ question: 'Which durability?', category: 'Design' }, { question: 'How to recover?', category: 'Design' }]);
  parent.answer = 'Tentative storage'; parent.answerState = 'tentative'; focal.answer = 'SAVED_FOCAL_ANSWER'; focal.answerState = 'decided'; focal.review = true;
  cross.answerState = 'needs-evidence'; omitted.answer = 'UNSELECTED_ANSWER'; child.answer = '';
  doc.pins = [{ id: 'constraint-00000000000000', text: 'Exact constraint λ' }];
  focal.research = { basis: 'sources', sources: [{ id: 's1', title: 'Recorded source', url: 'https://example.com/evidence', provenance: 'imported', retrievedAt: null }],
    claims: [{ id: 'c1', text: 'RECORDED_CLAIM', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'RECORDED_SUPPORT' }], limitations: 'Unverified interpretation' }], summary: 'SUMMARY_CANARY', recommendation: 'RECOMMENDATION_CANARY', proposedAnswer: 'PROPOSED_CANARY', uncertainty: 'Unverified',
    options: [{ title: 'First', description: 'First option', pros: [], cons: [] }, { title: 'Second', description: 'Second option', pros: [], cons: [] }] };
  const selection = { focalId: focal.id, nodeIds: [focal.id, parent.id, cross.id, child.id], includeEvidence: false };
  const scenario = { source: { id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt }, family: { id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt }, scope: 'personal', classification: 'unselected', preferenceRevision: 0, selectionRationale: '' };
  return { doc, focal, parent, cross, child, omitted, selection, scenario };
}

test('ADR scope projects exactly the focal and selected supporting records, partial states and visible guidance', () => {
  const f = fixture(); f.doc.projectCapture = { excerpt: 'PROJECT_CANARY' }; f.doc.brief = { secret: 'BRIEF_CANARY' }; f.doc.handoff = { secret: 'HANDOFF_CANARY' }; f.doc.drafts = 'DRAFT_CANARY';
  const before = structuredClone(f.doc), p = prepareAdrScope(f.doc, f.selection, { scenario: f.scenario });
  assert.equal(p.operation, 'adr-scope'); assert.equal(p.context.focalId, f.focal.id);
  assert.deepEqual(p.context.records.map(n => n.id), f.selection.nodeIds);
  assert.deepEqual(p.context.records.map(n => [n.answerState, n.review]), [['decided', true], ['tentative', false], ['needs-evidence', false], ['unanswered', false]]);
  assert.deepEqual(p.context.guidance.pins, f.doc.pins); assert.equal(p.context.guidance.objective, f.doc.objective); assert.deepEqual(p.context.scenario, f.scenario);
  assert.equal(p.coverage.included, 4); assert.equal(p.coverage.omitted, f.doc.nodes.length - 4);
  assert.equal(p.bytes, Buffer.byteLength(p.instructions) + Buffer.byteLength(p.prompt)); assert.ok(p.bytes <= p.limit);
  assert.doesNotMatch(p.prompt, /CANARY|UNSELECTED_|RECORDED_/); assert.match(p.prompt, /SAVED_FOCAL_ANSWER/);
  assert.deepEqual(f.doc, before);
  const research = prepareAdrScope(f.doc, { ...f.selection, includeEvidence: true }, { scenario: f.scenario });
  assert.match(research.prompt, /RECORDED_SUPPORT/); assert.match(research.prompt, /imported/); assert.doesNotMatch(research.prompt, /CANARY/);
  assert.match(research.instructions, /not.*decision|not.*verified/i);
});

test('ADR scope rejects implicit or invalid selections but permits explicitly selected supporting directions', () => {
  const f = fixture(), direction = addDirection(f.doc, f.doc.rootId, 'A user constraint');
  for (const selection of [
    { ...f.selection, focalId: f.doc.rootId }, { ...f.selection, focalId: direction.id }, { ...f.selection, focalId: 'missing' },
    { ...f.selection, nodeIds: [] }, { ...f.selection, nodeIds: [f.parent.id] }, { ...f.selection, nodeIds: [f.focal.id, f.focal.id] },
    { ...f.selection, nodeIds: [f.focal.id, f.doc.rootId] }, { ...f.selection, nodeIds: [f.focal.id, 'missing'] },
    { ...f.selection, includeEvidence: 'yes' }, { ...f.selection, extra: true },
  ]) assert.throws(() => prepareAdrScope(f.doc, selection), /scope|select|focal/i);
  const p = prepareAdrScope(f.doc, { ...f.selection, nodeIds: [f.focal.id, direction.id] });
  assert.equal(p.context.records[1].kind, 'direction'); assert.equal(p.context.records[1].answer, '');
  assert.ok(!p.context.records.some(n => n.id === f.parent.id));
});

test('ADR scope bounds all selected content without silently truncating a record', () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) addQuestions(f.doc, f.doc.rootId, [{ question: `Extra ${i}?`, category: 'More' }]);
  assert.throws(() => prepareAdrScope(f.doc, { ...f.selection, nodeIds: f.doc.nodes.filter(n => n.parentId).map(n => n.id) }), /100|select/i);
  f.focal.answer = '\0'.repeat(20000); f.parent.answer = '\0'.repeat(20000);
  assert.throws(() => prepareAdrScope(f.doc, f.selection), /128 KiB|limit/i);
});

test('ADR scope capture stores reference metadata only and strictly validates imported structure', () => {
  const f = fixture(), p = prepareAdrScope(f.doc, { ...f.selection, includeEvidence: true }, { scenario: f.scenario }), saved = captureAdrScope(p);
  assert.deepEqual(validateAdrScope(saved), saved); assert.deepEqual(saved.selection.nodeIds, f.selection.nodeIds);
  assert.equal(saved.dependencies.records.find(n => n.id === f.focal.id).review, true);
  assert.doesNotMatch(JSON.stringify(saved), /SAVED_FOCAL_ANSWER|RECORDED_CLAIM|https:|SUMMARY_CANARY/);
  for (const mutate of [
    s => s.version = 2, s => s.extra = true, s => s.selection.extra = true, s => s.selection.nodeIds.pop(),
    s => s.selection.focalId = 'missing', s => s.dependencies.records[0].state = 'direction',
    s => s.evidenceDigest = 'wrong', s => s.scenarioDigest = 'wrong', s => s.selectedAt = 'not a date',
    s => s.dependencies.records[0].extra = true, s => s.coverage.included++,
  ]) { const changed = structuredClone(saved); mutate(changed); assert.throws(() => validateAdrScope(changed)); }
});

test('ADR scope freshness tracks selected records, evidence, guidance and scenario without including unrelated content', () => {
  const f = fixture(), saved = captureAdrScope(prepareAdrScope(f.doc, { ...f.selection, includeEvidence: true }, { scenario: f.scenario }));
  assert.equal(adrScopeFreshness(saved, f.doc, f.scenario), 'current');
  for (const mutate of [
    d => d.nodes.find(n => n.id === f.focal.id).answer += ' changed', d => d.nodes.find(n => n.id === f.focal.id).review = false,
    d => d.nodes.find(n => n.id === f.cross.id).answerState = 'unanswered', d => d.objective += ' changed', d => d.pins[0].text += ' changed',
    d => d.nodes.find(n => n.id === f.focal.id).research.claims[0].limitations += ' changed', d => d.nodes = d.nodes.filter(n => n.id !== f.child.id),
  ]) { const changed = structuredClone(f.doc); mutate(changed); assert.equal(adrScopeFreshness(saved, changed, f.scenario), 'stale'); }
  assert.equal(adrScopeFreshness(saved, f.doc, { ...f.scenario, preferenceRevision: 1 }), 'stale');
  assert.equal(adrScopeFreshness(saved, f.doc), 'unknown');
  const unrelated = structuredClone(f.doc); unrelated.revision++; unrelated.nodes.find(n => n.id === f.omitted.id).answer += ' changed'; unrelated.nodes.find(n => n.id === f.focal.id).research.summary += ' changed';
  assert.equal(adrScopeFreshness(saved, unrelated, f.scenario), 'current');
  const noEvidence = captureAdrScope(prepareAdrScope(f.doc, f.selection, { scenario: f.scenario })); unrelated.nodes.find(n => n.id === f.focal.id).research.claims[0].text += ' changed';
  assert.equal(adrScopeFreshness(noEvidence, unrelated, f.scenario), 'current');
});

test('ADR scope reference survives shared canonical serialization and removed historical source records', () => {
  const f = fixture(); f.doc.adrScope = captureAdrScope(prepareAdrScope(f.doc, f.selection, { scenario: f.scenario }));
  assert.deepEqual(validateDocument(f.doc).adrScope, f.doc.adrScope); assert.deepEqual(importedDocument(f.doc).adrScope, f.doc.adrScope);
  const migrated = prepareSharedMigration(JSON.stringify(f.doc)), shared = readSharedDocument(migrated.content);
  const restored = validateDocument({ format: f.doc.format, version: 1, revision: 0, ...shared.document.journey });
  assert.deepEqual(restored.adrScope, f.doc.adrScope); assert.equal(adrScopeFreshness(restored.adrScope, restored, f.scenario), 'current');
  restored.nodes = restored.nodes.filter(n => n.id !== f.child.id);
  assert.deepEqual(validateDocument(restored).adrScope, f.doc.adrScope); assert.equal(adrScopeFreshness(restored.adrScope, restored, f.scenario), 'stale');
  const md = toMarkdown(restored); assert.match(md, /Saved ADR scope/); assert.match(md, /not.*decision|not.*ADR/i); assert.ok(md.replaceAll('\\', '').includes(f.focal.id));
});

async function setup(t, libraryMode = false) {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), 'explorer-adr-scope-')); let file = join(directory, 'map.explore.json'), calls = 0;
  f.doc.handoff = acceptHandoff(parseHandoff(JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] }), prepareHandoff(f.doc, { nodeIds: [f.focal.id], format: 'brief', includeEvidence: false })), []);
  const library = libraryMode ? new Library(directory) : undefined, entry = library && await library.import(f.doc);
  if (!library) await writeFile(file, JSON.stringify(f.doc)); else file = entry.file;
  const noInference = () => { calls++; throw Error('Scope selection must not invoke inference'); };
  const e = await new Explorer({ file, library, binding: 'adr-scope', send: noInference, researcher: { run: noInference }, briefHelper: { run: noInference, close() {} } }).load();
  if (entry) await e.attach(entry.key);
  t.after(async () => { await e.close(); await rm(directory, { recursive: true, force: true }); });
  let sequence = 0; const clientId = randomUUID(), journey = e.activeKey ?? e.doc.id;
  const input = (extra = {}) => ({ action: 'prepare', purpose: 'adr-scope', journey, nodeId: e.doc.rootId, selection: f.selection, clientId, sequence: ++sequence, ...extra });
  const preview = extra => e.reviewResearch(input(extra));
  const save = (p, extra = {}) => e.adrScopeRequest({ action: 'save', journey, revision: e.doc.revision, token: p.token, ...extra });
  return { ...f, e, file, directory, journey, input, preview, save, calls: () => calls };
}

test('ADR scope exact review saves only one explicit portable reference and preserves answers and accepted artifacts', async t => {
  const f = await setup(t), bytes = await readFile(f.file), before = structuredClone(f.e.doc), p = await f.preview();
  assert.equal(p.prepared.operation, 'adr-scope'); assert.equal(p.prepared.settings, undefined); assert.deepEqual(await readFile(f.file), bytes); assert.equal(f.calls(), 0);
  const saved = await f.save(p); assert.equal(saved.freshness, 'current'); assert.deepEqual(saved.scope.selection, f.selection); assert.equal(saved.snapshot.document.revision, before.revision + 1);
  assert.deepEqual(f.e.doc.nodes, before.nodes); assert.deepEqual(f.e.doc.handoff, before.handoff); assert.equal(f.calls(), 0);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')).adrScope, saved.scope);
  assert.equal((await f.e.adrScopeRequest({ action: 'status', journey: f.journey })).freshness, 'current');
  assert.equal((await f.e.readHistory(f.journey)).undoRevision, before.revision);
  assert.deepEqual((await f.e.readHistory(f.journey, before.revision)).document, before);
  await assert.rejects(f.save(p), /obsolete|review/i);
});

test('ADR scope rejects altered request fields, wrong-purpose, replaced and cancelled tokens without saving', async t => {
  const f = await setup(t), bytes = await readFile(f.file); let p = await f.preview();
  for (const extra of [{ selection: f.selection }, { token: 'wrong' }, { revision: 999 }, { journey: 'elsewhere' }]) await assert.rejects(f.save(p, extra));
  await assert.rejects(f.e.command('regenerate-questions', { journey: f.journey, nodeId: f.e.doc.rootId, revision: f.e.doc.revision, token: p.token }), /purpose|question/i);
  const next = await f.preview({ selection: { ...f.selection, nodeIds: [f.focal.id] } }); await assert.rejects(f.save(p), /obsolete/i);
  await f.e.reviewResearch(f.input({ action: 'cancel' })); await assert.rejects(f.save(next), /obsolete/i);
  const handoff = await f.e.reviewResearch(f.input({ purpose: 'implementation-handoff', selection: { nodeIds: [f.focal.id], format: 'brief', includeEvidence: false } }));
  await assert.rejects(f.save(handoff), /purpose/i);
  for (const extra of [{ settings: {} }, { project: { action: 'refresh', paths: ['README.md'] } }, { followup: { question: 'Why?' } }]) await assert.rejects(f.preview(extra), /Invalid/i);
  assert.deepEqual(await readFile(f.file), bytes); assert.equal(f.calls(), 0);
});

test('ADR scope preview rejects changed selected answers, guidance and opted-in evidence', async t => {
  const f = await setup(t);
  for (const mutate of [d => d.nodes.find(n => n.id === f.focal.id).answer += ' correction', d => d.objective += ' changed', d => d.nodes.find(n => n.id === f.focal.id).research.claims[0].limitations += ' changed', d => { d.dependencies = [{ dependentId: f.focal.id, prerequisiteId: f.omitted.id }]; }, d => { d.nodes.find(n => n.id === f.focal.id).researchStale = true; }]) {
    const p = await f.preview({ selection: { ...f.selection, includeEvidence: true } }), changed = structuredClone(f.e.doc); mutate(changed); await f.e.save(changed);
    await assert.rejects(f.save(p), /changed|review/i); assert.equal(f.e.doc.adrScope, undefined);
  }
  assert.equal(f.calls(), 0);
});

test('ADR scope saved freshness tolerates unrelated edits and reports unavailable scenario policy honestly', async t => {
  const f = await setup(t); await f.save(await f.preview());
  const changed = structuredClone(f.e.doc); changed.nodes.find(n => n.id === f.omitted.id).answer += ' unrelated'; await f.e.save(changed);
  assert.equal((await f.e.adrScopeRequest({ action: 'status', journey: f.journey })).freshness, 'current');
  const policy = f.e.scenarioPolicy.bind(f.e); f.e.scenarioPolicy = async () => { throw Error('Preferred scenario unavailable'); };
  const unknown = await f.e.adrScopeRequest({ action: 'status', journey: f.journey }); assert.equal(unknown.freshness, 'unknown'); assert.match(unknown.message, /unavailable/i);
  f.e.scenarioPolicy = policy; const selected = structuredClone(f.e.doc); selected.nodes.find(n => n.id === f.focal.id).answer += ' changed'; await f.e.save(selected);
  assert.equal((await f.e.adrScopeRequest({ action: 'status', journey: f.journey })).freshness, 'stale');
});

test('ADR scope rejects a preference change even when the saved map stays byte-identical', async t => {
  const f = await setup(t, true), p = await f.preview(), bytes = await readFile(f.file);
  const view = await f.e.scenarioPreferenceRequest({ action: 'inspect', journey: f.journey, revision: f.e.doc.revision });
  await f.e.scenarioPreferenceRequest({ action: 'select', journey: f.journey, revision: f.e.doc.revision, id: view.id, rationale: 'Current direction' });
  await assert.rejects(f.save(p), /changed|obsolete/i); assert.deepEqual(await readFile(f.file), bytes); assert.equal(f.calls(), 0);
});

test('ADR scope final save protects an external correction arriving during asynchronous policy validation', async t => {
  const f = await setup(t), p = await f.preview(), original = f.e.assertScenarioPolicy.bind(f.e); let checks = 0, external;
  f.e.assertScenarioPolicy = async policy => {
    await original(policy);
    if (++checks === 2) { external = structuredClone(f.e.doc); external.revision++; external.nodes.find(n => n.id === f.omitted.id).answer = 'EXTERNAL_CORRECTION'; await writeFile(f.file, JSON.stringify(external)); }
  };
  await assert.rejects(f.save(p), /changed|context|refresh/i); assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), external); assert.equal(f.calls(), 0);
});

test('ADR scope HTTP requires Origin and an explicit reviewed token, with no model work on status or selection', async t => {
  const f = await setup(t), server = await startServer(f.e); t.after(() => server.close());
  const url = new URL('api/adr-scope', server.url), headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: url.origin };
  const post = (body, h = headers) => fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const status = { action: 'status', journey: f.journey };
  assert.equal((await post(status, { ...headers, Origin: 'https://elsewhere.invalid' })).status, 403);
  const { Origin, ...noOrigin } = headers; assert.equal((await post(status, noOrigin)).status, 403);
  const empty = await post(status); assert.equal(empty.status, 200); assert.equal((await empty.json()).freshness, 'none');
  const previewResponse = await fetch(new URL('api/research-review', server.url), { method: 'POST', headers, body: JSON.stringify(f.input()) }); assert.equal(previewResponse.status, 200);
  const p = await previewResponse.json(); const response = await post({ action: 'save', journey: f.journey, revision: f.e.doc.revision, token: p.token }); assert.equal(response.status, 200);
  assert.equal((await response.json()).freshness, 'current'); assert.equal(f.calls(), 0);
});

test('ADR scope saves under the project writer lock and reopens with current portable fingerprints', async t => {
  const f = await setup(t, true), root = join(f.directory, 'checkout'); await mkdir(root);
  await promisify(execFile)('git', ['-C', root, 'init', '-q'], { windowsHide: true });
  f.e.projectRepository = new ProjectRepository({ readRoot: async () => root, localDirectory: f.directory });
  const project = await f.e.projectRepository.create(f.e.doc); await f.e.attachProject(project);
  const journey = f.e.activeKey, p = await f.e.reviewResearch(f.input({ journey }));
  const saved = await f.e.adrScopeRequest({ action: 'save', journey, revision: f.e.doc.revision, token: p.token });
  assert.equal(saved.freshness, 'current'); assert.deepEqual(readSharedDocument(await readFile(project.context.file)).document.journey.adrScope, saved.scope);
  await f.e.attachProject(await f.e.projectRepository.open(project.context.relativePath));
  const reopened = await f.e.adrScopeRequest({ action: 'status', journey: f.e.activeKey });
  assert.equal(reopened.freshness, 'current'); assert.deepEqual(reopened.scope, saved.scope); assert.equal(f.calls(), 0);
});
