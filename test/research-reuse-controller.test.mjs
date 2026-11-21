import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { fixtureResearchModels } from './helpers/research-model.mjs';
import { waitFor } from './helpers/wait-for.mjs';

const findings = { basis: 'reasoning', summary: 'Compare', options: [{ title: 'Pilot', description: 'Small', pros: [], cons: [] }, { title: 'Launch', description: 'Large', pros: [], cons: [] }], recommendation: 'Pilot first', uncertainty: 'Unknown costs', sources: [], claims: [{ id: 'c1', text: 'Start small', basis: 'reasoning', evidence: [], limitations: 'Judgment' }] };
const answer = { answer: 'A small pilot tests the assumption.', uncertainty: 'Reasoning, not new verification.', sources: [], claims: findings.claims };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-reuse-')), file = join(directory, 'map.explore.json');
  const doc = createDocument('Synthetic reuse'); addQuestions(doc, doc.rootId, [{ question: 'How big?', category: 'Size' }]); doc.nodes[1].research = structuredClone(findings);
  await writeFile(file, JSON.stringify(doc));
  const root = { path: directory }, runs = [], instances = [];
  const make = async () => {
    const e = await new Explorer({ file, projectRoot: async () => root.path, researcher: { models: fixtureResearchModels, runFollowup(context, options) { return new Promise((resolve, reject) => runs.push({ context, ...options, resolve, reject })); } } }).load();
    instances.push(e); return e;
  };
  const e = await make(), nodeId = doc.nodes[1].id, journey = doc.id;
  t.after(async () => { for (const run of runs) run.resolve(answer); for (const instance of instances) await instance.close(); assert.equal(dirname(directory), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  let sequence = 0; const clientId = randomUUID();
  const review = (question = 'Why?', options = {}) => e.reviewResearch({ action: 'prepare', conversationScope: e.uiSnapshot().conversationScope, journey, nodeId, scope: 'decisions', excluded: [], clientId, sequence: ++sequence, followup: { question, hypothetical: true }, ...options });
  const start = value => e.command('research-follow-up', { journey, nodeId, token: value.token });
  const reuse = value => e.command('research-follow-up-reuse', { journey, nodeId, token: value.token });
  const settle = async () => { await new Promise(setImmediate); await Promise.all([...e.researchTasks]); };
  const complete = async (question = 'Why?') => { const count = runs.length; await start(await review(question)); await waitFor(() => runs.length > count); runs.at(-1).resolve(answer); await settle(); assert.equal(e.error, ''); };
  const clear = () => e.command('followup-clear', { journey, nodeId, historyId: e.followup?.id, revision: e.doc.revision });
  return { e, doc, directory, file, root, runs, nodeId, journey, review, start, reuse, settle, complete, clear, make };
}

test('reviewed reuse avoids another helper, preserves original exchange and file, and fresh Research bypasses it', async t => {
  const f = await fixture(t), saved = await readFile(f.file, 'utf8');
  await f.complete(); const prior = structuredClone(f.e.followup.exchanges[0]), receipt = structuredClone(f.e.followup.reuse);
  const review = await f.review(); assert.equal(review.prepared.reuse.exchangeId, prior.id);
  assert.equal(f.runs.length, 1); await f.reuse(review);
  assert.equal(f.runs.length, 1); assert.equal(f.e.pending, null); assert.deepEqual(f.e.followup.exchanges, [prior]); assert.deepEqual(f.e.followup.reuse, receipt);
  assert.equal(f.e.uiSnapshot().followup.reuse, undefined); assert.equal(f.e.uiSnapshot().followup.reuseNotice.exchangeId, prior.id);
  assert.equal(f.e.snapshot().followup, undefined); assert.equal(await readFile(f.file, 'utf8'), saved);
  assert.ok(!JSON.stringify(review).includes(f.directory)); assert.ok(!JSON.stringify(f.e.uiSnapshot()).includes(receipt.inputHash));
  await f.start(await f.review()); await waitFor(() => f.runs.length === 2); f.runs[1].resolve(answer); await f.settle();
  const nextInputs = JSON.stringify([f.runs[1].context, f.runs[1].prepared.prompt, f.runs[1].prepared.instructions]);
  assert.ok(!nextInputs.includes(receipt.inputHash)); assert.ok(!nextInputs.includes(f.directory));
  assert.equal(f.e.followup.exchanges.length, 2); assert.notEqual(f.e.followup.exchanges[1].id, prior.id); assert.equal(f.e.followup.reuseNotice, undefined);
});

test('reuse requires its current one-use review and clear invalidates it without writing the map', async t => {
  const f = await fixture(t); await f.complete(); const saved = await readFile(f.file, 'utf8'), value = await f.review();
  const concurrent = await Promise.allSettled([f.reuse(value), f.reuse(value)]);
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1); assert.equal(f.runs.length, 1);
  const stale = await f.review(); await f.clear(); assert.equal(f.e.followup, null);
  await assert.rejects(f.reuse(stale), /obsolete|changed/i); assert.equal((await f.review()).prepared.reuse, undefined);
  assert.equal(await readFile(f.file, 'utf8'), saved); assert.equal(f.runs.length, 1);
});

test('changed project identity, saved constraint or model prevents reuse; other canvases have no cache', async t => {
  const f = await fixture(t); await f.complete(); const current = await f.review();
  await mkdir(join(f.directory, 'another')); f.root.path = join(f.directory, 'another');
  await assert.rejects(f.reuse(current), /previous|reuse|changed/i); assert.equal((await f.review()).prepared.reuse, undefined);
  f.root.path = f.directory;
  f.e.researcher.models = async () => ({ ...await fixtureResearchModels(), selectedId: 'fixture-dedicated' });
  assert.equal((await f.review()).prepared.reuse, undefined); f.e.researcher.models = fixtureResearchModels;
  const other = await f.make(); assert.equal(other.followup, undefined);
  const copied = await other.reviewResearch({ action: 'prepare', conversationScope: other.uiSnapshot().conversationScope, journey: f.journey, nodeId: f.nodeId, clientId: randomUUID(), sequence: 1, scope: 'decisions', excluded: [], followup: { question: 'Why?', hypothetical: true } });
  assert.equal(copied.prepared.reuse, undefined);
  const changed = structuredClone(f.e.doc); changed.nodes[1].question += ' for v2'; await writeFile(f.file, JSON.stringify(changed));
  await assert.rejects(f.review(), /changed/i); assert.equal(f.runs.length, 1);
});

test('a model change during the asynchronous root check rejects reuse without another helper', async t => {
  const f = await fixture(t); await f.complete(); const value = await f.review(), prior = structuredClone(f.e.followup.exchanges);
  const originalRoot = f.e.projectContext.root.bind(f.e.projectContext);
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  f.e.projectContext.root = async () => { entered(); await new Promise(resolve => { release = resolve; }); return originalRoot(); };
  const reuse = f.reuse(value); await waiting;
  f.e.researcher.models = async () => ({ ...await fixtureResearchModels(), selectedId: 'fixture-dedicated' });
  release();
  await assert.rejects(reuse, /model|changed|eligible|reuse/i);
  assert.deepEqual(f.e.followup.exchanges, prior); assert.equal(f.e.followup.reuseNotice, undefined); assert.equal(f.runs.length, 1);
  await assert.rejects(f.reuse(value), /obsolete|changed/i);
});

test('failed saved reads invalidate consumption and keep prior findings; no fake reuse receipt appears', async t => {
  const f = await fixture(t); await f.complete(); const value = await f.review(), saved = await readFile(f.file, 'utf8'), prior = structuredClone(f.e.followup.exchanges);
  await writeFile(f.file, '{broken'); await assert.rejects(f.reuse(value));
  assert.deepEqual(f.e.followup.exchanges, prior); assert.equal(f.e.followup.reuseNotice, undefined); assert.equal(f.runs.length, 1);
  assert.equal(await readFile(f.file, 'utf8'), '{broken'); await writeFile(f.file, saved);
  await assert.rejects(f.reuse(value), /obsolete|changed/i);
});

test('clear waits for active work; cancellation and its late response cannot populate reuse', async t => {
  const f = await fixture(t); await f.complete(); const id = f.e.followup.exchanges[0].id;
  await f.start(await f.review('Another?')); await waitFor(() => f.runs.length === 2);
  await assert.rejects(f.clear(), /wait|cancel|active/i); await f.e.command('cancel');
  assert.equal(f.runs[1].signal.aborted, true); f.runs[1].resolve({ ...answer, answer: 'Late cancelled answer' }); await f.settle();
  assert.equal(f.e.followup.exchanges.length, 1); assert.equal(f.e.followup.exchanges[0].id, id);
  assert.equal((await f.review('Another?')).prepared.reuse, undefined); await f.clear(); assert.equal(f.e.followup, null);
});

test('longer display retention preserves reusable prompt context while unavailable roots produce misses', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 5; index++) await f.complete(`Question ${index}?`);
  assert.equal(f.e.followup.exchanges.length, 5); assert.equal(f.e.followup.dropped, 0);
  assert.ok((await f.review('Question 4?')).prepared.reuse);
  const different = await f.review('A different question?'); assert.equal(different.prepared.reuse, undefined);
  assert.equal(different.prepared.followup.coverage.exchangesIncluded, 4); assert.equal(different.prepared.followup.coverage.exchangesOmitted, 1);
  f.root.path = join(f.directory, 'missing'); await f.complete('Unavailable root?');
  assert.equal((await f.review('Unavailable root?')).prepared.reuse, undefined); assert.equal(f.runs.length, 6);
});

