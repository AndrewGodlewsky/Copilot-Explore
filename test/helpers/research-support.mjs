import { recommendationFindings } from './research-recommendation.mjs';

export function supportFindings(decisionId = 'prior-access') {
  const value = recommendationFindings();
  value.basis = 'sources';
  value.options[0].pros = ['The cupboard is open all weekend', 'Loans cost nothing'];
  value.options[0].cons = ['Access depends on key holders'];
  value.sources = [{ id: 'hours', title: 'Fixture opening hours', url: 'https://example.com/hours', retrievedAt: '2026-11-20T00:00:00.000Z', provenance: 'recorded-read' }];
  value.claims = [
    { id: 'contrary', text: 'The cupboard is open all weekend', basis: 'sources', evidence: [{ sourceId: 'hours', paraphrase: 'The page says the office closes on Sunday.' }], limitations: 'This passage contradicts the claimed weekend access. Check the exact cupboard hours.' },
    { id: 'irrelevant', text: 'Loans cost nothing', basis: 'sources', evidence: [{ sourceId: 'hours', paraphrase: 'The page describes office hours, not loan fees.' }], limitations: 'This citation is irrelevant to loan fees. Cost remains unsupported.' },
    { id: 'judgment', text: 'A shared inventory may simplify a small pilot.', basis: 'reasoning', evidence: [], limitations: 'A fit judgment from the model, not a sourced fact.' },
  ];
  value.recommendationAssessment.decisionRefs = [{ nodeId: decisionId, reason: 'The user suggested two key holders; availability is unconfirmed.', answerState: 'assumption', review: true }];
  value.support = [
    { optionId: 'cupboard', field: 'pros', text: value.options[0].pros[0], claimIds: ['contrary'], decisionIds: [] },
    { optionId: 'cupboard', field: 'pros', text: value.options[0].pros[1], claimIds: ['irrelevant'], decisionIds: [] },
    { optionId: 'cupboard', field: 'cons', text: value.options[0].cons[0], claimIds: [], decisionIds: [decisionId] },
    { optionId: null, field: 'recommendation', text: value.recommendation, claimIds: ['judgment'], decisionIds: [decisionId] },
    { optionId: null, field: 'mainTradeoff', text: value.recommendationAssessment.mainTradeoff, claimIds: [], decisionIds: [] },
  ];
  return value;
}
