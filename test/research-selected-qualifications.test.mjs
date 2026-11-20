import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { AdrSourcesClient } from '../com.github.copilot/extensions/explorer/web/adr-sources-client.mjs';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';
import { selectedInputs, prepareHandoff, parseHandoff, acceptHandoff, validateHandoff, handoffFreshness, handoffMarkdown } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';
import { prepareAdrScope, captureAdrScope, adrScopeFreshness } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { prepareAdrDraft, parseAdrDraft, acceptAdrDraft, validateAdrDraft, adrDraftFreshness } from '../com.github.copilot/extensions/explorer/adr-draft.mjs';
import { captureAdrSources, validateAdrSources, adrSourcesStatus, adrSourcesMarkdown } from '../com.github.copilot/extensions/explorer/adr-sources.mjs';
import { limitationFindings } from './helpers/research-limitations.mjs';

function fixture() {
  const doc = model.createDocument('Selected evidence');
  const [node, omitted] = model.addQuestions(doc, doc.rootId, [{ question: 'Which access policy?', category: 'Access' }, { question: 'Private context', category: 'Other' }]);
  omitted.answer = 'EXCLUDED_ANSWER';
  const r = limitationFindings('conflict');
  r.recommendationAssessment.decisionRefs = [{ nodeId: omitted.id, reason: 'EXCLUDED_CONTEXT', answerState: 'assumption', review: true }];
  r.limitations[0].decisionIds = [omitted.id]; r.limitations[0].summary = 'A newer notice suspends Sunday access <img src=x onerror=bad()>';
  r.limitations[0].nextStep = 'Ask which notice governs access';
  r.limitations.push({ ...r.limitations[0], id: 'whole', claimIds: [], optionIds: [], decisionIds: [], summary: 'The question lacks an applicable date' });
  r.limitations.push({ ...r.limitations[0], id: 'option-only', claimIds: [], decisionIds: [], summary: 'EXCLUDED_OPTION_LIMITATION' });
  r.options[0].description = 'EXCLUDED_OPTION_BODY'; node.research = model.research(r);
  return { doc, node, omitted };
}

