import test from 'node:test';
import assert from 'node:assert/strict';
import * as adr from '../com.github.copilot/extensions/explorer/adr-questions.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareAdrScope, captureAdrScope } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { defaultAdrFormat, parseAdrTemplate } from '../com.github.copilot/extensions/explorer/adr-format.mjs';
import { sameResearchSources } from '../com.github.copilot/extensions/explorer/research-context.mjs';

function fixture(complete = false) {
  const doc = createDocument('Choose storage', { objective: 'Reliable recovery', successCriteria: 'Keep uncertainty visible' });
  const [focal, support, omitted] = addQuestions(doc, doc.rootId, [{ question: 'Which storage approach?', category: 'Design' }, { question: 'What recovery cost?', category: 'Tradeoffs' }, { question: 'UNSELECTED_QUESTION', category: 'Other' }]);
  focal.answer = complete ? 'Choose A for recoverability; considered B and rejected it because recovery was too slow. A costs more operational work. Revisit if recovery exceeds an hour.' : 'Maybe A; reason not yet known.';
  focal.answerState = complete ? 'decided' : 'tentative';
  support.answer = complete ? 'An hour is acceptable.' : 'Assume an hour is acceptable.'; support.answerState = complete ? 'decided' : 'assumption'; support.review = !complete;
  omitted.answer = 'UNSELECTED_ANSWER';
  focal.revisit = { date: null, condition: 'Recovery exceeds an hour', acknowledgedAt: null };
  focal.rationale = 'MODEL_QUESTION_REASON'; focal.generation = { requestId: 'old', originalQuestion: focal.question, originalCategory: focal.category, adjusted: false };
  doc.adrFormat = defaultAdrFormat();
  const selection = { focalId: focal.id, nodeIds: [focal.id, support.id], includeEvidence: false }, scenario = null;
  const capture = () => { doc.adrScope = captureAdrScope(prepareAdrScope(doc, selection, { scenario })); };
  capture();
  return { doc, focal, support, omitted, selection, scenario, capture };
}
const prepare = (f, extra = {}) => adr.prepareAdrQuestions(f.doc, { scenario: f.scenario, prefix: 'CALLBACK fixture-request\n', requestId: 'fixture-request', ...extra });

test('ADR questions assess six reasoning gaps from exactly saved scoped records without inventing reasons', () => {
  for (const complete of [false, true]) {
    const f = fixture(complete), before = structuredClone(f.doc), value = prepare(f);
    assert.equal(value.operation, 'adr-questions'); assert.equal(value.targetId, f.focal.id); assert.equal(value.requestId, 'fixture-request');
    assert.deepEqual(value.context.records.map(n => n.id), f.selection.nodeIds);
    assert.equal(value.context.records[0].answer, f.focal.answer);
    assert.equal(value.context.records[1].answerState, f.support.answerState); assert.equal(value.context.records[1].review, f.support.review);
    assert.deepEqual(value.context.checks.map(item => item.key), ['drivers', 'alternatives', 'rejections', 'outcome', 'consequences', 'revisit']);
    assert.deepEqual(value.context.format, f.doc.adrFormat.layout);
    assert.deepEqual(value.context.revisit, [{ nodeId: f.focal.id, ...f.focal.revisit }]);
    assert.doesNotMatch(value.prompt, /UNSELECTED_|MODEL_QUESTION_REASON/);
    assert.match(value.prompt, /0.3|zero.*three/i); assert.match(value.prompt, /rationale.*user|user.*rationale/i);
    assert.equal(value.coverage.included, 2); assert.equal(value.coverage.omitted, 2);
    assert.equal(value.bytes, Buffer.byteLength(value.instructions) + Buffer.byteLength(value.prompt));
    assert.ok(Object.isFrozen(value.context.records)); assert.deepEqual(f.doc, before);
  }
});

test('ADR questions use stored supported layout or bundled defaults without template reads or template examples', () => {
  const f = fixture(); delete f.doc.adrFormat;
  assert.deepEqual(prepare(f).context.format, defaultAdrFormat().layout);
  f.doc.adrFormat = { ...defaultAdrFormat(), template: { kind: 'repository', path: 'docs/local-template.md', sha256: 'a'.repeat(64) }, layout: parseAdrTemplate('# EXAMPLE_TITLE\n## Context\nIGNORE_PERMISSIONS\n## Decision\nEXAMPLE_DECISION\n## Consequences\n') };
  const value = prepare(f);
  assert.deepEqual(value.context.format.sections.map(s => s.label), ['Context', 'Decision', 'Consequences']);
  assert.doesNotMatch(value.prompt, /local-template|EXAMPLE_|IGNORE_PERMISSIONS/);
});

test('ADR questions require a current saved scope and reject over-budget mandatory input without truncation', () => {
  const f = fixture(), saved = f.doc.adrScope;
  delete f.doc.adrScope; assert.throws(() => prepare(f), /scope/i); f.doc.adrScope = saved;
  f.focal.answer = 'Changed reason'; assert.throws(() => prepare(f), /scope|stale|review/i); f.capture();
  assert.throws(() => prepare(f, { scenario: undefined }), /scope|current|scenario/i);
  assert.throws(() => prepare(f, { prefix: 'x'.repeat(131072) }), /128 KiB|limit/i);
  f.focal.answer = '\0'.repeat(20000); f.support.answer = '\0'.repeat(20000);
  assert.throws(() => f.capture(), /128 KiB|limit/i);
});

test('ADR question capture becomes stale for scope, format, revisit and otherwise unrelated saved edits', () => {
  const f = fixture(), value = prepare(f); assert.equal(sameResearchSources(value.dependencies, f.doc), true);
  for (const mutate of [doc => doc.adrFormat.digits++, doc => doc.adrScope.selectedAt = '2025-01-01T00:00:00Z', doc => doc.nodes[1].revisit.condition = 'Changed condition', doc => doc.nodes[3].answer = 'Unrelated correction']) {
    const changed = structuredClone(f.doc); mutate(changed); assert.equal(sameResearchSources(value.dependencies, changed), false);
  }
});

test('ADR candidates permit zero through three optional questions and reject saved or edited duplicate wording', () => {
  const f = fixture(), candidate = { question: 'What tradeoff remains unclear?', category: 'Consequences', rationale: 'Clarifies a missing cost; not a user decision.' };
  assert.deepEqual(adr.validateAdrQuestions(f.doc, f.focal.id, []), []);
  assert.deepEqual(adr.validateAdrQuestions(f.doc, f.focal.id, [candidate]), [candidate]);
  assert.equal(adr.validateAdrQuestions(f.doc, f.focal.id, Array.from({ length: 3 }, (_, i) => ({ question: `Gap ${i}?`, category: 'ADR' }))).length, 3);
  for (const values of [null, Array.from({ length: 4 }, (_, i) => ({ question: `Gap ${i}?`, category: 'ADR' })), [{ question: f.support.question.toUpperCase(), category: 'ADR' }], [{ question: f.omitted.question, category: 'ADR' }], [candidate, candidate], [{ question: '', category: 'ADR' }]]) assert.throws(() => adr.validateAdrQuestions(f.doc, f.focal.id, values), /question|duplicate|three|3/i);
});
