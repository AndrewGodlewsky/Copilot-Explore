import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { request } from 'node:http';
import { createDocument, validateDocument, addQuestions, answerNode, research, toMarkdown, contextFor } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { explorerCanvas } from '../com.github.copilot/extensions/explorer/canvas.mjs';
import { layout } from '../com.github.copilot/extensions/explorer/web/layout.mjs';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';

test('answer states validate all text combinations and preserve explicit choices', () => {
  for (const state of ['unanswered', 'decided', 'tentative', 'assumption', 'needs-evidence', 'not-relevant', 'revisit-later']) {
    for (const answer of ['', '  A note 🌿\n']) {
      const doc = createDocument('Topic'), [node] = addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }]);
      const invalid = !answer && ['decided', 'tentative', 'assumption'].includes(state) || answer && state === 'unanswered';
      if (invalid) {
        assert.throws(() => answerNode(doc, node.id, answer, state), /text|clear/i);
        Object.assign(node, { answer, answerState: state }); assert.throws(() => validateDocument(doc), /text|clear/i); continue;
      }
      answerNode(doc, node.id, answer, state);
      assert.equal(model.effectiveAnswerState(node), state);
      const imported = validateDocument(JSON.parse(JSON.stringify(doc)));
      assert.equal(model.effectiveAnswerState(imported.nodes[1]), state); assert.equal(imported.nodes[1].answer, answer);
      if (answer) { answerNode(doc, node.id, 'Changed note'); assert.equal(model.effectiveAnswerState(node), state); }
    }
  }
  const doc = createDocument('Topic'), [node] = addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }]);
  for (const value of [null, '', 'confident', 3, ['unanswered']]) { node.answerState = value; assert.throws(() => validateDocument(doc), /state/i); }
  delete node.answerState; answerNode(doc, node.id, 'New text'); assert.equal(model.effectiveAnswerState(node), 'tentative');
  assert.throws(() => answerNode(doc, doc.rootId, '', 'not-relevant'), /question/);
});

test('legacy answer state defaults remain sparse at the saved-data boundary', () => {
  const doc = createDocument('Topic');
  for (let i = 0; i < 4800; i++) doc.nodes.push({ id: `q${i}`, parentId: doc.rootId, question: 'Question?', category: 'Scope', answer: 'x'.repeat(1750), research: null, review: false });
  let remaining = model.MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(doc, null, 2)) - 20;
  for (const node of doc.nodes.slice(1)) { const add = Math.min(remaining, 20000 - node.answer.length); node.answer += 'x'.repeat(add); remaining -= add; if (!remaining) break; }
  const imported = validateDocument(doc);
  assert.equal(model.effectiveAnswerState(imported.nodes[1]), 'tentative');
  assert.equal(model.effectiveAnswerState(imported.nodes[0]), 'unanswered');
  assert.ok(!Object.hasOwn(imported.nodes[1], 'answerState'));
  assert.ok(Buffer.byteLength(JSON.stringify(imported, null, 2)) <= model.MAX_DOCUMENT_BYTES);
});

test('answer counts exclude root and distinguish resolved, answered, deferred and review', () => {
  const doc = createDocument('Topic'); doc.nodes[0].answer = 'Legacy root text';
  const rows = [['decided', 'Choice', false], ['decided', 'Old choice', true], ['not-relevant', '', false], ['tentative', 'Maybe', false], ['revisit-later', '', false], ['unanswered', '', false], ['assumption', 'Guess', false], ['needs-evidence', '', false]];
  rows.forEach(([answerState, answer, review], i) => doc.nodes.push({ id: `q${i}`, parentId: doc.rootId, question: `Question ${i}`, category: 'Scope', answerState, answer, review, research: null }));
  assert.deepEqual(model.questionCounts(doc), { total: 8, answered: 4, resolved: 2, deferred: 1, unresolved: 6 });
  const context = contextFor(doc, 'q3');
  assert.ok(context.decisionsElsewhere.some(n => n.answerState === 'not-relevant' && n.answer === ''));
  assert.ok(context.decisionsElsewhere.some(n => n.answerState === 'revisit-later'));
  assert.equal(context.path.at(-1).answerState, 'tentative'); assert.ok(!Object.hasOwn(context.path[0], 'answerState'));
  const markdown = toMarkdown(doc);
  for (const label of ['Decided', 'Tentative', 'Assumption', 'Need evidence', 'Not relevant', 'Revisit later', 'Unanswered']) assert.ok(markdown.includes(label));
  assert.match(markdown, /4 answered.*2 resolved.*1 deferred.*6 unresolved/);
});

