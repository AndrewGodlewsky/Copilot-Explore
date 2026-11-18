import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { ProjectReconciliation } from '../com.github.copilot/extensions/explorer/project-reconciliation.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
const exec = promisify(execFile);
const git = (cwd, ...args) => exec('git', ['-C', cwd, ...args], { windowsHide: true });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-reconcile-')); t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout'), local = join(root, 'private'); await mkdir(checkout); await git(checkout, 'init', '-q');
  const repository = new ProjectRepository({ readRoot: async () => checkout, localDirectory: local });
  const doc = createDocument('Shared changes'); addQuestions(doc, doc.rootId, [{ question: 'Which approach?', category: 'Scope' }]);
  doc.nodes[1].answer = '  Original 日本語  ';
  const store = await repository.create(doc); const reconcile = new ProjectReconciliation(repository, store);
  const replace = async answer => { const next = JSON.parse(await readFile(store.context.file, 'utf8')); next.journey.nodes[1].answer = answer; const text = JSON.stringify(next, null, 2); await writeFile(store.context.file, text); return text; };
  return { root, checkout, local, repository, doc, store, reconcile, replace };
}
test('explicit reload adopts changed bytes without writing incoming file and preserves old recovery history', async t => {
  const f = await fixture(t), before = structuredClone(f.store.document), originalHistory = await f.store.history.root();
  await f.store.history.checkpoint(before, before.revision, 'Original checkpoint'); const oldManifest = await readFile(join(originalHistory, 'manifest.json'));
  const incoming = await f.replace('Teammate answer');
  await assert.rejects(f.store.save(before, { baseDigest: f.store.baseDigest }), /changed|base|history/i);
  const preview = await f.reconcile.preview(); assert.equal(preview.changed, true); assert.equal(preview.document.nodes[1].answer, 'Teammate answer');
  const loaded = await f.reconcile.reload(preview.id);
  assert.equal(loaded.document.nodes[1].answer, 'Teammate answer'); assert.ok(loaded.document.revision > before.revision);
  assert.equal(await readFile(loaded.context.file, 'utf8'), incoming); assert.notEqual(await loaded.history.root(), originalHistory);
  assert.deepEqual(await readFile(join(originalHistory, 'manifest.json')), oldManifest);
  const versions = await loaded.versions(); assert.ok(versions.entries.length);
  const preserved = await loaded.versions(versions.entries[0].hash); assert.equal(preserved.document.nodes[1].answer, before.nodes[1].answer);
  const reopened = await f.repository.open(loaded.context.relativePath); assert.equal(reopened.document.revision, loaded.document.revision);
  const next = structuredClone(reopened.document); next.nodes[1].answer = 'Later answer'; await reopened.save(next, { baseDigest: reopened.baseDigest });
});
test('rapid incoming changes after preview reject reload and never overwrite either incoming version', async t => {
  const f = await fixture(t); await f.replace('First incoming'); const preview = await f.reconcile.preview();
  const latest = await f.replace('Second incoming'); await assert.rejects(f.reconcile.reload(preview.id), /changed|preview/i);
  assert.equal(await readFile(f.store.context.file, 'utf8'), latest); assert.equal(f.store.document.nodes[1].answer, f.doc.nodes[1].answer);
});
test('branch changes with identical journey bytes invalidate old writers and require explicit fresh selection', async t => {
  const f = await fixture(t); await git(f.checkout, 'add', '.'); await git(f.checkout, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Shared');
  const store = await f.repository.open(f.store.context.relativePath), original = await readFile(store.context.file);
  await git(f.checkout, 'switch', '-c', 'alternate');
  await assert.rejects(store.save(store.document, { baseDigest: store.baseDigest }), /branch|checkout|changed/i);
  const reconciliation = new ProjectReconciliation(f.repository, store), preview = await reconciliation.preview();
  const loaded = await reconciliation.reload(preview.id); assert.deepEqual(await readFile(loaded.context.file), original);
  const next = structuredClone(loaded.document); next.nodes[1].answer = 'New branch decision'; await loaded.save(next, { baseDigest: loaded.baseDigest });
});
test('deleted, renamed and conflicted files preserve the displayed base privately without rewriting the project', async t => {
  const f = await fixture(t), moved = f.store.context.file + '.moved'; await rename(f.store.context.file, moved);
  await assert.rejects(f.reconcile.preview(), /missing|available|ENOENT/i);
  const saved = await f.reconcile.preserve(); const versions = await f.store.versions(saved.hash);
  assert.equal(versions.document.nodes[1].answer, f.doc.nodes[1].answer);
  const conflict = '<<<<<<< ours\ninvalid\n=======\ntheirs\n>>>>>>> theirs\n'; await writeFile(f.store.context.file, conflict);
  await assert.rejects(f.reconcile.preview(), /JSON|conflict|invalid/i); assert.equal(await readFile(f.store.context.file, 'utf8'), conflict);
  assert.deepEqual(await readFile(moved), Buffer.from(JSON.stringify(f.store.shared, null, 2) + '\n'));
});
test('replacement with a different journey identity requires separate opening rather than rebasing old drafts', async t => {
  const f = await fixture(t), replacement = JSON.parse(await readFile(f.store.context.file)); replacement.journey.id = 'different-journey';
  const content = JSON.stringify(replacement); await writeFile(f.store.context.file, content);
  await assert.rejects(f.reconcile.preview(), /identity|different|journey/i); assert.equal(await readFile(f.store.context.file, 'utf8'), content);
  assert.equal((await f.reconcile.preserve()).saved, true);
});
test('atomic replacement with identical bytes rejects old writers and replacements during preview reject reload', async t => {
  const f = await fixture(t), bytes = await readFile(f.store.context.file), old = f.store.context.file + '.previous';
  await rename(f.store.context.file, old); await writeFile(f.store.context.file, bytes);
  await assert.rejects(f.store.save(f.store.document, { baseDigest: f.store.baseDigest }), /identity|changed/i);
  const preview = await f.reconcile.preview();
  await rename(f.store.context.file, old + '2'); await writeFile(f.store.context.file, bytes);
  await assert.rejects(f.reconcile.reload(preview.id), /identity|changed/i); assert.deepEqual(await readFile(f.store.context.file), bytes);
});
test('private pointer failures retain incoming bytes and recover both sides without changing the project', async t => {
  const f = await fixture(t), incoming = await f.replace('Pulled content'), preview = await f.reconcile.preview();
  await assert.rejects(f.reconcile.reload(preview.id, { pointerWrite: async () => { throw Error('Before pointer'); } }), /Before pointer/);
  assert.equal(await readFile(f.store.context.file, 'utf8'), incoming);
  await assert.rejects(f.reconcile.reload(preview.id, { pointerWrite: async (...args) => { await atomicWrite(...args); throw Error('After pointer'); } }), /After pointer/);
  const loaded = await f.repository.open(f.store.context.relativePath); assert.equal(loaded.document.nodes[1].answer, 'Pulled content');
  const versions = await loaded.versions(); assert.ok(versions.entries.length);
  assert.equal((await loaded.versions(versions.entries[0].hash)).document.nodes[1].answer, f.doc.nodes[1].answer);
  assert.equal(await readFile(f.store.context.file, 'utf8'), incoming);
});
test('controller observation invalidates queued questions and owned work, rejects late callbacks and preserves exact draft bases', async t => {
  const f = await fixture(t), e = await new Explorer({ library: new Library(f.local), projectRoot: async () => f.checkout, binding: 'reconcile', send: async () => {} }).load(); t.after(() => e.close());
  await e.command('open-project', { path: f.store.context.relativePath });
  const key = e.activeKey, node = e.doc.nodes[1];
  await e.writeDraft({ journey: key, nodeId: node.id, base: node, text: '  PRIVATE unsent 日本語  ', answerState: 'tentative', stateSelected: true, revision: 0 });
  await e.command('questions', { revision: e.doc.revision, nodeId: node.id }); const request = e.pending.id;
  const abort = new AbortController(); e.help = { abort, status: 'pending', journey: key, nodeId: node.id };
  await f.replace('Changed by teammate'); await e.observeProject();
  assert.ok(e.snapshot().projectChange); assert.equal(e.pending, null); assert.equal(abort.signal.aborted, true);
  await assert.rejects(e.receive('questions', { requestId: request, questions: [{ question: 'Late', category: 'Scope' }] }), /pending|active|stale|request/i);
  const preview = await e.projectReconciliationRequest({ action: 'inspect', journey: key, revision: e.doc.revision });
  const state = await e.command('project-reload', { id: preview.id, journey: key, revision: e.doc.revision });
  assert.equal(state.projectChange, null); assert.equal(e.doc.nodes[1].answer, 'Changed by teammate');
  const drafts = await e.readDrafts(key); assert.equal(drafts.entries[0].text, '  PRIVATE unsent 日本語  '); assert.equal(drafts.entries[0].stale, true);
});
test('an uninitialized private history pointer is rejected without resetting local revision authority', async t => {
  const f = await fixture(t), bytes = await readFile(f.store.context.file);
  await writeFile(join(f.store.context.directory, 'history-state.json'), JSON.stringify({ version: 1, key: 'a'.repeat(64) }));
  await assert.rejects(f.repository.open(f.store.context.relativePath), /history|ENOENT/i);
  assert.deepEqual(await readFile(f.store.context.file), bytes);
});
test('bounded recovery prioritizes the active history and displayed preservation over older namespaces', async t => {
  const f = await fixture(t); await f.replace('Incoming'); const preview = await f.reconcile.preview(), loaded = await f.reconcile.reload(preview.id);
  for (let index = 0; index < 40; index++) await mkdir(join(loaded.context.directory, 'history', index.toString(16).padStart(64, '0')), { recursive: true });
  const versions = await loaded.versions(); assert.ok(versions.unavailable > 0); assert.ok(versions.entries.length);
  const preserved = await loaded.versions(versions.entries[0].hash); assert.equal(preserved.document.nodes[1].answer, f.doc.nodes[1].answer);
});
test('same-byte replacement during history preparation is not overwritten by the final save', async t => {
  const f = await fixture(t), original = await readFile(f.store.context.file), write = f.store.history.write;
  let swapped = false;
  f.store.history.write = async (file, content) => {
    await write(file, content);
    if (!swapped && file.endsWith('intent.json')) { swapped = true; await atomicWrite(f.store.context.file, original); }
  };
  const edited = structuredClone(f.store.document); edited.nodes[1].answer = 'Stale edit';
  await assert.rejects(f.store.save(edited, { baseDigest: f.store.baseDigest }), /identity|changed/i);
  assert.equal(swapped, true); assert.deepEqual(await readFile(f.store.context.file), original);
});

test('newly preserved content remains inspectable after reopen despite a bounded history listing', async t => {
  const f = await fixture(t), preserved = structuredClone(f.store.document); preserved.nodes[1].answer = 'Last preserved base';
  const saved = await f.store.preserveDisplayed(preserved);
  for (let index = 0; index < 40; index++) await mkdir(join(f.store.context.directory, 'history', index.toString(16).padStart(64, '0')), { recursive: true });
  const reopened = await f.repository.open(f.store.context.relativePath), versions = await reopened.versions(saved.hash);
  assert.ok(versions.unavailable > 0); assert.equal(versions.document.nodes[1].answer, preserved.nodes[1].answer);
  await writeFile(join(f.store.context.directory, 'history-state.json'), JSON.stringify({ version: 1, key: 'a'.repeat(64) }));
  assert.equal((await reopened.versions(saved.hash)).document.nodes[1].answer, preserved.nodes[1].answer);
});
test('same-byte replacement on the fast reload reread rejects preview acceptance', async t => {
  const f = await fixture(t), preview = await f.reconcile.preview(), selected = f.reconcile.selection.store;
  const current = selected.current.bind(selected), original = await readFile(f.store.context.file);
  selected.current = async () => { await atomicWrite(f.store.context.file, original); return current(); };
  await assert.rejects(f.reconcile.reload(preview.id), /identity|changed/i); assert.deepEqual(await readFile(f.store.context.file), original);
});

test('an unavailable older namespace cannot hide the valid recently preserved version', async t => {
  const f = await fixture(t), saved = await f.reconcile.preserve();
  await writeFile(join(f.store.context.directory, 'history', '0'.repeat(64)), 'Not a history directory');
  const versions = await f.store.versions(saved.hash);
  assert.ok(versions.unavailable > 0); assert.equal(versions.document.nodes[1].answer, f.doc.nodes[1].answer);
});
