const binding = state => ({ journey: state.activeKey ?? state.document?.id ?? null, revision: state.document?.revision ?? null });
const same = (a, b) => a?.journey === b?.journey && a?.revision === b?.revision;

/** Explicit copy/inspect/navigation with canvas-local text and no automatic link handling. */
export class PortableReferenceClient {
  constructor({ $, state, active, canAct, begin, fetch, copyText, navigate, select }) {
    Object.assign(this, { $, state, active, canAct, begin, fetch, copyText, navigate, select }); this.epoch = 0;
    for (const id of ['open', 'welcome']) this.control(id).addEventListener('click', () => this.open());
    this.control('close').addEventListener('click', () => { if (!this.navigating) this.close(); });
    this.control('dialog').addEventListener('cancel', event => { event.preventDefault(); if (!this.navigating) this.close(); });
    this.control('dialog').addEventListener('close', () => { if (!this.control('dialog').open) this.close(false); });
    this.control('text').addEventListener('input', () => this.invalidate('Text changed. Inspect the reference before opening.'));
    this.control('ack').addEventListener('change', () => this.update());
    for (const action of ['copy', 'inspect', 'go']) this.control(action).addEventListener('click', () => void this[action]());
    this.update();
  }
  control(id) { return this.$(`portable-reference-${id}`); }
  stopRead() { this.epoch++; this.flight?.abort(); this.flight = null; this.release?.(); this.release = null; }
  invalidate(message = '') {
    this.stopRead(); this.preview = null; this.output = ''; this.control('output').value = ''; this.control('ack').checked = false;
    this.control('preview').textContent = ''; this.control('status').textContent = message; this.update();
  }
  open(nodeId) {
    if (!this.active() || this.navigating) return;
    this.close(false); this.nodeId = nodeId ?? null; this.view = binding(this.state()); this.returnFocus = this.control('dialog').ownerDocument.activeElement;
    this.control('title').textContent = nodeId ? 'Copy reference' : 'Open reference'; this.control('paste').hidden = !!nodeId; this.control('copy-area').hidden = !nodeId;
    this.control('dialog').showModal(); this.invalidate(); this.control(nodeId ? 'output' : 'text').focus();
    if (nodeId) return this.copy();
  }
  close(focus = true) {
    this.stopRead(); this.preview = null; this.navigating = false;
    this.control('preview').textContent = ''; this.control('go').disabled = true;
    if (this.control('dialog').open) { this.control('dialog').close(); if (focus && this.active()) (this.returnFocus?.isConnected ? this.returnFocus : this.control('open')).focus({ preventScroll: true }); }
  }
  update() {
    const state = this.state();
    for (const id of ['open', 'welcome']) this.control(id).disabled = !state.library;
    if (!this.control('dialog').open) return;
    if (!this.navigating && !same(this.view, binding(state))) {
      const changedJourney = this.view?.journey !== binding(state).journey; this.view = binding(state);
      if (changedJourney) { this.close(false); return; }
      this.invalidate('The saved map changed. Inspect or copy the current reference again.'); return;
    }
    const enabled = this.active() && this.canAct() && !this.flight && !this.navigating;
    this.control('inspect').disabled = !enabled || !state.library;
    this.control('copy').disabled = !enabled || state.storage?.scope !== 'project';
    this.control('go').disabled = !enabled || !this.preview || !!state.pending || !!state.preview || this.preview.status === 'changed' && !this.control('ack').checked;
    this.control('text').disabled = !!this.navigating; this.control('close').disabled = !!this.navigating;
    this.control('ack-label').hidden = this.preview?.status !== 'changed'; this.control('ack').disabled = !!this.navigating;
    if (state.pending || state.preview) this.control('status').textContent = 'Finish or cancel the active request and dismiss its preview before opening a reference.';
  }
  async request(action, fields) {
    if (!this.active() || !this.canAct() || this.flight || this.navigating || !this.control('dialog').open) return null;
    const view = binding(this.state()), epoch = ++this.epoch, abort = new AbortController(); this.flight = abort;
    const release = this.begin(); this.release = release; this.update();
    const timer = setTimeout(() => abort.abort(), 10000), current = () => this.active() && this.control('dialog').open && this.epoch === epoch && same(view, binding(this.state()));
    try {
      const response = await this.fetch('api/portable-reference', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, ...view, ...fields }) });
      const result = await response.json(); if (!current()) return null;
      if (!response.ok) throw Error(result.error);
      return result;
    } catch (error) { if (current()) this.control('status').textContent = abort.signal.aborted ? 'Reference inspection timed out. Your text is retained; try again.' : error.message; return null; }
    finally { clearTimeout(timer); if (this.flight === abort) { this.flight = null; this.release = null; release(); this.update(); } }
  }
  async copy() {
    if (this.state().storage?.scope !== 'project') { this.control('status').textContent = 'Save and open a shared Project copy before copying a portable reference.'; return; }
    if (!this.output) {
      const result = await this.request('copy', { nodeId: this.nodeId }); if (!result) return;
      this.output = result.text; this.control('output').value = result.text;
    }
    const epoch = this.epoch;
    try { await this.copyText(this.output); if (this.active() && this.epoch === epoch && this.control('dialog').open) this.control('status').textContent = 'Reference copied. Open it explicitly in Explorer in the target checkout.'; }
    catch { if (this.active() && this.epoch === epoch && this.control('dialog').open) { this.control('status').textContent = 'Clipboard unavailable. Select the reference text above and copy manually.'; this.control('output').focus(); this.control('output').select(); } }
  }
  async inspect() {
    const text = this.control('text').value;
    this.invalidate();
    if (!text.trim() || !text.isWellFormed() || new TextEncoder().encode(text).length > 8192) { this.control('status').textContent = 'Paste one valid Explorer reference, up to 8 KiB.'; return; }
    const result = await this.request('inspect', { text }); if (!result) return;
    this.preview = result;
    const caption = result.status === 'changed' ? 'The saved target changed. Acknowledge this before opening current content.' : result.status === 'unchecked' ? 'No source fingerprint: saved target freshness is unchecked.' : 'The saved target matches its fingerprint.';
    this.control('preview').textContent = `${result.path}\n${result.question}\n${caption}\nMatching covers this saved target, not research or the entire branch. Nothing was opened yet.`;
    this.control('status').textContent = ''; this.update();
  }
  async go() {
    const state = this.state(), preview = this.preview;
    if (!preview || !this.active() || !this.canAct() || this.flight || this.navigating || state.pending || state.preview || preview.status === 'changed' && !this.control('ack').checked) return;
    const epoch = this.epoch, view = this.view; this.navigating = true; this.update();
    try {
      const result = await this.navigate({ ...view, id: preview.id, acknowledged: this.control('ack').checked }, () => this.active() && this.epoch === epoch && this.control('dialog').open && same(view, binding(this.state())));
      if (!this.active() || this.epoch !== epoch || !this.control('dialog').open) return;
      if (result) { this.close(false); this.select(result.referenceNodeId); }
      else this.control('status').textContent = 'Reference was not opened. Resolve any current-map notice, then retry or inspect again.';
    } catch (error) { if (this.epoch === epoch && this.control('dialog').open) this.control('status').textContent = error.message; }
    finally { if (this.epoch === epoch) { this.navigating = false; this.update(); } }
  }
}
