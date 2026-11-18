import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';

function fixture() {
  const doc = model.createDocument('Restore a branch');
  const [branch, outside] = model.addQuestions(doc, doc.rootId, [{ question: 'Where?', category: 'Scope' }, { question: 'Who?', category: 'Scope' }]);
  const direction = model.addDirection(doc, branch.id, 'Deployment details');
  const [child] = model.addQuestions(doc, direction.id, [{ question: 'How?', category: 'Scope' }]);
  branch.answer = 'Local'; branch.answerState = 'assumption'; child.answer = '  Original 🌱\n'; child.answerState = 'tentative';
  return { doc, branch, outside, direction, child };
}
const restore = (...args) => { assert.equal(typeof model.branchRestoration, 'function'); return model.branchRestoration(...args); };

test('branch restoration recovers historical content and preserves unrelated later data and global guidance', () => {
  const f = fixture(), historical = structuredClone(f.doc), current = structuredClone(historical);
  current.nodes.find(n => n.id === f.child.id).answer = 'New detail';
  const outside = current.nodes.find(n => n.id === f.outside.id); outside.answer = 'New unrelated work'; outside.answerState = 'decided';
  current.objective = 'Current objective'; current.pins = [{ id: 'pin-abcdefghijklmnopqrst', text: 'Keep current guidance' }];
  const before = JSON.stringify(current), old = JSON.stringify(historical), result = restore(current, historical, f.branch.id);
  assert.deepEqual(result.conflicts, []); assert.equal(result.changed, true);
  assert.deepEqual(result.document.nodes.find(n => n.id === f.outside.id), outside);
  assert.equal(result.document.nodes.find(n => n.id === f.child.id).answer, '  Original 🌱\n');
  assert.equal(result.document.nodes.find(n => n.id === f.branch.id).answerState, 'assumption');
  assert.equal(result.document.nodes.find(n => n.id === f.branch.id).review, true, 'changed outside context requires review');
  for (const key of ['id', 'createdAt', 'rootId', 'objective', 'pins']) assert.deepEqual(result.document[key], current[key]);
  assert.equal(JSON.stringify(current), before); assert.equal(JSON.stringify(historical), old);
  assert.deepEqual(model.validateDocument(result.document), result.document);
});

test('missing subtrees return with stable identities; research remains historical and only affected outside dependents change', () => {
  const f = fixture();
  f.child.research = { basis: 'reasoning', summary: 'Old context', options: [{ title: 'A', description: 'A', pros: [], cons: [] }, { title: 'B', description: 'B', pros: [], cons: [] }], recommendation: 'A', uncertainty: 'Unknown', sources: [] };
  model.addDependency(f.doc, f.outside.id, f.child.id);
  const historical = model.validateDocument(f.doc), current = structuredClone(historical);
  current.nodes = current.nodes.filter(n => ![f.branch.id, f.direction.id, f.child.id].includes(n.id)); delete current.dependencies;
  const result = restore(current, historical, f.branch.id);
  assert.deepEqual(result.conflicts, []); assert.deepEqual(result.document.dependencies, historical.dependencies);
  const child = result.document.nodes.find(n => n.id === f.child.id);
  assert.equal(child.researchStale, true); assert.deepEqual(child.research, historical.nodes.find(n => n.id === f.child.id).research);
  assert.equal(result.document.nodes.find(n => n.id === f.outside.id).review, true);
  assert.equal(result.changes.find(change => change.id === f.outside.id).before.review, false, 'preview retains the exact outside preimage');
  assert.equal(result.document.nodes.find(n => n.id === f.direction.id).parentId, f.branch.id);
  assert.deepEqual(result.added.sort(), [f.branch.id, f.direction.id, f.child.id].sort());
});

test('compatible current boundary dependencies survive and exact restoration is a no-op', () => {
  const f = fixture(), historical = structuredClone(f.doc), current = structuredClone(historical);
  const noop = restore(current, historical, f.branch.id); assert.equal(noop.changed, false); assert.deepEqual(noop.document, current);
  model.addDependency(current, f.child.id, f.outside.id, 'New confirmed relationship');
  current.nodes.find(n => n.id === f.branch.id).answer = 'Changed';
  const result = restore(current, historical, f.branch.id); assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.document.dependencies, current.dependencies);
  assert.deepEqual(result.document.nodes.find(n => n.id === f.outside.id), current.nodes.find(n => n.id === f.outside.id));
});

