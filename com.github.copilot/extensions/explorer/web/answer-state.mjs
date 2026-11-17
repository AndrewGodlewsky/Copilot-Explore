// Shared by the document model and editor. Missing v1 states stay sparse on disk.
export const ANSWER_STATES = Object.freeze({ unanswered: 'Unanswered', decided: 'Decided', tentative: 'Tentative', assumption: 'Assumption', 'needs-evidence': 'Need evidence', 'not-relevant': 'Not relevant', 'revisit-later': 'Revisit later' });
export const effectiveAnswerState = node => node.answerState ?? (node.answer?.trim() ? 'tentative' : 'unanswered');
export function answerStateError(answer, state) {
  if (typeof state !== 'string' || !Object.hasOwn(ANSWER_STATES, state)) return 'Invalid answer state.';
  if (state === 'unanswered' && answer.trim()) return 'Clear the answer text explicitly before choosing Unanswered.';
  if (['decided', 'tentative', 'assumption'].includes(state) && !answer.trim()) return `${ANSWER_STATES[state]} requires answer text. Add text or choose another state.`;
  return '';
}
export function questionCounts(doc) {
  const counts = { total: 0, answered: 0, resolved: 0, deferred: 0, unresolved: 0 };
  for (const node of doc.nodes) {
    if (node.id === doc.rootId) continue;
    const state = effectiveAnswerState(node); counts.total++;
    if (node.answer.trim()) counts.answered++;
    if (['decided', 'not-relevant'].includes(state) && !node.review) counts.resolved++;
    if (state === 'revisit-later') counts.deferred++;
  }
  counts.unresolved = counts.total - counts.resolved;
  return counts;
}
export const ANSWER_CONTEXT_GUIDANCE = 'Answer states describe user intent, never external verification. Decided is a user decision; Assumption is unverified; Tentative is provisional. Need evidence and Unanswered remain unresolved. Not relevant records a scope choice; Revisit later is deferred. A needs-review flag means an ancestor changed: recheck the answer rather than treating it as settled.';
