import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';

const exec = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const unknown = () => Error('Git status evidence is unavailable.');

export function parseGitStatus(text, path, exists) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || !text.endsWith('\0')) throw unknown();
  const headers = new Map(), records = text.split('\0'); let file = exists ? 'committed' : 'missing', index = '.', worktree = '.', seen = false;
  for (let i = 0; i < records.length - 1; i++) {
    const row = records[i];
    if (row.startsWith('# branch.')) {
      const match = /^# branch\.(oid|head|upstream|ab) (.+)$/.exec(row);
      if (!match || headers.has(match[1])) throw unknown(); headers.set(match[1], match[2]); continue;
    }
    let match, names;
    if (row.startsWith('? ') || row.startsWith('! ')) {
      file = row[0] === '?' ? 'untracked' : 'ignored'; names = [row.slice(2)];
    } else if ((match = /^1 ([.MADRCUT]{2}) (?:[^ ]+ ){6}(.+)$/.exec(row))) {
      [index, worktree] = match[1]; file = 'modified'; names = [match[2]];
    } else if ((match = /^2 ([.MADRCUT]{2}) (?:[^ ]+ ){7}(.+)$/.exec(row))) {
      [index, worktree] = match[1]; file = 'modified'; names = [match[2], records[++i]];
    } else if ((match = /^u ([.MADRCUT]{2}) (?:[^ ]+ ){8}(.+)$/.exec(row))) {
      [index, worktree] = match[1]; file = 'conflicted'; names = [match[2]];
    } else throw unknown();
    if (seen || !names.some(name => typeof name === 'string' && (samePath(name, path) || file === 'ignored' && name.endsWith('/') && samePath(path.slice(0, name.length), name)))) throw unknown();
    seen = true;
  }
  const oid = headers.get('oid'), branch = headers.get('head'), upstream = headers.get('upstream') ?? null;
  if (!oid || oid !== '(initial)' && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid) || !branch || branch.length > 1024 || upstream?.length > 1024) throw unknown();
  const counts = headers.has('ab') ? /^\+(\d+) -(\d+)$/.exec(headers.get('ab')) : null;
  if (headers.has('ab') && (!counts || !upstream || !counts.slice(1).every(n => Number.isSafeInteger(Number(n))))) throw unknown();
  return { state: 'available', file, index, worktree, branch: branch === '(detached)' ? null : branch, detached: branch === '(detached)',
    unborn: oid === '(initial)', head: oid === '(initial)' ? null : oid, upstream, ahead: counts ? Number(counts[1]) : null, behind: counts ? Number(counts[2]) : null, remoteFreshness: 'unknown' };
}

/** An explicit local observation only: no Git writes, remote checks or model work. */
export class ProjectGitStatus {
  constructor(repository, store, { run = exec } = {}) { Object.assign(this, { repository, store, run }); }
  async read() {
    const path = this.store.context.relativePath; let limitation = '';
    try {
      const selected = await this.repository.selection(path, false), checkout = await directoryState(selected.checkoutDirectory);
      if (checkout.path !== this.store.context.checkoutDirectory || checkout.identity !== this.store.context.checkoutIdentity) throw unknown();
      const access = await projectDocumentAccess(selected);
      const read = async () => { try { const value = await access.read(); return { stamp: value.stamp, digest: digest(value.bytes) }; } catch (error) { if (error.code === 'ENOENT') return { stamp: null, digest: null }; throw error; } };
      const before = await read();
      const prefix = ['--no-optional-locks', '--no-lazy-fetch', '--literal-pathspecs', '-C', checkout.path, '-c', 'core.fsmonitor=false'];
      const options = { env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))), windowsHide: true, timeout: 5000, maxBuffer: 65536 };
      const readGit = args => this.run('git', [...prefix, ...args, '--', path], options);
      const attributes = (await readGit(['check-attr', '-z', 'filter'])).stdout.split('\0');
      if (attributes.length !== 4 || !samePath(attributes[0], path) || attributes[1] !== 'filter' || attributes[3] !== '') throw unknown();
      if (!['unspecified', 'unset'].includes(attributes[2])) {
        limitation = 'This file uses repository content filters. Inspect it with your Git client; Explorer does not run those filters for status.';
        throw unknown();
      }
      const result = await readGit(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=all']);
      const git = parseGitStatus(result.stdout, path, before.stamp !== null);
      if (git.file === 'committed') {
        // Empty status also occurs below gitlinks and for hidden index entries.
        // Require this exact regular file in both HEAD and the normal index.
        const index = /^H (100644|100755) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t([^\0]+)\0$/.exec((await readGit(['ls-files', '-v', '--stage', '-z'])).stdout);
        const head = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)\0$/.exec((await readGit(['ls-tree', '-z', 'HEAD'])).stdout);
        if (!index || !head || index[1] !== head[1] || index[2] !== head[2] || !samePath(index[3], path) || !samePath(head[3], path)) throw unknown();
      }
      let current = true; try { await this.store.context.assertCurrent(); } catch { current = false; }
      await selected.revalidate(); const after = await read();
      if (JSON.stringify(before) !== JSON.stringify(after)) throw unknown();
      const source = !after.stamp ? 'missing' : current && after.stamp === this.store.fileStamp && after.digest === this.store.baseDigest ? 'saved' : 'review';
      return { path, checkedAt: new Date().toISOString(), source, git };
    } catch {
      return { path, checkedAt: new Date().toISOString(), source: 'unavailable', git: { state: 'unavailable' }, message: limitation || 'Status could not be verified. Check Git availability and the current checkout, then refresh. Your map and drafts are unchanged.' };
    }
  }
}
