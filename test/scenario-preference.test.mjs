import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, lstat, rename, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { personalPreferenceStore, projectPreferenceStore } from '../com.github.copilot/extensions/explorer/scenario-preference-store.mjs';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { buildScenario } from '../com.github.copilot/extensions/explorer/scenario-fork.mjs';
import { scenarioIdentity, scenarioFamily, preferenceKey, readPreference, nextPreference, preferenceStatus, PREFERENCE_LIMIT } from '../com.github.copilot/extensions/explorer/scenario-preference.mjs';

function scenarios() {
  const original = createDocument('Which direction?');
  original.nodes.push({ id: 'choice', parentId: original.rootId, question: 'Where should this run?', category: 'Architecture', answer: 'Locally', answerState: 'assumption', research: null, review: true });
  const alternative = buildScenario(original, { nodeId: 'choice', answer: 'Remotely', answerState: 'tentative' }).document;
  return { original, alternative, family: scenarioFamily(original) };
}
const choice = (doc, location = 'a'.repeat(64)) => ({ identity: scenarioIdentity(doc), location });

test('scenario families follow explicit root origins through nested forks and copied forks without merging unforked copies', () => {
  const { original, alternative, family } = scenarios();
  const nested = buildScenario(alternative, { nodeId: alternative.forkOrigin.forkNodeId, answer: 'Both', answerState: 'assumption' }).document;
  assert.deepEqual(scenarioFamily(alternative), family); assert.deepEqual(scenarioFamily(nested), family);
  assert.deepEqual(scenarioFamily({ ...alternative, id: 'copied-fork' }), family);
  assert.notEqual(preferenceKey(scenarioFamily({ ...original, id: 'unforked-copy' })), preferenceKey(family));
  const incomplete = structuredClone(alternative); incomplete.forkOrigin.nodes = incomplete.forkOrigin.nodes.filter(row => row.nodeId !== incomplete.rootId);
  assert.throws(() => scenarioFamily(incomplete), /root|lineage/i);
  const contradictory = structuredClone(alternative); contradictory.forkOrigin.nodes.find(row => row.nodeId === contradictory.rootId).origin.nodeId = 'choice';
  assert.throws(() => scenarioFamily(contradictory), /root|lineage/i);
});

test('one preference records exact rationale and recoverable selection history without changing either map or answer certainty', () => {
  const { original, alternative, family } = scenarios(), before = JSON.stringify([original, alternative]);
  const initial = readPreference(null, family, 'personal'); assert.equal(initial.digest, null);
  let value = nextPreference(initial.value, choice(original), '  Start here 🌱\n');
  value = nextPreference(value, choice(alternative, 'b'.repeat(64)), 'Try the alternative');
  assert.equal(value.revision, 2); assert.deepEqual(value.events.at(-1).preferred, choice(alternative, 'b'.repeat(64)));
  assert.equal(value.events[0].rationale, '  Start here 🌱\n');
  const previous = value.events[0].preferred;
  value = nextPreference(value, previous, 'Restore earlier direction');
  assert.deepEqual(value.events.at(-1).preferred, choice(original)); assert.equal(value.revision, 3);
  value = nextPreference(value, null, 'Explicitly clear'); assert.equal(value.events.at(-1).preferred, null);
  for (let i = 0; i < 40; i++) value = nextPreference(value, choice(original), `Reason ${i}`);
  assert.equal(value.events.length, 32); assert.equal(value.events[0].revision, value.revision - 31);
  assert.equal(JSON.stringify([original, alternative]), before);
  const reread = readPreference(Buffer.from(JSON.stringify(value)), family, 'personal');
  assert.deepEqual(reread.value, value); assert.match(reread.digest, /^[a-f0-9]{64}$/);
});

