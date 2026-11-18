import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import * as suggestions from '../com.github.copilot/extensions/explorer/web/next-question.mjs';

const question = (id, text, extra = {}) => ({ id, parentId: 'root', question: text, category: 'Scope', answer: '', research: null, review: false, ...extra });
function map(nodes = [], guidance = {}) {
  const doc = createDocument('Library', { objective: 'Tool reliability', ...guidance });
  doc.rootId = 'root'; doc.nodes[0].id = 'root'; doc.nodes.push(...nodes);
  return doc;
}
const ranked = (id, text, importance) => question(id, text, { importance, importanceReason: 'Original consequence', generation: { requestId: 'r', originalQuestion: text, originalCategory: 'Scope', adjusted: false } });

test('next question ranks current constraint and goal wording ahead of historical importance with stable ties', () => {
  assert.equal(typeof suggestions.NextQuestion, 'function', 'local prioritization is available');
  const chooser = new suggestions.NextQuestion();
  const doc = map([ranked('z', 'Tool reliability?', 'high'), ranked('a', 'Tool storage?', 'low'), question('b', 'Budget ownership?')]);
  assert.equal(chooser.suggest(doc).candidate.id, 'z');
  doc.pins = [{ id: 'constraint000000000001', text: 'Budget is limited' }];
  const chosen = chooser.suggest(doc);
  assert.equal(chosen.candidate.id, 'b'); assert.deepEqual(chosen.candidate.constraintTerms, ['budget']);
  delete doc.pins; doc.objective = 'Storage ownership';
  assert.equal(chooser.suggest(doc).candidate.id, 'a', 'changed guidance changes selection');
  doc.nodes[1].question = 'Storage ownership?'; doc.nodes[1].importance = 'low';
  assert.equal(chooser.suggest(doc).candidate.id, 'z', 'more goal matches precede importance');
  doc.nodes[1].question = 'Storage?'; doc.nodes[2].question = 'Storage?';
  assert.equal(chooser.suggest(doc).candidate.id, 'a'); doc.nodes.reverse(); assert.equal(chooser.suggest(doc).candidate.id, 'a', 'array ordering cannot alter ties');
});

test('next question explains missing goals, literal-match limits and unresolved exclusions honestly', () => {
  const chooser = new suggestions.NextQuestion();
  assert.equal(chooser.suggest(map([], { objective: '' })).status, 'no-goal');
  assert.equal(chooser.suggest(map([question('a', 'Borrowing?')])).status, 'no-match');
  for (const state of ['unanswered', 'tentative', 'assumption', 'needs-evidence']) {
    assert.equal(chooser.suggest(map([question('a', 'Tool?', { answerState: state, answer: state === 'unanswered' ? '' : 'Maybe' })])).candidate.id, 'a');
  }
  const doc = map([
    question('a', 'Tool?', { answerState: 'decided', answer: 'Yes' }),
    question('b', 'Tool?', { answerState: 'not-relevant' }),
    question('c', 'Tool?', { answerState: 'revisit-later', revisit: { date: '2020-01-01', condition: 'Tool shortage', acknowledgedAt: null } }),
    question('d', 'Tool?', { answerState: 'decided', answer: 'Yes', review: true }),
    question('e', 'Tool?', { kind: 'direction' }),
  ]);
  let result = chooser.suggest(doc);
  assert.equal(result.status, 'excluded'); assert.deepEqual(result.counts, { questions: 4, resolved: 2, deferred: 1, review: 1, eligible: 0, matched: 0, dismissed: 0 });
  doc.nodes = doc.nodes.filter(n => !['c', 'd', 'e'].includes(n.id)); assert.equal(chooser.suggest(doc).status, 'resolved');
  assert.equal(chooser.suggest(map()).status, 'empty');
  assert.equal(chooser.suggest(map([question('a', 'ÉNERGIE?')], { objective: 'énergie' })).candidate.id, 'a');
  assert.equal(chooser.suggest(map([question('a', 'AI?')], { objective: 'AI' })).status, 'no-match');
  assert.equal(chooser.suggest(map([question('a', 'The outcome?')], { objective: 'the goal' })).status, 'no-match');
});

test('next question dismissal belongs to unchanged source and guidance, survives unrelated edits, and prunes removal', () => {
  const chooser = new suggestions.NextQuestion(), doc = map([question('a', 'Tool?'), question('b', 'Other?')]);
  chooser.suggest(doc); chooser.dismiss(doc, 'a');
  assert.equal(chooser.suggest(doc).status, 'dismissed');
  doc.revision++; doc.nodes[2].answer = 'Unrelated'; doc.nodes[1].revisit = { date: '2020-01-01', condition: 'Manual', acknowledgedAt: null };
  assert.equal(chooser.suggest(doc).status, 'dismissed', 'poll, other answer and reminder do not resurrect source');
  doc.nodes[1].answer = 'A changed saved answer'; assert.equal(chooser.suggest(doc).candidate.id, 'a');
  chooser.dismiss(doc, 'a'); doc.objective = 'Tool ownership'; assert.equal(chooser.suggest(doc).candidate.id, 'a');
  chooser.dismiss(doc, 'a'); const removed = doc.nodes.splice(1, 1)[0]; assert.equal(chooser.suggest(doc).candidate, null);
  doc.nodes.push(removed); assert.equal(chooser.suggest(doc).candidate.id, 'a', 'removed identity pruned');
  chooser.dismiss(doc, 'a'); assert.equal(new suggestions.NextQuestion().suggest(doc).candidate.id, 'a', 'reload lifetime');
  chooser.suggest(map()); assert.equal(chooser.suggest(doc).candidate.id, 'a', 'journey boundary clears dismissal');
  doc.nodes.at(-1).review = true; assert.equal(chooser.suggest(doc).candidate, null);
});

test('next question scans the complete maximum map and guidance without mutating or reading private context', () => {
  const doc = map(Array.from({ length: 4999 }, (_, i) => question(`q${String(i).padStart(4, '0')}`, i === 4998 ? 'Criticalbudget?' : 'Other?')),
    { objective: 'x'.repeat(2000), successCriteria: 'y'.repeat(4000) });
  doc.pins = Array.from({ length: 10 }, (_, i) => ({ id: `constraint0000000000${i}`, text: i === 9 ? 'z'.repeat(985) + ' Criticalbudget' : 'z'.repeat(1000) }));
  validateDocument(doc);
  const before = JSON.stringify(doc), chooser = new suggestions.NextQuestion();
  const result = chooser.suggest(doc);
  assert.equal(result.candidate.id, 'q4998'); assert.equal(result.counts.questions, 4999); assert.equal(JSON.stringify(doc), before);
  Object.defineProperty(doc.nodes[1], 'research', { get: () => { throw Error('private research read'); } });
  Object.defineProperty(doc, 'projectContext', { get: () => { throw Error('project context read'); } });
  assert.equal(chooser.suggest(doc).candidate.id, 'q4998');
});
