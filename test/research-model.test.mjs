import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, link, rename, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { ResearchModelSettings } from '../com.github.copilot/extensions/explorer/research-model-settings.mjs';
import { researchModelCatalog, captureResearchModel, sameResearchModel } from '../com.github.copilot/extensions/explorer/research-model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { randomUUID } from 'node:crypto';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-research-model-'));
  const remove = async path => { assert.equal(dirname(resolve(path)), resolve(tmpdir())); await rm(path, { recursive: true, force: true }); };
  t.after(() => remove(directory));
  return { directory, remove, file: join(directory, 'research-model-settings.json'), store: new ResearchModelSettings({ directory }) };
}
const auth = { isAuthenticated: true, login: 'Fixture', host: 'github.com' };
const catalog = [{ id: 'model-a', name: 'Model A', provider: { kind: 'copilot' } }, { id: 'model-b', name: 'Model B', provider: { kind: 'copilot' }, policy: { state: 'enabled' } }];
const metadata = () => researchModelCatalog({ list: catalog }, { modelId: 'model-a' }, auth);

test('Research model preference defaults without writes and persists explicit choice/reset with revisions', async t => {
  const { store, directory, file } = await fixture(t);
  assert.deepEqual(await store.read(), { version: 1, revision: 0, modelId: null }); assert.deepEqual(await readdir(directory), []);
  const first = await store.save('model-a', 0);
  assert.deepEqual(first, { version: 1, revision: 1, modelId: 'model-a' });
  assert.deepEqual(await new ResearchModelSettings({ directory }).read(), first);
  assert.deepEqual(await store.save('model-a', 1), first);
  await assert.rejects(store.save('model-b', 0), /another canvas/);
  assert.deepEqual(await store.save(null, 1), { version: 1, revision: 2, modelId: null });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), await store.read());
  for (const value of ['', ' x', 'a\nb', 'https://private', 'x'.repeat(129), {}, 3, '\ud800']) await assert.rejects(store.save(value, 2), /model/i);
  for (const revision of [-1, '2', NaN, Number.MAX_SAFE_INTEGER]) await assert.rejects(store.save('model-a', revision), /revision/);
});

test('Research model preference preserves corrupt, duplicate, extra, oversized and invalid UTF-8 files', async t => {
  const { file, store } = await fixture(t);
  for (const content of ['{bad', ' '.repeat(4097), '{"version":1,"revision":0,"modelId":null,"modelId":null}', '{"version":1,"revision":0,"modelId":null,"account":"private"}', '{"version":1,"revision":0,"modelId":""}', Buffer.from([255, 254])]) {
    await writeFile(file, content); const original = await readFile(file);
    await assert.rejects(store.read(), /preserved/); await assert.rejects(store.save(null, 0), /preserved/);
    assert.deepEqual(await readFile(file), original);
  }
});

test('Research model preference rejects linked files and replaced roots without overwriting either', async t => {
  const { file, directory, store, remove } = await fixture(t), original = await store.save('model-a', 0), target = join(directory, 'original.json');
  await rename(file, target); await link(target, file);
  await assert.rejects(store.read(), /preserved/); await assert.rejects(store.save(null, 1), /preserved/);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), original); await rm(file);
  const moved = directory + '-moved'; t.after(() => remove(moved)); await rename(directory, moved); await mkdir(directory);
  await assert.rejects(store.read(), /preserved/); await assert.rejects(store.save('model-b', 1), /preserved/);
  assert.deepEqual(await readdir(directory), []);
});

test('Research model writers conflict and failed writes retain the prior choice', async t => {
  const { store, directory } = await fixture(t), other = new ResearchModelSettings({ directory });
  const writes = await Promise.allSettled([store.save('model-a', 0), other.save('model-b', 0)]);
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(writes.filter(r => r.status === 'rejected').length, 1);
  const before = await store.read(), failing = new ResearchModelSettings({ directory, write: async () => { throw Error('disk full'); } });
  await assert.rejects(failing.save('model-c', 1), /disk full/); assert.deepEqual(await other.read(), before);
});

