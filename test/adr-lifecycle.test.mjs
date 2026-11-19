import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { adrFileMarkdown, adrFileMarker, adrBytesDigest, adrArtifactDigest, validateAdrFile, validateAdrFiles, associateAdrBatch } from '../com.github.copilot/extensions/explorer/adr-file.mjs';
import { validateAdrLifecycle, changeAdrLifecycle, linkAdrSuccessor, adrLifecycleFooter, appendAdrLifecycle, transitionAdrMarkdown } from '../com.github.copilot/extensions/explorer/adr-lifecycle.mjs';
import { captureAdrSources } from '../com.github.copilot/extensions/explorer/adr-sources.mjs';
import { defaultAdrFormat, parseAdrTemplate } from '../com.github.copilot/extensions/explorer/adr-format.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { importedDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';

const event = (day = 19, actor = null) => ({ at: `2026-11-${day}T18:00:00.000Z`, actor });
const reference = record => ({ id: record.id, path: record.path });
function fixture(number = 1, format = defaultAdrFormat()) {
  const doc = saveAdrFixture(adrFileDocument(), null, format), id = randomUUID(), sources = captureAdrSources(doc);
  const content = adrFileMarkdown(doc.adrDraft, id, null, sources);
  const record = { version: 1, id, path: `docs/decisions/${number}-storage-λ.md`, title: doc.adrDraft.title, status: 'proposed', sha256: adrBytesDigest(content), artifactDigest: adrArtifactDigest(doc.adrDraft), readinessDigest: 'a'.repeat(64), writtenAt: '2026-11-18T18:00:00.000Z', sources };
  return { doc, content, record };
}
const change = (records, kind, id = records.at(-1).id, stamp = event()) => changeAdrLifecycle(records, { kind, id }, stamp);

test('ADR lifecycle explicitly accepts and deprecates while preserving source reasoning and legacy proposed records', () => {
  const f = fixture(), before = structuredClone(f.record), actor = { id: randomUUID(), displayName: 'Alice λ <script>' };
  assert.deepEqual(validateAdrFile(f.record), before); assert.equal(f.record.lifecycle, undefined);
  const accepted = change([f.record], 'accept', f.record.id, event(19, actor));
  assert.equal(accepted[0].status, 'accepted'); assert.deepEqual(accepted[0].lifecycle.events, [{ from: 'proposed', to: 'accepted', ...event(19, actor) }]);
  const deprecated = change(accepted, 'deprecate', f.record.id, event(20));
  assert.equal(deprecated[0].status, 'deprecated'); assert.equal(deprecated[0].lifecycle.events.length, 2);
  assert.deepEqual(deprecated[0].sources, before.sources); assert.equal(deprecated[0].artifactDigest, before.artifactDigest); assert.deepEqual(f.record, before);
  f.doc.adrFiles = deprecated;
  assert.deepEqual(importedDocument(f.doc).adrFiles, deprecated);
  assert.deepEqual(readSharedDocument(prepareSharedMigration(JSON.stringify(f.doc)).content).document.journey.adrFiles, deprecated);
});

test('ADR lifecycle rejects illegal, repeated and malformed approval metadata without inventing history', () => {
  const f = fixture(), accepted = change([f.record], 'accept'), lifecycle = accepted[0].lifecycle;
  for (const edit of [v => { v.extra = true; }, v => { v.events[0].from = 'accepted'; }, v => { v.events[0].to = 'superseded'; }, v => { v.events[0].at = '2026-02-30T00:00:00.000Z'; }, v => { v.events[0].actor = { id: randomUUID(), displayName: 'Untrusted\nname' }; }, v => { v.events[0].actor = { id: randomUUID(), displayName: 'Alice', email: 'private@example.invalid' }; }, v => { v.successors = [{ id: randomUUID(), path: '../other.md' }]; }]) {
    const value = structuredClone(lifecycle); edit(value); assert.throws(() => validateAdrLifecycle(value, 'accepted'));
  }
  assert.throws(() => validateAdrFile({ ...f.record, status: 'accepted' }));
  assert.throws(() => change(accepted, 'accept')); assert.throws(() => change(accepted, 'supersede')); assert.throws(() => change(accepted, 'deprecate', f.record.id, event(18)));
  const rejected = change([f.record], 'deprecate'); assert.throws(() => change(rejected, 'accept')); assert.throws(() => change(rejected, 'deprecate'));
  assert.throws(() => linkAdrSuccessor(rejected, f.record.id, fixture(2).record));
});

