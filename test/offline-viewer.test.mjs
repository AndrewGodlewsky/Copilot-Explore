import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { createDocument, addQuestions, addDirection } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

import * as viewer from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
const hostile = '</script><!--<img src="https://evil.test" onerror="window.pwned=1"> λ 中文 🌿\u0000\u000b\r\n\ud800\u2028\u2029 &';
function fixture() {
  const doc = createDocument('ANCESTOR_CANARY', { objective: 'GUIDANCE_CANARY' });
  const [a, b] = addQuestions(doc, doc.rootId, [{ question: hostile, category: 'Category' }, { question: 'SIBLING_CANARY', category: 'Other' }]);
  a.answer = 'Saved answer λ'; a.answerState = 'assumption'; a.review = true;
  const c = addDirection(doc, a.id, 'User direction');
  a.research = { basis: 'sources', summary: 'Recorded AI summary', options: [
    { title: 'A', description: 'Choice A', pros: ['Pro'], cons: ['Con'], details: [{ label: 'Cost', value: 'Unknown' }], proposedAnswer: 'Option suggestion' },
    { title: 'B', description: 'Choice B', pros: [], cons: [] }], recommendation: 'AI recommendation', proposedAnswer: 'A private suggested answer', uncertainty: 'Not verified',
    sources: [{ id: 'PRIVATE_SOURCE_ID', title: 'A source', url: 'https://example.com/article', retrievedAt: '2026-11-17T00:00:00.000Z', provenance: 'imported' }],
    claims: [{ id: 'PRIVATE_CLAIM_ID', text: 'Claim text', basis: 'sources', limitations: 'Claim limits', evidence: [{ sourceId: 'PRIVATE_SOURCE_ID', paraphrase: 'Model paraphrase' }] }] };
  return { doc, a, b, c, selection: [{ nodeId: a.id, answer: false, research: false }, { nodeId: c.id, answer: false, research: false }] };
}
const hash = text => createHash('sha256').update(text).digest('base64');

test('viewer projection exports exact selections with generated forest IDs and no excluded data anywhere in artifact', () => {
  assert.equal(typeof viewer.viewerSnapshot, 'function', 'dedicated viewer projection exists');
  const { doc, a, c, selection } = fixture();
  Object.assign(doc, { token: 'TOKEN_CANARY', endpoint: 'ENDPOINT_CANARY', drafts: 'DRAFT_CANARY', projectCapture: 'PROJECT_CANARY', file: 'C:\\PRIVATE_PATH_CANARY', helper: 'HELPER_CANARY' });
  a.privateMetadata = 'PRIVATE_CANARY';
  const data = viewer.viewerSnapshot(doc, selection);
  assert.deepEqual(data.nodes.map(n => [n.id, n.parentId, n.role]), [['n0', null, 'question'], ['n1', 'n0', 'direction']]);
  assert.equal(data.nodes[0].question, hostile);
  assert.equal(data.nodes[0].answer, null); assert.equal(data.nodes[0].research, null);
  assert.equal(data.nodes[0].status, 'Assumption'); assert.equal(data.nodes[0].review, true);
  const html = viewer.viewerArtifact(data).content;
  for (const value of ['CANARY', doc.id, a.id, c.id, 'Saved answer λ', 'A private suggested answer', 'PRIVATE_SOURCE_ID']) assert.ok(!html.includes(value), value);
  assert.equal(viewer.viewerArtifact(data).filename, 'exploration-viewer.html');
  assert.deepEqual(viewer.viewerSnapshot(doc, [{ nodeId: c.id, answer: false, research: false }]).nodes.map(n => n.parentId), [null]);
});