test('Research catalog is bounded, literal, eligible and excludes account metadata from public model entries', () => {
  const value = researchModelCatalog({ list: [...catalog, { ...catalog[0], id: 'denied', policy: { state: 'disabled' } }, { ...catalog[0], id: 'external', provider: { kind: 'custom' } }, { ...catalog[0], id: 'policy', policy: { state: 'unconfigured' } }] }, { modelId: 'model-a' }, auth);
  assert.deepEqual(value.models, [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }]);
  assert.equal(value.selectedId, 'model-a'); assert.equal(value.account.login, 'fixture');
  assert.equal(researchModelCatalog({ list: [{ ...catalog[0], name: '<b>Literal 🌿</b>' }] }, null, auth).models[0].name, '<b>Literal 🌿</b>');
  for (const models of [[...catalog, catalog[0]], Array(501).fill(catalog[0]), [{ ...catalog[0], id: 'https://private' }], null]) assert.throws(() => researchModelCatalog({ list: models }, null, auth), /catalog/i);
  assert.throws(() => researchModelCatalog({ list: catalog }, null, { isAuthenticated: false }), /Sign in/);
});

test('Research captures relevant selection and revision, preserving unavailable dedicated choices', () => {
  const first = captureResearchModel(metadata(), { revision: 0, modelId: null });
  assert.equal(first.mode, 'chat'); assert.equal(first.model.id, 'model-a');
  const dedicated = captureResearchModel(metadata(), { revision: 1, modelId: 'model-b' });
  assert.equal(dedicated.mode, 'dedicated'); assert.equal(dedicated.model.id, 'model-b');
  assert.ok(sameResearchModel(dedicated, captureResearchModel({ ...metadata(), selectedId: null }, { revision: 1, modelId: 'model-b' })));
  for (const changed of [{ ...dedicated, revision: 3 }, { ...dedicated, mode: 'chat' }, { ...dedicated, account: { ...dedicated.account, login: 'other' } }, { ...dedicated, model: { id: 'model-a' } }]) assert.equal(sameResearchModel(dedicated, changed), false);
  assert.ok(sameResearchModel(dedicated, { ...dedicated, model: { ...dedicated.model, name: 'Renamed' } }));
  const saved = { revision: 2, modelId: 'removed' }; assert.throws(() => captureResearchModel(metadata(), saved), /unavailable.*Research model/i); assert.equal(saved.modelId, 'removed');
  assert.throws(() => captureResearchModel({ ...metadata(), selectedId: null }, { revision: 0, modelId: null }), /selected chat model/i);
});

async function controllerFixture(t) {
  const f = await fixture(t), library = new Library(f.directory), doc = createDocument('Private model setting');
  addQuestions(doc, doc.rootId, [{ question: 'What?', category: 'Target' }]);
  const entry = await library.import(doc), runs = [], host = { value: metadata() };
  const e = await new Explorer({ library, binding: 'model-fixture', researcher: { models: async () => { if (host.read) return host.read(); return host.value; }, run(context, options) { runs.push({ context, ...options }); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('Cancelled')))); } } }).load();
  await e.attach(entry.key); t.after(() => e.close());
  let sequence = 0; const clientId = randomUUID();
  const review = () => e.reviewResearch({ action: 'prepare', journey: entry.key, nodeId: e.doc.nodes[1].id, scope: 'decisions', excluded: [], clientId, sequence: ++sequence });
  const start = value => e.command('research', { journey: entry.key, nodeId: e.doc.nodes[1].id, token: value.token });
  return { ...f, e, runs, host, review, start };
}

