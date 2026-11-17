import { mkdir, lstat, realpath, readFile, open, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicWrite } from './storage.mjs';
import { ANSWER_STATES, effectiveAnswerState } from './web/answer-state.mjs';

const MAX_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 10000;
export const draftHash = value => createHash('sha256').update(value).digest('hex');
const key = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nodeId = value => typeof value === 'string' && value.length > 0 && value.length <= 100 && value.trim() === value;
const revision = value => Number.isSafeInteger(value) && value >= 0;
export function draftBase(value) {
  if (!value || typeof value.question !== 'string' || value.question.length > 4000 || typeof value.answer !== 'string' || value.answer.length > 20000) throw new Error('Invalid draft base.');
  if (Object.hasOwn(value, 'answerState') && (typeof value.answerState !== 'string' || !Object.hasOwn(ANSWER_STATES, value.answerState))) throw new Error('Invalid draft base state.');
  return draftHash(JSON.stringify([value.question, value.answer, effectiveAnswerState(value)]));
}
export function matchesDraftBase(entry, node) {
  if (entry.base === draftBase(node)) return true;
  // Only old text-only records may use the old hash, and only against a legacy-equivalent state.
  return !Object.hasOwn(entry, 'answerState') && effectiveAnswerState(node) === effectiveAnswerState({ answer: node.answer }) &&
    entry.base === draftHash(JSON.stringify([node.question, node.answer]));
}
function validEntry(entry) {
  return entry && key(entry.key) && nodeId(entry.nodeId) && key(entry.base) && revision(entry.revision) && entry.revision > 0 &&
    (entry.text === null || (typeof entry.text === 'string' && entry.text.length <= 20000)) &&
    (!Object.hasOwn(entry, 'stateSelected') || typeof entry.stateSelected === 'boolean') &&
    (!Object.hasOwn(entry, 'answerState') || typeof entry.answerState === 'string' && Object.hasOwn(ANSWER_STATES, entry.answerState)) && typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt));
}

export class Drafts {
  constructor(directory) { this.directory = resolve(directory); }
  async root() {
    await mkdir(this.directory, { recursive: true });
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('Draft storage cannot use a linked directory.');
    return realpath(this.directory);
  }
  async read() {
    try {
      const root = await this.root(), file = join(root, 'drafts.json');
      let stat;
      try { stat = await lstat(file); } catch (error) { if (error.code === 'ENOENT') return { version: 1, revision: 0, entries: [] }; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES || dirname(await realpath(file)) !== root) throw new Error('Unsafe draft file.');
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (value?.version !== 1 || !revision(value.revision) || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES || !value.entries.every(validEntry) || value.entries.some(e => e.revision > value.revision) || new Set(value.entries.map(e => JSON.stringify([e.key, e.nodeId]))).size !== value.entries.length) throw new Error('Invalid drafts.');
      return value;
    } catch { throw new Error('Draft storage could not be read. The file is preserved; restore drafts.json before saving drafts.'); }
  }
  async list(journey) {
    if (!key(journey)) throw new Error('Invalid draft journey.');
    return (await this.read()).entries.filter(entry => entry.key === journey);
  }
  async write(value) {
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > MAX_BYTES || value.entries.length > MAX_ENTRIES) throw new Error('Local draft storage is full. Export recoverable text and discard unused drafts.');
    await atomicWrite(join(await this.root(), 'drafts.json'), data);
  }
  async update(input, { matchingText, matchingState } = {}) {
    if (!input || !key(input.key) || !nodeId(input.nodeId) || !key(input.base) || !revision(input.revision) || !(input.text === null || typeof input.text === 'string' && input.text.length <= 20000)) throw new Error('Invalid draft.');
    if (Object.hasOwn(input, 'answerState') && (typeof input.answerState !== 'string' || !Object.hasOwn(ANSWER_STATES, input.answerState))) throw new Error('Invalid draft state.');
    if (Object.hasOwn(input, 'stateSelected') && typeof input.stateSelected !== 'boolean') throw new Error('Invalid draft state selection.');
    const root = await this.root(), path = join(root, 'drafts.json.lock'); let lock;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { lock = await open(path, 'wx'); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; await delay(20); }
    }
    if (!lock) throw new Error('Another draft writer is active. Retry; remove a stale drafts.json.lock only after Copilot has fully exited.');
    try {
      const value = await this.read(), index = value.entries.findIndex(e => e.key === input.key && e.nodeId === input.nodeId), old = value.entries[index];
      if ((old?.revision ?? 0) !== input.revision || (matchingText !== undefined && old?.text !== matchingText) || (matchingState !== undefined && effectiveAnswerState({ answer: old?.text, answerState: old?.answerState }) !== matchingState)) {
        if (matchingText !== undefined) return null;
        throw new Error('Another canvas changed this draft. Your editor text is preserved. Review the saved draft before replacing it.');
      }
      if (!Number.isSafeInteger(value.revision + 1)) throw new Error('Draft revision limit reached.');
      const entry = { key: input.key, nodeId: input.nodeId, base: input.base, text: input.text, answerState: effectiveAnswerState({ answer: input.text, answerState: input.answerState }), stateSelected: input.stateSelected ?? Object.hasOwn(input, 'answerState'), revision: ++value.revision, updatedAt: new Date().toISOString() };
      if (index < 0) value.entries.push(entry); else value.entries[index] = entry;
      await this.write(value); return entry;
    } finally { await lock.close(); await unlink(path); }
  }
}