test('selected claim and whole-question qualifications survive handoff and ADR capture, appendix and freshness', () => {
  const { doc, node, omitted } = fixture(), nodeIds = [node.id];
  const selected = selectedInputs(doc, nodeIds, true).context.evidence[0];
  const expected = node.research.limitations.slice(0, 2).map(({ id, kind, summary, claimIds, blocksRecommendation, nextStep }) => ({ id, kind, summary, claimIds, blocksRecommendation, nextStep }));
  assert.deepEqual(selected.qualifications, expected);
  assert.doesNotMatch(JSON.stringify(selected), /EXCLUDED_|optionIds|decisionIds/);
  assert.ok(!JSON.stringify(selected).includes(omitted.id));
  assert.deepEqual(selectedInputs(doc, nodeIds, false).context.evidence, []);
  const handoff = acceptHandoff(parseHandoff(JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] }), prepareHandoff(doc, { nodeIds, format: 'brief', includeEvidence: true })), []);
  assert.deepEqual(validateHandoff(handoff).evidence[0].qualifications, expected);
  assert.match(handoffMarkdown(handoff, doc), /newer notice suspends Sunday access/);
  assert.match(handoffMarkdown(handoff, doc), /Ask which notice governs access/);
  doc.adrScope = captureAdrScope(prepareAdrScope(doc, { focalId: node.id, nodeIds, includeEvidence: true }, { scenario: null }));
  const prepared = prepareAdrDraft(doc, { scenario: null });
  assert.match(prepared.prompt, /newer notice suspends Sunday access/); assert.doesNotMatch(prepared.prompt, /EXCLUDED_/);
  const raw = { title: 'Access policy', status: 'proposed', sections: { context: [], drivers: [], alternatives: [], outcome: [], consequences: [], confirmation: [], optionDetails: [] } };
  doc.adrDraft = acceptAdrDraft(parseAdrDraft(JSON.stringify(raw), prepared), { title: raw.title, statements: [] });
  assert.deepEqual(validateAdrDraft(doc.adrDraft).evidence[0].qualifications, expected);
  const capture = captureAdrSources(doc);
  assert.deepEqual(validateAdrSources(capture).evidence[0].qualifications, expected);
  assert.match(adrSourcesMarkdown(capture, doc.id), /newer notice suspends Sunday access/);
  assert.match(adrSourcesMarkdown(capture, doc.id), /Ask which notice governs access/);
  const dom = new JSDOM('<select id="adr-sources-node"></select>' + ['inspect', 'panel', 'status', 'meta', 'guidance', 'record', 'evidence', 'mappings'].map(id => `<div id="adr-sources-${id}"></div>`).join(''));
  const $ = id => dom.window.document.getElementById(id);
  const client = new AdrSourcesClient({ $, active: () => true, openReference: () => assert.fail('No navigation') });
  client.render({ capture, title: 'Historical evidence', sourceStatus: adrSourcesStatus(capture, doc) });
  assert.match($('adr-sources-evidence').textContent, /newer notice suspends Sunday access <img/);
  assert.match($('adr-sources-evidence').textContent, /whole question.*recommendation blocker/s);
  assert.match($('adr-sources-evidence').textContent, /Ask which notice governs access/);
  assert.equal(dom.window.document.querySelector('img'), null); dom.window.close();
  assert.equal(handoffFreshness(handoff, doc), 'current'); assert.equal(adrScopeFreshness(doc.adrScope, doc, null), 'current');
  assert.equal(adrDraftFreshness(doc.adrDraft, doc, null), 'current'); assert.equal(adrSourcesStatus(capture, doc).status, 'current');
  for (const field of ['summary', 'nextStep']) {
    const changed = structuredClone(doc); changed.nodes[1].research.limitations[0][field] += ' changed';
    assert.equal(handoffFreshness(handoff, changed), 'stale'); assert.equal(adrScopeFreshness(doc.adrScope, changed, null), 'stale');
    assert.equal(adrDraftFreshness(doc.adrDraft, changed, null), 'stale'); assert.equal(adrSourcesStatus(capture, changed).status, 'changed');
  }
  assert.deepEqual(model.importedDocument({ ...doc, handoff }).handoff.evidence[0].qualifications, expected);
});

test('selected qualifications reject malformed scope and bounds without changing legacy evidence', () => {
  const { doc, node } = fixture(), evidence = selectedInputs(doc, [node.id], true).context.evidence[0];
  assert.equal(typeof model.selectedResearchEvidence, 'function');
  for (const change of [
    e => e.qualifications[0].claimIds.push('missing'), e => e.qualifications[0].claimIds.push('access'),
    e => e.qualifications[0].optionIds = ['cupboard'], e => e.qualifications[0].blocksRecommendation = 'yes',
    e => e.qualifications[0].summary = 'x'.repeat(601), e => e.qualifications[0].nextStep = '',
    e => e.qualifications[0].kind = 'verified', e => e.qualifications.push(e.qualifications[0]),
    e => e.qualifications = Array.from({ length: 13 }, (_, i) => ({ ...e.qualifications[0], id: `q${i}` })),
    e => { delete e.claims; },
  ]) { const invalid = structuredClone(evidence); change(invalid); assert.throws(() => model.selectedResearchEvidence(invalid)); }
  const legacy = { basis: 'reasoning', sources: [] };
  assert.deepEqual(model.selectedResearchEvidence(legacy), model.researchEvidence(legacy));
  assert.equal(Object.hasOwn(model.selectedResearchEvidence({ ...evidence, qualifications: [] }), 'qualifications'), true);
  assert.throws(() => model.research({ ...node.research, qualifications: evidence.qualifications }), /fields/);
});
