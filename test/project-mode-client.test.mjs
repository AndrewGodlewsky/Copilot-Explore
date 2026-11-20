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
    project: { name: '<script>project 🌿</script>', root: 'C:/synthetic/project' }, scope: ['status', 'disable', 'discover'].includes(input.action) ? null : { files: [{ name: 'notes.md', bytes: 32 }], bytes: 32 },
    ...(input.action === 'prepare' ? { token: randomUUID() } : {}), ...(input.action === 'approve' ? { readToken: randomUUID() } : {}), message: input.action === 'approve' ? 'Scope ready; project brief required.' : '' });
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

test('discovery stays unselected, supports bounded selection and manual Unicode paths, and reads only by explicit action', async t => {
  const f = await fixture(t), names = ['README.md', 'package.json', 'src/main.ts', 'docs/design.md', 'docs/setup.md', 'docs/extra.md'];
  const receipt = { id: randomUUID(), capturedAt: '2026-11-20T12:00:00.000Z', sources: [{ name: 'notes.md', bytes: 32, excerptBytes: 32, fingerprint: 'abc123', truncated: false, excerpt: '<script>literal 🌿</script>\r\n' }] };
  f.intercept(input => ({ ...f.reply(input), ...(input.action === 'discover' ? { inventory: { candidates: names.map(name => ({ name, bytes: 32, reason: 'Documentation' })), skipped: [{ name: 'dist', reason: 'Generated content' }], examined: 9, directories: 2, truncated: true } } : {}),
    ...(input.action === 'read' ? { state: 'active', receipt } : {}) }));
  f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
  f.$('project-mode-discover').click(); await waitFor(() => !f.client.loading);
  assert.equal(f.$('project-mode-paths').value, ''); assert.equal(f.requests.some(r => r.action === 'read'), false);
  const boxes = () => [...f.$('project-mode-candidates').querySelectorAll('input')]; assert.equal(boxes().length, 6);
  assert.match(f.$('project-mode-discovery-summary').textContent, /limit|partial/i);
  for (let i = 0; i < 5; i++) { boxes()[i].click(); await new Promise(setImmediate); }
  boxes()[5].click(); assert.equal(f.$('project-mode-paths').value.split('\n').length, 5); assert.equal(boxes()[5].checked, false);
  boxes()[0].click(); await new Promise(setImmediate); assert.equal(boxes().length, 6, 'disabling stale scope retains metadata suggestions');
  f.$('project-mode-paths').value = ' notes 🌿.md'; f.$('project-mode-paths').dispatchEvent(new f.window.Event('input'));
  f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
  assert.deepEqual(f.requests.at(-1).paths, [' notes 🌿.md']); assert.deepEqual(f.requests.at(-1).exclusions, []);
  f.$('project-mode-approve').click(); await waitFor(() => !!f.client.value?.readToken);
  assert.equal(f.requests.some(r => r.action === 'read'), false);
  f.$('project-mode-read').click(); await waitFor(() => !!f.client.value?.receipt);
  assert.equal(f.window.document.activeElement.id, 'project-mode-receipt-title');
  assert.match(f.$('project-mode-receipt').textContent, /abc123/); assert.match(f.$('project-mode-receipt').textContent, /<script>literal 🌿<\/script>/);
  assert.equal(f.$('project-mode-receipt').querySelector('script'), null); assert.equal(f.$('project-mode-read').disabled, true);
  f.$('project-mode-exclusions').value = 'docs/'; f.$('project-mode-exclusions').dispatchEvent(new f.window.Event('input'));
  assert.equal(f.$('project-mode-receipt').textContent, ''); assert.equal(boxes().length, 0);
  f.$('project-mode-discover').click(); await waitFor(() => !f.client.loading); assert.deepEqual(f.requests.at(-1).exclusions, ['docs/']);
});

test('closing a pending read revokes it and rejects its late receipt; failed reconciliation hides captured text', async t => {
  const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
  f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
  f.$('project-mode-approve').click(); await waitFor(() => !!f.client.value?.readToken);
  let release; f.intercept(input => input.action === 'read' ? new Promise(resolve => { release = () => resolve({ ...f.reply(input), state: 'active', receipt: { id: randomUUID(), sources: [{ excerpt: 'private capture' }] } }); }) : f.reply(input));
  f.$('project-mode-read').click(); await waitFor(() => release); f.$('project-mode-close').click();
  assert.equal(f.requests.at(-1).action, 'disable'); release(); await new Promise(setImmediate);
  assert.equal(f.$('project-mode-receipt').textContent, ''); assert.equal(f.client.value?.readToken, undefined);
  f.client.value = { ...f.client.value, state: 'active', readToken: randomUUID(), receipt: { id: randomUUID(), sources: [] } };
  f.intercept(() => { throw Error('Disconnected'); }); await f.client.request('status');
  assert.equal(f.client.value.state, 'uncertain'); assert.equal(f.client.value.receipt, undefined); assert.equal(f.client.value.readToken, undefined);
});

test('lost revocation after editing paths or exclusions cannot restore old read tokens or excerpts', async t => {
  for (const edited of ['paths', 'exclusions']) {
    const f = await fixture(t); f.$('project-mode-open').click(); await waitFor(() => !f.client.loading);
    f.$('project-mode-paths').value = 'notes.md'; f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token);
    f.$('project-mode-approve').click(); await waitFor(() => !!f.client.value?.readToken);
    const old = structuredClone(f.client.value); let loseDisable = true;
    f.intercept(input => {
      if (input.action === 'disable' && loseDisable) throw Error('Lost disable request');
      return input.action === 'status' ? { ...old, ...input, receipt: { id: randomUUID(), sources: [] } } : f.reply(input);
    });
    f.$(`project-mode-${edited}`).value = edited === 'paths' ? 'new.md' : 'notes.md';
    f.$(`project-mode-${edited}`).dispatchEvent(new f.window.Event('input')); await new Promise(setImmediate);
    await f.client.request('status'); assert.equal(f.client.value.state, 'uncertain'); assert.equal(f.client.value.readToken, undefined); assert.equal(f.client.value.receipt, undefined);
    assert.equal(f.$('project-mode-read').disabled, true); assert.equal(f.$(`project-mode-${edited}`).value, edited === 'paths' ? 'new.md' : 'notes.md');
    f.$('project-mode-prepare').click(); await waitFor(() => !!f.client.value?.token); assert.equal(f.client.value.state, 'review', 'an explicit new review can replace revoked scope');
    f.$('project-mode-approve').click(); await waitFor(() => !!f.client.value?.readToken);
    f.$(`project-mode-${edited}`).dispatchEvent(new f.window.Event('input')); await new Promise(setImmediate);
    loseDisable = false; await f.client.request('disable'); assert.equal(f.client.value.state, 'off');
  }
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
