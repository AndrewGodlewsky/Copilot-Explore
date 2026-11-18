import test from 'node:test';
import assert from 'node:assert/strict';
import * as fork from '../com.github.copilot/extensions/explorer/scenario-fork.mjs';
import { createDocument, addQuestions, addDirection, addDependency, validateDocument, importedDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { savedDigest } from '../com.github.copilot/extensions/explorer/review-causes.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { ProjectJourney } from '../com.github.copilot/extensions/explorer/project-journey.mjs';
import { projectStorageContext } from '../com.github.copilot/extensions/explorer/storage-context.mjs';

function map() {
  const doc = createDocument('Scenario', { objective: 'Keep this goal', successCriteria: 'Keep these criteria', mode: 'decide' });
  const [a, outside] = addQuestions(doc, doc.rootId, [{ question: 'A?', category: 'Scope' }, { question: 'Outside?', category: 'Scope' }]);
  const direction = addDirection(doc, a.id, 'User direction');
  const [b] = addQuestions(doc, direction.id, [{ question: 'B?', category: 'Scope' }]);
  const [child] = addQuestions(doc, b.id, [{ question: 'Old downstream?', category: 'Scope' }]);
  for (const n of [a, b, child, outside]) { n.answer = `Saved ${n.question}`; n.answerState = 'decided'; }
  addDependency(doc, a.id, outside.id, 'External premise'); addDependency(doc, a.id, b.id, 'Mixed cycle');
  return { doc, a, b, child, outside, direction };
}
const proposal = b => ({ nodeId: b.id, answer: '  Alternative 🦞\nexact text  ', answerState: 'tentative' });

test('fork copies bounded ancestor context with fresh IDs and explicit omissions without mutating source', () => {
  const { doc, a, b, child, outside } = map(), before = structuredClone(doc);
  const result = fork.buildScenario(doc, proposal(b), '2026-11-18T00:00:00.000Z'), next = result.document;
  assert.deepEqual(doc, before); assert.notEqual(next.id, doc.id); assert.equal(next.nodes.length, 4);
  assert.equal(next.objective, doc.objective); assert.equal(next.successCriteria, doc.successCriteria); assert.equal(next.mode, doc.mode);
  assert.equal(next.nodes.at(-1).answer, proposal(b).answer); assert.equal(next.nodes.at(-1).answerState, 'tentative');
  assert.equal(next.nodes.at(-1).review, false); assert.equal(next.nodes[1].review, true);
  assert.ok(next.nodes.every(n => !doc.nodes.some(old => old.id === n.id) && n.research === null));
  assert.equal(next.dependencies.length, 1); assert.equal(result.omittedDependencies.length, 1);
  assert.equal(result.omittedDependencies[0].prerequisiteId, outside.id); assert.equal(result.omittedNodes, 2);
  assert.ok(!next.nodes.some(n => n.question === child.question)); assert.equal(next.forkOrigin.source.digest, savedDigest(validateDocument(doc)));
  assert.equal(next.forkOrigin.nodes.find(n => n.sourceNodeId === a.id).origin.nodeId, a.id);
  assert.deepEqual(validateDocument(next), next); assert.deepEqual(fork.buildScenario(doc, proposal(b), next.createdAt).document, next);
});

test('fork lineage survives later edits, missing source, nested forks, exports and project copy identity changes', () => {
  const { doc, b } = map(), first = fork.buildScenario(doc, proposal(b)).document;
  const second = fork.buildScenario(first, { nodeId: first.forkOrigin.forkNodeId, answer: 'Another', answerState: 'assumption' }).document;
  assert.equal(second.forkOrigin.source.journeyId, first.id);
  assert.deepEqual(second.forkOrigin.nodes.map(n => n.origin), first.forkOrigin.nodes.map(n => n.origin));
  first.nodes.pop(); first.dependencies = []; // Historical mappings outlive their current nodes.
  assert.deepEqual(importedDocument(first).forkOrigin, first.forkOrigin);
  const shared = readSharedDocument(prepareSharedMigration(JSON.stringify(first)).content).document;
  assert.deepEqual(shared.journey.forkOrigin, first.forkOrigin);
  first.id = 'project-copy-id'; assert.deepEqual(validateDocument(first).forkOrigin, first.forkOrigin);
  assert.match(toMarkdown(first), /Scenario origin/); assert.match(toMarkdown(first), new RegExp(doc.id));
  for (const change of [x => x.forkOrigin.extra = true, x => x.forkOrigin.source.digest = 'bad', x => x.forkOrigin.source.digest = ['a'.repeat(64)], x => x.forkOrigin.nodes.push(x.forkOrigin.nodes[0]), x => x.forkOrigin.forkNodeId = 'missing-mapping']) {
    const bad = structuredClone(first); change(bad); assert.throws(() => validateDocument(bad), /scenario origin/i);
  }
});

test('fork rejects unchanged, invalid and structural alternatives and handles the maximum ancestor depth iteratively', () => {
  const { doc, b, direction } = map();
  for (const input of [{ nodeId: b.id, answer: b.answer, answerState: b.answerState }, { nodeId: direction.id, answer: 'New', answerState: 'decided' }, { nodeId: b.id, answer: '', answerState: 'unanswered' }]) assert.throws(() => fork.buildScenario(doc, input), /alternative|question/i);
  const deep = createDocument('Deep');
  for (let i = 1; i < 5000; i++) deep.nodes.push({ id: `n${i}`, parentId: deep.nodes.at(-1).id, question: `Question ${i}`, category: 'Scope', answer: '', research: null, review: false });
  assert.equal(fork.buildScenario(deep, { nodeId: 'n4999', answer: 'New', answerState: 'decided' }).document.nodes.length, 5000);
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scenario-fork-')), library = new Library(dir), values = map();
  const record = await library.import(values.doc), sends = [];
  const e = await new Explorer({ library, binding: 'source', send: async x => sends.push(x), target: { instanceId: 'test' } }).load();
  await e.command('open', { key: record.key });
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (action, extra = {}) => e.scenarioForkRequest({ action, journey: e.activeKey, revision: e.doc.revision, ...extra });
  return { ...values, e, library, sends, request };
}

test('fork preview, cancellation and retries preserve source bytes/drafts and create one separately reopenable scenario', async t => {
  const f = await fixture(t), { e, b, request, library } = f, sourceFile = e.file, sourceKey = e.activeKey, raw = await readFile(sourceFile, 'utf8');
  await e.writeDraft({ journey: e.activeKey, nodeId: b.id, base: b, text: 'Private source draft', answerState: 'tentative', stateSelected: true, revision: 0 });
  const drafts = await e.readDrafts(sourceKey);
  let p = await request('preview', proposal(b)); assert.equal(p.copiedNodes, 4); assert.equal(p.omittedNodes, 2);
  assert.equal(p.links.total, 1); assert.equal((await library.list()).entries.length, 1);
  await request('discard', { id: p.id }); await assert.rejects(request('confirm', { id: p.id }), /preview/i);
  p = await request('preview', proposal(b)); const created = await request('confirm', { id: p.id });
  assert.equal(e.activeKey, sourceKey); assert.equal(await readFile(sourceFile, 'utf8'), raw); assert.deepEqual(await e.readDrafts(sourceKey), drafts); assert.equal(f.sends.length, 0);
  assert.equal((await request('confirm', { id: p.id })).key, created.key);
  const nextPreview = await request('preview', proposal(b)); assert.equal(nextPreview.existing, true);
  assert.equal((await request('confirm', { id: nextPreview.id })).key, created.key); assert.equal((await library.list()).entries.length, 2);
  await e.command('open', { revision: e.doc.revision, key: created.key });
  assert.equal(e.doc.nodes.at(-1).answer, proposal(b).answer); assert.equal((await e.readDrafts(e.activeKey)).entries.length, 0);
  assert.notEqual(e.file, sourceFile); assert.equal(f.sends.length, 0);
  await e.command('open', { revision: e.doc.revision, key: sourceKey }); assert.deepEqual(await e.readDrafts(sourceKey), drafts);
});

test('fork rejects stale source, active requests and late source changes before destination write', async t => {
  const { e, b, request, library } = await fixture(t);
  let p = await request('preview', proposal(b));
  e.pending = { id: 'request', kind: 'questions' }; await assert.rejects(request('confirm', { id: p.id }), /request|active/i); e.pending = null;
  const original = library.import.bind(library);
  library.import = async (doc, options) => { await writeFile(e.file, JSON.stringify({ ...e.doc, revision: e.doc.revision + 1 })); return original(doc, options); };
  await assert.rejects(request('confirm', { id: p.id }), /changed/i); assert.equal((await library.list()).entries.length, 1);
  await assert.rejects(request('preview', proposal(b)), /changed/i);
});

test('fork failed save and lost response can retry, but evolved destination is never overwritten', async t => {
  const { e, b, request, library } = await fixture(t), raw = await readFile(e.file, 'utf8');
  const p = await request('preview', proposal(b)), original = library.import.bind(library);
  library.import = async () => { throw Error('Storage unavailable'); }; await assert.rejects(request('confirm', { id: p.id }), /Storage/);
  library.import = async (...args) => { await original(...args); throw Error('Lost response'); }; await assert.rejects(request('confirm', { id: p.id }), /Lost response/);
  library.import = original; const created = await request('confirm', { id: p.id });
  assert.equal((await library.list()).entries.length, 2); const record = await library.resolve(created.key);
  const changed = { ...record.document, revision: 1, objective: 'Changed independently' }; await writeFile(record.file, JSON.stringify(changed));
  await assert.rejects(request('confirm', { id: p.id }), /evolved|changed|conflict/i);
  await assert.rejects(request('preview', proposal(b)), /evolved|changed|conflict/i);
  assert.equal(await readFile(e.file, 'utf8'), raw); assert.equal(JSON.parse(await readFile(record.file, 'utf8')).objective, changed.objective);
});

test('fork HTTP requires instance origin and rejects unexpected inputs', async t => {
  const { e, b } = await fixture(t), server = await startServer(e); t.after(() => server.close());
  const input = { action: 'preview', journey: e.activeKey, revision: e.doc.revision, ...proposal(b) };
  const request = headers => fetch(new URL('api/scenario-fork', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...headers }, body: JSON.stringify(input) });
  assert.equal((await request({})).status, 403);
  const response = await request({ Origin: new URL(server.url).origin }); assert.equal(response.status, 200); assert.equal((await response.json()).copiedNodes, 4);
  await assert.rejects(e.scenarioForkRequest({ ...input, secret: 'unexpected' }), /Invalid/);
});

test('fork destination creation never overwrites a file that appears during its final guard', async t => {
  const { e, b, request, library } = await fixture(t), p = await request('preview', proposal(b)), doc = JSON.parse(p.content);
  const file = join(library.directory, `journey-${createHash('sha256').update(doc.id).digest('hex')}.explore.json`);
  const original = library.import.bind(library);
  library.import = (document, options) => original(document, { beforeWrite: async () => { await options.beforeWrite(); await writeFile(file, 'Preserve independently created file'); } });
  await assert.rejects(request('confirm', { id: p.id }), /save|occupies|exists/i);
  assert.equal(await readFile(file, 'utf8'), 'Preserve independently created file');
  assert.equal(e.doc.id, doc.forkOrigin.source.journeyId);
});

test('fork from a shared project remains personal and preserves project bytes and private state', async t => {
  const { e, library, b, request } = await fixture(t), root = await mkdtemp(join(tmpdir(), 'fork-project-'));
  t.after(() => rm(root, { recursive: true, force: true })); await mkdir(join(root, '.explorer'));
  const file = join(root, '.explorer', 'source.explore.json'), context = await projectStorageContext({ checkoutDirectory: root, localDirectory: library.directory, file, journeyId: e.doc.id });
  const store = new ProjectJourney(context); await store.create(e.doc); await e.attachProject(store);
  const raw = await readFile(file), key = e.activeKey;
  await e.writeDraft({ journey: key, nodeId: b.id, base: b, text: 'Project private draft', answerState: 'tentative', stateSelected: true, revision: 0 });
  const before = await e.readDrafts(key), p = await request('preview', proposal(b)), saved = await request('confirm', { id: p.id });
  assert.equal(e.snapshot().storage.scope, 'project'); assert.deepEqual(await readFile(file), raw); assert.deepEqual(await e.readDrafts(key), before);
  await e.command('open', { revision: e.doc.revision, key: saved.key }); assert.equal(e.snapshot().storage.scope, 'personal');
  assert.equal((await e.readDrafts(e.activeKey)).entries.length, 0); assert.equal(e.doc.forkOrigin.source.journeyId, store.document.id);
});

test('fork omits research/reminders/provenance and isolates callbacks and helper state after explicit opening', async t => {
  const { e, b, request } = await fixture(t), source = structuredClone(e.doc);
  const n = source.nodes.find(n => n.id === b.id);
  n.research = { basis: 'reasoning', summary: 'Original-only analysis', options: ['A', 'B'].map(title => ({ title, description: title, pros: [], cons: [] })), recommendation: 'A', uncertainty: 'Unknown', sources: [] };
  n.generation = { requestId: 'old-generation', originalQuestion: n.question, originalCategory: n.category, adjusted: false }; n.rationale = 'Historical rationale';
  const built = fork.buildScenario(source, proposal(b)).document;
  assert.equal(built.nodes.at(-1).research, null); assert.equal(built.nodes.at(-1).generation, undefined); assert.equal(built.nodes.at(-1).rationale, undefined);
  await e.command('questions', { revision: e.doc.revision, nodeId: b.id }); const requestId = e.pending.id;
  await assert.rejects(request('preview', proposal(b)), /request|active/i); await e.command('cancel');
  const cleanup = { journey: e.activeKey, nodeId: b.id, abort: new AbortController(), status: 'pending' }; e.cleanup = cleanup;
  const p = await request('preview', proposal(b)), saved = await request('confirm', { id: p.id }); assert.equal(cleanup.abort.signal.aborted, false);
  await e.command('open', { revision: e.doc.revision, key: saved.key }); assert.equal(cleanup.abort.signal.aborted, true); assert.equal(e.cleanup, null);
  const current = structuredClone(e.doc); await assert.rejects(e.receive('questions', { requestId, questions: [{ question: 'Stale source callback?', category: 'Scope' }] }), /cancelled|replaced/);
  assert.deepEqual(e.doc, current); assert.equal(e.preview, null);
});
