import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { research, createDocument, addQuestions, importedDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { viewerSnapshot, viewerArtifact } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
import { prepareFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { prepareReconsideration, comparisonResult } from '../com.github.copilot/extensions/explorer/research-comparison.mjs';
import { JSDOM } from 'jsdom';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { confirmAnswer } from './helpers/answer-change.mjs';
import { limitationFindings } from './helpers/research-limitations.mjs';
import { recommendationFindings } from './helpers/research-recommendation.mjs';

for (const kind of ['conflict', 'dependent-sources', 'sparse', 'unavailable', 'constraints']) test(`research retains actionable ${kind} limitations without manufacturing a winner or options`, () => {
  const value = limitationFindings(kind), before = structuredClone(value), output = research(value);
  assert.deepEqual(output, before); assert.deepEqual(value, before);
  assert.equal(output.recommendationAssessment.optionId, null);
  assert.ok(output.limitations[0].blocksRecommendation && output.limitations[0].nextStep);
  assert.equal(output.options.length, kind === 'unavailable' ? 0 : kind === 'sparse' ? 1 : 2);
  if (kind === 'unavailable') { assert.equal(output.basis, 'reasoning'); assert.deepEqual(output.sources, []); }
  if (kind === 'dependent-sources') assert.match(output.limitations[0].summary, /not independent/);
  assert.equal(Object.hasOwn(output.limitations[0], 'verified'), false);
});

test('scoped nonblocking uncertainty permits a conditional winner and legacy coverage remains unknown', () => {
  const value = limitationFindings(); value.limitations[0].blocksRecommendation = false;
  value.recommendationAssessment.optionId = 'distributed'; value.recommendation = 'Consider direct loans if the owners can arrange collection.';
  assert.deepEqual(research(value), value);
  const legacy = recommendationFindings(); assert.equal(research(legacy).limitations, undefined);
  legacy.limitations = []; assert.deepEqual(research(legacy).limitations, []);
});

test('limitations require exact bounded records, known unique scope and consistent abstention', () => {
  const mutations = [
    r => r.limitations = null, r => r.limitations[0] = null, r => r.limitations[0].extra = 'ignored?',
    r => r.limitations[0].id = 'invalid space', r => r.limitations.push(structuredClone(r.limitations[0])),
    r => r.limitations[0].kind = 'verified', r => r.limitations[0].summary = ' ', r => r.limitations[0].nextStep = '',
    r => r.limitations[0].summary = 'x'.repeat(601), r => r.limitations[0].nextStep = 'x'.repeat(601),
    r => r.limitations[0].claimIds = ['absent'], r => r.limitations[0].claimIds.push('access'),
    r => r.limitations[0].optionIds = ['absent'], r => r.limitations[0].optionIds.push('cupboard'),
    r => r.limitations[0].decisionIds = ['not-captured'], r => delete r.limitations[0].decisionIds,
    r => r.limitations[0].blocksRecommendation = 'true', r => delete r.limitations[0].blocksRecommendation,
    r => r.recommendationAssessment.optionId = 'cupboard', r => r.limitations[0].blocksRecommendation = false,
    r => r.limitations = [], r => delete r.recommendationAssessment,
    r => { delete r.optionsVersion; delete r.recommendationAssessment; for (const o of r.options) { delete o.id; delete o.fit; } },
  ];
  for (const change of mutations) { const value = limitationFindings(); change(value); assert.throws(() => research(value), change.toString()); }
  const legacy = recommendationFindings(); delete legacy.optionsVersion; delete legacy.recommendationAssessment; delete legacy.claims; for (const o of legacy.options) { delete o.id; delete o.fit; }
  legacy.limitations = []; assert.throws(() => research(legacy), /version/i);
});

test('limitations accept maximum bounded scope and literal Unicode without mutation or clipping', () => {
  const value = limitationFindings('constraints');
  value.claims = Array.from({ length: 4 }, (_, i) => ({ ...value.claims[0], id: `claim-${i}` }));
  value.options = Array.from({ length: 4 }, (_, i) => ({ ...value.options[0], id: `option-${i}`, title: `Choice ${i}`, proposedAnswer: `I choose ${i}.` }));
  value.recommendationAssessment.decisionRefs = Array.from({ length: 8 }, (_, i) => ({ ...value.recommendationAssessment.decisionRefs[0], nodeId: `decision-${i}` }));
  const entry = { ...value.limitations[0], summary: '<img src=x onerror=bad()> 中文 🌿', nextStep: '界'.repeat(600), claimIds: value.claims.slice(0, 3).map(c => c.id), optionIds: value.options.map(o => o.id), decisionIds: value.recommendationAssessment.decisionRefs.map(d => d.nodeId) };
  value.limitations = Array.from({ length: 12 }, (_, i) => ({ ...entry, id: `gap-${i}` }));
  assert.deepEqual(research(value), value);
  for (const change of [r => r.limitations.push({ ...entry, id: 'extra' }), r => r.limitations[0].claimIds.push('claim-3'), r => r.limitations[0].optionIds.push('option-4'), r => r.limitations[0].decisionIds.push('decision-8')]) {
    const invalid = structuredClone(value); change(invalid); assert.throws(() => research(invalid));
  }
  const whole = limitationFindings(); whole.limitations[0].claimIds = []; whole.limitations[0].optionIds = [];
  assert.deepEqual(research(whole).limitations, whole.limitations);
});

test('recommendation abstention preserves independent answers and limitations through history, reopen and import', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-limitations-')); let explorer, reopened;
  t.after(async () => { await reopened?.close(); await explorer?.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  const doc = createDocument('Evidence gaps'), [target] = addQuestions(doc, doc.rootId, [{ question: 'Where should tools stay?', category: 'Storage' }]);
  target.research = limitationFindings(); const file = join(directory, 'map.explore.json'); await writeFile(file, JSON.stringify(doc));
  const imported = importedDocument(doc); assert.deepEqual(imported.nodes[1].research.limitations, target.research.limitations); assert.equal(imported.nodes[1].research.sources[0].provenance, 'imported');
  explorer = await new Explorer({ file }).load(); await confirmAnswer(explorer, { revision: explorer.doc.revision, nodeId: target.id, answer: 'I choose direct loans based on my own judgment.' });
  assert.equal(explorer.doc.nodes[1].answer, 'I choose direct loans based on my own judgment.');
  assert.deepEqual((await explorer.readHistory(doc.id, 0)).document.nodes[1].research.limitations, target.research.limitations);
  reopened = await new Explorer({ file }).load(); assert.deepEqual(reopened.doc.nodes[1].research.limitations, target.research.limitations);
});

test('limitations count toward aggregate UTF-8 bounds alongside existing evidence', () => {
  const value = limitationFindings(); delete value.limitations;
  value.options = Array.from({ length: 3 }, (_, i) => ({ ...value.options[0], id: `choice-${i}`, title: `Choice ${i}`, proposedAnswer: `I choose ${i}`, details: Array.from({ length: 8 }, () => ({ label: 'Detail', value: '界'.repeat(1000) })) }));
  value.claims = Array.from({ length: 12 }, (_, i) => ({ ...value.claims[0], id: `claim-${i}`, text: 'x'.repeat(1000), limitations: 'x'.repeat(1000), evidence: value.claims[0].evidence.map(e => ({ ...e, paraphrase: 'x'.repeat(1000) })) }));
  value.summary = 'x'.repeat(5000); assert.ok(Buffer.byteLength(JSON.stringify(value)) < 160000); assert.ok(research(value));
  value.limitations = Array.from({ length: 12 }, (_, i) => ({ id: `gap-${i}`, kind: 'missing-evidence', summary: '界'.repeat(600), nextStep: '界'.repeat(600), claimIds: ['claim-0'], optionIds: ['choice-0'], decisionIds: [], blocksRecommendation: true }));
  assert.ok(Buffer.byteLength(JSON.stringify(value)) > 160000); assert.throws(() => research(value), /serialized limit/);
});

function scopedDocument() {
  const doc = createDocument('Scoped uncertainty'), [target, prior] = addQuestions(doc, doc.rootId, [{ question: 'Where?', category: 'Storage' }, { question: 'Access?', category: 'Access' }]);
  prior.answer = 'EXCLUDED_USER_BODY'; target.research = limitationFindings('constraints', prior.id);
  return { doc, target, prior };
}

test('Markdown and offline exports retain local limitation scope without excluded identities or HTML execution', () => {
  const { doc, target, prior } = scopedDocument(), value = target.research;
  value.limitations[0].summary = '<img src=x onerror=bad()> 中文 🌿'; value.limitations[0].id = 'PRIVATE_LIMITATION';
  value.claims[0].id = 'PRIVATE_CLAIM'; value.limitations[0].claimIds = ['PRIVATE_CLAIM'];
  value.options[0].id = 'PRIVATE_OPTION'; value.limitations[0].optionIds = ['PRIVATE_OPTION'];
  const markdown = toMarkdown(doc); assert.match(markdown, /Model-identified limitations/); assert.match(markdown, /Next step:.*Clarify/); assert.match(markdown, /PRIVATE\\_LIMITATION/);
  const snapshot = viewerSnapshot(doc, [{ nodeId: target.id, answer: false, research: true }]), r = snapshot.nodes[0].research;
  assert.deepEqual(r.limitations[0], { ...value.limitations[0], id: 'l0', claimIds: ['c0'], optionIds: ['o0'], decisionIds: ['d0'] });
  const html = viewerArtifact(snapshot).content;
  for (const secret of [prior.id, target.id, 'EXCLUDED_USER_BODY', 'PRIVATE_LIMITATION', 'PRIVATE_CLAIM', 'PRIVATE_OPTION']) assert.ok(!html.includes(secret), secret);
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  try {
    const detail = dom.window.document.getElementById('detail'); assert.equal(detail.querySelector('img,script'), null);
    assert.match(detail.querySelector('[data-research-limitation]').textContent, /中文 🌿/);
    assert.match(detail.querySelector('[data-recommendation-next-step]').textContent, /Clarify/);
    assert.match(detail.textContent, /historical user intent/i);
  } finally { dom.window.close(); }
});

test('followup keeps limitation scope within optional evidence, with explicit omission and no excluded body', () => {
  const { doc, target, prior } = scopedDocument();
  const prepared = prepareFollowup(doc, target.id, { question: 'What is missing?', hypothetical: false }, { excluded: [prior.id] });
  assert.deepEqual(prepared.followup.original.find(item => item.kind === 'evidence').limitations, target.research.limitations);
  assert.ok(!prepared.prompt.includes(prior.answer)); assert.match(prepared.instructions, /limitations.*omitted|omitted.*limitations/s);
  target.answer = '\0'.repeat(10000);
  target.research = limitationFindings();
  target.research.claims = Array.from({ length: 12 }, (_, i) => ({ ...target.research.claims[0], id: `claim-${i}`, text: 'x'.repeat(1000), limitations: 'x'.repeat(1000), evidence: target.research.claims[0].evidence.map(e => ({ ...e, paraphrase: 'x'.repeat(1000) })) }));
  target.research.limitations = Array.from({ length: 12 }, (_, i) => ({ ...target.research.limitations[0], id: `gap-${i}`, summary: 'x'.repeat(600), nextStep: 'x'.repeat(600), claimIds: ['claim-0'] }));
  assert.ok(research(target.research));
  const omitted = prepareFollowup(doc, target.id, { question: 'What is missing?', hypothetical: false });
  assert.ok(omitted.followup.coverage.originalOmitted > 0); assert.equal(omitted.followup.original.some(item => item.kind === 'evidence'), false);
  assert.ok(!omitted.prompt.includes('gap-11')); assert.ok(omitted.bytes <= 131072);
});

test('tool-free reconsideration preserves recorded blockers while allowing useful comparisons', () => {
  const { doc, target } = scopedDocument(), criteria = [{ id: 'access', label: 'Access', priority: 'high' }];
  const prepared = prepareReconsideration(doc, target.id, { criteria });
  assert.deepEqual(prepared.comparison.prior.limitations, target.research.limitations);
  assert.match(prepared.instructions, /blocksRecommendation/);
  const value = { cells: target.research.options.map(option => ({ criterionId: 'access', optionId: option.id, basis: 'unknown', claimIds: [], explanation: 'Availability remains unresolved.' })), recommendation: { optionId: null, reason: 'Clarify access first.', changed: 'Access now has high priority.', unchanged: 'The recorded constraints still conflict.' }, uncertainty: 'No new evidence or changed saved answer.' };
  assert.deepEqual(comparisonResult(value, prepared), value);
  value.recommendation.optionId = 'distributed'; assert.throws(() => comparisonResult(value, prepared), /comparison/i);
  target.research.limitations[0].blocksRecommendation = false; target.research.recommendationAssessment.optionId = 'distributed';
  assert.deepEqual(comparisonResult(value, prepareReconsideration(doc, target.id, { criteria })), value);
});
