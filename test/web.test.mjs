import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { layout } from '../com.github.copilot/extensions/explorer/web/layout.mjs';
import { attachVoice } from '../com.github.copilot/extensions/explorer/web/voice.mjs';
import { DraftClient } from '../com.github.copilot/extensions/explorer/web/drafts.mjs';

const findings = { basis: 'reasoning', summary: 'Two possible ways forward.', options: [
  { title: 'One block', description: 'Start with the nearest neighbors.', pros: ['Easy handovers'], cons: ['Fewer tools'] },
  { title: 'Whole neighborhood', description: 'Invite everyone nearby.', pros: ['More tools'], cons: ['More coordination'] },
], recommendation: 'Try a small pilot.', uncertainty: 'No external sources consulted.', sources: [] };

async function until(read, label) {
  for (let i = 0; i < 250; i++) { const result = read(); if (result) return result; await delay(10); }
  assert.fail('Timed out: ' + label);
}

async function fixture(t, width = 1100, voice = { status: async () => ({ ready: false, error: 'Voice test fixture disabled.' }), close() {} }, useLibrary = false, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-dom-'));
  let resolveResearch;
  const explorer = await new Explorer({ file: join(dir, 'map.explore.json'), ...(useLibrary ? { library: new Library(dir), binding: 'dom' } : {}), send: async () => {}, target: { instanceId: 'dom-test' },
    researcher: { run: (_, { signal }) => new Promise((resolve, reject) => { resolveResearch = resolve; signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }); }) },
  }).load();
  await explorer.command('start', { topic: 'A tool library' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [
    { category: 'People', question: 'Who should borrow first?' }, { category: 'Trust', question: 'What if a tool breaks?' },
  ] });
  await options.before?.(explorer);
  const server = await startServer(explorer, voice);
  const dom = new JSDOM(await (await fetch(server.url)).text(), { url: server.url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  const guidanceDialog = document.getElementById('guidance-dialog');
  guidanceDialog.showModal = () => { guidanceDialog.open = true; };
  guidanceDialog.close = () => { guidanceDialog.open = false; };
  const requests = new Set();
  t.after(async () => {
    window.dispatchEvent(new window.Event('pagehide'));
    await Promise.allSettled([...requests]); await delay(0);
    dom.window.close(); await server.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true });
  });
  const map = document.getElementById('map');
  // jsdom has no visual layout. Only geometry inputs are stubbed; DOM events,
  // the shipped app, HTTP server, controller, persistence and callbacks are real.
  let height = 720;
  map.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height });
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { get() { return parseFloat(this.style.width) || (this.id === 'map' ? width : 220); } },
    offsetHeight: { get() { return this.id === 'node-workspace' ? Math.min(540, parseFloat(this.style.maxHeight) || 540) : 110; } },
  });
  let captures = 0, holdAnswer = null, holdState = null, holdAdd = null, holdDraftRead = options.holdDraftRead, holdDraftWrite = null;
  const captured = new Set(), observers = new Map();
  map.setPointerCapture = id => { captures++; captured.add(id); };
  map.hasPointerCapture = id => captured.has(id);
  map.releasePointerCapture = id => captured.delete(id);
  window.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe(element) { observers.set(element.id, this.callback); } disconnect() {} };
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() });
  window.fetch = (path, options) => {
    const request = (async () => {
      if (holdAnswer && options?.body && JSON.parse(options.body).action === 'answer') await holdAnswer();
      if (holdAdd && options?.body && JSON.parse(options.body).action === 'add') await holdAdd();
      if (holdDraftWrite && path === 'api/drafts' && options?.method === 'POST') await holdDraftWrite();
      if (options?.method === 'POST') options = { ...options, headers: { ...options.headers, Origin: new URL(server.url).origin } };
      const response = await fetch(new URL(path, server.url), options);
      const body = await response.arrayBuffer();
      if (holdState && path === 'api/state') await holdState();
      if (holdDraftRead && path.startsWith('api/drafts?')) await holdDraftRead();
      return new Response(body, { status: response.status, headers: response.headers });
    })();
    requests.add(request); request.then(() => requests.delete(request), () => requests.delete(request));
    return request;
  };
  window.layout = layout;
  window.attachVoice = attachVoice;
  window.DraftClient = DraftClient;
  const script = await readFile(new URL('../com.github.copilot/extensions/explorer/web/app.mjs', import.meta.url), 'utf8');
  window.eval(script.replace("import { layout } from './layout.mjs';", '').replace("import { attachVoice } from './voice.mjs';", '').replace("import { DraftClient } from './drafts.mjs';", ''));
  await until(() => width ? document.querySelectorAll('#nodes button').length >= 3 : document.getElementById('map-title').textContent, 'initial map');
  const open = id => {
    const question = explorer.doc.nodes.find(n => n.id === id).question;
    const button = [...document.querySelectorAll('#nodes button')].find(b => b.title === question);
    assert.ok(button, 'compact node exists: ' + question); button.click();
  };
  const type = (id, value) => { const e = document.getElementById(id); assert.ok(e, id); e.value = value; e.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = text => { const b = [...document.querySelectorAll('#node-workspace button')].find(e => e.textContent === text); assert.ok(b, text); b.click(); };
  return { explorer, window, document, open, type, click, resolveResearch: value => resolveResearch(value), captures: () => captures, pauseAnswer: fn => { holdAnswer = fn; },
    resize: (w, h = height) => { width = w; height = h; observers.get('map')(); }, pauseState: fn => { holdState = fn; }, pauseAdd: fn => { holdAdd = fn; },
    pauseDraftRead: fn => { holdDraftRead = fn; }, pauseDraftWrite: fn => { holdDraftWrite = fn; } };
}

test('library opens, searches, pins and archives journeys at narrow pane width', async t => {
  const f = await fixture(t, 340, undefined, true);
  const second = await f.explorer.library.import(createDocument('Another saved journey'));
  assert.ok(f.document.getElementById('library-toggle'), 'header offers Library');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'two library entries');
  f.type('library-search', 'Another');
  await until(() => f.document.querySelectorAll('.library-entry').length === 1, 'library search');
  f.document.querySelector('.library-entry [data-action="pin"]').click();
  await until(() => f.document.querySelector('.library-entry [data-action="pin"]')?.textContent === 'Unpin', 'pin saved');
  f.document.querySelector('.library-entry [data-action="archive"]').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 0, 'archived hidden');
  const archived = f.document.getElementById('library-archived'); archived.checked = true; archived.dispatchEvent(new f.window.Event('change'));
  await until(() => f.document.querySelectorAll('.library-entry').length === 1, 'archive filter');
  f.document.querySelector('.library-entry [data-action="open"]').click();
  await until(() => f.explorer.activeKey === second.key && !f.document.getElementById('workspace').hidden, 'journey opened');
  assert.equal(f.document.activeElement.id, 'map', 'keyboard focus follows the opened map');
});

test('switching blocks manual-question drafts and pending AI', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.doc.id, node = f.explorer.doc.nodes[1];
  await f.explorer.library.import(createDocument('Second journey'));
  assert.ok(f.document.getElementById('library-toggle'), 'header offers Library');
  const trySwitch = async () => {
    f.document.getElementById('library-toggle').click();
    await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library visible');
    [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('Second journey')).querySelector('[data-action="open"]').click();
    await delay(20); assert.equal(f.explorer.doc.id, first);
    f.document.getElementById('library-return').click();
  };
  f.open(node.id);
  f.type('answer', ''); f.type('manual-question', 'A manual question'); await trySwitch();
  assert.equal(f.document.getElementById('manual-question').value, 'A manual question');
  f.type('manual-question', ''); f.type('manual-category', 'My custom category'); await trySwitch();
  assert.equal(f.document.getElementById('manual-category').value, 'My custom category');
  f.type('manual-category', node.category);
  await f.explorer.command('questions', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.rootId });
  await until(() => !f.document.getElementById('request-status').hidden, 'pending visible'); await trySwitch();
  assert.match(f.document.getElementById('notice').textContent, /cancel/i);
});

