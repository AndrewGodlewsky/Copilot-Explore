import test from 'node:test';
import assert from 'node:assert/strict';
import { claimFreshness, sourceDateObservations, sourceDateFacts, researchFreshness } from '../com.github.copilot/extensions/explorer/web/research-freshness.mjs';
import { research, createDocument, addQuestions, importedDocument, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { selectedInputs } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';
import { freshnessFindings, FRESHNESS_NOW } from './helpers/research-freshness.mjs';

const DAY = 86400000;
for (const [type, days] of [['price-availability', 1], ['product-version', 7], ['evolving-guidance', 180]]) test(`${type} uses its own exact review boundary without certifying truth`, () => {
  const value = freshnessFindings(type), before = structuredClone(value);
  for (const [offset, status] of [[days * DAY - 1, 'within-window'], [days * DAY, 'review-needed'], [days * DAY + 1, 'review-needed']]) {
    const result = researchFreshness(value, FRESHNESS_NOW + offset);
    assert.equal(result.policyVersion, 1); assert.equal(result.evaluatedAt, new Date(FRESHNESS_NOW + offset).toISOString());
    assert.equal(result.claims[0].status, status); assert.equal(result.claims[0].needsRefresh, status === 'review-needed');
    assert.equal(result.recommendation.needsReview, status === 'review-needed');
    assert.match(result.claims[0].reason, status === 'within-window' ? /not.*(verified|guarantee)/i : /review|recheck/i);
  }
  assert.deepEqual(value, before);
});

test('durable concepts and named versions retain useful historical scope, while legacy classification stays unknown', () => {
  for (const [type, status] of [['durable-concept', 'durable-context'], ['named-version', 'named-version'], ['unknown', 'currentness-unknown']]) {
    const value = freshnessFindings(type); delete value.sources[0].dateObservations;
    const result = researchFreshness(value, FRESHNESS_NOW + 2000 * DAY);
    assert.equal(result.claims[0].status, status); assert.equal(result.claims[0].needsRefresh, false);
    if (type === 'named-version') assert.match(result.claims[0].reason, /November 2026 schedule.*(latest|current)/);
  }
  const value = freshnessFindings(); delete value.claims[0].freshness;
  const result = researchFreshness(value, FRESHNESS_NOW + 2000 * DAY);
  assert.equal(result.claims[0].status, 'currentness-unknown'); assert.match(result.claims[0].reason, /classification.*unknown/i);
});

test('retrieval does not renew old content, and absent dates or evidence cannot establish currentness', () => {
  const value = freshnessFindings(); value.sources[0].dateObservations[0] = { kind: 'published', text: 'Published: 2020-01-01' };
  assert.equal(researchFreshness(value, FRESHNESS_NOW).claims[0].status, 'review-needed');
  delete value.sources[0].dateObservations;
  const unknown = researchFreshness(value, FRESHNESS_NOW);
  assert.equal(unknown.claims[0].status, 'currentness-unknown'); assert.equal(unknown.recommendation.needsReview, true);
  assert.equal(researchFreshness(value, FRESHNESS_NOW + DAY).claims[0].status, 'review-needed', 'old read still needs review when publication is unknown');
  value.sources[0].retrievedAt = null; value.sources[0].provenance = 'imported';
  assert.equal(researchFreshness(value, FRESHNESS_NOW).claims[0].status, 'currentness-unknown');
  value.claims[0].basis = 'reasoning'; value.claims[0].evidence = []; value.sources = [];
  assert.equal(researchFreshness(value, FRESHNESS_NOW).claims[0].status, 'currentness-unknown');
});

test('publication and update labels remain distinct; invalid, conflicting or timezone-ambiguous dates stay unknown', () => {
  const source = freshnessFindings().sources[0];
  source.dateObservations.unshift({ kind: 'published', text: 'Published: 2020-01-01' });
  const facts = sourceDateFacts(source);
  assert.equal(facts.published, '2020-01-01'); assert.equal(facts.updated, '2026-11-20'); assert.equal(facts.effectiveDate, '2026-11-20');
  for (const observations of [
    [{ kind: 'ambiguous', text: '2026-11-20' }], [{ kind: 'updated', text: 'Updated: 11/20/2026' }],
    [{ kind: 'updated', text: 'Published: 2026-11-20' }],
    [{ kind: 'updated', text: 'Updated: 2026-02-30' }], [{ kind: 'updated', text: 'Updated: 2026-11-20 10:00 PST' }],
    [{ kind: 'updated', text: '2026-11-20T00:00:00Z' }], [{ kind: 'updated', text: '2026-11-20 +0100' }],
    [{ kind: 'updated', text: '2026-11-20' }, { kind: 'updated', text: '2026-11-19' }],
    [{ kind: 'published', text: '2026-11-20' }, { kind: 'updated', text: '2026-11-19' }],
    [{ kind: 'updated', text: 'Published 2020-01-01, updated 2026-11-20' }],
  ]) { source.dateObservations = observations; assert.equal(sourceDateFacts(source).effectiveDate, null, JSON.stringify(observations)); }
});

test('future dates and clock rollback do not become age zero or fresh evidence', () => {
  const value = freshnessFindings();
  for (const now of [FRESHNESS_NOW - 1, NaN, Infinity]) {
    const result = researchFreshness(value, now); assert.equal(result.claims[0].status, 'currentness-unknown'); assert.equal(result.claims[0].needsRefresh, true);
  }
  value.sources[0].dateObservations[0].text = 'Updated: 2027-01-01';
  assert.equal(researchFreshness(value, FRESHNESS_NOW).claims[0].status, 'currentness-unknown');
});

test('material recommendation scope excludes an explicitly unrelated stale alternative and exposes unknown legacy coverage', () => {
  const value = freshnessFindings('durable-concept');
  value.claims.push({ ...structuredClone(value.claims[0]), id: 'cost', freshness: { type: 'price-availability', reason: 'Price changes', version: null } });
  value.support.push({ optionId: 'distributed', field: 'cons', text: value.options[1].cons[0], claimIds: ['cost'], decisionIds: [] });
  let result = researchFreshness(value, FRESHNESS_NOW + DAY);
  assert.equal(result.claims[1].status, 'review-needed'); assert.equal(result.recommendation.needsReview, false);
  value.support[0].claimIds.push('cost'); result = researchFreshness(value, FRESHNESS_NOW + DAY);
  assert.equal(result.recommendation.needsReview, true); assert.deepEqual(result.recommendation.claimIds, ['cost']);
  delete value.support; result = researchFreshness(value, FRESHNESS_NOW + DAY);
  assert.equal(result.recommendation.coverage, 'unknown'); assert.equal(result.recommendation.needsReview, true);
});

test('bounded freshness metadata preserves Unicode and rejects unsupported fields and malformed classifications', () => {
  const classification = { type: 'named-version', reason: '中文 🌿', version: 'v2 λ' };
  assert.deepEqual(claimFreshness(classification), classification);
  assert.deepEqual(sourceDateObservations([{ kind: 'published', text: '公開日：2026-11-20' }]), [{ kind: 'published', text: '公開日：2026-11-20' }]);
  for (const bad of [{ ...classification, type: 'verified' }, { ...classification, reason: '' }, { ...classification, reason: 'x'.repeat(301) }, { ...classification, version: 'x'.repeat(121) }, { ...classification, type: 'durable-concept' }, { ...classification, extra: true }]) assert.throws(() => claimFreshness(bad));
  for (const bad of [[{ kind: 'retrieved', text: '2026-11-20' }], [{ kind: 'updated', text: '' }], [{ kind: 'updated', text: 'x'.repeat(161) }], [{ kind: 'updated', text: '2026-11-20', date: '2026-11-20' }], Array.from({ length: 4 }, () => ({ kind: 'updated', text: '2026-11-20' }))]) assert.throws(() => sourceDateObservations(bad));
});

test('model save/import and selected artifact evidence retain date observations and claim scope without changing read time', () => {
  const value = freshnessFindings(), normalized = research(value);
  assert.deepEqual(normalized, value);
  const doc = createDocument('Freshness'), [node] = addQuestions(doc, doc.rootId, [{ question: 'Current access?', category: 'Access' }]); node.research = value;
  assert.deepEqual(validateDocument(doc).nodes[1].research, value);
  const imported = importedDocument(doc).nodes[1].research;
  assert.deepEqual(imported.sources[0].dateObservations, value.sources[0].dateObservations); assert.equal(imported.sources[0].retrievedAt, value.sources[0].retrievedAt); assert.equal(imported.sources[0].provenance, 'imported');
  const selected = selectedInputs(doc, [node.id], true).context.evidence[0];
  assert.deepEqual(selected.sources[0].dateObservations, value.sources[0].dateObservations); assert.deepEqual(selected.claims[0].freshness, value.claims[0].freshness);
  const legacy = structuredClone(value); delete legacy.sources[0].dateObservations; delete legacy.claims[0].freshness;
  assert.deepEqual(research(legacy), legacy);
});
