import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { changeComments, commentStatuses } from '../com.github.copilot/extensions/explorer/comments.mjs';
import { mergeSharedDocuments } from '../com.github.copilot/extensions/explorer/semantic-merge.mjs';

const alice = { actor: { id: randomUUID(), displayName: 'Alice' }, at: '2026-11-18T12:00:00.000Z' }, bob = { actor: { id: randomUUID(), displayName: 'Bob' }, at: '2026-11-18T13:00:00.000Z' };
function shared(doc) { const { format, version, revision, ...journey } = doc; return { format: 'copilot-explorer-shared', version: 1, journey }; }
function fixture() { let doc = createDocument('Comments merge'); addQuestions(doc, doc.rootId, [{ question: 'Which?', category: 'Choice' }, { question: 'When?', category: 'Scope' }]); doc = changeComments(doc, 'create', { nodeId: doc.nodes[1].id, threadId: randomUUID(), messageId: randomUUID(), text: 'Original <script>' }, alice); return doc; }
const merge = (base, local, incoming, choices) => mergeSharedDocuments(shared(base), shared(local), shared(incoming), choices);
const thread = doc => doc.comments.threads[0];
const reply = (doc, text, actor = bob) => changeComments(doc, 'reply', { threadId: thread(doc).id, messageId: randomUUID(), text }, actor);

test('comments merge independent new threads without making the whole discussion collection conflict', () => {
  const base = fixture(); delete base.comments;
  const create = (index, event) => changeComments(base, 'create', { nodeId: base.nodes[index].id, threadId: randomUUID(), messageId: randomUUID(), text: event.actor.displayName }, event);
  const result = merge(base, create(1, alice), create(2, bob));
  assert.deepEqual(result.conflicts, []); assert.equal(result.document.journey.comments.threads.length, 2); assert.deepEqual(result.affected, []);
});

test('comments merge retains concurrent replies and their distinct contributors', () => {
  const base = fixture(), local = reply(base, 'Alice reply', alice), incoming = reply(base, 'Bob reply');
  const result = merge(base, local, incoming);
  assert.deepEqual(result.conflicts, []); assert.deepEqual(thread(result.document.journey).messages.map(m => m.text), ['Original <script>', 'Alice reply', 'Bob reply']);
  assert.equal(thread(result.document.journey).messages[2].event.actor.displayName, 'Bob');
  assert.deepEqual(result.document.journey.nodes, base.nodes);
});

test('comments merge requires explicit same-ID message edit choices without dropping other replies', () => {
  const base = fixture(), local = reply(base, 'Local added'), incoming = reply(base, 'Incoming added');
  thread(local).messages[0].text = 'Local edit'; thread(incoming).messages[0].text = 'Incoming edit';
  const id = `comment-message:${thread(base).id}:${thread(base).messages[0].id}`, preview = merge(base, local, incoming);
  assert.deepEqual(preview.unresolved, [id]); assert.equal(preview.document, null);
  const result = merge(base, local, incoming, { [id]: 'incoming' });
  assert.deepEqual(thread(result.document.journey).messages.map(m => m.text), ['Incoming edit', 'Local added', 'Incoming added']);
  assert.throws(() => merge(base, local, incoming, { 'comment-message:obsolete': 'local' }), /choices/);
});

test('resolution versus concurrent reply is explicit and selecting old resolution never claims review of the reply', () => {
  const base = fixture(), id = thread(base).id, local = changeComments(base, 'resolve', { threadId: id }, alice), incoming = reply(base, 'New objection');
  const conflict = `comment-status:${id}`, preview = merge(base, local, incoming);
  assert.deepEqual(preview.unresolved, [conflict]);
  for (const choice of ['local', 'incoming']) {
    const result = merge(base, local, incoming, { [conflict]: choice }).document.journey;
    assert.equal(thread(result).messages.length, 2); assert.equal(commentStatuses(result)[id].state, 'open');
    assert.equal(commentStatuses(result)[id].resolution, choice === 'local' ? 'historical' : 'current');
  }
  const reversed = merge(base, incoming, local); assert.deepEqual(reversed.unresolved, [conflict]);
});

test('competing resolution receipts remain explicit while identical shared activity needs no conflict', () => {
  const base = fixture(), id = thread(base).id;
  const local = changeComments(base, 'resolve', { threadId: id }, alice), incoming = changeComments(base, 'resolve', { threadId: id }, bob);
  assert.deepEqual(merge(base, local, incoming).unresolved, [`comment-status:${id}`]);
  const same = changeComments(reply(base, 'Agreed additions'), 'resolve', { threadId: id }, bob);
  assert.deepEqual(merge(base, same, same).conflicts, []);
});

test('node deletion retains an orphan discussion, while external thread or message deletion requires review', () => {
  const base = fixture(), local = structuredClone(base), incoming = reply(base, 'Retain this evidence');
  local.nodes.splice(1, 1); const orphan = merge(base, local, incoming);
  assert.deepEqual(orphan.conflicts, []); assert.equal(commentStatuses(orphan.document.journey)[thread(base).id].context, 'orphaned');
  const deleted = structuredClone(base); delete deleted.comments;
  const id = `comment-thread:${thread(base).id}`;
  assert.deepEqual(merge(base, deleted, incoming).unresolved, [id]);
  assert.equal(thread(merge(base, deleted, incoming, { [id]: 'incoming' }).document.journey).messages.length, 2);
  const two = reply(base, 'Second'), missing = structuredClone(two); thread(missing).messages.pop();
  assert.deepEqual(merge(two, missing, two).unresolved, [`comment-message:${thread(two).id}:${thread(two).messages[1].id}`]);
});

test('divergent discussion targets require a complete-thread choice instead of moving another branch reply', () => {
  const base = fixture(), local = structuredClone(base), incoming = reply(base, 'Reply to original source');
  thread(local).nodeId = local.nodes[2].id; thread(local).source.question = local.nodes[2].question;
  const id = `comment-thread:${thread(base).id}`, preview = merge(base, local, incoming);
  assert.deepEqual(preview.unresolved, [id]);
  assert.deepEqual(thread(merge(base, local, incoming, { [id]: 'incoming' }).document.journey), thread(incoming));
  assert.deepEqual(merge(base, base, local).unresolved, [id], 'a one-sided source/target change still needs explicit review');
  assert.deepEqual(merge(base, local, base).unresolved, [id], 'retargeting cannot silently move the discussion in either orientation');
});

test('a combined message limit failure requires explicit complete-source fallback and preserves the source objects', () => {
  let base = fixture(); for (let i = 0; i < 30; i++) base = reply(base, `Base ${i}`);
  const local = reply(base, 'Local last'), incoming = reply(base, 'Incoming last'), before = structuredClone([base, local, incoming]);
  const preview = merge(base, local, incoming); assert.equal(preview.document, null); assert.deepEqual(preview.unresolved, ['graph']);
  const selected = merge(base, local, incoming, { graph: 'incoming' }); assert.equal(thread(selected.document.journey).messages.length, 32);
  assert.deepEqual([base, local, incoming], before);
});
