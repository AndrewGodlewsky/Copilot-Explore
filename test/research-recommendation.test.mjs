import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { recommendationFindings } from './helpers/research-recommendation.mjs';
import { optionFindings } from './helpers/research-options.mjs';
import { research, createDocument, addQuestions, validateDocument, importedDocument, toMarkdown, answerNode } from '../com.github.copilot/extensions/explorer/model.mjs';
import { viewerSnapshot, viewerArtifact } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
import { prepareFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { confirmAnswer } from './helpers/answer-change.mjs';

function example() {
  const doc = createDocument('Neighborhood tool library');
  const [target, source] = addQuestions(doc, doc.rootId, [{ question: 'Where should tools stay?', category: 'Storage' }, { question: 'Who can open storage?', category: 'Access' }]);
  answerNode(doc, source.id, 'Two nearby neighbors may hold keys.', 'assumption'); source.review = true;
  const value = recommendationFindings();
  value.recommendationAssessment.decisionRefs = [{ nodeId: source.id, reason: 'The proposed two key holders make a shared cupboard plausible, but access is still an assumption.', answerState: 'assumption', review: true }];
  target.research = value;
  return { doc, target, source, value };
}

test('a recommendation identifies one current option and preserves that identity when options reorder', () => {
  const value = recommendationFindings(); assert.deepEqual(research(value), value);
  value.options.reverse(); assert.equal(research(value).recommendationAssessment.optionId, 'cupboard');
  assert.equal(research(value).options.find(o => o.id === 'cupboard').proposedAnswer, value.options[1].proposedAnswer);
  const changes = [
    r => r.recommendationAssessment.optionId = 'missing', r => r.recommendationAssessment.optionId = ['cupboard', 'distributed'],
    r => r.recommendationAssessment.optionIds = ['cupboard'], r => delete r.recommendationAssessment.optionId,
    r => r.recommendationAssessment.mainTradeoff = '', r => delete r.recommendationAssessment.reconsiderIf,
    r => r.recommendationAssessment.decisionRefs = null, r => r.recommendationAssessment = null,
    r => r.proposedAnswer = 'A competing draft unrelated to the referenced choice.',
    r => delete r.optionsVersion,
  ];
  for (const change of changes) { const invalid = recommendationFindings(); change(invalid); assert.throws(() => research(invalid), change.toString()); }
});

test('unable-to-recommend preserves plausible alternatives and never supplies a winner draft', () => {
  for (const count of [0, 1, 2]) {
    const value = recommendationFindings(); value.options.length = count;
    value.recommendationAssessment.optionId = null; value.recommendation = 'Access and storage availability are unknown; neither choice has a justified advantage yet.';
    if (count < 2) value.optionsLimit = 'More feasible alternatives need local evidence.';
    assert.deepEqual(research(value), value); assert.equal(research(value).options.length, count);
    value.proposedAnswer = 'Invent a decision'; assert.throws(() => research(value));
  }
});

test('recommendation bounds reject overflow and duplicate or malformed historical references', () => {
  for (const [field, max] of [['recommendation', 800], ['mainTradeoff', 600], ['reconsiderIf', 600]]) {
    const value = recommendationFindings(), object = field === 'recommendation' ? value : value.recommendationAssessment;
    object[field] = '界'.repeat(max); assert.deepEqual(research(value), value);
    object[field] += '界'; assert.throws(() => research(value));
  }
  const { value } = example(); value.recommendationAssessment.decisionRefs[0].reason = '界'.repeat(400); assert.deepEqual(research(value), value);
  const changes = [
    r => r.decisionRefs[0].reason += '界', r => r.decisionRefs.push({ ...r.decisionRefs[0] }),
    r => r.decisionRefs[0].nodeId = 'x'.repeat(101), r => r.decisionRefs[0].nodeId = ' ',
    r => r.decisionRefs[0].answerState = 'verified', r => r.decisionRefs[0].answerState = 'unanswered',
    r => r.decisionRefs[0].review = 'true', r => r.decisionRefs[0].answer = 'Unexpected copied input',
  ];
  for (const change of changes) { const invalid = structuredClone(value); change(invalid.recommendationAssessment); assert.throws(() => research(invalid), change.toString()); }
  const refs = Array.from({ length: 8 }, (_, i) => ({ ...value.recommendationAssessment.decisionRefs[0], nodeId: `prior-${i}` }));
  value.recommendationAssessment.decisionRefs = refs; assert.deepEqual(research(value), value);
  refs.push({ ...refs[0], nodeId: 'prior-8' }); assert.throws(() => research(value));
});

test('legacy recommendations stay readable without a fabricated linked winner', () => {
  const value = optionFindings(); value.recommendation = '界'.repeat(5000); value.proposedAnswer = 'My legacy editable suggestion.';
  assert.deepEqual(research(value), value); assert.equal(Object.hasOwn(research(value), 'recommendationAssessment'), false);
  delete value.optionsVersion; for (const option of value.options) { delete option.id; delete option.fit; }
  assert.deepEqual(research(value), value);
  const { doc, target } = example(); target.research = value;
  const dom = new JSDOM(viewerArtifact(viewerSnapshot(doc, [{ nodeId: target.id, answer: false, research: true }])).content, { runScripts: 'dangerously' });
  try { assert.doesNotMatch(dom.window.document.getElementById('detail').textContent, /Recommended option —/); }
  finally { dom.window.close(); }
});

test('historical recommendation references survive native imports and missing current sources without becoming facts', () => {
  const { doc, target, source, value } = example();
  for (const parse of [validateDocument, importedDocument]) assert.deepEqual(parse(JSON.parse(JSON.stringify(doc))).nodes.find(n => n.id === target.id).research, value);
  doc.nodes = doc.nodes.filter(n => n.id !== source.id);
  assert.deepEqual(validateDocument(doc).nodes[1].research, value);
  const markdown = toMarkdown(doc); assert.ok(markdown.includes(source.id)); assert.ok(markdown.includes(value.recommendationAssessment.mainTradeoff));
  assert.ok(markdown.includes(value.recommendationAssessment.reconsiderIf)); assert.match(markdown, /Assumption|assumption/); assert.match(markdown, /review/i);
});

test('linked recommendation and historical prior-context states survive saved history and native reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-recommendation-'));
  let explorer, reopened;
  t.after(async () => { await reopened?.close(); await explorer?.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  const { doc, target, value } = example(), library = new Library(directory), record = await library.import(doc);
  explorer = await new Explorer({ file: record.file }).load();
  await confirmAnswer(explorer, { revision: explorer.doc.revision, nodeId: target.id, answer: 'My independent choice' });
  assert.deepEqual((await explorer.readHistory(explorer.doc.id, 0)).document.nodes.find(n => n.id === target.id).research, value);
  reopened = await new Explorer({ file: record.file }).load();
  const saved = reopened.doc.nodes.find(n => n.id === target.id);
  assert.deepEqual(saved.research, value); assert.equal(saved.answer, 'My independent choice'); assert.equal(saved.researchStale, true);
});

