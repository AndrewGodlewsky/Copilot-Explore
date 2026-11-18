import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareContext, prepareResearch, RESEARCH_CONTEXT_LIMIT } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { prepareBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareAnswerCheck, prepareChallenge } from '../com.github.copilot/extensions/explorer/answer-check.mjs';
import { prepareHandoff } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';
import { prepareFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { helpContext } from '../com.github.copilot/extensions/explorer/web/question-help-context.mjs';

function fixture() {
  const doc = createDocument('Hypothetical direction'), node = { id: 'q', parentId: doc.rootId, question: 'Where?', category: 'Place', answer: 'Remote', answerState: 'assumption', review: true,
    researchStale: true, research: { basis: 'reasoning', summary: 'Compare', options: [{ title: 'Pilot', description: 'Small', pros: [], cons: [] }, { title: 'Launch', description: 'Large', pros: [], cons: [] }], recommendation: 'Pilot first', uncertainty: 'Unknown costs', sources: [] } };
  doc.nodes.push(node);
  const scenario = { source: { id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt }, family: { id: 'original', rootId: 'original-root', createdAt: doc.createdAt }, scope: 'personal', classification: 'hypothetical', preferenceRevision: 2, selectionRationale: '  Conditional alternative 🌱\n' };
  return { doc, node, scenario };
}

test('all prepared map-context operations identify the exact scenario and include hypothetical semantics within their measured inputs', () => {
  const { doc, node, scenario } = fixture(), before = JSON.stringify(doc);
  const prepared = [prepareResearch(doc, node.id, { scenario }), prepareResearch(doc, node.id, { operation: 'questions', scenario }), prepareBrief(doc, { scenario }),
    prepareAnswerCheck(doc, { scenario }), prepareChallenge(doc, [], [], { scenario }), prepareHandoff(doc, { nodeIds: [node.id], format: 'plan', includeEvidence: true }, { scenario }),
    prepareFollowup(doc, node.id, { question: 'Why this option?', hypothetical: false }, { scenario })];
  for (const value of prepared) {
    assert.deepEqual(value.context.scenario, scenario);
    assert.ok(value.prompt.includes(JSON.stringify(scenario))); assert.match(value.prompt, /hypothetical.*conditional/i);
    assert.equal(value.bytes, Buffer.byteLength(value.instructions) + Buffer.byteLength(value.prompt));
    assert.ok(value.bytes <= value.limit);
  }
  assert.equal(prepared[5].context.records[0].answerState, 'assumption');
  assert.equal(prepared[5].context.records[0].review, true); assert.equal(JSON.stringify(doc), before);
  assert.equal(Object.hasOwn(prepareResearch(doc, node.id).context, 'scenario'), false, 'pure legacy callers remain compatible');
});

test('scenario labels are mandatory budgeted context and cannot be silently dropped to fit a request', () => {
  const { scenario } = fixture(), source = { topic: 'Topic', path: [{ id: 'q', question: '?', answer: '' }] };
  const initial = prepareContext(source); source.path[0].answer = 'x'.repeat(RESEARCH_CONTEXT_LIMIT - initial.bytes - 10);
  assert.ok(prepareContext(source).bytes < RESEARCH_CONTEXT_LIMIT);
  assert.throws(() => prepareContext(source, { scenario }), /mandatory|limit/i);
});

test('question help includes the source label within its own budget while leaving answer and research out', () => {
  const { doc, node, scenario } = fixture(), context = helpContext(doc, node.id, { scenario });
  assert.deepEqual(context.scenario, scenario); assert.ok(JSON.stringify(context).length <= 16000);
  assert.equal(Object.hasOwn(context.selected, 'answer'), false); assert.equal(JSON.stringify(context).includes('Pilot first'), false);
});
