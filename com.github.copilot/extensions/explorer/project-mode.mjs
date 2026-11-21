import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { PROJECT_LIMITS, validateProjectPaths, projectRootKey } from './project-context.mjs';
import { ProjectDiscovery, validateProjectExclusions } from './project-discovery.mjs';
import { deadline } from './owned-helper.mjs';
import { readProjectCheckout } from './project-checkout.mjs';

const purpose = 'project-questions', lifetime = 10 * 60 * 1000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => Error('Project scope changed or expired. Review the current project and files again.');
function scopeChanges(previous, capture) {
  if (!previous || !capture?.files || !same(previous.root, capture.root)) return null;
  const old = new Map(previous.paths.map((name, index) => [name, previous.entries[index]])), current = new Map(capture.paths.map((name, index) => [name, capture.entries[index]]));
  return { files: { added: capture.paths.filter(name => !old.has(name)), removed: previous.paths.filter(name => !current.has(name)),
    changed: capture.paths.filter(name => old.has(name) && !same(old.get(name), current.get(name))), unchanged: capture.paths.filter(name => same(old.get(name), current.get(name))) },
    exclusions: { added: capture.exclusions.filter(name => !previous.exclusions.includes(name)), removed: previous.exclusions.filter(name => !capture.exclusions.includes(name)) },
    checkoutChanged: !same(previous.checkout, capture.checkout), previousCheckout: previous.checkout.git, currentCheckout: capture.checkout.git };
}

