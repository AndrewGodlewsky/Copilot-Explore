import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { ChangeSummaryClient } from '../com.github.copilot/extensions/explorer/web/change-summary-client.mjs';

const html = await readFile(new URL('../com.github.copilot/extensions/explorer/web/index.html', import.meta.url), 'utf8');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 400; i++) { if (check()) return; await delay(5); } throw Error('Summary UI did not settle.'); }
async function fixture(t) {
  const dom = new JSDOM(html, { url: 'http://127.0.0.1/', pretendToBeVisual: true }), { window } = dom, { document } = window;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  t.after(() => { client.close(false); window.close(); });
  const $ = id => document.getElementById(`change-summary-${id}`), calls = [], copies = [], downloads = [];
  let active = true, state = { document: { id: 'journey', rootId: 'root', createdAt: '2026-11-18T12:00:00.000Z', revision: 2 }, storage: { scope: 'personal' } }, copyError = false;
  const row = revision => ({ revision, hash: String(revision + 1).repeat(64), time: '2026-11-18T12:00:00.000Z', label: `Saved ${revision}` });
  const normal = async input => {
    const base = { journey: input.journey, revision: input.revision };
    if (input.action === 'list') return { ...base, current: row(input.revision), entries: [row(1), row(0)], gitAvailable: state.storage.scope === 'project', path: state.storage.path ?? null };
    if (input.action === 'check') return { ...base, token: input.token, valid: true };
    if (input.action === 'cancel') return { ...base, cancelled: true };
    return { ...base, token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expiresAt: Date.now() + 60000, selection: input.selection,
      sources: { before: input.selection.kind === 'git' ? { kind: 'git', ref: input.selection.ref, commit: 'a'.repeat(40), digest: 'b'.repeat(64) } : { kind: 'saved', revision: input.selection.before, digest: 'b'.repeat(64) }, after: { kind: 'saved', revision: input.selection.after ?? input.revision, digest: 'c'.repeat(64) }, path: state.storage.path ?? null },
      markdown: '# Changes\n\nBefore → after λ', coverage: 'Saved-only fixture; private drafts excluded.', bytes: 30, limit: 2 * 1024 * 1024 };
  };
  let handler = normal;
  const client = new ChangeSummaryClient({ $: id => document.getElementById(id), state: () => state, active: () => active, canAct: () => true,
    fetch: async (url, options) => { assert.equal(url, 'api/change-summary'); const input = JSON.parse(options.body); calls.push(input); const value = await handler(input); return { ok: !value.error, json: async () => value }; },
    copyText: async text => { if (copyError) throw Error('Clipboard unavailable'); copies.push(text); }, downloadText: async text => downloads.push(text) });
  const input = (id, value, event = 'input') => { $(id).value = value; $(id).dispatchEvent(new window.Event(event, { bubbles: true })); };
  const open = async () => { $('open').click(); await until(() => !$('refresh').disabled); };
  const generate = async () => { input('before', '0', 'change'); $('generate').click(); await until(() => !$('copy').disabled); };
  const hold = action => {
    let release, entered; const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { entered = resolve; }), previous = handler;
    handler = async value => { const result = await previous(value); if (value.action === action) { entered(); await gate; } return result; };
    return { release, seen };
  };
  const editor = document.createElement('textarea'); editor.id = 'private-answer-fixture'; editor.value = 'Private answer draft λ'; document.body.append(editor); editor.focus(); editor.setSelectionRange(2, 8);
  return { client, $, input, open, generate, hold, calls, copies, downloads, editor, document, window, state: () => state,
    setState: value => { state = value; client.update(); }, inactive: () => { active = false; client.close(false); }, handler: value => { handler = value; }, normal, copyError: () => { copyError = true; } };
}

