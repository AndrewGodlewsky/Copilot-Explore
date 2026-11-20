import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { ProjectModeClient } from '../com.github.copilot/extensions/explorer/web/project-mode-client.mjs';
import { waitFor } from './helpers/wait-for.mjs';

async function fixture(t) {
  const dom = new JSDOM(await readFile('com.github.copilot/extensions/explorer/web/index.html', 'utf8'), { pretendToBeVisual: true });
  const { window } = dom, $ = id => window.document.getElementById(id), requests = []; let journey = 'journey-a', active = true, intercept, now = 0;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const reply = input => ({ ...input, state: input.action === 'prepare' ? 'review' : input.action === 'approve' ? 'active' : 'off',
    project: { name: '<script>project 🌿</script>', root: 'C:/synthetic/project' }, scope: input.action === 'status' || input.action === 'disable' ? null : { files: [{ name: 'notes.md', bytes: 32 }], bytes: 32 },
    ...(input.action === 'prepare' ? { token: randomUUID() } : {}), message: input.action === 'approve' ? 'Scope ready; project brief required.' : '' });
  const fetch = async (_, options) => { const input = JSON.parse(options.body); requests.push(input); const value = intercept ? await intercept(input) : reply(input); return { ok: true, json: async () => value }; };
  const client = new ProjectModeClient({ $, fetch, journey: () => journey, active: () => active, now: () => now });
  t.after(() => { client.suspend(); dom.window.close(); });
  return { $, window, client, requests, reply, tick: (milliseconds = 10000) => { now += milliseconds; return client.checkStatus(); }, setJourney: value => { journey = value; }, setActive: value => { active = value; }, intercept: value => { intercept = value; } };
}

test('project scope dialog reviews exact paths/purpose, enables only after review and renders project names literally', async t => {
  const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => f.requests.length && !f.client.loading);
  assert.equal(f.$('project-mode-dialog').open, true); assert.equal(f.$('project-mode-approve').disabled, true);
  assert.equal(f.$('project-mode-project').textContent, 'C:/synthetic/project'); assert.equal(f.$('project-mode-project').querySelector('script'), null);
  f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-paths').dispatchEvent(new f.window.Event('input'));
  f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
  assert.deepEqual(f.requests.find(r => r.action === 'prepare').paths, ['notes.md']); assert.equal(f.requests.at(-1).purpose, 'project-questions');
  f.$('project-mode-approve').click(); await waitFor(() => f.client.value?.state === 'active');
  assert.equal(f.$('project-mode-indicator').hidden, false); assert.match(f.$('project-mode-indicator-text').textContent, /scope ready|Scope ready/);
  f.$('project-mode-close').click(); assert.equal(f.$('project-mode-dialog').open, false); assert.equal(f.window.document.activeElement.id, 'navigation-open');
});

test('editing invalidates the preview; closing ignores late replies and keeps an editable path draft', async t => {
  const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
  f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
  f.$('project-mode-paths').value = 'new.md'; f.$('project-mode-paths').dispatchEvent(new f.window.Event('input'));
  assert.equal(f.$('project-mode-approve').disabled, true);
  let release; f.intercept(input => input.action === 'prepare' ? new Promise(resolve => { release = () => resolve(f.reply(input)); }) : f.reply(input));
  f.$('project-mode-prepare').click(); await waitFor(() => release); f.$('project-mode-close').click(); release(); await new Promise(setImmediate);
  assert.equal(f.$('project-mode-dialog').open, false); assert.equal(f.client.value?.token, undefined); assert.equal(f.$('project-mode-paths').value, 'new.md');
});

test('journey changes and suspension discard scope display and reject delayed approvals', async t => {
  for (const change of ['journey', 'suspend']) {
    const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
    f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
    let release; f.intercept(input => input.action === 'approve' ? new Promise(resolve => { release = () => resolve(f.reply(input)); }) : f.reply(input));
    f.$('project-mode-approve').click(); await waitFor(() => release);
    if (change === 'journey') { f.setJourney('journey-b'); f.client.observe(); } else { f.client.suspend(); f.setActive(false); }
    release(); await new Promise(setImmediate); assert.equal(f.$('project-mode-indicator').hidden, true); assert.equal(f.$('project-mode-dialog').open, false);
  }
});

test('closing or editing during approval explicitly revokes scope instead of accepting a late success', async t => {
  for (const change of ['close', 'edit']) {
    const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
    f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
    let release; f.intercept(input => input.action === 'approve' ? new Promise(resolve => { release = () => resolve(f.reply(input)); }) : f.reply(input));
    f.$('project-mode-approve').click(); await waitFor(() => release);
    if (change === 'close') f.$('project-mode-close').click();
    else { f.$('project-mode-paths').value = 'other.md'; f.$('project-mode-paths').dispatchEvent(new f.window.Event('input')); }
    assert.equal(f.requests.at(-1).action, 'disable'); release(); await new Promise(setImmediate);
    assert.equal(f.$('project-mode-indicator').hidden, true); assert.equal(f.$('project-mode-approve').disabled, true);
  }
});

