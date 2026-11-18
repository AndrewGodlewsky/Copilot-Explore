import { acquireLock } from './owned-lock.mjs';
import { questionCounts } from './web/answer-state.mjs';
import { localDate, validReviewDate, REVISIT_FILTERS, revisitSummary } from './web/revisit.mjs';
import { mkdir, readdir, lstat, realpath, readFile, opendir, open } from 'node:fs/promises';
import { Drafts } from './drafts.mjs';
import { searchFilters, matchSearch, SEARCH_PAGE_SIZE } from './web/search.mjs';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateDocument, importedDocument, MAX_DOCUMENT_BYTES } from './model.mjs';
import { atomicWrite } from './storage.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const searchFingerprint = document => hash(JSON.stringify(document));
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const entryKey = (name, id) => hash(`${name}\0${id}`);
const emptyMetadata = () => ({ version: 1, revision: 0, entries: {}, bindings: {} });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function validateLibraryMetadata(value) {
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.entries || !value.bindings || typeof value.entries !== 'object' || typeof value.bindings !== 'object' || Array.isArray(value.entries) || Array.isArray(value.bindings)) throw new Error('Invalid metadata.');
  for (const [key, entry] of Object.entries(value.entries)) {
    if (!validKey(key) || !entry || typeof entry.pinned !== 'boolean' || typeof entry.archived !== 'boolean' || (entry.lastOpenedAt !== null && (typeof entry.lastOpenedAt !== 'string' || !Number.isFinite(Date.parse(entry.lastOpenedAt))))) throw new Error('Invalid metadata.');
    value.entries[key] = { pinned: entry.pinned, archived: entry.archived, lastOpenedAt: entry.lastOpenedAt };
  }
  for (const [key, entry] of Object.entries(value.bindings)) if (!validKey(key) || !validKey(entry)) throw new Error('Invalid binding.');
  return value;
}
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
      return validateLibraryMetadata(value);
    } catch (error) {
      if (error.code === 'ENOENT') return emptyMetadata();
      throw new Error('Library metadata could not be read. It has been preserved; restore library.json before changing the library.');
    }
  }
  summary(record, metadata, ambiguous, today = localDate()) {
    const { key, document: doc } = record;
    return { key, id: doc.id, topic: doc.topic, updatedAt: doc.updatedAt, nodeCount: doc.nodes.length, questionCount: questionCounts(doc).total,
      pinned: false, archived: false, lastOpenedAt: null, ...metadata.entries[key],
      ambiguous: ambiguous.has(doc.id), revisit: revisitSummary(doc.nodes, today) };
  }
  async list({ search = '', archived = false, reminder = 'all', today = localDate() } = {}) {
    if (typeof search !== 'string' || search.length > 4000 || typeof archived !== 'boolean') throw new Error('Invalid library filter.');
    if (!Object.hasOwn(REVISIT_FILTERS, reminder) || !validReviewDate(today)) throw new Error('Invalid library reminder filter or local date.');
    const { records, errors } = await this.scan();
    let metadata;
    try { metadata = await this.metadata(); } catch (error) { metadata = emptyMetadata(); errors.push({ message: error.message }); }
    const ambiguous = ambiguousIds(records);
    const entries = records.map(record => this.summary(record, metadata, ambiguous, today))
      .filter(entry => entry.archived === archived && entry.topic.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      .filter(entry => reminder === 'all' || entry.revisit.counts[reminder] > 0)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.lastOpenedAt ?? b.updatedAt) - Date.parse(a.lastOpenedAt ?? a.updatedAt) || a.key.localeCompare(b.key));
    return { revision: metadata.revision, entries, errors };
  }
  async search(input = {}) {
    if (this.searching) throw new Error('A local search is still running. Retry after it finishes.');
    this.searching = true;
    try { return await this.searchPage(input); } finally { this.searching = false; }
  }
  async searchPage(input) {
    const filters = searchFilters(input), query = hash(JSON.stringify(filters)), names = [];
    let enumerated = 0, truncated = false;
    for await (const entry of await opendir(await this.root())) {
      if (++enumerated > 2000) { truncated = true; break; }
      if (entry.name.endsWith('.explore.json')) names.push(entry.name);
    }
    names.sort();
    const directory = hash(JSON.stringify([names, truncated])), cursor = input.cursor;
    if (cursor !== undefined && cursor !== null && (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).sort().join(',') !== 'directory,file,node,query,source' || cursor.directory !== directory || cursor.query !== query || !Number.isInteger(cursor.file) || cursor.file < 0 || cursor.file >= names.length || !Number.isInteger(cursor.node) || cursor.node < 0 || cursor.node > 10000 || !(cursor.source === null && cursor.node === 0 || validKey(cursor.source)))) throw new Error('Search sources or filters changed. Refresh search from the beginning.');
    const metadata = await this.metadata(), errors = [], results = [];
    let draftEntries = [];
    if (filters.drafts || filters.draftText) {
      try { draftEntries = (await new Drafts(this.directory).read()).entries.filter(e => e.text !== null); }
      catch { errors.push({ message: 'Private draft storage could not be read; draft matches are incomplete. Saved files are preserved.' }); }
    }
    const drafts = new Map(draftEntries.map(e => [JSON.stringify([e.key, e.nodeId]), e.text]));
    let fileIndex = cursor?.file ?? 0, nodeIndex = cursor?.node ?? 0, examined = 0, bytes = 0, next = null;
    for (; fileIndex < names.length; fileIndex++, nodeIndex = 0) {
      if (examined >= 16 || bytes + MAX_DOCUMENT_BYTES + 1 > 32 * 1024 * 1024) { next = { directory, query, file: fileIndex, node: 0, source: null }; break; }
      examined++;
      let document, key, source;
      try {
        const name = names[fileIndex], file = await this.safeFile(name), handle = await open(file, 'r');
        try {
          const before = await handle.stat(), buffer = Buffer.alloc(Math.min(before.size + 1, MAX_DOCUMENT_BYTES + 1));
          let size = 0;
          while (size < buffer.length) { const read = await handle.read(buffer, size, buffer.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; bytes += read.bytesRead; }
          const after = await handle.stat(), current = await lstat(await this.safeFile(name));
          if (size > MAX_DOCUMENT_BYTES || size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || current.size !== before.size) throw new Error('Source changed');
          document = validateDocument(JSON.parse(buffer.subarray(0, size).toString('utf8')));
        } finally { await handle.close(); }
        key = entryKey(name, document.id); source = searchFingerprint(document); this.files.set(key, name);
      } catch {
        if (cursor?.file === fileIndex && cursor.source) throw new Error('Search source changed. Refresh search from the beginning.');
        errors.push({ message: 'A saved journey could not be searched (missing, changed, unreadable or oversized). Refresh after restoring it; other matches remain available.' }); continue;
      }
      if (cursor?.file === fileIndex && cursor.source && (cursor.source !== source || nodeIndex >= document.nodes.length)) throw new Error('Search source changed. Refresh search from the beginning.');
      if ((metadata.entries[key]?.archived ?? false) !== filters.archived) continue;
      for (; nodeIndex < document.nodes.length; nodeIndex++) {
        const node = document.nodes[nodeIndex], match = matchSearch(node, filters, { topic: document.topic, draft: drafts.get(JSON.stringify([key, node.id])) });
        if (!match) continue;
        if (results.length === SEARCH_PAGE_SIZE) { next = { directory, query, file: fileIndex, node: nodeIndex, source }; break; }
        results.push({ key, source, nodeId: node.id, topic: document.topic.slice(0, 160), question: node.question.slice(0, 240), ...match });
      }
      if (next) break;
    }
    return { results, errors, next, examined, bytes, truncated, discovered: names.length };
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
  async opened(key, binding, expected) {
    return this.locked(async () => {
      const record = await this.resolve(key);
      if (expected !== undefined && (!expected || expected.key !== key || !validKey(expected.source) || expected.source !== searchFingerprint(record.document) || typeof expected.nodeId !== 'string' || !record.document.nodes.some(n => n.id === expected.nodeId))) throw new Error('This search result changed. Refresh search before opening it.');
      const metadata = await this.metadata();
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
