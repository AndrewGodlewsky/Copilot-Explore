import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PortableReferenceClient } from '../com.github.copilot/extensions/explorer/web/portable-reference-client.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
async function fixture(t, { respond, copyText, navigate } = {}) {
  const dom = new JSDOM(`<button id="portable-reference-open">Open</button><button id="portable-reference-welcome">Open</button><dialog id="portable-reference-dialog"><h2 id="portable-reference-title"></h2><div id="portable-reference-paste"><textarea id="portable-reference-text"></textarea><button id="portable-reference-inspect">Inspect</button><div id="portable-reference-preview"></div><label id="portable-reference-ack-label"><input id="portable-reference-ack" type="checkbox">Open changed target</label><button id="portable-reference-go">Open reference</button></div><div id="portable-reference-copy-area"><textarea id="portable-reference-output" readonly></textarea><button id="portable-reference-copy">Copy reference</button></div><p id="portable-reference-status"></p><button id="portable-reference-close">Close</button></dialog>`, { url: 'http://localhost/' });
  const document = dom.window.document, $ = id => document.getElementById(`portable-reference-${id}`);
  $('dialog').showModal = () => { $('dialog').open = true; }; $('dialog').close = () => { $('dialog').open = false; };
  let state = { library: true, activeKey: 'current', storage: { scope: 'project' }, document: { id: 'journey', revision: 1, nodes: [{ id: 'node', question: 'Question?' }] } }, active = true, busy = false;
  const requests = [], copies = [], navigations = [], selections = [];
  const preview = { id: 'capture', path: '.explorer/map.explore.json', journeyId: 'target-journey', nodeId: 'target-node', question: '<script>Exact question?</script>', status: 'current' };
  const client = new PortableReferenceClient({ $: id => document.getElementById(id), state: () => state, active: () => active, canAct: () => !busy,
    begin: () => { busy = true; return () => { busy = false; }; }, copyText: async text => { copies.push(text); await copyText?.(text); }, select: id => selections.push(id),
    navigate: async (input, current) => { navigations.push(input); return navigate ? navigate(input, current) : { referenceNodeId: preview.nodeId }; },
    fetch: async (_, options) => { const input = JSON.parse(options.body); requests.push(input); return respond ? respond(input) : json(input.action === 'copy' ? { text: 'REFERENCE_CANARY <script>' } : preview); } });
  t.after(() => { client.close(false); dom.window.close(); });
  const input = value => { $('text').value = value; $('text').dispatchEvent(new dom.window.Event('input')); };
  return { $, dom, client, requests, copies, navigations, selections, preview, input, state: () => state, set: value => { state = value; client.update(); }, active: value => { active = value; }, busy: () => busy };
}

test('portable copy presents literal selectable text, retains it on clipboard failure and retries without another read', async t => {
  let fail = true; const f = await fixture(t, { copyText: () => { if (fail) throw Error('Clipboard unavailable'); } });
  await f.client.open('node'); assert.equal(f.requests[0].action, 'copy'); assert.equal(f.requests[0].nodeId, 'node');
  assert.equal(f.$('output').value, 'REFERENCE_CANARY <script>'); assert.match(f.$('status').textContent, /select|copy manually/i); assert.equal(f.$('dialog').querySelector('script'), null);
  fail = false; await f.client.copy(); assert.equal(f.requests.length, 1); assert.match(f.$('status').textContent, /copied/i);
});

test('portable inspection is explicit, literal, current-bound and opening passes the selected identity then focuses the result', async t => {
  const f = await fixture(t); f.client.open(); f.input('reference text'); assert.equal(f.requests.length, 0);
  await f.client.inspect(); assert.equal(f.requests[0].journey, 'current'); assert.equal(f.requests[0].revision, 1);
  assert.match(f.$('preview').textContent, /<script>Exact question/); assert.equal(f.$('preview').querySelector('script'), null); assert.match(f.$('preview').textContent, /saved target|research/i);
  await f.client.go(); assert.equal(f.navigations[0].id, 'capture'); assert.equal(f.navigations[0].acknowledged, false); assert.deepEqual(f.selections, ['target-node']); assert.equal(f.$('dialog').open, false);
});

