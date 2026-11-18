// Local saved-map prioritization; no model or network access.
import { effectiveAnswerState, isQuestion } from './answer-state.mjs';
import { DecisionImpact, decisionImpactKey } from './decision-impact.mjs';

const stopWords = new Set('and are but can could for from has have how into its our should that the their them there these they this was what when where which who why will with would you your'.split(' '));
const terms = text => new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => [...word].length >= 3 && !stopWords.has(word)));
const overlap = (words, guidance) => [...words].filter(word => guidance.has(word)).sort();
const source = (node, band) => JSON.stringify([node.parentId, node.question, node.answer, effectiveAnswerState(node), !!node.review, node.reviewCauses, node.importance, node.importanceReason, node.rationale, node.generation, band]);
const importance = { high: 3, medium: 2, low: 1 };
const rank = a => [importance[a.band], a.review ? a.state === 'assumption' ? 2 : 1 : 0, a.constraintTerms.length, a.goalTerms.length, importance[a.importance] ?? 0];
function better(a, b) {
  if (!b) return true;
  const left = rank(a), right = rank(b);
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] > right[i];
  return a.id < b.id;
}

// Input is the validated saved document: <=5,000 nodes and <=16,000 guidance characters.
export class NextQuestion {
  dismissed = new Map();
  impact(doc) {
    const key = decisionImpactKey(doc);
    if (key !== this.impactKey) { this.impactKey = key; this.index = new DecisionImpact(doc); }
    return this.index;
  }
  sync(doc, journey = doc.id) {
    const guidance = JSON.stringify([doc.objective, doc.successCriteria, doc.pins ?? [], doc.mode ?? 'understand']);
    if (this.journey !== journey || this.guidance !== guidance) this.dismissed.clear();
    this.journey = journey; this.guidance = guidance;
    if (!this.dismissed.size) return;
    const index = this.impact(doc);
    const nodes = new Map(doc.nodes.map(node => [node.id, node]));
    for (const [id, fingerprint] of this.dismissed) if (!nodes.has(id) || !isQuestion(nodes.get(id)) || source(nodes.get(id), index.bandFor(id)) !== fingerprint) this.dismissed.delete(id);
    return index;
  }
  dismiss(doc, id, journey = doc.id) {
    const index = this.sync(doc, journey) ?? this.impact(doc);
    const node = doc.nodes.find(node => node.id === id);
    if (node && isQuestion(node)) this.dismissed.set(id, source(node, index.bandFor(id)));
  }
  suggest(doc, journey = doc.id) {
    const index = this.sync(doc, journey) ?? this.impact(doc);
    const counts = { questions: 0, resolved: 0, deferred: 0, review: 0, eligible: 0, matched: 0, dismissed: 0 };
    const goal = terms(`${doc.objective ?? ''} ${doc.successCriteria ?? ''}`), constraints = terms((doc.pins ?? []).map(pin => pin.text).join(' '));
    let candidate = null;
    for (const node of doc.nodes) {
      if (!isQuestion(node)) continue;
      counts.questions++;
      const state = effectiveAnswerState(node);
      if (node.review) counts.review++;
      if (state === 'revisit-later') { counts.deferred++; continue; }
      if (!node.review && ['decided', 'not-relevant'].includes(state)) { counts.resolved++; continue; }
      counts.eligible++;
      const words = terms(node.question), constraintTerms = overlap(words, constraints), goalTerms = overlap(words, goal);
      const band = index.bandFor(node.id);
      if (band === 'low' && !node.review && (!doc.objective?.trim() || !constraintTerms.length && !goalTerms.length)) continue;
      counts.matched++;
      if (this.dismissed.has(node.id)) { counts.dismissed++; continue; }
      const choice = { id: node.id, question: node.question, state, review: !!node.review, band, constraintTerms, goalTerms,
        importance: node.importance ?? null, importanceReason: node.importanceReason ?? null, rationale: node.rationale ?? null,
        originalQuestion: node.generation?.originalQuestion ?? null };
      if (better(choice, candidate)) candidate = choice;
    }
    if (candidate) { const { counts, band, rules } = index.analyze(candidate.id); candidate.impact = { counts, band, rules }; }
    const status = candidate ? 'suggested' : !doc.objective?.trim() && !counts.matched ? 'no-goal' : !counts.questions ? 'empty' :
      counts.resolved === counts.questions ? 'resolved' : !counts.eligible ? 'excluded' : counts.dismissed ? 'dismissed' : 'no-match';
    return { status, candidate: status === 'suggested' ? candidate : null, counts };
  }
}
