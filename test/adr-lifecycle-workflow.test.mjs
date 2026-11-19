import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';
import { adrBytesDigest } from '../com.github.copilot/extensions/explorer/adr-file.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'adr-lifecycle-flow-')), root = join(directory, 'project'), file = join(directory, 'map.explore.json');
  await mkdir(root); await writeFile(file, JSON.stringify(adrFileDocument())); let calls = 0, cwd = root;
  const options = { file, projectRoot: async () => cwd, send() { calls++; throw Error('No chat'); }, briefHelper: { run() { calls++; throw Error('No model'); }, close() {} } };
  const e = await new Explorer(options).load(); await e.save(saveAdrFixture(structuredClone(e.doc), (await e.scenarioPolicy()).label));
  let sequence = 0, ordinary = 0; const clientId = randomUUID(), ordinaryId = randomUUID(), journey = e.doc.id;
  const normalPrepare = selection => e.adrFileRequest({ action: 'prepare', journey, clientId: ordinaryId, sequence: ++ordinary, selection });
  const normalSave = p => e.adrFileRequest({ action: 'save', journey, token: p.token, revision: e.doc.revision });
  const first = await normalPrepare({ kind: 'new', number: 1 }); assert.equal((await normalSave(first)).recovery.phase, 'complete');
  const parent = structuredClone(e.doc.adrFiles[0]), node = e.doc.nodes[1];
  await e.writeDraft({ journey, nodeId: node.id, base: node, text: 'PRIVATE_LIFECYCLE_DRAFT λ', revision: 0 });
  const server = await startServer(e), reopened = [];
  t.after(async () => { await server.close(); await e.close(); for (const item of reopened) await item.close(); await rm(directory, { recursive: true, force: true }); });
  const request = input => e.adrLifecycleRequest({ journey, ...input });
  const prepare = (kind = 'accept', id = parent.id, number = 2) => request({ action: 'prepare', clientId, sequence: ++sequence, selection: kind === 'successor' ? { kind, id, number } : { kind, id } });
  const confirm = p => request({ action: 'save', token: p.token, revision: e.doc.revision });
  const refreshDraft = async answer => { const doc = structuredClone(e.doc); doc.nodes[1].answer = answer; await e.save(saveAdrFixture(doc, (await e.scenarioPolicy()).label)); };
  const reopen = async () => { const other = await new Explorer(options).load(); reopened.push(other); return other; };
  const post = async (input, headers = {}) => { const response = await fetch(server.url + 'api/adr-lifecycle', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin, ...headers }, body: JSON.stringify({ journey, ...input }) }); return { status: response.status, value: await response.json() }; };
  return { e, root, file, directory, journey, parent, first, request, prepare, confirm, normalPrepare, normalSave, refreshDraft, reopen, post, calls: () => calls, cwd: value => { cwd = value; } };
}

test('ADR lifecycle accepts and deprecates an existing decision without requiring draft wording or changing source answers', async t => {
  const f = await fixture(t), doc = structuredClone(f.e.doc); delete doc.adrDraft; doc.nodes[1].answer = 'A newer answer requiring source review'; await f.e.save(doc);
  const before = structuredClone(f.e.doc.nodes), preview = await f.prepare();
  assert.equal(preview.kind, 'accept'); assert.equal(preview.files.length, 1); assert.equal(preview.files[0].oldContent, f.first.content); assert.equal(preview.files[0].toStatus, 'accepted');
  assert.equal(preview.files[0].sourceStatus.status, 'changed'); assert.match(preview.files[0].content, /uncertainty/i); assert.doesNotMatch(JSON.stringify(preview), /PRIVATE_LIFECYCLE_DRAFT/); assert.ok(!JSON.stringify(preview).includes(f.root));
  const saved = await f.confirm(preview); assert.equal(saved.recovery.phase, 'complete'); assert.equal(saved.recovery.associationSaved, true); assert.ok(saved.recovery.files.every(file => file.fileSaved));
  const accepted = f.e.doc.adrFiles[0]; assert.equal(accepted.status, 'accepted'); assert.deepEqual(accepted.sources, f.parent.sources); assert.equal(accepted.lifecycle.events[0].actor, null);
  assert.equal(await readFile(join(f.root, accepted.path), 'utf8'), preview.files[0].content); assert.deepEqual(f.e.doc.nodes, before);
  const deprecated = await f.confirm(await f.prepare('deprecate')); assert.equal(deprecated.recovery.phase, 'complete'); assert.equal(f.e.doc.adrFiles[0].status, 'deprecated');
  assert.deepEqual(f.e.doc.nodes, before); assert.equal(f.e.doc.adrDraft, undefined); assert.equal(f.calls(), 0); assert.match((await f.e.readDrafts(f.journey)).entries[0].text, /PRIVATE_LIFECYCLE_DRAFT/);
});

