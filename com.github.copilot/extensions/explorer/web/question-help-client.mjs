const operations = ['rephrase', 'example', 'terms'];
const same = (a, b) => !!a && !!b && a.journey === b.journey && a.nodeId === b.nodeId;

// Explanations live only in this page, for the active selected question.
export class QuestionHelpClient {
  constructor({ fetch, context, source, changed }) {
    Object.assign(this, { fetch, context, source, changed }); this.work = null; this.results = new Map(); this.selection = null;
  }
  async request(action, work) {
    const response = await this.fetch('api/question-help', { method: 'POST', keepalive: action === 'cancel',
      headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' },
      body: JSON.stringify({ action, id: work.id, journey: work.journey, nodeId: work.nodeId, operation: work.operation }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  }
  sync() {
    const current = this.context();
    if (!same(this.selection, current)) {
      this.cancel(); this.selection = current; this.results.clear(); this.changed();
    } else {
      if (this.work?.context && !sameHelpContext(this.work.context, this.source())) this.cancel();
      let cleared = false;
      for (const [operation, result] of this.results) if (!sameHelpContext(result.context, this.source())) { this.results.delete(operation); cleared = true; }
      if (cleared) this.changed();
    }
  }
  cancel() {
    const old = this.work; this.work = null; clearTimeout(this.timer);
    if (old) void this.request('cancel', old).catch(() => {});
    if (old) this.changed();
  }
  async start(operation) {
    if (!operations.includes(operation)) throw new Error('Invalid question help operation.');
    this.sync(); if (!this.selection || this.work?.status === 'pending') return;
    this.cancel();
    const work = { ...this.selection, id: globalThis.crypto.randomUUID(), operation, status: 'pending', progress: 'Preparing question help' };
    this.work = work; this.changed(); await this.receive(work, 'start');
  }
  async receive(work, action) {
    try {
      const result = await this.request(action, work);
      this.sync(); if (this.work !== work) return;
      if (result.id !== work.id || result.operation !== work.operation) throw new Error('The question help response did not match this request.');
      if (result.context !== undefined) {
        if (JSON.stringify(result.context).length > 16000 || !sameHelpContext(result.context, this.source())) throw new Error('The saved question context changed. Refresh the journey and try again.');
        work.context = result.context;
      }
      if (result.status === 'result') {
        if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 4000) throw new Error('Question help returned an invalid explanation.');
        if (!work.context) throw new Error('Question help did not identify its saved context.');
        this.results.delete(work.operation); this.results.set(work.operation, { text: result.text, context: work.context });
        work.status = 'result';
      } else if (result.status === 'pending') {
        work.progress = result.progress; this.timer = setTimeout(() => void this.receive(work, 'poll'), 300);
      } else if (result.status === 'error') throw new Error(result.error);
      else { this.cancel(); return; }
    } catch (error) {
      if (this.work !== work) return;
      work.status = 'error'; work.error = error.message;
    }
    this.changed();
  }
}
import { sameHelpContext } from './question-help-context.mjs';
