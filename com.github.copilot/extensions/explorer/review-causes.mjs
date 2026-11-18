import { createHash } from 'node:crypto';

export const savedDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const reviewCauseKey = cause => JSON.stringify([cause.sourceId, cause.baseDigest, cause.kind ?? null, cause.dependentId ?? null]);
export function reviewCauses(value) {
  const fail = () => { throw Error('Invalid review causes. Preserve the original with a compatible client.'); };
  if (!value || Object.keys(value).sort().join(',') !== 'changes,earlier' || typeof value.earlier !== 'boolean' || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 32) fail();
  const seen = new Set();
  const changes = value.changes.map(change => {
    const dependency = change && Object.hasOwn(change, 'kind'), fields = dependency ? 'baseDigest,dependentId,kind,revision,sourceId' : 'baseDigest,revision,sourceId';
    const id = value => typeof value === 'string' && value.trim() && value.trim() === value && value.length <= 100;
    if (!change || Object.keys(change).sort().join(',') !== fields || !id(change.sourceId) || !/^[a-f0-9]{64}$/.test(change.baseDigest) || !Number.isSafeInteger(change.revision) || change.revision < 0 || dependency && (!['dependency-added', 'dependency-removed'].includes(change.kind) || !id(change.dependentId) || change.dependentId === change.sourceId)) fail();
    const key = reviewCauseKey(change); if (seen.has(key)) fail(); seen.add(key);
    return { sourceId: change.sourceId, baseDigest: change.baseDigest, revision: change.revision, ...(dependency ? { kind: change.kind, dependentId: change.dependentId } : {}) };
  });
  return { changes, earlier: value.earlier };
}
export function addReviewCause(node, cause) {
  const old = node.reviewCauses, changes = [...old?.changes ?? []];
  if (!changes.some(item => reviewCauseKey(item) === reviewCauseKey(cause))) changes.push(cause);
  node.reviewCauses = { changes: changes.slice(-32), earlier: old?.earlier || !!node.review && !old || changes.length > 32 };
  node.review = true;
  if (node.research) node.researchStale = true;
}
