import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';
import { acquireLock } from './owned-lock.mjs';
import { atomicWrite } from './storage.mjs';
import { parseDocumentJson } from './shared-document.mjs';
import { validateContributor } from './contributors.mjs';

const empty = () => ({ version: 1, revision: 0, actor: null });
const preserved = () => Error('Contributor settings could not be read safely. The file has been preserved. Repair the private settings file, then refresh before editing shared decisions.');

/** The caller supplies an already trusted private directory, never a UI path. */
export class ContributorSettings {
  constructor({ directory, assertPrivate = async () => {}, write = atomicWrite }) {
    this.directory = directory; this.file = join(directory, 'contributor-settings.json'); this.assertPrivate = assertPrivate; this.write = write;
  }
  async access(create = false) {
    await this.assertPrivate();
    let current;
    try { current = await directoryState(this.directory, create && !this.root); }
    catch (error) { if (!create && !this.root && error.code === 'ENOENT') return null; throw preserved(); }
    if (this.root && this.root.identity !== current.identity) throw preserved();
    this.root ??= current;
    return projectDocumentAccess({ checkoutDirectory: this.directory, file: this.file, revalidate: async () => {
      await this.assertPrivate();
      if ((await directoryState(this.directory)).identity !== this.root.identity) throw preserved();
    } });
  }
  async read() {
    try {
      const access = await this.access();
      if (!access) return empty();
      let bytes;
      try { ({ bytes } = await access.read({ maxBytes: 4096 })); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await access.assertCurrent(); return empty(); }
      const value = parseDocumentJson(bytes).value;
      if (!value || Object.keys(value).sort().join(',') !== 'actor,revision,version' || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw preserved();
      if (value.actor !== null) validateContributor(value.actor);
      return value;
    } catch { throw preserved(); }
  }
  async save(displayName, revision) {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) throw Error('Invalid contributor settings revision.');
    const proposed = displayName === null ? null : validateContributor({ id: randomUUID(), displayName });
    const access = await this.access(true), lock = await acquireLock(this.file + '.lock');
    try {
      await access.assertCurrent();
      const saved = await this.read();
      if (saved.revision !== revision) throw Error('Contributor settings changed in another canvas. Refresh before saving.');
      if (saved.actor?.displayName === proposed?.displayName) return saved;
      const actor = proposed && { id: saved.actor?.id ?? proposed.id, displayName: proposed.displayName };
      const next = { version: 1, revision: revision + 1, actor };
      await access.assertCurrent();
      await this.write(this.file, JSON.stringify(next, null, 2));
      await access.assertCurrent();
      return next;
    } finally { await lock.release(); }
  }
}
