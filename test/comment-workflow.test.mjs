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
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { mergeSharedDocuments } from '../com.github.copilot/extensions/explorer/semantic-merge.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-comment-flow-')), writers = [], doc = createDocument('Review together');
  addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Decision' }]); doc.finishedAt = doc.updatedAt;
  t.after(async () => { for (const e of writers) await e.close(); await rm(root, { recursive: true, force: true }); });
  async function writer(name, bytes) {
    const checkoutDirectory = join(root, name, 'checkout'), localDirectory = join(root, name, 'private'), file = join(checkoutDirectory, 'map.explore.json');
    await mkdir(checkoutDirectory, { recursive: true });
    const context = await projectStorageContext({ checkoutDirectory, file, localDirectory, journeyId: doc.id }), store = new ProjectJourney(context);
    if (bytes) { await writeFile(file, bytes); await store.load(); } else await store.create(doc);
    const calls = [], e = new Explorer({ library: new Library(localDirectory), binding: 'PRIVATE_SESSION', target: 'PRIVATE_TARGET', send(...args) { calls.push(args); } });
    await e.attachProject(store); writers.push(e); return { e, file, context, calls };
  }
  return { root, writer };
}
const input = e => ({ journey: e.activeKey, revision: e.doc.revision });
const create = e => ({ ...input(e), nodeId: e.doc.nodes[1].id, threadId: randomUUID(), messageId: randomUUID(), text: 'COMMENT_CANARY λ <script>', suggestion: 'SUGGESTION_CANARY' });
const thread = e => e.doc.comments.threads[0];
const choose = (e, name) => e.contributorSettingsRequest({ action: 'save', displayName: name, revision: 0 });

test('shared comments survive two-contributor handoff, explicit resolution and idempotent retry without changing decisions', async t => {
  const f = await fixture(t), a = await f.writer('alice'), initial = await readFile(a.file), savedNodes = structuredClone(a.e.doc.nodes), finishedAt = a.e.doc.finishedAt;
  await choose(a.e, 'Alice λ'); assert.deepEqual(await readFile(a.file), initial); assert.equal(a.e.doc.comments, undefined);
  const post = create(a.e); await a.e.command('comment-create', post); const first = await readFile(a.file), revision = a.e.doc.revision;
  await a.e.command('comment-create', { ...post, ...input(a.e) }); assert.deepEqual(await readFile(a.file), first); assert.equal(a.e.doc.revision, revision);
  const b = await f.writer('bob', first); await choose(b.e, 'Bob 日本語');
  await b.e.command('comment-reply', { ...input(b.e), threadId: post.threadId, messageId: randomUUID(), text: 'Consider another answer' });
  await b.e.command('comment-resolve', { ...input(b.e), threadId: post.threadId });
  assert.equal(b.e.uiSnapshot().comments[post.threadId].state, 'resolved'); assert.equal(thread(b.e).status.event.actor.displayName, 'Bob 日本語');
  assert.equal(thread(b.e).messages[0].event.actor.displayName, 'Alice λ');
  const pulled = await f.writer('pulled', await readFile(b.file));
  await pulled.e.command('comment-reopen', { ...input(pulled.e), threadId: post.threadId });
  assert.equal(thread(pulled.e).status.event.actor, null); assert.equal(pulled.e.uiSnapshot().comments[post.threadId].state, 'open');
  assert.deepEqual(pulled.e.doc.nodes, savedNodes); assert.equal(pulled.e.doc.finishedAt, finishedAt); assert.deepEqual([...a.calls, ...b.calls, ...pulled.calls], []);
  const shared = await readFile(pulled.file, 'utf8');
  for (const secret of ['PRIVATE_SESSION', 'PRIVATE_TARGET', f.root, 'contributor-settings']) assert.equal(shared.includes(secret), false);
  for (const operation of ['questions', 'research']) for (const secret of ['COMMENT_CANARY', 'SUGGESTION_CANARY', 'Alice λ', 'Bob 日本語']) assert.equal(pulled.e.prepareRequest(operation, pulled.e.doc.nodes[1].id).prompt.includes(secret), false);
  const snapshot = pulled.e.uiSnapshot(); snapshot.comments[post.threadId].state = 'resolved'; assert.equal(pulled.e.uiSnapshot().comments[post.threadId].state, 'open');
});

test('independently saved replies merge and reload with both identities and no automatic decision action', async t => {
  const f = await fixture(t), a = await f.writer('a'); await a.e.command('comment-create', create(a.e)); const base = await readFile(a.file), b = await f.writer('b', base);
  await choose(a.e, 'Alice'); await choose(b.e, 'Bob');
  for (const [writer, text] of [[a, 'Local reply'], [b, 'Incoming reply']]) await writer.e.command('comment-reply', { ...input(writer.e), threadId: thread(writer.e).id, messageId: randomUUID(), text });
  const result = mergeSharedDocuments(readSharedDocument(base).document, readSharedDocument(await readFile(a.file)).document, readSharedDocument(await readFile(b.file)).document);
  assert.deepEqual(result.conflicts, []); const merged = await f.writer('merged', JSON.stringify(result.document));
  assert.deepEqual(thread(merged.e).messages.map(m => m.event.actor?.displayName ?? null), [null, 'Alice', 'Bob']);
  assert.equal(merged.e.uiSnapshot().comments[thread(merged.e).id].messageCount, 3);
});

