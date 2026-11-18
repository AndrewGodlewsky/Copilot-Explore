import { ANSWER_STATES, effectiveAnswerState, isQuestion } from './answer-state.mjs';
import { localDate, REVISIT_FILTERS, revisitMatches, validReviewDate } from './revisit.mjs';

export const SEARCH_PAGE_SIZE = 200;
export const searchText = value => String(value ?? '').normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function excerpt(text, matchAt) {
  const source = String(text ?? ''), target = Math.max(0, matchAt - 48);
  let normalizedOffset = 0, start = null, hit = 0, whitespace = true;
  // Map a normalized context offset to an original grapheme boundary. Only the
  // offset is normalized: displayed case, combining marks and whitespace stay exact.
  for (const { segment, index } of graphemes.segment(source)) {
    for (const char of segment.normalize('NFC').toLowerCase()) {
      if (/\s/u.test(char)) { if (!whitespace) normalizedOffset++; whitespace = true; }
      else { normalizedOffset += char.length; whitespace = false; }
    }
    if (start === null && normalizedOffset > target) start = index;
    if (normalizedOffset > matchAt) { hit = index; break; }
  }
  start ??= 0;
  // Collapsed whitespace can put the actual hit far beyond the preferred context.
  if (Array.from(source.slice(start, hit)).length > 48) start = hit;
  let value = '';
  for (const { segment } of graphemes.segment(source.slice(start))) {
    if (Array.from(value).length + Array.from(segment).length > 180) break;
    value += segment;
  }
  return `${start ? '…' : ''}${value}${start + value.length < source.length ? '…' : ''}`;
}
export function searchFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['query', 'state', 'importance', 'research', 'review', 'drafts', 'draftText', 'reminder', 'today', 'archived', 'cursor'].includes(k))) throw new Error('Invalid search filters.');
  const value = { query: '', state: 'all', importance: 'all', research: false, review: false, drafts: false, draftText: false, reminder: 'all', today: localDate(), archived: false, ...input };
  delete value.cursor;
  if (typeof value.query !== 'string' || value.query.length > 4000 || !(value.state === 'all' || Object.hasOwn(ANSWER_STATES, value.state)) || !['all', 'high', 'medium', 'low', 'unranked'].includes(value.importance) || !Object.hasOwn(REVISIT_FILTERS, value.reminder) || !validReviewDate(value.today) || ['research', 'review', 'drafts', 'draftText', 'archived'].some(k => typeof value[k] !== 'boolean')) throw new Error('Invalid search filters.');
  value.query = searchText(value.query); return value;
}
export function matchSearch(node, filters, { topic = '', draft = null } = {}) {
  const question = isQuestion(node), hasDraft = question && typeof draft === 'string';
  if (filters.state !== 'all' && (!question || effectiveAnswerState(node) !== filters.state) ||
      filters.importance !== 'all' && (!question || (node.importance ?? 'unranked') !== filters.importance) ||
      filters.research && !node.research || filters.review && !node.review || filters.drafts && !hasDraft ||
      !revisitMatches(node.revisit, filters.reminder, filters.today)) return null;
  const fields = [['Question', node.question], ['Saved answer', node.answer], ['Category', node.category], ['Journey', topic]];
  if (filters.draftText && hasDraft) fields.push(['Private draft', draft]);
  const match = fields.find(([, text]) => searchText(text).includes(filters.query));
  if (!match) return null;
  const [label, text] = match;
  return { snippet: `${label}: ${excerpt(text, searchText(text).indexOf(filters.query))}`, hasDraft };
}