test('successor creation remains proposed until a separate two-file acceptance supersedes the predecessor', async t => {
  const f = await fixture(t); await f.confirm(await f.prepare()); const original = structuredClone(f.e.doc.adrFiles[0]);
  await f.refreshDraft('Choose B for revised recovery requirements.');
  const proposal = await f.prepare('successor'); assert.equal(proposal.files.length, 2); assert.equal(proposal.files[0].oldContent, null); assert.deepEqual(proposal.files.map(file => file.toStatus), ['proposed', 'accepted']);
  assert.equal((await f.confirm(proposal)).recovery.phase, 'complete'); const child = f.e.doc.adrFiles[1];
  assert.equal(f.e.doc.adrFiles[0].status, 'accepted'); assert.equal(child.status, 'proposed'); assert.deepEqual(child.lifecycle.predecessor, { id: original.id, path: original.path });
  assert.equal(child.sources.nodes[0].record.answer, 'Choose B for revised recovery requirements.'); assert.deepEqual(f.e.doc.adrFiles[0].sources, original.sources);
  const approval = await f.prepare('accept', child.id); assert.deepEqual(approval.files.map(file => file.toStatus), ['accepted', 'superseded']);
  const outcome = await f.confirm(approval); assert.equal(outcome.recovery.phase, 'complete'); assert.equal(f.e.doc.adrFiles[0].status, 'superseded'); assert.equal(f.e.doc.adrFiles[1].status, 'accepted');
  assert.deepEqual(f.e.doc.adrFiles[0].sources, original.sources); assert.equal(f.e.doc.adrFiles[0].artifactDigest, original.artifactDigest);
  for (const file of approval.files) assert.equal(await readFile(join(f.root, file.path), 'utf8'), file.content);
  await assert.rejects(f.prepare('successor'), /superseded|accepted|successor/i); assert.equal(f.calls(), 0);
});

test('ordinary ADR writing protects accepted reasoning and retains proposal relationships after a completed lifecycle operation', async t => {
  const f = await fixture(t); await f.confirm(await f.prepare());
  await assert.rejects(f.normalPrepare({ kind: 'update', id: f.parent.id }), /accepted|successor|proposed/i);
  await f.confirm(await f.prepare('successor')); const child = structuredClone(f.e.doc.adrFiles[1]);
  const next = structuredClone(f.e.doc); next.adrDraft.sections.outcome[0].text = 'Manual proposal wording λ'; next.adrDraft.sections.outcome[0].edited = true; await f.e.save(next);
  const preview = await f.normalPrepare({ kind: 'update', id: child.id }); assert.match(preview.content, /Decision lifecycle/); assert.match(preview.content, /Manual proposal wording/);
  assert.equal((await f.normalSave(preview)).recovery.phase, 'complete'); assert.deepEqual(f.e.doc.adrFiles[1].lifecycle, child.lifecycle);
  const status = await f.request({ action: 'status' }); assert.equal(status.recovery.phase, 'completed-history'); assert.equal(status.recovery.canReconcile, false);
  assert.equal(f.e.doc.adrFiles[0].status, 'accepted'); assert.equal(f.e.doc.adrFiles[1].status, 'proposed');
});

for (const phase of ['after-file', 'before-association', 'after-association', 'before-completion']) test(`lifecycle request preserves and reconciles exact two-file intent after ${phase}`, async t => {
  const f = await fixture(t); await f.confirm(await f.prepare()); const preview = await f.prepare('successor'), store = await f.e.adrLifecycle.storage(f.e);
  if (phase === 'after-file') store.fault = async (step, _, index) => { if (step === phase && index === 0) throw Error('Injected first file interruption'); };
  else f.e.adrLifecycle.fault = async step => { if (step === phase) throw Error('Injected lifecycle interruption'); };
  const failed = await f.confirm(preview); assert.match(failed.error, /Injected/); assert.equal(failed.recovery.canReconcile, true); assert.equal(failed.recovery.files[0].fileSaved, true);
  if (phase === 'after-file') assert.equal(failed.recovery.files[1].fileSaved, false);
  const reopened = await f.reopen(), result = await reopened.adrLifecycleRequest({ action: 'reconcile', journey: f.journey, revision: reopened.doc.revision, operationId: failed.recovery.id });
  assert.equal(result.recovery.phase, 'complete'); assert.equal(reopened.doc.adrFiles.length, 2); assert.equal(reopened.doc.adrFiles[1].status, 'proposed');
  for (const file of preview.files) assert.equal(await readFile(join(f.root, file.path), 'utf8'), file.content);
  const revision = reopened.doc.revision; const repeated = await reopened.adrLifecycleRequest({ action: 'reconcile', journey: f.journey, revision, operationId: failed.recovery.id });
  assert.equal(repeated.recovery.phase, 'complete'); assert.equal(reopened.doc.revision, revision);
});

