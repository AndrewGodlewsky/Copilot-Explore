import { validateDocument, effectiveAnswerState, effectiveMode } from './model.mjs';
import { effectiveKind, ANSWER_CONTEXT_GUIDANCE } from './web/answer-state.mjs';
import { validateProjectPath } from './project-path.mjs';
import { createPortableReference, formatPortableReference } from './portable-reference.mjs';
import { adrUpdateStatus } from './adr-update.mjs';

export const CHANGE_SUMMARY_LIMIT = 2 * 1024 * 1024;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const key = value => JSON.stringify(canonical(value));
const sorted = (values, identify = value => value.id) => [...values].sort((a, b) => identify(a) < identify(b) ? -1 : identify(a) > identify(b) ? 1 : 0);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function source(value, doc) {
  const fields = value?.kind === 'saved' ? 'digest,kind,revision' : 'commit,digest,kind,ref';
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields || !sha(value.digest)) throw Error('Invalid comparison source identity.');
  if (value.kind === 'saved') {
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision !== doc.revision) throw Error('Saved source revision does not match its document.');
  } else if (value.kind !== 'git' || typeof value.ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(value.ref) || typeof value.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit)) throw Error('Invalid Git source identity.');
  return canonical(value);
}
function record(node) {
  return { id: node.id, parentId: node.parentId, kind: effectiveKind(node), question: node.question, category: node.category,
    answer: node.answer, answerState: effectiveKind(node) === 'question' ? effectiveAnswerState(node) : null, review: node.review === true,
    reviewCauses: node.reviewCauses ? { earlier: node.reviewCauses.earlier, changes: sorted(node.reviewCauses.changes, key) } : null,
    hasResearch: !!node.research, researchStale: node.researchStale === true };
}
const edgeId = edge => JSON.stringify([edge.dependentId, edge.prerequisiteId]);
const edge = value => ({ dependentId: value.dependentId, prerequisiteId: value.prerequisiteId, explanation: value.explanation ?? '' });
const guidance = doc => ({ topic: doc.topic, objective: doc.objective ?? '', successCriteria: doc.successCriteria ?? '', mode: effectiveMode(doc), pins: (doc.pins ?? []).map(pin => ({ id: pin.id, text: pin.text })) });
function adr(entry, doc, path) {
  const status = adrUpdateStatus(entry, doc, path), life = entry.lifecycle;
  return { id: entry.id, path: entry.path, title: entry.title, status: entry.status, sha256: entry.sha256,
    sourceCaptureDigest: entry.sources?.digest ?? null,
    lifecycle: life ? { events: life.events.map(event => ({ from: event.from, to: event.to, at: event.at })), predecessor: life.predecessor, successors: sorted(life.successors), supersededBy: life.supersededBy } : null,
    sourceReview: { status: status.status, coverage: status.coverage, reasons: sorted(status.reasons.map(({ kind, id, prerequisiteId }) => ({ kind, ...(id === undefined ? {} : { id }), ...(prerequisiteId === undefined ? {} : { prerequisiteId }) })), key), omittedReasons: status.omittedReasons } };
}
function differences(before, after, identify = value => value.id) {
  const left = new Map(before.map(value => [identify(value), value])), right = new Map(after.map(value => [identify(value), value]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap(id => {
    const a = left.get(id), b = right.get(id);
    return key(a) === key(b) ? [] : [{ kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed', before: a ?? null, after: b ?? null }];
  });
}
const counts = values => Object.fromEntries(['added', 'removed', 'changed'].map(kind => [kind, values.filter(value => value.kind === kind).length]));

/** Saved inputs only. The coordinator, not this formatter, proves acquisition/currentness. */
export function changeSummary(before, after, { beforeSource, afterSource, path = null }) {
  validateDocument(before); validateDocument(after);
  if (['id', 'rootId', 'createdAt'].some(field => before[field] !== after[field])) throw Error('Compare versions of the same exploration identity, not separate forks or copies.');
  const sources = { before: source(beforeSource, before), after: source(afterSource, after) };
  if (path !== null) { validateProjectPath(path); if (!path.endsWith('.explore.json')) throw Error('Use a project-relative .explore.json path.'); }
  const records = differences(before.nodes.map(record), after.nodes.map(record));
  const dependencies = differences((before.dependencies ?? []).map(edge), (after.dependencies ?? []).map(edge), edgeId);
  const adrs = differences((before.adrFiles ?? []).map(entry => adr(entry, before, path)), (after.adrFiles ?? []).map(entry => adr(entry, after, path)));
  const beforeGuidance = guidance(before), afterGuidance = guidance(after);
  const lineage = doc => ({ forkOrigin: doc.forkOrigin ?? null, copyOrigin: doc.copyOrigin ?? null });
  const beforeLineage = lineage(before), afterLineage = lineage(after);
  // Identity mappings have no authored ordering; retain event order elsewhere.
  for (const value of [beforeLineage, afterLineage]) if (value.forkOrigin) value.forkOrigin = { ...value.forkOrigin, nodes: sorted(value.forkOrigin.nodes, row => row.nodeId) };
  const changedGuidance = key(beforeGuidance) !== key(afterGuidance), changedLineage = key(beforeLineage) !== key(afterLineage);
  const totals = { records: counts(records), dependencies: counts(dependencies), adrs: counts(adrs), guidance: changedGuidance, scenario: changedLineage };
  const coverage = 'Whole selected exploration versions; stable IDs, not similar wording, pair records. Authored values are literal JSON; escapes preserve whitespace, line endings and control characters. Labels are deterministic comparisons, not AI findings. ' +
    'Includes saved question/direction/answer/state/review and research-staleness metadata, guidance, dependencies, saved scenario lineage, ADR association metadata and bounded saved-source review reasons (any omitted reason count is explicit). ' +
    'Omitted: raw research, accepted artifacts and ADR baseline wording, generation metadata, reminders, comments and contributor attribution, private drafts, project excerpts, usage and helper state. Historical external scenario preference is unavailable; external Markdown contents and current file freshness are unavailable. ' +
    (path ? 'Historical snapshot references may resolve to changed or removed records in another checkout.' : 'Personal saved versions: portable references unavailable.');
  const parts = []; let bytes = 0;
  const append = (...values) => {
    for (const value of values) {
      bytes += Buffer.byteLength(value) + 1;
      if (bytes > CHANGE_SUMMARY_LIMIT) throw Error('Change summary exceeds its 2 MiB output limit. Nothing was clipped; inspect the selected versions separately.');
      parts.push(value);
    }
  };
  const literal = value => {
    const text = JSON.stringify(canonical(value), null, 2), longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(match => match[0].length)), fence = '`'.repeat(longest + 1);
    append(`${fence}json`, text, fence, '');
  };
  append('# Exploration changes', '', '## Comparison scope', '', 'Before and after are explicit saved sources. A saved version is not proof that its current bytes are committed.', '');
  literal({ journeyId: before.id, rootId: before.rootId, createdAt: before.createdAt, path, ...sources });
  append('## Coverage', '', coverage, '', ANSWER_CONTEXT_GUIDANCE, '', '## Change counts', ''); literal(totals);
  const pair = (a, b) => { append('Before (literal saved values):', ''); literal(a); append('After (literal saved values):', ''); literal(b); };
  if (changedGuidance) { append('## Guidance and constraints', ''); pair(beforeGuidance, afterGuidance); }
  if (changedLineage) { append('## Saved scenario lineage', ''); pair(beforeLineage, afterLineage); }
  const names = { added: 'Added', removed: 'Removed', changed: 'Changed' };
  if (records.length) append('## Questions, directions and answers', '');
  for (const [index, row] of records.entries()) {
    append(`### ${names[row.kind]} record ${index + 1}`, ''); pair(row.before, row.after);
    if (path) for (const [label, value, doc] of [['Before', row.before, before], ['After', row.after, after]]) if (value) append(`${label} snapshot reference:`, '', formatPortableReference(createPortableReference(doc, path, value.id)), '');
  }
  if (dependencies.length) append('## Dependency relationships', '', 'Relationships and explanations are saved user assertions, not independently verified causes.', '');
  for (const [index, row] of dependencies.entries()) { append(`### ${names[row.kind]} dependency ${index + 1}`, ''); pair(row.before, row.after); }
  if (adrs.length) append('## Linked ADR effects', '', 'These are saved association and source-review changes, not reads of external ADR files. A generated baseline is historical data; its text is omitted.', '');
  for (const [index, row] of adrs.entries()) { append(`### ${names[row.kind]} ADR ${index + 1}`, ''); pair(row.before, row.after); }
  if (!records.length && !dependencies.length && !adrs.length && !changedGuidance && !changedLineage) append('No changes within the stated comparison coverage.', '');
  return { markdown: parts.join('\n') + '\n', bytes, limit: CHANGE_SUMMARY_LIMIT, counts: totals, coverage };
}
