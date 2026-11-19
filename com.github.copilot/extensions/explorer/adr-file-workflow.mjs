import { randomUUID } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { isDeepStrictEqual as equal } from 'node:util';
import { AdrFileStorage } from './adr-file-storage.mjs';
import { adrFileMarkdown, adrArtifactDigest, adrBytesDigest, associateAdrFile } from './adr-file.mjs';
import { defaultAdrFormat, adrFilename } from './adr-format.mjs';
import { adrReadiness } from './adr-readiness.mjs';
import { savedDigest } from './review-causes.mjs';
import { captureAdrSources, adrSourcesStatus } from './adr-sources.mjs';
import { captureAdrSourceLocation } from './adr-source-location.mjs';
import { appendAdrLifecycle } from './adr-lifecycle.mjs';
import { adrUpdateStatus } from './adr-update.mjs';

const TTL = 10 * 60 * 1000;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const identity = e => [e.file, e.activeKey, e.doc?.id, e.doc?.rootId, e.doc?.createdAt];
const invalid = () => { throw Error('Invalid ADR file request.'); };
const obsolete = () => { throw Error('This ADR preview is obsolete. Review the current wording and destination again.'); };
const message = error => error.code ? `ADR file or recovery storage is unavailable (${error.code}). Existing files are preserved.` : error.message;
const finished = recovery => !recovery || ['complete', 'abandoned', 'recorded-file-changed', 'completed-history'].includes(recovery.phase);
const bounded = value => { if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw Error('ADR file review exceeds its response limit. Nothing was clipped or authorized.'); return value; };

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
  async recordedLocation(e, store, target, entry) {
    await store.assertTarget(target);
    if (!entry.sources?.adrPath) return;
    const context = e.projectStore?.context;
    if (!context) throw Error('Reopen the original shared exploration to inspect this ADR file.');
    await context.assertCurrent();
    if (context !== e.projectStore?.context || relative(context.checkoutDirectory, join(target.root.path, entry.path)).split(sep).join('/') !== entry.sources.adrPath) throw Error('The recorded ADR location changed. Reopen the original working folder.');
  }
  async inspect(e, input) {
    if (!Number.isSafeInteger(input.revision) || input.revision !== e.doc.revision || typeof input.id !== 'string') invalid();
    const owner = identity(e), doc = e.doc, entry = doc.adrFiles?.find(record => record.id === input.id); if (!entry) invalid();
    let current = null, scenario, file;
    try { scenario = (await e.scenarioPolicy()).label; } catch { /* Missing policy is reported as unavailable coverage. */ }
    try { current = await e.readCurrent(); } catch { /* Historical data remains inspectable without a current source. */ }
    try {
      const store = await this.storage(e), observed = await store.observe(entry); await this.recordedLocation(e, store, observed.target, entry);
      file = { status: observed.target.base.sha256 === entry.sha256 ? 'matches' : 'modified', content: observed.oldContent, message: observed.target.base.sha256 === entry.sha256 ? 'File matches its recorded bytes.' : 'The file has external changes. Preserve it or explicitly review a complete replacement.' };
    } catch (error) { file = { status: error.code === 'ENOENT' ? 'missing' : 'unavailable', content: null, message: message(error) }; }
    if (e.closed || !equal(owner, identity(e)) || e.doc !== doc || input.revision !== e.doc.revision) obsolete();
    return bounded({ journey: input.journey, revision: input.revision, entry: { id: entry.id, path: entry.path, title: entry.title, status: entry.status }, baseline: entry.generated?.content ?? null,
      sourceIds: entry.sources?.nodes.map(n => n.record.id) ?? [], freshness: adrUpdateStatus(entry, current, e.projectStore?.context.relativePath ?? null, scenario), file });
  }
  async recovery(e, store) {
    const intent = await store.readIntent(); if (!intent) return null;
    const doc = await e.readCurrent(); if (intent.journeyId !== doc.id) throw Error('ADR recovery belongs to a different exploration. Preserve the journal for storage review.');
    const associationSaved = equal(doc.adrFiles?.find(record => record.id === intent.record.id), intent.record);
    const base = { id: intent.id, path: intent.target.path, content: intent.content, associationSaved, canReconcile: false, canDiscard: false };
    if (intent.completed && !associationSaved) return { ...base, phase: 'completed-history', fileSaved: null, cleanupRequired: null, message: 'This write completed previously. Its association has since changed; the historical receipt does not verify current file bytes.' };
    let state;
    try { state = await store.inspect(); }
    catch (error) { return { ...base, phase: associationSaved && (!intent.completionRequired || intent.completed) ? 'recorded-file-changed' : 'unavailable', fileSaved: null, cleanupRequired: null, message: message(error) }; }
    if (!state.intent || state.intent.id !== intent.id) throw Error('ADR recovery operation changed. Refresh its status.');
    const fileSaved = state.publication === 'published', phase = intent.abandoned ? 'abandoned' : fileSaved && associationSaved && !state.cleanupRequired ? intent.completionRequired && !intent.completed ? 'completion-pending' : 'complete' : fileSaved ? 'published' : 'unpublished';
    return { ...base, phase, fileSaved, cleanupRequired: state.cleanupRequired, canReconcile: !intent.abandoned && phase !== 'complete', canDiscard: !intent.abandoned && !fileSaved,
      message: phase === 'complete' ? 'ADR file and exploration association are saved.' : phase === 'completion-pending' ? 'ADR file and association are saved; completion still needs explicit reconciliation before another operation.' : phase === 'abandoned' ? 'Unpublished operation discarded. No ADR file was deleted.' : fileSaved ? 'ADR file is saved. Finish recovery to verify cleanup and save its exploration association.' : 'ADR file has not been published. Retry the confirmed write or explicitly discard this unpublished operation.' };
  }
  async result(e, store, error) {
    let recovery;
    try { recovery = await this.recovery(e, store); }
    catch (problem) { recovery = { phase: 'unavailable', fileSaved: null, associationSaved: null, canReconcile: false, canDiscard: false, message: message(problem) }; }
    const entries = (e.doc.adrFiles ?? []).map(({ id, path, title, status, writtenAt, sources }) => ({ id, path, title, status, writtenAt, hasSources: !!sources }));
    return { journey: e.activeKey ?? e.doc.id, revision: e.doc.revision, format: e.doc.adrFormat ?? defaultAdrFormat(), hasDraft: !!e.doc.adrDraft, entries, recovery, ...(error ? { error: message(error) } : {}) };
  }
  async associate(e, store, intent, owner) {
    await this.fault('before-association', intent);
    const doc = await e.fresh(), next = { ...structuredClone(doc), adrFiles: associateAdrFile(doc.adrFiles, intent.record, intent.associationBase ?? intent.base) }, base = savedDigest(doc);
    await e.commitCurrentLocked(doc, next, 'ADR project file associated', async () => {
      const state = await store.inspect();
      if (state.intent?.id !== intent.id || state.publication !== 'published' || state.cleanupRequired) throw Error('ADR file publication changed before its association could be saved. Refresh recovery.');
      const current = await e.readCurrent();
      if (e.closed || !equal(owner, identity(e)) || current.id !== intent.journeyId || savedDigest(current) !== base || savedDigest(e.doc) !== base) throw Error('Exploration changed before the ADR association saved. Refresh and reconcile; the ADR file is retained.');
    });
    await this.fault('after-association', intent);
  }
  async finish(e, store, intent, owner) {
    if (intent.completed) return;
    await store.publish(intent.id, current => this.checkSource(e, current, owner));
    await this.associate(e, store, intent, owner);
    await store.complete(intent.id, current => this.checkAssociation(e, current, owner));
  }
  async checkAssociation(e, intent, owner) {
    const doc = await e.readCurrent();
    if (e.closed || !equal(owner, identity(e)) || doc.id !== intent.journeyId || !equal(doc.adrFiles?.find(record => record.id === intent.record.id), intent.record)) throw Error('ADR association changed before completion could be recorded. Reconcile the saved operation.');
  }
  async hasPending(e) { return !finished(await this.recovery(e, await this.storage(e))); }
  async ensureCompleteReceipt(e) {
    const store = await this.storage(e), intent = await store.readIntent();
    if (!intent || intent.abandoned || intent.completed) return;
    const recovery = await this.recovery(e, store);
    if (recovery.phase === 'complete') await store.complete(intent.id, current => this.checkAssociation(e, current, identity(e)));
    else if (recovery.phase !== 'recorded-file-changed') throw Error('An unfinished ADR write needs recovery before changing its lifecycle.');
  }
  async request(e, input) {
    const fields = { status: 'action,journey', sources: 'action,journey,id,revision', inspect: 'action,journey,id,revision', prepare: 'action,journey,clientId,sequence,selection', cancel: 'action,journey,clientId,sequence', save: 'action,journey,token,revision' + (Object.hasOwn(input ?? {}, 'resolution') ? ',resolution' : ''), reconcile: 'action,journey,operationId,revision', 'discard-operation': 'action,journey,operationId,revision' };
    if (!input || !Object.hasOwn(fields, input.action) || !keys(input, fields[input.action]) || typeof input.journey !== 'string' || input.journey.length > 100 || e.closed || !e.doc || input.journey !== (e.activeKey ?? e.doc.id)) invalid();
    if (input.action === 'inspect') return this.inspect(e, input);
    if (input.action === 'sources') {
      if (!Number.isSafeInteger(input.revision) || input.revision !== e.doc.revision) throw Error('Exploration revision changed. Refresh before inspecting ADR sources.');
      const doc = e.doc, entry = doc.adrFiles?.find(item => item.id === input.id);
      if (typeof input.id !== 'string' || !entry) invalid();
      const capture = structuredClone(entry.sources ?? null); let current = null;
      try { current = await e.readCurrent(); } catch { /* Historical capture remains readable when current source authority is unavailable. */ }
      if (e.closed || e.doc !== doc || e.doc.revision !== input.revision || input.journey !== (e.activeKey ?? e.doc.id)) obsolete();
      return { journey: input.journey, revision: input.revision, id: entry.id, path: entry.path, title: entry.title, capture,
        sourceStatus: adrSourcesStatus(capture, current, e.projectStore?.context.relativePath ?? null) };
    }
    const store = await this.storage(e);
    if (input.action === 'status') return this.result(e, store);
    if (input.action !== 'cancel' && await e.adrLifecycle.hasPending(e)) throw Error('An unfinished ADR lifecycle operation needs reconciliation before another ADR write.');
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
      if (review.associationBase ? input.resolution !== 'replace' : Object.hasOwn(input, 'resolution')) throw Error('Choose an explicit replace resolution for this complete reviewed file, or keep the current file unchanged.');
      const source = await this.source(e);
      if (source.digest !== review.sourceDigest || source.readiness.digest !== review.record.readinessDigest || !this.valid(e, review)) obsolete();
      this.invalidate();
      try {
        const intent = await store.begin({ target: review.target, content: review.content, record: { ...review.record, writtenAt: new Date().toISOString() }, base: review.base, ...(review.associationBase ? { associationBase: review.associationBase } : {}), sourceDigest: review.sourceDigest, journeyId: source.doc.id }, review.previousId);
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
    if (!(keys(selection, 'kind,number') && selection.kind === 'new') && !(keys(selection, 'kind,id') && ['update', 'review-update'].includes(selection.kind) && typeof selection.id === 'string')) invalid();
    const recovery = await this.recovery(e, store); if (!finished(recovery)) throw Error('An unfinished ADR write needs recovery before another preview. Inspect its saved parts or discard it only if unpublished.');
    const source = await this.source(e), format = source.doc.adrDraft.format;
    const base = selection.kind !== 'new' ? source.doc.adrFiles?.find(record => record.id === selection.id) : null, reviewedUpdate = selection.kind === 'review-update';
    if (selection.kind !== 'new' && (!base || base.status !== 'proposed')) throw Error('Only proposed ADR wording can be updated. Create a successor proposal to revise an accepted decision.');
    if (selection.kind === 'new' && (format.naming === 'slug' ? selection.number !== null : !Number.isSafeInteger(selection.number))) invalid();
    const path = base?.path ?? adrFilename(format, source.doc.adrDraft.title, selection.number), id = base?.id ?? randomUUID();
    const preview = reviewedUpdate ? await store.observe(base) : await store.capture(path, base ?? null), located = await captureAdrSourceLocation(e, preview.target);
    if (base?.sources?.adrPath && located.location.adrPath !== base.sources.adrPath) throw Error('The ADR destination location changed with the working directory. Reopen the original folder before updating this recorded file.');
    const sources = captureAdrSources(source.doc, located.location);
    let content = adrFileMarkdown(source.doc.adrDraft, id, source.policy.label, sources);
    const record = { version: 1, id, path, title: source.doc.adrDraft.title, status: 'proposed', sha256: adrBytesDigest(content), artifactDigest: source.artifactDigest, readinessDigest: source.readiness.digest, writtenAt: new Date().toISOString(), sources, ...(base?.lifecycle ? { lifecycle: structuredClone(base.lifecycle) } : {}) };
    if (record.lifecycle) { content = appendAdrLifecycle(content, record); record.sha256 = adrBytesDigest(content); }
    record.generated = { version: 1, content };
    associateAdrFile(source.doc.adrFiles, record, base ?? null);
    await located.assertCurrent(); const latest = await this.source(e);
    if (!this.valid(e, review) || source.digest !== latest.digest || source.readiness.digest !== latest.readiness.digest) obsolete();
    Object.assign(review, { ...preview, content, record, base: reviewedUpdate ? { ...base, sha256: preview.target.base.sha256 } : base ?? null, ...(reviewedUpdate ? { associationBase: base } : {}), sourceDigest: source.digest, previousId: recovery?.id ?? null, token: randomUUID() });
    const response = bounded({ journey: input.journey, clientId: input.clientId, sequence: input.sequence, token: review.token, expiresAt: review.expiresAt, path, content, oldContent: preview.oldContent, mode: selection.kind, readiness: source.readiness,
      ...(reviewedUpdate ? { baseline: base.generated?.content ?? null, requiresResolution: !base.generated || preview.oldContent !== base.generated.content, sourceIds: sources.nodes.map(n => n.record.id), originalSourceIds: base.sources?.nodes.map(n => n.record.id) ?? [], freshness: adrUpdateStatus(base, source.doc, e.projectStore?.context.relativePath ?? null, source.policy.label) } : {}),
      message: reviewedUpdate ? 'Compare the historical generated baseline, current file and complete proposed replacement. Keep current writes nothing. Explicit replacement may discard manual edits and does not approve the decision.' : 'Exact proposed Markdown. Saving writes only this reviewed project file and its exploration association; it does not approve the decision or commit to Git.' });
    this.current = review; this.timer = setTimeout(() => this.invalidate(), TTL); this.timer.unref?.(); return response;
  }
}
