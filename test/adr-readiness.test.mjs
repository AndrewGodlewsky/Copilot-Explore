import test from 'node:test';
import assert from 'node:assert/strict';
import { adrReadiness, captureAdrReadiness } from '../com.github.copilot/extensions/explorer/adr-readiness.mjs';
import { prepareAdrDraft, parseAdrDraft, acceptAdrDraft, validateAdrDraft, validateAdrReadinessReceipt } from '../com.github.copilot/extensions/explorer/adr-draft.mjs';
import { createDocument, addQuestions, validateDocument, importedDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { captureAdrScope, prepareAdrScope } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { defaultAdrFormat } from '../com.github.copilot/extensions/explorer/adr-format.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';

function fixture(settled = false, evidence = false) {
  const doc = createDocument('Storage λ');
  const [focal, support, other] = addQuestions(doc, doc.rootId, [{ question: 'Which storage?', category: 'Design' }, { question: 'Operating limit?', category: 'Cost' }, { question: 'Other?', category: 'Other' }]);
  focal.answer = settled ? 'Choose A because recovery is faster.' : 'Maybe A'; focal.answerState = settled ? 'decided' : 'tentative';
  support.answer = 'One hour'; support.answerState = settled ? 'decided' : 'assumption'; support.review = !settled;
  if (evidence) focal.research = { basis: 'sources', summary: 'Prior interpretation', options: [{ title: 'A', description: 'A', pros: [], cons: [] }, { title: 'B', description: 'B', pros: [], cons: [] }], recommendation: 'A', uncertainty: 'Unverified meaning', sources: [{ id: 's1', title: 'Recorded source', url: 'https://example.com/source', provenance: 'recorded-read', retrievedAt: '2026-11-18T00:00:00.000Z' }], claims: [{ id: 'c1', text: 'Prior interpretation', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Recorded support' }], limitations: 'Unverified meaning' }] };
  doc.adrFormat = defaultAdrFormat(); doc.adrScope = captureAdrScope(prepareAdrScope(doc, { focalId: focal.id, nodeIds: [focal.id, support.id], includeEvidence: evidence }, { scenario: null }));
  const prepared = prepareAdrDraft(doc, { scenario: null }), raw = { title: 'Storage choice', status: 'proposed', sections: { context: [], drivers: [], alternatives: settled ? [{ id: 'other-option', text: 'B was considered', certainty: 'user-statement', sources: [{ kind: 'node', id: focal.id }] }] : [], outcome: [{ id: 'choice', text: focal.answer, certainty: 'user-decision', sources: [{ kind: 'node', id: focal.id }] }], consequences: [], confirmation: [], optionDetails: [] } };
  const draft = parseAdrDraft(JSON.stringify(raw), prepared);
  return { doc, focal, support, other, draft };
}
const report = f => adrReadiness(f.draft, f.doc, null);
const find = (r, code, id) => r.items.find(item => item.code === code && (id === undefined || item.target.id === id));

test('ADR readiness explains partial source states and gaps without changing answers or inventing a score', () => {
  const f = fixture(), before = structuredClone(f), r = report(f);
  assert.equal(r.blockers, 0); assert.ok(r.advisories >= 5); assert.equal('score' in r, false);
  assert.equal(find(r, 'unsettled-outcome').severity, 'advisory'); assert.ok(find(r, 'rationale-unconfirmed')); assert.ok(find(r, 'missing-alternatives'));
  assert.match(find(r, 'unresolved-source', f.focal.id).reason, /tentative/i);
  assert.match(find(r, 'unresolved-source', f.support.id).reason, /assumption/i); assert.ok(find(r, 'needs-review-source', f.support.id));
  for (const item of r.items) { assert.match(item.id, /^[a-f0-9]{64}$/); assert.ok(item.reason.length); assert.ok(item.target); }
  assert.equal(new Set(r.items.map(item => item.id)).size, r.items.length); assert.deepEqual(f, before);
});

test('ADR readiness treats missing outcomes and alternatives as honest advisory gaps, never guessing rationale from prose', () => {
  const f = fixture(true), r = report(f); assert.equal(r.blockers, 0); assert.equal(find(r, 'unsettled-outcome'), undefined); assert.equal(find(r, 'missing-alternatives'), undefined);
  assert.ok(find(r, 'rationale-unconfirmed'), 'because in free prose is not proof of a recorded reason');
  f.draft.sections.outcome = []; const empty = report(f); assert.equal(find(empty, 'missing-outcome').severity, 'advisory');
  assert.doesNotThrow(() => captureAdrReadiness(empty), 'proposed draft may honestly retain unknowns');
  f.draft.sections.consequences = [{ id: 'cost', text: 'Assume an operating cost', certainty: 'assumption', sources: [], edited: true }];
  const edited = report(f); assert.equal(find(edited, 'unmapped-statement').target.statementId, 'cost'); assert.ok(find(edited, 'edited-statement')); assert.ok(find(edited, 'draft-assumption'));
});

test('ADR readiness identifies missing, changed and unsupported references at their source or draft section', () => {
  const f = fixture(), missing = structuredClone(f); missing.doc.nodes = missing.doc.nodes.filter(n => n.id !== missing.support.id);
  assert.equal(find(report(missing), 'missing-source', f.support.id).severity, 'blocker');
  const changed = structuredClone(f); changed.doc.nodes.find(n => n.id === f.focal.id).answer = 'Now B';
  assert.equal(find(report(changed), 'changed-source', f.focal.id).severity, 'blocker');
  const unsupported = structuredClone(f); unsupported.draft.sections.outcome[0].sources[0].id = 'untransmitted';
  const r = report(unsupported), gap = find(r, 'unsupported-reference'); assert.equal(gap.severity, 'blocker'); assert.deepEqual(gap.target, { kind: 'section', section: 'outcome', statementId: 'choice' });
  assert.match(gap.reason, /untransmitted/); assert.throws(() => captureAdrReadiness(r), /block|invalid|stale/i);
});

test('ADR readiness invalidates exact wording, scope, format, evidence, scenario and current review causes but ignores unrelated answers', () => {
  const f = fixture(false, true), original = report(f);
  for (const change of [
    x => x.draft.title += ' revised', x => x.draft.sections.outcome[0].text += ' revised', x => x.doc.adrFormat.digits = 6,
    x => x.doc.adrScope.selectedAt = '2026-11-17T00:00:00.000Z', x => x.doc.nodes[1].answer += ' revised',
    x => x.doc.nodes[1].research.sources[0].title += ' revised', x => x.doc.objective = 'Changed guidance',
    x => x.doc.nodes[2].reviewCauses = { earlier: false, changes: [{ sourceId: x.focal.id, baseDigest: 'a'.repeat(64), revision: 1 }] },
    x => x.doc.nodes[1].researchStale = true,
  ]) { const next = structuredClone(f); change(next); assert.notEqual(report(next).digest, original.digest); }
  assert.notEqual(adrReadiness(f.draft, f.doc, { preference: 'changed' }).digest, original.digest);
  assert.equal(find(adrReadiness(f.draft, f.doc), 'unknown-scenario').severity, 'blocker');
  for (const [mutate, code] of [[d => d.adrFormat.digits = 6, 'changed-format'], [d => d.adrScope.selectedAt = '2026-11-17T00:00:00.000Z', 'changed-scope'], [d => d.nodes[1].research.sources[0].title = 'New title', 'changed-evidence'], [d => d.objective = 'New', 'changed-guidance']]) {
    const next = structuredClone(f); mutate(next.doc); assert.equal(find(report(next), code).severity, 'blocker');
  }
  f.doc.nodes[3].answer = 'Unrelated'; f.doc.privateDraft = 'Not shared'; assert.equal(report(f).digest, original.digest);
});

test('ADR acknowledgments are optional current advisory judgments and cannot waive blockers or unknown gaps', () => {
  const f = fixture(), r = report(f), id = find(r, 'missing-alternatives').id;
  const receipt = captureAdrReadiness(r, { digest: r.digest, acknowledged: [id] }); assert.deepEqual(receipt.acknowledged, [id]); assert.ok(Date.parse(receipt.reviewedAt));
  const accepted = acceptAdrDraft(f.draft, { title: f.draft.title, statements: [] }); accepted.readiness = receipt;
  assert.deepEqual(adrReadiness(accepted, f.doc, null).acknowledged, [id]); assert.equal(accepted.status, 'proposed');
  accepted.sections.outcome[0].text += ' revised'; assert.deepEqual(adrReadiness(accepted, f.doc, null).acknowledged, []);
  for (const submitted of [{ digest: 'a'.repeat(64), acknowledged: [] }, { digest: r.digest, acknowledged: ['b'.repeat(64)] }, { digest: r.digest, acknowledged: [id, id] }, { digest: r.digest, acknowledged: [], approve: true }]) assert.throws(() => captureAdrReadiness(r, submitted));
  f.doc.nodes[1].answer = 'New'; const stale = report(f), blocker = stale.items.find(item => item.severity === 'blocker');
  assert.throws(() => captureAdrReadiness(stale, { digest: stale.digest, acknowledged: [blocker.id] }), /block|stale/i);
  assert.deepEqual(captureAdrReadiness(r).acknowledged, []);
});

test('ADR readiness receipts validate strictly and survive personal/shared roundtrip while imports stay historical', () => {
  const f = fixture(true, true), r = report(f), receipt = captureAdrReadiness(r, { digest: r.digest, acknowledged: [find(r, 'rationale-unconfirmed').id] });
  f.doc.adrDraft = { ...acceptAdrDraft(f.draft, { title: f.draft.title, statements: [] }), readiness: receipt };
  assert.deepEqual(validateAdrDraft(f.doc.adrDraft).readiness, receipt); const personal = validateDocument(f.doc);
  const shared = readSharedDocument(prepareSharedMigration(JSON.stringify(personal)).content), roundtrip = validateDocument({ ...shared.document.journey, format: personal.format, version: 1, revision: 0 });
  assert.equal(adrReadiness(roundtrip.adrDraft, roundtrip, null).digest, r.digest); assert.deepEqual(adrReadiness(roundtrip.adrDraft, roundtrip, null).acknowledged, receipt.acknowledged);
  const imported = importedDocument(personal); assert.deepEqual(imported.adrDraft.readiness, receipt); assert.deepEqual(adrReadiness(imported.adrDraft, imported, null).acknowledged, []);
  for (const mutate of [v => v.version = 2, v => v.digest = 'bad', v => v.reviewedAt = 'never', v => v.acknowledged = Array(641).fill('a'.repeat(64)), v => v.acknowledged = ['bad'], v => v.approved = true]) { const v = structuredClone(receipt); mutate(v); assert.throws(() => validateAdrReadinessReceipt(v)); }
  assert.equal(validateAdrDraft(acceptAdrDraft(f.draft, { title: f.draft.title, statements: [] })).readiness, undefined);
});

test('ADR source correction refreshes live gap reasons while the old capture remains stale and wording stays intact', () => {
  const f = fixture(); f.draft.sections.outcome[0].text = 'Manual wording λ'; f.draft.sections.outcome[0].edited = true;
  const next = structuredClone(f.doc), source = next.nodes.find(n => n.id === f.support.id); source.answerState = 'decided'; source.review = false;
  const before = structuredClone(f.draft), r = adrReadiness(f.draft, next, null);
  assert.equal(find(r, 'unresolved-source', f.support.id), undefined); assert.equal(find(r, 'needs-review-source', f.support.id), undefined);
  assert.ok(find(r, 'changed-source', f.support.id)); assert.deepEqual(f.draft, before); assert.equal(f.doc.nodes[2].answerState, 'assumption');
});
