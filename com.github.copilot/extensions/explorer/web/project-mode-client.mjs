export class ProjectModeClient {
  constructor({ $, fetch, journey, active, now = Date.now, onChange = () => {}, briefState = () => null }) {
    Object.assign(this, { $, fetch, journey, active, now, onChange, briefState }); this.clientId = globalThis.crypto.randomUUID(); this.sequence = 0; this.generation = 0;
    this.value = null; this.loading = false; this.error = ''; this.boundJourney = journey();
    this.window = this.control('dialog').ownerDocument.defaultView;
    this.control('open').addEventListener('click', () => this.open());
    this.control('manage').addEventListener('click', () => this.open());
    this.control('close').addEventListener('click', () => this.close());
    this.control('dialog').addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.control('paths').addEventListener('input', () => this.edit());
    this.control('exclusions').addEventListener('input', () => { this.inventory = null; this.edit(); });
    this.control('discover').addEventListener('click', () => { this.inventory = null; void this.request('discover', { exclusions: this.lines('exclusions') }); });
    this.control('prepare').addEventListener('click', () => void this.request('prepare', { paths: this.lines('paths'), exclusions: this.lines('exclusions') }));
    this.control('approve').addEventListener('click', () => { if (this.value?.token) void this.request('approve', { token: this.value.token }); });
    this.control('read').addEventListener('click', () => { if (this.value?.readToken) void this.request('read', { token: this.value.readToken }); });
    this.control('disable').addEventListener('click', () => { this.inventory = null; void this.request('disable'); });
    this.control('refresh').addEventListener('click', () => void this.request('status'));
    this.render();
  }
  control(id) { return this.$(`project-mode-${id}`); }
  lines(id) { return this.control(id).value.split(/\r?\n/).filter(line => line.trim()); }
  edit() { this.invalidate(); this.error = 'Scope changed. Review the selected files again.'; this.notify('disable'); this.render(); }
  accept(value, action) {
    if (['unavailable', 'stale'].includes(value.state) || value.project && this.inventory?.root !== value.project.root) this.inventory = null;
    if (value.inventory) this.inventory = { ...value.inventory, root: value.project?.root };
    this.value = value;
    if (['off', 'unavailable', 'stale'].includes(value.state) || action === 'prepare' && value.state === 'review') this.revoking = false;
    if (this.revoking) this.uncertain();
    this.onChange();
  }
  invalidate() { this.generation++; this.abort?.abort(); this.abort = null; this.loading = false; }
  input(action, extra) { return { action, journey: this.boundJourney, clientId: this.clientId, sequence: ++this.sequence, purpose: 'project-questions', ...extra }; }
  uncertain() { this.value = { ...this.value, state: 'uncertain', token: undefined, readToken: undefined, receipt: undefined, message: this.revoking ? 'Scope changes are not confirmed. Turn off or review the edited scope.' : 'Project scope status is uncertain. Refresh or turn it off.' }; this.onChange(); }
  matches(value, input) { return value.clientId === input.clientId && value.sequence === input.sequence && value.journey === input.journey && value.purpose === input.purpose; }
  notify(action) {
    if (!this.boundJourney) return;
    const input = this.input(action), generation = this.generation;
    if (action === 'disable') { this.revoking = true; this.uncertain(); }
    void this.fetch('api/project-mode', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) }).then(async response => {
      const value = await response.json();
      if (action === 'disable' && response.ok && this.matches(value, input) && generation === this.generation && input.sequence === this.sequence &&
        input.clientId === this.clientId && input.journey === this.journey() && !this.paused) { this.accept(value, action); this.render(); }
    }).catch(() => {});
  }
  observe() {
    if (this.boundJourney !== this.journey()) {
      this.close(false); this.value = null; this.inventory = null; this.revoking = false; this.boundJourney = this.journey(); this.control('paths').value = ''; this.control('exclusions').value = ''; this.error = '';
    }
    this.render();
  }
  open() {
    if (!this.active() || !this.journey()) return;
    this.observe(); if (this.$('navigation-dialog').open) this.$('navigation-dialog').close(); this.control('dialog').showModal();
    this.control('close').focus(); void this.request('status');
  }
  close(focus = true) {
    const pendingApproval = this.loading && ['approve', 'read', 'discover'].includes(this.action);
    this.invalidate(); this.notify(pendingApproval ? 'disable' : 'cancel'); if (this.value?.state === 'review') this.value = null;
    if (this.control('dialog').open) this.control('dialog').close(); this.render();
    if (focus && this.active()) this.$('navigation-open').focus({ preventScroll: true });
  }
  suspend() {
    this.paused = true; this.inventory = null; this.invalidate(); this.notify('disable');
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
    if (this.revoking && ['approve', 'read'].includes(action)) return;
    if (action === 'disable') { this.revoking = true; this.uncertain(); }
    const input = this.input(action, extra), generation = ++this.generation, open = this.control('dialog').open;
    const current = () => generation === this.generation && this.active() && this.boundJourney === this.journey() && this.control('dialog').open === open;
    const abort = new AbortController(); this.abort = abort; this.action = action; this.loading = true; this.error = ''; this.render();
    const timeout = this.window.setTimeout(() => abort.abort(), 20000);
    try {
      const response = await this.fetch('api/project-mode', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
      const value = await response.json(); if (!current()) return; abort.signal.throwIfAborted();
      if (!response.ok) throw Error(value.error || 'Project scope request failed.');
      if (!this.matches(value, input)) throw Error('Project scope changed. Refresh before continuing.');
      this.accept(value, action);
      if (!this.control('paths').value && value.scope) this.control('paths').value = value.scope.files.map(file => file.name).join('\n');
    } catch (error) {
      if (current()) { this.error = abort.signal.aborted ? 'Project scope timed out. Refresh before continuing.' : error.message; this.uncertain(); }
    } finally {
      this.window.clearTimeout(timeout);
      if (current()) { this.loading = false; this.abort = null; this.render(); if (action === 'read' && this.value?.receipt) this.control('receipt-title').focus(); }
    }
  }
  render() {
    const value = this.value, active = value?.state === 'active', uncertain = value?.state === 'uncertain', project = value?.project;
    const brief = this.briefState(), approved = active && value.receipt && brief?.approved && brief.draft?.captureId === value.receipt.id;
    const briefStatus = approved ? 'project brief approved; ordinary questions unchanged.' : 'scope ready; project brief required.';
    this.control('open').disabled = !this.active() || !this.journey();
    this.control('settings-status').textContent = uncertain ? 'Project scope status is uncertain. Refresh or turn it off.' : active ? `${project.name}: ${briefStatus}` : 'Off. Ordinary questions use no project files.';
    this.control('indicator').hidden = this.paused || !active && !uncertain;
    this.control('indicator-text').textContent = uncertain ? 'Project scope status is uncertain. Open scope settings to refresh or turn it off.' : active ? `${project.name}: ${briefStatus}` : '';
    this.control('project').textContent = project?.root ?? 'Refresh to check the current local project.';
    this.control('state').textContent = this.error || (this.loading ? 'Checking project scope…' : value?.message || (value?.state === 'review' ? 'Review this exact scope, then enable it.' : 'Off. Select relative files and review their scope.'));
    this.control('scope').textContent = value?.scope ? value.scope.files.map(file => `${file.name} — ${file.bytes} bytes`).join('\n') + `\nTotal: ${value.scope.bytes} bytes\nExcluded paths: ${(value.scope.exclusions ?? []).join(', ') || 'none added'}` : '';
    this.control('approve').disabled = this.loading || !value?.token;
    this.control('prepare').disabled = this.loading || value?.state === 'unavailable';
    this.control('refresh').disabled = this.loading;
    this.control('discover').disabled = this.loading || value?.state === 'unavailable';
    this.control('read').disabled = this.loading || !value?.readToken;
    this.control('disable').disabled = this.loading || !active && !uncertain && value?.state !== 'review';
    this.renderInventory(); this.renderReceipt();
  }
  element(tag, text) { const node = this.window.document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
  renderInventory() {
    const inventory = this.inventory, signature = JSON.stringify(inventory ?? null), selected = this.lines('paths');
    if (signature !== this.inventorySignature) {
      this.inventorySignature = signature; this.control('candidates').replaceChildren(); this.control('skipped').replaceChildren();
      for (const file of inventory?.candidates ?? []) {
        const label = this.element('label'), box = this.element('input'); box.type = 'checkbox'; box.value = file.name;
        label.append(box, this.element('span', `${file.name} — ${file.bytes} bytes. ${file.reason}`)); this.control('candidates').append(label);
        box.addEventListener('change', () => {
          const paths = this.lines('paths');
          if (box.checked && !paths.includes(file.name) && paths.length >= 5) { box.checked = false; this.error = 'Select up to 5 files. Remove a selection first.'; this.render(); return; }
          this.control('paths').value = (box.checked ? [...new Set([...paths, file.name])] : paths.filter(name => name !== file.name)).join('\n'); this.edit();
        });
      }
      for (const entry of inventory?.skipped ?? []) this.control('skipped').append(this.element('li', `${entry.name || 'Project folder'}: ${entry.reason}`));
    }
    for (const box of this.control('candidates').querySelectorAll('input')) { box.checked = selected.includes(box.value); box.disabled = this.loading; }
    this.control('skips').hidden = !inventory?.skipped?.length;
    this.control('discovery-summary').textContent = inventory ? `Last discovered in ${inventory.root}: ${inventory.candidates.length} candidates, ${inventory.examined} entries checked across ${inventory.directories} folders. ${selected.length}/5 selected. ${inventory.truncated ? 'Partial results: a discovery limit was reached. Add a relative path manually if needed.' : 'Choose files to review; nothing is selected automatically.'}` : '';
  }
  renderReceipt() {
    const receipt = this.value?.receipt; this.control('capture').hidden = !receipt;
    if (receipt?.id === this.receiptId) return;
    this.receiptId = receipt?.id; this.control('receipt').replaceChildren();
    if (!receipt) return;
    this.control('receipt').append(this.element('p', `Captured locally: ${receipt.capturedAt}`));
    for (const file of receipt.sources) {
      const details = this.element('details');
      details.append(this.element('summary', `${file.name} — ${file.excerptBytes} of ${file.bytes} bytes${file.truncated ? ' (excerpt truncated)' : ''}`), this.element('p', `File SHA-256: ${file.fingerprint}`), this.element('p', `Excerpt SHA-256: ${file.excerptFingerprint}`));
      const excerpt = this.element('pre', file.excerpt); excerpt.tabIndex = 0; details.append(excerpt); this.control('receipt').append(details);
    }
  }
}
