import { randomUUID } from 'node:crypto';
import { answerNode, restartBranch, reaffirmReview, findNode, validateDocument } from './model.mjs';
import { DecisionImpact, impactPath } from './web/decision-impact.mjs';
import { effectiveAnswerState } from './web/answer-state.mjs';
import { sameResearchSources } from './research-context.mjs';
import { sameFollowup } from './research-followup.mjs';
import { savedDigest } from './review-causes.mjs';
import { briefFreshness } from './decision-brief.mjs';
import { handoffFreshness } from './implementation-handoff.mjs';
import { adrDraftFreshness } from './adr-draft.mjs';
import { checkFreshness } from './answer-check.mjs';
import { References } from './references.mjs';

const stale = () => Error('Answer change preview expired or its sources changed. Review the consequences again; your draft is retained.');
const identity = e => JSON.stringify([e.file, e.activeKey, e.doc?.id, e.doc?.rootId, e.doc?.createdAt]);
// Bind meaningful results and source identities, not progress text or local finding dismissal.
const artifactKey = work => work && [work.id, work.journey, work.operation, work.status, work.dependencies, work.proposal, work.findings, work.format, work.formatFingerprint, work.includeEvidence, work.evidence];
const workKey = e => savedDigest([e.pending && [e.pending.id, e.pending.kind, e.pending.nodeId], e.preview, e.questionSource, e.followup, artifactKey(e.briefWork), artifactKey(e.checkWork)]);
export function affectedArtifacts(e, doc, next) {
  const artifacts = [];
  for (const [kind, fresh] of [['brief', briefFreshness], ['handoff', handoffFreshness], ['adrDraft', adrDraftFreshness]]) {
    if (doc[kind] && fresh(doc[kind], doc) === 'current' && fresh(doc[kind], next) !== 'current') artifacts.push({ kind, state: 'saved' });
  }
  const brief = e.briefWork, check = e.checkWork;
  if (brief && ['pending', 'proposal'].includes(brief.status)) {
    const fresh = brief.operation === 'adrDraft' ? adrDraftFreshness : brief.operation === 'handoff' ? handoffFreshness : briefFreshness, value = brief.proposal ?? brief;
    if (fresh(value, doc) === 'current' && fresh(value, next) !== 'current') artifacts.push({ kind: brief.operation, state: brief.status });
  }
  if (check && ['pending', 'result'].includes(check.status) && checkFreshness(check.dependencies, doc) && !checkFreshness(check.dependencies, next)) artifacts.push({ kind: check.operation, state: check.status });
  return artifacts;
}
export { workKey as changeWorkKey };
const proposal = (input, next) => ({ operation: input.operation ?? 'answer', nodeId: input.nodeId, answer: input.answer, answerState: effectiveAnswerState(findNode(next, input.nodeId)), expand: input.expand === true, draftRevision: input.draftRevision ?? null, draftJourney: input.draftJourney ?? null, reviewCause: input.reviewCause ?? null });
export function applyAnswerChange(doc, input) {
  if (input.operation === 'reaffirm-review') {
    const node = findNode(doc, input.nodeId);
    if (input.answer !== node.answer || input.answerState !== effectiveAnswerState(node)) throw Error('Reaffirm preserves the saved answer and state.');
    return reaffirmReview(doc, input.nodeId, input.reviewCause);
  }
  if (input.reviewCause !== undefined) throw Error('Select a review cause only when reaffirming.');
  if (input.operation === 'clear-review-answer' && (input.answer !== '' || input.answerState !== 'unanswered' || !findNode(doc, input.nodeId).review)) throw Error('Choose a reviewed answer to clear to unanswered.');
  return (input.operation === 'restart-branch' ? restartBranch : answerNode)(doc, input.nodeId, input.answer, input.answerState);
}
async function references(e) {
  const key = await e.draftIdentity(e.activeKey ?? e.doc.id);
  e.referenceStore ??= new References(e.auxiliaryDirectory());
  return e.referenceStore.read(key);
}
function analyze(e, doc, input) {
  const next = structuredClone(doc), source = findNode(doc, input.nodeId);
  const restart = input.operation === 'restart-branch';
  const savedChange = applyAnswerChange(next, input);
  const target = findNode(next, input.nodeId), changed = source.answer !== target.answer || effectiveAnswerState(source) !== effectiveAnswerState(target);
  const impact = new DecisionImpact(doc).analyze(input.nodeId);
  const retained = new Set(next.nodes.map(n => n.id)), removedIds = doc.nodes.filter(n => !retained.has(n.id)).map(n => n.id), removed = new Set(removedIds);
  const invalidates = changed || removed.size > 0;
  const affectedIds = invalidates ? [...impact.predecessors.combined.keys()].filter(id => id !== source.id && !removed.has(id)) : [];
  const affected = new Set(affectedIds), researchIds = invalidates ? next.nodes.filter(n => n.research).map(n => n.id) : [];
  const generated = invalidates ? next.nodes.filter(n => n.generation && affected.has(n.id)).length : 0;
  const removedLinks = (doc.dependencies ?? []).filter(link => removed.has(link.dependentId) || removed.has(link.prerequisiteId));
  const staged = !!(e.preview && e.questionSource && !sameResearchSources(e.questionSource.dependencies, next));
  const running = !!(e.researchWork && !sameResearchSources(e.researchWork.dependencies, next));
  const followup = !!(e.followup && !e.followup.historical && !sameFollowup(e.followup.dependencies, next, e.followup.nodeId));
  const artifacts = affectedArtifacts(e, doc, next);
  return { next, savedChange, changed, invalidates, restart, impact, removedIds, removedLinks, affectedIds, researchIds, generated, staged, running, followup, artifacts,
    requiresConfirmation: !!(restart || source.review || affectedIds.length || researchIds.length || savedChange && (staged || running || followup || artifacts.length)) };
}

