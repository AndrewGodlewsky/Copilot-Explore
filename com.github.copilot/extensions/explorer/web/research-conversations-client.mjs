const blank = () => ({ question: '', hypothetical: false, sourceMode: 'existing' });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = binding => JSON.stringify([binding.conversationScope, binding.journey, binding.nodeId, binding.researchKey]);

export class ConversationClient {
  constructor({ fetch, changed, beforeMutation, delay = 350 }) {
    this.fetch = fetch; this.changed = changed; this.beforeMutation = beforeMutation; this.delay = delay; this.entries = new Map(); this.epoch = 0; this.scope = null; this.closed = false;
  }
  attach(scope) {
    if (this.scope === scope) return;
    this.scope = scope; this.epoch++; this.current = null;
    for (const entry of this.entries.values()) if (entry.loading) { entry.readSequence++; entry.loading = false; entry.loaded = false; }
  }
  open(binding) {
    this.attach(binding.conversationScope);
    const id = key(binding); let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= 128) {
        const candidate = [...this.entries.entries()].find(([, item]) => !item.dirty && !item.saving && !item.loading && item !== this.current);
        if (!candidate) throw Error('Too many unsaved private drafts. Save or explicitly delete one before opening another.');
        this.entries.delete(candidate[0]);
      }
      entry = { binding: { ...binding }, draft: blank(), base: blank(), guard: null, research: null, value: null, loaded: false, loading: false, dirty: false, generation: 0, restoreVersion: 0, readSequence: 0, error: '', conflict: null, saving: null, timer: null, deleting: false };
      this.entries.set(id, entry);
    } else entry.binding.revision = binding.revision;
    const activated = this.current !== entry;
    this.current = entry;
    if ((!entry.loaded || activated) && !entry.loading && !entry.deleting) {
      const epoch = this.epoch;
      entry.ready = entry.saving ? entry.saving.catch(() => {}).then(() => {
        if (!this.closed && this.current === entry && this.epoch === epoch) return this.load(entry);
      }) : this.load(entry);
    }
    return entry;
  }
  async request(binding, action, extra = {}) {
    const completed = ['clear', 'delete', 'cleanup'].includes(action) ? this.beforeMutation?.(binding, action, extra) : null;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await this.fetch('api/research-conversations', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' },
        body: JSON.stringify({ action, journey: binding.journey, conversationScope: binding.conversationScope, ...extra }) });
      const value = await response.json(); abort.signal.throwIfAborted();
      if (!response.ok) throw Error(value.error || 'Private conversation request failed.');
      if (value.conversationScope !== binding.conversationScope) throw Error('Private conversation scope changed. Refresh the question.');
      if (['clear', 'delete'].includes(action) && (value.journey !== binding.journey || value.nodeId !== extra.nodeId || value.research !== extra.research)) throw Error('Research changed. Reopen its current conversation.');
      if (action === 'cleanup' && value.deleted !== true) throw Error('Conversation deletion could not be confirmed.');
      completed?.(value.clearedWork);
      return value;
    } catch (error) { throw Error(abort.signal.aborted ? 'Private conversation request timed out. Save could not be confirmed; your local text is retained.' : error.message); }
    finally { clearTimeout(timer); }
  }
  check(entry, value) {
    if (value.journey !== entry.binding.journey || value.nodeId !== entry.binding.nodeId || !/^[a-f0-9]{64}$/.test(value.research) || entry.research && entry.research !== value.research) throw Error('Research changed. Reopen its current conversation.');
  }
  async load(entry) {
    const sequence = ++entry.readSequence, epoch = this.epoch, generation = entry.generation;
    entry.loading = true; this.changed();
    try {
      const value = await this.request(entry.binding, 'read', { nodeId: entry.binding.nodeId, revision: entry.binding.revision });
      if (this.closed || sequence !== entry.readSequence || epoch !== this.epoch) return;
      this.check(entry, value);
      const changed = entry.generation !== generation || entry.dirty;
      if (!entry.value && !changed) { entry.draft = structuredClone(value.draft); entry.restoreVersion++; }
      else if (!same(value.draft, entry.draft) && (!same(value.draft, entry.base) || entry.conflict)) entry.conflict = value;
      else if (same(value.draft, entry.draft)) { entry.dirty = false; entry.conflict = null; }
      entry.value = value; entry.guard = value.guard; entry.research = value.research; entry.base = structuredClone(value.draft); entry.loaded = true; entry.error = '';
    } catch (error) { if (sequence === entry.readSequence && epoch === this.epoch && !this.closed) entry.error = error.message; }
    finally {
      if (sequence === entry.readSequence && epoch === this.epoch && !this.closed) { entry.loading = false; this.changed(); }
    }
  }
  refresh(entry) { if (!entry.loading && !entry.saving && !entry.deleting) entry.ready = this.load(entry); return entry.ready; }
  edit(entry, draft) {
    if (this.closed || entry.deleting) return;
    entry.draft = structuredClone(draft); entry.generation++; entry.dirty = true; entry.deleted = false;
    clearTimeout(entry.timer);
    if (!entry.error && !entry.conflict) entry.timer = setTimeout(() => { entry.timer = null; void this.flush(entry).catch(() => {}); }, this.delay);
    this.changed();
  }
  async save(entry) {
    await entry.ready;
    if (!entry.loaded || entry.error || entry.conflict) throw Error(entry.error || 'Resolve the saved draft conflict before saving.');
    while (entry.dirty && !this.closed && !entry.deleting) {
      if (entry.saving) { await entry.saving; continue; }
      clearTimeout(entry.timer); entry.timer = null;
      const generation = entry.generation, draft = structuredClone(entry.draft);
      const saving = this.request(entry.binding, 'draft', { nodeId: entry.binding.nodeId, research: entry.research, guard: entry.guard, draft }).then(value => {
        if (this.closed) return;
        this.check(entry, value); entry.guard = value.guard; entry.value = value; entry.base = structuredClone(draft);
        if (generation === entry.generation) entry.dirty = false;
      }).catch(error => { if (!this.closed) entry.error = error.message; throw error; }).finally(() => {
        if (entry.saving === saving) entry.saving = null; if (!this.closed) this.changed();
      });
      entry.saving = saving; this.changed(); await saving;
      if (entry.error || entry.conflict) break;
    }
  }
  async flush(entry) {
    const values = entry ? [entry] : [...this.entries.values()].filter(item => item.binding.conversationScope === this.scope && (item.dirty || item.saving));
    for (const value of values) { clearTimeout(value.timer); value.timer = null; await this.save(value); }
  }
  async resolve(entry, choice) {
    const generation = entry.generation, epoch = this.epoch, sequence = ++entry.readSequence, active = this.current, local = structuredClone(entry.draft);
    const assertCurrent = () => {
      if (this.closed || this.current !== active || entry.generation !== generation || epoch !== this.epoch || sequence !== entry.readSequence || entry.binding.conversationScope !== this.scope) throw Error('Your composer or question attachment changed while resolving. Choose again; the current text is retained.');
    };
    entry.loading = false;
    if (entry.saving) await entry.saving.catch(() => {});
    assertCurrent();
    const value = await this.request(entry.binding, entry.research ? 'archive' : 'read', { nodeId: entry.binding.nodeId, ...(entry.research ? { research: entry.research } : { revision: entry.binding.revision }) });
    this.check(entry, value); assertCurrent();
    entry.readSequence++; entry.loading = false; entry.loaded = true; entry.guard = value.guard; entry.research = value.research; entry.value = value; entry.base = structuredClone(value.draft); entry.conflict = null; entry.error = '';
    entry.draft = choice === 'saved' ? structuredClone(value.draft) : local; entry.generation++; entry.restoreVersion++; entry.dirty = choice !== 'saved';
    this.changed(); if (entry.dirty) await this.flush(entry);
  }
  async mutate(entry, action) {
    clearTimeout(entry.timer); entry.timer = null;
    entry.deleting = true; this.changed();
    try {
      await entry.ready; if (entry.saving) await entry.saving;
      if (!entry.loaded) throw Error(entry.error || 'Load the saved conversation before changing it.');
      entry.readSequence++; entry.generation++;
      const value = await this.request(entry.binding, action, { nodeId: entry.binding.nodeId, research: entry.research, guard: entry.guard });
      if (this.closed) return;
      this.check(entry, value); entry.guard = value.guard; entry.value = value;
      if (action === 'delete') { entry.draft = blank(); entry.base = blank(); entry.dirty = false; entry.conflict = null; entry.error = ''; entry.deleted = true; entry.restoreVersion++; }
      this.changed();
    } catch (error) { entry.error = error.message; this.changed(); throw error; }
    finally { entry.deleting = false; this.changed(); }
    if (action === 'clear' && entry.dirty && !entry.error && !entry.conflict) await this.flush(entry);
  }
  archive(entry, research) { return this.request(entry.binding, 'archive', { nodeId: entry.binding.nodeId, research }); }
  forget(target) {
    for (const [id, entry] of this.entries) if (entry.binding.conversationScope === target.namespace && entry.binding.nodeId === target.nodeId && entry.research === target.research) {
      if (entry.dirty || entry.saving) throw Error('Local draft changed during deletion. Its text is retained; resolve it explicitly.');
      clearTimeout(entry.timer); entry.readSequence++; entry.forgotten = true; this.entries.delete(id); if (this.current === entry) this.current = null;
    }
    this.changed();
  }
  discardLocal(entry) {
    if (entry.saving || entry.deleting) throw Error('Wait for this draft save before discarding its local copy.');
    clearTimeout(entry.timer); entry.readSequence++; entry.generation++; entry.forgotten = true;
    this.entries.delete(key(entry.binding)); if (this.current === entry) this.current = null;
    this.changed();
  }
  get pending() { return [...this.entries.values()].some(entry => entry.dirty || entry.saving || entry.deleting); }
  dispose() { this.closed = true; this.epoch++; for (const entry of this.entries.values()) { clearTimeout(entry.timer); entry.readSequence++; } }
}
