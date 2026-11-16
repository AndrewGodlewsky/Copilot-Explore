export function layout(nodes, rootId) {
  const children = new Map(nodes.map(n => [n.id, []]));
  for (const n of nodes) if (n.parentId) children.get(n.parentId).push(n.id);
  const order = [rootId];
  for (let i = 0; i < order.length; i++) order.push(...children.get(order[i]));
  const spans = new Map();
  for (const id of order.toReversed()) spans.set(id, Math.max(142, children.get(id).reduce((sum, child) => sum + spans.get(child), 0)));
  const result = new Map([[rootId, { x: -110, y: -55, side: 0, branch: 0 }]]);
  const branches = children.get(rootId);
  for (const side of [-1, 1]) {
    const group = branches.map((id, index) => ({ id, index })).filter((_, index) => (index % 2 ? 1 : -1) === side);
    let offset = -group.reduce((sum, item) => sum + spans.get(item.id), 0) / 2;
    const queue = [];
    for (const item of group) { queue.push({ ...item, top: offset, depth: 1 }); offset += spans.get(item.id); }
    for (let i = 0; i < queue.length; i++) {
      const { id, index, top, depth } = queue[i];
      const center = top + spans.get(id) / 2;
      result.set(id, { x: side * depth * 300 - 110, y: center - 55, side, branch: index });
      let childTop = top;
      for (const child of children.get(id)) { queue.push({ id: child, index, top: childTop, depth: depth + 1 }); childTop += spans.get(child); }
    }
  }
  return result;
}