/** One bounded, transient preview; no user draft or preview is stored in the shared map. */
export class AnswerChanges {
  entry = null;
  async request(e, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid answer preview request.');
    const fields = { prepare: ['action', 'operation', 'journey', 'revision', 'nodeId', 'answer', 'answerState', 'expand', 'draftRevision', 'draftJourney', 'reviewCause'], page: ['action', 'token', 'page', 'targetId', 'pathPage', 'linkPage'], discard: ['action', 'token'] };
    if (!fields[input.action] || Object.keys(input).some(key => !fields[input.action].includes(key))) throw Error('Invalid answer preview fields.');
    if (input.action === 'discard') { if (this.entry?.token === input.token) this.entry = null; return { discarded: true }; }
    const doc = await e.readCurrent();
    if (input.action === 'prepare') {
      if (input.operation !== undefined && !['answer', 'restart-branch', 'reaffirm-review', 'clear-review-answer'].includes(input.operation) || input.operation && input.operation !== 'answer' && input.expand === true) throw Error('Invalid answer preview operation.');
      if (input.operation === 'restart-branch' && (e.pending || e.preview)) throw Error('Cancel the pending request and dismiss any unsaved question proposal before restarting a branch.');
      if (e.closed || input.journey !== (e.activeKey ?? e.doc.id)) throw stale();
      if (input.revision !== doc.revision || doc.revision !== e.doc.revision) throw Error('The map changed. Refresh the saved journey before reviewing this answer; your draft is retained.');
      if (input.expand !== undefined && typeof input.expand !== 'boolean' || input.draftRevision !== undefined && (!Number.isSafeInteger(input.draftRevision) || input.draftRevision < 0)) throw Error('Invalid answer preview proposal.');
      const result = analyze(e, doc, input); validateDocument(result.next);
      const token = randomUUID(), selectedReferences = result.restart ? await references(e) : null;
      this.entry = { ...result, token, checkpoint: result.restart && result.savedChange ? `Before branch restart r${doc.revision} ${token}` : null, selectedReferences, expires: Date.now() + 15 * 60_000, identity: identity(e), base: savedDigest(doc), work: workKey(e), proposal: proposal(input, result.next), doc };
      await this.checkDraft(e, this.entry);
      return this.page(this.entry, 0, null, 0);
    }
    const entry = this.assert(e, doc, input.token);
    await this.checkReferences(e, entry);
    return this.page(entry, input.page, input.targetId, input.pathPage, input.linkPage ?? 0);
  }
  assert(e, doc, token) {
    const entry = this.entry;
    if (e.closed || !entry || entry.token !== token || entry.expires < Date.now() || entry.identity !== identity(e) || entry.base !== savedDigest(doc) || entry.work !== workKey(e)) throw stale();
    return entry;
  }
  async checkDraft(e, entry) {
    const p = entry.proposal; if (!entry.requiresConfirmation || p.draftRevision === null) return;
    const key = await e.draftIdentity(p.draftJourney), record = (await e.draftStore.list(key)).find(item => item.nodeId === p.nodeId);
    if (!record || record.revision !== p.draftRevision || record.text !== p.answer || effectiveAnswerState({ answer: record.text, answerState: record.answerState }) !== p.answerState) throw stale();
  }
  async checkReferences(e, entry) {
    if (entry.restart && savedDigest(await references(e)) !== savedDigest(entry.selectedReferences)) throw stale();
  }
  async guard(e, doc, input, next) {
    if (!input.answerPreview) {
      if (analyze(e, doc, input).requiresConfirmation) throw Error('Review the downstream consequences before saving this answer.');
      return;
    }
    const entry = this.assert(e, doc, input.answerPreview);
    if (JSON.stringify(proposal(input, next)) !== JSON.stringify(entry.proposal) || entry.requiresConfirmation && input.confirmConsequences !== true) throw stale();
    await this.checkDraft(e, entry);
    await this.checkReferences(e, entry);
    this.assert(e, await e.fresh(), input.answerPreview);
  }
  async checkpoint(e, saved, input, next) {
    const entry = this.assert(e, saved, input.answerPreview); if (!entry.restart || !entry.savedChange) return;
    await this.guard(e, saved, input, next);
    const history = await e.history(e.activeKey ?? e.doc.id), list = await history.list(saved);
    const existing = list.entries.find(row => row.checkpoints.includes(entry.checkpoint));
    if (existing && existing.hash !== history.row(saved, 'Before restart').hash) throw stale();
    if (!existing) await history.checkpoint(saved, saved.revision, entry.checkpoint);
  }
  page(entry, page, targetId, pathPage, linkPage = 0) {
    if (![page, pathPage, linkPage].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 5000) || targetId !== null && typeof targetId !== 'string') throw Error('Invalid consequence page.');
    const { doc, impact } = entry, byId = new Map(doc.nodes.map(n => [n.id, n]));
    const removed = new Set(entry.removedIds), affected = new Set(entry.affectedIds), research = new Set(entry.researchIds), ids = [...removed, ...affected, ...[...research].filter(id => !affected.has(id))];
    const describe = id => { const n = byId.get(id); return { id, question: n.question, direction: n.kind === 'direction', state: effectiveAnswerState(n), structural: impact.predecessors.tree.has(id) && id !== impact.sourceId, confirmed: impact.predecessors.dependency.has(id) && id !== impact.sourceId, generated: !!n.generation && affected.has(id), research: research.has(id), review: affected.has(id), removed: removed.has(id), referenced: entry.selectedReferences?.nodeIds.includes(id) ?? false }; };
    if (targetId !== null && !ids.includes(targetId)) throw Error('Choose a listed affected item.');
    const selected = targetId ?? ids[page * 50] ?? null, path = selected === impact.sourceId ? [{ id: selected, via: null }] : selected ? impactPath(impact, selected) : [];
    const source = findNode(doc, impact.sourceId);
    const surviving = impact.affected.filter(n => affected.has(n.id)), counts = { ...impact.counts, total: surviving.length };
    for (const key of ['structural', 'confirmed', 'mixedOnly', 'review']) counts[key] = surviving.filter(n => n[key]).length;
    counts.assumptions = surviving.filter(n => n.state === 'assumption').length;
    counts.states = Object.fromEntries(Object.keys(counts.states).map(state => [state, surviving.filter(n => n.state === state).length]));
    return { token: entry.token, requiresConfirmation: entry.requiresConfirmation, changed: entry.changed, acknowledgment: !entry.restart && !entry.changed && entry.savedChange,
      operation: entry.proposal.operation, reviewResolution: source.review ? { total: (source.reviewCauses?.changes.length ?? 0) + (!source.reviewCauses || source.reviewCauses.earlier ? 1 : 0), remaining: (findNode(entry.next, source.id).reviewCauses?.changes.length ?? 0) + (findNode(entry.next, source.id).review && (!findNode(entry.next, source.id).reviewCauses || findNode(entry.next, source.id).reviewCauses.earlier) ? 1 : 0), selected: entry.proposal.reviewCause } : null,
      removed: removed.size, removedResearch: doc.nodes.filter(n => removed.has(n.id) && n.research).length, removedReferences: entry.selectedReferences?.nodeIds.filter(id => removed.has(id)).length ?? 0, checkpoint: entry.checkpoint,
      linkPage, linkTotal: entry.removedLinks.length, links: entry.removedLinks.slice(linkPage * 25, linkPage * 25 + 25).map(link => ({ ...link, dependent: byId.get(link.dependentId).question, prerequisite: byId.get(link.prerequisiteId).question, external: removed.has(link.dependentId) !== removed.has(link.prerequisiteId) })),
      current: { answer: source.answer, state: effectiveAnswerState(source) }, proposed: { answer: entry.proposal.answer, state: entry.proposal.answerState },
      counts, directions: entry.affectedIds.filter(id => byId.get(id).kind === 'direction').length,
      research: entry.researchIds.length, generated: entry.generated, staged: entry.staged, running: entry.running, followup: entry.followup, artifacts: entry.artifacts, adr: impact.adrAssociations.reason,
      total: ids.length, page, items: ids.slice(page * 50, page * 50 + 50).map(describe), targetId: selected, pathPage, pathTotal: path.length,
      path: path.slice(pathPage * 30, pathPage * 30 + 30).map(step => ({ ...step, question: byId.get(step.id).question })) };
  }
}
