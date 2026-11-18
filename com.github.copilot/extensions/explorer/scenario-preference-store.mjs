import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { directoryState, projectDocumentAccess, projectStorageContext } from './storage-context.mjs';
import { atomicWrite, atomicCreate } from './storage.mjs';
import { acquireLock } from './owned-lock.mjs';
import { preferenceKey, readPreference, nextPreference, PREFERENCE_LIMIT } from './scenario-preference.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const changed = () => { throw Error('Scenario preference storage or selection changed. Refresh before choosing again.'); };

class PreferenceStore {
  constructor(options) { Object.assign(this, options); this.replace = atomicWrite; this.create = atomicCreate; }
  async parentState(create = false) {
    await this.revalidate();
    let current;
    try { current = await directoryState(dirname(this.file)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (this.parent) changed();
      if (!create) return null;
      await this.prepare(); await this.revalidate(); current = await directoryState(dirname(this.file));
    }
    if (this.parent && !same(this.parent, current)) changed();
    this.parent = current; return current;
  }
  async read() {
    if (!await this.parentState()) return readPreference(null, this.family, this.scope);
    try {
      const access = await projectDocumentAccess({ checkoutDirectory: this.root, file: this.file, revalidate: this.revalidate });
      return readPreference((await access.read({ maxBytes: PREFERENCE_LIMIT })).bytes, this.family, this.scope);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.parentState(); return readPreference(null, this.family, this.scope);
    }
  }
  async update(expected, preferred, rationale, validateSource = async () => {}) {
    if (!expected || !Number.isSafeInteger(expected.value?.revision) || !(expected.digest === null || /^[a-f0-9]{64}$/.test(expected.digest))) changed();
    await this.parentState(true);
    return this.locked(async () => {
      const check = value => { if (value.digest !== expected.digest || value.value.revision !== expected.value.revision) changed(); };
      const current = await this.read(); check(current);
      const next = nextPreference(current.value, preferred, rationale), content = JSON.stringify(next) + '\n';
      // One line deliberately keeps competing Git selections in the same hunk.
      if (Buffer.byteLength(content) > PREFERENCE_LIMIT) throw Error('Scenario preference exceeds its 256 KiB limit. Existing history is preserved.');
      await validateSource(); check(await this.read());
      await (current.digest === null ? this.create : this.replace)(this.file, content);
      return this.read();
    });
  }
}

export async function personalPreferenceStore(library, family) {
  const root = await directoryState(await library.root()), key = preferenceKey(family);
  const revalidate = async () => { if (!same(root, await directoryState(root.path))) changed(); };
  const file = join(root.path, 'scenario-preferences', `${key}.json`);
  const prepare = async () => { await revalidate(); await mkdir(dirname(file)).catch(error => { if (error.code !== 'EEXIST') throw error; }); };
  const locked = async work => {
    await revalidate(); const lock = await acquireLock(file + '.lock', { attempts: 50 });
    try { await revalidate(); return await work(); } finally { await lock.release(); }
  };
  return new PreferenceStore({ scope: 'personal', family, root: root.path, file, revalidate, prepare, locked });
}

export async function projectPreferenceStore(repository, active, family) {
  if (active?.context.scope !== 'project') throw Error('Open the shared scenario before choosing a Project preference.');
  const context = active.context, key = preferenceKey(family), relativePath = `.explorer/scenarios/${key}.json`;
  const revalidate = () => context.assertCurrent();
  const selected = { checkoutDirectory: context.checkoutDirectory, file: join(context.checkoutDirectory, '.explorer', 'scenarios', `${key}.json`), relativePath, localDirectory: repository.localDirectory, revalidate };
  const prepare = () => repository.prepareParents(selected);
  const locked = async work => {
    const preferenceContext = await projectStorageContext({ ...selected, journeyId: `preference-${key}` });
    return preferenceContext.withLock(work);
  };
  return new PreferenceStore({ scope: 'project', family, root: selected.checkoutDirectory, file: selected.file, relativePath, revalidate, prepare, locked });
}
