import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { captureAdrSources, validateAdrSources, adrSourcesStatus, adrSourcesMarkdown } from '../com.github.copilot/extensions/explorer/adr-sources.mjs';
import { adrFileMarkdown, validateAdrFile, adrArtifactDigest } from '../com.github.copilot/extensions/explorer/adr-file.mjs';
import { createDocument, addQuestions, addDirection, validateDocument, importedDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { captureAdrScope, prepareAdrScope } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { prepareAdrDraft, parseAdrDraft, acceptAdrDraft } from '../com.github.copilot/extensions/explorer/adr-draft.mjs';
import { defaultAdrFormat } from '../com.github.copilot/extensions/explorer/adr-format.mjs';
import { readSharedDocument, prepareSharedMigration } from '../com.github.copilot/extensions/explorer/shared-document.mjs';

const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const sign = value => { const { digest, ...rest } = value; return { ...rest, digest: hash(rest) }; };
const path = '.explorer/journeys/choice-λ.explore.json', location = { journeyPath: path, adrPath: 'nested/docs/decisions/0001-choice.md', commit: 'a'.repeat(40) }, time = '2026-11-18T22:00:00.000Z';
function fixture(includeEvidence = true) {
  const doc = createDocument('Storage 🌱', { objective: 'Recover exactly', successCriteria: 'No lost answers' });
  const [node, omitted] = addQuestions(doc, doc.rootId, [{ question: 'Which storage λ?', category: 'Choice' }, { question: 'OMITTED_CANARY', category: 'Other' }]);
  node.answer = 'A because recovery is faster.\nKeep this original answer.'; node.answerState = 'decided';
  node.research = { basis: 'sources', summary: 'SUMMARY_CANARY', options: [{ title: 'A', description: 'A', pros: [], cons: [] }, { title: 'B', description: 'B', pros: [], cons: [] }], recommendation: 'RECOMMENDATION_CANARY', uncertainty: 'Not verified', sources: [{ id: 's1', title: 'Original source', url: 'https://example.com/original', retrievedAt: time, provenance: 'recorded-read' }], claims: [{ id: 'c1', text: 'Recorded interpretation', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Original support' }], limitations: 'Small sample; not independently verified' }] };
  const refresh = (ids = [node.id]) => {
    doc.adrFormat = defaultAdrFormat(); doc.adrScope = captureAdrScope(prepareAdrScope(doc, { focalId: node.id, nodeIds: ids, includeEvidence }, { scenario: null }));
    const prepared = prepareAdrDraft(doc, { scenario: null }), raw = { title: 'Storage choice', status: 'proposed', sections: { context: [{ id: 'goal', text: 'Recover exactly', certainty: 'user-statement', sources: [{ kind: 'guidance', field: 'objective' }] }], drivers: [], alternatives: [], outcome: [{ id: 'choice', text: 'Choose A', certainty: 'user-decision', sources: [{ kind: 'node', id: node.id }] }], consequences: includeEvidence ? [{ id: 'evidence', text: 'Recorded interpretation has limits', certainty: 'uncertain', sources: [{ kind: 'evidence', nodeId: node.id, sourceId: 's1' }] }] : [], confirmation: [], optionDetails: [] } };
    doc.adrDraft = acceptAdrDraft(parseAdrDraft(JSON.stringify(raw), prepared), { title: raw.title, statements: [] });
  };
  refresh(); return { doc, node, omitted, refresh, capture: () => captureAdrSources(doc, location, time) };
}

test('ADR source capture retains selected saved answers, guidance, evidence and mappings without private or unselected inputs', () => {
  const f = fixture(); f.doc.privateDraft = 'PRIVATE_CANARY'; f.doc.projectCapture = 'PROJECT_CANARY'; f.doc.sessionBinding = 'SESSION_CANARY';
  const before = structuredClone(f.doc), capture = f.capture();
  assert.equal(capture.journey.path, path); assert.equal(capture.adrPath, location.adrPath); assert.equal(capture.journey.commit, location.commit);
  assert.equal(capture.nodes[0].record.answer, f.node.answer); assert.equal(capture.nodes[0].record.answerState, 'decided');
  assert.equal(capture.guidance.objective, 'Recover exactly'); assert.equal(capture.evidence[0].claims[0].limitations, 'Small sample; not independently verified');
  assert.deepEqual(capture.statements.find(s => s.id === 'evidence').sources, f.doc.adrDraft.sections.consequences[0].sources);
  assert.equal(capture.references[0].nodeId, f.node.id); assert.match(capture.nodes[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(capture), /CANARY/); assert.deepEqual(f.doc, before); assert.deepEqual(validateAdrSources(capture), capture);
});

test('source fingerprints remain historical while current status separates edited decisions, evidence, guidance and deleted nodes', () => {
  const f = fixture(), capture = f.capture(), before = structuredClone(capture);
  assert.equal(adrSourcesStatus(capture, f.doc, path).status, 'current');
  for (const change of [doc => { doc.nodes[1].answer += ' changed'; }, doc => { doc.nodes[1].research.claims[0].limitations = 'Changed limitation'; }, doc => { doc.objective = 'Different objective'; }, doc => { doc.nodes[1].category = 'Other'; }]) {
    const doc = structuredClone(f.doc); change(doc); assert.equal(adrSourcesStatus(capture, doc, path).status, 'changed');
  }
  const removed = structuredClone(f.doc); removed.nodes.splice(1, 1);
  assert.equal(adrSourcesStatus(capture, removed, path).nodes[0].status, 'missing');
  assert.equal(adrSourcesStatus(capture, { ...f.doc, id: 'different' }, path).status, 'unavailable');
  assert.equal(adrSourcesStatus(capture, f.doc, 'moved.explore.json').status, 'unavailable');
  const later = structuredClone(f.doc); delete later.adrDraft; later.revision += 5;
  assert.equal(adrSourcesStatus(capture, later, path).status, 'current'); assert.deepEqual(capture, before);
});

test('Personal source captures and omitted research stay explicit without fabricated paths or Git revision', () => {
  const f = fixture(false), capture = captureAdrSources(f.doc, {}, time);
  assert.equal(capture.journey.path, null); assert.equal(capture.journey.commit, null); assert.equal(capture.adrPath, null); assert.deepEqual(capture.references, []); assert.deepEqual(capture.evidence, []);
  f.node.research.claims[0].text = 'Unselected evidence changed'; assert.equal(adrSourcesStatus(capture, f.doc).status, 'current');
  const text = adrSourcesMarkdown(capture, randomUUID()); assert.match(text, /Personal|portable.*unavailable/i); assert.match(text, /research.*omitted|evidence.*omitted/i);
  assert.throws(() => captureAdrSources(f.doc, { commit: location.commit }, time));
});

test('capturing stale or missing accepted wording fails and direction sources retain their user origin', () => {
  const f = fixture(false); f.node.answer = 'Changed after acceptance'; assert.throws(f.capture, /current|changed|stale/i); f.refresh();
  const direction = addDirection(f.doc, f.node.id, 'Consider a separate recovery service');
  f.refresh([f.node.id, direction.id]); const capture = f.capture();
  assert.equal(capture.nodes[1].record.kind, 'direction'); assert.equal(capture.nodes[1].record.origin, 'user'); assert.equal(capture.nodes[1].record.answer, '');
  delete f.doc.adrDraft; assert.throws(f.capture, /draft|accepted|wording/i);
});

test('source validation rejects invalid shapes, locations, references, hashes and unsupported Unicode even with a recalculated outer checksum', () => {
  const original = fixture().capture();
  const edits = [v => { v.version = 2; }, v => { v.extra = 'hidden'; }, v => { v.journey.path = '../outside.explore.json'; }, v => { v.adrPath = 'C:/secret.md'; }, v => { v.journey.commit = 'HEAD'; }, v => { v.journey.path = null; }, v => { v.nodes = []; }, v => { v.nodes.push(v.nodes[0]); }, v => { v.nodes[0].record.question = '\ud800'; }, v => { v.nodes[0].record.privateDraft = 'bad'; }, v => { v.nodes[0].fingerprint = 'b'.repeat(64); }, v => { v.references = []; }, v => { v.references[0].journeyId = 'different'; }, v => { delete v.references[0].fingerprint; }, v => { v.statements[0].sources = [{ kind: 'node', id: 'missing' }]; }, v => { v.statements[0].sources = [{ kind: 'evidence', nodeId: v.nodes[0].record.id, sourceId: 'absent' }]; }, v => { v.evidence[0].sources[0].url = 'file:///secret'; }, v => { v.capturedAt = 'invalid'; }];
  for (const edit of edits) { const next = structuredClone(original); edit(next); assert.throws(() => validateAdrSources(sign(next))); }
  assert.throws(() => validateAdrSources({ ...original, digest: 'b'.repeat(64) }));
  assert.throws(() => captureAdrSources(fixture().doc, { ...location, ignored: 'bad' }, time));
});

test('captured source bounds reject excessive selected answer data without clipping', () => {
  const f = fixture(false), extra = addQuestions(f.doc, f.doc.rootId, Array.from({ length: 3 }, (_, i) => ({ question: `Large answer ${i}`, category: 'Scope' })));
  for (const node of [f.node, ...extra]) { node.answer = 'x'.repeat(17000); node.answerState = 'decided'; }
  f.refresh([f.node.id, ...extra.map(n => n.id)]); assert.throws(f.capture, /64 KiB|source.*limit/i);
});

test('ADR Markdown exposes the same immutable capture with literal answers, research limitations and portable references before its managed marker', () => {
  const f = fixture(); f.node.answer = 'Exact λ\n<script> [run](file:///secret) `quoted`'; f.refresh(); const capture = f.capture(), id = randomUUID();
  const content = adrFileMarkdown(f.doc.adrDraft, id, null, capture), plain = content.replaceAll('\\', '');
  assert.ok(plain.includes(f.node.answer)); assert.ok(content.includes(capture.digest)); assert.ok(content.includes(id)); assert.match(content, /explorer-reference/);
  assert.match(plain, /https:\/\/example.com\/original/); assert.match(plain, /Small sample; not independently verified/);
  assert.match(content, /captured|historical/i); assert.doesNotMatch(content, /<script>|\]\(file:/); assert.ok(content.endsWith(`<!-- copilot-explorer-adr:v1:${id}:proposed -->\n`));
  assert.match(plain.split('## Captured exploration sources')[0], /source mapping: choice/);
});

test('source associations survive shared canonical serialization and imports while legacy records stay valid', () => {
  const f = fixture(), sources = f.capture(), id = randomUUID(), content = adrFileMarkdown(f.doc.adrDraft, id, null, sources);
  const legacy = { version: 1, id, path: 'docs/decisions/0001-choice.md', title: f.doc.adrDraft.title, status: 'proposed', sha256: createHash('sha256').update(content).digest('hex'), artifactDigest: adrArtifactDigest(f.doc.adrDraft), readinessDigest: 'b'.repeat(64), writtenAt: time };
  assert.deepEqual(validateAdrFile(legacy), legacy); f.doc.adrFiles = [{ ...legacy, sources }];
  const doc = validateDocument(f.doc), shared = readSharedDocument(prepareSharedMigration(JSON.stringify(doc)).content).document.journey;
  assert.deepEqual(shared.adrFiles[0].sources, sources); assert.equal(adrSourcesStatus(shared.adrFiles[0].sources, shared, path).status, 'current');
  assert.deepEqual(importedDocument(doc).adrFiles[0].sources, sources);
  const reversed = v => Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reversed(v[k])])) : v;
  assert.deepEqual(validateAdrSources(reversed(sources)), sources);
});
