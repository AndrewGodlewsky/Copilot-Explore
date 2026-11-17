import { effectiveAnswerState, answerStateError } from './answer-state.mjs';

const baseOf = node => ({ question: node.question, answer: node.answer, answerState: effectiveAnswerState(node) });
const recordState = record => effectiveAnswerState({ answer: record.text, answerState: record.answerState });
const sameBase = (a, b) => a.question === b.question && a.answer === b.answer && a.answerState === b.answerState;

// Draft text is deliberately owned separately from the committed document.
export class DraftClient {
  constructor({ fetch, drafts, changed, restored }) {
    Object.assign(this, { fetch, drafts, changed, restored });
    this.entries = new Map(); this.epoch = 0; this.queue = Promise.resolve(); this.ready = Promise.resolve();
  }
  reset(journey, nodes) {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.epoch++; this.journey = journey; this.entries.clear(); this.drafts.clear(); this.loadError = '';
    for (const node of nodes) this.entries.set(node.id, { base: baseOf(node), answerState: effectiveAnswerState(node), deliberate: false, generation: 0, edits: 0, revision: 0, dirty: false, status: '', conflict: null });
    this.ready = this.recover();
  }
  recover() {
    const epoch = this.epoch, bases = new Map([...this.entries].map(([id, entry]) => [id, entry.base]));
    return this.journey ? this.read().then(result => {
      if (epoch !== this.epoch) return;
      this.loadError = '';
      for (const record of result.entries) {
        let entry = this.entries.get(record.nodeId);
        if (!entry) { entry = { base: { question: '', answer: '' }, generation: 0, edits: 0, dirty: false, status: '', orphaned: true }; this.entries.set(record.nodeId, entry); }
        entry.revision = record.revision;
        if (record.text === null) continue;
        if (record.stale || entry.generation || entry.orphaned || !sameBase(entry.base, bases.get(record.nodeId))) { entry.conflict = record; entry.status = 'Review recovered draft'; }
        else { entry.answerState = recordState(record); entry.deliberate = record.stateSelected; this.drafts.set(record.nodeId, record.text); entry.status = 'Draft saved locally'; this.restored(record.nodeId, record.text); }
      }
      this.changed();
    }).catch(error => {
      if (epoch !== this.epoch) return;
      this.loadError = error.message; this.changed();
    }) : Promise.resolve();
  }
  async retry() {
    await this.ready;
    if (this.loadError) { this.ready = this.recover(); await this.ready; }
    return this.flush();
  }
  async read() { return this.request(`api/drafts?journey=${encodeURIComponent(this.journey)}`); }
  async request(path, value, keepalive = false) {
    const body = value === undefined ? undefined : JSON.stringify(value);
    const response = await this.fetch(path, value === undefined ? undefined : { method: 'POST', keepalive: keepalive && new TextEncoder().encode(body).length < 60000, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  updateNodes(nodes) {
    const ids = new Set(nodes.map(node => node.id));
    for (const [id, entry] of this.entries) {
      entry.orphaned = !ids.has(id);
      if (entry.orphaned && this.drafts.has(id)) {
        entry.conflict ??= { nodeId: id, text: this.drafts.get(id), answerState: entry.answerState, stateSelected: entry.deliberate, revision: entry.revision, stale: true, orphaned: true };
        entry.status = 'Review recovered draft';
      }
    }
    for (const node of nodes) {
      const entry = this.entries.get(node.id);
      if (!entry) this.entries.set(node.id, { base: baseOf(node), answerState: effectiveAnswerState(node), deliberate: false, generation: 0, edits: 0, revision: 0, dirty: false, status: '', conflict: null });
      // Keep the original base while there is editor text, including during answer saves.
      else if (!this.drafts.has(node.id) && !entry.conflict) { entry.base = baseOf(node); entry.answerState = effectiveAnswerState(node); entry.deliberate = false; }
      else if (!this.savingAnswer && !sameBase(entry.base, baseOf(node)) && this.drafts.has(node.id)) {
        entry.conflict ??= { nodeId: node.id, text: this.drafts.get(node.id), answerState: entry.answerState, stateSelected: entry.deliberate, revision: entry.revision, stale: true };
        entry.status = 'Review recovered draft';
      }
    }
  }
  touch(id) { const entry = this.entries.get(id); if (entry) entry.generation++; }
  state(id) { return this.entries.get(id)?.answerState ?? 'unanswered'; }
  selectState(id, state, text) {
    const entry = this.entries.get(id); if (!entry) return;
    entry.answerState = state; entry.deliberate = true; this.edit(id, text);
  }
  edit(id, text) {
    const entry = this.entries.get(id); if (!entry) return;
    if (!entry.deliberate && answerStateError(text, entry.answerState)) entry.answerState = text.trim() ? 'tentative' : 'unanswered';
    this.drafts.set(id, text); entry.generation++; entry.edits++; entry.dirty = true;
    entry.status = entry.conflict ? 'Review recovered draft' : 'Saving draft…';
    clearTimeout(entry.timer); entry.timer = setTimeout(() => { void this.flush(false, id).catch(() => {}); }, 500);
    this.changed();
  }
  pending() { return !!this.loadError || [...this.entries.values()].some(e => e.dirty || e.saving); }
  uncommitted() { return [...this.entries].some(([id, e]) => e.conflict?.text != null || this.drafts.has(id)); }
  async flush(keepalive = false, onlyId = null) {
    const epoch = this.epoch;
    const work = this.queue.then(async () => {
      await this.ready;
      if (epoch !== this.epoch) return;
      if (this.loadError && [...this.entries.values()].some(e => e.dirty)) throw new Error(this.loadError);
      let failure;
      for (const [id, entry] of this.entries) {
        if (onlyId !== null && id !== onlyId) continue;
        clearTimeout(entry.timer);
        while (entry.dirty) {
          if (entry.conflict || entry.paused) { failure ??= new Error('Review the recovered draft before leaving this journey.'); break; }
          const generation = entry.edits, text = this.drafts.get(id), answerState = entry.answerState;
          entry.saving = true; entry.status = 'Saving draft…'; this.changed();
          try {
            const result = await this.request('api/drafts', { journey: this.journey, nodeId: id, base: entry.base, text, answerState, stateSelected: entry.deliberate, revision: entry.revision }, keepalive);
            if (epoch !== this.epoch) return;
            entry.revision = result.revision; entry.dirty = generation !== entry.edits;
            entry.status = entry.dirty ? 'Saving draft…' : 'Draft saved locally'; entry.error = '';
          } catch (error) {
            if (epoch !== this.epoch) return;
            entry.status = 'Draft could not be saved'; entry.error = error.message;
            // Read without overwriting either editor text or the other canvas's version.
            try {
              const result = await this.read(), remote = result.entries.find(r => r.nodeId === id);
              if (epoch === this.epoch && remote && remote.revision !== entry.revision) entry.conflict = remote;
            } catch { /* The error remains visible; the in-memory text stays intact. */ }
            failure ??= error; break;
          } finally { entry.saving = false; if (epoch === this.epoch) this.changed(); }
        }
      }
      if (failure) throw failure;
    });
    this.queue = work.catch(() => {}); return work;
  }
  discardUnsaved(id, node) {
    const entry = this.entries.get(id), epoch = this.epoch, edits = entry?.edits;
    const work = this.queue.then(async () => {
      await this.ready;
      if (!entry || epoch !== this.epoch) return;
      if (this.savingAnswer || (!entry.error && !this.loadError)) throw new Error('Use Discard draft to clear a saved draft.');
      try {
        const result = await this.read(), remote = result.entries.find(r => r.nodeId === id);
        if (epoch !== this.epoch || entry.edits !== edits) return;
        entry.revision = remote?.revision ?? 0; entry.conflict = remote?.text != null ? remote : null;
      } catch (error) { this.loadError = error.message; }
      if (epoch !== this.epoch || entry.edits !== edits) return;
      clearTimeout(entry.timer); entry.generation++; entry.dirty = false; entry.error = '';
      this.drafts.delete(id); entry.answerState = effectiveAnswerState(node); entry.deliberate = false; entry.status = entry.conflict ? 'Review recovered draft' : '';
      this.restored(id, node.answer); this.changed();
    });
    this.queue = work.catch(() => {}); return work;
  }
  choose(id, choice, node) {
    const entry = this.entries.get(id), epoch = this.epoch, generation = entry?.edits;
    const work = this.queue.then(async () => {
      await this.ready;
      if (!entry || epoch !== this.epoch) return;
      if (this.savingAnswer) throw new Error('Wait for the answer save before discarding or recovering a draft.');
      if (this.loadError) throw new Error(this.loadError);
      clearTimeout(entry.timer);
      const remote = entry.conflict;
      const revision = remote?.revision ?? entry.revision;
      const text = choice === 'discard' ? null : choice === 'recover' ? remote?.text : this.drafts.get(id) ?? node?.answer ?? '';
      if (choice !== 'discard' && typeof text !== 'string') throw new Error('There is no saved draft to recover.');
      const base = node ? baseOf(node) : entry.base;
      const answerState = choice === 'discard' ? base.answerState ?? 'unanswered' : choice === 'recover' ? recordState(remote) : entry.answerState;
      const stateSelected = choice === 'discard' ? false : choice === 'recover' ? remote.stateSelected : entry.deliberate;
      try {
        const result = await this.request('api/drafts', { journey: this.journey, nodeId: id, revision, text, answerState, stateSelected, base });
        if (epoch !== this.epoch) return;
        entry.revision = result.revision; entry.base = base; entry.conflict = null; entry.error = '';
        if (generation === entry.edits) {
          entry.answerState = answerState; entry.deliberate = stateSelected; entry.dirty = false; text === null ? this.drafts.delete(id) : this.drafts.set(id, text);
          entry.status = text === null ? '' : 'Draft saved locally'; this.restored(id, text ?? node?.answer ?? '');
        } else { entry.dirty = true; entry.status = 'Saving draft…'; }
        this.changed();
        if (entry.dirty) entry.timer = setTimeout(() => { void this.flush(false, id).catch(() => {}); }, 500);
      } catch (error) {
        entry.status = 'Draft could not be saved'; entry.error = error.message;
        try { const result = await this.read(), remote = result.entries.find(r => r.nodeId === id); if (epoch === this.epoch && remote && remote.revision !== revision) entry.conflict = remote; } catch { /* Keep both known versions. */ }
        this.changed(); throw error;
      }
    });
    this.queue = work.catch(() => {}); return work;
  }
  async save(id, operation, currentNode) {
    const entry = this.entries.get(id), value = this.drafts.get(id) ?? currentNode().answer, answerState = entry.answerState, generation = entry.edits;
    if (this.savingAnswer) return null;
    this.savingAnswer = true;
    let result;
    try {
      await this.flush(false, id);
      if (entry.conflict) throw new Error('Review the recovered draft before saving an answer.');
      entry.paused = true;
      result = await operation(value, entry.revision, this.journey, answerState);
      if (!result) return null;
      const records = await this.read(), remote = records.entries.find(r => r.nodeId === id);
      const ownNewerText = entry.edits !== generation && remote?.revision === entry.revision && remote?.text === this.drafts.get(id) && recordState(remote) === entry.answerState;
      entry.revision = remote?.revision ?? 0;
      entry.base = baseOf(currentNode()); entry.conflict = remote?.text != null && !ownNewerText ? remote : null;
      if (entry.edits === generation) { this.drafts.delete(id); entry.answerState = effectiveAnswerState(currentNode()); entry.deliberate = false; entry.dirty = false; this.restored(id, currentNode().answer); }
      else entry.dirty = true;
      entry.status = entry.conflict ? 'Review recovered draft' : entry.dirty ? 'Saving draft…' : '';
      this.changed(); return result;
    } catch (error) { entry.status = 'Draft could not be saved'; entry.error = error.message; this.changed(); throw error; }
    finally { this.savingAnswer = false; entry.paused = false; if (result && entry.dirty && !entry.conflict) void this.flush(false, id).catch(() => {}); }
  }
}
