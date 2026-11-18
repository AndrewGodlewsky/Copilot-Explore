import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareSharedMigration } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { mergeSharedDocuments } from '../com.github.copilot/extensions/explorer/semantic-merge.mjs';
import { prepareBrief, parseBrief, acceptBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareHandoff, parseHandoff, acceptHandoff } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';

function fixture() {
  const doc = createDocument('Merge decisions');
  const [a, b] = addQuestions(doc, doc.rootId, [{ question: 'Storage?', category: 'Scope' }, { question: 'Delivery?', category: 'Scope' }]);
  const [child] = addQuestions(doc, a.id, [{ question: 'How much?', category: 'Scope' }]);
  a.answer = 'Local'; a.answerState = 'decided'; child.answer = 'Ten'; child.answerState = 'tentative';
  const base = prepareSharedMigration(JSON.stringify(doc)).document;
  return { base, local: structuredClone(base), incoming: structuredClone(base), a: a.id, b: b.id, child: child.id };
}
const node = (doc, id) => doc.journey.nodes.find(n => n.id === id);
const merge = (f, choices) => mergeSharedDocuments(f.base, f.local, f.incoming, choices);

test('independent nodes combine exactly, keep inputs untouched and mark changed-assumption descendants', () => {
  const f = fixture(); node(f.local, f.a).answer = '  Remote\n日本語  '; node(f.incoming, f.b).answer = 'Ship later';
  const before = structuredClone(f), result = merge(f);
  assert.deepEqual(f, before); assert.equal(result.conflicts.length, 0); assert.equal(result.error, null);
  assert.equal(node(result.document, f.a).answer, '  Remote\n日本語  '); assert.equal(node(result.document, f.b).answer, 'Ship later');
  assert.equal(node(result.document, f.child).review, true); assert.ok(result.affected.includes(f.child));
});

test('competing node candidates preserve answer/state and require explicit choices without a default', () => {
  const f = fixture(); node(f.local, f.a).answer = 'Local option'; node(f.incoming, f.a).answer = 'Incoming option'; node(f.incoming, f.a).answerState = 'tentative';
  const pending = merge(f), id = `node:${f.a}`;
  assert.ok(pending.conflicts.some(c => c.id === id)); assert.equal(pending.document, null); assert.deepEqual(pending.unresolved, [id]);
  const result = merge(f, { [id]: 'incoming' }); assert.equal(node(result.document, f.a).answer, 'Incoming option'); assert.equal(node(result.document, f.a).answerState, 'tentative');
  assert.throws(() => merge(f, { [id]: 'invent' }), /choice/i); assert.throws(() => merge(f, { unknown: 'local' }), /choice/i);
});

test('clean ancestor and descendant edits still require downstream review', () => {
  const f = fixture(); node(f.local, f.a).answer = 'New assumption'; node(f.incoming, f.child).answer = 'Twenty';
  const result = merge(f); assert.equal(result.conflicts.length, 0); assert.equal(node(result.document, f.child).answer, 'Twenty'); assert.equal(node(result.document, f.child).review, true);
});

test('delete versus edited descendants exposes parent and child choices and rejects broken combinations', () => {
  const f = fixture(); f.local.journey.nodes = f.local.journey.nodes.filter(n => ![f.a, f.child].includes(n.id)); node(f.incoming, f.child).answer = 'Updated';
  const pending = merge(f); assert.deepEqual(new Set(pending.unresolved), new Set([`node:${f.a}`, `node:${f.child}`]));
  const broken = merge(f, { [`node:${f.a}`]: 'local', [`node:${f.child}`]: 'incoming' }); assert.equal(broken.document, null); assert.match(broken.error, /parent/);
  const kept = merge(f, { [`node:${f.a}`]: 'incoming', [`node:${f.child}`]: 'incoming' }); assert.equal(node(kept.document, f.child).answer, 'Updated');
  const removed = merge(f, { [`node:${f.a}`]: 'local', [`node:${f.child}`]: 'local' }); assert.equal(node(removed.document, f.a), undefined);
});

test('guidance conflicts are explicit and changed context marks retained questions for review', () => {
  const f = fixture(); f.local.journey.objective = 'Local objective'; f.incoming.journey.objective = 'Incoming objective';
  const pending = merge(f); assert.deepEqual(pending.unresolved, ['field:objective']);
  const result = merge(f, { 'field:objective': 'local' }); assert.equal(result.document.journey.objective, 'Local objective'); assert.equal(result.affected.length, 3);
  assert.equal(result.document.journey.nodes[0].review, false);
});

