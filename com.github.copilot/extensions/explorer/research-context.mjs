import { findNode } from './model.mjs';
import { effectiveMode } from './web/modes.mjs';
import { effectiveAnswerState, isQuestion } from './web/answer-state.mjs';

export const RESEARCH_CONTEXT_LIMIT = 131072;
export const identity = doc => ({ id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt });
export const framing = doc => ({ topic: doc.topic, objective: doc.objective ?? '', successCriteria: doc.successCriteria ?? '', mode: effectiveMode(doc), pins: structuredClone(doc.pins ?? []) });
export const record = node => ({ id: node.id, parentId: node.parentId, question: node.question, answer: node.answer,
  ...(isQuestion(node) ? { answerState: effectiveAnswerState(node) } : node.kind === 'direction' ? { kind: 'direction', origin: 'user' } : {}), review: node.review });
const generationRecord = (node, relation, includeRationale = true) => ({ id: node.id, parentId: node.parentId, question: node.question, relation,
  ...(node.kind === 'direction' ? { kind: 'direction', origin: 'user' } : {}),
  ...(includeRationale && node.rationale && node.generation ? { historicalRationale: { originalQuestion: node.generation.originalQuestion, rationale: node.rationale,
    provenance: 'Historical model explanation for the original suggested wording and context; not a user fact or decision.' } } : {}) });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = value => Buffer.byteLength(value, 'utf8');
const immutable = value => {
  const queue = [value];
  for (let i = 0; i < queue.length; i++) { for (const item of Object.values(queue[i])) if (item && typeof item === 'object') queue.push(item); Object.freeze(queue[i]); }
  return value;
};
export function contextScope(value = 'decisions') {
  if (!['path', 'decisions'].includes(value)) throw new Error('Choose ancestor path only or additional decisions for request scope.');
  return value;
}

// Count actual SDK strings, not JSON-RPC escaping or opaque provider framing.
// Each optional record is serialized once; selection only remeasures small metadata.
export function prepareContext(source, { instructions = '', prefix = '', scope = 'decisions' } = {}) {
  scope = contextScope(scope);
  const context = { ...framing(source), ...(source.identity ? { identity: structuredClone(source.identity), targetId: source.targetId } : {}),
    scope, path: source.path.length ? [structuredClone(source.path.at(-1))] : [], decisionsElsewhere: [], truncated: false,
    omitted: { path: Math.max(0, source.path.length - 1), decisionsElsewhere: source.decisionsElsewhere?.length ?? 0 },
    omissionReasons: { budget: 0, scope: scope === 'path' ? source.decisionsElsewhere?.length ?? 0 : 0 } };
  if (source.generationContext) {
    context.generationContext = []; context.omitted.generationContext = source.generationContext.length;
    if (scope === 'path') context.omissionReasons.scope += source.generationContext.filter(item => item.relation === 'child').length;
  }
  const update = () => { const omitted = Object.values(context.omitted).reduce((sum, n) => sum + n, 0); context.truncated = !!omitted; context.omissionReasons.budget = omitted - context.omissionReasons.scope; };
  update();
  const { truncated, omitted, omissionReasons, ...fixed } = context;
  const metadataBase = bytes(JSON.stringify({ ...fixed, path: [], decisionsElsewhere: [] })) - 1;
  const metadataBytes = () => metadataBase + bytes(JSON.stringify({ truncated: context.truncated, omitted: context.omitted, omissionReasons: context.omissionReasons }));
  let recordsBytes = context.path.length ? bytes(JSON.stringify(context.path[0])) : 0;
  const fixedBytes = bytes(instructions) + bytes(prefix);
  if (fixedBytes + metadataBytes() + recordsBytes > RESEARCH_CONTEXT_LIMIT) throw new Error('The mandatory target and guidance (including all pinned constraints) exceed the 128 KiB request limit. Shorten the selected answer, topic, guidance or pins; changing optional scope cannot make mandatory content fit.');
  const add = (key, item, front = false) => {
    const size = bytes(JSON.stringify(item)) + (context[key].length ? 1 : 0);
    context.omitted[key]--; update();
    if (fixedBytes + metadataBytes() + recordsBytes + size <= RESEARCH_CONTEXT_LIMIT) {
      front ? context[key].unshift(structuredClone(item)) : context[key].push(structuredClone(item)); recordsBytes += size;
    } else { context.omitted[key]++; update(); }
  };
  for (let i = source.path.length - 2; i >= 0; i--) add('path', source.path[i], true);
  if (scope === 'decisions') for (const item of source.decisionsElsewhere ?? []) add('decisionsElsewhere', item);
  for (const item of source.generationContext ?? []) if (scope === 'decisions' || item.relation === 'path') add('generationContext', item);
  const prompt = prefix + JSON.stringify(context), size = bytes(instructions) + bytes(prompt);
  return immutable({ context, instructions, prompt, bytes: size, limit: RESEARCH_CONTEXT_LIMIT,
    coverage: { scope, included: { path: context.path.length, decisionsElsewhere: context.decisionsElsewhere.length, pins: context.pins.length, generationContext: context.generationContext?.length ?? 0 }, omitted: { ...context.omitted, ...context.omissionReasons } } });
}
export function boundedContext(context, options) { return prepareContext(context, options).context; }

