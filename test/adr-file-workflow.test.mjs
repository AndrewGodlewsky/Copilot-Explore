import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { projectStorageContext } from '../com.github.copilot/extensions/explorer/storage-context.mjs';
import { ProjectJourney } from '../com.github.copilot/extensions/explorer/project-journey.mjs';
import { readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'adr-file-flow-')), root = join(directory, 'project'), file = join(directory, 'map.explore.json'); await mkdir(root); await writeFile(file, JSON.stringify(adrFileDocument()));
  let workingRoot = root, calls = 0; const options = { file, projectRoot: async () => workingRoot, send() { calls++; throw Error('No chat'); }, briefHelper: { run() { calls++; throw Error('No model'); }, close() {} } };
  const e = await new Explorer(options).load(); await e.save(saveAdrFixture(structuredClone(e.doc), (await e.scenarioPolicy()).label));
  const journey = e.doc.id, node = e.doc.nodes[1]; await e.writeDraft({ journey, nodeId: node.id, base: node, text: 'PRIVATE_ANSWER_DRAFT λ', revision: 0 });
  const server = await startServer(e); const reopened = []; t.after(async () => { await server.close(); await e.close(); for (const item of reopened) await item.close(); await rm(directory, { recursive: true, force: true }); });
  let sequence = 0; const clientId = randomUUID(), request = input => e.adrFileRequest({ journey, ...input });
  const prepare = (selection = { kind: 'new', number: 1 }) => request({ action: 'prepare', clientId, sequence: ++sequence, selection });
  const save = preview => request({ action: 'save', token: preview.token, revision: e.doc.revision });
  const post = async (input, headers = {}) => { const response = await fetch(server.url + 'api/adr-file', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin, ...headers }, body: JSON.stringify({ journey, ...input }) }); return { status: response.status, value: await response.json() }; };
  const reopen = async () => { const next = await new Explorer(options).load(); reopened.push(next); return next; };
  return { e, root, file, directory, journey, request, prepare, save, post, reopen, calls: () => calls, changeRoot: value => { workingRoot = value; } };
}

test('ADR file HTTP workflow previews exact saved proposed wording, writes explicitly and persists one association with history', async t => {
  const f = await fixture(t), nodes = structuredClone(f.e.doc.nodes), draft = structuredClone(f.e.doc.adrDraft), before = await readFile(f.file, 'utf8');
  const p = await f.prepare(); assert.equal(p.mode, 'new'); assert.equal(p.oldContent, null); assert.equal(p.path, 'docs/decisions/0001-storage-λ.md'); assert.equal(p.readiness.blockers, 0);
  assert.match(p.content, /Captured exploration sources/);
  assert.deepEqual(await readdir(f.root), []); assert.equal(await readFile(f.file, 'utf8'), before); assert.doesNotMatch(p.content, /PRIVATE_ANSWER_DRAFT/); assert.match(p.content, /Scenario at export/);
  assert.ok(!JSON.stringify(p).includes(JSON.stringify(f.root).slice(1, -1)));
  const result = await f.save(p); assert.equal(result.recovery.phase, 'complete'); assert.equal(result.recovery.fileSaved, true); assert.equal(result.recovery.associationSaved, true);
  assert.equal(await readFile(join(f.root, p.path), 'utf8'), p.content); assert.equal(f.e.doc.adrFiles.length, 1); assert.deepEqual(f.e.doc.nodes, nodes); assert.deepEqual(f.e.doc.adrDraft, draft);
  assert.equal(f.e.doc.adrFiles[0].sources.journey.path, null); assert.equal(f.e.doc.adrFiles[0].sources.journey.commit, null); assert.equal(f.e.doc.adrFiles[0].sources.nodes[0].record.answer, nodes[1].answer);
  assert.match((await f.e.readDrafts(f.journey)).entries[0].text, /PRIVATE_ANSWER_DRAFT/); assert.equal(f.calls(), 0);
  const revision = f.e.doc.revision, replay = await f.request({ action: 'reconcile', operationId: result.recovery.id, revision });
  assert.equal(replay.recovery.phase, 'complete'); assert.equal(f.e.doc.revision, revision); await assert.rejects(f.save(p), /obsolete|preview/i);
  assert.equal((await f.e.readHistory(f.journey, revision - 1)).document.adrFiles, undefined);
});

