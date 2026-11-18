import { createHash, randomUUID } from 'node:crypto';
import { opendir, lstat } from 'node:fs/promises';
import { join, dirname, relative, isAbsolute, sep } from 'node:path';
import { Library } from './library.mjs';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';
import { readSharedDocument, MAX_SHARED_BYTES } from './shared-document.mjs';

export const PROJECT_LIBRARY_LIMITS = Object.freeze({ entries: 1000, files: 100, bytes: 64 * 1024 * 1024 });
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const signature = stat => [stat.dev, stat.ino, stat.birthtimeNs, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(':');
const changed = () => { throw Error('Project library sources changed. Refresh the project folder before selecting a journey.'); };

/** A captured project listing. Library's metadata methods write only its private directory. */
export class ProjectLibrary extends Library {
  static async capture(repository, folder = '.explorer/journeys') {
    if (typeof folder !== 'string') throw Error('Select a repository-relative exploration folder.');
    const selected = await repository.selection(`${folder}/selection.explore.json`, false), folderPath = dirname(selected.file);
    let folderState = null;
    try { folderState = await directoryState(folderPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const checkout = await directoryState(selected.checkoutDirectory), local = await directoryState(repository.localDirectory, true);
    const part = relative(checkout.path, local.path);
    if (!part || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)) throw Error('Private project metadata must be outside the checkout.');
    const checkoutKey = hash(JSON.stringify([process.platform === 'win32' ? checkout.path.toLowerCase() : checkout.path, checkout.identity]));
    const auxiliary = await directoryState(join(local.path, 'projects', checkoutKey, 'library'), true);
    const library = new ProjectLibrary(auxiliary.path);
    Object.assign(library, { repository, selected, folder, folderPath, folderState, local, auxiliary, listing: randomUUID(), records: new Map() });
    return library;
  }
  async root() {
    await this.selected.revalidate();
    for (const captured of [this.local, this.auxiliary]) if (!same(captured, await directoryState(captured.path))) throw Error('Private project library storage changed. Refresh from the intended checkout.');
    return this.directory;
  }
  async safeFile(name, limit) {
    const file = await super.safeFile(name, limit);
    if ((await lstat(file)).nlink !== 1) throw Error('Linked private metadata is unavailable.');
    return file;
  }
  async inventory() {
    let state;
    try { state = await directoryState(this.folderPath); }
    catch (error) { if (error.code === 'ENOENT' && !this.folderState) return { names: [], signatures: {}, truncated: false, missing: true }; throw error; }
    if (this.folderState && !same(state, this.folderState)) changed();
    this.folderState = state;
    const names = [], signatures = {}; let count = 0, truncated = false;
    for await (const entry of await opendir(this.folderPath)) {
      if (++count > PROJECT_LIBRARY_LIMITS.entries) { truncated = true; break; }
      if (entry.name.endsWith('.explore.json')) names.push(entry.name);
    }
    names.sort();
    for (const name of names) {
      try { signatures[name] = signature(await lstat(join(this.folderPath, name), { bigint: true })); } catch { signatures[name] = 'unavailable'; }
    }
    return { names, signatures, truncated, missing: false };
  }
  async scan() {
    await this.root(); const inventory = await this.inventory(), records = [], errors = [];
    let examined = 0, bytes = 0, partial = inventory.truncated;
    for (const name of inventory.names) {
      if (examined >= PROJECT_LIBRARY_LIMITS.files || bytes + MAX_SHARED_BYTES > PROJECT_LIBRARY_LIMITS.bytes) { partial = true; break; }
      examined++; const path = `${this.folder}/${name}`;
      try {
        const access = await projectDocumentAccess({ checkoutDirectory: this.selected.checkoutDirectory, file: join(this.folderPath, name) });
        const source = await access.read(); bytes += source.bytes.length;
        if (source.stamp !== inventory.signatures[name]) changed();
        const read = readSharedDocument(source.bytes), document = read.document.journey, key = hash(`${path}\0${document.id}`);
        records.push({ key, path, file: access.file, document, source: read.baseDigest, content: read.contentDigest });
      } catch (error) {
        errors.push({ path, message: /unsupported/i.test(error.message) ? 'Unsupported shared format or version; original preserved.' : /size limit/i.test(error.message) ? 'File exceeds the shared-data size limit; original preserved.' : 'Malformed, linked, missing or unreadable shared file; original preserved.' });
      }
    }
    await this.root(); if (!same(inventory, await this.inventory())) changed();
    const counts = new Map(); for (const row of records) counts.set(row.document.id, (counts.get(row.document.id) ?? 0) + 1);
    for (const row of records) row.duplicate = counts.get(row.document.id) > 1;
    this.inventoryCapture = inventory; this.partial = partial; this.records = new Map(records.map(row => [row.key, row]));
    return { records, errors, examined, bytes, partial, missing: inventory.missing, discovered: inventory.names.length };
  }
  async list() {
    const { records, ...coverage } = await this.scan(); let metadata;
    try { metadata = await this.metadata(); } catch (error) { metadata = { revision: 0, entries: {} }; coverage.errors.push({ message: error.message }); coverage.metadataUnavailable = true; }
    const entries = records.map(record => ({ ...this.summary(record, metadata, new Set()), path: record.path, scope: 'project', duplicate: record.duplicate }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.lastOpenedAt ?? b.updatedAt) - Date.parse(a.lastOpenedAt ?? a.updatedAt) || a.path.localeCompare(b.path));
    return { listing: this.listing, folder: this.folder, revision: metadata.revision, entries, ...coverage, limits: PROJECT_LIBRARY_LIMITS,
      coverage: coverage.partial ? 'Partial discovery: a file, entry or byte limit was reached. Choose a smaller folder before opening from this list.' : 'Only direct shared files in this folder were examined; subfolders and other project files were not read.' };
  }
  async resolve(key) {
    await this.root(); const record = this.records.get(key);
    if (!record || this.partial) throw Error('Refresh a complete project folder listing before selecting a journey.');
    if (record.duplicate) throw Error('Duplicate journey identity. Resolve the duplicate files and refresh before opening.');
    if (!same(this.inventoryCapture, await this.inventory())) changed();
    const access = await projectDocumentAccess({ checkoutDirectory: this.selected.checkoutDirectory, file: record.file, revalidate: this.selected.revalidate });
    if (readSharedDocument((await access.read()).bytes).baseDigest !== record.source) changed();
    return record;
  }
  async open(key, binding) {
    const record = await this.resolve(key), store = await this.repository.open(record.path);
    if (store.baseDigest !== record.source) changed();
    await this.opened(key, binding); return store;
  }
}
