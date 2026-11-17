import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../com.github.copilot/extensions/explorer/web/layout.mjs';

const nodes = [
  { id: 'root', parentId: null }, { id: 'a', parentId: 'root' },
  { id: 'b', parentId: 'root' }, { id: 'c', parentId: 'root' },
  { id: 'a1', parentId: 'a' }, { id: 'a2', parentId: 'a' },
  { id: 'a3', parentId: 'a1' }, { id: 'b1', parentId: 'b' },
];

test('expanded tree boxes never overlap and follow-ups stay below their parent', () => {
  for (const selected of nodes) for (const width of [260, 560]) {
    const positions = layout(nodes, 'root', new Map([[selected.id, { width, height: 680 }]]));
    assert.equal(positions.get(selected.id).width, width);
    assert.equal(positions.get(selected.id).height, 680);
    for (const n of nodes) if (n.parentId) {
      const p = positions.get(n.parentId), child = positions.get(n.id);
      assert.ok(child.y >= p.y + p.height + 40, n.id + ' below parent');
    }
    const boxes = [...positions.values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'separate boxes');
    }
  }
});

test('growing research preserves its question header and moves descendants down', () => {
  const before = layout(nodes, 'root', new Map([['a', { width: 560, height: 380 }]]));
  const after = layout(nodes, 'root', new Map([['a', { width: 560, height: 680 }]]));
  assert.equal(after.get('a').x, before.get('a').x);
  assert.equal(after.get('a').y, before.get('a').y);
  assert.deepEqual(after.get('b'), before.get('b'));
  assert.equal(after.get('a1').y, before.get('a1').y + 300);
});
