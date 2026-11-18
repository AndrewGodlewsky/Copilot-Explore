import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { buildScenario } from '../com.github.copilot/extensions/explorer/scenario-fork.mjs';
import { scenarioFamily } from '../com.github.copilot/extensions/explorer/scenario-preference.mjs';
import { personalPreferenceStore } from '../com.github.copilot/extensions/explorer/scenario-preference-store.mjs';
import { ScenarioPreferences } from '../com.github.copilot/extensions/explorer/scenario-preference-workflow.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'scenario-choice-'));
  t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); return rm(directory, { recursive: true, force: true }); });
  const library = new Library(directory), original = createDocument('Choose a direction');
  original.nodes.push({ id: 'choice', parentId: original.rootId, question: 'Where?', category: 'Place', answer: 'Local', answerState: 'assumption', research: null, review: true });
  const alternative = buildScenario(original, { nodeId: 'choice', answer: 'Remote', answerState: 'tentative' }).document;
  const a = await library.import(original), b = await library.import(alternative), e = await new Explorer({ library, binding: 'preference-test' }).load();
  t.after(() => e.close()); await e.attach(a.key);
  const workflow = new ScenarioPreferences(), request = (action, input = {}) => workflow.request(e, { action, journey: e.activeKey, revision: e.doc.revision, ...input });
  e.scenarioPreferences = workflow;
  const store = await personalPreferenceStore(library, scenarioFamily(original));
  return { e, a, b, workflow, request, store, directory };
}

test('explicit current selection records rationale and identifies the exact policy source without changing maps', async t => {
  const { e, a, b, workflow, request } = await fixture(t), before = await Promise.all([readFile(a.file), readFile(b.file)]);
  let view = await request('inspect'); assert.equal(view.selection.status, 'unselected'); assert.equal(view.source.identity.id, e.doc.id);
  view = await request('select', { id: view.id, rationale: '  Prefer this 🌱\n' });
  assert.equal(view.selection.status, 'preferred'); assert.equal(view.history[0].rationale, '  Prefer this 🌱\n');
  const policy = await workflow.policy(e);
  assert.equal(policy.label.classification, 'preferred'); assert.equal(policy.label.source.id, e.doc.id);
  assert.equal(JSON.stringify(policy.label).includes(a.key), false, 'private location keys are not model context');
  assert.deepEqual(await Promise.all([readFile(a.file), readFile(b.file)]), before);
});

test('unchanged policy checks keep the polling observation stable while actual selections invalidate it', async t => {
  const { e, workflow, request } = await fixture(t);
  await workflow.observe(e); const initial = workflow.observation;
  await workflow.policy(e); assert.equal(workflow.observation, initial);
  let view = await request('inspect'); assert.equal(workflow.observation, initial);
  await request('select', { id: view.id, rationale: 'New choice' });
  assert.notEqual(workflow.observation, initial); assert.equal(workflow.observation.status, 'preferred');
  const preferred = workflow.observation;
  await workflow.policy(e); assert.equal(workflow.observation, preferred);
});

test('retained alternatives require explicit hypothetical use and later preference changes invalidate captured policy', async t => {
  const { e, a, b, workflow, request, store } = await fixture(t);
  let view = await request('inspect'); await request('select', { id: view.id, rationale: '' }); await e.attach(b.key);
  view = await request('inspect'); assert.equal(view.selection.status, 'alternative');
  await assert.rejects(workflow.policy(e), /preferred|hypothetical/i);
  const raw = await readFile(store.file);
  await request('hypothetical', { id: view.id, enabled: true }); const captured = await workflow.policy(e);
  assert.equal(captured.label.classification, 'hypothetical'); assert.equal(captured.label.source.id, b.document.id);
  assert.deepEqual(await readFile(store.file), raw, 'hypothetical consent is private and transient');
  await workflow.assertPolicy(e, captured);
  await store.update(await store.read(), null, 'Clear elsewhere');
  await assert.rejects(workflow.assertPolicy(e, captured), /changed|obsolete/i);
  assert.equal((await workflow.policy(e)).label.classification, 'unselected');
  assert.equal(e.doc.nodes.find(n => n.id !== e.doc.rootId).answerState, 'tentative');
  assert.ok(a.key !== b.key);
});

test('missing preferred sources remain unresolved until an explicit new choice or clear; source navigation never substitutes', async t => {
  const { e, a, b, workflow, request } = await fixture(t);
  let view = await request('inspect'); await request('select', { id: view.id, rationale: 'Keep original' }); await e.attach(b.key);
  await rm(a.file); view = await request('inspect'); assert.equal(view.selection.status, 'unresolved');
  assert.equal(view.selection.preferred.identity.id, a.document.id);
  await assert.rejects(workflow.policy(e), /unresolved|unavailable|missing/i);
  await assert.rejects(workflow.source(e, view.id), /unresolved|unavailable|missing/i);
  await assert.rejects(request('hypothetical', { id: view.id, enabled: true }), /unresolved|alternative/i);
  view = await request('clear', { id: view.id, rationale: 'Explicitly unset missing choice' });
  assert.equal(view.selection.status, 'unselected'); assert.equal(view.history.length, 2);
});