test('import conflict offers open-existing or copy and never discards a manual draft', async t => {
  const f = await fixture(t, 340, undefined, true), original = structuredClone(f.explorer.doc), key = f.explorer.activeKey;
  const dialog = f.document.getElementById('import-conflict');
  // jsdom does not implement native dialog presentation or a file-picker dialog.
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  const source = structuredClone(original); source.nodes[1].answer = 'Imported answer';
  const file = f.document.getElementById('file');
  const importFile = document => {
    Object.defineProperty(file, 'files', { configurable: true, value: [{ size: JSON.stringify(document).length, text: async () => JSON.stringify(document) }] });
    file.dispatchEvent(new f.window.Event('change'));
  };
  f.open(original.nodes[1].id); f.type('manual-question', 'Keep this unfinished question');
  importFile(source); await delay(25);
  assert.equal(dialog.open, false); assert.equal(f.document.getElementById('manual-question').value, 'Keep this unfinished question');
  f.type('manual-question', ''); importFile(source);
  await until(() => dialog.open, 'duplicate choice'); assert.equal(f.explorer.doc.nodes[1].answer, '');
  f.document.querySelector('#import-existing button').click();
  await until(() => !dialog.open, 'open saved'); assert.equal(f.explorer.activeKey, key);
  importFile(source); await until(() => dialog.open, 'duplicate choice again');
  f.document.getElementById('import-copy').click();
  await until(() => !dialog.open && f.explorer.doc.id !== original.id, 'import copy');
  assert.equal(f.explorer.doc.nodes[1].answer, 'Imported answer');
  assert.equal((await f.explorer.library.resolve(key)).document.nodes[1].answer, '');
  importFile(original); await until(() => f.explorer.activeKey === key, 'identical import opens existing');
  assert.equal((await f.explorer.library.list()).entries.length, 2);
});

test('opening a divergent legacy entry resets saved-value editor buffers even when journey IDs match', async t => {
  const f = await fixture(t, 340, undefined, true), doc = structuredClone(f.explorer.doc), node = doc.nodes[1];
  doc.nodes[1].answer = 'The other saved version';
  await writeFile(join(f.explorer.library.directory, 'legacy-other.explore.json'), JSON.stringify(doc));
  const other = (await f.explorer.library.list()).entries.find(entry => entry.key !== f.explorer.activeKey);
  f.open(node.id); f.type('answer', '');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'ambiguous entries');
  [...f.document.querySelectorAll('.library-entry')].find(entry => entry.textContent.includes(other.key.slice(0, 8))).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey === other.key && !f.document.getElementById('workspace').hidden, 'other backing file');
  const collapse = f.document.getElementById('collapse-node'); if (collapse) collapse.click();
  f.open(node.id);
  assert.equal(f.document.getElementById('answer').value, 'The other saved version');
});

test('saved manual categories no longer block switching journeys', async t => {
  const f = await fixture(t, 340, undefined, true);
  const other = await f.explorer.library.import(createDocument('Other journey'));
  f.open(f.explorer.doc.rootId); f.type('manual-category', 'Custom category'); f.type('manual-question', 'A saved question?');
  f.document.getElementById('add-question').click();
  await until(() => f.explorer.doc.nodes.some(n => n.question === 'A saved question?') && f.document.getElementById('manual-question').value === '', 'manual question saved');
  assert.equal(f.explorer.doc.nodes.find(n => n.question === 'A saved question?').category, 'Custom category');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library entries');
  [...f.document.querySelectorAll('.library-entry')].find(entry => entry.textContent.includes('Other journey')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey === other.key, 'switch after saved manual category');
});

test('manual category edited during a save remains protected as an unsaved draft', async t => {
  const f = await fixture(t, 340, undefined, true), originalKey = f.explorer.activeKey;
  await f.explorer.library.import(createDocument('Other journey'));
  f.open(f.explorer.doc.rootId); f.type('manual-category', 'Submitted category'); f.type('manual-question', 'Submitted question?');
  let release, waiting = false;
  const gate = new Promise(resolve => { release = resolve; });
  f.pauseAdd(() => { waiting = true; return gate; });
  f.document.getElementById('add-question').click();
  await until(() => waiting, 'manual save in flight');
  f.type('manual-category', 'Next category'); release();
  await until(() => f.explorer.doc.nodes.some(n => n.question === 'Submitted question?') && f.document.getElementById('manual-question').value === '', 'submitted question saved');
  assert.equal(f.explorer.doc.nodes.find(n => n.question === 'Submitted question?').category, 'Submitted category');
  assert.equal(f.document.getElementById('manual-category').value, 'Next category');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library entries');
  [...f.document.querySelectorAll('.library-entry')].find(entry => entry.textContent.includes('Other journey')).querySelector('[data-action="open"]').click();
  await until(() => /draft/.test(f.document.getElementById('notice').textContent), 'new category protects switch');
  assert.equal(f.explorer.activeKey, originalKey);
  f.document.getElementById('library-return').click();
  assert.equal(f.document.getElementById('manual-category').value, 'Next category');
});

test('clearing a non-root manual category discards it and permits a new journey', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.doc.id;
  f.open(f.explorer.doc.nodes[1].id); f.type('manual-category', 'Unsaved custom category'); f.type('manual-category', '');
  f.document.getElementById('library-toggle').click();
  f.type('topic', 'A new journey');
  f.document.getElementById('start-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.id !== first, 'new journey after cleared category');
  assert.equal(f.explorer.doc.topic, 'A new journey');
});

function viewOf(f) {
  const numbers = f.document.getElementById('world').style.transform.match(/-?[\d.]+/g).map(Number);
  return { x: numbers[0], y: numbers[1], zoom: numbers[2] };
}
function pointer(f, type, target, x, y, extra = {}) {
  const event = new f.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, ...extra });
  Object.defineProperty(event, 'pointerId', { value: extra.pointerId ?? 1 });
  target.dispatchEvent(event); return event;
}
function wheel(f, target, deltaY, extra = {}) {
  const event = new f.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX: 320, clientY: 260, ...extra });
  target.dispatchEvent(event); return event;
}

test('dragging cards pans without selecting text or opening a question; clicks still open', async t => {
  const f = await fixture(t), map = f.document.getElementById('map'), node = f.document.querySelector('.node .question');
  const before = viewOf(f);
  assert.equal(pointer(f, 'pointerdown', node, 300, 250).defaultPrevented, true, 'native text selection is suppressed');
  pointer(f, 'pointermove', map, 380, 300); pointer(f, 'pointerup', map, 380, 300);
  assert.equal(viewOf(f).x, before.x + 80); assert.equal(viewOf(f).y, before.y + 50);
  node.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  assert.ok(f.document.getElementById('node-workspace').hidden, 'drag does not activate the card');
  assert.equal(map.classList.contains('dragging'), false);
  const next = f.document.querySelector('.node');
  pointer(f, 'pointerdown', next, 380, 300); pointer(f, 'pointerup', next, 380, 300); next.click();
  assert.equal(f.document.getElementById('node-workspace').hidden, false, 'normal click still activates');
});

