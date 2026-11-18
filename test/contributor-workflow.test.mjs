import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { ProjectJourney } from '../com.github.copilot/extensions/explorer/project-journey.mjs';
import { projectStorageContext } from '../com.github.copilot/extensions/explorer/storage-context.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
import { mergeSharedDocuments } from '../com.github.copilot/extensions/explorer/semantic-merge.mjs';
import { prepareBrief, parseBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { confirmAnswer } from './helpers/answer-change.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-contribution-flow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const doc = createDocument('Shared choices');
  addQuestions(doc, doc.rootId, [{ question: 'Which?', category: 'Decision' }, { question: 'When?', category: 'Scope' }]);
  const writers = [];
  async function writer(name, bytes) {
    const directory = join(root, name), checkoutDirectory = join(directory, 'checkout'), localDirectory = join(directory, 'private'), file = join(checkoutDirectory, 'choice.explore.json');
    await mkdir(checkoutDirectory, { recursive: true });
    const context = await projectStorageContext({ checkoutDirectory, file, localDirectory, journeyId: doc.id });
    const store = new ProjectJourney(context);
    if (bytes) { await writeFile(file, bytes); await store.load(); } else await store.create(doc);
    const e = new Explorer({ library: new Library(localDirectory), binding: 'PRIVATE_SESSION_CANARY', send() {}, target: 'PRIVATE_TARGET_CANARY' });
    await e.attachProject(store); writers.push(e);
    return { e, file, context, store };
  }
  t.after(async () => { for (const e of writers) await e.close(); });
  return { root, doc, writer };
}
const choose = (e, name, revision = 0) => e.contributorSettingsRequest({ action: 'save', displayName: name, revision });
const answer = (e, index, value) => confirmAnswer(e, { revision: e.doc.revision, nodeId: e.doc.nodes[index].id, answer: value, answerState: 'decided' });

test('two contributors clone, independently answer, merge and pull without claiming old work or leaking private settings', async t => {
  const f = await fixture(t), a = await f.writer('alice'), initial = await readFile(a.file), b = await f.writer('bob', initial);
  assert.deepEqual(await readFile(a.file), initial); assert.deepEqual(await readFile(b.file), initial);
  await choose(a.e, 'Alice λ'); await choose(b.e, 'Bob 日本語');
  assert.deepEqual(await readFile(a.file), initial);
  await answer(a.e, 1, 'A'); await answer(b.e, 2, 'Tomorrow');
  const local = readSharedDocument(await readFile(a.file)).document, incoming = readSharedDocument(await readFile(b.file)).document;
  const merged = mergeSharedDocuments(readSharedDocument(initial).document, local, incoming);
  assert.equal(merged.conflicts.length, 0);
  const combined = merged.document;
  assert.equal(combined.journey.nodes[1].attribution.answer.author.actor.displayName, 'Alice λ');
  assert.equal(combined.journey.nodes[2].attribution.answer.author.actor.displayName, 'Bob 日本語');
  const pulled = await f.writer('pulled', JSON.stringify(combined));
  assert.deepEqual(pulled.e.doc.nodes, combined.journey.nodes);
  assert.equal(pulled.e.uiSnapshot().contributions.nodes[pulled.e.doc.nodes[1].id].answer, 'current');
  for (const canary of ['PRIVATE_SESSION_CANARY', 'PRIVATE_TARGET_CANARY', f.root, 'contributor-settings', 'revision']) assert.equal(JSON.stringify(combined).includes(canary), false);
  assert.equal(prepareBrief(pulled.e.doc).prompt.includes('Alice λ'), false);
});

test('shared explicit edits preserve first author, update future names, clear identity and retain history', async t => {
  const f = await fixture(t), { e, file } = await f.writer('one');
  const first = (await choose(e, 'Alice')).settings;
  await answer(e, 1, 'First'); const revision = e.doc.revision, original = structuredClone(e.doc.nodes[1].attribution);
  await choose(e, 'Alicia', first.revision); await answer(e, 1, 'Second');
  assert.deepEqual(e.doc.nodes[1].attribution.answer.author, original.answer.author);
  assert.equal(e.doc.nodes[1].attribution.answer.editor.actor.displayName, 'Alicia');
  const saved = await readFile(file); await answer(e, 1, 'Second'); assert.deepEqual(await readFile(file), saved);
  await choose(e, null, 2); await answer(e, 1, 'Third');
  assert.equal(e.doc.nodes[1].attribution.answer.editor.actor, null);
  const history = await e.readHistory(e.activeKey, revision);
  assert.deepEqual(history.document.nodes[1].attribution, original);
  assert.equal(e.doc.nodes[0].attribution, undefined);
});

