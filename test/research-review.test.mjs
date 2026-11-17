import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareResearch, sameResearchSources } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { prepareAnswerCheck, captureCheck, checkFreshness } from '../com.github.copilot/extensions/explorer/answer-check.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { ResearchReviewClient } from '../com.github.copilot/extensions/explorer/web/research-review-client.mjs';
import { ResearchReview, REVIEW_TTL } from '../com.github.copilot/extensions/explorer/research-review.mjs';

function document() {
  const doc = createDocument('Review \ud83c\udf3f');
  addQuestions(doc, doc.rootId, [{ question: 'Selected?', category: 'Target' }, { question: 'Optional?', category: 'Other' }]);
  doc.nodes[2].answer = 'EXCLUDED-CANARY\u0000\n\ud83c\udf3f<script>';
  return doc;
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-review-')), file = join(dir, 'map.explore.json'), doc = document(), runs = [];
  await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file, researcher: { run(context, options) { runs.push({ context, ...options }); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('Cancelled')))); } } }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  let sequence = 0; const clientId = randomUUID();
  const input = extra => ({ action: 'prepare', journey: doc.id, nodeId: doc.nodes[1].id, scope: 'decisions', excluded: [], clientId, sequence: ++sequence, ...extra });
  const review = extra => e.reviewResearch(input(extra));
  const start = value => e.command('research', { journey: doc.id, nodeId: doc.nodes[1].id, token: value.token });
  return { e, file, doc, runs, input, review, start };
}
test('optional exclusions remove exact text and dependencies, never mandatory context', () => {
  const doc = document(), optional = doc.nodes[2], target = doc.nodes[1];
  const prepared = prepareResearch(doc, target.id, { excluded: [optional.id, doc.rootId] });
  assert.equal(prepared.prompt.includes('EXCLUDED-CANARY'), false);
  assert.deepEqual(prepared.dependencies.records.map(n => n.id), [target.id]);
  assert.equal(prepared.coverage.omitted.excluded, 2);
  optional.answer = 'Changed excluded'; assert.ok(sameResearchSources(prepared.dependencies, doc));
  assert.throws(() => prepareResearch(doc, target.id, { excluded: [target.id] }), /required|mandatory/i);
});
test('answer check captures and compares its actual fixed sent scope', () => {
  const doc = document(), prepared = prepareAnswerCheck(doc), captured = captureCheck(prepared);
  assert.equal(captured.scope, prepared.context.scope); assert.ok(checkFreshness(captured, doc));
  assert.equal(checkFreshness({ ...captured, scope: 'path' }, doc), false);
});
test('start consumes one reviewed immutable payload, rejects legacy starts and permits unrelated disk changes', async t => {
  const f = await fixture(t);
  await assert.rejects(f.start({}), /review/i);
  const native = f.e.snapshot(), review = await f.review({ excluded: [f.doc.nodes[2].id] });
  assert.deepEqual(f.e.snapshot(), native); assert.equal(f.runs.length, 0);
  const disk = structuredClone(f.doc); disk.nodes[2].answer = 'UNRELATED'; disk.revision++;
  await writeFile(f.file, JSON.stringify(disk));
  await f.start(review); await new Promise(setImmediate);
  assert.equal(f.runs[0].prepared.prompt, review.prepared.prompt);
  assert.equal(f.runs[0].prepared.instructions, review.prepared.instructions);
  assert.ok(Object.isFrozen(f.runs[0].prepared.context));
  assert.ok(!f.runs[0].prepared.prompt.includes('EXCLUDED-CANARY'));
  await f.e.command('cancel'); await assert.rejects(f.start(review), /review/i);
});
test('source changes require an explicit fresh review; old, replaced, cross-journey and cancelled tokens cannot send', async t => {
  const f = await fixture(t), old = await f.review(), next = await f.review();
  await assert.rejects(f.start(old), /review/i);
  await assert.rejects(f.e.command('research', { journey: 'wrong', nodeId: f.doc.nodes[1].id, token: next.token }), /review/i);
  const current = await f.review(); const disk = structuredClone(f.doc); disk.nodes[1].answer = 'New source'; disk.revision++;
  await writeFile(f.file, JSON.stringify(disk)); await assert.rejects(f.start(current), /changed.*refresh|refresh.*review/i);
  assert.equal(f.runs.length, 0);
  const refresh = await f.review(); assert.ok(refresh.prepared.prompt.includes('New source'));
  await f.e.reviewResearch(f.input({ action: 'cancel' })); await assert.rejects(f.start(refresh), /review/i);
  const late = f.input(), newest = f.input(); await f.e.reviewResearch(newest);
  await assert.rejects(f.e.reviewResearch(late), /obsolete/i); assert.equal(f.runs.length, 0);
});
test('review HTTP uses strict Origin, bounded bodies and no public polling changes', async t => {
  const f = await fixture(t), server = await startServer(f.e, { status: async () => ({ ready: false }), close() {} });
  t.after(() => server.close()); const origin = new URL(server.url).origin;
  const post = (input, extra = {}) => fetch(server.url + 'api/research-review', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin, ...extra }, body: JSON.stringify(input) });
  assert.equal((await post(f.input(), { Origin: 'https://wrong.example' })).status, 403);
  const before = await (await fetch(server.url + 'api/state')).json();
  const response = await post(f.input()); assert.equal(response.status, 200); const raw = await response.text();
  assert.ok(Buffer.byteLength(raw) <= 1024 * 1024); assert.ok(JSON.parse(raw).token);
  assert.deepEqual(await (await fetch(server.url + 'api/state')).json(), before);
  assert.equal((await post({ ...f.input(), extra: 'x' })).status, 400);
  assert.equal((await post({ ...f.input(), excluded: ['x'.repeat(600000)] })).status, 400);
});

