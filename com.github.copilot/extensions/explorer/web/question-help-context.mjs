import { effectiveAnswerState, isQuestion } from './answer-state.mjs';

const selectedRecord = n => ({ id: n.id, parentId: n.parentId, question: n.question, category: n.category });
const ancestorRecord = n => ({ id: n.id, parentId: n.parentId, question: n.question, category: n.category, answer: n.answer, ...(isQuestion(n) ? { answerState: effectiveAnswerState(n) } : {}), ...(n.kind ? { kind: n.kind } : {}) });
export function helpContext(doc, nodeId) {
  const node = doc?.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error('That node no longer exists.');
  if (node.id === doc.rootId || !isQuestion(node)) throw new Error('Select an ordinary question for help.');
  const input = { selected: selectedRecord(node), topic: doc.topic, objective: doc.objective, successCriteria: doc.successCriteria, ancestors: [], omissions: { ancestorIds: [], unlistedCount: 0 } };
  if (JSON.stringify(input).length > 16000) throw new Error('The selected question and guidance exceed the question help context limit. Shorten the saved guidance before trying again.');
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  for (let parent = byId.get(node.parentId); parent; parent = byId.get(parent.parentId)) {
    const record = ancestorRecord(parent);
    input.ancestors.push(record);
    if (JSON.stringify(input).length > 16000) {
      input.ancestors.pop(); input.omissions.ancestorIds.push(parent.id);
      if (JSON.stringify(input).length > 16000) { input.omissions.ancestorIds.pop(); input.omissions.unlistedCount++; }
    }
  }
  if (JSON.stringify(input).length > 16000) throw new Error('Question help context metadata exceeds the limit.');
  return input;
}
export function sameHelpContext(input, doc) {
  if (!input?.selected || !Array.isArray(input.ancestors) || !doc || [doc.topic, doc.objective, doc.successCriteria].some((value, i) => value !== [input.topic, input.objective, input.successCriteria][i])) return false;
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const selected = byId.get(input.selected.id);
  if (!selected || selected.id === doc.rootId || !isQuestion(selected) || JSON.stringify(selectedRecord(selected)) !== JSON.stringify(input.selected)) return false;
  const path = new Set();
  for (let parent = byId.get(selected.parentId); parent; parent = byId.get(parent.parentId)) path.add(parent.id);
  return input.ancestors.every(record => path.has(record.id) && JSON.stringify(ancestorRecord(byId.get(record.id))) === JSON.stringify(record));
}
