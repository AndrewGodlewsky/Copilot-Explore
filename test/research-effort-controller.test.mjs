import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument, addQuestions, research } from '../com.github.copilot/extensions/explorer/model.mjs';
import { fixtureResearchModels } from './helpers/research-model.mjs';
import { recommendationFindings } from './helpers/research-recommendation.mjs';
import { startResearch } from './helpers/research-review.mjs';
import { waitFor } from './helpers/wait-for.mjs';
import { randomUUID } from 'node:crypto';
const settings = { depth: 'standard', sourceFocus: 'balanced', recency: 'any', profile: { id: 'general', version: 1 } };
const report = (partial = null, overrides = {}) => ({ settings, reason: 'deadline', elapsedMs: 180001, toolAttempts: 2, duplicateAttempts: 0, deliveredTextUnits: 15, truncatedResults: 0, assessment: null, partial, ...overrides });
function checkpoint() {
  const value = recommendationFindings(); value.recommendationAssessment.optionId = null;
  value.summary = 'Incomplete useful findings 🌿'; value.recommendation = 'Research stopped before choosing.';
  return research({ ...value, settings });
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-effort-controller-')), file = join(dir, 'map.explore.json'), runs = [];
  const doc = createDocument('Research effort'); addQuestions(doc, doc.rootId, [{ question: 'Which pilot?', category: 'Scope' }]);
  doc.nodes[1].research = research(recommendationFindings()); await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file, researcher: { models: fixtureResearchModels, run(context, options) {
    return new Promise((resolve, reject) => runs.push({ context, ...options, resolve, reject }));
  } } }).load();
  t.after(async () => { for (const run of runs) run.resolve(research(recommendationFindings())); await e.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  const start = async () => { const count = runs.length; await startResearch(e, { nodeId: doc.nodes[1].id }); await waitFor(() => runs.length > count); return runs.at(-1); };
  const settle = async () => { await new Promise(setImmediate); await Promise.all([...e.researchTasks]); };
  return { e, dir, file, doc, runs, start, settle };
}

test('a released research partial stays separate from completed research, native context and exports', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), run = await f.start();
  run.onReport(report(checkpoint())); run.reject(Error('Research stopped at the deadline.')); await f.settle();
  const view = f.e.uiSnapshot().researchAttempt;
  assert.equal(view.nodeId, f.doc.nodes[1].id); assert.equal(view.report.partial.summary, 'Incomplete useful findings 🌿');
  assert.equal(view.historical, false); assert.equal(view.dependencies, undefined); assert.equal(view.scenarioPolicy, undefined);
  assert.equal(f.e.snapshot().researchAttempt, undefined); assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.e.pending, null);
  const poll = f.e.pollSnapshot(); assert.ok(poll.snapshot.researchAttempt);
  await f.e.command('research-attempt-clear', { id: view.id, journey: f.doc.id, nodeId: view.nodeId });
  assert.equal(f.e.uiSnapshot().researchAttempt, null); assert.ok(f.e.pollSnapshot(poll.cursor).snapshot); assert.equal(await readFile(f.file, 'utf8'), before);
});

test('complete and no-checkpoint attempts report honest effort without manufacturing partial findings', async t => {
  const f = await fixture(t);
  const complete = await f.start(); complete.onReport(report(null, { reason: 'model-completed', elapsedMs: 5000 })); complete.resolve(research(recommendationFindings())); await f.settle();
  assert.equal(f.e.uiSnapshot().researchAttempt.report.reason, 'model-completed'); assert.equal(f.e.uiSnapshot().researchAttempt.report.partial, null);
  const previous = structuredClone(f.e.doc.nodes[1].research), failed = await f.start(); failed.onReport(report()); failed.reject(Error('Timed out without a usable checkpoint.')); await f.settle();
  assert.equal(f.e.uiSnapshot().researchAttempt.report.reason, 'deadline'); assert.equal(f.e.uiSnapshot().researchAttempt.report.partial, null);
  assert.deepEqual(f.e.doc.nodes[1].research, previous);
});

test('cancellation and changed on-disk sources reject late partial reports', async t => {
  for (const cancel of [true, false]) {
    const f = await fixture(t), run = await f.start();
    if (cancel) await f.e.command('cancel');
    else { const changed = JSON.parse(await readFile(f.file, 'utf8')); changed.nodes[1].answer = 'A newer saved answer'; changed.nodes[1].answerState = 'decided'; changed.revision++; await writeFile(f.file, JSON.stringify(changed)); }
    run.onReport(report(checkpoint())); run.reject(Error('Deadline')); await f.settle();
    assert.equal(f.e.uiSnapshot().researchAttempt, null);
    if (!cancel) assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[1].answer, 'A newer saved answer');
  }
});

