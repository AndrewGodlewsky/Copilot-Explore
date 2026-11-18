import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { adrFileMarkdown, adrFileMarker, adrArtifactDigest, validateAdrFile, validateAdrFiles, associateAdrFile } from '../com.github.copilot/extensions/explorer/adr-file.mjs';
import { defaultAdrFormat, parseAdrTemplate } from '../com.github.copilot/extensions/explorer/adr-format.mjs';
import { validateDocument, importedDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  const doc = saveAdrFixture(adrFileDocument()), id = randomUUID(), content = adrFileMarkdown(doc.adrDraft, id);
  const record = { version: 1, id, path: 'docs/decisions/0001-storage-λ.md', title: doc.adrDraft.title, status: 'proposed', sha256: hash(content), artifactDigest: adrArtifactDigest(doc.adrDraft), readinessDigest: 'a'.repeat(64), writtenAt: '2026-11-18T18:00:00.000Z' };
  return { doc, id, content, record };
}

test('ADR file Markdown preserves literal Unicode, uncertainty and edited labels without declaring approval', () => {
  const doc = saveAdrFixture(adrFileDocument()), id = randomUUID(), draft = doc.adrDraft;
  draft.title = 'Storage 🌱 <script>'; draft.sections.outcome[0].text = '  Exact λ\r\n<script> & [link](file:///secret)  '; draft.sections.outcome[0].edited = true;
  draft.sections.alternatives = [{ id: 'unknown', text: 'Maybe B; unknown cost.', certainty: 'uncertain', edited: false, sources: [] }];
  const before = structuredClone(draft), content = adrFileMarkdown(draft, id), plain = content.replaceAll('\\', '');
  assert.ok(plain.includes('Storage 🌱 <script>')); assert.ok(plain.includes('  Exact λ\n<script> & [link](file:///secret)  '));
  assert.match(plain, /user.edited|User.edited/i); assert.match(content, /Uncertain/); assert.match(content, /date: "Unspecified\."/);
  assert.doesNotMatch(content, /<script>|\]\(file:/); assert.ok(content.endsWith(adrFileMarker(id) + '\n')); assert.match(content, /Status: proposed/);
  assert.match(content, /not.*approv/i); assert.doesNotMatch(content, /decision-makers:|2026-11-18/); assert.deepEqual(draft, before);
});

