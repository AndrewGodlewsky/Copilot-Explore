import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateDocument, MAX_DOCUMENT_BYTES } from '../com.github.copilot/extensions/explorer/model.mjs';
import { readSharedDocument, prepareSharedWrite, prepareSharedMigration } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { prepareBrief, parseBrief, acceptBrief, briefFreshness } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareHandoff, parseHandoff, acceptHandoff, handoffFreshness } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';

const date = '2026-11-18T12:00:00.000Z';
function personal() {
  return { format: 'copilot-explorer', version: 1, id: 'journey', revision: 7,
    topic: 'A choice', createdAt: date, updatedAt: date, finishedAt: null, rootId: 'root',
    nodes: [
      { id: 'root', parentId: null, question: 'A choice', category: 'Idea', answer: '', research: null, review: false },
      { id: 'q1', parentId: 'root', question: '  Which option?  ', category: ' Scope ', answer: '  Cafe\u0301 🌿\r\n第一\t choice  ', answerState: 'tentative', research: null, review: false },
      { id: 'q2', parentId: 'root', question: 'Why?', category: 'Scope', answer: '', research: null, review: false },
    ] };
}
function shared(value = personal()) {
  const { format, version, revision, ...journey } = structuredClone(value);
  return { format: 'copilot-explorer-shared', version: 1, journey, extensions: {} };
}
const hash = value => createHash('sha256').update(value).digest('hex');
const research = { basis: 'sources', summary: ' A finding ', options: [
  { title: ' First ', description: ' A small pilot ', pros: [' Low risk '], cons: [' Limited '], details: [] },
  { title: 'Second', description: 'Large launch', pros: ['Reach'], cons: ['Cost'] },
], recommendation: ' Prefer first ', uncertainty: ' Scope matters ', sources: [
  { id: 's1', title: ' Source ', url: 'https://example.com/study', retrievedAt: date, provenance: 'recorded-read' },
], claims: [{ id: 'c1', text: ' A premise ', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: ' Support ' }], limitations: ' Not a proof ' }] };

test('shared read and unchanged preparation preserve exact UTF-8, BOM, formatting and sparse legacy fields', () => {
  const doc = shared(); doc.journey.nodes[1].research = research;
  const source = Buffer.from('\uFEFF' + JSON.stringify(doc, null, '\t').replaceAll('\n', '\r\n') + '\r\n  ');
  const before = Buffer.from(source), read = readSharedDocument(source);
  assert.deepEqual(read.document, doc);
  assert.equal(read.baseDigest, hash(source));
  assert.equal(Object.hasOwn(read.document.journey, 'objective'), false);
  assert.equal(Object.hasOwn(read.document.journey.nodes[2], 'answerState'), false);
  assert.equal(read.document.journey.nodes[1].research.sources[0].provenance, 'recorded-read');
  const write = prepareSharedWrite(source, structuredClone(doc), read.baseDigest);
  assert.equal(write.changed, false); assert.equal(write.content, source.toString('utf8'));
  assert.equal(write.contentDigest, read.contentDigest); assert.deepEqual(source, before);
});

test('editing one answer creates a deterministic focused diff without altering other text, IDs, arrays or timestamps', () => {
  const initial = prepareSharedMigration(JSON.stringify(personal()));
  const next = structuredClone(initial.document); next.journey.nodes[1].answer = 'New answer 🌿\n  preserved';
  const write = prepareSharedWrite(initial.content, next, hash(initial.content));
  assert.equal(write.changed, true); assert.equal(write.content.endsWith('\n'), true);
  assert.equal(write.content.includes('\r'), false);
  const result = readSharedDocument(write.content);
  assert.deepEqual(result.document, next);
  assert.deepEqual(result.document.journey.nodes.map(n => n.id), ['root', 'q1', 'q2']);
  assert.equal(result.document.journey.updatedAt, date);
  const oldLines = initial.content.split('\n'), newLines = write.content.split('\n');
  assert.equal(oldLines.length, newLines.length);
  assert.equal(oldLines.filter((line, i) => line !== newLines[i]).length, 1);
  assert.equal(prepareSharedWrite(initial.content, next, hash(initial.content)).content, write.content);
});

test('semantic digest ignores object-key order and formatting but preserves array order and exact text', () => {
  const value = shared(), a = JSON.stringify(value);
  const reordered = Object.fromEntries(Object.entries(value).reverse()), b = JSON.stringify(reordered, null, 4);
  const first = readSharedDocument(a), second = readSharedDocument(b);
  assert.notEqual(first.baseDigest, second.baseDigest); assert.equal(first.contentDigest, second.contentDigest);
  assert.equal(prepareSharedWrite(a, reordered, first.baseDigest).content, a);
  reordered.journey.nodes.reverse(); assert.notEqual(readSharedDocument(JSON.stringify(reordered)).contentDigest, first.contentDigest);
  reordered.journey.nodes.reverse(); reordered.journey.nodes[1].answer += ' ';
  assert.notEqual(readSharedDocument(JSON.stringify(reordered)).contentDigest, first.contentDigest);
});