test('malformed effort, mismatched settings and winner-bearing partials cannot enter the drawer', async t => {
  for (const invalid of [report(null, { toolAttempts: 999 }), report(null, { settings: { ...settings, depth: 'deeper' } }), report(null, { settings: { ...settings, profile: { id: 'product-service', version: 1 } } }), report(research(recommendationFindings())), report(null, { price: 0 })]) {
    const f = await fixture(t), run = await f.start(), before = await readFile(f.file, 'utf8');
    assert.throws(() => run.onReport(invalid), /effort|partial|settings/i);
    run.reject(Error('Invalid report')); await f.settle(); assert.equal(f.e.uiSnapshot().researchAttempt, null); assert.equal(await readFile(f.file, 'utf8'), before);
  }
});

test('observed context changes make retained partials historical and stale clear controls cannot remove a newer attempt', async t => {
  const f = await fixture(t), first = await f.start(); first.onReport(report(checkpoint())); first.reject(Error('Deadline')); await f.settle();
  const old = f.e.uiSnapshot().researchAttempt;
  const next = structuredClone(f.e.doc); next.objective = 'Changed objective'; await f.e.save(next);
  assert.equal(f.e.uiSnapshot().researchAttempt.historical, true);
  const second = await f.start(); second.onReport(report()); second.reject(Error('Deadline')); await f.settle();
  const current = f.e.uiSnapshot().researchAttempt;
  await assert.rejects(f.e.command('research-attempt-clear', { id: old.id, journey: f.doc.id, nodeId: old.nodeId }), /obsolete|changed/i);
  assert.equal(f.e.uiSnapshot().researchAttempt.id, current.id); await f.e.close(); assert.equal(f.e.uiSnapshot().researchAttempt, null);
});

test('follow-up partials retain the reviewed question without adding an incomplete exchange or saved research', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8');
  f.e.researcher.runFollowup = f.e.researcher.run;
  const followup = { question: 'What if the budget doubles? 中文 🌿', hypothetical: true };
  const reviewed = await f.e.reviewResearch({ action: 'prepare', journey: f.doc.id, nodeId: f.doc.nodes[1].id, scope: 'decisions', excluded: [], clientId: randomUUID(), sequence: 1, followup });
  await f.e.command('research-follow-up', { journey: f.doc.id, nodeId: f.doc.nodes[1].id, token: reviewed.token }); await waitFor(() => f.runs.length === 1);
  const partial = { answer: 'A pilot may still help; this answer is incomplete.', uncertainty: 'Hypothetical only.', sources: [], claims: [{ id: 'pilot', text: 'A pilot may help.', basis: 'reasoning', evidence: [], limitations: 'Unverified hypothetical judgment.' }] };
  f.runs[0].onReport(report(partial)); f.runs[0].reject(Error('Deadline')); await f.settle();
  const view = f.e.uiSnapshot(); assert.deepEqual(view.researchAttempt.followup, followup); assert.deepEqual(view.researchAttempt.report.partial, partial);
  assert.equal(view.followup, null); assert.equal(await readFile(f.file, 'utf8'), before);
  const next = await f.e.reviewResearch({ action: 'prepare', journey: f.doc.id, nodeId: f.doc.nodes[1].id, scope: 'decisions', excluded: [], clientId: randomUUID(), sequence: 1, followup });
  assert.equal(next.prepared.followup.exchanges.length, 0); assert.ok(!next.prepared.prompt.includes(partial.answer));
});

test('unconfirmed release and unreadable current documents cannot publish a partial or overwrite the prior attempt', async t => {
  for (const unconfirmed of [true, false]) {
    const f = await fixture(t), first = await f.start(); first.onReport(report()); first.reject(Error('First deadline')); await f.settle();
    const prior = f.e.uiSnapshot().researchAttempt, before = await readFile(f.file, 'utf8'), next = await f.start();
    next.onReport(report(checkpoint()));
    if (!unconfirmed) await writeFile(f.file, '{broken external write');
    next.reject(Object.assign(Error('Stopped'), unconfirmed ? { releaseConfirmed: Promise.resolve(true) } : {})); await f.settle();
    assert.deepEqual(f.e.uiSnapshot().researchAttempt, prior);
    assert.equal(await readFile(f.file, 'utf8'), unconfirmed ? before : '{broken external write');
  }
});
