import { randomUUID } from 'node:crypto';
import { answerNode, findNode, validateDocument } from './model.mjs';
import { DecisionImpact, impactPath } from './web/decision-impact.mjs';
import { effectiveAnswerState } from './web/answer-state.mjs';
import { sameResearchSources } from './research-context.mjs';
import { sameFollowup } from './research-followup.mjs';
import { savedDigest } from './review-causes.mjs';
import { briefFreshness } from './decision-brief.mjs';
import { handoffFreshness } from './implementation-handoff.mjs';
import { checkFreshness } from './answer-check.mjs';

const stale = () => Error('Answer change preview expired or its sources changed. Review the consequences again; your draft is retained.');
const identity = e => JSON.stringify([e.file, e.activeKey, e.doc?.id, e.doc?.rootId, e.doc?.createdAt]);
// Bind meaningful results and source identities, not progress text or local finding dismissal.
const artifactKey = work => work && [work.id, work.journey, work.operation, work.status, work.dependencies, work.proposal, work.findings, work.format, work.formatFingerprint, work.includeEvidence, work.evidence];
const workKey = e => savedDigest([e.pending && [e.pending.id, e.pending.kind, e.pending.nodeId], e.preview, e.questionSource, e.followup, artifactKey(e.briefWork), artifactKey(e.checkWork)]);
function affectedArtifacts(e, doc, next) {
  const artifacts = [];
  for (const [kind, fresh] of [['brief', briefFreshness], ['handoff', handoffFreshness]]) {
    if (doc[kind] && fresh(doc[kind], doc) === 'current' && fresh(doc[kind], next) !== 'current') artifacts.push({ kind, state: 'saved' });
  }
  const brief = e.briefWork, check = e.checkWork;
  if (brief && ['pending', 'proposal'].includes(brief.status)) {
    const fresh = brief.operation === 'handoff' ? handoffFreshness : briefFreshness, value = brief.proposal ?? brief;
    if (fresh(value, doc) === 'current' && fresh(value, next) !== 'current') artifacts.push({ kind: brief.operation, state: brief.status });
  }
  if (check && ['pending', 'result'].includes(check.status) && checkFreshness(check.dependencies, doc) && !checkFreshness(check.dependencies, next)) artifacts.push({ kind: check.operation, state: check.status });
  return artifacts;
}
const proposal = (input, next) => ({ nodeId: input.nodeId, answer: input.answer, answerState: effectiveAnswerState(findNode(next, input.nodeId)), expand: input.expand === true, draftRevision: input.draftRevision ?? null, draftJourney: input.draftJourney ?? null });
function analyze(e, doc, input) {
  const next = structuredClone(doc), source = findNode(doc, input.nodeId);
  const savedChange = answerNode(next, input.nodeId, input.answer, input.answerState);
  const target = findNode(next, input.nodeId), changed = source.answer !== target.answer || effectiveAnswerState(source) !== effectiveAnswerState(target);
  const impact = new DecisionImpact(doc).analyze(input.nodeId);
  const affectedIds = changed ? [...impact.predecessors.combined.keys()].filter(id => id !== source.id) : [];
  const affected = new Set(affectedIds), researchIds = changed ? doc.nodes.filter(n => n.research).map(n => n.id) : [];
  const generated = changed ? doc.nodes.filter(n => n.generation && affected.has(n.id)).length : 0;
  const staged = !!(e.preview && e.questionSource && !sameResearchSources(e.questionSource.dependencies, next));
  const running = !!(e.researchWork && !sameResearchSources(e.researchWork.dependencies, next));
  const followup = !!(e.followup && !e.followup.historical && !sameFollowup(e.followup.dependencies, next, e.followup.nodeId));
  const artifacts = affectedArtifacts(e, doc, next);
  return { next, savedChange, changed, impact, affectedIds, researchIds, generated, staged, running, followup, artifacts,
    requiresConfirmation: !!(affectedIds.length || researchIds.length || savedChange && (staged || running || followup || artifacts.length)) };
}

