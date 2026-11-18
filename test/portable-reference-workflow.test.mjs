import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { createPortableReference, formatPortableReference, parsePortableReference } from '../com.github.copilot/extensions/explorer/portable-reference.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

const exec = promisify(execFile), binding = e => ({ journey: e.activeKey ?? e.doc?.id ?? null, revision: e.doc?.revision ?? null });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-portable-reference-')), writers = [];
  t.after(async () => { for (const e of writers) await e.close(); await rm(root, { recursive: true, force: true }); });
  const a = join(root, 'original'), b = join(root, 'different-clone');
  for (const dir of [a, b]) { await mkdir(dir); await exec('git', ['-C', dir, 'init', '-q'], { windowsHide: true }); }
  const doc = createDocument('Portable shared journey'); addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Choice' }]);
  doc.nodes[1].answer = 'SAVED_ANSWER_CANARY';
  const repository = new ProjectRepository({ readRoot: async () => a, localDirectory: join(root, 'private-a') }), store = await repository.create(doc);
  const path = store.context.relativePath, file = join(b, ...path.split('/')); await mkdir(dirname(file), { recursive: true }); await copyFile(store.context.file, file);
  let cwd = b, sends = 0;
  const first = await new Explorer({ library: new Library(join(root, 'private-a')), binding: 'SECRET_BINDING_A', projectRoot: async () => a, send() { sends++; } }).load(); await first.attachProject(store); writers.push(first);
  const second = await new Explorer({ library: new Library(join(root, 'private-b')), binding: 'SECRET_BINDING_B', projectRoot: async () => cwd, send() { sends++; } }).load(); writers.push(second);
  const reference = createPortableReference(doc, path, doc.nodes[1].id), text = formatPortableReference(reference);
  return { root, a, b, doc, first, second, path, file, text, reference, sends: () => sends, cwd: value => { cwd = value; }, inspect: (e = second, value = text) => e.portableReferenceRequest({ action: 'inspect', ...binding(e), text: value }), open: (preview, e = second, acknowledged = false) => e.command('open-reference', { ...binding(e), id: preview.id, acknowledged }) };
}

test('a copied portable reference opens the exact saved target in a different checkout and fresh canvas without a model or shared write', async t => {
  const f = await fixture(t), before = await readFile(f.file), result = await f.first.portableReferenceRequest({ action: 'copy', ...binding(f.first), nodeId: f.doc.nodes[1].id });
  assert.deepEqual(parsePortableReference(result.text), f.reference); assert.doesNotMatch(result.text, /SECRET_|CANARY/); assert.ok(!result.text.includes(f.root));
  const preview = await f.inspect(f.second, result.text); assert.equal(f.second.doc, null); assert.equal(preview.status, 'current'); assert.equal(preview.path, f.path); assert.equal(preview.question, 'Which option?');
  assert.ok(!JSON.stringify(preview).includes(f.root)); assert.doesNotMatch(JSON.stringify(preview), /SECRET_|CANARY/);
  const opened = await f.open(preview); assert.equal(opened.document.id, f.doc.id); assert.equal(opened.referenceNodeId, f.doc.nodes[1].id);
  assert.equal(opened.storage.path, f.path); assert.deepEqual(await readFile(f.file), before); assert.equal(f.sends(), 0);
});

test('reference navigation preserves the previous journey and private draft and requires current view and no pending work', async t => {
  const f = await fixture(t), e = f.second, personal = createDocument('Personal work'); addQuestions(personal, personal.rootId, [{ question: 'Current?', category: 'Choice' }]);
  const record = await e.library.import(personal); await e.attach(record.key); const node = e.doc.nodes[1], old = binding(e);
  await e.writeDraft({ journey: e.activeKey, nodeId: node.id, base: node, text: 'PRIVATE_DRAFT_CANARY', revision: 0 });
  const preview = await f.inspect();
  for (const work of ['pending', 'preview']) {
    e[work] = { id: 'active', kind: 'questions' }; await assert.rejects(f.open(preview), /pending|preview|finish|work/i); e[work] = null; assert.equal(e.doc.id, personal.id);
  }
  await assert.rejects(e.command('open-reference', { ...old, revision: old.revision + 1, id: preview.id, acknowledged: false }), /changed|current|selection/i);
  await f.open(preview); await e.command('open', { revision: e.doc.revision, key: record.key });
  assert.equal((await e.readDrafts(e.activeKey)).entries[0].text, 'PRIVATE_DRAFT_CANARY'); assert.equal(e.doc.nodes[1].answer, ''); assert.equal(f.sends(), 0);
  await assert.rejects(e.portableReferenceRequest({ action: 'copy', ...binding(e), nodeId: node.id }), /Project|shared/i);
});