test('selected research preserves AI suggestions, claims, unknown legacy support and provenance without arbitrary fields', () => {
  const { doc, a, selection } = fixture(); selection[0].answer = selection[0].research = true;
  a.research.settings = { private: 'SETTINGS_CANARY' }; a.research.options[0].hidden = 'OPTION_CANARY';
  const data = viewer.viewerSnapshot(doc, selection), r = data.nodes[0].research;
  assert.equal(data.nodes[0].answer, 'Saved answer λ'); assert.equal(r.proposedAnswer, 'A private suggested answer');
  assert.deepEqual(r.sources, [{ id: 's0', title: 'A source', url: 'https://example.com/article', retrievedAt: '2026-11-17T00:00:00.000Z', provenance: 'imported' }]);
  assert.deepEqual(r.claims, [{ id: 'c0', text: 'Claim text', basis: 'sources', limitations: 'Claim limits', evidence: [{ sourceId: 's0', paraphrase: 'Model paraphrase' }] }]);
  assert.ok(!JSON.stringify(data).includes('CANARY')); assert.ok(!JSON.stringify(data).includes('PRIVATE_'));
  delete a.research.claims; a.research.sources = [{ title: 'Legacy', url: 'https://example.com/old' }];
  assert.equal(viewer.viewerSnapshot(doc, selection).nodes[0].research.sources[0].provenance, 'unknown');
  for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'https://user:pass@example.com', 'data:text/html,x']) {
    a.research.sources[0].url = url; assert.throws(() => viewer.viewerSnapshot(doc, selection), /source/i);
  }
});

test('standalone viewer uses exact hash CSP, preserves hostile text and navigates/searches with no network or plugin globals', async () => {
  const { doc, selection } = fixture(); selection[0].answer = selection[0].research = true;
  const data = viewer.viewerSnapshot(doc, selection), { content } = viewer.viewerArtifact(data), requests = [], errors = [];
  class DenyResources extends ResourceLoader { fetch(url) { requests.push(url); return null; } }
  const dom = new JSDOM(content, { url: 'file:///offline/exploration-viewer.html', runScripts: 'dangerously', resources: new DenyResources(), virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push(e.message)), beforeParse(window) {
    const deny = name => function () { requests.push(name); throw Error('Network denied'); };
    window.fetch = deny('fetch'); window.XMLHttpRequest = deny('XHR'); window.WebSocket = deny('WebSocket'); window.EventSource = deny('EventSource'); window.open = deny('open'); window.navigator.sendBeacon = deny('beacon');
  } });
  const d = dom.window.document, $ = id => d.getElementById(id);
  try {
    const csp = d.querySelector('meta[http-equiv]').content;
    assert.ok(content.indexOf('Content-Security-Policy') < content.indexOf('<style>'));
    assert.match(csp, /default-src 'none'/); assert.match(csp, /connect-src 'none'/); assert.ok(!csp.includes('unsafe-inline')); assert.ok(!csp.includes('unsafe-eval'));
    assert.ok(csp.includes(`style-src 'sha256-${hash(d.querySelector('style').textContent)}'`));
    const scripts = [...d.querySelectorAll('script')]; assert.equal(scripts.length, 2);
    assert.ok(csp.includes(`script-src 'sha256-${hash(scripts[1].textContent)}'`));
    assert.deepEqual(JSON.parse($('viewer-data').textContent), data);
    assert.equal($('node-title').textContent, hostile); assert.equal(dom.window.pwned, undefined);
    assert.equal(d.querySelector('img,iframe,link,form,[src],[onclick],[onerror]'), null);
    assert.match($('detail').textContent, /AI suggestions/); assert.match($('detail').textContent, /Imported/); assert.match($('detail').textContent, /Claim limits/);
    const source = d.querySelector('#detail a'); assert.equal(source.href, 'https://example.com/article'); assert.equal(source.target, '_blank'); assert.equal(source.rel, 'noopener noreferrer'); assert.equal(source.referrerPolicy, 'no-referrer');
    let click; source.addEventListener('click', e => { click = true; e.preventDefault(); }); source.click(); assert.equal(click, true);
    $('next').click(); assert.equal($('node-title').textContent, 'User direction');
    $('previous').click(); assert.equal($('node-title').textContent, hostile);
    $('search').value = 'Model paraphrase'; $('search').dispatchEvent(new dom.window.Event('input')); assert.equal(d.querySelectorAll('#node-list button').length, 1);
    $('search').value = 'No match'; $('search').dispatchEvent(new dom.window.Event('input')); assert.equal(d.querySelectorAll('#node-list button').length, 0); assert.match($('results').textContent, /0/);
    $('search').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal($('search').value, ''); assert.equal(d.querySelectorAll('#node-list button').length, 2);
    assert.ok(d.querySelector('style').textContent.includes('@media')); assert.ok(d.querySelector('style').textContent.includes(':focus-visible'));
    await new Promise(resolve => setTimeout(resolve, 10)); assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});

