import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createDocument, MAX_DOCUMENT_BYTES } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-library-'));
  t.after(async () => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  const library = new Library(dir);
  const explorer = async binding => {
    const value = await new Explorer({ library, binding, send: async () => {}, target: { instanceId: binding } }).load();
    t.after(() => value.close()); return value;
  };
  return { dir, library, explorer };
}

test('metadata replacement retries transient sharing denial without publishing a partial revision', async t => {
  const { dir, library } = await fixture(t), file = join(dir, 'library.json');
  const before = { version: 1, revision: 3, entries: {}, bindings: {} };
  await writeFile(file, JSON.stringify(before)); let attempts = 0;
  await library.locked(() => library.writeMetadata(structuredClone(before), async (path, content) => {
    attempts++; assert.equal(await readFile(file, 'utf8'), JSON.stringify(before));
    if (attempts < 3) throw Object.assign(Error('sharing denial'), { code: 'EPERM', syscall: 'rename' });
    await atomicWrite(path, content);
  }));
  assert.equal(attempts, 3); assert.equal((await library.metadata()).revision, 4);
});

test('metadata retry rejects an external replacement or a stale revision and preserves the newer bytes', async t => {
  const { dir, library } = await fixture(t), file = join(dir, 'library.json');
  const before = { version: 1, revision: 3, entries: {}, bindings: {} }, newer = JSON.stringify({ ...before, revision: 4 });
  await writeFile(file, JSON.stringify(before)); let attempts = 0;
  await assert.rejects(library.locked(() => library.writeMetadata(structuredClone(before), async () => {
    attempts++; await writeFile(file, newer); throw Object.assign(Error('sharing denial'), { code: 'EPERM', syscall: 'rename' });
  })), /metadata/);
  assert.equal(attempts, 1); assert.equal(await readFile(file, 'utf8'), newer);
  await assert.rejects(library.locked(() => library.writeMetadata(structuredClone(before))), /metadata/);
  assert.equal(await readFile(file, 'utf8'), newer);
});

