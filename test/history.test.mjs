import { startResearch } from './helpers/research-review.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-history-')), file = join(dir, 'map.explore.json');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const doc = createDocument('History'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }]);
  await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file, send: async () => {} }).load(); t.after(() => e.close());
  const command = (action, input = {}) => e.command(action, { revision: e.doc.revision, journey: e.doc.id, ...input });
  return { dir, file, e, command };
}
test('history starts honestly, preserves committed content, checkpoints and monotonic undoable restores', async t => {
  const { e, command } = await fixture(t), original = structuredClone(e.doc);
  assert.equal((await e.readHistory(e.doc.id)).entries.length, 0);
  await command('answer', { nodeId: e.doc.nodes[1].id, answer: '  Exact ??\n', answerState: 'assumption' });
  const list = await e.readHistory(e.doc.id); assert.equal(list.entries.length, 1); assert.equal(list.undoRevision, 0);
  assert.equal(list.entries[0].label, 'Initial saved version');
  await command('checkpoint', { name: 'Choice', snapshotRevision: e.doc.revision });
  await command('guidance', { objective: 'Learn', successCriteria: '' });
  const selected = await e.readHistory(e.doc.id, 1); assert.equal(selected.document.nodes[1].answer, '  Exact ??\n');
  await command('restore', { snapshotRevision: 0 }); assert.equal(e.doc.nodes[1].answer, ''); assert.equal(e.doc.revision, 3); assert.equal(e.doc.id, original.id);
  await command('restore', { snapshotRevision: 1 }); assert.equal(e.doc.nodes[1].answerState, 'assumption'); assert.equal(e.doc.revision, 4);
  const final = await e.readHistory(e.doc.id); assert.equal(final.undoRevision, 3); assert.deepEqual(final.entries.find(r => r.revision === 1).checkpoints, ['Choice']);
});
test('history no-op checks disk freshness and stale restore rejects unrelated edits', async t => {
  const { e, file, command } = await fixture(t), other = await new Explorer({ file }).load();
  await command('answer', { nodeId: e.doc.nodes[1].id, answer: '' }); assert.equal((await e.readHistory(e.doc.id)).entries.length, 0);
  await other.command('guidance', { revision: 0, objective: 'Other canvas', successCriteria: '' });
  await assert.rejects(command('restore', { snapshotRevision: 0 }), /canvas|changed/i);
  await assert.rejects(command('answer', { nodeId: e.doc.nodes[1].id, answer: '' }), /canvas|changed/i);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).objective, 'Other canvas');
});
import { History, HISTORY_LIMITS } from '../com.github.copilot/extensions/explorer/history.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';
import { draftHash } from '../com.github.copilot/extensions/explorer/drafts.mjs';
import { readdir, unlink, symlink } from 'node:fs/promises';

