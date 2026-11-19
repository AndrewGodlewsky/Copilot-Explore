import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { join, relative, sep } from 'node:path';
import { AdrLifecycleStorage } from './adr-lifecycle-storage.mjs';
import { changeAdrLifecycle, linkAdrSuccessor, appendAdrLifecycle, transitionAdrMarkdown } from './adr-lifecycle.mjs';
import { adrBytesDigest, adrFileMarkdown, associateAdrBatch } from './adr-file.mjs';
import { adrFilename } from './adr-format.mjs';
import { captureAdrSources, adrSourcesStatus } from './adr-sources.mjs';
import { captureAdrSourceLocation } from './adr-source-location.mjs';
import { savedDigest } from './review-causes.mjs';

const TTL = 10 * 60 * 1000;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const identity = e => [e.file, e.activeKey, e.doc?.id, e.doc?.rootId, e.doc?.createdAt];
const invalid = () => { throw Error('Invalid ADR lifecycle request.'); };
const obsolete = () => { throw Error('This ADR lifecycle preview is obsolete. Review the current decision and files again.'); };
const message = error => error.code ? `ADR lifecycle storage is unavailable (${error.code}). Existing files are preserved.` : error.message;
const pairs = intent => intent.steps.map(({ record, base }) => ({ record, base }));
const associated = (doc, intent) => intent.steps.every(step => equal(doc.adrFiles?.find(record => record.id === step.record.id), step.record));
const bounded = value => { if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw Error('ADR lifecycle review exceeds its response limit. Nothing was clipped or authorized.'); return value; };

