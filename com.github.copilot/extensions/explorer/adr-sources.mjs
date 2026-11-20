import { savedDigest } from './review-causes.mjs';
import { framing, record } from './research-context.mjs';
import { selectedInputs } from './implementation-handoff.mjs';
import { ADR_SECTIONS, validateAdrDraft, adrDraftFreshness } from './adr-draft.mjs';
import { selectedResearchEvidence, pinnedConstraints } from './model.mjs';
import { validMode } from './web/modes.mjs';
import { answerStateError } from './web/answer-state.mjs';
import { adrFilePath, adrFileMarker } from './adr-file.mjs';
import { validateProjectPath } from './project-path.mjs';
import { createPortableReference, validatePortableReference, portableReferenceStatus, formatPortableReference } from './portable-reference.mjs';
import { validateAdrReviewContext } from './adr-review-context.mjs';

export const ADR_SOURCE_LIMIT = 65536;
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = v => savedDigest(canonical(v)), equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const invalid = () => { throw Error('Invalid ADR source capture. Preserve the original and review its source identities, mappings and limits.'); };
const keys = (v, names) => v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(v).every(k => typeof k === 'string' && Object.getOwnPropertyDescriptor(v, k)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), 'value')) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const array = (v, max) => Array.isArray(v) && v.length <= max && Object.keys(v).length === v.length;
const text = (v, max, nonblank = false) => typeof v === 'string' && v.isWellFormed() && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v) && (!nonblank || !!v.trim());
const id = v => text(v, 100, true) && v.trim() === v;
const date = v => text(v, 40, true) && Number.isFinite(Date.parse(v));
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function nodeRecord(v) {
  const direction = v?.kind === 'direction';
  if (!keys(v, direction ? 'id,parentId,question,answer,kind,origin,review' : 'id,parentId,question,answer,answerState,review') || !id(v.id) || !id(v.parentId) || v.id === v.parentId || !text(v.question, 600, true) || !text(v.answer, 20000) || typeof v.review !== 'boolean' ||
      (direction ? v.origin !== 'user' || v.answer !== '' : !!answerStateError(v.answer, v.answerState))) invalid();
  return record(v);
}
function guidance(v) {
  if (!keys(v, 'topic,objective,successCriteria,mode,pins') || !text(v.topic, 4000, true) || !text(v.objective, 2000) || !text(v.successCriteria, 4000)) invalid();
  validMode(v.mode); const pins = pinnedConstraints(v.pins);
  if (pins.some(pin => !text(pin.text, 1000, true))) invalid();
  return { topic: v.topic, objective: v.objective, successCriteria: v.successCriteria, mode: v.mode, pins };
}
const sourceFingerprint = (source, evidence) => digest({ record: source, evidence });
function evidenceList(value, nodes, included) {
  if (!array(value, 100) || !included && value.length || included && value.length !== nodes.length) invalid();
  const seen = new Set();
  return value.map(item => {
    if (!keys(item, 'nodeId,basis,sources' + (Object.hasOwn(item ?? {}, 'claims') ? ',claims' : '') + (Object.hasOwn(item ?? {}, 'qualifications') ? ',qualifications' : '')) || !nodes.some(n => n.record.id === item.nodeId) || seen.has(item.nodeId)) invalid();
    seen.add(item.nodeId); const result = { nodeId: item.nodeId, basis: item.basis, ...selectedResearchEvidence(item) };
    if (!equal(item, result)) invalid();
    return result;
  });
}
function mappings(value, nodes, evidence) {
  if (!array(value, 35)) invalid(); const ids = new Set();
  return value.map(item => {
    if (!keys(item, 'id,section,sources') || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || ids.has(item.id) || !ADR_SECTIONS.includes(item.section) || !array(item.sources, 8)) invalid();
    ids.add(item.id); const seen = new Set();
    const sources = item.sources.map(ref => {
      if (!(keys(ref, 'kind,id') && ref.kind === 'node' && nodes.some(n => n.record.id === ref.id)) &&
          !(keys(ref, 'kind,field') && ref.kind === 'guidance' && ['topic', 'objective', 'successCriteria', 'pins'].includes(ref.field)) &&
          !(keys(ref, 'kind,nodeId,sourceId') && ref.kind === 'evidence' && evidence.some(e => e.nodeId === ref.nodeId && e.sources.some(s => s.id && s.id === ref.sourceId)))) invalid();
      const key = digest(ref); if (seen.has(key)) invalid(); seen.add(key); return structuredClone(ref);
    });
    return { id: item.id, section: item.section, sources };
  });
}
export function validateAdrSources(value) {
  if (!keys(value, 'version,capturedAt,journey,adrPath,guidance,includeEvidence,nodes,evidence,references,statements,digest' + (Object.hasOwn(value ?? {}, 'freshness') ? ',freshness' : '')) || value.version !== 1 || !date(value.capturedAt) || typeof value.includeEvidence !== 'boolean' || !sha(value.digest)) invalid();
  const j = value.journey;
  if (!keys(j, 'id,rootId,createdAt,path,commit') || !id(j.id) || !id(j.rootId) || !date(j.createdAt) || j.commit !== null && (typeof j.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(j.commit))) invalid();
  if (j.path === null) { if (value.adrPath !== null || j.commit !== null) invalid(); }
  else {
    if (!text(j.path, 240, true) || !j.path.endsWith('.explore.json') || !text(value.adrPath, 240, true)) invalid();
    validateProjectPath(j.path); validateProjectPath(value.adrPath); adrFilePath(value.adrPath);
  }
  if (!array(value.nodes, 100) || !value.nodes.length) invalid();
  const nodes = value.nodes.map(n => { if (!keys(n, 'record,fingerprint') || !sha(n.fingerprint)) invalid(); return { record: nodeRecord(n.record), fingerprint: n.fingerprint }; });
  if (new Set(nodes.map(n => n.record.id)).size !== nodes.length || nodes.some(n => n.record.id === j.rootId)) invalid();
  const evidence = evidenceList(value.evidence, nodes, value.includeEvidence);
  for (const node of nodes) if (node.fingerprint !== sourceFingerprint(node.record, evidence.find(e => e.nodeId === node.record.id) ?? null)) invalid();
  if (!array(value.references, 100) || value.references.length !== (j.path === null ? 0 : nodes.length)) invalid();
  const references = value.references.map(validatePortableReference), seen = new Set();
  for (const ref of references) {
    if (ref.path !== j.path || ref.journeyId !== j.id || !sha(ref.fingerprint) || seen.has(ref.nodeId) || !nodes.some(n => n.record.id === ref.nodeId)) invalid();
    seen.add(ref.nodeId);
  }
  const result = { version: 1, capturedAt: value.capturedAt, journey: { id: j.id, rootId: j.rootId, createdAt: j.createdAt, path: j.path, commit: j.commit }, adrPath: value.adrPath,
    guidance: guidance(value.guidance), includeEvidence: value.includeEvidence, nodes, evidence, references, statements: mappings(value.statements, nodes, evidence) };
  if (Object.hasOwn(value, 'freshness')) {
    if (!keys(value.freshness, 'version,context,scenarioDigest') || value.freshness.version !== 1 || !sha(value.freshness.scenarioDigest)) invalid();
    result.freshness = { version: 1, context: validateAdrReviewContext(value.freshness.context, nodes.map(n => n.record.id), value.includeEvidence), scenarioDigest: value.freshness.scenarioDigest };
  }
  if (digest(result) !== value.digest) invalid();
  result.digest = value.digest;
  if (Buffer.byteLength(JSON.stringify(result)) > ADR_SOURCE_LIMIT) throw Error('ADR source capture exceeds its 64 KiB limit. Select fewer saved sources or omit research evidence; nothing was clipped.');
  return result;
}
export function captureAdrSources(doc, location = {}, capturedAt = new Date().toISOString()) {
  if (!location || typeof location !== 'object' || Array.isArray(location) || Object.keys(location).some(k => !['journeyPath', 'adrPath', 'commit'].includes(k))) invalid();
  if (!doc?.adrDraft) throw Error('Accept ADR draft wording before capturing its sources.');
  const draft = validateAdrDraft(doc.adrDraft);
  if (adrDraftFreshness(draft, doc) !== 'current') throw Error('ADR sources changed or are stale. Review current accepted wording before capturing sources.');
  const input = selectedInputs(doc, draft.scope.selection.nodeIds, draft.includeEvidence).context, path = location.journeyPath ?? null;
  const value = { version: 1, capturedAt, journey: { id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt, path, commit: location.commit ?? null }, adrPath: location.adrPath ?? null,
    guidance: input.guidance, includeEvidence: input.includeEvidence, nodes: input.records.map(r => ({ record: r, fingerprint: sourceFingerprint(r, input.evidence.find(e => e.nodeId === r.id) ?? null) })), evidence: input.evidence,
    references: path === null ? [] : input.records.map(r => createPortableReference(doc, path, r.id)),
    statements: Object.entries(draft.sections).flatMap(([section, items]) => items.map(item => ({ id: item.id, section, sources: structuredClone(item.sources) }))) };
  if (draft.scope.reviewContext) value.freshness = { version: 1, context: structuredClone(draft.scope.reviewContext), scenarioDigest: draft.scope.scenarioDigest };
  return validateAdrSources({ ...value, digest: digest(value) });
}
export function adrSourcesStatus(value, doc, path = null) {
  if (!value) return { status: 'unavailable', nodes: [], message: 'This legacy ADR has no captured source association.' };
  const capture = validateAdrSources(value), j = capture.journey;
  if (!doc || doc.id !== j.id || doc.rootId !== j.rootId || doc.createdAt !== j.createdAt || j.path !== null && path !== j.path) return { status: 'unavailable', nodes: [], message: 'The captured journey identity or original Project location is unavailable here. Inspect its exact portable reference; no replacement was inferred.' };
  const nodes = capture.nodes.map(saved => {
    const node = doc.nodes.find(n => n.id === saved.record.id);
    if (!node) return { id: saved.record.id, status: 'missing' };
    try {
      const evidence = capture.includeEvidence ? selectedInputs(doc, [node.id], true).context.evidence[0] : null;
      const ref = capture.references.find(r => r.nodeId === node.id);
      return { id: node.id, status: saved.fingerprint === sourceFingerprint(record(node), evidence) && (!ref || portableReferenceStatus(ref, doc) === 'current') ? 'current' : 'changed' };
    } catch { return { id: node.id, status: 'changed' }; }
  });
  const guidanceChanged = !equal(capture.guidance, framing(doc)), status = nodes.some(n => n.status === 'missing') ? 'missing' : guidanceChanged || nodes.some(n => n.status !== 'current') ? 'changed' : 'current';
  return { status, nodes, guidanceChanged, message: status === 'current' ? 'Selected saved source content matches the historical capture. Research remains recorded interpretation, not verified evidence.' : 'Captured source content is historical. Current decisions, guidance or recorded research differ or are missing; the original capture was retained.' };
}