test('state-only answer saves mark descendants, no-ops preserve finish and check disk freshness', async t => {
  const { explorer: e, messages } = await started(t), id = e.doc.nodes[1].id;
  await e.command('add', { revision: e.doc.revision, nodeId: id, question: 'Next?', category: 'Scope' });
  await e.command('answer', { revision: e.doc.revision, nodeId: id, answer: '', answerState: 'needs-evidence', expand: true });
  assert.equal(e.doc.nodes[1].answerState, 'needs-evidence'); assert.equal(e.doc.nodes[2].review, true);
  assert.equal(messages.at(-1).mode, 'enqueue'); assert.match(messages.at(-1).prompt, /needs-evidence/);
  await e.command('cancel'); await e.command('finish', { revision: e.doc.revision });
  const before = structuredClone(e.doc);
  await e.command('answer', { revision: e.doc.revision, nodeId: id, answer: '', answerState: 'needs-evidence' });
  assert.deepEqual(e.doc, before);
  const other = await new Explorer({ file: e.file }).load();
  await other.command('answer', { revision: other.doc.revision, nodeId: id, answer: '', answerState: 'not-relevant' });
  await assert.rejects(e.command('answer', { revision: e.doc.revision, nodeId: id, answer: '', answerState: 'needs-evidence' }), /updated|changed/);
  await e.command('refresh-answer', { revision: e.doc.revision }); assert.equal(e.doc.nodes[1].answerState, 'not-relevant');
});

test('unanswered save-and-deepen is rejected before saving or starting questions', async t => {
  const { explorer: e } = await started(t), before = structuredClone(e.doc);
  await assert.rejects(e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: '', answerState: 'unanswered', expand: true }), /state|answer/i);
  assert.deepEqual(e.doc, before); assert.equal(e.pending, null);
});