test('an expanded heading can pull the map back while answer selection stays native', async t => {
  const f = await fixture(t); f.open(f.explorer.doc.nodes[1].id);
  const map = f.document.getElementById('map'), title = f.document.getElementById('expanded-title'), before = viewOf(f);
  pointer(f, 'pointerdown', title, 400, 250); pointer(f, 'pointermove', map, 460, 300); pointer(f, 'pointerup', map, 460, 300);
  assert.equal(viewOf(f).x, before.x + 60);
  const answer = f.document.getElementById('answer'), after = viewOf(f);
  assert.equal(pointer(f, 'pointerdown', answer, 400, 350).defaultPrevented, false);
  pointer(f, 'pointermove', answer, 500, 400); pointer(f, 'pointerup', answer, 500, 400);
  assert.deepEqual(viewOf(f), after, 'selecting answer text never drags the map');
  pointer(f, 'pointerdown', map, 100, 100); pointer(f, 'pointermove', map, 100000, 100000); pointer(f, 'pointerup', map, 100000, 100000);
  assert.ok(Math.abs(viewOf(f).x) < 3000 && Math.abs(viewOf(f).y) < 3000, 'map cannot be thrown arbitrarily far away');
  const edge = viewOf(f);
  pointer(f, 'pointerdown', title, 100, 100); pointer(f, 'pointermove', map, 80, 80); pointer(f, 'pointerup', map, 80, 80);
  assert.equal(viewOf(f).x, edge.x - 20, 'reverse dragging responds immediately at the boundary');
});

test('pan tracks one pointer and ends on cancellation, capture loss or window blur', async t => {
  const f = await fixture(t), map = f.document.getElementById('map');
  for (const ending of ['pointercancel', 'lostpointercapture', 'blur']) {
    pointer(f, 'pointerdown', map, 200, 200);
    const start = viewOf(f);
    pointer(f, 'pointermove', map, 500, 500, { pointerId: 2 });
    assert.deepEqual(viewOf(f), start, 'another pointer cannot move the drag');
    pointer(f, 'pointerup', map, 500, 500, { pointerId: 2 });
    pointer(f, 'pointermove', map, 220, 220);
    assert.equal(viewOf(f).x, start.x + 20, 'another pointer cannot end the drag');
    if (ending === 'blur') f.window.dispatchEvent(new f.window.Event('blur'));
    else pointer(f, ending, map, 220, 220);
    const end = viewOf(f);
    pointer(f, 'pointermove', map, 250, 250);
    assert.deepEqual(viewOf(f), end); assert.equal(map.hasPointerCapture(1), false);
  }
});

test('touch or pen capture transferring from a card to the map does not cancel panning', async t => {
  const f = await fixture(t), map = f.document.getElementById('map'), label = f.document.querySelector('.node .question');
  const before = viewOf(f);
  pointer(f, 'pointerdown', label, 200, 200); pointer(f, 'pointermove', label, 220, 220);
  pointer(f, 'lostpointercapture', label, 220, 220);
  pointer(f, 'pointermove', map, 240, 240);
  assert.equal(viewOf(f).x, before.x + 40); assert.ok(map.hasPointerCapture(1));
  pointer(f, 'pointerup', map, 240, 240);
});

test('wheel zoom anchors at the pointer, reaches 300%, resets, and respects text scrolling', async t => {
  const f = await fixture(t), map = f.document.getElementById('map'), before = viewOf(f);
  assert.equal(wheel(f, map, -100).defaultPrevented, true);
  const after = viewOf(f);
  assert.ok(after.zoom > before.zoom);
  assert.ok(Math.abs((320 - after.x) / after.zoom - (320 - before.x) / before.zoom) < 1e-8);
  assert.ok(Math.abs((260 - after.y) / after.zoom - (260 - before.y) / before.zoom) < 1e-8);
  for (let i = 0; i < 20; i++) f.document.getElementById('zoom-in').click();
  assert.equal(viewOf(f).zoom, 3); assert.ok(f.document.getElementById('zoom-in').disabled);
  f.document.getElementById('zoom-level').click(); assert.equal(viewOf(f).zoom, 1);
  f.open(f.explorer.doc.nodes[1].id);
  const answer = f.document.getElementById('answer'), stable = viewOf(f);
  assert.equal(wheel(f, answer, 100).defaultPrevented, false); assert.deepEqual(viewOf(f), stable);
  assert.equal(wheel(f, answer, -100, { ctrlKey: true }).defaultPrevented, true, 'pinch/Ctrl-wheel cannot zoom the host page');
  assert.ok(viewOf(f).zoom > stable.zoom);
});

test('an expanded answer remains reachable at 300% in a narrow pane', async t => {
  const f = await fixture(t, 340); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep my draft');
  for (let i = 0; i < 20; i++) f.document.getElementById('zoom-in').click();
  const panel = f.document.getElementById('node-workspace'), v = viewOf(f);
  assert.equal(v.zoom, 3);
  const left = v.x + parseFloat(panel.style.left) * v.zoom, top = v.y + parseFloat(panel.style.top) * v.zoom;
  assert.ok(left >= 15 && left + panel.offsetWidth * v.zoom <= 325, 'editor stays inside the pane width');
  assert.ok(top >= 15 && top + panel.offsetHeight * v.zoom <= 705, 'heading and scrollable editor remain reachable');
  f.document.getElementById('save-answer').focus();
  assert.equal(f.document.activeElement.id, 'save-answer'); assert.equal(f.document.getElementById('answer').value, 'Keep my draft');
  assert.equal(viewOf(f).zoom, 3, 'focusing controls does not reset zoom');
  const map = f.document.getElementById('map');
  pointer(f, 'pointerdown', map, 100, 100); pointer(f, 'pointermove', map, 300, 200); pointer(f, 'pointerup', map, 300, 200);
  f.document.getElementById('answer').focus();
  const focused = viewOf(f), x = focused.x + parseFloat(panel.style.left) * focused.zoom;
  assert.ok(x >= 15 && x + panel.offsetWidth * focused.zoom <= 325, 'focusing the editor brings a panned-off card back');
});

test('resizing preserves manual zoom and view instead of resetting to whole map', async t => {
  const f = await fixture(t);
  f.resize(1100); f.document.getElementById('zoom-in').click(); f.document.getElementById('zoom-in').click();
  const before = viewOf(f); f.resize(1000, 680);
  const after = viewOf(f);
  assert.equal(after.zoom, before.zoom);
  assert.equal(after.x, before.x - 50); assert.equal(after.y, before.y - 20);
  f.resize(1000, 680); assert.deepEqual(viewOf(f), after, 'repeated resize notification is a no-op');
});

test('a canvas first loaded while hidden fits once it becomes visible', async t => {
  const f = await fixture(t, 0); f.resize(1100, 720);
  assert.equal(f.document.querySelectorAll('.node').length, 3);
  assert.equal(viewOf(f).zoom, 1);
  f.document.getElementById('zoom-in').click(); const before = viewOf(f);
  f.resize(0, 0); f.resize(1100, 720); assert.deepEqual(viewOf(f), before, 'hiding and revealing does not change the view');
});