test('ADR managed update previews a complete before/after comparison and keeps its original path and identity', async t => {
  const f = await fixture(t), first = await f.prepare(); await f.save(first); const original = structuredClone(f.e.doc.adrFiles[0]);
  const next = structuredClone(f.e.doc); next.adrDraft.title = 'Edited proposed title'; next.adrDraft.titleEdited = true; next.adrDraft.sections.outcome[0].text = 'Exact edited decision λ'; next.adrDraft.sections.outcome[0].edited = true; await f.e.save(next);
  const update = await f.prepare({ kind: 'update', id: original.id }); assert.equal(update.mode, 'update'); assert.equal(update.oldContent, first.content); assert.equal(update.path, first.path); assert.match(update.content, /Edited proposed title/);
  await f.save(update); assert.equal(f.e.doc.adrFiles[0].id, original.id); assert.equal(f.e.doc.adrFiles[0].path, original.path); assert.notEqual(f.e.doc.adrFiles[0].sha256, original.sha256); assert.equal(f.e.doc.adrFiles.length, 1);
});

test('ADR workflow rejects stale wording, readiness, root and expired reviews without writing project files', async t => {
  for (const change of ['wording', 'source', 'format', 'root', 'expiry', 'cancel']) {
    const f = await fixture(t), p = await f.prepare();
    if (['wording', 'source', 'format'].includes(change)) { const doc = structuredClone(f.e.doc); if (change === 'wording') doc.adrDraft.title += ' changed'; if (change === 'source') doc.nodes[1].answer += ' changed'; if (change === 'format') doc.adrFormat.digits = 6; await f.e.save(doc); }
    if (change === 'root') { const other = join(f.directory, 'other'); await mkdir(other); f.changeRoot(other); }
    if (change === 'expiry') f.e.adrWriter.current.expiresAt = Date.now() - 1;
    if (change === 'cancel') await f.request({ action: 'cancel', clientId: p.clientId, sequence: p.sequence + 1 });
    let result; try { result = await f.save(p); } catch (error) { assert.match(error.message, /changed|obsolete|stale|review|preview|blocker/i); }
    if (result) assert.notEqual(result.recovery?.fileSaved, true);
    assert.equal(f.e.doc.adrFiles, undefined); assert.deepEqual(await readdir(f.root), []);
  }
});

for (const stage of ['after-publish', 'before-association', 'after-association']) test(`ADR workflow reports actual saved parts and recovers after ${stage}`, async t => {
  const f = await fixture(t), p = await f.prepare(), store = await f.e.adrWriter.storage(f.e);
  if (stage === 'after-publish') store.fault = async phase => { if (phase === stage) throw Error('Injected file boundary'); };
  else f.e.adrWriter.fault = async phase => { if (phase === stage) throw Error('Injected association boundary'); };
  const result = await f.save(p); assert.equal(result.recovery.fileSaved, true); assert.equal(result.recovery.associationSaved, stage === 'after-association'); assert.match(result.error, /Injected/);
  const restarted = await f.reopen(), value = await restarted.adrFileRequest({ action: 'reconcile', journey: f.journey, operationId: result.recovery.id, revision: restarted.doc.revision });
  assert.equal(value.recovery.phase, 'complete'); assert.equal(restarted.doc.adrFiles.length, 1); assert.equal(await readFile(join(f.root, p.path), 'utf8'), p.content);
  assert.deepEqual(await readdir(join(f.root, 'docs/decisions')), ['0001-storage-λ.md']);
});

test('published ADR reconciliation retains newer source answers and draft wording as historical association inputs', async t => {
  const f = await fixture(t), p = await f.prepare(); f.e.adrWriter.fault = async phase => { if (phase === 'before-association') throw Error('Interrupted association'); };
  const failed = await f.save(p), next = structuredClone(f.e.doc); next.nodes[1].answer = 'Newer saved answer'; next.adrDraft.title = 'Newer draft wording'; await f.e.save(next);
  f.e.adrWriter.fault = async () => {}; const recovered = await f.request({ action: 'reconcile', operationId: failed.recovery.id, revision: f.e.doc.revision });
  assert.equal(recovered.recovery.phase, 'complete'); assert.equal(f.e.doc.nodes[1].answer, 'Newer saved answer'); assert.equal(f.e.doc.adrDraft.title, 'Newer draft wording'); assert.equal(await readFile(join(f.root, p.path), 'utf8'), p.content);
  const capture = f.e.doc.adrFiles[0].sources; assert.notEqual(capture.nodes[0].record.answer, 'Newer saved answer'); assert.ok(p.content.includes(capture.digest));
});

