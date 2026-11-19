import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AdrFileStorage } from '../com.github.copilot/extensions/explorer/adr-file-storage.mjs';
import { AdrLifecycleStorage } from '../com.github.copilot/extensions/explorer/adr-lifecycle-storage.mjs';
import { adrFileMarkdown, adrArtifactDigest, adrBytesDigest } from '../com.github.copilot/extensions/explorer/adr-file.mjs';
import { changeAdrLifecycle, linkAdrSuccessor, appendAdrLifecycle, transitionAdrMarkdown } from '../com.github.copilot/extensions/explorer/adr-lifecycle.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'adr-lifecycle-store-')), root = join(directory, 'project'), privateRoot = join(directory, 'private');
  await mkdir(join(root, 'docs/decisions'), { recursive: true }); await mkdir(privateRoot); t.after(() => rm(directory, { recursive: true, force: true }));
  let workingRoot = root; const options = { readRoot: async () => workingRoot, directory: privateRoot, key: 'journey-one' }, store = new AdrLifecycleStorage(options), reader = new AdrFileStorage(options);
  const doc = saveAdrFixture(adrFileDocument());
  const proposed = number => {
    const id = randomUUID(), content = adrFileMarkdown(doc.adrDraft, id);
    return { content, record: { version: 1, id, path: `docs/decisions/${number}-storage.md`, title: doc.adrDraft.title, status: 'proposed', sha256: adrBytesDigest(content), artifactDigest: adrArtifactDigest(doc.adrDraft), readinessDigest: 'a'.repeat(64), writtenAt: '2026-11-18T18:00:00.000Z' } };
  };
  const parent = proposed(1), accepted = changeAdrLifecycle([parent.record], { kind: 'accept', id: parent.record.id }, { actor: null, at: '2026-11-19T18:00:00.000Z' })[0];
  const oldContent = transitionAdrMarkdown(parent.content, parent.record, accepted), base = { ...accepted, sha256: adrBytesDigest(oldContent) }; await writeFile(join(root, base.path), oldContent);
  const successor = proposed(2), linked = linkAdrSuccessor([base], base.id, successor.record);
  const newContent = appendAdrLifecycle(successor.content, linked[1]), parentContent = transitionAdrMarkdown(oldContent, base, linked[0]);
  const steps = [
    { target: (await reader.capture(successor.record.path)).target, content: newContent, record: { ...linked[1], sha256: adrBytesDigest(newContent) }, base: null },
    { target: (await reader.capture(base.path, base)).target, content: parentContent, record: { ...linked[0], sha256: adrBytesDigest(parentContent) }, base },
  ];
  const value = { kind: 'successor', journeyId: doc.id, sourceDigest: 'b'.repeat(64), actor: null, steps };
  return { directory, root, privateRoot, options, store, value, oldContent, base, childFile: join(root, steps[0].record.path), parentFile: join(root, base.path), changeRoot: value => { workingRoot = value; } };
}

test('lifecycle coordinator persists exact intent before writes and completes only after both files and association', async t => {
  const f = await fixture(t), intent = await f.store.begin(f.value);
  assert.deepEqual(await readdir(join(f.root, 'docs/decisions')), ['1-storage.md']); assert.equal(await readFile(f.parentFile, 'utf8'), f.oldContent);
  assert.deepEqual((await f.store.states(intent)).map(value => value.publication), ['unpublished', 'unpublished']);
  await assert.rejects(f.store.complete(intent.id, async () => {}), /publish|complete/i);
  let checked = 0; await f.store.publish(intent.id, async (_, index, states) => { checked++; assert.equal(states[index].publication, 'unpublished'); }); assert.ok(checked >= 2);
  assert.equal(await readFile(f.childFile, 'utf8'), f.value.steps[0].content); assert.equal(await readFile(f.parentFile, 'utf8'), f.value.steps[1].content);
  await assert.rejects(f.store.complete(intent.id, async () => { throw Error('Association not saved'); }), /Association not saved/); assert.equal((await f.store.readIntent()).completed, false);
  await f.store.complete(intent.id, async () => {}); assert.equal((await f.store.readIntent()).completed, true);
  await writeFile(f.parentFile, 'A later reviewed status change'); const reopened = new AdrLifecycleStorage(f.options);
  assert.equal((await reopened.readIntent()).completed, true); await assert.rejects(reopened.publish(intent.id, async () => {}), /completed|histor/i);
  assert.equal((await reopened.complete(intent.id, async () => { throw Error('Do not replay historical proof'); })).completed, true);
});

test('lifecycle coordinator recovers the same children after publication of only the successor', async t => {
  const f = await fixture(t), intent = await f.store.begin(f.value);
  f.store.fault = async (phase, _, index) => { if (phase === 'after-file' && index === 0) throw Error('Interrupted after successor'); };
  await assert.rejects(f.store.publish(intent.id, async () => {}), /Interrupted/);
  assert.deepEqual((await f.store.states(intent)).map(value => value.publication), ['published', 'unpublished']);
  const firstId = (await f.store.child(intent, 0).readIntent()).id, reopened = new AdrLifecycleStorage(f.options); let partial = false;
  await reopened.publish(intent.id, async (_, index, states) => { if (index === 1) partial = states[0].publication === 'published'; }); assert.equal(partial, true);
  assert.equal((await reopened.child(intent, 0).readIntent()).id, firstId); await reopened.publish(intent.id, async () => { throw Error('Published parts must not repeat source checks'); });
  assert.deepEqual(await readdir(join(f.root, 'docs/decisions')), ['1-storage.md', '2-storage.md']); assert.equal(await readFile(f.parentFile, 'utf8'), f.value.steps[1].content);
});

