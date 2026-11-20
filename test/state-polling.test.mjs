import { fixtureResearchModels } from './helpers/research-model.mjs';
import { startResearch } from './helpers/research-review.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { makeFixture, fixtureSpecs } from '../scripts/perf-fixtures.mjs';
import { QuestionHelpClient } from '../com.github.copilot/extensions/explorer/web/question-help-client.mjs';

test('conditional HTTP avoids large-map clone serialization transfer and parse and rejects unknown cursors', async t => {
  const explorer = new Explorer({ target: {} });
  explorer.doc = makeFixture(fixtureSpecs.find(spec => spec.name === 'near9mib-wide')).document;
  const server = await startServer(explorer, { close() {} });
  t.after(() => server.close());
  let clones = 0, serializations = 0, parses = 0;
  const snapshot = explorer.snapshot.bind(explorer), stringify = JSON.stringify;
  explorer.snapshot = () => { clones++; return snapshot(); };
  JSON.stringify = function(value, ...args) { if (value?.document?.nodes) serializations++; return stringify(value, ...args); };
  t.after(() => { JSON.stringify = stringify; });
  const read = async cursor => {
    const response = await fetch(server.url + 'api/state', { headers: cursor ? { 'X-Explorer-State': cursor } : {} });
    const body = await response.text();
    const data = body ? (parses++, JSON.parse(body)) : null;
    return { response, data, bytes: Buffer.byteLength(body), cursor: response.headers.get('X-Explorer-State') };
  };
  const full = await read(); assert.equal(full.response.status, 200); assert.ok(full.bytes > 8_000_000); assert.ok(full.cursor);
  assert.deepEqual([clones, serializations, parses], [1, 1, 1]);
  for (let i = 0; i < 3; i++) {
    const unchanged = await read(full.cursor); assert.equal(unchanged.response.status, 204); assert.equal(unchanged.bytes, 0);
    assert.equal(unchanged.cursor, full.cursor); assert.equal(unchanged.response.headers.get('cache-control'), 'no-store');
  }
  assert.deepEqual([clones, serializations, parses], [1, 1, 1]);
  for (const cursor of ['invalid', 'a'.repeat(200), '00000000-0000-4000-8000-000000000000']) assert.equal((await read(cursor)).response.status, 200);
  explorer.pending = { id: 'pending', kind: 'research', progress: 'Preparing' };
  const transient = await read(full.cursor); assert.equal(transient.response.status, 200); assert.notEqual(transient.cursor, full.cursor);
  explorer.pending.progress = 'Reading sources'; assert.equal((await read(transient.cursor)).data.pending.progress, 'Reading sources');
  explorer.pending = null; explorer.error = 'Research failed'; const failed = await read(transient.cursor); assert.equal(failed.data.error, 'Research failed');
  explorer.doc = { ...explorer.doc, topic: 'Changed content', revision: explorer.doc.revision + 1 };
  const edited = await read(failed.cursor); assert.equal(edited.data.document.topic, 'Changed content');
  explorer.doc = { ...explorer.doc, id: 'another-journey' }; const switched = await read(edited.cursor);
  assert.equal(switched.data.document.revision, edited.data.document.revision); assert.notEqual(switched.cursor, edited.cursor);
  assert.equal((await read(full.cursor)).response.status, 200, 'old cursors are never replayed');
  assert.ok(explorer.snapshot().document); assert.equal('cursor' in explorer.snapshot(), false, 'native contract remains complete and separate');
});

test('conditional preflight notices preview staleness coverage and source replacement without serializing maps', () => {
  const e = new Explorer({ target: {} }); e.doc = makeFixture(fixtureSpecs[0]).document;
  const read = cursor => e.pollSnapshot(cursor);
  let state = read(); assert.ok(state.snapshot);
  e.preview = { id: 'batch', questions: [], stale: false }; e.questionSource = {};
  state = read(state.cursor); assert.equal(state.snapshot.preview.stale, true);
  assert.equal(read(state.cursor).snapshot, null);
  e.preview.stale = true; state = read(state.cursor); assert.ok(state.snapshot);
  e.contextCoverage = { journey: e.doc.id, bytes: 10 }; state = read(state.cursor); assert.equal(state.snapshot.contextCoverage.bytes, 10);
  e.questionSource = { journey: 'changed' }; state = read(state.cursor); assert.ok(state.snapshot);
  e.preview = null; state = read(state.cursor); assert.equal(state.snapshot.preview, null);
  e.cleanup = { private: 'draft' }; e.help = { private: 'result' }; assert.equal(read(state.cursor).snapshot, null);
});

