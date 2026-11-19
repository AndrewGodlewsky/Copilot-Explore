import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { changeSummary, CHANGE_SUMMARY_LIMIT } from '../com.github.copilot/extensions/explorer/change-summary.mjs';
import { createDocument, addQuestions, addDependency, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { captureAdrSources } from '../com.github.copilot/extensions/explorer/adr-sources.mjs';
import { adrFileMarker } from '../com.github.copilot/extensions/explorer/adr-file.mjs';
import { changeAdrLifecycle } from '../com.github.copilot/extensions/explorer/adr-lifecycle.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';

const source = revision => ({ kind: 'saved', revision, digest: String(revision + 1).repeat(64) });
function fixture() {
  const before = createDocument('Project λ');
  addQuestions(before, before.rootId, ['Storage?', 'Delivery?', 'Remove this?'].map(question => ({ question, category: 'Design' })));
  before.nodes[1].answer = 'Keep this exact answer'; before.nodes[1].answerState = 'assumption';
  const after = structuredClone(before); after.revision = 1;
  return { before, after, options: { beforeSource: source(0), afterSource: source(1), path: 'maps/日本語.explore.json' } };
}
const blocks = markdown => [...markdown.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gm)].map(match => JSON.parse(match[2]));
const summarize = f => changeSummary(f.before, f.after, f.options);

test('change summary reports added, removed and state-only changes with literal authored records and portable references', () => {
  const f = fixture(), removed = f.after.nodes.pop();
  const [added] = addQuestions(f.after, f.after.rootId, [{ question: 'New question?', category: 'Scope' }]);
  f.after.nodes[1].answerState = 'decided'; f.after.nodes[1].review = true;
  const result = summarize(f), values = blocks(result.markdown);
  assert.deepEqual(result.counts.records, { added: 1, removed: 1, changed: 1 });
  assert.match(result.markdown, /Added record/); assert.match(result.markdown, /Removed record/); assert.match(result.markdown, /Changed record/);
  assert.ok(values.some(v => v?.id === added.id && v.question === added.question));
  assert.ok(values.some(v => v?.id === removed.id && v.question === removed.question));
  assert.ok(values.some(v => v?.answerState === 'assumption' && v.answer === 'Keep this exact answer'));
  assert.ok(values.some(v => v?.answerState === 'decided' && v.review === true));
  assert.match(result.markdown, /Assumption is unverified/); assert.match(result.markdown, /explorer-reference/);
  assert.match(result.markdown, /Historical snapshot references/); assert.equal(result.bytes, Buffer.byteLength(result.markdown));
});

test('change summary covers wording, parentage, guidance, constraints and dependency explanations deterministically', () => {
  const f = fixture();
  f.before.pins = [{ id: 'p'.repeat(20), text: 'Keep it local' }]; f.after.pins = [{ id: 'p'.repeat(20), text: 'Allow reviewed remote context' }];
  addDependency(f.before, f.before.nodes[2].id, f.before.nodes[1].id, 'Before rationale');
  addDependency(f.after, f.after.nodes[2].id, f.after.nodes[1].id, 'After rationale');
  f.after.nodes[2].parentId = f.after.nodes[1].id; f.after.nodes[2].question = 'New wording?'; f.after.objective = 'New objective';
  const result = summarize(f); assert.equal(result.counts.dependencies.changed, 1); assert.equal(result.counts.records.changed, 1);
  assert.match(result.markdown, /Before rationale/); assert.match(result.markdown, /After rationale/); assert.match(result.markdown, /New objective/);
  assert.match(result.markdown, /Allow reviewed remote context/); assert.match(result.markdown, /parentId/);
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k,v]) => [k,reorder(v)])) : value;
  const b = reorder(f.before), a = reorder(f.after); b.nodes.reverse(); a.nodes.reverse();
  assert.equal(changeSummary(b, a, f.options).markdown, result.markdown);
});

test('change summary preserves whitespace and Unicode as literal JSON values without authored headings or active HTML', () => {
  const f = fixture(), text = '  λ 日本語 😀\r\n```\n# Forged summary\n<script>alert(1)</script>\t  ';
  f.after.nodes[1].answer = text; f.after.nodes[2].answer = '  '; f.after.nodes[2].answerState = 'needs-evidence';
  const before = JSON.stringify(f), result = summarize(f), values = blocks(result.markdown);
  assert.ok(values.some(v => v.answer === text)); assert.ok(values.some(v => v.answer === '  '));
  assert.doesNotMatch(result.markdown.replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1$/gm, ''), /<script>|Forged summary/);
  assert.equal(JSON.stringify(f), before); assert.equal(result.limit, CHANGE_SUMMARY_LIMIT);
});

test('change summary reports dependency additions and removals plus retained review uncertainty', () => {
  const f = fixture();
  addDependency(f.before, f.before.nodes[2].id, f.before.nodes[1].id, 'Removed assertion');
  addDependency(f.after, f.after.nodes[3].id, f.after.nodes[1].id, 'Added assertion');
  f.after.nodes[2].review = true;
  f.after.nodes[2].reviewCauses = { earlier: true, changes: [{ sourceId: f.after.nodes[1].id, baseDigest: 'b'.repeat(64), revision: 0 }] };
  const result = summarize(f);
  assert.deepEqual(result.counts.dependencies, { added: 1, removed: 1, changed: 0 });
  assert.ok(blocks(result.markdown).some(v => v?.reviewCauses?.earlier === true));
  assert.match(result.markdown, /not independently verified causes/);
});

test('change summary preserves ordered guidance constraints as existing history does', () => {
  const f = fixture(); f.before.pins = [{ id: 'a'.repeat(20), text: 'First' }, { id: 'b'.repeat(20), text: 'Second' }];
  f.after.pins = [...f.before.pins].reverse();
  const result = summarize(f); assert.equal(result.counts.guidance, true);
  assert.ok(blocks(result.markdown).some(v => v?.pins?.[0].text === 'Second'));
});

