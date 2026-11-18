import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { ProjectJourney } from '../com.github.copilot/extensions/explorer/project-journey.mjs';
import { projectStorageContext } from '../com.github.copilot/extensions/explorer/storage-context.mjs';
import { createDocument, addQuestions, contextFor } from '../com.github.copilot/extensions/explorer/model.mjs';
import { readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { mergeSharedDocuments } from '../com.github.copilot/extensions/explorer/semantic-merge.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { changeComments } from '../com.github.copilot/extensions/explorer/comments.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-review-handoff-flow-')), writers = [], doc = createDocument('Review a branch');
  addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Choice' }]); doc.nodes[1].answer = 'Unverified premise'; doc.nodes[1].answerState = 'assumption'; doc.nodes[1].review = true; doc.finishedAt = doc.updatedAt;
  t.after(async () => { for (const e of writers) await e.close(); await rm(root, { recursive: true, force: true }); });
  async function writer(name, bytes) {
    const checkoutDirectory = join(root, name, 'checkout'), localDirectory = join(root, name, 'private'), file = join(checkoutDirectory, 'map.explore.json'); await mkdir(checkoutDirectory, { recursive: true });
    const context = await projectStorageContext({ checkoutDirectory, file, localDirectory, journeyId: doc.id }), store = new ProjectJourney(context);
    if (bytes) { await writeFile(file, bytes); await store.load(); } else await store.create(doc);
    const calls = [], e = new Explorer({ library: new Library(localDirectory), binding: 'PRIVATE_SESSION', target: 'PRIVATE_TARGET', send(...args) { calls.push(args); } });
    await e.attachProject(store); writers.push(e); return { e, file, context, calls };
  }
  return { root, writer };
}
const binding = e => ({ journey: e.activeKey, revision: e.doc.revision });
const first = e => e.doc.reviewHandoffs.records[0];
const create = e => ({ ...binding(e), id: randomUUID(), transitionId: randomUUID(), scope: { kind: 'branch', nodeId: e.doc.nodes[1].id }, recipient: 'RECIPIENT_CANARY', note: 'HANDOFF_CANARY λ <script>', unresolvedIds: [e.doc.nodes[1].id] });
const change = (e, extra = {}) => ({ ...binding(e), id: first(e).id, transitionId: randomUUID(), note: '', ...extra });
const choose = (e, name) => e.contributorSettingsRequest({ action: 'save', displayName: name, revision: 0 });

test('shared review handoffs survive clone/pull, explicit ownership changes and exact retries without decision or model actions', async t => {
  const f = await fixture(t), a = await f.writer('alice'), original = structuredClone(a.e.doc); await choose(a.e, 'Alice λ');
  const input = create(a.e); await a.e.command('review-handoff-create', input); const bytes = await readFile(a.file), revision = a.e.doc.revision;
  await a.e.command('review-handoff-create', { ...input, ...binding(a.e) }); assert.deepEqual(await readFile(a.file), bytes); assert.equal(a.e.doc.revision, revision);
  const b = await f.writer('bob', bytes); await choose(b.e, 'Bob 日本語');
  await b.e.command('review-handoff-take', change(b.e, { note: 'Investigating' })); assert.equal(b.e.uiSnapshot().reviewHandoffs[input.id].owner.displayName, 'Bob 日本語');
  await b.e.command('review-handoff-complete', change(b.e, { note: 'Investigation complete; premise is still unverified' }));
  const pulled = await f.writer('pulled', await readFile(b.file)); await pulled.e.command('review-handoff-reassign', change(pulled.e, { recipient: null, note: 'Another investigation' }));
  assert.equal(first(pulled.e).transitions[0].event.actor.displayName, 'Alice λ'); assert.equal(first(pulled.e).transitions.at(-1).event.actor, null);
  assert.equal(pulled.e.uiSnapshot().reviewHandoffs[input.id].state, 'requested'); assert.equal(pulled.e.uiSnapshot().reviewHandoffs[input.id].recipient, null);
  assert.deepEqual(pulled.e.doc.nodes, original.nodes); assert.equal(pulled.e.doc.finishedAt, original.finishedAt); assert.deepEqual([...a.calls, ...b.calls, ...pulled.calls], []);
  assert.doesNotMatch(JSON.stringify(contextFor(pulled.e.doc, original.nodes[1].id)), /HANDOFF_CANARY|RECIPIENT_CANARY|Investigating|PRIVATE_SESSION|PRIVATE_TARGET/);
  const view = pulled.e.uiSnapshot(); view.reviewHandoffs[input.id].state = 'complete'; assert.equal(pulled.e.uiSnapshot().reviewHandoffs[input.id].state, 'requested');
});

test('concurrent responsibility changes require whole-record choice and keep each original candidate intact', async t => {
  const f = await fixture(t), a = await f.writer('a'); await a.e.command('review-handoff-create', create(a.e)); const bytes = await readFile(a.file), b = await f.writer('b', bytes);
  await choose(a.e, 'Alice'); await choose(b.e, 'Bob'); await a.e.command('review-handoff-reassign', change(a.e, { recipient: 'Unmatched reviewer', note: 'Local note' })); await b.e.command('review-handoff-complete', change(b.e, { note: 'Incoming note' }));
  const sources = [bytes, await readFile(a.file), await readFile(b.file)].map(bytes => readSharedDocument(bytes).document), id = `handoff-record:${first(a.e).id}`;
  assert.deepEqual(mergeSharedDocuments(...sources).unresolved, [id]); const merged = mergeSharedDocuments(...sources, { [id]: 'incoming' });
  const pulled = await f.writer('merged', JSON.stringify(merged.document)); assert.equal(first(pulled.e).transitions.at(-1).note, 'Incoming note'); assert.equal(pulled.e.uiSnapshot().reviewHandoffs[first(pulled.e).id].state, 'complete');
  assert.equal(first(a.e).transitions.at(-1).note, 'Local note');
});

