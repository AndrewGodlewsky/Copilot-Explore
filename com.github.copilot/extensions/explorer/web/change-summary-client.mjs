const limit = 2 * 1024 * 1024;
const binding = state => ({ journey: state.activeKey ?? state.document?.id ?? null, revision: state.document?.revision ?? null,
  key: JSON.stringify([state.activeKey, state.document?.id, state.document?.rootId, state.document?.createdAt, state.document?.revision, state.storage, !!state.projectChange]) });
const byteLength = text => new TextEncoder().encode(text).length;

/** Read-only source checks; edited Markdown stays in this canvas until explicit reuse. */
export class ChangeSummaryClient {
  constructor({ $, state, active, canAct, fetch, copyText, downloadText }) {
    Object.assign(this, { $, state, active, canAct, fetch, copyText, downloadText });
    this.epoch = 0; this.editEpoch = 0; this.window = this.control('dialog').ownerDocument.defaultView;
    this.control('open').addEventListener('click', () => void this.open());
    this.control('close').addEventListener('click', () => this.close());
    this.control('dialog').addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.control('dialog').addEventListener('close', () => { if (!this.control('dialog').open) this.close(false); });
    this.control('refresh').addEventListener('click', () => void this.refresh());
    this.control('generate').addEventListener('click', () => void this.generate());
    for (const name of ['copy', 'download']) this.control(name).addEventListener('click', () => void this.reuse(name));
    for (const name of ['mode', 'before', 'after', 'ref']) this.control(name).addEventListener(name === 'ref' ? 'input' : 'change', () => this.invalidate('Selection changed. Generate a new preview; edited text is retained.'));
    for (const event of ['input', 'compositionstart']) this.control('text').addEventListener(event, () => { this.editEpoch++; this.controls(); });
    this.update();
  }
  control(name) { return this.$(`change-summary-${name}`); }
  available() { return this.active() && this.canAct() && !!this.state().document && !this.state().projectChange; }
  stop() { this.epoch++; this.flight?.abort(); this.flight = null; this.reusing = false; this.window.clearTimeout(this.expiry); }
  cancel() {
    const p = this.preview; this.preview = null;
    if (p) void this.fetch('api/change-summary', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'cancel', journey: p.journey, revision: p.revision, token: p.token }) }).catch(() => {});
  }
  invalidate(message) { this.stop(); this.cancel(); this.control('status').textContent = message; this.controls(); }
  close(focus = true) {
    this.stop(); this.cancel();
    if (this.control('dialog').open) {
      this.control('dialog').close();
      if (focus && this.active()) (this.returnFocus?.isConnected ? this.returnFocus : this.control('open')).focus({ preventScroll: true });
    }
    this.controls();
  }
  async open() {
    if (!this.available()) return;
    this.close(false); this.view = binding(this.state()); this.versions = null;
    this.returnFocus = this.control('dialog').ownerDocument.activeElement;
    this.control('sources').textContent = ''; this.control('coverage').textContent = '';
    this.control('dialog').showModal(); this.control('mode').focus(); await this.refresh();
  }
  update() {
    const view = binding(this.state());
    if (this.control('dialog').open && this.view?.key !== view.key) {
      if (this.view?.journey !== view.journey) { this.close(false); return; }
      this.view = view; this.versions = null;
      this.invalidate('Saved sources changed. Refresh versions and generate again; edited Markdown is retained.'); return;
    }
    this.controls();
  }
  selection() {
    if (!this.versions) return null;
    if (this.control('mode').value === 'git') {
      const ref = this.control('ref').value.trim();
      return this.versions.gitAvailable && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref) ? { kind: 'git', ref } : null;
    }
    const before = this.control('before').value, after = this.control('after').value;
    return before !== '' && after !== '' ? { kind: 'saved', before: Number(before), after: Number(after) } : null;
  }
  controls() {
    this.control('open').disabled = !this.available();
    const open = this.control('dialog').open, enabled = open && this.available() && !this.flight && !this.reusing;
    for (const name of ['refresh', 'mode', 'before', 'after', 'ref']) this.control(name).disabled = !enabled;
    this.control('git-option').disabled = !this.versions?.gitAvailable;
    const git = this.control('mode').value === 'git'; this.control('saved-fields').hidden = git; this.control('git-fields').hidden = !git;
    this.control('generate').disabled = !enabled || !this.selection();
    for (const name of ['copy', 'download']) this.control(name).disabled = !enabled || !this.preview || Date.now() >= this.preview.expiresAt;
  }
  async request(action, fields = {}) {
    if (!this.available() || !this.control('dialog').open || this.flight) return null;
    const view = binding(this.state()), epoch = ++this.epoch, abort = new AbortController(); this.flight = abort; this.controls();
    const current = () => this.active() && this.control('dialog').open && this.epoch === epoch && binding(this.state()).key === view.key;
    const timer = this.window.setTimeout(() => abort.abort(), 60000);
    try {
      const response = await this.fetch('api/change-summary', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, journey: view.journey, revision: view.revision, ...fields }) });
      const value = await response.json(); if (!current()) return null;
      if (!response.ok) throw Error(value.error || 'Summary sources could not be read.');
      if (value.journey !== view.journey || value.revision !== view.revision) throw Error('Summary source identity changed. Refresh versions and preview again.');
      return { value, current };
    } catch (error) {
      if (current()) this.invalidate(abort.signal.aborted ? 'Summary request timed out. Refresh versions and retry; edited text is retained.' : error.message);
      return null;
    } finally { this.window.clearTimeout(timer); if (this.flight === abort) { this.flight = null; this.controls(); } }
  }
  async refresh() {
    if (this.flight || this.reusing) return;
    this.invalidate('Reading available saved versions…'); this.versions = null;
    const reply = await this.request('list'); if (!reply?.current()) return;
    const value = reply.value;
    if (!value.current || !Array.isArray(value.entries) || ![value.current, ...value.entries].every(row => Number.isSafeInteger(row.revision) && row.revision >= 0 && typeof row.hash === 'string')) return this.invalidate('Version list is invalid. Refresh again.');
    this.versions = value;
    const document = this.control('dialog').ownerDocument;
    for (const name of ['before', 'after']) {
      const select = this.control(name), prior = select.value; select.replaceChildren();
      if (name === 'before') { const option = document.createElement('option'); option.value = ''; option.textContent = 'Choose a before version'; select.append(option); }
      for (const row of [value.current, ...value.entries]) { const option = document.createElement('option'); option.value = String(row.revision); option.textContent = `${row.revision === value.current.revision ? 'Current saved' : 'Saved'} revision ${row.revision} — ${row.time}`; select.append(option); }
      select.value = [...select.options].some(option => option.value === prior) && prior !== '' ? prior : name === 'before' ? '' : String(value.current.revision);
    }
    if (!value.gitAvailable) this.control('mode').value = 'saved';
    this.control('status').textContent = 'Choose the before and after sources, then generate a preview. Existing edited Markdown is not saved or sent anywhere.'; this.controls();
  }
  async generate() {
    const selection = this.selection(); if (!selection || this.flight || this.reusing) return;
    const edits = this.editEpoch;
    this.invalidate('Comparing the selected saved sources…');
    const reply = await this.request('preview', { selection }); if (!reply?.current()) return;
    const value = reply.value;
    if (typeof value.markdown !== 'string' || byteLength(value.markdown) > limit || typeof value.coverage !== 'string' || !value.sources || typeof value.token !== 'string' || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || JSON.stringify(value.selection) !== JSON.stringify(selection)) return this.invalidate('Summary preview is invalid or expired. Generate again.');
    this.preview = value;
    if (this.editEpoch !== edits) return this.invalidate('Edited Markdown changed while generating. Your text is retained; generate again explicitly to replace it.');
    this.editEpoch++; this.control('text').value = value.markdown;
    this.control('sources').textContent = JSON.stringify(value.sources, null, 2); this.control('coverage').textContent = value.coverage;
    this.control('status').textContent = 'Preview ready. Edit the Markdown if needed, then explicitly copy or download. Sources will be checked again.';
    this.expiry = this.window.setTimeout(() => { if (this.preview === value) this.invalidate('Summary preview expired. Generate again; edited Markdown is retained.'); }, Math.max(0, value.expiresAt - Date.now())); this.controls();
  }
  async reuse(action) {
    const preview = this.preview; if (!preview || this.flight || this.reusing || !this.available() || Date.now() >= preview.expiresAt) return;
    const text = this.control('text').value, edits = this.editEpoch;
    if (!text.isWellFormed() || byteLength(text) > limit) { this.control('status').textContent = 'Edited summary must be valid Unicode within the 2 MiB limit.'; return; }
    this.reusing = true; this.control('status').textContent = 'Rechecking the exact selected sources…';
    const pending = this.request('check', { token: preview.token }), epoch = this.epoch, reply = await pending;
    if (!reply?.current()) { if (this.epoch === epoch) { this.reusing = false; this.controls(); } return; }
    try {
      if (reply.value.valid !== true || reply.value.token !== preview.token) return this.invalidate('Summary source check did not confirm this preview. Generate again.');
      if (this.editEpoch !== edits) { this.control('status').textContent = 'Edited Markdown changed while checking. Copy or download again to use your latest text.'; return; }
      if (action === 'copy') { await this.copyText(text); if (reply.current()) this.control('status').textContent = 'Edited Markdown copied.'; }
      else { await this.downloadText(text); if (reply.current()) this.control('status').textContent = 'Download requested. Browser file saving is unknown.'; }
    } catch (error) { if (reply.current()) this.control('status').textContent = `${error.message || 'Copy or download failed.'} Edited Markdown is retained; retry explicitly.`; }
    finally { if (this.epoch === epoch) { this.reusing = false; this.controls(); } }
  }
}