test('HTTP reuse and history clearing require the instance route, Origin and current reviewed identity', async t => {
  const f = await fixture(t); await f.complete(); const server = await startServer(f.e, { status: async () => ({ ready: false }), close() {} });
  t.after(() => server.close()); const origin = new URL(server.url).origin;
  const post = (input, includeOrigin = true, url = server.url + 'api/action') => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...(includeOrigin ? { Origin: origin } : {}) }, body: JSON.stringify(input) });
  const value = await f.review(), input = { action: 'research-follow-up-reuse', journey: f.journey, nodeId: f.nodeId, token: value.token };
  assert.equal((await post(input, false)).status, 403); assert.equal(f.e.followup.reuseNotice, undefined);
  assert.notEqual((await post(input, true, origin + '/api/action')).status, 200);
  assert.equal((await post({ ...input, token: randomUUID() })).status, 400);
  assert.equal((await post(input)).status, 200); assert.equal(f.runs.length, 1);
  const clear = { action: 'followup-clear', journey: f.journey, nodeId: f.nodeId, historyId: f.e.followup.id, revision: f.e.doc.revision };
  assert.equal((await post(clear, false)).status, 403); assert.ok(f.e.followup);
  assert.equal((await post({ ...clear, historyId: randomUUID() })).status, 400);
  assert.equal((await post(clear)).status, 200); assert.equal(f.e.followup, null);
});

test('unresponsive optional project identity is bounded and cannot populate a reuse namespace', { timeout: 5000 }, async t => {
  const f = await fixture(t); f.e.projectContext.root = () => new Promise(() => {});
  assert.equal(await f.e.researchReuseNamespace(), null);
});
