import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateContributor, validateContributionEvent, validateNodeAttribution, validateArtifactAcceptance, nodeAttributionDigest, artifactAcceptanceDigest, attributeContributions, contributionStatus } from '../com.github.copilot/extensions/explorer/contributors.mjs';
import { createDocument, addQuestions, validateDocument, importedDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { readSharedDocument, validateSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { mergeSharedDocuments } from '../com.github.copilot/extensions/explorer/semantic-merge.mjs';
import { buildScenario } from '../com.github.copilot/extensions/explorer/scenario-fork.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { prepareBrief, parseBrief, acceptBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareHandoff, parseHandoff, acceptHandoff } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';
import { saveAdrFixture } from './helpers/adr-file.mjs';
import { adrReadiness, captureAdrReadiness } from '../com.github.copilot/extensions/explorer/adr-readiness.mjs';

const alice = { id: randomUUID(), displayName: 'Alice λ <script>' }, bob = { id: randomUUID(), displayName: 'Bob 日本語' };
const firstAt = '2026-11-18T10:00:00.000Z', secondAt = '2026-11-18T11:00:00.000Z';
const event = (actor = alice, at = firstAt) => ({ actor, at });
const shared = doc => { const { format, version, revision, ...journey } = doc; return { format: 'copilot-explorer-shared', version: 1, journey, extensions: {} }; };
function fixture() { const doc = createDocument('Contributor fixture'); addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Decision' }, { question: 'When?', category: 'Scope' }]); return doc; }
function answer(doc, id, text, actor = alice, at = firstAt) { const next = structuredClone(doc); next.nodes.find(n => n.id === id).answer = text; next.nodes.find(n => n.id === id).answerState = 'decided'; return attributeContributions(doc, next, { kind: 'answer', id }, actor, at); }

test('contributor snapshots and events accept literal Unicode and reject hidden or malformed identity fields', () => {
  assert.deepEqual(validateContributor(alice), alice); assert.deepEqual(validateContributionEvent(event(null)), event(null));
  for (const value of [{ ...alice, email: 'private@example.com' }, { ...alice, sessionId: 'secret' }, { ...alice, id: 'account-name' }, { ...alice, displayName: '' }, { ...alice, displayName: ' x ' }, { ...alice, displayName: 'x'.repeat(97) }, { ...alice, displayName: '\ud800' }, { ...alice, displayName: 'Name\nOther' }, { ...alice, displayName: 'Name\u202eOther' }]) assert.throws(() => validateContributor(value));
  for (const value of [null, { ...event(), path: 'C:/private' }, event(alice, 'not a date'), event(alice, '2026-02-31T10:00:00.000Z')]) assert.throws(() => validateContributionEvent(value));
});

test('editing a legacy answer keeps its original author unknown and does not mutate the caller or descendants', () => {
  const before = fixture(), id = before.nodes[1].id; before.nodes[1].answer = 'Legacy answer'; const next = structuredClone(before); next.nodes[1].answer = 'Correction'; next.nodes[2].review = true;
  const original = structuredClone(next), result = attributeContributions(before, next, { kind: 'answer', id }, alice, firstAt), record = result.nodes[1].attribution.answer;
  assert.deepEqual(next, original); assert.equal(before.nodes[1].attribution, undefined); assert.equal(record.author, null); assert.equal(record.origin, 'unknown'); assert.deepEqual(record.editor, event()); assert.equal(record.accepted, null); assert.equal(result.nodes[2].attribution, undefined);
  assert.equal(contributionStatus(result).nodes[id].answer, 'current');
  assert.deepEqual(attributeContributions(result, result, { kind: 'answer', id }, bob, secondAt), result);
});

test('acknowledging review on an unanswered legacy node records an editor without inventing an answer author', () => {
  const before = fixture(); before.nodes[1].review = true; const next = structuredClone(before); next.nodes[1].review = false;
  const result = attributeContributions(before, next, { kind: 'answer', id: next.nodes[1].id }, alice, firstAt);
  assert.equal(result.nodes[1].attribution.answer.origin, 'unknown');
  assert.equal(result.nodes[1].attribution.answer.author, null);
  assert.deepEqual(result.nodes[1].attribution.answer.editor, event());
});

test('new answers retain their first contributor while future rename, edits and anonymous changes keep historical snapshots', () => {
  const doc = fixture(), id = doc.nodes[1].id, first = answer(doc, id, 'A');
  assert.deepEqual(first.nodes[1].attribution.answer.author, event()); assert.equal(first.nodes[1].attribution.answer.origin, 'user');
  const second = answer(first, id, 'B', bob, secondAt); assert.deepEqual(second.nodes[1].attribution.answer.author, event()); assert.deepEqual(second.nodes[1].attribution.answer.editor, event(bob, secondAt));
  const renamed = answer(second, id, 'C', { ...alice, displayName: 'Alice renamed' }, secondAt); assert.equal(renamed.nodes[1].attribution.answer.author.actor.displayName, alice.displayName);
  const anonymous = answer(renamed, id, 'D', null, secondAt); assert.deepEqual(anonymous.nodes[1].attribution.answer.editor, event(null, secondAt)); assert.deepEqual(first.nodes[1].attribution.answer.author, event());
});

test('new manual and AI questions distinguish authorship, adjusted wording and explicit acceptance', () => {
  const before = fixture(), manual = structuredClone(before), [m] = addQuestions(manual, manual.rootId, [{ question: 'Manual λ?', category: 'Manual' }]);
  const written = attributeContributions(before, manual, { kind: 'new-nodes', ids: [m.id], origin: 'user' }, alice, firstAt);
  assert.deepEqual(written.nodes.at(-1).attribution.question.author, event()); assert.equal(written.nodes.at(-1).attribution.question.accepted, null);
  const ai = structuredClone(before), [q] = addQuestions(ai, ai.rootId, [{ question: 'Edited AI question?', category: 'AI' }]); q.generation = { requestId: 'fixture', originalQuestion: 'Original AI question?', originalCategory: 'AI', adjusted: true };
  const accepted = attributeContributions(before, ai, { kind: 'new-nodes', ids: [q.id], origin: 'ai' }, bob, secondAt), record = accepted.nodes.at(-1).attribution.question;
  assert.equal(record.origin, 'ai'); assert.equal(record.author, null); assert.deepEqual(record.accepted, event(bob, secondAt)); assert.deepEqual(record.editor, event(bob, secondAt)); assert.equal(accepted.nodes.at(-1).attribution.answer, undefined); validateDocument(accepted);
  assert.throws(() => attributeContributions(before, before, { kind: 'new-nodes', ids: [before.nodes[1].id], origin: 'user' }, alice, firstAt));
});

test('attribution schemas remain strict and changed unrecorded text shows historical rather than current contributor', () => {
  const original = fixture(), id = original.nodes[1].id, doc = answer(original, id, 'A'), record = doc.nodes[1].attribution;
  assert.deepEqual(validateNodeAttribution(record), record);
  for (const value of [{ ...record, private: true }, { version: 1 }, { ...record, answer: { ...record.answer, contentDigest: 'invalid' } }, { ...record, answer: { ...record.answer, origin: 'ai' } }, { ...record, answer: { ...record.answer, extra: true } }]) assert.throws(() => validateNodeAttribution(value));
  const edited = structuredClone(doc); edited.nodes[1].answer = 'Changed outside Explorer'; validateDocument(edited);
  assert.equal(contributionStatus(edited).nodes[id].answer, 'historical'); assert.deepEqual(edited.nodes[1].attribution, record);
  assert.equal(nodeAttributionDigest({ ...doc.nodes[1], id: 'remapped' }, 'answer'), record.answer.contentDigest);
});

test('accepted synthesized artifacts record acceptance separately and bind it to the complete artifact', () => {
  const doc = fixture(); doc.nodes[1].answer = 'A'; saveAdrFixture(doc);
  const raw = { goal: [{ id: 'g', text: 'A suggested goal', certainty: 'uncertain', sources: [{ kind: 'node', id: doc.nodes[1].id }] }], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] };
  doc.brief = acceptBrief(parseBrief(JSON.stringify(raw), prepareBrief(doc)), []);
  doc.handoff = acceptHandoff(parseHandoff(JSON.stringify(raw), prepareHandoff(doc, { format: 'tasks', nodeIds: [doc.nodes[1].id], includeEvidence: false })), []);
  for (const field of ['brief', 'handoff', 'adrDraft']) {
    const before = structuredClone(doc); delete before[field]; const next = attributeContributions(before, doc, { kind: 'artifact', field }, bob, secondAt), acceptance = next[field].acceptance;
    assert.deepEqual(validateArtifactAcceptance(acceptance), acceptance); assert.deepEqual(acceptance.actor, bob); assert.equal(acceptance.at, secondAt); assert.equal(acceptance.contentDigest, artifactAcceptanceDigest(next[field]));
    validateDocument(next); assert.equal(contributionStatus(next).artifacts[field], 'current'); assert.equal(doc[field].acceptance, undefined);
    const roundtrip = readSharedDocument(JSON.stringify(shared(next))).document.journey;
    assert.equal(contributionStatus(roundtrip).artifacts[field], 'current'); assert.deepEqual(roundtrip[field].acceptance, acceptance);
    const changed = structuredClone(next); Object.values(changed[field].sections).flat()[0].text += ' externally changed'; validateDocument(changed);
    assert.equal(contributionStatus(changed).artifacts[field], 'historical'); assert.throws(() => validateArtifactAcceptance({ ...acceptance, email: 'secret' }));
  }
});

test('recording an ADR accepter preserves the content readiness check and optional acknowledgments', () => {
  const doc = fixture(); doc.nodes[1].answer = 'A'; saveAdrFixture(doc);
  const report = adrReadiness(doc.adrDraft, doc, null), gap = report.items.find(item => item.severity === 'advisory').id;
  doc.adrDraft.readiness = captureAdrReadiness(report, { digest: report.digest, acknowledged: [gap] });
  const before = structuredClone(doc); delete before.adrDraft; const attributed = attributeContributions(before, doc, { kind: 'artifact', field: 'adrDraft' }, alice, firstAt);
  const current = adrReadiness(attributed.adrDraft, attributed, null); assert.equal(current.digest, report.digest); assert.deepEqual(current.acknowledged, [gap]);
});

test('legacy/shared/imported documents preserve optional absence and literal contributor snapshots', () => {
  const legacy = fixture(); assert.deepEqual(validateDocument(legacy), legacy); assert.equal(JSON.stringify(readSharedDocument(JSON.stringify(shared(legacy))).document).includes('attribution'), false);
  const doc = answer(legacy, legacy.nodes[1].id, 'A'); const converted = readSharedDocument(JSON.stringify(shared(doc))).document;
  validateSharedDocument(converted); assert.deepEqual(converted.journey.nodes[1].attribution, doc.nodes[1].attribution); assert.deepEqual(importedDocument(doc).nodes[1].attribution, doc.nodes[1].attribution);
  assert.deepEqual(contributionStatus(legacy), { nodes: {}, artifacts: {} });
});

test('two contributors survive semantic merge without separating provenance from selected node text', () => {
  const original = fixture(), [a, b] = original.nodes.slice(1), left = answer(original, a.id, 'Alice choice'), right = answer(original, b.id, 'Bob choice', bob, secondAt);
  const merged = mergeSharedDocuments(shared(original), shared(left), shared(right)); assert.equal(merged.unresolved.length, 0);
  assert.deepEqual(merged.document.journey.nodes.find(n => n.id === a.id).attribution.answer.author.actor, alice); assert.deepEqual(merged.document.journey.nodes.find(n => n.id === b.id).attribution.answer.author.actor, bob);
  const conflict = answer(original, a.id, 'Other choice', bob, secondAt), selected = mergeSharedDocuments(shared(original), shared(left), shared(conflict), { [`node:${a.id}`]: 'incoming' });
  assert.equal(selected.document.journey.nodes.find(n => n.id === a.id).answer, 'Other choice'); assert.deepEqual(selected.document.journey.nodes.find(n => n.id === a.id).attribution.answer.author.actor, bob);
});

test('scenario forks retain copied attribution and mark the changed alternative attribution historical', () => {
  const legacy = fixture(), id = legacy.nodes[1].id; let doc = answer(legacy, id, 'A');
  const addition = structuredClone(doc), [child] = addQuestions(addition, id, [{ question: 'Child?', category: 'Detail' }]); doc = attributeContributions(doc, addition, { kind: 'new-nodes', ids: [child.id], origin: 'user' }, alice, firstAt); doc = answer(doc, child.id, 'Child answer', bob, secondAt);
  const fork = buildScenario(doc, { nodeId: child.id, answer: 'Alternative', answerState: 'tentative' }, secondAt).document, copied = fork.nodes[1], alternative = fork.nodes[2];
  assert.deepEqual(copied.attribution, doc.nodes[1].attribution); assert.deepEqual(alternative.attribution, doc.nodes.at(-1).attribution);
  const status = contributionStatus(fork); assert.equal(status.nodes[copied.id].answer, 'current'); assert.equal(status.nodes[alternative.id].question, 'current'); assert.equal(status.nodes[alternative.id].answer, 'historical');
});

test('history preserves old contributor snapshots through later edits', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'contributor-history-')), file = join(dir, 'map.explore.json'), legacy = fixture(), id = legacy.nodes[1].id, original = answer(legacy, id, 'A'); await writeFile(file, JSON.stringify(original));
  const e = await new Explorer({ file }).load(); t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  await e.save(answer(e.doc, id, 'B', bob, secondAt)); const prior = await e.readHistory(e.doc.id, original.revision);
  assert.deepEqual(prior.document.nodes[1].attribution.answer.author.actor, alice); assert.equal(prior.document.nodes[1].attribution.answer.editor, null); assert.deepEqual(e.doc.nodes[1].attribution.answer.editor.actor, bob);
});
