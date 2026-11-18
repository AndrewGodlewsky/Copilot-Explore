import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { changeReviewHandoffs, handoffStatuses } from '../com.github.copilot/extensions/explorer/review-handoffs.mjs';
import { mergeSharedDocuments } from '../com.github.copilot/extensions/explorer/semantic-merge.mjs';

const alice = { actor: { id: randomUUID(), displayName: 'Alice' }, at: '2026-11-18T12:00:00.000Z' }, bob = { actor: { id: randomUUID(), displayName: 'Bob' }, at: '2026-11-18T13:00:00.000Z' };
function shared(doc) { const { format, version, revision, ...journey } = doc; return { format: 'copilot-explorer-shared', version: 1, journey }; }
const merge = (base, local, incoming, choices) => mergeSharedDocuments(shared(base), shared(local), shared(incoming), choices);
const first = doc => doc.reviewHandoffs.records[0];
const create = doc => changeReviewHandoffs(doc, 'create', { id: randomUUID(), transitionId: randomUUID(), scope: { kind: 'branch', nodeId: doc.nodes[1].id }, recipient: null, note: 'Original note <script>', unresolvedIds: [doc.nodes[1].id] }, alice);
const change = (doc, action, extra = {}, event = bob) => changeReviewHandoffs(doc, action, { id: first(doc).id, transitionId: randomUUID(), note: 'New note', ...extra }, event);
function fixture() { const doc = createDocument('Handoff merge'); addQuestions(doc, doc.rootId, [{ question: 'Which?', category: 'Choice' }, { question: 'When?', category: 'Scope' }]); return create(doc); }

test('independent review handoffs merge while one-sided transition extensions retain their complete notes', () => {
  const base = fixture(); delete base.reviewHandoffs;
  const local = create(base), incoming = create(base), result = merge(base, local, incoming);
  assert.deepEqual(result.conflicts, []); assert.equal(result.document.journey.reviewHandoffs.records.length, 2); assert.deepEqual(result.affected, []);
  const next = change(local, 'take'); assert.deepEqual(first(merge(local, local, next).document.journey), first(next));
  assert.deepEqual(merge(local, next, next).conflicts, []);
});

test('concurrent reassignment and completion require a complete record choice with original notes intact', () => {
  const base = fixture(), local = change(base, 'reassign', { recipient: 'Alice' }, alice), incoming = change(base, 'complete'), id = `handoff-record:${first(base).id}`;
  const preview = merge(base, local, incoming); assert.equal(preview.document, null); assert.deepEqual(preview.unresolved, [id]);
  for (const [choice, expected] of [['local', local], ['incoming', incoming]]) {
    const result = merge(base, local, incoming, { [id]: choice }).document.journey;
    assert.deepEqual(first(result), first(expected)); assert.deepEqual(result.nodes, base.nodes); assert.equal(first(result).transitions[0].note, 'Original note <script>');
  }
  assert.deepEqual(merge(base, incoming, local).unresolved, [id]);
  assert.throws(() => merge(base, local, incoming, { 'handoff-record:obsolete': 'incoming' }), /choices/);
});

test('two contributors taking the same handoff remain an explicit ownership conflict', () => {
  const base = fixture(), local = change(base, 'take', {}, alice), incoming = change(base, 'take', {}, bob), id = `handoff-record:${first(base).id}`;
  assert.deepEqual(merge(base, local, incoming).unresolved, [id]);
  const result = merge(base, local, incoming, { [id]: 'incoming' }).document.journey; assert.deepEqual(handoffStatuses(result)[first(base).id].owner, bob.actor);
});

test('handoff deletion and any changed scope/source require explicit complete-candidate review', () => {
  const base = fixture(), deleted = structuredClone(base), id = `handoff-record:${first(base).id}`; delete deleted.reviewHandoffs;
  assert.deepEqual(merge(base, deleted, base).unresolved, [id]); assert.deepEqual(merge(base, base, deleted).unresolved, [id]);
  assert.equal(merge(base, deleted, base, { [id]: 'local' }).document.journey.reviewHandoffs.records.length, 0);
  for (const mutate of [doc => first(doc).scope = { kind: 'journey' }, doc => first(doc).source.label = 'Different summary source']) {
    const changed = structuredClone(base); mutate(changed);
    assert.deepEqual(merge(base, base, changed).unresolved, [id]); assert.deepEqual(merge(base, changed, base).unresolved, [id]);
    assert.deepEqual(first(merge(base, base, changed, { [id]: 'local' }).document.journey), first(base));
  }
});

test('node deletion preserves orphan handoffs and a combined limit requires explicit whole-source fallback', () => {
  const base = fixture(), removed = structuredClone(base), completed = change(base, 'complete'); removed.nodes.splice(1, 1);
  const orphan = merge(base, removed, completed); assert.deepEqual(orphan.conflicts, []); assert.equal(handoffStatuses(orphan.document.journey)[first(base).id].context, 'orphaned');
  let many = base; for (let i = 0; i < 30; i++) many = create(many);
  const local = create(many), incoming = create(many), sources = structuredClone([many, local, incoming]), preview = merge(many, local, incoming);
  assert.deepEqual(preview.unresolved, ['graph']); assert.equal(preview.document, null);
  assert.equal(merge(many, local, incoming, { graph: 'incoming' }).document.journey.reviewHandoffs.records.length, 32);
  assert.deepEqual([many, local, incoming], sources);
});