test('offline recommendation references reveal only selected artifact identities and render literal text', () => {
  const { doc, target, source, value } = example();
  value.options[0].id = 'PRIVATE_OPTION_CANARY'; value.recommendationAssessment.optionId = 'PRIVATE_OPTION_CANARY';
  value.recommendationAssessment.decisionRefs[0].reason = '<img src=x onerror=bad()> 中文 🌿';
  const selected = { nodeId: target.id, answer: false, research: true };
  const snapshot = viewerSnapshot(doc, [selected]);
  assert.equal(snapshot.nodes[0].research.recommendationAssessment.optionId, 'o0');
  assert.equal(snapshot.nodes[0].research.recommendationAssessment.decisionRefs[0].nodeId, null);
  const html = viewerArtifact(snapshot).content;
  for (const privateId of [source.id, target.id, 'PRIVATE_OPTION_CANARY']) assert.ok(!html.includes(privateId));
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  try {
    const detail = dom.window.document.getElementById('detail');
    assert.ok(detail.textContent.includes(value.recommendationAssessment.decisionRefs[0].reason));
    assert.match(detail.textContent, /outside.*selection|not included/i); assert.equal(detail.querySelector('img,script'), null);
  } finally { dom.window.close(); }
  const both = viewerSnapshot(doc, [selected, { nodeId: source.id, answer: false, research: false }]);
  assert.equal(both.nodes[0].research.recommendationAssessment.decisionRefs[0].nodeId, both.nodes[1].id);
});

test('follow-up retains the assessment as historical context even when its prior decision body is excluded', () => {
  const { doc, target, source, value } = example();
  const prepared = prepareFollowup(doc, target.id, { question: 'What assumption would change this?', hypothetical: false }, { excluded: [source.id] });
  assert.deepEqual(prepared.followup.recommendationAssessment, value.recommendationAssessment);
  assert.ok(!prepared.context.decisionsElsewhere.some(n => n.id === source.id));
  assert.ok(!prepared.prompt.includes(source.answer));
  assert.equal(prepared.followup.coverage.originalOmitted, 0);
  assert.match(prepared.instructions, /historical/i);
});
