import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, lstat, mkdir, link, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { StorageManagement } from '../com.github.copilot/extensions/explorer/storage-management.mjs';
import { acquireLock } from '../com.github.copilot/extensions/explorer/owned-lock.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';
import { Drafts, draftBase } from '../com.github.copilot/extensions/explorer/drafts.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-storage-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'map.explore.json');
  await writeFile(file, JSON.stringify(createDocument('Storage')));
  const explorer = await new Explorer({ file }).load(); t.after(() => explorer.close());
  for (let i = 0; i < 8; i++) await explorer.command('guidance', { revision: explorer.doc.revision, objective: `Revision ${i}`, successCriteria: '' });
  const key = await explorer.draftIdentity(explorer.doc.id);
  const record = { key, file, id: explorer.doc.id, topic: explorer.doc.topic };
  const store = new StorageManagement(directory, options);
  return { directory, file, explorer, key, record, store };
}

test('storage preview is read-only; explicit cleanup retains checkpoints, undo and all current files', async t => {
  const f = await fixture(t);
  await f.explorer.command('checkpoint', { revision: f.explorer.doc.revision, journey: f.explorer.doc.id, snapshotRevision: 0, name: 'Protected' });
  await writeFile(join(f.directory, 'drafts.json'), 'draft and tombstone evidence');
  await writeFile(join(f.directory, 'analytics.json'), 'protected local observation evidence');
  await mkdir(join(f.directory, 'usage')); await writeFile(join(f.directory, 'usage', 'recovery-unknown.json'), 'unreconciled');
  const before = await readFile(f.file, 'utf8'), manifestPath = join(f.directory, 'history', f.key, 'manifest.json');
  const manifest = await readFile(manifestPath, 'utf8');
  const preview = await f.store.preview([f.record], 5);
  assert.equal(preview.candidates.length, 2);
  assert.equal(await readFile(manifestPath, 'utf8'), manifest);
  const result = await f.store.clean(preview.id);
  assert.equal(result.results.filter(row => row.status === 'removed').length, 2);
  assert.equal(await readFile(f.file, 'utf8'), before);
  assert.equal(await readFile(join(f.directory, 'drafts.json'), 'utf8'), 'draft and tombstone evidence');
  assert.equal(await readFile(join(f.directory, 'analytics.json'), 'utf8'), 'protected local observation evidence');
  const after = await f.explorer.readHistory(f.explorer.doc.id);
  assert.ok(after.entries.some(row => row.checkpoints.includes('Protected')));
  assert.ok(after.entries.some(row => row.revision === after.undoRevision));
  assert.equal(after.entries.length, 6);
  await assert.rejects(f.store.clean('invented-preview'), /preview/i);
});

test('storage refuses changed candidates and concurrent writers without widening preview', async t => {
  const f = await fixture(t), preview = await f.store.preview([f.record], 5);
  const first = preview.candidates[0], path = join(f.directory, 'history', f.key, `${first.hash}.json`);
  const bytes = await readFile(path); await unlink(path); await writeFile(path, bytes);
  const lock = await acquireLock(f.file + '.lock');
  const blocked = await f.store.clean(preview.id); await lock.release();
  assert.equal(blocked.results.filter(row => row.status === 'removed').length, 0);
  const retry = await f.store.clean(preview.id);
  assert.equal(retry.results.find(row => row.hash === first.hash).status, 'ineligible');
  assert.equal((await lstat(path)).size, bytes.length);
});

test('storage partial unlink failures retain exact candidates for explicit retry', async t => {
  let fail = true;
  const f = await fixture(t, { remove: async path => { if (fail) { fail = false; throw Object.assign(new Error('access denied'), { code: 'EACCES' }); } await unlink(path); } });
  const preview = await f.store.preview([f.record], 5);
  const result = await f.store.clean(preview.id);
  assert.equal(result.results.filter(row => row.status === 'failed').length, 1);
  assert.equal(result.results.filter(row => row.status === 'removed').length, 2);
  const retry = await f.store.clean(preview.id);
  assert.equal(retry.results.filter(row => row.status === 'removed').length, 3);
  assert.deepEqual(retry.results.map(row => row.hash), preview.candidates.map(row => row.hash));
});