test('keyboard navigation zooms, recovers the map, and reveals off-screen focused nodes', async t => {
  const f = await fixture(t), map = f.document.getElementById('map'); map.focus();
  const key = key => map.dispatchEvent(new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  key('+'); assert.ok(viewOf(f).zoom > 1); key('0'); assert.equal(viewOf(f).zoom, 1);
  for (let i = 0; i < 40; i++) key('ArrowLeft');
  const node = f.document.querySelector('.node'); node.focus();
  const p = viewOf(f), x = p.x + parseFloat(node.style.left) * p.zoom, y = p.y + parseFloat(node.style.top) * p.zoom;
  assert.ok(x >= 0 && x + parseFloat(node.style.width) * p.zoom <= 1100, 'focused node is horizontally visible');
  assert.ok(y >= 0 && y + parseFloat(node.style.height) * p.zoom <= 720, 'focused node is vertically visible');
  f.document.getElementById('outline-toggle').click();
  f.document.getElementById('search').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(f.document.getElementById('outline').hidden); assert.equal(f.document.activeElement.id, 'outline-toggle');
});

test('background refresh preserves text scroll, selection direction and IME composition', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  f.type('answer', 'A long draft\n'.repeat(60));
  let answer = f.document.getElementById('answer'); answer.focus(); answer.setSelectionRange(12, 40, 'backward'); answer.scrollTop = 200;
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Shared fund' });
  await until(() => f.document.getElementById('progress').textContent.startsWith('1 answered'), 'background answer');
  answer = f.document.getElementById('answer');
  assert.equal(answer.scrollTop, 200); assert.equal(answer.selectionDirection, 'backward');
  answer.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Different fund' });
  await delay(1350);
  assert.equal(f.document.getElementById('answer'), answer, 'composition target stays mounted');
  answer.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
  await delay(50); assert.equal(f.explorer.doc.nodes[1].answer, '', 'confirming an IME candidate does not submit an answer');
  f.type('answer', 'My completed composition');
  answer.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  await delay(50); assert.equal(f.document.getElementById('answer').value, 'My completed composition');
});

test('whole map fits a wide or deep tree instead of stopping at an unreadable zoom limit', async t => {
  const f = await fixture(t, 340), template = structuredClone(f.explorer.doc);
  for (const deep of [false, true]) {
    const doc = structuredClone(template);
    for (let i = 0; i < 100; i++) doc.nodes.push({ ...template.nodes[1], id: `large-${i}`, parentId: deep && i ? `large-${i - 1}` : doc.rootId });
    await f.explorer.command('import', { revision: f.explorer.doc.revision, document: doc });
    await until(() => f.document.querySelectorAll('.node').length === doc.nodes.length &&
      (deep ? Math.max(...[...f.document.querySelectorAll('.node')].map(e => parseFloat(e.style.top))) > 10000 : true), 'large map rendered');
    f.document.getElementById('fit').click(); const v = viewOf(f);
    assert.ok(v.zoom < .1, 'map can fit below 10%');
    for (const node of f.document.querySelectorAll('.node')) {
      const left = v.x + parseFloat(node.style.left) * v.zoom, top = v.y + parseFloat(node.style.top) * v.zoom;
      assert.ok(left >= 0 && left + parseFloat(node.style.width) * v.zoom <= 340, 'whole width fits');
      assert.ok(top >= 0 && top + parseFloat(node.style.height) * v.zoom <= 720, 'whole height fits');
    }
    f.document.getElementById('zoom-in').click(); assert.ok(viewOf(f).zoom > v.zoom);
  }
});

test('late background reads cannot undo a completed save in the UI', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  let release, started = false;
  f.pauseState(() => { started = true; return new Promise(resolve => { release = resolve; }); });
  await until(() => started, 'old state response held');
  f.type('answer', 'The saved answer'); f.click('Save answer');
  await until(() => f.document.getElementById('answer-status').textContent === 'Answer saved', 'saved response applied');
  f.pauseState(null); release(); await delay(50);
  assert.equal(f.document.getElementById('answer').value, 'The saved answer');
  assert.equal(f.document.getElementById('progress').textContent.startsWith('1 answered'), true);
});

test('adding research scrolls only the answer pane, without native scrolling of the map', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options');
  await until(() => f.explorer.pending?.kind === 'research', 'research request'); f.resolveResearch(findings);
  await until(() => f.document.getElementById('use-recommendation'), 'research rendered');
  const answer = f.document.getElementById('answer'), pane = f.document.querySelector('.node-content'), before = viewOf(f);
  answer.scrollIntoView = () => assert.fail('scrollIntoView can scroll hidden ancestors of the map');
  pane.scrollTop = 400; pane.getBoundingClientRect = () => ({ top: 240 }); answer.getBoundingClientRect = () => ({ top: 0 });
  f.click('Use recommendation');
  assert.deepEqual(viewOf(f), before); assert.ok(pane.scrollTop < 400); assert.equal(f.document.activeElement, answer);
});

test('installed questions expand inside the map, preserve drafts, and collapse to saved previews', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1);
  f.open(a.id);
  assert.ok(f.document.querySelector('#world #node-workspace #answer'), 'answer lives in the expanded map node');
  assert.equal(f.document.querySelector('aside'), null, 'no separate inspector');
  const parent = f.document.querySelector(`[data-node-id="${f.explorer.doc.rootId}"]`);
  const worldY = Number(f.document.getElementById('world').style.transform.match(/translate\([^,]+,([^p]+)px\)/)[1]);
  assert.ok(worldY + parseFloat(parent.style.top) >= 16, 'the parent remains visible above the expanded question');
  f.type('answer', 'Neighbors on our block'); f.open(b.id); f.open(a.id);
  assert.equal(f.document.getElementById('answer').value, 'Neighbors on our block');
  f.click('Save answer'); await until(() => f.explorer.doc.nodes[1].answer, 'answer saved');
  await until(() => f.document.getElementById('answer-status')?.textContent === 'Answer saved', 'save rendered');
  f.click('Collapse node');
  assert.ok(f.document.getElementById('node-workspace').hidden);
  assert.match(f.document.getElementById('nodes').textContent, /Neighbors on our block/);
  f.open(a.id); assert.equal(f.document.getElementById('answer').value, 'Neighbors on our block');
  f.document.getElementById('fit').click(); assert.ok(f.document.getElementById('node-workspace').hidden);
});

test('research callbacks and follow-ups work inside a narrow expanded node without replacing a draft', async t => {
  const f = await fixture(t, 340), a = f.explorer.doc.nodes[1];
  f.open(a.id); f.type('answer', 'My own thought');
  f.document.querySelector('.research-disclosure summary').click();
  assert.ok(f.document.querySelector('.research-disclosure').open);
  f.click('Research options');
  await until(() => f.explorer.pending?.kind === 'research', 'research requested');
  f.type('answer', 'My own thought, still editing');
  f.resolveResearch(findings);
  await until(() => f.document.querySelector('#node-workspace .option'), 'research delivered');
  assert.equal(f.document.getElementById('answer').value, 'My own thought, still editing');
  assert.match(f.document.getElementById('node-workspace').textContent, /not externally verified/);
  f.click('Use this option');
  assert.match(f.document.getElementById('answer').value, /^My own thought, still editing\n\nOne block/);
  assert.equal(f.explorer.doc.nodes[1].answer, '');
  f.click('Save & explore deeper'); await until(() => f.explorer.pending?.kind === 'questions', 'follow-ups requested');
  await f.explorer.receive('questions', { requestId: f.explorer.pending.id, questions: [{ category: 'People', question: 'How will you invite them?' }] });
  await until(() => [...f.document.querySelectorAll('#node-workspace .followup')].length, 'follow-up link');
  f.document.querySelector('#node-workspace .followup').click();
  assert.equal(f.document.getElementById('expanded-title').textContent, 'How will you invite them?');
  assert.ok(parseFloat(f.document.getElementById('node-workspace').style.width) <= 308);
});

