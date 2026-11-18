import { createHash } from 'node:crypto';
import { parseDocumentJson } from './shared-document.mjs';
import { validateProjectPath } from './project-repository.mjs';

export const PREFERENCE_LIMIT = 256 * 1024;
const FORMAT = 'copilot-explorer-scenario-preference';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = message => { throw Error(`Invalid scenario preference: ${message}. The existing record is preserved.`); };
const fields = (v, names) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== names.split(',').sort().join(',')) fail('unsupported fields'); };
const id = value => { if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 100) fail('identity'); return value; };
const date = value => { if (typeof value !== 'string' || value.length > 100 || !Number.isFinite(Date.parse(value))) fail('date'); return value; };
function identity(value) { fields(value, 'id,rootId,createdAt'); return { id: id(value.id), rootId: id(value.rootId), createdAt: date(value.createdAt) }; }
export function scenarioIdentity(doc) { return identity({ id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt }); }
export function scenarioFamily(doc) {
  if (!doc.forkOrigin) return scenarioIdentity(doc);
  const root = doc.forkOrigin.nodes?.filter(row => row.nodeId === doc.rootId);
  if (root?.length !== 1 || root[0].sourceNodeId !== doc.forkOrigin.source?.rootId || root[0].origin?.nodeId !== root[0].origin?.rootId) fail('root lineage is incomplete or contradictory');
  const origin = root[0].origin;
  return identity({ id: origin.journeyId, rootId: origin.rootId, createdAt: origin.createdAt });
}
export const preferenceKey = family => createHash('sha256').update(JSON.stringify(identity(family))).digest('hex');
function selection(value, scope) {
  if (value === null) return null;
  fields(value, 'identity,location');
  if (scope === 'personal') { if (typeof value.location !== 'string' || !/^[a-f0-9]{64}$/.test(value.location)) fail('personal location'); }
  else { validateProjectPath(value.location); if (!value.location.endsWith('.explore.json')) fail('project location must name a shared journey'); }
  return { identity: identity(value.identity), location: value.location };
}
function validate(value, family, scope) {
  if (!['personal', 'project'].includes(scope)) fail('scope');
  fields(value, 'format,version,scope,family,revision,events');
  if (value.format !== FORMAT || value.version !== 1) fail('unsupported format or version');
  if (value.scope !== scope) fail('scope does not match this storage');
  if (!same(identity(value.family), identity(family))) fail('family does not match this map');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.events) || value.events.length !== Math.min(value.revision, 32)) fail('history');
  const events = value.events.map((event, i) => {
    fields(event, 'revision,at,preferred,rationale');
    if (event.revision !== value.revision - value.events.length + i + 1) fail('history sequence');
    if (typeof event.rationale !== 'string' || !event.rationale.isWellFormed() || event.rationale.length > 2000) fail('rationale limit is 2000 characters');
    return { revision: event.revision, at: date(event.at), preferred: selection(event.preferred, scope), rationale: event.rationale };
  });
  return { format: FORMAT, version: 1, scope, family: identity(family), revision: value.revision, events };
}
export function readPreference(source, family, scope) {
  if (source === null) return { value: validate({ format: FORMAT, version: 1, scope, family, revision: 0, events: [] }, family, scope), digest: null };
  if (!Buffer.isBuffer(source) && typeof source !== 'string') fail('read original UTF-8 bytes');
  if (Buffer.byteLength(source) > PREFERENCE_LIMIT) fail('file exceeds the 256 KiB limit');
  const parsed = parseDocumentJson(source);
  return { value: validate(parsed.value, family, scope), digest: parsed.baseDigest };
}
export function nextPreference(previous, preferred, rationale, at = new Date().toISOString()) {
  const value = validate(previous, previous.family, previous.scope);
  if (!Number.isSafeInteger(value.revision + 1)) fail('revision limit');
  value.revision++;
  value.events = [...value.events, { revision: value.revision, at, preferred, rationale }].slice(-32);
  return readPreference(JSON.stringify(value), value.family, value.scope).value;
}
export function preferenceStatus(value, current, resolved, location) {
  value = validate(value, scenarioFamily(current), value.scope);
  const event = value.events.at(-1), preferred = event?.preferred ?? null;
  let status = 'unselected';
  if (preferred) {
    let available = false;
    try { available = !!resolved && same(scenarioIdentity(resolved), preferred.identity) && same(scenarioFamily(resolved), value.family); } catch { /* Unverifiable preferred identity remains unresolved. */ }
    status = !available ? 'unresolved' : same(scenarioIdentity(current), preferred.identity) && location === preferred.location ? 'preferred' : 'alternative';
  }
  return { status, preferred, revision: value.revision, rationale: event?.rationale ?? '' };
}
