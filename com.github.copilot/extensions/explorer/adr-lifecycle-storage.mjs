import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { AdrFileStorage, validateAdrWriteIntent } from './adr-file-storage.mjs';
import { adrBytesDigest, adrFileMarker } from './adr-file.mjs';
import { validateContributionEvent } from './contributors.mjs';
import { directoryState, projectDocumentAccess } from './storage-context.mjs';
import { parseDocumentJson } from './shared-document.mjs';
import { atomicWrite } from './storage.mjs';
import { acquireLock } from './owned-lock.mjs';

const LIMIT = 1024 * 1024;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const invalid = () => { throw Error('Invalid ADR lifecycle journal. Preserve it for recovery review.'); };
const changed = () => { throw Error('ADR lifecycle operation, part or storage identity changed or is unavailable. Existing files are preserved.'); };
const message = error => error.code ? `ADR lifecycle storage is unavailable (${error.code}). Existing files are preserved.` : error.message;
const reference = record => ({ id: record.id, path: record.path });
const fixed = ({ status, lifecycle, sha256, writtenAt, ...record }) => record;
function childValue(intent, index) { return { ...intent.steps[index], sourceDigest: intent.sourceDigest, journeyId: intent.journeyId }; }
function synthetic(intent, index) { return { ...childValue(intent, index), version: 1, id: intent.id, createdAt: intent.createdAt, stage: null, abandoned: false }; }
function validate(value) {
  if (!keys(value, 'version,id,kind,journeyId,sourceDigest,actor,createdAt,steps,abandoned,completed') || value.version !== 1 || !['accept', 'deprecate', 'successor'].includes(value.kind) || typeof value.abandoned !== 'boolean' || typeof value.completed !== 'boolean' || value.abandoned && value.completed || !Array.isArray(value.steps) || !value.steps.length || value.steps.length > 2) invalid();
  adrFileMarker(value.id); const event = validateContributionEvent({ actor: value.actor, at: value.createdAt });
  const steps = value.steps.map((step, index) => {
    if (!keys(step, 'target,content,record,base')) invalid();
    const { target, content, record, base } = validateAdrWriteIntent(synthetic(value, index));
    if (base && !equal(fixed(record), fixed(base))) invalid();
    return { target, content, record, base };
  });
  if (new Set(steps.map(step => step.record.id)).size !== steps.length || new Set(steps.map(step => step.target.path.toLowerCase())).size !== steps.length || steps.some(step => !equal(step.target.root, steps[0].target.root))) invalid();
  const first = steps[0], second = steps[1];
  if (value.kind === 'successor') {
    if (steps.length !== 2 || first.base !== null || first.record.status !== 'proposed' || !second.base || second.record.status !== second.base.status || !equal(first.record.lifecycle?.predecessor, reference(second.record)) || !second.record.lifecycle?.successors.some(ref => equal(ref, reference(first.record)))) invalid();
  } else {
    if (!first.base || first.record.status !== (value.kind === 'accept' ? 'accepted' : 'deprecated')) invalid();
    if (value.kind === 'deprecate' && steps.length !== 1) invalid();
    if (value.kind === 'accept') {
      const predecessor = first.record.lifecycle?.predecessor;
      if (predecessor ? steps.length !== 2 || !second.base || second.record.status !== 'superseded' || !equal(predecessor, reference(second.record)) || !equal(second.record.lifecycle?.supersededBy, reference(first.record)) : steps.length !== 1) invalid();
    }
  }
  const result = { version: 1, id: value.id, kind: value.kind, journeyId: value.journeyId, sourceDigest: value.sourceDigest, actor: event.actor, createdAt: event.at, steps, abandoned: value.abandoned, completed: value.completed };
  if (Buffer.byteLength(JSON.stringify(result)) > LIMIT) throw Error('ADR lifecycle journal exceeds its 1 MiB limit. No reviewed content was clipped.');
  return result;
}