test('cancel before prepare arrival leaves a bounded tombstone; a newer prepare can replace it', async t => {
  const f = await fixture(t), late = f.input(), cancel = f.input({ action: 'cancel' });
  await f.e.reviewResearch(cancel); await assert.rejects(f.e.reviewResearch(late), /obsolete/);
  const review = await f.review(); assert.ok(review.token);
  await assert.rejects(f.e.reviewResearch(cancel), /obsolete/); await f.start(review);
  await new Promise(setImmediate); assert.equal(f.runs.length, 1);
});
test('expiry, destination changes, closed preparation and in-flight cancellation never authorize research', async t => {
  const f = await fixture(t), expired = await f.review();
  assert.ok(expired.expiresAt <= Date.now() + REVIEW_TTL); f.e.researchReview.current.expiresAt = Date.now() - 1;
  await assert.rejects(f.start(expired), /obsolete/);
  const review = await f.review(), disk = structuredClone(f.doc);
  disk.nodes[1].research = { basis: 'reasoning', summary: 'Other result', options: [{ title: 'A', description: 'A', pros: [], cons: [] }, { title: 'B', description: 'B', pros: [], cons: [] }], recommendation: 'A', uncertainty: 'Unknown', sources: [] };
  disk.revision++; await writeFile(f.file, JSON.stringify(disk));
  await assert.rejects(f.start(review), /saved research changed/); assert.equal(f.runs.length, 0);
  const state = new ResearchReview(); let resolve;
  const explorer = { doc: f.doc, file: f.file, activeKey: null, readCurrent: () => new Promise(r => { resolve = r; }) };
  const input = f.input(), preparing = state.prepare(explorer, input);
  await state.prepare(explorer, { ...input, action: 'cancel', sequence: input.sequence + 1 }); resolve(f.doc);
  await assert.rejects(preparing, /obsolete/); assert.equal(state.current, null);
  const next = state.prepare(explorer, { ...input, sequence: input.sequence + 2 }); explorer.closed = true; resolve(f.doc);
  await assert.rejects(next, /obsolete/); assert.equal(state.current, null);
});
test('review measures transport separately under escaping and rejects oversized exclusions', async t => {
  const f = await fixture(t), doc = structuredClone(f.doc);
  doc.nodes[1].answer = '\u0000'.repeat(18000) + '\ud83c\udf3f';
  doc.revision++;
  await writeFile(f.file, JSON.stringify(doc)); const review = await f.review();
  assert.equal(review.prepared.context.path.at(-1).answer, doc.nodes[1].answer);
  assert.ok(Buffer.byteLength(JSON.stringify(review)) > review.prepared.bytes);
  assert.ok(review.prepared.bytes <= 131072); assert.ok(Buffer.byteLength(JSON.stringify(review)) <= 1048576);
  assert.equal(review.prepared.bytes, Buffer.byteLength(review.prepared.instructions) + Buffer.byteLength(review.prepared.prompt));
  await assert.rejects(f.review({ excluded: Array(5001).fill('x') }), /Invalid/);
  await assert.rejects(f.review({ excluded: [f.doc.nodes[2].id, f.doc.nodes[2].id] }), /Invalid/);
  doc.nodes[1].answer = '\u0000'.repeat(20000); doc.objective = '\u0000'.repeat(2000);
  await writeFile(f.file, JSON.stringify(doc)); await assert.rejects(f.review(), /mandatory/);
});
test('client ignores late previews after close and rapid replacement, preserving newest choices', async () => {
  const requests = [], client = new ResearchReviewClient({ changed() {}, fetch: (url, options) => {
    const input = JSON.parse(options.body); let resolve; const promise = new Promise(r => { resolve = r; }); requests.push({ input, resolve }); return promise;
  } });
  const context = { journey: 'journey', nodeId: 'target', scope: 'decisions' };
  const respond = request => request.resolve({ ok: true, json: async () => ({ ...request.input, token: String(request.input.sequence) }) });
  client.open(context); const first = requests[0]; client.close(); respond(first); await new Promise(setImmediate); assert.equal(client.value, null);
  client.open(context); const second = requests.at(-1); client.exclude('optional', true); const third = requests.at(-1);
  respond(third); await new Promise(setImmediate); assert.deepEqual(client.value.excluded, ['optional']);
  respond(second); await new Promise(setImmediate); assert.deepEqual(client.value.excluded, ['optional']);
  client.close(); for (const request of requests) respond(request);
});

