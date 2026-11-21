import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument, addQuestions, research, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { helperFailure } from '../com.github.copilot/extensions/explorer/owned-helper.mjs';
import { fixtureResearchModels } from './helpers/research-model.mjs';
import { recommendationFindings } from './helpers/research-recommendation.mjs';
import { waitFor } from './helpers/wait-for.mjs';
import { confirmAnswer } from './helpers/answer-change.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-research-recovery-')), file = join(dir, 'map.json'), runs = [];
  const doc = createDocument('Research recovery'); addQuestions(doc, doc.rootId, [{ question: 'Which option? 🌿', category: 'Choice' }, { question: 'Excluded branch?', category: 'Choice' }, { question: 'Independent branch?', category: 'Choice' }]);
  doc.nodes[1].research = research(recommendationFindings()); doc.nodes[2].answer = 'Prior independent answer'; doc.nodes[2].answerState = 'decided'; await writeFile(file, JSON.stringify(doc));
  const run = (context, options) => new Promise((resolve, reject) => runs.push({ context, ...options, resolve, reject }));
  const e = await new Explorer({ file, researcher: { models: fixtureResearchModels, run, runFollowup: run, runReconsideration: run } }).load();
  t.after(async () => { for (const pending of runs) pending.resolve(research(recommendationFindings())); await e.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  const start = async (extra = {}) => {
    const count = runs.length;
    const reviewed = await e.reviewResearch({ action: 'prepare', journey: doc.id, nodeId: doc.nodes[1].id, scope: 'decisions', excluded: [doc.nodes[2].id],
      settings: { depth: 'quick', sourceFocus: 'primary', recency: 'recent' }, clientId: randomUUID(), sequence: 1, ...extra });
    await e.command(extra.followup ? 'research-follow-up' : 'research', { journey: doc.id, nodeId: doc.nodes[1].id, token: reviewed.token });
    await waitFor(() => runs.length > count); return runs.at(-1);
  };
  return { e, doc, file, runs, start, settle: () => Promise.all([...e.researchTasks]) };
}

test('research recovery retains reviewed intent and observed progress after failure without saving private state', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), run = await f.start();
  run.onProgress('Source read requested');
  const pending = f.e.uiSnapshot().researchOperation;
  assert.equal(pending.status, 'pending'); assert.equal(pending.phase, 'Source read requested'); assert.equal(pending.question, 'Which option? 🌿');
  assert.deepEqual(pending.intent, { scope: 'decisions', excluded: [f.doc.nodes[2].id], settings: { depth: 'quick', sourceFocus: 'primary', recency: 'recent', profile: { id: 'general', version: 1 } } });
  run.reject(helperFailure('Tools unavailable.', 'tools-unavailable')); await f.settle();
  const failed = f.e.uiSnapshot().researchOperation;
  assert.equal(failed.id, pending.id); assert.equal(failed.status, 'failed'); assert.equal(failed.reason, 'tools-unavailable'); assert.equal(failed.historical, false);
  assert.deepEqual(failed.intent, pending.intent); assert.equal(failed.dependencies, undefined); assert.equal(failed.scenarioPolicy, undefined);
  assert.equal(f.e.snapshot().researchOperation, undefined); assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.runs.length, 1);
  assert.doesNotMatch(toMarkdown(f.e.doc), /Tools unavailable/);
  const cursor = f.e.pollSnapshot().cursor;
  await f.e.command('research-operation-clear', { id: failed.id, journey: f.doc.id, nodeId: failed.nodeId, revision: f.e.doc.revision });
  assert.equal(f.e.uiSnapshot().researchOperation, null); assert.ok(f.e.pollSnapshot(cursor).snapshot);
});

test('research cancellation is request-bound and late callbacks cannot replace another operation', async t => {
  const f = await fixture(t), run = await f.start(), id = f.e.pending.id;
  await f.e.command('cancel', { id }); assert.equal(run.signal.aborted, true);
  assert.equal(f.e.uiSnapshot().researchOperation.status, 'cancelled');
  run.resolve(research(recommendationFindings())); await f.settle();
  const second = await f.start(), current = f.e.pending.id;
  await assert.rejects(f.e.command('cancel', { id }), /obsolete|changed/);
  run.onProgress('Late old callback');
  assert.equal(f.e.pending.id, current); assert.notEqual(f.e.uiSnapshot().researchOperation.phase, 'Late old callback');
  await assert.rejects(f.e.command('research-operation-clear', { id, journey: f.doc.id, nodeId: f.doc.nodes[1].id, revision: f.e.doc.revision }), /pending|wait|changed/i);
  second.resolve(research(recommendationFindings())); await f.settle();
  assert.equal(f.e.uiSnapshot().researchOperation.status, 'completed'); assert.equal(f.e.uiSnapshot().researchOperation.historical, false);
});