test('typing while saving survives the response and editing does not drag the canvas', async t => {
  const f = await fixture(t), a = f.explorer.doc.nodes[1]; f.open(a.id);
  const input = f.document.getElementById('answer');
  input.dispatchEvent(new f.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  assert.equal(f.captures(), 0, 'text editing is not canvas panning');
  let release, started = false;
  f.pauseAnswer(() => { started = true; return new Promise(resolve => { release = resolve; }); });
  f.type('answer', 'Submitted answer'); f.click('Save answer'); await until(() => started, 'save held');
  f.type('answer', 'Newer unsaved thought'); release();
  await until(() => f.explorer.doc.nodes[1].answer === 'Submitted answer', 'save delivered');
  await delay(80);
  assert.equal(f.document.getElementById('answer').value, 'Newer unsaved thought');
  assert.match(f.document.getElementById('answer-status').textContent, /Saving draft|Draft saved locally/);
});

test('recommendations and selected details append to editable drafts with safe undo', async t => {
  const f = await fixture(t, 340), a = f.explorer.doc.nodes[1]; f.open(a.id);
  f.type('answer', 'My own words');
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options');
  await until(() => f.explorer.pending?.kind === 'research', 'research requested');
  const richer = structuredClone(findings); richer.proposedAnswer = 'I will run a pilot.';
  richer.options[0].proposedAnswer = 'I will start on my block.';
  richer.options[0].details = [{ label: 'Pilot size', value: 'Ten neighbors' }, { label: 'Duration', value: 'One month' }];
  f.resolveResearch(richer);
  await until(() => f.document.getElementById('use-recommendation'), 'new controls');
  f.click('Use recommendation');
  assert.equal(f.document.getElementById('answer').value, 'My own words\n\nI will run a pilot.');
  assert.equal(f.explorer.doc.nodes[1].answer, '');
  f.click('Undo addition'); assert.equal(f.document.getElementById('answer').value, 'My own words');
  const check = f.document.getElementById('detail-0-0'); check.click(); check.focus();
  // A map refresh retains both the checkbox selection and its focus.
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.nodes[2].id, answer: 'Shared fund' });
  await until(() => f.document.getElementById('progress').textContent.startsWith('1 answered'), 'background refresh');
  assert.equal(f.document.getElementById('detail-0-0').checked, true); assert.equal(f.document.activeElement.id, 'detail-0-0');
  f.click('Add selected details');
  assert.equal(f.document.getElementById('answer').value, 'My own words\n\nPilot size: Ten neighbors');
  f.type('answer', f.document.getElementById('answer').value + '\nNew typing');
  assert.equal(f.document.getElementById('undo-addition').disabled, true, 'undo cannot erase newer typing');
  f.click('Use this option'); f.click('Undo addition');
  assert.match(f.document.getElementById('answer').value, /New typing$/);
  f.type('answer', 'x'.repeat(19999)); f.click('Use recommendation');
  assert.equal(f.document.getElementById('answer').value.length, 19999); assert.match(f.document.getElementById('notice').textContent, /too long/);
  await delay(50); // Let the voice-status refresh from the background render settle before closing jsdom.
});

test('pending work remains reachable from the whole map and cancellation preserves drafts', async t => {
  const f = await fixture(t), a = f.explorer.doc.nodes[1]; f.open(a.id);
  f.type('answer', 'Keep this while researching');
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options');
  await until(() => !f.document.getElementById('request-status').hidden, 'request status');
  f.document.getElementById('fit').click();
  f.document.getElementById('request-status').click();
  assert.equal(f.document.getElementById('expanded-title').textContent, a.question);
  f.click('Cancel request'); await until(() => !f.explorer.pending, 'cancelled');
  await until(() => !f.document.querySelector('#node-workspace .pending'), 'cancellation rendered');
  assert.equal(f.document.getElementById('answer').value, 'Keep this while researching');
});

test('manual question drafts survive navigation and unsaved answers block finish', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  f.document.querySelector('.manual summary').click();
  f.type('manual-category', 'Invitations'); f.type('manual-question', 'How should we invite people?');
  f.open(b.id); f.open(a.id);
  assert.ok(f.document.querySelector('.manual').open, 'disclosure state survives immediate navigation');
  assert.equal(f.document.getElementById('manual-question').value, 'How should we invite people?');
  assert.equal(f.document.getElementById('manual-category').value, 'Invitations');
  f.document.querySelector('.manual form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.nodes.length === 4, 'manual question added');
  await until(() => f.document.getElementById('manual-question').value === '', 'manual input cleared');
  assert.equal(f.explorer.doc.nodes[3].parentId, a.id);
  f.type('answer', 'Not saved yet'); f.document.getElementById('finish').click();
  await until(() => f.document.getElementById('notice').textContent.includes('Save your draft'), 'finish guard');
  assert.match(f.document.getElementById('notice').textContent, /Save your draft/);
  assert.equal(f.explorer.doc.finishedAt, null);
});

test('a rejected stale save keeps the answer draft available', async t => {
  const f = await fixture(t), a = f.explorer.doc.nodes[1]; f.open(a.id);
  f.type('answer', 'My unsaved change');
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: a.id, answer: 'A separately saved change' });
  f.click('Save answer');
  await until(() => f.document.getElementById('notice').textContent.includes('The map changed'), 'stale save error');
  assert.equal(f.document.getElementById('answer').value, 'My unsaved change');
  assert.equal(f.explorer.doc.nodes[1].answer, 'A separately saved change');
});

test('keyboard focus survives research, cancellation, and background map updates', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  f.document.querySelector('.research-disclosure summary').click();
  const research = [...f.document.querySelectorAll('#node-workspace button')].find(e => e.textContent === 'Research options');
  research.focus(); research.click();
  await until(() => f.document.querySelector('#node-workspace .pending'), 'pending controls');
  assert.equal(f.document.activeElement.textContent, 'Cancel request');
  f.click('Cancel request'); await until(() => !f.document.querySelector('#node-workspace .pending'), 'cancellation rendered');
  assert.equal(f.document.activeElement.id, 'expanded-title');
  f.document.getElementById('fit').click();
  f.document.querySelector(`[data-node-id="${a.id}"]`).focus();
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Repairs from a shared fund' });
  await until(() => f.document.getElementById('nodes').textContent.includes('Repairs from a shared fund'), 'background update');
  assert.equal(f.document.activeElement.dataset.nodeId, a.id);
});

function voiceFixture(mode = 'push_to_talk') {
  let job, starts = 0, finishes = 0, cancels = 0;
  return {
    status: async () => ({ ready: true, shortcut: { code: 'Space', ctrl: true, alt: false, shift: false, meta: false }, label: 'Ctrl + Space', mode }),
    start(id) { starts++; job = { id, phase: 'listening' }; return job; },
    poll() { return job; },
    finish() { finishes++; job = { ...job, phase: 'done', text: 'our neighbors' }; return job; },
    cancel() { cancels++; job = { ...job, phase: 'cancelled' }; return job; },
    close() {},
    counts: () => ({ starts, finishes, cancels }),
  };
}
const key = (f, type, props = {}) => f.document.getElementById('answer').dispatchEvent(new f.window.KeyboardEvent(type, { bubbles: true, cancelable: true, key: ' ', code: 'Space', ctrlKey: true, ...props }));

const draftInput = (e, node = e.doc.nodes[1], text = 'Recovered 🌿\n  exact  ') => ({ journey: e.activeKey ?? e.doc.id, nodeId: node.id, text, base: { question: node.question, answer: node.answer }, revision: 0 });