test('preference files reject ambiguous JSON, invalid encoding, unknown fields, cross-scope references and invalid history', () => {
  const { original, family } = scenarios(), value = nextPreference(readPreference(null, family, 'personal').value, choice(original), 'Reason');
  const raw = JSON.stringify(value);
  assert.throws(() => readPreference(raw.replace('"revision":1', '"revision":0,"revision":1'), family, 'personal'), /duplicate/i);
  assert.throws(() => readPreference(Buffer.from([0xc3, 0x28]), family, 'personal'), /UTF-8/i);
  assert.throws(() => readPreference(' '.repeat(PREFERENCE_LIMIT + 1), family, 'personal'), /limit/i);
  assert.throws(() => readPreference(JSON.stringify({ ...value, unexpected: true }), family, 'personal'), /preference/i);
  assert.throws(() => readPreference(raw, { ...family, id: 'other' }, 'personal'), /family/i);
  assert.throws(() => readPreference(raw, family, 'project'), /scope/i);
  const broken = structuredClone(value); broken.events[0].revision = 2;
  assert.throws(() => readPreference(JSON.stringify(broken), family, 'personal'), /history|preference/i);
  assert.throws(() => nextPreference(value, choice(original, '../private-file'), ''), /location|preference/i);
  assert.throws(() => nextPreference(value, choice(original), 'x'.repeat(2001)), /rationale/i);
  const project = readPreference(null, family, 'project').value;
  assert.throws(() => nextPreference(project, choice(original, '../outside.explore.json'), ''), /path|preference/i);
  assert.equal(nextPreference(project, choice(original, '.explorer/journeys/example.explore.json'), '').scope, 'project');
});

test('preference status keeps missing or replaced preferred scenarios unresolved and identifies retained alternatives', () => {
  const { original, alternative, family } = scenarios(), empty = readPreference(null, family, 'personal').value;
  assert.equal(preferenceStatus(empty, alternative, null).status, 'unselected');
  const selected = nextPreference(empty, choice(original), 'Current');
  assert.equal(preferenceStatus(selected, original, original, 'a'.repeat(64)).status, 'preferred');
  assert.equal(preferenceStatus(selected, original, original, 'b'.repeat(64)).status, 'alternative', 'a different file with the same claimed identity is not the preferred file');
  assert.equal(preferenceStatus(selected, alternative, original).status, 'alternative');
  assert.equal(preferenceStatus(selected, alternative, null).status, 'unresolved');
  assert.equal(preferenceStatus(selected, original, { ...original, createdAt: new Date(0).toISOString() }).status, 'unresolved');
  assert.equal(preferenceStatus(nextPreference(selected, null, ''), alternative, null).status, 'unselected');
});

async function storage(t) {
  const directory = await mkdtemp(join(tmpdir(), 'scenario-preference-'));
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); return rm(directory, { recursive: true, force: true }); });
  const library = new Library(directory), data = scenarios();
  return { directory, library, ...data, store: await personalPreferenceStore(library, data.family) };
}

