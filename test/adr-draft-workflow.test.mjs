import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { captureAdrScope, prepareAdrScope } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { defaultAdrFormat } from '../com.github.copilot/extensions/explorer/adr-format.mjs';
import { parseAdrDraft } from '../com.github.copilot/extensions/explorer/adr-draft.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { waitFor } from './helpers/wait-for.mjs';

const raw = p => ({ title: 'Proposed storage λ', status: 'proposed', sections: { context: [], drivers: [], alternatives: [], outcome: [{ id: 'choice', text: 'Maybe A; reason remains unknown.', certainty: 'uncertain', sources: [{ kind: 'node', id: p.context.focalId }] }], consequences: [], confirmation: [], optionDetails: [] } });
async function fixture(t, libraryMode = false) {
  const directory = await mkdtemp(join(tmpdir(), 'adr-draft-')), doc = createDocument('Storage choice'); let file = join(directory, 'map.explore.json');
  const [focal, other] = addQuestions(doc, doc.rootId, [{ question: 'Which store?', category: 'Design' }, { question: 'Other question?', category: 'Other' }]);
  focal.answer = 'Maybe A'; focal.answerState = 'tentative'; other.answer = 'UNSELECTED_CANARY';
  await writeFile(file, JSON.stringify(doc)); const calls = [];
  const library = libraryMode ? new Library(join(directory, 'library')) : undefined, entry = library ? await library.import(doc) : null;
  const e = await new Explorer({ file, library, binding: 'adr-draft', briefHelper: { async run(p) { calls.push(p); return parseAdrDraft(JSON.stringify(raw(p)), p); }, close() {} }, send() { throw Error('ADR drafts must not use attached chat'); } }).load();
  if (entry) { await e.attach(entry.key); file = entry.file; }
  const scoped = structuredClone(e.doc); scoped.adrFormat = defaultAdrFormat(); scoped.adrScope = captureAdrScope(prepareAdrScope(scoped, { focalId: focal.id, nodeIds: [focal.id], includeEvidence: false }, { scenario: (await e.scenarioPolicy()).label })); await e.save(scoped);
  const journey = e.activeKey ?? e.doc.id, request = { id: randomUUID(), journey }; let sequence = 0; const clientId = randomUUID();
  await e.writeDraft({ journey, nodeId: focal.id, base: focal, text: 'PRIVATE_DRAFT_CANARY λ', answerState: 'tentative', revision: 0 });
  const server = await startServer(e); t.after(async () => { await server.close(); await e.close(); await rm(directory, { recursive: true, force: true }); });
  const input = extra => ({ action: 'prepare', purpose: 'adr-draft', clientId, sequence: ++sequence, journey, nodeId: e.doc.rootId, ...extra });
  const review = extra => e.reviewResearch(input(extra)), action = (action, extra = {}, req = request) => e.briefRequest({ ...req, action, ...extra }, 'adrDraft');
  const post = async (route, value, headers = {}) => { const r = await fetch(server.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin, ...headers }, body: JSON.stringify(value) }); return { status: r.status, value: await r.json() }; };
  const generate = async () => { const p = await review(); await action('start', { token: p.token }); await e.toolFreeTask; return p; };
  return { e, directory, file, calls, focal, other, journey, request, input, review, action, post, generate };
}
const edits = { title: 'Edited wording λ', statements: [{ id: 'choice', text: '  Exact wording λ\r\nStill provisional.  ' }] };

