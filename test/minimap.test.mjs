import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { GeometryCache } from '../com.github.copilot/extensions/explorer/web/layout.mjs';

import * as module from '../com.github.copilot/extensions/explorer/web/minimap.mjs';
test('minimap projection round-trips negative and extreme scene coordinates and clips the exact viewport', () => {
  assert.equal(typeof module.projectOverview, 'function', 'minimap projection is available');
  for (const bounds of [
    { left: -1000, top: -200, right: 4000, bottom: 900 },
    { left: -900000, top: 0, right: 900000, bottom: 200 },
    { left: -140, top: 0, right: 140, bottom: 1800000 },
  ]) for (const [width, height] of [[180, 80], [80, 80], [300, 40]]) {
    const p = module.projectOverview(bounds, width, height);
    for (const [x, y] of [[bounds.left, bounds.top], [bounds.right, bounds.bottom], [0, 100]]) {
      const mini = p.point(x, y), back = p.world(mini.x, mini.y);
      assert.ok(Math.abs(back.x - x) < 1e-7); assert.ok(Math.abs(back.y - y) < 1e-7);
    }
    for (const zoom of [.0001, .1, 1, 3]) {
      const view = { x: 40, y: -30, zoom }, size = { width: 340, height: 500 };
      const box = p.viewport(view, size), a = p.point(-view.x / zoom, -view.y / zoom), b = p.point((size.width - view.x) / zoom, (size.height - view.y) / zoom);
      assert.equal(box.x, Math.max(0, Math.min(width, a.x)));
      assert.equal(box.y, Math.max(0, Math.min(height, a.y)));
      assert.equal(box.width, Math.max(0, Math.min(width, b.x)) - box.x);
      assert.equal(box.height, Math.max(0, Math.min(height, b.y)) - box.y);
    }
  }
});

test('minimap projection fits existing deep and wide geometry without another layout or nonfinite paths', () => {
  assert.equal(typeof module.overviewPaths, 'function', 'overview path builder is available');
  for (const deep of [false, true]) {
    const nodes = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), parentId: i ? String(deep ? i - 1 : 0) : null }));
    const scene = new GeometryCache().get(nodes, '0');
    const p = module.projectOverview(scene.bounds, 120, 80);
    const paths = module.overviewPaths(scene.positions, p, '4999', new Set(['1']), '0');
    assert.equal((paths.nodes.match(/M/g) ?? []).length, 5000);
    assert.equal((paths.selected.match(/M/g) ?? []).length, 1);
    assert.equal((paths.folded.match(/M/g) ?? []).length, 1);
    assert.equal((paths.focus.match(/M/g) ?? []).length, 1);
    assert.doesNotMatch(JSON.stringify(paths), /NaN|Infinity/);
    for (const box of scene.positions.values()) {
      const a = p.point(box.x, box.y), b = p.point(box.x + box.width, box.y + box.height);
      assert.ok(a.x >= 0 && a.y >= 0 && b.x <= 120 && b.y <= 80);
    }
  }
});

test('minimap has one action per activation and releases every listener on disposal', () => {
  const dom = new JSDOM('<main><button id="minimap-toggle"></button><section id="minimap" hidden><svg id="minimap-map" tabindex="0"><path id="minimap-nodes"/><path id="minimap-folded"/><path id="minimap-focus"/><path id="minimap-selected"/><rect id="minimap-viewport"/></svg><p id="minimap-status"></p></section></main>');
  const { window } = dom, { document } = window, $ = id => document.getElementById(id), svg = $('minimap-map');
  let observed = 0, listeners = 0, actions = 0, leftEditor = 0;
  window.ResizeObserver = class { observe() { observed++; } disconnect() { observed--; } };
  for (const target of [document, window, svg, $('minimap-toggle')]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (...args) => { listeners++; add(...args); };
    target.removeEventListener = (...args) => { listeners--; remove(...args); };
  }
  const held = new Set(); svg.setPointerCapture = id => held.add(id); svg.hasPointerCapture = id => held.has(id); svg.releasePointerCapture = id => held.delete(id);
  svg.getBoundingClientRect = () => ({ left: 10, top: 10, width: 180, height: 80 });
  const geometry = new GeometryCache().get([{ id: 'root', parentId: null }], 'root');
  const state = { geometry, selected: 'root', collapsed: new Set(), focusId: null, view: { x: 0, y: 0, zoom: 1 }, size: { width: 340, height: 500 } };
  const mini = module.attachMinimap({ document, window, scene: () => state, navigate: () => actions++, leaveEditor: () => leftEditor++ });
  $('minimap-toggle').click(); assert.equal(leftEditor, 1); assert.equal(actions, 0);
  const pointer = (target, type, values = {}) => { const event = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 1, button: 0, buttons: 1, isPrimary: true, clientX: 40, clientY: 40, ...values }); target.dispatchEvent(event); };
  pointer(svg, 'pointerdown'); pointer(window, 'pointerup'); svg.dispatchEvent(new window.MouseEvent('click', { detail: 1 })); assert.equal(actions, 1);
  pointer(svg, 'pointerdown'); pointer(window, 'pointermove', { clientX: 80 }); pointer(window, 'pointerup'); assert.equal(actions, 2, 'drag has no extra up action');
  pointer(svg, 'pointerdown', { isPrimary: false }); pointer(window, 'pointerup');
  pointer(svg, 'pointerdown', { ctrlKey: true }); pointer(window, 'pointerup'); assert.equal(actions, 2);
  svg.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', isComposing: true }));
  svg.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', repeat: true })); assert.equal(actions, 2, 'composition and repeated activation are inert');
  for (const key of ['Enter', ' ', 'Home', 'ArrowRight']) svg.dispatchEvent(new window.KeyboardEvent('keydown', { key })); assert.equal(actions, 6);
  pointer(svg, 'pointerdown'); mini.reset(); pointer(window, 'pointerup'); assert.equal(actions, 6); assert.equal(held.size, 0);
  mini.update(); pointer(svg, 'pointerdown'); svg.dispatchEvent(new window.Event('blur')); pointer(window, 'pointerup'); assert.equal(actions, 6, 'leaving overview focus cancels the pointer owner');
  mini.update(); const before = leftEditor; mini.update(); assert.equal(leftEditor, before, 'passive updates do not change voice ownership');
  mini.dispose(); assert.equal(observed, 0); assert.equal(listeners, 0);
  $('minimap-toggle').click(); svg.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' })); pointer(svg, 'pointerdown'); pointer(window, 'pointerup'); assert.equal(actions, 6);
  dom.window.close();
});
