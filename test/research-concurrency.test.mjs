import { waitFor } from './helpers/wait-for.mjs';
import { startResearch } from './helpers/research-review.mjs';
import { confirmAnswer } from './helpers/answer-change.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { boundedContext, prepareResearch, sameResearchSources } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';

const result = { basis: 'reasoning', summary: 'Choices', options: [{ title: 'A', description: 'First', pros: [], cons: [] }, { title: 'B', description: 'Second', pros: [], cons: [] }], recommendation: 'Try A', uncertainty: 'No sources', sources: [] };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-research-concurrency-')), file = join(dir, 'map.explore.json');
  const doc = createDocument('Concurrent work');
  addQuestions(doc, doc.rootId, [{ question: 'Same question?', category: 'Target' }, { question: 'Other question?', category: 'Other' }]);
  doc.nodes[2].question = doc.nodes[1].question;
  await writeFile(file, JSON.stringify(doc));
  const runs = [], e = await new Explorer({ file, send: async () => {}, researcher: { run(context, options) { const d = deferred(); runs.push({ ...d, context, ...options }); return d.promise; } } }).load();
  t.after(async () => { for (const run of runs) run.resolve(result); await e.close(); await rm(dir, { recursive: true, force: true }); });
  const command = (action, input = {}) => e.command(action, { revision: e.doc.revision, ...input });
  const begin = async ({ queued = false } = {}) => { const started = runs.length; await startResearch(e, { nodeId: doc.nodes[1].id }); if (!queued) await waitFor(() => runs.length > started, 'Research fixture helper did not start'); };
  const finish = async () => { runs.at(-1).resolve(result); await Promise.all([...e.researchTasks]); };
  return { dir, file, doc, e, runs, command, begin, finish };
}

test('research accepts a new unrelated answer and records both actual transitions', async t => {
  const f = await fixture(t); await f.begin();
  await f.command('answer', { nodeId: f.doc.nodes[2].id, answer: 'New independent answer', answerState: 'assumption' });
  assert.ok(f.e.pending); assert.equal(f.runs[0].signal.aborted, false);
  await f.finish(); assert.equal(f.e.doc.nodes[2].answer, 'New independent answer'); assert.deepEqual(f.e.doc.nodes[1].research, { ...result, settings: { depth: 'standard', sourceFocus: 'balanced', recency: 'any' } });
  assert.equal(f.e.doc.revision, 2);
  const history = await f.e.readHistory(f.e.doc.id, 1); assert.equal(history.document.nodes[2].answer, 'New independent answer'); assert.equal(history.document.nodes[1].research, null);
});

test('external pin edits discard research, while absent and empty pin defaults are equivalent', async t => {
  const f = await fixture(t); await f.begin();
  const same = JSON.parse(await readFile(f.file, 'utf8')); same.pins = []; same.revision++;
  await writeFile(f.file, JSON.stringify(same)); await f.finish(); assert.deepEqual(f.e.doc.nodes[1].research, { ...result, settings: { depth: 'standard', sourceFocus: 'balanced', recency: 'any' } });
  await f.begin(); const changed = JSON.parse(await readFile(f.file, 'utf8'));
  changed.pins = [{ id: 'pin-00000000000000000000', text: 'New user constraint' }]; changed.revision++;
  await writeFile(f.file, JSON.stringify(changed)); await f.finish();
  assert.match(f.e.error, /source context changed/); assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')).pins, changed.pins);
});

test('research source save keeps new user text and discards stale output only after commit', async t => {
  const f = await fixture(t); await f.begin();
  const save = f.e.commitCurrentLocked; f.e.commitCurrentLocked = async () => { throw Error('Injected precommit failure'); };
  await assert.rejects(confirmAnswer(f.e, { revision: f.e.doc.revision, nodeId: f.doc.nodes[1].id, answer: 'New target' }), /Injected/);
  assert.ok(f.e.pending); assert.equal(f.runs[0].signal.aborted, false); f.e.commitCurrentLocked = save;
  await confirmAnswer(f.e, { revision: f.e.doc.revision, nodeId: f.doc.nodes[1].id, answer: 'New target' });
  assert.equal(f.e.pending, null); assert.match(f.e.error, /saved.*context changed/i); assert.equal(f.runs[0].signal.aborted, true);
  await f.finish(); assert.equal(f.e.doc.nodes[1].answer, 'New target'); assert.equal(f.e.doc.nodes[1].research, null);
});

