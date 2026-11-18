import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareAdrScope, captureAdrScope } from '../com.github.copilot/extensions/explorer/adr-scope.mjs';
import { defaultAdrFormat } from '../com.github.copilot/extensions/explorer/adr-format.mjs';
import { actionSchemas } from '../com.github.copilot/extensions/explorer/canvas.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { waitFor } from './helpers/wait-for.mjs';

async function fixture(t, withLibrary = false) {
  const directory = await mkdtemp(join(tmpdir(), 'adr-questions-')), doc = createDocument('Storage decision'), sent = [];
  let file = join(directory, 'map.explore.json');
  const [focal, support] = addQuestions(doc, doc.rootId, [{ question: 'Which store?', category: 'Design' }, { question: 'Who operates it?', category: 'People' }]);
  focal.answer = 'Maybe A'; focal.answerState = 'tentative'; support.answer = 'Assume the team'; support.answerState = 'assumption';
  await writeFile(file, JSON.stringify(doc));
  const library = withLibrary ? new Library(join(directory, 'library')) : undefined, entry = library ? await library.import(doc) : null;
  const e = await new Explorer({ file, library, binding: 'adr-questions', target: { instanceId: 'adr-questions-fixture' }, send: async value => sent.push(value) }).load();
  if (entry) { await e.attach(entry.key); file = entry.file; }
  t.after(async () => { await e.close(); await rm(directory, { recursive: true, force: true }); });
  const scoped = structuredClone(e.doc); scoped.adrFormat = defaultAdrFormat();
  scoped.adrScope = captureAdrScope(prepareAdrScope(scoped, { focalId: focal.id, nodeIds: [focal.id, support.id], includeEvidence: false }, { scenario: (await e.scenarioPolicy()).label }));
  await e.save(scoped);
  let sequence = 0; const clientId = randomUUID();
  const input = extra => ({ action: 'prepare', purpose: 'adr-questions', journey: e.activeKey ?? e.doc.id, nodeId: e.doc.rootId, clientId, sequence: ++sequence, ...extra });
  const review = extra => e.reviewResearch(input(extra));
  const command = (action, extra = {}) => e.command(action, { revision: e.doc.revision, ...extra });
  const start = value => command('adr-questions', { journey: e.activeKey ?? e.doc.id, nodeId: e.doc.rootId, token: value.token });
  return { e, directory, file, sent, focal, support, input, review, command, start };
}
const candidates = [{ question: 'Which cost would make A unacceptable?', category: 'Consequences', rationale: 'The saved tentative choice does not state an acceptable cost.' }];

test('ADR questions enqueue exactly reviewed scoped input and require explicit user acceptance at the focal question', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), p = await f.review();
  assert.equal(f.sent.length, 0); assert.equal(p.prepared.operation, 'adr-questions'); assert.equal(p.prepared.settings, undefined);
  assert.equal(await readFile(f.file, 'utf8'), before);
  await f.start(p); await waitFor(() => f.sent.length === 1);
  assert.equal(f.sent[0].mode, 'enqueue'); assert.equal(f.sent[0].prompt, p.prepared.prompt); assert.equal(f.e.pending.nodeId, f.focal.id);
  const requestId = f.e.pending.id; assert.ok(p.prepared.prompt.includes(requestId));
  await f.e.receive('questions', { requestId, questions: candidates });
  assert.equal(f.e.uiSnapshot().preview.purpose, 'adr-questions'); assert.equal(f.e.snapshot().preview, undefined); assert.equal(await readFile(f.file, 'utf8'), before);
  await assert.rejects(f.command('accept-questions', { batchId: requestId, selected: [{ index: 0, question: f.support.question.toUpperCase() }] }), /duplicate/i);
  await f.command('accept-questions', { batchId: requestId, selected: [{ index: 0, question: candidates[0].question }] });
  const saved = f.e.doc.nodes.at(-1); assert.equal(saved.parentId, f.focal.id); assert.equal(saved.answer, ''); assert.equal(saved.rationale, candidates[0].rationale);
  assert.equal(f.e.doc.nodes.find(n => n.id === f.focal.id).answerState, 'tentative'); assert.equal(f.e.doc.nodes.find(n => n.id === f.support.id).answerState, 'assumption');
});

