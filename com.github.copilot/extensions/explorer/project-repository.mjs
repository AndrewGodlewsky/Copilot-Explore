import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, isAbsolute, sep } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ProjectContext } from './project-context.mjs';
import { directoryState, projectDocumentAccess, projectStorageContext } from './storage-context.mjs';
import { ProjectJourney } from './project-journey.mjs';
import { readSharedDocument } from './shared-document.mjs';

const exec = promisify(execFile), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const gitOptions = () => ({ env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))), windowsHide: true, timeout: 5000, maxBuffer: 65536 });
async function gitIdentity(directory) {
  const read = async args => {
    try { return (await exec('git', ['-C', directory, ...args], gitOptions())).stdout.trim(); }
    catch (error) { if (error.code === 1) return null; throw Error('Git checkout identity is unavailable. Refresh from the intended repository.'); }
  };
  const branch = await read(['symbolic-ref', '--quiet', 'HEAD']), head = await read(['rev-parse', '--verify', '--quiet', 'HEAD']);
  if ((!branch && !head) || head !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) throw Error('Git checkout identity is unavailable.');
  return { branch, head };
}
function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || isAbsolute(value) || /[\\:\x00-\x1f\x7f<>"|?*]/.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw Error('Use a project-relative path with forward slashes and ordinary folder names. Traversal, Git metadata and special paths are excluded.');
  return value;
}
export { relativePath as validateProjectPath };
export class ProjectRepository {
  constructor({ readRoot, localDirectory }) { this.project = new ProjectContext(readRoot); this.localDirectory = localDirectory; }
  async checkout() {
    const working = await this.project.root();
    let output;
    try {
      // Ambient GIT_DIR/WORK_TREE/config overrides must not redirect discovery.
      output = (await exec('git', ['-C', working.path, 'rev-parse', '--show-toplevel'], gitOptions())).stdout.trim();
    } catch { throw Error('The attached project is not an available Git repository. Use Personal storage or reopen Explorer in a local repository with Git available.'); }
    const checkout = await directoryState(output), part = relative(checkout.path, working.path);
    if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`) || !same(working, await this.project.root())) throw Error('The active project changed while resolving its repository. Retry from the intended checkout.');
    return { ...checkout, git: await gitIdentity(checkout.path) };
  }
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