test('changed references require acknowledgement and new text removes an old preview without erasing the paste', async t => {
  const f = await fixture(t, { respond: () => json({ id: 'changed', nodeId: 'n', question: 'Changed?', path: 'map.explore.json', status: 'changed' }) });
  f.client.open(); f.input('first'); await f.client.inspect(); assert.equal(f.$('go').disabled, true); await f.client.go(); assert.equal(f.navigations.length, 0);
  f.$('ack').checked = true; f.$('ack').dispatchEvent(new f.dom.window.Event('change')); assert.equal(f.$('go').disabled, false);
  f.input('newer'); assert.equal(f.$('go').disabled, true); assert.equal(f.$('preview').textContent, ''); f.client.close(); f.client.open(); assert.equal(f.$('text').value, 'newer');
});

test('fresh canvas inspection sends null bindings and personal copies explain Project storage', async t => {
  const f = await fixture(t); f.set({ library: true, document: null, storage: { scope: 'personal' } }); f.client.open(); f.input('reference'); await f.client.inspect();
  assert.equal(f.requests[0].journey, null); assert.equal(f.requests[0].revision, null);
  f.set({ ...f.state(), document: { id: 'personal', revision: 0, nodes: [{ id: 'node' }] } }); await f.client.open('node'); assert.match(f.$('status').textContent, /Project|shared/); assert.equal(f.requests.length, 1);
});

test('inspection rejects empty and oversized text locally and preserves failed inspection input', async t => {
  const f = await fixture(t, { respond: () => json({ error: 'Referenced file missing or moved' }, 400) }); f.client.open();
  await f.client.inspect(); f.input('λ'.repeat(4097)); await f.client.inspect(); assert.equal(f.requests.length, 0);
  f.input('valid pasted reference'); await f.client.inspect(); assert.equal(f.$('text').value, 'valid pasted reference'); assert.match(f.$('status').textContent, /missing|moved/); assert.equal(f.$('go').disabled, true);
});

for (const leave of ['hide', 'edit', 'suspend', 'journey', 'revision']) test(`late reference inspection after ${leave} never revives the old selection`, async t => {
  let finish; const f = await fixture(t, { respond: () => new Promise(resolve => { finish = () => resolve(json({ id: 'old', question: 'Old result', path: 'map.explore.json', status: 'current' })); }) });
  f.client.open(); f.input('old text'); const pending = f.client.inspect(); assert.ok(finish);
  if (leave === 'hide') f.client.close();
  else if (leave === 'edit') f.input('newer text');
  else if (leave === 'suspend') { f.active(false); f.client.close(false); }
  else if (leave === 'journey') f.set({ ...f.state(), activeKey: 'another', document: { ...f.state().document, id: 'another' } });
  else f.set({ ...f.state(), document: { ...f.state().document, revision: 2 } });
  finish(); await pending; assert.equal(f.$('preview').textContent, ''); assert.equal(f.$('go').disabled, true); assert.equal(f.busy(), false);
  if (leave === 'edit') assert.equal(f.$('text').value, 'newer text');
});

test('opening preserves a declined switch, blocks pending work and ignores a late navigation result after suspension', async t => {
  let finish; const f = await fixture(t, { navigate: () => new Promise(resolve => { finish = resolve; }) });
  f.client.open(); f.input('reference'); await f.client.inspect();
  f.set({ ...f.state(), pending: { kind: 'research' } }); await f.client.go(); assert.equal(f.navigations.length, 0);
  f.set({ ...f.state(), pending: null }); const first = f.client.go(); finish(null); await first; assert.equal(f.$('dialog').open, true); assert.equal(f.$('text').value, 'reference');
  const late = f.client.go(); f.active(false); f.client.close(false); finish({ referenceNodeId: 'target-node' }); await late; assert.deepEqual(f.selections, []);
});