/** The caller owns the exploration lock. File publication stays in AdrFileStorage. */
export class AdrLifecycleStorage {
  constructor(options) {
    this.options = options; this.anchor = new AdrFileStorage(options); this.children = new Map(); this.fault = async () => {};
    this.journalFile = join(this.anchor.directory, 'adr-lifecycle', adrBytesDigest(options.key), 'intent.json');
  }
  async readIntent() {
    try {
      await this.anchor.privateRoot(this.anchor.directory, null, false);
      const access = await projectDocumentAccess({ checkoutDirectory: this.anchor.directory, file: this.journalFile });
      return validate(parseDocumentJson((await access.read({ maxBytes: LIMIT })).bytes).value);
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async current(id) { const intent = await this.readIntent(); if (!intent || intent.id !== id) changed(); return intent; }
  async writeIntent(value, previousId) {
    const intent = validate(value);
    for (const step of intent.steps) { await this.anchor.assertTarget(step.target); await this.anchor.privateRoot(this.anchor.directory, step.target, true); }
    const parent = await directoryState(dirname(this.journalFile), true), lock = await acquireLock(join(parent.path, 'intent.lock'), { attempts: 50 });
    try {
      const previous = await this.readIntent(); if (previous?.id !== (previousId ?? undefined)) changed();
      if (previous && previous.id !== intent.id && !previous.completed && !previous.abandoned) throw Error('An unfinished ADR lifecycle operation is pending. Reconcile it first.');
      if (previous?.id === intent.id && (!equal({ ...previous, completed: intent.completed, abandoned: intent.abandoned }, intent) || previous.completed && !intent.completed || previous.abandoned && !intent.abandoned)) changed();
      for (const step of intent.steps) await this.anchor.assertTarget(step.target);
      if (!equal(await directoryState(parent.path), parent)) changed();
      await atomicWrite(this.journalFile, JSON.stringify(intent)); return intent;
    } finally { await lock.release(); }
  }
  async begin(value, previousId = null) {
    if (!keys(value, 'kind,journeyId,sourceDigest,actor,steps')) invalid();
    return this.writeIntent({ ...value, version: 1, id: randomUUID(), createdAt: new Date().toISOString(), abandoned: false, completed: false }, previousId);
  }
  child(intent, index) {
    if (!Number.isInteger(index) || index < 0 || index >= intent.steps.length) invalid();
    const key = `lifecycle:${adrBytesDigest(JSON.stringify([this.options.key, intent.id, index]))}`;
    if (!this.children.has(key)) this.children.set(key, new AdrFileStorage({ ...this.options, key }));
    return this.children.get(key);
  }
  async matchingChild(intent, index) {
    const child = this.child(intent, index), current = await child.readIntent(); if (!current) return null;
    const expected = childValue(intent, index), original = expected.target, target = current.target;
    const projected = { ...target, parents: target.parents.slice(0, original.parents.length) };
    if (target.parents.length < original.parents.length || !equal(projected, original) || !equal({ content: current.content, record: current.record, base: current.base, sourceDigest: current.sourceDigest, journeyId: current.journeyId }, { content: expected.content, record: expected.record, base: expected.base, sourceDigest: expected.sourceDigest, journeyId: expected.journeyId })) throw Error('ADR lifecycle child plan changed or does not match the confirmed operation. Preserve its files and journal.');
    return current;
  }
  async states(value) {
    const intent = validate(value), result = [];
    for (let index = 0; index < intent.steps.length; index++) {
      const step = intent.steps[index], base = { index, path: step.record.path, recordId: step.record.id };
      try {
        const child = this.child(intent, index), current = await this.matchingChild(intent, index);
        result.push({ ...base, ...await child.inspectIntent(current ?? synthetic(intent, index)) });
      } catch (error) { result.push({ ...base, publication: 'unavailable', cleanupRequired: null, message: message(error) }); }
    }
    return result;
  }
  async publish(id, guard) {
    if (typeof guard !== 'function') invalid();
    const intent = await this.current(id);
    if (intent.completed || intent.abandoned) throw Error('This ADR lifecycle operation is completed or abandoned and cannot be published again.');
    const check = states => { const problem = states.find(state => state.publication === 'unavailable'); if (problem) throw Error(problem.message); };
    check(await this.states(intent));
    for (let index = 0; index < intent.steps.length; index++) {
      const child = this.child(intent, index), current = await this.matchingChild(intent, index) ?? await child.begin(childValue(intent, index));
      await child.publish(current.id, async () => {
        const active = await this.current(id); if (active.completed || active.abandoned) changed();
        const states = await this.states(active); check(states); await guard(active, index, states);
      });
      await this.fault('after-file', intent, index);
    }
    return { intent, states: await this.states(intent) };
  }
  async complete(id, guard) {
    if (typeof guard !== 'function') invalid();
    const intent = await this.current(id); if (intent.completed) return intent;
    if (intent.abandoned || (await this.states(intent)).some(state => state.publication !== 'published' || state.cleanupRequired)) throw Error('Complete every ADR file publication and cleanup before recording lifecycle completion.');
    await guard(intent); return this.writeIntent({ ...intent, completed: true }, id);
  }
  async abandon(id) {
    const intent = await this.current(id); if (intent.completed) throw Error('Completed ADR lifecycle history cannot be abandoned.'); if (intent.abandoned) return intent;
    if ((await this.states(intent)).some(state => state.publication !== 'unpublished')) throw Error('A lifecycle file is published or unavailable. Preserve it and reconcile; this operation cannot be discarded.');
    for (let index = 0; index < intent.steps.length; index++) { const child = await this.matchingChild(intent, index); if (child) await this.child(intent, index).abandon(child.id); }
    return this.writeIntent({ ...intent, abandoned: true }, id);
  }
}
