import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { createDocument, addQuestions, addDirection } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { visualExport, visualSnapshot, visualLayout } from '../com.github.copilot/extensions/explorer/visual-export.mjs';

const hostile = 'λ 中文 🌿 " #quot; [end] `click` <script>alert(1)</script> & </text>\nNext\u0000\u000bEnd';
function document() {
  const doc = createDocument('ANCESTOR_CANARY', { objective: 'GUIDANCE_CANARY' });
  const [a, b] = addQuestions(doc, doc.rootId, [{ question: hostile, category: 'Category & "' }, { question: 'SIBLING_CANARY', category: 'Other' }]);
  a.answer = 'Saved answer λ'; a.answerState = 'assumption'; a.review = true;
  const c = addDirection(doc, a.id, 'User direction');
  b.answer = 'SIBLING_ANSWER_CANARY';
  return { doc, a, c };
}
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-visual-')), file = join(dir, 'map.explore.json');
  const f = document(); await writeFile(file, JSON.stringify(f.doc));
  const explorer = await new Explorer({ file }).load(), server = await startServer(explorer, { close() {} });
  t.after(async () => { await server.close(); await rm(dir, { recursive: true, force: true }); });
  const input = { format: 'canvas', scope: 'branch', nodeId: f.a.id, journey: f.doc.id, revision: 0 };
  const post = (value = input, headers = {}) => fetch(server.url + 'api/visual-export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin, ...headers }, body: JSON.stringify(value) });
  return { ...f, explorer, server, file, input, post };
}

test('visual HTTP exports include exact saved subtree roles/states without ancestor, private metadata or original IDs', async t => {
  const f = await setup(t);
  f.explorer.privateHelper = 'HELPER_CANARY'; f.explorer.projectCapture = 'PROJECT_CANARY';
  for (const format of ['canvas', 'mermaid', 'svg', 'print']) {
    const r = await f.post({ ...f.input, format }); assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="exploration-branch\.(canvas|mmd|svg|html)"$/);
    const text = await r.text(); assert.ok(!/CANARY/.test(text));
    assert.match(text, /Downstream impact unavailable/);
    assert.ok(!text.includes(f.a.id)); assert.ok(!text.includes(f.doc.id));
    assert.ok(!text.includes('http://127.0.0.1')); assert.ok(!text.includes(f.server.url));
    if (format === 'canvas') {
      const value = JSON.parse(text); assert.equal(value.nodes.length, 2); assert.equal(value.edges.length, 1);
      assert.match(value.nodes[0].text, /Question/); assert.match(value.nodes[0].text, /Assumption/); assert.match(value.nodes[0].text, /Needs review/);
      assert.match(value.nodes[1].text, /Direction/); assert.match(value.nodes[0].text, /Saved answer λ/);
      for (const node of value.nodes) { assert.equal(node.type, 'text'); for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isInteger(node[key])); assert.ok(node.width > 0 && node.height > 0); }
      const ids = new Set(value.nodes.map(n => n.id)); assert.equal(ids.size, 2);
      for (const edge of value.edges) { assert.ok(ids.has(edge.fromNode)); assert.ok(ids.has(edge.toNode)); }
      assert.ok(!value.nodes[0].text.includes('<script>'));
    }
    if (format === 'svg' || format === 'print') {
      const dom = new JSDOM(text, format === 'svg' ? { contentType: 'image/svg+xml' } : {});
      assert.match(dom.window.document.documentElement.textContent, /Downstream impact unavailable/);
      assert.equal(dom.window.document.querySelector('script,foreignObject,image,a,link,iframe'), null);
      assert.match(dom.window.document.documentElement.textContent.replace(/\n/g, ''), /<script>alert\(1\)<\/script>/);
      assert.match(dom.window.document.documentElement.textContent, /Saved answer λ/);
      assert.equal(dom.window.document.querySelector('[href],[src],[onload],[onclick]'), null);
      if (format === 'print') { assert.match(dom.window.document.body.textContent, /Save as PDF/); assert.equal(dom.window.document.querySelectorAll('article').length, 2); }
      dom.window.close();
    }
  }
  const native = await fetch(f.server.url + 'export.json').then(r => r.json()); assert.equal(native.nodes.length, 4);
  assert.match(await fetch(f.server.url + 'export.md').then(r => r.text()), /SIBLING/);
});

