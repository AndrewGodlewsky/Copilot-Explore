import { isDeepStrictEqual as equal } from 'node:util';
import { validateSharedDocument } from './shared-document.mjs';
import { effectiveAnswerState } from './model.mjs';

const mapNodes = doc => new Map(doc.journey.nodes.map(node => [node.id, node]));
const ordered = (...values) => [...new Set(values.flat())];
const context = node => node && [node.parentId, node.question, node.kind ?? null, node.answer, effectiveAnswerState(node)];

/** Pure comparison. The caller must prove a real common base before accepting it. */
export function mergeSharedDocuments(base, local, incoming, choices = {}) {
  for (const source of [base, local, incoming]) validateSharedDocument(source);
  for (const field of ['id', 'rootId', 'createdAt']) if (local.journey[field] !== base.journey[field] || incoming.journey[field] !== base.journey[field]) throw Error('Journey identity differs. Compare or save separate copies instead.');
  if (!choices || typeof choices !== 'object' || Array.isArray(choices) || ![Object.prototype, null].includes(Object.getPrototypeOf(choices))) throw Error('Invalid merge choices.');
  const conflicts = [], unresolved = [], maps = [base, local, incoming].map(mapNodes), [before, ours, theirs] = maps;
  const pick = (id, label, b, l, r, forced = false) => {
    if (!forced && equal(l, r)) return l;
    if (!forced && equal(b, l)) return r;
    if (!forced && equal(b, r)) return l;
    conflicts.push({ id, label });
    if (!Object.hasOwn(choices, id)) { unresolved.push(id); return l; }
    if (!['local', 'incoming'].includes(choices[id])) throw Error('Invalid merge choice. Choose a displayed candidate.');
    return choices[id] === 'local' ? l : r;
  };
  // Deleting an unchanged parent still competes with edits/additions below it.
  const deletionConflicts = new Set();
  for (const [deletedSide, otherSide] of [[ours, theirs], [theirs, ours]]) {
    for (const node of otherSide.values()) {
      if (equal(node, before.get(node.id))) continue;
      let parent = node.parentId;
      while (parent !== null) {
        if (before.has(parent) && !deletedSide.has(parent)) deletionConflicts.add(parent);
        parent = otherSide.get(parent).parentId;
      }
    }
  }
  const nodes = new Map();
  for (const id of ordered(...maps.map(map => [...map.keys()]))) {
    const selected = pick(`node:${id}`, (ours.get(id) ?? theirs.get(id) ?? before.get(id)).question, before.get(id), ours.get(id), theirs.get(id), deletionConflicts.has(id));
    if (selected !== undefined) nodes.set(id, structuredClone(selected));
  }
  let journey = { id: base.journey.id, rootId: base.journey.rootId, createdAt: base.journey.createdAt, updatedAt: local.journey.updatedAt };
  for (const key of ordered(...[base, local, incoming].map(doc => Object.keys(doc.journey)))) {
    if (['id', 'rootId', 'createdAt', 'updatedAt', 'nodes'].includes(key)) continue;
    const value = pick(`field:${key}`, `Journey ${key}`, base.journey[key], local.journey[key], incoming.journey[key]);
    if (value !== undefined) journey[key] = structuredClone(value);
  }
  // Compare only surviving base IDs for reorder intent; additions do not conflict.
  const common = new Set([...before.keys()].filter(id => ours.has(id) && theirs.has(id) && nodes.has(id)));
  const orders = maps.map(map => [...map.keys()].filter(id => common.has(id)));
  const order = pick('order', 'Order of existing questions', ...orders);
  const reordered = !equal(order, orders[0]);
  const preferred = reordered && equal(order, orders[2]) ? theirs : ours;
  journey.nodes = ordered([...preferred.keys()], ...maps.map(map => [...map.keys()])).filter(id => nodes.has(id)).map(id => nodes.get(id));
  let document = { format: base.format, version: base.version, journey };
  const extensions = pick('extensions', 'Shared extension envelope', base.extensions, local.extensions, incoming.extensions);
  if (extensions !== undefined) document.extensions = structuredClone(extensions);
  const allowed = new Set(conflicts.map(row => row.id));
  if (Object.keys(choices).some(id => !allowed.has(id) && id !== 'graph')) throw Error('Merge choices no longer match these sources. Preview again.');
  if (unresolved.length) return { conflicts, unresolved, document: null, affected: [], error: null };
  let graphError = null;
  try { validateSharedDocument(document); } catch (error) { graphError = error.message; }
  if (graphError) {
    const selected = pick('graph', 'Invalid combined graph: keep one complete source instead (replaces other choices)', undefined, local, incoming, true);
    if (unresolved.length) return { conflicts, unresolved, document: null, affected: [], error: graphError };
    document = structuredClone(selected); journey = document.journey;
  } else if (Object.hasOwn(choices, 'graph')) throw Error('The graph choice no longer applies. Remove it and preview again.');
  const resultNodes = mapNodes(document);
  const changed = new Set(journey.nodes.filter(node => !equal(context(node), context(before.get(node.id)))).map(node => node.id));
  const guidanceChanged = ['topic', 'objective', 'successCriteria', 'mode', 'pins'].some(key => !equal(journey[key], base.journey[key]));
  const affected = [];
  for (const node of journey.nodes) {
    if (node.id === journey.rootId) continue;
    let needsReview = guidanceChanged || before.has(node.id) && before.get(node.id).parentId !== node.parentId, parent = node.parentId;
    while (!needsReview && parent !== null) { needsReview = changed.has(parent); parent = resultNodes.get(parent).parentId; }
    if (needsReview) { node.review = true; affected.push(node.id); }
  }
  validateSharedDocument(document);
  return { conflicts, unresolved, document, affected, error: null };
}