test('storage inventory accounts hardlink duplicates and refuses linked directories and unknown subtrees', async t => {
  const f = await fixture(t), outside = await mkdtemp(join(tmpdir(), 'explorer-outside-test-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret'), 'outside');
  await mkdir(join(f.directory, 'unknown')); await writeFile(join(f.directory, 'unknown', 'hidden'), 'not scanned');
  await writeFile(join(f.directory, 'unknown.bin'), '12345'); await link(join(f.directory, 'unknown.bin'), join(f.directory, 'alias.bin'));
  await symlink(outside, join(f.directory, 'references'), 'junction');
  const inventory = await f.store.inventory();
  assert.ok(inventory.partial); assert.equal(inventory.duplicateBytes, 5);
  assert.ok(inventory.issues.length >= 2);
  assert.equal(await readFile(join(outside, 'secret'), 'utf8'), 'outside');
  const preview = await f.store.preview([f.record], 5);
  const history = join(f.directory, 'history');
  // A changed ancestor invalidates every candidate before any deletion.
  const { rename } = await import('node:fs/promises');
  await rename(history, join(f.directory, 'saved-history')); await symlink(outside, history, 'junction');
  const result = await f.store.clean(preview.id);
  assert.equal(result.results.filter(row => row.status === 'removed').length, 0);
  assert.equal(await readFile(join(outside, 'secret'), 'utf8'), 'outside');
});

test('checkpoint, intent and unknown recovery claims added after preview prevent removal', async t => {
  for (const change of ['checkpoint', 'intent', 'claim', 'quarantine']) {
    const f = await fixture(t), preview = await f.store.preview([f.record], 5);
    const first = preview.candidates[0];
    if (change === 'checkpoint') await f.explorer.command('checkpoint', { revision: f.explorer.doc.revision, journey: f.explorer.doc.id, snapshotRevision: first.revision, name: 'New protection' });
    else await writeFile(change === 'intent' ? join(f.directory, 'history', f.key, 'intent.json') : f.file + (change === 'claim' ? '.lock.recover' : '.lock.abandoned'), 'unknown retained evidence');
    const result = await f.store.clean(preview.id);
    assert.equal(result.results.filter(row => row.status === 'removed').length, 0, change);
    assert.ok(await lstat(join(f.directory, 'history', f.key, `${first.hash}.json`)));
  }
});

test('manifest publication failure preserves snapshots and safely retries the captured set', async t => {
  let fail = true;
  const f = await fixture(t, { write: async (path, data) => { if (fail) throw new Error('disk full'); await atomicWrite(path, data); } });
  const preview = await f.store.preview([f.record], 5), manifest = join(f.directory, 'history', f.key, 'manifest.json'), before = await readFile(manifest, 'utf8');
  const result = await f.store.clean(preview.id);
  assert.equal(result.results.filter(row => row.status === 'failed').length, 3);
  assert.equal(await readFile(manifest, 'utf8'), before);
  fail = false;
  assert.equal((await f.store.clean(preview.id)).results.filter(row => row.status === 'removed').length, 3);
});

test('preview preferences have revisions and never weaken drafts or tombstone stale-write protection', async t => {
  const f = await fixture(t), drafts = new Drafts(f.directory), nodeId = f.explorer.doc.rootId;
  const input = { key: f.key, nodeId, base: draftBase({ question: 'Q', answer: '' }), text: 'old draft', revision: 0 };
  const saved = await drafts.update(input), cleared = await drafts.update({ ...input, text: null, revision: saved.revision });
  assert.equal((await f.store.settings()).settings.keepHistory, 50);
  await f.store.saveSettings(5, 0);
  await assert.rejects(f.store.saveSettings(10, 0), /changed/i);
  const preview = await f.store.preview([f.record], 5); await f.store.clean(preview.id);
  await assert.rejects(drafts.update({ ...input, revision: saved.revision }), /Another canvas/);
  assert.equal((await drafts.list(f.key))[0].revision, cleared.revision);
  await writeFile(join(f.directory, 'storage-settings.json'), '{damaged');
  assert.ok((await f.store.settings()).error);
  await assert.rejects(f.store.saveSettings(10, 0), /preserved/i);
  assert.equal(await readFile(join(f.directory, 'storage-settings.json'), 'utf8'), '{damaged');
});