test('ADR file custom layout omitting status still visibly remains proposed and uses its chosen sections', () => {
  const format = { ...defaultAdrFormat(), template: { kind: 'repository', path: 'template.md', sha256: 'b'.repeat(64) }, layout: parseAdrTemplate('# Example\n## Context\n## Decision\n') };
  const doc = saveAdrFixture(adrFileDocument(), null, format), content = adrFileMarkdown(doc.adrDraft, randomUUID());
  assert.match(content, /^# Storage/); assert.match(content, /## Decision\n/); assert.match(content, /Status: proposed/); assert.doesNotMatch(content, /Example|date:|^---/);
});

test('ADR Markdown preserves front matter and explicitly labels a hypothetical scenario', () => {
  const { doc, id } = fixture(), label = { classification: 'hypothetical', scope: 'personal', preferenceRevision: 1, source: { id: doc.id }, family: { id: doc.id } };
  const content = adrFileMarkdown(doc.adrDraft, id, label); assert.match(content, /^---\nstatus:/); assert.match(content.replaceAll('\\', ''), /Conditional alternative; not a current project decision/);
  assert.ok(content.endsWith(adrFileMarker(id) + '\n')); assert.throws(() => adrFileMarkdown(doc.adrDraft, id, { ...label, classification: 'anything' }), /scenario/i);
});

test('ADR file renderer rejects unsupported identity, control text, approval and output overflow without clipping', () => {
  const f = fixture(); assert.throws(() => adrFileMarkdown(f.doc.adrDraft, '<!--bad-->'));
  for (const edit of [d => { d.status = 'accepted'; }, d => { d.title += '\0'; }, d => { d.sections.outcome[0].text += '\u0001'; }]) { const draft = structuredClone(f.doc.adrDraft); edit(draft); assert.throws(() => adrFileMarkdown(draft, f.id)); }
  const draft = structuredClone(f.doc.adrDraft);
  for (const key of ['context', 'drivers', 'alternatives', 'outcome', 'consequences']) draft.sections[key] = Array.from({ length: 5 }, (_, index) => ({ id: `${key}-${index}`, text: '界'.repeat(1000), certainty: 'uncertain', edited: false, sources: [] }));
  assert.throws(() => adrFileMarkdown(draft, f.id), /64 KiB|output limit/);
});

test('ADR file references enforce exact bounded schema and portable unique paths without filesystem authority', () => {
  const { record } = fixture(); assert.deepEqual(validateAdrFile(record), record);
  for (const value of [{ ...record, absolute: 'C:/secret.md' }, { ...record, status: 'accepted' }, { ...record, version: 2 }, { ...record, sha256: ['a'.repeat(64)] }, { ...record, writtenAt: 'invalid' }, { ...record, title: 'x'.repeat(201) }]) assert.throws(() => validateAdrFile(value));
  for (const path of ['../record.md', 'C:/record.md', 'docs\\record.md', '.git/record.md', 'docs/secrets.md', 'docs/record.txt', 'docs/CON.md', 'docs/' + '界'.repeat(100) + '.md']) assert.throws(() => validateAdrFile({ ...record, path }));
  assert.throws(() => validateAdrFiles([record, { ...record, path: 'docs/other.md' }]));
  assert.throws(() => validateAdrFiles([record, { ...record, id: randomUUID(), path: record.path.toUpperCase() }]));
  const fifty = Array.from({ length: 50 }, (_, i) => ({ ...record, id: randomUUID(), path: `docs/${i}.md` })); assert.equal(validateAdrFiles(fifty).length, 50);
  assert.throws(() => validateAdrFiles([...fifty, { ...record, id: randomUUID(), path: 'docs/51.md' }]));
});

test('ADR associations are idempotent and preserve unrelated references while rejecting changed update bases', () => {
  const { record } = fixture(), other = { ...record, id: randomUUID(), path: 'docs/other.md' }, initial = [other], before = structuredClone(initial);
  const created = associateAdrFile(initial, record, null); assert.deepEqual(initial, before); assert.deepEqual(created, [other, record]);
  assert.deepEqual(associateAdrFile(created, record, null), created);
  const updated = { ...record, sha256: 'c'.repeat(64), writtenAt: '2026-11-19T00:00:00.000Z' };
  assert.deepEqual(associateAdrFile(created, updated, record), [other, updated]); assert.deepEqual(associateAdrFile([other, updated], updated, record), [other, updated]);
  assert.throws(() => associateAdrFile(created, updated, null), /changed|conflict/i);
  assert.throws(() => associateAdrFile([other], updated, record), /changed|missing|conflict/i);
  assert.throws(() => associateAdrFile(created, { ...record, id: randomUUID() }, null), /path|conflict/i);
  assert.throws(() => associateAdrFile(created, { ...updated, path: 'docs/moved.md' }, record), /path|changed|conflict/i);
});

test('ADR file references survive personal/shared roundtrip as relative history and old documents stay unchanged', () => {
  const f = fixture(), old = validateDocument(f.doc); assert.equal(Object.hasOwn(old, 'adrFiles'), false);
  f.doc.adrFiles = [f.record]; assert.deepEqual(validateDocument(f.doc).adrFiles, [f.record]);
  const migrated = prepareSharedMigration(JSON.stringify(f.doc)), shared = readSharedDocument(migrated.content);
  assert.deepEqual(shared.document.journey.adrFiles, [f.record]); assert.deepEqual(importedDocument(f.doc).adrFiles, [f.record]);
  assert.equal(adrArtifactDigest(f.doc.adrDraft), adrArtifactDigest(shared.document.journey.adrDraft));
  const malformed = structuredClone(shared.document); malformed.journey.adrFiles[0].extra = true; assert.throws(() => readSharedDocument(JSON.stringify(malformed)));
});

test('ADR artifact digest binds normalized wording, capture and receipts independent of valid object property ordering', () => {
  const { doc } = fixture(), draft = doc.adrDraft, retained = new Set([draft.guidance, draft.evidence]);
  const sorted = value => retained.has(value) ? value : Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map(key => [key, sorted(value[key])])) : value;
  const digest = adrArtifactDigest(draft); assert.equal(adrArtifactDigest(sorted(draft)), digest);
  for (const edit of [d => { d.title += ' edited'; }, d => { d.sections.outcome[0].text += ' changed'; }, d => { d.readiness = { version: 1, reviewedAt: d.acceptedAt, digest: 'b'.repeat(64), acknowledged: [] }; }]) { const next = structuredClone(draft); edit(next); assert.notEqual(adrArtifactDigest(next), digest); }
});

test('ADR association history retains the earlier file receipt after a later managed update', async t => {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), 'adr-file-history-')), file = join(directory, 'map.explore.json'); await writeFile(file, JSON.stringify(f.doc));
  const e = await new Explorer({ file }).load(); t.after(async () => { await e.close(); await rm(directory, { recursive: true, force: true }); });
  await e.save({ ...e.doc, adrFiles: [f.record] }); const revision = e.doc.revision;
  const updated = { ...f.record, sha256: 'd'.repeat(64), writtenAt: '2026-11-19T00:00:00.000Z' }; await e.save({ ...e.doc, adrFiles: [updated] });
  assert.deepEqual((await e.readHistory(e.doc.id, revision)).document.adrFiles, [f.record]); assert.deepEqual(e.doc.adrFiles, [updated]);
});
