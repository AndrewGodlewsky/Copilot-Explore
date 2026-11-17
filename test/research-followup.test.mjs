import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDocument, addQuestions, research } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { prepareFollowup, followupResult, retainExchanges, parseFollowup, captureFollowup, sameFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';

const original = { basis: 'reasoning', summary: 'Compare', options: [{ title: 'Pilot', description: 'Small', pros: [], cons: [] }, { title: 'Launch', description: 'Large', pros: [], cons: [] }], recommendation: 'Pilot first', uncertainty: 'Unknown costs', sources: [], claims: [{ id: 'c1', text: 'Start small', basis: 'reasoning', evidence: [], limitations: 'Judgment' }] };
const result = { answer: 'A smaller pilot tests the assumption.', uncertainty: 'Hypothetical only.', sources: [], claims: original.claims };
function document() { const doc = createDocument('Garden'); addQuestions(doc, doc.rootId, [{ question: 'How big?', category: 'Size' }]); doc.nodes[1].research = structuredClone(original); return doc; }
test('follow-up prepares complete question and recommendation, bounded whole history and optional evidence', () => {
  const doc = document(), text = '🌿'.repeat(2000), prepared = prepareFollowup(doc, doc.nodes[1].id, { question: text, hypothetical: true });
  assert.equal(prepared.followup.question, text); assert.equal(prepared.followup.hypothetical, true);
  assert.equal(prepared.followup.recommendation, original.recommendation);
  assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
  assert.ok(prepared.bytes <= 131072); assert.ok(Object.isFrozen(prepared.followup));
  assert.throws(() => prepareFollowup(doc, doc.nodes[1].id, { question: text + 'x', hypothetical: true }), /4,000/);
  for (const question of ['', '  ', null]) assert.throws(() => prepareFollowup(doc, doc.nodes[1].id, { question, hypothetical: false }), /question/i);
  assert.throws(() => prepareFollowup(doc, doc.nodes[1].id, { question: 'Why?', hypothetical: 'yes' }), /hypothetical/i);
  const exchanges = Array.from({ length: 6 }, (_, i) => ({ id: randomUUID(), question: `Why ${i}?`, hypothetical: false, result }));
  assert.deepEqual(retainExchanges(exchanges).map(x => x.question), ['Why 2?', 'Why 3?', 'Why 4?', 'Why 5?']);
});
test('follow-up output rejects excess, unknown fields and unsupported source relations', () => {
  assert.deepEqual(followupResult(result), result);
  assert.throws(() => followupResult({ ...result, answer: 'x'.repeat(5001) }), /answer/i);
  assert.throws(() => followupResult({ ...result, surprise: true }), /follow-up/i);
  assert.throws(() => followupResult({ ...result, claims: [{ ...original.claims[0], basis: 'sources', evidence: [{ sourceId: 'absent', paraphrase: 'No' }] }] }), /source/i);
});
test('prior sources require included origin and IDs, preserve old metadata and remain separate from new read observations', () => {
  const doc = document(), source = { id: 's1', title: 'Old evidence', url: 'https://example.com/old', provenance: 'imported', retrievedAt: '2020-01-01T00:00:00.000Z' };
  doc.nodes[1].research.sources = [source];
  const prepared = prepareFollowup(doc, doc.nodes[1].id, { question: 'Why?', hypothetical: false });
  const raw = { ...result, sources: [{ id: 's1', prior: { origin: 'original', sourceId: 's1' } }], claims: [{ ...result.claims[0], basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Prior support' }] }] };
  const parsed = parseFollowup(JSON.stringify(raw), prepared, new Map());
  assert.deepEqual(parsed.sources[0], { ...source, evidenceOrigin: { origin: 'original', sourceId: 's1' } });
  assert.throws(() => parseFollowup(JSON.stringify(raw), { followup: { original: [], exchanges: [] } }, new Map()), /not included/);
  raw.sources[0].prior.origin = randomUUID(); assert.throws(() => parseFollowup(JSON.stringify(raw), prepared, new Map()), /not included/);
  raw.sources = [{ id: 's1', title: 'New', url: source.url }]; assert.throws(() => parseFollowup(JSON.stringify(raw), prepared, new Map()), /successfully read/);
  const now = '2026-11-17T13:00:00.000Z'; const fetched = parseFollowup(JSON.stringify(raw), prepared, new Map([[source.url, now]]));
  assert.equal(fetched.sources[0].retrievedAt, now); assert.equal(fetched.sources[0].evidenceOrigin.origin, 'current');
  const exchange = { id: randomUUID(), question: 'Earlier?', hypothetical: true, result: parsed };
  const repeated = prepareFollowup(doc, doc.nodes[1].id, { question: 'Again?', hypothetical: false }, { history: { id: 'history', exchanges: [exchange], dropped: 2 } });
  raw.sources = [{ id: 's1', prior: { origin: exchange.id, sourceId: 's1' } }]; assert.equal(parseFollowup(JSON.stringify(raw), repeated, new Map()).sources[0].retrievedAt, source.retrievedAt);
  assert.equal(repeated.followup.coverage.previouslyDropped, 2);
});
test('large original records and exchanges omit whole with accurate measured coverage, mandatory overflow rejects', () => {
  const doc = document(); doc.nodes[1].answer = 'a'.repeat(20000);
  doc.nodes[1].research.sources = Array.from({ length: 15 }, (_, i) => ({ id: `s${i}`, title: 'x'.repeat(300), url: 'https://example.com/' + 'a'.repeat(1900) + i, provenance: 'imported', retrievedAt: null }));
  doc.nodes[1].research.claims = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, text: '\0'.repeat(1000), basis: 'reasoning', evidence: [], limitations: '\0'.repeat(1000) }));
  doc.nodes[1].research.basis = 'sources'; research(doc.nodes[1].research);
  const history = { exchanges: Array.from({ length: 4 }, () => ({ id: randomUUID(), question: 'q'.repeat(4000), hypothetical: false, result: { ...result, answer: '界'.repeat(5000) } })) };
  const prepared = prepareFollowup(doc, doc.nodes[1].id, { question: 'Current question', hypothetical: true }, { history });
  assert.ok(prepared.followup.coverage.originalOmitted > 0); assert.ok(!prepared.followup.original.some(item => item.kind === 'evidence'));
  assert.equal(prepared.followup.coverage.originalIncluded + prepared.followup.coverage.originalOmitted, 5);
  assert.equal(prepared.followup.coverage.exchangesIncluded + prepared.followup.coverage.exchangesOmitted, 4);
  assert.ok(prepared.bytes <= 131072); assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
  assert.ok(Buffer.byteLength(JSON.stringify(retainExchanges(history.exchanges))) <= 65536);
  const captured = captureFollowup(prepared); assert.ok(!JSON.stringify(captured).includes('Current question')); assert.ok(sameFollowup(captured, doc, doc.nodes[1].id));
  doc.updatedAt = new Date().toISOString(); assert.ok(sameFollowup(captured, doc, doc.nodes[1].id));
  doc.nodes[1].research.recommendation += ' Changed'; assert.equal(sameFollowup(captured, doc, doc.nodes[1].id), false);
  doc.nodes[1].answer = '\0'.repeat(20000); doc.nodes[1].research.recommendation = '\0'.repeat(5000);
  assert.throws(() => prepareFollowup(doc, doc.nodes[1].id, { question: '\0'.repeat(4000), hypothetical: false }), /mandatory/);
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-followup-')), file = join(dir, 'map.explore.json'), doc = document(), runs = [];
  await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file, researcher: { runFollowup(context, options) { return new Promise((resolve, reject) => runs.push({ context, ...options, resolve, reject })); } } }).load();
  t.after(async () => { for (const run of runs) run.resolve(result); await e.close(); await rm(dir, { recursive: true, force: true }); });
  let sequence = 0; const clientId = randomUUID();
  const review = question => e.reviewResearch({ action: 'prepare', journey: doc.id, nodeId: doc.nodes[1].id, scope: 'decisions', excluded: [], clientId, sequence: ++sequence, followup: { question, hypothetical: true } });
  const start = value => e.command('research-follow-up', { journey: doc.id, nodeId: doc.nodes[1].id, token: value.token });
  const settle = async () => { await new Promise(setImmediate); await Promise.all([...e.researchTasks]); };
  return { e, file, doc, runs, review, start, settle };
}
test('follow-up history is transient, exact reviewed work and completion preserve saved document', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), review = await f.review('What if the budget doubles?');
  await f.start(review); await new Promise(setImmediate);
  assert.equal(f.runs[0].prepared.prompt, review.prepared.prompt);
  f.runs[0].resolve(result); await f.settle();
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.e.uiSnapshot().followup.exchanges.length, 1);
  assert.equal(f.e.snapshot().followup, undefined);
  const again = await f.review('Why?'); assert.equal(again.prepared.followup.exchanges.length, 1);
  await assert.rejects(f.e.command('research', { journey: f.doc.id, nodeId: f.doc.nodes[1].id, token: again.token }), /follow-up|purpose/i);
});
test('late cancelled work cannot enter a replacement, relevant changes mark existing exchanges historical', async t => {
  const f = await fixture(t); await f.start(await f.review('Why?')); await new Promise(setImmediate);
  await f.e.command('cancel'); const replacement = await f.review('Why now?'); await f.start(replacement);
  f.runs[0].resolve(result); await new Promise(setImmediate); await new Promise(setImmediate);
  assert.equal(f.runs.length, 2); f.runs[1].resolve(result); await f.settle();
  assert.equal(f.e.uiSnapshot().followup.exchanges[0].question, 'Why now?');
  await f.e.command('answer', { nodeId: f.doc.nodes[1].id, answer: 'Changed committed answer', revision: f.e.doc.revision });
  assert.equal(f.e.uiSnapshot().followup.historical, true);
});
test('shared actual-release queue gates follow-up and research in both directions, including unconfirmed shutdown', async t => {
  for (const reverse of [false, true]) {
    const f = await fixture(t); f.e.researcher.run = f.e.researcher.runFollowup;
    const ordinary = async () => {
      const review = await f.e.reviewResearch({ action: 'prepare', journey: f.doc.id, nodeId: f.doc.nodes[1].id, scope: 'decisions', excluded: [], clientId: randomUUID(), sequence: 1 });
      await f.e.command('research', { journey: f.doc.id, nodeId: f.doc.nodes[1].id, token: review.token });
    };
    const followup = async () => f.start(await f.review('Why?'));
    await (reverse ? ordinary() : followup()); await new Promise(setImmediate); await f.e.command('cancel');
    await (reverse ? followup() : ordinary()); await new Promise(setImmediate); assert.equal(f.runs.length, 1);
    let release; f.runs[0].reject(Object.assign(Error('Shutdown incomplete'), { releaseConfirmed: new Promise(resolve => { release = resolve; }) }));
    await f.settle(); assert.equal(f.runs.length, 1); assert.match(f.e.error, /shutdown/);
    await assert.rejects(followup(), /shutdown/); await assert.rejects(ordinary(), /shutdown/);
    release(true); await new Promise(setImmediate); await followup(); await new Promise(setImmediate);
    assert.equal(f.runs.length, 2); f.runs[1].resolve(result); await f.settle(); assert.equal(f.e.uiSnapshot().followup.exchanges.length, 1);
  }
});
test('earlier transmitted dependencies remain fresh across exclusions; metadata edits preserve history; replacement starts a new chain', async t => {
  const f = await fixture(t); await f.start(await f.review('Why?')); await new Promise(setImmediate); f.runs[0].resolve(result); await f.settle();
  const stableId = f.e.followup.id; const disk = JSON.parse(await readFile(f.file, 'utf8')); disk.revision++; disk.updatedAt = new Date().toISOString(); await writeFile(f.file, JSON.stringify(disk));
  const reviewed = await f.review('Again?'); assert.equal(reviewed.prepared.followup.exchanges.length, 1); assert.equal(f.e.followup.id, stableId);
  disk.nodes[0].answer = 'A changed ancestor'; disk.revision++; await writeFile(f.file, JSON.stringify(disk));
  await assert.rejects(f.start(reviewed), /changed/); assert.equal(f.runs.length, 1);
  const fresh = await f.review('Under the change?'); assert.equal(fresh.prepared.followup.exchanges.length, 0); assert.equal(f.e.followup.historical, true);
  disk.nodes[1].research.recommendation = 'A replacement recommendation'; disk.revision++; await writeFile(f.file, JSON.stringify(disk));
  await assert.rejects(f.start(fresh), /research changed/);
  const replacement = await f.review('Why the replacement?'); assert.equal(replacement.prepared.followup.recommendation, 'A replacement recommendation'); assert.equal(replacement.prepared.followup.exchanges.length, 0);
  await f.start(replacement); await new Promise(setImmediate); f.runs[1].resolve(result); await f.settle();
  assert.equal(f.e.followup.exchanges.length, 1); assert.equal(f.e.followup.exchanges[0].question, 'Why the replacement?');
  const reopened = await new Explorer({ file: f.file }).load(); assert.equal(reopened.uiSnapshot().followup, null); await reopened.close();
});
test('raw output and retained serialized exchanges enforce exact byte and character boundaries including escapes', () => {
  const doc = document(), prepared = prepareFollowup(doc, doc.nodes[1].id, { question: 'Why?', hypothetical: false });
  const base = JSON.stringify(result);
  for (const extra of [-1, 0]) assert.deepEqual(parseFollowup(base + ' '.repeat(12000 - base.length + extra), prepared, new Map()), result);
  assert.throws(() => parseFollowup(base + ' '.repeat(12001 - base.length), prepared, new Map()), /output limit/);
  const wide = { ...result, answer: '界'.repeat(5000), uncertainty: '界'.repeat(3000) }, encoded = JSON.stringify(wide);
  const padding = 24576 - Buffer.byteLength(encoded); assert.ok(padding >= 0);
  assert.deepEqual(parseFollowup(encoded + ' '.repeat(padding), prepared, new Map()), wide);
  assert.throws(() => parseFollowup(encoded + ' '.repeat(padding + 1), prepared, new Map()), /output limit/);
  const make = length => [{ id: randomUUID(), question: '\0'.repeat(4000), hypothetical: false, result: { ...result, answer: 'x'.repeat(length) } }];
  const overhead = Buffer.byteLength(JSON.stringify(make(0))); const exact = make(65536 - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), 65536); assert.equal(retainExchanges(exact).length, 1);
  exact[0].result.answer += 'x'; assert.deepEqual(retainExchanges(exact), []);
});
for (const boundary of ['review consumption', 'helper completion']) {
  for (const change of ['sent source', 'original research', 'unrelated metadata']) {
    test(`${boundary} reconciles retained follow-ups after disk changes to ${change}`, async t => {
      const f = await fixture(t);
      await f.start(await f.review('First question')); await new Promise(setImmediate);
      f.runs[0].resolve(result); await f.settle();
      const retained = structuredClone(f.e.uiSnapshot().followup.exchanges);
      const reviewed = await f.review('Second question');
      if (boundary === 'helper completion') { await f.start(reviewed); await new Promise(setImmediate); }
      const originalDisk = JSON.parse(await readFile(f.file, 'utf8')), disk = structuredClone(originalDisk);
      disk.revision++; disk.updatedAt = '2026-11-17T23:00:00.000Z';
      if (change === 'sent source') disk.nodes[1].answer = 'A newly committed constraint';
      if (change === 'original research') disk.nodes[1].research.recommendation = 'A replacement recommendation';
      const changedBytes = JSON.stringify(disk); await writeFile(f.file, changedBytes);
      const relevant = change !== 'unrelated metadata';
      if (boundary === 'review consumption') {
        if (relevant) { await assert.rejects(f.start(reviewed), /changed/); assert.equal(f.runs.length, 1); }
        else { await f.start(reviewed); await new Promise(setImmediate); }
      }
      if (boundary === 'helper completion' || !relevant) { f.runs[1].resolve(result); await f.settle(); }
      const snapshot = f.e.uiSnapshot();
      assert.equal(snapshot.pending, null);
      assert.equal(await readFile(f.file, 'utf8'), changedBytes);
      if (!relevant) {
        assert.equal(snapshot.followup.historical, false);
        assert.deepEqual(snapshot.followup.exchanges[0], retained[0]);
        assert.equal(snapshot.followup.exchanges.length, 2);
        assert.equal(snapshot.followup.exchanges[1].question, 'Second question');
        assert.equal(f.e.doc.revision, disk.revision); assert.equal(f.e.error, '');
        return;
      }
      if (boundary === 'helper completion') assert.match(f.e.error, /changed.*discarded/);
      assert.deepEqual(snapshot.followup.exchanges, retained);
      assert.equal(snapshot.followup.historical, true);
      originalDisk.revision = disk.revision + 1;
      const reversedBytes = JSON.stringify(originalDisk); await writeFile(f.file, reversedBytes);
      await f.e.command('refresh-answer', { revision: f.e.doc.revision });
      assert.equal(f.e.uiSnapshot().followup.historical, true);
      assert.deepEqual(f.e.uiSnapshot().followup.exchanges, retained);
      const afterReversal = await f.review('After content reversal');
      assert.equal(afterReversal.prepared.followup.exchanges.length, 0);
      assert.equal(await readFile(f.file, 'utf8'), reversedBytes);
    });
  }
}
test('source fingerprint union keeps earlier dependencies under its explicit count and byte bounds', () => {
  const doc = document(); addQuestions(doc, doc.rootId, [{ question: 'Earlier source?', category: 'Other' }]); doc.nodes[2].answer = 'Used earlier';
  const first = prepareFollowup(doc, doc.nodes[1].id, { question: 'First?', hypothetical: false });
  const second = prepareFollowup(doc, doc.nodes[1].id, { question: 'Second?', hypothetical: false }, { excluded: [doc.nodes[2].id], history: { id: 'history', exchanges: [], dependencies: first.followupDependencies } });
  assert.ok(!second.prompt.includes('Used earlier')); assert.ok(sameFollowup(second.followupDependencies, doc, doc.nodes[1].id));
  assert.equal(second.coverage.followupTracking.records, 3); assert.ok(second.coverage.followupTracking.bytes <= 4194304);
  doc.nodes[2].answer = 'Changed'; assert.equal(sameFollowup(second.followupDependencies, doc, doc.nodes[1].id), false);
  const tooMany = { records: Array.from({ length: 5001 }, (_, i) => [`source-${i}`, '0'.repeat(64)]) };
  assert.throws(() => prepareFollowup(doc, doc.nodes[1].id, { question: 'Overflow?', hypothetical: false }, { history: { exchanges: [], dependencies: tooMany } }), /source tracking exceeds/);
});
test('successful research rerun makes follow-ups historical even when the comparison is identical', async t => {
  const f = await fixture(t), initial = structuredClone(f.e.doc); initial.nodes[1].research.settings = { depth: 'standard', sourceFocus: 'balanced', recency: 'any' }; await f.e.save(initial);
  await f.start(await f.review('Why?')); await new Promise(setImmediate); f.runs[0].resolve(result); await f.settle();
  f.e.researcher.run = async () => original;
  const value = await f.e.reviewResearch({ action: 'prepare', journey: f.doc.id, nodeId: f.doc.nodes[1].id, scope: 'decisions', excluded: [], clientId: randomUUID(), sequence: 1 });
  await f.e.command('research', { journey: f.doc.id, nodeId: f.doc.nodes[1].id, token: value.token }); await f.settle();
  assert.equal(f.e.followup.historical, true);
});
