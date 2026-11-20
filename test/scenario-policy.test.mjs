import { fixtureResearchModels } from './helpers/research-model.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { buildScenario } from '../com.github.copilot/extensions/explorer/scenario-fork.mjs';
import { scenarioFamily, scenarioIdentity } from '../com.github.copilot/extensions/explorer/scenario-preference.mjs';
import { personalPreferenceStore } from '../com.github.copilot/extensions/explorer/scenario-preference-store.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { parseBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';

async function until(read) { for (let i = 0; i < 250; i++) { if (read()) return; await delay(10); } assert.fail('Expected async operation did not settle.'); }
async function fixture(t, helpers = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'scenario-policy-')), library = new Library(directory), sent = [];
  const doc = createDocument('Scenario policy'); doc.nodes.push({ id: 'q', parentId: doc.rootId, question: 'Where?', category: 'Place', answer: 'Local', answerState: 'assumption', review: true, research: null });
  const a = await library.import(doc), b = await library.import(buildScenario(doc, { nodeId: 'q', answer: 'Remote', answerState: 'tentative' }).document);
  const e = await new Explorer({ library, binding: 'policy', target: { instanceId: 'policy' }, send: async value => { sent.push(value); }, ...helpers }).load();
  t.after(async () => { await e.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  await e.attach(a.key);
  const request = (action, extra = {}) => e.scenarioPreferenceRequest({ action, journey: e.activeKey, revision: e.doc.revision, ...extra });
  let view = await request('inspect'); await request('select', { id: view.id, rationale: 'Current direction' }); await e.attach(b.key);
  const enable = async () => { const view = await request('inspect'); await request('hypothetical', { id: view.id, enabled: true }); };
  return { e, a, b, sent, enable, request, store: await personalPreferenceStore(library, scenarioFamily(doc)) };
}

test('questions require explicit alternative use before answer expansion and reject callbacks after a preference change', async t => {
  const { e, sent, enable, store } = await fixture(t), node = e.doc.nodes[1], before = JSON.stringify(e.doc);
  await assert.rejects(e.command('questions', { revision: e.doc.revision, nodeId: node.id }), /preferred|hypothetical/i);
  await assert.rejects(e.command('answer', { revision: e.doc.revision, nodeId: node.id, answer: 'New alternative', answerState: 'tentative', expand: true }), /preferred|hypothetical/i);
  assert.equal(JSON.stringify(e.doc), before); assert.equal(sent.length, 0);
  await enable(); await e.command('questions', { revision: e.doc.revision, nodeId: node.id }); await until(() => sent.length === 1);
  assert.match(sent[0].prompt, /"classification":"hypothetical"/); assert.match(sent[0].prompt, /"answerState":"tentative"/);
  const id = e.pending.id; await store.update(await store.read(), null, 'Changed outside this canvas');
  await assert.rejects(e.receive('questions', { requestId: id, questions: [{ question: 'What next?', category: 'Next', rationale: 'Explore the consequence', importance: 'medium', importanceReason: 'Affects the next choice' }] }), /changed|obsolete/i);
  assert.equal(e.preview, null); assert.equal(e.pending, null); assert.equal(JSON.stringify(e.doc), before);
});

test('reviewed research and handoff inputs carry the exact classification and cannot consume an obsolete preference', async t => {
  let calls = 0;
  const { e, enable, store } = await fixture(t, { researcher: { models: fixtureResearchModels, async run() { calls++; throw Error('Unexpected inference'); }, async close() {} }, briefHelper: { async run() { calls++; throw Error('Unexpected inference'); }, async close() {} } });
  const nodeId = e.doc.nodes[1].id, review = extra => ({ action: 'prepare', clientId: randomUUID(), sequence: 1, journey: e.activeKey, nodeId, scope: 'decisions', excluded: [], ...extra });
  await assert.rejects(e.reviewResearch(review()), /preferred|hypothetical/i);
  await enable(); const research = await e.reviewResearch(review()); assert.equal(research.prepared.context.scenario.classification, 'hypothetical');
  await store.update(await store.read(), null, 'Preference changed');
  await assert.rejects(e.command('research', { revision: e.doc.revision, journey: e.activeKey, nodeId, token: research.token }), /changed|obsolete/i);
  const handoff = await e.reviewResearch({ action: 'prepare', clientId: randomUUID(), sequence: 1, journey: e.activeKey, nodeId: e.doc.rootId, purpose: 'implementation-handoff', selection: { nodeIds: [nodeId], format: 'plan', includeEvidence: false } });
  assert.equal(handoff.prepared.context.scenario.classification, 'unselected');
  await store.update(await store.read(), { identity: scenarioIdentity(e.doc), location: e.activeKey }, 'Prefer this scenario');
  await assert.rejects(e.briefRequest({ action: 'start', id: randomUUID(), journey: e.activeKey, token: handoff.token }, 'handoff'), /changed|obsolete/i);
  assert.equal(calls, 0); assert.equal(e.doc.handoff, undefined);
});

test('queued and returning tool-free work rejects obsolete preferences instead of publishing alternative findings', async t => {
  let calls = 0, captured, deliver;
  const helper = { async run(prepared) { calls++; captured = prepared; return new Promise(resolve => { deliver = resolve; }); }, async close() {} };
  const { e, a, enable, store } = await fixture(t, { checkHelper: helper });
  await assert.rejects(e.checkRequest({ action: 'start', id: randomUUID(), journey: e.activeKey }), /preferred|hypothetical/i);
  await enable(); const gate = Promise.withResolvers(); e.toolFreeTask = gate.promise;
  try {
    await e.checkRequest({ action: 'start', id: randomUUID(), journey: e.activeKey }); await store.update(await store.read(), null, 'Clear while queued');
    gate.resolve(); await e.toolFreeTask; assert.equal(calls, 0); assert.match(e.checkWork.error, /changed|obsolete/i);
    await e.checkRequest({ action: 'start', id: randomUUID(), journey: e.activeKey }); await until(() => !!captured);
    assert.equal(captured.context.scenario.classification, 'unselected');
    await store.update(await store.read(), { identity: scenarioIdentity(a.document), location: a.key }, 'Restore original preference');
    deliver({ findings: [] }); await e.toolFreeTask;
    assert.notEqual(e.checkWork.status, 'result'); assert.equal(e.checkWork.findings, undefined); assert.match(e.checkWork.error, /changed|obsolete/i);
  } finally { gate.resolve(); deliver?.({ findings: [] }); }
});

test('answer cleanup remains an explicit text-only operation when inspecting a retained alternative', async t => {
  let captured;
  const { e } = await fixture(t, { cleaner: { async run(text) { captured = text; return text; }, async close() {} } });
  await e.cleanupRequest({ action: 'start', id: randomUUID(), journey: e.activeKey, nodeId: e.doc.nodes[1].id, mutation: 1, text: 'Only this private draft' });
  await e.toolFreeTask; assert.equal(captured, 'Only this private draft'); assert.equal(e.cleanup.status, 'proposal');
});

test('question help labels its context and expires retained results when the preference changes', async t => {
  let captured;
  const { e, enable, store } = await fixture(t, { questionHelper: { async run(operation, context) { captured = context; return 'Conditional explanation'; }, async close() {} } });
  const input = { id: randomUUID(), journey: e.activeKey, nodeId: e.doc.nodes[1].id, operation: 'terms' };
  await assert.rejects(e.helpRequest({ ...input, action: 'start' }), /preferred|hypothetical/i);
  await enable(); await e.helpRequest({ ...input, action: 'start' }); await e.toolFreeTask;
  assert.equal(captured.scenario.classification, 'hypothetical');
  assert.equal((await e.helpRequest({ ...input, action: 'poll' })).status, 'result');
  await store.update(await store.read(), null, 'No current preference');
  const check = await e.helpRequest({ action: 'check', journey: input.journey, nodeId: input.nodeId, ids: [{ id: input.id, operation: input.operation }] });
  assert.deepEqual(check.staleIds, [input.id]);
  const result = await e.helpRequest({ ...input, action: 'poll' });
  assert.equal(result.status, 'error'); assert.equal(result.text, undefined);
});

test('a preferred scenario change invalidates an unaccepted brief without promoting alternative answers', async t => {
  const { e, enable, store } = await fixture(t, { briefHelper: { async run(prepared) { return parseBrief(JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [{ id: 'a', text: 'Conditional choice only', certainty: 'uncertain', sources: [] }], unresolved: [], nextSteps: [] }), prepared); }, async close() {} } });
  const input = { id: randomUUID(), journey: e.activeKey };
  await assert.rejects(e.briefRequest({ ...input, action: 'start' }), /preferred|hypothetical/i);
  await enable(); await e.briefRequest({ ...input, action: 'start' }); await e.toolFreeTask;
  assert.equal(e.briefWork.status, 'proposal');
  await store.update(await store.read(), null, 'Changed after generation');
  await assert.rejects(e.briefRequest({ ...input, action: 'accept', revision: e.doc.revision, edits: [] }), /changed|stale/i);
  assert.equal(e.doc.brief, undefined); assert.equal(e.doc.nodes[1].answerState, 'tentative');
  assert.equal((await e.briefRequest({ ...input, action: 'poll' })).status, 'stale');
});

