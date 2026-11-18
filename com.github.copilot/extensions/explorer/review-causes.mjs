import { createHash } from 'node:crypto';

export const savedDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function reviewCauses(value) {
  const fail = () => { throw Error('Invalid review causes. Preserve the original with a compatible client.'); };
  if (!value || Object.keys(value).sort().join(',') !== 'changes,earlier' || typeof value.earlier !== 'boolean' || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 32) fail();
  const seen = new Set();
  const changes = value.changes.map(change => {
    if (!change || Object.keys(change).sort().join(',') !== 'baseDigest,revision,sourceId' || typeof change.sourceId !== 'string' || !change.sourceId.trim() || change.sourceId.trim() !== change.sourceId || change.sourceId.length > 100 || !/^[a-f0-9]{64}$/.test(change.baseDigest) || !Number.isSafeInteger(change.revision) || change.revision < 0) fail();
    const key = JSON.stringify([change.sourceId, change.baseDigest]); if (seen.has(key)) fail(); seen.add(key);
    return { sourceId: change.sourceId, baseDigest: change.baseDigest, revision: change.revision };
  });
  return { changes, earlier: value.earlier };
}
export function addReviewCause(node, cause) {
  const old = node.reviewCauses, changes = [...old?.changes ?? []];
  if (!changes.some(item => item.sourceId === cause.sourceId && item.baseDigest === cause.baseDigest)) changes.push(cause);
  node.reviewCauses = { changes: changes.slice(-32), earlier: old?.earlier || !!node.review && !old || changes.length > 32 };
  node.review = true;
  if (node.research) node.researchStale = true;
}
