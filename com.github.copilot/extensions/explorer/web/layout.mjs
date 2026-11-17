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