test('change summary UI requires selection, previews exact identities and explicitly copies/downloads locally edited Markdown', async t => {
  const f = await fixture(t); await f.open(); assert.deepEqual(f.calls.map(x => x.action), ['list']); assert.equal(f.$('generate').disabled, true);
  await f.generate(); assert.match(f.$('sources').textContent, /bbbbbbbbbbbb/); assert.match(f.$('coverage').textContent, /private drafts excluded/);
  f.input('text', '# My edited summary λ'); f.$('copy').click(); await until(() => f.copies.length === 1);
  f.$('download').click(); await until(() => f.downloads.length === 1);
  assert.equal(f.copies[0], '# My edited summary λ'); assert.equal(f.downloads[0], f.copies[0]);
  assert.equal(f.calls.filter(x => x.action === 'check').length, 2); assert.doesNotMatch(JSON.stringify(f.calls), /My edited summary|Private answer draft/);
  assert.match(f.$('status').textContent, /Download requested/); assert.match(f.$('status').textContent, /unknown/);
  f.$('close').click(); assert.equal(f.editor.value, 'Private answer draft λ'); assert.equal(f.editor.selectionStart, 2); assert.equal(f.editor.selectionEnd, 8);
});

test('change summary UI invalidates saved and selection changes while preserving edited text, selection and private answer', async t => {
  const f = await fixture(t); await f.open(); await f.generate(); f.input('text', 'Keep edited Markdown'); f.$('text').focus(); f.$('text').setSelectionRange(2, 7);
  const changed = structuredClone(f.state()); changed.document.revision++; f.setState(changed);
  assert.equal(f.$('copy').disabled, true); assert.equal(f.$('download').disabled, true); assert.equal(f.$('text').value, 'Keep edited Markdown'); assert.equal(f.$('text').selectionStart, 2); assert.equal(f.$('text').selectionEnd, 7);
  assert.match(f.$('status').textContent, /changed|stale/i); assert.equal(f.calls.filter(x => x.action === 'preview').length, 1);
  f.$('refresh').click(); await until(() => !f.$('refresh').disabled); await f.generate(); f.input('after', '1', 'change');
  assert.equal(f.$('copy').disabled, true); assert.equal(f.editor.value, 'Private answer draft λ');
});