test('storage HTTP validates origin/body, binds preview identity and exposes bounded inventory', async t => {
  const f = await fixture(t), server = await startServer(f.explorer, { close() {} }); t.after(() => server.close());
  const url = new URL('api/storage', server.url), headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: url.origin };
  const post = async (input, custom = headers) => fetch(url, { method: 'POST', headers: custom, body: JSON.stringify(input) });
  assert.equal((await post({ action: 'inspect' }, { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post({ action: 'clean', id: '../outside' })).status, 400);
  assert.equal((await post({ action: 'preview', keepHistory: 0 })).status, 400);
  assert.equal((await post({ action: 'inspect', unexpected: true })).status, 400);
  const inventory = await (await post({ action: 'inspect' })).json();
  assert.ok(inventory.inventory.categories.history.apparentBytes > inventory.inventory.manifestDeclaredHistoryBytes);
  assert.equal(inventory.inventory.journeyNames, undefined);
  const preview = await (await post({ action: 'preview', keepHistory: 5 })).json();
  assert.equal(preview.candidates.length, 3);
  assert.equal((await post({ action: 'clean', id: preview.id, candidates: [] })).status, 400);
  const result = await (await post({ action: 'clean', id: preview.id })).json();
  assert.equal(result.results.filter(row => row.status === 'removed').length, 3);
});

test('root replacement and malformed manifests stay protected with truthful partial totals', async t => {
  const f = await fixture(t), preview = await f.store.preview([f.record], 5);
  const { rename } = await import('node:fs/promises');
  const sibling = f.directory + '-replaced';
  t.after(() => rm(sibling, { recursive: true, force: true }));
  await rename(f.directory, sibling); await mkdir(f.directory);
  const result = await f.store.clean(preview.id);
  assert.equal(result.results.filter(row => row.status === 'removed').length, 0);
  assert.equal((await f.store.inventory()).apparentBytes, 0);
  await mkdir(join(f.directory, 'history', f.key), { recursive: true });
  await writeFile(join(f.directory, 'history', f.key, 'manifest.json'), '{invalid');
  const inventory = await f.store.inventory();
  assert.ok(inventory.partial); assert.equal(inventory.manifestDeclaredHistoryBytes, 0);
  assert.equal(inventory.categories.history.apparentBytes, 8);
});

test('cleanup revalidates newly referenced snapshots after manifest publication and never unlinks them', async t => {
  let restore;
  const f = await fixture(t, { write: async (path, data) => {
    await atomicWrite(path, data);
    if (restore) { const original = restore; restore = null; await atomicWrite(path, original); }
  } });
  const manifest = join(f.directory, 'history', f.key, 'manifest.json');
  const preview = await f.store.preview([f.record], 5);
  restore = await readFile(manifest, 'utf8');
  const first = preview.candidates[0], result = await f.store.clean(preview.id);
  assert.equal(result.results[0].status, 'ineligible');
  assert.ok(await lstat(join(f.directory, 'history', f.key, `${first.hash}.json`)));
});

test('pending intents and unpreviewed orphan snapshots are never reconciled by storage cleanup', async t => {
  const f = await fixture(t), history = await f.explorer.history(f.explorer.doc.id);
  const root = join(f.directory, 'history', f.key), orphan = history.row(f.explorer.doc, 'Orphan');
  await history.store(f.explorer.doc, orphan);
  const orphanPath = join(root, `${orphan.hash}.json`), orphanBytes = await readFile(orphanPath, 'utf8');
  const preview = await f.store.preview([f.record], 5);
  await f.store.clean(preview.id);
  assert.equal(await readFile(orphanPath, 'utf8'), orphanBytes);
  await writeFile(join(root, 'intent.json'), '{unresolved');
  assert.equal((await f.store.preview([f.record], 5)).candidates.length, 0);
  assert.equal(await readFile(join(root, 'intent.json'), 'utf8'), '{unresolved');
});

test('owned-root junction replacement rejects cleanup and does not inspect the target tree', async t => {
  const f = await fixture(t), preview = await f.store.preview([f.record], 5);
  const outside = await mkdtemp(join(tmpdir(), 'explorer-root-outside-test-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'sentinel'), 'Never touch');
  const saved = f.directory + '-original', { rename } = await import('node:fs/promises');
  t.after(() => rm(saved, { recursive: true, force: true }));
  await rename(f.directory, saved); await symlink(outside, f.directory, 'junction');
  assert.equal((await f.store.clean(preview.id)).results.filter(row => row.status === 'removed').length, 0);
  const inventory = await f.store.inventory(); assert.ok(inventory.partial); assert.equal(inventory.entries, 0);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'Never touch');
});

test('library cleanup preserves archived journeys and independent draft/usage/recovery metadata', async t => {
  const f = await fixture(t), { Library } = await import('../com.github.copilot/extensions/explorer/library.mjs');
  const library = new Library(f.directory), first = (await library.scan()).records[0];
  const controller = await new Explorer({ library, binding: 'storage-library' }).load(); t.after(() => controller.close());
  await controller.attach(first.key);
  for (let i = 0; i < 7; i++) await controller.command('guidance', { revision: controller.doc.revision, objective: `Library ${i}`, successCriteria: '' });
  await library.update(first.key, { archived: true }, (await library.metadata()).revision);
  const before = await readFile(first.file, 'utf8'), metadata = await readFile(join(f.directory, 'library.json'), 'utf8');
  const preview = await controller.storageRequest({ action: 'preview', keepHistory: 5 });
  assert.equal(preview.candidates.length, 2);
  assert.equal((await controller.storageRequest({ action: 'clean', id: preview.id })).results.filter(row => row.status === 'removed').length, 2);
  assert.equal(await readFile(first.file, 'utf8'), before); assert.equal(await readFile(join(f.directory, 'library.json'), 'utf8'), metadata);
  assert.ok((await controller.storageRequest({ action: 'inspect' })).inventory.categories.history.apparentBytes > 0);
});

test('inventory reports exact apparent category lengths without scanning unknown directories', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-exact-storage-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = { 'map.explore.json': '123', 'map.md': '12345', 'library.json': '1234567', 'drafts.json': '123456789', 'voice-settings.json': '12', 'drafts.json.partial.tmp': '1234', 'unknown.bin': '123456' };
  for (const [name, data] of Object.entries(files)) await writeFile(join(directory, name), data);
  await mkdir(join(directory, 'other-plugin')); await writeFile(join(directory, 'other-plugin', 'secret'), 'NEVER SCANNED');
  const inventory = await new StorageManagement(directory).inventory();
  assert.equal(inventory.apparentBytes, 36); assert.equal(inventory.uniqueBytes, 36);
  assert.equal(inventory.categories.journeys.apparentBytes, 3); assert.equal(inventory.categories.exports.apparentBytes, 5);
  assert.equal(inventory.categories.drafts.apparentBytes, 9); assert.equal(inventory.categories.recovery.apparentBytes, 4);
  assert.ok(inventory.partial); assert.match(inventory.issues[0].message, /unscanned/);
});

test('absent after an interrupted unlink is unknown, while confirmed removals remain idempotent', async t => {
  let interrupted = true;
  const f = await fixture(t, { remove: async path => { await unlink(path); if (interrupted) { interrupted = false; throw new Error('Lost unlink acknowledgement'); } } });
  const preview = await f.store.preview([f.record], 5), first = await f.store.clean(preview.id);
  assert.equal(first.results[0].status, 'failed');
  const retry = await f.store.clean(preview.id);
  assert.equal(retry.results[0].status, 'absent'); assert.match(retry.results[0].message, /unknown/);
  const confirmed = retry.results.find(row => row.status === 'removed'), path = join(f.directory, 'history', f.key, `${confirmed.hash}.json`);
  await writeFile(path, 'New unknown bytes after confirmed removal');
  await f.store.clean(preview.id);
  assert.equal(await readFile(path, 'utf8'), 'New unknown bytes after confirmed removal');
});

test('expired or replaced controllers cannot resume captured cleanup or authorize orphan deletion', async t => {
  const f = await fixture(t, { remove: async () => { throw new Error('Interrupted before unlink'); } });
  const preview = await f.store.preview([f.record], 5); await f.store.clean(preview.id);
  f.store.captured.expiresAt = Date.now() - 1;
  await assert.rejects(f.store.clean(preview.id), /expired/);
  const replacement = new StorageManagement(f.directory);
  await assert.rejects(replacement.clean(preview.id), /expired/);
  assert.equal((await replacement.preview([f.record], 5)).candidates.length, 0);
  for (const row of preview.candidates) assert.ok(await lstat(join(f.directory, 'history', f.key, `${row.hash}.json`)));
});

test('lost HTTP cleanup reply retries only the original ledger without repeating successful deletions', async t => {
  const f = await fixture(t), server = await startServer(f.explorer, { close() {} }); t.after(() => server.close());
  const url = new URL('api/storage', server.url), headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: url.origin };
  const preview = await f.explorer.storageRequest({ action: 'preview', keepHistory: 5 });
  const complete = Promise.withResolvers(), release = Promise.withResolvers(), request = f.explorer.storageRequest.bind(f.explorer);
  let held = false;
  f.explorer.storageRequest = async input => {
    const result = await request(input);
    if (input.action === 'clean' && !held) { held = true; complete.resolve(result); await release.promise; }
    return result;
  };
  const abort = new AbortController();
  const missing = fetch(url, { method: 'POST', signal: abort.signal, headers, body: JSON.stringify({ action: 'clean', id: preview.id }) }).catch(error => error);
  const observed = await complete.promise; abort.abort(); await missing; release.resolve();
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'clean', id: preview.id }) });
  const retry = await response.json();
  assert.deepEqual(retry.results, observed.results); assert.equal(retry.results.filter(row => row.status === 'removed').length, 3);
});

