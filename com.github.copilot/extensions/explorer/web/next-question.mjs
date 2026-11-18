// Local saved-map prioritization; no model or network access.
import { effectiveAnswerState, isQuestion } from './answer-state.mjs';

const stopWords = new Set('and are but can could for from has have how into its our should that the their them there these they this was what when where which who why will with would you your'.split(' '));
const terms = text => new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => [...word].length >= 3 && !stopWords.has(word)));
const overlap = (words, guidance) => [...words].filter(word => guidance.has(word)).sort();
const source = node => JSON.stringify([node.parentId, node.question, node.answer, effectiveAnswerState(node), !!node.review, node.importance, node.importanceReason, node.rationale, node.generation]);
const importance = { high: 3, medium: 2, low: 1 };
const better = (a, b) => !b || a.constraintTerms.length > b.constraintTerms.length ||
  a.constraintTerms.length === b.constraintTerms.length && (a.goalTerms.length > b.goalTerms.length ||
  a.goalTerms.length === b.goalTerms.length && ((importance[a.importance] ?? 0) > (importance[b.importance] ?? 0) ||
  (importance[a.importance] ?? 0) === (importance[b.importance] ?? 0) && a.id < b.id));

// Input is the validated saved document: <=5,000 nodes and <=16,000 guidance characters.
export class NextQuestion {
  dismissed = new Map();
  sync(doc, journey = doc.id) {
    const guidance = JSON.stringify([doc.objective, doc.successCriteria, doc.pins ?? [], doc.mode ?? 'understand']);
    if (this.journey !== journey || this.guidance !== guidance) this.dismissed.clear();
    this.journey = journey; this.guidance = guidance;
    const nodes = new Map(doc.nodes.map(node => [node.id, node]));
    for (const [id, fingerprint] of this.dismissed) if (!nodes.has(id) || source(nodes.get(id)) !== fingerprint) this.dismissed.delete(id);
  }
  dismiss(doc, id, journey = doc.id) {
    this.sync(doc, journey);
    const node = doc.nodes.find(node => node.id === id);
    if (node && isQuestion(node)) this.dismissed.set(id, source(node));
  }
  suggest(doc, journey = doc.id) {
    this.sync(doc, journey);
    const counts = { questions: 0, resolved: 0, deferred: 0, review: 0, eligible: 0, matched: 0, dismissed: 0 };
    const goal = terms(`${doc.objective ?? ''} ${doc.successCriteria ?? ''}`), constraints = terms((doc.pins ?? []).map(pin => pin.text).join(' '));
    let candidate = null;
    for (const node of doc.nodes) {
      if (!isQuestion(node)) continue;
      counts.questions++;
      const state = effectiveAnswerState(node);
      if (node.review) { counts.review++; continue; }
      if (['decided', 'not-relevant'].includes(state)) { counts.resolved++; continue; }
      if (state === 'revisit-later') { counts.deferred++; continue; }
      counts.eligible++;
      const words = terms(node.question), constraintTerms = overlap(words, constraints), goalTerms = overlap(words, goal);
      if (!constraintTerms.length && !goalTerms.length) continue;
      counts.matched++;
      if (this.dismissed.has(node.id)) { counts.dismissed++; continue; }
      const choice = { id: node.id, question: node.question, state, constraintTerms, goalTerms,
        importance: node.importance ?? null, importanceReason: node.importanceReason ?? null, rationale: node.rationale ?? null,
        originalQuestion: node.generation?.originalQuestion ?? null };
      if (better(choice, candidate)) candidate = choice;
    }
    const status = !doc.objective?.trim() ? 'no-goal' : candidate ? 'suggested' : !counts.questions ? 'empty' :
      counts.resolved === counts.questions ? 'resolved' : !counts.eligible ? 'excluded' : counts.dismissed ? 'dismissed' : 'no-match';
    return { status, candidate: status === 'suggested' ? candidate : null, counts };
  }
}
