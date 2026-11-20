import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { PROJECT_LIMITS, validateProjectPaths } from './project-context.mjs';
import { ProjectDiscovery, validateProjectExclusions } from './project-discovery.mjs';
import { deadline } from './owned-helper.mjs';

const purpose = 'project-questions', lifetime = 10 * 60 * 1000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => Error('Project scope changed or expired. Review the current project and files again.');

/** Scope consent and explicit local reads never authorize a helper request. */
export class ProjectMode {
  constructor(reader, currentJourney, now = Date.now, discovery = new ProjectDiscovery(reader)) { Object.assign(this, { reader, currentJourney, now, discovery }); this.epoch = 0; this.clear(); }
  clearScope() { this.preview = this.approved = this.readConsent = this.readCapture = this.receipt = null; this.approvedPolicy = false; }
  clear() { this.epoch++; this.pending?.abort(); this.pending = null; this.clearScope(); this.inventory = null; this.clientId = this.journey = null; this.sequence = 0; }
  async work(run) {
    const abort = new AbortController(); this.pending = abort;
    const timer = setTimeout(() => abort.abort(Error('Project context reached its time budget. Review a smaller scope and retry.')), 5000);
    try { const value = await run(abort.signal); abort.signal.throwIfAborted(); return value; }
    catch (error) { abort.signal.throwIfAborted(); throw error; }
    finally { clearTimeout(timer); if (this.pending === abort) this.pending = null; }
  }
  async inspect(root, paths, exclusions = []) {
    const files = [], entries = []; let bytes = 0;
    for (const name of paths) {
      const entry = await deadline(this.reader.entry(root, name), 2000); bytes += entry.size;
      if (bytes > PROJECT_LIMITS.totalBytes) throw Error('Selected project files exceed the 128 KiB scope limit.');
      files.push({ name, bytes: entry.size }); entries.push({ stamp: entry.stamp, parents: entry.parents });
    }
    if (!same(await deadline(this.reader.root(), 2000), root)) throw changed();
    return { root, paths: [...paths], files, entries, bytes, exclusions };
  }
  async request(input) {
    const action = input?.action, keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).sort().join(',') : '';
    const policyReview = Object.hasOwn(input ?? {}, 'exclusions');
    const expected = action === 'discover' ? 'action,clientId,exclusions,journey,purpose,sequence' : action === 'prepare' ? `action,clientId,${policyReview ? 'exclusions,' : ''}journey,paths,purpose,sequence` : ['approve', 'read'].includes(action) ? 'action,clientId,journey,purpose,sequence,token' : 'action,clientId,journey,purpose,sequence';
    if (!['status', 'discover', 'prepare', 'approve', 'read', 'cancel', 'disable'].includes(action) || keys !== expected || input.purpose !== purpose ||
      typeof input.journey !== 'string' || !input.journey || input.journey.length > 100 || typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.clientId) ||
      !Number.isSafeInteger(input.sequence) || input.sequence < 1 || ['approve', 'read'].includes(action) && (typeof input.token !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.token))) throw Error('Invalid project scope request.');
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
      project: capture ? { name: basename(capture.root.path) || capture.root.path, root: capture.root.path } : null,
      scope: capture?.files ? { files: capture.files, bytes: capture.bytes, exclusions: capture.exclusions } : null, limits: PROJECT_LIMITS, ...(token ? { token } : {}),
      ...(this.inventory ? { inventory: Object.fromEntries(Object.entries(this.inventory).filter(([key]) => key !== 'root')) } : {}),
      ...(state === 'active' && this.readConsent ? { readToken: this.readConsent.token } : {}), ...(state === 'active' && this.receipt ? { receipt: this.receipt } : {}), message });
    if (action === 'disable') { this.clearScope(); this.inventory = null; return view('off', null); }
    if (action === 'cancel') this.preview = null;
    if (action === 'prepare' || action === 'discover') this.clearScope();
    if (this.preview && this.now() > this.preview.expires) this.preview = null;
    if (this.readConsent && this.now() > this.readConsent.expires) this.readConsent = null;
    let root;
    try { root = await deadline(this.reader.root(), 2000); current(); }
    catch (error) {
      current(); this.clearScope(); this.inventory = null;
      if (action !== 'status' && action !== 'cancel') throw changed();
      return view('unavailable', null, null, 'A current local project is unavailable. Ordinary exploration still works.');
    }
    if (this.inventory && !same(this.inventory.root, root)) this.inventory = null;
    if (action === 'discover') {
      const exclusions = validateProjectExclusions(input.exclusions);
      const inventory = await this.work(signal => this.discovery.discover(exclusions, { signal })); current();
      if (!same(inventory.root, root)) throw changed(); this.inventory = inventory;
      return view('off', { root }, null, 'Select candidate files or add relative paths, then review their exact scope. No source contents have been read.');
    }
    if (action === 'prepare') {
      const paths = validateProjectPaths(input.paths); if (!paths.length) throw Error('Select at least one project file to review its scope.');
      const exclusions = validateProjectExclusions(input.exclusions ?? []);
      if (policyReview) { await this.work(signal => this.discovery.assertAllowed(root, paths, exclusions, { signal })); current(); }
      const capture = await this.inspect(root, paths, exclusions); current();
      if (this.inventory && !same(this.inventory.exclusions, exclusions)) this.inventory = null;
      this.preview = { capture, policyReview, token: randomUUID(), expires: this.now() + lifetime };
      return view('review', capture, this.preview.token);
    }
    if (action === 'approve') {
      const preview = this.preview;
      if (!preview || preview.token !== input.token) throw Error('Project scope review token is expired or already used. Review again.');
      this.preview = null;
      let capture;
      try {
        if (preview.policyReview) { await this.work(signal => this.discovery.assertAllowed(root, preview.capture.paths, preview.capture.exclusions, { signal })); current(); }
        capture = await this.inspect(root, preview.capture.paths, preview.capture.exclusions); current();
      } catch { current(); this.clearScope(); throw changed(); }
      if (!same(capture, preview.capture) || this.now() > preview.expires) { this.approved = null; throw changed(); }
      this.approved = capture; this.approvedPolicy = preview.policyReview; this.readConsent = { token: randomUUID(), expires: this.now() + lifetime };
      return view('active', capture, null, 'Scope ready; a reviewed project brief is required before questions can use project context. Ordinary questions remain available.');
    }
    if (action === 'read') {
      if (!this.approved || !this.readConsent || this.readConsent.token !== input.token) throw Error('Project file read token expired or was already used. Review and enable the scope again.');
      const scope = this.approved; this.readConsent = this.readCapture = this.receipt = null;
      let capture;
      try {
        capture = await this.work(async signal => {
          await this.discovery.assertAllowed(scope.root, scope.paths, scope.exclusions, { signal }); current();
          const value = await this.reader.select(scope.paths, null, { expected: scope, signal }); current();
          await this.discovery.assertAllowed(scope.root, scope.paths, scope.exclusions, { signal }); current();
          if (!await this.reader.fresh(value, { content: false })) throw changed(); signal.throwIfAborted(); current(); return value;
        }); current();
      } catch (error) { current(); this.clearScope(); throw error; }
      this.readCapture = capture; this.approvedPolicy = true;
      this.receipt = { id: randomUUID(), purpose, capturedAt: new Date(this.now()).toISOString(), sources: capture.sources };
      return view('active', scope, null, 'Reviewed files captured locally. Inspect their excerpts; a reviewed project brief is still required before questions use them.');
    }
    const capture = this.approved ?? this.preview?.capture;
    if (capture) {
      let fresh;
      try {
        fresh = same(capture, await this.inspect(root, capture.paths, capture.exclusions)); current();
        if (fresh && (this.approvedPolicy || this.preview?.policyReview)) await this.work(signal => this.discovery.assertAllowed(root, capture.paths, capture.exclusions, { signal }));
      } catch { fresh = false; }
      current();
      if (!fresh) { this.clearScope(); return view('stale', { root }, null, 'Project, file metadata or exclusion policy changed. Review the scope again; ordinary exploration still works.'); }
      return this.approved ? view('active', capture, null, 'Scope ready; a reviewed project brief is required before questions can use project context. Ordinary questions remain available.') : view('review', capture, this.preview.token);
    }
    return view('off', { root });
  }
}