test('missing parents, root selection and reused identities block without producing a candidate', () => {
  const f = fixture(), historical = structuredClone(f.doc);
  const missing = structuredClone(historical); missing.nodes = missing.nodes.filter(n => ![f.branch.id, f.direction.id, f.child.id].includes(n.id));
  assert.match(restore(missing, historical, f.direction.id).conflicts.map(c => c.message).join(' '), /parent/i);
  assert.match(restore(historical, historical, historical.rootId).conflicts.map(c => c.message).join(' '), /whole.map/i);
  const moved = structuredClone(historical); moved.nodes.find(n => n.id === f.child.id).parentId = f.outside.id;
  const result = restore(moved, historical, f.branch.id); assert.equal(result.document, null); assert.match(result.conflicts.map(c => c.message).join(' '), /identity|outside|reused/i);
  const reused = structuredClone(historical); reused.nodes.find(n => n.id === f.child.id).question = 'Unrelated reused ID';
  assert.equal(restore(reused, historical, f.branch.id).document, null);
});

test('boundary conflicts, missing historical endpoints, cycles and incompatible lineage are explicit blockers', () => {
  const f = fixture(), historical = structuredClone(f.doc); model.addDependency(historical, f.child.id, f.outside.id, 'Original explanation');
  const current = structuredClone(historical); current.dependencies[0].explanation = 'Conflicting explanation';
  assert.match(restore(current, historical, f.branch.id).conflicts.map(c => c.message).join(' '), /dependency|explanation/i);
  const removed = structuredClone(historical); removed.nodes = removed.nodes.filter(n => n.id !== f.outside.id); delete removed.dependencies;
  assert.equal(restore(removed, historical, f.branch.id).document, null);
  const cycle = structuredClone(f.doc); model.addDependency(cycle, f.outside.id, f.child.id);
  assert.match(restore(cycle, historical, f.branch.id).conflicts.map(c => c.message).join(' '), /cycle/i);
  const lineage = structuredClone(f.doc); lineage.copyOrigin = { kind: 'personal-copy', sourceId: 'other-map', sourceDigest: 'a'.repeat(64) };
  assert.match(restore(lineage, f.doc, f.branch.id).conflicts.map(c => c.message).join(' '), /lineage/i);
  assert.throws(() => restore(f.doc, { ...f.doc, version: 99 }, f.branch.id), /supported/);
});

test('a retained historical parent must keep its question, kind and parent identity', () => {
  const f = fixture(), historical = structuredClone(f.doc);
  for (const change of [{ question: 'Unrelated reused parent' }, { parentId: f.outside.id }]) {
    const current = structuredClone(historical); current.nodes = current.nodes.filter(n => n.id !== f.child.id);
    Object.assign(current.nodes.find(n => n.id === f.direction.id), change);
    const result = restore(current, historical, f.child.id);
    assert.equal(result.document, null); assert.ok(result.conflicts.some(c => c.id === f.direction.id));
  }
});

test('historical boundary dependency endpoints reject reused or moved outside identities', () => {
  const f = fixture(), historical = structuredClone(f.doc); model.addDependency(historical, f.child.id, f.outside.id);
  for (const change of [{ question: 'Unrelated reused endpoint' }, { parentId: f.branch.id }]) {
    const current = structuredClone(historical); current.nodes = current.nodes.filter(n => n.id !== f.child.id); delete current.dependencies;
    Object.assign(current.nodes.find(n => n.id === f.outside.id), change);
    const result = restore(current, historical, f.child.id);
    assert.equal(result.document, null); assert.ok(result.conflicts.some(c => c.id === f.outside.id));
  }
});

