import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, link, symlink, lstat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdrFileStorage, validateAdrWriteIntent } from '../com.github.copilot/extensions/explorer/adr-file-storage.mjs';
import { adrFileMarkdown, adrArtifactDigest, adrBytesDigest } from '../com.github.copilot/extensions/explorer/adr-file.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';

async function fixture(t, fault = async () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'adr-file-store-')), root = join(directory, 'project'), privateRoot = join(directory, 'private');
  await mkdir(root); await mkdir(privateRoot); t.after(() => rm(directory, { recursive: true, force: true }));
  let workingRoot = root; const readRoot = async () => workingRoot, store = new AdrFileStorage({ readRoot, directory: privateRoot, key: 'journey-one', fault });
  const doc = saveAdrFixture(adrFileDocument()), path = 'docs/decisions/0001-storage-λ.md';
  const record = (id = randomUUID(), title = 'Storage λ') => { const draft = { ...doc.adrDraft, title }, content = adrFileMarkdown(draft, id); return { content, record: { version: 1, id, path, title, status: 'proposed', sha256: adrBytesDigest(content), artifactDigest: adrArtifactDigest(draft), readinessDigest: 'a'.repeat(64), writtenAt: new Date().toISOString() } }; };
  const prepare = async (owner = store, value = record(), base = null) => { const preview = await owner.capture(path, base); const intent = await owner.begin({ target: preview.target, ...value, base, sourceDigest: 'b'.repeat(64), journeyId: doc.id }); return { ...preview, intent, ...value }; };
  return { directory, root, privateRoot, store, readRoot, record, prepare, path, file: join(root, path), changeRoot: path => { workingRoot = path; } };
}

test('ADR publication previews without project writes, then saves exact bytes once and recognizes reopen', async t => {
  const f = await fixture(t), p = await f.prepare(); assert.deepEqual(await readdir(f.root), []); assert.equal(p.oldContent, null);
  assert.equal((await f.store.inspect()).publication, 'unpublished'); let guards = 0;
  await f.store.publish(p.intent.id, async () => { guards++; }); assert.ok(guards); assert.equal(await readFile(f.file, 'utf8'), p.content);
  assert.equal((await f.store.inspect()).publication, 'published');
  const reopened = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'journey-one' });
  await reopened.publish(p.intent.id, async () => { throw Error('Already published must not rerun original source guard'); });
  assert.equal(await readFile(f.file, 'utf8'), p.content); assert.deepEqual(await readdir(join(f.root, 'docs/decisions')), ['0001-storage-λ.md']);
  await assert.rejects(f.prepare(), /pending|unfinished|operation|exists/i);
});

test('ADR reviewed update journal separates observed bytes from original association without accepting other metadata changes', async t => {
  const f = await fixture(t), first = await f.prepare(); await f.store.publish(first.intent.id);
  const current = first.content.replace('<!-- copilot-explorer-adr:', 'Manual reasoning\n<!-- copilot-explorer-adr:'); await writeFile(f.file, current);
  const observed = await f.store.observe(first.record), replacement = f.record(first.record.id, 'Revised title');
  const value = { ...first.intent, id: randomUUID(), target: observed.target, content: replacement.content, record: replacement.record, base: { ...first.record, sha256: adrBytesDigest(current) }, associationBase: first.record, stage: null };
  assert.equal(validateAdrWriteIntent(value).associationBase.sha256, first.record.sha256);
  for (const edit of [v => { v.associationBase.title += ' mismatch'; }, v => { v.associationBase.id = randomUUID(); }, v => { v.base.sha256 = first.record.sha256; }, v => { v.base = null; }, v => { v.associationBase.extra = true; }]) { const forged = structuredClone(value); edit(forged); assert.throws(() => validateAdrWriteIntent(forged)); }
  await assert.rejects(f.store.capture(f.path, first.record), /changed|conflict/i);
  assert.equal(await readFile(f.file, 'utf8'), current);
});

test('two ADR writers with the same target never overwrite each other', async t => {
  const f = await fixture(t), other = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'journey-two' });
  const first = await f.prepare(), second = await f.prepare(other), results = await Promise.allSettled([f.store.publish(first.intent.id), other.publish(second.intent.id)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); const saved = await readFile(f.file, 'utf8');
  assert.ok([first.content, second.content].includes(saved)); assert.deepEqual(await readdir(join(f.root, 'docs/decisions')), ['0001-storage-λ.md']);
});

