import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { optionFindings } from './helpers/research-options.mjs';
import { research, createDocument, addQuestions, validateDocument, importedDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { viewerSnapshot, viewerArtifact } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
import { prepareFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { confirmAnswer } from './helpers/answer-change.mjs';

function documentWith(value) {
  const doc = createDocument('Neighborhood tool library');
  const node = addQuestions(doc, doc.rootId, [{ question: 'Where should tools stay?', category: 'Storage' }])[0];
  node.research = value;
  return { doc, node };
}

test('concise options preserve stable identities and fit through reordered native and imported records', () => {
  const value = optionFindings();
  assert.deepEqual(research(value), value);
  const { doc } = documentWith(value);
  for (const read of [validateDocument, importedDocument]) assert.deepEqual(read(JSON.parse(JSON.stringify(doc))).nodes[1].research, value);
  value.options.reverse();
  assert.deepEqual(research(value).options.map(o => [o.id, o.fit]), value.options.map(o => [o.id, o.fit]));
});

test('concise options accept an honest zero or one option outcome without manufacturing alternatives', () => {
  for (const count of [0, 1]) {
    const value = optionFindings(); value.options.length = count; value.optionsLimit = 'Access is unconfirmed; more choices would be speculative.';
    assert.deepEqual(research(value), value);
    delete value.optionsLimit; assert.throws(() => research(value), /limit/i);
  }
  const value = optionFindings(); value.options = []; value.optionsLimit = 'No supported choice.'; value.proposedAnswer = 'Pretend we chose.';
  assert.throws(() => research(value), /answer/i);
});

test('concise options reject duplicate identities or normalized choices, unsupported fields and broken references', () => {
  const changes = [
    r => r.optionsVersion = 2, r => delete r.optionsVersion, r => delete r.claims,
    r => r.options[1].id = r.options[0].id, r => r.options[0].id = '<img>', r => r.options[0].id = 'x'.repeat(33),
    r => r.options[1].title = '  USE   ONE SHARED CUPBOARD  ',
    r => r.options[1].proposedAnswer = r.options[0].proposedAnswer.toUpperCase(),
    r => delete r.options[0].fit, r => delete r.options[0].proposedAnswer,
    r => r.options[0].fit = ' ', r => r.options[0].winner = true, r => r.options[0].claimIds = ['missing'],
    r => r.optionsLimit = 'Unneeded limitation at a normal count.',
    r => r.claims[0].evidence = [{ sourceId: 'missing', paraphrase: 'Unsupported.' }],
  ];
  for (const change of changes) { const value = optionFindings(); change(value); assert.throws(() => research(value), change.toString()); }
});

test('concise option bounds accept exact field limits and reject overflow without clipping', () => {
  const limits = { title: 150, description: 600, fit: 400, proposedAnswer: 1000 };
  for (const [field, max] of Object.entries(limits)) {
    const value = optionFindings(); value.options[0][field] = '界'.repeat(max);
    assert.equal(research(value).options[0][field], value.options[0][field]);
    value.options[0][field] += '界'; assert.throws(() => research(value));
  }
  for (const field of ['pros', 'cons']) {
    const value = optionFindings(); value.options[0][field] = Array(4).fill('界'.repeat(240));
    assert.deepEqual(research(value).options[0][field], value.options[0][field]);
    value.options[0][field][0] += '界'; assert.throws(() => research(value));
    value.options[0][field] = Array(5).fill('Small'); assert.throws(() => research(value));
  }
  const value = optionFindings(); value.options.length = 1; value.optionsLimit = '界'.repeat(600); assert.equal(research(value).optionsLimit, value.optionsLimit);
  value.optionsLimit += '界'; assert.throws(() => research(value));
});

test('legacy research stays exact without invented fit or option identities', () => {
  const value = optionFindings(); delete value.optionsVersion; delete value.claims;
  for (const option of value.options) { delete option.id; delete option.fit; }
  value.options[0].description = '界'.repeat(3000); value.options[0].pros = Array(6).fill('p'.repeat(1000));
  assert.deepEqual(research(value), value);
  assert.equal(Object.hasOwn(research(value).options[0], 'id'), false);
  const { doc } = documentWith(value); assert.deepEqual(validateDocument(doc).nodes[1].research, value);
});

test('concise option identity and sparse limitations survive saved history and native reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-options-'));
  t.after(async () => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  const value = optionFindings(); value.options.length = 1; value.optionsLimit = 'Local access needs confirmation.';
  const { doc, node } = documentWith(value), library = new Library(directory), record = await library.import(doc);
  const explorer = await new Explorer({ file: record.file }).load();
  t.after(() => explorer.close());
  await confirmAnswer(explorer, { revision: explorer.doc.revision, nodeId: node.id, answer: 'My independent answer' });
  assert.deepEqual((await explorer.readHistory(explorer.doc.id, 0)).document.nodes[1].research, value);
  const reopened = await new Explorer({ file: record.file }).load(); t.after(() => reopened.close());
  assert.deepEqual(reopened.doc.nodes[1].research, value); assert.equal(reopened.doc.nodes[1].answer, 'My independent answer');
});

test('concise option exports preserve literal fit and sparse limits while offline identities stay private', () => {
  const value = optionFindings(); value.options.length = 1; value.optionsLimit = 'Need access evidence <script>🌿</script>';
  value.options[0].id = 'PRIVATE_OPTION_ID'; value.options[0].fit = 'Fits 中文 <img src=x onerror=bad()> 🌿';
  const { doc, node } = documentWith(value), markdown = toMarkdown(validateDocument(doc));
  assert.match(markdown, /Need access evidence/); assert.match(markdown, /Fits 中文/); assert.ok(markdown.includes('\\<img src=x onerror=bad()\\>'));
  const snapshot = viewerSnapshot(doc, [{ nodeId: node.id, answer: false, research: true }]);
  assert.equal(snapshot.nodes[0].research.options[0].fit, value.options[0].fit);
  assert.equal(snapshot.nodes[0].research.optionsLimit, value.optionsLimit);
  const html = viewerArtifact(snapshot).content; assert.ok(!html.includes('PRIVATE_OPTION_ID'));
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  try { const detail = dom.window.document.getElementById('detail'); assert.ok(detail.textContent.includes(value.options[0].fit)); assert.ok(detail.textContent.includes(value.optionsLimit)); assert.equal(detail.querySelector('img,script'), null); }
  finally { dom.window.close(); }
});

test('follow-up context keeps the sparse-result limitation and existing stable option IDs', () => {
  for (const count of [0, 1]) {
    const value = optionFindings(); value.options.length = count; value.optionsLimit = 'Only local access evidence can resolve this.';
    const { doc, node } = documentWith(value);
    const prepared = prepareFollowup(doc, node.id, { question: 'What is missing?', hypothetical: false });
    assert.equal(prepared.followup.optionsLimit, value.optionsLimit);
    assert.equal(prepared.followup.optionsVersion, 1);
    assert.deepEqual(prepared.followup.original.filter(item => item.kind === 'option').map(item => item.option.id), value.options.map(o => o.id));
    assert.equal(prepared.followup.coverage.originalOmitted, 0);
  }
});
