import { isResolvedQuestion } from './answer-state.mjs';

// The full tree supplies counts; only visible nodes and edges reach layout/rendering.
export function branchView(nodes, rootId, collapsed, focusId = null) {
  const children = new Map(nodes.map(node => [node.id, []]));
  for (const node of nodes) if (node.parentId) children.get(node.parentId).push(node);
  const ancestry = new Set();
  if (focusId && focusId !== rootId) {
    const parents = new Map(nodes.map(node => [node.id, node.parentId]));
    for (let id = focusId; id != null; id = parents.get(id)) ancestry.add(id);
  }
  const order = [nodes.find(node => node.id === rootId)];
  for (let i = 0; i < order.length; i++) order.push(...children.get(order[i].id));
  const descendants = new Map();
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i], count = { total: 0, unresolved: 0 };
    for (const child of children.get(node.id)) {
      const nested = descendants.get(child.id);
      count.total += 1 + nested.total;
      count.unresolved += Number(!isResolvedQuestion(child)) + nested.unresolved;
    }
    descendants.set(node.id, count);
  }
  const visible = [order[0]], edges = [];
  for (let i = 0; i < visible.length; i++) {
    const node = visible[i];
    if (collapsed.has(node.id) && (!ancestry.has(node.id) || node.id === focusId)) continue;
    for (const child of children.get(node.id)) {
      if (ancestry.has(node.id) && node.id !== focusId && !ancestry.has(child.id)) continue;
      visible.push(child); edges.push(child);
    }
  }
  return { nodes: visible, edges, descendants };
}

export function revealPath(nodes, collapsed, id) {
  const parents = new Map(nodes.map(node => [node.id, node.parentId]));
  const revealed = new Set(collapsed);
  for (let parent = parents.get(id); parent != null; parent = parents.get(parent)) revealed.delete(parent);
  return revealed;
}

export function layout(nodes, rootId, sizes = new Map()) {
  const children = new Map(nodes.map(n => [n.id, []]));
  for (const n of nodes) if (n.parentId) children.get(n.parentId).push(n.id);
  const order = [rootId];
  for (let i = 0; i < order.length; i++) order.push(...children.get(order[i]));
  const spans = new Map();
  const box = id => sizes.get(id) ?? { width: 220, height: 110 };
  const childSpan = id => children.get(id).reduce((sum, child) => sum + spans.get(child), 0) + Math.max(0, children.get(id).length - 1) * 36;
  for (const id of order.toReversed()) spans.set(id, Math.max(box(id).width, childSpan(id)));
  const result = new Map(), queue = [{ id: rootId, left: -spans.get(rootId) / 2, top: 0, branch: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const { id, left, top, branch } = queue[i], { width, height } = box(id);
    result.set(id, { x: left + (spans.get(id) - width) / 2, y: top, width, height, branch });
    let childLeft = left + (spans.get(id) - childSpan(id)) / 2;
    for (const [index, child] of children.get(id).entries()) {
      queue.push({ id: child, left: childLeft, top: top + height + 72, branch: id === rootId ? index : branch });
      childLeft += spans.get(child) + 36;
    }
  }
  return result;
}
