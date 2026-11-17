import { createHash } from 'node:crypto';
import { prepareBrief, parseBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { MAX_DOCUMENT_BYTES, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';

const date = '2026-01-01T00:00:00.000Z';
const research = {
  basis: 'reasoning', summary: 'Compare the tradeoffs with the saved constraints. '.repeat(18),
  options: [
    { title: 'Pilot', description: 'Try one branch first. '.repeat(30), pros: ['Short feedback cycle'], cons: ['Limited scope'] },
    { title: 'Broad rollout', description: 'Include all branches. '.repeat(30), pros: ['Broad coverage'], cons: ['More coordination'] },
  ], recommendation: 'Keep the choice open pending user review.', uncertainty: 'No external sources were consulted.', sources: [],
};
const specs = [
  { name: 'small-deep', count: 64, topology: 'deep' },
  { name: 'small-wide', count: 64, topology: 'wide' },
  { name: 'medium-deep', count: 640, topology: 'deep' },
  { name: 'medium-wide', count: 640, topology: 'wide' },
  { name: 'large-deep', count: 2400, topology: 'deep' },
  { name: 'large-wide', count: 2400, topology: 'wide' },
  { name: 'near5000-deep', count: 4950, topology: 'deep' },
  { name: 'near5000-wide', count: 4950, topology: 'wide' },
  { name: 'near9mib-wide', count: 4950, topology: 'wide', nearBytes: true },
];
export const fixtureSpecs = Object.freeze(specs.map(value => Object.freeze(value)));

function base(spec) {
  const nodes = [{ id: 'node-0', parentId: null, question: 'Synthetic planning journey', category: 'Your idea', answer: '', research: null, review: false }];
  for (let i = 1; i < spec.count; i++) {
    const direction = i % 17 === 0;
    const parent = spec.topology === 'deep' ? i - 1 : Math.floor((i - 1) / 7);
    nodes.push({ id: `node-${i}`, parentId: `node-${parent}`, ...(direction ? { kind: 'direction' } : {}),
      question: direction ? `User direction ${i}: preserve the local constraint` : `Question ${i}: what choice fits this branch?`,
      category: direction ? 'Direction' : 'Planning',
      answer: direction || i % 5 === 0 ? '' : `Saved user answer ${i}. ` + 'Specific tradeoff and reason. '.repeat(12),
      ...(!direction && i % 5 !== 0 ? { answerState: i % 4 === 0 ? 'tentative' : i % 7 === 0 ? 'assumption' : 'decided' } : {}),
      research: !direction && i % 23 === 0 ? structuredClone(research) : null, review: !direction && i % 13 === 0 });
  }
  const doc = { format: 'copilot-explorer', version: 1, id: 'synthetic-perf-journey', revision: 1,
    topic: nodes[0].question, objective: 'Choose a small pilot with accountable owners.',
    successCriteria: 'Record tradeoffs and revisit uncertain choices.', mode: 'decide',
    pins: [{ id: 'synthetic-constraint-0001', text: 'Keep the first pilot under one month.' }],
    rootId: nodes[0].id, createdAt: date, updatedAt: date, finishedAt: null, nodes };
  const prepared = prepareBrief(doc);
  const sections = Object.fromEntries(['goal', 'decisions', 'constraints', 'assumptions', 'unresolved', 'nextSteps'].map(key => [key, []]));
  sections.goal.push({ id: 'goal-1', text: 'Choose a small pilot.', certainty: 'user-statement', sources: [{ kind: 'guidance', field: 'objective' }] });
  sections.constraints.push({ id: 'constraint-1', text: 'Keep the first pilot under one month.', certainty: 'user-statement', sources: [{ kind: 'guidance', field: 'pins' }] });
  sections.unresolved.push({ id: 'open-1', text: 'The rollout size remains open.', certainty: 'uncertain', sources: [] });
  doc.brief = { version: 1, acceptedAt: date, ...parseBrief(JSON.stringify(sections), prepared) };
  return doc;
}

export function makeFixture(spec) {
  if (!fixtureSpecs.includes(spec)) throw new Error('Unknown performance fixture.');
  const doc = base(spec);
  if (spec.nearBytes) {
    // Distribute padding across real answer fields, staying below each 20,000-character cap.
    const targets = doc.nodes.filter(node => node.answer);
    const targetBytes = MAX_DOCUMENT_BYTES - 60 * 1024;
    let bytes = Buffer.byteLength(JSON.stringify(doc, null, 2));
    for (const node of targets) {
      if (bytes >= targetBytes) break;
      const add = Math.min(20000 - node.answer.length, targetBytes - bytes);
      node.answer += 'x'.repeat(add);
      bytes += add;
    }
    if (bytes < targetBytes) throw new Error('Fixture could not approach the saved-data limit.');
  }
  const validated = validateDocument(doc);
  const bytes = Buffer.byteLength(JSON.stringify(validated, null, 2));
  const questions = validated.nodes.filter(node => node.kind !== 'direction' && node.id !== doc.rootId).length;
  const fingerprint = createHash('sha256').update(JSON.stringify(validated)).digest('hex');
  return { document: validated, definition: { name: spec.name, topology: spec.topology, nodes: validated.nodes.length, questions, bytes, fingerprint,
    savedBrief: true, researchNodes: validated.nodes.filter(node => node.research).length, answeredNodes: validated.nodes.filter(node => node.answer).length } };
}
