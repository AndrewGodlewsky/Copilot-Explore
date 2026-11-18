import { createHash, randomUUID } from 'node:crypto';
import { validateDocument, findNode, isQuestion, effectiveAnswerState, DecisionImpact } from './model.mjs';
import { answerStateError } from './web/answer-state.mjs';
import { savedDigest } from './review-causes.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function buildScenario(source, input, now = new Date().toISOString()) {
  source = validateDocument(source);
  const selected = findNode(source, input.nodeId), error = answerStateError(input.answer, input.answerState);
  if (!isQuestion(selected) || selected.id === source.rootId) throw Error('Choose an ordinary question to fork.');
  if (error || input.answerState === 'unanswered' || (selected.answer === input.answer && effectiveAnswerState(selected) === input.answerState)) throw Error('Write a different alternative answer or choose a different answered state.');
  const digest = savedDigest(source), id = `scenario-${hash([digest, input.nodeId, input.answer, input.answerState])}`;
  const byId = new Map(source.nodes.map(n => [n.id, n])), path = [];
  for (let node = selected; node; node = byId.get(node.parentId)) path.push(node);
  path.reverse();
  const ids = new Map(path.map(n => [n.id, `fork-${hash([id, n.id])}`]));
  const identity = nodeId => ({ journeyId: source.id, rootId: source.rootId, createdAt: source.createdAt, nodeId });
  const previous = new Map((source.forkOrigin?.nodes ?? []).map(row => [row.nodeId, row.origin]));
  const document = {
    format: source.format, version: source.version, id,
    forkOrigin: { version: 1, source: { ...identity(selected.id), digest, revision: source.revision }, forkNodeId: ids.get(selected.id),
      nodes: path.map(n => ({ nodeId: ids.get(n.id), sourceNodeId: n.id, origin: structuredClone(previous.get(n.id) ?? identity(n.id)) })) },
    revision: 0, topic: source.topic, objective: source.objective, successCriteria: source.successCriteria,
    ...(source.mode ? { mode: source.mode } : {}), ...(source.pins ? { pins: structuredClone(source.pins) } : {}),
    rootId: ids.get(source.rootId), createdAt: now, updatedAt: now, finishedAt: null,
    nodes: path.map(n => ({ id: ids.get(n.id), parentId: n.parentId === null ? null : ids.get(n.parentId), ...(n.kind ? { kind: n.kind } : {}), question: n.question, category: n.category,
      answer: n.id === selected.id ? input.answer : n.answer,
      ...(isQuestion(n) && n.id !== source.rootId ? { answerState: n.id === selected.id ? input.answerState : effectiveAnswerState(n) } : {}),
      research: null, review: n.id !== selected.id && n.review,
      ...(n.attribution ? { attribution: structuredClone(n.attribution) } : {}) })),
  };
  const internal = (source.dependencies ?? []).filter(link => ids.has(link.dependentId) && ids.has(link.prerequisiteId));
  if (internal.length) document.dependencies = internal.map(link => ({ ...link, dependentId: ids.get(link.dependentId), prerequisiteId: ids.get(link.prerequisiteId) }));
  const omittedDependencies = (source.dependencies ?? []).filter(link => ids.has(link.dependentId) !== ids.has(link.prerequisiteId));
  const changed = new Set(new DecisionImpact(document).analyze(ids.get(selected.id)).predecessors.combined.keys());
  // Missing upstream premises need review even when unrelated to the alternative.
  const adjacency = new Map(document.nodes.map(n => [n.id, []]));
  for (const n of document.nodes) if (n.parentId !== null) adjacency.get(n.parentId).push(n.id);
  for (const link of document.dependencies ?? []) adjacency.get(link.prerequisiteId).push(link.dependentId);
  const missing = new Set(omittedDependencies.filter(link => ids.has(link.dependentId)).map(link => ids.get(link.dependentId))), queue = [...missing];
  for (let i = 0; i < queue.length; i++) for (const child of adjacency.get(queue[i])) if (!missing.has(child)) { missing.add(child); queue.push(child); }
  for (const nodeId of missing) changed.add(nodeId);
  for (const n of document.nodes) if (n.id !== document.forkOrigin.forkNodeId && changed.has(n.id)) n.review = true;
  return { document: validateDocument(document), omittedNodes: source.nodes.length - path.length, omittedDependencies };
}

export class ScenarioFork {
  constructor(library, readSource) { this.library = library; this.readSource = readSource; this.entry = null; }
  clear() { this.entry = null; }
  get(id) {
    if (!this.entry || this.entry.id !== id || Date.now() - this.entry.time > 15 * 60 * 1000) throw Error('Scenario preview expired. Preview the alternative again.');
    return this.entry;
  }
  async check(entry) {
    if (savedDigest(await this.readSource()) !== entry.digest) throw Error('The saved source changed. Preview the alternative again.');
  }
  async preview(input) {
    this.clear();
    const source = await this.readSource(), built = buildScenario(source, input);
    const existing = (await this.library.scan()).records.filter(row => row.document.id === built.document.id);
    if (existing.length) {
      built.document = buildScenario(source, input, existing[0].document.createdAt).document;
      if (existing.some(row => savedDigest(row.document) !== savedDigest(built.document))) throw Error('This alternative already has an evolved scenario. Open it from the personal library; it will not be overwritten.');
    }
    const entry = { ...built, id: randomUUID(), time: Date.now(), digest: savedDigest(source), source, existing: existing.length > 0 };
    await this.check(entry); this.entry = entry;
    return { id: entry.id, existing: entry.existing, scenarioId: entry.document.id, copiedNodes: entry.document.nodes.length, omittedNodes: entry.omittedNodes,
      content: JSON.stringify(entry.document, null, 2), links: this.links(entry.id, 0) };
  }
  links(id, offset) {
    const entry = this.get(id);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % 25 || offset > Math.max(0, entry.omittedDependencies.length - 1)) throw Error('Invalid omitted dependency page.');
    const nodes = new Map(entry.source.nodes.map(n => [n.id, n]));
    return { offset, total: entry.omittedDependencies.length, items: entry.omittedDependencies.slice(offset, offset + 25).map(link => ({ ...link, dependent: nodes.get(link.dependentId).question, prerequisite: nodes.get(link.prerequisiteId).question })) };
  }
  async confirm(id) {
    const entry = this.get(id); await this.check(entry);
    const result = await this.library.import(entry.document, { beforeWrite: () => this.check(entry) });
    if (result.conflict) throw Error('The saved scenario changed. Open it from the personal library; it will not be overwritten.');
    await this.check(entry);
    return { key: result.key, scenarioId: result.document.id };
  }
}
