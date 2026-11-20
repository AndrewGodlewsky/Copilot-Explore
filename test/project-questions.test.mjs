import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions, answerNode } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareResearch, sameResearchSources } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { prepareProjectQuestions, parseProjectQuestions } from '../com.github.copilot/extensions/explorer/project-questions.mjs';

const claim = (text, kind = 'file-backed', section = 'stack') => ({ id: 'claim-one', text, kind, section });
const brief = (...claims) => ({ revision: 3, claims });
const question = text => ({ question: text, category: 'Design', rationale: 'This unresolved choice affects the goal.', importance: 'high', importanceReason: 'Changing the decision affects the branch.' });

test('paired synthetic project cases include established facts while retaining unresolved choices and user uncertainty', () => {
  // Authored examples define the desired relevance contract, not a live-model quality measurement.
  const cases = [
    { topic: 'Offline inventory 🌿', fact: 'The current implementation uses SQLite.', generic: 'Which database does the app use?', focused: 'Would SQLite still meet the planned multi-device sync needs?' },
    { topic: 'Community workshop', fact: 'Workshops currently meet in a borrowed library room.', generic: 'Where are workshops held?', focused: 'When would a dedicated room become worth its additional cost?' },
    { topic: 'Study reminder', fact: 'The current reminder is a weekly email.', generic: 'How are reminders delivered?', focused: 'What would justify changing the weekly email schedule?' },
  ];
  for (const sample of cases) {
    const doc = createDocument(sample.topic), [target] = addQuestions(doc, doc.rootId, [{ question: 'What should change next?', category: 'Goals' }]);
    answerNode(doc, target.id, 'Still exploring alternatives', 'tentative');
    const assertions = brief(claim(sample.fact), { ...claim('The future constraint is uncertain.', 'unknown', 'constraints'), id: 'unknown' });
    const ordinary = prepareResearch(doc, target.id, { operation: 'questions' });
    const grounded = prepareProjectQuestions(doc, target.id, assertions);
    assert.ok(!ordinary.prompt.includes(sample.fact)); assert.ok(grounded.prompt.includes(sample.fact));
    assert.equal(grounded.context.path.at(-1).answerState, 'tentative');
    assert.deepEqual(grounded.projectBrief, assertions);
    assert.match(grounded.instructions, /current implementation.*not.*mandatory/is);
    assert.match(grounded.instructions, /already established/i); assert.match(grounded.instructions, /inferences.*uncertain/is);
    assert.ok(!grounded.prompt.includes('invoke_canvas_action'));
    assert.equal(grounded.bytes, Buffer.byteLength(grounded.instructions + grounded.prompt));
    const suggestions = parseProjectQuestions(JSON.stringify({ questions: [question(sample.focused)] }));
    assert.equal(suggestions[0].question, sample.focused); assert.notEqual(suggestions[0].question, sample.generic);
    assert.equal(doc.nodes.length, 2); assert.equal(target.answer, 'Still exploring alternatives');
  }
});

test('project question output preserves Unicode and rejects answers, invented fields, missing reasoning and oversized batches', () => {
  const valid = { questions: [question('What should change for café users 🌿?')] };
  assert.equal(parseProjectQuestions(JSON.stringify(valid))[0].question, valid.questions[0].question);
  for (const invalid of [{ ...valid, answer: 'Yes' }, { questions: [{ ...valid.questions[0], answer: 'Yes' }] },
    { questions: [{ question: 'Why?', category: 'Design' }] }, { questions: [] }, { questions: Array(7).fill(valid.questions[0]) },
    { questions: [{ ...valid.questions[0], importance: 'certain' }] }, { questions: [{ ...valid.questions[0], question: 'x'.repeat(601) }] }]) {
    assert.throws(() => parseProjectQuestions(JSON.stringify(invalid)));
  }
  assert.throws(() => parseProjectQuestions('```json\n{}\n```'));
  assert.throws(() => parseProjectQuestions(' '.repeat(65537)));
});

test('project grounding rejects insufficient or oversized briefs and freshness uses the same bounded relevance operation', () => {
  const doc = createDocument('Project migration'), [target] = addQuestions(doc, doc.rootId, [{ question: 'What must migration preserve?', category: 'Migration' }]);
  answerNode(doc, target.id, 'Keep offline behavior', 'decided');
  for (let i = 0; i < 30; i++) {
    const [node] = addQuestions(doc, doc.rootId, [{ question: `Migration tradeoff ${i}?`, category: 'Migration' }]);
    answerNode(doc, node.id, `Migration ${i}: ${'é'.repeat(3200)}`, 'tentative');
  }
  addQuestions(doc, target.id, [{ question: 'What is the rollback plan?', category: 'Migration' }]);
  assert.throws(() => prepareProjectQuestions(doc, target.id, brief(claim('Unknown project', 'unknown'))), /insufficient|unknown/i);
  assert.throws(() => prepareProjectQuestions(doc, target.id, brief(claim('x'.repeat(501)))));
  const prepared = prepareProjectQuestions(doc, target.id, brief(claim('SQLite is the current store.')));
  assert.ok(prepared.coverage.omitted.budget > 0); assert.ok(prepared.bytes <= prepared.limit);
  assert.ok(prepared.context.generationContext.some(item => item.question === 'What is the rollback plan?') || prepared.coverage.omitted.generationContext > 0);
  assert.equal(sameResearchSources(prepared.dependencies, doc), true, 'unchanged near-budget input stays valid');
  target.answer = 'Online only'; assert.equal(sameResearchSources(prepared.dependencies, doc), false);
});
