import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicWrite } from './controller.mjs';

const defaults = () => ({ version: 1, revision: 0, microphone: '', model: 'copilot' });
export function validatePreferences(value) {
  if (!value || typeof value.microphone !== 'string' || value.microphone.length > 500 || typeof value.model !== 'string' || value.model.length > 100 || !value.model) throw new Error('Invalid voice settings.');
}
export class VoicePreferences {
  constructor(file) { this.file = file; }
  async read() {
    if (!this.file) return defaults();
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      validatePreferences(value);
      if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid format');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return defaults();
      throw new Error('Saved voice settings could not be read. The file has been preserved.');
    }
  }
  async save(selection, revision) {
    validatePreferences(selection);
    if (!this.file) throw new Error('Voice settings storage is unavailable.');
    await mkdir(dirname(this.file), { recursive: true });
    let lock;
    try { lock = await open(this.file + '.lock', 'wx'); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Voice settings are being updated. Refresh and try again.'); throw error; }
    try {
      const saved = await this.read();
      if (saved.revision !== revision) throw new Error('Voice settings changed in another canvas. Refresh before saving.');
      const next = { version: 1, revision: revision + 1, microphone: selection.microphone, model: selection.model };
      await atomicWrite(this.file, JSON.stringify(next, null, 2)); return next;
    } finally { await lock.close(); await unlink(this.file + '.lock'); }
  }
}
