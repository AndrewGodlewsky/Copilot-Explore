import { isDeepStrictEqual as equal } from 'node:util';
import { validateAdrFile } from './adr-file.mjs';
import { adrSourcesStatus } from './adr-sources.mjs';
import { adrReviewContext, adrReviewContextChanges } from './adr-review-context.mjs';
import { record } from './research-context.mjs';
import { savedDigest } from './review-causes.mjs';

/** Saved-source comparison only. On-disk file availability is a separate observed state. */
export function adrUpdateStatus(value, doc, path = null, scenario) {
  const entry = validateAdrFile(value), capture = entry.sources, source = adrSourcesStatus(capture, doc, path), reasons = [];
  const coverage = { baseline: entry.generated ? 'available' : 'unavailable', context: capture?.freshness ? 'available' : 'unavailable', scenario: capture?.freshness && scenario !== undefined ? 'available' : 'unavailable' };
  if (source.status === 'unavailable') return { status: 'unavailable', reasons: [{ kind: 'unavailable', message: source.message }], coverage, omittedReasons: 0 };
  for (const node of source.nodes) if (node.status !== 'current') {
    if (node.status === 'missing') { reasons.push({ kind: 'missing', id: node.id, message: `Selected source ${node.id} is missing.` }); continue; }
    const before = capture.nodes.find(n => n.record.id === node.id).record, current = record(doc.nodes.find(n => n.id === node.id));
    const fields = ['question', 'answer', 'answerState', 'review', 'parentId', 'kind', 'origin'].filter(field => !equal(before[field], current[field]));
    for (const field of fields) reasons.push({ kind: field === 'answerState' ? 'certainty' : 'source', id: node.id, message: `Selected source ${node.id}: ${field === 'answerState' ? 'answer certainty' : field} changed.` });
    if (!fields.length) reasons.push({ kind: 'evidence', id: node.id, message: `Recorded evidence or portable source fingerprint changed for ${node.id}.` });
  }
  if (source.guidanceChanged) reasons.push({ kind: 'guidance', message: 'Saved project topic, objective, success criteria, mode or constraints changed.' });
  if (capture.freshness) {
    try { reasons.push(...adrReviewContextChanges(capture.freshness.context, adrReviewContext(doc, capture.nodes.map(n => n.record.id), capture.includeEvidence))); }
    catch { coverage.context = 'unavailable'; reasons.push({ kind: 'unavailable', message: 'Current dependency context is missing or exceeds the bounded review limit.' }); }
    if (scenario !== undefined && savedDigest(scenario) !== capture.freshness.scenarioDigest) reasons.push({ kind: 'scenario', message: 'The selected scenario, preference or scenario rationale changed since the reviewed source scope.' });
  } else reasons.push({ kind: 'unavailable', message: 'This historical capture has no reviewed dependency/research-staleness context or scenario fingerprint. Its selected source content can still be compared.' });
  if (coverage.scenario === 'unavailable') reasons.push({ kind: 'unavailable', message: 'Current or historical scenario proof is unavailable; no matching scenario is assumed.' });
  const changed = reasons.some(r => r.kind !== 'unavailable'), status = source.status === 'missing' ? 'missing' : changed ? 'changed' : Object.entries(coverage).some(([key, value]) => key !== 'baseline' && value === 'unavailable') ? 'unavailable' : 'current';
  return { status, reasons: reasons.slice(0, 200), omittedReasons: Math.max(0, reasons.length - 200), coverage };
}
