import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';

test('private help HTTP is isolated, stale-safe and serialized with cleanup', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-help-protocol-')), runs = [], sends = [];
  const explorer = new Explorer({ file: join(dir, 'map.explore.json'), send: async value => sends.push(value), target: {},
    questionHelper: { run(operation, context, options) { return new Promise(resolve => { runs.push({ operation, context, ...options, resolve }); }); }, close() {} },
    cleaner: { run() { throw new Error('Cleanup should be blocked'); }, close() {} } });
  await explorer.command('start', { topic: 'Explore λ' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ question: 'What is λ?', category: 'Technical' }, { question: 'Other branch?', category: 'Other' }] });
  await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: [{ index: 0, question: 'What is λ?' }, { index: 1, question: 'Other branch?' }] });
  const server = await startServer(explorer, { close() {} });
  t.after(async () => { runs.forEach(run => run.resolve('Late')); await server.close(); await rm(dir, { recursive: true, force: true }); });
  const origin = new URL(server.url).origin, nodeId = explorer.doc.nodes[1].id;
  const post = (body, headers = {}) => fetch(server.url + 'api/question-help', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin, ...headers }, body: JSON.stringify(body) });
  const base = { id: randomUUID(), journey: explorer.doc.id, nodeId, operation: 'rephrase' };
  for (const headers of [{ Origin: '' }, { Origin: 'https://other.test' }, { 'X-Explorer-Client': '' }]) assert.equal((await post({ ...base, action: 'start' }, headers)).status, 403);
  for (const change of [{ operation: 'other' }, { nodeId: explorer.doc.rootId }, { journey: 'other' }, { text: 'browser context' }, { id: 'bad' }]) assert.equal((await post({ ...base, ...change, action: 'start' })).status, 400);
  assert.equal((await post({ ...base, action: 'start' })).status, 200); await delay(0);
  assert.equal(runs.length, 1); assert.equal(runs[0].operation, 'rephrase');
  assert.equal(runs[0].context.selected.question, 'What is λ?');
  assert.ok(!JSON.stringify(explorer.snapshot()).includes('Preparing question help'));
  const cleanup = { action: 'start', id: randomUUID(), journey: base.journey, nodeId, mutation: 0, text: 'Draft' };
  assert.equal((await fetch(server.url + 'api/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin }, body: JSON.stringify(cleanup) })).status, 400);
  const second = { ...base, id: randomUUID(), operation: 'example' };
  await post({ ...second, action: 'start' }); assert.equal(runs[0].signal.aborted, true); assert.equal(runs.length, 1);
  runs[0].resolve('old'); await delay(10); assert.equal(runs.length, 2);
  await post({ ...base, action: 'cancel' }); assert.equal(runs[1].signal.aborted, false);
  runs[1].resolve('Illustrative <b> example'); await delay(10);
  const result = await post({ ...second, action: 'poll' }).then(r => r.json());
  assert.equal(result.status, 'result'); assert.equal(result.text, 'Illustrative <b> example');
  assert.equal(result.context.selected.id, nodeId);
  const unrelated = JSON.parse(await readFile(explorer.file, 'utf8')); unrelated.nodes[2].answer = 'Other branch saved'; unrelated.nodes[2].answerState = 'tentative'; unrelated.revision++;
  await writeFile(explorer.file, JSON.stringify(unrelated));
  assert.equal((await post({ ...second, action: 'poll' }).then(r => r.json())).status, 'result', 'other branch disk edit is not an input dependency');
  assert.equal((await post({ action: 'check', journey: base.journey, nodeId, ids: [{ id: second.id, operation: second.operation }], context: runs[1].context })).status, 400, 'browser cannot provide replacement check context');
  assert.deepEqual((await post({ action: 'check', journey: base.journey, nodeId, ids: [{ id: second.id, operation: second.operation }] }).then(r => r.json())).staleIds, [], 'retained result survives unrelated committed edit');
  assert.equal(explorer.doc.nodes[1].answer, ''); assert.equal(explorer.doc.nodes[1].question, 'What is λ?');
  assert.equal(sends.length, 1, 'only initial attached question generation');
  const other = { ...base, id: randomUUID(), operation: 'terms' };
  await post({ ...other, action: 'start' }); await delay(0);
  const disk = JSON.parse(await readFile(explorer.file, 'utf8')); disk.nodes[1].question = 'Changed question?'; disk.revision++;
  await writeFile(explorer.file, JSON.stringify(disk));
  const stale = await post({ ...other, action: 'poll' }).then(r => r.json());
  assert.equal(stale.status, 'error'); assert.match(stale.error, /saved question context changed/i);
  assert.deepEqual((await post({ action: 'check', journey: base.journey, nodeId, ids: [{ id: second.id, operation: second.operation }] }).then(r => r.json())).staleIds, [second.id], 'retained result fails committed-source check');
  assert.equal(runs[2].signal.aborted, true);
  runs[2].resolve('Late');
  assert.equal((await post({ ...base, id: randomUUID(), action: 'start' })).status, 400, 'stale local canvas cannot start over changed disk source');
});

test('unconfirmed failed or timed-out shutdown blocks queued and new cross-feature work in both directions', async t => {
  for (const first of ['cleanup', 'help']) for (const stop of ['failed', 'timeout']) {
    const dir = await mkdtemp(join(tmpdir(), 'explorer-help-stop-'));
    let sourceSignal, releaseStop; const targetRuns = [];
    const releaseConfirmed = stop === 'failed' ? Promise.resolve(false) : new Promise(resolve => { releaseStop = resolve; });
    const failingRun = (_, options) => new Promise((_, reject) => {
      sourceSignal = options.signal;
      options.signal.addEventListener('abort', () => setTimeout(() => {
        const error = new Error('Helper cleanup failed.'); error.releaseConfirmed = releaseConfirmed; reject(error);
      }, 15), { once: true });
    });
    const targetRun = () => { targetRuns.push(1); return Promise.resolve('Safe result'); };
    const explorer = new Explorer({ file: join(dir, 'map.explore.json'), send: async () => {}, target: {},
      cleaner: { run: first === 'cleanup' ? failingRun : targetRun, close() {} },
      questionHelper: { run: first === 'help' ? (operation, context, options) => failingRun(operation, options) : targetRun, close() {} } });
    t.after(async () => { await explorer.close(); await rm(dir, { recursive: true, force: true }); });
    await explorer.command('start', { topic: 'Topic' });
    await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ question: 'Question?', category: 'A' }] });
    await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: [{ index: 0, question: 'Question?' }] });
    const common = { id: randomUUID(), journey: explorer.doc.id, nodeId: explorer.doc.nodes[1].id };
    const cleanup = { ...common, mutation: 0 }, help = { ...common, operation: 'rephrase' };
    const source = first === 'cleanup' ? () => explorer.cleanupRequest({ action: 'start', ...cleanup, text: 'Draft' }) : () => explorer.helpRequest({ action: 'start', ...help });
    const cancel = first === 'cleanup' ? () => explorer.cleanupRequest({ action: 'cancel', ...cleanup }) : () => explorer.helpRequest({ action: 'cancel', ...help });
    const target = first === 'cleanup' ? () => explorer.helpRequest({ action: 'start', ...help }) : () => explorer.cleanupRequest({ action: 'start', ...cleanup, text: 'Draft' });
    await source(); await delay(0); assert.ok(sourceSignal);
    await cancel(); await target(); await delay(35);
    assert.equal(targetRuns.length, 0, `${first} ${stop}: queued target cannot start after unconfirmed release`);
    await assert.rejects(target(), /not confirmed shutdown/);
    if (stop === 'timeout') { releaseStop(true); await delay(0); await target(); await delay(0); assert.equal(targetRuns.length, 1, 'confirmed late release allows an explicit retry'); }
    else { await delay(0); await assert.rejects(target(), /not confirmed shutdown/); }
  }
});

