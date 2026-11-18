import { History } from './history.mjs';
import { discoverVersions } from './recovery.mjs';
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

/** Persistence adapter only. Host metadata, scope selection and UI are callers' work. */
export class ProjectJourney {
  constructor(context, { write = atomicWrite, historyWrite = atomicWrite } = {}) {
    if (context?.scope !== 'project') throw Error('Project storage context required.');
    this.context = context; this.write = write; this.queue = Promise.resolve(); this.document = null;
    this.history = new History(context.directory, context.key, context.journeyId, { write: historyWrite, validate: validateProjectWorkingDocument });
  }
  transact(work) {
    const result = this.queue.then(() => this.context.withLock(work));
    this.queue = result.catch(() => {}); return result;
  }
  checkIdentity(shared) {
    if (shared.journey.id !== this.context.journeyId) throw Error('Project journey identity changed. Reopen the saved document.');
  }
  accept(read, revision) {
    this.document = working(read.document, revision); this.shared = read.document; this.baseDigest = read.baseDigest;
    return this.document;
  }
  async current() {
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
  async create(document) {
    validateProjectWorkingDocument(document);
    const prepared = prepareSharedMigration(JSON.stringify(document)); this.checkIdentity(prepared.document);
    return this.transact(() => this.context.withCreationLock(async () => {
      try { await this.context.read(); throw Error('A project document already exists. Open it or choose a different destination.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      // A reused identity with local history must be reconciled explicitly, not reset.
      if (await this.history.read('manifest.json', 128 * 1024, true) !== null || await this.history.read('intent.json', 256 * 1024, true) !== null) throw Error('Local history already exists for this journey. Reopen or recover it before creating a copy.');
      await this.history.reconcile(working(prepared.document, 0));
      await this.context.assertCurrent(); await this.write(this.context.file, prepared.content);
      this.accept(readSharedDocument(prepared.content), 0); return this.document;
    }));
  }
  async save(candidate, { baseDigest, label = 'Map updated' } = {}) {
    validateProjectWorkingDocument(candidate);
    candidate = structuredClone(candidate);
    return this.transact(async () => {
      const current = await this.current();
      if (candidate.revision !== current.working.revision) throw Error('Local working revision changed. Reopen before saving.');
      for (const key of ['id', 'rootId', 'createdAt']) if (candidate[key] !== current.working[key]) throw Error('Journey identity cannot be changed by saving.');
      let next = envelope(candidate);
      // Preserve optional envelope presence; never insert extensions on an unchanged save.
      if (!Object.hasOwn(current.document, 'extensions')) delete next.extensions;
      let prepared = prepareSharedWrite(current.content, next, baseDigest);
      if (!prepared.changed) {
        await this.history.reconcile(current.working); this.accept(current, current.working.revision); return false;
      }
      const revision = current.working.revision + 1;
      if (!Number.isSafeInteger(revision)) throw Error('Local revision limit reached.');
      next = structuredClone(next);
      next.journey.updatedAt = new Date(Math.max(Date.now(), Date.parse(current.working.updatedAt) + 1)).toISOString();
      prepared = prepareSharedWrite(current.content, next, baseDigest);
      const read = readSharedDocument(prepared.content), after = working(read.document, revision);
      await this.history.commit(current.working, after, label, async () => {
        const fresh = await this.context.read();
        if (readSharedDocument(fresh.bytes).baseDigest !== current.baseDigest) throw Error('Project document changed before save. Existing content and local recovery are preserved.');
        await this.context.assertCurrent(); await this.write(this.context.file, prepared.content);
        this.accept(read, revision);
      });
      return true;
    });
  }
  versions(selected) {
    return this.transact(() => discoverVersions(this.context.directory, this.context.key, id => id === this.context.journeyId, selected, { validate: validateProjectWorkingDocument }));
  }
  record() { return { key: this.context.key, id: this.context.journeyId, file: this.context.file, topic: this.document?.topic.slice(0, 160) ?? 'Project journey' }; }
  retention() {
    return new StorageManagement(this.context.directory, { validate: validateProjectWorkingDocument,
      externalDocument: { ...this.record(), lockFile: this.context.lockFile, read: async () => {
        const current = await this.current(); return { stamp: current.stamp, document: current.working };
      } } });
  }
}