test('writes require the exact current base even when two personal revisions or semantic contents match', () => {
  const first = personal(), second = personal(); second.nodes[1].answer = 'Another contributor';
  assert.equal(first.revision, second.revision);
  const a = prepareSharedMigration(JSON.stringify(first)), b = prepareSharedMigration(JSON.stringify(second));
  assert.notEqual(a.contentDigest, b.contentDigest);
  assert.throws(() => prepareSharedWrite(b.content, a.document, hash(a.content)), /changed|base/i);
  assert.throws(() => prepareSharedWrite(a.content + ' ', a.document, hash(a.content)), /changed|base/i);
  for (const base of [undefined, '', 'not-a-digest', null]) assert.throws(() => prepareSharedWrite(a.content, a.document, base), /base|digest/i);
});

test('migration is explicit and non-destructive, drops only local revision/format metadata and preserves provenance', () => {
  const legacy = personal(); legacy.nodes[1].research = research;
  const source = Buffer.from(JSON.stringify(legacy, null, 4)), original = Buffer.from(source);
  assert.doesNotThrow(() => validateDocument(legacy));
  assert.throws(() => readSharedDocument(source), /shared|migrat/i);
  const plan = prepareSharedMigration(source);
  assert.equal(plan.sourceDigest, hash(source)); assert.deepEqual(plan.document, shared(legacy));
  assert.equal(Object.hasOwn(plan.document.journey, 'revision'), false);
  assert.equal(plan.document.journey.nodes[1].research.sources[0].provenance, 'recorded-read');
  assert.deepEqual(source, original, 'abandoning the prepared migration leaves the personal source intact');
  legacy.revision++; assert.equal(prepareSharedMigration(JSON.stringify(legacy)).contentDigest, plan.contentDigest);
});

test('future versions, unknown nested data and unsupported extension semantics refuse mutation without stripping source', () => {
  const changes = [
    d => { d.version = 2; }, d => { d.future = true; },
    d => { d.journey.unknown = { answer: 'keep me' }; },
    d => { d.journey.nodes[1].futureDecision = 'keep me'; },
    d => { d.extensions.dependencies = { version: 1, links: [] }; },
    d => { d.journey.revision = 1; },
    d => { d.journey.nodes[1].research = structuredClone(research); d.journey.nodes[1].research.options[0].future = 'keep me'; },
  ];
  for (const mutate of changes) {
    const value = shared(); mutate(value); const source = Buffer.from(JSON.stringify(value)), before = Buffer.from(source);
    assert.throws(() => readSharedDocument(source), /unsupported|unknown|field|extension|version|revision/i);
    assert.throws(() => prepareSharedWrite(source, shared(), hash(source)), /unsupported|unknown|field|extension|version|revision/i);
    assert.deepEqual(source, before);
  }
  const personalFuture = personal(); personalFuture.nodes[1].future = true;
  assert.throws(() => prepareSharedMigration(JSON.stringify(personalFuture)), /unsupported|unknown|field/i);
  personalFuture.version = 2; assert.throws(() => prepareSharedMigration(JSON.stringify(personalFuture)), /version|supported/i);
});

test('duplicate JSON keys including escaped names cannot hide discarded values', () => {
  const source = JSON.stringify(shared());
  for (const duplicate of [source.replace('"version":1', '"version":2,"version":1'), source.replace('"answer":""', '"answer":"hidden","ans\\u0077er":""')]) {
    assert.throws(() => readSharedDocument(duplicate), /duplicate/i);
  }
  const literal = shared(); literal.journey.nodes[1].answer = 'a ":" and {"answer": 1, "answer": 2} in user text';
  assert.equal(readSharedDocument(JSON.stringify(literal)).document.journey.nodes[1].answer, literal.journey.nodes[1].answer);
});

test('invalid encoding, non-JSON values and prototype keys fail before becoming writable data', () => {
  for (const source of [Buffer.from([0xff]), '\ud800', '{', 'null', '[]', 'true']) assert.throws(() => readSharedDocument(source));
  const bad = JSON.stringify(shared()).replace('"extensions":{}', '"extensions":{},"__proto__":{"polluted":true}');
  assert.throws(() => readSharedDocument(bad), /unknown|unsupported|field/i);
  assert.equal({}.polluted, undefined);
  const value = shared(); value.journey.nodes[1].answer = undefined;
  assert.throws(() => prepareSharedWrite(JSON.stringify(shared()), value, hash(JSON.stringify(shared()))));
  value.journey.nodes[1].answer = 'fine'; value.journey.nodes[1].review = 1;
  assert.throws(() => readSharedDocument(JSON.stringify(value)), /preserv|invalid|review/i);
});

test('invalid parent references and normalized identities never create a migration or writable shared map', () => {
  const legacy = personal(); legacy.nodes[1].parentId = 'missing';
  assert.throws(() => prepareSharedMigration(JSON.stringify(legacy)), /parent/i);
  const value = shared(); value.journey.nodes[1].id = ' q1 ';
  assert.throws(() => readSharedDocument(JSON.stringify(value)), /identity|preserv|id/i);
  value.journey.nodes[1].id = 'q1'; value.journey.nodes[2].id = 'q1';
  assert.throws(() => readSharedDocument(JSON.stringify(value)), /unique/i);
});