test('managed proposed ADR update reviews complete old bytes and refuses an unchanged-byte replacement identity', async t => {
  const f = await fixture(t), first = await f.prepare(); await f.store.publish(first.intent.id);
  const owner = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'update' }), value = f.record(first.record.id, 'Edited title λ');
  const update = await f.prepare(owner, value, first.record); assert.equal(update.oldContent, first.content);
  await rename(f.file, f.file + '.saved'); await writeFile(f.file, first.content);
  await assert.rejects(owner.publish(update.intent.id), /changed|identity|review/i); assert.equal(await readFile(f.file, 'utf8'), first.content);
  const fresh = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'fresh-update' }), reviewed = await f.prepare(fresh, value, first.record);
  await fresh.publish(reviewed.intent.id); assert.equal(await readFile(f.file, 'utf8'), value.content); assert.equal(await readFile(f.file + '.saved', 'utf8'), first.content);
  await assert.rejects(fresh.capture(f.path, { ...value.record, sha256: '0'.repeat(64) }), /changed|fingerprint|match/i);
});

test('unchanged-content ADR updates still require staging and current-source validation', async t => {
  const f = await fixture(t), first = await f.prepare(); await f.store.publish(first.intent.id);
  const owner = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'unchanged-update' }), update = await f.prepare(owner, { content: first.content, record: first.record }, first.record);
  const original = (await lstat(f.file, { bigint: true })).ino;
  assert.equal((await owner.inspect()).publication, 'unpublished');
  await assert.rejects(owner.publish(update.intent.id, async () => { throw Error('Current source rejected'); }), /Current source rejected/);
  assert.equal((await lstat(f.file, { bigint: true })).ino, original); assert.equal((await owner.inspect()).publication, 'unpublished');
  let guarded = false; await owner.publish(update.intent.id, async () => { guarded = true; }); assert.equal(guarded, true);
  assert.equal((await owner.inspect()).publication, 'published'); assert.equal(await readFile(f.file, 'utf8'), first.content);
  assert.notEqual((await lstat(f.file, { bigint: true })).ino, original);
});

test('unchanged-content ADR update refuses a same-byte replacement after review', async t => {
  const f = await fixture(t), first = await f.prepare(); await f.store.publish(first.intent.id);
  const owner = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'identical-replacement' }), update = await f.prepare(owner, { content: first.content, record: first.record }, first.record);
  await rename(f.file, f.file + '.original'); await writeFile(f.file, first.content);
  await assert.rejects(owner.publish(update.intent.id), /changed|identity|conflict/i); assert.equal(await readFile(f.file, 'utf8'), first.content);
});

test('matching external new ADR bytes are a collision and never proof of this operation publication', async t => {
  const f = await fixture(t), p = await f.prepare(); await mkdir(join(f.root, 'docs/decisions'), { recursive: true }); await writeFile(f.file, p.content);
  await assert.rejects(f.store.publish(p.intent.id), /changed|identity|conflict/i); assert.equal(await readFile(f.file, 'utf8'), p.content);
});

test('ADR recovery refuses a same-byte replacement of its published staging identity', async t => {
  const f = await fixture(t), p = await f.prepare(); await f.store.publish(p.intent.id);
  await rename(f.file, f.file + '.published'); await writeFile(f.file, p.content);
  await assert.rejects(f.store.publish(p.intent.id), /changed|identity|conflict/i); assert.equal(await readFile(f.file, 'utf8'), p.content);
});

test('ADR writer rejects changed working roots, missing/replaced ancestors and linked destinations', async t => {
  for (const change of ['working', 'root', 'missing', 'parent', 'junction', 'hardlink', 'directory']) {
    const f = await fixture(t); await mkdir(join(f.root, 'docs/decisions'), { recursive: true }); const p = await f.prepare();
    const outside = join(f.directory, 'outside'); await mkdir(outside);
    if (change === 'working') f.changeRoot(outside);
    if (change === 'root') { await rename(f.root, join(f.directory, 'old-project')); await mkdir(f.root); }
    if (change === 'missing') await rename(join(f.root, 'docs'), join(f.root, 'saved-docs'));
    if (change === 'parent') { await rename(join(f.root, 'docs/decisions'), join(f.root, 'docs/old')); await mkdir(join(f.root, 'docs/decisions')); }
    if (change === 'junction') { await rename(join(f.root, 'docs/decisions'), join(f.root, 'docs/old')); await symlink(outside, join(f.root, 'docs/decisions'), 'junction'); }
    if (change === 'hardlink') { await writeFile(join(outside, 'held.md'), 'External bytes'); await link(join(outside, 'held.md'), f.file); }
    if (change === 'directory') await mkdir(f.file);
    await assert.rejects(f.store.publish(p.intent.id), /changed|unavailable|linked|identity|exists|directory|regular|root|ENOENT/i, change);
    assert.equal((await readdir(outside)).includes('0001-storage-λ.md'), false);
    if (change === 'hardlink') assert.equal(await readFile(join(outside, 'held.md'), 'utf8'), 'External bytes');
  }
});

