const sections = ['purpose', 'architecture', 'stack', 'conventions', 'constraints'];
const labels = { 'file-backed': 'File-backed claim', inference: 'Inference', unknown: 'Unknown', user: 'User assertion' };
const title = text => text[0].toUpperCase() + text.slice(1);

export class ProjectBriefClient {
  constructor({ $, fetch, journey, active, scope, changed = () => {}, now = Date.now }) {
    Object.assign(this, { $, fetch, journey, active, scope, changed, now });
    this.window = this.control('state').ownerDocument.defaultView;
    this.clientId = globalThis.crypto.randomUUID(); this.registered = false; this.sequence = 0; this.generation = 0; this.boundJourney = journey();
    this.rows = []; this.error = ''; this.loading = false; this.dirty = false;
    for (const [id, action] of Object.entries({ prepare: 'prepare', start: 'start', cancel: 'cancel', save: 'edit', approve: 'approve', revoke: 'revoke', clear: 'discard' })) {
      this.control(id).addEventListener('click', () => void this.act(action));
    }
    this.control('discard-changes').addEventListener('click', () => { this.dirty = false; this.formKey = undefined; this.render(); });
    for (const id of ['add-text', 'add-section']) this.control(id).addEventListener('input', () => { this.dirty = true; this.render(); });
    $('project-mode-close').addEventListener('click', () => this.close());
    $('project-mode-dialog').addEventListener('cancel', () => this.close());
    this.render();
  }
  control(id) { return this.$(`project-brief-${id}`); }
  element(tag, text) { const node = this.window.document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
  captureId() { const scope = this.scope(); return scope?.state === 'active' ? scope.receipt?.id : undefined; }
  matches(value, input) { return value.purpose === input.purpose && value.clientId === input.clientId && value.sequence === input.sequence && value.journey === input.journey; }
  input(action, extra = {}) { return { action, purpose: 'project-brief', clientId: this.clientId, sequence: ++this.sequence, journey: this.boundJourney, ...extra }; }
  invalidate() { this.generation++; this.abort?.abort(); this.abort = null; this.loading = false; }
  uncertain(message) { this.error = message; this.uncertainState = true; this.value = { ...this.value, approved: false, token: undefined, prepared: undefined }; this.render(); }
  accept(value) {
    if (this.cancelId) {
      if (value.id === this.cancelId || value.token || value.state === 'pending') {
        this.value = { ...value, draft: this.cancelDraft, approved: false, token: undefined, prepared: undefined, state: 'cancelling' };
        this.uncertainState = true; return;
      }
      this.cancelId = null; this.cancelDraft = null; this.runId = null;
    }
    this.value = value; this.uncertainState = false;
    if (value.state !== 'pending') this.runId = null;
  }
  cancel() {
    if (!this.cancelId) { this.cancelId = this.runId ?? (this.value?.state === 'pending' ? this.value.id : null) ?? globalThis.crypto.randomUUID(); this.cancelDraft = this.value?.draft; }
    const input = this.input('cancel', { id: this.cancelId }), generation = this.generation;
    this.value = { ...this.value, approved: false, token: undefined, prepared: undefined, state: 'cancelling' }; this.uncertainState = true;
    if (!this.boundJourney) return;
    void this.fetch('api/project-brief', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) }).then(async response => {
      const value = await response.json();
      if (response.ok && this.matches(value, input) && generation === this.generation && input.sequence === this.sequence && input.clientId === this.clientId && input.journey === this.journey() && !this.paused) {
        this.accept(value); this.render();
      }
    }).catch(() => {});
  }
  close() { const preparing = this.loading && ['prepare', 'start'].includes(this.action); this.invalidate(); if (this.cancelId || preparing || this.value?.token || this.runId || this.value?.state === 'pending') this.cancel(); this.render(); }
  observe() {
    if (this.boundJourney !== this.journey()) {
      this.close(); this.boundJourney = this.journey(); this.clientId = globalThis.crypto.randomUUID(); this.registered = false; this.value = null;
      this.scopeKey = undefined; this.dirty = false; this.formKey = undefined; this.runId = this.cancelId = this.cancelDraft = null; this.error = ''; this.uncertainState = false;
    }
    this.scopeChanged();
  }
  scopeChanged() {
    const project = this.scope()?.project?.root, key = `${project ?? ''}:${this.scope()?.state ?? ''}:${this.captureId() ?? ''}`;
    if (key === this.scopeKey) return;
    this.scopeKey = key; this.invalidate(); this.uncertainState = true;
    if (project && this.value?.project?.root && project !== this.value.project.root) {
      this.dirty = false; this.formKey = undefined; this.value = null; this.cancelDraft = null;
    }
    this.value = { ...this.value, approved: false, token: undefined, prepared: undefined };
    this.render();
    if (!this.paused && this.active() && this.boundJourney) void (this.cancelId ? this.request('cancel', { id: this.cancelId }) : this.request('status'));
  }
  suspend() { this.paused = true; this.close(); this.clientId = globalThis.crypto.randomUUID(); this.registered = false; this.uncertainState = true; this.render(); }
  resume() { const wasPaused = this.paused; this.paused = false; if (wasPaused) { this.observe(); void this.request('status'); } }
  async checkStatus() {
    this.observe();
    const pending = !!this.cancelId || this.value?.state === 'pending';
    if (!this.paused && this.active() && this.boundJourney && !this.loading && (pending || this.$('project-mode-dialog').open) &&
      (this.checkedAt === undefined || this.now() - this.checkedAt >= (pending ? 1000 : 10000))) {
      this.checkedAt = this.now(); await (this.cancelId ? this.request('cancel', { id: this.cancelId }) : this.request('status'));
    }
  }
  changes() {
    const changes = { edits: [], remove: [], additions: [] };
    for (const row of this.rows) {
      if (row.remove.checked) changes.remove.push(row.claim.id);
      else if (row.input.value !== row.claim.text) changes.edits.push({ id: row.claim.id, text: row.input.value });
    }
    if (this.control('add-text').value.trim()) changes.additions.push({ section: this.control('add-section').value, text: this.control('add-text').value });
    return changes;
  }
  async act(action) {
    if (action === 'cancel') { this.invalidate(); this.cancel(); this.render(); return; }
    if (this.cancelId) return;
    const extra = {};
    if (action === 'start') { if (!this.value?.token || this.dirty) return; this.runId = globalThis.crypto.randomUUID(); Object.assign(extra, { id: this.runId, token: this.value.token }); }
    if (['edit', 'approve', 'revoke', 'discard'].includes(action)) extra.revision = this.value?.revision;
    if (['edit', 'approve'].includes(action)) extra.changes = this.changes();
    await this.request(action, extra);
  }
  async request(action, extra = {}) {
    if (this.paused || !this.active() || !this.boundJourney || this.loading) return;
    if (!this.registered) { action = 'status'; extra = {}; }
    const input = this.input(action, extra), generation = ++this.generation, open = this.$('project-mode-dialog').open;
    const current = () => generation === this.generation && input.clientId === this.clientId && input.journey === this.journey() && !this.paused && this.active() && this.$('project-mode-dialog').open === open;
    const abort = new AbortController(); this.abort = abort; this.action = action; this.loading = true; this.error = ''; this.render();
    const timeout = this.window.setTimeout(() => abort.abort(), 20000);
    try {
      const response = await this.fetch('api/project-brief', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
      const value = await response.json(); if (!current()) return; abort.signal.throwIfAborted();
      if (!response.ok) throw Error(value.error || 'Project brief request failed.');
      if (!this.matches(value, input)) throw Error('Project brief changed. Refresh before continuing.');
      if (action === 'status') this.registered = true;
      this.accept(value);
      if (['edit', 'approve', 'discard'].includes(action)) { this.dirty = false; this.formKey = undefined; }
    } catch (error) { if (current()) this.uncertain(abort.signal.aborted ? 'Project brief request timed out. Refresh to confirm its state.' : error.message); }
    finally { this.window.clearTimeout(timeout); if (current()) { this.loading = false; this.abort = null; this.render(); } }
  }
  render() {
    const value = this.value, draft = value?.draft, pending = value?.state === 'pending', capture = this.captureId();
    const current = !!capture && !!value?.captureAvailable && !this.uncertainState && (!draft || draft.captureId === capture);
    const key = JSON.stringify(draft ?? null);
    if (!this.dirty && key !== this.formKey) { this.formKey = key; this.formDraft = draft; this.renderClaims(draft); }
    const staleEdits = this.dirty && (key !== this.formKey || !current);
    const editable = current && !!draft && !value.approved && !pending && !this.loading && !staleEdits;
    this.control('state').textContent = this.cancelId ? 'Cancellation is not confirmed. Explorer will retry while this canvas is active; results from this run cannot be approved.' : staleEdits ? 'Your unsaved edits are retained below. The scope or brief changed; discard local changes before reviewing the current brief.' : this.error || value?.error || (this.loading ? 'Checking project brief…' : pending ? value.progress || 'Generating project brief…' : value?.approved && current ? 'Approved for this project and captured files. Ordinary questions are unchanged in this version.' : draft ? 'Review each claim. Changes you make become user assertions. Approve when the brief matches your project.' : current ? 'Captured files are ready. Review the exact request before generating a project brief.' : 'Read the reviewed project files above to prepare a brief.');
    this.control('prepare').disabled = this.loading || pending || !current || this.dirty;
    this.control('start').disabled = this.loading || pending || !current || !value?.token || this.dirty;
    this.control('cancel').disabled = !this.cancelId && !pending && !value?.token && !this.runId && !this.loading;
    this.control('save').disabled = !editable || !this.dirty;
    this.control('approve').disabled = !editable;
    this.control('revoke').disabled = !!this.cancelId || this.loading || !draft || !value?.approved && !this.uncertainState;
    this.control('clear').disabled = !!this.cancelId || this.loading || pending || !draft && !value?.corrections?.length || this.dirty;
    this.control('discard-changes').disabled = !this.dirty;
    this.control('review').hidden = !value?.prepared;
    this.control('input').textContent = value?.prepared ? `${value.prepared.instructions}\n\n${value.prepared.prompt}` : '';
    this.control('size').textContent = value?.prepared ? `${value.prepared.bytes} / ${value.prepared.limit} bytes. Uses the selected chat model in an isolated helper with no tools.` : '';
    this.control('editing').hidden = !this.formDraft;
    for (const row of this.rows) { row.input.readOnly = !editable; row.remove.disabled = !editable; }
    this.control('add-text').readOnly = !editable; this.control('add-section').disabled = !editable;
    this.control('corrections').textContent = !draft && value?.corrections?.length ? `Saved user assertions retained for the next brief:\n${value.corrections.map(c => `${title(c.section)}: ${c.text}`).join('\n')}` : '';
    this.changed();
  }
  renderClaims(draft) {
    this.rows = []; this.control('claims').replaceChildren(); this.control('add-text').value = '';
    if (!draft) return;
    for (const section of sections) {
      const group = this.element('section'); group.append(this.element('h4', title(section)));
      if (!draft.sections[section].length) group.append(this.element('p', 'No claims retained.'));
      for (const claim of draft.sections[section]) {
        const card = this.element('div'); card.className = 'project-brief-claim';
        const input = this.element('textarea'), label = this.element('label', `${title(section)} — ${labels[claim.kind]}`);
        input.id = `brief-claim-${claim.id}`; input.value = claim.text; input.maxLength = 500; input.rows = 3; label.htmlFor = input.id;
        const remove = this.element('input'), removeLabel = this.element('label'); remove.type = 'checkbox'; removeLabel.append(remove, this.element('span', 'Remove this claim'));
        card.append(label, input, removeLabel);
        if (claim.sources.length) {
          const details = this.element('details'); details.append(this.element('summary', 'Captured evidence'));
          for (const ref of claim.sources) {
            const source = draft.sources.find(source => source.id === ref.id);
            details.append(this.element('p', source?.name ?? 'Captured source'), this.element('p', `File SHA-256: ${source?.fingerprint ?? ''}`), this.element('p', `Excerpt SHA-256: ${source?.excerptFingerprint ?? ''}`), this.element('blockquote', ref.quote));
          }
          card.append(details);
        }
        for (const control of [input, remove]) control.addEventListener('input', () => { this.dirty = true; this.render(); });
        this.rows.push({ claim, input, remove }); group.append(card);
      }
      this.control('claims').append(group);
    }
  }
}