test('ADR empty results stay optional unsaved previews while ordinary requests still reject zero and ADR rejects over three', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8');
  const p = await f.review(); await f.start(p); await waitFor(() => f.sent.length === 1); const requestId = f.e.pending.id;
  await assert.rejects(f.e.receive('questions', { requestId, questions: Array.from({ length: 4 }, (_, i) => ({ question: `Gap ${i}?`, category: 'ADR' })) }), /3|three/i);
  await f.e.receive('questions', { requestId, questions: [] });
  assert.equal(f.e.preview.questions.length, 0); assert.equal(f.e.preview.purpose, 'adr-questions'); assert.equal(f.e.pending, null); assert.equal(await readFile(f.file, 'utf8'), before);
  await assert.rejects(f.command('accept-questions', { batchId: requestId, selected: [] }), /select|question/i);
  await f.command('dismiss-questions', { batchId: requestId });
  await f.command('questions', { nodeId: f.e.doc.rootId });
  await assert.rejects(f.e.receive('questions', { requestId: f.e.pending.id, questions: [] }), /at least one/i);
  assert.equal(actionSchemas.submit_questions.properties.questions.minItems, 0);
});

test('ADR review rejects missing or stale scope, extra fields, wrong purpose, old or expired tokens and cancellation without dispatch', async t => {
  const f = await fixture(t), old = await f.review(), p = await f.review();
  await assert.rejects(f.start(old), /obsolete|review/i);
  await assert.rejects(f.command('regenerate-questions', { journey: f.e.doc.id, nodeId: f.e.doc.rootId, token: p.token }), /purpose/i);
  await assert.rejects(f.review({ excluded: [] }), /invalid/i);
  f.e.researchReview.current.expiresAt = Date.now() - 1; await assert.rejects(f.start(p), /obsolete|review/i);
  const cancelled = await f.review(); await f.e.reviewResearch(f.input({ action: 'cancel' })); await assert.rejects(f.start(cancelled), /obsolete|review/i);
  const changed = structuredClone(f.e.doc); changed.nodes[1].answer = 'Corrected'; await f.e.save(changed);
  await assert.rejects(f.review(), /scope|stale|review/i);
  delete changed.adrScope; await f.e.save(changed); await assert.rejects(f.review(), /scope/i); assert.equal(f.sent.length, 0);
});

test('ADR saved format edits invalidate reviewed starts and captured candidates without changing source decisions', async t => {
  const f = await fixture(t), old = await f.review();
  const changed = structuredClone(f.e.doc); changed.adrFormat.digits = 5; await f.e.save(changed);
  await assert.rejects(f.start(old), /changed|review/i);
  const p = await f.review(); await f.start(p); await waitFor(() => f.sent.length === 1); const requestId = f.e.pending.id;
  await f.e.receive('questions', { requestId, questions: candidates });
  const newer = structuredClone(f.e.doc); newer.adrFormat.directory = 'docs/adr'; await f.e.save(newer);
  assert.equal(f.e.uiSnapshot().preview.stale, true);
  await assert.rejects(f.command('accept-questions', { batchId: requestId, selected: [{ index: 0, question: candidates[0].question }] }), /changed|stale/i);
  assert.equal(f.e.doc.nodes.length, 3);
});

