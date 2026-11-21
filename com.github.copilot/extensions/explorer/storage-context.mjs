import { mkdir, lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, relative, dirname, basename, parse, sep, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { acquireLock } from './owned-lock.mjs';
import { MAX_SHARED_BYTES } from './shared-document.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const identity = stat => [stat.dev, stat.ino, stat.birthtimeNs].join(':');
const stamp = stat => [identity(stat), stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(':');
const comparable = path => process.platform === 'win32' ? path.toLowerCase() : path;
const inside = (root, path) => { const part = relative(root, path); return !part || !part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part); };
const absolute = path => {
  if (typeof path !== 'string' || !isAbsolute(path) || path.startsWith('\\\\') || path.includes('\0')) throw Error('Storage needs an absolute local path.');
  return resolve(path);
};
export async function directoryState(directory, create = false) {
  directory = absolute(directory);
  let path = parse(directory).root; const ancestors = [];
  for (const part of ['', ...relative(path, directory).split(sep).filter(Boolean)]) {
    path = join(path, part);
    let stat;
    try { stat = await lstat(path, { bigint: true }); }
    catch (error) {
      if (!create || error.code !== 'ENOENT') throw error;
      await mkdir(path).catch(error => { if (error.code !== 'EEXIST') throw error; });
      stat = await lstat(path, { bigint: true });
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino <= 0n || stat.dev < 0n) throw Error('Storage root is linked or its identity is unavailable.');
    ancestors.push(identity(stat));
  }
  const canonical = await realpath(directory);
  if (comparable(canonical) !== comparable(directory)) throw Error('Storage root identity changed.');
  return { path: canonical, identity: ancestors.join('/') };
}

/** This context never discovers a project or moves a personal journey/draft. */
export async function projectDocumentAccess({ checkoutDirectory, file, revalidate = async () => {} }) {
  const checkout = await directoryState(absolute(checkoutDirectory)), requestedFile = absolute(file);
  if (!inside(checkout.path, requestedFile) || requestedFile === checkout.path) throw Error('The document must be inside its checkout.');
  const parent = await directoryState(dirname(requestedFile));
  file = join(parent.path, basename(requestedFile));
  const assertCurrent = async () => {
    await revalidate();
    for (const captured of [checkout, parent]) {
      const current = await directoryState(captured.path);
      if (current.identity !== captured.identity || comparable(current.path) !== comparable(captured.path)) throw Error('Storage root identity changed. Reopen the current checkout; private data was not moved.');
    }
  };
  const entry = async () => {
    await assertCurrent();
    const stat = await lstat(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.ino <= 0n || comparable(await realpath(file)) !== comparable(file)) throw Error('Project document is linked or its identity is unavailable.');
    if (stat.size > BigInt(MAX_SHARED_BYTES)) throw Error('Project document exceeds the saved-data size limit.');
    return { stamp: stamp(stat), size: Number(stat.size) };
  };
  const read = async ({ maxBytes = MAX_SHARED_BYTES + 1, onRead = () => {} } = {}) => {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || typeof onRead !== 'function') throw Error('Invalid document read budget.');
    const before = await entry();
    if (before.size > maxBytes) throw Object.assign(Error('Document exceeds the remaining read budget.'), { readLimit: true });
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (stamp(await handle.stat({ bigint: true })) !== before.stamp) throw Error('Project document changed.');
      const bytes = Buffer.alloc(Math.min(before.size + 1, maxBytes)); let count = 0;
      while (count < bytes.length) { const part = await handle.read(bytes, count, bytes.length - count, count); onRead(part.bytesRead); if (!part.bytesRead) break; count += part.bytesRead; }
      if (count !== before.size || stamp(await handle.stat({ bigint: true })) !== before.stamp || (await entry()).stamp !== before.stamp) throw Error('Project document changed while reading.');
      return { bytes: bytes.subarray(0, count), stamp: before.stamp };
    } finally { await handle.close(); }
  };
  return { file, checkout, assertCurrent, read };
}

export async function projectStorageContext({ checkoutDirectory, file, localDirectory, journeyId, revalidate }) {
  if (typeof journeyId !== 'string' || !journeyId.trim() || journeyId.trim() !== journeyId || journeyId.length > 100) throw Error('Invalid journey identity.');
  const document = await projectDocumentAccess({ checkoutDirectory, file, revalidate }), { checkout } = document;
  const localPath = absolute(localDirectory);
  if (inside(checkout.path, localPath)) throw Error('Private storage must be outside the checkout.');
  const local = await directoryState(localPath, true);
  const checkoutKey = hash(JSON.stringify([comparable(checkout.path), checkout.identity]));
  const key = hash(JSON.stringify([checkoutKey, journeyId]));
  const directory = join(local.path, 'projects', checkoutKey, hash(journeyId));
  if (inside(checkout.path, directory)) throw Error('Private storage must be outside the checkout.');
  const auxiliary = await directoryState(directory, true), lockFile = join(auxiliary.path, 'document.lock');
  const creationLockFile = join(local.path, 'projects', checkoutKey, 'create.lock');
  const assertPrivate = async () => {
    for (const captured of [local, auxiliary]) if ((await directoryState(captured.path)).identity !== captured.identity) throw Error('Private storage identity changed. Reopen the journey.');
  };
  const assertCurrent = async () => { await document.assertCurrent(); await assertPrivate(); };
  const read = async () => { await assertCurrent(); return document.read(); };
  const locked = async (path, work, check = assertCurrent) => {
    await check(); const lock = await acquireLock(path, { attempts: 50 });
    try { await check(); return await work(); } finally { await lock.release(); }
  };
  return Object.freeze({ scope: 'project', file: document.file, relativePath: relative(checkout.path, document.file).split(sep).join('/'), checkoutDirectory: checkout.path, checkoutIdentity: checkout.identity, journeyId, key,
    directory: auxiliary.path, usageDirectory: join(auxiliary.path, 'usage'), lockFile, creationLockFile, assertCurrent, assertPrivate, read,
    withLock: work => locked(lockFile, work), withPrivateLock: work => locked(lockFile, work, assertPrivate), withCreationLock: work => locked(creationLockFile, work) });
}
