import { lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, relative, parse, sep, extname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const PROJECT_LIMITS = Object.freeze({ files: 5, pathCharacters: 240, fileBytes: 65536, totalBytes: 131072, excerptBytes: 8192, totalExcerptBytes: 32768 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => [stat.dev, stat.ino, stat.birthtimeNs].join(':');
const stamp = stat => [identity(stat), stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(':');
const reliable = stat => stat.ino > 0n && stat.dev >= 0n;
const unavailable = () => { throw new Error('Project file or working root is unavailable, linked, or changed. Select regular files in the current project and explicitly refresh.'); };
const extensions = new Set(['.md', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.tsv', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.html', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.swift', '.kt', '.sql', '.sh', '.ps1']);
function paths(values) {
  if (!Array.isArray(values) || values.length > PROJECT_LIMITS.files) throw new Error('Select at most five project files.');
  const names = values.map(value => {
    if (typeof value !== 'string' || !value.length || value.length > PROJECT_LIMITS.pathCharacters || /[\\:\x00-\x1f\x7f<>"|?*]/.test(value) || isAbsolute(value)) throw new Error('Use relative project paths of at most 240 characters, with forward slashes.');
    const parts = value.split('/');
    if (parts.some(part => !part || part.startsWith('.') || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw new Error('Hidden, traversal and special project paths are excluded.');
    if (parts.some(part => /(?:^|[._-])(?:env|auth|oauth|api[_-]?keys?|service[_-]?account|keys?|secrets?|credentials?|passwords?|tokens?|private|id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:[._-]|$)/i.test(part)) || !extensions.has(extname(value).toLowerCase())) throw new Error('Secret defaults and unsupported file types are excluded before reading. Choose a text or source document.');
    return value;
  });
  if (new Set(names.map(name => process.platform === 'win32' ? name.toLowerCase() : name)).size !== names.length) throw new Error('Duplicate project files are not allowed.');
  return names;
}
export { paths as validateProjectPaths };

// Cooperative local filesystem: observed replacements reject. Portable Node cannot
// atomically bind every ancestor against a hostile concurrent directory swap.
export class ProjectContext {
  constructor(readRoot) { this.readRoot = readRoot; }
  async root() {
    try {
      const value = await this.readRoot?.();
      if (typeof value !== 'string' || !isAbsolute(value) || value.length > 32768 || value.startsWith('\\\\')) unavailable();
      const path = resolve(value); let parent = parse(path).root; const ancestors = [];
      for (const part of ['', ...relative(parent, path).split(sep).filter(Boolean)]) {
        parent = join(parent, part); const stat = await lstat(parent, { bigint: true });
        if (!stat.isDirectory() || stat.isSymbolicLink() || !reliable(stat)) unavailable();
        ancestors.push(identity(stat));
      }
      return { path: await realpath(path), ancestors: ancestors.join('/') };
    } catch { unavailable(); }
  }
  async entry(root, name) {
    const path = join(root.path, ...name.split('/')); let parent = root.path; const parents = [];
    for (const part of name.split('/').slice(0, -1)) {
      parent = join(parent, part); const stat = await lstat(parent, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || !reliable(stat) || await realpath(parent) !== parent) unavailable();
      parents.push(identity(stat));
    }
    const stat = await lstat(path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || !reliable(stat) || await realpath(path) !== path) unavailable();
    if (stat.size > BigInt(PROJECT_LIMITS.fileBytes)) throw new Error('Project file exceeds the 64 KiB per-file limit.');
    return { path, size: Number(stat.size), stamp: stamp(stat), parents: parents.join('/') };
  }
  async read(root, name, expected) {
    const entry = await this.entry(root, name);
    if (expected && (entry.stamp !== expected.stamp || entry.parents !== expected.parents)) unavailable();
    const handle = await open(entry.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (stamp(await handle.stat({ bigint: true })) !== entry.stamp) unavailable();
      const again = await this.entry(root, name);
      if (again.stamp !== entry.stamp || again.parents !== entry.parents || JSON.stringify(await this.root()) !== JSON.stringify(root)) unavailable();
      const bytes = Buffer.alloc(entry.size + 1); let count = 0;
      while (count < bytes.length) { const part = await handle.read(bytes, count, bytes.length - count, count); if (!part.bytesRead) break; count += part.bytesRead; }
      if (count !== entry.size || stamp(await handle.stat({ bigint: true })) !== entry.stamp) unavailable();
      const after = await this.entry(root, name);
      if (after.stamp !== entry.stamp || after.parents !== entry.parents || JSON.stringify(await this.root()) !== JSON.stringify(root)) unavailable();
      return { ...entry, content: bytes.subarray(0, count) };
    } finally { await handle.close(); }
  }
  async select(values, previous) {
    const names = paths(values);
    if (!names.length) return null;
    try {
      const root = await this.root(), entries = [], sources = []; let bytes = 0, excerpts = 0;
      // Reject aggregate sizes before any file content is read.
      for (const name of names) { const entry = await this.entry(root, name); bytes += entry.size; if (bytes > PROJECT_LIMITS.totalBytes) throw new Error('Selected project files exceed the 128 KiB total read limit.'); entries.push(entry); }
      for (const [index, name] of names.entries()) {
        const entry = await this.read(root, name, entries[index]); let text;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.content); } catch { throw new Error('Project documents must contain valid UTF-8 text.'); }
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw new Error('Binary or control-character project documents are excluded.');
        let excerpt = '', excerptBytes = 0;
        for (const character of text) { const size = Buffer.byteLength(character); if (excerptBytes + size > PROJECT_LIMITS.excerptBytes) break; excerpt += character; excerptBytes += size; }
        excerpts += excerptBytes; if (excerpts > PROJECT_LIMITS.totalExcerptBytes) throw new Error('Selected excerpts exceed the 32 KiB total excerpt limit. Select fewer files.');
        const prior = JSON.stringify(root) === JSON.stringify(previous?.root) ? previous.sources.find(source => source.name === name) : null;
        sources.push(Object.freeze({ id: prior?.id ?? randomUUID(), name, fingerprint: hash(entry.content), excerptFingerprint: hash(excerpt), bytes: entry.size, excerptBytes, truncated: excerptBytes < entry.size, excerpt }));
      }
      return { root, entries: entries.map(({ stamp, parents }) => ({ stamp, parents })), sources: Object.freeze(sources) };
    } catch (error) {
      if (/^(?:Project |Selected |Binary )/.test(error.message)) throw error;
      unavailable();
    }
  }
  async fresh(capture, { content = true } = {}) {
    if (!capture) return true;
    try {
      if (JSON.stringify(await this.root()) !== JSON.stringify(capture.root)) return false;
      for (const [index, source] of capture.sources.entries()) {
        const entry = content ? await this.read(capture.root, source.name, capture.entries[index]) : await this.entry(capture.root, source.name);
        if (entry.stamp !== capture.entries[index].stamp || entry.parents !== capture.entries[index].parents || content && hash(entry.content) !== source.fingerprint) return false;
      }
      return JSON.stringify(await this.root()) === JSON.stringify(capture.root);
    } catch { return false; }
  }
}
