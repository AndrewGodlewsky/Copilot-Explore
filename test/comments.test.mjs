import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateComments, changeComments, commentSource, commentMessagesDigest, commentStatuses, COMMENT_LIMITS } from '../com.github.copilot/extensions/explorer/comments.mjs';
import { createDocument, addQuestions, validateDocument, importedDocument, contextFor, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { buildScenario } from '../com.github.copilot/extensions/explorer/scenario-fork.mjs';
import { prepareBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';

const alice = { actor: { id: randomUUID(), displayName: 'Alice λ <script>' }, at: '2026-11-18T12:00:00.000Z' };
const bob = { actor: { id: randomUUID(), displayName: 'Bob 日本語' }, at: '2026-11-18T13:00:00.000Z' };
function fixture() { const doc = createDocument('Discussion fixture'); addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Choice' }, { question: 'When?', category: 'Scope' }]); doc.nodes[1].answer = 'A'; doc.nodes[1].answerState = 'decided'; return doc; }
function post(doc, fields = {}, event = alice) { const input = { nodeId: doc.nodes[1].id, threadId: randomUUID(), messageId: randomUUID(), text: '  Review <b> λ\r\nExact text  ', ...fields }; return { input, doc: changeComments(doc, 'create', input, event) }; }
const thread = doc => doc.comments.threads[0];
const reply = (doc, fields = {}, event = bob) => changeComments(doc, 'reply', { threadId: thread(doc).id, messageId: randomUUID(), text: 'Reply', ...fields }, event);

test('comments capture exact public text, contributor and saved source without altering decisions or the caller', () => {
  const before = fixture(), original = structuredClone(before), { doc, input } = post(before, { suggestion: 'Proposed B' });
  assert.deepEqual(before, original); assert.deepEqual(doc.nodes, before.nodes); assert.equal(doc.finishedAt, before.finishedAt);
  assert.deepEqual(thread(doc).source, commentSource(before.nodes[1]));
  assert.deepEqual(thread(doc).messages[0], { id: input.messageId, text: input.text, event: alice, suggestion: 'Proposed B' });
  assert.deepEqual(thread(doc).status, { state: 'open', event: alice, messagesDigest: commentMessagesDigest(thread(doc).messages) });
  assert.deepEqual(commentStatuses(doc)[input.threadId], { context: 'current', state: 'open', resolution: 'current', messageCount: 1, canSuggest: true });
  assert.deepEqual(validateDocument(doc).comments, doc.comments);
});

test('comment submission IDs make exact retries no-ops and reject mismatched reuse', () => {
  const first = post(fixture()), input = { threadId: thread(first.doc).id, messageId: randomUUID(), text: 'Later reply' };
  const later = changeComments(first.doc, 'reply', input, bob);
  assert.deepEqual(changeComments(later, 'create', first.input, bob), later);
  assert.deepEqual(changeComments(later, 'reply', input, alice), later);
  const reordered = structuredClone(later); thread(reordered).messages.reverse();
  assert.deepEqual(changeComments(reordered, 'create', first.input, bob), reordered);
  assert.throws(() => changeComments(later, 'reply', { ...input, text: 'Different' }, bob), /reused|already/i);
  assert.throws(() => changeComments(later, 'create', { ...first.input, nodeId: later.nodes[2].id }, bob), /reused|already/i);
  assert.throws(() => changeComments(later, 'reply', { ...input, actor: bob.actor }, bob));
  assert.throws(() => changeComments(later, 'create', { ...first.input, source: thread(later).source }, bob));
});

test('discussion resolve and reopen are explicit, attributed and separate from answer state', () => {
  const { doc } = post(fixture()), id = thread(doc).id, resolved = changeComments(doc, 'resolve', { threadId: id }, bob);
  assert.equal(commentStatuses(resolved)[id].state, 'resolved'); assert.deepEqual(thread(resolved).status.event, bob);
  assert.deepEqual(resolved.nodes, doc.nodes); assert.deepEqual(changeComments(resolved, 'resolve', { threadId: id }, alice), resolved);
  assert.throws(() => reply(resolved), /reopen/i);
  const reopened = changeComments(resolved, 'reopen', { threadId: id }, alice);
  assert.equal(commentStatuses(reopened)[id].state, 'open'); assert.deepEqual(thread(reopened).status.event, alice);
  assert.deepEqual(changeComments(reopened, 'reopen', { threadId: id }, bob), reopened);
  assert.equal(thread(reply(reopened)).messages.length, 2);
});

test('changed question/answer and missing nodes preserve historical discussion without claiming current review', () => {
  const { doc } = post(fixture()), id = thread(doc).id;
  for (const mutate of [d => d.nodes[1].answer = 'B', d => d.nodes[1].answerState = 'tentative', d => d.nodes[1].question = 'Changed?']) {
    const next = structuredClone(doc); mutate(next); assert.equal(commentStatuses(next)[id].context, 'changed');
    assert.deepEqual(thread(next).source, thread(doc).source);
  }
  const orphan = structuredClone(doc); orphan.nodes.splice(1, 1);
  assert.doesNotThrow(() => validateDocument(orphan)); assert.equal(commentStatuses(orphan)[id].context, 'orphaned'); assert.equal(commentStatuses(orphan)[id].canSuggest, false);
  const resolved = changeComments(reply(orphan), 'resolve', { threadId: id }, bob);
  assert.equal(commentStatuses(resolved)[id].context, 'orphaned'); assert.equal(thread(resolved).messages.length, 2);
});

test('a resolution covers its message set, never concurrent new or changed replies', () => {
  const { doc } = post(fixture()), id = thread(doc).id, resolved = changeComments(doc, 'resolve', { threadId: id }, alice);
  const incoming = thread(reply(doc)).messages[1], changed = structuredClone(resolved); thread(changed).messages.push(incoming);
  assert.doesNotThrow(() => validateComments(changed.comments));
  assert.equal(commentStatuses(changed)[id].state, 'open'); assert.equal(commentStatuses(changed)[id].resolution, 'historical');
  const reviewed = changeComments(changed, 'resolve', { threadId: id }, bob); assert.equal(commentStatuses(reviewed)[id].state, 'resolved');
  const reordered = structuredClone(reviewed); thread(reordered).messages.reverse(); assert.equal(commentStatuses(reordered)[id].state, 'resolved');
  thread(reordered).messages[0].text = 'Edited outside Explorer'; assert.equal(commentStatuses(reordered)[id].resolution, 'historical');
});

test('comment schemas reject malformed versions, hidden fields, duplicate IDs, invalid events and unsupported proposals', () => {
  const { doc } = post(fixture());
  for (const mutate of [c => c.version = 2, c => c.extra = true, c => c.threads.push(structuredClone(c.threads[0])), c => c.threads[0].id = 'not-uuid', c => c.threads[0].nodeId = ' ', c => c.threads[0].source.kind = 'answer', c => c.threads[0].source.extra = true, c => c.threads[0].source.answerDigest = 'broken', c => c.threads[0].messages.push(structuredClone(c.threads[0].messages[0])), c => c.threads[0].messages[0].event.actor.email = 'hidden@example.test', c => c.threads[0].messages[0].event.at = 'not-date', c => c.threads[0].messages[0].text = '\ud800', c => c.threads[0].messages[0].text = ' ', c => c.threads[0].messages[0].suggestion = '', c => c.threads[0].messages[0].suggestion = { answer: 'B' }, c => c.threads[0].status.state = 'approved', c => c.threads[0].status.messagesDigest = 'bad']) {
    const value = structuredClone(doc.comments); mutate(value); assert.throws(() => validateComments(value));
  }
  const hidden = structuredClone(doc.comments); Object.defineProperty(hidden, 'secret', { value: 'private' }); assert.throws(() => validateComments(hidden));
  assert.throws(() => post(doc, { nodeId: doc.rootId, suggestion: 'Not an answer target' }));
  assert.throws(() => post(doc, { nodeId: 'missing' }));
});

test('comment limits bound each field, collection and complete serialized discussion', () => {
  const { doc } = post(fixture());
  for (const fields of [{ text: 'x'.repeat(4001) }, { suggestion: 'x'.repeat(5001) }]) assert.throws(() => post(doc, fields));
  const makeThread = (count = 1, size = 1) => { const value = structuredClone(thread(doc)); value.id = randomUUID(); value.messages = Array.from({ length: count }, () => ({ id: randomUUID(), text: 'x'.repeat(size), event: alice })); return value; };
  assert.throws(() => validateComments({ version: 1, threads: Array.from({ length: 65 }, () => makeThread()) }));
  assert.throws(() => validateComments({ version: 1, threads: [makeThread(33)] }));
  assert.throws(() => validateComments({ version: 1, threads: [...Array.from({ length: 8 }, () => makeThread(32)), makeThread()] }));
  const oversized = { version: 1, threads: Array.from({ length: 8 }, () => makeThread(32, 4000)) };
  assert.ok(Buffer.byteLength(JSON.stringify(oversized, null, 2)) > COMMENT_LIMITS.bytes); assert.throws(() => validateComments(oversized));
  const empty = { version: 1, threads: [] }; assert.deepEqual(validateComments(empty), empty);
});

test('legacy absence stays absent and native/shared/import round trips preserve comments without model or decision export leakage', () => {
  const legacy = fixture(); assert.equal(validateDocument(legacy).comments, undefined); assert.deepEqual(commentStatuses(legacy), {});
  const { doc } = post(legacy, { text: 'COMMENT_ONLY_CANARY', suggestion: 'SUGGESTION_ONLY_CANARY' });
  const shared = readSharedDocument(prepareSharedMigration(JSON.stringify(doc)).content).document;
  assert.deepEqual(shared.journey.comments, doc.comments); assert.deepEqual(importedDocument(doc).comments, doc.comments);
  for (const output of [JSON.stringify(contextFor(doc, doc.nodes[1].id)), prepareBrief(doc).prompt, toMarkdown(doc)]) assert.doesNotMatch(output, /COMMENT_ONLY_CANARY|SUGGESTION_ONLY_CANARY|Alice λ/);
});

test('scenario forks retain only copied-node discussions with remapped links and historical alternative context', () => {
  const { doc } = post(fixture()), second = post(doc, { nodeId: doc.nodes[2].id }).doc;
  const fork = buildScenario(second, { nodeId: doc.nodes[1].id, answer: 'Alternative B', answerState: 'tentative' }).document;
  assert.equal(fork.comments.threads.length, 1); assert.equal(thread(fork).id, thread(doc).id);
  assert.notEqual(thread(fork).nodeId, thread(doc).nodeId); assert.deepEqual(thread(fork).messages, thread(doc).messages);
  assert.equal(commentStatuses(fork)[thread(fork).id].context, 'changed'); assert.equal(second.comments.threads.length, 2);
});

test('saved history retains the comment and its status before a later discussion change', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-comments-history-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'journey.json'), doc = fixture(); await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file }).load(); t.after(() => e.close());
  const first = post(e.doc).doc; await e.save(first, 'Comment posted'); const revision = e.doc.revision;
  await e.save(changeComments(e.doc, 'resolve', { threadId: thread(e.doc).id }, bob), 'Discussion resolved');
  assert.deepEqual((await e.readHistory(e.doc.id, revision)).document.comments, first.comments);
});