const md = value => String(value).replace(/[\\`*_{}[\]<>#+!|()&.:=~-]/g, '\\$&').replace(/\r\n?/g, '\n');
export function adrSourcesMarkdown(value, managedId) {
  const c = validateAdrSources(value); adrFileMarker(managedId);
  const lines = ['## Captured exploration sources', '', `ADR association: ${md(managedId)}. Capture: ${c.digest}. Captured at: ${md(c.capturedAt)}.`, '',
    'Historical saved user inputs and recorded AI research, not current verification or decision approval. Later source edits do not change this capture.', '',
    `Journey ID: ${md(c.journey.id)}. ${c.journey.path === null ? 'Personal journey: portable source location unavailable.' : `Journey path: ${md(c.journey.path)}. ADR path from Git root: ${md(c.adrPath)}.`}`,
    `Committed source revision: ${c.journey.commit ?? 'unavailable; no committed version is claimed'}.`, '',
    '### Captured guidance', '', `Topic: ${md(c.guidance.topic)}`, '', `Objective: ${md(c.guidance.objective || 'Unspecified.')}`, '', `Success criteria: ${md(c.guidance.successCriteria || 'Unspecified.')}`, '', `Mode: ${md(c.guidance.mode)}`, '',
    ...c.guidance.pins.flatMap(pin => [`Constraint ${md(pin.id)}: ${md(pin.text)}`, '']),
    c.includeEvidence ? 'Recorded research below retains its original provenance and limitations. It was not independently verified for this ADR.' : 'Research evidence was omitted from this capture.', ''];
  for (const node of c.nodes) {
    const r = node.record;
    lines.push(`### Source ${md(r.id)}`, '', md(r.question), '', `Captured state: ${md(r.answerState ?? 'direction (user supplied)')}${r.review ? '; needs review' : ''}. Fingerprint: ${node.fingerprint}.`, '', `Captured answer: ${md(r.answer || (r.kind === 'direction' ? 'Not an answer; user direction.' : 'Unanswered.'))}`, '');
    const evidence = c.evidence.find(e => e.nodeId === r.id);
    if (evidence) {
      lines.push(`Recorded research basis: ${md(evidence.basis)}.`, '');
      for (const source of evidence.sources) lines.push(`- ${md(source.id ?? 'Legacy source')}: ${md(source.title)} — ${md(source.url)}. Captured provenance: ${md(source.provenance ?? 'unknown')}; recorded retrieval: ${md(source.retrievedAt ?? 'unknown')}.`, '');
      for (const claim of evidence.claims ?? []) {
        lines.push(`Claim ${md(claim.id)} (${md(claim.basis)}): ${md(claim.text)}`, '', `Limitations: ${md(claim.limitations || 'None recorded; this does not establish reliability.')}`, '');
        for (const support of claim.evidence) lines.push(`Recorded support ${md(support.sourceId)}: ${md(support.paraphrase)}`, '');
      }
      if (!evidence.claims && evidence.sources.length) lines.push('Legacy source list has no structured claim support or recorded limitations. Consultation does not establish support.', '');
      for (const q of evidence.qualifications ?? []) lines.push(`Recorded qualification (${md(q.kind)}; ${q.claimIds.length ? `claims ${q.claimIds.map(md).join(', ')}` : 'whole question'}; ${q.blocksRecommendation ? 'recommendation blocker' : 'qualified conclusion'}): ${md(q.summary)}`, '', `Next step: ${md(q.nextStep)}`, '');
    }
    const ref = c.references.find(ref => ref.nodeId === r.id); if (ref) lines.push(formatPortableReference(ref), '');
  }
  lines.push('### Statement source mappings', '');
  for (const statement of c.statements) lines.push(`- ${md(statement.section)} / ${md(statement.id)}: ${statement.sources.length ? statement.sources.map(ref => md(ref.kind === 'node' ? `node ${ref.id}` : ref.kind === 'guidance' ? `guidance ${ref.field}` : `evidence ${ref.nodeId}/${ref.sourceId}`)).join('; ') : 'No source recorded; not independently supported.'}`, '');
  return lines.join('\n');
}
