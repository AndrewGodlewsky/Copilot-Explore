import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { effectiveAnswerState } from './web/answer-state.mjs';

const fields = (value, names) => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const invalid = () => { throw Error('Invalid contributor attribution. Existing content must be preserved.'); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid();
  return value;
}
export function validateContributor(value) {
  if (!fields(value, ['id', 'displayName']) || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.id) || typeof value.displayName !== 'string' || !value.displayName || value.displayName.trim() !== value.displayName || value.displayName.length > 96 || !value.displayName.isWellFormed() || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value.displayName)) invalid();
  return { id: value.id, displayName: value.displayName };
}
export function validateContributionEvent(value) {
  if (!fields(value, ['actor', 'at'])) invalid();
  return { actor: value.actor === null ? null : validateContributor(value.actor), at: date(value.at) };
}
export function validateNodeAttribution(value) {
  const aspects = ['question', 'answer'].filter(name => Object.hasOwn(value ?? {}, name));
  if (!aspects.length || !fields(value, ['version', ...aspects]) || value.version !== 1) invalid();
  const result = { version: 1 };
  for (const aspect of aspects) {
    const record = value[aspect];
    if (!fields(record, ['origin', 'contentDigest', 'author', 'editor', 'accepted']) || !['user', 'ai', 'unknown'].includes(record.origin) || !digest(record.contentDigest) || record.origin !== 'user' && record.author !== null || aspect === 'answer' && (record.origin === 'ai' || record.accepted !== null)) invalid();
    result[aspect] = { origin: record.origin, contentDigest: record.contentDigest, ...Object.fromEntries(['author', 'editor', 'accepted'].map(name => [name, record[name] === null ? null : validateContributionEvent(record[name])])) };
  }
  return result;
}
export function validateArtifactAcceptance(value) {
  if (!fields(value, ['actor', 'at', 'contentDigest']) || !digest(value.contentDigest)) invalid();
  return { ...validateContributionEvent({ actor: value.actor, at: value.at }), contentDigest: value.contentDigest };
}
export function nodeAttributionDigest(node, aspect) {
  if (aspect === 'question') return hash([node.kind ?? 'question', node.question, node.category]);
  if (aspect === 'answer') return hash([node.answer, effectiveAnswerState(node)]);
  invalid();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function artifactAcceptanceDigest(value) {
  const { acceptance, ...content } = value; return hash(canonical(content));
}
const answerEdit = node => [node.answer, effectiveAnswerState(node), node.review, node.reviewCauses ?? []];
/** Only explicit user mutation boundaries call this; persistence and imports do not infer contributors. */
export function attributeContributions(before, next, intent, actor, at) {
  const event = validateContributionEvent({ actor, at }), result = structuredClone(next), prior = new Map((before?.nodes ?? []).map(node => [node.id, node]));
  const set = (node, aspect, record) => { node.attribution = validateNodeAttribution({ ...(node.attribution ?? { version: 1 }), [aspect]: record }); };
  if (intent?.kind === 'new-nodes') {
    if (!fields(intent, ['kind', 'ids', 'origin']) || !['user', 'ai'].includes(intent.origin) || !Array.isArray(intent.ids) || !intent.ids.length || intent.ids.length > 6 || new Set(intent.ids).size !== intent.ids.length) invalid();
    for (const id of intent.ids) {
      const node = result.nodes.find(node => node.id === id);
      if (!node || prior.has(id) || intent.origin === 'ai' && !node.generation) invalid();
      set(node, 'question', { origin: intent.origin, contentDigest: nodeAttributionDigest(node, 'question'), author: intent.origin === 'user' ? event : null, editor: intent.origin === 'ai' && node.generation.adjusted ? event : null, accepted: intent.origin === 'ai' ? event : null });
    }
  } else if (intent?.kind === 'answer') {
    if (!fields(intent, ['kind', 'id'])) invalid();
    const old = prior.get(intent.id), node = result.nodes.find(node => node.id === intent.id); if (!old || !node) invalid();
    if (equal(answerEdit(old), answerEdit(node))) return result;
    const recorded = old.attribution ? validateNodeAttribution(old.attribution).answer : null;
    const first = !recorded && !old.answer.trim() && effectiveAnswerState(old) === 'unanswered' && (node.answer.trim() || effectiveAnswerState(node) !== 'unanswered');
    set(node, 'answer', { origin: recorded?.origin ?? (first ? 'user' : 'unknown'), contentDigest: nodeAttributionDigest(node, 'answer'), author: recorded?.author ?? (first ? event : null), editor: first ? null : event, accepted: null });
  } else if (intent?.kind === 'artifact') {
    if (!fields(intent, ['kind', 'field']) || !['brief', 'handoff', 'adrDraft'].includes(intent.field) || !result[intent.field]) invalid();
    const value = result[intent.field], contentDigest = artifactAcceptanceDigest(value);
    if (before?.[intent.field] && contentDigest === artifactAcceptanceDigest(before[intent.field])) return result;
    value.acceptance = validateArtifactAcceptance({ ...event, contentDigest });
  } else invalid();
  return result;
}
export function contributionStatus(doc) {
  const nodes = Object.fromEntries((doc?.nodes ?? []).filter(node => node.attribution).map(node => [node.id, Object.fromEntries(['question', 'answer'].filter(aspect => node.attribution[aspect]).map(aspect => [aspect, node.attribution[aspect].contentDigest === nodeAttributionDigest(node, aspect) ? 'current' : 'historical']))]));
  const artifacts = Object.fromEntries(['brief', 'handoff', 'adrDraft'].filter(field => doc?.[field]?.acceptance).map(field => [field, doc[field].acceptance.contentDigest === artifactAcceptanceDigest(doc[field]) ? 'current' : 'historical']));
  return { nodes, artifacts };
}
