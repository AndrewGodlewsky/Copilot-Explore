import test from 'node:test';
import { confirmAnswer } from './helpers/answer-change.mjs';
import assert from 'node:assert/strict';
import { research, createDocument, addQuestions, importedDocument, validateDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { startResearch } from './helpers/research-review.mjs';

export const evidence = {
  basis: 'sources', summary: 'Comparison', options: [
    { title: 'Pilot', description: 'Learn first', pros: [], cons: [] },
    { title: 'Launch', description: 'Reach more', pros: [], cons: [] },
  ], recommendation: 'Consider a pilot', uncertainty: 'Applicability varies',
  sources: [{ id: 's1', title: '<script>Source</script>', url: 'https://example.com/a?q=one', retrievedAt: '2026-11-17T12:00:00.000Z', provenance: 'recorded-read' }],
  claims: [
    { id: 'c1', text: '<script>Claim</script>', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'The source describes a limited pilot.' }], limitations: 'This is model interpretation.' },
    { id: 'c2', text: 'A pilot may fit', basis: 'reasoning', evidence: [], limitations: 'Personal judgment.' },
    { id: 'c3', text: 'Local cost', basis: 'unknown', evidence: [], limitations: 'No local evidence.' },
  ],
};

test('claim evidence survives native validation and escaped complete Markdown with honest read labels', () => {
  assert.deepEqual(research(evidence), evidence);
  const doc = createDocument('Evidence'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }])[0].research = evidence;
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).nodes[1].research, evidence);
  const markdown = toMarkdown(doc);
  for (const text of ['c1', 's1', 'The source describes', '2026-11-17T12:00:00.000Z', 'Model interpretation', 'Unknown support', 'requested URL']) assert.ok(markdown.includes(text), text);
  assert.ok(!markdown.includes('<script>'));
});

test('claim schema rejects duplicate, unknown and mismatched references, unsupported bases and unsafe URLs', () => {
  const changes = [
    r => r.claims.push(r.claims[0]), r => r.sources.push(r.sources[0]),
    r => r.claims[0].evidence[0].sourceId = 'c1', r => r.claims[0].evidence.push(r.claims[0].evidence[0]),
    r => r.claims[0].evidence = [], r => r.claims[1].evidence = r.claims[0].evidence,
    r => r.claims[0].basis = 'verified', r => r.claims[0].id = '<script>',
    r => r.sources[0].url = 'javascript:alert(1)', r => r.sources[0].url = 'https://u:p@example.com',
    r => r.sources[0].retrievedAt = 'yesterday', r => r.sources[0].provenance = 'verified',
    r => delete r.sources[0].id, r => r.claims[0].evidence[0].quote = 'Invented quote',
    r => r.sources[0].url = 'https://example.com/' + '界'.repeat(500),
    r => r.claims[0].claimId = 'missing', r => r.sources.push({ ...r.sources[0], id: 's2', url: r.sources[0].url + '#fragment' }),
  ];
  for (const change of changes) { const value = structuredClone(evidence); change(value); assert.throws(() => research(value), change.toString()); }
});

test('claim bounds reject overflow without clipping and legacy records gain no invented provenance', () => {
  const changes = [r => r.claims[0].text = 'x'.repeat(1001), r => r.claims[0].limitations = 'x'.repeat(1001),
    r => r.claims[0].evidence[0].paraphrase = 'x'.repeat(1001), r => r.claims[0].id = 'c'.repeat(33),
    r => r.claims = [], r => r.claims = Array.from({ length: 13 }, (_, i) => ({ ...r.claims[1], id: `c${i}` })),
    r => { r.summary = '\u0000'.repeat(5000); r.recommendation = '\u0000'.repeat(5000); r.options = Array.from({ length: 4 }, () => ({ ...r.options[0], description: '\u0000'.repeat(3000), pros: Array(6).fill('\u0000'.repeat(1000)) })); },
  ];
  for (const change of changes) { const value = structuredClone(evidence); change(value); assert.throws(() => research(value), change.toString()); }
  const legacy = structuredClone(evidence); delete legacy.claims; legacy.sources = [{ title: 'Old', url: 'https://example.com' }];
  const validated = research(legacy); assert.equal(validated.claims, undefined); assert.equal(validated.sources[0].retrievedAt, undefined);
  const doc = createDocument('Legacy'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }])[0].research = validated;
  assert.match(toMarkdown(doc), /Claim-level support.*unknown/); assert.match(toMarkdown(doc), /Retrieval time unknown/);
});

