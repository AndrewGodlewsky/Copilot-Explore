import test from 'node:test';
import assert from 'node:assert/strict';
import { layout, branchView, revealPath } from '../com.github.copilot/extensions/explorer/web/layout.mjs';

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

test('nested folds retain their own nodes and count all hidden unresolved descendants', () => {
  const tree = [
    { id: 'root', parentId: null, answer: '' },
    { id: 'a', parentId: 'root', answer: '' },
    { id: 'b', parentId: 'root', answer: '' },
    { id: 'a1', parentId: 'a', answer: 'Provisional', answerState: 'tentative' },
    { id: 'a2', parentId: 'a', answer: '', answerState: 'not-relevant' },
    { id: 'a3', parentId: 'a1', answer: 'Chosen', answerState: 'decided', review: true },
    { id: 'b1', parentId: 'b', answer: 'Chosen', answerState: 'decided' },
  ];
  const folded = branchView(tree, 'root', new Set(['a', 'a1']));
  assert.deepEqual(folded.nodes.map(n => n.id), ['root', 'a', 'b', 'b1']);
  assert.deepEqual(folded.edges.map(n => [n.parentId, n.id]), [['root', 'a'], ['root', 'b'], ['b', 'b1']]);
  assert.deepEqual(folded.descendants.get('a'), { total: 3, unresolved: 2 });
  assert.deepEqual(folded.descendants.get('a1'), { total: 1, unresolved: 1 });
  assert.deepEqual(folded.descendants.get('root'), { total: 6, unresolved: 4 });
  assert.deepEqual(branchView(tree, 'root', new Set(['root'])).nodes.map(n => n.id), ['root']);
  assert.deepEqual(branchView(tree, 'root', new Set()).nodes.map(n => n.id), ['root', 'a', 'b', 'a1', 'a2', 'b1', 'a3']);
  assert.deepEqual([...revealPath(tree, new Set(['root', 'a', 'a1', 'b']), 'a3')], ['b']);
});

test('wide and maximum-depth maps fold without recursion or repeated subtree scans', () => {
  const deep = [{ id: 'root', parentId: null, answer: '' }];
  for (let i = 1; i <= 4999; i++) deep.push({ id: `d${i}`, parentId: i === 1 ? 'root' : `d${i - 1}`, answer: '' });
  const folded = branchView(deep, 'root', new Set(['d1']));
  assert.deepEqual(folded.nodes.map(n => n.id), ['root', 'd1']);
  assert.deepEqual(folded.descendants.get('d1'), { total: 4998, unresolved: 4998 });
  assert.equal(revealPath(deep, new Set(['root', 'd1', 'd3000']), 'd4999').size, 0);
  const wide = [{ id: 'root', parentId: null, answer: '' }, ...Array.from({ length: 4999 }, (_, i) => ({ id: `w${i}`, parentId: 'root', answer: '' }))];
  assert.equal(branchView(wide, 'root', new Set(['root'])).descendants.get('root').total, 4999);
});

test('branch focus keeps its ancestry and subtree while restoring unrelated folds', () => {
  const folded = new Set(['root', 'a', 'a1', 'b']);
  const focused = branchView(nodes, 'root', folded, 'a1');
  assert.deepEqual(focused.nodes.map(n => n.id), ['root', 'a', 'a1']);
  assert.deepEqual(focused.edges.map(n => n.id), ['a', 'a1']);
  assert.deepEqual([...folded], ['root', 'a', 'a1', 'b'], 'focus never edits folds');
  assert.deepEqual(branchView(nodes, 'root', folded).nodes.map(n => n.id), ['root']);
  assert.deepEqual(branchView(nodes, 'root', new Set(['b']), 'a').nodes.map(n => n.id), ['root', 'a', 'a1', 'a2', 'a3']);
  assert.deepEqual(branchView(nodes, 'root', new Set(['a1']), 'a').nodes.map(n => n.id), ['root', 'a', 'a1', 'a2']);
  assert.deepEqual(branchView(nodes, 'root', new Set(), 'a3').nodes.map(n => n.id), ['root', 'a', 'a1', 'a3']);
  assert.deepEqual(branchView(nodes, 'root', new Set(), 'root').nodes.map(n => n.id), branchView(nodes, 'root', new Set()).nodes.map(n => n.id));
});