test('viewer rejects invalid, duplicate, missing and over-limit selections rather than truncating', () => {
  const { doc, a, selection } = fixture();
  for (const invalid of [[], null, [...selection, selection[0]], [{ ...selection[0], secret: 1 }], [{ nodeId: 'missing', answer: false, research: false }], [{ nodeId: a.id, answer: 1, research: false }]]) assert.throws(() => viewer.viewerSnapshot(doc, invalid));
  const large = createDocument('Root');
  for (let i = 1; i < 501; i++) large.nodes.push({ id: `id${i}`, parentId: large.rootId, question: `Q${i}`, category: 'General', answer: 'x'.repeat(2200), research: null, review: false });
  const choices = large.nodes.map(n => ({ nodeId: n.id, answer: true, research: false }));
  assert.throws(() => viewer.viewerSnapshot(large, choices), /limit/i);
  assert.throws(() => viewer.viewerSnapshot(large, choices.slice(1)), /limit/i);
  for (const n of large.nodes) n.answer = '';
  assert.equal(viewer.viewerSnapshot(large, choices.slice(1)).nodes.length, 500);
  assert.throws(() => viewer.viewerArtifact({ nodes: [{ question: '<'.repeat(1024 * 1024) }] }), /limit/i);
});

test('deep and wide 500-node exports remain searchable without recursive layout or automatic networking', () => {
  for (const deep of [false, true]) {
    const doc = createDocument('Root');
    for (let i = 1; i < 500; i++) doc.nodes.push({ id: `node${i}`, parentId: deep ? doc.nodes[i - 1].id : doc.rootId, question: `Question ${i} 中文`, category: 'General', answer: 'Long saved text 🌿 '.repeat(40), research: null, review: false });
    const snapshot = viewer.viewerSnapshot(doc, doc.nodes.map(n => ({ nodeId: n.id, answer: true, research: false })));
    const requests = [], errors = [];
    class DenyResources extends ResourceLoader { fetch(url) { requests.push(url); return null; } }
    const dom = new JSDOM(viewer.viewerArtifact(snapshot).content, { runScripts: 'dangerously', resources: new DenyResources(), virtualConsole: new VirtualConsole().on('jsdomError', e => errors.push(e.message)), beforeParse(window) {
      const deny = () => { requests.push('network'); throw Error('Denied'); };
      window.fetch = window.XMLHttpRequest = window.WebSocket = window.EventSource = window.open = window.navigator.sendBeacon = deny;
    } });
    try {
      const d = dom.window.document; assert.equal(d.querySelectorAll('#node-list button').length, 500);
      const search = d.getElementById('search'); search.value = 'Question 499'; search.dispatchEvent(new dom.window.Event('input'));
      d.querySelector('#node-list button').click(); assert.equal(d.getElementById('node-title').textContent, 'Question 499 中文');
      assert.equal(d.activeElement.id, 'node-title'); assert.equal(d.getElementById('next').disabled, true);
      assert.match(d.getElementById('detail').textContent, deep ? /Parent: Question 498 中文/ : /Parent: Root/);
      assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    } finally { dom.window.close(); }
  }
});

