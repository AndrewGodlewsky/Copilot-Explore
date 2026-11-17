import { opendir, lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { validateDocument, MAX_DOCUMENT_BYTES } from './model.mjs';

export const recoveryHash = value => createHash('sha256').update(value).digest('hex');
export const validRecoveryKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export async function boundedNames(directory, limit) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Recovery storage is unavailable. Originals are preserved.');
  const names = [];
  for await (const entry of await opendir(directory)) {
    if (names.length === limit) throw new Error('Recovery discovery limit reached. Files are preserved for storage review.');
    names.push(entry.name);
  }
  return names;
}
export async function recoveryRead(directory, name, max) {
  if (!/^[a-zA-Z0-9.-]+$/.test(name) || name === '.' || name === '..') throw new Error('Invalid recovery file.');
  const root = await realpath(directory), file = join(root, name), entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > max || dirname(await realpath(file)) !== root) throw new Error('Recovery file is unavailable.');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (stat.ino !== entry.ino || stat.dev !== entry.dev || !stat.isFile() || stat.nlink !== 1 || stat.size > max) throw new Error('Recovery file changed.');
    const buffer = Buffer.alloc(max + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > max) throw new Error('Recovery file exceeds its limit.');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
export async function discoverVersions(directory, key, acceptsId, selected) {
  if (!validRecoveryKey(key) || selected !== undefined && !validRecoveryKey(selected)) throw new Error('Invalid recovery selection.');
  const history = join(directory, 'history'), root = join(history, key);
  let names;
  try { await boundedNames(directory, 2000); await boundedNames(history, 2000); names = await boundedNames(root, 128); }
  catch (error) { if (error.code === 'ENOENT') return { entries: [], unavailable: 0 }; throw error; }
  const entries = []; let unavailable = 0, bytes = 0, document;
  // Manifest/intent pointers are never followed. Only content-addressed snapshots
  // under this known journey are inspected; malformed files and temps remain intact.
  for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
    if (entries.length >= 50) { unavailable++; continue; }
    try {
      bytes += (await lstat(join(root, name))).size;
      if (bytes > 128 * 1024 * 1024) throw new Error('Recovery byte limit.');
      const data = await recoveryRead(root, name, MAX_DOCUMENT_BYTES);
      if (recoveryHash(data) !== name.slice(0, -5)) throw new Error('Damaged snapshot.');
      const raw = JSON.parse(data), doc = validateDocument(raw);
      if (raw.id !== doc.id || raw.revision !== doc.revision || raw.updatedAt !== doc.updatedAt || !acceptsId(doc.id)) throw new Error('Wrong snapshot identity.');
      entries.push({ hash: name.slice(0, -5), revision: doc.revision, time: doc.updatedAt });
      if (selected === name.slice(0, -5)) document = doc;
    } catch { unavailable++; }
  }
  if (selected !== undefined && !document) throw new Error('This recoverable version is unavailable or damaged. Refresh recovery; originals are preserved.');
  return { entries: entries.sort((a, b) => b.revision - a.revision), unavailable, ...(document ? { document } : {}) };
}
