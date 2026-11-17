import { researchSettings } from './research-policy.mjs';
export class ResearchReviewClient {
  constructor({ fetch, changed }) {
    this.fetch = fetch; this.changed = changed; this.clientId = globalThis.crypto.randomUUID(); this.sequence = 0;
    this.context = null; this.value = null; this.loading = false; this.error = ''; this.abort = null;
    this.projectDraft = ''; this.projectDirty = false;
  }
  open(context) { this.close(); this.context = { ...context, settings: researchSettings(), excluded: [] }; void this.prepare(); }
  settings(value) {
    if (!this.context) return;
    this.context = { ...this.context, settings: researchSettings(value) }; void this.prepare();
  }
  async prepare(project) {
    if (!this.context) return;
    this.abort?.abort(); const abort = new AbortController(); this.abort = abort;
    const sequence = ++this.sequence, input = { action: 'prepare', ...this.context, clientId: this.clientId, sequence, ...(project ? { project } : {}) };
    this.value = null; this.error = ''; this.loading = true; this.changed();
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await this.fetch('api/research-review', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
      const value = await response.json();
      if (sequence !== this.sequence || !this.context) return;
      if (!response.ok) throw Error(value.error);
      if (value.clientId !== this.clientId || value.sequence !== sequence || value.journey !== input.journey || value.nodeId !== input.nodeId) throw Error('Research review changed. Refresh context.');
      this.value = value;
      if (project) this.projectDirty = false;
      if (this.projectDraft.trim() && !value.prepared.context.projectSources?.length) this.projectDirty = true;
    } catch (error) {
      if (sequence === this.sequence && this.context) this.error = abort.signal.aborted ? 'Context review timed out. Refresh and review before starting.' : error.message;
    } finally {
      clearTimeout(timeout);
      if (sequence === this.sequence && this.context) { this.loading = false; this.changed(); }
    }
  }
  exclude(id, excluded) {
    if (!this.context) return;
    this.context = { ...this.context, excluded: excluded ? [...new Set([...this.context.excluded, id])] : this.context.excluded.filter(value => value !== id) };
    void this.prepare();
  }
  close() {
    const context = this.context; this.sequence++; this.abort?.abort(); this.abort = null; this.context = null; this.value = null; this.loading = false;
    this.projectDraft = ''; this.projectDirty = false;
    if (context) void this.fetch('api/research-review', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' },
      body: JSON.stringify({ action: 'cancel', ...context, excluded: [], clientId: this.clientId, sequence: this.sequence }) }).catch(() => {});
  }
}
