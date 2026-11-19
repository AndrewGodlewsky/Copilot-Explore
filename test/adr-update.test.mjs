import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adrReviewContext, validateAdrReviewContext, adrReviewContextChanges } from '../com.github.copilot/extensions/explorer/adr-review-context.mjs';
import { adrUpdateStatus } from '../com.github.copilot/extensions/explorer/adr-update.mjs';
import { captureAdrSources, validateAdrSources } from '../com.github.copilot/extensions/explorer/adr-sources.mjs';
import { adrFileMarkdown, adrBytesDigest, adrArtifactDigest, validateAdrFile } from '../com.github.copilot/extensions/explorer/adr-file.mjs';
import { prepareAdrScope, captureAdrScope, adrScopeFreshness } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { adrDraftFreshness } from '../com.github.copilot/extensions/explorer/adr-draft.mjs';
import { changeAdrLifecycle, transitionAdrMarkdown } from '../com.github.copilot/extensions/explorer/adr-lifecycle.mjs';
import { addQuestions, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { readSharedDocument, prepareSharedMigration } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';

function fixture() {
  const doc = adrFileDocument(), node = doc.nodes[1];
  const [parent, upstream, other, other2] = addQuestions(doc, doc.rootId, ['Parent', 'Upstream', 'Other', 'Other 2'].map(question => ({ question, category: 'Context' })));
  parent.answer = 'UNSELECTED_PRIVATE_CONTEXT'; parent.answerState = 'decided';
  doc.dependencies = [{ dependentId: node.id, prerequisiteId: parent.id, explanation: 'Required recovery' }, { dependentId: parent.id, prerequisiteId: upstream.id }];
  saveAdrFixture(doc);
  const sources = captureAdrSources(doc), id = randomUUID(), content = adrFileMarkdown(doc.adrDraft, id, null, sources);
  const record = { version: 1, id, path: 'docs/decisions/0001-storage.md', title: doc.adrDraft.title, status: 'proposed', sha256: adrBytesDigest(content), artifactDigest: adrArtifactDigest(doc.adrDraft), readinessDigest: 'a'.repeat(64), writtenAt: new Date().toISOString(), sources, generated: { version: 1, content } };
  return { doc, node, parent, upstream, other, other2, record, content };
}

test('ADR reviewed context is canonical, relevant and contains fingerprints rather than unselected answers', () => {
  const f = fixture(), before = adrReviewContext(f.doc, [f.node.id], false);
  assert.equal(before.edges.length, 2); assert.deepEqual(new Set(before.prerequisites.map(x => x.id)), new Set([f.parent.id, f.upstream.id]));
  assert.doesNotMatch(JSON.stringify(before), /UNSELECTED_PRIVATE_CONTEXT/);
  f.doc.dependencies.reverse(); f.other.answer = 'Unrelated edit';
  f.doc.dependencies.push({ dependentId: f.other.id, prerequisiteId: f.other2.id });
  assert.deepEqual(adrReviewContext(f.doc, [f.node.id], false), before);
  f.upstream.answer = 'Changed prerequisite';
  const changes = adrReviewContextChanges(before, adrReviewContext(f.doc, [f.node.id], false));
  assert.ok(changes.some(x => x.kind === 'prerequisite' && x.id === f.upstream.id));
  assert.deepEqual(validateAdrReviewContext(before, [f.node.id], false), before);
});

test('ADR scope and accepted wording become stale when reviewed dependencies change, and source capture cannot relabel old wording', () => {
  const f = fixture(); assert.ok(f.doc.adrScope.reviewContext); assert.ok(f.record.sources.freshness);
  assert.deepEqual(f.record.sources.freshness.context, f.doc.adrDraft.scope.reviewContext);
  assert.equal(adrScopeFreshness(f.doc.adrScope, f.doc, null), 'current');
  f.doc.dependencies[0].explanation = 'Different dependency';
  assert.equal(adrScopeFreshness(f.doc.adrScope, f.doc, null), 'stale');
  assert.equal(adrDraftFreshness(f.doc.adrDraft, f.doc), 'stale');
  assert.throws(() => captureAdrSources(f.doc), /stale|changed|current/i);
  assert.ok(adrUpdateStatus(f.record, f.doc, null, null).reasons.some(x => x.kind === 'dependency'));
});

test('ADR update status explains selected certainty, missing sources, guidance and prerequisite changes without unrelated false positives', () => {
  const f = fixture(); assert.equal(adrUpdateStatus(f.record, f.doc, null, null).status, 'current');
  f.other.answer = 'Changed'; f.doc.revision++; assert.equal(adrUpdateStatus(f.record, f.doc, null, null).status, 'current');
  const cases = [
    [doc => { doc.nodes[1].answerState = 'tentative'; }, 'certainty'],
    [doc => { doc.nodes.splice(1, 1); }, 'missing'],
    [doc => { doc.objective += ' changed'; }, 'guidance'],
    [doc => { doc.nodes.find(n => n.id === f.parent.id).answer += ' changed'; }, 'prerequisite'],
  ];
  for (const [change, kind] of cases) { const doc = structuredClone(f.doc); change(doc); const status = adrUpdateStatus(f.record, doc, null, null); assert.notEqual(status.status, 'current'); assert.ok(status.reasons.some(x => x.kind === kind), kind); }
});

test('ADR context includes selected stale research only when evidence is explicitly included', () => {
  const f = fixture(), selection = { focalId: f.node.id, nodeIds: [f.node.id], includeEvidence: true };
  const before = adrReviewContext(f.doc, [f.node.id], true), omitted = adrReviewContext(f.doc, [f.node.id], false);
  f.node.researchStale = true;
  assert.ok(adrReviewContextChanges(before, adrReviewContext(f.doc, [f.node.id], true)).some(x => x.kind === 'research-stale'));
  assert.deepEqual(adrReviewContext(f.doc, [f.node.id], false), omitted);
  const scope = captureAdrScope(prepareAdrScope(f.doc, selection, { scenario: null }));
  assert.equal(scope.reviewContext.research[0].stale, true);
});

test('ADR scenario and legacy coverage remain explicit instead of claiming unavailable freshness or baselines', () => {
  const f = fixture();
  assert.equal(adrUpdateStatus(f.record, f.doc, null).coverage.scenario, 'unavailable');
  assert.equal(adrUpdateStatus(f.record, f.doc, null).status, 'unavailable');
  assert.ok(adrUpdateStatus(f.record, f.doc, null, { classification: 'preferred' }).reasons.some(x => x.kind === 'scenario'));
  const legacy = structuredClone(f.record); delete legacy.generated; delete legacy.sources;
  const state = adrUpdateStatus(legacy, f.doc, null, null);
  assert.equal(state.status, 'unavailable'); assert.equal(state.coverage.baseline, 'unavailable'); assert.equal(state.coverage.context, 'unavailable');
  assert.equal(validateAdrFile(legacy).generated, undefined);
});

test('ADR generated baseline survives shared portability and metadata-only lifecycle changes as historical text', () => {
  const f = fixture(); f.doc.adrFiles = [f.record];
  const portable = readSharedDocument(prepareSharedMigration(JSON.stringify(validateDocument(f.doc))).content).document.journey;
  assert.equal(portable.adrFiles[0].generated.content, f.content);
  const accepted = changeAdrLifecycle([f.record], { kind: 'accept', id: f.record.id }, { actor: null, at: new Date().toISOString() })[0];
  const changed = transitionAdrMarkdown(f.content, f.record, accepted);
  assert.notEqual(changed, f.content); assert.equal(accepted.generated.content, f.content);
  assert.deepEqual(validateAdrSources(f.record.sources), f.record.sources);
});

test('ADR baseline and context validators reject malformed identities, unexpected fields and oversized values without clipping', () => {
  const f = fixture(), original = adrReviewContext(f.doc, [f.node.id], false);
  for (const edit of [v => { v.version = 2; }, v => { v.extra = true; }, v => { v.edges.push(v.edges[0]); }, v => { v.prerequisites[0].hash = 'bad'; }, v => { v.research = [{ id: f.node.id, stale: true }]; }, v => { v.edges[0].explanation = 'x'.repeat(1001); }]) {
    const next = structuredClone(original); edit(next); assert.throws(() => validateAdrReviewContext(next, [f.node.id], false));
  }
  for (const generated of [{ version: 2, content: f.content }, { version: 1, content: 'unmanaged' }, { version: 1, content: '\ud800' }, { version: 1, content: 'x'.repeat(65537) }, { version: 1, content: f.content, extra: true }]) assert.throws(() => validateAdrFile({ ...f.record, generated }));
  const large = structuredClone(original); large.edges = Array.from({ length: 100 }, (_, i) => ({ dependentId: f.node.id, prerequisiteId: `source-${String(i).padStart(3, '0')}`, explanation: 'x'.repeat(1000) }));
  assert.throws(() => validateAdrReviewContext(large, [f.node.id], false), /limit|invalid/i);
});