test('external import marks historical metadata while native reopen and history preserve evidence exactly', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-evidence-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const doc = createDocument('Evidence'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }])[0].research = evidence;
  const original = JSON.stringify(doc), imported = importedDocument(doc);
  assert.equal(JSON.stringify(doc), original); assert.equal(imported.nodes[1].research.sources[0].provenance, 'imported');
  assert.equal(imported.nodes[1].research.sources[0].retrievedAt, evidence.sources[0].retrievedAt);
  const library = new Library(dir), record = await library.import(doc);
  const e = await new Explorer({ file: record.file }).load(); t.after(() => e.close());
  const expected = structuredClone(evidence); expected.sources[0].provenance = 'imported';
  assert.deepEqual(e.doc.nodes[1].research, expected);
  await confirmAnswer(e, { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: 'My answer' });
  const previous = await e.readHistory(e.doc.id, 0); assert.deepEqual(previous.document.nodes[1].research, expected);
  await e.command('restore', { revision: e.doc.revision, journey: e.doc.id, snapshotRevision: 0 });
  assert.deepEqual(e.doc.nodes[1].research, expected); assert.equal(e.doc.nodes[1].answer, '');
  assert.match(toMarkdown(e.doc), /Imported read metadata; not observed by this installation/);
  const reopened = await new Explorer({ file: record.file }).load(); t.after(() => reopened.close());
  assert.deepEqual(reopened.doc.nodes[1].research, expected);
  const legacy = structuredClone(doc); delete legacy.nodes[1].research.claims; legacy.nodes[1].research.sources = [{ title: 'Old source', url: 'https://example.com' }];
  const legacyRecord = await library.import(legacy, { asCopy: true }); assert.equal(legacyRecord.document.nodes[1].research.sources[0].retrievedAt, undefined);
});

test('identical local reimport retains its identity and divergence requires an explicit imported copy', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-evidence-import-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const doc = createDocument('Evidence'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }])[0].research = evidence;
  const file = join(dir, 'local.explore.json'); await writeFile(file, JSON.stringify(doc));
  const before = await readFile(file, 'utf8'), library = new Library(dir);
  const identical = await library.import(doc);
  assert.equal(identical.conflict, undefined); assert.deepEqual(identical.document, validateDocument(doc));
  const changed = structuredClone(doc); changed.nodes[1].research.summary = 'Different imported assertions';
  assert.ok((await library.import(changed)).conflict);
  const copy = await library.import(changed, { asCopy: true });
  assert.notEqual(copy.document.id, doc.id); assert.equal(copy.document.nodes[1].research.sources[0].provenance, 'imported');
  assert.equal(await readFile(file, 'utf8'), before);
});

test('evidence rejects unknown top-level fields and normalized URL expansion over the byte ceiling', () => {
  assert.throws(() => research({ ...evidence, verifiedClaims: ['fake'] }));
  const value = structuredClone(evidence);
  value.sources[0].url = 'https://example.com/' + '界'.repeat(200);
  value.summary = 'x'.repeat(5000); value.recommendation = 'x'.repeat(5000);
  value.options = Array.from({ length: 4 }, () => ({ title: 'Option', description: 'x'.repeat(3000), pros: Array(6).fill('x'.repeat(1000)), cons: Array(6).fill('x'.repeat(1000)), proposedAnswer: 'x'.repeat(5000), details: Array.from({ length: 8 }, () => ({ label: 'Setting', value: 'x'.repeat(1000) })) }));
  value.claims = Array.from({ length: 12 }, (_, i) => ({ ...evidence.claims[0], id: `c${i}`, text: 'x'.repeat(1000), limitations: 'x'.repeat(1000) }));
  // Reach the aggregate raw boundary with bounded field contents; URL canonicalization expands UTF-8.
  let bytes = Buffer.byteLength(JSON.stringify(value));
  for (const claim of value.claims) {
    const remaining = 159999 - bytes, add = Math.min(1000 - claim.evidence[0].paraphrase.length, remaining);
    if (add > 0) { claim.evidence = [{ sourceId: 's1', paraphrase: claim.evidence[0].paraphrase + 'x'.repeat(add) }]; bytes += add; }
  }
  assert.ok(bytes <= 160000 && bytes + 1200 > 160000, bytes);
  assert.throws(() => research(value), /serialized limit/);
});

test('invalid evidence, overflow, cancellation and current-disk changes preserve prior research and saved answers', { timeout: 10000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-evidence-save-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'map.explore.json'), doc = createDocument('Evidence');
  const node = addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }])[0]; node.research = evidence; node.answer = 'My unchanged answer';
  await writeFile(file, JSON.stringify(doc));
  let finish, started;
  const e = await new Explorer({ file, researcher: { run: () => new Promise(resolve => { finish = resolve; started(); }) } }).load(); t.after(async () => { finish?.(evidence); await e.close(); });
  for (const mode of ['unknown-ref', 'oversized', 'cancelled', 'disk-source', 'disk-destination']) {
    const ready = new Promise(resolve => { started = resolve; });
    await startResearch(e, { revision: e.doc.revision, nodeId: node.id });
    // Policy checks can still be pending after the command releases its writer lock.
    await ready;
    const value = structuredClone(evidence);
    if (mode === 'unknown-ref') value.claims[0].evidence[0].sourceId = 'nonexistent';
    if (mode === 'oversized') value.claims[0].text = 'x'.repeat(1001);
    if (mode === 'cancelled') await e.command('cancel');
    if (mode.startsWith('disk-')) {
      const other = await new Explorer({ file }).load();
      if (mode === 'disk-source') await confirmAnswer(other, { revision: other.doc.revision, nodeId: node.id, answer: 'Current disk answer' });
      else { const next = structuredClone(other.doc); next.nodes[1].research.summary = 'Current disk research'; await other.save(next); }
      await other.close();
    }
    finish(value); await Promise.all([...e.researchTasks]);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.nodes[1].research.summary, mode === 'disk-destination' ? 'Current disk research' : evidence.summary);
    assert.equal(saved.nodes[1].answer, mode === 'disk-source' || mode === 'disk-destination' ? 'Current disk answer' : node.answer);
    await e.load();
  }
});