test('ADR readiness workflow reviews exact edited wording without inference and saves optional current judgments', async t => {
  const f = await fixture(t); await f.generate();
  const before = await readFile(f.file, 'utf8'), nodes = structuredClone(f.e.doc.nodes), drafts = await f.e.readDrafts(f.journey);
  const initial = await f.action('poll'); assert.equal(initial.readiness.blockers, 0);
  const checked = await f.post('api/adr-draft', { ...f.request, action: 'readiness', edits }); assert.equal(checked.status, 200);
  const r = checked.value.readiness; assert.notEqual(r.digest, initial.readiness.digest); assert.ok(r.items.some(item => item.code === 'edited-statement'));
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.calls.length, 1);
  const acknowledged = [r.items.find(item => item.code === 'missing-alternatives').id];
  await f.action('accept', { revision: f.e.doc.revision, edits, readiness: { digest: r.digest, acknowledged } });
  assert.equal(f.e.doc.adrDraft.status, 'proposed'); assert.deepEqual(f.e.doc.adrDraft.readiness.acknowledged, acknowledged); assert.equal(f.e.doc.adrDraft.readiness.digest, r.digest);
  const saved = await f.action('readiness', { edits: null }); assert.deepEqual(saved.readiness.acknowledged, acknowledged); assert.equal(saved.readiness.digest, r.digest);
  assert.deepEqual(f.e.doc.nodes, nodes); assert.deepEqual(await f.e.readDrafts(f.journey), drafts); assert.equal(f.calls.length, 1);
});

test('ADR readiness workflow rejects obsolete wording judgments, unknown fields and nonadvisory IDs without saving', async t => {
  const f = await fixture(t); await f.generate(); const r = (await f.action('readiness', { edits })).readiness, before = await readFile(f.file, 'utf8');
  for (const readiness of [{ digest: 'a'.repeat(64), acknowledged: [] }, { digest: r.digest, acknowledged: ['b'.repeat(64)] }, { digest: r.digest, acknowledged: [], approve: true }]) await assert.rejects(f.action('accept', { revision: f.e.doc.revision, edits, readiness }), /readiness|advisory/i);
  await assert.rejects(f.action('accept', { revision: f.e.doc.revision, edits: { ...edits, title: 'Changed after review' }, readiness: { digest: r.digest, acknowledged: [] } }), /readiness changed/i);
  await assert.rejects(f.action('readiness', { edits, revision: f.e.doc.revision }), /Invalid/);
  await assert.rejects(f.action('readiness', { edits }, { ...f.request, id: randomUUID() }), /proposal|unavailable/i);
  await assert.rejects(f.e.briefRequest({ ...f.request, action: 'readiness', edits }, 'brief'), /Invalid/);
  assert.equal(await readFile(f.file, 'utf8'), before);
  await f.action('accept', { revision: f.e.doc.revision, edits }); assert.deepEqual(f.e.doc.adrDraft.readiness.acknowledged, [], 'older callers are rechecked without mandatory acknowledgments');
});

test('ADR readiness workflow explains corrected live sources without rebasing stale captured wording', async t => {
  const f = await fixture(t); await f.generate(); const before = structuredClone(f.e.briefWork.proposal);
  const changed = structuredClone(f.e.doc); changed.nodes[1].answer = 'Now B'; changed.nodes[1].answerState = 'decided'; await f.e.save(changed);
  const r = (await f.action('readiness', { edits })).readiness;
  assert.ok(r.items.some(item => item.code === 'changed-source' && item.target.id === f.focal.id));
  assert.equal(r.items.some(item => item.code === 'unresolved-source' && item.target.id === f.focal.id), false);
  assert.deepEqual(f.e.briefWork.proposal, before); const view = await f.action('poll'); assert.equal(view.status, 'stale'); assert.ok(view.readiness.blockers);
  await assert.rejects(f.action('accept', { revision: f.e.doc.revision, edits, readiness: { digest: r.digest, acknowledged: r.items.filter(item => item.severity === 'blocker').map(item => item.id) } }), /stale|blocker/i);
  assert.equal(f.e.doc.adrDraft, undefined); assert.equal(f.calls.length, 1);
});

test('ADR readiness workflow rejects generated receipts and rechecks disk after asynchronous scenario validation', async t => {
  const f = await fixture(t), originalHelper = f.e.briefHelper.run;
  f.e.briefHelper.run = async p => ({ ...await originalHelper(p), readiness: { version: 1, digest: 'a'.repeat(64), reviewedAt: new Date().toISOString(), acknowledged: [] } });
  await f.generate(); assert.equal((await f.action('poll')).status, 'error');
  f.e.briefHelper.run = originalHelper; await f.generate();
  const originalPolicy = f.e.scenarioPolicy.bind(f.e); let changed = false;
  f.e.scenarioPolicy = async () => { const policy = await originalPolicy(); if (!changed) { changed = true; const disk = structuredClone(f.e.doc); disk.adrFormat.digits = 6; disk.revision++; await writeFile(f.file, JSON.stringify(disk)); } return policy; };
  const r = (await f.action('readiness', { edits })).readiness; assert.ok(r.items.some(item => item.code === 'changed-format')); assert.ok(r.blockers);
});

