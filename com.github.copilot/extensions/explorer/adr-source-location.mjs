import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual as equal } from 'node:util';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { ProjectGitStatus } from './project-git-status.mjs';
import { projectDocumentAccess } from './storage-context.mjs';
import { readSharedDocument, MAX_SHARED_BYTES } from './shared-document.mjs';
import { validateProjectPath } from './project-path.mjs';
import { adrFilePath } from './adr-file.mjs';

const exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const changed = () => { throw Error('The source journey, checkout or ADR destination location changed or is unavailable. Review again before writing.'); };

/** Local evidence only. No Git writes, content filters, lazy fetches or replacement of historical receipts. */
export async function captureAdrSourceLocation(explorer, target, { run = exec } = {}) {
  const store = explorer.projectStore;
  if (!store) return { location: {}, assertCurrent: async () => {} };
  const repository = explorer.projectRepository;
  if (!repository) changed();
  let selected, access, before;
  try {
    selected = await repository.selection(store.context.relativePath, false);
    if (selected.checkoutDirectory !== store.context.checkoutDirectory || !equal(await repository.project.root(), target.root)) changed();
    access = await projectDocumentAccess(selected); before = await access.read();
    if (before.stamp !== store.fileStamp || hash(before.bytes) !== store.baseDigest) changed();
  } catch { changed(); }
  const adrPath = relative(selected.checkoutDirectory, join(target.root.path, target.path)).split(sep).join('/');
  validateProjectPath(adrPath); adrFilePath(adrPath);
  const assertCurrent = async () => {
    try {
      if (explorer.closed || explorer.projectStore !== store || !equal(await repository.project.root(), target.root)) changed();
      await selected.revalidate(); await store.context.assertCurrent();
      const after = await access.read();
      if (after.stamp !== before.stamp || hash(after.bytes) !== hash(before.bytes) || explorer.closed || explorer.projectStore !== store) changed();
    } catch { changed(); }
  };
  let commit = null;
  try {
    const observed = await new ProjectGitStatus(repository, store, { run }).read();
    if (observed.source === 'saved' && observed.git.state === 'available' && observed.git.file === 'committed' && observed.git.head) {
      const options = { env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))), windowsHide: true, timeout: 5000, maxBuffer: MAX_SHARED_BYTES + 1024, encoding: 'buffer' };
      const args = ['--no-optional-locks', '--no-lazy-fetch', '--literal-pathspecs', '-C', selected.checkoutDirectory, '-c', 'core.fsmonitor=false', 'cat-file', 'blob', `${observed.git.head}:${selected.relativePath}`];
      const blob = (await run('git', args, options)).stdout;
      if (equal(readSharedDocument(blob).document, readSharedDocument(before.bytes).document)) commit = observed.git.head;
    }
  } catch { /* Unavailable Git evidence never invents a committed source revision. */ }
  await assertCurrent();
  return { location: { journeyPath: selected.relativePath, adrPath, commit }, assertCurrent };
}