/** Scope consent and explicit local reads never authorize a helper request. */
export class ProjectMode {
  constructor(reader, currentJourney, now = Date.now, discovery = new ProjectDiscovery(reader), targetContext = null, checkoutReader = readProjectCheckout) { Object.assign(this, { reader, currentJourney, now, discovery, targetContext, checkoutReader }); this.epoch = 0; this.clear(); }
  clearScope(state = 'off', retainComparison = false) {
    if (retainComparison && this.approved) this.comparison = same(this.approved.root, this.observedRoot) ? structuredClone(this.approved) : null;
    if (!retainComparison) this.comparison = null;
    this.preview = this.approved = this.readConsent = this.readCapture = this.receipt = null; this.approvedPolicy = false; this.state = state;
  }
  clear() { this.epoch++; this.pending?.abort(); this.pending = null; this.clearScope(); this.inventory = null; this.observedRoot = null; this.clientId = this.journey = null; this.sequence = 0; }
  projectIdentity() { return this.journey === this.currentJourney() ? structuredClone(this.observedRoot) : null; }
  contextState() { return this.state; }
  capture() {
    if (!this.approved || !this.readCapture || !this.receipt || this.journey !== this.currentJourney()) return null;
    return structuredClone({ id: this.receipt.id, ...this.readCapture, paths: this.approved.paths, exclusions: this.approved.exclusions });
  }
  async captureCurrent(capture, { content = false, signal } = {}) {
    signal?.throwIfAborted(); const current = () => !!capture && same(capture, this.capture());
    if (!current()) return false;
    const stale = () => { if (current()) this.clearScope('stale', true); return false; };
    try {
      if (!same(capture.checkout, await this.checkoutReader(this.reader, { expectedRoot: capture.root, signal }))) return stale();
      await this.discovery.assertAllowed(capture.root, capture.paths, capture.exclusions, { signal });
      if (!current()) return false;
      const fresh = await this.reader.fresh(capture, { content, signal }); signal?.throwIfAborted();
      if (!fresh) return stale(); if (!current()) return false;
      await this.discovery.assertAllowed(capture.root, capture.paths, capture.exclusions, { signal }); signal?.throwIfAborted();
      if (!same(capture.checkout, await this.checkoutReader(this.reader, { expectedRoot: capture.root, signal }))) return stale();
      return current();
    } catch { signal?.throwIfAborted(); if (current()) this.clearScope('unavailable'); return false; }
  }
  async work(run) {
    const abort = new AbortController(); this.pending = abort;
    const timer = setTimeout(() => abort.abort(Error('Project context reached its time budget. Review a smaller scope and retry.')), 5000);
    try { const value = await run(abort.signal); abort.signal.throwIfAborted(); return value; }
    catch (error) { abort.signal.throwIfAborted(); throw error; }
    finally { clearTimeout(timer); if (this.pending === abort) this.pending = null; }
  }
  async inspect(root, paths, exclusions = [], checkout, signal) {
    const files = [], entries = []; let bytes = 0;
    for (const name of paths) {
      signal?.throwIfAborted(); const entry = await deadline(this.reader.entry(root, name), 2000); bytes += entry.size;
      if (bytes > PROJECT_LIMITS.totalBytes) throw Error('Selected project files exceed the 128 KiB scope limit.');
      files.push({ name, bytes: entry.size }); entries.push({ stamp: entry.stamp, parents: entry.parents });
    }
    if (!same(await deadline(this.reader.root(), 2000), root)) throw changed();
    if (!same(checkout, await this.checkoutReader(this.reader, { expectedRoot: root, signal }))) throw changed();
    return { root, checkout, paths: [...paths], files, entries, bytes, exclusions };
  }
  async request(input) {
    const action = input?.action, keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).sort().join(',') : '';
    const policyReview = Object.hasOwn(input ?? {}, 'exclusions');
    const expected = action === 'target' ? 'action,clientId,direction,exclusions,journey,nodeId,purpose,sequence' : action === 'discover' ? 'action,clientId,exclusions,journey,purpose,sequence' : action === 'prepare' ? `action,clientId,${policyReview ? 'exclusions,' : ''}journey,paths,purpose,sequence` : ['approve', 'read'].includes(action) ? 'action,clientId,journey,purpose,sequence,token' : 'action,clientId,journey,purpose,sequence';
    if (!['status', 'target', 'discover', 'prepare', 'approve', 'read', 'cancel', 'disable', 'revise'].includes(action) || keys !== expected || input.purpose !== purpose ||
      typeof input.journey !== 'string' || !input.journey || input.journey.length > 100 || typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.clientId) ||
      !Number.isSafeInteger(input.sequence) || input.sequence < 1 || ['approve', 'read'].includes(action) && (typeof input.token !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.token)) ||
      action === 'target' && (typeof input.nodeId !== 'string' || !input.nodeId || input.nodeId.length > 100 || typeof input.direction !== 'string' || input.direction.length > 500)) throw Error('Invalid project scope request.');
    if (!this.currentJourney()) throw Error('This canvas is closed or has no active journey.');
    if (input.journey !== this.currentJourney()) throw changed();
    if (this.journey !== input.journey) { this.clear(); this.journey = input.journey; }
    if (action === 'status' && this.clientId !== input.clientId) { this.clear(); this.journey = input.journey; this.clientId = input.clientId; }
    if (this.clientId !== input.clientId || input.sequence <= this.sequence) throw Error('Project scope client changed or request is obsolete. Open a fresh scope review.');
    this.sequence = input.sequence; this.pending?.abort(); this.pending = null;
    const epoch = this.epoch, current = () => {
      if (epoch !== this.epoch || this.sequence !== input.sequence || input.journey !== this.currentJourney()) throw changed();
    };
    const view = (state, capture, token, message = '') => structuredClone({ journey: input.journey, clientId: input.clientId, sequence: input.sequence, purpose, state,
      project: capture ? { name: basename(capture.root.path) || capture.root.path, root: capture.root.path, identity: projectRootKey(capture.root) } : null,
      scope: capture?.files ? { files: capture.files, bytes: capture.bytes, exclusions: capture.exclusions, checkout: capture.checkout.git } : null, limits: PROJECT_LIMITS, ...(token ? { token } : {}),
      ...(scopeChanges(this.comparison, capture) ? { comparison: scopeChanges(this.comparison, capture) } : {}),
      ...(this.inventory ? { inventory: Object.fromEntries(Object.entries(this.inventory).filter(([key]) => key !== 'root')) } : {}),
      ...(state === 'active' && this.readConsent ? { readToken: this.readConsent.token } : {}), ...(state === 'active' && this.receipt ? { receipt: this.receipt } : {}), message });
    if (action === 'disable') { this.clearScope(); this.inventory = null; return view('off', null); }
    if (action === 'revise') { this.clearScope(this.approved || this.comparison ? 'stale' : 'off', true); return view(this.state, this.observedRoot ? { root: this.observedRoot } : null, null, 'Scope edited. Review the exact selection again before using project context.'); }
    if (action === 'cancel') { this.preview = null; if (this.inventory?.target) this.inventory = null; }
    if (action === 'prepare' || action === 'discover') this.clearScope(this.approved || this.comparison ? 'stale' : 'off', true);
    if (this.preview && this.now() > this.preview.expires) { this.preview = null; this.state = this.comparison ? 'stale' : 'off'; }
    if (this.readConsent && this.now() > this.readConsent.expires) this.readConsent = null;
    let root, checkout;
    try {
      root = await deadline(this.reader.root(), 2000); current(); this.observedRoot = structuredClone(root);
      if (this.comparison && !same(this.comparison.root, root)) this.comparison = null;
      checkout = await this.work(signal => this.checkoutReader(this.reader, { expectedRoot: root, signal })); current();
      if (this.state === 'unavailable') this.state = 'stale';
    }
    catch (error) {
      current(); this.clearScope('unavailable'); this.inventory = null;
      if (action !== 'status' && action !== 'cancel') throw changed();
      return view('unavailable', root ? { root } : null, null, 'A current local Git project is unavailable. Ordinary exploration still works.');
    }
    if (this.inventory && !same(this.inventory.root, root)) this.inventory = null;
    if (action === 'target') {
      this.inventory = null;
      if (!this.targetContext) throw Error('Branch file suggestions are unavailable. Use ordinary questions or select files manually.');
      const exclusions = validateProjectExclusions(input.exclusions);
      const inventory = await this.work(async signal => {
        const target = await this.targetContext(input, signal); current(); signal.throwIfAborted();
        const inventory = await this.discovery.discover(exclusions, { signal, target }); current(); signal.throwIfAborted();
        await target.check(); current(); signal.throwIfAborted(); return inventory;
      }); current();
      if (!same(inventory.root, root)) throw changed(); this.inventory = inventory;
      return view('active', this.approved, null, 'Branch suggestions use local filename matches and reviewed shared sources. No new source contents were read. Changing scope requires a new read and brief approval.');
    }
    if (action === 'discover') {
      const exclusions = validateProjectExclusions(input.exclusions);
      const inventory = await this.work(signal => this.discovery.discover(exclusions, { signal })); current();
      if (!same(inventory.root, root)) throw changed(); this.inventory = inventory;
      return view(this.state, { root }, null, 'Select candidate files or add relative paths, then review their exact scope. No source contents have been read.');
    }
    if (action === 'prepare') {
      const paths = validateProjectPaths(input.paths); if (!paths.length) throw Error('Select at least one project file to review its scope.');
      const exclusions = validateProjectExclusions(input.exclusions ?? []);
      if (policyReview) { await this.work(signal => this.discovery.assertAllowed(root, paths, exclusions, { signal })); current(); }
      const capture = await this.work(signal => this.inspect(root, paths, exclusions, checkout, signal)); current();
      if (this.inventory && !same(this.inventory.exclusions, exclusions)) this.inventory = null;
      this.preview = { capture, policyReview, token: randomUUID(), expires: this.now() + lifetime }; this.state = 'review';
      return view('review', capture, this.preview.token);
    }
    if (action === 'approve') {
      const preview = this.preview;
      if (!preview || preview.token !== input.token) throw Error('Project scope review token is expired or already used. Review again.');
      this.preview = null;
      let capture;
      try {
        if (preview.policyReview) { await this.work(signal => this.discovery.assertAllowed(root, preview.capture.paths, preview.capture.exclusions, { signal })); current(); }
        capture = await this.work(signal => this.inspect(root, preview.capture.paths, preview.capture.exclusions, checkout, signal)); current();
      } catch { current(); this.clearScope('stale', true); throw changed(); }
      if (!same(capture, preview.capture) || this.now() > preview.expires) { this.clearScope('stale', true); throw changed(); }
      this.approved = capture; this.state = 'active'; this.approvedPolicy = preview.policyReview; this.readConsent = { token: randomUUID(), expires: this.now() + lifetime };
      return view('active', capture, null, 'Scope ready; a reviewed project brief is required before questions can use project context. Ordinary questions remain available.');
    }
    if (action === 'read') {
      if (!this.approved || !this.readConsent || this.readConsent.token !== input.token) throw Error('Project file read token expired or was already used. Review and enable the scope again.');
      const scope = this.approved; this.readConsent = this.readCapture = this.receipt = null;
      let capture;
      try {
        capture = await this.work(async signal => {
          if (!same(scope.checkout, checkout)) throw changed();
          await this.discovery.assertAllowed(scope.root, scope.paths, scope.exclusions, { signal }); current();
          if (!same(scope.checkout, await this.checkoutReader(this.reader, { expectedRoot: scope.root, signal }))) throw changed(); current();
          const value = await this.reader.select(scope.paths, null, { expected: scope, signal }); current();
          await this.discovery.assertAllowed(scope.root, scope.paths, scope.exclusions, { signal }); current();
          if (!await this.reader.fresh(value, { content: false, signal }) || !same(scope.checkout, await this.checkoutReader(this.reader, { expectedRoot: scope.root, signal }))) throw changed(); signal.throwIfAborted(); current(); return { ...value, checkout: scope.checkout };
        }); current();
      } catch (error) { current(); this.clearScope('stale', true); throw error; }
      this.readCapture = capture; this.approvedPolicy = true;
      this.receipt = { id: randomUUID(), purpose, capturedAt: new Date(this.now()).toISOString(), sources: capture.sources };
      return view('active', scope, null, 'Reviewed files captured locally. Inspect their excerpts; a reviewed project brief is still required before questions use them.');
    }
    const capture = this.approved ?? this.preview?.capture;
    if (capture) {
      let fresh;
      try {
        fresh = same(capture, await this.work(signal => this.inspect(root, capture.paths, capture.exclusions, checkout, signal))); current();
        if (fresh && (this.approvedPolicy || this.preview?.policyReview)) await this.work(signal => this.discovery.assertAllowed(root, capture.paths, capture.exclusions, { signal }));
      } catch { fresh = false; }
      current();
      if (!fresh) { this.clearScope('stale', true); return view('stale', { root }, null, 'Project checkout, file metadata or exclusion policy changed. Review the scope again; ordinary exploration still works.'); }
      return this.approved ? view('active', capture, null, 'Scope ready; a reviewed project brief is required before questions can use project context. Ordinary questions remain available.') : view('review', capture, this.preview.token);
    }
    if (this.state === 'review') this.state = this.comparison ? 'stale' : 'off';
    return view(this.state, { root }, null, this.state === 'stale' ? 'Project context is stale. Review scope, read the reviewed files and approve an updated brief before reuse.' : '');
  }
}
