import { ANSWER_STATES, effectiveAnswerState, isQuestion } from './answer-state.mjs';

export const IMPACT_RULES = 'High: at least 20 affected questions or 5 confirmed dependents. Medium: at least 5 affected questions or 1 confirmed dependent. Otherwise low. Counts describe recorded reasoning, not code-change effort or confidence.';
const order = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.via < b.via ? -1 : a.via > b.via ? 1 : 0;
const band = counts => counts.total >= 20 || counts.confirmed >= 5 ? 'high' : counts.total >= 5 || counts.confirmed >= 1 ? 'medium' : 'low';

/** Include every input to analysis or its displayed paths, independent of revision and serialization order. */
export function decisionImpactKey(doc) {
  const byId = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  return JSON.stringify([doc.id, doc.rootId,
    doc.nodes.map(node => [node.id, node.parentId, isQuestion(node), node.question, effectiveAnswerState(node), !!node.review]).sort(byId),
    (doc.dependencies ?? []).map(link => [link.dependentId, link.prerequisiteId]).sort(byId)]);
}

/** A snapshot index of a validated saved map. Rebuild when saved content changes. */
export class DecisionImpact {
  bands = new Map();
  constructor(doc) {
    this.nodes = new Map(doc.nodes.map(node => [node.id, { id: node.id, question: isQuestion(node), state: effectiveAnswerState(node), review: !!node.review }]));
    this.edges = new Map(doc.nodes.map(node => [node.id, []]));
    for (const node of doc.nodes) if (node.parentId !== null) this.edges.get(node.parentId).push({ id: node.id, via: 'tree' });
    for (const link of doc.dependencies ?? []) this.edges.get(link.prerequisiteId).push({ id: link.dependentId, via: 'dependency' });
    for (const edges of this.edges.values()) edges.sort(order);
  }
  /** Exact display band: stop as soon as a high threshold is proven. Cache only the band. */
  bandFor(sourceId) {
    if (!this.nodes.get(sourceId)?.question) throw Error('Choose an ordinary saved question to inspect decision impact.');
    if (this.bands.has(sourceId)) return this.bands.get(sourceId);
    const countUntil = (kind, limit) => {
      const seen = new Set([sourceId]), queue = [sourceId]; let count = 0;
      for (let i = 0; i < queue.length; i++) for (const edge of this.edges.get(queue[i])) {
        if (kind !== 'combined' && edge.via !== kind || seen.has(edge.id)) continue;
        seen.add(edge.id); queue.push(edge.id);
        if (this.nodes.get(edge.id).question && ++count >= limit) return count;
      }
      return count;
    };
    const total = countUntil('combined', 20), confirmed = total >= 20 ? 0 : countUntil('dependency', 5);
    const value = band({ total, confirmed }); this.bands.set(sourceId, value); return value;
  }
  analyze(sourceId) {
    if (!this.nodes.get(sourceId)?.question) throw Error('Choose an ordinary saved question to inspect decision impact.');
    let visitedEdges = 0;
    const walk = kind => {
      const predecessors = new Map([[sourceId, null]]), queue = [sourceId];
      for (let i = 0; i < queue.length; i++) for (const edge of this.edges.get(queue[i])) {
        visitedEdges++;
        if (kind !== 'combined' && edge.via !== kind || predecessors.has(edge.id)) continue;
        predecessors.set(edge.id, { id: queue[i], via: edge.via }); queue.push(edge.id);
      }
      return predecessors;
    };
    const predecessors = { tree: walk('tree'), dependency: walk('dependency'), combined: walk('combined') };
    const affected = [...predecessors.combined.keys()].filter(id => id !== sourceId && this.nodes.get(id).question).sort().map(id => {
      const node = this.nodes.get(id), structural = predecessors.tree.has(id), confirmed = predecessors.dependency.has(id);
      return { id, state: node.state, review: node.review, structural, confirmed, mixedOnly: !structural && !confirmed };
    });
    const counts = { total: affected.length, structural: 0, confirmed: 0, mixedOnly: 0, review: 0, assumptions: 0, states: Object.fromEntries(Object.keys(ANSWER_STATES).map(key => [key, 0])) };
    for (const item of affected) {
      for (const key of ['structural', 'confirmed', 'mixedOnly', 'review']) if (item[key]) counts[key]++;
      counts.states[item.state]++; if (item.state === 'assumption') counts.assumptions++;
    }
    return { sourceId, affected, counts, band: band(counts), rules: IMPACT_RULES, predecessors, visitedEdges,
      adrAssociations: { status: 'unavailable', count: null, reason: 'ADR source associations are not supported yet. No ADR count or impact has been inferred.' } };
  }
}

/** Materialize one shortest path on demand instead of retaining quadratic path arrays. */
export function impactPath(result, targetId, kind = 'combined') {
  const predecessors = result.predecessors[kind];
  if (!predecessors || !predecessors.has(targetId) || targetId === result.sourceId) return [];
  const path = []; let id = targetId;
  while (id !== result.sourceId) { const previous = predecessors.get(id); path.push({ id, via: previous.via }); id = previous.id; }
  path.push({ id: result.sourceId, via: null }); return path.reverse();
}

/** Highlight every qualifying decision; keep complete recorded dependency components and tree ancestry as context. */
export function criticalPaths(doc, index = new DecisionImpact(doc)) {
  const neighbors = new Map(doc.nodes.map(node => [node.id, []])), parents = new Map(doc.nodes.map(node => [node.id, node.parentId]));
  for (const { dependentId, prerequisiteId } of doc.dependencies ?? []) { neighbors.get(dependentId).push(prerequisiteId); neighbors.get(prerequisiteId).push(dependentId); }
  const highlights = new Map();
  for (const node of doc.nodes) if (isQuestion(node)) {
    const reasons = [];
    if (index.bandFor(node.id) === 'high') reasons.push('High downstream impact');
    if (neighbors.get(node.id).length && (node.review || !['decided', 'not-relevant'].includes(effectiveAnswerState(node)))) reasons.push('Unresolved recorded dependency');
    if (reasons.length) highlights.set(node.id, reasons);
  }
  const ids = new Set(highlights.keys()), queue = [...ids]; let visitedLinks = 0;
  for (let i = 0; i < queue.length; i++) for (const id of neighbors.get(queue[i])) {
    visitedLinks++; if (!ids.has(id)) { ids.add(id); queue.push(id); }
  }
  // Ancestors provide navigation context but do not pull in unrelated dependency components.
  const ancestors = new Set([doc.rootId]);
  for (const start of ids) for (let id = parents.get(start); id !== null && !ancestors.has(id); id = parents.get(id)) ancestors.add(id);
  for (const id of ancestors) ids.add(id);
  return { highlights, ids, visitedLinks };
}