test('manual questions and explicitly accepted AI questions record different contributions, never callback identities', async t => {
  const f = await fixture(t), { e } = await f.writer('one'); await choose(e, 'Reviewer <script>');
  await e.command('add', { revision: e.doc.revision, nodeId: e.doc.rootId, question: 'Manual?', category: 'Scope' });
  assert.equal(e.doc.nodes.at(-1).attribution.question.origin, 'user');
  await answer(e, 1, 'Ready');
  await e.command('questions', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id });
  const requestId = e.pending.id;
  await e.receive('questions', { requestId, questions: [{ question: 'Generated?', category: 'Decision' }] });
  assert.equal(e.doc.nodes.some(n => n.question === 'Generated?'), false);
  await e.command('accept-questions', { revision: e.doc.revision, batchId: requestId, selected: [{ index: 0, question: 'Adjusted?' }] });
  const record = e.doc.nodes.at(-1).attribution.question;
  assert.equal(record.origin, 'ai'); assert.equal(record.author, null);
  assert.equal(record.editor.actor.displayName, 'Reviewer <script>'); assert.deepEqual(record.accepted, record.editor);
  assert.equal(e.doc.nodes[1].attribution.answer.author.actor.displayName, 'Reviewer <script>');
});

test('propagated review flags do not claim descendant answers and failed or stale writes preserve attribution', async t => {
  const f = await fixture(t), { e, file, context } = await f.writer('one'); await choose(e, 'Alice');
  await answer(e, 1, 'Original');
  await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, question: 'Dependent?', category: 'Decision' });
  await answer(e, 3, 'Child'); const oldChild = structuredClone(e.doc.nodes[3].attribution);
  assert.equal(oldChild.answer.author.actor.displayName, 'Alice');
  await choose(e, 'Bob', 1); await answer(e, 1, 'Changed');
  assert.deepEqual(e.doc.nodes[3].attribution, oldChild); assert.equal(e.doc.nodes[3].review, true);
  const before = await readFile(file), originalWrite = e.projectStore.write;
  e.projectStore.write = async () => { throw Error('disk full'); };
  await assert.rejects(answer(e, 2, 'Failed'), /disk full/); assert.deepEqual(await readFile(file), before);
  e.projectStore.write = originalWrite;
  const other = await new ProjectJourney(context).load(), next = structuredClone(other.document); next.nodes[2].answer = 'External winner';
  await other.save(next, { baseDigest: other.baseDigest }); const external = await readFile(file);
  await assert.rejects(answer(e, 2, 'Stale'), /changed|refresh/i); assert.deepEqual(await readFile(file), external);
});

test('accepted synthesized brief records the accepter separately while personal/import writes do not claim authorship', async t => {
  const f = await fixture(t), { e } = await f.writer('one'); await choose(e, 'Approver');
  e.briefHelper = { async run(prepared) { return parseBrief(JSON.stringify({ goal: [{ id: 'goal', text: 'Explore choices', certainty: 'user-statement', sources: [{ kind: 'guidance', field: 'topic' }] }], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] }), prepared); }, close() {} };
  const request = { id: randomUUID(), journey: e.activeKey };
  await e.briefRequest({ ...request, action: 'start' }); await e.toolFreeTask;
  await e.briefRequest({ ...request, action: 'accept', revision: e.doc.revision, edits: [] });
  assert.equal(e.doc.brief.acceptance.actor.displayName, 'Approver');
  assert.equal(e.uiSnapshot().contributions.artifacts.brief, 'current');
  assert.equal(e.doc.nodes[0].attribution, undefined);
  await e.command('import', { revision: e.doc.revision, document: e.doc, asCopy: true });
  const before = structuredClone(e.doc.brief.acceptance);
  await answer(e, 1, 'Personal answer');
  assert.equal(e.doc.nodes[1].attribution, undefined); assert.deepEqual(e.doc.brief.acceptance, before);
});

test('invalid private identity blocks new shared contributions and never rewrites the saved journey', async t => {
  const f = await fixture(t), { e, file } = await f.writer('one'); await choose(e, 'Alice');
  const before = await readFile(file);
  await writeFile(join(e.library.directory, 'contributor-settings.json'), '{broken');
  await assert.rejects(answer(e, 1, 'Unrecorded'), /preserved/);
  assert.deepEqual(await readFile(file), before);
});

test('starting a shared journey and adding a direction attribute only the newly created user text', async t => {
  const f = await fixture(t), checkout = join(f.root, 'new-checkout'); await mkdir(checkout);
  await promisify(execFile)('git', ['init', '-q', checkout], { windowsHide: true });
  const e = new Explorer({ library: new Library(join(f.root, 'new-private')), binding: 'new', projectRoot: async () => checkout, send() {}, target: 'fixture' });
  t.after(() => e.close()); await choose(e, 'Starter');
  await e.command('start', { topic: 'New shared topic', storageScope: 'project' });
  const record = structuredClone(e.doc.nodes[0].attribution);
  assert.equal(record.question.author.actor.displayName, 'Starter');
  await e.command('cancel', { revision: e.doc.revision });
  await e.command('add-direction', { revision: e.doc.revision, nodeId: e.doc.rootId, direction: 'Another direction' });
  assert.equal(e.doc.nodes.at(-1).attribution.question.author.actor.displayName, 'Starter');
  assert.deepEqual(e.doc.nodes[0].attribution, record);
});
