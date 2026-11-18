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
  assert.equal(result.candidate.id, 'd'); assert.deepEqual(result.counts, { questions: 4, resolved: 2, deferred: 1, review: 1, eligible: 1, matched: 1, dismissed: 0 });
  doc.nodes[4].answerState = 'revisit-later'; assert.equal(chooser.suggest(doc).status, 'excluded');
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
  doc.nodes.at(-1).review = true; assert.equal(chooser.suggest(doc).candidate.id, 'a');
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

test('influential unresolved assumptions outrank literal high-importance leaves with exact saved-map evidence', () => {
  const chooser = new suggestions.NextQuestion(), doc = map([ranked('leaf', 'Tool reliability?', 'high'), question('source', 'Database choice?', { answer: 'Probably SQL', answerState: 'assumption', review: true }),
    ...Array.from({ length: 20 }, (_, i) => question(`child-${i}`, 'Unanswered detail?', { parentId: 'source' }))]);
  doc.dependencies = [{ dependentId: 'leaf', prerequisiteId: 'source' }];
  const chosen = chooser.suggest(doc).candidate;
  assert.equal(chosen.id, 'source'); assert.equal(chosen.review, true); assert.equal(chosen.impact.band, 'high');
  assert.equal(chosen.impact.counts.total, 21); assert.equal(chosen.impact.counts.structural, 20); assert.equal(chosen.impact.counts.confirmed, 1); assert.equal(chosen.impact.counts.states.unanswered, 21);
  assert.equal(chosen.importance, null); assert.deepEqual(chosen.goalTerms, []);
  doc.objective = ''; assert.equal(chooser.suggest(doc).candidate.id, 'source', 'impact supports maps without guidance');
  delete doc.dependencies; const treeOnly = chooser.suggest(doc).candidate;
  assert.equal(treeOnly.id, 'source'); assert.equal(treeOnly.impact.counts.confirmed, 0); assert.equal(treeOnly.impact.counts.total, 20);
  doc.nodes.at(-1).answerState = 'decided'; doc.nodes.at(-1).answer = 'Saved'; assert.equal(chooser.suggest(doc).candidate.impact.counts.states.unanswered, 19, 'same-revision saved changes refresh exact evidence');
});

test('review eligibility honors explicit deferral and favors assumptions; dismissal tracks relevant impact and causes', () => {
  const chooser = new suggestions.NextQuestion(), doc = map([question('a', 'Tool?', { answer: 'Yes', answerState: 'decided', review: true }), question('b', 'Tool?', { answer: 'Maybe', answerState: 'assumption', review: true }), question('c', 'Tool?', { answerState: 'revisit-later', review: true })]);
  assert.equal(chooser.suggest(doc).candidate.id, 'b'); chooser.dismiss(doc, 'b'); assert.equal(chooser.suggest(doc).candidate.id, 'a');
  doc.nodes.push(question('unrelated', 'Other?', { answer: 'Settled', answerState: 'decided' })); assert.equal(chooser.suggest(doc).candidate.id, 'a');
  doc.nodes[2].reviewCauses = { changes: [{ sourceId: 'a', revision: 1, baseDigest: 'a'.repeat(64) }], earlier: false }; assert.equal(chooser.suggest(doc).candidate.id, 'b');
  chooser.dismiss(doc, 'b'); doc.dependencies = [{ dependentId: 'unrelated', prerequisiteId: 'b' }]; assert.equal(chooser.suggest(doc).candidate.id, 'b', 'changed impact band resets dismissal');
  chooser.dismiss(doc, 'b'); doc.nodes.at(-1).answer = 'Different settled wording'; assert.equal(chooser.suggest(doc).candidate.id, 'a', 'same band and unrelated answer do not reset dismissal');
  doc.nodes[1].answerState = 'not-relevant'; assert.equal(chooser.suggest(doc).candidate.id, 'a', 'not-relevant review remains eligible');
});
