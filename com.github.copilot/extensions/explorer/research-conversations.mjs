import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';
import { acquireLock } from './owned-lock.mjs';
import { atomicWrite } from './storage.mjs';
import { parseDocumentJson } from './shared-document.mjs';
import { followupInput, followupResult } from './research-followup.mjs';
import { researchProfile } from './web/research-guidance.mjs';

export const CONVERSATION_LIMITS = Object.freeze({ entries: 128, bytes: 8 * 1024 * 1024, exchanges: 20, historyBytes: 256 * 1024 });
const size = value => Buffer.byteLength(JSON.stringify(value));
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const node = value => typeof value === 'string' && !!value.trim() && value.length <= 100;
const invalid = () => { throw Error('Invalid private conversation data.'); };
const preserved = () => Object.assign(Error('Private research conversations could not be read safely. The file has been preserved; repair it before saving.'), { code: 'CONVERSATION_UNSAFE' });
const conflict = () => { throw Object.assign(Error('This conversation changed or was deleted in another canvas. Refresh before saving.'), { code: 'CONVERSATION_CONFLICT' }); };
const empty = () => ({ version: 1, revision: 0, entries: [] });
export const emptyConversationDraft = () => ({ question: '', hypothetical: false, sourceMode: 'existing' });
export function conversationKey(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'namespace,nodeId,research' || !hash(value.namespace) || !hash(value.research) || !node(value.nodeId)) invalid();
  return { namespace: value.namespace, nodeId: value.nodeId, research: value.research };
}
const keyId = value => JSON.stringify([value.namespace, value.nodeId, value.research]);
export function conversationDraft(value) {
  if (!object(value) || typeof value.question !== 'string' || value.question.length > 4000) invalid();
  return { ...followupInput({ ...value, question: value.question.trim() ? value.question : '_' }), question: value.question };
}
export function retainConversation(exchanges) {
  const retained = exchanges.slice(-CONVERSATION_LIMITS.exchanges);
  while (size(retained) > CONVERSATION_LIMITS.historyBytes) retained.shift();
  return retained;
}
function dependencies(value) {
  if (!object(value) || Object.keys(value).some(key => !['identity', 'framing', 'destination', 'records', 'relevanceSources'].includes(key)) || !['identity', 'framing', 'destination'].every(key => hash(value[key]))) invalid();
  const pairs = values => {
    if (!Array.isArray(values) || values.length > 5000) invalid();
    const ids = new Set();
    return values.map(pair => { if (!Array.isArray(pair) || pair.length !== 2 || !node(pair[0]) || !hash(pair[1]) || ids.has(pair[0])) invalid(); ids.add(pair[0]); return [...pair]; });
  };
  const result = { identity: value.identity, framing: value.framing, destination: value.destination, records: pairs(value.records), ...(value.relevanceSources ? { relevanceSources: pairs(value.relevanceSources) } : {}) };
  if (size(result) > 4 * 1024 * 1024) invalid();
  return result;
}
export function conversationHistory(value) {
  if (value === null) return null;
  if (!object(value) || !uuid(value.id) || !hash(value.policy) || !integer(value.dropped) || !Array.isArray(value.exchanges) || value.exchanges.length > 100) invalid();
  const ids = new Set();
  const all = value.exchanges.map(item => {
    if (!object(item) || !uuid(item.id) || ids.has(item.id)) invalid(); ids.add(item.id);
    const input = followupInput({ question: item.question, hypothetical: item.hypothetical, ...(Object.hasOwn(item, 'sourceMode') ? { sourceMode: item.sourceMode } : {}), ...(item.target ? { target: item.target } : {}) });
    if (!Object.hasOwn(item, 'sourceMode')) delete input.sourceMode;
    if (item.targetLabel !== undefined && (typeof item.targetLabel !== 'string' || item.targetLabel.length > 4000)) invalid();
    return { id: item.id, ...input, ...(item.targetLabel !== undefined ? { targetLabel: item.targetLabel } : {}), ...(item.profile !== undefined ? { profile: researchProfile(item.profile) } : {}), result: followupResult(item.result) };
  });
  const exchanges = retainConversation(all), dropped = value.dropped + all.length - exchanges.length;
  if (!integer(dropped)) invalid();
  if (value.historical !== undefined && typeof value.historical !== 'boolean') invalid();
  return { id: value.id, dependencies: dependencies(value.dependencies), policy: value.policy, dropped, exchanges, ...(value.historical ? { historical: true } : {}) };
}
function validate(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'entries,revision,version' || value.version !== 1 || !integer(value.revision) || !Array.isArray(value.entries) || value.entries.length > CONVERSATION_LIMITS.entries || size(value) > CONVERSATION_LIMITS.bytes) invalid();
  const ids = new Set();
  for (const entry of value.entries) {
    if (!object(entry) || Object.keys(entry).sort().join(',') !== 'draft,draftRevision,history,historyRevision,incarnation,key,revision,updatedAt' || !uuid(entry.incarnation) || !['revision', 'draftRevision', 'historyRevision'].every(key => integer(entry[key])) || entry.revision > value.revision || entry.draftRevision > entry.revision || entry.historyRevision > entry.revision || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt)) || new Date(entry.updatedAt).toISOString() !== entry.updatedAt) invalid();
    conversationKey(entry.key); const id = keyId(entry.key); if (ids.has(id)) invalid(); ids.add(id);
    if (!isDeepStrictEqual(conversationDraft(entry.draft), entry.draft) || !isDeepStrictEqual(conversationHistory(entry.history), entry.history)) invalid();
  }
  return value;
}
function guard(entry, revision) {
  return { incarnation: entry?.incarnation ?? null, revision: entry?.revision ?? 0, draftRevision: entry?.draftRevision ?? 0, historyRevision: entry?.historyRevision ?? 0, storeRevision: revision };
}
function checkGuard(value) {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'draftRevision,historyRevision,incarnation,revision,storeRevision' || value.incarnation !== null && !uuid(value.incarnation) || !['revision', 'draftRevision', 'historyRevision', 'storeRevision'].every(key => integer(value[key]))) invalid();
}
export const sameConversationHistory = (a, b) => a?.incarnation === b?.incarnation && a?.historyRevision === b?.historyRevision;