test('draft recovery does not overwrite typing, selection or IME while its read is pending', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, 340, undefined, false, { before: e => e.writeDraft(draftInput(e)), holdDraftRead: () => gate });
  t.after(release);
  const node = f.explorer.doc.nodes[1]; f.open(node.id);
  const editor = f.document.getElementById('answer'); editor.focus();
  editor.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  f.type('answer', 'New text 日本語'); editor.setSelectionRange(2, 4);
  release();
  await until(() => f.document.getElementById('recover-draft'), 'explicit recovery choice');
  assert.equal(editor.value, 'New text 日本語'); assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 4);
  assert.equal(f.document.querySelector('[aria-label="Recovered draft"]').value, 'Recovered 🌿\n  exact  ');
  editor.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  f.document.getElementById('keep-draft').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'chosen local text persisted');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'New text 日本語');
});

test('matching draft recovery and discard are explicit and survive journey reopen', async t => {
  const f = await fixture(t, 340, undefined, true, { before: e => e.writeDraft(draftInput(e)) });
  await delay(50); const node = f.explorer.doc.nodes[1]; f.open(node.id);
  assert.equal(f.document.getElementById('answer').value, 'Recovered 🌿\n  exact  ');
  assert.equal(node.answer, '');
  f.document.getElementById('discard-draft').click();
  await until(() => f.document.getElementById('answer').value === '', 'discard restored committed answer');
  const first = f.explorer.activeKey;
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelector('.library-entry [data-action="open"]'), 'library entry');
  f.document.querySelector('.library-entry [data-action="open"]').click();
  await until(() => !f.document.getElementById('workspace').hidden, 'reopen'); await delay(50);
  f.open(node.id); assert.equal(f.explorer.activeKey, first); assert.equal(f.document.getElementById('answer').value, '');
});

test('draft writes debounce, preserve exact whitespace and flush before switching journeys', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.activeKey, node = f.explorer.doc.nodes[1];
  await f.explorer.library.import(createDocument('Second with drafts'));
  f.open(node.id); f.type('answer', ' first '); f.type('answer', '  final 🌿\n ');
  await delay(100); assert.equal((await f.explorer.readDrafts(first)).entries.length, 0);
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'entries');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('Second with drafts')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey !== first && f.document.getElementById('map-title').textContent === 'Second with drafts' && !f.document.getElementById('workspace').hidden, 'flushed switch');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'entries reopened');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('A tool library')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey === first && f.document.getElementById('map-title').textContent === 'A tool library' && !f.document.getElementById('workspace').hidden, 'first journey'); await delay(50);
  f.open(node.id); assert.equal(f.document.getElementById('answer').value, '  final 🌿\n ');
});

test('failed draft flush blocks switching and keeps text available for retry', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.activeKey, node = f.explorer.doc.nodes[1];
  await f.explorer.library.import(createDocument('Second draft failure'));
  await f.explorer.readDrafts(first); const write = f.explorer.draftStore.write;
  f.explorer.draftStore.write = async () => { throw new Error('Disk full'); };
  f.open(node.id); f.type('answer', 'Do not lose this');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library visible');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('Second draft failure')).querySelector('[data-action="open"]').click();
  await until(() => f.document.getElementById('notice').textContent.includes('Disk full'), 'failed flush');
  assert.equal(f.explorer.activeKey, first); f.document.getElementById('library-return').click();
  assert.equal(f.document.getElementById('answer').value, 'Do not lose this');
  f.explorer.draftStore.write = write; f.document.getElementById('retry-draft').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'retried');
});

test('changed committed base keeps answer and recovered draft separate until chosen', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.writeDraft(draftInput(e));
    await e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: 'New committed decision' });
  } });
  await delay(40); f.open(f.explorer.doc.nodes[1].id);
  assert.equal(f.document.getElementById('answer').value, 'New committed decision');
  assert.equal(f.document.querySelector('[aria-label="Recovered draft"]').value, 'Recovered 🌿\n  exact  ');
  f.document.getElementById('recover-draft').click();
  await until(() => f.document.getElementById('answer').value.startsWith('Recovered'), 'chosen recovery');
  assert.equal(f.explorer.doc.nodes[1].answer, 'New committed decision');
});

test('answer save captures the click text while a draft flush is still pending', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  let release, started; const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  f.pauseDraftWrite(() => { started(); return gate; }); t.after(release);
  f.type('answer', 'Clicked save'); f.click('Save answer'); await entered;
  f.type('answer', 'Typed after click'); release(); f.pauseDraftWrite(null);
  await until(() => f.explorer.doc.nodes[1].answer, 'committed captured text');
  assert.equal(f.explorer.doc.nodes[1].answer, 'Clicked save');
  assert.equal(f.document.getElementById('answer').value, 'Typed after click');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'later typing saved locally');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'Typed after click');
});

test('initial draft storage failure can be retried without losing editor text', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.readDrafts(e.doc.id); const read = e.draftStore.read.bind(e.draftStore); let fail = true;
    e.draftStore.read = () => { if (fail) { fail = false; throw new Error('Temporary read failure'); } return read(); };
  } });
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Typed despite read failure');
  await until(() => f.document.getElementById('retry-draft'), 'retry available');
  f.document.getElementById('retry-draft').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'recovery retried');
  assert.equal(f.document.getElementById('answer').value, 'Typed despite read failure');
});

test('another canvas draft stays separate and explicit conflict choices use revision checks', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; await delay(30); f.open(node.id);
  const remote = await f.explorer.writeDraft(draftInput(f.explorer, node, 'Remote writer'));
  f.type('answer', 'Local writer');
  await until(() => f.document.getElementById('keep-draft'), 'conflict discovered');
  assert.equal(f.document.getElementById('answer').value, 'Local writer');
  assert.equal(f.document.querySelector('[aria-label="Recovered draft"]').value, 'Remote writer');
  await f.explorer.writeDraft({ ...draftInput(f.explorer, node, 'Remote writer newer'), revision: remote.revision });
  f.document.getElementById('keep-draft').click();
  await until(() => f.document.getElementById('notice').textContent.includes('Another canvas'), 'stale explicit choice refused');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'Remote writer newer');
  assert.equal(f.document.getElementById('answer').value, 'Local writer');
});

test('keyboard answer save clears its draft without treating restored focus as typing', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id); const editor = f.document.getElementById('answer');
  editor.focus(); f.type('answer', 'Committed keyboard answer');
  editor.dispatchEvent(new f.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter', ctrlKey: true }));
  await until(() => f.explorer.pending?.kind === 'questions', 'keyboard answer saved');
  await delay(100);
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, null);
  assert.equal(f.document.getElementById('answer-status').textContent, 'Answer saved');
});

test('recovery based on an older state read cannot replace a newer committed answer', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, 340, undefined, false, { before: e => e.writeDraft(draftInput(e)), holdDraftRead: () => gate }); t.after(release);
  const node = f.explorer.doc.nodes[1]; f.open(node.id);
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: node.id, answer: 'Committed during recovery' });
  await until(() => f.document.getElementById('answer').value === 'Committed during recovery', 'new state');
  release(); await until(() => f.document.getElementById('recover-draft'), 'stale read choice');
  assert.equal(f.document.getElementById('answer').value, 'Committed during recovery');
});

