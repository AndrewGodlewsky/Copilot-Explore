import test from 'node:test';
import assert from 'node:assert/strict';
import * as context from '../com.github.copilot/extensions/explorer/research-context.mjs';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { waitFor } from './helpers/wait-for.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';

function fixture() {
  const doc = model.createDocument('Correct the deployment assumption');
  const [parent, prerequisite, unrelated] = model.addQuestions(doc, doc.rootId, [
    { question: 'Where do we deploy?', category: 'Architecture' }, { question: 'Budget?', category: 'Scope' }, { question: 'Who owns it?', category: 'Scope' },
  ]);
  parent.answer = 'Corrected: on premises'; parent.answerState = 'decided';
  prerequisite.answer = 'CURRENT-BUDGET'; prerequisite.answerState = 'assumption';
  unrelated.answer = 'OBSOLETE-OWNER'; unrelated.review = true;
  const [retained, stale] = model.addQuestions(doc, parent.id, [{ question: 'Monitoring?', category: 'Operations' }, { question: 'Cloud region?', category: 'Architecture' }]);
  stale.answer = 'OBSOLETE-REGION'; stale.review = true;
  retained.rationale = 'OBSOLETE-RATIONALE'; retained.generation = { requestId: 'old', originalQuestion: retained.question, originalCategory: retained.category, adjusted: false };
  model.addDependency(doc, parent.id, prerequisite.id, 'Funding limits deployment');
  return { doc: model.validateDocument(doc), parent, prerequisite, unrelated, retained, stale };
}
const prepare = (doc, id, options = {}) => {
  assert.equal(typeof context.prepareRegeneration, 'function');
  return context.prepareRegeneration(doc, id, { prefix: 'REQUEST\n', requestId: 'regeneration-fixture', retained: [], ...options });
};

test('regeneration uses corrected committed context and current prerequisites, excluding obsolete claims', () => {
  const f = fixture(), before = JSON.stringify(f.doc), value = prepare(f.doc, f.parent.id, { retained: [f.retained.id] });
  assert.match(value.prompt, /Corrected: on premises/); assert.match(value.prompt, /CURRENT-BUDGET/);
  assert.doesNotMatch(value.prompt, /OBSOLETE-OWNER|OBSOLETE-REGION|OBSOLETE-RATIONALE/);
  assert.equal(value.context.regeneration.prerequisites[0].answerState, 'assumption');
  assert.deepEqual(value.context.regeneration.links, f.doc.dependencies);
  assert.deepEqual(value.context.regeneration.retained.map(n => n.id), [f.retained.id]);
  assert.equal(value.operation, 'question-regeneration'); assert.equal(value.requestId, 'regeneration-fixture');
  assert.equal(JSON.stringify(f.doc), before); assert.ok(Object.isFrozen(value.context.regeneration));
  assert.ok(context.sameResearchSources(value.dependencies, f.doc));
  const changed = structuredClone(f.doc); changed.nodes.find(n => n.id === f.unrelated.id).answer = 'Another saved edit';
  assert.equal(context.sameResearchSources(value.dependencies, changed), false);
});

test('regeneration follows prerequisite chains without confusing mixed tree/dependency paths with cycles', () => {
  const f = fixture(); model.addDependency(f.doc, f.prerequisite.id, f.retained.id);
  const value = prepare(f.doc, f.parent.id, { scope: 'path' });
  assert.deepEqual(new Set(value.context.regeneration.prerequisites.map(n => n.id)), new Set([f.prerequisite.id, f.retained.id]));
  assert.equal(value.context.regeneration.links.length, 2); assert.equal(value.context.decisionsElsewhere.length, 0);
  assert.equal(value.context.regeneration.retained.length, 0);
  f.doc.nodes.find(n => n.id === f.prerequisite.id).review = true;
  const unsettled = prepare(f.doc, f.parent.id);
  assert.doesNotMatch(unsettled.prompt, /CURRENT-BUDGET/);
  assert.equal(unsettled.context.regeneration.prerequisites.find(n => n.id === f.prerequisite.id).answerOmitted, 'needs-review');
});