export class AdrLifecycleWorkflow {
  constructor(readRoot) { this.readRoot = readRoot; this.generation = 0; this.order = null; this.current = null; this.timer = null; this.owner = null; this.store = null; this.fault = async () => {}; }
  invalidate() { clearTimeout(this.timer); this.timer = null; this.current = null; this.generation++; }
  clear() { this.invalidate(); this.owner = null; this.store = null; }
  async storage(e) {
    const owner = identity(e); if (this.store && equal(this.owner, owner)) return this.store;
    const key = await e.draftIdentity(e.activeKey ?? e.doc.id);
    if (!equal(owner, identity(e)) || e.closed) obsolete();
    this.store = new AdrLifecycleStorage({ readRoot: this.readRoot, directory: e.auxiliaryDirectory(), lockDirectory: e.library?.directory ?? e.auxiliaryDirectory(), key }); this.owner = owner;
    return this.store;
  }
  valid(e, review) { return !e.closed && review.generation === this.generation && review.order === this.order && equal(review.owner, identity(e)) && Date.now() < review.expiresAt; }
  async actor(e) { const settings = e.contributorSettings(); return settings ? (await settings.read()).actor : null; }
  async hasPending(e) { const intent = await (await this.storage(e)).readIntent(); return !!intent && !intent.completed && !intent.abandoned; }
  async location(e, store, step) {
    await store.anchor.assertTarget(step.target);
    if (!step.record.sources?.adrPath) return;
    const context = e.projectStore?.context;
    if (!context) throw Error('Reopen the original shared journey and working folder to change this ADR lifecycle.');
    await context.assertCurrent();
    if (context !== e.projectStore?.context || relative(context.checkoutDirectory, join(step.target.root.path, step.record.path)).split(sep).join('/') !== step.record.sources.adrPath) throw Error('The recorded ADR location changed. Reopen its original working folder before changing its lifecycle.');
  }
  async authority(e, store, intent, owner) {
    for (const step of intent.steps) await this.location(e, store, step);
    const doc = await e.fresh();
    if (e.closed || !equal(owner, identity(e)) || doc.id !== intent.journeyId) obsolete();
    associateAdrBatch(doc.adrFiles, pairs(intent));
    return doc;
  }
  async source(e, intent, owner) {
    const actor = await this.actor(e), doc = await e.fresh();
    if (e.closed || !equal(owner, identity(e)) || doc.id !== intent.journeyId || savedDigest(doc) !== intent.sourceDigest || !equal(actor, intent.actor)) throw Error('Saved source context or contributor identity changed. Review again or discard unpublished work.');
    if (intent.kind === 'successor') {
      const current = await e.adrWriter.source(e), record = intent.steps[0].record;
      if (current.digest !== intent.sourceDigest || current.artifactDigest !== record.artifactDigest || current.readiness.digest !== record.readinessDigest || e.closed || !equal(owner, identity(e))) obsolete();
    }
  }
  async recovery(e, store) {
    const intent = await store.readIntent(); if (!intent) return null;
    const doc = await e.readCurrent(); if (doc.id !== intent.journeyId) throw Error('ADR lifecycle recovery belongs to another exploration. Preserve its journal.');
    const associationSaved = associated(doc, intent), states = await store.states(intent);
    const files = states.map((state, index) => ({ path: state.path, fileSaved: state.publication === 'unavailable' ? null : state.publication === 'published', cleanupRequired: state.cleanupRequired, content: intent.steps[index].content, ...(state.message ? { message: state.message } : {}) }));
    const complete = associationSaved && files.every(file => file.fileSaved && !file.cleanupRequired);
    const phase = intent.completed ? complete ? 'complete' : 'completed-history' : intent.abandoned ? 'abandoned' : files.some(file => file.fileSaved === null) ? 'unavailable' : files.some(file => file.fileSaved) ? 'published' : 'unpublished';
    return { id: intent.id, kind: intent.kind, phase, files, associationSaved,
      canReconcile: !intent.completed && !intent.abandoned && phase !== 'unavailable', canDiscard: !intent.completed && !intent.abandoned && files.every(file => file.fileSaved === false),
      message: phase === 'complete' ? 'ADR files, relationships and lifecycle history are saved.' : phase === 'completed-history' ? 'This operation completed previously. Later changes mean its receipt does not verify current files or associations.' : phase === 'abandoned' ? 'Unpublished operation discarded. No published ADR file was deleted.' : 'Review each saved part. Reconciliation finishes the exact confirmed operation and retains newer source answers; published parts cannot be discarded.' };
  }
  async result(e, store, error) {
    let recovery;
    try { recovery = await this.recovery(e, store); }
    catch (problem) { recovery = { phase: 'unavailable', files: [], associationSaved: null, canReconcile: false, canDiscard: false, message: message(problem) }; }
    return bounded({ journey: e.activeKey ?? e.doc.id, revision: e.doc.revision,
      entries: (e.doc.adrFiles ?? []).map(({ id, path, title, status, lifecycle }) => ({ id, path, title, status, lifecycle: lifecycle ?? null })), recovery, ...(error ? { error: message(error) } : {}) });
  }
  async checkAssociation(e, store, intent, owner) {
    const doc = await this.authority(e, store, intent, owner);
    if (!associated(doc, intent)) throw Error('ADR lifecycle associations changed before completion. Reconcile the saved operation.');
  }
  async finish(e, store, intent, owner) {
    if (intent.completed) return;
    await store.publish(intent.id, async (current, _, states) => {
      await this.authority(e, store, current, owner);
      if (!states.some(state => state.publication === 'published')) await this.source(e, current, owner);
    });
    await this.fault('before-association', intent);
    const doc = await this.authority(e, store, intent, owner), digest = savedDigest(doc);
    const next = { ...structuredClone(doc), adrFiles: associateAdrBatch(doc.adrFiles, pairs(intent)) };
    await e.commitCurrentLocked(doc, next, 'ADR lifecycle and relationships saved', async () => {
      const active = await store.current(intent.id), states = await store.states(active);
      if (active.completed || active.abandoned || states.some(state => state.publication !== 'published' || state.cleanupRequired)) throw Error('ADR lifecycle publication changed before association. Reconcile its saved parts.');
      const current = await this.authority(e, store, intent, owner);
      if (savedDigest(current) !== digest || savedDigest(e.doc) !== digest) throw Error('Exploration changed before ADR lifecycle association. Existing files are retained.');
    });
    await this.fault('after-association', intent); await this.fault('before-completion', intent);
    await store.complete(intent.id, current => this.checkAssociation(e, store, current, owner));
  }
  async existingStep(e, store, base, record) {
    const capture = await store.anchor.capture(base.path, base), step = { target: capture.target, base, record, content: transitionAdrMarkdown(capture.oldContent, base, record) };
    step.record = { ...record, sha256: adrBytesDigest(step.content) }; await this.location(e, store, step);
    return { step, oldContent: capture.oldContent };
  }
  async prepare(e, store, selection, review) {
    if (!(keys(selection, 'kind,id') && ['accept', 'deprecate'].includes(selection.kind)) && !(keys(selection, 'kind,id,number') && selection.kind === 'successor') || typeof selection.id !== 'string') invalid();
    const previous = await store.readIntent();
    if (previous && !previous.completed && !previous.abandoned || await e.adrWriter.hasPending(e)) throw Error('An unfinished ADR operation needs recovery before another lifecycle preview.');
    const actor = await this.actor(e), at = new Date().toISOString(), doc = await e.fresh(), digest = savedDigest(doc), base = doc.adrFiles?.find(record => record.id === selection.id);
    if (!base) invalid();
    let files, located;
    if (selection.kind === 'successor') {
      if (!['accepted', 'deprecated'].includes(base.status) || !base.lifecycle?.events.some(event => event.to === 'accepted')) throw Error('Choose an accepted or previously accepted deprecated ADR for a successor proposal. Superseded decisions retain their existing successor.');
      const source = await e.adrWriter.source(e), format = source.doc.adrDraft.format;
      if (source.digest !== digest) obsolete();
      if (format.naming === 'slug' ? selection.number !== null : !Number.isSafeInteger(selection.number)) invalid();
      const path = adrFilename(format, source.doc.adrDraft.title, selection.number), id = randomUUID(), capture = await store.anchor.capture(path);
      located = await captureAdrSourceLocation(e, capture.target);
      const sources = captureAdrSources(doc, located.location), content = adrFileMarkdown(doc.adrDraft, id, source.policy.label, sources);
      const record = { version: 1, id, path, title: doc.adrDraft.title, status: 'proposed', sha256: adrBytesDigest(content), artifactDigest: source.artifactDigest, readinessDigest: source.readiness.digest, writtenAt: at, sources };
      const linked = linkAdrSuccessor(doc.adrFiles, base.id, record), child = linked.find(record => record.id === id), updated = linked.find(record => record.id === base.id);
      const proposed = appendAdrLifecycle(content, child); child.sha256 = adrBytesDigest(proposed);
      files = [{ step: { target: capture.target, base: null, record: child, content: proposed }, oldContent: null }, await this.existingStep(e, store, base, updated)];
    } else {
      const changed = changeAdrLifecycle(doc.adrFiles, selection, { actor, at });
      const ids = [base.id, ...(selection.kind === 'accept' && base.lifecycle?.predecessor ? [base.lifecycle.predecessor.id] : [])];
      files = [];
      for (const id of ids) files.push(await this.existingStep(e, store, doc.adrFiles.find(record => record.id === id), changed.find(record => record.id === id)));
    }
    const plan = { kind: selection.kind, journeyId: doc.id, sourceDigest: digest, actor, steps: files.map(file => file.step) };
    associateAdrBatch(doc.adrFiles, pairs(plan));
    await located?.assertCurrent(); await this.authority(e, store, plan, review.owner); await this.source(e, plan, review.owner);
    if (!this.valid(e, review)) obsolete();
    const token = randomUUID(), response = bounded({ journey: e.activeKey ?? e.doc.id, clientId: review.order.clientId, sequence: review.order.sequence, token, expiresAt: review.expiresAt, kind: selection.kind, actor,
      files: files.map(({ step, oldContent }) => ({ id: step.record.id, path: step.record.path, oldContent, content: step.content, fromStatus: step.base?.status ?? null, toStatus: step.record.status, sourceStatus: adrSourcesStatus(step.record.sources ?? null, doc, e.projectStore?.context.relativePath ?? null) })),
      message: selection.kind === 'successor' ? 'Save a new proposed successor and reciprocal references. The older decision keeps its status and reasoning until a separate explicit acceptance.' : 'Confirm only the reviewed status, history and reference changes. Existing reasoning and source uncertainty are retained; no source answer, scenario preference or Git commit changes.' });
    Object.assign(review, { plan, token, previousId: previous?.id ?? null }); this.current = review;
    this.timer = setTimeout(() => this.invalidate(), TTL); this.timer.unref?.(); return response;
  }
  async request(e, input) {
    const fields = { status: 'action,journey', prepare: 'action,journey,clientId,sequence,selection', cancel: 'action,journey,clientId,sequence', save: 'action,journey,token,revision', reconcile: 'action,journey,operationId,revision', discard: 'action,journey,operationId,revision' };
    if (!input || !Object.hasOwn(fields, input.action) || !keys(input, fields[input.action]) || typeof input.journey !== 'string' || input.journey.length > 100 || e.closed || !e.doc || input.journey !== (e.activeKey ?? e.doc.id)) invalid();
    const store = await this.storage(e);
    if (input.action === 'status') return this.result(e, store);
    if (['save', 'reconcile', 'discard'].includes(input.action)) {
      if (!Number.isSafeInteger(input.revision) || input.revision !== e.doc.revision) throw Error('Exploration revision changed. Refresh before changing an ADR lifecycle.');
      await e.fresh(); const owner = identity(e);
      if (input.action !== 'save') {
        const intent = await store.readIntent(); if (typeof input.operationId !== 'string' || !intent || intent.id !== input.operationId || intent.journeyId !== e.doc.id) invalid();
        if (await e.adrWriter.hasPending(e)) throw Error('An unfinished ADR write needs recovery before lifecycle reconciliation.');
        this.invalidate();
        try { if (input.action === 'discard') await store.abandon(intent.id); else await this.finish(e, store, intent, owner); }
        catch (error) { return this.result(e, store, error); }
        return this.result(e, store);
      }
      const review = this.current;
      if (!review || typeof input.token !== 'string' || input.token !== review.token || !this.valid(e, review)) obsolete();
      await this.authority(e, store, review.plan, owner); await this.source(e, review.plan, owner);
      if (!this.valid(e, review)) obsolete(); this.invalidate();
      try {
        await e.adrWriter.ensureCompleteReceipt(e);
        const intent = await store.begin(review.plan, review.previousId); await this.finish(e, store, intent, owner);
      } catch (error) { return this.result(e, store, error); }
      return this.result(e, store);
    }
    if (typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.clientId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1) invalid();
    if (this.order?.clientId === input.clientId && input.sequence <= this.order.sequence) obsolete();
    if (input.action === 'cancel' && this.order && input.clientId !== this.order.clientId) return { journey: input.journey, cancelled: true };
    this.order = { clientId: input.clientId, sequence: input.sequence }; this.invalidate();
    if (input.action === 'cancel') return { journey: input.journey, cancelled: true };
    return this.prepare(e, store, input.selection, { generation: this.generation, order: this.order, owner: identity(e), expiresAt: Date.now() + TTL });
  }
}
