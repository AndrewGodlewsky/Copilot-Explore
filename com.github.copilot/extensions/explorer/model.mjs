import { randomUUID } from 'node:crypto';
import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts } from './web/answer-state.mjs';
export { effectiveAnswerState, questionCounts } from './web/answer-state.mjs';

export const FORMAT = 'copilot-explorer';
export const MAX_NODES = 5000;
export const MAX_DOCUMENT_BYTES = 9 * 1024 * 1024;
export const MAX_OBJECTIVE = 2000;
export const MAX_SUCCESS_CRITERIA = 4000;
export function guidanceText(value, name, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text of at most ${max} characters.`);
  return value;
}
export function text(value, name, max = 20000, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) {
    throw new Error(`${name} must be ${empty ? '' : 'nonempty '}text of at most ${max} characters.`);
  }
  return value.trim();
}
function list(value, name, max, convert) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${name}.`);
  return value.map(convert);
}
export function questions(value) {
  const result = list(value, 'questions', 6, q => ({
    question: text(q?.question, 'Question', 600),
    category: text(q?.category, 'Category', 60),
  }));
  if (!result.length) throw new Error('Return at least one question.');
  return result;
}
export function research(value) {
  if (!value || !['sources', 'reasoning'].includes(value.basis)) throw new Error('Research needs a basis: sources or reasoning.');
  const sources = list(value.sources, 'sources', 15, source => {
    const url = new URL(text(source?.url, 'Source URL', 2000));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Sources must be public HTTP(S) URLs.');
    return { title: text(source.title, 'Source title', 300), url: url.href };
  });
  if (value.basis === 'sources' && !sources.length) throw new Error('Sourced research needs at least one consulted source.');
  const options = list(value.options, 'options', 4, option => ({
    title: text(option?.title, 'Option title', 150),
    description: text(option.description, 'Option description', 3000),
    pros: list(option.pros, 'pros', 6, v => text(v, 'Pro', 1000)),
    cons: list(option.cons, 'cons', 6, v => text(v, 'Con', 1000)),
    ...(option.proposedAnswer !== undefined ? { proposedAnswer: text(option.proposedAnswer, 'Proposed answer', 5000) } : {}),
    ...(option.details !== undefined ? { details: list(option.details, 'details', 8, d => ({ label: text(d?.label, 'Detail label', 80), value: text(d.value, 'Detail value', 1000) })) } : {}),
  }));
  if (options.length < 2) throw new Error('Compare at least two options.');
  return { basis: value.basis, summary: text(value.summary, 'Research summary', 5000), options,
    recommendation: text(value.recommendation, 'Recommendation', 5000),
    ...(value.proposedAnswer !== undefined ? { proposedAnswer: text(value.proposedAnswer, 'Proposed answer', 5000) } : {}),
    uncertainty: text(value.uncertainty, 'Uncertainty', 3000), sources };
}
export function createDocument(topic, { objective = '', successCriteria = '' } = {}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  return { format: FORMAT, version: 1, id: randomUUID(), revision: 0, topic: text(topic, 'Idea', 4000),
    objective: guidanceText(objective, 'Objective', MAX_OBJECTIVE), successCriteria: guidanceText(successCriteria, 'Success criteria', MAX_SUCCESS_CRITERIA),
    createdAt: now, updatedAt: now, finishedAt: null, rootId: id,
    nodes: [{ id, parentId: null, question: topic.trim(), category: 'Your idea', answer: '', research: null, review: false }] };
}
export function validateDocument(value) {
  if (value?.format !== FORMAT || value.version !== 1) throw new Error('This is not a supported Explorer v1 file.');
  const date = (v, name) => {
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new Error(`Invalid ${name}.`);
    return v;
  };
  const nodes = list(value.nodes, 'nodes', MAX_NODES, n => ({
    id: text(n?.id, 'Node ID', 100), parentId: n.parentId === null ? null : text(n.parentId, 'Parent ID', 100),
    question: text(n.question, 'Question', n.id === value.rootId ? 4000 : 600),
    category: text(n.category, 'Category', 60), answer: guidanceText(n.answer, 'Answer', 20000),
    ...(Object.hasOwn(n, 'answerState') ? { answerState: n.answerState } : {}),
    research: n.research === null ? null : research(n.research), review: n.review === true,
  }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const node of nodes) {
    const error = answerStateError(node.answer, Object.hasOwn(node, 'answerState') ? node.answerState : effectiveAnswerState(node));
    if (error) throw new Error(error);
  }
  if (!nodes.length || byId.size !== nodes.length) throw new Error('Node IDs must be unique.');
  const root = byId.get(value.rootId);
  if (!root || root.parentId !== null || nodes.filter(n => n.parentId === null).length !== 1) throw new Error('The map must have one root.');
  const children = new Map(nodes.map(n => [n.id, []]));
  for (const n of nodes) {
    if (n.parentId === null) continue;
    if (!children.has(n.parentId)) throw new Error('A node refers to a missing parent.');
    children.get(n.parentId).push(n.id);
  }
  const reached = new Set();
  const queue = [root.id];
  for (let i = 0; i < queue.length; i++) {
    if (reached.has(queue[i])) throw new Error('The map contains a cycle.');
    reached.add(queue[i]);
    queue.push(...children.get(queue[i]));
  }
  if (reached.size !== nodes.length) throw new Error('The map contains disconnected nodes or a cycle.');
  const topic = text(value.topic, 'Idea', 4000);
  if (root.question !== topic) throw new Error('The root must match the idea.');
  const document = { format: FORMAT, version: 1, id: text(value.id, 'Exploration ID', 100),
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    topic, objective: guidanceText(Object.hasOwn(value, 'objective') ? value.objective : '', 'Objective', MAX_OBJECTIVE),
    successCriteria: guidanceText(Object.hasOwn(value, 'successCriteria') ? value.successCriteria : '', 'Success criteria', MAX_SUCCESS_CRITERIA),
    rootId: root.id, createdAt: date(value.createdAt, 'creation date'), updatedAt: date(value.updatedAt, 'update date'),
    finishedAt: value.finishedAt === null ? null : date(value.finishedAt, 'finish date'), nodes };
  if (Buffer.byteLength(JSON.stringify(document, null, 2)) > MAX_DOCUMENT_BYTES) throw new Error('This map has reached the 9 MiB saved-data limit. Export it and continue in a new exploration.');
  return document;
}
export function findNode(doc, id) {
  const node = doc?.nodes.find(n => n.id === id);
  if (!node) throw new Error('That node no longer exists.');
  return node;
}
export function addQuestions(doc, parentId, values) {
  findNode(doc, parentId);
  const existing = new Set(doc.nodes.filter(n => n.parentId === parentId).map(n => n.question.toLowerCase()));
  const additions = questions(values).filter(q => {
    const key = q.question.toLowerCase();
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  if (doc.nodes.length + additions.length > MAX_NODES) throw new Error(`This POC supports up to ${MAX_NODES} nodes per map.`);
  if (!additions.length) throw new Error('These questions already exist. Try different questions.');
  const nodes = additions.map(q => ({ id: randomUUID(), parentId, ...q, answer: '', research: null, review: false }));
  doc.nodes.push(...nodes);
  return nodes;
}
export function answerNode(doc, id, answer, answerState) {
  const node = findNode(doc, id);
  if (id === doc.rootId) throw new Error('Answer a question rather than the central idea.');
  const next = guidanceText(answer, 'Answer', 20000);
  const previousState = effectiveAnswerState(node);
  const state = answerState === undefined ? (answerStateError(next, previousState) ? (next.trim() ? 'tentative' : 'unanswered') : previousState) : answerState;
  const error = answerStateError(next, state); if (error) throw new Error(error);
  const changed = node.answer !== next || previousState !== state;
  if (!changed && !node.review) return false;
  if (changed) {
    const children = new Map(doc.nodes.map(n => [n.id, []]));
    for (const n of doc.nodes) if (n.parentId) children.get(n.parentId).push(n);
    const queue = [id];
    for (let i = 0; i < queue.length; i++) for (const child of children.get(queue[i])) {
      child.review = true; queue.push(child.id);
    }
  }
  node.answer = next;
  node.answerState = state;
  node.review = false;
  return true;
}
export function contextFor(doc, nodeId) {
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const path = [];
  for (let node = findNode(doc, nodeId); node; node = byId.get(node.parentId)) {
    path.push({ id: node.id, question: node.question, answer: node.answer, ...(node.id !== doc.rootId ? { answerState: effectiveAnswerState(node) } : {}), review: node.review });
  }
  return { topic: doc.topic, objective: doc.objective ?? '', successCriteria: doc.successCriteria ?? '', path: path.reverse(),
    existingQuestions: doc.nodes.filter(n => n.parentId === nodeId).map(n => n.question),
    decisionsElsewhere: doc.nodes.filter(n => n.id !== doc.rootId && (n.answer.trim() || effectiveAnswerState(n) !== 'unanswered') && !path.some(p => p.id === n.id)).map(n => ({ question: n.question, answer: n.answer, answerState: effectiveAnswerState(n), review: n.review })) };
}
const md = value => String(value).replace(/[\\`*_{}[\]<>#+!|]/g, '\\$&');
export function toMarkdown(doc) {
  validateDocument(doc);
  const { answered, resolved, deferred, unresolved } = questionCounts(doc);
  const lines = ['# Exploration: ' + md(doc.topic), '', `Saved: ${doc.updatedAt}`, '',
    `${answered} answered; ${resolved} resolved; ${deferred} deferred; ${unresolved} unresolved questions.`, '',
    'This record preserves user answers separately from AI research. Open questions are unresolved, not decisions.', '',
    '## Guidance', '', '**Objective:**', '', doc.objective ? md(doc.objective) : '_Not set._', '',
    '**Success criteria:**', '', doc.successCriteria ? md(doc.successCriteria) : '_Not set._', '',
    'Criteria guide exploration; the user decides when to finish.', '', '## Map', '',
    '| ID | Parent | Category | Question | Status |', '| --- | --- | --- | --- | --- |'];
  const ids = new Map(doc.nodes.map((n, i) => [n.id, `N${i}`]));
  for (const n of doc.nodes) lines.push(`| ${ids.get(n.id)} | ${ids.get(n.parentId) ?? '—'} | ${md(n.category).replace(/\n/g, ' ')} | ${md(n.question).replace(/\n/g, ' ')} | ${n.id === doc.rootId ? 'Idea' : ANSWER_STATES[effectiveAnswerState(n)]}${n.review ? '; needs review' : ''} |`);
  for (const n of doc.nodes) {
    if (n.id === doc.rootId) continue;
    lines.push('', `## ${ids.get(n.id)}: ${md(n.question)}`, '', `Category: ${md(n.category)}. Parent: ${ids.get(n.parentId)}.`, '');
    if (n.review) lines.push('**Needs review:** an ancestor answer changed after this branch was created.', '');
    lines.push('### User answer', '', `State: ${ANSWER_STATES[effectiveAnswerState(n)]}.`, '', n.answer ? md(n.answer) : '_No answer text._', '');
    if (n.research) {
      const r = n.research;
      lines.push('### AI research', '', `Basis: ${r.basis === 'sources' ? 'Consulted sources' : 'Model reasoning; not externally verified'}.`, '', md(r.summary), '');
      for (const o of r.options) {
        lines.push(`#### ${md(o.title)}`, '', md(o.description), '', '**Pros**', '', ...o.pros.map(p => `- ${md(p)}`), '', '**Cons**', '', ...o.cons.map(p => `- ${md(p)}`), '');
        if (o.proposedAnswer) lines.push('Suggested draft: ' + md(o.proposedAnswer), '');
        for (const detail of o.details ?? []) lines.push(`- ${md(detail.label)}: ${md(detail.value)}`);
      }
      lines.push('**Recommendation:** ' + md(r.recommendation), '', '**Uncertainty:** ' + md(r.uncertainty), '');
      if (r.proposedAnswer) lines.push('Suggested draft: ' + md(r.proposedAnswer), '');
      for (const source of r.sources) lines.push(`- [${md(source.title)}](<${source.url.replace(/>/g, '%3E').replace(/</g, '%3C')}>)`);
    }
  }
  return lines.join('\n') + '\n';
}
