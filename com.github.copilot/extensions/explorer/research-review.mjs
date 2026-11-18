import { prepareFollowup } from './research-followup.mjs';
import { prepareChallenge } from './answer-check.mjs';
import { prepareHandoff, captureHandoff, handoffFreshness } from './implementation-handoff.mjs';
import { prepareAdrScope, captureAdrScope, adrScopeFreshness } from './adr-scope.mjs';
import { prepareAdrDraft, captureAdrDraft, adrDraftFreshness } from './adr-draft.mjs';
import { randomUUID } from 'node:crypto';
import { isQuestion } from './web/answer-state.mjs';
import { findNode } from './model.mjs';
import { researchFraming } from './research.mjs';
import { researchSettings, researchLimits } from './web/research-policy.mjs';
import { prepareResearch, sameResearchSources, sameResearchDestination } from './research-context.mjs';

export const REVIEW_RESPONSE_LIMIT = 1024 * 1024;
export const REVIEW_TTL = 10 * 60 * 1000;
const invalid = () => { throw new Error('Invalid research review request.'); };
const obsolete = () => { throw new Error('This research review is obsolete. Refresh and review context before starting.'); };

// Private, bounded to one payload and one latest client sequence; never part of map polling.
export class ResearchReview {
  constructor() { this.current = null; this.order = null; this.timer = null; this.selection = null; }
  clear(keepSelection = false) {
    clearTimeout(this.timer); this.timer = null; this.current = null;
    if (!keepSelection) this.selection = null;
    else if (this.selection) { this.timer = setTimeout(() => this.clear(), REVIEW_TTL); this.timer.unref?.(); }
  }
  async prepare(explorer, input) {
    const challenge = input?.purpose === 'challenge-review';
    const handoff = input?.purpose === 'implementation-handoff';
    const adrScope = input?.purpose === 'adr-scope', adrQuestions = input?.purpose === 'adr-questions', adrDraft = input?.purpose === 'adr-draft', savedAdr = adrQuestions || adrDraft, selected = handoff || adrScope;
    const regeneration = input?.purpose === 'question-regeneration';
    if (!input || typeof input !== 'object' || Array.isArray(input) || !['prepare', 'cancel'].includes(input.action) ||
      (savedAdr ? Object.keys(input).sort().join(',') !== 'action,clientId,journey,nodeId,purpose,sequence' : regeneration ? Object.keys(input).sort().join(',') !== 'action,clientId,excluded,journey,nodeId,purpose,retained,scope,sequence' : selected ? Object.keys(input).sort().join(',') !== 'action,clientId,journey,nodeId,purpose,selection,sequence' : !['action,clientId,excluded,journey,nodeId,scope,sequence', 'action,clientId,excluded,journey,nodeId,scope,sequence,settings'].includes(Object.keys(input).filter(key => key !== 'followup' && !(challenge && ['purpose', 'project'].includes(key))).sort().join(','))) ||
      (challenge && (input.followup !== undefined || input.scope !== 'decisions')) ||
      typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.clientId) ||
      !Number.isSafeInteger(input.sequence) || input.sequence < 1 ||
      typeof input.journey !== 'string' || input.journey.length > 100 || typeof input.nodeId !== 'string' || input.nodeId.length > 100 ||
      (!selected && !savedAdr && (!Array.isArray(input.excluded) || input.excluded.length > 5000 || input.excluded.some(id => typeof id !== 'string' || id.length > 100)))) invalid();
    if (input.project !== undefined && (!challenge || !input.project || Object.keys(input.project).sort().join(',') !== 'action,paths' || input.project.action !== 'refresh' || !Array.isArray(input.project.paths))) invalid();
    const settings = researchSettings(input.settings);
    if (this.order?.clientId === input.clientId && this.order.sequence >= input.sequence) obsolete();
    if (input.action === 'cancel' && this.order && this.order.clientId !== input.clientId) return { status: 'cancelled' };
    this.order = { clientId: input.clientId, sequence: input.sequence }; const order = this.order;
    this.clear(challenge && this.selection?.journey === input.journey && this.selection?.clientId === input.clientId && input.action !== 'cancel');
    if (input.action === 'cancel') return { status: 'cancelled' };
    if (explorer.closed || !explorer.doc || input.journey !== (explorer.activeKey ?? explorer.doc.id)) obsolete();
    if (explorer.pending) throw new Error('Wait for research or cancel the current request first.');
    if ((regeneration || adrQuestions) && explorer.preview) throw Error('Accept or dismiss the existing question preview before asking again.');
    const file = explorer.file, key = explorer.activeKey;
    const current = regeneration || adrScope || savedAdr ? await explorer.fresh() : await explorer.readCurrent();
    if (explorer.closed || this.order !== order || explorer.file !== file || explorer.activeKey !== key) obsolete();
    if (challenge || selected || savedAdr ? input.nodeId !== current.rootId : !isQuestion(findNode(current, input.nodeId))) throw new Error(challenge || selected || savedAdr ? 'This review must use the journey root.' : 'Select a question to research.');
    if (challenge && input.project) {
      const capture = await explorer.projectContext.select(input.project.paths, this.selection?.capture);
      if (explorer.closed || this.order !== order || explorer.file !== file || explorer.activeKey !== key) obsolete();
      this.selection = capture ? { journey: input.journey, clientId: input.clientId, capture } : null;
      this.clear(true);
    }
    const projectCapture = challenge ? this.selection?.capture : undefined;
    const observedFresh = !projectCapture || await explorer.projectContext.fresh(projectCapture);
    if (this.selection && !observedFresh) this.selection.stale = true;
    const projectFresh = observedFresh && !this.selection?.stale;
    if (explorer.closed || this.order !== order || explorer.file !== file || explorer.activeKey !== key) obsolete();
    const scenarioPolicy = await explorer.scenarioPolicy(), scenario = scenarioPolicy.label;
    const content = adrDraft ? prepareAdrDraft(current, { scenario }) : adrQuestions ? explorer.prepareAdrQuestionRequest(current, randomUUID(), scenario) : adrScope ? prepareAdrScope(current, input.selection, { scenario }) : regeneration ? explorer.prepareRequest('questions', input.nodeId, randomUUID(), input.scope, scenario, { document: current, retained: input.retained, excluded: input.excluded }) : handoff ? prepareHandoff(current, input.selection, { scenario }) : challenge ? Object.freeze({ ...prepareChallenge(current, input.excluded, projectCapture?.sources, { scenario }), projectCapture, projectFresh }) : input.followup !== undefined ? prepareFollowup(current, input.nodeId, input.followup, { settings, scenario, scope: input.scope, excluded: input.excluded, history: explorer.currentFollowup(current, input.nodeId) }) : Object.freeze({ ...prepareResearch(current, input.nodeId, { ...researchFraming(current, settings), scenario, scope: input.scope, excluded: input.excluded }), settings, limits: researchLimits(settings) });
    await explorer.assertScenarioPolicy(scenarioPolicy);
    const prepared = Object.freeze({ ...content, scenarioPolicy });
    const token = randomUUID(), expiresAt = Date.now() + REVIEW_TTL;
    const response = { token, journey: input.journey, nodeId: input.nodeId, clientId: input.clientId, sequence: input.sequence, expiresAt,
      excluded: [...input.excluded ?? []], prepared: { context: prepared.context, instructions: prepared.instructions, prompt: prepared.prompt, bytes: prepared.bytes, limit: prepared.limit, coverage: prepared.coverage, ...(regeneration || selected || savedAdr ? { operation: prepared.operation, canStart: true } : challenge ? { operation: 'challenge-review', canStart: prepared.canStart && projectFresh, projectFresh } : { settings }), limits: prepared.limits, ...(prepared.followup ? { followup: prepared.followup } : {}) } };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > REVIEW_RESPONSE_LIMIT) throw new Error('The research review exceeds its 1 MiB response limit. Reduce optional exclusions or choose a narrower scope.');
    this.current = { token, journey: input.journey, nodeId: input.nodeId, file, key, prepared, expiresAt };
    clearTimeout(this.timer); this.timer = setTimeout(() => this.clear(), REVIEW_TTL); this.timer.unref?.();
    return response;
  }
  async consume(explorer, input) {
    const review = this.current;
    if (!review || typeof input.token !== 'string' || input.token !== review.token || input.journey !== review.journey || input.nodeId !== review.nodeId ||
      explorer.file !== review.file || explorer.activeKey !== review.key || input.journey !== (explorer.activeKey ?? explorer.doc?.id) || Date.now() >= review.expiresAt) obsolete();
    if ((review.prepared.operation ?? (review.prepared.followup ? 'research-follow-up' : 'research')) !== (input.purpose ?? 'research')) throw new Error('This review has a different purpose.');
    const challenge = review.prepared.operation === 'challenge-review';
    const handoff = review.prepared.operation === 'implementation-handoff';
    const adrScope = review.prepared.operation === 'adr-scope';
    const regeneration = review.prepared.operation === 'question-regeneration';
    const adrQuestions = review.prepared.operation === 'adr-questions';
    const adrDraft = review.prepared.operation === 'adr-draft';
    if ((regeneration || adrQuestions) && (explorer.pending || explorer.preview)) throw Error('Finish or dismiss the current questions before asking again.');
    if (challenge && !review.prepared.canStart) throw new Error('Select at least one saved nonempty answer to challenge. Tentative answers remain tentative.');
    this.clear(true);
    await explorer.assertScenarioPolicy(review.prepared.scenarioPolicy);
    const current = await explorer.readCurrent();
    if (review.prepared.projectCapture && (!review.prepared.projectFresh || !await explorer.projectContext.fresh(review.prepared.projectCapture))) throw new Error('Reviewed project files or working root changed or are unavailable. Explicitly refresh files and review before starting.');
    explorer.currentFollowup(current);
    if (explorer.closed || !sameResearchSources(review.prepared.dependencies, current) || ((regeneration || adrQuestions) && !sameResearchSources(review.prepared.dependencies, explorer.doc)) || (!challenge && !handoff && !adrScope && !regeneration && !adrQuestions && !adrDraft && !sameResearchDestination(review.prepared.dependencies, current))) throw new Error('Reviewed sources or saved research changed. Refresh and review context before starting.');
    if (adrDraft) {
      const captured = captureAdrDraft(review.prepared), scenario = review.prepared.context.scenario;
      if (adrDraftFreshness(captured, current, scenario) !== 'current' || adrDraftFreshness(captured, explorer.doc, scenario) !== 'current') throw Error('Reviewed ADR draft inputs changed. Refresh and review again.');
    }
    if (adrScope) {
      const captured = captureAdrScope(review.prepared), scenario = review.prepared.context.scenario;
      if (adrScopeFreshness(captured, current, scenario) !== 'current' || adrScopeFreshness(captured, explorer.doc, scenario) !== 'current') throw Error('Reviewed ADR sources or evidence changed. Refresh and review again.');
    }
    if (handoff) {
      const captured = { dependencies: captureHandoff(review.prepared), formatFingerprint: review.prepared.formatFingerprint, ...review.prepared.context };
      if (handoffFreshness(captured, current) !== 'current' || handoffFreshness(captured, explorer.doc) !== 'current') throw Error('Reviewed handoff sources or evidence changed. Refresh and review again.');
    }
    if (review.prepared.followup && (explorer.currentFollowup(current, input.nodeId)?.id ?? null) !== review.prepared.historyId) throw new Error('Follow-up history or its earlier source context changed. Review again before starting.');
    this.clear();
    return review.prepared;
  }
}