test('unknown root, parent and candidate file identities refuse cleanup before manifest mutation', async t => {
  for (const location of ['root', 'parent', 'snapshot']) {
    const f = await fixture(t), preview = await f.store.preview([f.record], 5);
    const manifestPath = join(f.directory, 'history', f.key, 'manifest.json'), before = await readFile(manifestPath, 'utf8');
    const target = location === 'root' ? f.directory : location === 'parent' ? join(f.directory, 'history') : join(f.directory, 'history', f.key, `${preview.candidates[0].hash}.json`);
    const original = fsPromises.lstat;
    const mock = t.mock.method(fsPromises, 'lstat', async (path, options) => {
      const stat = await original(path, options);
      if (path === target && options?.bigint) stat.ino = 0n;
      return stat;
    });
    syncBuiltinESMExports();
    try {
      const result = await f.store.clean(preview.id);
      assert.equal(result.results[0].status, 'ineligible', location);
      if (location === 'root') { const inventory = await f.store.inventory(); assert.ok(inventory.partial); assert.equal(inventory.entries, 0); }
      // A single changed candidate does not prevent independent eligible candidates.
      if (location !== 'snapshot') assert.equal(await readFile(manifestPath, 'utf8'), before);
      else assert.ok(JSON.parse(await readFile(manifestPath, 'utf8')).entries.some(row => row.hash === preview.candidates[0].hash));
    } finally { mock.mock.restore(); syncBuiltinESMExports(); }
  }
});

