import { isDeepStrictEqual as equal } from 'node:util';
import { ADR_SECTIONS, validateAdrDraft, validateAdrReadinessReceipt } from './adr-draft.mjs';
import { defaultAdrFormat } from './adr-format.mjs';
import { identity, framing, record } from './research-context.mjs';
import { selectedInputs } from './implementation-handoff.mjs';
import { savedDigest } from './review-causes.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => savedDigest(canonical(value));
const sectionTarget = (section, statementId) => ({ kind: 'section', section, ...(statementId ? { statementId } : {}) });
const nodeTarget = id => ({ kind: 'node', id });
const list = value => Array.isArray(value) ? value : [];
const evidenceFor = (doc, id) => { try { return selectedInputs(doc, [id], true).context.evidence[0]; } catch { return null; } };

export function adrReadiness(value, doc, scenario) {
  const items = [];
  const add = (code, severity, reason, target) => {
    const id = digest([code, target]);
    if (!items.some(item => item.id === id)) items.push({ id, code, severity, reason, target });
  };
  const finish = (draft, current) => {
    const { acceptedAt, version, readiness, ...content } = draft ?? {};
    const fingerprint = digest({ draft: content, current, items });
    const advisoryIds = new Set(items.filter(item => item.severity === 'advisory').map(item => item.id));
    return { version: 1, digest: fingerprint, items, blockers: items.filter(item => item.severity === 'blocker').length, advisories: advisoryIds.size,
      acknowledged: readiness?.digest === fingerprint ? readiness.acknowledged.filter(id => advisoryIds.has(id)) : [] };
  };
  // Normal import/generation validation already rejects these references. Keep a
  // precise section explanation for a draft inspected at a malformed boundary.
  for (const section of ADR_SECTIONS) for (const statement of (Array.isArray(value?.sections?.[section]) ? value.sections[section].slice(0, 5) : [])) {
    for (const ref of (Array.isArray(statement?.sources) ? statement.sources.slice(0, 8) : [])) {
      const supported = ref?.kind === 'node' ? list(value.dependencies?.records).some(source => source?.id === ref.id)
        : ref?.kind === 'guidance' ? ['topic', 'objective', 'successCriteria', 'pins'].includes(ref.field)
        : ref?.kind === 'evidence' && list(value.evidence).some(item => item?.nodeId === ref.nodeId && list(item.sources).some(source => source?.id === ref.sourceId));
      if (!supported) add('unsupported-reference', 'blocker', `This statement has an unsupported or untransmitted ${ref?.kind ?? 'unknown'} reference.`, sectionTarget(section, statement?.id));
    }
  }
  let draft;
  try { draft = validateAdrDraft({ ...value, version: 1, acceptedAt: value?.acceptedAt ?? '2000-01-01T00:00:00.000Z' }); }
  catch (error) {
    if (!items.length) add('invalid-draft', 'blocker', error.message, sectionTarget('outcome'));
    return finish(null, { invalid: true });
  }
  if (!doc) { add('missing-journey', 'blocker', 'The saved exploration is unavailable; references cannot be checked.', sectionTarget('context')); return finish(draft, null); }
  const byId = new Map(doc.nodes.map(node => [node.id, node]));
  const currentRecords = draft.dependencies.records.map(source => {
    const node = byId.get(source.id); if (!node) return null;
    return { record: record(node), reviewCauses: node.reviewCauses ?? null,
      ...(draft.includeEvidence ? { evidence: evidenceFor(doc, node.id), researchStale: !!node.researchStale } : {}) };
  });
  const current = { identity: identity(doc), guidance: framing(doc), format: doc.adrFormat ?? defaultAdrFormat(), scope: doc.adrScope ?? null, records: currentRecords, scenario: scenario ?? null, scenarioKnown: scenario !== undefined };
  if (savedDigest(current.identity) !== draft.dependencies.identity) add('changed-identity', 'blocker', 'This draft belongs to a different saved exploration identity.', sectionTarget('context'));
  if (savedDigest(current.guidance) !== draft.dependencies.guidance) add('changed-guidance', 'blocker', 'Global guidance changed after the draft source capture.', sectionTarget('context'));
  if (!equal(current.format, draft.format)) add('changed-format', 'blocker', 'The saved ADR format changed after this draft was captured.', { kind: 'control', id: 'adr-format-open' });
  if (!equal(current.scope, draft.scope)) add('changed-scope', 'blocker', 'The saved ADR scope changed or is unavailable. Review it before generating from new inputs.', { kind: 'control', id: 'adr-scope-open' });
  if (scenario === undefined) add('unknown-scenario', 'blocker', 'Current scenario context has not been checked.', sectionTarget('context'));
  else if (savedDigest(scenario) !== draft.scope.scenarioDigest) add('changed-scenario', 'blocker', 'Scenario context changed after the draft source capture.', sectionTarget('context'));
  for (let index = 0; index < draft.dependencies.records.length; index++) {
    const source = draft.dependencies.records[index], now = currentRecords[index], target = nodeTarget(source.id);
    if (!now) { add('missing-source', 'blocker', 'Captured source is no longer in this exploration.', target); continue; }
    if (savedDigest(now.record) !== source.hash) add('changed-source', 'blocker', 'Saved source changed after this draft was captured.', target);
    if (now.record.review) add('needs-review-source', 'advisory', 'Saved source is marked needs review.', target);
    if (['unanswered', 'tentative', 'assumption', 'needs-evidence', 'revisit-later'].includes(now.record.answerState)) add('unresolved-source', 'advisory', `Saved source is ${now.record.answerState}. This is recorded intent, not a verified fact.`, target);
    if (draft.includeEvidence && !equal(now.evidence, draft.evidence.find(item => item.nodeId === source.id))) add('changed-evidence', 'blocker', 'Included recorded evidence changed after capture.', target);
    if (now.researchStale) add('stale-evidence', 'advisory', 'Included research is marked stale for this saved source.', target);
  }
  if (!draft.sections.outcome.length) add('missing-outcome', 'advisory', 'No chosen outcome is written in the draft. A proposed ADR may honestly leave it unspecified.', sectionTarget('outcome'));
  else if (!draft.sections.outcome.some(statement => statement.certainty === 'user-decision' && statement.sources.some(ref => ref.kind === 'node' && currentRecords.some(now => now?.record.id === ref.id && now.record.answerState === 'decided' && !now.record.review)))) add('unsettled-outcome', 'advisory', 'The outcome is not mapped to a settled, non-review decided answer. Keep it provisional.', sectionTarget('outcome'));
  add('rationale-unconfirmed', 'advisory', 'Check that the outcome explains the recorded reason for the choice, or explicitly says it is unknown. Free-form wording and a model explanation do not establish a user rationale.', sectionTarget('outcome'));
  if (!draft.sections.alternatives.length) add('missing-alternatives', 'advisory', 'No alternative is recorded in the draft. This may be an honest gap or an omitted template section.', sectionTarget('alternatives'));
  for (const section of ADR_SECTIONS) for (const statement of draft.sections[section]) {
    const target = sectionTarget(section, statement.id);
    if (!statement.sources.length) add('unmapped-statement', 'advisory', 'This statement has no mapped saved source. Review its wording as an unknown, assumption or suggestion.', target);
    if (statement.edited) add('edited-statement', 'advisory', 'User-edited wording retains original references; its meaning has not been reverified against them.', target);
    if (statement.certainty === 'assumption') add('draft-assumption', 'advisory', 'This draft statement is explicitly an assumption, not an established fact.', target);
  }
  return finish(draft, current);
}

export function captureAdrReadiness(report, submitted) {
  if (report.blockers) throw Error('ADR readiness has correctness blockers. Resolve stale or invalid references before accepting.');
  if (submitted !== undefined && (!submitted || Object.keys(submitted).sort().join(',') !== 'acknowledged,digest')) throw Error('Invalid ADR readiness acknowledgment.');
  const receipt = validateAdrReadinessReceipt({ version: 1, reviewedAt: new Date().toISOString(), digest: submitted?.digest ?? report.digest, acknowledged: submitted?.acknowledged ?? [] });
  if (receipt.digest !== report.digest) throw Error('ADR readiness changed. Check the current wording and saved sources again.');
  const advisoryIds = new Set(report.items.filter(item => item.severity === 'advisory').map(item => item.id));
  if (receipt.acknowledged.some(id => !advisoryIds.has(id))) throw Error('Only current advisory gaps can be acknowledged; blockers cannot be waived.');
  return receipt;
}
