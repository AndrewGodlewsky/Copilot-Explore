import { contextFor, findNode } from './model.mjs';
import { effectiveMode } from './web/modes.mjs';
import { effectiveAnswerState, isQuestion } from './web/answer-state.mjs';

export const RESEARCH_CONTEXT_LIMIT = 75000;
const identity = doc => ({ id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt });
const framing = doc => ({ topic: doc.topic, objective: doc.objective ?? '', successCriteria: doc.successCriteria ?? '', mode: effectiveMode(doc) });
const record = node => ({ id: node.id, parentId: node.parentId, question: node.question, answer: node.answer,
  ...(isQuestion(node) ? { answerState: effectiveAnswerState(node) } : node.kind === 'direction' ? { kind: 'direction', origin: 'user' } : {}), review: node.review });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function boundedContext(context) {
  const result = { ...framing(context), ...(context.identity ? { identity: context.identity, targetId: context.targetId } : {}),
    path: context.path.length ? [structuredClone(context.path.at(-1))] : [], decisionsElsewhere: [], truncated: false,
    omitted: { path: Math.max(0, context.path.length - 1), decisionsElsewhere: context.decisionsElsewhere?.length ?? 0 } };
  // Counts are included in every size check; complete records are never clipped.
  result.truncated = !!(result.omitted.path || result.omitted.decisionsElsewhere);
  if (JSON.stringify(result).length > RESEARCH_CONTEXT_LIMIT) throw new Error('The research target and guidance exceed the research context limit. Shorten them before researching.');
  const add = (key, item, front = false) => {
    const candidate = structuredClone(result);
    front ? candidate[key].unshift(item) : candidate[key].push(item);
    candidate.omitted[key]--; candidate.truncated = !!(candidate.omitted.path || candidate.omitted.decisionsElsewhere);
    if (JSON.stringify(candidate).length <= RESEARCH_CONTEXT_LIMIT) Object.assign(result, candidate);
  };
  for (const item of context.path.slice(0, -1).reverse()) add('path', item, true);
  for (const item of context.decisionsElsewhere ?? []) add('decisionsElsewhere', item);
  return result;
}

export function prepareResearch(doc, nodeId) {
  const source = contextFor(doc, nodeId), byId = new Map(doc.nodes.map(node => [node.id, node]));
  const path = source.path.map(item => record(byId.get(item.id)));
  const pathIds = new Set(path.map(item => item.id));
  const decisionsElsewhere = doc.nodes.filter(node => isQuestion(node) && (node.answer.trim() || effectiveAnswerState(node) !== 'unanswered') && !pathIds.has(node.id)).map(record);
  const context = boundedContext({ ...source, identity: identity(doc), targetId: nodeId, path, decisionsElsewhere });
  return { context, dependencies: structuredClone({ identity: context.identity, framing: framing(doc), nodeId,
    records: [...context.path, ...context.decisionsElsewhere], destination: findNode(doc, nodeId).research }) };
}

export function sameResearchSources(dependencies, doc) {
  if (!doc || !equal(dependencies.identity, identity(doc)) || !equal(dependencies.framing, framing(doc))) return false;
  const nodes = new Map(doc.nodes.map(node => [node.id, node]));
  return nodes.has(dependencies.nodeId) && isQuestion(nodes.get(dependencies.nodeId)) && dependencies.records.every(saved => nodes.has(saved.id) && equal(saved, record(nodes.get(saved.id))));
}

export function sameResearchDestination(dependencies, doc) {
  return equal(dependencies.destination, findNode(doc, dependencies.nodeId).research);
}