test('comment commands reject forged metadata, wrong journeys, stale revisions and personal writes while preserving bytes', async t => {
  const f = await fixture(t), { e, file } = await f.writer('one'), before = await readFile(file), valid = create(e);
  for (const changed of [{ actor: { id: randomUUID(), displayName: 'Forged' } }, { at: new Date().toISOString() }, { source: {} }, { journey: 'other' }, { revision: -1 }, { extra: true }]) await assert.rejects(e.command('comment-create', { ...valid, ...changed }));
  assert.deepEqual(await readFile(file), before);
  const personalFile = join(f.root, 'personal.json'); await writeFile(personalFile, JSON.stringify(e.doc)); const personal = await new Explorer({ file: personalFile }).load(); t.after(() => personal.close());
  await assert.rejects(personal.command('comment-create', { ...valid, journey: personal.doc.id }), /shared|project/i); assert.equal(personal.doc.comments, undefined);
  await writeFile(join(e.library.directory, 'contributor-settings.json'), '{broken');
  await assert.rejects(e.command('comment-create', valid), /preserved/); assert.deepEqual(await readFile(file), before);
});

test('failed and stale shared comment writes retain the saved file, private answer draft and historical orphan discussion', async t => {
  const f = await fixture(t), { e, file, context } = await f.writer('one'), post = create(e);
  await e.writeDraft({ journey: e.activeKey, nodeId: post.nodeId, base: e.doc.nodes[1], text: 'PRIVATE_DRAFT', revision: 0 });
  const before = await readFile(file), write = e.projectStore.write; e.projectStore.write = async () => { throw Error('disk full'); };
  await assert.rejects(e.command('comment-create', post), /disk full/); assert.deepEqual(await readFile(file), before); assert.equal(e.doc.comments, undefined);
  e.projectStore.write = write; await e.command('comment-create', post);
  const orphan = structuredClone(e.doc); orphan.nodes.splice(1, 1); await e.save(orphan);
  assert.equal(e.uiSnapshot().comments[post.threadId].context, 'orphaned');
  await e.command('comment-reply', { ...input(e), threadId: post.threadId, messageId: randomUUID(), text: 'Retain explanation' });
  assert.equal((await e.readDrafts(e.activeKey)).entries[0].text, 'PRIVATE_DRAFT');
  const other = await new ProjectJourney(context).load(), newer = structuredClone(other.document); newer.objective = 'External edit'; await other.save(newer, { baseDigest: other.baseDigest }); const winning = await readFile(file);
  await assert.rejects(e.command('comment-resolve', { ...input(e), threadId: post.threadId }), /changed|refresh/i); assert.deepEqual(await readFile(file), winning);
});

test('comment HTTP actions require the same-origin client and reject identity injection', async t => {
  const f = await fixture(t), { e } = await f.writer('one'), server = await startServer(e); t.after(() => server.close());
  const url = new URL('api/action', server.url), origin = url.origin, body = { action: 'comment-create', ...create(e) };
  const post = headers => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ origin })).status, 403); assert.equal((await post({ 'x-explorer-client': '1' })).status, 403);
  assert.equal((await post({ origin: 'https://evil.test', 'x-explorer-client': '1' })).status, 403);
  body.actor = { id: randomUUID(), displayName: 'Forged' }; assert.equal((await post({ origin, 'x-explorer-client': '1' })).status, 400); delete body.actor;
  const response = await post({ origin, 'x-explorer-client': '1' }); assert.equal(response.status, 200); assert.equal((await response.json()).document.comments.threads[0].messages[0].event.actor, null);
});

test('failed comment responses distinguish absent messages from posts committed before history failure', async t => {
  const f = await fixture(t), { e } = await f.writer('one'), server = await startServer(e); t.after(() => server.close()); const url = new URL('api/action', server.url);
  const post = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: url.origin, 'x-explorer-client': '1' }, body: JSON.stringify({ action: 'comment-create', ...body }) });
  const first = create(e), rejected = await post({ ...first, suggestion: '   ' }); assert.equal(rejected.status, 400); assert.equal((await rejected.json()).commentSubmission, 'absent');
  const save = e.projectStore.saveLocked.bind(e.projectStore); e.projectStore.saveLocked = async (...args) => { await save(...args); throw Error('History finalization failed'); };
  const committed = await post(first); assert.equal(committed.status, 400); assert.equal((await committed.json()).commentSubmission, 'present'); assert.equal(thread(e).messages[0].id, first.messageId);
  e.projectStore.saveLocked = save; const retry = await post({ ...first, ...input(e) }); assert.equal(retry.status, 200); assert.equal(e.doc.comments.threads.length, 1);
});