test('retained parent and boundary answers may change and root guidance remains current', () => {
  const f = fixture(), historical = structuredClone(f.doc); model.addDependency(historical, f.child.id, f.outside.id);
  const current = structuredClone(historical); current.nodes = current.nodes.filter(n => n.id !== f.child.id); delete current.dependencies;
  current.nodes.find(n => n.id === f.outside.id).answer = 'Current budget';
  current.nodes.find(n => n.id === f.branch.id).answer = 'Current deployment';
  current.nodes.find(n => n.id === current.rootId).question = 'Current project'; current.topic = 'Current project';
  const result = restore(current, historical, f.child.id);
  assert.deepEqual(result.conflicts, []); assert.deepEqual(result.document.dependencies, historical.dependencies);
  for (const id of [f.outside.id, f.branch.id, current.rootId]) assert.deepEqual(result.document.nodes.find(n => n.id === id), current.nodes.find(n => n.id === id));
  assert.equal(result.document.nodes.find(n => n.id === f.child.id).review, true);
  assert.deepEqual(restore(current, historical, f.branch.id).conflicts, [], 'root question changes do not conflict');
});

test('removing a current descendant with outside dependency links requires explicit correction first', () => {
  const f = fixture(), historical = structuredClone(f.doc), current = structuredClone(historical);
  const [newChild] = model.addQuestions(current, f.child.id, [{ question: 'New reasoning?', category: 'Scope' }]);
  model.addDependency(current, f.outside.id, newChild.id);
  const result = restore(current, historical, f.branch.id);
  assert.equal(result.document, null); assert.match(result.conflicts.map(c => c.message).join(' '), /removed|boundary/i);
});

test('deep restoration traverses iteratively and restores direction subtrees', () => {
  const f = fixture(); let parentId = f.child.id;
  for (let i = 0; i < 4000; i++) { const id = `deep-${i}`; f.doc.nodes.push({ id, parentId, question: 'Detail?', category: 'Scope', answer: '', research: null, review: false }); parentId = id; }
  const current = structuredClone(f.doc); current.nodes = current.nodes.slice(0, 3);
  const result = restore(current, f.doc, f.direction.id); assert.deepEqual(result.conflicts, []);
  assert.equal(result.document.nodes.length, f.doc.nodes.length); assert.equal(result.document.nodes.find(n => n.id === parentId).parentId, 'deep-3998');
});

async function controller(t) {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), 'branch-restore-')), file = join(directory, 'map.explore.json');
  await writeFile(file, JSON.stringify(f.doc));
  const e = await new Explorer({ file, send: async () => {}, target: { instanceId: 'restore-fixture' } }).load();
  t.after(async () => { await e.close(); await rm(directory, { recursive: true, force: true }); });
  const later = structuredClone(e.doc); later.nodes.find(n => n.id === f.child.id).answer = 'Later detail';
  later.nodes.find(n => n.id === f.outside.id).answer = 'Later unrelated answer';
  const [added] = model.addQuestions(later, f.branch.id, [{ question: 'New child?', category: 'Scope' }]);
  await e.save(later);
  const prepare = () => e.branchRestoreRequest({ action: 'prepare', journey: e.doc.id, revision: e.doc.revision, snapshotRevision: 0, nodeId: f.branch.id });
  const commit = token => e.command('restore-branch', { journey: e.doc.id, revision: e.doc.revision, token, confirm: true });
  return { ...f, e, directory, file, added, prepare, commit };
}

