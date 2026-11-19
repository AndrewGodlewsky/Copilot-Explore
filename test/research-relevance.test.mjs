import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions, addDependency, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareResearch, sameResearchSources } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { prepareFollowup, sameFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';

function question(doc, parent, text, answer = '', state) {
  const [node] = addQuestions(doc, parent, [{ question: text, category: 'Fixture' }]);
  node.answer = answer; if (state) node.answerState = state; return node;
}
function oversized() {
  const doc = createDocument('Shared program'); let parent = doc.rootId;
  for (let i = 0; i < 9; i++) parent = question(doc, parent, `Earlier detail ${i}`, 'x'.repeat(20000), 'decided').id;
  const target = question(doc, parent, 'Which service should we choose?');
  const distant = question(doc, doc.rootId, 'A distant prerequisite?', 'z'.repeat(20000), 'assumption');
  addDependency(doc, target.id, distant.id); validateDocument(doc);
  return { doc, target, distant };
}
const records = prepared => [...prepared.context.path, ...prepared.context.decisionsElsewhere];

test('distant explicit prerequisites fit before large optional ancestors consume the research budget', () => {
  const { doc, target, distant } = oversized(), before = structuredClone(doc);
  const prepared = prepareResearch(doc, target.id);
  const selected = prepared.context.decisionsElsewhere.find(node => node.id === distant.id);
  assert.ok(selected, 'Distant explicit prerequisite must contribute before optional ancestors exhaust the budget');
  assert.equal(selected.answer, distant.answer); assert.equal(selected.answerState, 'assumption');
  assert.ok(selected.selection.includes('Explicit prerequisite'));
  assert.ok(prepared.coverage.omitted.path > 0); assert.ok(prepared.coverage.omitted.budget > 0);
  assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
  assert.ok(prepared.bytes <= 131072); assert.deepEqual(doc, before);
  doc.nodes.reverse(); assert.equal(prepareResearch(doc, target.id).prompt, prepared.prompt);
});

test('pins and objectives select relevant distant decisions without converting conflicting assumptions into facts', () => {
  const doc = createDocument('Service choice', { objective: 'Provide offline access', successCriteria: 'Accessible journeys' });
  doc.pins = [{ id: 'pin-storage', text: '  Preserve encrypted storage 🌿  ' }];
  const near = question(doc, doc.rootId, 'Nearby logistics?', 'Routine', 'decided');
  const target = question(doc, near.id, 'How should authentication work?');
  const far = question(doc, doc.rootId, 'Storage constraints?', 'Encrypted storage must stay local', 'decided');
  const conflict = question(doc, doc.rootId, 'A storage assumption?', 'Encrypted storage may be remote', 'assumption');
  conflict.review = true;
  const goal = question(doc, doc.rootId, 'Where should access work?', 'Offline access is provisional', 'tentative');
  const prepared = prepareResearch(doc, target.id), others = prepared.context.decisionsElsewhere;
  assert.equal(others[0].id, conflict.id);
  for (const id of [far.id, conflict.id]) assert.ok(others.find(node => node.id === id).selection.includes('Matches pinned constraints'));
  assert.ok(others.find(node => node.id === goal.id).selection.includes('Matches objective or success criteria'));
  assert.equal(others.find(node => node.id === conflict.id).answerState, 'assumption');
  assert.equal(others.find(node => node.id === conflict.id).review, true);
  assert.equal(others.find(node => node.id === goal.id).answerState, 'tentative');
  assert.deepEqual(prepared.context.pins, doc.pins);
  assert.match(prepared.context.selectionPolicy, /heuristic|literal/i);
  assert.match(prepared.context.selectionPolicy, /not.*verif|never.*verif/i);
});

test('explicit unanswered prerequisites remain unresolved and can be excluded or omitted by path scope', () => {
  const doc = createDocument('Planning'), target = question(doc, doc.rootId, 'Choose a vendor?');
  const unresolved = question(doc, doc.rootId, 'What is the spending limit?');
  addDependency(doc, target.id, unresolved.id);
  const prepared = prepareResearch(doc, target.id);
  assert.equal(prepared.context.decisionsElsewhere.find(node => node.id === unresolved.id)?.answerState, 'unanswered');
  const excluded = prepareResearch(doc, target.id, { excluded: [unresolved.id] });
  assert.equal(excluded.coverage.omitted.excluded, 1); assert.ok(!records(excluded).some(node => node.id === unresolved.id));
  const path = prepareResearch(doc, target.id, { scope: 'path' });
  assert.equal(path.context.decisionsElsewhere.length, 0); assert.equal(path.coverage.omitted.scope, 1);
  unresolved.answer = 'Changed excluded source';
  assert.ok(sameResearchSources(excluded.dependencies, doc)); assert.ok(sameResearchSources(path.dependencies, doc));
});

test('research freshness rejects changed contributors and changed selection while tolerating unrelated omitted edits', () => {
  const { doc, target, distant } = oversized(), prepared = prepareResearch(doc, target.id);
  const included = new Set(records(prepared).map(node => node.id));
  const omitted = doc.nodes.find(node => !included.has(node.id) && node.id !== doc.rootId);
  assert.ok(omitted); omitted.answer = 'q'.repeat(20000); doc.revision++;
  assert.ok(sameResearchSources(prepared.dependencies, doc), 'An omitted record staying omitted is unrelated');
  const changed = structuredClone(doc); changed.nodes.find(node => node.id === distant.id).answer += '!';
  assert.equal(sameResearchSources(prepared.dependencies, changed), false);
  doc.dependencies = []; assert.equal(sameResearchSources(prepared.dependencies, doc), false, 'Removing a contributing selection reason invalidates the review');
  const baseline = prepareResearch(doc, target.id);
  addDependency(doc, target.id, distant.id);
  assert.equal(sameResearchSources(baseline.dependencies, doc), false, 'New relevant membership cannot use the old token');
});

test('newly relevant saved records invalidate research without requiring a global document revision match', () => {
  const doc = createDocument('Planning'), target = question(doc, doc.rootId, 'Which database should we use?');
  const unrelated = question(doc, doc.rootId, 'What color are the chairs?');
  const prepared = prepareResearch(doc, target.id);
  unrelated.question = 'Which chair color?'; doc.revision += 10; doc.updatedAt = new Date().toISOString();
  assert.ok(sameResearchSources(prepared.dependencies, doc));
  unrelated.answer = 'Blue chairs'; unrelated.answerState = 'decided';
  assert.ok(sameResearchSources(prepared.dependencies, doc), 'A newly answered unrelated fallback is not a new relevant contributor');
  question(doc, doc.rootId, 'Database availability?', 'Availability requires replicas', 'decided');
  assert.equal(sameResearchSources(prepared.dependencies, doc), false);
});

test('question and brief operations retain their separate contracts and ordinary research rejects project excerpts', () => {
  const doc = createDocument('Planning'), target = question(doc, doc.rootId, 'Choose a service?');
  const other = question(doc, doc.rootId, 'Unanswered dependency?'); addDependency(doc, target.id, other.id);
  const generation = prepareResearch(doc, target.id, { operation: 'questions' });
  assert.equal(generation.context.selectionPolicy, undefined); assert.equal(generation.context.decisionsElsewhere.length, 0);
  assert.ok(records(generation).every(node => !node.selection));
  const brief = prepareResearch(doc, doc.rootId, { operation: 'brief' });
  assert.equal(brief.context.selectionPolicy, undefined); assert.ok(brief.context.decisionsElsewhere.some(node => node.id === other.id));
  assert.throws(() => prepareResearch(doc, target.id, { projectSources: [{ text: 'PRIVATE PROJECT CANARY' }] }), /project.*research|research.*project/i);
});

test('removing or clearing an excluded record does not invalidate unchanged reviewed contributors', () => {
  const doc = createDocument('Planning'), target = question(doc, doc.rootId, 'Which service?');
  const excluded = question(doc, doc.rootId, 'Furniture?', 'Blue chairs', 'decided');
  const prepared = prepareResearch(doc, target.id, { excluded: [excluded.id] });
  excluded.answer = ''; excluded.answerState = 'unanswered';
  assert.ok(sameResearchSources(prepared.dependencies, doc));
  doc.nodes = doc.nodes.filter(node => node.id !== excluded.id);
  assert.ok(sameResearchSources(prepared.dependencies, doc));
});

test('research selection counts Unicode, complete records and scenario framing at exact byte boundaries', () => {
  const doc = createDocument('Planning 🌿'), target = doc.nodes[0];
  const optional = question(doc, doc.rootId, 'A saved decision?', '\0🌿', 'tentative');
  const options = { instructions: 'instructions 🌿', prefix: 'DATA\n', scenario: { source: 'hypothetical', preference: 'unselected' } };
  const base = prepareResearch(doc, target.id, options);
  for (const delta of [-1, 0, 1]) {
    const prepared = prepareResearch(doc, target.id, { ...options, prefix: options.prefix + 'x'.repeat(131072 - base.bytes + delta) });
    assert.ok(prepared.bytes <= 131072); assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
    assert.ok(sameResearchSources(prepared.dependencies, doc));
    if (delta <= 0) { assert.equal(prepared.bytes, 131072 + delta); assert.equal(prepared.context.decisionsElsewhere[0].answer, optional.answer); }
    else { assert.equal(prepared.coverage.omitted.budget, 1); optional.answer += '!'; assert.ok(sameResearchSources(prepared.dependencies, doc)); }
  }
  assert.match(base.prompt, /hypothetical.*conditional alternative/);
});

test('follow-up history remembers contributing relevance reasons even when that record is later excluded', () => {
  const doc = createDocument('Planning'), target = question(doc, doc.rootId, 'Which service?');
  const prerequisite = question(doc, doc.rootId, 'A prerequisite?', 'User assumption', 'assumption');
  addDependency(doc, target.id, prerequisite.id);
  target.research = { basis: 'reasoning', summary: 'Compare', options: [{ title: 'Pilot', description: 'Small', pros: [], cons: [] }, { title: 'Launch', description: 'Large', pros: [], cons: [] }], recommendation: 'Pilot first', uncertainty: 'Unknown costs', sources: [], claims: [{ id: 'c1', text: 'Start small', basis: 'reasoning', evidence: [], limitations: 'Judgment' }] };
  const first = prepareFollowup(doc, target.id, { question: 'What if our priorities change? 🌿', hypothetical: true });
  const second = prepareFollowup(doc, target.id, { question: 'Continue?', hypothetical: false }, { excluded: [prerequisite.id], history: { id: 'history', exchanges: [], dependencies: first.followupDependencies } });
  assert.ok(sameFollowup(second.followupDependencies, doc, target.id));
  assert.equal(first.followup.hypothetical, true); assert.equal(first.bytes, Buffer.byteLength(first.instructions) + Buffer.byteLength(first.prompt));
  assert.ok(second.coverage.followupTracking.bytes <= 4194304);
  doc.dependencies = [];
  assert.equal(sameFollowup(second.followupDependencies, doc, target.id), false, 'A previously used selection reason changed');
});

test('an unchanged review at a full byte boundary stays current with omitted fallback records', () => {
  const doc = createDocument('Planning');
  question(doc, doc.rootId, 'First unrelated record?', 'x'.repeat(20000), 'tentative');
  question(doc, doc.rootId, 'Second unrelated record?', 'y'.repeat(20000), 'tentative');
  let lower = 0, upper = 131072;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    let fits = false; try { fits = prepareResearch(doc, doc.rootId, { prefix: 'x'.repeat(middle) }).context.decisionsElsewhere.length > 0; } catch {}
    if (fits) lower = middle; else upper = middle - 1;
  }
  const prepared = prepareResearch(doc, doc.rootId, { prefix: 'x'.repeat(lower) });
  assert.equal(prepared.context.decisionsElsewhere.length, 1); assert.equal(prepared.coverage.omitted.budget, 1);
  assert.equal(prepared.bytes, 131072); assert.ok(sameResearchSources(prepared.dependencies, doc));
});

