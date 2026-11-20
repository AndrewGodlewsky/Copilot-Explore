export class ProjectModeClient {
  constructor({ $, fetch, journey, active, now = Date.now }) {
    Object.assign(this, { $, fetch, journey, active, now }); this.clientId = globalThis.crypto.randomUUID(); this.sequence = 0; this.generation = 0;
    this.value = null; this.loading = false; this.error = ''; this.boundJourney = journey();
    this.window = this.control('dialog').ownerDocument.defaultView;
    this.control('open').addEventListener('click', () => this.open());
    this.control('manage').addEventListener('click', () => this.open());
    this.control('close').addEventListener('click', () => this.close());
    this.control('dialog').addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.control('paths').addEventListener('input', () => {
      this.invalidate(); this.error = 'Scope changed. Review the selected files again.';
      this.notify('disable'); this.render();
    });
    this.control('prepare').addEventListener('click', () => void this.request('prepare', { paths: this.control('paths').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) }));
    this.control('approve').addEventListener('click', () => { if (this.value?.token) void this.request('approve', { token: this.value.token }); });
    this.control('disable').addEventListener('click', () => void this.request('disable'));
    this.control('refresh').addEventListener('click', () => void this.request('status'));
    this.render();
  }
  control(id) { return this.$(`project-mode-${id}`); }
  invalidate() { this.generation++; this.abort?.abort(); this.abort = null; this.loading = false; }
  input(action, extra) { return { action, journey: this.boundJourney, clientId: this.clientId, sequence: ++this.sequence, purpose: 'project-questions', ...extra }; }
  uncertain() { this.value = { ...this.value, state: 'uncertain', token: undefined, message: 'Project scope status is uncertain. Refresh or turn it off.' }; }
  matches(value, input) { return value.clientId === input.clientId && value.sequence === input.sequence && value.journey === input.journey && value.purpose === input.purpose; }
  notify(action) {
    if (!this.boundJourney) return;
    const input = this.input(action), generation = this.generation;
    if (action === 'disable') this.uncertain();
    void this.fetch('api/project-mode', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) }).then(async response => {
      const value = await response.json();
      if (action === 'disable' && response.ok && this.matches(value, input) && generation === this.generation && input.sequence === this.sequence &&
        input.clientId === this.clientId && input.journey === this.journey() && !this.paused) { this.value = value; this.render(); }
    }).catch(() => {});
  }
  observe() {
    if (this.boundJourney !== this.journey()) {
      this.close(false); this.value = null; this.boundJourney = this.journey(); this.control('paths').value = ''; this.error = '';
    }
    this.render();
  }
  open() {
    if (!this.active() || !this.journey()) return;
    this.observe(); if (this.$('navigation-dialog').open) this.$('navigation-dialog').close(); this.control('dialog').showModal();
    this.control('close').focus(); void this.request('status');
  }
  close(focus = true) {
    const pendingApproval = this.loading && this.action === 'approve';
    this.invalidate(); this.notify(pendingApproval ? 'disable' : 'cancel'); if (this.value?.state === 'review') this.value = null;
    if (this.control('dialog').open) this.control('dialog').close(); this.render();
    if (focus && this.active()) this.$('navigation-open').focus({ preventScroll: true });
  }
  suspend() {
    this.paused = true; this.invalidate(); this.notify('disable');
    if (this.control('dialog').open) this.control('dialog').close(); this.clientId = globalThis.crypto.randomUUID(); this.render();
  }
  resume() {
    const wasPaused = this.paused; this.paused = false;
    if (wasPaused) { this.observe(); void this.request('status'); }
  }
  async checkStatus() {
    this.observe();
    if (!this.paused && this.active() && ['active', 'uncertain'].includes(this.value?.state) && !this.loading && !this.control('dialog').open &&
      (this.checkedAt === undefined || this.now() - this.checkedAt >= 10000)) { this.checkedAt = this.now(); await this.request('status'); }
  }
  async request(action, extra = {}) {
    if (this.paused || !this.active() || !this.boundJourney || this.loading) return;
    const input = this.input(action, extra), generation = ++this.generation, open = this.control('dialog').open;
    const current = () => generation === this.generation && this.active() && this.boundJourney === this.journey() && this.control('dialog').open === open;
    const abort = new AbortController(); this.abort = abort; this.action = action; this.loading = true; this.error = ''; this.render();
    const timeout = this.window.setTimeout(() => abort.abort(), 20000);
    try {
      const response = await this.fetch('api/project-mode', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
      const value = await response.json(); if (!current()) return; abort.signal.throwIfAborted();
      if (!response.ok) throw Error(value.error || 'Project scope request failed.');
      if (!this.matches(value, input)) throw Error('Project scope changed. Refresh before continuing.');
      this.value = value;
      if (!this.control('paths').value && value.scope) this.control('paths').value = value.scope.files.map(file => file.name).join('\n');
    } catch (error) {
      if (current()) { this.error = abort.signal.aborted ? 'Project scope timed out. Refresh before continuing.' : error.message; this.uncertain(); }
    } finally {
      this.window.clearTimeout(timeout);
      if (current()) { this.loading = false; this.abort = null; this.render(); }
    }
  }
  render() {
    const value = this.value, active = value?.state === 'active', uncertain = value?.state === 'uncertain', project = value?.project;
    this.control('open').disabled = !this.active() || !this.journey();
    this.control('settings-status').textContent = uncertain ? 'Project scope status is uncertain. Refresh or turn it off.' : active ? `${project.name}: scope ready; project brief required.` : 'Off. Ordinary questions use no project files.';
    this.control('indicator').hidden = this.paused || !active && !uncertain;
    this.control('indicator-text').textContent = uncertain ? 'Project scope status is uncertain. Open scope settings to refresh or turn it off.' : active ? `${project.name}: scope ready for project-aware questions; project brief required.` : '';
    this.control('project').textContent = project?.root ?? 'Refresh to check the current local project.';
    this.control('state').textContent = this.error || (this.loading ? 'Checking project scope…' : value?.message || (value?.state === 'review' ? 'Review this exact scope, then enable it.' : 'Off. Select relative files and review their scope.'));
    this.control('scope').textContent = value?.scope ? value.scope.files.map(file => `${file.name} — ${file.bytes} bytes`).join('\n') + `\nTotal: ${value.scope.bytes} bytes` : '';
    this.control('approve').disabled = this.loading || !value?.token;
    this.control('prepare').disabled = this.loading || value?.state === 'unavailable';
    this.control('refresh').disabled = this.loading;
    this.control('disable').disabled = this.loading || !active && !uncertain && value?.state !== 'review';
  }
}