test('research merges another canvas latest revision and rejects destination conflicts', async t => {
  const f = await fixture(t); await f.begin(); const other = await new Explorer({ file: f.file }).load();
  await other.command('answer', { revision: other.doc.revision, nodeId: f.doc.nodes[2].id, answer: 'Other canvas answer' });
  await f.finish(); assert.equal(f.e.doc.nodes[2].answer, 'Other canvas answer'); assert.equal(f.e.doc.revision, 2);
  await f.begin(); await other.command('refresh-answer', { revision: other.doc.revision });
  const next = structuredClone(other.doc); next.nodes[1].research = { ...result, summary: 'Newer research' }; await other.save(next);
  await f.finish(); assert.match(f.e.error, /research.*changed|conflict/i);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[1].research.summary, 'Newer research');
});

test('prepared research captures only actual transmitted IDs and whole records within 131072 UTF-8 bytes', () => {
  const doc = createDocument('Unicode 🌿'); addQuestions(doc, doc.rootId, [{ question: 'Target?', category: 'Target' }]);
  for (let i = 0; i < 8; i++) doc.nodes.push({ ...structuredClone(doc.nodes[1]), id: `source-${i}`, question: 'Duplicate?', answer: '🌿'.repeat(10000) });
  const prepared = prepareResearch(doc, doc.nodes[1].id);
  assert.ok(prepared.bytes <= 131072); assert.ok(prepared.context.truncated);
  assert.ok(prepared.context.omitted.decisionsElsewhere > 0);
  assert.deepEqual(prepared.dependencies.records, [...prepared.context.path, ...prepared.context.decisionsElsewhere]);
  const included = prepared.context.decisionsElsewhere[0]; assert.equal(included.answer, '🌿'.repeat(10000));
  const omitted = doc.nodes.find(n => n.id.startsWith('source-') && !prepared.dependencies.records.some(r => r.id === n.id));
  omitted.answer = 'Changed omitted record'; assert.ok(sameResearchSources(prepared.dependencies, doc));
  doc.nodes.find(n => n.id === included.id).answer = 'Changed included duplicate'; assert.equal(sameResearchSources(prepared.dependencies, doc), false);
  assert.throws(() => boundedContext({ topic: 'x', path: [{ question: 'Mandatory', answer: '\u0000'.repeat(22000) }] }), /target and guidance/);
});

test('captured sources reject target, ancestry, state, guidance, effective mode and identity changes', () => {
  const doc = createDocument('Framing'); addQuestions(doc, doc.rootId, [{ question: 'Parent?', category: 'P' }]);
  addQuestions(doc, doc.nodes[1].id, [{ question: 'Target?', category: 'T' }]);
  const prepared = prepareResearch(doc, doc.nodes[2].id);
  const mutations = [d => { d.nodes[1].answer = 'Changed'; }, d => { d.nodes[2].answerState = 'needs-evidence'; },
    d => { d.nodes[2].parentId = d.rootId; }, d => { d.nodes[1].question = 'Changed?'; }, d => { d.nodes[2].review = true; },
    d => { d.nodes.pop(); }, d => { d.objective = 'Changed'; }, d => { d.successCriteria = 'Changed'; }, d => { d.topic = 'Changed'; },
    d => { d.mode = 'challenge'; }, d => { d.createdAt = '2020-01-01T00:00:00.000Z'; }, d => { d.rootId = 'replaced'; }];
  for (const mutate of mutations) { const next = structuredClone(doc); mutate(next); assert.equal(sameResearchSources(prepared.dependencies, next), false, String(mutate)); }
  doc.mode = 'understand'; assert.ok(sameResearchSources(prepared.dependencies, doc));
  doc.nodes[2].rationale = 'Not sent'; assert.ok(sameResearchSources(prepared.dependencies, doc));
});

test('research completion then source save preserves completed history and new answer', async t => {
  const f = await fixture(t); await f.begin(); await f.finish();
  await confirmAnswer(f.e, { revision: f.e.doc.revision, nodeId: f.doc.nodes[1].id, answer: 'Later decision' });
  assert.equal(f.e.doc.nodes[1].answer, 'Later decision'); assert.deepEqual(f.e.doc.nodes[1].research, { ...result, settings: { depth: 'standard', sourceFocus: 'balanced', recency: 'any' } });
  assert.equal((await f.e.readHistory(f.e.doc.id, 1)).document.nodes[1].answer, '');
});

