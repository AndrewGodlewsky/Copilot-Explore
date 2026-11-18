import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';

function fixture() {
  const doc = model.createDocument('Explain impact');
  const node = (id, parentId = doc.rootId, answerState = 'unanswered', review = false) => ({ id, parentId, question: `Question ${id}`, category: 'Choice', answer: ['decided', 'tentative', 'assumption'].includes(answerState) ? `Answer ${id}` : '', answerState, research: null, review });
  doc.nodes.push(node('a', doc.rootId, 'decided'), node('b', doc.rootId, 'decided', true), node('c', doc.rootId, 'assumption'), node('d', 'b', 'tentative'), node('e', 'a', 'revisit-later'), node('f', doc.rootId, 'needs-evidence'));
  doc.dependencies = [['b','a'], ['c','b'], ['d','c'], ['f','e']].map(([dependentId,prerequisiteId]) => ({dependentId, prerequisiteId}));
  return model.validateDocument(doc);
}
const index = doc => { assert.equal(typeof model.DecisionImpact, 'function'); return new model.DecisionImpact(doc); };

test('impact content keys retain identical snapshots and invalidate relevant same-revision replacements', () => {
  assert.equal(typeof model.decisionImpactKey, 'function');
  const doc = fixture(), key = model.decisionImpactKey(doc), same = structuredClone(doc);
  same.nodes.reverse(); same.dependencies.reverse(); same.revision++; same.nodes.find(n => n.id === 'a').answer = 'Different text, same state';
  assert.equal(model.decisionImpactKey(same), key);
  for (const change of [d => { d.nodes.find(n => n.id === 'a').question = 'New question'; }, d => { d.nodes.find(n => n.id === 'e').parentId = 'b'; }, d => { d.nodes.find(n => n.id === 'b').review = false; }, d => { d.nodes.find(n => n.id === 'b').answerState = 'tentative'; }, d => { d.dependencies.pop(); }]) {
    const replaced = structuredClone(doc); change(replaced); assert.notEqual(model.decisionImpactKey(replaced), key);
  }
});

test('impact separates tree, confirmed and mixed exposure, counts unique questions and explains reproducible paths', () => {
  const doc = fixture(), before = structuredClone(doc), result = index(doc).analyze('a');
  assert.deepEqual(result.affected.map(item => item.id), ['b','c','d','e','f']);
  assert.deepEqual(result.counts, { total: 5, structural: 1, confirmed: 3, mixedOnly: 1, review: 1, assumptions: 1, states: { unanswered: 0, decided: 1, tentative: 1, assumption: 1, 'needs-evidence': 1, 'not-relevant': 0, 'revisit-later': 1 } });
  assert.equal(result.band, 'medium'); assert.deepEqual(doc, before);
  assert.deepEqual(model.impactPath(result, 'c', 'dependency'), [{ id: 'a', via: null }, { id: 'b', via: 'dependency' }, { id: 'c', via: 'dependency' }]);
  assert.deepEqual(model.impactPath(result, 'f', 'combined'), [{ id: 'a', via: null }, { id: 'e', via: 'tree' }, { id: 'f', via: 'dependency' }]);
  assert.deepEqual(model.impactPath(result, 'f', 'dependency'), []);
  assert.equal(result.adrAssociations.status, 'available'); assert.equal(result.adrAssociations.count, 0);
});

test('impact identifies historical ADR sources across the changed node and combined dependency closure without changing bands', () => {
  const doc = fixture(), original = index(doc).analyze('a');
  const association = (id, ids) => ({ id, title: `ADR ${id}`, path: `docs/${id}.md`, status: 'proposed', sources: { journey: { id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt }, adrPath: `nested/docs/${id}.md`, nodes: ids.map(id => ({ record: { id } })) } });
  doc.adrFiles = [association('direct', ['a']), association('dependent', ['c', 'f']), association('unrelated', [doc.rootId]), { id: 'legacy', title: 'Legacy', path: 'old.md', status: 'proposed' }];
  const before = structuredClone(doc), result = index(doc).analyze('a');
  assert.equal(result.band, original.band); assert.deepEqual(result.counts, original.counts); assert.deepEqual(doc, before);
  assert.equal(result.adrAssociations.count, 2); assert.equal(result.adrAssociations.unknown, 1); assert.equal(result.adrAssociations.status, 'partial');
  assert.deepEqual(result.adrAssociations.entries.map(entry => entry.id), ['direct', 'dependent']); assert.match(result.adrAssociations.reason, /nested\/docs\/direct.md/); assert.match(result.adrAssociations.reason, /historical|captured/i);
  const key = model.decisionImpactKey(doc), next = structuredClone(doc); next.adrFiles[0].sources.nodes[0].record.id = 'missing'; assert.notEqual(model.decisionImpactKey(next), key);
  next.adrFiles = [...doc.adrFiles].reverse(); assert.equal(model.decisionImpactKey(next), key);
  next.adrFiles = [association('foreign', ['a'])]; next.adrFiles[0].sources.journey.id = 'other'; assert.equal(index(next).analyze('a').adrAssociations.count, 0); assert.equal(index(next).analyze('a').adrAssociations.unknown, 1);
});

test('union traversal tolerates reverse-to-tree dependency cycles and never counts its source', () => {
  const doc = fixture(); doc.dependencies.push({ dependentId: 'a', prerequisiteId: 'e' }); model.validateDocument(doc);
  const result = index(doc).analyze('a'); assert.equal(result.counts.total, 5); assert.ok(!result.affected.some(item => item.id === 'a'));
  assert.equal(model.impactPath(result, 'f', 'combined').length, 3);
});

