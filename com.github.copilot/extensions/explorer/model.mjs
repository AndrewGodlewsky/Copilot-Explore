import { validateHandoff, handoffMarkdown } from './implementation-handoff.mjs';
import { validateAdrDraft } from './adr-draft.mjs';
import { validateAdrFiles } from './adr-file.mjs';
import { validateNodeAttribution } from './contributors.mjs';
import { validateComments } from './comments.mjs';
import { validateAdrScope, adrScopeMarkdown } from './adr-scope.mjs';
import { validateAdrFormat } from './adr-format.mjs';
import { scenarioOrigin } from './scenario-origin.mjs';
import { validateBrief, briefMarkdown } from './decision-brief.mjs';
import { randomUUID } from 'node:crypto';
import { DecisionImpact } from './web/decision-impact.mjs';
import { savedDigest, reviewCauses, addReviewCause, reviewCauseKey } from './review-causes.mjs';
import { researchSettings, researchSettingsText } from './web/research-policy.mjs';
import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, effectiveKind, nodeStatus } from './web/answer-state.mjs';
import { effectiveMode, validMode, MODES } from './web/modes.mjs';
import { validateRevisit } from './web/revisit.mjs';
export { localDate, revisitStatuses } from './web/revisit.mjs';
export { effectiveMode } from './web/modes.mjs';
export { DecisionImpact, impactPath, decisionImpactKey, criticalPaths, IMPACT_RULES } from './web/decision-impact.mjs';
export { effectiveAnswerState, questionCounts, isQuestion, effectiveKind } from './web/answer-state.mjs';