async function service(t) {
  const f = await fixture(t), key = draftHash('isolated-history'), history = new History(f.dir, key, f.e.doc.id);
  let current = structuredClone(f.e.doc);
  const commit = async (label = 'Answer changed') => {
    const next = structuredClone(current); next.revision++; next.objective = `Revision ${next.revision}`; next.updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString();
    await history.commit(current, next, label, async () => { await atomicWrite(f.file, JSON.stringify(next)); current = next; });
  };
  return { ...f, history, commit, current: () => current };
}
test('history interrupted writes reconcile before and after the document commit point without invented transitions', async t => {
  for (const stage of ['snapshot', 'baseline', 'intent', 'document', 'final']) {
    const f = await service(t); let failed = false, manifestWrites = 0;
    f.history.write = async (path, data) => {
      if (path.endsWith('manifest.json')) manifestWrites++;
      const match = stage === 'snapshot' && /[a-f0-9]{64}\.json$/.test(path) || stage === 'baseline' && path.endsWith('manifest.json') && manifestWrites === 1 || stage === 'intent' && path.endsWith('intent.json') || stage === 'final' && path.endsWith('manifest.json') && manifestWrites === 2;
      if (match && !failed) { failed = true; throw new Error('Injected storage failure'); }
      await atomicWrite(path, data);
    };
    if (stage === 'document') {
      const next = structuredClone(f.current()); next.revision++; next.objective = 'Lost write';
      await assert.rejects(f.history.commit(f.current(), next, 'Guidance changed', async () => { throw new Error('Injected document failure'); }), /Injected/);
    } else await assert.rejects(f.commit(), stage === 'final' ? /Map saved.*finalization failed/ : /Injected/);
    f.history.write = atomicWrite;
    const recovered = new History(f.dir, f.history.key, f.current().id), list = await recovered.list(f.current());
    assert.equal(list.entries.length, stage === 'final' ? 1 : 0, stage);
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).revision, stage === 'final' ? 1 : 0);
    await f.commit(); assert.equal((await f.history.list(f.current())).undoRevision, f.current().revision - 1);
  }
});
test('history exact retention and checkpoint name/count limits preserve protected immutable revisions', async t => {
  const f = await service(t);
  assert.deepEqual(HISTORY_LIMITS, { revisions: 50, bytes: 134217728, checkpoints: 10, name: 120 });
  await f.history.checkpoint(f.current(), 0, 'x'.repeat(120));
  await assert.rejects(f.history.checkpoint(f.current(), 0, 'x'.repeat(121)), /1.*120/);
  await assert.rejects(f.history.checkpoint(f.current(), 0, ''), /1.*120/);
  await assert.rejects(f.history.checkpoint(f.current(), 0, ' '), /1.*120/);
  for (let i = 1; i < 10; i++) await f.history.checkpoint(f.current(), 0, String(i));
  await assert.rejects(f.history.checkpoint(f.current(), 0, '11'), /10/);
  for (let i = 0; i < 52; i++) await f.commit();
  const list = await f.history.list(f.current()); assert.equal(list.entries.length, 50); assert.equal(list.oldestRevision, 0); assert.equal(list.entries.at(-1).checkpoints.length, 10);
  assert.equal(list.entries.some(r => r.revision === 1), false); assert.equal((await f.history.list(f.current(), 0)).document.objective, '');
  await f.history.checkpoint(f.current(), 0, '1', true); await f.history.checkpoint(f.current(), 52, 'Replacement');
  assert.equal((await f.history.list(f.current())).entries.length, 50);
});
test('history retention applies exact byte boundary and refuses to prune protected content', async t => {
  const f = await service(t), value = f.history.initial(f.current()), row = value.head;
  // Planner uses declared, validated snapshot byte sizes; no enormous test buffers are needed.
  value.head = { ...row, revision: 20 };
  value.entries = Array.from({ length: 16 }, (_, i) => ({ ...row, revision: i, bytes: 8 * 1024 * 1024, checkpoints: [] }));
  value.undoRevision = 15;
  assert.equal(f.history.prune(structuredClone(value), 15).entries.length, 16);
  value.entries[15].bytes++;
  assert.equal(f.history.prune(structuredClone(value), 15).entries.length, 15);
  value.entries.forEach((r, i) => { r.checkpoints = [String(i)]; });
  assert.throws(() => f.history.prune(value, 15), /protected named checkpoints/);
});
test('history missing manifests, corrupt snapshots and unsafe paths are preserved and rejected', async t => {
  const f = await service(t); await f.commit();
  const root = await f.history.root(), list = await f.history.list(f.current()), snapshot = join(root, `${list.entries[0].hash}.json`);
  await writeFile(snapshot, '{ damaged');
  await assert.rejects(f.history.list(f.current()), /History recovery required/); assert.equal(await readFile(snapshot, 'utf8'), '{ damaged');
  await unlink(join(root, 'manifest.json'));
  await assert.rejects(f.history.list(f.current()), /History recovery required/);
  assert.throws(() => new History(f.dir, '../escape', f.current().id), /identity/);
});
test('history missing manifest never treats intact recorded snapshots as uncommitted garbage', async t => {
  const f = await service(t); await f.commit(); const root = await f.history.root();
  const files = await readdir(root); await unlink(join(root, 'manifest.json'));
  await assert.rejects(f.history.list(f.current()), /manifest|recovery/i);
  assert.ok((await readdir(root)).includes(files.find(name => /^[a-f0-9]{64}\.json$/.test(name))));
});
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { MAX_DOCUMENT_BYTES, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
const findings = { basis: 'reasoning', summary: 'Compare choices', options: [{ title: 'A', description: 'First', pros: [], cons: [] }, { title: 'B', description: 'Second', pros: [], cons: [] }], recommendation: 'Try A', uncertainty: 'No sources consulted', sources: [] };

test('history covers supported mutations and restores sourced provenance without drafts or pending callbacks', async t => {
  const { e, command } = await fixture(t), initial = e.doc.revision, nodeId = e.doc.nodes[1].id;
  await command('answer', { nodeId, answer: '  My decision ??\n', answerState: 'decided' });
  await command('add', { nodeId, question: 'Then what?', category: 'Follow-up' });
  await command('questions', { nodeId }); const requestId = e.pending.id;
  await assert.rejects(command('restore', { snapshotRevision: initial }), /cancel/i);
  await e.receive('questions', { requestId, questions: [{ question: 'Generated?', category: 'Scope' }] });
  await e.command('accept-questions', { revision: e.doc.revision, batchId: e.preview.id, selected: e.preview.questions.map((q, index) => ({ index, question: q.question })) });
  const sourced = { ...findings, basis: 'sources', sources: [{ title: 'Evidence', url: 'https://example.com/evidence' }] };
  e.researcher = { run: async () => sourced }; await startResearch(e, { nodeId }); await Promise.all([...e.researchTasks]);
  const sourcedRevision = e.doc.revision;
  e.researcher = { run: async () => findings }; await startResearch(e, { nodeId }); await Promise.all([...e.researchTasks]);
  await command('guidance', { objective: '  Objective ??', successCriteria: 'Done' });
  await command('finish');
  const labels = (await e.readHistory(e.doc.id)).entries.map(r => r.label);
  for (const label of ['Answer or state changed', 'Question added', 'Questions accepted', 'Research replaced', 'Guidance changed']) assert.ok(labels.includes(label), label);
  await command('questions', { nodeId }); const late = e.pending.id; await command('cancel');
  await command('restore', { snapshotRevision: sourcedRevision });
  assert.deepEqual(e.doc.nodes[1].research, { ...sourced, settings: { depth: 'standard', sourceFocus: 'balanced', recency: 'any' } }); assert.equal(e.doc.nodes[1].answer, '  My decision ??\n');
  await assert.rejects(e.receive('questions', { requestId: late, questions: [{ question: 'Late?', category: 'Scope' }] }), /cancelled/);
  const imported = structuredClone(e.doc); imported.objective = 'Same-ID import'; await command('import', { document: imported });
  assert.equal((await e.readHistory(e.doc.id)).current.label, 'Imported saved map');
  const before = e.doc.revision; await command('import', { document: structuredClone(e.doc) }); assert.equal(e.doc.revision, before);
});
test('history isolates same-ID files, independent library copies and direct-file identity replacements', async t => {
  const { e, dir, file, command } = await fixture(t), original = structuredClone(e.doc);
  const otherFile = join(dir, 'other.explore.json'); await writeFile(otherFile, JSON.stringify(original));
  const other = await new Explorer({ file: otherFile }).load();
  await command('guidance', { objective: 'First only', successCriteria: '' });
  assert.equal((await other.readHistory(other.doc.id)).entries.length, 0);
  const library = new Library(dir), entries = (await library.list()).entries;
  const first = await new Explorer({ library, binding: 'first' }).load(); await first.command('open', { key: entries.find(row => row.topic === original.topic).key });
  const copy = await library.import(original, { asCopy: true }), second = await new Explorer({ library, binding: 'second' }).load(); await second.command('open', { key: copy.key });
  assert.equal((await second.readHistory(second.activeKey)).entries.length, 0);
  const id = e.doc.id, oldKey = (await e.history(id)).key;
  const replacement = createDocument('New identity'); await command('import', { document: replacement });
  assert.notEqual((await e.history(e.doc.id)).key, oldKey); assert.equal((await e.readHistory(e.doc.id)).entries.length, 0);
  assert.ok((await readdir(join(dir, 'history', oldKey))).includes('manifest.json'));
  const reopened = await new Explorer({ file }).load(); assert.equal((await reopened.readHistory(reopened.doc.id)).entries.length, 0);
  await assert.rejects(e.readHistory(id), /active journey changed/);
});
test('history near-limit valid maps prune actual snapshot bytes and restore legacy defaults', async t => {
  const f = await service(t), doc = f.current();
  for (let i = 0; i < 470; i++) doc.nodes.push({ id: `large-${i}`, parentId: doc.rootId, question: `Question ${i}`, category: 'Scope', answer: 'x'.repeat(19500), research: null, review: false });
  let remaining = MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(doc, null, 2)) - 300;
  for (const node of doc.nodes.slice(2)) { const extra = Math.min(20000 - node.answer.length, remaining); node.answer += 'x'.repeat(extra); remaining -= extra; if (!remaining) break; }
  delete doc.objective; delete doc.successCriteria;
  await atomicWrite(f.file, JSON.stringify(doc));
  assert.ok(Buffer.byteLength(JSON.stringify(validateDocument(doc), null, 2)) > MAX_DOCUMENT_BYTES - 500);
  for (let i = 0; i < 16; i++) await f.commit();
  const list = await f.history.list(f.current());
  assert.equal(list.entries.length, 14); assert.ok(list.bytes <= HISTORY_LIMITS.bytes); assert.ok(list.bytes + list.entries[0].bytes > HISTORY_LIMITS.bytes);
  const oldest = await f.history.list(f.current(), list.oldestRevision); assert.equal(oldest.document.nodes[2].answer, doc.nodes[2].answer); assert.equal(oldest.document.successCriteria, '');
});
test('history checkpoint failure before manifest leaves no named checkpoint and allows retry', async t => {
  const f = await service(t); let snapshotsWritten = false;
  f.history.write = async (path, data) => {
    if (/\b[a-f0-9]{64}\.json$/.test(path)) snapshotsWritten = true;
    if (snapshotsWritten && path.endsWith('manifest.json')) throw new Error('Checkpoint manifest failure');
    return atomicWrite(path, data);
  };
  await assert.rejects(f.history.checkpoint(f.current(), 0, 'Failed name'), /failure/);
  f.history.write = atomicWrite;
  assert.equal((await f.history.list(f.current())).entries.length, 0);
  await f.history.checkpoint(f.current(), 0, 'Retry'); assert.equal((await f.history.list(f.current())).entries[0].checkpoints[0], 'Retry');
});
test('history repeated identical restore reports already matching after freshness checks without inventing revisions', async t => {
  const { e, command } = await fixture(t);
  await command('guidance', { objective: 'New choice', successCriteria: '' });
  await command('restore', { snapshotRevision: 0 }); const revision = e.doc.revision;
  const preview = await e.readHistory(e.doc.id, 0); assert.equal(preview.preview.matchesCurrent, true);
  const result = await command('restore', { snapshotRevision: 0 });
  assert.equal(e.doc.revision, revision); assert.match(result.error, /already matches/i);
});
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
test('history HTTP validates requested revisions and requires exact write origin without leaking snapshots into polling', async t => {
  const { e, command } = await fixture(t); await command('guidance', { objective: 'Changed', successCriteria: '' });
  const server = await startServer(e, { close() {} }); t.after(() => server.close());
  const url = new URL('api/action', server.url), payload = JSON.stringify({ action: 'restore', journey: e.doc.id, revision: e.doc.revision, snapshotRevision: 0 });
  const rejected = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: payload }); assert.equal(rejected.status, 403);
  assert.equal((await fetch(new URL(`api/history?journey=${e.doc.id}&snapshotRevision=../0`, server.url))).status, 400);
  const summary = await (await fetch(new URL(`api/history?journey=${e.doc.id}`, server.url))).json(); assert.ok(summary.entries.every(row => !Object.hasOwn(row, 'document')));
  const state = await (await fetch(new URL('api/state', server.url))).json(); assert.equal(state.history, undefined); assert.equal(state.entries, undefined);
  const restored = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: url.origin }, body: payload }); assert.equal(restored.status, 200);
});
test('controller reports a saved document when history finalization fails and safely retries under its writer lock', async t => {
  const { e, command, file } = await fixture(t), history = await e.history(e.doc.id); let manifests = 0;
  history.write = async (path, data) => { if (path.endsWith('manifest.json') && ++manifests === 2) throw new Error('Rename failed'); return atomicWrite(path, data); };
  await assert.rejects(command('guidance', { objective: 'Saved despite finalization failure', successCriteria: '' }), /Map saved.*history finalization/);
  assert.equal(e.doc.revision, 1); assert.equal(JSON.parse(await readFile(file, 'utf8')).objective, e.doc.objective);
  history.write = atomicWrite;
  const reopened = await new Explorer({ file }).load(); assert.equal((await reopened.readHistory(reopened.doc.id)).undoRevision, 0);
  await command('guidance', { objective: 'Retry after recovery', successCriteria: '' }); assert.equal(e.doc.revision, 2);
});
test('history rejects snapshot identity and schema tampering and preserves interrupted intent on an unknown active outcome', async t => {
  for (const change of ['identity', 'schema', 'revision', 'intent']) {
    const f = await service(t); await f.commit(); const root = await f.history.root();
    const value = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), row = value.entries[0];
    if (change === 'intent') {
      await writeFile(join(root, 'intent.json'), JSON.stringify({ version: 1, before: row.hash, after: 'a'.repeat(64), manifest: value }));
    } else {
      const snapshot = JSON.parse(await readFile(join(root, `${row.hash}.json`), 'utf8'));
      if (change === 'identity') snapshot.id = 'Different journey'; else if (change === 'revision') snapshot.revision = -1; else snapshot.nodes[1].answerState = 'not-a-state';
      const data = JSON.stringify(snapshot, null, 2); row.hash = draftHash(data); row.bytes = Buffer.byteLength(data);
      await writeFile(join(root, `${row.hash}.json`), data); await writeFile(join(root, 'manifest.json'), JSON.stringify(value));
    }
    await assert.rejects(f.history.list(f.current()), /History recovery required/);
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).revision, 1);
    assert.ok((await readdir(root)).includes(change === 'intent' ? 'intent.json' : `${row.hash}.json`));
  }
});
test('history refuses linked directories without writing outside the journey root', async t => {
  const f = await service(t), outside = await mkdtemp(join(tmpdir(), 'explorer-history-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(f.dir, 'history'), 'junction');
  await assert.rejects(f.history.list(f.current()), /History recovery required/);
  assert.deepEqual(await readdir(outside), []);
});
test('history validates compatible legacy snapshots at preview and restore with current defaults', async t => {
  const { e, command } = await fixture(t); await command('guidance', { objective: 'New objective', successCriteria: '' });
  const history = await e.history(e.doc.id), root = await history.root(), value = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')), row = value.entries[0];
  const snapshot = JSON.parse(await readFile(join(root, `${row.hash}.json`), 'utf8')); delete snapshot.objective; delete snapshot.successCriteria;
  const data = JSON.stringify(snapshot, null, 2); row.hash = draftHash(data); row.bytes = Buffer.byteLength(data);
  await writeFile(join(root, `${row.hash}.json`), data); await writeFile(join(root, 'manifest.json'), JSON.stringify(value));
  const preview = await e.readHistory(e.doc.id, 0); assert.equal(preview.document.objective, '');
  await command('restore', { snapshotRevision: 0 }); assert.equal(e.doc.objective, ''); assert.equal(e.doc.successCriteria, ''); assert.equal(e.doc.revision, 2);
});
test('history cleanup debt blocks further commits until obsolete snapshots can be removed', async t => {
  const f = await service(t); for (let i = 0; i < 50; i++) await f.commit();
  const cleanup = f.history.cleanup.bind(f.history); f.history.cleanup = async value => { if (value.head.revision >= 51) throw new Error('Injected cleanup failure'); return cleanup(value); };
  await assert.rejects(f.commit(), /Map saved.*history finalization/); assert.equal(f.current().revision, 51);
  const snapshots = async () => (await readdir(await f.history.root())).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
  assert.equal((await snapshots()).length, 51);
  for (let i = 0; i < 3; i++) await assert.rejects(f.commit(), /History recovery required/);
  assert.equal(f.current().revision, 51); assert.equal((await snapshots()).length, 51);
  f.history.cleanup = cleanup; assert.equal((await f.history.list(f.current())).entries.length, 50); assert.equal((await snapshots()).length, 50);
  await f.commit(); assert.equal((await snapshots()).length, 50);
});
test('history validates cached row metadata and current head before committing', async t => {
  for (const part of ['head', 'entry']) {
    const f = await service(t); await f.commit(); await f.history.list(f.current());
    const root = await f.history.root(), manifest = join(root, 'manifest.json'), value = JSON.parse(await readFile(manifest, 'utf8'));
    (part === 'head' ? value.head : value.entries[0]).time = '2020-01-01T00:00:00.000Z';
    await writeFile(manifest, JSON.stringify(value));
    await assert.rejects(f.commit(), /History recovery required/); assert.equal(f.current().revision, 1);
  }
});
test('history checkpoint cleanup failure reports the committed checkpoint and retries safely', async t => {
  const f = await service(t), cleanup = f.history.cleanup.bind(f.history); let calls = 0;
  f.history.cleanup = async value => { if (++calls === 2) throw new Error('Cleanup unavailable'); return cleanup(value); };
  await assert.rejects(f.history.checkpoint(f.current(), 0, 'Saved checkpoint'), /Checkpoint updated.*cleanup failed/);
  f.history.cleanup = cleanup; assert.deepEqual((await f.history.list(f.current())).entries[0].checkpoints, ['Saved checkpoint']);
});
