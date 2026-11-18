import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { mergeSharedDocuments } from '../com.github.copilot/extensions/explorer/semantic-merge.mjs';

function fixture() {
  const doc = model.createDocument('Explicit dependencies'), [a, b] = model.addQuestions(doc, doc.rootId, [{ question: 'Storage?', category: 'Choice' }, { question: 'Delivery?', category: 'Choice' }]);
  const [c] = model.addQuestions(doc, a.id, [{ question: 'Capacity?', category: 'Choice' }]);
  b.answer = '  Exact answer 日本語\n'; b.answerState = 'assumption';
  b.research = { basis: 'reasoning', summary: 'Compare', options: ['One', 'Two'].map(title => ({ title, description: title, pros: ['Useful'], cons: ['Cost'] })), recommendation: 'One', uncertainty: 'Unknown', sources: [] };
  return { doc, a: a.id, b: b.id, c: c.id };
}
const edge = (dependentId, prerequisiteId, explanation) => ({ dependentId, prerequisiteId, ...(explanation === undefined ? {} : { explanation }) });
async function directory(t) { const root = await mkdtemp(join(tmpdir(), 'explorer-dependencies-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('explicit cross-branch direction and exact explanation round-trip without changing any node', () => {
  const { doc, a, b } = fixture(), before = structuredClone(doc.nodes), explanation = '  Uses its result 日本語 🌱\n';
  assert.equal(typeof model.addDependency, 'function'); model.addDependency(doc, b, a, explanation);
  assert.deepEqual(doc.dependencies, [edge(b, a, explanation)]); assert.deepEqual(doc.nodes, before);
  assert.deepEqual(model.importedDocument(JSON.parse(JSON.stringify(doc))).dependencies, doc.dependencies);
  const shared = prepareSharedMigration(JSON.stringify(doc)); assert.deepEqual(readSharedDocument(shared.content).document.journey.dependencies, doc.dependencies);
  assert.match(model.toMarkdown(doc), /N2 depends on N1/); assert.match(model.toMarkdown(doc), /Uses its result 日本語 🌱/);
  model.removeDependency(doc, b, a); assert.equal(Object.hasOwn(doc, 'dependencies'), false); assert.deepEqual(doc.nodes, before);
});

test('validation rejects invalid endpoints, duplicate pairs, cycles and unsupported relationship data', () => {
  const { doc, a, b, c } = fixture(), direction = model.addDirection(doc, doc.rootId, 'A direction');
  for (const dependencies of [null, {}, [edge(a, a)], [edge(a, 'missing')], [edge(doc.rootId, a)], [edge(a, direction.id)], [edge(a, b), edge(a, b)], [edge(a, b), edge(b, c), edge(c, a)], [edge(a, b, 1)], [edge(a, b, 'x'.repeat(1001))], [{ ...edge(a, b), inferred: true }]]) {
    assert.throws(() => model.validateDocument({ ...doc, dependencies }), /depend|question|explanation|cycle/i);
  }
  assert.equal(Object.hasOwn(model.validateDocument(doc), 'dependencies'), false);
  const valid = { ...doc, dependencies: [edge(b, a), edge(c, b)] }; assert.deepEqual(model.validateDocument(valid).dependencies, valid.dependencies);
  assert.throws(() => model.validateDocument({ ...valid, nodes: valid.nodes.filter(n => n.id !== c) }), /depend|missing/i);
});

test('rejected add/remove operations are atomic and ordinary tree ancestry never becomes a dependency', () => {
  const { doc, a, b, c } = fixture(); assert.equal(typeof model.addDependency, 'function');
  assert.equal(Object.hasOwn(doc, 'dependencies'), false);
  model.addDependency(doc, a, c); // Explicit dependency direction can differ from the navigation tree.
  model.addDependency(doc, b, a); const before = structuredClone(doc);
  for (const [dependent, prerequisite] of [[a, c], [c, b], [a, a], [b, 'missing']]) { assert.throws(() => model.addDependency(doc, dependent, prerequisite), /depend|cycle|missing/i); assert.deepEqual(doc, before); }
  assert.throws(() => model.removeDependency(doc, a, b), /depend|exist/i); assert.deepEqual(doc, before);
  model.removeDependency(doc, b, a); assert.deepEqual(doc.dependencies, [edge(a, c)]);
});

test('dependency validation is bounded and iterative on a near-limit map', () => {
  const doc = model.createDocument('Deep dependencies');
  for (let i = 0; i < 4999; i++) doc.nodes.push({ id: `n${i}`, parentId: doc.rootId, question: `Question ${i}`, category: 'Choice', answer: '', research: null, review: false });
  doc.dependencies = Array.from({ length: 4998 }, (_, i) => edge(`n${i + 1}`, `n${i}`));
  assert.equal(model.validateDocument(doc).dependencies?.length, 4998);
  assert.throws(() => model.validateDocument({ ...doc, dependencies: [...doc.dependencies, edge('n0', 'n4998')] }), /cycle/i);
  assert.throws(() => model.validateDocument({ ...doc, dependencies: Array(10001).fill(edge('n1', 'n0')) }), /depend|limit/i);
});

test('controller saves dependency edits through history, rejects stale writes and validates imports/restores', async t => {
  const root = await directory(t), { doc, a, b } = fixture(), file = join(root, 'map.explore.json'); await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file }).load(); t.after(() => e.close());
  const command = (action, data = {}) => e.command(action, { revision: e.doc.revision, nodeId: b, prerequisiteId: a, ...data });
  await command('add-dependency', { explanation: 'Shared requirement' }); const saved = structuredClone(e.doc), snapshotRevision = saved.revision;
  assert.deepEqual(e.doc.nodes, doc.nodes); assert.deepEqual(JSON.parse(await readFile(file)).dependencies, [edge(b, a, 'Shared requirement')]);
  await assert.rejects(command('add-dependency'), /duplicate|already/i); assert.deepEqual(e.doc, saved);
  await assert.rejects(command('remove-dependency', { inferred: true }), /field/i);
  await command('remove-dependency'); assert.equal(Object.hasOwn(e.doc, 'dependencies'), false);
  assert.equal((await e.readHistory(e.doc.id, snapshotRevision)).preview.dependenciesChanged, true);
  await e.command('restore', { revision: e.doc.revision, journey: e.doc.id, snapshotRevision }); assert.deepEqual(e.doc.dependencies, saved.dependencies);
  const prior = await readFile(file), invalid = structuredClone(e.doc); invalid.nodes = invalid.nodes.filter(n => n.id !== b);
  await assert.rejects(e.command('import', { revision: e.doc.revision, document: invalid }), /depend|missing/i); assert.deepEqual(await readFile(file), prior);
  const other = await new Explorer({ file }).load(); t.after(() => other.close()); await other.command('remove-dependency', { revision: other.doc.revision, nodeId: b, prerequisiteId: a });
  await assert.rejects(command('remove-dependency'), /changed|canvas/i); assert.equal(Object.hasOwn(JSON.parse(await readFile(file)), 'dependencies'), false);
  assert.ok((await other.readHistory(other.doc.id)).entries.some(row => /Dependency/.test(row.label)));
});

