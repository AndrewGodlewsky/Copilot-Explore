import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ResearchConversations, conversationKey, conversationHistory, emptyConversationDraft, sameConversationHistory } from './research-conversations.mjs';
import { sameFollowup } from './research-followup.mjs';
import { isQuestion } from './model.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = value => process.platform === 'win32' ? value.toLowerCase() : value;
const obsolete = () => { throw Object.assign(Error('This private conversation scope changed. Refresh the current question.'), { code: 'CONVERSATION_CONFLICT' }); };
const conflict = () => { throw Object.assign(Error('Follow-up conversation history changed or was deleted. Review the current conversation again.'), { code: 'CONVERSATION_CONFLICT' }); };
export function conversationPolicy(policy) {
  if (!policy?.proof) return null;
  const { epoch, ...stable } = policy.proof; return hash(stable);
}
export class ResearchConversationWorkspace {
  constructor() { this.memory = new ResearchConversations({ directory: null }); this.activeStore = null; this.unsaved = null; }
  scope(e, doc = e.doc) {
    if (!doc) return null;
    const identity = [doc.id, doc.rootId, doc.createdAt], context = e.projectStore?.context;
    return hash(['research-conversation-v1', ...(context ? ['project', context.key, canonical(context.relativePath.replaceAll('\\', '/'))] : e.library ? ['personal', e.activeKey] : ['preview', e.reuseInstance, e.file ? canonical(resolve(e.file)) : null]), identity]);
  }
  requireScope(e, scope, doc = e.doc) { if (e.closed || typeof scope !== 'string' || !/^[a-f0-9]{64}$/.test(scope) || scope !== this.scope(e, doc)) obsolete(); }
  binding(e, doc = e.doc) {
    const context = e.projectStore?.context, directory = context?.directory ?? e.library?.directory;
    if (directory && this.activeStore?.directory !== directory) this.activeStore = new ResearchConversations({ directory, ...(context ? { assertPrivate: () => context.assertPrivate() } : {}) });
    return { scope: this.scope(e, doc), store: directory ? this.activeStore : this.memory };
  }
  key(e, doc, nodeId, research) {
    const node = doc.nodes.find(node => node.id === nodeId);
    if (research === undefined && !node?.research) throw Error('Research this question before opening a conversation.');
    return conversationKey({ namespace: this.scope(e, doc), nodeId, research: research ?? hash(node.research) });
  }
  requireSaved() { if (this.unsaved) throw Error('A validated reply could not be confirmed saved. Save again or discard the unsaved reply before starting more research.'); }
  pending(e) {
    const value = this.unsaved; if (!value) return null;
    const here = value.capture.scope === this.scope(e);
    return { id: value.id, here, ...(here ? { nodeId: value.capture.key.nodeId } : {}), message: 'Save could not be confirmed. The validated reply is retained only while this Explorer remains open. Return to its original question to save again, or discard it.' };
  }
  historical(e, doc, key, history, policy) {
    const node = doc.nodes.find(node => node.id === key.nodeId);
    return !!history && (!!history.historical || e.followup?.id === history.id && e.followup?.conversationScope === key.namespace && e.followup.historical || !node?.research || node.researchStale === true || key.research !== hash(node.research) || !sameFollowup(history.dependencies, doc, key.nodeId) || history.policy !== conversationPolicy(policy));
  }
  visible(e, doc, key, history, policy) {
    if (!history) return null;
    const { dependencies, policy: ignoredPolicy, scenarioPolicy, reuse, conversationScope, ...visible } = history;
    return structuredClone({ ...visible, journey: e.activeKey ?? doc.id, nodeId: key.nodeId, historical: this.historical(e, doc, key, history, policy) });
  }
  async markHistorical(e, doc, binding, key, saved, policy) {
    if (!policy || !saved.entry?.history || saved.entry.history.historical || !this.historical(e, doc, key, saved.entry.history, policy)) return saved;
    this.requireScope(e, binding.scope);
    // A known stale observation is permanent until clear, including after restart.
    // Unavailable policy alone is not proof of change. This never creates a record.
    const marked = await binding.store.saveHistory(key, { ...saved.entry.history, historical: true }, saved.guard);
    this.requireScope(e, binding.scope); return marked;
  }
  async view(e, doc, binding, key, saved, policy) {
    const entries = await binding.store.list(key.namespace);
    this.requireScope(e, binding.scope);
    const pending = this.unsaved?.capture.scope === binding.scope && this.unsaved.capture.key.nodeId === key.nodeId && this.unsaved.capture.key.research === key.research ? this.unsaved : null;
    const history = pending?.history ?? saved.entry?.history ?? null;
    return { journey: e.activeKey ?? doc.id, conversationScope: binding.scope, nodeId: key.nodeId, research: key.research, guard: saved.guard, durable: saved.durable,
      draft: saved.entry?.draft ?? emptyConversationDraft(), history: this.visible(e, doc, key, history, policy), historical: this.historical(e, doc, key, history, policy),
      archives: entries.filter(item => item.nodeId === key.nodeId && item.research !== key.research).map(({ namespace, ...item }) => item), unsaved: this.pending(e) };
  }
  async request(e, input) {
    const fields = { read: 'action,conversationScope,journey,nodeId,revision', archive: 'action,conversationScope,journey,nodeId,research', draft: 'action,conversationScope,draft,guard,journey,nodeId,research', clear: 'action,conversationScope,guard,journey,nodeId,research', delete: 'action,conversationScope,guard,journey,nodeId,research', inventory: 'action,conversationScope,journey', cleanup: 'action,conversationScope,guard,journey,target', 'retry-save': 'action,conversationScope,id,journey,nodeId', 'discard-unsaved': 'action,conversationScope,id,journey' };
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(fields, input.action) || Object.keys(input).sort().join(',') !== fields[input.action]) throw Error('Invalid private conversation request.');
    this.requireScope(e, input.conversationScope);
    if (input.journey !== (e.activeKey ?? e.doc.id)) obsolete();
    if (input.action === 'discard-unsaved') { if (this.unsaved?.id !== input.id) obsolete(); this.unsaved = null; return { conversationScope: input.conversationScope, discarded: true }; }
    const doc = await e.readCurrent(); this.requireScope(e, input.conversationScope, doc);
    const binding = this.binding(e, doc);
    if (input.action === 'retry-save') return this.retry(e, doc, input.id, input.nodeId);
    if (input.action === 'inventory') return { conversationScope: binding.scope, entries: (await binding.store.list()).map(({ namespace, nodeId, research, ...item }) => ({ ...item, target: { namespace, nodeId, research }, currentJourney: namespace === binding.scope })) };
    if (input.action === 'cleanup') {
      if (e.pending) throw Error('Finish pending work before deleting conversations.');
      const target = conversationKey(input.target), pending = this.unsaved?.capture.key;
      if (pending && ['namespace', 'nodeId', 'research'].every(field => target[field] === pending[field])) throw Error('Save again or discard the unsaved reply before deleting its conversation. Other records can be deleted to free space.');
      const entries = await binding.store.list();
      if (!entries.some(item => item.namespace === target.namespace && item.nodeId === target.nodeId && item.research === target.research)) conflict();
      this.requireScope(e, binding.scope);
      await binding.store.delete(target, input.guard); e.researchReview.clear();
      const clearedWork = [];
      if (target.namespace === binding.scope && e.followup?.nodeId === target.nodeId) { e.followup = null; clearedWork.push('followup'); }
      return { conversationScope: binding.scope, deleted: true, clearedWork };
    }
    if (input.action === 'read' && (!Number.isSafeInteger(input.revision) || input.revision !== doc.revision)) obsolete();
    const key = this.key(e, doc, input.nodeId, input.research); let saved = await binding.store.read(key);
    this.requireScope(e, binding.scope);
    const clearedWork = [];
    if (input.action === 'draft') {
      if (!saved.entry && !doc.nodes.some(node => node.id === key.nodeId && isQuestion(node))) conflict();
      saved = await binding.store.saveDraft(key, input.draft, input.guard);
    } else if (['clear', 'delete'].includes(input.action)) {
      if (e.pending || this.unsaved) throw Error('Finish pending work and resolve unsaved replies before clearing or deleting a conversation.');
      saved = await binding.store[input.action === 'clear' ? 'clearHistory' : 'delete'](key, input.guard);
      e.researchReview.clear();
      if (e.followup?.nodeId === key.nodeId) { e.followup = null; e.followupTurn = null; clearedWork.push('followup', 'followupTurn'); }
      if (e.researchOperation?.kind === 'research-follow-up' && e.researchOperation.nodeId === key.nodeId) { e.researchOperation = null; clearedWork.push('researchOperation'); }
      if (e.researchAttempt?.kind === 'research-follow-up' && e.researchAttempt.nodeId === key.nodeId) { e.researchAttempt = null; clearedWork.push('researchAttempt'); }
    }
    let policy; try { policy = await e.scenarioPolicy(); } catch { /* Unavailable scenario authority keeps saved discussion historical. */ }
    this.requireScope(e, binding.scope);
    saved = await this.markHistorical(e, doc, binding, key, saved, policy);
    const value = await this.view(e, doc, binding, key, saved, policy);
    return ['clear', 'delete'].includes(input.action) ? { ...value, clearedWork } : value;
  }
  async prepare(e, doc, nodeId, scope, policy) {
    this.requireSaved(); this.requireScope(e, scope, doc);
    const binding = this.binding(e, doc), key = this.key(e, doc, nodeId);
    let saved = await binding.store.read(key);
    this.requireScope(e, scope);
    saved = await this.markHistorical(e, doc, binding, key, saved, policy);
    if (this.historical(e, doc, key, saved.entry?.history, policy)) throw Error('This conversation is historical because its research or saved context changed. Start a fresh conversation before reviewing a new follow-up.');
    if (!saved.entry) saved = await binding.store.ensure(key, saved.guard);
    this.requireScope(e, scope);
    const history = saved.entry.history;
    const previous = e.followup?.id === history?.id && e.followup?.conversationScope === scope ? e.followup : null;
    e.followup = history ? { ...history, journey: e.activeKey ?? doc.id, nodeId, conversationScope: scope, scenarioPolicy: policy, historical: false, ...(previous?.reuse ? { reuse: previous.reuse } : {}), ...(previous?.reuseNotice ? { reuseNotice: previous.reuseNotice } : {}) } : null;
    return { scope, key, guard: saved.guard };
  }
  async assert(e, doc, capture) {
    if (!capture) conflict(); this.requireScope(e, capture.scope, doc);
    if (this.key(e, doc, capture.key.nodeId).research !== capture.key.research) throw Object.assign(Error('Reviewed research changed. Review the current conversation again.'), { code: 'CONVERSATION_CONFLICT' });
    const binding = this.binding(e, doc), saved = await binding.store.read(capture.key);
    this.requireScope(e, capture.scope);
    if (!saved.entry || !sameConversationHistory(saved.guard, capture.guard)) conflict();
    return { binding, saved };
  }
  async save(e, doc, capture, history) {
    if (!capture) conflict(); this.requireScope(e, capture.scope, doc);
    const binding = this.binding(e, doc), durable = conversationHistory({ ...history, policy: conversationPolicy(history.scenarioPolicy) });
    try {
      await this.assert(e, doc, capture);
      await binding.store.saveHistory(capture.key, durable, capture.guard);
    }
    catch (error) {
      if (error.code === 'CONVERSATION_CONFLICT') throw error;
      this.unsaved = { id: randomUUID(), capture, store: binding.store, history: durable };
      throw Object.assign(Error('Save could not be confirmed. Your validated reply remains in this Explorer; save again or discard it before more research. Closing now may lose it.'), { code: 'CONVERSATION_SAVE' });
    }
  }
  async retry(e, doc, id, nodeId) {
    const value = this.unsaved;
    if (!value || value.id !== id || value.capture.key.nodeId !== nodeId || e.pending) obsolete();
    this.requireScope(e, value.capture.scope, doc);
    const policy = await e.scenarioPolicy(); this.requireScope(e, value.capture.scope);
    if (conversationPolicy(policy) !== value.history.policy || !sameFollowup(value.history.dependencies, doc, value.capture.key.nodeId) || this.key(e, doc, value.capture.key.nodeId).research !== value.capture.key.research) conflict();
    await value.store.saveHistory(value.capture.key, value.history, value.capture.guard);
    this.unsaved = null; e.followup = { ...value.history, journey: e.activeKey ?? doc.id, nodeId: value.capture.key.nodeId, conversationScope: value.capture.scope, scenarioPolicy: policy };
    e.researchReview.clear(); e.error = '';
    return { conversationScope: value.capture.scope, saved: true };
  }
  async invalidateReplacement(e, after, nodeId) {
    const binding = this.binding(e, after), key = this.key(e, after, nodeId), saved = await binding.store.read(key);
    this.requireScope(e, binding.scope);
    if (!saved.entry?.history || saved.entry.history.historical) return;
    // Persist before the map commit. A failed map save may conservatively retire this
    // discussion, but a committed replacement must never revive an earlier thread.
    await binding.store.saveHistory(key, { ...saved.entry.history, historical: true }, saved.guard);
  }
}
