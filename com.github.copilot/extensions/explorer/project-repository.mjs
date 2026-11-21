import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ProjectContext } from './project-context.mjs';
import { directoryState, projectDocumentAccess, projectStorageContext } from './storage-context.mjs';
import { ProjectJourney } from './project-journey.mjs';
import { readSharedDocument } from './shared-document.mjs';
import { validateProjectPath as relativePath } from './project-path.mjs';
import { readProjectCheckout } from './project-checkout.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export { relativePath as validateProjectPath };
export class ProjectRepository {
  constructor({ readRoot, localDirectory }) { this.project = new ProjectContext(readRoot); this.localDirectory = localDirectory; }
  async checkout() { return readProjectCheckout(this.project); }
  async selection(path, create) {
    relativePath(path);
    const checkout = await this.checkout();
    const revalidate = async () => { if (!same(checkout, await this.checkout())) throw Error('The active project checkout changed. Reopen the intended project journey before saving.'); };
    const selected = { checkoutDirectory: checkout.path, file: join(checkout.path, ...path.split('/')), localDirectory: this.localDirectory, revalidate, relativePath: path };
    if (create) await this.prepareParents(selected);
    return selected;
  }
  async prepareParents(selected) {
    let parent = selected.checkoutDirectory;
    for (const part of selected.relativePath.split('/').slice(0, -1)) {
      await selected.revalidate(); await directoryState(parent);
      parent = join(parent, part);
      await mkdir(parent).catch(error => { if (error.code !== 'EEXIST') throw Error('Project folder is not writable. Existing content is preserved; choose another folder or Personal storage.'); });
      await directoryState(parent);
    }
  }
  async create(document, folder = '.explorer/journeys') {
    relativePath(folder);
    const selected = await this.selection(`${folder}/${document.id}.explore.json`, false);
    return this.createSelected(document, selected);
  }
  async createSelected(document, selected, options) {
    await selected.revalidate(); await this.prepareParents(selected);
    const context = await projectStorageContext({ ...selected, journeyId: document.id });
    const store = new ProjectJourney(Object.freeze({ ...context, relativePath: selected.relativePath }));
    await store.create(document, options); return store;
  }
  async open(path) {
    if (typeof path !== 'string' || !path.endsWith('.explore.json')) throw Error('Use the project-relative path of a shared .explore.json file.');
    return this.openSelected(await this.selection(path, false));
  }
  async openSelected(selected) {
    await selected.revalidate(); const access = await projectDocumentAccess(selected);
    const read = readSharedDocument((await access.read()).bytes);
    const context = await projectStorageContext({ ...selected, journeyId: read.document.journey.id });
    return new ProjectJourney(Object.freeze({ ...context, relativePath: selected.relativePath })).load();
  }
}
