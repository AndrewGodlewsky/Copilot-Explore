import { open, lstat, realpath, mkdir, link, rename, unlink } from 'node:fs/promises';
import { constants, lstatSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative, sep, isAbsolute, parse } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectContext } from './project-context.mjs';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';
import { acquireLock } from './owned-lock.mjs';
import { atomicWrite } from './storage.mjs';
import { parseDocumentJson } from './shared-document.mjs';
import { ADR_FILE_LIMIT, adrFilePath, adrFileMarker, adrBytesDigest, validateAdrFile } from './adr-file.mjs';

const JOURNAL_LIMIT = 262144;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const comparable = path => process.platform === 'win32' ? path.toLowerCase() : path;
const inside = (root, path) => { const part = relative(root, path); return !part || part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part); };
const physical = stat => [stat.dev, stat.ino, stat.birthtimeNs].join(':');
const stamp = stat => [physical(stat), stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink].join(':');
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 65536 && /^[\d:/-]+$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = () => { throw Error('Invalid ADR write journal. Preserve it for storage review.'); };
const changed = () => { throw Error('ADR destination or identity changed, is linked, or conflicts with the reviewed file. Review again; existing content is preserved.'); };
function targetValue(value) {
  if (!keys(value, 'root,path,parents,base') || !keys(value.root, 'path,ancestors') || typeof value.root.path !== 'string' || !isAbsolute(value.root.path) || value.root.path.startsWith('\\\\') || value.root.path.length > 32768 || !identity(value.root.ancestors) || !Array.isArray(value.parents)) invalid();
  adrFilePath(value.path); if (value.parents.length > value.path.split('/').length - 1 || value.parents.some(value => !identity(value))) invalid();
  if (value.base !== null && (!keys(value.base, 'stamp,sha256,id') || !identity(value.base.stamp) || !digest(value.base.sha256))) invalid();
  if (value.base) adrFileMarker(value.base.id);
  return structuredClone(value);
}
function validateIntent(value) {
  if (!keys(value, 'version,id,target,content,record,base,sourceDigest,journeyId,createdAt,stage,abandoned' + (Object.hasOwn(value ?? {}, 'completed') ? ',completed' : '') + (Object.hasOwn(value ?? {}, 'completionRequired') ? ',completionRequired' : '')) || value.version !== 1 || typeof value.abandoned !== 'boolean' || Object.hasOwn(value, 'completed') && (value.completed !== true || value.abandoned || value.stage === null) || Object.hasOwn(value, 'completionRequired') && value.completionRequired !== true) invalid();
  adrFileMarker(value.id); const target = targetValue(value.target), record = validateAdrFile(value.record), base = value.base === null ? null : validateAdrFile(value.base);
  if (typeof value.content !== 'string' || !value.content.isWellFormed() || Buffer.byteLength(value.content) > ADR_FILE_LIMIT || !value.content.endsWith(adrFileMarker(record.id) + '\n') || adrBytesDigest(value.content) !== record.sha256 || record.path !== target.path || !digest(value.sourceDigest) ||
      typeof value.journeyId !== 'string' || !value.journeyId.trim() || value.journeyId.length > 100 || typeof value.createdAt !== 'string' || value.createdAt.length > 40 || !Number.isFinite(Date.parse(value.createdAt))) invalid();
  if (base ? !target.base || base.id !== record.id || base.path !== record.path || base.sha256 !== target.base.sha256 || base.id !== target.base.id : target.base !== null) invalid();
  if (value.stage !== null && (!keys(value.stage, 'name,identity') || typeof value.stage.name !== 'string' || !/^\.explorer-adr-[a-f0-9-]{36}\.tmp$/.test(value.stage.name) || !identity(value.stage.identity))) invalid();
  const result = { version: 1, id: value.id, target, content: value.content, record, base, sourceDigest: value.sourceDigest, journeyId: value.journeyId, createdAt: value.createdAt, stage: structuredClone(value.stage), abandoned: value.abandoned, ...(value.completed ? { completed: true } : {}), ...(value.completionRequired ? { completionRequired: true } : {}) };
  if (Buffer.byteLength(JSON.stringify(result)) > JOURNAL_LIMIT) throw Error('ADR write journal exceeds its 256 KiB limit.');
  return result;
}
export { validateIntent as validateAdrWriteIntent };

