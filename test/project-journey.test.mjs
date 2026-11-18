import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { projectStorageContext } from '../com.github.copilot/extensions/explorer/storage-context.mjs';
import { ProjectJourney } from '../com.github.copilot/extensions/explorer/project-journey.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Drafts, draftBase } from '../com.github.copilot/extensions/explorer/drafts.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';
import { readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-project-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const localDirectory = join(root, 'private'), checkoutDirectory = join(root, 'checkout');
  const file = join(checkoutDirectory, '.explorer', 'journeys', 'choice.explore.json');
  await mkdir(dirname(file), { recursive: true });
  const document = createDocument('  A choice 🌿  '); document.nodes[0].question = document.topic;
  addQuestions(document, document.rootId, [{ question: 'Which option?', category: 'Scope' }]);
  document.nodes[1].question = '  Which option? 🌿  ';
  const options = { file, checkoutDirectory, localDirectory, journeyId: document.id };
  const context = await projectStorageContext(options), journey = new ProjectJourney(context);
  await journey.create(document);
  return { root, options, context, journey, file, document, localDirectory, checkoutDirectory };
}
const answer = (journey, text) => {
  const next = structuredClone(journey.document); next.nodes[1].answer = text;
  return journey.save(next, { baseDigest: journey.baseDigest, label: 'Answer saved' });
};

test('project saves contain only shared content; private drafts and helper data stay outside the checkout', async t => {
  const f = await fixture(t), { context, journey } = f;
  const drafts = new Drafts(context.directory), node = journey.document.nodes[1];
  await drafts.update({ key: context.key, nodeId: node.id, base: draftBase(node), text: 'Private unfinished answer', revision: 0 });
  await mkdir(context.usageDirectory); await writeFile(join(context.usageDirectory, 'receipt.json'), 'private receipt');
  await writeFile(join(context.directory, 'library.json'), 'private binding');
  await answer(journey, '  Committed café 🌿\n  second line ');
  const bytes = await readFile(f.file), shared = readSharedDocument(bytes).document;
  assert.equal(shared.journey.nodes[1].answer, journey.document.nodes[1].answer);
  assert.equal(Object.hasOwn(shared.journey, 'revision'), false);
  assert.equal(bytes.includes('Private unfinished'), false); assert.equal(bytes.includes('private receipt'), false);
  assert.deepEqual(await readdir(dirname(f.file)), ['choice.explore.json']);
  assert.equal((await drafts.list(context.key))[0].text, 'Private unfinished answer');
  assert.equal((await journey.versions()).entries.length, 1);
  const savedVersion = (await journey.versions()).entries[0];
  assert.equal((await journey.versions(savedVersion.hash)).document.nodes[1].question, '  Which option? 🌿  ');
  const before = await readFile(f.file); const base = journey.baseDigest;
  assert.equal(await journey.save(structuredClone(journey.document), { baseDigest: base }), false);
  assert.deepEqual(await readFile(f.file), before); assert.equal(journey.baseDigest, base);
});

test('two clones with the same journey ID open without source-machine data and isolate every auxiliary namespace', async t => {
  const f = await fixture(t); await answer(f.journey, 'Shared answer');
  const checkoutDirectory = join(f.root, 'second-checkout'), file = join(checkoutDirectory, 'choice.explore.json');
  await mkdir(checkoutDirectory); await writeFile(file, await readFile(f.file));
  const otherContext = await projectStorageContext({ ...f.options, checkoutDirectory, file });
  const other = await new ProjectJourney(otherContext).load();
  assert.equal(other.document.nodes[1].answer, 'Shared answer'); assert.equal(other.document.revision, 0);
  for (const field of ['directory', 'key', 'lockFile', 'usageDirectory']) assert.notEqual(f.context[field], otherContext[field]);
  const node = f.journey.document.nodes[1];
  await new Drafts(f.context.directory).update({ key: f.context.key, nodeId: node.id, base: draftBase(node), text: 'First checkout draft', revision: 0 });
  assert.deepEqual(await new Drafts(otherContext.directory).list(otherContext.key), []);
  assert.deepEqual((await other.versions()).entries, []);
  const lock = f.context.withLock(async () => { await otherContext.withLock(async () => {}); });
  await lock;
  await answer(other, 'Second checkout answer');
  assert.equal(readSharedDocument(await readFile(f.file)).document.journey.nodes[1].answer, 'Shared answer');
  const reopened = await new ProjectJourney(await projectStorageContext(f.options)).load();
  assert.equal(reopened.document.revision, 1);
  assert.equal((await new Drafts(f.context.directory).list(f.context.key))[0].text, 'First checkout draft');
});

