import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { helpContext, parseHelp, helpText, sameHelpContext } from '../com.github.copilot/extensions/explorer/question-help.mjs';

test('question help takes bounded saved selected context and nearest complete ancestors', () => {
  const doc = createDocument('A topic', { objective: 'Understand choices', successCriteria: 'Know the tradeoffs' });
  const [first] = addQuestions(doc, doc.rootId, [{ question: 'First?', category: 'A' }]);
  first.answer = 'Earlier answer'; first.answerState = 'tentative';
  const [selected] = addQuestions(doc, first.id, [{ question: 'What does λ mean?', category: 'Technical' }]);
  selected.answer = 'Do not send this answer'; selected.rationale = undefined;
  const input = helpContext(doc, selected.id);
  assert.ok(JSON.stringify(input).length <= 16000);
  assert.equal(input.selected.question, selected.question);
  assert.equal(input.ancestors[0].id, first.id);
  assert.equal(input.ancestors[0].answer, first.answer);
  assert.ok(!JSON.stringify(input).includes(selected.answer));
  assert.equal(sameHelpContext(input, structuredClone(doc)), true);
  addQuestions(doc, doc.rootId, [{ question: 'Unrelated?', category: 'Other' }]);
  doc.nodes.at(-1).answer = 'Unincluded change';
  assert.equal(sameHelpContext(input, doc), true);
  first.answer = 'Changed'; assert.equal(sameHelpContext(input, doc), false);
  first.answer = 'Earlier answer'; selected.kind = 'direction'; assert.equal(sameHelpContext(input, doc), false);
});

test('help parser rejects malformed and overlong output; preserves Unicode and markup as text', () => {
  for (const operation of ['rephrase', 'example', 'terms']) {
    assert.equal(parseHelp(JSON.stringify({ text: '<script>λ😀</script>' }), operation), '<script>λ😀</script>');
  }
  assert.throws(() => helpText(' '));
  assert.throws(() => parseHelp('{"text":" "}', 'terms'));
  assert.throws(() => parseHelp('{"text":"x","action":"save"}', 'example'));
  assert.throws(() => parseHelp(JSON.stringify({ text: 'x'.repeat(4001) }), 'rephrase'));
  assert.throws(() => parseHelp('{"text":"ok"}', 'other'));
});

test('context cap omits whole ancestors and reports gaps without rewriting saved text', () => {
  const doc = createDocument('Topic');
  let parent = doc.rootId;
  for (let i = 0; i < 30; i++) {
    const [node] = addQuestions(doc, parent, [{ question: `Question ${i}?`, category: 'Branch' }]);
    node.answer = '😀'.repeat(4000); node.answerState = 'tentative'; parent = node.id;
  }
  const [selected] = addQuestions(doc, parent, [{ question: 'Technical λ?', category: 'Terms' }]);
  const input = helpContext(doc, selected.id);
  assert.ok(JSON.stringify(input).length <= 16000);
  assert.equal(input.ancestors[0].id, parent);
  assert.equal(input.ancestors[0].answer, '😀'.repeat(4000));
  assert.ok(input.omissions.ancestorIds.length > 0);
  assert.equal(input.ancestors.length + input.omissions.ancestorIds.length + input.omissions.unlistedCount, 31);
  assert.equal(sameHelpContext(input, doc), true);
  doc.nodes.find(n => n.id === input.omissions.ancestorIds[0]).answer = 'Changed omitted record';
  assert.equal(sameHelpContext(input, doc), true);
});
