import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, link, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { References } from '../com.github.copilot/extensions/explorer/references.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-references-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'map.json'), doc = createDocument('Idea');
  addQuestions(doc, doc.rootId, ['One', 'Two', 'Three', 'Four'].map(question => ({ category: 'Test', question })));
  await writeFile(file, JSON.stringify(doc));
  const explorer = await new Explorer({ file, send: async () => {} }).load();
  return { dir, file, doc, explorer, ids: doc.nodes.slice(1).map(n => n.id) };
}

test('reference store rejects unsafe records and preserves failed writes', async t => {
  const { dir } = await setup(t), store = new References(dir), key = 'a'.repeat(64);
  assert.deepEqual(await store.read(key), { version: 1, revision: 0, nodeIds: [] });
  assert.equal((await store.save(key, ['node-1'], 0)).revision, 1);
  await assert.rejects(store.save(key, ['node-2'], 0), /changed.*refresh/i);
  assert.deepEqual((await store.read(key)).nodeIds, ['node-1']);
  const path = store.path(key);
  await writeFile(path, JSON.stringify({ version: 1, revision: 1, nodeIds: ['node-1'], extra: 1 }));
  await assert.rejects(store.read(key), /preserved/i);
  await assert.rejects(store.save(key, ['node-2'], 1), /preserved/i);
  assert.match(await readFile(path, 'utf8'), /extra/);
  await writeFile(path, 'x'.repeat(4097));
  await assert.rejects(store.read(key), /preserved/i);
  await rm(path);
  try { await symlink(join(dir, 'map.json'), path); }
  catch (error) { if (error.code !== 'EPERM') throw error; await link(join(dir, 'map.json'), path); }
  await assert.rejects(store.read(key), /preserved/i);
});

test('controller reference pins use saved ordinary questions, revision checks and direct-file identity', async t => {
  const { dir, file, explorer, ids, doc } = await setup(t), journey = doc.id;
  const first = await explorer.readReferences(journey);
  assert.deepEqual(first.nodeIds, []);
  await assert.rejects(explorer.writeReferences({ journey, revision: 0, nodeIds: [doc.rootId] }), /question/i);
  await assert.rejects(explorer.writeReferences({ journey, revision: 0, nodeIds: ['missing'] }), /question/i);
  await assert.rejects(explorer.writeReferences({ journey, revision: 0, nodeIds: [ids[0], ids[0]] }), /reference/i);
  await assert.rejects(explorer.writeReferences({ journey, revision: 0, nodeIds: ids }), /reference/i);
  const saved = await explorer.writeReferences({ journey, revision: 0, nodeIds: ids.slice(0, 3) });
  assert.equal(saved.revision, 1);
  assert.equal(explorer.doc.revision, doc.revision);
  assert.equal(Object.hasOwn(explorer.snapshot(), 'references'), false);
  assert.equal(JSON.stringify(explorer.snapshot()).includes(ids[2]), true); // Nodes remain in the native map.
  assert.equal((await explorer.writeReferences({ journey, revision: 1, nodeIds: ids.slice(0, 3) })).revision, 1);
  await assert.rejects(explorer.writeReferences({ journey, revision: 0, nodeIds: [] }), /refresh/i);
  assert.deepEqual((await (await new Explorer({ file, send: async () => {} }).load()).readReferences(journey)).nodeIds, ids.slice(0, 3));
  const other = join(dir, 'other', 'map.json'); await mkdir(join(dir, 'other'));
  await writeFile(other, JSON.stringify(doc));
  assert.deepEqual((await (await new Explorer({ file: other, send: async () => {} }).load()).readReferences(journey)).nodeIds, []);
});

test('failed reference replacement preserves the last good record', async t => {
  const { dir } = await setup(t), key = 'b'.repeat(64), store = new References(dir);
  await store.save(key, ['first'], 0);
  const broken = new References(dir, async () => { throw new Error('Disk full'); });
  await assert.rejects(broken.save(key, ['second'], 1), /Disk full/);
  assert.deepEqual(await store.read(key), { version: 1, revision: 1, nodeIds: ['first'] });
});

test('removed source remains pinned and becomes available when the same ID returns', async t => {
  const { explorer, doc, ids } = await setup(t), journey = doc.id;
  await explorer.writeReferences({ journey, revision: 0, nodeIds: [ids[0]] });
  const removed = structuredClone(explorer.doc); removed.nodes = removed.nodes.filter(n => n.id !== ids[0]);
  await explorer.save(removed, 'Source removed');
  assert.deepEqual((await explorer.readReferences(journey)).nodeIds, [ids[0]]);
  const restored = structuredClone(doc); await explorer.save(restored, 'Source restored');
  assert.ok(explorer.doc.nodes.some(n => n.id === ids[0]));
  assert.deepEqual((await explorer.readReferences(journey)).nodeIds, [ids[0]]);
  await explorer.writeReferences({ journey, revision: 1, nodeIds: [] });
  assert.deepEqual((await explorer.readReferences(journey)).nodeIds, []);
});

test('same-ID divergent library entries isolate references', async t => {
  const { dir, doc, ids } = await setup(t), library = new Library(join(dir, 'library'));
  const divergent = structuredClone(doc); divergent.nodes[1].answer = 'Divergent';
  const first = await library.import(doc), copy = await library.import(divergent, { asCopy: true });
  const explorer = await new Explorer({ library, binding: 'refs', send: async () => {} }).load();
  await explorer.attach(first.key);
  await explorer.writeReferences({ journey: first.key, revision: 0, nodeIds: [ids[0]] });
  await explorer.attach(copy.key);
  assert.deepEqual((await explorer.readReferences(copy.key)).nodeIds, []);
  await explorer.attach(first.key);
  assert.deepEqual((await explorer.readReferences(first.key)).nodeIds, [ids[0]]);
});

test('private reference HTTP route enforces token, Origin, client and 1024-byte body', async t => {
  const { explorer, doc, ids } = await setup(t);
  const server = await startServer(explorer, { close() {} }); t.after(() => server.close());
  const origin = new URL(server.url).origin;
  const request = (value, headers = {}) => fetch(server.url + 'api/references', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Explorer-Client': '1', ...headers }, body: JSON.stringify(value) });
  assert.equal((await fetch(server.url + `api/references?journey=${doc.id}`)).status, 200);
  assert.equal((await request({ journey: doc.id, revision: 0, nodeIds: [ids[0]] }, { Origin: 'http://bad.invalid' })).status, 403);
  assert.equal((await request({ journey: doc.id, revision: 0, nodeIds: [ids[0]] }, { 'X-Explorer-Client': '0' })).status, 403);
  assert.equal((await request({ journey: doc.id, revision: 0, nodeIds: [ids[0]], padding: 'x'.repeat(1024) })).status, 400);
  assert.equal((await request({ journey: doc.id, revision: 0, nodeIds: [ids[0]] })).status, 200);
  assert.equal((await fetch(origin + '/api/references')).status, 404);
  const native = await fetch(server.url + 'export.json').then(r => r.text());
  assert.equal(native.includes('nodeIds'), false);
});