/** Only trusted private directories reach this store. Null means an explicitly transient preview. */
export class ResearchConversations {
  constructor({ directory, assertPrivate = async () => {}, write = atomicWrite }) {
    this.directory = directory; this.file = directory ? join(directory, 'research-conversations.json') : null;
    this.assertPrivate = assertPrivate; this.write = write; this.memory = empty(); this.queue = Promise.resolve();
  }
  async access(create = false) {
    if (!this.directory) return null;
    try {
      await this.assertPrivate();
      let current;
      try { current = await directoryState(this.directory, create && !this.root); }
      catch (error) { if (!create && !this.root && error.code === 'ENOENT') return null; throw error; }
      if (this.root && this.root.identity !== current.identity) throw preserved();
      this.root ??= current;
      return await projectDocumentAccess({ checkoutDirectory: this.directory, file: this.file, revalidate: async () => {
        await this.assertPrivate(); if ((await directoryState(this.directory)).identity !== this.root.identity) throw preserved();
      } });
    } catch { throw preserved(); }
  }
  async document() {
    if (!this.directory) return structuredClone(this.memory);
    try {
      const access = await this.access(); if (!access) return empty();
      let bytes;
      try { ({ bytes } = await access.read({ maxBytes: CONVERSATION_LIMITS.bytes })); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await access.assertCurrent(); return empty(); }
      return validate(parseDocumentJson(bytes).value);
    } catch { throw preserved(); }
  }
  view(value, key) {
    const entry = value.entries.find(item => keyId(item.key) === keyId(key)) ?? null;
    return structuredClone({ entry, guard: guard(entry, value.revision), durable: !!this.directory });
  }
  async read(key) { conversationKey(key); return this.view(await this.document(), key); }
  async list(namespace) {
    if (namespace !== undefined && !hash(namespace)) invalid();
    const value = await this.document();
    return value.entries.filter(entry => namespace === undefined || entry.key.namespace === namespace).map(entry => ({ ...entry.key, updatedAt: entry.updatedAt, exchanges: entry.history?.exchanges.length ?? 0, hasDraft: !!entry.draft.question, guard: guard(entry, value.revision) }));
  }
  mutate(key, captured, field, change, reconcile) {
    key = conversationKey(key); checkGuard(captured); captured = structuredClone(captured);
    const run = async () => {
      const access = await this.access(true), lock = this.directory ? await acquireLock(this.file + '.lock') : null;
      try {
        await access?.assertCurrent();
        const value = await this.document(), current = this.view(value, key), entry = current.entry;
        if (reconcile && entry && entry.incarnation === captured.incarnation && entry.historyRevision === captured.historyRevision + 1 && isDeepStrictEqual(entry.history, reconcile)) return current;
        if (entry ? entry.incarnation !== captured.incarnation || entry[field] !== captured[field] : captured.incarnation !== null || captured.storeRevision !== value.revision) conflict();
        if (value.revision >= Number.MAX_SAFE_INTEGER || entry && entry.revision >= Number.MAX_SAFE_INTEGER) throw Error('Private conversation revision limit reached.');
        const next = change(entry), index = value.entries.findIndex(item => keyId(item.key) === keyId(key));
        if (next === entry && entry) return current;
        if (next) {
          if (index < 0 && value.entries.length >= CONVERSATION_LIMITS.entries) throw Error('Private conversation storage is full. Explicitly delete a saved conversation to make room.');
          const updated = { ...(entry ?? { key, incarnation: randomUUID(), revision: 0, draftRevision: 0, historyRevision: 0, draft: emptyConversationDraft(), history: null }), ...next, revision: (entry?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
          if (field !== 'revision') updated[field] = (entry?.[field] ?? 0) + 1;
          if (index < 0) value.entries.push(updated); else value.entries[index] = updated;
        } else if (index >= 0) value.entries.splice(index, 1);
        value.revision++;
        if (size(value) > CONVERSATION_LIMITS.bytes) throw Error('Private conversation storage byte limit reached. Explicitly delete a saved conversation to make room.');
        validate(value); await access?.assertCurrent();
        if (this.directory) { await this.write(this.file, JSON.stringify(value)); await access.assertCurrent(); }
        else this.memory = value;
        return this.view(value, key);
      } finally { await lock?.release(); }
    };
    const result = this.queue.then(run, run); this.queue = result.catch(() => {}); return result;
  }
  ensure(key, captured) { return this.mutate(key, captured, 'revision', entry => entry ?? {}); }
  saveDraft(key, draft, captured) { draft = conversationDraft(draft); return this.mutate(key, captured, 'draftRevision', () => ({ draft })); }
  saveHistory(key, history, captured) { history = conversationHistory(history); return this.mutate(key, captured, 'historyRevision', () => ({ history }), history); }
  clearHistory(key, captured) { return this.mutate(key, captured, 'historyRevision', () => ({ history: null })); }
  delete(key, captured) { return this.mutate(key, captured, 'revision', () => null); }
}