test('ordering combines independent additions but competing reorders require a choice', () => {
  const f = fixture(), ids = f.base.journey.nodes.map(n => n.id);
  f.local.journey.nodes.reverse(); f.incoming.journey.nodes = [f.incoming.journey.nodes[1], f.incoming.journey.nodes[0], ...f.incoming.journey.nodes.slice(2)];
  assert.deepEqual(merge(f).unresolved, ['order']);
  assert.deepEqual(merge(f, { order: 'incoming' }).document.journey.nodes.map(n => n.id), [ids[1], ids[0], ...ids.slice(2)]);
  const next = fixture();
  for (const [side, id] of [['local', 'local-new'], ['incoming', 'incoming-new']]) next[side].journey.nodes.push({ ...node(next.base, next.b), id });
  const merged = merge(next); assert.equal(merged.conflicts.length, 0); assert.deepEqual(merged.document.journey.nodes.slice(-2).map(n => n.id), ['local-new', 'incoming-new']);
});

test('invalid graphs, unknown families and different journey identities cannot merge', () => {
  for (const mutate of [doc => { doc.version = 2; }, doc => { doc.journey.futureADR = []; }, doc => { doc.journey.nodes.push(doc.journey.nodes[0]); }, doc => { doc.journey.id = 'other'; }]) {
    const f = fixture(); mutate(f.incoming); assert.throws(() => merge(f));
  }
  const f = fixture(); node(f.local, f.a).parentId = f.b; node(f.incoming, f.b).parentId = f.a;
  const cycle = merge(f); assert.equal(cycle.document, null); assert.match(cycle.error, /cycle|disconnected/);
  assert.ok(cycle.conflicts.some(row => row.id === 'graph'));
  const chosen = merge(f, { graph: 'incoming' }); assert.ok(chosen.document); assert.equal(node(chosen.document, f.a).parentId, f.base.journey.rootId); assert.equal(node(chosen.document, f.b).parentId, f.a);
});

test('all supported metadata families survive unchanged and atomic metadata conflicts retain both candidates', () => {
  const f = fixture(), journey = f.base.journey, a = node(f.base, f.a);
  journey.mode = 'decide'; journey.objective = 'Choose'; journey.successCriteria = 'Fits constraints';
  journey.copyOrigin = { kind: 'personal-copy', sourceId: 'source', sourceDigest: 'a'.repeat(64) };
  journey.pins = [{ text: ' Keep offline access ', id: 'constraint-12345678901234' }];
  a.generation = { requestId: 'request', originalQuestion: a.question, originalCategory: a.category, adjusted: false };
  a.importance = 'high'; a.importanceReason = 'Affects storage'; a.rationale = 'Scope'; a.review = true;
  a.revisit = { date: '2026-12-01', condition: 'When revised', acknowledgedAt: null };
  a.research = { basis: 'reasoning', summary: 'Model view', options: [{ title: 'One', description: 'First', pros: ['Simple'], cons: ['Limited'] }, { title: 'Two', description: 'Second', pros: ['Flexible'], cons: ['Complex'] }], recommendation: 'One', uncertainty: 'Check context', sources: [] };
  journey.nodes.push({ id: 'direction', parentId: journey.rootId, kind: 'direction', question: 'User direction', category: 'Direction', answer: '', research: null, review: false });
  const doc = { ...journey, format: 'copilot-explorer', version: 1, revision: 0 };
  const sections = JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] });
  journey.brief = acceptBrief(parseBrief(sections, prepareBrief(doc)), []);
  journey.handoff = acceptHandoff(parseHandoff(sections, prepareHandoff(doc, { nodeIds: [f.a], format: 'plan', includeEvidence: true })), []);
  f.local = structuredClone(f.base); f.incoming = structuredClone(f.base);
  assert.deepEqual(merge(f).document, f.base);
  f.local.journey.pins[0].text = 'Local constraint'; f.incoming.journey.pins[0].text = 'Incoming constraint';
  const result = merge(f); assert.deepEqual(result.unresolved, ['field:pins']);
  const selected = merge(f, { 'field:pins': 'incoming' });
  assert.deepEqual(selected.document.journey.brief, journey.brief); assert.deepEqual(selected.document.journey.handoff, journey.handoff);
  assert.equal(selected.document.journey.pins[0].text, 'Incoming constraint'); assert.equal(f.local.journey.pins[0].text, 'Local constraint');
});