test('ADR readiness final acceptance recomputes scenario after the last asynchronous policy check', async t => {
  const f = await fixture(t); await f.generate(); const r = (await f.action('readiness', { edits })).readiness, before = await readFile(f.file, 'utf8');
  const original = f.e.assertScenarioPolicy.bind(f.e); let checks = 0;
  f.e.assertScenarioPolicy = async policy => { await original(policy); if (++checks === 2) { const current = await f.e.scenarioPolicy(); f.e.scenarioPolicy = async () => ({ ...current, label: { changed: 'during final await' } }); } };
  await assert.rejects(f.action('accept', { revision: f.e.doc.revision, edits, readiness: { digest: r.digest, acknowledged: [] } }), /blocker|changed|stale/i);
  assert.equal(checks, 2); assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.e.doc.adrDraft, undefined);
});

test('ADR workflow reviews exact input, keeps proposals private and explicitly saves wording with history and drafts intact', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), drafts = await f.e.readDrafts(f.journey), p = await f.review();
  assert.equal(f.calls.length, 0); assert.doesNotMatch(p.prepared.prompt, /CANARY/); assert.equal(p.prepared.operation, 'adr-draft');
  await f.action('start', { token: p.token }); await f.e.toolFreeTask;
  assert.equal(f.calls[0].prompt, p.prepared.prompt); assert.equal(f.calls[0].instructions, p.prepared.instructions);
  assert.equal((await f.action('poll')).status, 'proposal'); assert.equal(f.e.doc.adrDraft, undefined); assert.equal(await readFile(f.file, 'utf8'), before); assert.doesNotMatch(JSON.stringify(f.e.uiSnapshot()), /Proposed storage/);
  await assert.rejects(f.action('accept', { revision: f.e.doc.revision, edits: { ...edits, status: 'accepted' } }), /ADR|Invalid/i);
  const nodes = structuredClone(f.e.doc.nodes), revision = f.e.doc.revision;
  assert.equal((await f.action('accept', { revision, edits })).status, 'accepted');
  assert.equal(f.e.doc.adrDraft.status, 'proposed'); assert.equal(f.e.doc.adrDraft.titleEdited, true); assert.equal(f.e.doc.adrDraft.sections.outcome[0].text, edits.statements[0].text);
  assert.deepEqual(f.e.doc.nodes, nodes); assert.deepEqual(await f.e.readDrafts(f.journey), drafts);
  assert.equal((await f.e.readHistory(f.journey)).current.revision, revision + 1);
  await f.e.command('answer', { revision: f.e.doc.revision, nodeId: f.other.id, answer: 'Unrelated update' });
  const history = await f.e.readHistory(f.journey, revision + 1); assert.deepEqual(history.document.adrDraft, f.e.doc.adrDraft);
  const reloaded = await new Explorer({ file: f.file }).load(); assert.deepEqual(reloaded.doc.adrDraft, f.e.doc.adrDraft); await reloaded.close();
});

test('ADR review and HTTP workflow reject unknown fields, wrong purpose, expiry, cancellation and missing origin/client', async t => {
  const f = await fixture(t);
  for (const extra of [{ selection: {} }, { nodeId: f.focal.id }, { settings: {} }]) await assert.rejects(f.review(extra));
  const p = await f.review(); await assert.rejects(f.e.researchReview.consume(f.e, { token: p.token, journey: f.journey, nodeId: f.e.doc.rootId, purpose: 'implementation-handoff' }), /purpose/);
  assert.equal((await f.post('api/adr-draft', { ...f.request, action: 'start', token: p.token }, { Origin: '' })).status, 403);
  assert.equal((await f.post('api/adr-draft', { ...f.request, action: 'start', token: p.token }, { 'X-Explorer-Client': '' })).status, 403);
  f.e.researchReview.current.expiresAt = 0; await assert.rejects(f.action('start', { token: p.token }), /obsolete|expired/i);
  const cancelled = await f.review(); await f.e.reviewResearch(f.input({ action: 'cancel' })); await assert.rejects(f.action('start', { token: cancelled.token }), /obsolete/i);
  const fresh = await f.review(); const started = await f.post('api/adr-draft', { ...f.request, action: 'start', token: fresh.token }); assert.equal(started.status, 200);
  await f.e.toolFreeTask; await assert.rejects(f.action('start', { token: fresh.token }), /obsolete/i); assert.equal(f.calls.length, 1);
});