test('cleanup checks newest recovery document identity, not just a matching content hash', async t => {
  let replaced = false;
  const f = await fixture(t, { write: async (path, data) => {
    if (!replaced) {
      replaced = true; const value = JSON.parse(data), row = value.entries.at(-1), foreign = createDocument('Different journey');
      foreign.revision = row.revision; foreign.updatedAt = row.time;
      const bytes = JSON.stringify(foreign, null, 2), digest = createHash('sha256').update(bytes).digest('hex');
      await writeFile(join(f.directory, 'history', f.key, `${digest}.json`), bytes);
      value.entries[value.entries.length - 1] = { ...row, hash: digest, bytes: Buffer.byteLength(bytes) };
      await atomicWrite(path, JSON.stringify(value));
    } else await atomicWrite(path, data);
  } });
  const preview = await f.store.preview([f.record], 5), result = await f.store.clean(preview.id);
  assert.equal(result.results.filter(row => row.status === 'removed').length, 0);
  assert.equal(result.results[0].status, 'ineligible');
  assert.ok(await lstat(join(f.directory, 'history', f.key, `${preview.candidates[0].hash}.json`)));
});

for (const timing of ['before preview', 'before confirmation']) for (const field of ['revision', 'time', 'bytes', 'checkpoints']) {
  test(`storage preserves unrecovered head ${field} changed ${timing}`, async t => {
    const f = await fixture(t), history = await f.explorer.history(f.explorer.doc.id);
    const directory = join(f.directory, 'history', f.key), manifestPath = join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const snapshots = await Promise.all(manifest.entries.map(async row => [join(directory, `${row.hash}.json`), await readFile(join(directory, `${row.hash}.json`), 'utf8')]));
    const preview = timing === 'before confirmation' ? await f.store.preview([f.record], 5) : null;
    if (preview) assert.equal(preview.candidates.length, 3);
    if (field === 'revision') manifest.head.revision++;
    if (field === 'time') manifest.head.time = new Date(Date.parse(manifest.head.time) + 1).toISOString();
    if (field === 'bytes') manifest.head.bytes++;
    if (field === 'checkpoints') manifest.head.checkpoints = ['Invalid head protection'];
    assert.doesNotThrow(() => history.validate(manifest), 'structural validation alone accepts the malformed head');
    const damaged = JSON.stringify(manifest); await writeFile(manifestPath, damaged);
    await assert.rejects(f.explorer.readHistory(f.explorer.doc.id), /History recovery required/);
    if (preview) {
      const result = await f.store.clean(preview.id);
      assert.equal(result.results.filter(row => row.status === 'removed').length, 0);
      assert.ok(result.results.every(row => /History needs recovery/.test(row.message)), 'confirmation uses the same recovery-required guard');
    } else {
      const result = await f.store.preview([f.record], 5);
      assert.equal(result.candidates.length, 0);
      assert.ok(result.issues.some(issue => /History needs recovery/.test(issue)));
    }
    assert.equal(await readFile(manifestPath, 'utf8'), damaged, 'malformed manifest retained exactly');
    for (const [path, content] of snapshots) assert.equal(await readFile(path, 'utf8'), content, 'snapshot retained exactly');
  });
}
