import { randomUUID } from 'node:crypto';
import { branchRestoration } from './model.mjs';
import { savedDigest } from './review-causes.mjs';
import { References } from './references.mjs';
import { affectedArtifacts, changeWorkKey } from './answer-changes.mjs';

const stale = () => Error('Branch restore preview expired or its sources changed. Preview the current branch again; drafts are retained.');
const identity = e => JSON.stringify([e.file, e.activeKey, e.doc?.id, e.doc?.rootId, e.doc?.createdAt]);
async function references(e) {
  const key = await e.draftIdentity(e.activeKey ?? e.doc.id);
  e.referenceStore ??= new References(e.auxiliaryDirectory());
  return e.referenceStore.read(key);
}
function idle(e) {
  if (e.pending) throw Error('Cancel the pending question or research request before restoring a branch.');
  if (e.preview) throw Error('Dismiss the staged question preview before restoring a branch.');
}

/** One private, bounded preview. The client can choose a source, never submit a candidate. */
export class BranchRestoration {
  constructor() { this.entry = null; this.epoch = 0; }
  clear() { this.entry = null; this.epoch++; }
  assert(e, doc, token) {
    const entry = this.entry; idle(e);
    if (e.closed || !entry || token !== entry.token || entry.expires < Date.now() || entry.epoch !== this.epoch || entry.binding !== identity(e) ||
      entry.store !== e.projectStore || entry.base !== savedDigest(doc) || entry.work !== changeWorkKey(e)) throw stale();
    return entry;
  }
  async guard(e, token) {
    const entry = this.assert(e, await e.fresh(), token);
    // Read the immutable source directly. Reconciliation here would consume the active commit intent.
    const historical = await entry.history.snapshot(entry.row);
    if (savedDigest(await references(e)) !== entry.referencesDigest) throw stale();
    const current = await e.fresh(); this.assert(e, current, token);
    if (e.projectStore && e.projectStore.history !== entry.history) throw stale();
    const result = branchRestoration(current, historical, entry.nodeId);
    if (savedDigest(result) !== entry.resultDigest) throw stale();
    return entry;
  }
  async request(e, input) {
    const fields = { prepare: 'action,journey,nodeId,revision,snapshotRevision', page: 'action,page,selected,token', discard: 'action,token' };
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(fields, input.action) || Object.keys(input).sort().join(',') !== fields[input.action]) throw Error('Invalid branch restore request.');
    if (input.action === 'discard') { if (this.entry?.token === input.token) this.entry = null; return { discarded: true }; }
    idle(e);
    if (input.action === 'page') return this.page(await this.guard(e, input.token), input.page, input.selected);
    this.entry = null;
    const current = await e.fresh(), journey = e.activeKey ?? e.doc.id;
    if (e.closed || input.journey !== journey || input.revision !== current.revision || typeof input.nodeId !== 'string' || !Number.isSafeInteger(input.snapshotRevision) || input.snapshotRevision < 0) throw stale();
    const history = await e.history(journey), row = await history.list(current, input.snapshotRevision), result = branchRestoration(current, row.document, input.nodeId);
    const selectedReferences = await references(e), token = randomUUID();
    const entry = { token, epoch: this.epoch, expires: Date.now() + 15 * 60000, binding: identity(e), store: e.projectStore, history, row,
      journey, revision: current.revision, nodeId: input.nodeId, base: savedDigest(current), work: changeWorkKey(e), selectedReferences,
      referencesDigest: savedDigest(selectedReferences), result, resultDigest: savedDigest(result),
      artifacts: result.document ? affectedArtifacts(e, current, result.document) : [] };
    entry.items = [
      ...result.conflicts.map(data => ({ kind: 'conflict', label: data.message, data })),
      ...result.changes.map(data => ({ kind: 'node', label: `${!data.before ? 'Restore' : !data.after ? 'Remove' : 'Change'}: ${(data.after ?? data.before).question}`, data })),
      ...result.dependencies.map(data => ({ kind: 'dependency', label: `${!data.before ? 'Restore' : !data.after ? 'Remove' : 'Change'} dependency: ${(data.after ?? data.before).dependentId} depends on ${(data.after ?? data.before).prerequisiteId}`, data })),
    ];
    this.entry = entry;
    this.assert(e, await e.fresh(), token);
    return this.page(entry, 0, null);
  }
  page(entry, page, selected) {
    if (!Number.isSafeInteger(page) || page < 0 || page > Math.floor(Math.max(0, entry.items.length - 1) / 50) || selected !== null && (!Number.isSafeInteger(selected) || selected < 0 || selected >= entry.items.length)) throw Error('Choose a listed branch restore change.');
    const index = selected ?? (entry.items.length ? page * 50 : null), result = entry.result;
    return { token: entry.token, expiresAt: entry.expires, journey: entry.journey, revision: entry.revision, snapshotRevision: entry.row.revision, nodeId: entry.nodeId,
      canRestore: result.changed && !result.conflicts.length, changed: result.changed, conflicts: result.conflicts.length,
      added: result.added.length, removed: result.removed.length, reviewed: result.reviewed.length, research: result.research.length,
      removedReferences: entry.selectedReferences.nodeIds.filter(id => result.removed.includes(id)).length, artifacts: entry.artifacts,
      adr: 'ADR associations are not supported yet; none are inferred or changed.',
      total: entry.items.length, page, items: entry.items.slice(page * 50, page * 50 + 50).map((item, i) => ({ index: page * 50 + i, kind: item.kind, label: item.label })),
      selected: index === null ? null : { index, ...structuredClone(entry.items[index]) } };
  }
  async commit(e, input) {
    if (Object.keys(input).some(key => !['action', 'journey', 'revision', 'scope', 'token', 'confirm'].includes(key)) || input.confirm !== true) throw Error('Explicitly confirm the reviewed branch restoration.');
    const entry = await this.guard(e, input.token);
    if (input.journey !== entry.journey || input.revision !== entry.revision) throw stale();
    if (entry.result.conflicts.length) throw Error('Resolve the listed conflicts before restoring this branch.');
    if (!entry.result.changed) { e.error = 'This branch already matches the saved version. No change was made.'; return; }
    await e.commitCurrentLocked(await e.fresh(), entry.result.document, `Branch restored from revision ${entry.row.revision}`, () => this.guard(e, input.token));
    this.entry = null;
  }
}
