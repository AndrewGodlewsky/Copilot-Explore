import { mkdir, lstat, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { atomicWrite } from './storage.mjs';

const MAX_BYTES = 4096;
export const defaultNavigationSettings = () => ({ version: 1, revision: 0, wheelMode: 'zoom', sensitivity: 1, motion: 'system' });

function validateChoice(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !['zoom', 'pan'].includes(value.wheelMode) ||
    typeof value.sensitivity !== 'number' || !Number.isFinite(value.sensitivity) || value.sensitivity < .25 || value.sensitivity > 3 ||
    !['system', 'reduce', 'full'].includes(value.motion)) throw new Error('Invalid navigation settings.');
}

function validateSaved(value) {
  validateChoice(value);
  if (Object.keys(value).sort().join(',') !== 'motion,revision,sensitivity,version,wheelMode' ||
    value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid navigation settings.');
}

export class NavigationPreferences {
  constructor(file, write = atomicWrite) { this.file = file; this.write = write; }
  async read() {
    if (!this.file) return defaultNavigationSettings();
    try {
      const entry = await lstat(this.file);
      if (!entry.isFile() || entry.nlink !== 1 || entry.size > MAX_BYTES) throw new Error('Unsafe navigation settings file.');
      const handle = await open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES || stat.ino !== entry.ino) throw new Error('Unsafe navigation settings file.');
        const bytes = Buffer.alloc(MAX_BYTES + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (bytesRead > MAX_BYTES) throw new Error('Oversized navigation settings file.');
        const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
        validateSaved(value);
        return value;
      } finally { await handle.close(); }
    } catch (error) {
      if (error.code === 'ENOENT') return defaultNavigationSettings();
      throw new Error('Saved navigation settings could not be read. The file has been preserved. Repair the file, then refresh settings.');
    }
  }
  async save(choice, revision) {
    validateChoice(choice);
    if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) throw new Error('Invalid navigation settings revision.');
    if (!this.file) throw new Error('Navigation settings storage is unavailable.');
    await mkdir(dirname(this.file), { recursive: true });
    let lock;
    try { lock = await open(this.file + '.lock', 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Navigation settings are being updated. Refresh and try again.');
      throw error;
    }
    try {
      const saved = await this.read();
      if (saved.revision !== revision) throw new Error('Navigation settings changed in another canvas. Refresh before saving.');
      const next = { version: 1, revision: revision + 1, wheelMode: choice.wheelMode, sensitivity: choice.sensitivity, motion: choice.motion };
      await this.write(this.file, JSON.stringify(next, null, 2));
      return next;
    } finally { await lock.close(); await unlink(this.file + '.lock'); }
  }
}
