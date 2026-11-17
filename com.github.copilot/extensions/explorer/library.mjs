import { acquireLock } from './owned-lock.mjs';
import { questionCounts } from './web/answer-state.mjs';
import { mkdir, readdir, lstat, realpath, readFile } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateDocument, importedDocument, MAX_DOCUMENT_BYTES } from './model.mjs';
import { atomicWrite } from './storage.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const entryKey = (name, id) => hash(`${name}\0${id}`);
const emptyMetadata = () => ({ version: 1, revision: 0, entries: {}, bindings: {} });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ambiguousIds(records) {
  const groups = new Map();
  for (const { document } of records) {
    if (!groups.has(document.id)) groups.set(document.id, new Set());
    groups.get(document.id).add(hash(JSON.stringify(document)));
  }
  return new Set([...groups].filter(([, fingerprints]) => fingerprints.size > 1).map(([id]) => id));
}

export class Library {
  constructor(directory) { this.directory = resolve(directory); this.files = new Map(); }
  async root() {
    try {
      await mkdir(this.directory, { recursive: true });
      if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('link');
      return await realpath(this.directory);
    } catch { throw new Error('Library storage is unavailable. Check the data directory permissions and do not use a linked directory.'); }
  }
  async safeFile(name, limit = MAX_DOCUMENT_BYTES) {
    if (!/^[^\\/:\0]+$/.test(name) || name === '.' || name === '..') throw new Error('Invalid library filename.');
    const root = await this.root(), file = join(root, name), stat = await lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile() || dirname(await realpath(file)) !== root) throw new Error('Library links and non-file entries cannot be opened.');
    if (stat.size > limit) throw new Error('Saved file exceeds the size limit.');
    return file;
  }
  async scan() {
    const root = await this.root(), records = [], errors = [];
    for (const name of (await readdir(root)).filter(name => name.endsWith('.explore.json')).sort()) {
      try {
        const file = await this.safeFile(name), document = validateDocument(JSON.parse(await readFile(file, 'utf8')));
        const key = entryKey(name, document.id);
        this.files.set(key, name); records.push({ key, file, document });
      } catch (error) {
        errors.push({ key: hash(name), message: error.code === 'ENOENT' ? 'A saved journey is missing. Refresh the library.' : /link|size limit/.test(error.message) ? error.message : 'A saved journey could not be read. The original file is preserved.' });
      }
    }
    return { records, errors };
  }
  async metadata() {
    try {
      const file = await this.safeFile('library.json', MAX_DOCUMENT_BYTES), value = JSON.parse(await readFile(file, 'utf8'));
      if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.entries || !value.bindings || typeof value.entries !== 'object' || typeof value.bindings !== 'object' || Array.isArray(value.entries) || Array.isArray(value.bindings)) throw new Error('Invalid metadata.');
      for (const [key, entry] of Object.entries(value.entries)) {
        if (!validKey(key) || !entry || typeof entry.pinned !== 'boolean' || typeof entry.archived !== 'boolean' || (entry.lastOpenedAt !== null && (typeof entry.lastOpenedAt !== 'string' || !Number.isFinite(Date.parse(entry.lastOpenedAt))))) throw new Error('Invalid metadata.');
        value.entries[key] = { pinned: entry.pinned, archived: entry.archived, lastOpenedAt: entry.lastOpenedAt };
      }
      for (const [key, entry] of Object.entries(value.bindings)) if (!validKey(key) || !validKey(entry)) throw new Error('Invalid binding.');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return emptyMetadata();
      throw new Error('Library metadata could not be read. It has been preserved; restore library.json before changing the library.');
    }
  }
  summary(record, metadata, ambiguous) {
    const { key, document: doc } = record;
    return { key, id: doc.id, topic: doc.topic, updatedAt: doc.updatedAt, nodeCount: doc.nodes.length, questionCount: questionCounts(doc).total,
      pinned: false, archived: false, lastOpenedAt: null, ...metadata.entries[key],
      ambiguous: ambiguous.has(doc.id) };
  }
  async list({ search = '', archived = false } = {}) {
    if (typeof search !== 'string' || search.length > 4000 || typeof archived !== 'boolean') throw new Error('Invalid library filter.');
    const { records, errors } = await this.scan();
    let metadata;
    try { metadata = await this.metadata(); } catch (error) { metadata = emptyMetadata(); errors.push({ message: error.message }); }
    const ambiguous = ambiguousIds(records);
    const entries = records.map(record => this.summary(record, metadata, ambiguous))
      .filter(entry => entry.archived === archived && entry.topic.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.lastOpenedAt ?? b.updatedAt) - Date.parse(a.lastOpenedAt ?? a.updatedAt) || a.key.localeCompare(b.key));
    return { revision: metadata.revision, entries, errors };
  }
  async resolve(key) {
    if (!validKey(key)) throw new Error('Invalid library entry key.');
    if (!this.files.has(key)) await this.scan();
    try {
      const name = this.files.get(key);
      if (!name) throw new Error('Missing');
      const file = await this.safeFile(name), document = validateDocument(JSON.parse(await readFile(file, 'utf8')));
      if (entryKey(name, document.id) !== key) throw new Error('Changed identity');
      return { key, file, document };
    } catch { throw new Error('This library entry is missing, changed, or unreadable. Refresh the library; its original file has not been replaced.'); }
  }
  async locked(fn) {
    const lock = await acquireLock(join(await this.root(), 'library.json.lock'), { attempts: 50 });
    try { return await fn(); } finally { await lock.release(); }
  }
  async writeMetadata(metadata) {
    metadata.revision++;
    try { await atomicWrite(join(await this.root(), 'library.json'), JSON.stringify(metadata, null, 2)); }
    catch { throw new Error('Could not save library metadata. Your saved journeys are preserved.'); }
  }
  async update(key, patch, revision) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.entries(patch).some(([name, value]) => !['pinned', 'archived'].includes(name) || typeof value !== 'boolean')) throw new Error('Invalid library metadata change.');
    return this.locked(async () => {
      await this.resolve(key); const metadata = await this.metadata();
      if (revision !== metadata.revision) throw new Error('The library changed. Refresh it and try again.');
      metadata.entries[key] = { pinned: false, archived: false, lastOpenedAt: null, ...metadata.entries[key], ...patch };
      await this.writeMetadata(metadata);
    });
  }
  async opened(key, binding) {
    return this.locked(async () => {
      const record = await this.resolve(key), metadata = await this.metadata();
      metadata.entries[key] = { pinned: false, archived: false, ...metadata.entries[key], lastOpenedAt: new Date().toISOString() };
      if (binding) metadata.bindings[hash(binding)] = key;
      await this.writeMetadata(metadata); return record;
    });
  }
  async bound(binding) {
    if (!binding) return null;
    const metadata = await this.metadata(), key = metadata.bindings[hash(binding)];
    if (key) return this.resolve(key);
    // Old canvases used a hash of the host attachment as their filename.
    if (/^[a-f0-9]{32}$/.test(binding)) {
      const file = join(await this.root(), `${binding}.explore.json`);
      return (await this.scan()).records.find(record => record.file === file) ?? null;
    }
    return null;
  }
  async import(document, { asCopy = false } = {}) {
    let doc = validateDocument(document);
    if (typeof asCopy !== 'boolean') throw new Error('Invalid import choice.');
    return this.locked(async () => {
      const { records } = await this.scan(), matches = records.filter(record => record.document.id === doc.id);
      if (matches.length && !asCopy) {
        if (matches.every(record => same(record.document, doc))) return matches[0];
        const metadata = await this.metadata();
        const ambiguous = ambiguousIds(records);
        return { conflict: matches.map(record => this.summary(record, metadata, ambiguous)) };
      }
      doc = importedDocument(doc);
      if (asCopy) { doc.id = randomUUID(); doc.revision = 0; doc.finishedAt = null; doc.createdAt = doc.updatedAt = new Date().toISOString(); }
      const name = `journey-${hash(doc.id)}.explore.json`, file = join(await this.root(), name);
      // Never replace an unreadable file or a legacy collision at the canonical name.
      try { await lstat(file); throw new Error('A saved file already occupies this journey identity. Import as a new copy.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await this.metadata();
      try { await atomicWrite(file, JSON.stringify(doc, null, 2)); }
      catch { throw new Error('Could not save the imported journey. Existing saved files are preserved.'); }
      const key = entryKey(name, doc.id); this.files.set(key, basename(file));
      return { key, file, document: doc };
    });
  }
}