test('decision exports require explicit alternative use, label its source, and preserve raw backups', async t => {
  const { e, enable } = await fixture(t), server = await startServer(e, { close() {} }); t.after(() => server.close());
  assert.equal((await fetch(server.url + 'export.md')).status, 400);
  await assert.rejects(e.command('finish', { revision: e.doc.revision }), /preferred|hypothetical/i);
  assert.equal(e.doc.finishedAt, null);
  const backup = await fetch(server.url + 'export.json'); assert.equal(backup.status, 200); assert.deepEqual(await backup.json(), e.doc);
  await enable(); const response = await fetch(server.url + 'export.md'); assert.equal(response.status, 200);
  const content = (await response.text()).replaceAll('\\', ''); assert.match(content, /Scenario at export: hypothetical/); assert.ok(content.includes(e.doc.id));
  assert.match(content, /Tentative|tentative/); assert.match(content, /not.*current project decision/i);
});

test('question acceptance rechecks preference after asynchronous history preparation', async t => {
  const { e, enable, store } = await fixture(t); await enable();
  await e.command('questions', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id });
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'Next conditional question?', category: 'Choice' }] });
  const history = await e.history(e.activeKey), commit = history.commit.bind(history), before = structuredClone(e.doc);
  history.commit = async (...args) => { await store.update(await store.read(), null, 'Changed while preparing history'); return commit(...args); };
  await assert.rejects(e.command('accept-questions', { revision: e.doc.revision, batchId: e.preview.id, selected: [{ index: 0, question: 'Next conditional question?' }] }), /changed|stale/i);
  assert.deepEqual(e.doc, before);
});

