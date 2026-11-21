import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { deadline } from './owned-helper.mjs';
import { prepareProjectBrief, validateProjectBrief, editProjectBrief, projectCorrections } from './project-brief.mjs';
import { projectRootKey } from './project-context.mjs';

const purpose = 'project-brief', lifetime = 600000, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{20,80}$/.test(value);
const changed = () => Error('Project brief or captured files changed. Review the current scope and brief again.');
const claimSummary = draft => Object.fromEntries(Object.entries(draft.sections).map(([section, claims]) => [section, claims.map(({ text, kind }) => ({ text, kind }))]));

export class ProjectBriefWorkspace {
  constructor({ mode, journey, execute, now = Date.now }) { Object.assign(this, { mode, journey, execute, now }); this.epoch = 0; this.clear(); }
  clear() {
    this.epoch++; this.validation?.abort(); this.work?.abort.abort(); this.validation = this.work = this.preview = this.draft = this.approval = null;
    this.assertions = []; this.root = this.previous = null; this.observedCaptureId = this.checkedCaptureId = null; this.clientId = this.boundJourney = null; this.sequence = this.revision = 0; this.error = '';
  }
  invalidate(message = '', retainComparison = false) {
    const changed = this.preview || this.work || this.draft || this.approval;
    if (retainComparison && this.draft) this.previous = claimSummary(this.draft);
    if (!retainComparison) this.previous = null;
    if (this.draft) this.assertions = projectCorrections(this.draft);
    this.validation?.abort(); this.work?.abort.abort(); this.preview = this.work = this.draft = this.approval = null; this.checkedCaptureId = null;
    if (changed) this.revision++; this.error = message;
  }
  observe() {
    const capture = this.mode.capture();
    const compare = !['off', 'unavailable'].includes(this.mode.contextState?.());
    if (!compare) this.previous = null;
    const project = this.mode.projectIdentity?.() ?? capture?.root;
    if (project && this.root && !same(project, this.root)) {
      this.invalidate('The working project changed. Its previous brief and corrections were cleared.');
      this.assertions = []; this.root = structuredClone(project); this.observedCaptureId = null;
    }
    if (capture?.id !== this.observedCaptureId && (capture || this.observedCaptureId)) {
      this.invalidate(capture ? '' : 'Project scope is off or changed. User corrections remain local until discarded or the project changes.', compare);
      if (capture && this.root && !same(this.root, capture.root)) this.assertions = [];
      if (capture) this.root = structuredClone(capture.root);
      this.observedCaptureId = capture?.id ?? null;
    }
    return capture;
  }
  async verify(capture, content, signal) {
    const abort = new AbortController(), cancel = () => abort.abort();
    if (signal?.aborted) abort.abort(); signal?.addEventListener('abort', cancel, { once: true });
    try { return await deadline(this.mode.captureCurrent(capture, { content, signal: abort.signal }), 5000); }
    finally { abort.abort(); signal?.removeEventListener('abort', cancel); }
  }
  approvalCurrent(guard) {
    const capture = this.observe();
    return !!guard && !!this.approval && guard.approval === this.approval && guard.draft === this.draft && guard.epoch === this.epoch &&
      guard.journey === this.boundJourney && this.boundJourney === this.journey() && guard.capture.id === capture?.id && this.approval.revision === this.revision;
  }
  async assertApproval(guard, { signal } = {}) {
    if (!this.approvalCurrent(guard)) throw changed();
    try {
      if (!await this.verify(guard.capture, true, signal) || !this.approvalCurrent(guard)) throw changed();
    } catch (error) {
      if (this.approvalCurrent(guard) && !signal?.aborted) this.invalidate('Project files or scope changed or could not be verified. Review and approve a current brief again.', !['off', 'unavailable'].includes(this.mode.contextState?.()));
      throw error;
    }
  }
  async approvedInput({ signal } = {}) {
    const capture = this.observe();
    if (!capture || !this.approval || !this.draft) throw Error('Approve a current project brief first, or use ordinary questions without project context.');
    const guard = Object.freeze({ capture, approval: this.approval, draft: this.draft, epoch: this.epoch, journey: this.boundJourney });
    await this.assertApproval(guard, { signal });
    const claims = Object.entries(this.draft.sections).flatMap(([section, claims]) => claims.map(({ id, text, kind }) => ({ id, section, text, kind })));
    return { guard, brief: { revision: this.revision, claims } };
  }
  view(input) {
    const capture = this.mode.capture(), state = this.work?.status === 'pending' ? 'pending' : this.preview ? 'review' : this.error ? 'error' : this.approval ? 'approved' : this.draft ? 'draft' : capture ? 'ready' : 'off';
    return structuredClone({ purpose, clientId: input.clientId, sequence: input.sequence, journey: input.journey, state, revision: this.revision,
      captureAvailable: !!capture && this.checkedCaptureId === capture.id, approved: !!this.approval,
      project: this.root ? { root: this.root.path, name: basename(this.root.path), identity: projectRootKey(this.root) } : null, corrections: this.assertions, error: this.error,
      ...(this.previous ? { comparison: { previous: this.previous, current: this.draft ? claimSummary(this.draft) : null } } : {}),
      ...(this.draft ? { draft: this.draft } : {}), ...(this.work ? { id: this.work.id, progress: this.work.progress } : {}),
      ...(this.preview ? { token: this.preview.token, expires: this.preview.expires, prepared: { instructions: this.preview.prepared.instructions, prompt: this.preview.prepared.prompt, bytes: this.preview.prepared.bytes, limit: this.preview.prepared.limit } } : {}),
    });
  }
  async request(input) {
    const action = input?.action, extra = { status: '', prepare: '', start: ',id,token', cancel: ',id', edit: ',changes,revision', approve: ',changes,revision', revoke: ',revision', discard: ',revision' };
    const expected = (`action,clientId,journey,purpose,sequence${extra[action] ?? ''}`).split(',').sort().join(',');
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(extra, action) || Object.keys(input).sort().join(',') !== expected || input.purpose !== purpose ||
      !validId(input.clientId) || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || !this.journey() || input.journey !== this.journey() ||
      ['start', 'cancel'].includes(action) && !validId(input.id) || action === 'start' && !validId(input.token) ||
      ['edit', 'approve', 'revoke', 'discard'].includes(action) && (!Number.isSafeInteger(input.revision) || input.revision < 0)) throw Error('Invalid project brief request.');
    if (this.boundJourney !== input.journey) { this.clear(); this.boundJourney = input.journey; }
    if (action === 'status' && this.clientId !== input.clientId) { this.clear(); this.boundJourney = input.journey; this.clientId = input.clientId; }
    if (this.clientId !== input.clientId || input.sequence <= this.sequence) throw Error('Project brief client changed or request is obsolete. Open a fresh review.');
    this.sequence = input.sequence; this.validation?.abort(); this.validation = null;
    const epoch = this.epoch, current = () => { if (epoch !== this.epoch || this.sequence !== input.sequence || this.boundJourney !== this.journey()) throw changed(); };
    const capture = this.observe();
    if (this.preview && this.now() > this.preview.expires) this.preview = null;
    if (Object.hasOwn(input, 'revision') && input.revision !== this.revision) throw Error('Project brief revision changed. Refresh before editing or approving.');
    if (action === 'cancel') {
      if (this.work?.id === input.id) {
        if (this.work.status === 'result') this.invalidate();
        else { this.work.abort.abort(); this.work = null; }
      }
      this.preview = null; this.error = ''; return this.view(input);
    }
    if (action === 'discard') { this.invalidate(); this.assertions = []; this.revision++; return this.view(input); }
    if (action === 'revoke') { if (this.approval) { this.approval = null; this.revision++; } return this.view(input); }
    if (['edit', 'approve'].includes(action)) {
      if (!this.draft || this.work?.status === 'pending') throw Error('No editable project brief is available. Finish or cancel generation first.');
      if (this.approval) throw Error('Revoke approval with Edit brief before changing an approved brief.');
      if (action === 'edit') {
        this.draft = editProjectBrief(this.draft, input.changes); this.assertions = projectCorrections(this.draft); this.preview = null; this.revision++; this.error = '';
        return this.view(input);
      }
    }
    if (action === 'prepare' && this.work?.status === 'pending') throw Error('Cancel the current project brief before preparing another.');
    if (action === 'start' && (!this.preview || this.preview.token !== input.token || this.preview.revision !== this.revision || this.preview.capture.id !== capture?.id)) throw Error('Project brief review token expired or was already used. Review again.');
    const preview = action === 'start' ? this.preview : null;
    if (action === 'start') this.preview = null;
    if (!capture) {
      if (action !== 'status') throw Error('Explicitly read the current reviewed project files before preparing a brief.');
      return this.view(input);
    }
    const abort = new AbortController(); this.validation = abort;
    let fresh;
    try { fresh = await this.verify(capture, action === 'approve', abort.signal); current(); abort.signal.throwIfAborted(); }
    catch (error) { current(); if (!abort.signal.aborted) this.invalidate('Project freshness could not be verified. Review the current scope again.', !['off', 'unavailable'].includes(this.mode.contextState?.())); throw error; }
    finally { if (this.validation === abort) this.validation = null; }
    if (!fresh) { this.invalidate('Project files, checkout or ignore policy changed. Review and explicitly read the current scope again.', !['off', 'unavailable'].includes(this.mode.contextState?.())); if (action !== 'status') throw changed(); return this.view(input); }
    this.checkedCaptureId = capture.id;
    if (action === 'prepare') {
      if (this.draft) this.previous = claimSummary(this.draft);
      if (this.approval) { this.approval = null; this.revision++; }
      this.error = ''; this.work = null;
      this.preview = { token: randomUUID(), expires: this.now() + lifetime, capture, revision: this.revision, prepared: prepareProjectBrief(capture, this.assertions) };
    }
    if (action === 'approve') {
      if (this.draft?.captureId !== capture.id) throw changed();
      const draft = editProjectBrief(this.draft, input.changes);
      if (!Object.values(draft.sections).some(claims => claims.length)) throw Error('A project brief needs at least one reviewed claim or user assertion.');
      this.draft = draft; this.assertions = projectCorrections(draft); this.previous = null; this.preview = null; this.revision++; this.approval = { captureId: capture.id, revision: this.revision }; this.error = '';
    }
    if (action === 'start') {
      if (!preview || preview.revision !== this.revision || this.now() > preview.expires) throw changed();
      this.approval = null; this.error = '';
      const work = { id: input.id, abort: new AbortController(), status: 'pending', progress: 'Waiting for the project brief helper', revision: this.revision, epoch, captureId: capture.id };
      this.work = work;
      const live = () => this.work === work && !work.abort.signal.aborted && this.epoch === epoch && this.boundJourney === this.journey() && this.revision === work.revision && this.mode.capture()?.id === work.captureId;
      work.task = Promise.resolve().then(() => this.execute(async helper => {
        if (!live()) return;
        if (!await this.verify(capture, true, work.abort.signal) || !live()) throw changed();
        const result = await helper.run(preview.prepared, { signal: work.abort.signal, onProgress: progress => { if (live()) work.progress = progress; } });
        if (!live()) return;
        if (!await this.verify(capture, true, work.abort.signal) || !live()) throw changed();
        const trusted = validateProjectBrief(result, preview.prepared);
        this.draft = trusted; this.assertions = projectCorrections(trusted); this.revision++; work.status = 'result'; work.progress = 'Review the project brief before approving it.';
      })).catch(error => { if (live()) { work.status = 'error'; this.error = error.message; } });
    }
    return this.view(input);
  }
}