test('change summary UI exposes project Git selection explicitly and never generates on mode changes', async t => {
  const f = await fixture(t); const project = structuredClone(f.state()); project.storage = { scope: 'project', path: 'maps/shared.explore.json' }; f.setState(project);
  await f.open(); f.input('mode', 'git', 'change'); f.input('ref', 'comparison'); assert.equal(f.calls.filter(x => x.action === 'preview').length, 0);
  f.$('generate').click(); await until(() => !f.$('copy').disabled);
  assert.deepEqual(f.calls.find(x => x.action === 'preview').selection, { kind: 'git', ref: 'comparison' }); assert.match(f.$('sources').textContent, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});

for (const event of ['input', 'compositionstart']) test(`change summary UI preserves ${event} edits and caret during delayed generation`, async t => {
  const f = await fixture(t); await f.open(); f.input('text', 'Text present before generation');
  const held = f.hold('preview'); f.input('before', '0', 'change'); f.$('generate').click(); await held.seen;
  f.input('text', 'Authored during slow generation', event); f.$('text').focus(); f.$('text').setSelectionRange(2, 7);
  held.release(); await until(() => !f.$('generate').disabled);
  assert.equal(f.$('text').value, 'Authored during slow generation');
  assert.equal(f.$('text').selectionStart, 2); assert.equal(f.$('text').selectionEnd, 7);
  assert.equal(f.$('copy').disabled, true); assert.equal(f.$('download').disabled, true);
  assert.match(f.$('status').textContent, /changed while generating/i);
  assert.equal(f.calls.filter(x => x.action === 'cancel').length, 1);
  assert.equal(f.calls.find(x => x.action === 'cancel').token, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.deepEqual(f.copies, []); assert.deepEqual(f.downloads, []);
  f.handler(f.normal); f.$('generate').click(); await until(() => !f.$('copy').disabled);
  assert.match(f.$('text').value, /^# Changes/);
});

for (const leave of ['hide', 'switch', 'suspend']) test(`change summary UI ignores late previews after ${leave}`, async t => {
  const f = await fixture(t); await f.open(); f.input('text', 'Retain existing edited text'); const held = f.hold('preview'); f.input('before', '0', 'change'); f.$('generate').click(); await held.seen;
  if (leave === 'hide') f.$('close').click();
  else if (leave === 'switch') { const next = structuredClone(f.state()); next.document.id = 'other'; f.setState(next); }
  else f.inactive();
  const status = f.$('status').textContent; held.release(); await delay(20);
  assert.equal(f.$('dialog').open, false); assert.equal(f.$('text').value, 'Retain existing edited text'); assert.equal(f.$('copy').disabled, true); assert.equal(f.$('status').textContent, status);
});

test('change summary UI rejects edits or saved changes during awaited reuse and preserves the latest text', async t => {
  const f = await fixture(t); await f.open(); await f.generate(); const held = f.hold('check');
  f.$('copy').click(); await held.seen; f.input('text', 'New text while checking'); held.release(); await until(() => !f.$('refresh').disabled);
  assert.deepEqual(f.copies, []); assert.equal(f.$('text').value, 'New text while checking'); assert.match(f.$('status').textContent, /edited|changed|again/i);
  f.handler(f.normal); const second = f.hold('check'); f.$('download').click(); await second.seen;
  const state = structuredClone(f.state()); state.document.revision++; f.setState(state); second.release(); await delay(20); assert.deepEqual(f.downloads, []);
});

test('change summary UI reports failed source checks and clipboard errors without success or losing edited text', async t => {
  const f = await fixture(t); await f.open(); await f.generate(); f.input('text', 'Retained edits');
  f.handler(async input => input.action === 'check' ? { error: 'Sources changed. Preview again.' } : f.normal(input));
  f.$('copy').click(); await until(() => /Sources changed/.test(f.$('status').textContent)); assert.deepEqual(f.copies, []); assert.equal(f.$('copy').disabled, true); assert.equal(f.$('text').value, 'Retained edits');
  f.handler(f.normal); await f.generate(); f.copyError(); f.$('copy').click(); await until(() => /Clipboard unavailable/.test(f.$('status').textContent)); assert.deepEqual(f.copies, []);
});

test('change summary UI keeps the newest dialog state when old list and preview replies arrive after reopening', async t => {
  const f = await fixture(t), first = f.hold('list'); f.$('open').click(); await first.seen; f.$('close').click();
  f.handler(f.normal); const next = structuredClone(f.state()); next.document.revision = 3; f.setState(next); await f.open(); first.release(); await delay(20);
  assert.ok([...f.$('after').options].some(option => option.value === '3'));
  const old = f.hold('preview'); f.input('before', '0', 'change'); f.$('generate').click(); await old.seen; f.$('close').click();
  f.handler(f.normal); await f.open(); await f.generate(); f.input('text', 'Newest edited summary'); old.release(); await delay(20);
  assert.equal(f.$('text').value, 'Newest edited summary'); assert.equal(f.$('copy').disabled, false);
});

test('change summary UI rejects expired or oversized previews and oversized edits without copying or losing text', async t => {
  const f = await fixture(t); await f.open(); f.input('text', 'Existing edits');
  f.handler(async input => input.action === 'preview' ? { ...await f.normal(input), expiresAt: 0 } : f.normal(input));
  f.input('before', '0', 'change'); f.$('generate').click(); await until(() => /invalid|expired/.test(f.$('status').textContent));
  assert.equal(f.$('text').value, 'Existing edits'); assert.equal(f.$('copy').disabled, true);
  f.handler(async input => input.action === 'preview' ? { ...await f.normal(input), markdown: 'x'.repeat(2 * 1024 * 1024 + 1) } : f.normal(input));
  f.$('generate').click(); await until(() => /invalid|expired/.test(f.$('status').textContent)); assert.equal(f.$('text').value, 'Existing edits');
  f.handler(f.normal); await f.generate(); f.input('text', 'x'.repeat(2 * 1024 * 1024 + 1)); const checks = f.calls.filter(x => x.action === 'check').length;
  f.$('copy').click(); assert.match(f.$('status').textContent, /2 MiB/); assert.equal(f.calls.filter(x => x.action === 'check').length, checks); assert.deepEqual(f.copies, []);
});

test('change summary UI refuses a source check for a different token and provides labeled keyboard controls', async t => {
  const f = await fixture(t); await f.open(); await f.generate();
  for (const name of ['mode', 'before', 'after', 'ref', 'text']) assert.ok(f.document.querySelector(`label[for="change-summary-${name}"]`));
  f.handler(async input => input.action === 'check' ? { ...await f.normal(input), token: 'different' } : f.normal(input));
  f.$('copy').click(); await until(() => /did not confirm/.test(f.$('status').textContent)); assert.deepEqual(f.copies, []);
  f.$('dialog').dispatchEvent(new f.window.Event('cancel', { cancelable: true })); assert.equal(f.$('dialog').open, false); assert.equal(f.document.activeElement, f.editor);
});
