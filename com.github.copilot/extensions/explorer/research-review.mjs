import { prepareFollowup } from './research-followup.mjs';
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
  constructor() { this.current = null; this.order = null; this.timer = null; }
  clear() { clearTimeout(this.timer); this.timer = null; this.current = null; }
  async prepare(explorer, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !['prepare', 'cancel'].includes(input.action) ||
      !['action,clientId,excluded,journey,nodeId,scope,sequence', 'action,clientId,excluded,journey,nodeId,scope,sequence,settings'].includes(Object.keys(input).filter(key => key !== 'followup').sort().join(',')) ||
      typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.clientId) ||
      !Number.isSafeInteger(input.sequence) || input.sequence < 1 ||
      typeof input.journey !== 'string' || input.journey.length > 100 || typeof input.nodeId !== 'string' || input.nodeId.length > 100 ||
      !Array.isArray(input.excluded) || input.excluded.length > 5000 || input.excluded.some(id => typeof id !== 'string' || id.length > 100)) invalid();
    const settings = researchSettings(input.settings);
    if (this.order?.clientId === input.clientId && this.order.sequence >= input.sequence) obsolete();
    if (input.action === 'cancel' && this.order && this.order.clientId !== input.clientId) return { status: 'cancelled' };
    this.order = { clientId: input.clientId, sequence: input.sequence }; const order = this.order;
    this.clear();
    if (input.action === 'cancel') return { status: 'cancelled' };
    if (explorer.closed || !explorer.doc || input.journey !== (explorer.activeKey ?? explorer.doc.id)) obsolete();
    if (explorer.pending) throw new Error('Wait for research or cancel the current request first.');
    const file = explorer.file, key = explorer.activeKey;
    const current = await explorer.readCurrent();
    if (explorer.closed || this.order !== order || explorer.file !== file || explorer.activeKey !== key) obsolete();
    if (!isQuestion(findNode(current, input.nodeId))) throw new Error('Select a question to research.');
    const prepared = input.followup !== undefined ? prepareFollowup(current, input.nodeId, input.followup, { settings, scope: input.scope, excluded: input.excluded, history: explorer.currentFollowup(current, input.nodeId) }) : Object.freeze({ ...prepareResearch(current, input.nodeId, { ...researchFraming(current, settings), scope: input.scope, excluded: input.excluded }), settings, limits: researchLimits(settings) });
    const token = randomUUID(), expiresAt = Date.now() + REVIEW_TTL;
    const response = { token, journey: input.journey, nodeId: input.nodeId, clientId: input.clientId, sequence: input.sequence, expiresAt,
      excluded: [...input.excluded], prepared: { context: prepared.context, instructions: prepared.instructions, prompt: prepared.prompt, bytes: prepared.bytes, limit: prepared.limit, coverage: prepared.coverage, settings, limits: prepared.limits, ...(prepared.followup ? { followup: prepared.followup } : {}) } };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > REVIEW_RESPONSE_LIMIT) throw new Error('The research review exceeds its 1 MiB response limit. Reduce optional exclusions or choose a narrower scope.');
    this.current = { token, journey: input.journey, nodeId: input.nodeId, file, key, prepared, expiresAt };
    this.timer = setTimeout(() => this.clear(), REVIEW_TTL); this.timer.unref?.();
    return response;
  }
  async consume(explorer, input) {
    const review = this.current;
    if (!review || typeof input.token !== 'string' || input.token !== review.token || input.journey !== review.journey || input.nodeId !== review.nodeId ||
      explorer.file !== review.file || explorer.activeKey !== review.key || input.journey !== (explorer.activeKey ?? explorer.doc?.id) || Date.now() >= review.expiresAt) obsolete();
    if (!!review.prepared.followup !== (input.purpose === 'research-follow-up')) throw new Error('This review has a different research or follow-up purpose.');
    this.clear();
    const current = await explorer.readCurrent();
    if (explorer.closed || !sameResearchSources(review.prepared.dependencies, current) || !sameResearchDestination(review.prepared.dependencies, current)) throw new Error('Research sources or saved research changed. Refresh and review context before starting.');
    if (review.prepared.followup && (explorer.currentFollowup(current, input.nodeId)?.id ?? null) !== review.prepared.historyId) throw new Error('Follow-up history or its earlier source context changed. Review again before starting.');
    return review.prepared;
  }
}