test('changed saved targets require acknowledgement and absent fingerprints remain visibly unchecked', async t => {
  const f = await fixture(t), raw = JSON.parse(await readFile(f.file)); raw.journey.nodes[1].answer = 'Changed saved answer'; await writeFile(f.file, JSON.stringify(raw));
  const preview = await f.inspect(); assert.equal(preview.status, 'changed'); await assert.rejects(f.open(preview), /acknowledge|changed/i); assert.equal(f.second.doc, null);
  const opened = await f.open(preview, f.second, true); assert.equal(opened.document.nodes[1].answer, 'Changed saved answer');
  const unchecked = { ...f.reference }; delete unchecked.fingerprint;
  const next = await f.inspect(f.second, JSON.stringify(unchecked)); assert.equal(next.status, 'unchecked'); await f.open(next); assert.equal(f.sends(), 0);
});

test('moved files, different journeys, deleted nodes and invalid or linked files never attach a lookalike', async t => {
  const f = await fixture(t), original = await readFile(f.file), moved = f.file.replace('.explore.json', '-moved.explore.json');
  await rename(f.file, moved); await assert.rejects(f.inspect(), /missing|moved/i); await rename(moved, f.file);
  const raw = JSON.parse(original); raw.journey.id = 'different-journey'; await writeFile(f.file, JSON.stringify(raw)); await assert.rejects(f.inspect(), /different.*journey|identity/i);
  raw.journey.id = f.doc.id; raw.journey.nodes[1].id = 'same-question-different-node'; await writeFile(f.file, JSON.stringify(raw)); await assert.rejects(f.inspect(), /missing|removed|target/i);
  await writeFile(f.file, '{'); await assert.rejects(f.inspect(), /malformed|unavailable/i);
  await writeFile(f.file, original); const outside = join(f.root, 'outside'); await mkdir(outside); await copyFile(f.file, join(outside, 'map.explore.json')); await symlink(outside, join(f.b, 'linked'), 'junction');
  await assert.rejects(f.inspect(f.second, JSON.stringify({ ...f.reference, path: 'linked/map.explore.json' })), /linked|unavailable/i);
  assert.equal(f.second.doc, null); assert.equal(f.sends(), 0);
});

test('inspection invalidates prior captures, strict malformed requests fail, and cancellation is selection-specific', async t => {
  const f = await fixture(t), e = f.second, first = await f.inspect(), next = await f.inspect();
  await assert.rejects(f.open(first), /expired|inspect|selection/i);
  await e.portableReferenceRequest({ action: 'cancel', ...binding(e), id: first.id }); await f.open(next);
  const last = await f.inspect(); await e.portableReferenceRequest({ action: 'cancel', ...binding(e), id: last.id }); await assert.rejects(f.open(last), /expired|inspect|selection/i);
  for (const input of [{ action: 'inspect', ...binding(e), text: f.text, command: 'extra' }, { action: 'inspect', ...binding(e), text: 'x'.repeat(8193) }, { action: 'inspect', ...binding(e), text: JSON.stringify({ ...f.reference, path: '../other.explore.json' }) }, { action: 'copy', ...binding(e), nodeId: 'missing' }, { action: 'inspect', text: f.text }]) await assert.rejects(e.portableReferenceRequest(input));
  const capture = await f.inspect(); await assert.rejects(e.command('open-reference', { ...binding(e), id: capture.id, acknowledged: 'yes' })); await assert.rejects(e.command('open-reference', { ...binding(e), id: capture.id, acknowledged: true, path: f.path }));
  const before = e.doc; await e.close(); await assert.rejects(f.open(capture), /closed|changed|unavailable|selection/i); assert.equal(e.doc, before);
});

test('target bytes and checkout changes between inspection and opening reject without replacing the current map', async t => {
  const f = await fixture(t), preview = await f.inspect(), before = await readFile(f.file); await writeFile(f.file, `${before}\n`);
  await assert.rejects(f.open(preview), /changed|inspect/i); assert.equal(f.second.doc, null);
  const current = await f.inspect(); f.cwd(f.a); await assert.rejects(f.open(current), /changed|checkout|inspect/i); assert.equal(f.second.doc, null);
  f.cwd(f.b); const last = await f.inspect(), originalOpen = f.second.projectRepository.openSelected.bind(f.second.projectRepository);
  f.second.projectRepository.openSelected = async selected => { await writeFile(f.file, `${await readFile(f.file)}\n`); return originalOpen(selected); };
  await assert.rejects(f.open(last), /changed|inspect/i); assert.equal(f.second.doc, null);
});