test('allowlisting does not claim to redact private words deliberately selected by the owner', () => {
  const { doc, a } = fixture(); a.answer = 'My private text: C:\\Users\\example\\secret.txt and token=my-personal-token';
  const snapshot = viewer.viewerSnapshot(doc, [{ nodeId: a.id, answer: true, research: false }]);
  assert.equal(snapshot.nodes[0].answer, a.answer);
  const dom = new JSDOM(viewer.viewerArtifact(snapshot).content);
  assert.equal(JSON.parse(dom.window.document.getElementById('viewer-data').textContent).nodes[0].answer, a.answer); dom.window.close();
});

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-viewer-')), file = join(dir, 'map.explore.json'), f = fixture();
  await writeFile(file, JSON.stringify(f.doc)); const explorer = await new Explorer({ file }).load(), server = await startServer(explorer, { close() {} });
  t.after(async () => { await server.close(); await rm(dir, { recursive: true, force: true }); });
  const input = { action: 'preview', journey: f.doc.id, revision: 0, selection: f.selection, digest: null };
  const post = (value = input, headers = {}) => fetch(server.url + 'api/viewer-export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin, ...headers }, body: JSON.stringify(value) });
  return { ...f, file, explorer, server, input, post };
}
test('viewer HTTP preview/download binds saved identity, exact selection and revision, rejects races and unauthorized requests', async t => {
  const f = await setup(t);
  let response = await f.post(); assert.equal(response.status, 200); const preview = await response.json();
  assert.equal(preview.snapshot.nodes.length, 2); assert.match(preview.digest, /^[a-f0-9]{64}$/);
  const download = { ...f.input, action: 'download', digest: preview.digest };
  response = await f.post(download); assert.equal(response.status, 200); assert.equal(response.headers.get('content-disposition'), 'attachment; filename="exploration-viewer.html"');
  const artifact = await response.text(); assert.ok(!artifact.includes(f.server.url)); assert.ok(!artifact.includes(new URL(f.server.url).pathname.split('/').filter(Boolean)[0]));
  assert.equal((await f.post(f.input, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.post(f.input, { 'X-Explorer-Client': '0' })).status, 403);
  for (const input of [{ ...download, digest: '0'.repeat(64) }, { ...download, selection: [{ ...f.selection[0], answer: true }] }, { ...f.input, revision: 1 }, { ...f.input, journey: 'wrong' }, { ...f.input, extra: 1 }]) assert.equal((await f.post(input)).status, 400);
  const read = f.explorer.readCurrent.bind(f.explorer);
  f.explorer.readCurrent = async () => { const doc = await read(); f.explorer.doc = createDocument('Replaced'); return doc; };
  assert.equal((await f.post(download)).status, 400);
  f.explorer.doc = f.doc; f.explorer.readCurrent = async () => { const doc = await read(); f.explorer.doc = { ...f.doc, revision: 1 }; return doc; };
  assert.equal((await f.post(download)).status, 400);
  f.explorer.doc = f.doc; f.explorer.readCurrent = read;
  const disk = structuredClone(f.doc); disk.revision++; await writeFile(f.file, JSON.stringify(disk)); assert.equal((await f.post(download)).status, 400);
});

test('preview digest distinguishes original selected identities even when projected content is identical', async t => {
  const f = await setup(t); const doc = structuredClone(f.doc); doc.nodes[2].question = doc.nodes[1].question; doc.nodes[2].category = doc.nodes[1].category; doc.nodes[2].answerState = 'assumption'; doc.nodes[2].answer = 'Saved answer λ'; doc.nodes[2].review = true;
  await writeFile(f.file, JSON.stringify(doc)); f.explorer.doc = doc;
  const first = { ...f.input, selection: [f.selection[0]] }, preview = await f.post(first).then(r => r.json());
  const changed = { ...first, action: 'download', digest: preview.digest, selection: [{ ...first.selection[0], nodeId: f.b.id }] };
  assert.equal((await f.post(changed)).status, 400);
});

test('viewer HTTP previews importance and rejects a changed historical assessment with the old digest', async t => {
  const f = await setup(t), doc = structuredClone(f.doc), node = doc.nodes[1];
  node.importance = 'high'; node.importanceReason = '<script>Historical consequence</script>';
  node.generation = { requestId: 'imported-request', originalQuestion: node.question, originalCategory: node.category, adjusted: false };
  await writeFile(f.file, JSON.stringify(doc)); f.explorer.doc = doc;
  const preview = await f.post().then(r => r.json());
  assert.equal(preview.snapshot.nodes[0].importance, 'high'); assert.equal(preview.snapshot.nodes[0].importanceReason, node.importanceReason);
  const download = { ...f.input, action: 'download', digest: preview.digest };
  assert.equal((await f.post(download)).status, 200);
  node.importanceReason = 'Changed historical consequence';
  await writeFile(f.file, JSON.stringify(doc)); f.explorer.doc = doc;
  assert.equal((await f.post(download)).status, 400, 'projection freshness catches even unchanged revision');
});