test('maximum-depth focus and nested folds stay iterative', () => {
  const deep = [{ id: 'root', parentId: null, answer: '' }];
  for (let i = 1; i <= 4999; i++) deep.push({ id: `d${i}`, parentId: i === 1 ? 'root' : `d${i - 1}`, answer: '' });
  const focused = branchView(deep, 'root', new Set(['root', 'd1', 'd4998']), 'd4999');
  assert.equal(focused.nodes.length, 5000);
  assert.equal(focused.edges.length, 4999);
  assert.equal(branchView(deep, 'root', new Set(['d4999']), 'd4998').nodes.length, 5000);
});
import * as geometry from '../com.github.copilot/extensions/explorer/web/layout.mjs';

test('geometry cache reuses stable layout and releases changed topology, dimensions and journey', () => {
  assert.equal(typeof geometry.GeometryCache, 'function', 'geometry cache is available');
  const cache = new geometry.GeometryCache();
  const boxes = new Map([['a', { width: 560, height: 400 }]]);
  const first = cache.get(nodes, 'root', boxes, ['journey', 1100, 720, 0, 'a']);
  assert.equal(cache.get(structuredClone(nodes), 'root', boxes, ['journey', 1100, 720, 0, 'a']), first);
  assert.equal(first.positions.size, 8);
  assert.equal(first.edges.size, 7);
  for (const inputs of [['journey', 340, 720, 0, 'a'], ['journey', 340, 720, 1, 'a'], ['other', 340, 720, 1, 'a']]) {
    const previous = cache.value;
    assert.notEqual(cache.get(nodes, 'root', boxes, inputs), previous);
  }
  const before = cache.value;
  boxes.set('a', { width: 560, height: 600 });
  const after = cache.get(nodes, 'root', boxes, ['other', 340, 720, 1, 'a']);
  assert.notEqual(after, before);
  assert.equal(after.positions.get('a1').y, before.positions.get('a1').y + 200);
  const folded = branchView(nodes, 'root', new Set(['a']));
  assert.equal(cache.get(folded.nodes, 'root', boxes, []).positions.has('a1'), false);
  cache.clear(); assert.equal(cache.value, null);
});

test('viewport conversion and crossing connectors retain edges with both endpoints offscreen', () => {
  assert.equal(typeof geometry.viewportBounds, 'function', 'viewport conversion is available');
  for (const zoom of [.0001, .1, 1, 3]) {
    const view = { x: -1200, y: -500, zoom };
    const rect = geometry.viewportBounds(view, { width: 340, height: 720 }, 0);
    assert.equal(rect.left * zoom + view.x, 0);
    assert.equal(rect.top * zoom + view.y, 0);
    assert.ok(Math.abs(rect.right * zoom + view.x - 340) < .000001);
    assert.ok(Math.abs(rect.bottom * zoom + view.y - 720) < .000001);
  }
  const cache = new geometry.GeometryCache();
  const scene = cache.get([{ id: 'r', parentId: null }, { id: 'c', parentId: 'r' }], 'r');
  const viewport = { left: -30, right: 30, top: 125, bottom: 160 };
  assert.equal(geometry.intersects(scene.positions.get('r'), viewport), false);
  assert.equal(geometry.intersects(scene.positions.get('c'), viewport), false);
  assert.equal(geometry.intersects(scene.edges.get('c').bounds, viewport), true);
  assert.equal(geometry.intersects({ x: 30, y: 160, width: 10, height: 10 }, viewport), true, 'inclusive boundary');
  assert.equal(geometry.intersects({ x: 31, y: 161, width: 10, height: 10 }, viewport), false);
});

test('near-limit deep and wide geometry remains finite and nonoverlapping with long text and expansion', () => {
  assert.equal(typeof geometry.GeometryCache, 'function', 'geometry cache is available');
  for (const wide of [false, true]) {
    const tree = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), parentId: i ? String(wide ? 0 : i - 1) : null, question: 'Long text '.repeat(200) }));
    const scene = new geometry.GeometryCache().get(tree, '0', new Map([['2500', { width: 560, height: 680 }]]));
    assert.equal(scene.positions.size, 5000); assert.equal(scene.edges.size, 4999);
    let previous;
    for (const node of tree) {
      const box = scene.positions.get(node.id);
      assert.ok(Object.values(box).every(Number.isFinite));
      if (node.parentId) {
        const parent = scene.positions.get(node.parentId);
        assert.ok(box.y >= parent.y + parent.height + 72);
        if (wide && previous) assert.ok(box.x >= previous.x + previous.width + 36);
        previous = box;
      }
    }
  }
});
