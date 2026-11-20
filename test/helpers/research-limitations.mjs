import { recommendationFindings } from './research-recommendation.mjs';

export function limitationFindings(kind = 'conflict', decisionId = 'prior-access') {
  const value = recommendationFindings();
  value.recommendation = 'Check the missing access information before choosing.';
  value.recommendationAssessment.optionId = null;
  const entry = { id: 'access-gap', kind: 'conflict', summary: 'The two pages disagree about Sunday access; their applicable dates are unclear.', claimIds: ['access'], optionIds: ['cupboard'], decisionIds: [], blocksRecommendation: true, nextStep: 'Ask the cupboard host which Sunday access policy currently applies.' };
  if (kind === 'conflict' || kind === 'dependent-sources') {
    value.basis = 'sources';
    value.sources = ['host', 'directory'].map(id => ({ id, title: `${id} access information`, url: `https://example.com/${id}`, retrievedAt: '2026-11-20T00:00:00.000Z', provenance: 'recorded-read' }));
    value.claims[0] = { id: 'access', text: 'Sunday access is unresolved.', basis: 'sources', evidence: [{ sourceId: 'host', paraphrase: 'The host page says Sunday collection is available.' }, { sourceId: 'directory', paraphrase: 'The directory says Sunday collection is unavailable.' }], limitations: 'Publication dates and applicability are unknown; neither statement was independently verified.' };
    if (kind === 'dependent-sources') {
      entry.kind = kind; entry.summary = 'Both pages cite each other without an identifiable original schedule. Repetition is not independent support.';
      entry.nextStep = 'Obtain the original access schedule directly from the cupboard host.';
      value.claims[0].evidence[1].paraphrase = 'The directory repeats the host entry and links back to it.';
    }
  } else if (kind === 'sparse' || kind === 'unavailable') {
    const count = kind === 'sparse' ? 1 : 0;
    value.options = value.options.slice(0, count); value.optionsLimit = 'No evidence establishes additional feasible arrangements.';
    entry.kind = 'missing-evidence'; entry.optionIds = value.options.map(option => option.id);
    entry.summary = kind === 'sparse' ? 'Only one plausible arrangement is described; access remains unconfirmed.' : 'Retrieval was unavailable. This is reasoning without external verification.';
    entry.nextStep = 'Supply the host access schedule or explicitly research again when retrieval is available.';
  } else if (kind === 'constraints') {
    value.recommendationAssessment.decisionRefs = [{ nodeId: decisionId, reason: 'Access was assumed to be both appointment-only and available at any time.', answerState: 'assumption', review: true }];
    entry.kind = 'assumption'; entry.summary = 'The captured user constraints conflict: appointment-only collection and access at any time.';
    entry.decisionIds = [decisionId]; entry.nextStep = 'Clarify whether unrestricted access or scheduled collection is the actual requirement.';
  }
  value.limitations = [entry];
  return value;
}
