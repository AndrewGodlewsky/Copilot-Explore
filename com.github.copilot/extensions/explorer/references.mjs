import { acquireLock } from './owned-lock.mjs';
import { mkdir, lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { atomicWrite } from './storage.mjs';

const MAX_BYTES = 4096;
const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && value.trim() === value;
const validRevision = value => Number.isSafeInteger(value) && value >= 0;
export const emptyReferences = () => ({ version: 1, revision: 0, nodeIds: [] });
export function validateReferenceIds(nodeIds) {
  if (!Array.isArray(nodeIds) || nodeIds.length > 3 || !nodeIds.every(validId) || new Set(nodeIds).size !== nodeIds.length) throw new Error('Invalid reference node IDs: choose up to three unique question IDs.');
  return nodeIds;
}

export class References {
  constructor(directory, write = atomicWrite) { this.directory = resolve(directory); this.write = write; }
  path(key) {
    if (!validKey(key)) throw new Error('Invalid reference journey.');
    return join(this.directory, 'references', `${key}.json`);
  }
  async root() {
    await mkdir(this.directory, { recursive: true });
    const owner = await lstat(this.directory);
    if (!owner.isDirectory() || owner.isSymbolicLink()) throw new Error('Unsafe reference storage directory.');
    const directory = join(this.directory, 'references');
    await mkdir(directory, { recursive: true });
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unsafe reference storage directory.');
    return realpath(directory);
  }
  async read(key) {
    if (!validKey(key)) throw new Error('Invalid reference journey.');
    try {
      const file = join(await this.root(), `${key}.json`), entry = await lstat(file);
      if (!entry.isFile() || entry.nlink !== 1 || entry.size > MAX_BYTES) throw new Error('Unsafe reference file.');
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES || stat.ino !== entry.ino) throw new Error('Unsafe reference file.');
        const bytes = Buffer.alloc(MAX_BYTES + 1), { bytesRead } = await handle.read(bytes, 0, MAX_BYTES + 1, 0);
        if (bytesRead > MAX_BYTES) throw new Error('Oversized reference file.');
        const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'nodeIds,revision,version' || value.version !== 1 || !validRevision(value.revision)) throw new Error('Invalid reference file.');
        validateReferenceIds(value.nodeIds);
        return value;
      } finally { await handle.close(); }
    } catch (error) {
      if (error.code === 'ENOENT') return emptyReferences();
      throw new Error('Saved references could not be read. The file is preserved; repair it before saving references.');
    }
  }
  async save(key, nodeIds, revision) {
    if (!validKey(key)) throw new Error('Invalid reference journey.');
    validateReferenceIds(nodeIds);
    if (!validRevision(revision) || revision === Number.MAX_SAFE_INTEGER) throw new Error('Invalid reference revision.');
    const root = await this.root(), file = join(root, `${key}.json`), lockPath = `${file}.lock`;
    const lock = await acquireLock(lockPath);
    try {
      const old = await this.read(key);
      if (old.revision !== revision) throw new Error('References changed in another canvas. Refresh references and retry your choice.');
      if (JSON.stringify(old.nodeIds) === JSON.stringify(nodeIds)) return old;
      const next = { version: 1, revision: revision + 1, nodeIds };
      const data = JSON.stringify(next);
      if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('Reference storage limit reached.');
      await this.write(file, data);
      return next;
    } finally { await lock.release(); }
  }
}
