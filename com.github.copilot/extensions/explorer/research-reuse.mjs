import { createHash } from 'node:crypto';
import { findNode } from './model.mjs';
import { prepareFollowup, followupResult, sameFollowup } from './research-followup.mjs';
import { sameReviewedResearchFreshness } from './research-context.mjs';
import { FRESHNESS_POLICY_VERSION, researchFreshness } from './web/research-freshness.mjs';

export const REUSE_TTL = 15 * 60 * 1000;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = value => Number.isFinite(value) && Number.isFinite(new Date(value).getTime());
const day = value => new Date(value).toISOString().slice(0, 10);
const inputHash = prepared => hash([1, FRESHNESS_POLICY_VERSION, prepared.instructions, prepared.prompt, prepared.settings, prepared.reusePolicy, prepared.reuseNamespace, prepared.modelCapture]);
const needsRefresh = (value, now) => researchFreshness(value, now).claims.some(claim => claim.needsRefresh);
const inputsFresh = (prepared, now) => sameReviewedResearchFreshness(prepared, now) &&
  [...prepared.followup.original.filter(item => item.kind === 'evidence'), ...prepared.followup.exchanges.map(item => item.result)].every(value => !needsRefresh(value, now));

export function reuseNamespace({ root, binding, file, journey }) {
  if (!root || typeof root.path !== 'string' || !root.path || root.path.length > 32768 || typeof root.ancestors !== 'string' || !root.ancestors || root.ancestors.length > 131072 ||
    [binding, file, journey].some(value => typeof value !== 'string' || !value || value.length > 32768)) return null;
  return hash([root.path, root.ancestors, binding, file, journey]);
}
export function createReuseRecord(prepared, exchange, completedAt = Date.now()) {
  if (!digest(prepared.reuseNamespace) || !prepared.modelCapture || prepared.followup?.question !== exchange.question || prepared.followup.hypothetical !== exchange.hypothetical || !time(prepared.preparedAt) || !time(completedAt) || completedAt < prepared.preparedAt || day(completedAt) !== day(prepared.preparedAt)) return null;
  const result = followupResult(exchange.result);
  if (needsRefresh(result, completedAt) || !inputsFresh(prepared, completedAt)) return null;
  return { version: 2, freshnessVersion: FRESHNESS_POLICY_VERSION, exchangeId: exchange.id, preparedAt: prepared.preparedAt, completedAt, inputHash: inputHash(prepared), resultHash: hash([exchange.question, exchange.hypothetical, exchange.profile ?? null, result]) };
}
export function reusableFollowup(doc, nodeId, input, { history, namespace, modelCapture, settings, scenario, scope, excluded = [], now = Date.now() } = {}) {
  try {
    const receipt = history?.reuse, exchange = history?.exchanges.at(-1);
    if (!receipt || history.historical || history.nodeId !== nodeId || findNode(doc, nodeId).researchStale || !exchange || exchange.id !== receipt.exchangeId || !sameFollowup(history.dependencies, doc, nodeId) ||
      receipt.version !== 2 || receipt.freshnessVersion !== FRESHNESS_POLICY_VERSION || !digest(namespace) || !modelCapture || !digest(receipt.inputHash) || !digest(receipt.resultHash) ||
      !time(now) || !time(receipt.preparedAt) || !time(receipt.completedAt) || receipt.preparedAt > receipt.completedAt || now < receipt.completedAt || now - receipt.completedAt >= REUSE_TTL || day(now) !== day(receipt.preparedAt) ||
      hash([exchange.question, exchange.hypothetical, exchange.profile ?? null, followupResult(exchange.result)]) !== receipt.resultHash || needsRefresh(exchange.result, now)) return null;
    // Recreate the original input, including its clock, instead of stripping fields from a new prompt.
    const prepared = prepareFollowup(doc, nodeId, input, { settings, scenario, scope, excluded, history: { ...history, exchanges: history.exchanges.slice(0, -1) }, now: receipt.preparedAt });
    if (!inputsFresh(prepared, now) || inputHash({ ...prepared, reusePolicy: { scope, excluded }, reuseNamespace: namespace, modelCapture }) !== receipt.inputHash) return null;
    return { exchangeId: exchange.id, completedAt: new Date(receipt.completedAt).toISOString(), expiresAt: receipt.completedAt + REUSE_TTL };
  } catch { return null; }
}