test('failed writes permit explicit loss of unsaved editor text before a switch', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.activeKey;
  await f.explorer.library.import(createDocument('After discard'));
  await f.explorer.readDrafts(first); f.explorer.draftStore.write = async () => { throw new Error('Disk full'); };
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Explicitly abandon me');
  await until(() => f.document.getElementById('discard-unsaved-draft'), 'discard unsaved option');
  f.document.getElementById('discard-unsaved-draft').click(); await until(() => f.document.getElementById('answer').value === '', 'local discard');
  f.document.getElementById('library-toggle').click(); await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'entries');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('After discard')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey !== first, 'switch after explicit discard');
});
test('optional creation guidance is saved without carrying settings into another journey', async t => {
  const f = await fixture(t, 340, undefined, true);
  f.document.getElementById('library-toggle').click();
  const details = f.document.getElementById('start-guidance');
  assert.equal(details.open, false);
  details.open = true;
  f.type('topic', 'A shared orchard');
  f.type('start-objective', 'Decide where to plant 🌳');
  f.type('start-criteria', 'Neighbors can reach it');
  f.document.getElementById('start-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc?.topic === 'A shared orchard', 'guided journey created');
  await until(() => !f.document.getElementById('workspace').hidden && f.document.getElementById('start-objective').value === '', 'new journey rendered');
  assert.equal(f.explorer.doc.objective, 'Decide where to plant 🌳');
  assert.equal(f.explorer.doc.successCriteria, 'Neighbors can reach it');
  await f.explorer.command('cancel');
  f.document.getElementById('library-toggle').click();
  await until(() => !f.document.getElementById('welcome').hidden, 'library visible');
  assert.equal(f.document.getElementById('start-objective').value, '');
  assert.equal(f.document.getElementById('start-criteria').value, '');
});
test('guidance edit, cancel, and stale retry preserve the expanded answer draft and caret', async t => {
  const f = await fixture(t, 340), node = f.explorer.doc.nodes[1];
  f.open(node.id);
  f.type('answer', 'A local draft 🌿');
  const answer = f.document.getElementById('answer'); answer.focus(); answer.setSelectionRange(4, 4);
  f.document.getElementById('edit-guidance').click();
  assert.equal(f.document.activeElement.id, 'edit-objective');
  f.type('edit-objective', 'Discard me');
  f.document.getElementById('cancel-guidance').click();
  assert.equal(f.explorer.doc.objective, '');
  assert.equal(f.document.activeElement.id, 'edit-guidance');
  assert.equal(f.document.getElementById('answer').selectionStart, 4);
  f.document.getElementById('edit-guidance').click();
  f.type('edit-objective', 'Understand the neighbors');
  f.type('edit-criteria', 'A usable plan');
  f.document.getElementById('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.objective === 'Understand the neighbors' && !f.document.getElementById('guidance-dialog').open, 'guidance saved');
  assert.equal(f.document.getElementById('answer').value, 'A local draft 🌿');
  assert.equal(f.document.getElementById('answer').selectionStart, 4);
  assert.equal(f.document.activeElement.id, 'edit-guidance');
  assert.equal(f.document.getElementById('node-workspace').hidden, false);
  f.document.getElementById('edit-guidance').click();
  f.type('edit-objective', 'Keep this on failure');
  const second = await new Explorer({ file: f.explorer.file }).load();
  await second.command('guidance', { revision: second.doc.revision, objective: 'Another canvas', successCriteria: 'A usable plan' });
  f.document.getElementById('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => /Another canvas/.test(f.document.getElementById('guidance-error').textContent), 'stale edit rejected');
  assert.equal(f.document.getElementById('edit-objective').value, 'Keep this on failure');
  assert.equal(f.document.getElementById('guidance-dialog').open, true);
});
test('stale guidance retry refreshes an unrelated answer and preserves the local draft', async t => {
  const f = await fixture(t, 340), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'My unsaved answer');
  f.document.getElementById('edit-guidance').click();
  f.type('edit-objective', 'My objective');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('answer', { revision: other.doc.revision, nodeId: node.id, answer: 'Other saved answer' });
  const form = f.document.getElementById('guidance-form');
  form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !f.document.getElementById('refresh-guidance').hidden, 'refresh offered');
  f.document.getElementById('refresh-guidance').click();
  await until(() => f.explorer.doc.nodes[1].answer === 'Other saved answer' && f.document.getElementById('refresh-guidance').hidden, 'latest answer loaded');
  assert.equal(f.document.getElementById('edit-objective').value, 'My objective');
  assert.equal(f.document.getElementById('guidance-conflict').hidden, true);
  form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.objective === 'My objective' && !f.document.getElementById('guidance-dialog').open, 'retry saved');
  assert.equal(f.explorer.doc.nodes[1].answer, 'Other saved answer');
  assert.equal(f.document.getElementById('answer').value, 'My unsaved answer');
});
test('stale guidance retry requires an explicit choice before replacing changed guidance', async t => {
  const f = await fixture(t, 340);
  f.document.getElementById('edit-guidance').click();
  f.type('edit-objective', 'My objective');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: 'Other objective', successCriteria: 'Other criterion' });
  const form = f.document.getElementById('guidance-form');
  form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !f.document.getElementById('refresh-guidance').hidden, 'refresh offered');
  f.document.getElementById('refresh-guidance').click();
  await until(() => !f.document.getElementById('guidance-conflict').hidden, 'conflict choice shown');
  assert.equal(f.document.getElementById('edit-objective').value, 'My objective');
  assert.equal(f.explorer.doc.objective, 'Other objective');
  assert.equal(f.document.getElementById('save-guidance').disabled, true);
  f.document.getElementById('keep-guidance-edits').click();
  assert.equal(f.document.getElementById('save-guidance').disabled, false);
  form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.objective === 'My objective' && !f.document.getElementById('guidance-dialog').open, 'explicit overwrite saved');
  assert.equal(f.explorer.doc.successCriteria, '');
});

test('one conflicting node does not prevent other nodes from saving drafts', async t => {
  const f = await fixture(t), [first, second] = f.explorer.doc.nodes.slice(1); await delay(30);
  await f.explorer.writeDraft(draftInput(f.explorer, first, 'Other canvas'));
  f.open(first.id); f.type('answer', 'Conflicting local text');
  await until(() => f.document.getElementById('keep-draft'), 'first conflict');
  f.open(second.id); f.type('answer', 'Independent draft');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'second persisted independently');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries.find(e => e.nodeId === second.id).text, 'Independent draft');
});

test('discarding failed editor changes keeps the previous persisted draft visible', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id); f.type('answer', 'Previously persisted');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'initial save');
  f.explorer.draftStore.write = async () => { throw new Error('Disk full'); }; f.type('answer', 'Failed later edit');
  await until(() => f.document.getElementById('discard-unsaved-draft'), 'failure option');
  f.document.getElementById('discard-unsaved-draft').click();
  await until(() => f.document.querySelector('[aria-label="Recovered draft"]'), 'previous persisted draft still visible');
  assert.equal(f.document.getElementById('answer').value, '');
  assert.equal(f.document.querySelector('[aria-label="Recovered draft"]').value, 'Previously persisted');
  f.document.getElementById('finish').click();
  await until(() => f.document.getElementById('notice').textContent.includes('Save your draft'), 'finish still honest');
  assert.equal(f.explorer.doc.finishedAt, null);
});

test('dictated text and recommendation undo persist without committing an answer', async t => {
  const f = await fixture(t, 340, voiceFixture()), node = f.explorer.doc.nodes[1]; f.open(node.id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'voice ready');
  f.document.getElementById('answer').focus(); key(f, 'keydown');
  await until(() => /^Listening/.test(f.document.getElementById('voice-status').textContent), 'listening'); key(f, 'keyup');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'dictation persisted');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'our neighbors');
  f.click('Research options'); await until(() => f.explorer.pending?.kind === 'research', 'research pending');
  f.resolveResearch(findings); await until(() => f.document.getElementById('use-recommendation'), 'recommendation ready');
  f.document.getElementById('use-recommendation').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'addition persisted');
  assert.match((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, /Try a small pilot/);
  f.document.getElementById('undo-addition').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'undo persisted');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'our neighbors');
  assert.equal(f.explorer.doc.nodes[1].answer, '');
});