test('replacing the journey aborts help without exposing its late result', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-help-journey-')); let run;
  const explorer = new Explorer({ file: join(dir, 'map.explore.json'), send: async () => {}, target: {},
    questionHelper: { run(operation, context, options) { return new Promise(resolve => { run = { ...options, resolve }; }); }, close() {} } });
  t.after(async () => { run?.resolve('Late'); await explorer.close(); await rm(dir, { recursive: true, force: true }); });
  await explorer.command('start', { topic: 'First' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ question: 'Question?', category: 'A' }] });
  await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: [{ index: 0, question: 'Question?' }] });
  const request = { action: 'start', id: randomUUID(), journey: explorer.doc.id, nodeId: explorer.doc.nodes[1].id, operation: 'terms' };
  await explorer.helpRequest(request); await delay(0); assert.ok(run);
  await explorer.command('import', { revision: explorer.doc.revision, document: createDocument('Second') });
  assert.equal(run.signal.aborted, true); run.resolve('Late');
  assert.equal((await explorer.helpRequest({ ...request, action: 'poll' })).status, 'cancelled');
  assert.ok(!JSON.stringify(explorer.snapshot()).includes('Late'));
});

test('cross-feature retries wait for cancelled owned sessions to release in both directions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-help-owner-')), cleanupRuns = [], helpRuns = [];
  const explorer = new Explorer({ file: join(dir, 'map.explore.json'), send: async () => {}, target: {},
    cleaner: { run(text, options) { return new Promise(resolve => cleanupRuns.push({ ...options, resolve })); }, close() {} },
    questionHelper: { run(operation, context, options) { return new Promise(resolve => helpRuns.push({ ...options, resolve })); }, close() {} } });
  t.after(async () => { cleanupRuns.forEach(run => run.resolve('Clean')); helpRuns.forEach(run => run.resolve('Help')); await explorer.close(); await rm(dir, { recursive: true, force: true }); });
  await explorer.command('start', { topic: 'Topic' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ question: 'Question?', category: 'A' }] });
  await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: [{ index: 0, question: 'Question?' }] });
  const nodeId = explorer.doc.nodes[1].id, journey = explorer.doc.id;
  const c1 = { id: randomUUID(), journey, nodeId, mutation: 0 };
  const h1 = { id: randomUUID(), journey, nodeId, operation: 'rephrase' };
  await explorer.cleanupRequest({ action: 'start', ...c1, text: 'Draft' }); await delay(0);
  assert.equal(cleanupRuns.length, 1);
  await assert.rejects(explorer.helpRequest({ action: 'start', ...h1 }), /Cancel answer cleanup/);
  await explorer.cleanupRequest({ action: 'cancel', ...c1 });
  await explorer.helpRequest({ action: 'start', ...h1 }); await delay(15);
  assert.equal(helpRuns.length, 0, 'help cannot own a session before cancelled cleanup releases');
  cleanupRuns[0].resolve('Old cleanup'); await delay(15);
  assert.equal(helpRuns.length, 1);
  const c2 = { ...c1, id: randomUUID() };
  await assert.rejects(explorer.cleanupRequest({ action: 'start', ...c2, text: 'Draft' }), /Cancel question help/);
  await explorer.helpRequest({ action: 'cancel', ...h1 });
  await explorer.cleanupRequest({ action: 'start', ...c2, text: 'Draft' }); await delay(15);
  assert.equal(cleanupRuns.length, 1, 'cleanup cannot own a session before cancelled help releases');
  helpRuns[0].resolve('Old help'); await delay(15);
  assert.equal(cleanupRuns.length, 2);
  cleanupRuns[1].resolve('New cleanup');
});
