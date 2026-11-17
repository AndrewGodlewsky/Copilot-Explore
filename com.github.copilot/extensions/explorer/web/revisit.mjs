// Date-only schedules use the viewer's local calendar, never UTC midnight.
export function localDate(now = new Date()) {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function validReviewDate(value) {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function validateRevisit(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'acknowledgedAt,condition,date') throw Error('Invalid revisit fields.');
  const { date, condition, acknowledgedAt } = value;
  if (date !== null && !validReviewDate(date)) throw Error('Review date must be a real calendar date in YYYY-MM-DD format (0001–9999).');
  if (typeof condition !== 'string' || condition.length > 1000 || (date === null && !condition.trim())) throw Error('A revisit needs a date or nonblank manual condition (at most 1,000 characters).');
  if (acknowledgedAt !== null && (typeof acknowledgedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(acknowledgedAt) || !Number.isFinite(Date.parse(acknowledgedAt)) || new Date(acknowledgedAt).toISOString() !== acknowledgedAt)) throw Error('Invalid revisit acknowledgment timestamp.');
  return { date, condition, acknowledgedAt };
}
export const REVISIT_FILTERS = Object.freeze({ all: 'All journeys / questions', any: 'Any reminder', attention: 'Needs attention', overdue: 'Overdue', 'due-today': 'Due today', upcoming: 'Upcoming', 'manual-condition': 'Manual condition', acknowledged: 'Acknowledged' });
export function revisitStatuses(value, today = localDate()) {
  if (!value) return [];
  if (value.acknowledgedAt) return ['acknowledged'];
  return [...(value.date ? [value.date < today ? 'overdue' : value.date === today ? 'due-today' : 'upcoming'] : []), ...(value.condition.trim() ? ['manual-condition'] : [])];
}
export function revisitMatches(value, filter, today = localDate()) {
  const statuses = revisitStatuses(value, today);
  return filter === 'all' || (filter === 'any' ? statuses.length > 0 : filter === 'attention' ? statuses.some(status => ['overdue', 'due-today', 'manual-condition'].includes(status)) : statuses.includes(filter));
}
export function revisitSummary(nodes, today = localDate()) {
  const counts = Object.fromEntries(Object.keys(REVISIT_FILTERS).filter(key => key !== 'all').map(key => [key, 0]));
  let nextDate = null;
  for (const { revisit } of nodes) {
    for (const key of Object.keys(counts)) if (revisitMatches(revisit, key, today)) counts[key]++;
    if (revisit?.date && !revisit.acknowledgedAt && (!nextDate || revisit.date < nextDate)) nextDate = revisit.date;
  }
  return { counts, nextDate };
}
