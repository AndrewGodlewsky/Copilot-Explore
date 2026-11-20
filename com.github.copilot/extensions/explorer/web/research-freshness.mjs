const DAY = 86400000;
export const FRESHNESS_POLICY_VERSION = 1;
const intervals = Object.freeze({ 'price-availability': 1, 'product-version': 7, 'evolving-guidance': 180 });
const types = [...Object.keys(intervals), 'durable-concept', 'named-version', 'unknown'];
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === names.split(',').sort().join(',');
const text = (value, max) => typeof value === 'string' && !!value.trim() && value.length <= max;

export function claimFreshness(value) {
  if (!keys(value, 'type,reason,version') || !types.includes(value.type) || !text(value.reason, 300) ||
    (value.type === 'named-version' ? !text(value.version, 120) : value.version !== null)) throw Error('Invalid claim freshness classification.');
  return { type: value.type, reason: value.reason, version: value.version };
}
export function sourceDateObservations(value) {
  if (!Array.isArray(value) || value.length > 3) throw Error('Invalid source date observations.');
  return value.map(item => {
    if (!keys(item, 'kind,text') || !['published', 'updated', 'ambiguous'].includes(item.kind) || !text(item.text, 160)) throw Error('Invalid source date observation.');
    return { kind: item.kind, text: item.text };
  });
}
export function checkedSourceDateObservations(value, receivedText) {
  const observations = sourceDateObservations(value);
  if (observations.some(item => typeof receivedText !== 'string' || !receivedText.includes(item.text))) throw Error('A source date label was not found in the bounded first successful read. Omit unsupported date observations; the date remains unknown.');
  return observations;
}
function calendarLabel(value, kind) {
  // Interpret a narrow date-only grammar; timestamps and other wording remain inspectable unknowns.
  const match = /^(?:(published|updated|last updated|publication date|date published|date modified|modified)(?: on)?\s*[:：]?\s*)?(\d{4}-\d{2}-\d{2})\.?$/i.exec(value.trim());
  if (!match) return null;
  if (match[1] && (/publish|publication/i.test(match[1]) ? 'published' : 'updated') !== kind) return null;
  const instant = Date.parse(`${match[2]}T00:00:00.000Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === match[2] ? match[2] : null;
}
export function sourceDateFacts(source) {
  const observations = sourceDateObservations(source.dateObservations ?? []);
  const unknown = reason => ({ published: null, updated: null, effectiveDate: null, reason });
  if (!observations.length) return unknown('Publication and update dates unknown; no date label was recorded.');
  const parsed = observations.map(item => ({ kind: item.kind, date: item.kind === 'ambiguous' ? null : calendarLabel(item.text, item.kind) }));
  if (parsed.some(item => !item.date)) return unknown('Date wording is ambiguous, unsupported or not a valid ISO calendar date.');
  const dates = kind => [...new Set(parsed.filter(item => item.kind === kind).map(item => item.date))];
  const published = dates('published'), updated = dates('updated');
  if (published.length > 1 || updated.length > 1 || published.length && updated.length && updated[0] < published[0]) return unknown('Recorded publication/update dates conflict; applicability is unknown.');
  return { published: published[0] ?? null, updated: updated[0] ?? null, effectiveDate: updated[0] ?? published[0] ?? null,
    reason: 'Date-label interpretation, not verified applicability or currentness.' };
}
function evaluateClaim(claim, sources, now) {
  const type = claim.freshness?.type ?? 'unknown';
  const result = (status, reason, needsRefresh = false) => ({ claimId: claim.id, type, status, reason, needsRefresh });
  if (type === 'durable-concept') return result('durable-context', 'Age alone does not expire this model-classified concept; correctness is not verified.');
  if (type === 'named-version') return result('named-version', `Scope: ${claim.freshness.version}. This does not establish the latest version or current compatibility.`);
  if (!Object.hasOwn(intervals, type)) return result('currentness-unknown', 'Freshness classification is unknown; currentness has not been established.');
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return result('currentness-unknown', 'The evaluation clock is unavailable; recheck current evidence.', true);
  if (!claim.evidence?.length) return result('currentness-unknown', 'No source evidence establishes this time-sensitive claim; obtain current evidence.', true);
  const days = intervals[type], today = new Date(now).toISOString().slice(0, 10), statuses = claim.evidence.map(ref => {
    const source = sources.find(item => item.id === ref.sourceId), retrieved = source?.retrievedAt ? Date.parse(source.retrievedAt) : NaN;
    if (!source || !Number.isFinite(retrieved) || retrieved > now) return 'unknown';
    if (now - retrieved >= days * DAY) return 'old';
    const facts = sourceDateFacts(source);
    if (!facts.effectiveDate || facts.effectiveDate > today || facts.published > today || facts.updated > today) return 'unknown';
    return (Date.parse(today) - Date.parse(facts.effectiveDate)) / DAY >= days ? 'old' : 'within';
  });
  if (statuses.includes('old')) return result('review-needed', `Recheck this ${type.replace(/-/g, ' ')} claim: a read or supported source date has reached its ${days}-day review interval.`, true);
  if (statuses.includes('unknown')) return result('currentness-unknown', 'A read or applicable publication/update date is missing, ambiguous or future-dated; obtain current evidence.', true);
  return result('within-window', `Read and interpreted source dates are within the ${days}-day review window; currentness and truth are not verified.`);
}
export function researchFreshness(value, now = Date.now()) {
  const claims = (value.claims ?? []).map(claim => evaluateClaim(claim, value.sources ?? [], now));
  const chosen = value.recommendationAssessment?.optionId;
  const support = (value.support ?? []).filter(item => item.optionId === null || item.optionId === chosen);
  const ids = new Set(support.length ? support.flatMap(item => item.claimIds) : claims.map(item => item.claimId));
  const blocked = claims.filter(item => ids.has(item.claimId) && item.needsRefresh).map(item => item.claimId);
  return { policyVersion: FRESHNESS_POLICY_VERSION, evaluatedAt: Number.isFinite(now) && Number.isFinite(new Date(now).getTime()) ? new Date(now).toISOString() : null, claims,
    recommendation: { coverage: support.length ? 'recorded' : 'unknown', needsReview: !!blocked.length, claimIds: blocked } };
}

export function sourceDateText(source) {
  const facts = sourceDateFacts(source);
  return `Published: ${facts.published ?? 'unknown'}; updated: ${facts.updated ?? 'unknown'}. ${facts.reason}` +
    (source.dateObservations?.length ? '\nRecorded date labels: ' + source.dateObservations.map(item => `${item.kind}: ${item.text}`).join('; ') : '');
}
export function claimFreshnessText(claim, assessment) {
  const status = assessment.claims.find(item => item.claimId === claim.id);
  const labels = { 'review-needed': 'Review needed', 'currentness-unknown': 'Currentness unknown', 'within-window': 'Within review window · unverified', 'durable-context': 'Durable concept', 'named-version': 'Named historical version' };
  return `${labels[status.status]} · ${status.type.replace(/-/g, ' ')}. ${status.reason}` +
    (claim.freshness ? `\nModel classification: ${claim.freshness.reason}` : '');
}
export function freshnessNotice(assessment) {
  return `Evaluated as of ${assessment.evaluatedAt ?? 'unknown time'} (policy ${assessment.policyVersion}). ` +
    (assessment.recommendation.needsReview ? 'Recommendation needs evidence review. A material time-sensitive premise is expired or its currentness is unknown. Use Research to review an explicit refresh; saved findings remain until a replacement succeeds.' : 'No age-based recommendation blocker identified; this does not establish currency or truth.') +
    (assessment.recommendation.coverage === 'unknown' ? ' Material support coverage is unknown.' : '');
}
