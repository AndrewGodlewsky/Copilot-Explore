import test from 'node:test';
import assert from 'node:assert/strict';
import * as adr from '../com.github.copilot/extensions/explorer/adr-draft.mjs';
import { createDocument, addQuestions, validateDocument, importedDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { captureAdrScope, prepareAdrScope } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { defaultAdrFormat, parseAdrTemplate } from '../com.github.copilot/extensions/explorer/adr-format.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { affectedArtifacts } from '../com.github.copilot/extensions/explorer/answer-changes.mjs';

function fixture(complete = false, includeEvidence = false) {
  const doc = createDocument('Choose storage λ', { objective: 'Recover reliably', successCriteria: 'Explain tradeoffs' });
  const [focal, support, omitted] = addQuestions(doc, doc.rootId, [{ question: 'Which storage?', category: 'Design' }, { question: 'Which operating constraint?', category: 'Cost' }, { question: 'UNSELECTED_QUESTION_CANARY', category: 'Other' }]);
  focal.answer = complete ? 'Choose A for recovery speed; B was too slow. A costs more. Revisit if recovery exceeds an hour.' : 'Maybe A; rationale is not yet known.';
  focal.answerState = complete ? 'decided' : 'tentative'; support.answer = 'Assume one hour is acceptable.'; support.answerState = 'assumption'; support.review = true;
  omitted.answer = 'UNSELECTED_ANSWER_CANARY'; focal.rationale = 'MODEL_QUESTION_RATIONALE_CANARY';
  focal.generation = { requestId: 'previous-request', originalQuestion: focal.question, originalCategory: focal.category, adjusted: false };
  doc.pins = [{ id: 'constraint-00000000000000', text: 'Keep uncertainty explicit λ' }];
  focal.research = { basis: 'sources', summary: 'SUMMARY_CANARY', options: [{ title: 'A', description: 'Option A', pros: [], cons: [] }, { title: 'B', description: 'Option B', pros: [], cons: [] }], recommendation: 'RECOMMENDATION_CANARY', uncertainty: 'Not independently verified', sources: [{ id: 's1', title: 'Recorded source', url: 'https://example.com/source', retrievedAt: '2026-11-18T00:00:00.000Z', provenance: 'recorded-read' }], claims: [{ id: 'c1', text: 'Research interpretation', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Recorded support' }], limitations: 'Unverified meaning' }] };
  doc.adrFormat = defaultAdrFormat();
  const selection = { focalId: focal.id, nodeIds: [focal.id, support.id], includeEvidence }, scenario = null;
  const capture = () => { doc.adrScope = captureAdrScope(prepareAdrScope(doc, selection, { scenario })); };
  capture(); return { doc, focal, support, omitted, selection, scenario, capture };
}
const prepare = f => adr.prepareAdrDraft(f.doc, { scenario: f.scenario });
const statement = (id, text, sources = [], certainty = 'uncertain') => ({ id, text, certainty, sources });
const output = f => ({ title: 'Storage direction λ', status: 'proposed', sections: { context: [statement('context', 'Recover reliably', [{ kind: 'guidance', field: 'objective' }], 'user-statement')], drivers: [], alternatives: [], outcome: [statement('choice', f.focal.answer, [{ kind: 'node', id: f.focal.id }], 'user-decision')], consequences: [], confirmation: [], optionDetails: [] } });
const proposal = (f, value = output(f)) => adr.parseAdrDraft(JSON.stringify(value), prepare(f));
const accept = (value, changes = {}) => adr.acceptAdrDraft(value, { title: value.title, statements: [], ...changes });

test('ADR draft preparation uses exact selected saved evidence and layout while preserving partial and decided states', () => {
  for (const complete of [false, true]) for (const evidence of [false, true]) {
    const f = fixture(complete, evidence), before = structuredClone(f.doc);
    f.doc.privateDraft = 'PRIVATE_DRAFT_CANARY'; f.doc.previousArtifact = 'PREVIOUS_ARTIFACT_CANARY'; f.doc.projectCapture = 'PROJECT_CANARY';
    const p = prepare(f);
    assert.equal(p.operation, 'adr-draft'); assert.deepEqual(p.context.records.map(n => n.id), f.selection.nodeIds);
    assert.deepEqual(p.context.format, f.doc.adrFormat.layout); assert.equal(p.context.records[0].answer, f.focal.answer); assert.equal(p.context.records[1].review, true);
    assert.equal(p.context.evidence.length, evidence ? 2 : 0); assert.equal(p.context.includeEvidence, evidence);
    assert.doesNotMatch(p.prompt, /CANARY/); assert.doesNotMatch(p.prompt, /docs\/decisions/);
    assert.match(p.instructions, /missing.*(unknown|unspecified)/i); assert.match(p.instructions, /rationale.*user|user.*rationale/i);
    assert.equal(p.bytes, Buffer.byteLength(p.prompt) + Buffer.byteLength(p.instructions)); assert.ok(Object.isFrozen(p.context.records));
    const parsed = adr.parseAdrDraft(JSON.stringify(output(f)), p);
    assert.equal(parsed.sections.outcome[0].certainty, complete ? 'user-decision' : 'uncertain'); assert.deepEqual(f.doc.nodes, before.nodes);
  }
});

test('ADR draft requires current scope and rejects excessive input without truncating selected records', () => {
  const f = fixture(), scope = f.doc.adrScope;
  delete f.doc.adrScope; assert.throws(() => prepare(f), /scope/i); f.doc.adrScope = scope;
  f.focal.answer = 'Changed'; assert.throws(() => prepare(f), /scope|current|stale/i); f.capture();
  assert.throws(() => adr.prepareAdrDraft(f.doc), /scope|scenario|current/i);
  // Scope fits by itself; the actual ADR instructions push the reviewed request over its cap.
  const extra = addQuestions(f.doc, f.doc.rootId, Array.from({ length: 6 }, (_, i) => ({ question: `Budget record ${i}`, category: 'Scope' })));
  for (const node of extra) { node.answer = 'x'.repeat(18000); f.selection.nodeIds.push(node.id); }
  f.support.answer = 'y'.repeat(8000);
  let found = false;
  for (let length = 7000; length <= 20000; length += 100) {
    f.focal.answer = 'x'.repeat(length);
    try { f.capture(); } catch { break; }
    try { prepare(f); } catch (error) { assert.match(error.message, /128 KiB|limit/); found = true; break; }
  }
  assert.equal(found, true);
  assert.doesNotThrow(() => validateDocument(f.doc));
});

test('ADR draft validates strict sections, status, title, bounds and only transmitted references', () => {
  const f = fixture(true, true), p = prepare(f), valid = output(f);
  for (const mutate of [v => v.status = 'accepted', v => v.extra = true, v => v.title = 'Title\nApproved', v => v.title = 'x'.repeat(201), v => v.sections.outcome[0].sources[0].id = f.omitted.id, v => v.sections.outcome[0].sources[0] = { kind: 'evidence', nodeId: f.focal.id, sourceId: 'missing' }, v => v.sections.context[0].id = 'choice', v => v.sections.outcome[0].text = 'x'.repeat(1001), v => v.sections.context = Array.from({ length: 6 }, (_, i) => statement(`c${i}`, 'Context')), v => v.sections.decision = []]) {
    const value = structuredClone(valid); mutate(value); assert.throws(() => adr.parseAdrDraft(JSON.stringify(value), p));
  }
  assert.throws(() => adr.parseAdrDraft('not JSON', p)); assert.throws(() => adr.parseAdrDraft(' '.repeat(256 * 1024 + 1), p));
  valid.sections.outcome[0].sources = [{ kind: 'evidence', nodeId: f.focal.id, sourceId: 's1' }];
  assert.equal(adr.parseAdrDraft(JSON.stringify(valid), p).sections.outcome[0].certainty, 'uncertain');
  valid.sections.outcome[0].sources = [{ kind: 'node', id: f.support.id }];
  assert.equal(adr.parseAdrDraft(JSON.stringify(valid), p).sections.outcome[0].certainty, 'uncertain');
});

test('ADR draft minimal repository template retains unspecified sections and rejects nonempty omitted content', () => {
  const f = fixture(); f.doc.adrFormat = { ...defaultAdrFormat(), template: { kind: 'repository', path: 'docs/local-template.md', sha256: 'a'.repeat(64) }, layout: parseAdrTemplate('# Example\n## Context\nEXAMPLE_CANARY\n## Decision\n') };
  const p = prepare(f); assert.doesNotMatch(p.prompt, /local-template|EXAMPLE_CANARY/);
  const value = output(f); assert.equal(adr.parseAdrDraft(JSON.stringify(value), p).sections.consequences.length, 0);
  value.sections.consequences = [statement('cost', 'New invented cost')]; assert.throws(() => adr.parseAdrDraft(JSON.stringify(value), p), /template|section|ADR/i);
});

test('ADR wording edits retain exact Unicode and original references without changing proposed status or sources', () => {
  const f = fixture(true), p = proposal(f), text = '  Exact λ <script> [x](javascript:bad)\r\nMore  ', before = structuredClone(f.doc);
  const a = accept(p, { title: 'Edited λ title', statements: [{ id: 'choice', text }] });
  assert.equal(a.status, 'proposed'); assert.equal(a.titleEdited, true); assert.equal(a.sections.outcome[0].edited, true);
  assert.equal(a.sections.outcome[0].text, text); assert.deepEqual(a.sections.outcome[0].sources, p.sections.outcome[0].sources);
  assert.deepEqual(f.doc, before); assert.equal(p.sections.outcome[0].edited, false);
  for (const edits of [{ title: p.title, statements: [], status: 'accepted' }, { title: p.title, statements: [{ id: 'missing', text: 'x' }] }, { title: p.title, statements: [{ id: 'choice', text: 'x', sources: [] }] }, { title: p.title, statements: [{ id: 'choice', text: 'x' }, { id: 'choice', text: 'y' }] }]) assert.throws(() => adr.acceptAdrDraft(p, edits));
  assert.deepEqual(adr.validateAdrDraft(a), a);
});

test('ADR draft freshness follows all selected inputs, saved format/scope and optional scenario while ignoring unrelated answers', () => {
  const f = fixture(true, true), a = accept(proposal(f));
  assert.equal(adr.adrDraftFreshness(a, f.doc, null), 'current');
  for (const change of [d => d.nodes[1].answer = 'New choice', d => d.nodes[2].review = false, d => d.adrFormat.digits = 6, d => d.adrScope.selectedAt = '2026-11-17T00:00:00.000Z', d => d.nodes[1].research.claims[0].limitations = 'Changed limitation']) {
    const changed = structuredClone(f.doc); change(changed); assert.equal(adr.adrDraftFreshness(a, changed, null), 'stale');
  }
  const unrelated = structuredClone(f.doc); unrelated.nodes[3].answer = 'Other'; unrelated.nodes[1].research.summary = 'New untransmitted summary';
  assert.equal(adr.adrDraftFreshness(a, unrelated, null), 'current'); assert.equal(adr.adrDraftFreshness(a, f.doc, { different: true }), 'stale');
  const removed = structuredClone(f.doc); removed.nodes = removed.nodes.filter(n => n.id !== f.support.id); assert.equal(adr.adrDraftFreshness(a, removed, null), 'stale');
});

test('accepted ADR drafts round-trip personal/shared files and retain historical imported provenance', () => {
  const f = fixture(true, true); f.doc.adrDraft = accept(proposal(f));
  const personal = validateDocument(JSON.parse(JSON.stringify(f.doc))); assert.deepEqual(personal.adrDraft, f.doc.adrDraft);
  const migrated = prepareSharedMigration(JSON.stringify(personal)), shared = readSharedDocument(migrated.content);
  const roundtrip = validateDocument({ ...shared.document.journey, format: personal.format, version: 1, revision: 0 });
  assert.deepEqual(roundtrip.adrDraft, personal.adrDraft); assert.equal(adr.adrDraftFreshness(roundtrip.adrDraft, roundtrip, null), 'current');
  const imported = importedDocument(personal); assert.equal(imported.adrDraft.evidence[0].sources[0].provenance, 'imported');
  assert.equal(imported.adrDraft.sections.outcome[0].text, personal.adrDraft.sections.outcome[0].text); assert.equal(imported.adrDraft.status, 'proposed');
  assert.doesNotThrow(() => validateDocument(imported));
  const invalid = structuredClone(personal); invalid.adrDraft.status = 'accepted'; assert.throws(() => validateDocument(invalid));
});

test('answer consequence analysis includes saved and proposed ADR artifacts without editing their text', () => {
  const f = fixture(true), p = proposal(f); f.doc.adrDraft = accept(p);
  const next = structuredClone(f.doc); next.nodes[1].answer = 'New choice';
  const affected = affectedArtifacts({ briefWork: { ...p, operation: 'adrDraft', status: 'proposal' } }, f.doc, next);
  assert.deepEqual(affected, [{ kind: 'adrDraft', state: 'saved' }, { kind: 'adrDraft', state: 'proposal' }]);
});
