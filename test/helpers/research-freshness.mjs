import { recommendationFindings } from './research-recommendation.mjs';

export const FRESHNESS_NOW = Date.parse('2026-11-20T00:00:00.000Z');
export function freshnessFindings(type = 'price-availability') {
  const value = recommendationFindings(); value.basis = 'sources';
  value.sources = [{ id: 'host', title: 'Host policy', url: 'https://example.com/access', retrievedAt: new Date(FRESHNESS_NOW).toISOString(), provenance: 'recorded-read',
    dateObservations: [{ kind: 'updated', text: 'Updated: 2026-11-20' }] }];
  value.claims[0] = { id: 'access', text: 'The host currently offers Sunday access.', basis: 'sources', evidence: [{ sourceId: 'host', paraphrase: 'The host lists Sunday collection.' }], limitations: 'The host statement is not independently verified.',
    freshness: { type, reason: 'Access arrangements can change.', version: type === 'named-version' ? 'November 2026 schedule' : null } };
  value.support = [{ optionId: null, field: 'recommendation', text: value.recommendation, claimIds: ['access'], decisionIds: [] }];
  return value;
}
