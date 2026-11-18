import { mkdir, lstat, realpath, readFile, readdir, unlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { validateDocument, MAX_DOCUMENT_BYTES } from './model.mjs';
import { atomicWrite } from './storage.mjs';

export const HISTORY_LIMITS = Object.freeze({ revisions: 50, bytes: 128 * 1024 * 1024, checkpoints: 10, name: 120 });
const hash = value => createHash('sha256').update(value).digest('hex');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
const nameValid = value => typeof value === 'string' && value.trim().length > 0 && value.length <= HISTORY_LIMITS.name;
const recoveryError = () => new Error('History recovery required. Files are preserved. Open Recovery to inspect saved versions or retry reconciliation before editing this journey.');

// Every method is called under the active document's writer lock. The active
// document rename is the commit point; intent recovery never replaces it.
export class History {
  constructor(directory, key, id, { write = atomicWrite, validate = validateDocument } = {}) {
    if (!validHash(key) || typeof id !== 'string' || !id.length || id.length > 100) throw new Error('Invalid history identity.');
    this.directory = resolve(directory); this.key = key; this.id = id; this.write = write; this.validateDocument = validate; this.verified = new Map();
  }
  encode(doc) {
    const data = JSON.stringify(this.validateDocument(doc), null, 2);
    if (Buffer.byteLength(data) > MAX_DOCUMENT_BYTES) throw new Error('History snapshot exceeds the saved-data size limit.');
    return data;
  }
  async root() {
    let root = this.directory;
    await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink()) throw new Error('History cannot use a linked root.');
    root = await realpath(root);
    for (const part of ['history', this.key]) {
      root = join(root, part); await mkdir(root, { recursive: true });
      const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink() || dirname(await realpath(root)) !== dirname(root)) throw new Error('Unsafe history directory.');
    }
    return root;
  }
  async read(name, max, optional = false) {
    const root = await this.root(), file = join(root, name);
    let stat;
    try { stat = await lstat(file); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max || dirname(await realpath(file)) !== root) throw new Error('Unsafe or oversized history file.');
    const data = await readFile(file, 'utf8');
    if (Buffer.byteLength(data) > max) throw new Error('Oversized history file.');
    return data;
  }
  validate(value) {
    const rowValid = row => row && revision(row.revision) && validHash(row.hash) && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= MAX_DOCUMENT_BYTES &&
      typeof row.time === 'string' && Number.isFinite(Date.parse(row.time)) && typeof row.label === 'string' && row.label.length > 0 && row.label.length <= 200 &&
      Array.isArray(row.checkpoints) && row.checkpoints.every(nameValid);
    if (value?.version !== 1 || value.key !== this.key || value.id !== this.id || !rowValid(value.head) || !Array.isArray(value.entries) || !value.entries.every(rowValid) ||
      value.entries.length > HISTORY_LIMITS.revisions || value.entries.reduce((sum, row) => sum + row.bytes, 0) > HISTORY_LIMITS.bytes ||
      value.entries.some((row, i) => row.revision > value.head.revision || i && row.revision <= value.entries[i - 1].revision) ||
      value.entries.flatMap(row => row.checkpoints).length > HISTORY_LIMITS.checkpoints || new Set(value.entries.flatMap(row => row.checkpoints)).size !== value.entries.flatMap(row => row.checkpoints).length ||
      !(value.undoRevision === null || revision(value.undoRevision) && value.entries.some(row => row.revision === value.undoRevision && row.revision < value.head.revision))) throw new Error('Invalid history manifest.');
    return value;
  }
  row(doc, label) { const data = this.encode(doc); return { revision: doc.revision, hash: hash(data), bytes: Buffer.byteLength(data), time: doc.updatedAt, label, checkpoints: [] }; }
  initial(doc) { return { version: 1, key: this.key, id: this.id, head: this.row(doc, 'Initial saved version'), entries: [], undoRevision: null }; }
  async verify(row) {
    const stat = await lstat(join(await this.root(), `${row.hash}.json`));
    const stamp = JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino, row.revision, row.time, row.bytes]);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe history snapshot.');
    if (this.verified.get(row.hash) === stamp) return;
    await this.snapshot(row); this.verified.set(row.hash, stamp);
  }
  async snapshot(row) {
    const data = await this.read(`${row.hash}.json`, MAX_DOCUMENT_BYTES);
    if (hash(data) !== row.hash || Buffer.byteLength(data) !== row.bytes) throw new Error('A history snapshot is damaged.');
    const raw = JSON.parse(data);
    if (raw.id !== this.id || raw.revision !== row.revision || raw.updatedAt !== row.time) throw new Error('History snapshot identity does not match.');
    const doc = this.validateDocument(raw);
    if (doc.id !== this.id || doc.revision !== row.revision || doc.updatedAt !== row.time) throw new Error('History snapshot identity does not match.');
    return doc;
  }
  async store(doc, row) {
    const file = `${row.hash}.json`, existing = await this.read(file, MAX_DOCUMENT_BYTES, true);
    if (existing !== null) { await this.snapshot(row); return; }
    await this.write(join(await this.root(), file), this.encode(doc));
  }
  prune(value, required) {
    while (value.entries.length > HISTORY_LIMITS.revisions || value.entries.reduce((sum, row) => sum + row.bytes, 0) > HISTORY_LIMITS.bytes) {
      const index = value.entries.findIndex(row => row.revision !== required && !row.checkpoints.length);
      if (index < 0) throw new Error('History storage is full: protected named checkpoints prevent safe pruning. Remove a checkpoint before retrying.');
      value.entries.splice(index, 1);
    }
    if (!value.entries.some(row => row.revision === value.undoRevision)) value.undoRevision = null;
    return this.validate(value);
  }
  async cleanup(value) {
    const root = await this.root(), retained = new Set(value.entries.map(row => `${row.hash}.json`));
    for (const file of await readdir(root)) {
      if (!/^[a-f0-9]{64}\.json$/.test(file) || retained.has(file)) continue;
      const data = await this.read(file, MAX_DOCUMENT_BYTES), doc = this.validateDocument(JSON.parse(data));
      if (hash(data) !== file.slice(0, -5) || doc.id !== this.id) throw new Error('An unreferenced history snapshot is damaged.');
      await unlink(join(root, file));
    }
  }
  async reconcile(current) {
    try {
      const raw = await this.read('manifest.json', 128 * 1024, true);
      if (raw === null && (await readdir(await this.root())).some(file => file === 'intent.json' || /^[a-f0-9]{64}\.json$/.test(file))) throw new Error('History manifest is missing.');
      let value = raw === null ? this.initial(current) : this.validate(JSON.parse(raw));
      const intentRaw = await this.read('intent.json', 256 * 1024, true);
      if (intentRaw !== null) {
        const intent = JSON.parse(intentRaw), proposed = this.validate(intent.manifest);
        if (intent.version !== 1 || !validHash(intent.before) || !validHash(intent.after) || proposed.head.hash !== intent.after || proposed.head.revision !== value.head.revision + 1 || intent.before !== value.head.hash) {
          // Final manifest may already have landed before a crash removing intent.
          if (!(intent.version === 1 && validHash(intent.before) && intent.after === value.head.hash && JSON.stringify(proposed) === JSON.stringify(value))) throw new Error('Invalid history intent.');
        }
        const active = hash(this.encode(current));
        if (active === intent.after) {
          for (const row of proposed.entries) await this.verify(row);
          await this.write(join(await this.root(), 'manifest.json'), JSON.stringify(proposed)); value = proposed;
        } else if (active !== intent.before) throw new Error('The active map matches neither side of an interrupted save.');
        await unlink(join(await this.root(), 'intent.json'));
      }
      const currentRow = this.row(current, value.head.label);
      if (['hash', 'revision', 'time', 'bytes'].some(field => value.head[field] !== currentRow[field]) || value.head.checkpoints.length) throw new Error('The active map changed outside its recorded history.');
      for (const row of value.entries) await this.verify(row);
      await this.cleanup(value);
      return value;
    } catch (error) { throw recoveryError(error); }
  }
  async commit(before, after, label, replace) {
    const value = await this.reconcile(before), next = structuredClone(value), row = value.head;
    if (!next.entries.some(entry => entry.revision === before.revision)) next.entries.push(row);
    next.head = this.row(after, label); next.undoRevision = before.revision;
    this.prune(next, before.revision);
    // Establish a baseline before intent, so recovery also works for legacy files.
    await this.write(join(await this.root(), 'manifest.json'), JSON.stringify(value));
    await this.store(before, row);
    await this.write(join(await this.root(), 'intent.json'), JSON.stringify({ version: 1, before: row.hash, after: next.head.hash, manifest: next }));
    await replace();
    try { await this.reconcile(after); }
    catch { throw new Error('Map saved, but history finalization failed. Open Recovery to retry history reconciliation before another edit. Newer saved content is retained.'); }
  }
  async list(current, requested) {
    const value = await this.reconcile(current);
    if (requested !== undefined) {
      if (!revision(requested)) throw new Error('Invalid history revision.');
      const row = value.entries.find(row => row.revision === requested);
      if (!row) throw new Error('This history revision is no longer available.');
      return { ...row, current: value.head, document: await this.snapshot(row) };
    }
    return { entries: [...value.entries].reverse(), current: value.head, undoRevision: value.undoRevision, oldestRevision: value.entries[0]?.revision ?? null, bytes: value.entries.reduce((sum, row) => sum + row.bytes, 0), limits: HISTORY_LIMITS };
  }
  async checkpoint(current, selected, name, remove = false) {
    if (!revision(selected) || !nameValid(name)) throw new Error('Checkpoint names must contain 1–120 characters.');
    const value = await this.reconcile(current);
    // A persisted baseline distinguishes an interrupted checkpoint from lost history.
    await this.write(join(await this.root(), 'manifest.json'), JSON.stringify(value));
    let row = value.entries.find(row => row.revision === selected);
    if (!row && selected === current.revision && !remove) { row = structuredClone(value.head); value.entries.push(row); }
    if (!row) throw new Error('This history revision is no longer available.');
    if (remove) { if (!row.checkpoints.includes(name)) throw new Error('Unknown checkpoint.'); row.checkpoints = row.checkpoints.filter(v => v !== name); }
    else {
      const names = value.entries.flatMap(entry => entry.checkpoints);
      if (names.length >= HISTORY_LIMITS.checkpoints) throw new Error('At most 10 named checkpoints are allowed.');
      if (names.includes(name)) throw new Error('A checkpoint already has this name.');
      row.checkpoints.push(name);
    }
    this.prune(value, selected);
    if (selected === current.revision) await this.store(current, row);
    await this.write(join(await this.root(), 'manifest.json'), JSON.stringify(value));
    try { await this.cleanup(value); }
    catch (error) { throw new Error(`Checkpoint updated, but history cleanup failed. Reopen History to retry. ${error.message}`); }
  }
}