test('preference reads create no record; explicit changes serialize and reject an obsolete writer while preserving maps', async t => {
  const { library, store, original, alternative, family } = await storage(t);
  const a = await library.import(original), b = await library.import(alternative), before = await Promise.all([readFile(a.file), readFile(b.file)]);
  const initial = await store.read(); assert.equal(initial.digest, null); await assert.rejects(lstat(dirname(store.file)), { code: 'ENOENT' });
  const other = await personalPreferenceStore(library, family), sameInitial = await other.read();
  const results = await Promise.allSettled([store.update(initial, choice(original, a.key), 'First'), other.update(sameInitial, choice(alternative, b.key), 'Second')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /changed|conflict/i);
  const saved = await store.read(); assert.equal(saved.value.revision, 1); assert.equal(saved.value.events.length, 1);
  assert.deepEqual(await Promise.all([readFile(a.file), readFile(b.file)]), before);
});

test('preference write rechecks external bytes after asynchronous source validation and preserves failed-save recovery', async t => {
  const { store, original } = await storage(t);
  await store.update(await store.read(), choice(original), 'Original');
  const previous = await store.read(), raw = await readFile(store.file, 'utf8');
  const external = JSON.stringify(nextPreference(previous.value, null, 'Changed elsewhere'));
  await assert.rejects(store.update(previous, choice(original), 'Obsolete', async () => writeFile(store.file, external)), /changed|conflict/i);
  assert.equal(await readFile(store.file, 'utf8'), external);
  const saved = await store.read(); store.replace = async () => { throw Error('write fixture failure'); };
  await assert.rejects(store.update(saved, choice(original), 'Cannot save'), /write fixture/);
  assert.equal(await readFile(store.file, 'utf8'), external); assert.notEqual(raw, external);
});

test('corrupted preferences and replaced parent directories fail closed without inventing a selection', async t => {
  const { store, original } = await storage(t);
  await store.update(await store.read(), choice(original), 'Original'); const before = await store.read();
  const file = await readFile(store.file, 'utf8'); await writeFile(store.file, '<<<<<<< unresolved Git conflict');
  await assert.rejects(store.read(), /JSON/); await assert.rejects(store.update(before, null, ''), /JSON/);
  await writeFile(store.file, file);
  const old = dirname(store.file), moved = old + '-retained'; await rename(old, moved);
  await assert.rejects(store.read(), /changed|identity/i);
});

test('project preferences use one shared family record across scenarios and preserve private data and map files', async t => {
  const { directory, original, alternative, family } = await storage(t), root = join(directory, 'checkout'); await mkdir(root);
  await promisify(execFile)('git', ['-C', root, 'init', '-q'], { windowsHide: true });
  const repository = new ProjectRepository({ readRoot: async () => root, localDirectory: directory });
  const a = await repository.create(original), b = await repository.create(alternative), before = await Promise.all([readFile(a.context.file), readFile(b.context.file)]);
  const first = await projectPreferenceStore(repository, a, family), second = await projectPreferenceStore(repository, b, family);
  assert.equal(first.file, second.file); assert.equal((await first.read()).digest, null);
  await assert.rejects(lstat(join(root, '.explorer/scenarios')), { code: 'ENOENT' });
  const initial = await first.read();
  const saved = await first.update(initial, choice(original, a.context.relativePath), 'Use the original');
  await assert.rejects(second.update(initial, choice(alternative, b.context.relativePath), 'Stale alternative'), /changed/i);
  await second.update(saved, choice(alternative, b.context.relativePath), 'Choose the alternative');
  const raw = await readFile(first.file, 'utf8'); assert.equal(JSON.parse(raw).revision, 2);
  assert.equal(raw.includes(directory), false); assert.equal(raw.includes('nodes'), false); assert.equal(raw.includes('Locally'), false);
  assert.deepEqual(await Promise.all([readFile(a.context.file), readFile(b.context.file)]), before);
});

test('project preference operations reject a changed host checkout and byte-only edits without replacing either file', async t => {
  const { directory, original, family } = await storage(t), root = join(directory, 'checkout'), other = join(directory, 'other');
  for (const path of [root, other]) { await mkdir(path); await promisify(execFile)('git', ['-C', path, 'init', '-q'], { windowsHide: true }); }
  let working = root;
  const repository = new ProjectRepository({ readRoot: async () => working, localDirectory: directory }), active = await repository.create(original);
  const store = await projectPreferenceStore(repository, active, family), reference = choice(original, active.context.relativePath);
  await store.update(await store.read(), reference, 'Original'); const base = await store.read();
  const external = JSON.stringify(base.value, null, 2); await writeFile(store.file, external);
  await assert.rejects(store.update(base, null, 'Outdated bytes'), /changed/i); assert.equal(await readFile(store.file, 'utf8'), external);
  working = other; await assert.rejects(store.read(), /changed|checkout/i);
  await assert.rejects(store.update(base, null, 'Wrong checkout'), /changed|checkout/i);
  assert.equal(await readFile(store.file, 'utf8'), external); await assert.rejects(lstat(join(other, '.explorer')), { code: 'ENOENT' });
});