test('stale map tokens and malformed actions cannot select a preference, and retained history restores only an available exact source', async t => {
  const { e, a, b, request, store } = await fixture(t);
  let view = await request('inspect'); const stale = view.id;
  await e.command('guidance', { revision: e.doc.revision, objective: 'Changed', successCriteria: '' });
  await assert.rejects(request('select', { id: stale, rationale: '' }), /changed|obsolete/i);
  assert.equal((await store.read()).digest, null);
  view = await request('inspect');
  await assert.rejects(request('select', { id: view.id, rationale: '', unexpected: true }), /Invalid/);
  await request('select', { id: view.id, rationale: 'First' }); await e.attach(b.key);
  view = await request('inspect'); view = await request('select', { id: view.id, rationale: 'Second' });
  view = await request('restore', { id: view.id, eventRevision: 1, rationale: 'Back to first' });
  assert.equal(view.selection.status, 'alternative'); assert.equal(view.history[0].preferred.identity.id, a.document.id); assert.equal(view.selection.revision, 3);
  await assert.rejects(request('restore', { id: view.id, eventRevision: 99, rationale: '' }), /history|retained/i);
});

test('a source edit during target validation rejects preference publication', async t => {
  const { e, a, workflow, request, store } = await fixture(t), view = await request('inspect');
  const resolveTarget = workflow.resolve.bind(workflow);
  workflow.resolve = async (...args) => {
    const changed = structuredClone(e.doc); changed.nodes[1].answer = 'Changed externally';
    await writeFile(a.file, JSON.stringify(changed)); return resolveTarget(...args);
  };
  await assert.rejects(request('select', { id: view.id, rationale: '' }), /changed/i);
  assert.equal((await store.read()).digest, null);
  assert.equal(JSON.parse(await readFile(a.file, 'utf8')).nodes[1].answer, 'Changed externally');
});

test('hypothetical consent requires the preferred source to remain available after inspection', async t => {
  const { e, a, b, request } = await fixture(t);
  let view = await request('inspect'); await request('select', { id: view.id, rationale: '' }); await e.attach(b.key);
  view = await request('inspect'); await rm(a.file);
  await assert.rejects(request('hypothetical', { id: view.id, enabled: true }), /unavailable|unresolved/i);
});

test('controller invalidates preference tokens across A-to-B-to-A and opens only the exact available preferred source', async t => {
  const { e, a, b, request } = await fixture(t);
  let view = await e.scenarioPreferenceRequest({ action: 'inspect', journey: e.activeKey, revision: e.doc.revision });
  await e.attach(b.key); await e.attach(a.key);
  await assert.rejects(request('select', { id: view.id, rationale: 'Obsolete page' }), /changed/i);
  view = await request('inspect'); await request('select', { id: view.id, rationale: '' }); await e.attach(b.key);
  const node = e.doc.nodes[1]; await e.writeDraft({ journey: e.activeKey, nodeId: node.id, base: node, text: 'Retain this private draft', answerState: 'tentative', stateSelected: true, revision: 0 });
  const draft = await e.readDrafts(b.key); view = await request('inspect');
  e.pending = { id: 'active-request', kind: 'questions', nodeId: e.doc.rootId };
  await assert.rejects(e.command('open-preferred-source', { id: view.id, journey: e.activeKey, revision: e.doc.revision }), /pending|active/i);
  e.pending = null;
  await e.command('open-preferred-source', { id: view.id, journey: e.activeKey, revision: e.doc.revision });
  assert.equal(e.activeKey, a.key); await e.attach(b.key); assert.deepEqual(await e.readDrafts(b.key), draft);
});

test('preference HTTP validates origin and exact fields; native model reads require an explicit scenario policy', async t => {
  const { e, b, request } = await fixture(t), server = await startServer(e);
  t.after(() => server.close());
  const post = (body, authorized = true) => fetch(new URL('api/scenario-preference', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { 'X-Explorer-Client': '1', Origin: new URL(server.url).origin } : {}) }, body: JSON.stringify({ journey: e.activeKey, revision: e.doc.revision, ...body }) });
  assert.equal((await post({ action: 'inspect' }, false)).status, 403);
  assert.equal((await post({ action: 'inspect', unexpected: true })).status, 400);
  const response = await post({ action: 'inspect' }); assert.equal(response.status, 200); let view = await response.json();
  assert.equal((await post({ action: 'select', id: view.id, rationale: '' })).status, 200);
  await e.attach(b.key); await assert.rejects(e.nativeSnapshot(), /preferred|hypothetical/i);
  view = await request('inspect'); await request('hypothetical', { id: view.id, enabled: true });
  const native = await e.nativeSnapshot(); assert.equal(native.scenario.classification, 'hypothetical'); assert.equal(native.document.id, b.document.id);
  assert.equal(native.document.nodes[1].answerState, 'tentative');
});

test('project policy remains read-only inside a document writer lock and preferred navigation reopens the selected shared file', async t => {
  const { e, a, b, workflow, request, directory } = await fixture(t), root = join(directory, 'checkout'); await mkdir(root);
  await promisify(execFile)('git', ['-C', root, 'init', '-q'], { windowsHide: true });
  e.projectRepository = new ProjectRepository({ readRoot: async () => root, localDirectory: directory });
  const original = await e.projectRepository.create(a.document), alternative = await e.projectRepository.create(b.document);
  await e.attachProject(original); let view = await request('inspect'); await request('select', { id: view.id, rationale: 'Shared choice' });
  const before = await readFile(original.context.file);
  await original.context.withLock(async () => assert.equal((await workflow.policy(e)).label.classification, 'preferred'));
  assert.deepEqual(await readFile(original.context.file), before);
  await e.attachProject(alternative); view = await request('inspect');
  await e.command('open-preferred-source', { id: view.id, journey: e.activeKey, revision: e.doc.revision });
  assert.equal(e.projectStore.context.relativePath, original.context.relativePath); assert.equal(e.doc.id, a.document.id);
});