test('already sent external decisions invalidate by ID while a newly answered branch does not', async t => {
  const f = await fixture(t);
  await f.command('answer', { nodeId: f.doc.nodes[2].id, answer: 'Included at start' }); await f.begin();
  assert.equal(f.runs[0].context.decisionsElsewhere[0].id, f.doc.nodes[2].id);
  await confirmAnswer(f.e, { revision: f.e.doc.revision, nodeId: f.doc.nodes[2].id, answer: 'New included decision' });
  assert.equal(f.e.pending, null); await f.finish(); assert.equal(f.e.doc.nodes[1].research, null);
});

test('research replacement queues behind actual release and ignores old completion/error', async t => {
  const f = await fixture(t); await f.begin(); const old = f.runs[0];
  await f.command('cancel'); await f.begin({ queued: true }); assert.equal(f.runs.length, 1);
  const replacement = f.e.pending.id; old.resolve(result); await waitFor(() => f.runs.length === 2);
  assert.equal(f.runs.length, 2); assert.equal(f.e.pending.id, replacement); assert.equal(f.e.doc.nodes[1].research, null);
  old.reject(Error('Duplicate late error')); await f.finish(); assert.deepEqual(f.e.doc.nodes[1].research, { ...result, settings: { depth: 'standard', sourceFocus: 'balanced', recency: 'any' } });
});

test('failed or unconfirmed research shutdown blocks queued and new work until true and explicit retry', async t => {
  for (const confirmation of [false, true]) {
    const f = await fixture(t), assertPolicy = f.e.assertScenarioPolicy.bind(f.e);
    f.e.assertScenarioPolicy = async policy => { await new Promise(resolve => setTimeout(resolve, 10)); return assertPolicy(policy); };
    await f.begin(); const old = f.runs[0], released = deferred();
    await f.command('cancel'); await f.begin({ queued: true });
    const error = Object.assign(Error('Shutdown incomplete'), { releaseConfirmed: released.promise }); old.reject(error);
    await Promise.all([...f.e.researchTasks]); assert.equal(f.runs.length, 1); assert.match(f.e.error, /shutdown/);
    await assert.rejects(f.begin(), /shutdown/); released.resolve(confirmation); await new Promise(setImmediate);
    assert.equal(f.runs.length, 1);
    if (confirmation) { await f.begin(); assert.equal(f.runs.length, 2); await f.finish(); }
    else await assert.rejects(f.begin(), /shutdown/);
  }
});

test('missing, corrupt and replaced committed documents never accept late research', async t => {
  for (const kind of ['corrupt', 'identity', 'root', 'missing']) {
    const f = await fixture(t); await f.begin(); const old = JSON.stringify(f.e.doc);
    if (kind === 'corrupt') await writeFile(f.file, '{broken');
    else if (kind === 'missing') { const { unlink } = await import('node:fs/promises'); await unlink(f.file); }
    else { const replacement = structuredClone(f.e.doc); replacement.revision += 2; if (kind === 'identity') replacement.createdAt = '2020-01-01T00:00:00.000Z'; else { replacement.rootId = 'new-root'; replacement.nodes[0].id = 'new-root'; for (const node of replacement.nodes.slice(1)) node.parentId = 'new-root'; } await writeFile(f.file, JSON.stringify(replacement)); }
    await f.finish(); assert.equal(JSON.stringify(f.e.doc), old); assert.ok(f.e.error); assert.equal(f.e.pending, null);
    if (kind === 'corrupt') assert.equal(await readFile(f.file, 'utf8'), '{broken');
  }
});