test('Research model HTTP is bounded/private, validates catalog choices and allows explicit reset during catalog failure', async t => {
  const f = await controllerFixture(t), server = await startServer(f.e); t.after(() => server.close());
  const origin = new URL(server.url).origin, post = (value, headers = {}) => fetch(server.url + 'api/research-model-settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-explorer-client': '1', origin, ...headers }, body: JSON.stringify(value) });
  assert.equal((await post({ action: 'read' }, { origin: 'https://example.test' })).status, 403);
  const read = await (await post({ action: 'read' })).json();
  assert.equal(read.available, true); assert.equal(read.settings.modelId, null); assert.equal(read.effective.id, 'model-a'); assert.equal(JSON.stringify(read).includes('fixture'), false);
  assert.equal((await post({ action: 'save', revision: 0, modelId: 'missing' })).status, 400);
  const saved = await (await post({ action: 'save', revision: 0, modelId: 'model-b' })).json(); assert.equal(saved.settings.modelId, 'model-b');
  f.host.value = { ...metadata(), models: [] };
  const unavailable = await (await post({ action: 'read' })).json(); assert.equal(unavailable.settings.modelId, 'model-b'); assert.equal(unavailable.effective, null); assert.match(unavailable.problem, /unavailable/);
  f.host.read = async () => { throw Error('PRIVATE-ERROR'); };
  const failed = await (await post({ action: 'read' })).json(); assert.equal(failed.settings.modelId, 'model-b'); assert.equal(JSON.stringify(failed).includes('PRIVATE-ERROR'), false);
  const reset = await (await post({ action: 'save', revision: 1, modelId: null })).json(); assert.equal(reset.settings.modelId, null);
  for (const value of [{ action: 'read', account: 'forged' }, { action: 'save', revision: 2, modelId: 'x'.repeat(5000) }, { action: 'save', revision: 2, modelId: null, models: [] }]) assert.equal((await post(value)).status, 400);
  assert.equal(f.runs.length, 0); assert.equal(JSON.stringify(f.e.uiSnapshot()).includes('model-b'), false); assert.equal(JSON.stringify(f.e.doc).includes('model-a'), false);
});

test('Research review rejects changed chat models, account and preference revisions before start', async t => {
  const f = await controllerFixture(t), initial = await f.review();
  assert.deepEqual(initial.prepared.model, { mode: 'chat', id: 'model-a', name: 'Model A' });
  assert.equal(JSON.stringify(initial).includes('"login"'), false); assert.equal(initial.prepared.prompt.includes('model-a'), false);
  f.host.value = { ...metadata(), selectedId: 'model-b' };
  await assert.rejects(f.start(initial), /model.*changed/i); assert.equal(f.runs.length, 0);
  f.host.value = metadata(); const beforePreference = await f.review();
  await f.store.save('model-b', 0); await f.store.save(null, 1);
  await assert.rejects(f.start(beforePreference), /model.*changed/i); assert.equal(f.runs.length, 0);
  const beforeAccount = await f.review(); f.host.value = { ...metadata(), account: { ...auth, login: 'other' } };
  await assert.rejects(f.start(beforeAccount), /model.*changed/i); assert.equal(f.runs.length, 0);
});

test('accepted dedicated Research remains pinned while queued and after preferences change', async t => {
  const f = await controllerFixture(t); await f.store.save('model-b', 0);
  const reviewed = await f.review(); assert.equal(reviewed.prepared.model.mode, 'dedicated');
  f.host.value = { ...metadata(), selectedId: null };
  let release; f.e.researchTask = new Promise(resolve => { release = resolve; });
  try { await f.start(reviewed); await f.store.save(null, 1); assert.equal(f.runs.length, 0); } finally { release(); }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.runs.length, 1); assert.equal(f.runs[0].prepared.modelCapture.model.id, 'model-b');
  assert.equal(f.runs[0].prepared.modelCapture.revision, 1); await f.e.command('cancel');
});

test('metadata discovery rejects a preference edit while review is being prepared', async t => {
  const f = await controllerFixture(t); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  f.host.read = () => new Promise(resolve => { release = () => resolve(metadata()); entered(); });
  const reviewing = f.review(); await ready; await f.store.save('model-b', 0); release();
  await assert.rejects(reviewing, /settings changed/i); assert.equal(f.e.researchReview.current, null); assert.equal(f.runs.length, 0);
});
