import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative, isAbsolute, sep } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ProjectContext } from './project-context.mjs';
import { directoryState, projectDocumentAccess, projectStorageContext } from './storage-context.mjs';
import { ProjectJourney } from './project-journey.mjs';
import { readSharedDocument } from './shared-document.mjs';

const exec = promisify(execFile), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || isAbsolute(value) || /[\\:\x00-\x1f\x7f<>"|?*]/.test(value) ||
    value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) throw Error('Use a project-relative path with forward slashes and ordinary folder names. Traversal, Git metadata and special paths are excluded.');
  return value;
}
export class ProjectRepository {
  constructor({ readRoot, localDirectory }) { this.project = new ProjectContext(readRoot); this.localDirectory = localDirectory; }
  async checkout() {
    const working = await this.project.root();
    let output;
    try {
      // Ambient GIT_DIR/WORK_TREE/config overrides must not redirect discovery.
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
      output = (await exec('git', ['-C', working.path, 'rev-parse', '--show-toplevel'], { env, windowsHide: true, timeout: 5000, maxBuffer: 65536 })).stdout.trim();
    } catch { throw Error('The attached project is not an available Git repository. Use Personal storage or reopen Explorer in a local repository with Git available.'); }
    const checkout = await directoryState(output), part = relative(checkout.path, working.path);
    if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`) || !same(working, await this.project.root())) throw Error('The active project changed while resolving its repository. Retry from the intended checkout.');
    return checkout;
  }
  async selection(path, create) {
    relativePath(path);
    const checkout = await this.checkout();
    const revalidate = async () => { if (!same(checkout, await this.checkout())) throw Error('The active project checkout changed. Reopen the intended project journey before saving.'); };
    if (create) {
      let parent = checkout.path;
      for (const part of path.split('/').slice(0, -1)) {
        await revalidate(); await directoryState(parent);
        parent = join(parent, part);
        await mkdir(parent).catch(error => { if (error.code !== 'EEXIST') throw Error('Project folder is not writable. Existing content is preserved; choose another folder or Personal storage.'); });
        await directoryState(parent);
      }
    }
    return { checkoutDirectory: checkout.path, file: join(checkout.path, ...path.split('/')), localDirectory: this.localDirectory, revalidate, relativePath: path };
  }
  async create(document, folder = '.explorer/journeys') {
    relativePath(folder);
    const selected = await this.selection(`${folder}/${document.id}.explore.json`, true);
    const context = await projectStorageContext({ ...selected, journeyId: document.id });
    const store = new ProjectJourney(Object.freeze({ ...context, relativePath: selected.relativePath }));
    await store.create(document); return store;
  }
  async open(path) {
    if (typeof path !== 'string' || !path.endsWith('.explore.json')) throw Error('Use the project-relative path of a shared .explore.json file.');
    const selected = await this.selection(path, false), access = await projectDocumentAccess(selected);
    const read = readSharedDocument((await access.read()).bytes);
    const context = await projectStorageContext({ ...selected, journeyId: read.document.journey.id });
    return new ProjectJourney(Object.freeze({ ...context, relativePath: path })).load();
  }
}