test('late closure or cancellation during asynchronous target validation prevents attachment', async t => {
  const f = await fixture(t), preview = await f.inspect(), originalOpen = f.second.projectRepository.openSelected.bind(f.second.projectRepository); let entered, release;
  const ready = new Promise(resolve => { entered = resolve; }), pause = new Promise(resolve => { release = resolve; });
  f.second.projectRepository.openSelected = async selected => { entered(); await pause; return originalOpen(selected); };
  const opening = f.open(preview); await ready; const closing = f.second.close(); release();
  await assert.rejects(opening, /closed|changed|expired|selection/i); await closing; assert.equal(f.second.doc, null);
});

test('a file edit during final checkout revalidation is detected before attachment', async t => {
  const f = await fixture(t), preview = await f.inspect(), originalOpen = f.second.projectRepository.openSelected.bind(f.second.projectRepository);
  f.second.projectRepository.openSelected = async selected => {
    const store = await originalOpen(selected), context = store.context;
    store.context = { ...context, assertCurrent: async () => { await context.assertCurrent(); await writeFile(f.file, `${await readFile(f.file)}\n`); } };
    return store;
  };
  await assert.rejects(f.open(preview), /changed|inspect/i); assert.equal(f.second.doc, null);
});

for (const change of ['target edit', 'checkout switch', 'canvas closure']) test(`${change} during attachment analytics flush keeps the previous map and storage`, async t => {
  const f = await fixture(t), e = f.second, personal = createDocument('Keep this map');
  addQuestions(personal, personal.rootId, [{ question: 'Keep my draft?', category: 'Choice' }]);
  const record = await e.library.import(personal); await e.attach(record.key);
  await e.writeDraft({ journey: e.activeKey, nodeId: e.doc.nodes[1].id, base: e.doc.nodes[1], text: 'PRIVATE_DRAFT_CANARY', revision: 0 });
  const preview = await f.inspect(), before = { doc: e.doc, file: e.file, key: e.activeKey, store: e.projectStore, drafts: e.draftStore };
  let flushed = false, closing;
  e.analytics = { async flush() {
    if (flushed) return; flushed = true;
    if (change === 'target edit') { const raw = JSON.parse(await readFile(f.file)); raw.journey.nodes[1].answer = 'Changed during attachment'; await writeFile(f.file, JSON.stringify(raw)); }
    if (change === 'checkout switch') f.cwd(f.a);
    if (change === 'canvas closure') closing = e.close();
  } };
  await assert.rejects(f.open(preview), /changed|inspect|closed|expired|selection/i); await closing;
  assert.equal(flushed, true); assert.equal(e.doc, before.doc); assert.equal(e.file, before.file); assert.equal(e.activeKey, before.key);
  assert.equal(e.projectStore, before.store); assert.equal(e.draftStore, before.drafts);
  assert.equal((await e.readDrafts(e.activeKey)).entries[0].text, 'PRIVATE_DRAFT_CANARY'); assert.equal(f.sends(), 0);
});

test('portable reference HTTP endpoints enforce origin, instance token, bounded inputs and strict open shape', async t => {
  const f = await fixture(t), server = await startServer(f.second); t.after(() => server.close()); const url = new URL(server.url), origin = url.origin;
  const post = (route, data, headers = {}) => fetch(new URL(route, server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...headers }, body: JSON.stringify(data) });
  const input = { action: 'inspect', ...binding(f.second), text: f.text };
  assert.equal((await post('api/portable-reference', input)).status, 403); assert.equal((await post('api/portable-reference', input, { Origin: 'https://wrong.test' })).status, 403);
  const unauthenticated = await fetch(`${origin}/api/portable-reference`, { method: 'POST', body: JSON.stringify(input) }); assert.equal(unauthenticated.status, 404);
  assert.equal((await post('api/portable-reference', { ...input, text: 'x'.repeat(24000) }, { Origin: origin })).status, 400);
  const response = await post('api/portable-reference', input, { Origin: origin }); assert.equal(response.status, 200); const preview = await response.json();
  const open = { action: 'open-reference', ...binding(f.second), id: preview.id, acknowledged: false };
  assert.equal((await post('api/action', open)).status, 403); assert.equal((await post('api/action', { ...open, path: f.path }, { Origin: origin })).status, 400);
  const opened = await post('api/action', open, { Origin: origin }); assert.equal(opened.status, 200); assert.equal((await opened.json()).referenceNodeId, f.doc.nodes[1].id); assert.equal(f.sends(), 0);
});
