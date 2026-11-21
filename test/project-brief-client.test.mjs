import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { ProjectBriefClient } from '../com.github.copilot/extensions/explorer/web/project-brief-client.mjs';
import { ProjectModeClient } from '../com.github.copilot/extensions/explorer/web/project-mode-client.mjs';
import { ProjectBriefWorkspace } from '../com.github.copilot/extensions/explorer/project-brief-workspace.mjs';
import { parseProjectBrief, PROJECT_BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/project-brief.mjs';
import { waitFor } from './helpers/wait-for.mjs';

async function fixture(t) {
  const dom = new JSDOM(await readFile('com.github.copilot/extensions/explorer/web/index.html', 'utf8'), { pretendToBeVisual: true });
  const { window } = dom, $ = id => window.document.getElementById(id), requests = [];
  const excerpt = '<script>Community tools 🌿</script>', hash = createHash('sha256').update(excerpt).digest('hex');
  const original = { id: randomUUID(), root: { path: 'C:/project', ancestors: 'a' }, sources: [{ id: randomUUID(), name: 'README.md', fingerprint: hash, excerptFingerprint: hash, bytes: Buffer.byteLength(excerpt), excerptBytes: Buffer.byteLength(excerpt), excerpt, truncated: false }] };
  let capture = original, projectIdentity = original.root, journey = 'journey-a', scope = { state: 'active', receipt: { id: original.id } }, sends = 0, intercept, now = 0, hold, release, signal;
  const mode = { capture: () => capture, captureCurrent: async () => !!capture, projectIdentity: () => projectIdentity };
  const workspace = new ProjectBriefWorkspace({ mode, journey: () => journey, execute: task => task({ run: async (prepared, options) => {
    sends++; signal = options.signal; if (hold) await new Promise(resolve => { release = resolve; }); signal.throwIfAborted();
    const output = Object.fromEntries(PROJECT_BRIEF_SECTIONS.map(section => [section, [{ id: section, text: `${section} unknown`, kind: 'unknown', sources: [] }]]));
    output.purpose = [{ id: 'purpose', text: excerpt, kind: 'file-backed', sources: [{ id: original.sources[0].id, quote: excerpt }] }];
    return parseProjectBrief(JSON.stringify(output), prepared);
  } }) });
  const fetch = async (_, options) => {
    const input = JSON.parse(options.body); requests.push(input); if (intercept) { const result = await intercept(input); if (result) return result; }
    try { const value = await workspace.request(input); return { ok: true, json: async () => value }; } catch (error) { return { ok: false, json: async () => ({ error: error.message }) }; }
  };
  $('project-mode-dialog').open = true;
  const client = new ProjectBriefClient({ $, fetch, journey: () => journey, active: () => true, scope: () => scope, now: () => now });
  t.after(() => { client.suspend(); workspace.clear(); release?.(); window.close(); });
  await client.request('status');
  const click = async id => { $(`project-brief-${id}`).click(); await waitFor(() => !client.loading); };
  const generate = async () => { await click('prepare'); await click('start'); await waitFor(() => workspace.work?.status !== 'pending'); await client.request('status'); };
  return { $, window, client, workspace, requests, click, generate, sends: () => sends, signal: () => signal, ready: () => release, release: () => release?.(), hold: () => { hold = true; },
    intercept: fn => { intercept = fn; }, scope: value => { scope = value; client.scopeChanged(); }, recapture: () => { capture = { ...original, id: randomUUID() }; scope = { state: 'active', receipt: { id: capture.id } }; client.scopeChanged(); },
    root: (path, ancestors = original.root.ancestors) => { capture = null; projectIdentity = { path, ancestors }; scope = { state: 'off', project: { root: path, identity: createHash('sha256').update(JSON.stringify(projectIdentity)).digest('hex') } }; workspace.observe(); client.scopeChanged(); },
    journey: value => { journey = value; client.observe(); }, tick: async () => { now += 10000; await client.checkStatus(); await waitFor(() => !client.loading); } };
}

test('brief refresh displays changed claims before approval and preserves editor focus across status polling', async t => {
  const f = await fixture(t); await f.generate();
  const field = f.$('project-brief-claims').querySelector('textarea');
  field.value = 'Reviewed user correction 🌿'; field.dispatchEvent(new f.window.Event('input')); await f.click('approve');
  f.recapture(); await waitFor(() => !f.client.loading); await f.generate();
  assert.equal(f.$('project-brief-changes').hidden, false);
  const content = f.$('project-brief-changes').textContent;
  assert.match(content, /Added/); assert.match(content, /File-backed claim/); assert.match(content, /unchanged/i); assert.equal(f.$('project-brief-changes').querySelector('script,a'), null);
  const current = f.$('project-brief-claims').querySelector('textarea'); current.focus(); current.setSelectionRange(2, 4); await f.client.request('status');
  assert.equal(f.window.document.activeElement, current); assert.equal(current.selectionStart, 2);
  await f.click('approve'); assert.equal(f.$('project-brief-changes').hidden, true);
});

test('replacing the canonical project at the same path clears old unsaved brief text', async t => {
  const f = await fixture(t); await f.generate(); const field = f.$('project-brief-claims').querySelector('textarea');
  field.value = 'Private unsaved old-project wording'; field.dispatchEvent(new f.window.Event('input')); assert.equal(f.client.dirty, true);
  f.root('C:/project', 'replacement-directory'); await waitFor(() => !f.client.loading);
  assert.equal(f.client.dirty, false); assert.equal(f.$('project-brief-claims').querySelector('textarea'), null); assert.equal(f.client.value.comparison, undefined);
});

test('question explanations resolve only the exact approved local brief without network or supporting quotes', async t => {
  const f = await fixture(t); await f.generate(); await f.click('approve');
  const value = f.client.value, claim = value.draft.sections.purpose[0];
  const reference = { state: 'current', captureId: value.draft.captureId, revision: value.revision, claimIds: [claim.id, value.draft.sections.stack[0].id] };
  const before = f.requests.length, explanation = f.client.explain(reference);
  assert.equal(explanation.state, 'current'); assert.equal(explanation.claims[0].text, claim.text);
  assert.equal(explanation.claims[0].kind, 'file-backed'); assert.deepEqual(explanation.claims[0].files, ['README.md']);
  assert.equal(explanation.claims[1].kind, 'unknown'); assert.ok(!JSON.stringify(explanation).includes('quote'));
  assert.equal(f.requests.length, before, 'display cannot read or request context');
  for (const changed of [{ ...reference, revision: reference.revision + 1 }, { ...reference, captureId: 'other' }, { ...reference, claimIds: ['README.md'] }, { state: 'stale' }]) assert.equal(f.client.explain(changed).state, 'stale');
  assert.equal(f.client.explain().state, 'unavailable');
  await f.click('revoke'); assert.equal(f.client.explain(reference).state, 'stale');
  await f.click('approve'); assert.equal(f.client.explain(reference).state, 'stale');
});

test('brief UI reviews exact input, generates only explicitly, edits provenance and approves the reviewed revision', async t => {
  const f = await fixture(t); await f.click('prepare'); assert.equal(f.sends(), 0);
  assert.match(f.$('project-brief-input').textContent, /Community tools/); assert.equal(f.$('project-brief-input').querySelector('script'), null);
  await f.click('start'); await waitFor(() => f.workspace.work?.status !== 'pending'); await f.client.request('status');
  assert.equal(f.sends(), 1); assert.equal(f.client.value.approved, false); assert.match(f.$('project-brief-claims').textContent, /File-backed claim/);
  assert.match(f.$('project-brief-claims').textContent, /Unknown/); assert.equal(f.$('project-brief-claims').querySelector('script'), null);
  const fields = f.$('project-brief-claims').querySelectorAll('textarea'); fields[0].value = 'A corrected purpose 🌿'; fields[0].dispatchEvent(new f.window.Event('input'));
  f.$('project-brief-claims').querySelectorAll('input[type=checkbox]')[1].click();
  f.$('project-brief-add-text').value = 'User constraint'; f.$('project-brief-add-text').dispatchEvent(new f.window.Event('input'));
  await f.click('approve'); assert.equal(f.client.value.approved, true);
  assert.equal(f.workspace.draft.sections.purpose[0].kind, 'user'); assert.equal(f.workspace.draft.sections.architecture.length, 0);
  assert.ok(Object.values(f.workspace.draft.sections).flat().some(c => c.text === 'User constraint' && c.kind === 'user'));
  assert.ok([...f.$('project-brief-claims').querySelectorAll('textarea')].every(field => field.readOnly));
  await f.click('revoke'); assert.equal(f.client.value.approved, false); assert.equal(f.$('project-brief-claims').querySelector('textarea').readOnly, false);
});

test('polls and failed saves preserve local text, caret and expanded sources; stale scope retains unsaved text read-only', async t => {
  const f = await fixture(t); await f.generate(); const field = f.$('project-brief-claims').querySelector('textarea');
  const source = f.$('project-brief-claims').querySelector('details'); source.open = true;
  field.value = 'Unsaved local correction'; field.dispatchEvent(new f.window.Event('input')); field.focus(); field.setSelectionRange(3, 5);
  await f.tick(); assert.equal(f.$('project-brief-claims').querySelector('textarea'), field); assert.equal(field.selectionStart, 3); assert.equal(source.open, true);
  f.intercept(input => { if (input.action === 'edit') throw Error('Lost save'); }); await f.click('save'); assert.equal(field.value, 'Unsaved local correction');
  f.intercept(null); await f.client.request('status'); assert.equal(field.value, 'Unsaved local correction');
  f.recapture(); await waitFor(() => !f.client.loading); assert.equal(field.value, 'Unsaved local correction'); assert.equal(field.readOnly, true);
  assert.match(f.$('project-brief-state').textContent, /unsaved|scope/i); await f.click('discard-changes'); assert.equal(f.$('project-brief-claims').querySelector('textarea'), null);
});

test('lost revocation never unlocks an approved draft until the server confirms revocation', async t => {
  const f = await fixture(t); await f.generate(); await f.click('approve');
  f.intercept(input => { if (input.action === 'revoke') throw Error('Lost revoke'); }); await f.click('revoke');
  assert.equal(f.$('project-brief-claims').querySelector('textarea').readOnly, true);
  await f.client.request('status'); assert.equal(f.$('project-brief-claims').querySelector('textarea').readOnly, true);
  f.intercept(null); await f.click('revoke'); assert.equal(f.$('project-brief-claims').querySelector('textarea').readOnly, false);
});

test('close cancels owned generation, ignores a late reply and journey changes clear local context', async t => {
  const f = await fixture(t); f.hold(); await f.click('prepare'); await f.click('start'); await waitFor(() => f.ready());
  f.$('project-mode-close').click(); await waitFor(() => f.signal().aborted); f.release(); await new Promise(setImmediate);
  assert.equal(f.client.value?.draft, undefined); assert.equal(f.workspace.draft, null);
  f.journey('journey-b'); assert.equal(f.$('project-brief-input').textContent, ''); assert.equal(f.$('project-brief-claims').textContent, '');
});

test('return to project questions cancels brief review and generation but preserves an approved brief and answer draft', async t => {
  for (const stage of ['prepare', 'review', 'start', 'helper', 'approved']) await t.test(stage, async t => {
    const f = await fixture(t); let returned, releaseRequest;
    f.$('project-mode-dialog').close = function () { this.open = false; };
    const mode = new ProjectModeClient({ $: f.$, fetch: async () => ({ ok: true, json: async () => ({}) }), journey: () => 'journey-a', active: () => true,
      briefState: () => f.client.value, onReturn: nodeId => { returned = nodeId; } });
    mode.target = { nodeId: 'target', question: 'Billing' }; mode.render();
    const answer = f.window.document.createElement('textarea'); answer.value = 'Keep my answer draft'; f.window.document.body.append(answer);
    let pending, approved;
    if (stage === 'approved') { await f.generate(); await f.click('approve'); approved = f.workspace.draft; }
    else {
      if (stage !== 'prepare') await f.click('prepare');
      if (['prepare', 'start'].includes(stage)) {
        f.intercept(input => { if (input.action === stage) return new Promise(resolve => { releaseRequest = resolve; }); });
        pending = f.client.act(stage); await waitFor(() => releaseRequest);
      } else if (stage === 'helper') { f.hold(); await f.click('start'); await waitFor(() => f.ready()); }
    }
    const cancels = f.requests.filter(input => input.action === 'cancel').length;
    f.$('project-mode-return').click(); await new Promise(setImmediate);
    assert.equal(f.$('project-mode-dialog').open, false); assert.equal(returned, 'target'); assert.equal(answer.value, 'Keep my answer draft');
    assert.equal(f.requests.filter(input => input.action === 'cancel').length, cancels + (stage === 'approved' ? 0 : 1));
    if (stage === 'helper') { assert.equal(f.signal().aborted, true); f.release(); await new Promise(setImmediate); }
    releaseRequest?.(); await pending;
    assert.equal(f.workspace.preview, null); assert.equal(f.client.value?.token, undefined);
    if (stage === 'approved') { assert.equal(f.workspace.draft, approved); assert.equal(f.client.value.approved, true); }
    else { assert.equal(f.workspace.draft, null); assert.equal(f.client.value?.draft, undefined); assert.equal(f.sends(), stage === 'helper' ? 1 : 0); }
  });
});

test('lost cancellation stays pending while hidden and cannot expose a late result for approval', async t => {
  for (const close of [false, true]) {
    const f = await fixture(t); f.hold(); await f.click('prepare'); await f.click('start'); await waitFor(() => f.ready());
    f.intercept(input => { if (input.action === 'cancel') throw Error('Cancel never delivered'); });
    if (close) { f.$('project-mode-close').click(); f.$('project-mode-dialog').open = false; } else await f.click('cancel');
    await new Promise(setImmediate); assert.match(f.$('project-brief-state').textContent, /cancel.*confirm/i);
    f.release(); await waitFor(() => f.workspace.work?.status === 'result');
    await f.client.request('status'); assert.equal(f.client.value?.draft, undefined); assert.equal(f.$('project-brief-approve').disabled, true);
    const count = f.requests.filter(r => r.action === 'cancel').length; await f.tick(); assert.ok(f.requests.filter(r => r.action === 'cancel').length > count, 'existing polling retries cancellation even while closed');
    f.intercept(null); await f.tick(); assert.equal(f.workspace.draft, null, 'confirmed cancellation removes the unwanted late result');
    assert.equal(f.client.cancelId, null); assert.equal(f.$('project-brief-approve').disabled, true);
  }
});

test('a metadata-only root change clears old-project saved corrections and unsaved form text', async t => {
  const f = await fixture(t); await f.generate(); const field = f.$('project-brief-claims').querySelector('textarea');
  field.value = 'OLD_PROJECT_PRIVATE_CORRECTION'; field.dispatchEvent(new f.window.Event('input')); await f.click('save');
  const saved = f.$('project-brief-claims').querySelector('textarea'); saved.value = 'OLD_PROJECT_UNSAVED_TEXT'; saved.dispatchEvent(new f.window.Event('input'));
  f.root('C:/new-project'); await waitFor(() => !f.client.loading);
  assert.equal(f.$('project-brief-claims').textContent, ''); assert.equal(f.$('project-brief-corrections').textContent, '');
  assert.deepEqual(f.client.value.corrections, []); assert.equal(f.client.value.project.root, 'C:/new-project');
});

test('closing during status or preparing a fresh review preserves the completed brief', async t => {
  for (const action of ['status', 'prepare']) {
    const f = await fixture(t); await f.generate(); const id = f.workspace.draft.sections.purpose[0].id; let release;
    f.intercept(input => { if (input.action === action) return new Promise(resolve => { release = resolve; }); });
    const pending = f.client.request(action); await waitFor(() => release);
    f.$('project-mode-close').click(); f.$('project-mode-dialog').open = false; await new Promise(setImmediate);
    release(); await pending;
    assert.equal(f.workspace.draft?.sections.purpose[0].id, id, `closing during ${action} does not cancel a completed generation`);
  }
});

test('resume registers its new client before cancellation retries even if scope supersedes the first status', async t => {
  const f = await fixture(t); f.hold(); await f.click('prepare'); await f.click('start'); await waitFor(() => f.ready());
  let releaseStatus, held = false;
  f.intercept(input => {
    if (input.action === 'cancel') throw Error('Lost cancel');
    if (input.action === 'status' && !held) { held = true; return new Promise(resolve => { releaseStatus = resolve; }); }
  });
  f.client.suspend(); f.client.resume(); await waitFor(() => releaseStatus);
  f.scope({ state: 'uncertain' }); await waitFor(() => !f.client.loading); await f.tick();
  releaseStatus(); await new Promise(setImmediate);
  assert.equal(f.workspace.clientId, f.client.clientId, 'fresh status handshake registers the rotated client');
  assert.equal(f.client.cancelId, null); assert.equal(f.signal().aborted, true);
});