test('visual route rejects unauthorized, malformed, stale and switched journeys including during disk read', async t => {
  const f = await setup(t);
  assert.equal((await f.post(f.input, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.post(f.input, { 'X-Explorer-Client': '0' })).status, 403);
  for (const input of [{ ...f.input, extra: 'bad' }, { ...f.input, scope: 'viewport' }, { ...f.input, nodeId: 'missing' }, { ...f.input, journey: 'wrong' }, { ...f.input, revision: 1 }, { ...f.input, format: 'pdf' }]) assert.equal((await f.post(input)).status, 400);
  const read = f.explorer.readCurrent.bind(f.explorer);
  f.explorer.readCurrent = async () => { const doc = await read(); f.explorer.doc = createDocument('SWITCHED_CANARY'); return doc; };
  assert.equal((await f.post()).status, 400);
  f.explorer.doc = f.doc; f.explorer.readCurrent = read;
  f.explorer.readCurrent = async () => { const doc = await read(); f.explorer.doc = { ...f.explorer.doc, revision: 1 }; return doc; };
  assert.equal((await f.post()).status, 400);
  f.explorer.doc = f.doc; f.explorer.readCurrent = read;
  const disk = structuredClone(f.doc); disk.revision++; await writeFile(f.file, JSON.stringify(disk));
  assert.equal((await f.post()).status, 400);
});

test('visual projection is allowlisted, deterministic and preserves selected direction role without ancestor metadata', () => {
  const { doc, a, c } = document();
  Object.assign(doc, { token: 'TOKEN_CANARY', endpoint: 'ENDPOINT_CANARY', drafts: ['DRAFT_CANARY'], handoff: { secret: 'HANDOFF_CANARY' }, project: { excerpt: 'PROJECT_CANARY' } });
  Object.assign(a, { research: { proposedAnswer: 'PROPOSED_CANARY' }, rationale: 'RATIONALE_CANARY', generation: { secret: 'GENERATION_CANARY' }, privateReference: 'REFERENCE_CANARY' });
  const input = { scope: 'branch', nodeId: a.id }, snapshot = visualSnapshot(doc, input);
  assert.deepEqual(snapshot.nodes.map(n => [n.id, n.parentId, n.role, n.status, n.review]), [['n0', null, 'question', 'Assumption', true], ['n1', 'n0', 'direction', 'Direction (user supplied)', false]]);
  assert.ok(!JSON.stringify(snapshot).includes('CANARY')); assert.ok(!JSON.stringify(snapshot).includes(a.id));
  assert.equal(snapshot.nodes[0].question, hostile.replace(/[\u0000\u000b]/g, '\ufffd'));
  for (const format of ['mermaid', 'canvas', 'svg', 'print']) {
    const first = visualExport(doc, { ...input, format });
    doc.collapsed = [doc.rootId, a.id]; doc.focusId = c.id; doc.viewport = { width: 1 };
    assert.deepEqual(visualExport(doc, { ...input, format }), first);
  }
  const direction = visualSnapshot(doc, { scope: 'branch', nodeId: c.id });
  assert.equal(direction.nodes[0].role, 'direction'); assert.equal(direction.nodes[0].parentId, null);
});

function tree(count, deep = false, answer = '') {
  const doc = createDocument('Map');
  for (let i = 1; i < count; i++) doc.nodes.push({ id: `original-${i}`, parentId: deep ? doc.nodes[i - 1].id : doc.rootId, question: `Question ${i}`, category: 'General', answer, research: null, review: false });
  return doc;
}
test('visual full layout covers wide/deep maps with nonoverlapping integer boxes and connected in-bounds paths', () => {
  for (const doc of [tree(200), tree(250, true), tree(2, false, '文🌿'.repeat(5000))]) {
    const snapshot = visualSnapshot(doc, { scope: 'whole', nodeId: null }), scene = visualLayout(snapshot);
    for (const box of scene.positions.values()) { assert.ok(box.x >= 0 && box.y >= 0); assert.ok(box.x + box.width <= scene.width && box.y + box.height <= scene.height); }
    const boxes = [...scene.positions.values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]; assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
    const value = JSON.parse(visualExport(doc, { format: 'canvas', scope: 'whole', nodeId: null }).content);
    assert.equal(value.nodes.length, doc.nodes.length); assert.equal(value.edges.length, doc.nodes.length - 1);
    const svg = new JSDOM(visualExport(doc, { format: 'svg', scope: 'whole', nodeId: null }).content, { contentType: 'image/svg+xml' });
    assert.equal(svg.window.document.querySelectorAll('path').length, doc.nodes.length - 1); assert.equal(svg.window.document.querySelectorAll('g').length, doc.nodes.length);
    assert.deepEqual(svg.window.document.documentElement.getAttribute('viewBox').split(' ').map(Number), [0, 0, scene.width, scene.height]);
    svg.window.close();
  }
});

test('visual caps reject excessive nodes, projected UTF-8, geometry and formatted bytes without truncating', () => {
  const input = { scope: 'whole', nodeId: null, format: 'svg' };
  assert.throws(() => visualExport(tree(501), input), /smaller branch/);
  assert.throws(() => visualExport(tree(100, false, '文'.repeat(10000)), input), /size limit/);
  assert.throws(() => visualExport(tree(240), input), /size limit/);
  assert.throws(() => visualExport(tree(500, true), input), /size limit/);
  // Small projected text, but XML element overhead expands beyond the final cap.
  const expansive = tree(20, false, '\n'.repeat(4000));
  assert.throws(() => visualExport(expansive, input), /size limit/);
  // Mermaid doesn't need geometry; its own output expansion is still bounded.
  assert.throws(() => visualExport(tree(50, false, '~'.repeat(19000)), { ...input, format: 'mermaid' }), /size limit/);
  const boundary = visualExport(tree(500), { ...input, format: 'mermaid' }); assert.match(boundary.content, /n499/);
});
