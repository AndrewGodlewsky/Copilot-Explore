import { isQuestion } from './answer-state.mjs';
import { DecisionImpact } from './decision-impact.mjs';

/** Tree preorder is stable and navigable; mixed relationship cycles have no global causal order. */
export function reviewQueue(doc) {
  const children = new Map(doc.nodes.map(n => [n.id, []])), byId = new Map(doc.nodes.map(n => [n.id, n]));
  for (const node of doc.nodes) if (node.parentId !== null) children.get(node.parentId)?.push(node.id);
  const stack = [doc.rootId], seen = new Set(), result = [];
  while (stack.length) {
    const id = stack.pop(); if (seen.has(id)) continue; seen.add(id);
    const node = byId.get(id); if (isQuestion(node) && node.review) result.push(node);
    const ids = children.get(id) ?? []; for (let i = ids.length - 1; i >= 0; i--) stack.push(ids[i]);
  }
  return result;
}

export function reviewContext(doc, nodeId, cause) {
  if (cause === 'earlier') return { legacy: true, source: null };
  const source = doc.nodes.find(n => n.id === cause.sourceId) ?? null, dependent = doc.nodes.find(n => n.id === cause.dependentId) ?? null;
  const impact = source && isQuestion(source) ? new DecisionImpact(doc).analyze(source.id) : null;
  const structural = impact?.predecessors.tree.has(nodeId) && nodeId !== cause.sourceId || false;
  const confirmed = impact?.predecessors.dependency.has(nodeId) && nodeId !== cause.sourceId || false;
  const mixed = !structural && !confirmed && impact?.predecessors.combined.has(nodeId) || false;
  return { legacy: false, source, dependent, structural, confirmed, mixed, linkPresent: !!cause.dependentId && !!doc.dependencies?.some(link => link.dependentId === cause.dependentId && link.prerequisiteId === cause.sourceId) };
}
