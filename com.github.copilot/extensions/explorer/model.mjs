import { validateBrief, briefMarkdown } from './decision-brief.mjs';
import { randomUUID } from 'node:crypto';
import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus } from './web/answer-state.mjs';
import { effectiveMode, validMode, MODES } from './web/modes.mjs';
export { effectiveMode } from './web/modes.mjs';
export { effectiveAnswerState, questionCounts, isQuestion, effectiveKind } from './web/answer-state.mjs';

export const FORMAT = 'copilot-explorer';
export const MAX_NODES = 5000;
export const MAX_DOCUMENT_BYTES = 9 * 1024 * 1024;
export const MAX_OBJECTIVE = 2000;
export const MAX_SUCCESS_CRITERIA = 4000;
export function pinnedConstraints(value) {
  const seen = new Set();
  return list(value, 'pinned constraints (at most 10)', 10, pin => {
    if (!pin || typeof pin !== 'object' || Array.isArray(pin) || Object.keys(pin).sort().join(',') !== 'id,text' ||
      typeof pin.id !== 'string' || !/^[a-zA-Z0-9_-]{20,80}$/.test(pin.id) || seen.has(pin.id) ||
      typeof pin.text !== 'string' || !pin.text.trim() || pin.text.length > 1000) throw new Error('Each constraint needs a unique opaque ID and nonblank text of at most 1,000 characters.');
    seen.add(pin.id); return { id: pin.id, text: pin.text };
  });
}
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
export function directionText(value) {
  text(value, 'Direction', 600);
  return value;
}
export function questions(value) {
  const result = list(value, 'questions', 6, q => ({
    question: text(q?.question, 'Question', 600),
    category: text(q?.category, 'Category', 60),
    ...(q && Object.hasOwn(q, 'rationale') ? { rationale: text(q.rationale, 'Question rationale', 1000) } : {}),
  }));
  if (!result.length) throw new Error('Return at least one question.');
  return result;
}
export function candidateQuestions(doc, parentId, values) {
  findNode(doc, parentId);
  const seen = new Set(doc.nodes.filter(n => n.parentId === parentId).map(n => n.question.toLowerCase()));
  return questions(values).map(q => {
    const key = q.question.toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate question. Adjust or deselect it before accepting.');
    seen.add(key); return q;
  });
}
function generation(value, question, category) {
  if (!value || Object.keys(value).some(k => !['requestId', 'originalQuestion', 'originalCategory', 'adjusted'].includes(k))) throw new Error('Invalid question generation provenance.');
  const result = { requestId: text(value.requestId, 'Generation request ID', 100), originalQuestion: text(value.originalQuestion, 'Original question', 600), originalCategory: text(value.originalCategory, 'Original category', 60), adjusted: value.adjusted };
  if (typeof result.adjusted !== 'boolean' || result.adjusted !== (question !== result.originalQuestion) || category !== result.originalCategory) throw new Error('Invalid question adjustment provenance.');
  return result;
}
export function acceptQuestions(doc, parentId, batch, selected) {
  if (!Array.isArray(selected) || !selected.length || selected.length > 6) throw new Error('Select at least one preview question (at most six).');
  const seen = new Set();
  const values = selected.map(value => {
    if (!value || Object.keys(value).some(k => !['index', 'question'].includes(k)) || !Number.isInteger(value.index) || !batch.questions[value.index] || seen.has(value.index)) throw new Error('Invalid preview selection.');
    seen.add(value.index);
    return { question: value.question, category: batch.questions[value.index].category };
  });
  const validated = candidateQuestions(doc, parentId, values);
  const next = structuredClone(doc), nodes = addQuestions(next, parentId, validated);
  nodes.forEach((node, i) => {
    const original = batch.questions[selected[i].index];
    node.generation = generation({ requestId: batch.id, originalQuestion: original.question, originalCategory: original.category, adjusted: node.question !== original.question }, node.question, node.category);
    if (Object.hasOwn(original, 'rationale')) node.rationale = text(original.rationale, 'Question rationale', 1000);
  });
  next.finishedAt = null;
  validateDocument(next);
  return { document: next, ids: nodes.map(n => n.id) };
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
export function createDocument(topic, { objective = '', successCriteria = '', mode = 'understand' } = {}) {
  const now = new Date().toISOString();
  const id = randomUUID();
  return { format: FORMAT, version: 1, id: randomUUID(), revision: 0, topic: text(topic, 'Idea', 4000),
    objective: guidanceText(objective, 'Objective', MAX_OBJECTIVE), successCriteria: guidanceText(successCriteria, 'Success criteria', MAX_SUCCESS_CRITERIA),
    ...(validMode(mode) === 'understand' ? {} : { mode }),
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
    ...(Object.hasOwn(n, 'kind') ? { kind: n.kind } : {}),
    question: n.kind === 'direction' ? directionText(n.question) : text(n.question, 'Question', n.id === value.rootId ? 4000 : 600),
    category: text(n.category, 'Category', 60), answer: guidanceText(n.answer, 'Answer', 20000),
    ...(Object.hasOwn(n, 'rationale') ? { rationale: text(n.rationale, 'Question rationale', 1000) } : {}),
    ...(Object.hasOwn(n, 'answerState') ? { answerState: n.answerState } : {}),
    research: n.research === null ? null : research(n.research), review: n.review === true,
    ...(Object.hasOwn(n, 'generation') ? { generation: generation(n.generation, text(n.question, 'Question', 600), text(n.category, 'Category', 60)) } : {}),
  }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const node of nodes) {
    if (Object.hasOwn(node, 'kind') && (node.kind !== 'direction' || node.id === value.rootId)) throw new Error('Invalid node kind.');
    if (Object.hasOwn(node, 'rationale') && (node.id === value.rootId || !isQuestion(node) || !node.generation)) throw new Error('Only generated ordinary questions can have a rationale.');
    if (!isQuestion(node) && node.kind === 'direction' && (node.answer !== '' || Object.hasOwn(node, 'answerState') || node.research !== null || Object.hasOwn(node, 'generation'))) throw new Error('A direction cannot have an answer, answer state, research or AI generation provenance.');
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
    ...(Object.hasOwn(value, 'mode') ? { mode: validMode(value.mode) } : {}),
    ...(Object.hasOwn(value, 'pins') ? { pins: pinnedConstraints(value.pins) } : {}),
    rootId: root.id, createdAt: date(value.createdAt, 'creation date'), updatedAt: date(value.updatedAt, 'update date'),
    ...(Object.hasOwn(value, 'brief') ? { brief: validateBrief(value.brief) } : {}),
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
export function addDirection(doc, parentId, value) {
  findNode(doc, parentId);
  const question = directionText(value);
  if (doc.nodes.some(n => n.parentId === parentId && n.question.trim().toLowerCase() === question.trim().toLowerCase())) throw new Error('This direction already exists in this branch.');
  if (doc.nodes.length >= MAX_NODES) throw new Error(`This POC supports up to ${MAX_NODES} nodes per map.`);
  const node = { id: randomUUID(), parentId, kind: 'direction', question, category: 'Direction', answer: '', research: null, review: false };
  validateDocument({ ...doc, nodes: [...doc.nodes, node] });
  doc.nodes.push(node);
  return node;
}
export function answerNode(doc, id, answer, answerState) {
  const node = findNode(doc, id);
  if (!isQuestion(node)) throw new Error('Only question nodes can have answers.');
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
    path.push({ id: node.id, question: node.question, answer: node.answer, ...(isQuestion(node) ? { answerState: effectiveAnswerState(node) } : node.kind === 'direction' ? { kind: 'direction', origin: 'user' } : {}), review: node.review });
  }
  const relevant = [...doc.nodes.filter(n => n.parentId === nodeId), ...path.map(p => byId.get(p.id))];
  const historicalRationales = relevant.filter(n => n && isQuestion(n) && n.rationale && n.generation).slice(-12).map(n => ({
    question: n.question, originalQuestion: n.generation.originalQuestion, rationale: n.rationale,
    provenance: 'Historical model explanation for the original suggested wording and context; not a user fact or decision.',
  }));
  return { topic: doc.topic, objective: doc.objective ?? '', successCriteria: doc.successCriteria ?? '', mode: effectiveMode(doc), path: path.reverse(), historicalRationales,
    existingQuestions: doc.nodes.filter(n => n.parentId === nodeId && isQuestion(n)).map(n => n.question),
    directions: doc.nodes.filter(n => n.parentId === nodeId && n.kind === 'direction').map(n => ({ kind: 'direction', origin: 'user', text: n.question })),
    decisionsElsewhere: doc.nodes.filter(n => isQuestion(n) && (n.answer.trim() || effectiveAnswerState(n) !== 'unanswered') && !path.some(p => p.id === n.id)).map(n => ({ question: n.question, answer: n.answer, answerState: effectiveAnswerState(n), review: n.review })) };
}
const md = value => String(value).replace(/[\\`*_{}[\]<>#+!|]/g, '\\$&');
export function toMarkdown(doc) {
  validateDocument(doc);
  const { answered, resolved, deferred, unresolved } = questionCounts(doc);
  const lines = ['# Exploration: ' + md(doc.topic), '', `Saved: ${doc.updatedAt}`, '',
    `${answered} answered; ${resolved} resolved; ${deferred} deferred; ${unresolved} unresolved questions.`, '',
    'This record preserves user answers separately from AI research. Open questions are unresolved, not decisions.', '',
    '## Guidance', '', `**Mode: ${MODES[effectiveMode(doc)].label}**`, '', '**Objective:**', '', doc.objective ? md(doc.objective) : '_Not set._', '',
    '**Success criteria:**', '', doc.successCriteria ? md(doc.successCriteria) : '_Not set._', '',
    'Criteria guide exploration; the user decides when to finish.', '',
    ...(doc.pins?.length ? ['## User-supplied constraints', '', 'User statements, not verified facts, answered questions or AI explanations. Private visual references are separate.', '', ...doc.pins.flatMap(pin => [`### ${md(pin.id)}`, '', md(pin.text), ''])] : []),
    '## Map', '',
    '| ID | Parent | Category | Question | Status |', '| --- | --- | --- | --- | --- |'];
  const ids = new Map(doc.nodes.map((n, i) => [n.id, `N${i}`]));
  for (const n of doc.nodes) lines.push(`| ${ids.get(n.id)} | ${ids.get(n.parentId) ?? '—'} | ${md(n.category).replace(/\n/g, ' ')} | ${md(n.question).replace(/\n/g, ' ')} | ${nodeStatus(n)}${n.review ? '; needs review' : ''} |`);
  for (const n of doc.nodes) {
    if (n.id === doc.rootId) continue;
    lines.push('', `## ${ids.get(n.id)}: ${md(n.question)}`, '', `Category: ${md(n.category)}. Parent: ${ids.get(n.parentId)}.`, '');
    if (n.review) lines.push('**Needs review:** an ancestor answer changed after this branch was created.', '');
    if (!isQuestion(n)) { lines.push('Direction (user supplied). Original direction text; not an answer or decision.', ''); continue; }
    lines.push('### User answer', '', `State: ${ANSWER_STATES[effectiveAnswerState(n)]}.`, '', n.answer ? md(n.answer) : '_No answer text._', '');
    if (n.generation) lines.push('### Question provenance', '', `Generated question: ${md(n.generation.originalQuestion)}`, '', `Generated category: ${md(n.generation.originalCategory)}. ${n.generation.adjusted ? 'Wording adjusted by the user before acceptance.' : 'Accepted without wording changes.'}`, '');
    if (n.rationale) {
      lines.push('### Why this question?', '', 'Historical model explanation for the original suggested wording and context; not a user fact or decision.', '');
      if (n.generation?.adjusted) lines.push(`Original suggested wording: ${md(n.generation.originalQuestion)}`, '');
      lines.push(md(n.rationale), '');
    }
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
  if (doc.brief) lines.push('', briefMarkdown(doc.brief, doc));
  return lines.join('\n') + '\n';
}