test('a fresh Git clone retains confirmed relationships without private metadata', async t => {
  const root = await directory(t), checkout = join(root, 'checkout'), cloned = join(root, 'clone'), exec = promisify(execFile);
  const git = (...args) => exec('git', args, { windowsHide: true }); await mkdir(checkout); await git('-C', checkout, 'init', '-q');
  const { doc, a, b } = fixture(); doc.dependencies = [edge(b, a, 'Published user assertion')];
  const repository = new ProjectRepository({ readRoot: async () => checkout, localDirectory: join(root, 'private-one') }), store = await repository.create(doc);
  await git('-C', checkout, 'add', '--', store.context.relativePath); await git('-C', checkout, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Shared relationships');
  await git('clone', '-q', '--no-hardlinks', checkout, cloned);
  const second = new ProjectRepository({ readRoot: async () => cloned, localDirectory: join(root, 'private-two') }), opened = await second.open(store.context.relativePath);
  assert.deepEqual(opened.document.dependencies, doc.dependencies); assert.deepEqual(opened.document.nodes, doc.nodes); assert.notEqual(opened.context.key, store.context.key);
});

test('semantic merge refuses a clean-looking deletion that would leave a confirmed dependency dangling', () => {
  const { doc, a, b } = fixture(), base = prepareSharedMigration(JSON.stringify(doc)).document, local = structuredClone(base), incoming = structuredClone(base);
  local.journey.dependencies = [edge(b, a)]; incoming.journey.nodes = incoming.journey.nodes.filter(n => n.id !== b);
  const result = mergeSharedDocuments(base, local, incoming); assert.equal(result.document, null); assert.match(result.error, /depend|missing/i); assert.ok(result.unresolved.includes('graph'));
});