test('explicit lifecycle reconciliation after partial publication retains newer answers and the historical successor capture', async t => {
  const f = await fixture(t); await f.confirm(await f.prepare()); await f.refreshDraft('Reviewed successor source'); const preview = await f.prepare('successor'), store = await f.e.adrLifecycle.storage(f.e);
  store.fault = async (phase, _, index) => { if (phase === 'after-file' && index === 0) throw Error('Pause after first file'); };
  const failed = await f.confirm(preview), next = structuredClone(f.e.doc); next.nodes[1].answer = 'Newer source after interrupted publication'; await f.e.save(next);
  store.fault = async () => {}; const recovered = await f.request({ action: 'reconcile', operationId: failed.recovery.id, revision: f.e.doc.revision });
  assert.equal(recovered.recovery.phase, 'complete'); assert.equal(f.e.doc.nodes[1].answer, 'Newer source after interrupted publication');
  assert.equal(f.e.doc.adrFiles[1].sources.nodes[0].record.answer, 'Reviewed successor source');
});

test('unfinished lifecycle work blocks ordinary writes and cannot discard an already published part', async t => {
  const f = await fixture(t); await f.confirm(await f.prepare()); const preview = await f.prepare('successor'), store = await f.e.adrLifecycle.storage(f.e);
  store.fault = async (phase, _, index) => { if (phase === 'after-file' && index === 0) throw Error('Pause'); };
  const failed = await f.confirm(preview); await assert.rejects(f.normalPrepare({ kind: 'new', number: 3 }), /unfinished|lifecycle|reconcil/i);
  const discard = await f.request({ action: 'discard', operationId: failed.recovery.id, revision: f.e.doc.revision }); assert.match(discard.error, /published|preserv|discard/i);
  assert.equal(await readFile(join(f.root, preview.files[0].path), 'utf8'), preview.files[0].content);
});

test('lifecycle confirmation rejects intervening source, contributor and predecessor file changes without overwriting', async t => {
  for (const kind of ['source', 'actor', 'file']) {
    const f = await fixture(t); let actor = null; f.e.contributorSettings = () => ({ read: async () => ({ actor }) }); const preview = await f.prepare();
    if (kind === 'source') { const next = structuredClone(f.e.doc); next.nodes[1].answer = 'Intervening source change'; await f.e.save(next); }
    else if (kind === 'actor') actor = { id: randomUUID(), displayName: 'Another identity' };
    else await writeFile(join(f.root, f.parent.path), 'External ADR correction');
    let result; try { result = await f.confirm(preview); } catch (error) { result = { error: error.message }; }
    assert.match(result.error, /changed|obsolete|identity|source|actor|contributor|conflict|unavailable/i);
    assert.equal(f.e.doc.adrFiles[0].status, 'proposed'); assert.equal(await readFile(join(f.root, f.parent.path), 'utf8'), kind === 'file' ? 'External ADR correction' : f.first.content);
  }
});

test('lifecycle successor numbering collisions and cleared preview ownership never yield write authority', async t => {
  const f = await fixture(t); await f.confirm(await f.prepare()); await assert.rejects(f.prepare('successor', f.parent.id, 1), /exists|occupied|collision/i);
  const store = await f.e.adrLifecycle.storage(f.e), capture = store.anchor.capture.bind(store.anchor);
  store.anchor.capture = async (...args) => { const value = await capture(...args); f.e.adrLifecycle.clear(); return value; };
  await assert.rejects(f.prepare('deprecate'), /obsolete|changed/i); assert.equal(f.e.doc.adrFiles[0].status, 'accepted');
});