test('regeneration validates retained selections and saved target without changing any question', () => {
  const f = fixture();
  for (const retained of [[f.stale.id], [f.unrelated.id], [f.retained.id, f.retained.id], null]) assert.throws(() => prepare(f.doc, f.parent.id, { retained }), /retained|selection/i);
  assert.throws(() => prepare(f.doc, f.doc.rootId), /question/i);
  assert.throws(() => prepare(f.doc, f.retained.id), /save|answer/i);
  assert.throws(() => prepare(f.doc, f.stale.id), /review/i);
  const value = prepare(f.doc, f.parent.id, { excluded: [f.unrelated.id] });
  assert.deepEqual(value.context.regeneration.retained, []);
  assert.ok(f.doc.nodes.some(n => n.id === f.retained.id));
});

test('mandatory regeneration prerequisites obey the actual string budget without truncating claims', () => {
  const f = fixture();
  const ids = model.addQuestions(f.doc, f.doc.rootId, Array.from({ length: 6 }, (_, i) => ({ question: `Required ${i}?`, category: 'Scope' })));
  for (const node of ids) { node.answer = 'x'.repeat(20000); model.addDependency(f.doc, f.parent.id, node.id); }
  f.doc.nodes.find(n => n.id === f.prerequisite.id).answer = 'y'.repeat(20000);
  assert.throws(() => prepare(f.doc, f.parent.id), /128 KiB|limit/);
});

test('an explicit prerequisite remains mandatory when it also appears on the optional ancestor path', () => {
  const f = fixture(); f.doc.nodes.find(n => n.id === f.retained.id).answer = 'Retained correction';
  model.addDependency(f.doc, f.retained.id, f.parent.id);
  const value = prepare(f.doc, f.retained.id, { excluded: [f.parent.id], scope: 'path' });
  assert.ok(value.context.regeneration.prerequisites.some(n => n.id === f.parent.id && n.answer === f.parent.answer));
});

async function controller(t) {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), 'question-regeneration-')), file = join(directory, 'map.explore.json'), sent = [];
  await writeFile(file, JSON.stringify(f.doc));
  const e = await new Explorer({ file, target: { instanceId: 'regeneration-fixture' }, send: async input => sent.push(input) }).load();
  t.after(async () => { await e.close(); await rm(directory, { recursive: true, force: true }); });
  const clientId = randomUUID(); let sequence = 0;
  const input = extra => ({ action: 'prepare', purpose: 'question-regeneration', journey: e.doc.id, nodeId: f.parent.id, scope: 'decisions', excluded: [], retained: [], clientId, sequence: ++sequence, ...extra });
  const review = extra => e.reviewResearch(input(extra));
  const command = (action, extra = {}) => e.command(action, { revision: e.doc.revision, ...extra });
  const start = value => command('regenerate-questions', { journey: e.doc.id, nodeId: f.parent.id, token: value.token });
  return { ...f, e, file, sent, input, review, command, start };
}

test('regeneration consumes the exact inspected queued prompt and stages only explicitly accepted candidates', async t => {
  const f = await controller(t), before = await readFile(f.file, 'utf8');
  const p = await f.review({ retained: [f.retained.id] });
  assert.equal(f.sent.length, 0); assert.equal(await readFile(f.file, 'utf8'), before);
  assert.equal(p.prepared.operation, 'question-regeneration'); assert.equal(p.prepared.settings, undefined);
  await f.start(p); await waitFor(() => f.sent.length === 1);
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].mode, 'enqueue'); assert.equal(f.sent[0].prompt, p.prepared.prompt);
  const id = f.e.pending.id; assert.match(p.prepared.prompt, new RegExp(id));
  const questions = [{ question: 'How will on-premises capacity grow?', category: 'Operations' }];
  await f.e.receive('questions', { requestId: id, questions });
  assert.equal(f.e.uiSnapshot().preview.purpose, 'question-regeneration'); assert.equal(await readFile(f.file, 'utf8'), before);
  await assert.rejects(f.command('accept-questions', { batchId: id, selected: [{ index: 0, question: f.retained.question }] }), /duplicate|already/i);
  await f.command('accept-questions', { batchId: id, selected: [{ index: 0, question: questions[0].question }] });
  assert.equal(f.e.doc.nodes.length, f.doc.nodes.length + 1); assert.equal(f.e.doc.nodes.find(n => n.id === f.retained.id).question, f.retained.question);
  await assert.rejects(f.start(p), /review|obsolete/i);
});

