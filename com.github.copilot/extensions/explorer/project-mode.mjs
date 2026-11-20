import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { PROJECT_LIMITS, validateProjectPaths } from './project-context.mjs';
import { deadline } from './owned-helper.mjs';

const purpose = 'project-questions', lifetime = 10 * 60 * 1000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => Error('Project scope changed or expired. Review the current project and files again.');

/** Metadata-only scope consent. It never authorizes a helper request or reads file contents. */
export class ProjectMode {
  constructor(reader, currentJourney, now = Date.now) { Object.assign(this, { reader, currentJourney, now }); this.epoch = 0; this.clear(); }
  clear() { this.epoch++; this.preview = this.approved = null; this.clientId = this.journey = null; this.sequence = 0; }
  async inspect(root, paths) {
    const files = [], entries = []; let bytes = 0;
    for (const name of paths) {
      const entry = await deadline(this.reader.entry(root, name), 2000); bytes += entry.size;
      if (bytes > PROJECT_LIMITS.totalBytes) throw Error('Selected project files exceed the 128 KiB scope limit.');
      files.push({ name, bytes: entry.size }); entries.push({ stamp: entry.stamp, parents: entry.parents });
    }
    if (!same(await deadline(this.reader.root(), 2000), root)) throw changed();
    return { root, paths: [...paths], files, entries, bytes };
  }
  async request(input) {
    const action = input?.action, keys = input && typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).sort().join(',') : '';
    const expected = action === 'prepare' ? 'action,clientId,journey,paths,purpose,sequence' : action === 'approve' ? 'action,clientId,journey,purpose,sequence,token' : 'action,clientId,journey,purpose,sequence';
    if (!['status', 'prepare', 'approve', 'cancel', 'disable'].includes(action) || keys !== expected || input.purpose !== purpose ||
      typeof input.journey !== 'string' || !input.journey || input.journey.length > 100 || typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.clientId) ||
      !Number.isSafeInteger(input.sequence) || input.sequence < 1 || action === 'approve' && (typeof input.token !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.token))) throw Error('Invalid project scope request.');
    if (!this.currentJourney()) throw Error('This canvas is closed or has no active journey.');
    if (input.journey !== this.currentJourney()) throw changed();
    if (this.journey !== input.journey) { this.clear(); this.journey = input.journey; }
    if (action === 'status' && this.clientId !== input.clientId) { this.clear(); this.journey = input.journey; this.clientId = input.clientId; }
    if (this.clientId !== input.clientId || input.sequence <= this.sequence) throw Error('Project scope client changed or request is obsolete. Open a fresh scope review.');
    this.sequence = input.sequence;
    const epoch = this.epoch, current = () => {
      if (epoch !== this.epoch || this.sequence !== input.sequence || input.journey !== this.currentJourney()) throw changed();
    };
    const view = (state, capture, token, message = '') => structuredClone({ journey: input.journey, clientId: input.clientId, sequence: input.sequence, purpose, state,
      project: capture ? { name: basename(capture.root.path) || capture.root.path, root: capture.root.path } : null,
      scope: capture?.files ? { files: capture.files, bytes: capture.bytes } : null, limits: PROJECT_LIMITS, ...(token ? { token } : {}), message });
    if (action === 'disable') { this.preview = this.approved = null; return view('off', null); }
    if (action === 'cancel') this.preview = null;
    if (action === 'prepare') this.preview = this.approved = null;
    if (this.preview && this.now() > this.preview.expires) this.preview = null;
    let root;
    try { root = await deadline(this.reader.root(), 2000); current(); }
    catch (error) {
      current(); this.preview = this.approved = null;
      if (action !== 'status' && action !== 'cancel') throw changed();
      return view('unavailable', null, null, 'A current local project is unavailable. Ordinary exploration still works.');
    }
    if (action === 'prepare') {
      const paths = validateProjectPaths(input.paths); if (!paths.length) throw Error('Select at least one project file to review its scope.');
      const capture = await this.inspect(root, paths); current();
      this.preview = { capture, token: randomUUID(), expires: this.now() + lifetime };
      return view('review', capture, this.preview.token);
    }
    if (action === 'approve') {
      const preview = this.preview;
      if (!preview || preview.token !== input.token) throw Error('Project scope review token is expired or already used. Review again.');
      this.preview = null;
      let capture;
      try { capture = await this.inspect(root, preview.capture.paths); current(); }
      catch { current(); this.approved = null; throw changed(); }
      if (!same(capture, preview.capture) || this.now() > preview.expires) { this.approved = null; throw changed(); }
      this.approved = capture;
      return view('active', capture, null, 'Scope ready; a reviewed project brief is required before questions can use project context. Ordinary questions remain available.');
    }
    const capture = this.approved ?? this.preview?.capture;
    if (capture) {
      let fresh;
      try { fresh = same(capture, await this.inspect(root, capture.paths)); } catch { fresh = false; }
      current();
      if (!fresh) { this.preview = this.approved = null; return view('stale', { root }, null, 'Project or file metadata changed. Review the scope again; ordinary exploration still works.'); }
      return this.approved ? view('active', capture, null, 'Scope ready; a reviewed project brief is required before questions can use project context. Ordinary questions remain available.') : view('review', capture, this.preview.token);
    }
    return view('off', { root });
  }
}
