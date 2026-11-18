import { randomUUID } from 'node:crypto';
import { savedDigest } from './review-causes.mjs';
import { scenarioIdentity, scenarioFamily, preferenceKey, readPreference, preferenceStatus } from './scenario-preference.mjs';
import { personalPreferenceStore, projectPreferenceStore } from './scenario-preference-store.mjs';
import { projectDocumentAccess } from './storage-context.mjs';
import { readSharedDocument } from './shared-document.mjs';
import { FORMAT } from './model.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const obsolete = () => { throw Error('Scenario preference or saved map changed. Refresh this choice before continuing.'); };
const unavailable = () => { throw Error('The preferred scenario is unavailable or unresolved. Reconcile its source or explicitly choose or clear the preference.'); };
export class ScenarioPreferences {
  constructor() { this.epoch = 0; this.entry = null; this.consent = null; this.observation = null; this.lastProof = null; }
  clear() { this.epoch++; this.entry = null; this.consent = null; this.observation = null; this.lastProof = null; }
  matches(policy) { return !!policy && same(policy.proof, this.lastProof); }
  remember(observation) { if (!same(observation, this.observation)) this.observation = observation; }
  async observe(e) {
    try { await this.state(e); }
    catch (error) {
      this.lastProof = null;
      this.remember({ journey: e.activeKey ?? e.doc?.id, scope: e.projectStore ? 'project' : 'personal', status: 'unresolved', message: error.message });
    }
    return this.observation;
  }
  async resolve(e, reference, scope, family) {
    if (!reference) return null;
    try {
      let target;
      if (scope === 'project') {
        const projectSelection = await e.projectRepository.selection(reference.location, false);
        const source = await (await projectDocumentAccess(projectSelection)).read(), shared = readSharedDocument(source.bytes);
        target = { projectSelection, stamp: source.stamp, document: { format: FORMAT, version: 1, revision: 0, ...shared.document.journey } };
      } else target = await e.library.resolve(reference.location);
      const document = target.document;
      return same(scenarioIdentity(document), reference.identity) && same(scenarioFamily(document), family) ? { ...target, document } : null;
    } catch { return null; }
  }
  async state(e) {
    if (e.closed || !e.doc) throw Error('Open an exploration before inspecting its scenario preference.');
    const binding = { file: e.file, key: e.activeKey, store: e.projectStore, epoch: this.epoch };
    const doc = await e.readCurrent(), family = scenarioFamily(doc), scope = e.projectStore ? 'project' : 'personal';
    const location = e.projectStore?.context.relativePath ?? e.activeKey;
    const store = e.projectStore ? await projectPreferenceStore(e.projectRepository, e.projectStore, family) : e.library ? await personalPreferenceStore(e.library, family) : null;
    const record = store ? await store.read() : readPreference(null, family, scope), preferred = record.value.events.at(-1)?.preferred;
    const target = preferred ? await this.resolve(e, preferred, scope, family) : null;
    if (preferred && (await store.read()).digest !== record.digest) obsolete();
    if (e.closed || binding.file !== e.file || binding.key !== e.activeKey || binding.store !== e.projectStore || binding.epoch !== this.epoch || !same(scenarioIdentity(doc), scenarioIdentity(e.doc))) obsolete();
    const selection = preferenceStatus(record.value, doc, target?.document, location);
    const proof = { epoch: this.epoch, journey: e.activeKey ?? doc.id, location, scope, family: preferenceKey(family), preference: record.digest, identity: scenarioIdentity(doc) };
    const hypothetical = selection.status === 'alternative' && same(this.consent, proof);
    this.lastProof = { ...proof, classification: hypothetical ? 'hypothetical' : selection.status };
    this.remember({ journey: e.activeKey ?? doc.id, scope, status: selection.status, hypothetical, revision: record.value.revision, preferredId: selection.preferred?.identity.id ?? null });
    return { binding, doc, family, scope, location, store, record, target, selection, proof, hypothetical };
  }
  async inspect(e) {
    const state = await this.state(e);
    const entry = { ...state, id: randomUUID(), expiresAt: Date.now() + 15 * 60 * 1000, digest: savedDigest(state.doc) };
    this.entry = entry; return this.view(entry);
  }
  view(entry) {
    return { id: entry.id, expiresAt: entry.expiresAt, source: { identity: scenarioIdentity(entry.doc), family: entry.family, topic: entry.doc.topic, scope: entry.scope, location: entry.location },
      preferencePath: entry.store?.relativePath ?? 'Private Explorer storage', selection: entry.selection, hypothetical: entry.hypothetical,
      history: structuredClone(entry.record.value.events).reverse(), omittedHistory: entry.record.value.revision - entry.record.value.events.length };
  }
  async check(e, id) {
    const entry = this.entry;
    if (!entry || entry.id !== id || Date.now() >= entry.expiresAt || e.closed || entry.binding.epoch !== this.epoch || entry.binding.file !== e.file || entry.binding.key !== e.activeKey || entry.binding.store !== e.projectStore || savedDigest(e.doc) !== entry.digest) obsolete();
    if (savedDigest(await e.readCurrent()) !== entry.digest || (await entry.store.read()).digest !== entry.record.digest || this.entry !== entry) obsolete();
    return entry;
  }
  async request(e, input) {
    const fields = { inspect: 'action,journey,revision', select: 'action,id,journey,rationale,revision', clear: 'action,id,journey,rationale,revision', restore: 'action,eventRevision,id,journey,rationale,revision', hypothetical: 'action,enabled,id,journey,revision', discard: 'action,id,journey,revision' };
    if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(fields, input.action) || Object.keys(input).sort().join(',') !== fields[input.action]) throw Error('Invalid scenario preference request.');
    if (e.closed || !e.library || input.journey !== e.activeKey || input.revision !== e.doc?.revision) obsolete();
    if (input.action === 'inspect') {
      const result = await this.inspect(e); if (this.entry.doc.revision !== input.revision) obsolete(); return result;
    }
    if (input.action === 'discard') { if (this.entry?.id === input.id) this.entry = null; return { discarded: true }; }
    const entry = await this.check(e, input.id);
    if (input.action === 'hypothetical') {
      if (typeof input.enabled !== 'boolean' || input.enabled && entry.selection.status !== 'alternative') throw Error('Explicit hypothetical use requires an available retained alternative. An unresolved preference must be reconciled.');
      if (input.enabled && !await this.resolve(e, entry.selection.preferred, entry.scope, entry.family)) unavailable();
      await this.check(e, input.id);
      this.consent = input.enabled ? entry.proof : null; return this.inspect(e);
    }
    if (e.pending || e.preview) throw Error('Finish or cancel pending work and its preview before changing the preference.');
    let preferred = input.action === 'select' ? { identity: scenarioIdentity(entry.doc), location: entry.location } : null;
    if (input.action === 'restore') {
      const event = entry.record.value.events.find(event => event.revision === input.eventRevision);
      if (!event || !Number.isSafeInteger(input.eventRevision)) throw Error('That selection is not in retained preference history.');
      preferred = event.preferred;
    }
    await entry.store.update(entry.record, preferred, input.rationale, async () => {
      await this.check(e, input.id);
      if (preferred && !await this.resolve(e, preferred, entry.scope, entry.family)) unavailable();
      await this.check(e, input.id);
    });
    this.entry = null; this.consent = null; return this.inspect(e);
  }
  async source(e, id) {
    const entry = await this.check(e, id), reference = entry.selection.preferred;
    const target = await this.resolve(e, reference, entry.scope, entry.family); if (!target) unavailable();
    await this.check(e, id);
    return { ...target, reference, scope: entry.scope, digest: savedDigest(target.document) };
  }
  async policy(e) {
    const state = await this.state(e), status = state.selection.status;
    if (status === 'unresolved') unavailable();
    if (status === 'alternative' && !state.hypothetical) throw Error('This is a retained alternative. Open the preferred scenario or explicitly enable hypothetical use in Scenario preference before using its conclusions.');
    const classification = state.hypothetical ? 'hypothetical' : status;
    return { proof: { ...state.proof, classification }, label: { source: scenarioIdentity(state.doc), family: state.family, scope: state.scope, classification, preferenceRevision: state.record.value.revision, selectionRationale: state.selection.rationale } };
  }
  async assertPolicy(e, captured) {
    let current; try { current = await this.policy(e); } catch { obsolete(); }
    if (!captured || !same(captured.proof, current.proof)) obsolete();
  }
}