for (const phase of ['before-stage', 'after-stage', 'before-publish', 'after-publish', 'after-cleanup']) test(`ADR publication recovers idempotently after failure at ${phase}`, async t => {
  let fail = true; const f = await fixture(t, async step => { if (step === phase && fail) { fail = false; throw Error(`Injected ${phase}`); } });
  const p = await f.prepare(); await assert.rejects(f.store.publish(p.intent.id), /Injected/);
  const view = await f.store.inspect(); assert.equal(view.publication, ['after-publish', 'after-cleanup'].includes(phase) ? 'published' : 'unpublished');
  if (phase === 'after-publish') { assert.equal((await lstat(f.file)).nlink, 2); assert.equal(view.cleanupRequired, true); }
  const reopened = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'journey-one' }); await reopened.publish(p.intent.id);
  assert.equal(await readFile(f.file, 'utf8'), p.content); assert.equal((await lstat(f.file)).nlink, 1); assert.equal((await reopened.inspect()).cleanupRequired, false);
  assert.deepEqual(await readdir(join(f.root, 'docs/decisions')), ['0001-storage-λ.md']);
});

test('final source guard and write denial preserve old ADR bytes and retain a recoverable intent', async t => {
  const f = await fixture(t), p = await f.prepare(); await f.store.publish(p.intent.id);
  const owner = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'guarded-update' }), next = await f.prepare(owner, f.record(p.record.id, 'Changed'), p.record);
  await assert.rejects(owner.publish(next.intent.id, async () => { throw Error('Source changed'); }), /Source changed/); assert.equal(await readFile(f.file, 'utf8'), p.content);
  owner.fault = async phase => { if (phase === 'before-publish') throw Object.assign(Error('Read-only destination'), { code: 'EROFS' }); };
  await assert.rejects(owner.publish(next.intent.id), /Read-only/); assert.equal(await readFile(f.file, 'utf8'), p.content); assert.equal((await owner.inspect()).publication, 'unpublished');
  owner.fault = async () => {}; await owner.publish(next.intent.id); assert.equal(await readFile(f.file, 'utf8'), next.content);
});

test('ADR journal and path validation reject unsafe fields and limits without treating stored roots as authority', async t => {
  const f = await fixture(t);
  for (const path of ['../file.md', '.hidden/file.md', 'docs/secrets.md', 'docs/file.txt', 'C:/file.md']) await assert.rejects(f.store.capture(path));
  const p = await f.prepare(), original = await readFile(f.store.journalFile, 'utf8');
  for (const alter of [v => { v.extra = true; }, v => { v.target.path = '../file.md'; }, v => { v.content += 'different'; }, v => { v.stage = { name: '../other', identity: '1:2:3' }; }, v => { v.record.status = 'accepted'; }]) {
    const value = JSON.parse(original); alter(value); await writeFile(f.store.journalFile, JSON.stringify(value)); await assert.rejects(f.store.inspect());
  }
  await writeFile(f.store.journalFile, Buffer.alloc(262145, 65)); await assert.rejects(f.store.inspect(), /limit|size|budget/i);
  await writeFile(f.store.journalFile, Buffer.from([255])); await assert.rejects(f.store.inspect(), /UTF|JSON|journal/i);
  await writeFile(f.store.journalFile, original); f.changeRoot(join(f.directory, 'missing-project')); await assert.rejects(f.store.publish(p.intent.id), /root|unavailable/i);
  assert.deepEqual(await readdir(f.root), []);
});

test('ADR recovery preserves replaced staging evidence and refuses an extra unowned hard link', async t => {
  for (const change of ['replaced-stage', 'third-link']) {
    const f = await fixture(t, async phase => { if (phase === 'after-publish') throw Error('Crash after link'); }), p = await f.prepare();
    await assert.rejects(f.store.publish(p.intent.id), /Crash/); const intent = await f.store.readIntent(), stage = join(f.root, 'docs/decisions', intent.stage.name);
    if (change === 'replaced-stage') { await rename(stage, stage + '.preserved'); await writeFile(stage, 'Unrelated external staging bytes'); }
    else await link(f.file, join(f.root, 'external-link.md'));
    f.store.fault = async () => {};
    await assert.rejects(f.store.publish(p.intent.id), /changed|identity|linked/i);
    assert.equal(await readFile(f.file, 'utf8'), p.content);
    if (change === 'replaced-stage') assert.equal(await readFile(stage, 'utf8'), 'Unrelated external staging bytes');
    else assert.equal(await readFile(join(f.root, 'external-link.md'), 'utf8'), p.content);
  }
});

test('ADR final asynchronous guard cannot overwrite an externally corrected managed draft', async t => {
  const f = await fixture(t), first = await f.prepare(); await f.store.publish(first.intent.id);
  const owner = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'external-update' }), next = await f.prepare(owner, f.record(first.record.id, 'New wording'), first.record);
  await assert.rejects(owner.publish(next.intent.id, async () => { await writeFile(f.file, 'External correction'); }), /changed|conflict/i);
  assert.equal(await readFile(f.file, 'utf8'), 'External correction');
});