test('failed scope status remains uncertain with disable available and background reconciliation resumes', async t => {
  const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
  f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
  f.$('project-mode-approve').click(); await waitFor(() => f.client.value?.state === 'active'); f.$('project-mode-close').click();
  f.intercept(() => { throw Error('Connection lost'); }); f.tick(); await waitFor(() => !f.client.loading);
  assert.equal(f.client.value.state, 'uncertain'); assert.equal(f.$('project-mode-indicator').hidden, false);
  assert.match(f.$('project-mode-settings-status').textContent, /uncertain|unavailable/i); assert.equal(f.$('project-mode-disable').disabled, false);
  f.intercept(input => ({ ...f.reply(input), state: 'active', scope: { files: [{ name: 'notes.md', bytes: 32 }], bytes: 32 } }));
  f.tick(); await waitFor(() => f.client.value?.state === 'active'); assert.equal(f.$('project-mode-indicator').hidden, false);
  f.intercept(input => f.reply(input)); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
  assert.equal(f.client.value.state, 'off'); assert.equal(f.$('project-mode-indicator').hidden, true);
});

test('an unacknowledged disable keeps uncertainty until the server confirms off', async t => {
  const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
  f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
  f.$('project-mode-approve').click(); await waitFor(() => f.client.value?.state === 'active');
  f.intercept(() => { throw Error('Lost response'); }); f.$('project-mode-disable').click(); await waitFor(() => !f.client.loading);
  assert.equal(f.client.value.state, 'uncertain'); assert.equal(f.$('project-mode-disable').disabled, false);
  f.intercept(input => f.reply(input)); f.$('project-mode-disable').click(); await waitFor(() => !f.client.loading);
  assert.equal(f.client.value.state, 'off'); assert.equal(f.$('project-mode-indicator').hidden, true);
});

test('lost best-effort disable replies stay uncertain after close or edit and a fresh request can recover', async t => {
  for (const change of ['close', 'edit']) {
    const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
    f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
    let release; f.intercept(input => {
      if (input.action === 'approve') return new Promise(resolve => { release = () => resolve(f.reply(input)); });
      throw Error('Lost disable reply');
    });
    f.$('project-mode-approve').click(); await waitFor(() => release);
    if (change === 'close') f.$('project-mode-close').click();
    else f.$('project-mode-paths').dispatchEvent(new f.window.Event('input'));
    release(); await new Promise(setImmediate);
    assert.equal(f.client.value.state, 'uncertain'); assert.equal(f.client.value.token, undefined);
    assert.equal(f.$('project-mode-indicator').hidden, false); assert.equal(f.$('project-mode-disable').disabled, false);
    f.intercept(input => f.reply(input));
    if (change === 'close') f.tick(); else f.$('project-mode-disable').click();
    await waitFor(() => f.client.value?.state === 'off');
  }
});

test('returning after suspension reconciles with a new client even if best-effort disable failed', async t => {
  const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
  f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
  f.$('project-mode-approve').click(); await waitFor(() => f.client.value?.state === 'active');
  const oldClient = f.client.clientId;
  f.intercept(() => { throw Error('Disconnected'); }); f.client.suspend(); await new Promise(setImmediate);
  assert.equal(f.$('project-mode-indicator').hidden, true); assert.notEqual(f.client.clientId, oldClient);
  f.client.resume(); await waitFor(() => !f.client.loading);
  assert.equal(f.client.value.state, 'uncertain'); assert.equal(f.$('project-mode-indicator').hidden, false);
  f.intercept(input => f.reply(input)); f.tick(); await waitFor(() => f.client.value?.state === 'off');
  assert.equal(f.requests.at(-1).clientId, f.client.clientId);
});

test('shared polling checks scope at most every ten seconds and does no work while suspended', async t => {
  const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
  f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
  f.$('project-mode-approve').click(); await waitFor(() => f.client.value?.state === 'active'); f.$('project-mode-close').click();
  f.intercept(input => ({ ...f.reply(input), state: 'active', scope: { files: [{ name: 'notes.md', bytes: 32 }], bytes: 32 } }));
  await f.tick(); const count = f.requests.length;
  await f.tick(0); await f.tick(9999); assert.equal(f.requests.length, count);
  await f.tick(1); assert.equal(f.requests.length, count + 1);
  f.client.suspend(); const pausedCount = f.requests.length;
  await f.tick(); assert.equal(f.requests.length, pausedCount);
});
