import { opendir } from 'node:fs/promises';
import { resolve, relative, sep, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';
import { validateExplorationSource } from './shared-document.mjs';

export const VALIDATION_LIMITS = Object.freeze({ files: 100, directoryEntries: 1000, totalBytes: 64 * 1024 * 1024 });
const usage = 'Usage: node validate.mjs [--folder RELATIVE_FOLDER] [--] FILE...\nExplicit paths must be inside the current directory. Folder discovery is direct *.explore.json files only. Limits: 100 files, 1000 directory entries, 9 MiB/file, 64 MiB total. No files are rewritten.';
const cleanError = error => error.code === 'ENOENT' ? 'File or folder does not exist.' : error.code ? 'File or folder is unavailable; check permissions and path.' : error.message.replace(/^Cannot edit this shared exploration: /, '');

export async function runValidation(args, { cwd = process.cwd(), write = line => process.stdout.write(line + '\n') } = {}) {
  if (args.length === 1 && args[0] === '--help') { write(usage); return 0; }
  let folder, literal = false; const requested = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && arg === '--folder' && folder === undefined && args[i + 1] && !args[i + 1].startsWith('--')) { folder = args[++i]; continue; }
    if (!literal && arg.startsWith('-')) { write(usage); return 2; }
    requested.push(arg);
  }
  if (!requested.length && folder === undefined) { write(usage); return 2; }
  try {
    const root = await directoryState(resolve(cwd));
    const scoped = input => {
      if (typeof input !== 'string' || !input || input.includes('\0')) throw Error('Invalid path.');
      const path = resolve(root.path, input), part = relative(root.path, path);
      if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`)) throw Error('Paths must be inside the current directory. Change directory before validating another repository.');
      return path;
    };
    const files = requested.map(scoped);
    if (folder !== undefined) {
      const directory = await directoryState(scoped(folder)); let count = 0;
      for await (const entry of await opendir(directory.path)) {
        if (++count > VALIDATION_LIMITS.directoryEntries) throw Error('Directory discovery limit reached (1000 entries). Select a smaller folder or explicit files. Validation is incomplete.');
        if (entry.name.endsWith('.explore.json')) files.push(join(directory.path, entry.name));
        if (files.length > VALIDATION_LIMITS.files) throw Error('File discovery limit reached (100 files). Validate smaller groups. Validation is incomplete.');
      }
      if ((await directoryState(directory.path)).identity !== directory.identity) throw Error('Folder identity changed during discovery. Retry validation.');
    }
    const unique = [...new Map(files.map(file => [process.platform === 'win32' ? file.toLowerCase() : file, file])).values()].sort();
    if (unique.length > VALIDATION_LIMITS.files) throw Error('File limit reached (100 files). Validate smaller groups. Validation is incomplete.');
    let valid = 0, invalid = 0, bytes = 0;
    const readLimit = () => { write('INVALID: total read limit reached (64 MiB). Validate smaller groups. Validation is incomplete.'); return 1; };
    for (const file of unique) {
      if (bytes >= VALIDATION_LIMITS.totalBytes) return readLimit();
      const label = JSON.stringify(relative(root.path, file).split(sep).join('/'));
      try {
        const access = await projectDocumentAccess({ checkoutDirectory: root.path, file });
        const source = (await access.read({ maxBytes: VALIDATION_LIMITS.totalBytes - bytes, onRead: count => { bytes += count; } })).bytes;
        if (/^(?:<<<<<<< |=======\r?$|>>>>>>> )/m.test(source.toString('utf8'))) throw Error('Unresolved Git merge/conflict markers. Resolve the file before validation.');
        const result = validateExplorationSource(source); valid++;
        write(`VALID ${label}: ${result.format} v${result.version}, ${result.nodes} nodes.`);
      } catch (error) { if (error.readLimit) return readLimit(); invalid++; write(`INVALID ${label}: ${JSON.stringify(cleanError(error))}`); }
    }
    write(`${valid} valid, ${invalid} invalid. Structural validity does not establish decision quality. No files changed.`);
    return invalid ? 1 : 0;
  } catch (error) { write(`INVALID: ${JSON.stringify(cleanError(error))}`); return 1; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runValidation(process.argv.slice(2));