test('regeneration rejects purpose confusion, old/cancelled tokens and invalid selection without dispatch', async t => {
  const f = await controller(t), old = await f.review(), current = await f.review();
  await assert.rejects(f.start(old), /review|obsolete/i);
  await assert.rejects(f.command('research', { journey: f.e.doc.id, nodeId: f.parent.id, token: current.token }), /purpose|research/i);
  await assert.rejects(f.review({ settings: { depth: 'quick', sourceFocus: 'primary', recency: 'any' } }), /invalid/i);
  await assert.rejects(f.review({ retained: [f.stale.id] }), /retained|review/i);
  const p = await f.review(); await f.e.reviewResearch(f.input({ action: 'cancel' }));
  await assert.rejects(f.start(p), /review|obsolete/i); assert.equal(f.sent.length, 0);
});

test('any saved edit including an added dependency invalidates regeneration before start and candidate acceptance', async t => {
  const f = await controller(t); let p = await f.review();
  const changed = structuredClone(f.e.doc); changed.nodes.find(n => n.id === f.unrelated.id).answer = 'Changed outside claim'; await f.e.save(changed);
  await assert.rejects(f.start(p), /changed|review/i); assert.equal(f.sent.length, 0);
  p = await f.review(); await f.start(p); await waitFor(() => f.sent.length === 1);
  const id = f.e.pending.id; await f.e.receive('questions', { requestId: id, questions: [{ question: 'Replacement?', category: 'Scope' }] });
  const linked = structuredClone(f.e.doc); model.addDependency(linked, f.parent.id, f.unrelated.id); await f.e.save(linked);
  assert.equal(f.e.uiSnapshot().preview.stale, true);
  await assert.rejects(f.command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Replacement?' }] }), /changed|stale/i);
});

test('regeneration cancellation and late callbacks cannot revive a replaced request', async t => {
  const f = await controller(t), p = await f.review(); await f.start(p); await waitFor(() => f.sent.length === 1);
  const id = f.e.pending.id; await f.command('cancel');
  await assert.rejects(f.e.receive('questions', { requestId: id, questions: [{ question: 'Late?', category: 'Scope' }] }), /cancelled|replaced/i);
  assert.equal(f.e.preview, null); assert.equal(f.e.doc.nodes.length, f.doc.nodes.length);
});

test('regeneration rechecks disk after the queued dispatch policy await', async t => {
  const f = await controller(t), p = await f.review(); const original = f.e.assertScenarioPolicy.bind(f.e);
  let calls = 0;
  f.e.assertScenarioPolicy = async policy => {
    await original(policy);
    if (++calls === 3) { const changed = structuredClone(f.e.doc); changed.revision++; changed.nodes.find(n => n.id === f.parent.id).answer = 'External correction'; await writeFile(f.file, JSON.stringify(changed)); }
  };
  await f.start(p); await waitFor(() => f.e.pending === null); await f.e.queue;
  assert.equal(f.sent.length, 0); assert.equal(f.e.pending, null); assert.match(f.e.error, /context changed|saved.*changed/i);
});

test('regeneration protected HTTP review rejects cross-origin and accepts the same explicit action path', async t => {
  const f = await controller(t), server = await startServer(f.e); t.after(() => server.close());
  const url = new URL('api/research-review', server.url), headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: url.origin };
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://elsewhere.invalid' }, body: JSON.stringify(f.input()) })).status, 403);
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(f.input()) }); assert.equal(response.status, 200);
  const preview = await response.json(); assert.equal(preview.prepared.operation, 'question-regeneration');
  const actionUrl = new URL('api/action', server.url), action = { action: 'regenerate-questions', journey: f.e.doc.id, revision: f.e.doc.revision, nodeId: f.parent.id, token: preview.token };
  const { Origin, ...missingOrigin } = headers;
  assert.equal((await fetch(actionUrl, { method: 'POST', headers: missingOrigin, body: JSON.stringify(action) })).status, 403);
  assert.equal(f.e.pending, null); assert.equal(f.sent.length, 0);
  assert.equal((await fetch(actionUrl, { method: 'POST', headers, body: JSON.stringify(action) })).status, 200);
  await waitFor(() => f.sent.length === 1);
});