test('ADR controller revalidates malformed injected helper output while retaining trusted captures', async t => {
  for (const mutate of [v => v.status = 'accepted', v => v.sections.outcome[0].sources[0].id = 'invented', v => v.title = 'x'.repeat(201), v => v.unexpected = true]) {
    const f = await fixture(t); f.e.briefHelper.run = async p => { const value = parseAdrDraft(JSON.stringify(raw(p)), p); mutate(value); return value; };
    await f.generate(); assert.equal((await f.action('poll')).status, 'error'); assert.equal(f.e.doc.adrDraft, undefined);
  }
  const f = await fixture(t); f.e.briefHelper.run = async p => { const value = parseAdrDraft(JSON.stringify(raw(p)), p); value.sections.outcome[0].edited = true; return { ...value, titleEdited: true, format: 'forged', dependencies: {}, evidence: [{ private: true }] }; };
  await f.generate(); const view = await f.action('poll'); assert.equal(view.status, 'proposal'); assert.deepEqual(view.proposal.format, f.e.doc.adrFormat); assert.deepEqual(view.proposal.evidence, []);
  assert.equal(view.proposal.titleEdited, false); assert.equal(view.proposal.sections.outcome[0].edited, false);
});

test('ADR queue waits for actual release, rejects late cancellation and preserves saved draft content', async t => {
  const f = await fixture(t), drafts = await f.e.readDrafts(f.journey), before = await readFile(f.file); let release, firstSignal;
  f.e.briefHelper.run = (p, options) => { f.calls.push(p); if (f.calls.length === 1) { firstSignal = options.signal; return new Promise(resolve => { release = () => resolve(parseAdrDraft(JSON.stringify(raw(p)), p)); }); } return Promise.resolve(parseAdrDraft(JSON.stringify(raw(p)), p)); };
  const p = await f.review(); await f.action('start', { token: p.token }); await waitFor(() => release);
  await f.action('discard'); assert.equal(firstSignal.aborted, true);
  const next = await f.review(), req = { id: randomUUID(), journey: f.journey }; await f.action('start', { token: next.token }, req); assert.equal(f.calls.length, 1);
  release(); await f.e.toolFreeTask; assert.equal(f.calls.length, 2); assert.equal((await f.action('poll', {}, req)).status, 'proposal');
  assert.deepEqual(await readFile(f.file), before); assert.deepEqual(await f.e.readDrafts(f.journey), drafts);
  await f.action('discard', {}, req); f.e.unconfirmedToolFreeRelease = {}; const blocked = await f.review(); await assert.rejects(f.action('start', { token: blocked.token }), /shutdown|release/i);
});

test('ADR start and queued dispatch reject changed format and saved scope even with unchanged answers', async t => {
  const f = await fixture(t), p = await f.review(), changed = structuredClone(f.e.doc); changed.adrFormat.digits = 6; await f.e.save(changed);
  await assert.rejects(f.action('start', { token: p.token }), /changed|stale/i);
  const fresh = await f.review(); let release; f.e.toolFreeTask = new Promise(resolve => { release = resolve; }); await f.action('start', { token: fresh.token });
  const disk = structuredClone(f.e.doc); disk.adrScope.selectedAt = '2026-11-17T00:00:00.000Z'; disk.revision++; await writeFile(f.file, JSON.stringify(disk));
  release(); await f.e.toolFreeTask; assert.equal(f.calls.length, 0); assert.equal((await f.action('poll')).status, 'stale');
});