test('confirmed branch restoration matches its preview, preserves private drafts/references and has an immutable undo preimage', async t => {
  const f = await controller(t), before = structuredClone(f.e.doc), history = await f.e.history(f.e.doc.id), snapshot = await history.list(before, 0);
  const snapshotPath = join(await history.root(), `${snapshot.hash}.json`), immutable = await readFile(snapshotPath);
  await f.e.writeDraft({ journey: f.e.doc.id, nodeId: f.child.id, base: before.nodes.find(n => n.id === f.child.id), text: 'Private surviving 🌱 draft', answerState: 'assumption', stateSelected: true, revision: 0 });
  await f.e.writeDraft({ journey: f.e.doc.id, nodeId: f.added.id, base: f.added, text: 'Private removed draft', answerState: 'tentative', stateSelected: true, revision: 0 });
  await f.e.writeReferences({ journey: f.e.doc.id, nodeIds: [f.added.id], revision: 0 });
  const preview = await f.prepare(); assert.equal(preview.removed, 1); assert.equal(preview.removedReferences, 1); assert.equal(preview.canRestore, true);
  const expected = restore(before, f.doc, f.branch.id).document;
  await assert.rejects(f.e.command('restore-branch', { journey: f.e.doc.id, revision: f.e.doc.revision, token: preview.token }), /confirm/);
  await f.commit(preview.token);
  assert.deepEqual(f.e.doc.nodes, expected.nodes); assert.equal(f.e.doc.revision, before.revision + 1);
  assert.deepEqual(await readFile(snapshotPath), immutable);
  const drafts = await f.e.readDrafts(f.e.doc.id); assert.equal(drafts.entries.find(n => n.nodeId === f.added.id).orphaned, true);
  assert.equal(drafts.entries.find(n => n.nodeId === f.child.id).stale, true); assert.equal(drafts.entries.find(n => n.nodeId === f.child.id).text, 'Private surviving 🌱 draft');
  assert.deepEqual((await f.e.readReferences(f.e.doc.id)).nodeIds, [f.added.id]);
  assert.equal((await f.e.readHistory(f.e.doc.id)).undoRevision, before.revision);
  await f.e.command('restore', { journey: f.e.doc.id, revision: f.e.doc.revision, snapshotRevision: before.revision });
  assert.deepEqual(f.e.doc.nodes, before.nodes);
});

test('stale map and reference previews, cancelled previews and failed writes preserve current content', async t => {
  const f = await controller(t); let p = await f.prepare();
  await f.e.writeReferences({ journey: f.e.doc.id, nodeIds: [f.child.id], revision: 0 });
  await assert.rejects(f.commit(p.token), /changed|preview/i);
  p = await f.prepare(); await f.e.branchRestoreRequest({ action: 'discard', token: p.token });
  await assert.rejects(f.commit(p.token), /preview/i);
  p = await f.prepare(); const original = await readFile(f.file), commit = f.e.commitCurrentLocked;
  f.e.commitCurrentLocked = async () => { throw Error('Precommit fixture failure'); };
  await assert.rejects(f.commit(p.token), /Precommit fixture/); assert.deepEqual(await readFile(f.file), original);
  f.e.commitCurrentLocked = commit;
  const next = structuredClone(f.e.doc); next.objective = 'Changed while previewing'; await f.e.save(next);
  await assert.rejects(f.commit(p.token), /changed|preview/i);
});

test('pending or staged work blocks restoration, and cancelled callbacks cannot write into restored identities', async t => {
  const f = await controller(t);
  await f.e.command('questions', { revision: f.e.doc.revision, nodeId: f.child.id }); const first = f.e.pending.id;
  await assert.rejects(f.prepare(), /Cancel|pending/i);
  await f.e.receive('questions', { requestId: first, questions: [{ question: 'Pending detail?', category: 'Scope' }] });
  await assert.rejects(f.prepare(), /dismiss|staged/i); await f.e.command('dismiss-questions', { batchId: first });
  await f.e.command('questions', { revision: f.e.doc.revision, nodeId: f.child.id }); const late = f.e.pending.id;
  await f.e.command('cancel'); const p = await f.prepare(); await f.commit(p.token);
  const saved = await readFile(f.file);
  await assert.rejects(f.e.receive('questions', { requestId: late, questions: [{ question: 'Obsolete?', category: 'Scope' }] }), /cancelled|replaced/);
  assert.deepEqual(await readFile(f.file), saved);
});

test('an external write during snapshot validation rejects confirmation', async t => {
  const f = await controller(t), p = await f.prepare(), history = await f.e.history(f.e.doc.id), snapshot = history.snapshot.bind(history);
  let once = true;
  history.snapshot = async row => {
    const result = await snapshot(row);
    if (once) { once = false; const external = JSON.parse(await readFile(f.file, 'utf8')); external.objective = 'External winner'; await writeFile(f.file, JSON.stringify(external)); }
    return result;
  };
  await assert.rejects(f.commit(p.token), /changed|preview|history/i);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).objective, 'External winner');
});

