import { History } from './history.mjs';
import { discoverVersions, recoveryRead, boundedNames } from './recovery.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { StorageManagement } from './storage-management.mjs';
import { atomicWrite } from './storage.mjs';
import { FORMAT } from './model.mjs';
import { SHARED_FORMAT, SHARED_VERSION, readSharedDocument, prepareSharedWrite, prepareSharedMigration, validateSharedDocument } from './shared-document.mjs';

const envelope = value => {
  const { format, version, revision, ...journey } = value;
  if (format !== FORMAT || version !== 1 || !Number.isSafeInteger(revision) || revision < 0) throw Error('Invalid local working document.');
  return { format: SHARED_FORMAT, version: SHARED_VERSION, journey, extensions: {} };
};
export function validateProjectWorkingDocument(value) { validateSharedDocument(envelope(value)); return value; }
const working = (shared, revision) => ({ format: FORMAT, version: 1, revision, ...shared.journey });
const hash = value => createHash('sha256').update(value).digest('hex');
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Persistence adapter only. Host metadata, scope selection and UI are callers' work. */
export class ProjectJourney {
  constructor(context, { write = atomicWrite, historyWrite = atomicWrite } = {}) {
    if (context?.scope !== 'project') throw Error('Project storage context required.');
    this.context = context; this.write = write; this.queue = Promise.resolve(); this.document = null;
    this.historyWrite = historyWrite;
    this.history = new History(context.directory, context.key, context.journeyId, { write: historyWrite, validate: validateProjectWorkingDocument });
  }
  newHistory(key) { return new History(this.context.directory, key, this.context.journeyId, { write: this.historyWrite, validate: validateProjectWorkingDocument }); }
  async selectHistory() {
    await this.context.assertPrivate(); let key = this.context.key, selectedPointer = false;
    try {
      const pointer = JSON.parse(await recoveryRead(this.context.directory, 'history-state.json', 4096));
      if (pointer?.version !== 1 || Object.keys(pointer).sort().join(',') !== 'key,version' || !validKey(pointer.key)) throw Error('Invalid private history selection. Preserve files and use Recovery.');
      key = pointer.key; selectedPointer = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this.context.assertPrivate();
    const selected = this.history.key === key ? this.history : this.newHistory(key);
    if (selectedPointer) selected.validate(JSON.parse(await selected.read('manifest.json', 128 * 1024)));
    this.history = selected;
    return this.history;
  }
  transactPrivate(work) {
    const result = this.queue.then(() => this.context.withPrivateLock(work));
    this.queue = result.catch(() => {}); return result;
  }
  transact(work) {
    const result = this.queue.then(() => this.context.withLock(work));
    this.queue = result.catch(() => {}); return result;
  }
  checkIdentity(shared) {
    if (shared.journey.id !== this.context.journeyId) throw Error('Project journey identity changed. Reopen the saved document.');
  }
  accept(read, revision) {
    this.document = working(read.document, revision); this.shared = read.document; this.baseDigest = read.baseDigest; this.fileStamp = read.stamp ?? null;
    return this.document;
  }
  async acceptWritten(read, revision) {
    const source = await this.context.read();
    if (readSharedDocument(source.bytes).baseDigest !== read.baseDigest) throw Error('Project content changed immediately after saving. Preserve recovery and refresh.');
    return this.accept({ ...read, stamp: source.stamp }, revision);
  }
  async current() {
    await this.selectHistory();
    const source = await this.context.read(), read = readSharedDocument(source.bytes); this.checkIdentity(read.document);
    const raw = await this.history.read('manifest.json', 128 * 1024, true);
    let revision = 0;
    if (raw !== null) {
      const manifest = this.history.validate(JSON.parse(raw)), heads = [manifest.head];
      const intent = await this.history.read('intent.json', 256 * 1024, true);
      if (intent !== null) heads.push(this.history.validate(JSON.parse(intent).manifest).head);
      const matched = heads.find(head => this.history.row(working(read.document, head.revision), head.label).hash === head.hash);
      if (!matched) throw Error('Shared content changed outside local history. Keep drafts and recovery data; refresh/reconciliation is required before editing.');
      revision = matched.revision;
    }
    return { ...read, stamp: source.stamp, working: working(read.document, revision) };
  }
  async load() {
    await this.transact(async () => {
      const current = await this.current(); await this.history.reconcile(current.working);
      this.accept(current, current.working.revision);
    });
    return this;
  }
  async create(document, { beforeWrite = async () => {} } = {}) {
    validateProjectWorkingDocument(document);
    const prepared = prepareSharedMigration(JSON.stringify(document)); this.checkIdentity(prepared.document);
    return this.transact(() => this.context.withCreationLock(async () => {
      await this.selectHistory();
      try { await this.context.read(); throw Error('A project document already exists. Open it or choose a different destination.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      // A reused identity with local history must be reconciled explicitly, not reset.
      const manifest = await this.history.read('manifest.json', 128 * 1024, true);
      if (await this.history.read('intent.json', 256 * 1024, true) !== null || manifest !== null && this.history.validate(JSON.parse(manifest)).head.hash !== this.history.row(working(prepared.document, 0), 'Initial version').hash) throw Error('Local history already exists for this journey. Reopen or recover it before creating a copy.');
      await this.history.reconcile(working(prepared.document, 0));
      await beforeWrite(); await this.context.assertCurrent();
      try { await this.context.read(); throw Error('A project document already exists. Open it or choose a different destination.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await this.write(this.context.file, prepared.content);
      await this.acceptWritten(readSharedDocument(prepared.content), 0); return this.document;
    }));
  }
  async save(candidate, options) {
    validateProjectWorkingDocument(candidate); candidate = structuredClone(candidate); options = { ...options };
    return this.transact(() => this.saveLocked(candidate, options));
  }
  async saveLocked(candidate, { baseDigest, label = 'Map updated', beforeWrite = () => {} } = {}) {
    validateProjectWorkingDocument(candidate);
    candidate = structuredClone(candidate);
    const current = await this.current();
    if (this.fileStamp && this.fileStamp !== current.stamp) throw Error('Project file identity or contents changed. Review the incoming file before saving.');
    if (candidate.revision !== current.working.revision) throw Error('Local working revision changed. Reopen before saving.');
    for (const key of ['id', 'rootId', 'createdAt']) if (candidate[key] !== current.working[key]) throw Error('Journey identity cannot be changed by saving.');
    let next = envelope(candidate);
    // Preserve optional envelope presence; never insert extensions on an unchanged save.
    if (!Object.hasOwn(current.document, 'extensions')) delete next.extensions;
    let prepared = prepareSharedWrite(current.content, next, baseDigest);
    if (!prepared.changed) {
      await this.history.reconcile(current.working);
      await beforeWrite(); await this.context.assertCurrent();
      const fresh = await this.context.read();
      if (fresh.stamp !== current.stamp || readSharedDocument(fresh.bytes).baseDigest !== current.baseDigest) throw Error('Project document changed before save. Review again.');
      this.accept(current, current.working.revision); return false;
    }
    const revision = current.working.revision + 1;
    if (!Number.isSafeInteger(revision)) throw Error('Local revision limit reached.');
    next = structuredClone(next);
    next.journey.updatedAt = new Date(Math.max(Date.now(), Date.parse(current.working.updatedAt) + 1)).toISOString();
    prepared = prepareSharedWrite(current.content, next, baseDigest);
    const read = readSharedDocument(prepared.content), after = working(read.document, revision);
    await this.history.commit(current.working, after, label, async () => {
      await beforeWrite(); await this.context.assertCurrent();
      const fresh = await this.context.read();
      if (fresh.stamp !== current.stamp || readSharedDocument(fresh.bytes).baseDigest !== current.baseDigest) throw Error('Project document changed before save. Existing content and local recovery are preserved.');
      await this.write(this.context.file, prepared.content);
      await this.acceptWritten(read, revision);
    });
    return true;
  }
  async preserveDisplayed(document) {
    validateProjectWorkingDocument(document); document = structuredClone(document);
    if (document.id !== this.context.journeyId) throw Error('Recovery journey identity changed.');
    return this.transactPrivate(async () => {
      const history = this.newHistory(hash(`preserved:${this.context.key}:${JSON.stringify(document)}`));
      const row = history.row(document, 'Preserved displayed project base'); row.checkpoints = ['Preserved displayed project base'];
      await history.store(document, row);
      const manifest = history.initial(document); manifest.entries = [row]; history.validate(manifest);
      await this.context.assertPrivate(); await history.write(join(await history.root(), 'manifest.json'), JSON.stringify(manifest));
      await history.write(join(this.context.directory, 'preserved-state.json'), JSON.stringify({ version: 1, key: history.key }));
      return { saved: true, hash: row.hash };
    });
  }
  async adoptIncoming(expectedDigest, displayed, { pointerWrite = atomicWrite, expectedStamp } = {}) {
    validateProjectWorkingDocument(displayed); displayed = structuredClone(displayed);
    return this.transact(async () => {
      const source = await this.context.read(), incoming = { ...readSharedDocument(source.bytes), stamp: source.stamp }; this.checkIdentity(incoming.document);
      if (incoming.baseDigest !== expectedDigest || expectedStamp && source.stamp !== expectedStamp) throw Error('Incoming project content or identity changed after preview. Review again.');
      for (const key of ['id', 'rootId', 'createdAt']) if (incoming.document.journey[key] !== displayed[key]) throw Error('Incoming journey identity changed. Open it separately; original drafts are preserved.');
      await this.selectHistory();
      let current;
      try { current = await this.current(); } catch { /* An external content change cannot match the old local head. */ }
      const sameDisplayed = readSharedDocument(JSON.stringify(envelope(displayed))).contentDigest === incoming.contentDigest;
      if (current && (sameDisplayed || current.working.revision > displayed.revision)) {
        if (current.baseDigest !== expectedDigest || current.stamp !== incoming.stamp) throw Error('Incoming project content or identity changed after preview.');
        await this.history.reconcile(current.working);
        const fresh = await this.context.read();
        if (fresh.stamp !== incoming.stamp || readSharedDocument(fresh.bytes).baseDigest !== expectedDigest) throw Error('Incoming project content or identity changed during reload.');
        this.accept(current, current.working.revision); return this;
      }
      const active = this.history, manifest = await active.read('manifest.json', 128 * 1024, true);
      let revision = displayed.revision;
      if (manifest !== null) revision = Math.max(revision, active.validate(JSON.parse(manifest)).head.revision);
      const intent = await active.read('intent.json', 256 * 1024, true);
      if (intent !== null) revision = Math.max(revision, active.validate(JSON.parse(intent).manifest).head.revision);
      if (!Number.isSafeInteger(revision + 1)) throw Error('Local revision limit reached. Preserve this journey and open a separate copy.');
      const before = { ...displayed, revision }, after = working(incoming.document, revision + 1);
      const staged = this.newHistory(hash(`${this.context.key}:${randomUUID()}`));
      await staged.commit(before, after, 'Reloaded external project content', async () => {
        const latestSource = await this.context.read(), latest = readSharedDocument(latestSource.bytes);
        if (latest.baseDigest !== expectedDigest || latestSource.stamp !== incoming.stamp || (await this.selectHistory()).key !== active.key) throw Error('Project content or local history changed during reload. Review again.');
        await this.context.assertCurrent();
        await pointerWrite(join(this.context.directory, 'history-state.json'), JSON.stringify({ version: 1, key: staged.key }));
        this.history = staged; this.accept(incoming, after.revision);
      });
      return this;
    });
  }
  versions(selected) {
    return this.transactPrivate(async () => {
      if (selected !== undefined && !validKey(selected)) throw Error('Invalid recovery selection.');
      let keys, unavailable = 0, document; const priority = [];
      try {
        const preserved = JSON.parse(await recoveryRead(this.context.directory, 'preserved-state.json', 4096));
        if (preserved?.version !== 1 || Object.keys(preserved).sort().join(',') !== 'key,version' || !validKey(preserved.key)) throw Error('Invalid preservation pointer.');
        priority.push(preserved.key);
      } catch (error) { if (error.code !== 'ENOENT') unavailable++; }
      try { await this.selectHistory(); } catch { unavailable++; }
      priority.push(this.history.key);
      try { keys = (await boundedNames(join(this.context.directory, 'history'), 128)).filter(validKey).sort(); }
      catch (error) { keys = []; if (error.code !== 'ENOENT') unavailable++; }
      keys = [...new Set([...priority, ...keys])];
      unavailable += Math.max(0, keys.length - 32);
      const budget = { bytes: 0, entries: 0 }, entries = new Map();
      for (const key of keys.slice(0, 32)) {
        try {
          const found = await discoverVersions(this.context.directory, key, id => id === this.context.journeyId, selected, { validate: validateProjectWorkingDocument, budget, allowMissingSelected: true });
          for (const row of found.entries) entries.set(row.hash, row);
          unavailable += found.unavailable; document ??= found.document;
        } catch { unavailable++; }
      }
      if (selected && !document) throw Error('This recoverable version is unavailable. Refresh Recovery; originals are preserved.');
      return { entries: [...entries.values()].sort((a, b) => b.revision - a.revision), unavailable, ...(document ? { document } : {}) };
    });
  }
  record() { return { key: this.history.key, id: this.context.journeyId, file: this.context.file, topic: this.document?.topic.slice(0, 160) ?? 'Project journey' }; }
  retention() {
    const key = this.history.key;
    return new StorageManagement(this.context.directory, { validate: validateProjectWorkingDocument,
      externalDocument: { ...this.record(), lockFile: this.context.lockFile, read: async () => {
        const current = await this.current(); if (this.history.key !== key) throw Error('History changed after this cleanup preview. Refresh storage.'); return { stamp: current.stamp, document: current.working };
      } } });
  }
}
