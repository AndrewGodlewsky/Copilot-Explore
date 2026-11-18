import { lstat as fileStat, realpath, opendir, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, relative, sep, parse } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { History, HISTORY_LIMITS } from './history.mjs';
import { validateDocument, MAX_DOCUMENT_BYTES } from './model.mjs';
import { atomicWrite } from './storage.mjs';
import { acquireLock } from './owned-lock.mjs';

export const STORAGE_LIMITS = Object.freeze({ entries: 10000, depth: 4, candidates: 500, discoveryBytes: 64 * 1024 * 1024, readBytes: 256 * 1024 * 1024, previewMs: 15 * 60 * 1000, responseBytes: 512 * 1024 });
const choices = [5, 10, 25, 50], hash = value => createHash('sha256').update(value).digest('hex');
const keyPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeStat = stat => Object.assign(stat, { size: Number(stat.size), nlink: Number(stat.nlink) });
const lstat = async path => normalizeStat(await fileStat(path, { bigint: true }));
const reliableIdentity = stat => stat.ino > 0n && stat.dev >= 0n;
const identity = stat => [stat.dev, stat.ino, stat.birthtimeNs].join(':');
const stamp = stat => [identity(stat), stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(':');
const defaults = () => ({ version: 1, revision: 0, keepHistory: 50 });
const validSettings = value => value?.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 0 && choices.includes(value.keepHistory) && Object.keys(value).sort().join(',') === 'keepHistory,revision,version';
const protectedText = 'Only listed old unnamed history snapshots can be removed. All journeys, drafts and tombstones, newest recovery versions, undo versions, named checkpoints, usage receipts, local observations, preferences, locks, intents, recovery and unknown files remain protected. Protected versions can exceed the keep target. Removal is irreversible; this is not a backup.';

function category(parts) {
  const name = parts.at(-1);
  if (parts.length === 1 && name === 'analytics.json') return 'analytics';
  if (/\.tmp$|\.lock(?:\.recover|\.abandoned)?$/.test(name) || name === 'intent.json' || /^recovery-/.test(name)) return 'recovery';
  if (parts[0] === 'history') return 'history';
  if (parts[0] === 'usage') return 'usage';
  if (parts[0] === 'references' || ['voice-settings.json', 'navigation-settings.json', 'storage-settings.json'].includes(name)) return 'preferences';
  if (parts.length === 1 && name.endsWith('.explore.json')) return 'journeys';
  if (parts.length === 1 && name.endsWith('.md')) return 'exports';
  if (parts.length === 1 && name === 'drafts.json') return 'drafts';
  if (parts.length === 1 && name === 'library.json') return 'library';
  return 'unknown';
}
function descend(parts) {
  return parts.length === 1 && ['history', 'usage', 'references'].includes(parts[0]) ||
    parts.length === 2 && (parts[0] === 'history' && keyPattern.test(parts[1]) || parts[0] === 'usage' && parts[1] === 'session-state') ||
    parts.length === 3 && parts[0] === 'usage' && parts[1] === 'session-state' && uuidPattern.test(parts[2]);
}

// This shares the existing cooperative local-filesystem contract. Path checks
// detect observed replacements; Node has no portable atomic ancestor-bound unlink.
export class StorageManagement {
  constructor(directory, { write = atomicWrite, remove = unlink } = {}) {
    this.directory = resolve(directory); this.write = write; this.remove = remove; this.captured = null;
  }
  async root(expected) {
    let path = parse(this.directory).root;
    for (const part of relative(path, this.directory).split(sep).filter(Boolean)) {
      path = join(path, part);
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !reliableIdentity(stat)) throw new Error('Storage root is linked or its identity is unavailable.');
    }
    if (await realpath(this.directory) !== this.directory) throw new Error('Storage root changed.');
    const current = identity(await lstat(this.directory));
    if (expected && current !== expected) throw new Error('Storage root identity changed.');
    return current;
  }
  async safe(path, { root, parents, file = true } = {}) {
    await this.root(root);
    const parts = relative(this.directory, resolve(path)).split(sep);
    if (parts.some(part => !part || part === '..') || resolve(path) === this.directory) throw new Error('Invalid owned storage path.');
    let parent = this.directory; const observed = [];
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part); const stat = await lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !reliableIdentity(stat) || await realpath(parent) !== parent) throw new Error('Linked or changed storage parent.');
      observed.push(identity(stat));
    }
    if (parents && JSON.stringify(parents) !== JSON.stringify(observed)) throw new Error('Storage parent identity changed.');
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !reliableIdentity(stat) || file && (!stat.isFile() || stat.nlink !== 1) || await realpath(path) !== resolve(path)) throw new Error('Linked, unknown-identity or nonregular storage entry.');
    return { stat, parents: observed, stamp: stamp(stat) };
  }
  async read(path, max, expected = {}) {
    const entry = await this.safe(path, expected);
    if (entry.stat.size > max) throw new Error('Storage read limit reached.');
    if (this.readBudget !== undefined) {
      if (entry.stat.size > this.readBudget) throw new Error('Storage read budget reached; retry remaining captured candidates.');
      this.readBudget -= entry.stat.size;
    }
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (stamp(normalizeStat(await handle.stat({ bigint: true }))) !== entry.stamp) throw new Error('Storage entry changed.');
      const bytes = Buffer.alloc(Math.min(max + 1, entry.stat.size + 1));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== entry.stat.size || stamp(normalizeStat(await handle.stat({ bigint: true }))) !== entry.stamp || (await this.safe(path, expected)).stamp !== entry.stamp) throw new Error('Storage entry changed.');
      return { ...entry, text: bytes.subarray(0, bytesRead).toString('utf8') };
    } finally { await handle.close(); }
  }
  async absent(path) {
    try { await lstat(path); throw new Error('Pending intent or retained writer evidence blocks cleanup.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async settings() {
    try {
      const value = JSON.parse((await this.read(join(this.directory, 'storage-settings.json'), 4096)).text);
      if (!validSettings(value)) throw new Error('Invalid settings.'); return { settings: value };
    } catch (error) {
      return { settings: defaults(), ...(error.code === 'ENOENT' ? {} : { error: 'Storage preferences could not be read. The file is preserved; preview still works with an explicit choice.' }) };
    }
  }
  async saveSettings(keepHistory, revision) {
    if (!choices.includes(keepHistory) || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid storage preferences.');
    const root = await this.root(), file = join(this.directory, 'storage-settings.json');
    await this.absent(file + '.lock.recover');
    const lock = await acquireLock(file + '.lock', { recover: false });
    try {
      const value = await this.settings();
      if (value.error) throw new Error(value.error);
      if (value.settings.revision !== revision) throw new Error('Storage preferences changed. Refresh settings.');
      await this.root(root);
      const next = { version: 1, revision: revision + 1, keepHistory };
      await this.write(file, JSON.stringify(next)); return { settings: next };
    } finally { await lock.release(); }
  }
  async inventory() {
    const categories = Object.fromEntries(['journeys', 'exports', 'library', 'drafts', 'history', 'recovery', 'usage', 'analytics', 'preferences', 'unknown'].map(name => [name, { files: 0, apparentBytes: 0, uniqueBytes: 0 }]));
    const result = { categories, apparentBytes: 0, uniqueBytes: 0, duplicateBytes: 0, manifestDeclaredHistoryBytes: 0, manifests: 0, entries: 0, partial: false, issues: [], journeyNames: [], limits: STORAGE_LIMITS, historyLimits: HISTORY_LIMITS, protection: protectedText };
    const seen = new Set(); let stopped = false, metadataBytes = 0;
    const issue = (path, message) => { result.partial = true; if (result.issues.length < 100) result.issues.push({ path, message }); };
    const walk = async parts => {
      const path = join(this.directory, ...parts);
      try {
        if (parts.length) await this.safe(path, { root, file: false }); else await this.root(root);
        for await (const entry of await opendir(path)) {
          if (result.entries >= STORAGE_LIMITS.entries) { stopped = true; issue(parts.join('/'), 'Entry limit reached; remaining entries unscanned.'); break; }
          result.entries++; const child = [...parts, entry.name], label = child.join('/');
          try {
            const stat = await lstat(join(path, entry.name));
            if (stat.isSymbolicLink()) { issue(label, 'Linked entry excluded; target unscanned.'); continue; }
            if (stat.isDirectory()) {
              if (descend(child) && child.length < STORAGE_LIMITS.depth) await walk(child);
              else issue(label, 'Unknown or depth-limited directory; contents unscanned.');
              if (stopped) break; continue;
            }
            if (!stat.isFile()) { issue(label, 'Nonregular entry excluded.'); continue; }
            if (!Number.isSafeInteger(stat.size) || !Number.isSafeInteger(result.apparentBytes + stat.size)) { issue(label, 'File lengths exceed exact accounting bounds; excluded.'); continue; }
            const row = categories[category(child)]; row.files++; row.apparentBytes += stat.size; result.apparentBytes += stat.size;
            const reliable = reliableIdentity(stat);
            const id = `${stat.dev}:${stat.ino}`;
            if (reliable && seen.has(id)) result.duplicateBytes += stat.size;
            else { row.uniqueBytes += stat.size; result.uniqueBytes += stat.size; if (reliable) seen.add(id); }
            if (!reliable) issue(label, 'File identity unavailable; duplicate accounting uncertain.');
            if (child.length === 1 && entry.name.endsWith('.explore.json')) result.journeyNames.push(entry.name);
            if (child.length === 3 && child[0] === 'history' && entry.name === 'manifest.json') {
              try {
                metadataBytes += stat.size;
                if (metadataBytes > 8 * 1024 * 1024) throw new Error('Metadata budget reached.');
                const value = JSON.parse((await this.read(join(path, entry.name), 128 * 1024, { root })).text);
                new History(this.directory, child[1], value.id).validate(value);
                result.manifestDeclaredHistoryBytes += value.entries.reduce((sum, row) => sum + row.bytes, 0); result.manifests++;
              } catch { issue(label, 'Retained history metadata unreadable, invalid or over 8 MiB inspection budget; logical total incomplete.'); }
            }
          } catch { issue(label, 'Unreadable or changed entry; size unknown.'); }
        }
      } catch { issue(parts.join('/') || '.', 'Unreadable or changed directory; contents unscanned.'); }
    };
    let root;
    try { root = await this.root(); await walk([]); } catch { issue('.', 'Owned root unavailable or linked; nothing scanned.'); }
    return result;
  }
  async records(names, direct) {
    const records = [], issues = []; let bytes = 0;
    if (direct) return { records: [direct], issues };
    for (const name of names.slice(0, 2000)) {
      try {
        if (!name.endsWith('.explore.json') || name.includes('/') || name.includes('\\')) throw new Error('Invalid journey name.');
        const file = join(this.directory, name), stat = (await this.safe(file)).stat;
        if (bytes + stat.size > STORAGE_LIMITS.discoveryBytes) { issues.push('Journey discovery byte budget reached; remaining journeys unconsidered.'); break; }
        bytes += stat.size;
        const doc = validateDocument(JSON.parse((await this.read(file, MAX_DOCUMENT_BYTES)).text));
        records.push({ file, key: hash(`${name}\0${doc.id}`), id: doc.id, topic: doc.topic.slice(0, 160) });
      } catch { if (issues.length < 100) issues.push('An unreadable journey was preserved and excluded.'); }
    }
    if (names.length > 2000) issues.push('Journey count limit reached; remaining journeys unconsidered.');
    return { records, issues };
  }
  async state(record, expected = {}) {
    const root = await this.root(expected.root), file = resolve(record.file);
    if (dirname(file) !== this.directory || !keyPattern.test(record.key)) throw new Error('Invalid journey ownership.');
    await this.absent(file + '.lock.recover'); await this.absent(file + '.lock.abandoned');
    const directory = join(this.directory, 'history', record.key);
    await this.safe(directory, { root, parents: expected.directoryParents, file: false });
    if (expected.directoryIdentity && identity(await lstat(directory)) !== expected.directoryIdentity) throw new Error('History directory changed.');
    await this.absent(join(directory, 'intent.json'));
    const current = await this.read(file, MAX_DOCUMENT_BYTES, { root });
    const document = validateDocument(JSON.parse(current.text));
    if (document.id !== record.id) throw new Error('Journey identity changed.');
    const history = new History(this.directory, record.key, record.id);
    const manifest = await this.read(join(directory, 'manifest.json'), 128 * 1024, { root });
    const value = history.validate(JSON.parse(manifest.text));
    const currentRow = history.row(document, value.head.label);
    if (['hash', 'revision', 'time', 'bytes'].some(field => value.head[field] !== currentRow[field]) || value.head.checkpoints.length) throw new Error('History needs recovery.');
    return { root, current, document, directory, history, manifest, value };
  }
  async preview(records, keepHistory) {
    if (!choices.includes(keepHistory) || !Array.isArray(records) || records.length > 2000) throw new Error('Invalid storage preview.');
    const root = await this.root(), candidates = [], issues = []; let readBytes = 0;
    this.readBudget = STORAGE_LIMITS.readBytes;
    this.captured = null;
    for (const record of records) {
      if (candidates.length >= STORAGE_LIMITS.candidates || readBytes >= STORAGE_LIMITS.readBytes) { issues.push('Preview limit reached; remaining journeys were not considered.'); break; }
      try {
        await this.absent(record.file + '.lock');
        const state = await this.state(record, { root });
        const protectedRows = new Set(state.value.entries.slice(-keepHistory).map(row => row.hash));
        const rows = state.value.entries.filter(row => !protectedRows.has(row.hash) && !row.checkpoints.length && row.revision !== state.value.undoRevision);
        // Validate retained recovery before authorizing any removal, without reconciliation.
        const observed = new Map();
        for (const row of state.value.entries) {
          readBytes += row.bytes;
          if (readBytes > STORAGE_LIMITS.readBytes) throw new Error('Preview read budget reached.');
          const file = join(state.directory, `${row.hash}.json`), entry = await this.read(file, MAX_DOCUMENT_BYTES, { root });
          const raw = JSON.parse(entry.text), doc = validateDocument(raw);
          if (hash(entry.text) !== row.hash || Buffer.byteLength(entry.text) !== row.bytes || doc.id !== record.id || raw.id !== doc.id || raw.revision !== row.revision || doc.revision !== row.revision || raw.updatedAt !== row.time) throw new Error('History snapshot is damaged.');
          observed.set(row.hash, entry);
        }
        const directoryInfo = await this.safe(state.directory, { root, file: false });
        for (const row of rows) {
          if (candidates.length === STORAGE_LIMITS.candidates) { issues.push('Candidate limit reached; additional versions remain protected.'); break; }
          candidates.push({ record: { ...record }, row, root, directoryIdentity: identity(directoryInfo.stat), directoryParents: directoryInfo.parents,
            currentStamp: state.current.stamp, manifestText: state.manifest.text, manifestStamp: state.manifest.stamp, snapshotStamp: observed.get(row.hash).stamp, parents: observed.get(row.hash).parents, status: 'pending' });
        }
      } catch (error) { if (issues.length < 100) issues.push(`${(record.topic ?? 'Journey').slice(0, 160)}: ${error.code === 'ENOENT' ? 'History is missing or unavailable; nothing selected.' : error.message}`); }
    }
    this.captured = { id: randomUUID(), expiresAt: Date.now() + STORAGE_LIMITS.previewMs, candidates };
    this.readBudget = undefined;
    return { id: this.captured.id, expiresAt: this.captured.expiresAt, keepHistory, protection: protectedText, issues,
      candidates: candidates.map(({ record, row }) => ({ key: record.key, topic: record.topic, ...row })), bytes: candidates.reduce((sum, candidate) => sum + candidate.row.bytes, 0) };
  }
  async clean(id) {
    const preview = this.captured;
    if (!preview || id !== preview.id || Date.now() > preview.expiresAt) throw new Error('Cleanup preview expired or changed. Preview again before removing anything.');
    const results = [], issues = []; this.readBudget = STORAGE_LIMITS.readBytes;
    for (const candidate of preview.candidates) {
      const { record, row } = candidate;
      if (['removed', 'ineligible'].includes(candidate.status)) { results.push({ key: record.key, hash: row.hash, revision: row.revision, status: candidate.status, message: candidate.message }); continue; }
      let lock, status = 'failed', message = 'Cleanup could not complete; retry only this preview.';
      try {
        await this.root(candidate.root); await this.absent(record.file + '.lock.recover'); await this.absent(record.file + '.lock.abandoned');
        lock = await acquireLock(record.file + '.lock', { recover: false });
        let state = await this.state(record, candidate);
        const path = join(state.directory, `${row.hash}.json`);
        if (state.current.stamp !== candidate.currentStamp) throw new Error('Journey changed since preview.');
        const retained = state.value.entries.find(item => item.hash === row.hash);
        if (retained) {
          if (candidate.detached || state.manifest.text !== candidate.manifestText || state.manifest.stamp !== candidate.manifestStamp || retained.checkpoints.length || retained.revision === state.value.undoRevision || state.value.entries.at(-1).hash === row.hash) throw new Error('History or protection changed since preview.');
          const snapshot = await this.read(path, MAX_DOCUMENT_BYTES, candidate);
          if (snapshot.stamp !== candidate.snapshotStamp || hash(snapshot.text) !== row.hash) throw new Error('Candidate changed since preview.');
          state.value.entries = state.value.entries.filter(item => item.hash !== row.hash);
          await this.safe(join(state.directory, 'manifest.json'), candidate); await this.root(candidate.root);
          await this.write(join(state.directory, 'manifest.json'), JSON.stringify(state.value));
          candidate.detached = true;
          // Update only this preview's expected manifest after our own successful commit.
          const next = await this.read(join(state.directory, 'manifest.json'), 128 * 1024, candidate);
          for (const other of preview.candidates) if (other.record.key === record.key) { other.manifestText = next.text; other.manifestStamp = next.stamp; }
        } else if (!candidate.detached) throw new Error('Candidate is no longer retained by the previewed manifest.');
        // Repeat protection and ancestry checks after manifest publication, immediately before unlink.
        state = await this.state(record, candidate);
        if (state.current.stamp !== candidate.currentStamp || state.value.entries.some(item => item.hash === row.hash)) throw new Error('Candidate is newly referenced or journey changed.');
        const newest = state.value.entries.at(-1);
        if (!newest) throw new Error('Last recovery version changed.');
        const recovery = await this.read(join(state.directory, `${newest.hash}.json`), MAX_DOCUMENT_BYTES, candidate);
        const recoveryRaw = JSON.parse(recovery.text), recoveryDocument = validateDocument(recoveryRaw);
        if (hash(recovery.text) !== newest.hash || Buffer.byteLength(recovery.text) !== newest.bytes || recoveryRaw.id !== record.id || recoveryDocument.id !== record.id ||
          recoveryRaw.revision !== newest.revision || recoveryDocument.revision !== newest.revision || recoveryRaw.updatedAt !== newest.time) throw new Error('Last recovery version changed.');
        let snapshot;
        try { snapshot = await this.read(path, MAX_DOCUMENT_BYTES, candidate); }
        catch (error) { if (error.code === 'ENOENT' && candidate.detached) { status = 'absent'; message = 'Already absent after manifest removal; deletion outcome is unknown.'; } else throw error; }
        if (snapshot) {
          if (snapshot.stamp !== candidate.snapshotStamp || hash(snapshot.text) !== row.hash) throw new Error('Candidate changed since preview.');
          await this.safe(path, candidate);
          await this.remove(path); status = 'removed'; message = 'Snapshot removed.';
        }
      } catch (error) {
        if (/changed|linked|identity|newly referenced|no longer|nonregular|Invalid/.test(error.message)) status = 'ineligible';
        message = status === 'ineligible' ? 'Changed or unsafe candidate preserved. Create a new preview.' :
          error.code ? `Storage operation failed (${error.code}). Removal is not confirmed; retry this captured candidate.` : `${error.message.slice(0, 180)} Removal is not confirmed; retry this captured candidate.`;
      } finally {
        if (lock) try { await lock.release(); } catch { issues.push(`Writer lock release failed for ${record.topic ?? 'journey'}; recovery evidence retained.`); }
      }
      candidate.status = status; candidate.message = message;
      results.push({ key: record.key, hash: row.hash, revision: row.revision, status, message });
    }
    this.readBudget = undefined;
    return { id, results, issues, protection: protectedText };
  }
}