test('saving corrections, acknowledging review and restarting never enqueue replacement questions automatically', async t => {
  const f = await controller(t);
  const change = async (operation, nodeId, answer, extra = {}) => {
    const input = { operation, nodeId, answer, answerState: 'tentative', revision: f.e.doc.revision, ...extra };
    const preview = await f.e.answerChangeRequest({ action: 'prepare', journey: f.e.doc.id, ...input });
    await f.command(operation, { ...input, answerPreview: preview.token, confirmConsequences: true });
    assert.equal(f.e.pending, null); assert.equal(f.sent.length, 0);
  };
  await change('answer', f.parent.id, 'Another corrected answer');
  const node = f.e.doc.nodes.find(n => n.id === f.stale.id);
  await change('reaffirm-review', node.id, node.answer, { reviewCause: node.reviewCauses.changes[0] });
  await change('restart-branch', f.parent.id, 'Corrected replacement premise');
  assert.equal(f.e.doc.nodes.some(n => n.id === f.stale.id), false);
  const p = await f.review(); assert.doesNotMatch(p.prepared.prompt, /OBSOLETE-REGION|Cloud region/); assert.equal(f.sent.length, 0);
});

test('a preference change invalidates reviewed regeneration even when saved map bytes stay identical', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'regeneration-scenario-')), library = new Library(directory), doc = fixture().doc, sent = [];
  const entry = await library.import(doc), e = await new Explorer({ library, binding: 'regeneration', send: async input => sent.push(input) }).load();
  t.after(async () => { await e.close(); await rm(directory, { recursive: true, force: true }); }); await e.attach(entry.key);
  const input = { action: 'prepare', purpose: 'question-regeneration', journey: e.activeKey, nodeId: doc.nodes[1].id, scope: 'decisions', excluded: [], retained: [], clientId: randomUUID(), sequence: 1 };
  const p = await e.reviewResearch(input), bytes = await readFile(entry.file);
  const view = await e.scenarioPreferenceRequest({ action: 'inspect', journey: e.activeKey, revision: e.doc.revision });
  await e.scenarioPreferenceRequest({ action: 'select', journey: e.activeKey, revision: e.doc.revision, id: view.id, rationale: 'Current direction' });
  await assert.rejects(e.command('regenerate-questions', { revision: e.doc.revision, journey: e.activeKey, nodeId: input.nodeId, token: p.token }), /changed|obsolete/i);
  assert.deepEqual(await readFile(entry.file), bytes); assert.equal(sent.length, 0);
});

test('an old cancelled dispatch read cannot mark the replacement candidate preview stale', async t => {
  const f = await controller(t), p = await f.review(), read = f.e.readCurrent.bind(f.e), check = f.e.checkQuestionSource.bind(f.e); let rejectOld, hold = true, checking = false;
  f.e.checkQuestionSource = async (...args) => { checking = true; try { return await check(...args); } finally { checking = false; } };
  f.e.readCurrent = async () => {
    if (f.e.pending && hold && checking) { hold = false; return new Promise((resolve, reject) => { rejectOld = reject; }); }
    return read();
  };
  await f.start(p); await waitFor(() => !!rejectOld); await f.command('cancel');
  const next = await f.review(); await f.start(next); await waitFor(() => f.sent.length === 1);
  const id = f.e.pending.id; await f.e.receive('questions', { requestId: id, questions: [{ question: 'Current replacement?', category: 'Scope' }] });
  rejectOld(Error('Old dispatch read failed')); await new Promise(setImmediate); await f.e.queue;
  assert.equal(f.e.preview.id, id); assert.equal(f.e.preview.stale, false);
});

test('an external correction during final scenario validation survives candidate acceptance', async t => {
  const f = await controller(t), p = await f.review(); await f.start(p); await waitFor(() => f.sent.length === 1);
  const id = f.e.pending.id; await f.e.receive('questions', { requestId: id, questions: [{ question: 'Before external edit?', category: 'Scope' }] });
  const check = f.e.assertScenarioPolicy.bind(f.e); let checks = 0, external;
  f.e.assertScenarioPolicy = async policy => {
    await check(policy);
    if (++checks === 2) { external = structuredClone(f.e.doc); external.revision++; external.nodes.find(n => n.id === f.parent.id).answer = 'CONCURRENT EXTERNAL CORRECTION'; await writeFile(f.file, JSON.stringify(external)); }
  };
  await assert.rejects(f.command('accept-questions', { batchId: id, selected: [{ index: 0, question: 'Before external edit?' }] }), /changed|context/i);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), external);
  assert.equal(f.e.preview.stale, true);
});
