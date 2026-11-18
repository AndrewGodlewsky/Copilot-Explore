import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { AdrFileStorage } from './adr-file-storage.mjs';
import { adrFileMarkdown, adrArtifactDigest, adrBytesDigest, associateAdrFile } from './adr-file.mjs';
import { defaultAdrFormat, adrFilename } from './adr-format.mjs';
import { adrReadiness } from './adr-readiness.mjs';
import { savedDigest } from './review-causes.mjs';

const TTL = 10 * 60 * 1000;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const identity = e => [e.file, e.activeKey, e.doc?.id, e.doc?.rootId, e.doc?.createdAt];
const invalid = () => { throw Error('Invalid ADR file request.'); };
const obsolete = () => { throw Error('This ADR preview is obsolete. Review the current wording and destination again.'); };
const message = error => error.code ? `ADR file or recovery storage is unavailable (${error.code}). Existing files are preserved.` : error.message;
const finished = recovery => !recovery || ['complete', 'abandoned', 'recorded-file-changed'].includes(recovery.phase);

export class AdrFileWorkflow {
  constructor(readRoot) { this.readRoot = readRoot; this.generation = 0; this.order = null; this.current = null; this.timer = null; this.owner = null; this.store = null; this.fault = async () => {}; }
  invalidate() { clearTimeout(this.timer); this.timer = null; this.current = null; this.generation++; }
  clear() { this.invalidate(); this.owner = null; this.store = null; }
  async storage(e) {
    const owner = identity(e); if (this.store && equal(this.owner, owner)) return this.store;
    const key = await e.draftIdentity(e.activeKey ?? e.doc.id);
    if (!equal(owner, identity(e)) || e.closed) obsolete();
    this.store = new AdrFileStorage({ readRoot: this.readRoot, directory: e.auxiliaryDirectory(), lockDirectory: e.library?.directory ?? e.auxiliaryDirectory(), key }); this.owner = owner;
    return this.store;
  }
  valid(e, review) { return !e.closed && review.generation === this.generation && review.order === this.order && equal(review.owner, identity(e)) && Date.now() < review.expiresAt; }
  async source(e) {
    const policy = await e.scenarioPolicy(), doc = await e.fresh();
    if (!doc.adrDraft) throw Error('Accept proposed ADR wording into this exploration before reviewing a project file.');
    const readiness = adrReadiness(doc.adrDraft, doc, policy.label);
    if (readiness.blockers) throw Error('ADR readiness has correctness blockers. Review current sources and draft wording before writing.');
    return { doc, policy, readiness, digest: savedDigest(doc), artifactDigest: adrArtifactDigest(doc.adrDraft) };
  }
  async checkSource(e, intent, owner) {
    const source = await this.source(e);
    if (e.closed || !equal(owner, identity(e)) || source.doc.id !== intent.journeyId || source.digest !== intent.sourceDigest || source.artifactDigest !== intent.record.artifactDigest || source.readiness.digest !== intent.record.readinessDigest) throw Error('Saved ADR wording or source context changed. Review again; unpublished work may be explicitly discarded.');
  }
  async recovery(e, store) {
    const intent = await store.readIntent(); if (!intent) return null;
    const doc = await e.readCurrent(); if (intent.journeyId !== doc.id) throw Error('ADR recovery belongs to a different exploration. Preserve the journal for storage review.');
    const associationSaved = equal(doc.adrFiles?.find(record => record.id === intent.record.id), intent.record);
    const base = { id: intent.id, path: intent.target.path, content: intent.content, associationSaved, canReconcile: false, canDiscard: false };
    let state;
    try { state = await store.inspect(); }
    catch (error) { return { ...base, phase: associationSaved ? 'recorded-file-changed' : 'unavailable', fileSaved: null, cleanupRequired: null, message: message(error) }; }
    if (!state.intent || state.intent.id !== intent.id) throw Error('ADR recovery operation changed. Refresh its status.');
    const fileSaved = state.publication === 'published', phase = intent.abandoned ? 'abandoned' : fileSaved && associationSaved && !state.cleanupRequired ? 'complete' : fileSaved ? 'published' : 'unpublished';
    return { ...base, phase, fileSaved, cleanupRequired: state.cleanupRequired, canReconcile: !intent.abandoned && phase !== 'complete', canDiscard: !intent.abandoned && !fileSaved,
      message: phase === 'complete' ? 'ADR file and exploration association are saved.' : phase === 'abandoned' ? 'Unpublished operation discarded. No ADR file was deleted.' : fileSaved ? 'ADR file is saved. Finish recovery to verify cleanup and save its exploration association.' : 'ADR file has not been published. Retry the confirmed write or explicitly discard this unpublished operation.' };
  }
  async result(e, store, error) {
    let recovery;
    try { recovery = await this.recovery(e, store); }
    catch (problem) { recovery = { phase: 'unavailable', fileSaved: null, associationSaved: null, canReconcile: false, canDiscard: false, message: message(problem) }; }
    return { journey: e.activeKey ?? e.doc.id, revision: e.doc.revision, format: e.doc.adrFormat ?? defaultAdrFormat(), hasDraft: !!e.doc.adrDraft, entries: structuredClone(e.doc.adrFiles ?? []), recovery, ...(error ? { error: message(error) } : {}) };
  }
  async associate(e, store, intent, owner) {
    await this.fault('before-association', intent);
    const doc = await e.fresh(), next = { ...structuredClone(doc), adrFiles: associateAdrFile(doc.adrFiles, intent.record, intent.base) }, base = savedDigest(doc);
    await e.commitCurrentLocked(doc, next, 'ADR project file associated', async () => {
      const state = await store.inspect();
      if (state.intent?.id !== intent.id || state.publication !== 'published' || state.cleanupRequired) throw Error('ADR file publication changed before its association could be saved. Refresh recovery.');
      const current = await e.readCurrent();
      if (e.closed || !equal(owner, identity(e)) || current.id !== intent.journeyId || savedDigest(current) !== base || savedDigest(e.doc) !== base) throw Error('Exploration changed before the ADR association saved. Refresh and reconcile; the ADR file is retained.');
    });
    await this.fault('after-association', intent);
  }
  async finish(e, store, intent, owner) {
    await store.publish(intent.id, current => this.checkSource(e, current, owner));
    await this.associate(e, store, intent, owner);
  }
  async request(e, input) {
    const fields = { status: 'action,journey', prepare: 'action,journey,clientId,sequence,selection', cancel: 'action,journey,clientId,sequence', save: 'action,journey,token,revision', reconcile: 'action,journey,operationId,revision', 'discard-operation': 'action,journey,operationId,revision' };
    if (!input || !Object.hasOwn(fields, input.action) || !keys(input, fields[input.action]) || typeof input.journey !== 'string' || input.journey.length > 100 || e.closed || !e.doc || input.journey !== (e.activeKey ?? e.doc.id)) invalid();
    const store = await this.storage(e);
    if (input.action === 'status') return this.result(e, store);
    if (['save', 'reconcile', 'discard-operation'].includes(input.action)) {
      if (!Number.isSafeInteger(input.revision) || input.revision !== e.doc.revision) throw Error('Exploration revision changed. Refresh before saving or reconciling an ADR.');
      await e.fresh(); const owner = identity(e);
      if (input.action !== 'save') {
        const intent = await store.readIntent(); if (typeof input.operationId !== 'string' || !intent || intent.id !== input.operationId || intent.journeyId !== e.doc.id) invalid();
        this.invalidate();
        try { if (input.action === 'discard-operation') await store.abandon(intent.id); else await this.finish(e, store, intent, owner); }
        catch (error) { return this.result(e, store, error); }
        return this.result(e, store);
      }
      const review = this.current;
      if (!review || typeof input.token !== 'string' || input.token !== review.token || !this.valid(e, review)) obsolete();
      const source = await this.source(e);
      if (source.digest !== review.sourceDigest || source.readiness.digest !== review.record.readinessDigest || !this.valid(e, review)) obsolete();
      this.invalidate();
      try {
        const intent = await store.begin({ target: review.target, content: review.content, record: { ...review.record, writtenAt: new Date().toISOString() }, base: review.base, sourceDigest: review.sourceDigest, journeyId: source.doc.id }, review.previousId);
        await this.finish(e, store, intent, owner);
      } catch (error) { return this.result(e, store, error); }
      return this.result(e, store);
    }
    if (typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.clientId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1) invalid();
    if (this.order?.clientId === input.clientId && input.sequence <= this.order.sequence) obsolete();
    if (input.action === 'cancel' && this.order && input.clientId !== this.order.clientId) return { journey: input.journey, cancelled: true };
    this.order = { clientId: input.clientId, sequence: input.sequence }; this.invalidate();
    if (input.action === 'cancel') return { journey: input.journey, cancelled: true };
    const review = { generation: this.generation, order: this.order, owner: identity(e), expiresAt: Date.now() + TTL }, selection = input.selection;
    if (!(keys(selection, 'kind,number') && selection.kind === 'new') && !(keys(selection, 'kind,id') && selection.kind === 'update' && typeof selection.id === 'string')) invalid();
    const recovery = await this.recovery(e, store); if (!finished(recovery)) throw Error('An unfinished ADR write needs recovery before another preview. Inspect its saved parts or discard it only if unpublished.');
    const source = await this.source(e), format = source.doc.adrDraft.format;
    const base = selection.kind === 'update' ? source.doc.adrFiles?.find(record => record.id === selection.id) : null;
    if (selection.kind === 'update' && !base) throw Error('Select a recorded managed proposed ADR to update.');
    if (selection.kind === 'new' && (format.naming === 'slug' ? selection.number !== null : !Number.isSafeInteger(selection.number))) invalid();
    const path = base?.path ?? adrFilename(format, source.doc.adrDraft.title, selection.number), id = base?.id ?? randomUUID();
    const content = adrFileMarkdown(source.doc.adrDraft, id, source.policy.label), record = { version: 1, id, path, title: source.doc.adrDraft.title, status: 'proposed', sha256: adrBytesDigest(content), artifactDigest: source.artifactDigest, readinessDigest: source.readiness.digest, writtenAt: new Date().toISOString() };
    associateAdrFile(source.doc.adrFiles, record, base ?? null);
    const preview = await store.capture(path, base ?? null), latest = await this.source(e);
    if (!this.valid(e, review) || source.digest !== latest.digest || source.readiness.digest !== latest.readiness.digest) obsolete();
    Object.assign(review, { ...preview, content, record, base: base ?? null, sourceDigest: source.digest, previousId: recovery?.id ?? null, token: randomUUID() });
    this.current = review; this.timer = setTimeout(() => this.invalidate(), TTL); this.timer.unref?.();
    return { journey: input.journey, clientId: input.clientId, sequence: input.sequence, token: review.token, expiresAt: review.expiresAt, path, content, oldContent: preview.oldContent, mode: selection.kind, readiness: source.readiness,
      message: 'Exact proposed Markdown. Saving writes only this reviewed project file and its exploration association; it does not approve the decision or commit to Git.' };
  }
}
