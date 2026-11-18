import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { AdrSourcesClient } from '../com.github.copilot/extensions/explorer/web/adr-sources-client.mjs';

function fixture(t) {
  const dom = new JSDOM('<section id="adr-sources-panel" hidden><p id="adr-sources-status"></p><p id="adr-sources-meta"></p><pre id="adr-sources-guidance"></pre><select id="adr-sources-node"></select><pre id="adr-sources-record"></pre><pre id="adr-sources-evidence"></pre><pre id="adr-sources-mappings"></pre><button id="adr-sources-inspect">Inspect current source</button></section>');
  const $ = id => dom.window.document.getElementById(`adr-sources-${id}`), opens = []; let active = true;
  const client = new AdrSourcesClient({ $: id => dom.window.document.getElementById(id), active: () => active, openReference: text => opens.push(text) });
  const reference = { format: 'explorer-reference', version: 1, path: '.explorer/original.explore.json', journeyId: 'map', nodeId: 'a', fingerprint: 'original' };
  const result = { id: 'adr', path: 'docs/a.md', title: '<script>ADR title</script>', capture: { capturedAt: '2026-11-18', digest: 'capture', journey: { id: 'map', path: reference.path, commit: null }, adrPath: 'nested/docs/a.md', guidance: { topic: '<script>Topic</script>', objective: 'Original objective', successCriteria: '', mode: 'understand', pins: [] }, includeEvidence: true,
    nodes: [{ record: { id: 'a', question: '<script>Question A?</script>', answer: 'Original <b>answer</b>', answerState: 'tentative', review: true }, fingerprint: 'record-a' }, { record: { id: 'b', question: 'Question B?', answer: '', kind: 'direction', review: false }, fingerprint: 'record-b' }],
    evidence: [{ nodeId: 'a', basis: 'sources', sources: [{ id: 's1', title: 'Evidence', url: 'https://example.com/original', provenance: 'imported', retrievedAt: null }], claims: [{ id: 'c1', text: 'Original interpretation', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Original support' }], limitations: 'Original limitation <img>' }] }],
    references: [reference], statements: [{ id: 'choice', section: 'outcome', sources: [{ kind: 'node', id: 'a' }] }] }, sourceStatus: { status: 'changed', guidanceChanged: false, nodes: [{ id: 'a', status: 'changed' }, { id: 'b', status: 'missing' }], message: 'Saved content changed; capture retained.' } };
  t.after(() => dom.window.close()); return { $, dom, client, opens, result, reference, active: v => { active = v; } };
}
test('ADR source details render historical answers, current status and recorded limitations literally', t => {
  const f = fixture(t); f.client.render(f.result);
  assert.equal(f.$('panel').hidden, false); assert.match(f.$('status').textContent, /changed/); assert.match(f.$('record').textContent, /Original <b>answer/); assert.match(f.$('record').textContent, /tentative|needs review/i);
  assert.match(f.$('evidence').textContent, /Original limitation <img>/); assert.match(f.$('evidence').textContent, /https:\/\/example.com\/original/); assert.match(f.$('evidence').textContent, /imported/);
  assert.match(f.$('meta').textContent, /no committed|unavailable/i); assert.match(f.$('guidance').textContent, /Original objective/); assert.match(f.$('mappings').textContent, /choice/);
  assert.equal(f.dom.window.document.querySelector('script,img,b'), null); assert.equal(f.opens.length, 0);
});
test('explicit source inspection preserves the original reference and selecting another source never navigates', t => {
  const f = fixture(t); f.client.render(f.result); f.$('inspect').click(); assert.deepEqual(JSON.parse(f.opens[0]), f.reference);
  f.$('node').value = 'b'; f.$('node').dispatchEvent(new f.dom.window.Event('change')); assert.match(f.$('record').textContent, /missing/); assert.equal(f.$('inspect').disabled, true); assert.equal(f.opens.length, 1);
});
test('legacy and Personal source details expose unavailable portable context without retaining old controls', t => {
  const f = fixture(t); f.client.render(f.result); f.client.render({ ...f.result, capture: null, sourceStatus: { status: 'unavailable', nodes: [], message: 'No historical capture.' } });
  assert.match(f.$('status').textContent, /No historical capture/); assert.equal(f.$('node').disabled, true); assert.equal(f.$('inspect').disabled, true); assert.equal(f.$('record').textContent, '');
  f.result.capture.journey.path = null; f.result.capture.adrPath = null; f.result.capture.references = []; f.client.render(f.result);
  assert.match(f.$('meta').textContent, /Personal|portable.*unavailable/i); assert.equal(f.$('inspect').disabled, true);
});
test('cleared, locked or inactive source controls cannot start reference inspection', t => {
  const f = fixture(t); f.client.render(f.result); f.client.update(true); f.$('inspect').click(); assert.equal(f.opens.length, 0);
  f.client.update(false); f.active(false); f.$('inspect').click(); assert.equal(f.opens.length, 0);
  f.active(true); f.client.clear(); f.$('inspect').click(); assert.equal(f.$('panel').hidden, true); assert.equal(f.opens.length, 0);
});
