import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateReviewHandoffs, handoffScope, handoffCapture, handoffStatuses, changeReviewHandoffs, HANDOFF_LIMITS } from '../com.github.copilot/extensions/explorer/review-handoffs.mjs';
import { createDocument, addQuestions, validateDocument, importedDocument, contextFor, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { buildScenario } from '../com.github.copilot/extensions/explorer/scenario-fork.mjs';
import { prepareBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { viewerSnapshot } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';

const alice = { actor: { id: randomUUID(), displayName: 'Alice λ <script>' }, at: '2026-11-18T12:00:00.000Z' };
const bob = { actor: { id: randomUUID(), displayName: 'Bob 日本語' }, at: '2026-11-18T13:00:00.000Z' };
const unknown = { actor: null, at: '2026-11-18T14:00:00.000Z' };
function fixture() {
  const doc = createDocument('Review handoff fixture');
  addQuestions(doc, doc.rootId, ['Branch?', 'Unrelated?', 'Prerequisite?'].map(question => ({ question, category: 'Choice' })));
  addQuestions(doc, doc.nodes[1].id, [{ question: 'Child?', category: 'Detail' }]);
  doc.nodes[1].answer = 'A'; doc.nodes[1].answerState = 'assumption';
  doc.dependencies = [{ dependentId: doc.nodes[4].id, prerequisiteId: doc.nodes[3].id, explanation: 'Uses premise' }];
  return doc;
}
const first = doc => doc.reviewHandoffs.records[0];
function create(doc, changes = {}, event = alice) {
  const input = { id: randomUUID(), transitionId: randomUUID(), scope: { kind: 'branch', nodeId: doc.nodes[1].id }, recipient: 'Requested reviewer', note: '  HANDOFF_NOTE λ\r\n<script> exact  ', unresolvedIds: [doc.nodes[4].id], ...changes };
  return { doc: changeReviewHandoffs(doc, 'create', input, event), input };
}
const change = (doc, action, changes = {}, event = bob) => changeReviewHandoffs(doc, action, { id: first(doc).id, transitionId: randomUUID(), note: '', ...changes }, event);

test('handoffs preserve exact source, selected questions and requested responsibility without editing decisions', () => {
  const original = fixture(), before = structuredClone(original), { doc, input } = create(original);
  assert.deepEqual(original, before); assert.deepEqual(doc.nodes, original.nodes); assert.equal(doc.finishedAt, original.finishedAt);
  assert.deepEqual(first(doc).source, handoffCapture(original, input.scope));
  assert.deepEqual(first(doc).unresolved, [{ nodeId: original.nodes[4].id, question: 'Child?' }]);
  assert.deepEqual(first(doc).transitions, [{ id: input.transitionId, action: 'create', note: input.note, recipient: input.recipient, event: alice }]);
  const status = handoffStatuses(doc)[input.id]; assert.equal(status.state, 'requested'); assert.equal(status.recipient, input.recipient); assert.equal(status.owner, null); assert.equal(status.context, 'current');
  assert.deepEqual(validateDocument(doc).reviewHandoffs, doc.reviewHandoffs);
});

test('take, reassign and complete preserve prior notes and attribution without resolving answers or uncertainty', () => {
  const initial = create(fixture()).doc, taken = change(initial, 'take', { note: 'Investigating' });
  assert.equal(handoffStatuses(taken)[first(taken).id].state, 'taken'); assert.deepEqual(handoffStatuses(taken)[first(taken).id].owner, bob.actor);
  assert.throws(() => change(taken, 'take'), /reassign|taken/i);
  const completed = change(taken, 'complete', { note: 'Evidence still missing; investigation complete' }, alice);
  assert.equal(handoffStatuses(completed)[first(completed).id].state, 'complete'); assert.deepEqual(completed.nodes, initial.nodes);
  assert.throws(() => change(completed, 'complete'), /complete|reassign/i); assert.throws(() => change(completed, 'take'), /complete|reassign/i);
  const reassigned = change(completed, 'reassign', { recipient: null, note: 'Another review needed' });
  assert.equal(handoffStatuses(reassigned)[first(reassigned).id].state, 'requested'); assert.equal(handoffStatuses(reassigned)[first(reassigned).id].recipient, null); assert.equal(handoffStatuses(reassigned)[first(reassigned).id].owner, null);
  assert.deepEqual(first(reassigned).transitions.slice(0, 3), first(completed).transitions); assert.deepEqual(first(reassigned).source, first(initial).source);
  const anonymous = change(reassigned, 'take', {}, unknown); assert.equal(handoffStatuses(anonymous)[first(anonymous).id].state, 'taken'); assert.equal(handoffStatuses(anonymous)[first(anonymous).id].owner, null);
  const unassigned = create(fixture(), { recipient: null }).doc; assert.equal(handoffStatuses(unassigned)[first(unassigned).id].recipient, null);
  assert.equal(handoffStatuses(change(unassigned, 'complete'))[first(unassigned).id].state, 'complete');
});

test('exact transition retries remain no-ops after later actions or source removal and reject different reused content', () => {
  const made = create(fixture()), take = { id: made.input.id, transitionId: randomUUID(), note: 'Taking it' };
  const taken = changeReviewHandoffs(made.doc, 'take', take, bob), completed = change(taken, 'complete');
  assert.deepEqual(changeReviewHandoffs(completed, 'create', made.input, unknown), completed);
  assert.deepEqual(changeReviewHandoffs(completed, 'take', take, unknown), completed);
  const removed = structuredClone(completed); removed.nodes = removed.nodes.filter(n => ![made.input.scope.nodeId, made.input.unresolvedIds[0]].includes(n.id)); removed.dependencies = [];
  assert.deepEqual(changeReviewHandoffs(removed, 'create', made.input, unknown), removed);
  for (const input of [{ ...take, note: 'Different' }, { ...take, id: randomUUID() }]) assert.throws(() => changeReviewHandoffs(completed, 'take', input, bob), /submission|used|exist/i);
  assert.throws(() => changeReviewHandoffs(completed, 'create', { ...made.input, unresolvedIds: [] }, bob), /submission|used/i);
  assert.throws(() => changeReviewHandoffs(completed, 'reassign', { ...take, recipient: null }, bob), /submission|used/i);
});

test('branch fingerprints cover descendants, ancestors, prerequisite closure and guidance while ignoring unrelated or administrative changes', () => {
  const doc = fixture(), scope = { kind: 'branch', nodeId: doc.nodes[1].id }, capture = handoffCapture(doc, scope);
  assert.deepEqual(new Set(handoffScope(doc, scope).primaryIds), new Set([doc.nodes[1].id, doc.nodes[4].id]));
  assert.deepEqual(new Set(handoffScope(doc, scope).contextIds), new Set([doc.rootId, doc.nodes[1].id, doc.nodes[3].id, doc.nodes[4].id]));
  assert.equal(capture.nodeCount, 4);
  for (const mutate of [d => d.nodes[4].question = 'Changed child?', d => d.nodes[3].answer = 'New premise', d => d.nodes[1].answerState = 'decided', d => d.nodes[1].review = true, d => d.objective = 'New objective', d => d.mode = 'design', d => d.dependencies[0].explanation = 'Changed dependency', d => addQuestions(d, d.nodes[1].id, [{ question: 'New child?', category: 'Detail' }]), d => { d.nodes.pop(); d.dependencies = []; }]) {
    const changed = structuredClone(doc); mutate(changed); assert.notEqual(handoffCapture(changed, scope).digest, capture.digest);
  }
  const same = create(doc).doc; same.revision++; same.updatedAt = unknown.at; same.nodes[2].answer = 'Unrelated'; same.nodes[1].revisit = { date: '2026-12-01', condition: '', acknowledgedAt: null }; same.nodes[1].research = { ignored: true }; same.comments = { ignored: true }; same.nodes.reverse();
  assert.equal(handoffCapture(same, scope).digest, capture.digest);
  assert.notEqual(handoffCapture(same, { kind: 'journey' }).digest, handoffCapture(doc, { kind: 'journey' }).digest);
  const changedIdentity = structuredClone(doc); changedIdentity.id = randomUUID(); assert.notEqual(handoffCapture(changedIdentity, scope).digest, capture.digest);
});

test('changed and removed handoff sources retain historical summaries even after completion', () => {
  const { doc } = create(fixture()), record = first(doc); doc.nodes[1].answer = 'B';
  const completed = change(doc, 'complete'); assert.equal(handoffStatuses(completed)[record.id].context, 'changed'); assert.equal(handoffStatuses(completed)[record.id].state, 'complete');
  completed.nodes = completed.nodes.filter(n => ![record.scope.nodeId, record.unresolved[0].nodeId].includes(n.id)); completed.dependencies = [];
  assert.doesNotThrow(() => validateDocument(completed)); assert.equal(handoffStatuses(completed)[record.id].context, 'orphaned');
  const reassigned = change(completed, 'reassign', { recipient: 'No matching account' }); assert.equal(handoffStatuses(reassigned)[record.id].context, 'orphaned'); assert.deepEqual(first(reassigned).source, record.source);
});

test('unresolved selections must be unique explicit ordinary questions in the primary scope and cannot inject metadata', () => {
  const doc = fixture();
  for (const fields of [{ unresolvedIds: [doc.nodes[2].id] }, { unresolvedIds: [doc.rootId] }, { unresolvedIds: [doc.nodes[4].id, doc.nodes[4].id] }, { unresolvedIds: ['missing'] }, { recipient: '' }, { recipient: ' hidden ' }, { recipient: '\u202eName' }, { note: ' ' }, { actor: alice.actor }, { source: {} }, { scope: { kind: 'branch', nodeId: 'missing' } }]) assert.throws(() => create(doc, fields));
  assert.equal(first(create(doc, { unresolvedIds: [] }).doc).unresolved.length, 0);
  assert.equal(first(create(doc, { scope: { kind: 'journey' }, unresolvedIds: [doc.nodes[2].id] }).doc).unresolved[0].question, 'Unrelated?');
});

test('strict handoff schemas reject unknown fields, malformed Unicode, duplicate IDs and illegal transition sequences', () => {
  const value = create(fixture()).doc.reviewHandoffs;
  for (const mutate of [v => v.version = 2, v => v.extra = true, v => v.records[0].id = 'bad', v => v.records[0].scope.extra = true, v => v.records[0].source.digest = 'bad', v => v.records[0].source.nodeCount = 0, v => v.records[0].unresolved.push(structuredClone(v.records[0].unresolved[0])), v => v.records[0].transitions[0].note = '\ud800', v => v.records[0].transitions[0].event.actor.email = 'hidden', v => v.records[0].transitions[0].event.at = 'invalid', v => v.records[0].transitions[0].action = 'take', v => v.records[0].transitions.push(structuredClone(v.records[0].transitions[0])), v => v.records.push(structuredClone(v.records[0]))]) { const candidate = structuredClone(value); mutate(candidate); assert.throws(() => validateReviewHandoffs(candidate)); }
  const hidden = structuredClone(value); Object.defineProperty(hidden, 'private', { value: 'secret' }); assert.throws(() => validateReviewHandoffs(hidden));
  const complete = change(create(fixture()).doc, 'complete').reviewHandoffs; complete.records[0].transitions.push({ id: randomUUID(), action: 'take', note: '', event: bob }); assert.throws(() => validateReviewHandoffs(complete));
  const duplicateEvent = structuredClone(value); duplicateEvent.records.push({ ...structuredClone(value.records[0]), id: randomUUID() }); assert.throws(() => validateReviewHandoffs(duplicateEvent));
});

test('handoff limits bound fields, selections, transition history, collection count and serialized bytes', () => {
  const doc = fixture(); for (const fields of [{ note: 'n'.repeat(2001) }, { recipient: 'r'.repeat(97) }, { unresolvedIds: Array.from({ length: 25 }, () => randomUUID()) }]) assert.throws(() => create(doc, fields));
  const sample = first(create(doc).doc), record = (count = 1, size = 0) => ({ ...structuredClone(sample), id: randomUUID(), transitions: Array.from({ length: count }, (_, i) => ({ id: randomUUID(), action: i ? 'reassign' : 'create', note: i ? 'x'.repeat(size) : 'Start', recipient: null, event: structuredClone(alice) })) });
  for (const records of [Array.from({ length: 33 }, () => record()), [record(17)], [...Array.from({ length: 16 }, () => record(16)), record()]]) assert.throws(() => validateReviewHandoffs({ version: 1, records }));
  const oversized = { version: 1, records: Array.from({ length: 16 }, () => record(16, 2000)) }; assert.ok(Buffer.byteLength(JSON.stringify(oversized, null, 2)) > HANDOFF_LIMITS.bytes); assert.throws(() => validateReviewHandoffs(oversized));
  assert.deepEqual(validateReviewHandoffs({ version: 1, records: [] }), { version: 1, records: [] });
});

test('legacy reads stay sparse; native import and clone retain handoffs while model and ordinary decision exports omit notes', () => {
  const old = fixture(); assert.equal(validateDocument(old).reviewHandoffs, undefined); assert.deepEqual(handoffStatuses(old), {});
  const doc = create(old, { recipient: 'RECIPIENT_CANARY', note: 'HANDOFF_ONLY_CANARY' }).doc;
  assert.deepEqual(importedDocument(doc).reviewHandoffs, doc.reviewHandoffs);
  assert.deepEqual(readSharedDocument(prepareSharedMigration(JSON.stringify(doc)).content).document.journey.reviewHandoffs, doc.reviewHandoffs);
  for (const value of [contextFor(doc, doc.nodes[1].id), prepareBrief(doc).prompt, toMarkdown(doc), viewerSnapshot(doc, doc.nodes.map(node => ({ nodeId: node.id, answer: true, research: true })))]) assert.doesNotMatch(JSON.stringify(value), /HANDOFF_ONLY_CANARY|RECIPIENT_CANARY|Alice λ/);
  const fork = buildScenario(doc, { nodeId: doc.nodes[1].id, answer: 'B', answerState: 'tentative' }).document; assert.equal(fork.reviewHandoffs, undefined); assert.equal(doc.reviewHandoffs.records.length, 1);
});

test('saved history retains original handoff notes before later responsibility changes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-handoff-history-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'journey.json'); await writeFile(file, JSON.stringify(fixture())); const e = await new Explorer({ file }).load(); t.after(() => e.close());
  const initial = create(e.doc).doc; await e.save(initial, 'Review requested'); const revision = e.doc.revision;
  await e.save(change(e.doc, 'take'), 'Review taken'); assert.deepEqual((await e.readHistory(e.doc.id, revision)).document.reviewHandoffs, initial.reviewHandoffs);
});