const question = { question: 'Who will use it first?', category: 'People' };
const findings = { basis: 'reasoning', summary: 'Compare two possible audiences.', options: [
  { title: 'Individuals', description: 'Start with personal use.', pros: ['Easy to recruit'], cons: ['Less feedback per team'] },
  { title: 'Teams', description: 'Start with a small team.', pros: ['Shared learning'], cons: ['More coordination'] },
], recommendation: 'Start with individuals to learn quickly.', uncertainty: 'No external sources were consulted.', sources: [] };
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-test-'));
  const messages = [];
  const explorer = await new Explorer({ file: join(dir, 'map.explore.json'), send: async value => messages.push(value), target: { canvasId: 'explorer', instanceId: 'test' }, ...options }).load();
  t.after(async () => { await explorer.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  return { explorer, dir, messages };
}
async function started(t, options) {
  const f = await fixture(t, options);
  await f.explorer.command('start', { topic: 'A community garden 🌿' });
  await f.explorer.receive('questions', { requestId: f.explorer.pending.id, questions: [question] });
  await f.explorer.command('accept-questions', { revision: f.explorer.doc.revision, batchId: f.explorer.preview.id, selected: f.explorer.preview.questions.map((q, index) => ({ index, question: q.question })) });
  return f;
}
test('legacy guidance defaults to empty and invalid explicit guidance is rejected', () => {
  const legacy = createDocument('Garden'); delete legacy.objective; delete legacy.successCriteria;
  assert.equal(validateDocument(legacy).objective, '');
  assert.equal(validateDocument(legacy).successCriteria, '');
  for (const [field, value] of [['objective', null], ['objective', 'x'.repeat(2001)], ['successCriteria', []], ['successCriteria', 'x'.repeat(4001)]]) {
    assert.throws(() => validateDocument({ ...legacy, [field]: value }), /text/);
  }
});
test('committed Unicode guidance survives JSON and Markdown and enters question context', () => {
  const doc = createDocument('Garden', { objective: 'Decide for neighbors 🌿', successCriteria: 'Accessible to all; cost ≤ $50' });
  const imported = validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.equal(imported.objective, 'Decide for neighbors 🌿');
  assert.equal(imported.successCriteria, 'Accessible to all; cost ≤ $50');
  assert.match(toMarkdown(imported), /Objective[\s\S]*Decide for neighbors 🌿/);
  assert.match(toMarkdown(imported), /Success criteria[\s\S]*Accessible to all; cost ≤ \$50/);
  assert.equal(contextFor(imported, imported.rootId).objective, imported.objective);
  assert.equal(contextFor(imported, imported.rootId).successCriteria, imported.successCriteria);
});
test('guidance retains user whitespace and Unicode through create and edit', async t => {
  const { explorer } = await fixture(t);
  await explorer.command('start', { topic: 'Garden', objective: '  Decide 🌿\n', successCriteria: '\nEnough detail  ' });
  assert.equal(explorer.doc.objective, '  Decide 🌿\n');
  await explorer.command('cancel');
  await explorer.command('guidance', { revision: explorer.doc.revision, objective: '  Decide 🌿\n', successCriteria: '  Compare costs\n' });
  assert.equal(explorer.doc.successCriteria, '  Compare costs\n');
  assert.equal(validateDocument(JSON.parse(await readFile(explorer.file, 'utf8'))).objective, '  Decide 🌿\n');
});
test('guidance edits are revision checked, no-op safe, and clear finished state without changing nodes', async t => {
  const { explorer, messages } = await started(t);
  await explorer.command('finish', { revision: explorer.doc.revision });
  const before = structuredClone(explorer.doc);
  await explorer.command('guidance', { revision: before.revision, objective: '', successCriteria: '' });
  assert.equal(explorer.doc.revision, before.revision);
  await explorer.command('guidance', { revision: before.revision, objective: 'Find a practical plan', successCriteria: 'Fits one weekend' });
  assert.equal(explorer.doc.revision, before.revision + 1);
  assert.equal(explorer.doc.finishedAt, null);
  assert.deepEqual(explorer.doc.nodes, before.nodes);
  await assert.rejects(explorer.command('guidance', { revision: before.revision, objective: 'stale', successCriteria: '' }), /changed/);
  assert.equal(messages.length, 1);
  const saved = JSON.parse(await readFile(explorer.file, 'utf8'));
  assert.equal(saved.objective, 'Find a practical plan');
});
test('stale no-op guidance save rejects another canvas revision without editing the file', async t => {
  const { explorer } = await started(t);
  const stale = await new Explorer({ file: explorer.file }).load();
  await explorer.command('guidance', { revision: explorer.doc.revision, objective: 'New objective', successCriteria: '' });
  const disk = await readFile(explorer.file, 'utf8');
  await assert.rejects(stale.command('guidance', { revision: stale.doc.revision, objective: '', successCriteria: '' }), /Another canvas/);
  assert.equal(await readFile(explorer.file, 'utf8'), disk);
  assert.equal(stale.doc.revision + 1, explorer.doc.revision);
});
test('refreshing a stale guidance writer rebases on a newer answer and keeps identity', async t => {
  const { explorer } = await started(t), nodeId = explorer.doc.nodes[1].id;
  const stale = await new Explorer({ file: explorer.file }).load();
  await explorer.command('answer', { revision: explorer.doc.revision, nodeId, answer: 'Other canvas answer' });
  const refreshed = await stale.command('refresh-guidance', { revision: stale.doc.revision });
  assert.equal(refreshed.document.id, explorer.doc.id);
  assert.equal(refreshed.document.nodes[1].answer, 'Other canvas answer');
  assert.equal(refreshed.document.revision, explorer.doc.revision);
  await stale.command('guidance', { revision: refreshed.document.revision, objective: 'My objective', successCriteria: 'One clear option' });
  assert.equal(stale.doc.nodes[1].answer, 'Other canvas answer');
  assert.equal(stale.doc.objective, 'My objective');
});
test('guidance reaches queued questions and native HTTP exports without draft text', async t => {
  const { explorer, messages } = await started(t);
  await explorer.command('guidance', { revision: explorer.doc.revision, objective: 'Choose a garden 🌿', successCriteria: 'One practical location' });
  await explorer.command('questions', { revision: explorer.doc.revision, nodeId: explorer.doc.rootId });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(messages.at(-1).prompt, /Choose a garden 🌿/);
  assert.match(messages.at(-1).prompt, /One practical location/);
  const server = await startServer(explorer); t.after(() => server.close());
  const native = await (await fetch(server.url + 'export.json')).json();
  assert.equal(native.objective, 'Choose a garden 🌿');
  assert.equal(native.successCriteria, 'One practical location');
  const markdown = await (await fetch(server.url + 'export.md')).text();
  assert.match(markdown, /Choose a garden 🌿/);
  assert.match(markdown, /One practical location/);
});
test('answers grow arbitrarily deep branches; changing an ancestor flags descendants without deleting them', () => {
  const doc = createDocument('A garden'); let parent = doc.rootId;
  for (let i = 0; i < 150; i++) { const [child] = addQuestions(doc, parent, [{ question: `Question ${i}`, category: 'Depth' }]); answerNode(doc, child.id, `Answer ${i}`); parent = child.id; }
  answerNode(doc, doc.nodes[1].id, 'A revised decision');
  assert.equal(doc.nodes.length, 151); assert.equal(doc.nodes.at(-1).review, true); assert.equal(doc.nodes[1].review, false);
  assert.equal(validateDocument(doc).nodes.length, 151);
  assert.equal(layout(doc.nodes, doc.rootId).size, 151);
});
test('JSON round trip and Markdown preserve all questions, answers, research, uncertainty and edges', () => {
  const doc = createDocument('Garden <plan>');
  const [node] = addQuestions(doc, doc.rootId, [question]); answerNode(doc, node.id, 'Neighbors 🌿\nWith shared plots.'); node.research = research(findings);
  addQuestions(doc, node.id, [{ question: 'What space is available?', category: 'Space' }]);
  const imported = validateDocument(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(imported, doc);
  const md = toMarkdown(doc);
  for (const value of ['Neighbors 🌿', 'shared plots.', 'What space is available?', 'No external sources', 'Individuals', 'No answer text', '| N2 | N1 |']) assert.ok(md.includes(value), value);
  assert.ok(md.includes('Garden \\<plan\\>'));
});
test('imports reject unknown versions, duplicates, dangling parents and disconnected cycles', () => {
  const doc = createDocument('Garden'); const [node] = addQuestions(doc, doc.rootId, [question]);
  for (const mutate of [d => d.version = 2, d => d.nodes.push(d.nodes[1]), d => d.nodes[1].parentId = 'missing', d => d.nodes[1].parentId = node.id, d => d.topic = 'different']) {
    const bad = structuredClone(doc); mutate(bad); assert.throws(() => validateDocument(bad));
  }
});
test('research rejects unsafe links, missing consulted sources, and empty option sets', () => {
  assert.throws(() => research({ ...findings, basis: 'sources' }), /source/);
  assert.throws(() => research({ ...findings, sources: [{ title: 'Bad', url: 'javascript:alert(1)' }] }), /HTTP/);
  assert.throws(() => research({ ...findings, options: [] }), /two options/);
  assert.equal(research({ ...findings, basis: 'sources', sources: [{ title: 'Reference', url: 'https://example.com' }] }).basis, 'sources');
});
test('duplicate generated questions are not appended', () => {
  const doc = createDocument('Garden'); addQuestions(doc, doc.rootId, [question, question]);
  assert.equal(doc.nodes.length, 2); assert.throws(() => addQuestions(doc, doc.rootId, [question]), /already exist/);
});
test('queued generation and isolated research persist across reopen', async t => {
  const { explorer, messages } = await started(t, { researcher: { run: async () => findings } });
  assert.equal(messages[0].mode, 'enqueue'); assert.match(messages[0].prompt, /submit_questions/);
  const node = explorer.doc.nodes[1];
  await explorer.command('answer', { revision: explorer.doc.revision, nodeId: node.id, answer: 'Neighbors', expand: true });
  assert.match(messages.at(-1).prompt, /Neighbors/);
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ question: 'How will neighbors join?', category: 'Access' }] });
  await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: [{ index: 0, question: explorer.preview.questions[0].question }] });
  await explorer.command('research', { revision: explorer.doc.revision, nodeId: node.id });
  await Promise.all([...explorer.researchTasks]);
  const reopened = await new Explorer({ file: explorer.file }).load();
  assert.deepEqual(reopened.doc, explorer.doc); assert.equal(reopened.doc.nodes[1].answer, 'Neighbors');
  await explorer.command('finish', { revision: explorer.doc.revision });
  assert.match(await readFile(explorer.file.replace('.explore.json', '.md'), 'utf8'), /Neighbors/);
});
test('cancellation rejects late results, and stale UI writes preserve saved state', async t => {
  const { explorer } = await fixture(t);
  await explorer.command('start', { topic: 'Garden' }); const old = explorer.pending.id;
  await explorer.command('cancel');
  await assert.rejects(explorer.receive('questions', { requestId: old, questions: [question] }), /cancelled/);
  await assert.rejects(explorer.command('add', { revision: 0, nodeId: explorer.doc.rootId, ...question }), /changed/);
  assert.equal(explorer.doc.nodes.length, 1);
});
test('pending requests reject conflicting mutations; incorrect callbacks remain retryable', async t => {
  const { explorer } = await fixture(t); await explorer.command('start', { topic: 'Garden' });
  const id = explorer.pending.id;
  await assert.rejects(explorer.command('import', { revision: explorer.doc.revision, document: createDocument('Other') }), /Wait/);
  await assert.rejects(explorer.receive('questions', { requestId: id, questions: [] }), /least/);
  assert.equal(explorer.pending.id, id);
  await explorer.receive('questions', { requestId: id, questions: [question] }); assert.equal(explorer.pending, null);
});
test('delivery failure and timeout retain the map and make retries available', async t => {
  const { explorer } = await fixture(t, { send: async () => { throw new Error('offline'); } });
  await explorer.command('start', { topic: 'Garden' }); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(explorer.pending, null); assert.match(explorer.error, /offline/); assert.equal(explorer.doc.topic, 'Garden');
  explorer.send = async () => {}; explorer.timeoutMs = 10;
  await explorer.command('questions', { revision: explorer.doc.revision, nodeId: explorer.doc.rootId });
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(explorer.pending, null); assert.match(explorer.error, /not returned/);
});
test('corrupt persistence is preserved; disk revision and lock protect competing writers', async t => {
  const { explorer, dir } = await started(t);
  const second = await new Explorer({ file: explorer.file }).load();
  await explorer.command('answer', { revision: explorer.doc.revision, nodeId: explorer.doc.nodes[1].id, answer: 'A' });
  await assert.rejects(second.command('answer', { revision: second.doc.revision, nodeId: second.doc.nodes[1].id, answer: 'B' }), /Another canvas/);
  await writeFile(explorer.file + '.lock', 'fixture');
  await assert.rejects(explorer.command('finish', { revision: explorer.doc.revision }), /Another writer/);
  const broken = join(dir, 'broken.explore.json'); await writeFile(broken, '{broken');
  await assert.rejects(new Explorer({ file: broken }).load(), /preserved/); assert.equal(await readFile(broken, 'utf8'), '{broken');
});
test('HTTP serves real assets and exports; protects token, origin, host and static paths', async t => {
  const { explorer } = await started(t); const server = await startServer(explorer); t.after(() => server.close());
  assert.match(await (await fetch(server.url)).text(), /Make room for the questions/);
  assert.equal((await fetch(server.url + 'layout.mjs')).status, 200);
  assert.equal((await fetch(new URL('/api/state', server.url))).status, 404);
  const wrongHost = await new Promise((resolve, reject) => {
    const req = request(server.url + 'api/state', { headers: { Host: 'evil.example' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(wrongHost, 403);
  for (const headers of [{ 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: 'https://evil.example' }]) {
    assert.equal((await fetch(server.url + 'api/action', { method: 'POST', headers, body: JSON.stringify({ action: 'cancel' }) })).status, 403);
  }
  assert.equal((await fetch(server.url + '%2e%2e/controller.mjs')).status, 404);
  const download = await fetch(server.url + 'export.json'); assert.match(download.headers.get('content-disposition'), /\.explore\.json/);
  assert.deepEqual(await download.json(), explorer.doc);
  assert.match(await (await fetch(server.url + 'export.md')).text(), /Who will use it first/);
});
test('navigation settings HTTP uses token, origin and bounded writes with recoverable defaults', async t => {
  const { explorer, dir } = await started(t), server = await startServer(explorer); t.after(() => server.close());
  const endpoint = server.url + 'api/navigation-settings', origin = new URL(server.url).origin;
  assert.equal((await fetch(new URL('/api/navigation-settings', server.url))).status, 404);
  assert.equal((await fetch(server.url + 'navigation.mjs')).status, 200);
  assert.deepEqual(await (await fetch(endpoint)).json(), { settings: { version: 1, revision: 0, wheelMode: 'zoom', sensitivity: 1, motion: 'system' } });
  const input = { revision: 0, wheelMode: 'pan', sensitivity: 1.5, motion: 'reduce' };
  const post = (value, headers = {}) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
  assert.equal((await post(input)).status, 403);
  assert.equal((await post(input, { 'X-Explorer-Client': '1', Origin: 'https://other.example' })).status, 403);
  assert.equal((await post(input, { 'X-Explorer-Client': '1', Origin: origin })).status, 200);
  assert.equal((await post(input, { 'X-Explorer-Client': '1', Origin: origin })).status, 400, 'stale revision');
  assert.equal((await post({ ...input, sensitivity: 0 }, { 'X-Explorer-Client': '1', Origin: origin })).status, 400);
  assert.equal((await post({ ...input, extra: true }, { 'X-Explorer-Client': '1', Origin: origin })).status, 400);
  assert.equal((await post({ ...input, padding: 'x'.repeat(2000) }, { 'X-Explorer-Client': '1', Origin: origin })).status, 400);
  assert.equal((await (await fetch(endpoint)).json()).settings.revision, 1);
  const other = await new Explorer({ file: explorer.file }).load();
  const secondServer = await startServer(other);
  assert.equal((await (await fetch(secondServer.url + 'api/navigation-settings')).json()).settings.wheelMode, 'pan', 'another canvas reads same data root');
  await secondServer.close();
  const before = explorer.snapshot(), file = join(dir, 'navigation-settings.json');
  await writeFile(file, '{broken');
  const fallback = await (await fetch(endpoint)).json();
  assert.equal(fallback.settings.wheelMode, 'zoom'); assert.match(fallback.error, /preserved/i);
  assert.equal((await post({ ...input, revision: 0 }, { 'X-Explorer-Client': '1', Origin: origin })).status, 400);
  assert.equal(await readFile(file, 'utf8'), '{broken');
  assert.deepEqual(explorer.snapshot(), before, 'settings do not edit document or pending context');
});
test('canvas instances are independent, reopen from disk and reject cross-session actions', async t => {
  const { dir } = await fixture(t);
  const extension = explorerCanvas({ createCanvas: options => options, getSession: () => ({ sessionId: 'session', send: async () => {} }), directory: dir }); t.after(() => extension.close());
  const ctx = { sessionId: 'session', extensionId: 'plugin:explorer:explorer', canvasId: 'explorer', instanceId: 'one', input: {} };
  const first = await extension.canvas.open(ctx), second = await extension.canvas.open({ ...ctx, instanceId: 'two' });
  assert.notEqual(first.url, second.url);
  const result = await fetch(first.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'start', topic: 'First' }) });
  assert.equal(result.status, 200);
  const read = extension.canvas.actions.find(a => a.name === 'get_exploration').handler;
  assert.equal(read({ ...ctx, instanceId: 'two' }).document, null);
  assert.throws(() => read({ ...ctx, sessionId: 'wrong' }), /different session/);
  await extension.canvas.onClose(ctx);
  const reopened = await extension.canvas.open(ctx); assert.notEqual(first.url, reopened.url); assert.equal(read(ctx).document.topic, 'First');
});
test('tree layout keeps siblings separated and branches connected below the idea', () => {
  const doc = createDocument('Garden'); const children = addQuestions(doc, doc.rootId, [question, { question: 'What will it cost?', category: 'Cost' }, { question: 'How much space?', category: 'Space' }]);
  addQuestions(doc, children[0].id, [{ question: 'Who maintains it?', category: 'Care' }, { question: 'Who owns it?', category: 'Ownership' }]);
  const positions = layout(doc.nodes, doc.rootId);
  assert.ok(positions.get(children[0].id).y > positions.get(doc.rootId).y + 110);
  assert.ok(positions.get(children[1].id).x > positions.get(children[0].id).x);
  const values = [...positions.values()];
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) assert.ok(Math.abs(values[i].x - values[j].x) >= 220 || Math.abs(values[i].y - values[j].y) >= 110);
});