test('owned research rechecks a queued preference and discards a result returned under an obsolete selection', async t => {
  let calls = 0, captured, deliver;
  const result = { basis: 'reasoning', summary: 'Conditional research', options: [{ title: 'A', description: 'First', pros: [], cons: [] }, { title: 'B', description: 'Second', pros: [], cons: [] }], recommendation: 'A', uncertainty: 'Unverified', sources: [] };
  const { e, a, enable, store } = await fixture(t, { researcher: { models: fixtureResearchModels, async run(context) { calls++; captured = context; return new Promise(resolve => { deliver = resolve; }); }, async close() {} } });
  const start = async () => {
    const review = await e.reviewResearch({ action: 'prepare', clientId: randomUUID(), sequence: 1, journey: e.activeKey, nodeId: e.doc.nodes[1].id, scope: 'decisions', excluded: [] });
    await e.command('research', { journey: e.activeKey, nodeId: e.doc.nodes[1].id, token: review.token });
  };
  const gate = Promise.withResolvers();
  try {
    await enable(); e.researchTask = gate.promise; await start();
    await store.update(await store.read(), null, 'Clear while queued'); gate.resolve(); await Promise.all([...e.researchTasks]);
    assert.equal(calls, 0); assert.match(e.error, /changed|obsolete/i);
    await start(); await until(() => captured); assert.equal(captured.scenario.classification, 'unselected');
    await store.update(await store.read(), { identity: scenarioIdentity(a.document), location: a.key }, 'Original preferred again');
    deliver(result); await Promise.all([...e.researchTasks]); assert.equal(e.doc.nodes[1].research, null); assert.match(e.error, /changed|obsolete/i);
  } finally { gate.resolve(); deliver?.(result); }
});

test('answer checks cannot dispatch after project-source freshness yields to a changed preference', async t => {
  let calls = 0;
  const { e, enable, store } = await fixture(t, { checkHelper: { async run() { calls++; return { findings: [] }; }, async close() {} } });
  await enable();
  e.projectContext.fresh = async (capture, options) => {
    if (!options) await store.update(await store.read(), null, 'Changed while validating project sources');
    return true;
  };
  await e.checkRequest({ action: 'start', id: randomUUID(), journey: e.activeKey }); await e.toolFreeTask;
  assert.equal(calls, 0); assert.match(e.checkWork.error, /changed|obsolete/i);
});

test('answer check result retention and polling recheck preference after project freshness I/O', async t => {
  for (const phase of ['result', 'poll']) {
    let checks = 0, completed = false, changed = false;
    const { e, enable, store } = await fixture(t, { checkHelper: { async run() { return { findings: [] }; }, async close() {} } }); await enable();
    e.projectContext.fresh = async (capture, options) => {
      if (!options) checks++;
      if (!changed && (phase === 'result' ? checks === 2 : completed && options?.content === false)) { changed = true; await store.update(await store.read(), null, `Changed during ${phase}`); }
      return true;
    };
    const input = { id: randomUUID(), journey: e.activeKey }; await e.checkRequest({ ...input, action: 'start' }); await e.toolFreeTask;
    if (phase === 'result') { assert.notEqual(e.checkWork.status, 'result'); assert.equal(e.checkWork.findings, undefined); }
    completed = true; const result = await e.checkRequest({ ...input, action: 'poll' });
    assert.notEqual(result.status, 'result'); assert.equal(result.findings, undefined); assert.match(result.error, /changed|obsolete/i);
  }
});