test('transport response cap rejects escaped exclusion IDs without retaining a payload', async () => {
  const doc = document(), excluded = [];
  for (let i = 0; i < 2500; i++) {
    const id = String(i).padStart(4, '0') + '\u0000'.repeat(96); excluded.push(id);
    doc.nodes.push({ ...doc.nodes[2], id });
  }
  const review = new ResearchReview(), explorer = { doc, file: 'map', activeKey: null, readCurrent: async () => doc };
  await assert.rejects(review.prepare(explorer, { action: 'prepare', clientId: randomUUID(), sequence: 1, journey: doc.id, nodeId: doc.nodes[1].id, scope: 'decisions', excluded }), /1 MiB response limit/);
  assert.equal(review.current, null);
});

test('exclusions preserve mandatory limit boundaries and omit complete optional records', () => {
  const doc = document(), target = doc.nodes[1], excluded = [doc.rootId, doc.nodes[2].id]; target.answer = '\ud83c\udf3f\u0000\n';
  const base = prepareResearch(doc, target.id, { excluded, instructions: 'fixed' });
  for (const delta of [-1, 0, 1]) {
    const options = { excluded, instructions: 'fixed', prefix: 'x'.repeat(base.limit - base.bytes + delta) };
    if (delta > 0) assert.throws(() => prepareResearch(doc, target.id, options), /mandatory/);
    else { const result = prepareResearch(doc, target.id, options); assert.equal(result.bytes, result.limit + delta); assert.equal(result.context.path[0].answer, target.answer); assert.deepEqual(result.context.decisionsElsewhere, []); }
  }
});