test('ADR updates recover after rename without overwriting a subsequent external edit', async t => {
  const f = await fixture(t), first = await f.prepare(); await f.store.publish(first.intent.id);
  const owner = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'interrupted-update', fault: async phase => { if (phase === 'after-publish') throw Error('After rename'); } });
  const next = await f.prepare(owner, f.record(first.record.id, 'New wording'), first.record); await assert.rejects(owner.publish(next.intent.id), /After rename/);
  assert.equal((await owner.inspect()).publication, 'published'); assert.equal((await lstat(f.file)).nlink, 1);
  await writeFile(f.file, 'Later external correction'); owner.fault = async () => {};
  await assert.rejects(owner.publish(next.intent.id), /changed|conflict/i); assert.equal(await readFile(f.file, 'utf8'), 'Later external correction');
});

test('ADR private recovery cannot be placed inside the project or follow replaced private storage', async t => {
  const f = await fixture(t), inside = new AdrFileStorage({ readRoot: f.readRoot, directory: f.root, key: 'inside' });
  await assert.rejects(f.prepare(inside), /outside.*project/i); assert.deepEqual(await readdir(f.root), []);
  const p = await f.prepare(); await rename(f.privateRoot, f.privateRoot + '-old'); await mkdir(f.privateRoot);
  await assert.rejects(f.store.publish(p.intent.id), /storage identity changed/i); assert.deepEqual(await readdir(f.root), []);
});

test('an unpublished ADR operation can be explicitly abandoned without deleting or rolling back a published file', async t => {
  const f = await fixture(t, async phase => { if (phase === 'after-stage') throw Error('Interrupted staging'); }), first = await f.prepare();
  await assert.rejects(f.store.publish(first.intent.id), /Interrupted/); await f.store.abandon(first.intent.id);
  assert.equal((await f.store.inspect()).intent.abandoned, true); assert.deepEqual(await readdir(join(f.root, 'docs/decisions')), []);
  await assert.rejects(f.store.publish(first.intent.id), /abandoned/i);
  const value = f.record(), preview = await f.store.capture(f.path), next = await f.store.begin({ target: preview.target, ...value, base: null, sourceDigest: 'b'.repeat(64), journeyId: first.intent.journeyId }, first.intent.id);
  f.store.fault = async () => {}; await f.store.publish(next.id); await assert.rejects(f.store.abandon(next.id), /published|saved/i);
  assert.equal(await readFile(f.file, 'utf8'), value.content);
});

test('ADR completion receipts require proven publication and association, then remain historical without replay', async t => {
  const f = await fixture(t), p = await f.prepare();
  await assert.rejects(f.store.complete(p.intent.id, async () => {}), /publish|complete/i);
  await f.store.publish(p.intent.id);
  await assert.rejects(f.store.complete(p.intent.id, async () => { throw Error('Association not durable'); }), /Association not durable/);
  assert.equal((await f.store.readIntent()).completed, undefined);
  const completed = await f.store.complete(p.intent.id, async current => { assert.equal(current.record.id, p.record.id); });
  assert.equal(completed.completed, true);
  await writeFile(f.file, 'Later explicitly edited or transitioned ADR');
  const reopened = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'journey-one' });
  assert.equal((await reopened.readIntent()).completed, true);
  assert.equal((await reopened.complete(p.intent.id, async () => { throw Error('Historical proof must not be replayed'); })).completed, true);
  await assert.rejects(reopened.publish(p.intent.id), /completed|histor/i); await assert.rejects(reopened.abandon(p.intent.id), /completed|histor/i);
  assert.equal(await readFile(f.file, 'utf8'), 'Later explicitly edited or transitioned ADR');
});

for (const changedPart of ['destination', 'stage']) test(`ADR final authority guard cannot overwrite a ${changedPart} edit made during its await`, async t => {
  const f = await fixture(t), first = await f.prepare(); await f.store.publish(first.intent.id);
  const owner = new AdrFileStorage({ readRoot: f.readRoot, directory: f.privateRoot, key: 'final-guard-edit' });
  const next = await f.prepare(owner, f.record(first.record.id, 'Reviewed update'), first.record); let guards = 0;
  await assert.rejects(owner.publish(next.intent.id, async intent => {
    if (++guards === 2) await writeFile(changedPart === 'destination' ? f.file : owner.stagePath(intent), 'Human correction during final guard');
  }), /changed|identity|conflict|review/i);
  assert.equal(guards, 2); assert.equal(await readFile(f.file, 'utf8'), changedPart === 'destination' ? 'Human correction during final guard' : first.content);
});