/** One bounded, transient preview; no user draft or preview is stored in the shared map. */
export class AnswerChanges {
  entry = null;
  async request(e, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid answer preview request.');
    const fields = { prepare: ['action', 'journey', 'revision', 'nodeId', 'answer', 'answerState', 'expand', 'draftRevision', 'draftJourney'], page: ['action', 'token', 'page', 'targetId', 'pathPage'], discard: ['action', 'token'] };
    if (!fields[input.action] || Object.keys(input).some(key => !fields[input.action].includes(key))) throw Error('Invalid answer preview fields.');
    if (input.action === 'discard') { if (this.entry?.token === input.token) this.entry = null; return { discarded: true }; }
    const doc = await e.readCurrent();
    if (input.action === 'prepare') {
      if (e.closed || input.journey !== (e.activeKey ?? e.doc.id)) throw stale();
      if (input.revision !== doc.revision || doc.revision !== e.doc.revision) throw Error('The map changed. Refresh the saved journey before reviewing this answer; your draft is retained.');
      if (input.expand !== undefined && typeof input.expand !== 'boolean' || input.draftRevision !== undefined && (!Number.isSafeInteger(input.draftRevision) || input.draftRevision < 0)) throw Error('Invalid answer preview proposal.');
      const result = analyze(e, doc, input); validateDocument(result.next);
      this.entry = { ...result, token: randomUUID(), expires: Date.now() + 15 * 60_000, identity: identity(e), base: savedDigest(doc), work: workKey(e), proposal: proposal(input, result.next), doc };
      await this.checkDraft(e, this.entry);
      return this.page(this.entry, 0, null, 0);
    }
    const entry = this.assert(e, doc, input.token);
    return this.page(entry, input.page, input.targetId, input.pathPage);
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
  async guard(e, doc, input, next) {
    if (!input.answerPreview) {
      if (analyze(e, doc, input).requiresConfirmation) throw Error('Review the downstream consequences before saving this answer.');
      return;
    }
    const entry = this.assert(e, doc, input.answerPreview);
    if (JSON.stringify(proposal(input, next)) !== JSON.stringify(entry.proposal) || entry.requiresConfirmation && input.confirmConsequences !== true) throw stale();
    await this.checkDraft(e, entry);
    this.assert(e, await e.fresh(), input.answerPreview);
  }
  page(entry, page, targetId, pathPage) {
    if (![page, pathPage].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 5000) || targetId !== null && typeof targetId !== 'string') throw Error('Invalid consequence page.');
    const { doc, impact } = entry, byId = new Map(doc.nodes.map(n => [n.id, n]));
    const affected = new Set(entry.affectedIds), research = new Set(entry.researchIds), ids = [...affected, ...[...research].filter(id => !affected.has(id))];
    const describe = id => { const n = byId.get(id); return { id, question: n.question, direction: n.kind === 'direction', state: effectiveAnswerState(n), structural: impact.predecessors.tree.has(id) && id !== impact.sourceId, confirmed: impact.predecessors.dependency.has(id) && id !== impact.sourceId, generated: !!n.generation && affected.has(id), research: research.has(id), review: affected.has(id) }; };
    if (targetId !== null && !ids.includes(targetId)) throw Error('Choose a listed affected item.');
    const selected = targetId ?? ids[page * 50] ?? null, path = selected === impact.sourceId ? [{ id: selected, via: null }] : selected ? impactPath(impact, selected) : [];
    const source = findNode(doc, impact.sourceId);
    return { token: entry.token, requiresConfirmation: entry.requiresConfirmation, changed: entry.changed, acknowledgment: !entry.changed && entry.savedChange,
      current: { answer: source.answer, state: effectiveAnswerState(source) }, proposed: { answer: entry.proposal.answer, state: entry.proposal.answerState },
      counts: entry.changed ? impact.counts : { total: 0, structural: 0, confirmed: 0, mixedOnly: 0 }, directions: entry.affectedIds.filter(id => byId.get(id).kind === 'direction').length,
      research: entry.researchIds.length, generated: entry.generated, staged: entry.staged, running: entry.running, followup: entry.followup, artifacts: entry.artifacts, adr: impact.adrAssociations.reason,
      total: ids.length, page, items: ids.slice(page * 50, page * 50 + 50).map(describe), targetId: selected, pathPage, pathTotal: path.length,
      path: path.slice(pathPage * 30, pathPage * 30 + 30).map(step => ({ ...step, question: byId.get(step.id).question })) };
  }
}