test('metadata replacement bounds sharing retries and does not retry unrelated I/O errors', async t => {
  const { dir, library } = await fixture(t), file = join(dir, 'library.json');
  const before = { version: 1, revision: 3, entries: {}, bindings: {} }, raw = JSON.stringify(before); await writeFile(file, raw);
  for (const [code, expected] of [['EPERM', 4], ['ENOSPC', 1]]) {
    let attempts = 0;
    await assert.rejects(library.locked(() => library.writeMetadata(structuredClone(before), async () => {
      attempts++; throw Object.assign(Error('write rejected'), { code, syscall: 'rename' });
    })), /metadata/);
    assert.equal(attempts, expected); assert.equal(await readFile(file, 'utf8'), raw);
  }
});
test('legacy files are discovered intact; corrupt, oversized and symlink entries do not hide good maps', async t => {
  const { dir, library } = await fixture(t), doc = createDocument('Legacy 🌿');
  const raw = JSON.stringify(doc); await writeFile(join(dir, 'legacy.explore.json'), raw);
  await writeFile(join(dir, 'bad.explore.json'), '{');
  await writeFile(join(dir, 'huge.explore.json'), ' '.repeat(MAX_DOCUMENT_BYTES + 1));
  const listing = await library.list();
  assert.equal(listing.entries.length, 1); assert.equal(listing.errors.length, 2);
  assert.equal(listing.entries[0].topic, doc.topic);
  const entry = await library.resolve(listing.entries[0].key);
  assert.equal(entry.file, join(dir, 'legacy.explore.json')); assert.deepEqual(entry.document, doc);
  assert.equal(await readFile(entry.file, 'utf8'), raw);
  assert.ok(!JSON.stringify(listing).includes(dir));
  for (const key of ['../legacy.explore.json', '/etc/passwd', 'x', 'a'.repeat(64)]) await assert.rejects(library.resolve(key), /entry|key/i);
  await writeFile(entry.file, JSON.stringify({ ...doc, id: 'replaced' }));
  await assert.rejects(library.resolve(listing.entries[0].key), /entry/i);
  await rm(entry.file); await assert.rejects(library.resolve(listing.entries[0].key), /entry/i);
  try { await symlink(join(dir, 'bad.explore.json'), join(dir, 'link.explore.json')); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('Windows does not permit file symlinks in this fixture.'); return; } throw error; }
  assert.ok((await library.list()).errors.some(e => /link|symbolic/i.test(e.message)));
});
test('new maps and cross-canvas opens preserve identity and reject stale simultaneous writers', async t => {
  const { library, explorer } = await fixture(t), a = await explorer('a'), b = await explorer('b');
  assert.equal(a.doc, null);
  await a.command('start', { topic: 'First' }); await a.command('cancel');
  const first = structuredClone(a.doc), key = a.activeKey, file = a.file;
  await a.command('start', { revision: a.doc.revision, topic: 'Second' }); await a.command('cancel');
  assert.equal((await library.list()).entries.length, 2); assert.notEqual(a.file, file);
  await b.command('open', { key }); assert.deepEqual(b.doc, first); assert.equal(b.file, file);
  await a.command('open', { revision: a.doc.revision, key });
  await a.command('add', { revision: a.doc.revision, nodeId: a.doc.rootId, category: 'One', question: 'Saved first?' });
  await assert.rejects(b.command('add', { revision: b.doc.revision, nodeId: b.doc.rootId, category: 'Two', question: 'Stale?' }), /Another canvas/);
  assert.equal((await explorer('a')).file, file);
  assert.equal((await explorer('fresh')).doc, null);
  assert.ok(!JSON.stringify(a.snapshot()).includes('Second'));
});
test('metadata pin/archive/search/recent are separate, durable and revision checked', async t => {
  const { library, explorer, dir } = await fixture(t), a = await explorer('a');
  await a.command('start', { topic: 'Garden 🌿' }); await a.command('cancel');
  const key = a.activeKey, raw = await readFile(a.file, 'utf8');
  const before = await library.list();
  await library.update(key, { pinned: true, archived: true }, before.revision);
  assert.equal((await library.list()).entries.length, 0);
  const archived = await library.list({ archived: true, search: 'GARDEN' });
  assert.equal(archived.entries[0].pinned, true); assert.ok(archived.entries[0].lastOpenedAt);
  assert.equal((await library.list({ archived: true, search: 'absent' })).entries.length, 0);
  await assert.rejects(library.update(key, { archived: false }, before.revision), /changed/);
  await library.update(key, { archived: false }, archived.revision);
  assert.equal(await readFile(a.file, 'utf8'), raw);
  assert.ok((await readFile(join(dir, 'library.json'), 'utf8')).includes(key));
});
test('identical imports reopen; divergent IDs require an explicit copy and preserve originals', async t => {
  const { library, explorer, dir } = await fixture(t), a = await explorer('a');
  const original = createDocument('Imported'), imported = await a.command('import', { document: original });
  const file = a.file, raw = await readFile(file, 'utf8');
  await a.command('import', { revision: a.doc.revision, document: original });
  assert.equal(a.file, file); assert.equal((await library.list()).entries.length, 1);
  const divergent = structuredClone(original); divergent.nodes[0].answer = 'Different'; divergent.finishedAt = original.createdAt;
  const conflict = await a.command('import', { revision: a.doc.revision, document: divergent });
  assert.equal(conflict.importConflict.entries.length, 1); assert.deepEqual(a.doc, imported.document);
  await a.command('import', { revision: a.doc.revision, document: divergent, asCopy: true });
  assert.notEqual(a.doc.id, original.id); assert.equal(a.doc.nodes[0].answer, 'Different');
  assert.equal(a.doc.finishedAt, null, 'a new copy starts an unfinished journey');
  assert.equal(await readFile(file, 'utf8'), raw);
  await writeFile(join(dir, 'duplicate.explore.json'), JSON.stringify(divergent));
  const entries = (await library.list()).entries.filter(e => e.id === original.id);
  assert.equal(entries.length, 2); assert.ok(entries.every(e => e.ambiguous));
  const again = await a.command('import', { revision: a.doc.revision, document: original });
  assert.equal(again.importConflict.entries.length, 2, 'legacy divergent duplicate requires an explicit selection');
});
test('known entry resolution revalidates its file without rescanning unrelated journeys', async t => {
  const { library } = await fixture(t);
  const first = await library.import(createDocument('First'));
  await library.import(createDocument('Other'));
  await library.list();
  const scan = library.scan.bind(library); let scans = 0;
  library.scan = async () => { scans++; return scan(); };
  const record = await library.resolve(first.key);
  assert.equal(scans, 0, 'resolving a known entry must only read that document');
  record.document.nodes[0].answer = 'Updated externally';
  await writeFile(record.file, JSON.stringify(record.document));
  assert.equal((await library.resolve(first.key)).document.nodes[0].answer, 'Updated externally');
});
test('concurrent metadata writers merge opens and reject conflicting edits without losing either binding', async t => {
  const { library, explorer } = await fixture(t), a = await explorer('a');
  await a.command('import', { document: createDocument('Shared') });
  const other = new library.constructor(library.directory);
  await Promise.all([library.opened(a.activeKey, 'one'), other.opened(a.activeKey, 'two')]);
  assert.equal((await library.bound('one')).key, a.activeKey); assert.equal((await other.bound('two')).key, a.activeKey);
  const listing = await library.list();
  const results = await Promise.allSettled([library.update(a.activeKey, { pinned: true }, listing.revision), other.update(a.activeKey, { archived: true }, listing.revision)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /changed/);
});
test('a directory junction is rejected and corrupt metadata preserves readable journeys', async t => {
  const { library, dir } = await fixture(t);
  const saved = await library.import(createDocument('Intact'));
  await symlink(dir, join(dir, 'junction.explore.json'), 'junction');
  assert.match((await library.list()).errors[0].message, /links/);
  await writeFile(join(dir, 'library.json'), '{broken');
  const list = await library.list(); assert.equal(list.entries.length, 1); assert.ok(list.errors.length >= 2);
  await assert.rejects(library.opened(saved.key, 'one'), /metadata/);
  assert.equal(await readFile(join(dir, 'library.json'), 'utf8'), '{broken');
  assert.equal((await library.resolve(saved.key)).document.topic, 'Intact');
});
test('library summaries never accept extra metadata fields as document identity or paths', async t => {
  const { library, explorer, dir } = await fixture(t), a = await explorer('one');
  await a.command('import', { document: createDocument('Real topic') });
  const path = join(dir, 'library.json'), metadata = JSON.parse(await readFile(path, 'utf8'));
  metadata.entries[a.activeKey].file = dir; metadata.entries[a.activeKey].key = '../escape'; metadata.entries[a.activeKey].topic = 'Forged';
  await writeFile(path, JSON.stringify(metadata));
  const entry = (await library.list()).entries[0];
  assert.equal(entry.key, a.activeKey); assert.equal(entry.topic, 'Real topic'); assert.equal(entry.file, undefined);
});
test('pending requests block switching and late callbacks cannot reach a newly opened journey', async t => {
  const { explorer } = await fixture(t), a = await explorer('a');
  await a.command('start', { topic: 'First' }); const id = a.pending.id;
  await assert.rejects(a.command('start', { revision: a.doc.revision, topic: 'Second' }), /cancel/);
  await a.command('cancel'); await a.command('start', { revision: a.doc.revision, topic: 'Second' });
  await assert.rejects(a.receive('questions', { requestId: id, questions: [{ category: 'Old', question: 'Stale?' }] }), /cancelled/);
  assert.equal(a.doc.nodes.length, 1);
});
test('library HTTP is separate from snapshots, validates metadata mutations and keeps saved maps', async t => {
  const { explorer } = await fixture(t), a = await explorer('a');
  const server = await startServer(a, { close() {} }); t.after(() => server.close());
  const post = (action, input = {}) => fetch(server.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin }, body: JSON.stringify({ action, revision: a.doc?.revision, ...input }) });
  assert.equal((await fetch(server.url + 'api/library')).status, 200);
  await post('import', { document: createDocument('HTTP journey') });
  const listing = await (await fetch(server.url + 'api/library')).json();
  assert.equal(listing.entries.length, 1);
  assert.equal((await post('library-update', { key: listing.entries[0].key, metadataRevision: listing.revision, patch: { pinned: true } })).status, 200);
  assert.equal((await post('library-update', { key: listing.entries[0].key, metadataRevision: listing.revision, patch: { archived: true } })).status, 400);
  assert.equal(a.snapshot().library, true); assert.equal(a.snapshot().entries, undefined);
});