test('overlapping tree and explicit paths count once, with both reasons and deterministic shortest paths', () => {
  const doc = fixture(); doc.dependencies.push({ dependentId: 'e', prerequisiteId: 'a' }, { dependentId: 'd', prerequisiteId: 'b' });
  const result = index(doc).analyze('a'), e = result.affected.find(item => item.id === 'e');
  assert.equal(result.counts.total, 5); assert.equal(result.counts.confirmed, 5); assert.equal(result.band, 'high');
  assert.equal(e.structural, true); assert.equal(e.confirmed, true);
  assert.deepEqual(model.impactPath(result, 'd', 'dependency').map(item => item.id), ['a','b','d']);
  const reversed = structuredClone(doc); reversed.nodes.reverse(); reversed.dependencies.reverse();
  const again = index(reversed).analyze('a'); assert.deepEqual(again.affected, result.affected); assert.deepEqual(model.impactPath(again, 'd', 'combined'), model.impactPath(result, 'd', 'combined'));
});

test('leaves and legacy maps have no invented dependence and saved changes refresh analysis without touching importance', () => {
  const doc = fixture(), a = doc.nodes.find(n => n.id === 'a');
  a.generation = { requestId:'generated', originalQuestion:a.question, originalCategory:a.category, adjusted:false }; a.importance = 'high'; a.importanceReason = 'Historical model rationale';
  const original = structuredClone(a), first = index(doc).analyze('f'); assert.equal(first.counts.total, 0); assert.equal(first.band, 'low');
  delete doc.dependencies; const legacy = index(doc).analyze('a'); assert.equal(legacy.counts.total, 1); assert.equal(legacy.counts.confirmed, 0); assert.deepEqual(a, original);
  doc.nodes.find(n => n.id === 'e').answerState = 'assumption'; doc.nodes.find(n => n.id === 'e').answer = 'Unverified';
  assert.equal(index(doc).analyze('a').counts.assumptions, 1);
  doc.nodes = doc.nodes.filter(n => n.id !== 'e'); assert.equal(index(doc).analyze('a').counts.total, 0);
});

test('documented bands follow raw total and confirmed counts at every boundary', () => {
  for (const [count, confirmed, band] of [[0,0,'low'],[4,0,'low'],[5,0,'medium'],[19,0,'medium'],[20,0,'high'],[1,1,'medium'],[4,4,'medium'],[5,5,'high']]) {
    const doc = model.createDocument('Band fixture'); doc.nodes.push({ id:'source', parentId:doc.rootId, question:'Source?', category:'Choice', answer:'', research:null, review:false });
    for(let i=0;i<count;i++) doc.nodes.push({ id:`q${i}`, parentId:'source', question:`Question ${i}`, category:'Choice', answer:'', research:null, review:false });
    if(confirmed) doc.dependencies = Array.from({length:confirmed}, (_,i)=>({dependentId:`q${i}`,prerequisiteId:'source'}));
    const impact = index(doc), result = impact.analyze('source'); assert.equal(result.counts.total,count); assert.equal(result.counts.confirmed,confirmed); assert.equal(result.band,band);
    assert.equal(impact.bandFor('source'), band);
  }
});

test('display bands exactly match full analysis across mixed cycles, direction chains and deterministic varied maps', () => {
  let seed = 71; const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  for (let sample = 0; sample < 8; sample++) {
    const doc = model.createDocument('Varied impact');
    for (let i = 0; i < 80; i++) doc.nodes.push({ id: `q${i}`, parentId: i ? `q${random(i)}` : doc.rootId, question: `Q${i}`, category: 'Choice', answer: '', research: null, review: false });
    doc.dependencies = [];
    for (let i = 1; i < 80; i++) if (random(3)) doc.dependencies.push({ dependentId: `q${random(i)}`, prerequisiteId: `q${i}` });
    model.validateDocument(doc); const impact = index(doc);
    assert.equal(typeof impact.bandFor, 'function');
    for (const node of doc.nodes.slice(1)) { const expected = impact.analyze(node.id).band; assert.equal(impact.bandFor(node.id), expected); assert.equal(impact.bandFor(node.id), expected); }
    assert.throws(() => impact.bandFor(doc.rootId), /ordinary saved question/);
  }
  const doc = model.createDocument('Structural chain');
  doc.nodes.push({ id:'source', parentId:doc.rootId, question:'Source', category:'Choice', answer:'', research:null, review:false });
  for (let i=0; i<3000; i++) doc.nodes.push({ id:`d${i}`, parentId:i?`d${i-1}`:'source', kind:'direction', question:`Direction ${i}`, category:'Direction', answer:'', research:null, review:false });
  const impact = index(doc); assert.equal(impact.bandFor('source'), 'low'); assert.equal(impact.analyze('source').counts.total, 0);
});

test('near-limit deep traversal stores linear predecessor evidence and constructs only the inspected path', () => {
  const doc = model.createDocument('Deep impact');
  for(let i=0;i<4999;i++) doc.nodes.push({id:`q${i}`,parentId:i?`q${i-1}`:doc.rootId,question:`Question ${i}`,category:'Choice',answer:'',research:null,review:false});
  const result = index(doc).analyze('q0'); assert.equal(result.counts.total,4998); assert.equal(result.counts.structural,4998);
  assert.ok(result.visitedEdges <= 3 * (doc.nodes.length - 1));
  assert.ok(result.affected.every(item => !Object.hasOwn(item,'path')));
  assert.equal(model.impactPath(result,'q4998','tree').length,4999); assert.equal(result.band,'high');
});