test('ADR cancellation and source correction reject late or mismatched callbacks', async t => {
  const f = await fixture(t), p = await f.review(); await f.start(p); await waitFor(() => f.sent.length === 1); const first = f.e.pending.id;
  await assert.rejects(f.e.receive('questions', { requestId: 'wrong', questions: candidates }), /cancelled|replaced/i);
  await f.command('cancel'); await assert.rejects(f.e.receive('questions', { requestId: first, questions: candidates }), /cancelled|replaced/i);
  const next = await f.review(); await f.start(next); await waitFor(() => f.sent.length === 2); const second = f.e.pending.id;
  const changed = structuredClone(f.e.doc); changed.adrFormat.digits = 6; changed.revision++; await writeFile(f.file, JSON.stringify(changed));
  await assert.rejects(f.e.receive('questions', { requestId: second, questions: candidates }), /changed/i);
  assert.equal(f.e.pending, null); assert.equal(f.e.preview, null); assert.equal(f.e.doc.nodes.length, 3);
});

test('ADR dispatch rechecks disk after the asynchronous queued scenario policy check', async t => {
  const f = await fixture(t), p = await f.review(), original = f.e.assertScenarioPolicy.bind(f.e); let checks = 0;
  f.e.assertScenarioPolicy = async policy => { await original(policy); if (++checks === 3) { const changed = structuredClone(f.e.doc); changed.adrFormat.digits = 6; changed.revision++; await writeFile(f.file, JSON.stringify(changed)); } };
  await f.start(p); await waitFor(() => f.e.pending === null); await f.e.queue;
  assert.equal(f.sent.length, 0); assert.match(f.e.error, /changed/i);
});

test('ADR HTTP review and start enforce origin and client headers before dispatch', async t => {
  const f = await fixture(t), server = await startServer(f.e); t.after(() => server.close());
  const url = new URL('api/research-review', server.url), headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: url.origin };
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://elsewhere.invalid' }, body: JSON.stringify(f.input()) })).status, 403);
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(f.input()) }); assert.equal(response.status, 200); const p = await response.json();
  const action = { action: 'adr-questions', journey: f.e.doc.id, nodeId: f.e.doc.rootId, token: p.token, revision: f.e.doc.revision }, actionUrl = new URL('api/action', server.url);
  const missing = { ...headers }; delete missing['X-Explorer-Client'];
  assert.equal((await fetch(actionUrl, { method: 'POST', headers: missing, body: JSON.stringify(action) })).status, 403); assert.equal(f.sent.length, 0);
  const noOrigin = { ...headers }; delete noOrigin.Origin;
  assert.equal((await fetch(actionUrl, { method: 'POST', headers: noOrigin, body: JSON.stringify(action) })).status, 403);
  assert.equal((await fetch(actionUrl, { method: 'POST', headers, body: JSON.stringify(action) })).status, 200); await waitFor(() => f.sent.length === 1);
});

test('ADR scenario preference changes invalidate reviewed questions even when map bytes stay identical', async t => {
  const f = await fixture(t, true), p = await f.review(), before = await readFile(f.file);
  const journey = f.e.activeKey, revision = f.e.doc.revision;
  const view = await f.e.scenarioPreferenceRequest({ action: 'inspect', journey, revision });
  await f.e.scenarioPreferenceRequest({ action: 'select', journey, revision, id: view.id, rationale: 'Current direction' });
  await assert.rejects(f.start(p), /changed|obsolete/i);
  assert.deepEqual(await readFile(f.file), before); assert.equal(f.sent.length, 0);
});

test('ADR final acceptance guard preserves an external edit made during scenario validation', async t => {
  const f = await fixture(t), p = await f.review(); await f.start(p); await waitFor(() => f.sent.length === 1);
  const requestId = f.e.pending.id; await f.e.receive('questions', { requestId, questions: candidates });
  const original = f.e.assertScenarioPolicy.bind(f.e); let checks = 0, external;
  f.e.assertScenarioPolicy = async policy => { await original(policy); if (++checks === 2) { external = structuredClone(f.e.doc); external.revision++; external.adrFormat.directory = 'docs/changed'; await writeFile(f.file, JSON.stringify(external)); } };
  await assert.rejects(f.command('accept-questions', { batchId: requestId, selected: [{ index: 0, question: candidates[0].question }] }), /changed|context/i);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), external); assert.equal(f.e.preview.stale, true);
});