test('unpublished stale ADR work can be explicitly abandoned and cannot be silently replayed', async t => {
  const f = await fixture(t), p = await f.prepare(), store = await f.e.adrWriter.storage(f.e); store.fault = async phase => { if (phase === 'before-stage') throw Error('Interrupted before publication'); };
  const failed = await f.save(p), next = structuredClone(f.e.doc); next.adrDraft.title = 'New wording'; await f.e.save(next); store.fault = async () => {};
  const retry = await f.request({ action: 'reconcile', operationId: failed.recovery.id, revision: f.e.doc.revision }); assert.equal(retry.recovery.fileSaved, false); assert.match(retry.error, /changed|stale|review/i);
  const abandoned = await f.request({ action: 'discard-operation', operationId: failed.recovery.id, revision: f.e.doc.revision }); assert.equal(abandoned.recovery.phase, 'abandoned');
  const fresh = await f.prepare(); assert.match(fresh.content, /New wording/); await f.save(fresh); assert.equal(f.e.doc.adrFiles.length, 1);
});

test('ADR file HTTP enforces origin, bounded exact schemas and journey/token/sequence bindings', async t => {
  const f = await fixture(t); assert.equal((await f.post({ action: 'status' }, { Origin: 'https://example.com' })).status, 403); assert.equal((await f.post({ action: 'status' }, { 'X-Explorer-Client': '' })).status, 403);
  for (const input of [{ action: 'status', extra: true }, { action: 'status', journey: 'other' }, { action: 'prepare', clientId: 'short', sequence: 1, selection: { kind: 'new', number: 1 } }, { action: 'prepare', clientId: randomUUID(), sequence: 1, selection: { kind: 'new', number: 1, path: '../arbitrary.md' } }, { action: 'status', extra: 'x'.repeat(17000) }]) assert.equal((await f.post(input)).status, 400);
  const p = await f.prepare(); await assert.rejects(f.request({ action: 'prepare', clientId: p.clientId, sequence: p.sequence, selection: { kind: 'new', number: 1 } }), /obsolete|sequence/i);
  await assert.rejects(f.request({ action: 'save', token: randomUUID(), revision: f.e.doc.revision }), /obsolete|preview/i); assert.deepEqual(await readdir(f.root), []);
});

test('ADR file responses remain bounded for a large map and omit unrelated saved source text', async t => {
  const f = await fixture(t), next = structuredClone(f.e.doc);
  for (let index = 0; index < 60; index++) next.nodes.push({ ...structuredClone(next.nodes[1]), id: randomUUID(), answer: 'UNSELECTED_LARGE_CANARY '.repeat(500) });
  await f.e.save(next); const status = await f.post({ action: 'status' }); assert.equal(status.status, 200); assert.ok(!JSON.stringify(status.value).includes('UNSELECTED_LARGE_CANARY'));
  const preview = await f.prepare(), saved = await f.post({ action: 'save', token: preview.token, revision: f.e.doc.revision });
  assert.equal(saved.status, 200); assert.equal(saved.value.recovery.phase, 'complete'); assert.ok(Buffer.byteLength(JSON.stringify(saved.value)) < 512 * 1024);
});

test('ADR status lists bounded metadata rather than duplicating every historical source capture', async t => {
  const f = await fixture(t), doc = structuredClone(f.e.doc);
  doc.pins = Array.from({ length: 10 }, (_, i) => ({ id: `constraint-${String(i).padStart(20, '0')}`, text: `Constraint ${i} ` + 'x'.repeat(970) }));
  await f.e.save(saveAdrFixture(doc, (await f.e.scenarioPolicy()).label)); const p = await f.prepare(); await f.save(p);
  const original = f.e.doc.adrFiles[0], records = Array.from({ length: 50 }, (_, i) => ({ ...structuredClone(original), id: randomUUID(), path: `docs/decisions/${i}.md` }));
  await f.e.save({ ...structuredClone(f.e.doc), adrFiles: records });
  const response = await f.post({ action: 'status' }); assert.equal(response.status, 200); assert.equal(response.value.entries.length, 50);
  assert.ok(response.value.entries.every(entry => entry.hasSources === true && entry.sources === undefined)); assert.ok(Buffer.byteLength(JSON.stringify(response.value)) < 128 * 1024);
});