test('accepted brief and handoff retain legacy hash inputs, evidence and freshness through conversion and edits', () => {
  const legacy = personal();
  legacy.pins = [{ text: ' Keep offline access ', id: 'constraint-12345678901234' }];
  legacy.nodes[1].research = structuredClone(research);
  const sections = JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] });
  legacy.brief = acceptBrief(parseBrief(sections, prepareBrief(legacy)), []);
  legacy.handoff = acceptHandoff(parseHandoff(sections, prepareHandoff(legacy, { nodeIds: ['q1'], format: 'plan', includeEvidence: true })), []);
  const initial = prepareSharedMigration(JSON.stringify(legacy)), opened = readSharedDocument(initial.content);
  assert.deepEqual(opened.document, initial.document);
  assert.equal(briefFreshness(opened.document.journey.brief, opened.document.journey), 'current');
  assert.equal(handoffFreshness(opened.document.journey.handoff, opened.document.journey), 'current');
  const edited = structuredClone(opened.document); edited.journey.nodes[1].answer = 'A different choice';
  const written = prepareSharedWrite(initial.content, edited, opened.baseDigest), reopened = readSharedDocument(written.content);
  assert.deepEqual(reopened.document.journey.handoff, legacy.handoff);
  assert.deepEqual(reopened.document.journey.brief, legacy.brief);
  assert.equal(briefFreshness(reopened.document.journey.brief, reopened.document.journey), 'stale');
  assert.equal(handoffFreshness(reopened.document.journey.handoff, reopened.document.journey), 'stale');
  const again = prepareSharedWrite(written.content, reopened.document, reopened.baseDigest);
  assert.equal(again.changed, false); assert.equal(again.content, written.content);
});

test('brief and handoff certainty cannot bypass semantic normalization by preserving arbitrary strings', () => {
  const sections = JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [], unresolved: [],
    nextSteps: [{ id: 'step', text: 'Consider a pilot', certainty: 'suggestion', sources: [] }] });
  for (const field of ['brief', 'handoff']) {
    const legacy = personal();
    legacy[field] = field === 'brief' ? acceptBrief(parseBrief(sections, prepareBrief(legacy)), []) :
      acceptHandoff(parseHandoff(sections, prepareHandoff(legacy, { nodeIds: ['q1'], format: 'plan', includeEvidence: false })), []);
    const valid = prepareSharedMigration(JSON.stringify(legacy)), opened = readSharedDocument(valid.content);
    assert.deepEqual(opened.document.journey[field], legacy[field]);
    legacy[field].sections.nextSteps[0].certainty = 'user-decision';
    const source = Buffer.from(JSON.stringify(legacy)), before = Buffer.from(source);
    assert.throws(() => prepareSharedMigration(source), /meaning|identity/i);
    assert.throws(() => readSharedDocument(JSON.stringify(shared(legacy))), /meaning|identity/i);
    const edited = structuredClone(opened.document); edited.journey[field] = legacy[field];
    assert.throws(() => prepareSharedWrite(valid.content, edited, opened.baseDigest), /meaning|identity/i);
    assert.deepEqual(source, before);
  }
});

test('size limits apply to raw input and canonical output, preserving near-limit migration sources', () => {
  assert.throws(() => readSharedDocument(' '.repeat(MAX_DOCUMENT_BYTES + 1)), /size|limit|large/i);
  const legacy = personal();
  for (let i = 0; i < 465; i++) legacy.nodes.push({ id: `large${i}`, parentId: 'root', question: 'Why?', category: 'Scope', answer: 'x'.repeat(20000), research: null, review: false });
  assert.doesNotThrow(() => validateDocument(legacy));
  const source = Buffer.from(JSON.stringify(legacy)), before = Buffer.from(source);
  const migration = prepareSharedMigration(source);
  assert.deepEqual(readSharedDocument(migration.content).document.journey.nodes.at(-1), legacy.nodes.at(-1));
  assert.deepEqual(source, before);
  // Keep the old personal format within its bound while the envelope's extra indentation exceeds it.
  let remaining = MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(validateDocument(legacy), null, 2)) - 8;
  for (const node of legacy.nodes) {
    const extra = Math.min(remaining, 20000 - node.answer.length); node.answer += 'x'.repeat(extra); remaining -= extra;
    if (!remaining) break;
  }
  assert.equal(remaining, 0); assert.doesNotThrow(() => validateDocument(legacy));
  const near = Buffer.from(JSON.stringify(legacy)), nearBefore = Buffer.from(near);
  assert.throws(() => prepareSharedMigration(near), /size|limit|large/i);
  assert.deepEqual(near, nearBefore);
  const compact = JSON.stringify(shared(legacy)), compactRead = readSharedDocument(compact);
  assert.equal(prepareSharedWrite(compact, compactRead.document, compactRead.baseDigest).content, compact);
  compactRead.document.journey.nodes[1].answer = compactRead.document.journey.nodes[1].answer.replace('x', 'y');
  assert.throws(() => prepareSharedWrite(compact, compactRead.document, compactRead.baseDigest), /size|limit|large/i);
});
