import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { validateContributionEvent } from './contributors.mjs';
import { effectiveKind, effectiveAnswerState, isQuestion } from './web/answer-state.mjs';
import { effectiveMode } from './web/modes.mjs';

export const HANDOFF_LIMITS = Object.freeze({ records: 32, perRecord: 16, transitions: 256, unresolved: 24, note: 2000, recipient: 96, bytes: 256 * 1024 });
const invalid = () => { throw Error('Invalid review handoff data or handoff limit exceeded.'); };
function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const names = Reflect.ownKeys(value);
  if (required.some(key => !names.includes(key)) || names.some(key => ![...required, ...optional].includes(key))) invalid();
  for (const key of names) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(); }
}
function text(value, max, required = true) { if (typeof value !== 'string' || !value.isWellFormed() || value.length > max || required && !value.trim()) invalid(); return value; }
function uuid(value) { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) invalid(); }
function nodeId(value) { text(value, 100); if (value !== value.trim()) invalid(); }
function array(value, max, nonempty = false) {
  if (!Array.isArray(value) || value.length > max || nonempty && !value.length || Reflect.ownKeys(value).length !== value.length + 1 || Object.keys(value).some((key, i) => key !== String(i))) invalid();
  for (let i = 0; i < value.length; i++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(i)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(); }
}
function recipient(value) { if (value === null) return; text(value, HANDOFF_LIMITS.recipient); if (value.trim() !== value || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value)) invalid(); }
function scope(value) {
  fields(value, ['kind'], ['nodeId']);
  if (value.kind === 'branch') { fields(value, ['kind', 'nodeId']); nodeId(value.nodeId); }
  else if (value.kind === 'journey') fields(value, ['kind']); else invalid();
}
function event(value) { fields(value, ['actor', 'at']); if (value.actor !== null) fields(value.actor, ['id', 'displayName']); return validateContributionEvent(value); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function index(doc) {
  const nodes = new Map(doc.nodes.map(node => [node.id, node])), children = new Map(doc.nodes.map(node => [node.id, []])), prerequisites = new Map(doc.nodes.map(node => [node.id, []]));
  for (const node of doc.nodes) if (node.parentId !== null) children.get(node.parentId)?.push(node.id);
  for (const link of doc.dependencies ?? []) prerequisites.get(link.dependentId)?.push(link.prerequisiteId);
  const hashes = new Map(doc.nodes.map(node => [node.id, hash({ id: node.id, parentId: node.parentId, question: node.question, category: node.category, kind: effectiveKind(node), answer: node.answer, answerState: effectiveAnswerState(node), review: node.review, reviewCauses: node.reviewCauses ?? [] })]));
  const guidance = hash({ identity: [doc.id, doc.rootId, doc.createdAt], topic: doc.topic, objective: doc.objective ?? '', successCriteria: doc.successCriteria ?? '', mode: effectiveMode(doc), pins: doc.pins ?? [] });
  return { doc, nodes, children, prerequisites, hashes, guidance };
}
function selected(indexed, chosen) {
  scope(chosen); const { doc, nodes, children, prerequisites } = indexed;
  if (chosen.kind === 'branch' && !nodes.has(chosen.nodeId)) throw Error('That handoff branch no longer exists.');
  const primaryIds = chosen.kind === 'journey' ? doc.nodes.map(node => node.id) : [chosen.nodeId], visited = new Set(primaryIds);
  if (chosen.kind === 'branch') for (let i = 0; i < primaryIds.length; i++) for (const id of children.get(primaryIds[i]) ?? []) if (!visited.has(id)) { visited.add(id); primaryIds.push(id); }
  const contextIds = [...primaryIds];
  for (let i = 0; i < contextIds.length; i++) {
    const id = contextIds[i], parent = nodes.get(id)?.parentId;
    for (const previous of [...(parent === null || parent === undefined ? [] : [parent]), ...prerequisites.get(id) ?? []]) if (!visited.has(previous)) { visited.add(previous); contextIds.push(previous); }
  }
  return { primaryIds, contextIds };
}
function capture(indexed, chosen) {
  const { contextIds } = selected(indexed, chosen), included = new Set(contextIds), { doc, hashes, guidance, nodes } = indexed;
  const links = (doc.dependencies ?? []).filter(link => included.has(link.dependentId)).map(link => [link.dependentId, link.prerequisiteId, link.explanation ?? '']).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
  return { version: 1, label: chosen.kind === 'journey' ? doc.topic : nodes.get(chosen.nodeId).question, digest: hash([chosen, guidance, contextIds.sort().map(id => [id, hashes.get(id)]), links]), nodeCount: contextIds.length };
}
export const handoffScope = (doc, chosen) => selected(index(doc), chosen);
export const handoffCapture = (doc, chosen) => capture(index(doc), chosen);

function responsibility(record) {
  let state = 'requested', requested = null, owner = null, latest;
  for (const transition of record.transitions) {
    if (transition.action === 'create' || transition.action === 'reassign') { state = 'requested'; requested = transition.recipient; owner = null; }
    else if (transition.action === 'take') { if (state !== 'requested') throw Error('Reassign this taken or completed handoff before taking responsibility.'); state = 'taken'; owner = transition.event.actor; }
    else { if (state === 'complete') throw Error('This handoff is already complete. Reassign it to request another review.'); state = 'complete'; }
    latest = transition.event;
  }
  return { state, recipient: requested, owner, event: latest };
}
export function validateReviewHandoffs(value) {
  fields(value, ['version', 'records']); if (value.version !== 1) invalid(); array(value.records, HANDOFF_LIMITS.records);
  const recordIds = new Set(), transitionIds = new Set();
  for (const record of value.records) {
    fields(record, ['id', 'scope', 'source', 'unresolved', 'transitions']); uuid(record.id); scope(record.scope);
    if (recordIds.has(record.id)) invalid(); recordIds.add(record.id);
    fields(record.source, ['version', 'label', 'digest', 'nodeCount']); text(record.source.label, 4000);
    if (record.source.version !== 1 || typeof record.source.digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.source.digest) || !Number.isSafeInteger(record.source.nodeCount) || record.source.nodeCount < 1 || record.source.nodeCount > 5000) invalid();
    array(record.unresolved, HANDOFF_LIMITS.unresolved); const unresolved = new Set();
    for (const reference of record.unresolved) { fields(reference, ['nodeId', 'question']); nodeId(reference.nodeId); text(reference.question, 4000); if (unresolved.has(reference.nodeId)) invalid(); unresolved.add(reference.nodeId); }
    array(record.transitions, HANDOFF_LIMITS.perRecord, true);
    for (const [i, transition] of record.transitions.entries()) {
      fields(transition, ['id', 'action', 'note', 'event'], ['recipient']); uuid(transition.id); text(transition.note, HANDOFF_LIMITS.note, i === 0); event(transition.event);
      if (transitionIds.has(transition.id) || !(i === 0 ? transition.action === 'create' : ['take', 'reassign', 'complete'].includes(transition.action))) invalid(); transitionIds.add(transition.id);
      if (['create', 'reassign'].includes(transition.action)) { fields(transition, ['id', 'action', 'note', 'event', 'recipient']); recipient(transition.recipient); }
      else fields(transition, ['id', 'action', 'note', 'event']);
    }
    responsibility(record);
  }
  if (transitionIds.size > HANDOFF_LIMITS.transitions || Buffer.byteLength(JSON.stringify(value, null, 2)) > HANDOFF_LIMITS.bytes) invalid();
  return structuredClone(value);
}
export function handoffStatuses(doc) {
  if (!doc?.reviewHandoffs?.records.length) return {};
  const indexed = index(doc);
  return Object.fromEntries(doc.reviewHandoffs.records.map(record => {
    const orphaned = record.scope.kind === 'branch' && !indexed.nodes.has(record.scope.nodeId);
    return [record.id, { context: orphaned ? 'orphaned' : equal(capture(indexed, record.scope), record.source) ? 'current' : 'changed', ...structuredClone(responsibility(record)) }];
  }));
}
/** Explicit shared mutation only. Submission IDs are retry keys, never identities. */
export function changeReviewHandoffs(document, action, input, contribution) {
  const observed = event(contribution); if (!['create', 'take', 'reassign', 'complete'].includes(action)) invalid();
  fields(input, ['id', 'transitionId', 'note', ...(['create', 'reassign'].includes(action) ? ['recipient'] : []), ...(action === 'create' ? ['scope', 'unresolvedIds'] : [])]);
  uuid(input.id); uuid(input.transitionId); text(input.note, HANDOFF_LIMITS.note, action === 'create');
  if (['create', 'reassign'].includes(action)) recipient(input.recipient);
  if (action === 'create') { scope(input.scope); array(input.unresolvedIds, HANDOFF_LIMITS.unresolved); input.unresolvedIds.forEach(nodeId); if (new Set(input.unresolvedIds).size !== input.unresolvedIds.length) invalid(); }
  const result = structuredClone(document), value = result.reviewHandoffs ? validateReviewHandoffs(result.reviewHandoffs) : { version: 1, records: [] };
  let record = value.records.find(record => record.id === input.id);
  const reused = () => { throw Error('That handoff submission ID was already used for different content. Preserve your draft and start a new submission.'); };
  const previous = value.records.flatMap(record => record.transitions.map(transition => ({ record, transition }))).find(row => row.transition.id === input.transitionId);
  if (previous) {
    const old = previous.transition;
    if (previous.record.id !== input.id || old.action !== action || old.note !== input.note || old.recipient !== input.recipient || action === 'create' && (!equal(previous.record.scope, input.scope) || !equal(previous.record.unresolved.map(ref => ref.nodeId), input.unresolvedIds))) reused();
    return result;
  }
  const transition = { id: input.transitionId, action, note: input.note, event: observed, ...(['create', 'reassign'].includes(action) ? { recipient: input.recipient } : {}) };
  if (action === 'create') {
    if (record) reused(); const indexed = index(result), { primaryIds } = selected(indexed, input.scope), included = new Set(primaryIds);
    const unresolved = input.unresolvedIds.map(id => { const node = indexed.nodes.get(id); if (!included.has(id) || !node || !isQuestion(node)) throw Error('Choose unresolved questions from the selected branch or journey.'); return { nodeId: id, question: node.question }; });
    record = { id: input.id, scope: structuredClone(input.scope), source: capture(indexed, input.scope), unresolved, transitions: [transition] }; value.records.push(record);
  } else { if (!record) throw Error('That review handoff no longer exists. Refresh and preserve your draft.'); record.transitions.push(transition); }
  result.reviewHandoffs = validateReviewHandoffs(value); return result;
}

/** Do not invent an ordering for independent responsibility changes on one record. */
export function mergeReviewHandoffs(base, local, incoming, pick) {
  if ([base, local, incoming].every(value => value === undefined)) return undefined;
  const maps = [base, local, incoming].map(value => new Map((value?.records ?? []).map(record => [record.id, record]))), records = [];
  for (const id of new Set(maps.flatMap(map => [...map.keys()]))) {
    const [b, l, r] = maps.map(map => map.get(id));
    const removed = !!b && !!l !== !!r, retargeted = !!l && !!r && !equal([l.scope, l.source], [r.scope, r.source]);
    const chosen = pick(`handoff-record:${id}`, 'Review handoff responsibility or notes', b, l, r, removed || retargeted);
    if (chosen !== undefined) records.push(structuredClone(chosen));
  }
  return { version: 1, records };
}