test('stale bases, private/unknown fields and unavailable destinations preserve both shared content and drafts', async t => {
  const f = await fixture(t), stale = f.journey.baseDigest;
  await answer(f.journey, 'First'); const before = await readFile(f.file);
  const next = structuredClone(f.journey.document); next.nodes[1].answer = 'Second';
  await assert.rejects(f.journey.save(next, { baseDigest: stale }), /changed|base/i);
  for (const field of ['drafts', 'sessionId', 'projectSources', 'usage', 'references']) {
    await assert.rejects(f.journey.save({ ...next, [field]: 'private' }, { baseDigest: f.journey.baseDigest }), /unsupported|field/i);
  }
  const failed = await new ProjectJourney(f.context, { write: async () => { throw Error('disk unavailable'); } }).load();
  await assert.rejects(answer(failed, 'Cannot persist'), /unavailable/);
  assert.deepEqual(await readFile(f.file), before);
  const recovered = await new ProjectJourney(f.context).load(); assert.equal(recovered.document.nodes[1].answer, 'First');
});

test('interrupted history finalization keeps the committed shared answer and reconciles from local intent on reopen', async t => {
  const f = await fixture(t); let fail = false;
  const journey = await new ProjectJourney(f.context, { historyWrite: async (path, content) => {
    if (fail && path.endsWith('manifest.json') && JSON.parse(content).head.revision === 1) throw Error('interrupted finalization');
    await atomicWrite(path, content);
  } }).load();
  fail = true;
  await assert.rejects(answer(journey, 'Saved before interruption'), /finalization|saved/i);
  assert.equal(readSharedDocument(await readFile(f.file)).document.journey.nodes[1].answer, 'Saved before interruption');
  const reopened = await new ProjectJourney(f.context).load();
  assert.equal(reopened.document.revision, 1); assert.equal(reopened.document.nodes[1].answer, 'Saved before interruption');
  assert.equal((await reopened.versions()).entries.length, 1);
  assert.equal((await readdir(join(f.context.directory, 'history', f.context.key))).includes('intent.json'), false);
});

test('retention cleans only old local snapshots while the authoritative document is in another root', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 8; i++) await answer(f.journey, `Choice ${i}`);
  const draftFile = join(f.context.directory, 'drafts.json'); await writeFile(draftFile, 'protected private drafts');
  const before = await readFile(f.file), store = f.journey.retention();
  const preview = await store.preview([f.journey.record()], 5);
  assert.deepEqual(preview.issues, []); assert.equal(preview.candidates.length, 3);
  const result = await store.clean(preview.id);
  assert.equal(result.results.filter(row => row.status === 'removed').length, 3);
  assert.deepEqual(await readFile(f.file), before); assert.equal(await readFile(draftFile, 'utf8'), 'protected private drafts');
  assert.equal((await f.journey.versions()).entries.length, 5);
  const other = await new ProjectJourney(f.context).load(); await answer(other, 'Another writer');
  const old = await store.preview([f.journey.record()], 5);
  await answer(other, 'Changed after preview');
  assert.equal((await store.clean(old.id)).results.some(row => row.status === 'removed'), false);
});

