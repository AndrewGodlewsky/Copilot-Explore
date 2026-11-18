import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { devNull } from 'node:os';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';
import { MAX_SHARED_BYTES, readSharedDocument } from './shared-document.mjs';
import { mergeSharedDocuments } from './semantic-merge.mjs';
import { FORMAT } from './model.mjs';

const exec = promisify(execFile), oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unavailable = () => Error('Git comparison is unavailable. Check the selected local branch/ref and use Recovery for unavailable or conflicted files.');

/** Local object reads only. No Git merges, index writes, filters or network fetches. */
export class ProjectMerge {
  constructor(repository, store, { run = exec } = {}) { Object.assign(this, { repository, store, run }); this.selection = null; }
  async capture(ref) {
    if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref)) throw Error('Choose a locally available branch/ref or commit ID. Revision expressions and options are unsupported.');
    await this.store.context.assertCurrent();
    const selected = await this.repository.selection(this.store.context.relativePath, false), checkout = await directoryState(selected.checkoutDirectory);
    if (checkout.path !== this.store.context.checkoutDirectory || checkout.identity !== this.store.context.checkoutIdentity) throw Error('Project checkout changed. Reopen the journey.');
    const access = await projectDocumentAccess(selected), source = await access.read(), local = readSharedDocument(source.bytes);
    if (source.stamp !== this.store.fileStamp || local.baseDigest !== this.store.baseDigest) throw Error('Local saved content changed. Review project changes before merging.');
    const prefix = ['--no-optional-locks', '--no-lazy-fetch', '--no-replace-objects', '--literal-pathspecs', '-C', checkout.path, '-c', 'core.fsmonitor=false'];
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    // --no-replace-objects does not disable legacy grafts, which can invent ancestry.
    env.GIT_GRAFT_FILE = devNull;
    const git = async (args, binary = false) => {
      try { return (await this.run('git', [...prefix, ...args], { env, windowsHide: true, timeout: 5000, maxBuffer: binary ? MAX_SHARED_BYTES : 65536, encoding: binary ? 'buffer' : 'utf8' })).stdout; }
      catch (error) { if (args[0] === 'merge-base' && error.code === 1) return ''; throw unavailable(); }
    };
    const commit = async name => { const oid = (await git(['rev-parse', '--verify', '--end-of-options', `${name}^{commit}`])).trim(); if (!oidPattern.test(oid)) throw unavailable(); return oid; };
    const head = await commit('HEAD'), incomingCommit = await commit(ref);
    const bases = (await git(['merge-base', '--all', head, incomingCommit])).trim().split(/\s+/).filter(Boolean);
    if (bases.some(oid => !oidPattern.test(oid))) throw unavailable();
    const baseCommit = bases.length === 1 ? bases[0] : null, path = selected.relativePath;
    const documentAt = async oid => {
      const entry = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)\0$/.exec(await git(['ls-tree', '-z', oid, '--', path]));
      if (!entry || entry[3] !== path) throw Error('The selected exploration is not the same regular file at this Git revision. Compare separate copies or use Recovery.');
      const sizeText = (await git(['cat-file', '-s', entry[2]])).trim(), size = Number(sizeText);
      if (!/^\d+$/.test(sizeText) || !Number.isSafeInteger(size) || size > MAX_SHARED_BYTES) throw Error('Git exploration exceeds the 9 MiB read limit.');
      const bytes = await git(['cat-file', 'blob', entry[2]], true);
      if (bytes.length !== size) throw unavailable();
      return readSharedDocument(bytes);
    };
    const incoming = await documentAt(incomingCommit);
    let base = null, message = baseCommit ? '' : 'No unique trustworthy common base is available. Compare and copy the separate sources; automatic merging is disabled.';
    if (baseCommit) {
      try { base = await documentAt(baseCommit); }
      catch { message = 'The common-base exploration is unavailable or unsupported. Compare and copy the separate sources; automatic merging is disabled.'; }
    }
    await selected.revalidate(); await this.store.context.assertCurrent();
    const fresh = await access.read();
    if (fresh.stamp !== source.stamp || readSharedDocument(fresh.bytes).baseDigest !== local.baseDigest || await commit('HEAD') !== head || await commit(ref) !== incomingCommit) throw Error('Comparison sources changed. Preview again.');
    return { local, incoming, base, head, incomingCommit, baseCommit, message, path,
      fingerprint: { head, incomingCommit, baseCommit, local: local.baseDigest, stamp: source.stamp, incoming: incoming.baseDigest, base: base?.baseDigest ?? null } };
  }
  async preview(ref) {
    this.selection = null;
    const captured = await this.capture(ref), selection = { id: randomUUID(), ref, captured, revision: this.store.document.revision, expires: Date.now() + 15 * 60 * 1000, resolved: null };
    this.selection = selection;
    let plan = null, message = captured.message;
    if (captured.base) {
      try { plan = this.resolve(selection.id, {}); }
      catch { message = 'These sources cannot form a compatible merge. Compare and copy them separately; no project content was changed.'; }
    }
    return { id: selection.id, path: captured.path, head: captured.head, incomingCommit: captured.incomingCommit, baseCommit: captured.baseCommit, message, plan,
      sources: { local: captured.local.content, incoming: captured.incoming.content, base: captured.base?.content ?? null } };
  }
  selected(id) {
    if (!this.selection || this.selection.id !== id || Date.now() > this.selection.expires || this.store.document.revision !== this.selection.revision) throw Error('Merge preview expired or local revision changed. Preview again.');
    return this.selection;
  }
  resolve(id, choices) {
    const selected = this.selected(id); selected.resolved = null;
    const { base, local, incoming } = selected.captured;
    if (!base) throw Error('A compatible common base is required for resolution.');
    const result = mergeSharedDocuments(base.document, local.document, incoming.document, choices);
    const token = result.document ? randomUUID() : null;
    if (token) selected.resolved = { token, document: result.document, affected: result.affected };
    return { token, conflicts: result.conflicts, unresolved: result.unresolved, affected: result.affected, error: result.error,
      content: result.document ? JSON.stringify(result.document, null, 2) + '\n' : null };
  }
  async accept(id, token, acknowledged) {
    const selected = this.selected(id), resolved = selected.resolved;
    if (!resolved || resolved.token !== token) throw Error('A current, fully resolved preview is required.');
    if (acknowledged !== true) throw Error('Acknowledge the reviewed merge and its consequences before saving.');
    const verify = async () => {
      const current = await this.capture(selected.ref);
      if (this.selected(id) !== selected || selected.resolved !== resolved || !same(current.fingerprint, selected.captured.fingerprint)) throw Error('Comparison sources or resolution changed. Preview again.');
    };
    await verify();
    const candidate = { format: FORMAT, version: 1, revision: selected.revision, ...resolved.document.journey };
    await this.store.save(candidate, { baseDigest: selected.captured.local.baseDigest, label: 'Merged shared exploration', beforeWrite: verify });
    this.selection = null; return this.store;
  }
  cancel() { this.selection = null; }
}
