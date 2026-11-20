import { contextGraph } from './research-relevance.mjs';
import { effectiveAnswerState } from './web/answer-state.mjs';
import { PROJECT_LIMITS } from './project-context.mjs';

const stop = new Set('and are but can could for from has have how into its our should that the their them there these they this was what when where which who why will with would you your project question source file'.split(' '));
const terms = text => new Set((text.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => [...word].length >= 3 && !stop.has(word)));
const matches = (words, reference) => [...reference].filter(word => words.has(word));

export function branchFileBasis(doc, nodeId) {
  const { path } = contextGraph(doc, nodeId);
  return { journey: doc.id, rootId: doc.rootId, createdAt: doc.createdAt, objective: doc.objective ?? '', successCriteria: doc.successCriteria ?? '', pins: structuredClone(doc.pins ?? []),
    path: path.map(node => ({ id: node.id, parentId: node.parentId, kind: node.kind, question: node.question, answer: node.answer, answerState: effectiveAnswerState(node), review: node.review ?? null })) };
}

/** Local filename hints only; this object grants no file-read or model authority. */
export function branchFileContext(doc, nodeId, direction, brief, revision) {
  if (typeof direction !== 'string' || direction.length > 500) throw Error('Use a branch direction of at most 500 characters.');
  const basis = branchFileBasis(doc, nodeId), target = basis.path.at(-1), sources = new Map(brief.sources.map(source => [source.id, source.name]));
  const shared = new Set(brief.sections.constraints.flatMap(claim => claim.sources.map(ref => sources.get(ref.id))).filter(Boolean));
  const directed = terms(direction), focused = terms(`${target.question}\n${target.answer ?? ''}`), ancestors = terms(basis.path.slice(0, -1).map(node => `${node.question}\n${node.answer ?? ''}`).join('\n'));
  const general = terms(Object.values(brief.sections).flat().filter(claim => claim.kind !== 'unknown').map(claim => claim.text).join('\n') + '\n' + basis.objective + '\n' + basis.successCriteria + '\n' + basis.pins.map(pin => pin.text).join('\n'));
  return { basis, shared: [...shared], summary: { nodeId, question: target.question, direction, briefRevision: revision }, match(name) {
    const words = terms(name), direct = matches(words, directed), question = matches(words, focused), parent = matches(words, ancestors), broad = matches(words, general), retained = shared.has(name);
    if (!direct.length && !question.length && !parent.length && !broad.length && !retained) return null;
    const reason = [...(direct.length ? [`Direction filename matches: ${direct.slice(0, 8).join(', ')}`] : []), ...(question.length ? [`Saved question/answer filename matches: ${question.slice(0, 8).join(', ')}`] : []),
      ...(retained ? ['Source of a reviewed shared constraint'] : []), ...(parent.length ? [`Ancestor filename matches: ${parent.slice(0, 8).join(', ')}`] : []), ...(broad.length ? [`Brief/guidance filename matches: ${broad.slice(0, 8).join(', ')}`] : [])].join('. ');
    return { reason, priority: -(direct.length * 1000 + question.length * 100 + (retained ? 50 : 0) + parent.length * 10 + broad.length) };
  } };
}

export function suggestBranchFiles(files, context) {
  const suggested = []; let bytes = 0, excerpts = 0;
  for (const file of files) {
    const excerpt = Math.min(file.bytes, PROJECT_LIMITS.excerptBytes);
    if (suggested.length >= PROJECT_LIMITS.files || bytes + file.bytes > PROJECT_LIMITS.totalBytes || excerpts + excerpt > PROJECT_LIMITS.totalExcerptBytes) continue;
    suggested.push(file.name); bytes += file.bytes; excerpts += excerpt;
  }
  return { ...context.summary, suggested, omitted: files.length - suggested.length, omittedShared: context.shared.filter(name => !suggested.includes(name)) };
}
