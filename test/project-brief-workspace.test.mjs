import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { ProjectBriefWorkspace } from '../com.github.copilot/extensions/explorer/project-brief-workspace.mjs';
import { parseProjectBrief, PROJECT_BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/project-brief.mjs';
import { waitFor } from './helpers/wait-for.mjs';

function fixture(t) {
  const excerpt = 'A project for community tools 🌿.', fingerprint = createHash('sha256').update(excerpt).digest('hex');
  const initial = { id: randomUUID(), root: { path: 'C:/project', ancestors: 'identity-a' }, sources: [{ id: randomUUID(), name: 'README.md', fingerprint, excerptFingerprint: fingerprint, bytes: Buffer.byteLength(excerpt), excerptBytes: Buffer.byteLength(excerpt), truncated: false, excerpt }] };
  let capture = initial, fresh = true, journey = 'journey-a', now = 1000, sequence = 0, sends = 0, queued, hold = false, release, signal, inspect;
  const output = Object.fromEntries(PROJECT_BRIEF_SECTIONS.map(section => [section, [{ id: section, text: `${section} is not established.`, kind: 'unknown', sources: [] }]]));
  const mode = { capture: () => capture && structuredClone(capture), captureCurrent: async (value, options) => { if (inspect) await inspect(value, options); options.signal?.throwIfAborted(); return fresh && value?.id === capture?.id; } };
  const helper = { run: async (prepared, options) => { sends++; signal = options.signal; if (hold) await new Promise(resolve => { release = resolve; }); signal.throwIfAborted(); return parseProjectBrief(JSON.stringify(output), prepared); } };
  const workspace = new ProjectBriefWorkspace({ mode, journey: () => journey, now: () => now, execute: task => queued ? queued(task, helper) : task(helper) });
  t.after(() => { workspace.clear(); release?.(); }); const clientId = randomUUID();
  const request = (action, extra = {}) => workspace.request({ action, purpose: 'project-brief', journey, clientId, sequence: ++sequence, ...extra });
  const generate = async () => { await request('status'); const preview = await request('prepare'); const id = randomUUID(); await request('start', { token: preview.token, id }); await waitFor(() => workspace.work?.status !== 'pending'); return request('status'); };
  return { workspace, request, generate, initial, sends: () => sends, signal: () => signal, ready: () => release, release: () => release?.(), hold: () => { hold = true; }, setCapture: value => { capture = value; }, setFresh: value => { fresh = value; }, setJourney: value => { journey = value; }, advance: value => { now += value; }, inspect: value => { inspect = value; }, queue: value => { queued = value; } };
}
const noChanges = () => ({ edits: [], remove: [], additions: [] });

test('project question input requires approval and guards revision, capture and content without disclosing raw sources', async t => {
  const f = fixture(t); await assert.rejects(f.workspace.approvedInput(), /approve|brief/i);
  const draft = await f.generate(); await assert.rejects(f.workspace.approvedInput(), /approve|brief/i);
  await f.request('approve', { revision: draft.revision, changes: { ...noChanges(), additions: [{ section: 'purpose', text: 'A corrected purpose 🌿.' }] } });
  const input = await f.workspace.approvedInput();
  assert.ok(input.brief.claims.some(item => item.kind === 'user' && item.text === 'A corrected purpose 🌿.'));
  assert.ok(!JSON.stringify(input.brief).includes('C:/project')); assert.ok(!JSON.stringify(input.brief).includes(f.initial.sources[0].excerpt));
  assert.equal(f.workspace.approvalCurrent(input.guard), true); await f.workspace.assertApproval(input.guard);
  f.setFresh(false); await assert.rejects(f.workspace.assertApproval(input.guard));
  assert.equal(f.workspace.approvalCurrent(input.guard), false);
  f.setFresh(true); const next = await f.generate(); const approved = await f.request('approve', { revision: next.revision, changes: noChanges() });
  const later = await f.workspace.approvedInput(); await f.request('revoke', { revision: approved.revision });
  assert.equal(f.workspace.approvalCurrent(later.guard), false);
});

test('brief review starts no model; one-use explicit generation stays unapproved until revision-bound approval', async t => {
  const f = fixture(t); const status = await f.request('status'); assert.equal(status.captureAvailable, true); assert.equal(status.approved, false);
  const preview = await f.request('prepare'); assert.ok(preview.prepared.prompt.includes('community tools')); assert.equal(f.sends(), 0);
  const id = randomUUID(); await f.request('start', { id, token: preview.token }); await assert.rejects(f.request('start', { id, token: preview.token }));
  await waitFor(() => f.workspace.work?.status !== 'pending'); const draft = await f.request('status'); assert.equal(draft.state, 'draft'); assert.equal(draft.approved, false);
  const approved = await f.request('approve', { revision: draft.revision, changes: noChanges() }); assert.equal(approved.approved, true); assert.equal(f.sends(), 1);
  await assert.rejects(f.request('approve', { revision: draft.revision, changes: noChanges() }), /revision|changed|stale/i);
  await assert.rejects(f.request('edit', { revision: approved.revision, changes: noChanges() }), /revoke|edit|approved/i);
  const editable = await f.request('revoke', { revision: approved.revision }); assert.equal(editable.approved, false);
});

test('brief corrections and removals preserve other claims and survive a same-project recapture only as user assertions', async t => {
  const f = fixture(t), draft = await f.generate(); const corrected = draft.draft.sections.purpose[0], removed = draft.draft.sections.stack[0];
  const edited = await f.request('edit', { revision: draft.revision, changes: { edits: [{ id: corrected.id, text: 'A user correction 🌿.' }], remove: [removed.id], additions: [] } });
  assert.equal(edited.draft.sections.purpose[0].kind, 'user'); assert.equal(edited.draft.sections.stack.length, 0); assert.equal(edited.draft.sections.constraints.length, 1);
  f.setCapture(null); f.workspace.observe(); const off = await f.request('status'); assert.equal(off.draft, undefined); assert.equal(off.corrections[0].text, 'A user correction 🌿.'); assert.equal(off.approved, false);
  f.setCapture({ ...f.initial, id: randomUUID() }); const next = await f.generate(); assert.ok(next.draft.sections.purpose.some(claim => claim.kind === 'user' && claim.text === 'A user correction 🌿.'));
  f.setCapture({ ...f.initial, id: randomUUID(), root: { path: 'C:/other', ancestors: 'identity-b' } }); assert.deepEqual((await f.request('status')).corrections, []);
});

test('stale capture, changed corrections, expired tokens and foreign purposes cannot start or approve work', async t => {
  for (const change of ['stale', 'capture', 'expired']) {
    const f = fixture(t); await f.request('status'); const preview = await f.request('prepare');
    if (change === 'stale') f.setFresh(false); if (change === 'capture') f.setCapture({ ...f.initial, id: randomUUID() }); if (change === 'expired') f.advance(600001);
    await assert.rejects(f.request('start', { id: randomUUID(), token: preview.token })); assert.equal(f.sends(), 0);
  }
  const f = fixture(t), draft = await f.generate(); const preview = await f.request('prepare');
  await f.request('edit', { revision: draft.revision, changes: { ...noChanges(), additions: [{ section: 'purpose', text: 'Correction after preview.' }] } });
  await assert.rejects(f.request('start', { id: randomUUID(), token: preview.token }));
  await assert.rejects(f.request('status', { purpose: 'research' })); f.setFresh(false);
  await assert.rejects(f.request('approve', { revision: (await f.request('status')).revision, changes: noChanges() }));
});

test('cancellation and scope changes abort only owned work and discard late results', async t => {
  for (const action of ['cancel', 'scope']) {
    const f = fixture(t); f.hold(); await f.request('status'); const preview = await f.request('prepare'), id = randomUUID(); await f.request('start', { token: preview.token, id });
    await waitFor(() => f.ready());
    if (action === 'cancel') await f.request('cancel', { id }); else { f.setCapture(null); f.workspace.observe(); }
    assert.equal(f.signal().aborted, true); f.release(); await new Promise(setImmediate);
    const value = await f.request('status'); assert.equal(value.draft, undefined); assert.equal(value.approved, false);
  }
});

test('queued generation revalidates before helper invocation and changed source after inference discards results', async t => {
  const queued = fixture(t); let run;
  queued.queue((task, helper) => new Promise((resolve, reject) => { run = () => task(helper).then(resolve, reject); }));
  await queued.request('status'); const preview = await queued.request('prepare'); await queued.request('start', { token: preview.token, id: randomUUID() });
  await waitFor(() => run); queued.setFresh(false); run(); await waitFor(() => queued.workspace.work?.status !== 'pending'); assert.equal(queued.sends(), 0);
  const changed = fixture(t); changed.hold(); await changed.request('status'); const before = await changed.request('prepare'); await changed.request('start', { token: before.token, id: randomUUID() });
  await waitFor(() => changed.ready()); changed.setFresh(false); changed.release(); await waitFor(() => changed.workspace.work?.status !== 'pending');
  assert.equal((await changed.request('status')).draft, undefined);
});

test('late status cannot restore a discarded draft or clobber a new client or journey', async t => {
  const f = fixture(t), draft = await f.generate(); let release, started;
  f.inspect(async () => { if (!started) { started = true; await new Promise(resolve => { release = resolve; }); } });
  const old = f.request('status'), rejected = assert.rejects(old); await waitFor(() => release);
  await f.request('discard', { revision: draft.revision }); release(); await rejected; assert.equal((await f.request('status')).draft, undefined);
  const next = await f.generate(); assert.ok(next.draft); f.setJourney('journey-b'); assert.equal((await f.request('status')).draft, undefined);
  await f.generate(); assert.equal((await f.request('status', { clientId: randomUUID() })).draft, undefined);
});

test('failed freshness verification revokes an approved brief instead of retaining uncertain authority', async t => {
  const f = fixture(t), draft = await f.generate(); await f.request('approve', { revision: draft.revision, changes: noChanges() });
  f.inspect(async () => { throw Error('Metadata unavailable'); }); await assert.rejects(f.request('status'));
  assert.equal(f.workspace.approval, null); assert.equal(f.workspace.draft, null);
});