export function prepareResearch(doc, nodeId, options) {
  if (options?.operation === 'brief' && nodeId !== doc.rootId) throw new Error('Journey summaries must be anchored at the root.');
  const byId = new Map(doc.nodes.map(node => [node.id, node])), target = findNode(doc, nodeId), path = [], seen = new Set();
  for (let node = target; node; node = byId.get(node.parentId)) {
    if (seen.has(node.id) || seen.size >= 5000) throw new Error('Invalid context ancestry.');
    seen.add(node.id); path.push(record(node));
  }
  path.reverse();
  const adjacent = new Map(doc.nodes.map(node => [node.id, []]));
  for (const node of doc.nodes) if (adjacent.has(node.parentId)) { adjacent.get(node.parentId).push(node.id); adjacent.get(node.id).push(node.parentId); }
  const distances = new Map([[nodeId, 0]]), queue = [nodeId];
  for (let i = 0; i < queue.length; i++) for (const id of adjacent.get(queue[i])) if (!distances.has(id)) { distances.set(id, distances.get(queue[i]) + 1); queue.push(id); }
  const stateful = node => isQuestion(node) && (node.answer.trim() || effectiveAnswerState(node) !== 'unanswered');
  const decisionsElsewhere = doc.nodes.filter(node => (options?.operation === 'brief' || stateful(node)) && !seen.has(node.id))
    .sort((a, b) => (options?.operation === 'brief' ? Number(!!stateful(b)) - Number(!!stateful(a)) : 0) || distances.get(a.id) - distances.get(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(record);
  const generationContext = options?.operation === 'questions' ? [
    ...path.slice().reverse().map(item => byId.get(item.id)).filter(node => node.rationale && node.generation).map(node => generationRecord(node, 'path')),
    ...doc.nodes.filter(node => node.parentId === nodeId).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(node => generationRecord(node, 'child')),
  ] : undefined;
  const prepared = prepareContext({ ...framing(doc), identity: identity(doc), targetId: nodeId, path, decisionsElsewhere, ...(generationContext ? { generationContext } : {}) }, options);
  return immutable({ ...prepared, dependencies: structuredClone({ identity: identity(doc), framing: framing(doc), nodeId,
    records: [...prepared.context.path, ...prepared.context.decisionsElsewhere], generationRecords: prepared.context.generationContext ?? [], destination: target.research }) });
}
export function sameResearchSources(dependencies, doc) {
  if (!dependencies || !doc || !equal(dependencies.identity, identity(doc)) || !equal(dependencies.framing, framing(doc))) return false;
  const nodes = new Map(doc.nodes.map(node => [node.id, node]));
  return nodes.has(dependencies.nodeId) && dependencies.records.every(saved => nodes.has(saved.id) && equal(saved, record(nodes.get(saved.id)))) &&
    (dependencies.generationRecords ?? []).every(saved => nodes.has(saved.id) && equal(saved, generationRecord(nodes.get(saved.id), saved.relation, Object.hasOwn(saved, 'historicalRationale'))));
}
export function sameResearchDestination(dependencies, doc) { return equal(dependencies.destination, findNode(doc, dependencies.nodeId).research); }