test('ADR source inspection returns one immutable capture with current or unavailable status and rejects stale bindings', async t => {
  const f = await fixture(t), p = await f.prepare(); await f.save(p); const record = structuredClone(f.e.doc.adrFiles[0]), before = await readFile(f.file);
  const input = { action: 'sources', id: record.id, revision: f.e.doc.revision };
  const first = await f.request(input); assert.deepEqual(first.capture, record.sources); assert.equal(first.sourceStatus.status, 'current'); assert.deepEqual(await readFile(f.file), before);
  const next = structuredClone(f.e.doc); next.nodes[1].answer = 'Different answer'; await f.e.save(next);
  await assert.rejects(f.request(input), /revision|changed|refresh/i);
  const current = { ...input, revision: f.e.doc.revision }, changed = await f.request(current); assert.equal(changed.sourceStatus.status, 'changed'); assert.deepEqual(changed.capture, record.sources);
  for (const bad of [{ ...current, id: 'missing' }, { ...current, extra: true }]) await assert.rejects(f.request(bad));
  await writeFile(f.file, '{'); const unavailable = await f.request(current); assert.equal(unavailable.sourceStatus.status, 'unavailable'); assert.deepEqual(unavailable.capture, record.sources);
  assert.ok(!JSON.stringify(unavailable).includes(f.directory)); assert.equal(f.calls(), 0);
});

test('ADR final source guard rejects a scenario change during staging without publishing the file', async t => {
  const f = await fixture(t), p = await f.prepare(), store = await f.e.adrWriter.storage(f.e), policy = await f.e.scenarioPolicy();
  store.fault = async phase => { if (phase === 'before-publish') f.e.scenarioPolicy = async () => ({ ...policy, label: { ...policy.label, preferenceRevision: policy.label.preferenceRevision + 1 } }); };
  const result = await f.save(p); assert.equal(result.recovery.fileSaved, false); assert.match(result.error, /readiness|source|changed/i); assert.equal(f.e.doc.adrFiles, undefined);
  await assert.rejects(readFile(join(f.root, p.path)), { code: 'ENOENT' });
});

for (const mode of ['new', 'update']) test(`ADR final storage reads cannot publish ${mode} wording after the source answer changes`, async t => {
  const f = await fixture(t);
  if (mode === 'update') await f.save(await f.prepare());
  const original = structuredClone(f.e.doc.adrFiles), p = await f.prepare(mode === 'update' ? { kind: 'update', id: original[0].id } : { kind: 'new', number: 1 });
  const store = await f.e.adrWriter.storage(f.e), check = f.e.adrWriter.checkSource.bind(f.e.adrWriter), stageData = store.stageData.bind(store);
  let checked = false, changed = false;
  f.e.adrWriter.checkSource = async (...args) => { await check(...args); checked = true; };
  store.stageData = async (...args) => {
    const result = await stageData(...args);
    if (checked && !changed) {
      changed = true; const next = structuredClone(f.e.doc); next.nodes[1].answer = 'Corrected during final storage read'; next.revision++;
      await writeFile(f.file, JSON.stringify(next));
    }
    return result;
  };
  const result = await f.save(p); assert.equal(changed, true); assert.match(result.error, /changed|source|reopen|updated/i);
  if (mode === 'new') await assert.rejects(readFile(join(f.root, p.path)), { code: 'ENOENT' });
  else assert.equal(await readFile(join(f.root, p.path), 'utf8'), p.oldContent);
  assert.equal((await store.inspect()).publication, 'unpublished'); assert.deepEqual(f.e.doc.adrFiles, original);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[1].answer, 'Corrected during final storage read');
});

test('ADR association final guard preserves an external correction made during publication verification', async t => {
  const f = await fixture(t), p = await f.prepare(), store = await f.e.adrWriter.storage(f.e), inspect = store.inspect.bind(store); let changed = false;
  store.inspect = async () => { const state = await inspect(); if (!changed && state.publication === 'published') { changed = true; const doc = structuredClone(f.e.doc); doc.nodes[1].answer = 'External correction'; doc.revision++; await writeFile(f.file, JSON.stringify(doc)); } return state; };
  const result = await f.save(p); assert.equal(result.recovery.fileSaved, true); assert.equal(result.recovery.associationSaved, false); assert.match(result.error, /changed/i);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[1].answer, 'External correction');
  await f.e.command('refresh-answer', { revision: f.e.doc.revision }); const retry = await f.request({ action: 'reconcile', operationId: result.recovery.id, revision: f.e.doc.revision });
  assert.equal(retry.recovery.phase, 'published'); assert.match(retry.error, /History recovery required/); assert.equal(f.e.doc.nodes[1].answer, 'External correction');
  assert.equal(await readFile(join(f.root, p.path), 'utf8'), p.content); assert.equal(f.e.doc.adrFiles, undefined);
});