test('successor proposals retain alternatives and require separate acceptance to supersede the predecessor', () => {
  const original = fixture(), first = fixture(2), second = fixture(3), accepted = change([original.record], 'accept');
  const one = linkAdrSuccessor(accepted, original.record.id, first.record);
  assert.equal(one[0].status, 'accepted'); assert.equal(one[1].status, 'proposed'); assert.deepEqual(one[1].lifecycle.events, []);
  assert.deepEqual(one[0].lifecycle.successors, [reference(first.record)]); assert.deepEqual(one[1].lifecycle.predecessor, reference(original.record));
  const two = linkAdrSuccessor(one, original.record.id, second.record), deprecated = change(two, 'deprecate', first.record.id, event(20));
  const next = change(deprecated, 'accept', second.record.id, event(21));
  assert.equal(next[0].status, 'superseded'); assert.deepEqual(next[0].lifecycle.supersededBy, reference(second.record)); assert.equal(next[2].status, 'accepted'); assert.equal(next[1].status, 'deprecated');
  assert.deepEqual(next[0].lifecycle.successors, [reference(first.record), reference(second.record)]);
  assert.deepEqual(next[0].sources, original.record.sources); assert.deepEqual(next[2].sources, second.record.sources);
  assert.throws(() => change(next, 'accept', first.record.id)); assert.throws(() => linkAdrSuccessor(next, original.record.id, fixture(4).record));
  const later = linkAdrSuccessor(next, second.record.id, fixture(4).record), final = change(later, 'accept', later.at(-1).id, event(22));
  assert.equal(final[0].status, 'superseded'); assert.equal(final[2].status, 'superseded'); assert.equal(final[3].status, 'accepted'); assert.equal(validateAdrFiles(final).length, 4);
});

test('ADR relationships reject dangling, mismatched, duplicate, cyclic and competing accepted replacements', () => {
  const f = fixture(), child = fixture(2), records = linkAdrSuccessor(change([f.record], 'accept'), f.record.id, child.record);
  for (const edit of [v => v.pop(), v => { v[1].lifecycle.predecessor.path = 'docs/wrong.md'; }, v => { v[0].lifecycle.successors = []; }, v => { v[0].lifecycle.successors.push(reference(v[1])); }, v => { v[0].lifecycle.predecessor = reference(v[1]); v[1].lifecycle.successors = [reference(v[0])]; }, v => { v[0].lifecycle.successors = [reference(v[0])]; }]) {
    const value = structuredClone(records); edit(value); assert.throws(() => validateAdrFiles(value));
  }
  const branched = linkAdrSuccessor(records, f.record.id, fixture(3).record), replaced = change(branched, 'accept', child.record.id, event(20));
  assert.throws(() => change(replaced, 'accept', branched[2].id, event(21)));
  const corrupt = structuredClone(replaced); corrupt[0].lifecycle.supersededBy = reference(corrupt[2]); assert.throws(() => validateAdrFiles(corrupt));
});

test('ADR batch association checks every base then applies reciprocal records together and replays idempotently', () => {
  const f = fixture(), child = fixture(2), original = change([f.record], 'accept'), next = linkAdrSuccessor(original, f.record.id, child.record);
  const pairs = [{ base: original[0], record: next[0] }, { base: null, record: next[1] }];
  assert.deepEqual(associateAdrBatch(original, pairs), next); assert.deepEqual(associateAdrBatch(next, pairs), next);
  const conflicting = [{ ...original[0], sha256: 'b'.repeat(64) }]; assert.throws(() => associateAdrBatch(conflicting, pairs), /changed|conflict/i); assert.equal(conflicting.length, 1);
  assert.throws(() => associateAdrBatch(original, [pairs[0]])); assert.throws(() => associateAdrBatch(original, [pairs[1]]));
  assert.throws(() => associateAdrBatch(original, [...pairs, pairs[0]]));
  const moved = structuredClone(pairs); moved[0].record.path = 'docs/moved.md'; assert.throws(() => associateAdrBatch(original, moved));
});