test('omitted-record review is bounded, preserves complete question text and never enters model input', () => {
  const doc = createDocument('Planning'), target = question(doc, doc.rootId, 'Which service?');
  const excluded = [];
  for (let i = 0; i < 100; i++) excluded.push(question(doc, doc.rootId, `Question ${i} ` + '🌿 context '.repeat(45), 'ANSWER_ONLY_CANARY', 'assumption').id);
  const prepared = prepareResearch(doc, target.id, { excluded });
  const sample = prepared.coverage.omissionSample;
  assert.ok(sample); assert.equal(sample.total, 100); assert.ok(sample.entries.length > 0 && sample.entries.length <= 50);
  assert.equal(sample.remaining, sample.total - sample.entries.length); assert.ok(sample.remaining > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(sample)) <= 32768);
  for (const row of sample.entries) {
    assert.equal(row.question, doc.nodes.find(node => node.id === row.id).question); assert.equal(row.reason, 'excluded');
    assert.equal(row.answerState, 'assumption'); assert.ok(!Object.hasOwn(row, 'answer'));
    assert.ok(!prepared.prompt.includes(row.question));
  }
  assert.ok(!JSON.stringify(sample).includes('ANSWER_ONLY_CANARY')); assert.ok(!prepared.prompt.includes('ANSWER_ONLY_CANARY'));
});
