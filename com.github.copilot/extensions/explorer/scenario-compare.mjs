import { randomUUID } from 'node:crypto';
import { validateDocument, effectiveAnswerState, effectiveMode, isQuestion } from './model.mjs';
import { savedDigest } from './review-causes.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identity = (doc, nodeId, journeyId = doc.id) => ({ journeyId, rootId: doc.rootId, createdAt: doc.createdAt, nodeId });
const key = value => JSON.stringify([value.journeyId, value.rootId, value.createdAt, value.nodeId]);
function aliases(doc) {
  const inherited = new Map((doc.forkOrigin?.nodes ?? []).map(row => [row.nodeId, row]));
  return new Map(doc.nodes.map(node => {
    const values = new Set([key(identity(doc, node.id))]), row = inherited.get(node.id);
    if (row) {
      values.add(key(row.origin));
      values.add(key({ ...doc.forkOrigin.source, nodeId: row.sourceNodeId }));
    }
    if (doc.copyOrigin?.kind === 'personal-copy') values.add(key(identity(doc, node.id, doc.copyOrigin.sourceId)));
    return [node.id, values];
  }));
}
const summary = doc => ({ id: doc.id, rootId: doc.rootId, createdAt: doc.createdAt, topic: doc.topic, revision: doc.revision, scenario: !!doc.forkOrigin });

export function compareScenarios(left, right) {
  validateDocument(left); validateDocument(right);
  // Shared documents can retain valid whitespace that legacy normalization trims.
  left = structuredClone(left); right = structuredClone(right);
  const leftAliases = aliases(left), rightAliases = aliases(right);
  // Count alias collisions without constructing a potentially quadratic cross product.
  const index = values => {
    const result = new Map();
    for (const [id, keys] of values) for (const value of keys) { const entry = result.get(value); if (entry) entry.count++; else result.set(value, { id, count: 1 }); }
    return result;
  };
  const candidatesFor = (values, other) => new Map([...values].map(([id, keys]) => {
    const candidates = new Set(); let collision = false, found = false;
    for (const value of keys) { const entry = other.get(value); if (!entry) continue; found = true; if (entry.count > 1) collision = true; else candidates.add(entry.id); }
    return [id, { found, match: !collision && candidates.size === 1 ? [...candidates][0] : null }];
  }));
  const candidates = candidatesFor(leftAliases, index(rightAliases)), reverse = candidatesFor(rightAliases, index(leftAliases));
  const pairs = new Map(), pairedRight = new Set();
  for (const [id, { match }] of candidates) if (match !== null && reverse.get(match).match === id) { pairs.set(id, match); pairedRight.add(match); }
  const leftNodes = new Map(left.nodes.map(n => [n.id, n])), rightNodes = new Map(right.nodes.map(n => [n.id, n]));
  const links = doc => { const map = new Map(doc.nodes.map(n => [n.id, []])); for (const link of doc.dependencies ?? []) map.get(link.dependentId).push(link); return map; };
  const leftLinks = links(left), rightLinks = links(right);
  const linkKey = (list, translate) => list.map(link => JSON.stringify([translate(link.prerequisiteId), link.explanation ?? ''])).sort();
  const rows = left.nodes.map(a => {
    const rightId = pairs.get(a.id) ?? null, b = rightNodes.get(rightId), differences = [];
    if (b) {
      for (const field of ['question', 'category', 'kind', 'answer']) if ((a[field] ?? '') !== (b[field] ?? '')) differences.push(field);
      if (effectiveAnswerState(a) !== effectiveAnswerState(b)) differences.push('answerState');
      if (a.parentId === null ? b.parentId !== null : pairs.get(a.parentId) !== b.parentId) differences.push('parent');
      if (!same(a.research, b.research) || !!a.researchStale !== !!b.researchStale) differences.push('research');
      if (!!a.review !== !!b.review || !same(a.reviewCauses ?? null, b.reviewCauses ?? null)) differences.push('review');
      if (!same(linkKey(leftLinks.get(a.id), id => pairs.has(id) ? `right:${pairs.get(id)}` : `left:${id}`), linkKey(rightLinks.get(b.id), id => `right:${id}`))) differences.push('dependencies');
    } else differences.push('presence');
    return { leftId: a.id, rightId, relation: b ? 'paired' : 'only-left', ambiguous: !b && candidates.get(a.id).found, differences };
  });
  for (const b of right.nodes) if (!pairedRight.has(b.id)) rows.push({ leftId: null, rightId: b.id, relation: 'only-right', ambiguous: reverse.get(b.id).found, differences: ['presence'] });
  const counts = { paired: pairs.size, onlyLeft: left.nodes.length - pairs.size, onlyRight: right.nodes.length - pairs.size, ambiguous: rows.filter(r => r.ambiguous).length, changed: rows.filter(r => r.relation === 'paired' && r.differences.length).length,
    reviewLeft: left.nodes.filter(n => n.review).length, reviewRight: right.nodes.filter(n => n.review).length,
    questionsLeft: left.nodes.filter(n => n.id !== left.rootId && isQuestion(n)).length, questionsRight: right.nodes.filter(n => n.id !== right.rootId && isQuestion(n)).length };
  const context = Object.fromEntries(['topic', 'objective', 'successCriteria', 'pins', 'mode'].map(field => {
    const value = doc => field === 'mode' ? effectiveMode(doc) : doc[field] ?? (field === 'pins' ? [] : '');
    return [field, { left: value(left), right: value(right), same: same(value(left), value(right)) }];
  }));
  return { left, right, leftNodes, rightNodes, leftLinks, rightLinks, rows, counts, context };
}