test('latest-disk merge failures before and after atomic commit retain coherent snapshots and recoverable history', async t => {
  for (const stage of ['intent', 'document', 'final']) {
    const f = await fixture(t); await f.begin(); const other = await new Explorer({ file: f.file }).load();
    await other.command('answer', { revision: other.doc.revision, nodeId: f.doc.nodes[2].id, answer: 'External preimage' });
    const history = await f.e.history(f.e.doc.id); let manifestWrites = 0;
    if (stage === 'document') { const commit = history.commit.bind(history); history.commit = (before, after, label) => commit(before, after, label, async () => { throw Error('Injected document failure'); }); }
    else history.write = async (path, data) => { if (path.endsWith('manifest.json')) manifestWrites++; if (stage === 'intent' && path.endsWith('intent.json') || stage === 'final' && manifestWrites === 2 && path.endsWith('manifest.json')) throw Error('Injected persistence failure'); await atomicWrite(path, data); };
    await f.finish(); assert.match(f.e.error, /failure|finalization/);
    const disk = JSON.parse(await readFile(f.file, 'utf8')); assert.equal(disk.nodes[2].answer, 'External preimage');
    assert.equal(disk.revision, stage === 'final' ? 2 : 1); assert.equal(f.e.doc.revision, stage === 'final' ? 2 : 0);
    history.write = atomicWrite; await f.command('refresh-answer');
    const recovered = await f.e.readHistory(f.e.doc.id); assert.equal(recovered.current.revision, disk.revision);
    if (stage === 'final') assert.equal((await f.e.readHistory(f.e.doc.id, 1)).document.nodes[2].answer, 'External preimage');
  }
});

test('research retains question generation, history and journey guards; cancelled results cannot survive restart', async t => {
  const f = await fixture(t); await f.begin();
  for (const action of ['questions', 'restore', 'import', 'start', 'guidance', 'open']) await assert.rejects(f.command(action, { nodeId: f.doc.nodes[1].id }), /cancel/);
  await assert.rejects(f.command('answer', { nodeId: f.doc.nodes[2].id, answer: 'Draft', expand: true }), /Save & explore deeper/);
  await f.command('cancel'); const replacement = createDocument('Replacement'); await f.command('import', { document: replacement });
  await f.finish(); assert.equal(f.e.doc.id, replacement.id); assert.equal(f.e.doc.nodes.length, 1);
  const reopened = await new Explorer({ file: f.file }).load(); assert.equal(reopened.pending, null); assert.equal(reopened.doc.id, replacement.id);
});

test('identical research reconciles the latest disk snapshot and records clearing a stale marker', async t => {
  const f = await fixture(t); await f.begin(); await f.finish(); await f.begin();
  const other = await new Explorer({ file: f.file }).load();
  await confirmAnswer(other, { revision: other.doc.revision, nodeId: f.doc.nodes[2].id, answer: 'Newest independent answer' });
  assert.equal(other.doc.nodes[1].researchStale, true);
  await f.finish(); assert.equal(f.e.doc.revision, 3); assert.equal(f.e.doc.nodes[2].answer, 'Newest independent answer'); assert.equal(f.e.doc.nodes[1].researchStale, undefined);
  assert.equal(f.e.error, ''); assert.equal(f.e.pending, null);
});

test('external guidance/source edits discard completion, but explicit legacy Understand remains the same policy', async t => {
  for (const change of ['guidance', 'mode', 'parent', 'state', 'understand']) {
    const f = await fixture(t); await f.begin(); const other = await new Explorer({ file: f.file }).load(), next = structuredClone(other.doc);
    if (change === 'guidance') next.objective = 'New objective';
    if (change === 'mode') next.mode = 'design';
    if (change === 'parent') next.nodes[1].parentId = next.nodes[2].id;
    if (change === 'state') next.nodes[1].answerState = 'needs-evidence';
    if (change === 'understand') next.mode = 'understand';
    await other.save(next); await f.finish();
    const disk = JSON.parse(await readFile(f.file, 'utf8'));
    if (change === 'understand') { assert.equal(f.e.error, ''); assert.deepEqual(disk.nodes[1].research, { ...result, settings: { depth: 'standard', sourceFocus: 'balanced', recency: 'any' } }); }
    else { assert.match(f.e.error, /source context changed/); assert.equal(disk.nodes[1].research, null); }
  }
});

test('close during history preparation rejects research immediately before the atomic commit', async t => {
  const f = await fixture(t); await f.begin(); const history = await f.e.history(f.e.doc.id), commit = history.commit.bind(history);
  let closing;
  history.commit = (before, after, label, replace) => commit(before, after, label, async () => { closing = f.e.close(); await replace(); });
  await f.finish(); await closing;
  assert.equal(f.e.doc.revision, 0); assert.equal(JSON.parse(await readFile(f.file, 'utf8')).nodes[1].research, null);
  assert.equal((await f.e.readHistory(f.e.doc.id)).current.revision, 0);
});