test('ADR reconciliation rejects conflicting association changes without replacing newer user records', async t => {
  const f = await fixture(t), p = await f.prepare(); f.e.adrWriter.fault = async phase => { if (phase === 'before-association') throw Error('Pause association'); };
  const result = await f.save(p), store = await f.e.adrWriter.storage(f.e), intent = await store.readIntent(), conflict = { ...intent.record, sha256: 'c'.repeat(64) };
  await f.e.save({ ...structuredClone(f.e.doc), adrFiles: [conflict] }); f.e.adrWriter.fault = async () => {};
  const retry = await f.request({ action: 'reconcile', operationId: result.recovery.id, revision: f.e.doc.revision });
  assert.match(retry.error, /association changed|conflict/i); assert.deepEqual(f.e.doc.adrFiles, [conflict]); assert.equal(await readFile(join(f.root, p.path), 'utf8'), p.content);
});

test('ADR association history-finalization failure reports the durable record and retry creates no duplicate', async t => {
  const f = await fixture(t), p = await f.prepare(), history = await f.e.history(f.journey); let manifests = 0;
  history.write = async (path, bytes) => { if (path.endsWith('manifest.json') && ++manifests === 2) throw Error('Injected final history failure'); await atomicWrite(path, bytes); };
  const result = await f.save(p); assert.equal(result.recovery.phase, 'completion-pending'); assert.equal(result.recovery.canReconcile, true); assert.match(result.error, /history|final/i); assert.equal(f.e.doc.adrFiles.length, 1);
  const revision = f.e.doc.revision; history.write = atomicWrite;
  const retry = await f.request({ action: 'reconcile', operationId: result.recovery.id, revision }); assert.equal(retry.recovery.phase, 'complete'); assert.equal(f.e.doc.revision, revision); assert.equal(f.e.doc.adrFiles.length, 1);
});

test('ADR preview cleared during an awaited destination read cannot deliver a valid token', async t => {
  const f = await fixture(t), store = await f.e.adrWriter.storage(f.e), capture = store.capture.bind(store);
  store.capture = async (...args) => { const value = await capture(...args); f.e.adrWriter.clear(); return value; };
  await assert.rejects(f.prepare(), /obsolete/i); assert.equal(f.e.adrWriter.current, null); assert.deepEqual(await readdir(f.root), []);
});

test('shared ADR write stores only portable references and ordinary Markdown while recovery remains private', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'adr-shared-write-')), root = join(directory, 'project'), local = join(directory, 'private'); await mkdir(root); await mkdir(local);
  await promisify(execFile)('git', ['init', '--quiet', root], { windowsHide: true });
  const relativePath = '.explorer/journeys/shared.explore.json', file = join(root, relativePath); await mkdir(join(root, '.explorer/journeys'), { recursive: true });
  const doc = adrFileDocument(), context = { ...await projectStorageContext({ checkoutDirectory: root, file, localDirectory: local, journeyId: doc.id }), relativePath };
  const project = new ProjectJourney(context); await project.create(doc);
  const e = new Explorer({ library: new Library(local), binding: 'shared-adr', projectRoot: async () => root }); await e.attachProject(project);
  t.after(async () => { await e.close(); await rm(directory, { recursive: true, force: true }); });
  await e.save(saveAdrFixture(structuredClone(e.doc), (await e.scenarioPolicy()).label)); const journey = e.activeKey;
  const p = await e.adrFileRequest({ action: 'prepare', journey, clientId: randomUUID(), sequence: 1, selection: { kind: 'new', number: 1 } });
  const result = await e.adrFileRequest({ action: 'save', journey, token: p.token, revision: e.doc.revision }); assert.equal(result.recovery.phase, 'complete');
  const shared = readSharedDocument(await readFile(file)).document; assert.deepEqual(shared.journey.adrFiles, e.doc.adrFiles);
  assert.ok(!JSON.stringify(shared).includes(JSON.stringify(root).slice(1, -1))); assert.ok(!JSON.stringify(shared).includes('intent.json'));
  assert.equal(await readFile(join(root, p.path), 'utf8'), p.content); const fresh = join(directory, 'fresh-clone'); await mkdir(fresh); await writeFile(join(fresh, 'decision.md'), await readFile(join(root, p.path)));
  assert.equal(await readFile(join(fresh, 'decision.md'), 'utf8'), p.content); assert.deepEqual(await readdir(fresh), ['decision.md']);
});