for (const stage of ['dispatch', 'completion', 'poll']) test(`ADR ${stage} rechecks disk after asynchronous scenario validation`, async t => {
  const f = await fixture(t); let delivered = false, changed = false;
  f.e.briefHelper.run = async p => { f.calls.push(p); delivered = true; return parseAdrDraft(JSON.stringify(raw(p)), p); };
  if (stage === 'poll') await f.generate();
  const original = f.e.assertScenarioPolicy.bind(f.e);
  f.e.assertScenarioPolicy = async policy => { await original(policy); if (!changed && f.e.briefWork && (stage === 'dispatch' ? !delivered : stage === 'completion' ? delivered : true)) { const disk = structuredClone(f.e.doc); disk.adrFormat.digits = 6; disk.revision++; await writeFile(f.file, JSON.stringify(disk)); changed = true; } };
  if (stage !== 'poll') await f.generate();
  const view = await f.action('poll'); assert.equal(changed, true); assert.equal(view.status, 'stale'); assert.equal(f.e.doc.adrDraft, undefined);
  if (stage === 'dispatch') assert.equal(f.calls.length, 0);
});

test('ADR final acceptance check preserves an unrelated external edit made during its last asynchronous guard', async t => {
  const f = await fixture(t); await f.generate(); const original = f.e.assertScenarioPolicy.bind(f.e); let checks = 0, external;
  f.e.assertScenarioPolicy = async policy => { await original(policy); if (++checks === 2) { external = structuredClone(f.e.doc); external.nodes[2].answer = 'EXTERNAL_NEW_ANSWER'; external.revision++; await writeFile(f.file, JSON.stringify(external)); } };
  await assert.rejects(f.action('accept', { revision: f.e.doc.revision, edits }), /changed|updated|stale/i);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), external); assert.equal(f.e.doc.adrDraft, undefined);
});

test('ADR dependency changes invalidate exact input review and generated wording without changing selected answers', async t => {
  for (const stage of ['review', 'proposal']) {
    const f = await fixture(t), preview = stage === 'proposal' ? await f.generate() : await f.review(), answers = f.e.doc.nodes.map(n => n.answer);
    const next = structuredClone(f.e.doc); next.dependencies = [{ dependentId: f.focal.id, prerequisiteId: f.other.id, explanation: 'Required first' }]; await f.e.save(next);
    if (stage === 'review') { await assert.rejects(f.action('start', { token: preview.token }), /changed|stale/i); assert.equal(f.calls.length, 0); }
    else { assert.equal((await f.action('poll')).status, 'stale'); await assert.rejects(f.action('accept', { revision: f.e.doc.revision, edits }), /stale|changed/i); }
    assert.equal(f.e.doc.adrDraft, undefined); assert.deepEqual(f.e.doc.nodes.map(n => n.answer), answers);
    assert.match((await f.e.readDrafts(f.journey)).entries[0].text, /PRIVATE_DRAFT_CANARY/);
  }
});

test('ADR scenario preference invalidates reviewed work without changing map bytes', async t => {
  const f = await fixture(t, true), p = await f.review(), before = await readFile(f.file), view = await f.e.scenarioPreferenceRequest({ action: 'inspect', journey: f.journey, revision: f.e.doc.revision });
  await f.e.scenarioPreferenceRequest({ action: 'select', journey: f.journey, revision: f.e.doc.revision, id: view.id, rationale: 'Current direction' });
  await assert.rejects(f.action('start', { token: p.token }), /changed|obsolete|scope/i); assert.deepEqual(await readFile(f.file), before); assert.equal(f.calls.length, 0);
});

test('ADR generated proposal becomes stale after a scenario preference change and cannot be accepted', async t => {
  const f = await fixture(t, true); await f.generate(); const before = await readFile(f.file), view = await f.e.scenarioPreferenceRequest({ action: 'inspect', journey: f.journey, revision: f.e.doc.revision });
  await f.e.scenarioPreferenceRequest({ action: 'select', journey: f.journey, revision: f.e.doc.revision, id: view.id, rationale: 'Prefer this direction' });
  assert.equal((await f.action('poll')).status, 'stale'); await assert.rejects(f.action('accept', { revision: f.e.doc.revision, edits }), /stale|changed/i);
  assert.deepEqual(await readFile(f.file), before); assert.equal(f.e.doc.adrDraft, undefined);
});