test('lifecycle HTTP enforces exact origin, schema, revision and explicit review token without exposing private drafts', async t => {
  const f = await fixture(t);
  assert.equal((await f.post({ action: 'status' }, { Origin: 'https://example.com' })).status, 403); assert.equal((await f.post({ action: 'status' }, { 'X-Explorer-Client': '' })).status, 403);
  for (const input of [{ action: 'status', extra: true }, { action: 'status', journey: 'other' }, { action: 'prepare', clientId: randomUUID(), sequence: 1, selection: { kind: 'accept', id: f.parent.id, path: '../other.md' } }, { action: 'save', token: randomUUID(), revision: f.e.doc.revision }, { action: 'status', extra: 'x'.repeat(17000) }]) assert.equal((await f.post(input)).status, 400);
  const status = await f.post({ action: 'status' }); assert.equal(status.status, 200); assert.ok(Buffer.byteLength(JSON.stringify(status.value)) < 512 * 1024); assert.doesNotMatch(JSON.stringify(status.value), /PRIVATE_LIFECYCLE_DRAFT/);
  const preview = await f.prepare(); await f.request({ action: 'cancel', clientId: preview.clientId, sequence: preview.sequence + 1 }); await assert.rejects(f.confirm(preview), /obsolete|preview/i);
  assert.equal(f.e.doc.adrFiles[0].status, 'proposed'); assert.equal(f.calls(), 0);
});

test('explicit lifecycle attribution keeps the reviewed self-declared contributor and timestamp', async t => {
  const f = await fixture(t), actor = { id: randomUUID(), displayName: 'Reviewer λ <not HTML>' };
  f.e.contributorSettings = () => ({ read: async () => ({ actor }) });
  const p = await f.prepare(); assert.deepEqual(p.actor, actor); const event = f.e.adrLifecycle.current.plan.steps[0].record.lifecycle.events[0];
  assert.equal((await f.confirm(p)).recovery.phase, 'complete'); assert.deepEqual(f.e.doc.adrFiles[0].lifecycle.events, [event]); assert.deepEqual(event.actor, actor);
  assert.match(p.files[0].content, /self-declared contributor/); assert.equal(await readFile(join(f.root, f.parent.path), 'utf8'), p.files[0].content);
});

for (const change of ['source', 'root', 'closed']) test(`lifecycle final storage reads reject ${change} drift before publication`, async t => {
  const f = await fixture(t), p = await f.prepare(), store = await f.e.adrLifecycle.storage(f.e), child = store.child.bind(store); let changed = false;
  store.child = (...args) => {
    const item = child(...args); if (item.injected) return item; item.injected = true; const stageData = item.stageData.bind(item);
    item.stageData = async (...values) => {
      const result = await stageData(...values);
      if (!changed) {
        changed = true;
        if (change === 'source') { const next = structuredClone(f.e.doc); next.nodes[1].answer = 'Changed during final read'; next.revision++; await writeFile(f.file, JSON.stringify(next)); }
        if (change === 'root') { const other = join(f.directory, 'other'); await mkdir(other); f.cwd(other); }
        if (change === 'closed') f.e.closed = true;
      }
      return result;
    }; return item;
  };
  const result = await f.confirm(p); assert.equal(changed, true); assert.match(result.error, /changed|obsolete|unavailable|updated/i);
  assert.equal(await readFile(join(f.root, f.parent.path), 'utf8'), f.first.content); assert.equal(f.e.doc.adrFiles[0].status, 'proposed');
});

test('lifecycle association conflicts preserve a published successor and newer records', async t => {
  const f = await fixture(t); await f.confirm(await f.prepare()); const p = await f.prepare('successor'), store = await f.e.adrLifecycle.storage(f.e);
  store.fault = async (phase, _, index) => { if (phase === 'after-file' && index === 0) throw Error('Pause before predecessor'); };
  const failed = await f.confirm(p), next = structuredClone(f.e.doc); next.adrFiles[0].writtenAt = '2026-11-18T01:02:03.000Z'; await f.e.save(next);
  store.fault = async () => {}; const recovered = await f.request({ action: 'reconcile', operationId: failed.recovery.id, revision: f.e.doc.revision });
  assert.match(recovered.error, /association changed|conflict/i); assert.equal(f.e.doc.adrFiles.length, 1); assert.equal(f.e.doc.adrFiles[0].writtenAt, next.adrFiles[0].writtenAt);
  assert.equal(await readFile(join(f.root, p.files[0].path), 'utf8'), p.files[0].content); assert.equal(await readFile(join(f.root, p.files[1].path), 'utf8'), p.files[1].oldContent);
});

test('lifecycle history finalization remains pending and reconciliation preserves the durable transition without duplication', async t => {
  const f = await fixture(t), p = await f.prepare(), history = await f.e.history(f.journey); let manifests = 0;
  history.write = async (path, bytes) => { if (path.endsWith('manifest.json') && ++manifests === 2) throw Error('Injected final history failure'); await atomicWrite(path, bytes); };
  const failed = await f.confirm(p); assert.match(failed.error, /history|final/i); assert.equal(failed.recovery.associationSaved, true); assert.equal(failed.recovery.canReconcile, true);
  await assert.rejects(f.normalPrepare({ kind: 'new', number: 2 }), /unfinished|reconcil/i);
  history.write = atomicWrite; const revision = f.e.doc.revision, recovered = await f.request({ action: 'reconcile', operationId: failed.recovery.id, revision });
  assert.equal(recovered.recovery.phase, 'complete'); assert.equal(f.e.doc.revision, revision); assert.equal(f.e.doc.adrFiles[0].lifecycle.events.length, 1);
});

