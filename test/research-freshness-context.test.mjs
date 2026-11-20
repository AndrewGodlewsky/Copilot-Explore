import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import * as context from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { prepareFollowup, parseFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { prepareReconsideration, comparisonResult } from '../com.github.copilot/extensions/explorer/research-comparison.mjs';
import { freshnessFindings, FRESHNESS_NOW } from './helpers/research-freshness.mjs';

const DAY = 86400000;
function fixture() {
  const doc = createDocument('Current access'), [node] = addQuestions(doc, doc.rootId, [{ question: 'When is access available?', category: 'Access' }]);
  node.research = freshnessFindings(); return { doc, node };
}
const criteria = [{ id: 'access', label: 'Access', priority: 'high' }];
const comparison = p => ({ cells: p.comparison.options.map(option => ({ criterionId: 'access', optionId: option.id, explanation: 'The old schedule is historical.', basis: 'prior-claim', claimIds: ['access'] })), recommendation: { optionId: 'cupboard', reason: 'Conditional fit', changed: 'Access is emphasized', unchanged: 'The old evidence is not renewed' }, uncertainty: 'Current access is unknown.' });

test('followup and reconsideration capture immutable exact freshness input with policy and evaluation time', () => {
  const { doc, node } = fixture();
  const followup = prepareFollowup(doc, node.id, { question: 'Why?', hypothetical: false }, { now: FRESHNESS_NOW });
  const evidence = followup.followup.original.find(item => item.kind === 'evidence');
  assert.equal(evidence.freshness.policyVersion, 1); assert.equal(evidence.freshness.evaluatedAt, new Date(FRESHNESS_NOW).toISOString());
  assert.equal(evidence.freshness.claims[0].status, 'within-window'); assert.ok(followup.prompt.includes(JSON.stringify(evidence)));
  assert.equal(followup.bytes, Buffer.byteLength(followup.instructions) + Buffer.byteLength(followup.prompt));
  const p = prepareReconsideration(doc, node.id, { criteria }, { now: FRESHNESS_NOW });
  assert.deepEqual(p.comparison.freshness, evidence.freshness); assert.ok(p.prompt.includes(JSON.stringify(p.comparison)));
  assert.ok(Object.isFrozen(p.comparison.freshness)); assert.ok(Object.isFrozen(evidence.freshness));
});

test('meaningful age changes and clock rollback require new review without rewriting captured input', () => {
  const { doc, node } = fixture(), p = prepareReconsideration(doc, node.id, { criteria }, { now: FRESHNESS_NOW }), before = structuredClone(p);
  assert.equal(typeof context.sameReviewedResearchFreshness, 'function');
  assert.equal(context.sameReviewedResearchFreshness(p, FRESHNESS_NOW + DAY - 1), true);
  assert.equal(context.sameReviewedResearchFreshness(p, FRESHNESS_NOW + DAY), false);
  assert.equal(context.sameReviewedResearchFreshness(p, FRESHNESS_NOW - 1), false);
  assert.equal(context.sameReviewedResearchFreshness(p, NaN), false); assert.deepEqual(p, before);
  const followup = prepareFollowup(doc, node.id, { question: 'Why?', hypothetical: false }, { now: FRESHNESS_NOW });
  assert.equal(context.sameReviewedResearchFreshness(followup, FRESHNESS_NOW + DAY), false);
});

test('tool-free reconsideration cannot renew an expired material premise but keeps historical comparison cells', () => {
  const { doc, node } = fixture(), now = FRESHNESS_NOW + DAY;
  const p = prepareReconsideration(doc, node.id, { criteria }, { now });
  assert.equal(p.comparison.freshness.recommendation.needsReview, true);
  const value = comparison(p); assert.throws(() => comparisonResult(value, p, now), /comparison|freshness/i);
  value.recommendation.optionId = null; assert.deepEqual(comparisonResult(value, p, now), value);
  const earlier = prepareReconsideration(doc, node.id, { criteria }, { now: FRESHNESS_NOW });
  assert.throws(() => comparisonResult(value, earlier, now), /freshness|review|comparison/i);
});

test('changed comparison winners check their own material support and returned claim references', () => {
  const { doc, node } = fixture(), now = FRESHNESS_NOW + DAY;
  node.research = freshnessFindings('durable-concept');
  node.research.claims.push({ ...structuredClone(node.research.claims[0]), id: 'cost', freshness: { type: 'price-availability', reason: 'Current price', version: null } });
  node.research.support.push({ optionId: 'distributed', field: 'pros', text: node.research.options[1].pros[0], claimIds: ['cost'], decisionIds: [] });
  let p = prepareReconsideration(doc, node.id, { criteria }, { now }), value = comparison(p);
  value.cells.find(c => c.optionId === 'distributed').claimIds = ['cost'];
  assert.equal(p.comparison.freshness.recommendation.needsReview, false);
  assert.equal(comparisonResult(value, p, now).recommendation.optionId, 'cupboard', 'unrelated stale alternative remains readable');
  value.recommendation.optionId = 'distributed';
  assert.throws(() => comparisonResult(value, p, now), /comparison/);
  value.cells.find(c => c.optionId === 'distributed').claimIds = ['access'];
  assert.throws(() => comparisonResult(value, p, now), /comparison/, 'recorded option support also governs a changed winner');
  node.research.support.pop(); p = prepareReconsideration(doc, node.id, { criteria }, { now });
  value.cells.find(c => c.optionId === 'distributed').claimIds = ['cost'];
  assert.throws(() => comparisonResult(value, p, now), /comparison/, 'returned references cannot bypass missing recorded option support');
  value.recommendation.optionId = null; assert.equal(comparisonResult(value, p, now).recommendation.optionId, null);
});

test('followup cannot relabel expired prior evidence as a current sourced assertion and retains explicit unknowns', () => {
  const { doc, node } = fixture(), now = FRESHNESS_NOW + DAY;
  const p = prepareFollowup(doc, node.id, { question: 'Is access currently available?', hypothetical: false }, { now });
  const raw = { answer: 'Current access remains unknown.', uncertainty: 'Old schedule only.', claims: [{ ...node.research.claims[0], evidence: [{ sourceId: 'old', paraphrase: 'Old schedule' }] }], sources: [{ id: 'old', prior: { origin: 'original', sourceId: 'host' } }] };
  assert.throws(() => parseFollowup(JSON.stringify(raw), p, new Map(), new Map(), now), /currentness|freshness|review/i);
  raw.claims[0].basis = 'unknown'; raw.claims[0].evidence = [];
  assert.equal(parseFollowup(JSON.stringify(raw), p, new Map(), new Map(), now).claims[0].basis, 'unknown');
});

test('included exchange evidence ages without mutating saved discussion or leaking omitted evidence', () => {
  const { doc, node } = fixture(), r = freshnessFindings();
  const exchange = { id: 'prior-exchange', question: 'Prior date?', hypothetical: false,
    result: { answer: 'Historical schedule', uncertainty: 'Check applicability', claims: r.claims, sources: r.sources.map(source => ({ ...source, evidenceOrigin: { origin: 'current', sourceId: null } })) } };
  const before = structuredClone(exchange);
  const p = prepareFollowup(doc, node.id, { question: 'Again?', hypothetical: false }, { now: FRESHNESS_NOW, history: { exchanges: [exchange], dropped: 0 } });
  assert.equal(p.followup.exchanges[0].freshness.claims[0].status, 'within-window');
  assert.deepEqual(exchange, before); assert.equal(context.sameReviewedResearchFreshness(p, FRESHNESS_NOW + DAY), false);
  node.research = { ...node.research, claims: undefined, sources: [], basis: 'reasoning' };
  const absent = prepareFollowup(doc, node.id, { question: 'Again?', hypothetical: false }, { now: FRESHNESS_NOW });
  assert.ok(!absent.prompt.includes('Updated: 2026-11-20')); assert.equal(absent.followup.exchanges.length, 0);
});