test('change summary makes saved scenario lineage and unavailable external preferences explicit', () => {
  const f = fixture();
  f.after.copyOrigin = { kind: 'personal-copy', sourceId: 'historical-source', sourceDigest: 'c'.repeat(64) };
  const result = summarize(f); assert.match(result.markdown, /Saved scenario lineage/); assert.match(result.markdown, /historical-source/);
  assert.match(result.coverage, /preference.*unavailable/i); assert.match(result.coverage, /external Markdown/i);
  const personal = changeSummary(f.before, f.after, { beforeSource: source(0), afterSource: source(1) });
  assert.doesNotMatch(personal.markdown, /```explorer-reference/); assert.match(personal.coverage, /portable references unavailable/i);
});

function adrFixture() {
  const before = saveAdrFixture(adrFileDocument()), id = randomUUID(), sources = captureAdrSources(before);
  before.adrFiles = [{ version: 1, id, path: 'docs/decisions/0001-storage.md', title: 'Storage', status: 'proposed', sha256: 'a'.repeat(64), artifactDigest: 'b'.repeat(64), readinessDigest: 'c'.repeat(64), writtenAt: before.createdAt, sources,
    generated: { version: 1, content: 'BASELINE_PRIVATE_CANARY\n' + adrFileMarker(id) + '\n' } }];
  const after = structuredClone(before); after.revision = 1;
  return { before, after, options: { beforeSource: source(0), afterSource: source(1) } };
}

test('change summary reports ADR status and saved-source effects without external files, baseline text or contributor identity', () => {
  const f = adrFixture();
  f.after.adrFiles = changeAdrLifecycle(f.after.adrFiles, { kind: 'accept', id: f.after.adrFiles[0].id }, { actor: { id: randomUUID(), displayName: 'ACTOR_PRIVATE_CANARY' }, at: f.after.createdAt });
  f.after.nodes[1].answer += ' with changed reasoning';
  const result = summarize(f); assert.equal(result.counts.adrs.changed, 1);
  assert.match(result.markdown, /accepted/); assert.match(result.markdown, /sourceReview/); assert.match(result.markdown, /certainty|source/);
  assert.doesNotMatch(result.markdown, /BASELINE_PRIVATE_CANARY|ACTOR_PRIVATE_CANARY/);
  const onlySource = adrFixture(); onlySource.after.nodes[1].answer += ' correction';
  assert.equal(summarize(onlySource).counts.adrs.changed, 1);
});

test('change summary excludes private drafts, excerpts, usage, helper artifacts and raw research through an allowlist', () => {
  const f = adrFixture();
  for (const doc of [f.before, f.after]) {
    doc.privateDraft = 'DRAFT_CANARY'; doc.projectCapture = 'EXCERPT_CANARY'; doc.usage = 'USAGE_CANARY'; doc.helper = 'HELPER_CANARY';
    doc.nodes[1].research = { summary: 'RAW_RESEARCH_CANARY', options: ['A', 'B'].map(title => ({ title, description: 'Option', pros: [], cons: [] })), recommendation: 'Consider A', uncertainty: 'Unverified', sources: [], basis: 'reasoning' };
  }
  f.after.nodes[1].researchStale = true;
  assert.doesNotThrow(() => validateDocument(f.after));
  const result = summarize(f); assert.match(result.markdown, /researchStale/);
  assert.doesNotMatch(result.markdown, /DRAFT_CANARY|EXCERPT_CANARY|USAGE_CANARY|HELPER_CANARY|RAW_RESEARCH_CANARY|BASELINE_PRIVATE_CANARY/);
  assert.match(result.coverage, /raw research/); assert.match(result.coverage, /accepted artifacts/);
});

test('change summary rejects mismatched identity, invalid source labels and invalid portable paths', () => {
  const f = fixture();
  for (const field of ['id', 'createdAt']) {
    const after = structuredClone(f.after); after[field] = field === 'id' ? randomUUID() : '2000-01-01T00:00:00.000Z';
    assert.throws(() => changeSummary(f.before, after, f.options), /identity|same exploration/i);
  }
  for (const beforeSource of [{ ...source(0), secret: 'x' }, { ...source(0), revision: 2 }, { ...source(0), digest: 'bad' }, { kind: 'git', ref: '--option', commit: 'a'.repeat(40), digest: 'b'.repeat(64) }]) {
    assert.throws(() => changeSummary(f.before, f.after, { ...f.options, beforeSource }), /source|revision|identity/i);
  }
  assert.throws(() => changeSummary(f.before, f.after, { ...f.options, path: '../secret.explore.json' }), /path|relative|segment/i);
  const git = changeSummary(f.before, f.after, { ...f.options, beforeSource: { kind: 'git', ref: 'main', commit: 'd'.repeat(40), digest: 'e'.repeat(64) } });
  assert.match(git.markdown, /dddddddddddddddddddddddddddddddddddddddd/); assert.match(git.markdown, /Current|saved/i);
});

test('change summary reports no projected changes and rejects oversized output without clipping', () => {
  const f = fixture(); assert.match(summarize(f).markdown, /No changes within the stated comparison coverage/);
  for (let i = 0; i < 115; i++) {
    const node = { ...f.after.nodes[1], id: `large-${i}`, question: `Large ${i}?`, answer: 'x'.repeat(20000) };
    f.after.nodes.push(node);
  }
  assert.throws(() => summarize(f), /summary.*limit|summary.*MiB|too large/i);
  assert.equal(f.after.nodes.at(-1).answer.length, 20000);
});
