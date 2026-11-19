import { effectiveAnswerState, isQuestion } from './web/answer-state.mjs';

export const RESEARCH_SELECTION_POLICY = 'Required target, guidance and pins are included first. Optional records prioritize explicit prerequisites of the target or its ancestors, then literal matches to pinned constraints, objective/success criteria and the target, then ancestry and other saved answer states. Equivalent relevance favors needs-review, assumptions and unresolved evidence before settled decisions, then tree distance and stable ID. Selection is a deterministic heuristic, not semantic understanding or external verification. Reasons are navigation/context signals, never proof. Preserve conflicting and tentative statements as uncertainty; omitted or historical records were not read.';
const stopWords = new Set('and are but can could for from has have how into its our should that the their them there these they this was what when where which who why will with would you your same other question'.split(' '));
const terms = text => new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => [...word].length >= 3 && !stopWords.has(word)));
const overlap = (words, reference) => { let count = 0; for (const word of reference) if (words.has(word)) count++; return count; };
const stateRank = node => node.review ? 6 : ({ assumption: 5, 'needs-evidence': 4, tentative: 3, decided: 2, 'revisit-later': 1 }[effectiveAnswerState(node)] ?? 0);

export function contextGraph(doc, nodeId) {
  const byId = new Map(doc.nodes.map(node => [node.id, node])), path = [], seen = new Set();
  if (!byId.has(nodeId)) throw Error('Context target no longer exists.');
  for (let node = byId.get(nodeId); node; node = byId.get(node.parentId)) {
    if (seen.has(node.id) || seen.size >= 5000) throw Error('Invalid context ancestry.');
    seen.add(node.id); path.push(node);
  }
  path.reverse();
  const adjacent = new Map(doc.nodes.map(node => [node.id, []]));
  for (const node of doc.nodes) if (adjacent.has(node.parentId)) { adjacent.get(node.parentId).push(node.id); adjacent.get(node.id).push(node.parentId); }
  const distances = new Map([[nodeId, 0]]), queue = [nodeId];
  for (let i = 0; i < queue.length; i++) for (const id of adjacent.get(queue[i])) if (!distances.has(id)) { distances.set(id, distances.get(queue[i]) + 1); queue.push(id); }
  return { byId, path, distances };
}

// Operates only on validated current saved records. No history, research or private inputs.
export function researchRelevance(doc, nodeId, graph = contextGraph(doc, nodeId)) {
  const { byId, path, distances } = graph, pathIds = new Set(path.map(node => node.id));
  const incoming = new Map(doc.nodes.map(node => [node.id, []]));
  for (const link of doc.dependencies ?? []) incoming.get(link.dependentId)?.push(link.prerequisiteId);
  const reached = new Map(path.map(node => [node.id, 0])), prerequisites = new Map(), queue = [...pathIds];
  for (let i = 0; i < queue.length; i++) for (const id of incoming.get(queue[i]) ?? []) {
    const depth = reached.get(queue[i]) + 1;
    if (!prerequisites.has(id) || depth < prerequisites.get(id)) prerequisites.set(id, depth);
    if (!reached.has(id)) { reached.set(id, depth); queue.push(id); }
  }
  const target = byId.get(nodeId), targetTerms = terms(target.question + '\n' + target.answer);
  const pins = terms((doc.pins ?? []).map(pin => pin.text).join('\n'));
  const goals = terms((doc.objective ?? '') + '\n' + (doc.successCriteria ?? ''));
  const reasons = new Map([[nodeId, ['Required target']]]), optional = [];
  for (const node of doc.nodes) {
    if (node.id === nodeId) continue;
    const ancestor = pathIds.has(node.id), prerequisite = prerequisites.has(node.id);
    if (!ancestor && !prerequisite && !(isQuestion(node) && (node.answer.trim() || effectiveAnswerState(node) !== 'unanswered'))) continue;
    const words = terms(node.question + '\n' + node.answer), pinMatches = overlap(words, pins), goalMatches = overlap(words, goals), targetMatches = overlap(words, targetTerms);
    const matches = pinMatches + goalMatches + targetMatches;
    const selection = [...(prerequisite ? ['Explicit prerequisite'] : []), ...(pinMatches ? ['Matches pinned constraints'] : []), ...(goalMatches ? ['Matches objective or success criteria'] : []), ...(targetMatches ? ['Matches target question or answer'] : []), ancestor ? 'Ancestor path' : 'Saved answer state'];
    reasons.set(node.id, selection);
    optional.push({ id: node.id, key: ancestor ? 'path' : 'decisionsElsewhere', selection,
      rank: [prerequisite ? 3 : matches ? 2 : ancestor ? 1 : 0, prerequisite ? -prerequisites.get(node.id) : 0, pinMatches, goalMatches, targetMatches, stateRank(node), -distances.get(node.id)] });
  }
  optional.sort((a, b) => { for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i]; return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  return { optional, reasons };
}

// Human review only: bounded whole descriptors, never omitted answers or model input.
export function researchOmissions(byId, optional, selectedIds, scope, excluded = []) {
  const omitted = optional.filter(item => !selectedIds.has(item.id)), exclusions = new Set(excluded);
  const sample = { total: omitted.length, entries: [], remaining: omitted.length, recordLimit: 50, byteLimit: 32768 };
  for (const item of omitted) {
    if (sample.entries.length === sample.recordLimit) break;
    const node = byId.get(item.id);
    sample.entries.push({ id: item.id, question: node.question, ...(isQuestion(node) ? { answerState: effectiveAnswerState(node) } : {}),
      reason: exclusions.has(item.id) ? 'excluded' : scope === 'path' && item.key !== 'path' ? 'scope' : 'budget', selection: item.selection });
    sample.remaining--;
    if (Buffer.byteLength(JSON.stringify(sample)) > sample.byteLimit) { sample.entries.pop(); sample.remaining++; break; }
  }
  return sample;
}