for (const layout of ['metadata', 'heading', 'omitted']) test(`ADR ${layout} status changes preserve substantive Markdown and captured source bytes`, () => {
  const format = layout === 'metadata' ? defaultAdrFormat() : { ...defaultAdrFormat(), template: { kind: 'repository', path: 'template.md', sha256: 'b'.repeat(64) }, layout: parseAdrTemplate(`# Example\n${layout === 'heading' ? '## Status\n' : ''}## Context\n## Decision\n`) };
  const f = fixture(1, format), actor = { id: randomUUID(), displayName: 'Alice <script> λ' };
  const accepted = change([f.record], 'accept', f.record.id, event(19, actor))[0], output = transitionAdrMarkdown(f.content, f.record, accepted);
  const source = f.content.slice(f.content.indexOf('## Captured exploration sources'), f.content.indexOf(adrFileMarker(f.record.id)));
  assert.ok(output.includes(source)); assert.match(output, /> Status: accepted/); assert.doesNotMatch(output, /<script>/); assert.ok(output.endsWith(adrFileMarker(f.record.id) + '\n'));
  if (layout === 'metadata') assert.match(output, /^---\nstatus: "accepted"/); else if (layout === 'heading') assert.match(output, /## Status\n\naccepted\n/); else assert.doesNotMatch(output, /^---|## Status\n/m);
  assert.ok(output.includes(adrLifecycleFooter(accepted))); assert.match(output, /uncertainty/i);
  const stored = { ...accepted, sha256: adrBytesDigest(output) }, deprecated = change([stored], 'deprecate', stored.id, event(20))[0], later = transitionAdrMarkdown(output, stored, deprecated);
  assert.ok(later.includes(source)); assert.match(later, /> Status: deprecated/); assert.ok(later.includes(adrLifecycleFooter(deprecated))); assert.ok(!later.includes(adrLifecycleFooter(accepted)));
  assert.throws(() => transitionAdrMarkdown(f.content + 'Manual edit', f.record, accepted));
  assert.throws(() => transitionAdrMarkdown(output.replace('accepted', 'manual'), stored, deprecated));
});

test('new successor Markdown preserves proposed status and literals when its lifecycle footer is appended', () => {
  const f = fixture(), child = fixture(2), records = linkAdrSuccessor(change([f.record], 'accept'), f.record.id, child.record);
  const result = appendAdrLifecycle(child.content, records[1]);
  assert.match(result, /Status: proposed/); assert.ok(result.includes(adrLifecycleFooter(records[1]))); assert.ok(result.includes(child.content.slice(0, child.content.indexOf(adrFileMarker(child.record.id)))));
  assert.equal(appendAdrLifecycle(f.content, f.record), f.content); assert.throws(() => appendAdrLifecycle(result, records[1]));
  const full = child.content.replace(adrFileMarker(child.record.id), 'x'.repeat(65536) + adrFileMarker(child.record.id));
  assert.throws(() => appendAdrLifecycle(full, { ...records[1], sha256: adrBytesDigest(full) }), /64 KiB|limit/i);
});

test('lifecycle status rendering never rewrites status words or lookalike headings inside user reasoning', () => {
  const f = fixture();
  f.doc.adrDraft.sections.outcome[0].text = 'The proposed design remains a proposal.\n## Status\n\nproposed\n> Status: proposed.\n<script> λ';
  f.doc.adrDraft.sections.outcome[0].edited = true;
  const content = adrFileMarkdown(f.doc.adrDraft, f.record.id, null, f.record.sources), before = { ...f.record, sha256: adrBytesDigest(content) };
  const accepted = change([before], 'accept')[0], result = transitionAdrMarkdown(content, before, accepted);
  const decision = content.slice(content.indexOf('## Decision Outcome'), content.indexOf('\n> Status: proposed. Accepting'));
  assert.ok(result.includes(decision)); assert.match(result, /The proposed design remains a proposal/); assert.doesNotMatch(result, /<script>/);
  assert.throws(() => transitionAdrMarkdown(content, before, { ...accepted, title: 'Replaced decision' }), /successor|decision text/i);
});

test('lifecycle limits preserve original metadata instead of dropping relationships or attribution', () => {
  const f = fixture(), accepted = change([f.record], 'accept')[0], large = structuredClone(accepted.lifecycle);
  large.successors = Array.from({ length: 49 }, (_, i) => ({ id: randomUUID(), path: `${'界'.repeat(79)}/${'界'.repeat(79)}/${'界'.repeat(69)}${i}.md` }));
  assert.throws(() => validateAdrLifecycle(large, 'accepted'), /limit|bounded|lifecycle/i);
  const many = structuredClone(accepted.lifecycle); many.events.push(...Array.from({ length: 3 }, () => many.events[0])); assert.throws(() => validateAdrLifecycle(many, 'accepted'));
  const before = structuredClone(f.record); assert.throws(() => change([f.record], 'accept', f.record.id, { ...event(), actor: { id: randomUUID(), displayName: 'x'.repeat(97) } })); assert.deepEqual(f.record, before);
});