export function comparisonPage(comparison, page = 0, selected = page * 25) {
  const { rows } = comparison, pages = Math.ceil(rows.length / 25);
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages || !Number.isSafeInteger(selected) || selected < page * 25 || selected >= Math.min(rows.length, (page + 1) * 25)) throw Error('Invalid comparison page or selected row.');
  const detail = (side, id) => {
    if (id === null) return null;
    const nodes = comparison[`${side}Nodes`], node = nodes.get(id);
    return { id, question: node.question, category: node.category, kind: id === comparison[side].rootId ? 'root' : node.kind ?? 'question', parent: node.parentId === null ? null : { id: node.parentId, question: nodes.get(node.parentId).question },
      answer: node.answer, answerState: effectiveAnswerState(node), review: !!node.review, reviewCauses: node.reviewCauses ?? null,
      research: node.research, researchStale: !!node.researchStale, dependencyCount: comparison[`${side}Links`].get(id).length,
      dependencies: comparison[`${side}Links`].get(id).slice(0, 25).map(link => ({ prerequisite: { id: link.prerequisiteId, question: nodes.get(link.prerequisiteId).question }, explanation: link.explanation ?? '' })) };
  };
  const selectedRow = rows[selected];
  const result = { left: summary(comparison.left), right: summary(comparison.right), counts: comparison.counts, context: comparison.context, page, pages, total: rows.length, selectedIndex: selected,
    items: rows.slice(page * 25, (page + 1) * 25).map((row, offset) => ({ index: page * 25 + offset, relation: row.relation, ambiguous: row.ambiguous, differences: row.differences, label: (comparison.leftNodes.get(row.leftId) ?? comparison.rightNodes.get(row.rightId)).question.slice(0, 240) })),
    selected: { ...selectedRow, left: detail('left', selectedRow.leftId), right: detail('right', selectedRow.rightId) },
    coverage: 'All saved nodes compared using recorded identity claims; ambiguous claims remain separate. Observed absence is not proof of addition or deletion: forks intentionally omit branches. Summary labels may be abbreviated; selected answers and evidence are complete. Up to 25 dependency details per side are shown; open a source for additional relationships. Current guidance is not a reconstructed historical base. Generation artifacts, reminders, accepted exports and private data are outside this comparison. Source provenance and retrieval dates are retained claims, not fresh verification.' };
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw Error('Selected comparison exceeds the response limit. Open each source to inspect its full content.');
  return result;
}

export class ScenarioComparison {
  constructor(readSources) { this.readSources = readSources; this.entry = null; }
  clear() { this.entry = null; }
  get(id) {
    if (!this.entry || this.entry.id !== id || Date.now() - this.entry.time > 15 * 60 * 1000) throw Error('Comparison expired. Compare the sources again.');
    return this.entry;
  }
  async check(entry) {
    const fresh = await this.readSources();
    if (!fresh.left || !fresh.right) throw Error('A comparison source is unavailable. Select the journeys again.');
    if (savedDigest(fresh.left) !== entry.leftDigest || savedDigest(fresh.right) !== entry.rightDigest) throw Error('A comparison source changed. Refresh the sources and compare again.');
  }
  async preview() {
    this.clear(); const sources = await this.readSources(), comparison = compareScenarios(sources.left, sources.right);
    const entry = { id: randomUUID(), time: Date.now(), comparison, leftDigest: savedDigest(sources.left), rightDigest: savedDigest(sources.right) };
    await this.check(entry); this.entry = entry;
    return { id: entry.id, ...comparisonPage(comparison) };
  }
  async page(id, page, selected) {
    const entry = this.get(id); await this.check(entry); return { id, ...comparisonPage(entry.comparison, page, selected) };
  }
  async source(id, side, nodeId) {
    const entry = this.get(id); await this.check(entry);
    if (!['left', 'right'].includes(side) || !entry.comparison[`${side}Nodes`].has(nodeId)) throw Error('Choose a saved comparison source node.');
    return { document: entry.comparison[side], nodeId, digest: entry[`${side}Digest`] };
  }
}