/** Caller owns the exploration lock. This service never commits an association or infers project authority from a journal path. */
export class AdrFileStorage {
  constructor({ readRoot, directory, key, lockDirectory = directory, fault = async () => {} }) {
    if (![directory, lockDirectory].every(value => typeof value === 'string' && isAbsolute(value)) || typeof key !== 'string' || !key || key.length > 1000) invalid();
    this.reader = new ProjectContext(readRoot); this.directory = resolve(directory); this.lockDirectory = resolve(lockDirectory); this.fault = fault;
    this.journalFile = join(this.directory, 'adr-files', adrBytesDigest(key), 'intent.json');
  }
  async assertTarget(target) {
    if (!same(await this.reader.root(), target.root)) changed();
    let parent = target.root.path;
    for (const [index, part] of target.path.split('/').slice(0, target.parents.length).entries()) {
      parent = join(parent, part); if ((await directoryState(parent)).identity !== target.parents[index]) changed();
    }
  }
  async parents(root, path, create = false) {
    const result = []; let parent = root.path;
    for (const part of path.split('/').slice(0, -1)) {
      if (!same(await this.reader.root(), root)) changed();
      const previous = await directoryState(parent); parent = join(parent, part);
      try { result.push((await directoryState(parent)).identity); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!create) break;
        await mkdir(parent).catch(error => { if (error.code !== 'EEXIST') throw error; });
        if ((await directoryState(dirname(parent))).identity !== previous.identity) changed();
        result.push((await directoryState(parent)).identity);
      }
    }
    return result;
  }
  async fileData(target, file, links = 1) {
    await this.assertTarget(target); const entry = await lstat(file, { bigint: true });
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== BigInt(links) || entry.ino <= 0n || entry.dev < 0n || comparable(await realpath(file)) !== comparable(file)) changed();
    if (entry.size > BigInt(ADR_FILE_LIMIT)) throw Error('ADR file exceeds the 64 KiB read limit.');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (stamp(await handle.stat({ bigint: true })) !== stamp(entry)) changed();
      const bytes = Buffer.alloc(Number(entry.size) + 1); let count = 0;
      while (count < bytes.length) { const read = await handle.read(bytes, count, bytes.length - count, count); if (!read.bytesRead) break; count += read.bytesRead; }
      if (count !== Number(entry.size) || stamp(await handle.stat({ bigint: true })) !== stamp(entry) || stamp(await lstat(file, { bigint: true })) !== stamp(entry)) changed();
      await this.assertTarget(target);
      let content; try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, count)); } catch { throw Error('ADR file must contain valid UTF-8 text.'); }
      return { content, sha256: adrBytesDigest(bytes.subarray(0, count)), stamp: stamp(entry), identity: physical(entry), nlink: Number(entry.nlink) };
    } finally { await handle.close(); }
  }
  async capture(path, expected = null) {
    adrFilePath(path); const base = expected === null ? null : validateAdrFile(expected); if (base && base.path !== path) changed();
    const root = await this.reader.root(), target = { root, path, parents: await this.parents(root, path), base: null };
    let data; try { data = await this.fileData(target, join(root.path, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (base) {
      if (!data || data.sha256 !== base.sha256 || !data.content.endsWith(adrFileMarker(base.id) + '\n')) changed();
      target.base = { stamp: data.stamp, sha256: data.sha256, id: base.id };
    } else if (data) throw Error('ADR target already exists. Choose another number or explicitly review a recorded managed draft.');
    await this.assertTarget(target); return { target, oldContent: data?.content ?? null };
  }
  async privateRoot(directory, target, create) {
    if (target && inside(target.root.path, directory)) throw Error('ADR recovery storage must remain outside the active project.');
    const state = await directoryState(directory, create);
    this.privateRoots ??= new Map(); const prior = this.privateRoots.get(directory);
    if (prior && !same(prior, state)) throw Error('Private ADR recovery storage identity changed. Reopen the exploration.');
    this.privateRoots.set(directory, state); return state;
  }
  async readIntent() {
    try {
      await this.privateRoot(this.directory, null, false);
      const access = await projectDocumentAccess({ checkoutDirectory: this.directory, file: this.journalFile });
      const bytes = (await access.read({ maxBytes: JOURNAL_LIMIT })).bytes;
      return validateIntent(parseDocumentJson(bytes).value);
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async writeIntent(value, expectedId) {
    const intent = validateIntent(value); await this.assertTarget(intent.target); await this.privateRoot(this.directory, intent.target, true);
    const parent = await directoryState(dirname(this.journalFile), true), lock = await acquireLock(join(parent.path, 'intent.lock'), { attempts: 50 });
    try {
      if ((await this.readIntent())?.id !== (expectedId ?? undefined)) throw Error('Another ADR operation is pending. Reconcile the unfinished write first.');
      await this.assertTarget(intent.target); if (!same(await directoryState(parent.path), parent)) changed();
      await atomicWrite(this.journalFile, JSON.stringify(intent)); return intent;
    } finally { await lock.release(); }
  }
  async begin(value, previousId = null) {
    if (!keys(value, 'target,content,record,base,sourceDigest,journeyId')) invalid();
    return this.writeIntent({ ...value, version: 1, id: randomUUID(), createdAt: new Date().toISOString(), stage: null, abandoned: false, completionRequired: true }, previousId);
  }
  stagePath(intent) { return join(dirname(join(intent.target.root.path, intent.target.path)), intent.stage.name); }
  async stageData(intent, links = 1) {
    const data = await this.fileData(intent.target, this.stagePath(intent), links);
    if (data.identity !== intent.stage.identity || data.sha256 !== intent.record.sha256) changed();
    return data;
  }
  publicationSnapshot(intent, staged) {
    // No awaits after the final source guard: catch edits made during it without
    // reopening the inverse late-source gap. The OS rename still is not a CAS.
    const target = intent.target, directoryIdentity = directory => {
      let path = parse(directory).root; const ancestors = [];
      for (const part of ['', ...relative(path, directory).split(sep).filter(Boolean)]) {
        path = join(path, part); const entry = lstatSync(path, { bigint: true });
        if (!entry.isDirectory() || entry.isSymbolicLink() || entry.ino <= 0n || entry.dev < 0n) changed();
        ancestors.push(physical(entry));
      }
      if (comparable(realpathSync(directory)) !== comparable(directory)) changed();
      return ancestors.join('/');
    };
    if (directoryIdentity(target.root.path) !== target.root.ancestors) changed();
    let parent = target.root.path;
    for (const [index, part] of target.path.split('/').slice(0, -1).entries()) {
      parent = join(parent, part); if (directoryIdentity(parent) !== target.parents[index]) changed();
    }
    const stage = lstatSync(this.stagePath(intent), { bigint: true });
    if (!stage.isFile() || stage.isSymbolicLink() || stamp(stage) !== staged.stamp) changed();
    let destination;
    try { destination = lstatSync(join(target.root.path, target.path), { bigint: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (target.base ? !destination || !destination.isFile() || destination.isSymbolicLink() || stamp(destination) !== target.base.stamp : !!destination) changed();
  }
  async inspectIntent(intent) {
    const target = intent.target; await this.assertTarget(target); const file = join(target.root.path, target.path);
    let entry; try { entry = await lstat(file, { bigint: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!entry) { if (target.base) changed(); return { publication: 'unpublished', cleanupRequired: false }; }
    const two = entry.nlink === 2n;
    if (two && !intent.stage) changed();
    const data = await this.fileData(target, file, two ? 2 : 1);
    if (two) { const staged = await this.stageData(intent, 2); if (staged.identity !== data.identity) changed(); }
    // Matching bytes alone cannot prove publication: an unchanged update or an
    // external same-byte replacement still has to pass the original base guard.
    if (intent.stage && data.identity === intent.stage.identity && data.sha256 === intent.record.sha256 && data.content.endsWith(adrFileMarker(intent.record.id) + '\n')) return { publication: 'published', cleanupRequired: two };
    if (two || !target.base || data.stamp !== target.base.stamp || data.sha256 !== target.base.sha256) changed();
    return { publication: 'unpublished', cleanupRequired: false };
  }
  async inspect() { const intent = await this.readIntent(); return intent ? { intent, ...await this.inspectIntent(intent) } : { intent: null, publication: 'none', cleanupRequired: false }; }
  async cleanupStage(intent) {
    if (!intent.stage) return;
    let entry; try { entry = await lstat(this.stagePath(intent), { bigint: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const two = entry.nlink === 2n; const staged = await this.stageData(intent, two ? 2 : 1);
    if (two) { const published = await this.fileData(intent.target, join(intent.target.root.path, intent.target.path), 2); if (published.identity !== staged.identity || published.sha256 !== staged.sha256) changed(); }
    await this.assertTarget(intent.target); if (physical(await lstat(this.stagePath(intent), { bigint: true })) !== staged.identity) changed();
    await unlink(this.stagePath(intent));
  }
  async stage(intent) {
    if (intent.stage) {
      try { await this.stageData(intent); return intent; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await this.fault('before-stage', intent);
    const name = `.explorer-adr-${randomUUID()}.tmp`, path = join(dirname(join(intent.target.root.path, intent.target.path)), name);
    await this.assertTarget(intent.target); const handle = await open(path, 'wx', 0o600); let entry;
    try { await handle.writeFile(intent.content, 'utf8'); await handle.sync(); entry = await handle.stat({ bigint: true }); } finally { await handle.close(); }
    intent = await this.writeIntent({ ...intent, stage: { name, identity: physical(entry) } }, intent.id);
    await this.stageData(intent); await this.fault('after-stage', intent); return intent;
  }
  async withTargetLock(intent, work) {
    await this.assertTarget(intent.target); await this.privateRoot(this.lockDirectory, intent.target, true);
    const locks = await directoryState(join(this.lockDirectory, 'adr-file-locks'), true);
    const lock = await acquireLock(join(locks.path, `${adrBytesDigest(JSON.stringify([comparable(intent.target.root.path), intent.target.root.ancestors, intent.target.path.toLowerCase()]))}.lock`), { attempts: 50 });
    try { return await work(); } finally { await lock.release(); }
  }
  async abandon(id) {
    let intent = await this.readIntent(); if (!intent || intent.id !== id) throw Error('ADR operation is unavailable. Refresh recovery.');
    if (intent.completed) throw Error('This completed ADR operation is historical and cannot be abandoned.');
    return this.withTargetLock(intent, async () => {
      intent = await this.readIntent(); if (!intent || intent.id !== id) throw Error('ADR operation changed. Refresh recovery.');
      if (intent.completed) throw Error('This completed ADR operation is historical and cannot be abandoned.');
      if ((await this.inspectIntent(intent)).publication !== 'unpublished') throw Error('The ADR file is already published. Reconcile its association; it cannot be abandoned or deleted here.');
      await this.cleanupStage(intent); return this.writeIntent({ ...intent, abandoned: true, stage: null }, id);
    });
  }
  async complete(id, guard) {
    if (typeof guard !== 'function') invalid();
    let intent = await this.readIntent(); if (!intent || intent.id !== id) throw Error('ADR operation is unavailable. Refresh recovery.');
    if (intent.completed) return intent;
    return this.withTargetLock(intent, async () => {
      intent = await this.readIntent(); if (!intent || intent.id !== id) throw Error('ADR operation changed. Refresh recovery.');
      if (intent.completed) return intent;
      const status = await this.inspectIntent(intent);
      if (intent.abandoned || status.publication !== 'published' || status.cleanupRequired) throw Error('Complete ADR publication and cleanup before recording its completion.');
      await guard(intent);
      return this.writeIntent({ ...intent, completed: true }, id);
    });
  }
  async publish(id, guard = async () => {}) {
    let intent = await this.readIntent(); if (!intent || intent.id !== id) throw Error('ADR write operation is unavailable. Refresh its recovery status.');
    if (intent.completed) throw Error('This completed ADR operation is historical and cannot be published again.');
    return this.withTargetLock(intent, async () => {
      const current = await this.readIntent(); if (!current || current.id !== id) throw Error('ADR write operation changed. Refresh recovery.'); intent = current;
      if (intent.abandoned || intent.completed) throw Error('This ADR operation was abandoned or completed. Review a new write.');
      let status = await this.inspectIntent(intent);
      if (status.publication !== 'published') {
        await this.assertTarget(intent.target);
        const parents = await this.parents(intent.target.root, intent.target.path, true); await this.assertTarget(intent.target);
        intent = await this.writeIntent({ ...intent, target: { ...intent.target, parents } }, id);
        intent = await this.stage(intent); await this.fault('before-publish', intent); await guard(intent);
        status = await this.inspectIntent(intent); const staged = await this.stageData(intent);
        if (status.publication !== 'published') {
          await guard(intent);
          this.publicationSnapshot(intent, staged);
          const destination = join(intent.target.root.path, intent.target.path);
          if (intent.target.base) await rename(this.stagePath(intent), destination); else await link(this.stagePath(intent), destination);
          await this.fault('after-publish', intent);
        }
      }
      await this.cleanupStage(intent); await this.fault('after-cleanup', intent);
      status = await this.inspectIntent(intent); if (status.publication !== 'published') throw Error('ADR publication could not be verified. Refresh recovery before retrying.');
      return { id, path: intent.target.path, published: true, content: intent.content, record: intent.record };
    });
  }
}
