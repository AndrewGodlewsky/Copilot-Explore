import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { layout } from '../com.github.copilot/extensions/explorer/web/layout.mjs';

const findings = { basis: 'reasoning', summary: 'Two possible ways forward.', options: [
  { title: 'One block', description: 'Start with the nearest neighbors.', pros: ['Easy handovers'], cons: ['Fewer tools'] },
  { title: 'Whole neighborhood', description: 'Invite everyone nearby.', pros: ['More tools'], cons: ['More coordination'] },
], recommendation: 'Try a small pilot.', uncertainty: 'No external sources consulted.', sources: [] };

async function until(read, label) {
  for (let i = 0; i < 250; i++) { const result = read(); if (result) return result; await delay(10); }
  assert.fail('Timed out: ' + label);
}

async function fixture(t, width = 1100) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-dom-'));
  const explorer = await new Explorer({ file: join(dir, 'map.explore.json'), send: async () => {}, target: { instanceId: 'dom-test' } }).load();
  await explorer.command('start', { topic: 'A tool library' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [
    { category: 'People', question: 'Who should borrow first?' }, { category: 'Trust', question: 'What if a tool breaks?' },
  ] });
  const server = await startServer(explorer);
  const dom = new JSDOM(await (await fetch(server.url)).text(), { url: server.url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  t.after(async () => { dom.window.close(); await server.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  const map = document.getElementById('map');
  // jsdom has no visual layout. Only geometry inputs are stubbed; DOM events,
  // the shipped app, HTTP server, controller, persistence and callbacks are real.
  map.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: 720, width, height: 720 });
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { get() { return parseFloat(this.style.width) || (this.id === 'map' ? width : 220); } },
    offsetHeight: { get() { return this.id === 'node-workspace' ? 540 : 110; } },
  });
  let captures = 0, holdAnswer = null;
  map.setPointerCapture = () => { captures++; };
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() });
  window.fetch = async (path, options) => {
    if (holdAnswer && options?.body && JSON.parse(options.body).action === 'answer') await holdAnswer();
    return fetch(new URL(path, server.url), options);
  };
  window.layout = layout;
  const script = await readFile(new URL('../com.github.copilot/extensions/explorer/web/app.mjs', import.meta.url), 'utf8');
  window.eval(script.replace("import { layout } from './layout.mjs';", ''));
  await until(() => document.querySelectorAll('#nodes button').length >= 3, 'initial map');
  const open = id => {
    const question = explorer.doc.nodes.find(n => n.id === id).question;
    const button = [...document.querySelectorAll('#nodes button')].find(b => b.title === question);
    assert.ok(button, 'compact node exists: ' + question); button.click();
  };
  const type = (id, value) => { const e = document.getElementById(id); assert.ok(e, id); e.value = value; e.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = text => { const b = [...document.querySelectorAll('#node-workspace button')].find(e => e.textContent === text); assert.ok(b, text); b.click(); };
  return { explorer, window, document, open, type, click, captures: () => captures, pauseAnswer: fn => { holdAnswer = fn; } };
}

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
  await f.explorer.receive('research', { requestId: f.explorer.pending.id, research: findings });
  await until(() => f.document.querySelector('#node-workspace .option'), 'research delivered');
  assert.equal(f.document.getElementById('answer').value, 'My own thought, still editing');
  assert.match(f.document.getElementById('node-workspace').textContent, /not externally verified/);
  f.click('Add to my answer');
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
  assert.match(f.document.getElementById('answer-status').textContent, /Unsaved/);
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