test('lifecycle publication checks the predecessor before creating a successor and preserves external edits', async t => {
  const f = await fixture(t), intent = await f.store.begin(f.value); await writeFile(f.parentFile, 'External predecessor correction');
  await assert.rejects(f.store.publish(intent.id, async () => {}), /changed|unavailable|conflict/i);
  await assert.rejects(readFile(f.childFile), { code: 'ENOENT' }); assert.equal(await readFile(f.parentFile, 'utf8'), 'External predecessor correction');
});

test('a predecessor edit after successor publication leaves an explicit recoverable conflict without rollback', async t => {
  const f = await fixture(t), intent = await f.store.begin(f.value);
  f.store.fault = async (phase, _, index) => { if (phase === 'after-file' && index === 0) await writeFile(f.parentFile, 'Concurrent correction after first publication'); };
  await assert.rejects(f.store.publish(intent.id, async () => {}), /changed|unavailable|conflict/i);
  assert.equal(await readFile(f.childFile, 'utf8'), f.value.steps[0].content); assert.equal(await readFile(f.parentFile, 'utf8'), 'Concurrent correction after first publication');
  assert.deepEqual((await f.store.states(intent)).map(value => value.publication), ['published', 'unavailable']);
  await assert.rejects(f.store.abandon(intent.id), /published|unavailable|preserv/i);
});

test('failed lifecycle source guards preserve original bytes and permit discarding only unpublished staging', async t => {
  const f = await fixture(t), intent = await f.store.begin(f.value);
  await assert.rejects(f.store.publish(intent.id, async () => { throw Error('Source changed'); }), /Source changed/);
  await assert.rejects(readFile(f.childFile), { code: 'ENOENT' }); assert.equal(await readFile(f.parentFile, 'utf8'), f.oldContent);
  await f.store.abandon(intent.id); assert.equal((await f.store.readIntent()).abandoned, true);
  assert.deepEqual(await readdir(join(f.root, 'docs/decisions')), ['1-storage.md']); await assert.rejects(f.store.publish(intent.id, async () => {}), /abandoned/i);
});

test('lifecycle final source check follows all asynchronous part inspections', async t => {
  const f = await fixture(t), intent = await f.store.begin(f.value), states = f.store.states.bind(f.store); let changed = false;
  f.store.states = async (...args) => { const result = await states(...args); changed = true; return result; };
  await assert.rejects(f.store.publish(intent.id, async () => { if (changed) throw Error('Source changed in last part inspection'); }), /Source changed/);
  await assert.rejects(readFile(f.childFile), { code: 'ENOENT' }); assert.equal(await readFile(f.parentFile, 'utf8'), f.oldContent);
});

test('lifecycle journal schemas reject extra authority, changed roots, conflicting children and replacement of pending intent', async t => {
  const f = await fixture(t);
  for (const edit of [v => { v.extra = true; }, v => { v.steps[0].content += 'Unreviewed'; }, v => { v.steps[0].record.path = '../other.md'; }, v => { v.steps.push(v.steps[0]); }, v => { v.steps[0].target.root.path = f.privateRoot; }, v => { v.actor = { id: randomUUID(), displayName: 'Alice', email: 'private@example.invalid' }; }]) {
    const value = structuredClone(f.value); edit(value); await assert.rejects(f.store.begin(value));
  }
  assert.equal(await f.store.readIntent(), null); const intent = await f.store.begin(f.value);
  await assert.rejects(f.store.begin(f.value, intent.id), /pending|unfinished/i);
  const child = f.store.child(intent, 0), plan = { ...f.value.steps[0], journeyId: f.value.journeyId, sourceDigest: 'c'.repeat(64) };
  await child.begin(plan); await assert.rejects(f.store.publish(intent.id, async () => {}), /changed|plan|match/i);
  await assert.rejects(readFile(f.childFile), { code: 'ENOENT' });
});

test('lifecycle coordinator preserves files when working or private storage identity changes', async t => {
  for (const change of ['working', 'private']) {
    const f = await fixture(t), intent = await f.store.begin(f.value);
    if (change === 'working') { const other = join(f.directory, 'other'); await mkdir(other); f.changeRoot(other); }
    else { await rename(f.privateRoot, f.privateRoot + '-original'); await mkdir(f.privateRoot); }
    await assert.rejects(f.store.publish(intent.id, async () => {}), /changed|unavailable|identity/i);
    await assert.rejects(readFile(f.childFile), { code: 'ENOENT' }); assert.equal(await readFile(f.parentFile, 'utf8'), f.oldContent);
  }
});