test('Ctrl+Space dictates only into a focused answer, at the selection, without saving', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice), node = f.explorer.doc.nodes[1];
  f.open(node.id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'voice settings');
  key(f, 'keydown'); await delay(20); assert.equal(voice.counts().starts, 0, 'answer must own focus');
  const answer = f.document.getElementById('answer'); answer.focus();
  f.type('answer', 'For everyone nearby.'); answer.setSelectionRange(4, 12);
  key(f, 'keydown', { altKey: true }); await delay(10); assert.equal(voice.counts().starts, 0, 'exact modifiers');
  key(f, 'keydown'); key(f, 'keydown', { repeat: true });
  await until(() => /^Listening/.test(f.document.getElementById('voice-status').textContent), 'listening');
  assert.equal(voice.counts().starts, 1);
  key(f, 'keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false });
  await until(() => answer.value.includes('our neighbors'), 'dictated draft');
  assert.equal(answer.value, 'For our neighbors nearby.'); assert.equal(node.answer, '');
  assert.match(f.document.getElementById('answer-status').textContent, /Saving draft|Draft saved locally/);
  assert.equal(voice.counts().finishes, 1);
});

test('typing, Escape and focus loss cancel dictation without overwriting a draft', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'settings');
  const answer = f.document.getElementById('answer'); answer.focus();
  key(f, 'keydown'); await until(() => voice.counts().starts === 1, 'start');
  f.type('answer', 'Keep my edit'); await until(() => voice.counts().cancels === 1, 'edit cancels');
  key(f, 'keyup'); await delay(30); assert.equal(answer.value, 'Keep my edit');
  key(f, 'keydown'); await until(() => voice.counts().starts === 2, 'restart');
  key(f, 'keydown', { key: 'Escape', code: 'Escape', ctrlKey: false });
  await until(() => voice.counts().cancels === 2, 'escape cancels');
  assert.equal(f.document.getElementById('node-workspace').hidden, false, 'escape cancels before collapsing');
  key(f, 'keydown'); await until(() => voice.counts().starts === 3, 'restart');
  answer.blur(); await until(() => voice.counts().cancels === 3, 'blur cancels');
  assert.equal(voice.counts().finishes, 0);
});

test('toggle dictation ignores key release and finishes with the same configured shortcut', async t => {
  const voice = voiceFixture('toggle'), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Press Ctrl'), 'toggle settings');
  const answer = f.document.getElementById('answer'); answer.focus(); key(f, 'keydown');
  await until(() => /^Listening/.test(f.document.getElementById('voice-status').textContent), 'listening');
  key(f, 'keyup'); await delay(20); assert.equal(voice.counts().finishes, 0);
  key(f, 'keydown'); await until(() => answer.value === 'our neighbors', 'toggle finish');
});

test('a late dictation result cannot cross into another question', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice), [a, b] = f.explorer.doc.nodes.slice(1);
  f.open(a.id); await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'settings');
  f.document.getElementById('answer').focus(); key(f, 'keydown'); await until(() => voice.counts().starts === 1, 'start');
  f.open(b.id); f.type('answer', 'Another answer'); voice.finish();
  await delay(400); assert.equal(f.document.getElementById('answer').value, 'Another answer');
  f.open(a.id); assert.equal(f.document.getElementById('answer').value, '');
});

test('dictation respects the answer length limit without losing the existing draft', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'settings');
  const answer = f.document.getElementById('answer'), previous = 'a'.repeat(20000);
  answer.focus(); f.type('answer', previous); answer.setSelectionRange(previous.length, previous.length);
  key(f, 'keydown'); await until(() => /^Listening/.test(f.document.getElementById('voice-status').textContent), 'listening');
  key(f, 'keyup'); await until(() => f.document.getElementById('voice-status').textContent.includes('exceed'), 'limit explained');
  assert.equal(answer.value, previous); assert.equal(f.explorer.doc.nodes[1].answer, '');
});

test('voice settings list local choices, save independently and retain unsaved choices across nodes', async t => {
  const voice = voiceFixture(); let saved, reads = 0;
  const options = { ...(await voice.status()), preferences: { revision: 0, microphone: 'Disconnected mic', model: 'copilot' }, copilotModel: 'Nemotron English',
    microphones: [{ name: 'USB microphone', supported: true }],
    models: [{ id: 'english', label: 'Nemotron English', supported: true }, { id: 'whisper', label: 'Whisper', supported: false, reason: 'Unsupported format' }] };
  voice.options = async () => { reads++; return options; };
  voice.configure = async input => { saved = input; options.preferences = { ...input, revision: input.revision + 1 }; return options; };
  const f = await fixture(t, 340, voice), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  const disclosure = f.document.getElementById('voice-settings'); assert.ok(disclosure);
  disclosure.open = true;
  await until(() => f.document.querySelector('#voice-microphone option[value="USB microphone"]'), 'device choices');
  assert.match(f.document.querySelector('#voice-microphone option:checked').textContent, /Unavailable/);
  assert.equal(f.document.querySelector('#voice-model option[value="whisper"]').disabled, true);
  const mic = f.document.getElementById('voice-microphone'); mic.value = 'USB microphone'; mic.dispatchEvent(new f.window.Event('change'));
  f.open(b.id);
  assert.equal(f.document.getElementById('voice-settings').open, true);
  assert.equal(f.document.getElementById('voice-microphone').value, 'USB microphone');
  f.click('Save voice settings'); await until(() => saved, 'saved settings');
  assert.deepEqual(saved, { microphone: 'USB microphone', model: 'copilot', revision: 0 });
  await until(() => !f.document.getElementById('voice-refresh').disabled, 'save finishes');
  f.click('Refresh devices and models'); await until(() => reads === 2, 'refresh');
  assert.equal(f.explorer.doc.nodes.every(n => !n.answer), true, 'settings do not submit an answer');
});

test('voice bar distinguishes loading, measured audio, silence, transcription and cancellation', async t => {
  const voice = voiceFixture(); let phase = 'loading', levels = [], elapsedMs = 0, id;
  voice.start = recordingId => { id = recordingId; return { id, phase }; };
  voice.poll = () => ({ id, phase, levels, elapsedMs });
  voice.finish = () => { phase = 'transcribing'; return { id, phase }; };
  const f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'settings');
  const bar = f.document.getElementById('voice-feedback'); assert.ok(bar); assert.equal(bar.hidden, true);
  f.document.getElementById('answer').focus(); key(f, 'keydown');
  await until(() => bar.dataset.phase === 'loading', 'loading'); assert.equal(bar.hidden, false);
  phase = 'listening'; levels = [0, .5, 1]; elapsedMs = 2100;
  await until(() => bar.dataset.phase === 'listening', 'listening');
  const bars = [...bar.querySelectorAll('.voice-level')]; assert.equal(bars.length, 24);
  await until(() => bars.at(-1).style.height === '28px', 'measured levels arrive');
  assert.equal(bars.at(-1).style.height, '28px'); assert.equal(bars.at(-2).style.height, '15px');
  assert.equal(bar.querySelector('.voice-elapsed').textContent, '0:02');
  levels = [0, 0];
  await until(() => [...bar.querySelectorAll('.voice-level')].every(b => b.style.height === '2px'), 'silence is flat');
  key(f, 'keyup'); await until(() => bar.dataset.phase === 'transcribing', 'transcription');
  key(f, 'keydown', { key: 'Escape', code: 'Escape', ctrlKey: false }); assert.equal(bar.hidden, true);
});