export const FORMAT = 'copilot-explorer';
export const MAX_NODES = 5000;
export const MAX_DOCUMENT_BYTES = 9 * 1024 * 1024;
export const MAX_OBJECTIVE = 2000;
export const MAX_SUCCESS_CRITERIA = 4000;
export const MAX_DEPENDENCIES = 10000;
function decisionDependencies(value, nodes) {
  if (!Array.isArray(value) || value.length > MAX_DEPENDENCIES) throw Error('Dependencies must be a list of at most 10,000 relationships.');
  const byId = new Map(nodes.map(node => [node.id, node])), seen = new Set(), children = new Map(nodes.map(node => [node.id, []])), incoming = new Map(nodes.map(node => [node.id, 0]));
  const result = value.map(link => {
    if (!link || typeof link !== 'object' || Array.isArray(link) || Object.keys(link).some(key => !['dependentId', 'prerequisiteId', 'explanation'].includes(key))) throw Error('Invalid dependency fields.');
    const { dependentId, prerequisiteId } = link;
    if (![dependentId, prerequisiteId].every(id => typeof id === 'string' && byId.has(id) && isQuestion(byId.get(id)))) throw Error('Dependencies must refer to two existing ordinary questions; a question is missing or is a structural node.');
    if (dependentId === prerequisiteId) throw Error('A question cannot depend on itself.');
    const key = JSON.stringify([dependentId, prerequisiteId]);
    if (seen.has(key)) throw Error('This dependency already exists; duplicate pairs are not allowed.');
    seen.add(key); children.get(prerequisiteId).push(dependentId); incoming.set(dependentId, incoming.get(dependentId) + 1);
    return { dependentId, prerequisiteId, ...(Object.hasOwn(link, 'explanation') ? { explanation: guidanceText(link.explanation, 'Dependency explanation', 1000) } : {}) };
  });
  const queue = nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id);
  for (let i = 0; i < queue.length; i++) for (const id of children.get(queue[i])) { incoming.set(id, incoming.get(id) - 1); if (incoming.get(id) === 0) queue.push(id); }
  if (queue.length !== nodes.length) throw Error('These dependencies create a directed cycle. Remove a relationship before adding this one.');
  return result;
}
export function addDependency(doc, dependentId, prerequisiteId, explanation) {
  const link = { dependentId, prerequisiteId, ...(explanation === undefined ? {} : { explanation }) };
  const candidate = validateDocument({ ...doc, dependencies: [...doc.dependencies ?? [], link] });
  doc.dependencies = candidate.dependencies;
}
export function removeDependency(doc, dependentId, prerequisiteId) {
  const dependencies = (doc.dependencies ?? []).filter(link => link.dependentId !== dependentId || link.prerequisiteId !== prerequisiteId);
  if (dependencies.length === (doc.dependencies ?? []).length) throw Error('That dependency no longer exists.');
  validateDocument({ ...doc, dependencies });
  if (dependencies.length) doc.dependencies = dependencies; else delete doc.dependencies;
}
export function changeDependency(doc, action, dependentId, prerequisiteId, explanation) {
  if (!['add', 'remove'].includes(action)) throw Error('Invalid dependency change.');
  const cause = { sourceId: prerequisiteId, baseDigest: savedDigest(doc), revision: doc.revision, kind: action === 'add' ? 'dependency-added' : 'dependency-removed', dependentId };
  const previous = action === 'remove' ? new DecisionImpact(doc).analyze(dependentId) : null;
  if (action === 'add') addDependency(doc, dependentId, prerequisiteId, explanation); else removeDependency(doc, dependentId, prerequisiteId);
  const impact = previous ?? new DecisionImpact(doc).analyze(dependentId);
  for (const node of doc.nodes) if (impact.predecessors.combined.has(node.id)) addReviewCause(node, cause);
  for (const node of doc.nodes) if (node.research) node.researchStale = true;
}
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
export function questionImportance(value) {
  if (!Object.hasOwn(value, 'importance') && !Object.hasOwn(value, 'importanceReason')) return {};
  if (!['low', 'medium', 'high'].includes(value.importance) || !Object.hasOwn(value, 'importanceReason')) throw new Error('Question importance needs low, medium or high and an importance reason.');
  text(value.importanceReason, 'Importance reason', 600);
  return { importance: value.importance, importanceReason: value.importanceReason };
}
export function questions(value) {
  const result = list(value, 'questions', 6, q => ({
    question: text(q?.question, 'Question', 600),
    category: text(q?.category, 'Category', 60),
    ...(q && Object.hasOwn(q, 'rationale') ? { rationale: text(q.rationale, 'Question rationale', 1000) } : {}),
    ...questionImportance(q),
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
    Object.assign(node, questionImportance(original));
  });
  next.finishedAt = null;
  validateDocument(next);
  return { document: next, ids: nodes.map(n => n.id) };
}
export const MAX_RESEARCH_BYTES = 160000;
function evidenceId(value, seen, name) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value) || seen.has(value)) throw new Error(`Invalid or duplicate ${name} ID.`);
  seen.add(value); return value;
}
function evidenceKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('Invalid research evidence fields.');
}
export function researchEvidence(value) {
  if (!value || !['sources', 'reasoning'].includes(value.basis)) throw new Error('Research needs a basis: sources or reasoning.');
  const hasClaims = Object.hasOwn(value, 'claims'), sourceIds = new Set(), sourceUrls = new Set(), claimIds = new Set();
  if (hasClaims && Buffer.byteLength(JSON.stringify(value)) > MAX_RESEARCH_BYTES) throw new Error('Research evidence exceeds its serialized limit.');
  const sources = list(value.sources, 'sources', 15, source => {
    const url = new URL(text(source?.url, 'Source URL', 2000));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Sources must be public HTTP(S) URLs.');
    if (!hasClaims) return { title: text(source.title, 'Source title', 300), url: url.href };
    evidenceKeys(source, ['id', 'title', 'url', 'retrievedAt', 'provenance']);
    url.hash = '';
    text(url.href, 'Canonical source URL', 2000);
    if (sourceUrls.has(url.href)) throw new Error('Duplicate research source URL.');
    sourceUrls.add(url.href);
    const id = evidenceId(source.id, sourceIds, 'source');
    if (source.retrievedAt !== null && (typeof source.retrievedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(source.retrievedAt) || !Number.isFinite(Date.parse(source.retrievedAt)) || new Date(source.retrievedAt).toISOString() !== source.retrievedAt)) throw new Error('Invalid source retrieval time.');
    if (!['recorded-read', 'imported'].includes(source.provenance) || source.provenance === 'recorded-read' && !source.retrievedAt) throw new Error('Invalid source provenance.');
    return { id, title: text(source.title, 'Source title', 300), url: url.href, retrievedAt: source.retrievedAt, provenance: source.provenance };
  });
  if (value.basis === 'sources' && !sources.length) throw new Error('Sourced research needs at least one consulted source.');
  let claims;
  if (hasClaims) {
    if (value.basis === 'reasoning' && sources.length) throw new Error('Reasoning research cannot contain sources.');
    claims = list(value.claims, 'claims', 12, claim => {
      evidenceKeys(claim, ['id', 'text', 'basis', 'evidence', 'limitations']);
      const id = evidenceId(claim.id, claimIds, 'claim'), refs = new Set();
      if (!['sources', 'reasoning', 'unknown'].includes(claim.basis)) throw new Error('Invalid claim basis.');
      const evidence = list(claim.evidence, 'claim evidence', 3, item => {
        evidenceKeys(item, ['sourceId', 'paraphrase']);
        if (!sourceIds.has(item.sourceId) || refs.has(item.sourceId)) throw new Error('Unknown or duplicate claim source reference.');
        refs.add(item.sourceId);
        return { sourceId: item.sourceId, paraphrase: text(item.paraphrase, 'Supporting paraphrase', 1000) };
      });
      if ((claim.basis === 'sources') !== (evidence.length > 0)) throw new Error('Claim basis does not match its evidence.');
      return { id, text: text(claim.text, 'Claim', 1000), basis: claim.basis, evidence, limitations: text(claim.limitations, 'Claim limitations', 1000) };
    });
    if (!claims.length) throw new Error('Research needs at least one claim.');
  }
  return { sources, ...(hasClaims ? { claims } : {}) };
}
export function research(value) {
  const hasClaims = Object.hasOwn(value ?? {}, 'claims');
  if (hasClaims) evidenceKeys(value, ['basis', 'summary', 'options', 'settings', 'recommendation', 'proposedAnswer', 'uncertainty', 'sources', 'claims']);
  const { sources, claims } = researchEvidence(value);
  const options = list(value.options, 'options', 4, option => ({
    title: text(option?.title, 'Option title', 150),
    description: text(option.description, 'Option description', 3000),
    pros: list(option.pros, 'pros', 6, v => text(v, 'Pro', 1000)),
    cons: list(option.cons, 'cons', 6, v => text(v, 'Con', 1000)),
    ...(option.proposedAnswer !== undefined ? { proposedAnswer: text(option.proposedAnswer, 'Proposed answer', 5000) } : {}),
    ...(option.details !== undefined ? { details: list(option.details, 'details', 8, d => ({ label: text(d?.label, 'Detail label', 80), value: text(d.value, 'Detail value', 1000) })) } : {}),
  }));
  if (options.length < 2) throw new Error('Compare at least two options.');
  const result = { basis: value.basis, summary: text(value.summary, 'Research summary', 5000), options,
    ...(hasClaims ? { claims } : {}),
    ...(Object.hasOwn(value, 'settings') ? { settings: researchSettings(value.settings) } : {}),
    recommendation: text(value.recommendation, 'Recommendation', 5000),
    ...(value.proposedAnswer !== undefined ? { proposedAnswer: text(value.proposedAnswer, 'Proposed answer', 5000) } : {}),
    uncertainty: text(value.uncertainty, 'Uncertainty', 3000), sources };
  if (hasClaims && Buffer.byteLength(JSON.stringify(result)) > MAX_RESEARCH_BYTES) throw new Error('Research evidence exceeds its serialized limit.');
  return result;
}
// Imported metadata can describe another installation's read, never a local observation.
export function importedDocument(value) {
  const doc = validateDocument(value);
  for (const node of doc.nodes) for (const source of node.research?.claims ? node.research.sources : []) source.provenance = 'imported';
  for (const item of doc.handoff?.evidence ?? []) for (const source of item.claims ? item.sources : []) source.provenance = 'imported';
  for (const item of doc.adrDraft?.evidence ?? []) for (const source of item.claims ? item.sources : []) source.provenance = 'imported';
  return doc;
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
    ...questionImportance(n),
    ...(Object.hasOwn(n, 'attribution') ? { attribution: validateNodeAttribution(n.attribution) } : {}),
    ...(Object.hasOwn(n, 'answerState') ? { answerState: n.answerState } : {}),
    research: n.research === null ? null : research(n.research), review: n.review === true,
    ...(Object.hasOwn(n, 'reviewCauses') ? { reviewCauses: reviewCauses(n.reviewCauses) } : {}),
    ...(Object.hasOwn(n, 'researchStale') ? { researchStale: n.researchStale } : {}),
    ...(Object.hasOwn(n, 'revisit') ? { revisit: validateRevisit(n.revisit) } : {}),
    ...(Object.hasOwn(n, 'generation') ? { generation: generation(n.generation, text(n.question, 'Question', 600), text(n.category, 'Category', 60)) } : {}),
  }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const node of nodes) {
    if (node.reviewCauses && !node.review) throw Error('Review causes require a review flag.');
    if (Object.hasOwn(node, 'researchStale') && (node.researchStale !== true || !node.research)) throw Error('Research stale markers require retained research.');
    if (Object.hasOwn(node, 'importance') && (node.id === value.rootId || !isQuestion(node) || !node.generation)) throw new Error('Only generated ordinary questions can have importance.');
    if (Object.hasOwn(node, 'revisit') && !isQuestion(node)) throw new Error('Only ordinary questions can have revisit reminders.');
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
  if (Object.hasOwn(value, 'copyOrigin') && (!value.copyOrigin || Object.keys(value.copyOrigin).sort().join(',') !== 'kind,sourceDigest,sourceId' || value.copyOrigin.kind !== 'personal-copy' || typeof value.copyOrigin.sourceId !== 'string' || !value.copyOrigin.sourceId || value.copyOrigin.sourceId.trim() !== value.copyOrigin.sourceId || value.copyOrigin.sourceId.length > 100 || !/^[a-f0-9]{64}$/.test(value.copyOrigin.sourceDigest))) throw Error('Invalid project copy origin lineage.');
  const document = { format: FORMAT, version: 1, id: text(value.id, 'Exploration ID', 100),
    ...(Object.hasOwn(value, 'forkOrigin') ? { forkOrigin: scenarioOrigin(value.forkOrigin) } : {}),
    ...(Object.hasOwn(value, 'copyOrigin') ? { copyOrigin: { ...value.copyOrigin } } : {}),
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    topic, objective: guidanceText(Object.hasOwn(value, 'objective') ? value.objective : '', 'Objective', MAX_OBJECTIVE),
    successCriteria: guidanceText(Object.hasOwn(value, 'successCriteria') ? value.successCriteria : '', 'Success criteria', MAX_SUCCESS_CRITERIA),
    ...(Object.hasOwn(value, 'mode') ? { mode: validMode(value.mode) } : {}),
    ...(Object.hasOwn(value, 'pins') ? { pins: pinnedConstraints(value.pins) } : {}),
    ...(Object.hasOwn(value, 'dependencies') ? { dependencies: decisionDependencies(value.dependencies, nodes) } : {}),
    rootId: root.id, createdAt: date(value.createdAt, 'creation date'), updatedAt: date(value.updatedAt, 'update date'),
    ...(Object.hasOwn(value, 'brief') ? { brief: validateBrief(value.brief) } : {}),
    ...(Object.hasOwn(value, 'handoff') ? { handoff: validateHandoff(value.handoff) } : {}),
    ...(Object.hasOwn(value, 'adrScope') ? { adrScope: validateAdrScope(value.adrScope) } : {}),
    ...(Object.hasOwn(value, 'adrFormat') ? { adrFormat: validateAdrFormat(value.adrFormat) } : {}),
    ...(Object.hasOwn(value, 'adrDraft') ? { adrDraft: validateAdrDraft(value.adrDraft) } : {}),
    ...(Object.hasOwn(value, 'adrFiles') ? { adrFiles: validateAdrFiles(value.adrFiles) } : {}),
    ...(Object.hasOwn(value, 'comments') ? { comments: validateComments(value.comments) } : {}),
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
export function acknowledgeDirection(doc, id) {
  const node = findNode(doc, id);
  if (node.kind !== 'direction') throw new Error('Only structural directions can acknowledge direction review.');
  node.review = false;
  delete node.reviewCauses;
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
    const result = new DecisionImpact(doc).analyze(id), cause = { sourceId: id, baseDigest: savedDigest(doc), revision: doc.revision };
    for (const child of doc.nodes) if (child.id !== id && result.predecessors.combined.has(child.id)) addReviewCause(child, cause);
    // Saved results do not retain their complete context dependency set. Be explicit about uncertainty.
    for (const saved of doc.nodes) if (saved.research) saved.researchStale = true;
  }
  node.answer = next;
  node.answerState = state;
  node.review = false;
  delete node.reviewCauses;
  return true;
}
export function reaffirmReview(doc, id, selected) {
  const node = findNode(doc, id);
  if (!isQuestion(node) || !node.review) throw Error('Choose an answer that needs review.');
  const causes = node.reviewCauses ?? { changes: [], earlier: true };
  let changes = causes.changes, earlier = causes.earlier;
  if (selected === 'earlier') {
    if (!earlier) throw Error('That earlier review cause is no longer outstanding.');
    earlier = false;
  } else {
    const valid = reviewCauses({ changes: [selected], earlier: false }).changes[0];
    if (!changes.some(cause => reviewCauseKey(cause) === reviewCauseKey(valid) && cause.revision === valid.revision)) throw Error('That review cause is no longer outstanding.');
    changes = changes.filter(cause => reviewCauseKey(cause) !== reviewCauseKey(valid));
  }
  node.review = !!(changes.length || earlier);
  if (changes.length) node.reviewCauses = { changes, earlier }; else delete node.reviewCauses;
  return true;
}
export function restartBranch(doc, id, answer, answerState) {
  const impact = new DecisionImpact(doc).analyze(id), removed = new Set([...impact.predecessors.tree.keys()].filter(nodeId => nodeId !== id));
  const cause = { sourceId: id, baseDigest: savedDigest(doc), revision: doc.revision };
  const changed = answerNode(doc, id, answer, answerState);
  if (!removed.size) return changed;
  // Removing reasoning invalidates its surviving dependents even when the selected answer is unchanged.
  for (const node of doc.nodes) if (node.id !== id && !removed.has(node.id) && impact.predecessors.combined.has(node.id)) addReviewCause(node, cause);
  doc.nodes = doc.nodes.filter(node => !removed.has(node.id));
  for (const node of doc.nodes) if (node.research) node.researchStale = true;
  const links = (doc.dependencies ?? []).filter(link => !removed.has(link.dependentId) && !removed.has(link.prerequisiteId));
  if (links.length) doc.dependencies = links; else delete doc.dependencies;
  return true;
}

/** A scoped historical replacement; neither input is mutated and conflicts have no candidate. */
export function branchRestoration(current, historical, nodeId) {
  current = validateDocument(current); historical = validateDocument(historical);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b), conflicts = [];
  const conflict = (kind, id, message) => conflicts.push({ kind, id, message });
  const blocked = () => ({ document: null, changed: false, conflicts, added: [], removed: [], reviewed: [], research: [], changes: [], dependencies: [] });
  const old = new Map(historical.nodes.map(n => [n.id, n])), now = new Map(current.nodes.map(n => [n.id, n])), selected = old.get(nodeId);
  const compatible = (a, b) => a.parentId === b.parentId && effectiveKind(a) === effectiveKind(b) && a.question === b.question;
  if (['id', 'rootId', 'createdAt'].some(key => current[key] !== historical[key])) conflict('identity', nodeId, 'This snapshot belongs to a different journey identity.');
  if (!same(current.forkOrigin, historical.forkOrigin) || !same(current.copyOrigin, historical.copyOrigin)) conflict('lineage', nodeId, 'Scenario lineage changed; scoped restoration cannot replace or infer it.');
  if (!selected || nodeId === historical.rootId) conflict('selection', nodeId, 'Select a non-root historical branch. Use whole-map restore for the root.');
  if (conflicts.length) return blocked();
  if (!now.has(selected.parentId)) conflict('parent', selected.parentId, 'The historical parent is missing. Restore that parent branch first.');
  else if (selected.parentId !== historical.rootId && !compatible(now.get(selected.parentId), old.get(selected.parentId))) conflict('identity', selected.parentId, 'The historical parent has incompatible parent, kind or question identity.');
  const subtree = (doc, id) => {
    const children = new Map(doc.nodes.map(n => [n.id, []]));
    for (const n of doc.nodes) if (n.parentId !== null) children.get(n.parentId).push(n.id);
    const found = new Set(), queue = children.has(id) ? [id] : [];
    for (let i = 0; i < queue.length; i++) { found.add(queue[i]); queue.push(...children.get(queue[i])); }
    return found;
  };
  const before = subtree(current, nodeId), restored = subtree(historical, nodeId);
  for (const id of restored) {
    const a = now.get(id), b = old.get(id);
    if (a && (!before.has(id) || !compatible(a, b))) conflict('identity', id, 'A restored ID is reused outside the branch or has incompatible parent, kind or question identity.');
  }
  if (conflicts.length) return blocked();
  const removed = [...before].filter(id => !restored.has(id)), added = [...restored].filter(id => !now.has(id));
  const replacement = historical.nodes.filter(n => restored.has(n.id)), nodes = current.nodes.filter(n => !before.has(n.id)).map(n => structuredClone(n));
  const index = before.size ? current.nodes.findIndex(n => before.has(n.id)) : nodes.findIndex(n => n.id === selected.parentId) + 1;
  nodes.splice(index, 0, ...replacement);
  const candidate = { ...current, nodes }, ids = new Set(nodes.map(n => n.id)), key = link => JSON.stringify([link.dependentId, link.prerequisiteId]), links = new Map();
  for (const link of current.dependencies ?? []) {
    if (before.has(link.dependentId) && before.has(link.prerequisiteId)) continue;
    if (!ids.has(link.dependentId) || !ids.has(link.prerequisiteId)) conflict('dependency', link.dependentId, 'A current boundary dependency refers to a removed node. Correct that link explicitly before restoring.');
    else links.set(key(link), link);
  }
  for (const link of historical.dependencies ?? []) {
    if (!restored.has(link.dependentId) && !restored.has(link.prerequisiteId)) continue;
    for (const id of [link.dependentId, link.prerequisiteId]) if (!restored.has(id) && now.has(id) && !compatible(now.get(id), old.get(id))) conflict('identity', id, 'A historical boundary dependency endpoint has incompatible parent, kind or question identity.');
    if (!ids.has(link.dependentId) || !ids.has(link.prerequisiteId)) conflict('dependency', link.dependentId, 'A historical boundary dependency has a missing endpoint. Restore its prerequisite branch or correct the dependency first.');
    else if (links.has(key(link)) && !same(links.get(key(link)), link)) conflict('dependency', link.dependentId, 'Current and historical boundary dependency explanations conflict. Resolve the link explicitly before restoring.');
    else links.set(key(link), link);
  }
  if (conflicts.length) return blocked();
  if (links.size) candidate.dependencies = [...links.values()]; else delete candidate.dependencies;
  try { validateDocument(candidate); } catch (error) { conflict('graph', nodeId, error.message); return blocked(); }
  const oldLinks = new Map((current.dependencies ?? []).map(link => [key(link), link]));
  const dependencies = [...new Set([...oldLinks.keys(), ...links.keys()])].filter(id => !same(oldLinks.get(id), links.get(id))).map(id => ({ before: oldLinks.get(id) ?? null, after: links.get(id) ?? null }));
  const changedIds = new Set([...before, ...restored].filter(id => !same(now.get(id), restored.has(id) ? old.get(id) : undefined)));
  if (!changedIds.size && !dependencies.length && same([...before], [...restored])) return { document: current, changed: false, conflicts, added, removed, reviewed: [], research: [], changes: [], dependencies };
  // Complete research prerequisites were not retained. Restored evidence is historical.
  const outside = (doc, branch) => [doc.nodes.filter(n => !branch.has(n.id)), doc.topic, doc.objective, doc.successCriteria, doc.mode, doc.pins,
    (doc.dependencies ?? []).filter(link => !branch.has(link.dependentId) || !branch.has(link.prerequisiteId))];
  const contextChanged = !same(outside(current, before), outside(historical, restored));
  const cause = { sourceId: nodeId, baseDigest: savedDigest(current), revision: current.revision };
  for (const n of replacement) { if (contextChanged) addReviewCause(n, cause); if (n.research) n.researchStale = true; }
  // Walk the union of both graphs once: only downstream outside nodes need review.
  const edges = new Map([...now.keys(), ...ids].map(id => [id, new Set()]));
  for (const doc of [current, candidate]) {
    for (const n of doc.nodes) if (n.parentId !== null) edges.get(n.parentId).add(n.id);
    for (const link of doc.dependencies ?? []) edges.get(link.prerequisiteId).add(link.dependentId);
  }
  const affected = new Set(changedIds);
  for (const change of dependencies) affected.add((change.after ?? change.before).dependentId);
  const queue = [...affected];
  for (let i = 0; i < queue.length; i++) for (const id of edges.get(queue[i]) ?? []) if (!affected.has(id)) { affected.add(id); queue.push(id); }
  for (const n of nodes) if (!restored.has(n.id) && affected.has(n.id)) addReviewCause(n, cause);
  candidate.finishedAt = null;
  let document;
  try { document = validateDocument(candidate); } catch (error) { conflict('limits', nodeId, error.message); return blocked(); }
  const after = new Map(document.nodes.map(n => [n.id, n]));
  const changes = [...new Set([...now.keys(), ...after.keys()])].filter(id => !same(now.get(id), after.get(id))).map(id => ({ id, before: now.get(id) ?? null, after: after.get(id) ?? null }));
  return { document, changed: true, conflicts, added, removed, dependencies, changes,
    reviewed: changes.filter(change => change.after?.review).map(change => change.id), research: replacement.filter(n => n.research).map(n => n.id) };
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
  if (doc.forkOrigin) {
    const origin = doc.forkOrigin;
    lines.splice(lines.indexOf('## Map'), 0, '## Scenario origin', '', `Historical source journey: ${md(origin.source.journeyId)}; root: ${md(origin.source.rootId)}; created: ${md(origin.source.createdAt)}; question: ${md(origin.source.nodeId)}; revision: ${origin.source.revision}; fingerprint: ${origin.source.digest}.`, '', `Fork question: ${md(origin.forkNodeId)}. Source availability and current content are not verified. Historical mappings may refer to removed nodes. Use JSON for a reopenable file.`, '', ...origin.nodes.map(row => `- ${md(row.nodeId)} from ${md(row.sourceNodeId)}; earliest origin: ${md(JSON.stringify(row.origin))}`), '');
  }
  for (const n of doc.nodes) lines.push(`| ${ids.get(n.id)} | ${ids.get(n.parentId) ?? '—'} | ${md(n.category).replace(/\n/g, ' ')} | ${md(n.question).replace(/\n/g, ' ')} | ${nodeStatus(n)}${n.review ? '; needs review' : ''} |`);
  if (doc.dependencies?.length) {
    lines.push('', '## Confirmed decision dependencies', '', 'User assertions, separate from tree navigation and research evidence. B depends on A means changing A may affect B.', '');
    for (const link of doc.dependencies) lines.push(`- ${ids.get(link.dependentId)} depends on ${ids.get(link.prerequisiteId)}${link.explanation ? `: ${md(link.explanation)}` : ''}`);
  }
  for (const n of doc.nodes) {
    if (n.id === doc.rootId) continue;
    lines.push('', `## ${ids.get(n.id)}: ${md(n.question)}`, '', `Category: ${md(n.category)}. Parent: ${ids.get(n.parentId)}.`, '');
    if (n.review) lines.push('**Needs review:** recorded upstream reasoning changed, or a legacy review remains unresolved.', '');
    if (n.reviewCauses) { for (const cause of n.reviewCauses.changes) lines.push(`- Review cause: ${cause.kind ? `${cause.kind}, dependent ${md(cause.dependentId)}, ` : ''}source ${md(cause.sourceId)}, saved base ${cause.baseDigest}, revision ${cause.revision}.`); if (n.reviewCauses.earlier) lines.push('- Additional earlier or legacy review causes are not individually retained.'); lines.push(''); }
    if (n.researchStale) lines.push('**Retained research needs reconsideration after saved reasoning changed.** It has not been refreshed.', '');
    if (!isQuestion(n)) { lines.push('Direction (user supplied). Original direction text; not an answer or decision.', ''); continue; }
    lines.push('### User answer', '', `State: ${ANSWER_STATES[effectiveAnswerState(n)]}.`, '', n.answer ? md(n.answer) : '_No answer text._', '');
    if (n.revisit) lines.push('### User revisit reminder', '', `Review date (local calendar): ${n.revisit.date ?? 'Not set'}.`, '', 'Manual condition (evaluated by you; not monitored):', '', n.revisit.condition ? md(n.revisit.condition) : '_Not set._', '', `Acknowledged: ${n.revisit.acknowledgedAt ?? 'Not yet'}. Acknowledgment records a review, not a changed answer or resolved decision.`, '');
    if (n.generation) lines.push('### Question provenance', '', `Generated question: ${md(n.generation.originalQuestion)}`, '', `Generated category: ${md(n.generation.originalCategory)}. ${n.generation.adjusted ? 'Wording adjusted by the user before acceptance.' : 'Accepted without wording changes.'}`, '');
    lines.push(`Importance: ${n.importance ?? 'Unranked'}.`, '');
    if (n.importance) lines.push('Historical model assessment for the original suggested wording and context; not confidence, answer certainty or a user decision. Not automatically reassessed after changes.', '', `Original suggested wording: ${md(n.generation.originalQuestion)}`, '', md(n.importanceReason), '');
    if (n.rationale) {
      lines.push('### Why this question?', '', 'Historical model explanation for the original suggested wording and context; not a user fact or decision.', '');
      if (n.generation?.adjusted) lines.push(`Original suggested wording: ${md(n.generation.originalQuestion)}`, '');
      lines.push(md(n.rationale), '');
    }
    if (n.research) {
      const r = n.research;
      lines.push('### AI research', '', `Basis: ${r.basis === 'sources' ? 'Consulted sources' : 'Model reasoning; not externally verified'}.`, '', researchSettingsText(r.settings), '', md(r.summary), '');
      for (const o of r.options) {
        lines.push(`#### ${md(o.title)}`, '', md(o.description), '', '**Pros**', '', ...o.pros.map(p => `- ${md(p)}`), '', '**Cons**', '', ...o.cons.map(p => `- ${md(p)}`), '');
        if (o.proposedAnswer) lines.push('Suggested draft: ' + md(o.proposedAnswer), '');
        for (const detail of o.details ?? []) lines.push(`- ${md(detail.label)}: ${md(detail.value)}`);
      }
      lines.push('**Recommendation:** ' + md(r.recommendation), '', '**Uncertainty:** ' + md(r.uncertainty), '');
      if (r.proposedAnswer) lines.push('Suggested draft: ' + md(r.proposedAnswer), '');
      if (r.claims) {
        lines.push('#### Claims and evidence', '', 'Model interpretation of support; a recorded page read does not verify a claim.', '');
        for (const claim of r.claims) {
          lines.push(`**${claim.id}: ${md(claim.text)}**`, '', `${claim.basis === 'sources' ? 'Source-linked model interpretation' : claim.basis === 'reasoning' ? 'Model reasoning' : 'Unknown support'}.`, '', `Limitations: ${md(claim.limitations)}`, '');
          for (const item of claim.evidence) {
            const source = r.sources.find(s => s.id === item.sourceId);
            lines.push(`- ${item.sourceId}: ${md(item.paraphrase)}`, `  [${md(source.title)}](<${source.url.replace(/>/g, '%3E').replace(/</g, '%3C')}>) — ${source.provenance === 'imported' ? 'Imported read metadata; not observed by this installation' : 'Recorded successful read of requested URL'}; ${source.retrievedAt ?? 'Retrieval time unknown'}.`);
          }
        }
      } else lines.push('Claim-level support and historical retrieval times unknown for this legacy result.', '');
      lines.push('Consulted sources (a read does not establish claim support):', '');
      for (const source of r.sources) lines.push(`- ${source.id ? source.id + ': ' : ''}[${md(source.title)}](<${source.url.replace(/>/g, '%3E').replace(/</g, '%3C')}>) — ${source.retrievedAt ? `${source.provenance === 'imported' ? 'Imported metadata; not observed by this installation' : 'Recorded successful read of requested URL'}: ${source.retrievedAt}` : 'Retrieval time unknown'}.`);
    }
  }
  // Only a fixed heading may precede the appendix, including when the topic is multiline.
  if (doc.brief || doc.handoff || doc.adrScope) {
    lines[0] = '# Exploration';
    lines.splice(2, 0, ...(doc.brief ? [briefMarkdown(doc.brief, doc), ''] : []), ...(doc.handoff ? [handoffMarkdown(doc.handoff, doc), ''] : []), ...(doc.adrScope ? [adrScopeMarkdown(doc.adrScope), ''] : []), '## Topic', '', md(doc.topic), '');
  }
  return lines.join('\n') + '\n';
}