test('unfinished ordinary writing blocks lifecycle previews until explicitly discarded', async t => {
  const f = await fixture(t), p = await f.normalPrepare({ kind: 'new', number: 2 }), store = await f.e.adrWriter.storage(f.e);
  store.fault = async phase => { if (phase === 'before-stage') throw Error('Interrupted ordinary write'); };
  const failed = await f.normalSave(p); await assert.rejects(f.prepare(), /unfinished|recovery/i);
  const result = await f.e.adrFileRequest({ action: 'discard-operation', journey: f.journey, revision: f.e.doc.revision, operationId: failed.recovery.id }); assert.equal(result.recovery.phase, 'abandoned');
  assert.equal((await f.confirm(await f.prepare())).recovery.phase, 'complete');
});

test('oversized exact lifecycle responses reject before issuing a review token or write intent', async t => {
  const f = await fixture(t), content = '\0'.repeat(45000) + f.first.content, next = structuredClone(f.e.doc);
  assert.ok(Buffer.byteLength(content) < 65536); await writeFile(join(f.root, f.parent.path), content); next.adrFiles[0].sha256 = adrBytesDigest(content); await f.e.save(next);
  await assert.rejects(f.prepare(), /response limit/i); assert.equal(f.e.adrLifecycle.current, null); assert.equal(await (await f.e.adrLifecycle.storage(f.e)).readIntent(), null);
  assert.equal(await readFile(join(f.root, f.parent.path), 'utf8'), content);
});

test('lifecycle final authority reads retain a concurrent human edit to the predecessor', async t => {
  const f = await fixture(t), p = await f.prepare(), store = await f.e.adrLifecycle.storage(f.e), publish = store.publish.bind(store); let guards = 0;
  store.publish = (id, guard) => publish(id, async (...args) => { await guard(...args); if (++guards === 2) await writeFile(join(f.root, f.parent.path), 'Human correction during lifecycle authority read'); });
  const result = await f.confirm(p); assert.match(result.error, /changed|identity|conflict|review/i); assert.equal(guards, 2);
  assert.equal(await readFile(join(f.root, f.parent.path), 'utf8'), 'Human correction during lifecycle authority read'); assert.equal(f.e.doc.adrFiles[0].status, 'proposed');
});

test('ordinary completion receipt failure stays pending until explicit reconciliation before lifecycle review', async t => {
  const f = await fixture(t), p = await f.normalPrepare({ kind: 'new', number: 2 }), store = await f.e.adrWriter.storage(f.e), complete = store.complete.bind(store);
  store.complete = async () => { throw Error('Injected completion receipt failure'); };
  const failed = await f.normalSave(p); assert.match(failed.error, /receipt failure/); assert.equal(failed.recovery.phase, 'completion-pending'); assert.equal(failed.recovery.canReconcile, true); assert.equal(await f.e.adrWriter.hasPending(f.e), true);
  await assert.rejects(f.prepare(), /unfinished|recovery/i); await assert.rejects(f.normalPrepare({ kind: 'new', number: 3 }), /unfinished|recovery/i);
  store.complete = complete; const revision = f.e.doc.revision;
  const result = await f.e.adrFileRequest({ action: 'reconcile', journey: f.journey, operationId: failed.recovery.id, revision });
  assert.equal(result.recovery.phase, 'complete'); assert.equal(f.e.doc.revision, revision); assert.equal((await f.prepare()).kind, 'accept');
});

test('legacy completed ordinary journals without receipt requirements remain compatible with explicit lifecycle confirmation', async t => {
  const f = await fixture(t), store = await f.e.adrWriter.storage(f.e), intent = await store.readIntent(); delete intent.completed; delete intent.completionRequired;
  await writeFile(store.journalFile, JSON.stringify(intent)); assert.equal((await f.e.adrFileRequest({ action: 'status', journey: f.journey })).recovery.phase, 'complete');
  const preview = await f.prepare(); assert.equal((await store.readIntent()).completed, undefined); assert.equal((await f.confirm(preview)).recovery.phase, 'complete');
  assert.equal((await store.readIntent()).completed, true);
});