test('stale and malformed research keeps prior findings and records the recovery cause', async t => {
  for (const stale of [true, false]) {
    const f = await fixture(t), prior = structuredClone(f.e.doc.nodes[1].research), run = await f.start();
    if (stale) { const changed = JSON.parse(await readFile(f.file, 'utf8')); changed.nodes[1].answer = 'New committed constraint'; changed.nodes[1].answerState = 'decided'; changed.revision++; await writeFile(f.file, JSON.stringify(changed)); }
    run.resolve(stale ? research(recommendationFindings()) : { summary: 'Incomplete unsafe result' }); await f.settle();
    const operation = f.e.uiSnapshot().researchOperation;
    assert.equal(operation.status, 'failed'); assert.equal(operation.reason, stale ? 'stale-context' : 'invalid-result');
    assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')).nodes[1].research, prior);
    assert.equal(f.runs.length, 1);
  }
});

test('independent branch answers remain editable and follow-up recovery retains the original target', async t => {
  const f = await fixture(t), followup = { question: 'PRIVATE_RETRY_PROMPT 🌿', hypothetical: true, target: { kind: 'option', index: 0 } }, run = await f.start({ followup });
  await confirmAnswer(f.e, { nodeId: f.doc.nodes[3].id, answer: 'Independent answer', revision: f.e.doc.revision });
  assert.equal(f.e.doc.nodes[3].answer, 'Independent answer'); assert.equal(f.e.pending.nodeId, f.doc.nodes[1].id);
  run.reject(helperFailure('Selected effort ended.', 'deadline')); await f.settle();
  const operation = f.e.uiSnapshot().researchOperation;
  assert.deepEqual(operation.intent.followup, followup); assert.equal(operation.reason, 'deadline');
  assert.ok(!JSON.stringify(f.e.snapshot()).includes(followup.question)); assert.ok(!(await readFile(f.file, 'utf8')).includes(followup.question));
  const next = structuredClone(f.e.doc); next.nodes[1].research.summary = 'Replacement research'; await f.e.save(next);
  assert.equal(f.e.uiSnapshot().researchOperation.historical, true);
  await f.e.close(); assert.equal(f.e.uiSnapshot().researchOperation, null);
});

test('research recovery exposes an unconfirmed helper release and updates only when it is confirmed', async t => {
  const f = await fixture(t), run = await f.start(); let release;
  const error = helperFailure('Cleanup could not confirm shutdown.', 'cleanup-failure'); error.releaseConfirmed = new Promise(resolve => { release = resolve; });
  run.reject(error); await f.settle();
  const first = f.e.pollSnapshot(); assert.equal(first.snapshot.researchOperation.releasePending, true);
  await assert.rejects(f.start(), /shutdown|release/); assert.equal(f.runs.length, 1);
  release(true); await new Promise(setImmediate);
  assert.equal(f.e.pollSnapshot(first.cursor).snapshot.researchOperation.releasePending, false);
});

test('local source changes record stale recovery and late results cannot erase it', async t => {
  const f = await fixture(t), run = await f.start(), prior = structuredClone(f.e.doc.nodes[1].research);
  const next = structuredClone(f.e.doc); next.objective = 'Changed reviewed objective'; await f.e.save(next);
  const operation = f.e.uiSnapshot().researchOperation;
  assert.equal(operation.status, 'failed'); assert.equal(operation.reason, 'stale-context'); assert.equal(operation.historical, true);
  run.resolve(research(recommendationFindings())); await f.settle();
  assert.equal(f.e.uiSnapshot().researchOperation.id, operation.id); assert.equal(f.e.uiSnapshot().researchOperation.reason, 'stale-context'); assert.deepEqual(f.e.doc.nodes[1].research, prior);
});

test('dismissing a captured follow-up also removes its private retry intent', async t => {
  const f = await fixture(t), run = await f.start({ followup: { question: 'Dismiss private retry text', hypothetical: false } });
  run.reject(helperFailure('Unavailable.', 'tools-unavailable')); await f.settle();
  const turn = f.e.uiSnapshot().followupTurn;
  await f.e.command('followup-turn-clear', { id: turn.id, journey: turn.journey, nodeId: turn.nodeId, revision: f.e.doc.revision });
  assert.equal(f.e.uiSnapshot().researchOperation, null); assert.equal(f.e.uiSnapshot().followupTurn, null);
});
