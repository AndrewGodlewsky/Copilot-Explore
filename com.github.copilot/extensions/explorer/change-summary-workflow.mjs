import { randomUUID } from 'node:crypto';
import { FORMAT } from './model.mjs';
import { changeSummary } from './change-summary.mjs';
import { ProjectMerge } from './project-merge.mjs';
import { ProjectGitStatus } from './project-git-status.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields;
const revision = value => Number.isSafeInteger(value) && value >= 0;
const expired = () => Error('Change summary preview expired or sources changed. Generate a new preview before reuse.');
const bounded = value => { if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) throw Error('Change summary response exceeds its 4 MiB limit. Nothing was clipped.'); return value; };

/** Exact saved reads only; called under the active document transaction/writer lock. */
export class ChangeSummary {
  constructor({ now = Date.now } = {}) { this.now = now; this.entry = null; }
  clear() { this.entry = null; }
  owner(e, input) {
    const doc = e.doc, store = e.projectStore, file = e.file;
    const assert = () => {
      if (e.closed || !doc || e.doc !== doc || e.projectStore !== store || e.file !== file || input.journey !== (e.activeKey ?? e.doc.id) || input.revision !== e.doc.revision) throw Error('Summary journey, revision or owner changed. Refresh the selected saved exploration.');
    };
    assert(); return assert;
  }
  selected(e, input) {
    const value = this.entry;
    if (!value || value.token !== input.token || this.now() >= value.expiresAt || value.journey !== input.journey || value.revision !== input.revision || value.store !== e.projectStore || value.file !== e.file) throw expired();
    return value;
  }
  async saved(e, current, selection) {
    const history = await e.history(e.activeKey ?? current.id), list = await history.list(current);
    const read = async requested => {
      if (requested === current.revision) return { doc: current, source: { kind: 'saved', revision: requested, digest: list.current.hash } };
      const row = await history.list(current, requested);
      return { doc: row.document, source: { kind: 'saved', revision: requested, digest: row.hash } };
    };
    const before = await read(selection.before), after = await read(selection.after);
    return { before: before.doc, after: after.doc, sources: { before: before.source, after: after.source, path: e.projectStore?.context.relativePath ?? null },
      fingerprint: { history: history.key, current: list.current.hash, before: before.source.digest, after: after.source.digest } };
  }
  async git(e, current, selection) {
    if (!e.projectStore || !e.projectRepository) throw Error('Git comparison requires a saved project exploration.');
    const status = new ProjectGitStatus(e.projectRepository, e.projectStore);
    const check = async () => {
      const value = await status.read();
      if (value.source !== 'saved' || value.git.state !== 'available' || ['conflicted', 'missing', 'ignored'].includes(value.git.file)) throw Error('Selected-file Git status is unavailable, conflicted or uses unsupported filters. Resolve it in your Git client and refresh.');
      return value;
    };
    const first = await check(), captured = await new ProjectMerge(e.projectRepository, e.projectStore).capture(selection.ref), last = await check();
    if (!same(first.git, last.git) || first.path !== captured.path || first.git.head !== captured.head) throw expired();
    return { before: { ...captured.incoming.document.journey, format: FORMAT, version: 1, revision: 0 }, after: { ...captured.local.document.journey, format: FORMAT, version: 1, revision: current.revision },
      sources: { before: { kind: 'git', ref: selection.ref, commit: captured.incomingCommit, digest: captured.incoming.baseDigest }, after: { kind: 'saved', revision: current.revision, digest: captured.local.baseDigest }, path: captured.path },
      fingerprint: { ...captured.fingerprint, git: last.git } };
  }
  async capture(e, current, selection) {
    if (keys(selection, 'after,before,kind') && selection.kind === 'saved' && revision(selection.before) && revision(selection.after)) return this.saved(e, current, selection);
    if (keys(selection, 'kind,ref') && selection.kind === 'git' && typeof selection.ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(selection.ref)) return this.git(e, current, selection);
    throw Error('Invalid saved-version or Git comparison selection.');
  }
  async request(e, input) {
    const fields = { list: 'action,journey,revision', preview: 'action,journey,revision,selection', check: 'action,journey,revision,token', cancel: 'action,journey,revision,token' };
    if (!input || !Object.hasOwn(fields, input.action) || !keys(input, fields[input.action])) throw Error('Invalid change summary request.');
    if (['check', 'cancel'].includes(input.action) && (typeof input.token !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.token))) throw Error('Invalid change summary token.');
    const assertOwner = this.owner(e, input);
    if (input.action === 'cancel') { if (this.entry?.token === input.token) this.clear(); return { journey: input.journey, revision: input.revision, cancelled: true }; }
    if (input.action === 'list' || input.action === 'preview') this.clear();
    const prior = input.action === 'check' ? this.selected(e, input) : null;
    try {
      const current = await e.fresh(); assertOwner();
      if (input.action === 'list') {
        const history = await e.history(input.journey), list = await history.list(current);
        await e.fresh(); assertOwner();
        return bounded({ journey: input.journey, revision: current.revision, current: list.current, entries: list.entries, gitAvailable: !!e.projectStore && !!e.projectRepository, path: e.projectStore?.context.relativePath ?? null });
      }
      const selection = prior?.selection ?? input.selection, captured = await this.capture(e, current, selection);
      await e.fresh(); assertOwner();
      if (prior) {
        if (this.selected(e, input) !== prior || !same(prior.fingerprint, captured.fingerprint)) throw expired();
        return { journey: input.journey, revision: current.revision, token: prior.token, valid: true };
      }
      const summary = changeSummary(captured.before, captured.after, { beforeSource: captured.sources.before, afterSource: captured.sources.after, path: captured.sources.path });
      const token = randomUUID(), expiresAt = this.now() + 15 * 60 * 1000;
      const response = bounded({ journey: input.journey, revision: current.revision, token, expiresAt, selection: structuredClone(selection), sources: captured.sources, ...summary });
      this.entry = { token, expiresAt, journey: input.journey, revision: current.revision, selection: structuredClone(selection), fingerprint: captured.fingerprint, store: e.projectStore, file: e.file };
      return response;
    } catch (error) { this.clear(); throw error; }
  }
}
