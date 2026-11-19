import { isDeepStrictEqual as equal } from 'node:util';
import { record } from './research-context.mjs';
import { savedDigest } from './review-causes.mjs';

const LIMIT = 65536;
export const ADR_REVIEW_CONTEXT_GUIDANCE = 'Dependency relationships are user assertions, not verified facts. Unselected upstream prerequisites are fingerprints for freshness only: their answer content is omitted and they are not admissible statement sources. Select a prerequisite explicitly to use its answer. Research stale flags retain prior evidence uncertainty.';
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const array = v => Array.isArray(v) && v.length <= 10000 && Object.keys(v).length === v.length;
const text = (v, max) => typeof v === 'string' && v.isWellFormed() && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const id = v => text(v, 100) && !!v.trim() && v === v.trim();
const sha = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const invalid = () => { throw Error('Invalid ADR reviewed dependency context or context limit. Preserve the original scope and review its sources.'); };
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const edgeKey = e => JSON.stringify([e.dependentId, e.prerequisiteId]);
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => savedDigest(canonical(v));
function selectedIds(ids, evidence) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(v => !id(v)) || new Set(ids).size !== ids.length || typeof evidence !== 'boolean') invalid();
  return new Set(ids);
}
function upstream(edges, selected) {
  const incoming = new Map();
  for (const edge of edges) { const list = incoming.get(edge.dependentId) ?? []; list.push(edge.prerequisiteId); incoming.set(edge.dependentId, list); }
  const result = new Set(selected), queue = [...selected];
  for (let i = 0; i < queue.length; i++) for (const source of incoming.get(queue[i]) ?? []) if (!result.has(source)) { result.add(source); queue.push(source); }
  return result;
}
export function validateAdrReviewContext(value, nodeIds, includeEvidence) {
  const selected = selectedIds(nodeIds, includeEvidence);
  if (!keys(value, 'version,edges,prerequisites,research') || value.version !== 1 || ![value.edges, value.prerequisites, value.research].every(array)) invalid();
  const edges = value.edges.map(e => {
    if (!keys(e, 'dependentId,prerequisiteId,explanation') || !id(e.dependentId) || !id(e.prerequisiteId) || e.dependentId === e.prerequisiteId || !text(e.explanation, 1000)) invalid();
    return { dependentId: e.dependentId, prerequisiteId: e.prerequisiteId, explanation: e.explanation };
  });
  const edgeKeys = edges.map(edgeKey); if (new Set(edgeKeys).size !== edges.length || !equal(edgeKeys, [...edgeKeys].sort(order))) invalid();
  const closure = upstream(edges, selected);
  if (edges.some(e => !closure.has(e.dependentId) && !selected.has(e.prerequisiteId))) invalid();
  const outgoing = new Map(), counts = new Map();
  for (const edge of edges) { const list = outgoing.get(edge.prerequisiteId) ?? []; list.push(edge.dependentId); outgoing.set(edge.prerequisiteId, list); counts.set(edge.dependentId, (counts.get(edge.dependentId) ?? 0) + 1); if (!counts.has(edge.prerequisiteId)) counts.set(edge.prerequisiteId, 0); }
  const queue = [...counts].filter(([, n]) => n === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++) for (const dest of outgoing.get(queue[i]) ?? []) { counts.set(dest, counts.get(dest) - 1); if (!counts.get(dest)) queue.push(dest); }
  if (queue.length !== counts.size) invalid();
  const prerequisites = value.prerequisites.map(p => { if (!keys(p, 'id,hash') || !id(p.id) || !sha(p.hash)) invalid(); return { id: p.id, hash: p.hash }; });
  if (!equal(prerequisites.map(p => p.id), [...closure].filter(id => !selected.has(id)).sort(order))) invalid();
  const research = value.research.map(r => { if (!keys(r, 'id,stale') || !id(r.id) || typeof r.stale !== 'boolean') invalid(); return { id: r.id, stale: r.stale }; });
  if (!equal(research.map(r => r.id), includeEvidence ? [...selected].sort(order) : [])) invalid();
  const result = { version: 1, edges, prerequisites, research };
  if (Buffer.byteLength(JSON.stringify(result)) > LIMIT) throw Error('ADR reviewed dependency context exceeds its 64 KiB limit. Select a smaller scope; nothing was clipped.');
  return result;
}
export function adrReviewContext(doc, nodeIds, includeEvidence) {
  const selected = selectedIds(nodeIds, includeEvidence), byId = new Map(doc.nodes.map(n => [n.id, n]));
  if ([...selected].some(id => !byId.has(id))) throw Error('A selected ADR source is missing. Review the current scope.');
  const all = doc.dependencies ?? [], closure = upstream(all, selected);
  const edges = all.filter(e => closure.has(e.dependentId) || selected.has(e.prerequisiteId)).map(e => ({ dependentId: e.dependentId, prerequisiteId: e.prerequisiteId, explanation: e.explanation ?? '' })).sort((a, b) => order(edgeKey(a), edgeKey(b)));
  const prerequisites = [...closure].filter(id => !selected.has(id)).sort(order).map(id => { if (!byId.has(id)) throw Error('An ADR prerequisite is missing. Review its dependency relationship.'); return { id, hash: hash(record(byId.get(id))) }; });
  return validateAdrReviewContext({ version: 1, edges, prerequisites, research: includeEvidence ? [...selected].sort(order).map(id => ({ id, stale: byId.get(id).researchStale === true })) : [] }, nodeIds, includeEvidence);
}
export function adrReviewContextChanges(before, after) {
  const changes = [];
  for (const [field, key, kind] of [['edges', edgeKey, 'dependency'], ['prerequisites', p => p.id, 'prerequisite'], ['research', p => p.id, 'research-stale']]) {
    const old = new Map(before[field].map(v => [key(v), v])), current = new Map(after[field].map(v => [key(v), v]));
    for (const id of [...new Set([...old.keys(), ...current.keys()])].sort(order)) if (!equal(old.get(id), current.get(id))) {
      const edge = current.get(id) ?? old.get(id);
      changes.push(kind === 'dependency' ? { kind, id: edge.dependentId, prerequisiteId: edge.prerequisiteId, message: `Dependency ${edge.dependentId} requires ${edge.prerequisiteId}: ${!old.has(id) ? 'added' : !current.has(id) ? 'removed' : 'explanation changed'}.` } : { kind, id, message: kind === 'prerequisite' ? `Upstream prerequisite ${id} changed or its inclusion changed.` : `Recorded research staleness changed for ${id}.` });
    }
  }
  return changes;
}