test('older retained-help rejection only removes captured IDs and preserves same-node replacements', async () => {
  let reject; let changes = 0;
  const client = new QuestionHelpClient({ fetch: () => new Promise((_, fail) => { reject = fail; }), context: () => ({ journey: 'j', nodeId: 'n' }), source: () => ({}), changed: () => changes++ });
  client.selection = client.context(); client.sync = () => {};
  client.results.set('rephrase', { id: 'old' }); client.results.set('terms', { id: 'old-terms' });
  const checking = client.checkRetained(); client.results.set('rephrase', { id: 'new' }); reject(new Error('timeout'));
  await checking; assert.equal(client.results.get('rephrase')?.id, 'new'); assert.equal(client.results.has('terms'), false); assert.equal(changes, 1);
});
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';

test('conditional snapshots follow real preview accept dismiss stale cancellation research and partial history commits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-conditional-')); let work;
  const e = new Explorer({ file: join(directory, 'map.explore.json'), target: {}, send: async () => {}, researcher: { models: fixtureResearchModels,
    run(context, options) { return new Promise((resolve, reject) => { work = { resolve, reject, ...options }; options.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }); }); },
  } });
  const server = await startServer(e, { close() {} });
  t.after(async () => { await server.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  let cursor;
  const read = async changed => { const response = await fetch(server.url + 'api/state', { headers: cursor ? { 'X-Explorer-State': cursor } : {} }); assert.equal(response.status, changed ? 200 : 204); cursor = response.headers.get('X-Explorer-State'); return changed ? response.json() : null; };
  const command = (action, input = {}) => e.command(action, { revision: e.doc?.revision, ...input });
  await read(true); await command('start', { topic: 'Conditional lifecycle' }); assert.ok((await read(true)).pending);
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'First question?', category: 'Scope' }] });
  let next = await read(true); assert.equal(next.preview.stale, false); assert.equal(next.pending, null); await read(false);
  await command('accept-questions', { batchId: e.preview.id, selected: [{ index: 0, question: 'First question?' }] }); next = await read(true); assert.equal(next.preview, null);
  const nodeId = e.doc.nodes[1].id;
  await command('answer', { nodeId, answer: 'Saved input' }); await read(true);
  await command('questions', { nodeId }); await read(true);
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'Second question?', category: 'Scope' }] }); await read(true);
  const updated = structuredClone(e.doc); updated.objective = 'Different objective'; await e.save(updated); assert.equal((await read(true)).preview.stale, true);
  await command('dismiss-questions', { batchId: e.preview.id }); assert.equal((await read(true)).preview, null);
  await command('questions', { nodeId }); const obsolete = e.pending.id; await read(true); await command('cancel'); assert.equal((await read(true)).pending, null);
  await command('questions', { nodeId }); await read(true); await assert.rejects(e.receive('questions', { requestId: obsolete, questions: [] }), /cancelled|replaced/); await read(false);
  await e.receive('fail', { requestId: e.pending.id, message: 'Question failure' }); assert.equal((await read(true)).error, 'Question failure');
  await startResearch(e, { nodeId }); await read(true); await delay(0); work.onProgress('Reading sources'); assert.equal((await read(true)).pending.progress, 'Reading sources');
  work.reject(new Error('Research failure')); await Promise.allSettled([...e.researchTasks]); assert.equal((await read(true)).error, 'Research failure');
  await startResearch(e, { nodeId }); await read(true); await delay(0);
  work.resolve({ basis: 'reasoning', summary: 'Summary', options: [{ title: 'Option', description: 'Description', pros: [], cons: [] }, { title: 'Other option', description: 'Other description', pros: [], cons: [] }], recommendation: 'Consider', uncertainty: 'Unverified', sources: [] });
  await Promise.allSettled([...e.researchTasks]); next = await read(true); assert.equal(next.pending, null); assert.equal(next.document.nodes[1].research.summary, 'Summary');
  const history = await e.history(e.doc.id); let manifests = 0;
  history.write = async (path, value) => { if (path.endsWith('manifest.json') && ++manifests === 2) throw new Error('Injected finalization failure'); return atomicWrite(path, value); };
  await assert.rejects(command('guidance', { objective: 'Saved despite history error', successCriteria: '' }), /Map saved.*history finalization/);
  next = await read(true); assert.equal(next.document.objective, 'Saved despite history error'); await read(false); history.write = atomicWrite;
});

import { measureStateTraffic } from '../scripts/perf-state-polling.mjs';
test('separate HTTP benchmark counters measure changed and unchanged operations explicitly', async () => {
  const traffic = await measureStateTraffic(makeFixture(fixtureSpecs[0]).document);
  for (const name of ['unchanged', 'transientUnchanged']) {
    assert.deepEqual(traffic[name], { requests: 10, bodyBytes: 0, mapClones: 0, mapSerializations: 0, mapParses: 0, statuses: Array(10).fill(204) });
  }
  for (const name of ['fullSnapshot', 'documentChanged', 'transientChanged']) {
    assert.ok(traffic[name].bodyBytes > 10000); assert.equal(traffic[name].mapClones, 1); assert.equal(traffic[name].mapSerializations, 1); assert.equal(traffic[name].mapParses, 1); assert.deepEqual(traffic[name].statuses, [200]);
  }
});