test('context rejects linked or replaced roots and private storage inside the checkout without moving data', async t => {
  const f = await fixture(t), before = await readFile(f.file);
  await assert.rejects(projectStorageContext({ ...f.options, localDirectory: join(f.checkoutDirectory, 'private') }), /private|outside/i);
  await assert.rejects(projectStorageContext({ ...f.options, file: join(f.root, 'outside.explore.json') }), /outside|project|checkout/i);
  const link = join(f.root, 'linked-checkout'); await symlink(f.checkoutDirectory, link, 'junction');
  await assert.rejects(projectStorageContext({ ...f.options, checkoutDirectory: link, file: join(link, '.explorer', 'journeys', 'choice.explore.json') }), /linked|identity|root/i);
  const moved = join(f.root, 'previous-checkout'); await rename(f.checkoutDirectory, moved);
  await mkdir(dirname(f.file), { recursive: true }); await writeFile(f.file, before);
  await assert.rejects(answer(f.journey, 'Must not follow replacement'), /changed|identity|root/i);
  assert.deepEqual(await readFile(f.file), before);
  assert.deepEqual(await readFile(join(moved, '.explorer', 'journeys', 'choice.explore.json')), before);
});

test('different journey identities cannot race to overwrite the same new project destination', async t => {
  const f = await fixture(t), file = join(dirname(f.file), 'collision.explore.json');
  const documents = [createDocument('First creator'), createDocument('Second creator')];
  const journeys = await Promise.all(documents.map(async document => new ProjectJourney(
    await projectStorageContext({ ...f.options, file, journeyId: document.id }),
    { write: async (path, content) => { await new Promise(resolve => setTimeout(resolve, 50)); await atomicWrite(path, content); } },
  )));
  const results = await Promise.allSettled(journeys.map((journey, index) => journey.create(documents[index])));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const winner = results.findIndex(result => result.status === 'fulfilled');
  assert.equal(readSharedDocument(await readFile(file)).document.journey.id, documents[winner].id);
});

test('preparing another storage scope never moves personal drafts or changes the original saved journey', async t => {
  const f = await fixture(t), personalFile = join(f.localDirectory, 'personal.explore.json');
  await writeFile(personalFile, JSON.stringify(f.document));
  const personal = await new Explorer({ file: personalFile }).load(); t.after(() => personal.close());
  const node = personal.doc.nodes[1];
  await personal.writeDraft({ journey: personal.doc.id, nodeId: node.id, base: node, text: 'Original private draft', revision: 0 });
  const before = await readFile(personalFile), draftFile = join(f.localDirectory, 'drafts.json'), beforeDraft = await readFile(draftFile);
  const otherContext = await projectStorageContext({ ...f.options, journeyId: 'new-project-identity', file: join(dirname(f.file), 'new.explore.json') });
  const copy = { ...structuredClone(personal.doc), id: 'new-project-identity' };
  await new ProjectJourney(otherContext).create(copy);
  assert.deepEqual(await readFile(personalFile), before); assert.deepEqual(await readFile(draftFile), beforeDraft);
  assert.deepEqual(await new Drafts(otherContext.directory).list(otherContext.key), []);
  await assert.rejects(projectStorageContext({ ...f.options, localDirectory: join(f.checkoutDirectory, 'forbidden') }), /outside/i);
  assert.equal((await personal.readDrafts(personal.doc.id)).entries[0].text, 'Original private draft');
});

test('unsupported shared data and external edits preserve private recovery and refuse mutation', async t => {
  const f = await fixture(t); await answer(f.journey, 'Known saved answer');
  const original = await readFile(f.file), parsed = JSON.parse(original);
  parsed.version = 999; const future = JSON.stringify(parsed); await writeFile(f.file, future);
  await assert.rejects(new ProjectJourney(f.context).load(), /unsupported/i);
  assert.equal(await readFile(f.file, 'utf8'), future);
  parsed.version = 1; parsed.journey.nodes[1].answer = 'External Git edit';
  const external = JSON.stringify(parsed); await writeFile(f.file, external);
  await assert.rejects(new ProjectJourney(f.context).load(), /outside local history|reconciliation/i);
  assert.equal(await readFile(f.file, 'utf8'), external);
  assert.equal((await f.journey.versions()).entries.length, 1);
});
