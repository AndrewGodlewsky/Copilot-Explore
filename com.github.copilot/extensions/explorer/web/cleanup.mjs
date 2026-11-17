const same = (a, b) => !!a && !!b && ['journey', 'nodeId', 'mutation', 'text'].every(key => a[key] === b[key]);

// One bounded, transient review/undo. Draft persistence remains the editor's responsibility.
export class CleanupClient {
  constructor({ fetch, context, edit, changed }) {
    Object.assign(this, { fetch, context, edit, changed }); this.work = null; this.queue = Promise.resolve();
  }
  request(action, work, text) {
    const { id, journey, nodeId, mutation } = work;
    const task = this.queue.then(async () => {
      const response = await this.fetch('api/cleanup', { method: 'POST', keepalive: action === 'cancel', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' },
        body: JSON.stringify({ action, id, journey, nodeId, mutation, ...(text !== undefined ? { text } : {}) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
    });
    this.queue = task.catch(() => {}); return task;
  }
  sync() { if (this.work && !same(this.work, this.context())) this.cancel(); }
  cancel() {
    const old = this.work; this.work = null; clearTimeout(this.timer);
    if (old) { void this.request('cancel', old).catch(() => {}); this.changed(); }
  }
  async start() {
    this.cancel(); const captured = this.context();
    if (!captured || !captured.text.trim() || captured.text.length > 20000) return;
    const work = { ...captured, id: globalThis.crypto.randomUUID(), original: captured.text, status: 'pending', progress: 'Preparing answer cleanup' };
    this.work = work; this.changed();
    await this.receive(work, 'start');
  }
  async receive(work, action) {
    try {
      const result = await this.request(action, work, action === 'start' ? work.original : undefined);
      this.sync(); if (this.work !== work) return;
      if (result.id !== work.id) throw new Error('The cleanup response did not match this request. Try again.');
      if (result.status === 'proposal') {
        if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 20000) throw new Error('The cleanup proposal was invalid. Your draft is unchanged.');
        work.proposed = result.text; work.status = 'proposal';
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
  apply() {
    this.sync(); const work = this.work; if (work?.status !== 'proposal') return;
    this.cancel(); this.edit(work.proposed);
    this.work = { ...this.context(), id: work.id, original: work.original, status: 'undo' }; this.changed();
  }
  undo() {
    this.sync(); const work = this.work; if (work?.status !== 'undo') return;
    this.cancel(); this.edit(work.original); this.changed();
  }
}
