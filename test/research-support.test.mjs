import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { research, createDocument, addQuestions, importedDocument, validateDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { viewerSnapshot, viewerArtifact } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
import { prepareFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { JSDOM } from 'jsdom';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { confirmAnswer } from './helpers/answer-change.mjs';
import { supportFindings } from './helpers/research-support.mjs';
import { recommendationFindings } from './helpers/research-recommendation.mjs';

test('statement support binds exact text and stable identities while permitting reordered choices and tradeoffs', () => {
  const value = supportFindings(), before = structuredClone(value);
  assert.deepEqual(research(value), value); assert.deepEqual(value, before);
  value.options.reverse(); value.options.find(o => o.id === 'cupboard').pros.reverse();
  assert.deepEqual(research(value).support, before.support);
  for (const change of [r => r.options[0].pros[0] += ' changed', r => r.options[0].pros.pop(), r => r.options.shift(), r => r.recommendation += ' changed', r => r.recommendationAssessment.mainTradeoff += ' changed']) {
    const invalid = supportFindings(); change(invalid); assert.throws(() => research(invalid), /support|reference|option/i, change.toString());
  }
});

test('statement support rejects malformed, unknown, duplicated and mismatched targets and evidence references', () => {
  const mutations = [
    r => r.support = null, r => r.support[0] = null, r => r.support[0].extra = true,
    r => r.support[0].optionId = 'missing', r => r.support[0].optionId = null, r => r.support[3].optionId = 'cupboard',
    r => r.support[0].field = 'description', r => r.support[0].field = '__proto__', r => r.support[0].text = 'unrelated statement',
    r => r.support[0].claimIds = ['missing'], r => r.support[0].claimIds = ['contrary', 'contrary'], r => r.support[0].claimIds = 'contrary',
    r => r.support[0].decisionIds = ['unknown-context'], r => r.support[2].decisionIds.push('prior-access'), r => delete r.support[0].decisionIds,
    r => r.support.push(structuredClone(r.support[0])), r => r.claims[0].evidence[0].sourceId = 'missing-source',
    r => { delete r.recommendationAssessment; r.support = [r.support[2]]; },
  ];
  for (const change of mutations) { const invalid = supportFindings(); change(invalid); assert.throws(() => research(invalid), change.toString()); }
});

test('structural support does not relabel irrelevant or contradictory citations as verified evidence', () => {
  const result = research(supportFindings());
  assert.match(result.claims[0].limitations, /contradicts/); assert.match(result.claims[1].limitations, /irrelevant/);
  assert.equal(result.sources[0].provenance, 'recorded-read');
  assert.equal(result.claims[0].basis, 'sources'); assert.equal(result.claims[2].basis, 'reasoning');
  assert.ok(!Object.hasOwn(result.support[0], 'verified'));
  assert.equal(result.support.at(-1).claimIds.length, 0, 'unsupported main tradeoff has no invented evidence');
});

function fullSupport() {
  const value = supportFindings(); value.options = Array.from({ length: 4 }, (_, i) => ({ ...value.options[0], id: `option-${i}`, title: `Choice ${i}`, proposedAnswer: `I choose ${i}.`,
    pros: Array.from({ length: 4 }, (_, j) => `Benefit ${i}-${j}`), cons: Array.from({ length: 4 }, (_, j) => `Cost ${i}-${j}`) }));
  value.recommendationAssessment.optionId = value.options[0].id;
  value.recommendationAssessment.decisionRefs = Array.from({ length: 8 }, (_, i) => ({ ...value.recommendationAssessment.decisionRefs[0], nodeId: `decision-${i}` }));
  value.support = value.options.flatMap(o => ['pros', 'cons'].flatMap(field => o[field].map(text => ({ optionId: o.id, field, text, claimIds: value.claims.map(c => c.id), decisionIds: value.recommendationAssessment.decisionRefs.map(r => r.nodeId) }))));
  for (const field of ['recommendation', 'mainTradeoff', 'reconsiderIf']) value.support.push({ optionId: null, field, text: field === 'recommendation' ? value[field] : value.recommendationAssessment[field], claimIds: [], decisionIds: [] });
  return value;
}

test('statement support enforces 35 targets, three claims and eight historical context references without clipping', () => {
  const value = fullSupport(); assert.equal(value.support.length, 35); assert.deepEqual(research(value), value);
  const extra = structuredClone(value); extra.support.push(extra.support[0]); assert.throws(() => research(extra));
  value.claims.push({ ...value.claims[2], id: 'fourth' }); value.support[0].claimIds.push('fourth'); assert.throws(() => research(value));
  const contexts = fullSupport(); contexts.support[0].decisionIds.push('decision-8'); assert.throws(() => research(contexts));
  const unicode = supportFindings(); unicode.options[0].pros[0] = '<script>literal</script> 中文 🌿'; unicode.support[0].text = unicode.options[0].pros[0];
  assert.deepEqual(research(unicode), unicode);
});

test('old research stays unknown and unsupported annotations cannot be silently discarded as legacy data', () => {
  const value = recommendationFindings(); assert.deepEqual(research(value), value); assert.equal(research(value).support, undefined);
  value.support = []; assert.deepEqual(research(value), value);
  delete value.optionsVersion; delete value.recommendationAssessment; for (const option of value.options) { delete option.id; delete option.fit; }
  assert.throws(() => research(value)); delete value.support; assert.deepEqual(research(value), value);
  delete value.claims; value.support = []; assert.throws(() => research(value));
});

test('statement links survive native history/reopen and imports demote only source provenance', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-statement-support-'));
  let explorer, reopened;
  t.after(async () => { await reopened?.close(); await explorer?.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  const doc = createDocument('Evidence for tradeoffs'), [target] = addQuestions(doc, doc.rootId, [{ question: 'Where should tools stay?', category: 'Storage' }]);
  target.research = supportFindings();
  assert.deepEqual(validateDocument(doc).nodes[1].research, target.research);
  const imported = importedDocument(doc); assert.deepEqual(imported.nodes[1].research.support, target.research.support);
  assert.equal(imported.nodes[1].research.sources[0].provenance, 'imported'); assert.equal(target.research.sources[0].provenance, 'recorded-read');
  const file = join(directory, 'map.explore.json'); await writeFile(file, JSON.stringify(doc));
  explorer = await new Explorer({ file }).load(); await confirmAnswer(explorer, { revision: explorer.doc.revision, nodeId: target.id, answer: 'My own decision' });
  assert.deepEqual((await explorer.readHistory(doc.id, 0)).document.nodes[1].research.support, target.research.support);
  reopened = await new Explorer({ file }).load(); assert.deepEqual(reopened.doc.nodes[1].research.support, target.research.support);
  assert.equal(reopened.doc.nodes[1].researchStale, true);
});

test('statement annotations count toward the existing aggregate UTF-8 limit', () => {
  const value = fullSupport();
  for (const option of value.options) {
    option.description = 'x'.repeat(600); option.fit = 'x'.repeat(400); option.proposedAnswer = option.id + 'x'.repeat(980);
    for (const field of ['pros', 'cons']) option[field] = option[field].map((text, i) => `${i}` + '\u0000'.repeat(239));
    option.details = Array.from({ length: 8 }, () => ({ label: 'Extra', value: 'x'.repeat(1000) }));
  }
  value.summary = 'x'.repeat(5000);
  value.claims = Array.from({ length: 12 }, (_, i) => ({ id: `claim-${i}`, text: 'x'.repeat(1000), basis: 'sources', evidence: [{ sourceId: 'hours', paraphrase: 'x'.repeat(1000) }], limitations: 'x'.repeat(1000) }));
  delete value.support;
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 160000); assert.ok(research(value));
  value.support = value.options.flatMap(o => ['pros', 'cons'].flatMap(field => o[field].map(text => ({ optionId: o.id, field, text, claimIds: ['claim-0'], decisionIds: [] }))));
  assert.ok(Buffer.byteLength(JSON.stringify(value)) > 160000);
  assert.throws(() => research(value), /serialized limit/);
});

test('portable statement support keeps near-text associations, literal caveats and remapped private identities', () => {
  const doc = createDocument('Portable support'), [target, prior] = addQuestions(doc, doc.rootId, [{ question: 'Where?', category: 'Storage' }, { question: 'Access?', category: 'Access' }]);
  prior.answer = 'PRIVATE_EXCLUDED_ANSWER'; target.research = supportFindings(prior.id);
  target.research.options[0].id = 'PRIVATE_OPTION'; for (const entry of target.research.support) if (entry.optionId === 'cupboard') entry.optionId = 'PRIVATE_OPTION'; target.research.recommendationAssessment.optionId = 'PRIVATE_OPTION';
  target.research.claims[0].id = 'PRIVATE_CLAIM'; target.research.support[0].claimIds = ['PRIVATE_CLAIM'];
  const markdown = toMarkdown(doc); assert.match(markdown, /Support unknown/); assert.match(markdown, /Statement support.*PRIVATE\\_CLAIM/);
  assert.match(markdown, /Historical user context/); assert.match(markdown, /contradicts/);
  const snapshot = viewerSnapshot(doc, [{ nodeId: target.id, answer: false, research: true }]), r = snapshot.nodes[0].research;
  assert.equal(r.support[0].optionId, 'o0'); assert.deepEqual(r.support[0].claimIds, ['c0']);
  assert.deepEqual(r.support[2].decisionIds, ['d0']); assert.equal(r.recommendationAssessment.decisionRefs[0].id, 'd0');
  assert.equal(r.recommendationAssessment.decisionRefs[0].nodeId, null);
  const html = viewerArtifact(snapshot).content;
  for (const secret of [prior.id, target.id, 'PRIVATE_OPTION', 'PRIVATE_CLAIM', 'PRIVATE_EXCLUDED_ANSWER']) assert.ok(!html.includes(secret), secret);
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  try {
    const detail = dom.window.document.getElementById('detail'), disclosures = detail.querySelectorAll('[data-statement-support]');
    assert.equal(disclosures.length, 8); assert.match(disclosures[0].textContent, /not verified/); assert.match(disclosures[0].textContent, /contradicts/);
    assert.match(disclosures[1].textContent, /irrelevant/); assert.match(disclosures[2].textContent, /Historical user context.*assumption/s);
    assert.match(disclosures[3].textContent, /Support unknown/); assert.equal(detail.querySelector('img,script'), null);
  } finally { dom.window.close(); }
});

test('followup carries support with historical evidence and never includes an excluded answer body', () => {
  const doc = createDocument('Scoped support'), [target, prior] = addQuestions(doc, doc.rootId, [{ question: 'Where?', category: 'Storage' }, { question: 'Access?', category: 'Access' }]);
  prior.answer = 'EXCLUDED_USER_BODY'; target.research = supportFindings(prior.id);
  const prepared = prepareFollowup(doc, target.id, { question: 'Why this pro?', hypothetical: false }, { excluded: [prior.id] });
  assert.deepEqual(prepared.followup.original.find(item => item.kind === 'evidence').support, target.research.support);
  assert.ok(!prepared.prompt.includes(prior.answer)); assert.match(prepared.instructions, /support.*omitted|omitted.*support/s);
});