test('native exploration reads omit shared review notes while UI snapshots and saved files retain them', async t => {
  const f = await fixture(t), { e, file } = await f.writer('one'); await e.command('review-handoff-create', create(e));
  await e.save(changeComments(e.doc, 'create', { nodeId: e.doc.nodes[1].id, threadId: randomUUID(), messageId: randomUUID(), text: 'COMMENT_NATIVE_CANARY', suggestion: 'SUGGESTION_NATIVE_CANARY' }, { actor: null, at: '2026-11-18T12:00:00.000Z' }));
  const bytes = await readFile(file), native = await e.nativeSnapshot();
  assert.doesNotMatch(JSON.stringify(native), /HANDOFF_CANARY|RECIPIENT_CANARY|COMMENT_NATIVE_CANARY|SUGGESTION_NATIVE_CANARY/);
  assert.deepEqual(native.document.nodes, e.doc.nodes); assert.ok(e.uiSnapshot().document.reviewHandoffs); assert.ok(e.uiSnapshot().document.comments); assert.deepEqual(await readFile(file), bytes);
});

test('handoff commands reject stale, wrong-journey, forged, personal and corrupt-identity requests without altering saved bytes', async t => {
  const f = await fixture(t), { e, file } = await f.writer('one'), bytes = await readFile(file), input = create(e);
  for (const extra of [{ actor: { id: randomUUID(), displayName: 'Forged' } }, { at: new Date().toISOString() }, { source: {} }, { revision: -1 }, { journey: 'other' }, { extra: true }]) await assert.rejects(e.command('review-handoff-create', { ...input, ...extra }));
  assert.deepEqual(await readFile(file), bytes);
  const personalFile = join(f.root, 'personal.json'); await writeFile(personalFile, JSON.stringify(e.doc)); const personal = await new Explorer({ file: personalFile }).load(); t.after(() => personal.close());
  await assert.rejects(personal.command('review-handoff-create', { ...input, journey: personal.doc.id }), /shared|project/i); assert.equal(personal.doc.reviewHandoffs, undefined);
  await writeFile(join(e.library.directory, 'contributor-settings.json'), '{broken'); await assert.rejects(e.command('review-handoff-create', input), /preserved/); assert.deepEqual(await readFile(file), bytes);
});

test('failed writes, external changes and orphan branches preserve handoff notes and private answer drafts', async t => {
  const f = await fixture(t), { e, file, context } = await f.writer('one'), input = create(e);
  await e.writeDraft({ journey: e.activeKey, nodeId: input.scope.nodeId, base: e.doc.nodes[1], text: 'PRIVATE_DRAFT', revision: 0 });
  const bytes = await readFile(file), write = e.projectStore.write; e.projectStore.write = async () => { throw Error('disk full'); };
  await assert.rejects(e.command('review-handoff-create', input), /disk full/); assert.deepEqual(await readFile(file), bytes); assert.equal(e.doc.reviewHandoffs, undefined);
  e.projectStore.write = write; await e.command('review-handoff-create', input);
  const orphan = structuredClone(e.doc); orphan.nodes.splice(1, 1); await e.save(orphan); assert.equal(e.uiSnapshot().reviewHandoffs[input.id].context, 'orphaned');
  await e.command('review-handoff-complete', change(e)); assert.equal((await e.readDrafts(e.activeKey)).entries[0].text, 'PRIVATE_DRAFT');
  const other = await new ProjectJourney(context).load(), newer = structuredClone(other.document); newer.objective = 'External change'; await other.save(newer, { baseDigest: other.baseDigest }); const winning = await readFile(file);
  await assert.rejects(e.command('review-handoff-reassign', change(e, { recipient: null })), /changed|refresh/i); assert.deepEqual(await readFile(file), winning);
});

test('handoff HTTP actions require exact origin and client identity and distinguish absent from committed submissions', async t => {
  const f = await fixture(t), { e } = await f.writer('one'), server = await startServer(e); t.after(() => server.close()); const url = new URL('api/action', server.url), input = create(e);
  const post = (body, headers = { origin: url.origin, 'x-explorer-client': '1' }) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  for (const headers of [{ origin: url.origin }, { 'x-explorer-client': '1' }, { origin: 'https://evil.test', 'x-explorer-client': '1' }]) assert.equal((await post({ action: 'review-handoff-create', ...input }, headers)).status, 403);
  const absent = await post({ action: 'review-handoff-create', ...input, recipient: '   ' }); assert.equal(absent.status, 400); assert.equal((await absent.json()).handoffSubmission, 'absent');
  const save = e.projectStore.saveLocked.bind(e.projectStore); e.projectStore.saveLocked = async (...args) => { await save(...args); throw Error('History finalization failed'); };
  const committed = await post({ action: 'review-handoff-create', ...input }); assert.equal(committed.status, 400); assert.equal((await committed.json()).handoffSubmission, 'present'); assert.equal(first(e).transitions[0].id, input.transitionId);
  e.projectStore.saveLocked = save; const retry = await post({ action: 'review-handoff-create', ...input, ...binding(e) }); assert.equal(retry.status, 200); assert.equal(first(e).transitions.length, 1);
  const take = change(e); e.projectStore.saveLocked = async (...args) => { await save(...args); throw Error('History failed after taking'); };
  const taken = await post({ action: 'review-handoff-take', ...take }); assert.equal((await taken.json()).handoffSubmission, 'present'); e.projectStore.saveLocked = save;
  assert.equal((await post({ action: 'review-handoff-take', ...take, ...binding(e) })).status, 200); assert.equal(first(e).transitions.length, 2);
});
