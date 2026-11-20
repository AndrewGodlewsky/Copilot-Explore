import { opendir, lstat, realpath } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateProjectPaths } from './project-context.mjs';

const exec = promisify(execFile), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const DISCOVERY_LIMITS = Object.freeze({ depth: 3, directories: 40, entries: 300, candidates: 40, milliseconds: 5000, exclusions: 10 });
const generated = new Set(['node_modules', 'vendor', 'dist', 'build', 'out', 'target', 'coverage', 'bin', 'obj', '__pycache__', 'venv']);
const generatedFiles = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'cargo.lock', 'go.sum']);
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const policyError = () => Error('Project ignore policy is unavailable. Check Git and the current repository, then retry; ordinary exploration still works.');
const excluded = (name, exclusions) => exclusions.some(value => value.endsWith('/') ? fold(name) === fold(value.slice(0, -1)) || fold(name).startsWith(fold(value)) : fold(name) === fold(value));
const isGenerated = name => name.split('/').some(part => generated.has(part.toLowerCase())) || generatedFiles.has(basename(name).toLowerCase());

export function validateProjectExclusions(values) {
  if (!Array.isArray(values) || values.length > DISCOVERY_LIMITS.exclusions) throw Error('Use at most ten exact file or folder exclusions.');
  const result = values.map(value => {
    if (typeof value !== 'string' || !value || value.length > 240 || /[\\:\x00-\x1f\x7f<>"|?*]/.test(value)) throw Error('Use exact relative exclusions of at most 240 characters, without wildcards.');
    const parts = (value.endsWith('/') ? value.slice(0, -1) : value).split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw Error('Exclusions must stay within the project without traversal or empty path segments.');
    // Excluding a hidden/secret or unsupported file is safe; this grants no read access.
    return value;
  });
  if (new Set(result.map(fold)).size !== result.length) throw Error('Duplicate project exclusions are not allowed.');
  return result;
}

function relevance(name) {
  const leaf = basename(name).toLowerCase();
  if (/^(?:readme(?:[._-].*)?|architecture\.md|design\.md|contributing\.md)$/.test(leaf) || /(?:^|\/)(?:docs?|documentation|adrs?)\//i.test(name) && ['.md', '.txt', '.rst', '.adoc'].includes(extname(leaf))) return { reason: 'Project documentation', priority: 0 };
  if (['package.json', 'pyproject.toml', 'cargo.toml', 'composer.json', 'pom.xml', 'requirements.txt', 'pubspec.yaml', 'cmakelists.txt'].includes(leaf)) return { reason: 'Project manifest', priority: 1 };
  if (/^(?:index|main|app|server|program)\.(?:[cm]?js|jsx|ts|tsx|py|go|rs|java|cs|rb|swift|kt|c|cpp)$/.test(leaf)) return { reason: 'Source entry point', priority: 2 };
  return null;
}

export class ProjectDiscovery {
  constructor(reader, { run = exec, now = Date.now } = {}) { Object.assign(this, { reader, run, now }); }
  budget(signal) {
    const end = this.now() + DISCOVERY_LIMITS.milliseconds;
    const guard = () => { signal?.throwIfAborted(); if (this.now() >= end) throw Error('Project discovery reached its time budget. Retry with a smaller scope.'); };
    return { signal, guard, remaining: () => { guard(); return Math.max(1, end - this.now()); }, checked: async operation => { guard(); const value = await operation(); guard(); return value; } };
  }
  async ignored(root, names, budget) {
    const ignored = new Set();
    for (let offset = 0; offset < names.length; offset += 32) {
      const batch = names.slice(offset, offset + 32); let result;
      try {
        result = await budget.checked(() => this.run('git', ['--no-pager', '--no-optional-locks', '--no-lazy-fetch', '-C', root.path,
          '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', 'check-ignore', '--no-index', '--', ...batch], {
          env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))),
          windowsHide: true, timeout: budget.remaining(), maxBuffer: 65536, signal: budget.signal,
        }));
      } catch (error) {
        budget.guard(); if (error.code !== 1 || error.stdout !== '') throw policyError(); result = { stdout: '' };
      }
      const text = result.stdout;
      if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || text && !text.endsWith('\n')) throw policyError();
      for (const name of text ? text.slice(0, -1).split('\n') : []) { if (!batch.includes(name)) throw policyError(); ignored.add(name); }
    }
    return ignored;
  }
  async assertAllowed(root, paths, exclusions, { signal } = {}) {
    const names = validateProjectPaths(paths), omitted = validateProjectExclusions(exclusions), budget = this.budget(signal);
    if (!same(await budget.checked(() => this.reader.root()), root)) throw Error('Project changed. Review the current scope again.');
    if (names.some(name => excluded(name, omitted) || isGenerated(name))) throw Error('Selected project files include an excluded or generated path.');
    if ((await this.ignored(root, names.length ? names : ['explorer-policy-probe.md'], budget)).size && names.length) throw Error('Selected project files include a Git-ignored path.');
    if (!same(await budget.checked(() => this.reader.root()), root)) throw Error('Project changed. Review the current scope again.');
  }
  async discover(exclusions, { signal } = {}) {
    const omitted = validateProjectExclusions(exclusions), budget = this.budget(signal), root = await budget.checked(() => this.reader.root());
    await this.ignored(root, ['explorer-policy-probe.md'], budget);
    const candidates = [], skipped = [], queue = [{ name: '', depth: 0 }]; let examined = 0, directories = 0, truncated = false;
    const skip = (name, reason) => skipped.push({ name, reason });
    const directory = async name => {
      const path = join(root.path, ...name.split('/').filter(Boolean)), stat = await budget.checked(() => lstat(path, { bigint: true }));
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino <= 0n || await budget.checked(() => realpath(path)) !== path) throw Error('Unavailable directory');
      return { path, identity: [stat.dev, stat.ino, stat.birthtimeNs].join(':') };
    };
    while (queue.length && examined < DISCOVERY_LIMITS.entries && directories < DISCOVERY_LIMITS.directories) {
      const item = queue.shift(); let before;
      try {
        before = await directory(item.name);
        if (item.name) {
          let nested = false;
          try { await budget.checked(() => lstat(join(before.path, '.git'))); nested = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (nested) { skip(item.name, 'Nested repository'); continue; }
        }
      } catch { budget.guard(); skip(item.name, 'Unavailable or linked directory'); continue; }
      const entries = []; let handle;
      try {
        budget.guard(); handle = await opendir(before.path, { bufferSize: 32 }); budget.guard(); directories++;
        while (examined < DISCOVERY_LIMITS.entries) { const entry = await budget.checked(() => handle.read()); if (!entry) break; examined++; entries.push(entry); }
        if (examined === DISCOVERY_LIMITS.entries) truncated = true;
      } catch { budget.guard(); skip(item.name, 'Inaccessible directory'); continue; }
      finally { await handle?.close(); }
      if (!same(await directory(item.name), before)) throw Error('Project directory changed. Discover again.');
      const eligible = [];
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const name = item.name ? `${item.name}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) { skip(name, 'Linked or unsupported entry'); continue; }
        try { validateProjectPaths([entry.isDirectory() ? `${name}/scope.md` : name]); } catch { skip(name, 'Excluded path or unsupported file type'); continue; }
        if (excluded(name, omitted)) { skip(name, 'Explicit exclusion'); continue; }
        if (isGenerated(name)) { skip(name, 'Generated or vendor content'); continue; }
        if (entry.isDirectory() && item.depth >= DISCOVERY_LIMITS.depth) { skip(name, 'Traversal depth limit'); truncated = true; continue; }
        const reason = entry.isDirectory() ? null : relevance(name);
        if (!entry.isDirectory() && !reason) { skip(name, 'Not a context entry point'); continue; }
        eligible.push({ name, directory: entry.isDirectory(), reason });
      }
      const ignored = await this.ignored(root, eligible.map(entry => entry.name), budget);
      for (const entry of eligible) {
        if (ignored.has(entry.name)) { skip(entry.name, 'Git ignore rule'); continue; }
        if (entry.directory) { queue.push({ name: entry.name, depth: item.depth + 1 }); continue; }
        try { const value = await budget.checked(() => this.reader.entry(root, entry.name)); candidates.push({ name: entry.name, bytes: value.size, ...entry.reason }); }
        catch { budget.guard(); skip(entry.name, 'Unavailable, linked or oversized file'); }
      }
    }
    if (queue.length || candidates.length > DISCOVERY_LIMITS.candidates) truncated = true;
    if (!same(await budget.checked(() => this.reader.root()), root)) throw Error('Project changed. Discover again.');
    candidates.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    for (const extra of candidates.slice(DISCOVERY_LIMITS.candidates)) skip(extra.name, 'Candidate limit');
    return { root, candidates: candidates.slice(0, DISCOVERY_LIMITS.candidates).map(({ priority, ...file }) => file), skipped, examined, directories, truncated, limits: DISCOVERY_LIMITS, exclusions: omitted };
  }
}