test('final guard follows asynchronous history preparation and preserves an intervening external write', async t => {
  const f = await controller(t), p = await f.prepare(), history = await f.e.history(f.e.doc.id), write = history.write;
  history.write = async (path, value) => {
    await write(path, value);
    if (path.endsWith('intent.json')) { const external = JSON.parse(await readFile(f.file, 'utf8')); external.objective = 'Final boundary winner'; await writeFile(f.file, JSON.stringify(external)); }
  };
  await assert.rejects(f.commit(p.token), /changed|preview|history/i);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).objective, 'Final boundary winner');
});

test('damaged snapshots block confirmation without overwriting the saved map', async t => {
  const f = await controller(t), p = await f.prepare(), history = await f.e.history(f.e.doc.id), row = await history.list(f.e.doc, 0), original = await readFile(f.file);
  await writeFile(join(await history.root(), `${row.hash}.json`), '{}');
  await assert.rejects(f.commit(p.token), /snapshot|damaged|history/i); assert.deepEqual(await readFile(f.file), original);
});

test('returning to the same journey does not revive a previous branch restore token', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'branch-restore-binding-')), library = new Library(directory), f = fixture();
  const a = await library.import(f.doc), b = await library.import(model.createDocument('Other journey'));
  const e = await new Explorer({ library, binding: 'branch-restore' }).load();
  t.after(async () => { await e.close(); await rm(directory, { recursive: true, force: true }); });
  await e.attach(a.key); const next = structuredClone(e.doc); next.nodes.find(n => n.id === f.child.id).answer = 'Later'; await e.save(next);
  const p = await e.branchRestoreRequest({ action: 'prepare', journey: e.activeKey, revision: e.doc.revision, snapshotRevision: 0, nodeId: f.branch.id });
  await e.attach(b.key); await e.attach(a.key);
  await assert.rejects(e.command('restore-branch', { journey: e.activeKey, revision: e.doc.revision, token: p.token, confirm: true }), /preview/);
});

test('restoration HTTP requires write Origin, validates page selection and returns exact paged change detail', async t => {
  const f = await controller(t), server = await startServer(f.e); t.after(() => server.close());
  const post = (value, origin = true) => fetch(new URL('api/branch-restore', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...(origin ? { Origin: new URL(server.url).origin } : {}) }, body: JSON.stringify(value) });
  const request = { action: 'prepare', journey: f.e.doc.id, revision: f.e.doc.revision, snapshotRevision: 0, nodeId: f.branch.id };
  assert.equal((await post(request, false)).status, 403);
  const response = await post(request); assert.equal(response.status, 200); const p = await response.json();
  assert.ok(p.items.length); assert.ok(p.selected.data.before || p.selected.data.after);
  const page = await post({ action: 'page', token: p.token, page: 0, selected: 999999 }); assert.equal(page.status, 400);
  assert.equal((await post({ ...request, document: {} })).status, 400);
});

test('paged restoration preview exposes every removal and each selected exact preimage', async t => {
  const f = await controller(t), next = structuredClone(f.e.doc);
  for (let i = 0; i < 55; i++) next.nodes.push({ id: `later-${i}`, parentId: f.branch.id, question: `Later ${i}?`, category: 'Scope', answer: `Exact ${i}`, research: null, review: false });
  await f.e.save(next); const p = await f.prepare(); assert.equal(p.items.length, 50); assert.ok(p.total > 50);
  const last = await f.e.branchRestoreRequest({ action: 'page', token: p.token, page: 1, selected: null });
  const indices = [...p.items, ...last.items].map(item => item.index); assert.equal(new Set(indices).size, p.total);
  const detail = await f.e.branchRestoreRequest({ action: 'page', token: p.token, page: 1, selected: last.items.at(-1).index });
  assert.equal(detail.selected.data.before.answer, 'Exact 54'); assert.equal(detail.selected.data.after, null);
});
