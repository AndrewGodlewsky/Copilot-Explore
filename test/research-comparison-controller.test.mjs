import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { fixtureResearchModels } from './helpers/research-model.mjs';
import { confirmAnswer } from './helpers/answer-change.mjs';
import { waitFor } from './helpers/wait-for.mjs';
import { freshnessFindings, FRESHNESS_NOW } from './helpers/research-freshness.mjs';

const comparison = { criteria: [{ id: 'effort', label: 'Coordination effort', priority: 'high' }] };
const result = prepared => ({
  cells: prepared.comparison.criteria.flatMap(criterion => prepared.comparison.options.map(option => ({ criterionId: criterion.id, optionId: option.id, explanation: 'Needs a local pilot', basis: 'unknown', claimIds: [] }))),
  recommendation: { optionId: prepared.comparison.options[0].id, reason: 'Hypothetical fit', changed: 'Effort is prioritized', unchanged: 'Participation is still unknown' }, uncertainty: 'Prior reasoning only',
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-comparison-controller-')), file = join(dir, 'map.explore.json'), runs = [];
  const doc = createDocument('Neighborhood tools');
  addQuestions(doc, doc.rootId, [{ question: 'How broad a pilot?', category: 'Scope' }, { question: 'Where to store tools?', category: 'Location' }]);
  doc.nodes[1].research = { basis: 'reasoning', summary: 'Compare pilot scope', options: [
    { title: 'One block', description: 'Start nearby', pros: [], cons: [] }, { title: 'Neighborhood', description: 'Start broadly', pros: [], cons: [] },
  ], recommendation: 'Start nearby', uncertainty: 'Unknown participation', sources: [] };
  await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file, researcher: { models: fixtureResearchModels, runReconsideration(context, options) {
    return new Promise((resolve, reject) => runs.push({ context, ...options, resolve, reject }));
  } } }).load();
  t.after(async () => { for (const run of runs) run.resolve(result(run.prepared)); await e.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  let sequence = 0; const clientId = randomUUID(), target = { journey: doc.id, nodeId: doc.nodes[1].id };
  const review = (input = comparison) => e.reviewResearch({ action: 'prepare', ...target, scope: 'decisions', excluded: [], clientId, sequence: ++sequence, purpose: 'research-reconsideration', comparison: input });
  const start = value => e.command('research-reconsideration', { ...target, token: value.token });
  const settle = async () => { await new Promise(setImmediate); await Promise.all([...e.researchTasks]); };
  const complete = async (input = comparison) => { const index = runs.length, prepared = await review(input); await start(prepared); await waitFor(() => runs.length > index); runs[index].resolve(result(runs[index].prepared)); await settle(); return e.uiSnapshot().reconsideration.proposal; };
  const accept = proposal => e.command('comparison-accept', { ...target, id: proposal.id, comparison: { criteria: proposal.comparison.criteria } });
  return { e, doc, dir, file, runs, target, review, start, settle, complete, accept };
}

test('an evidence age boundary makes a waiting comparison historical and prevents adoption', async t => {
  const f = await fixture(t), next = structuredClone(f.e.doc); next.nodes[1].research = freshnessFindings(); await f.e.save(next);
  let now = FRESHNESS_NOW; const clock = t.mock.method(Date, 'now', () => now);
  try {
    const proposal = await f.complete(), before = await readFile(f.file, 'utf8');
    now += 86400000;
    assert.equal(f.e.uiSnapshot().reconsideration.proposal.historical, true);
    await assert.rejects(f.accept(proposal), /historical|changed|review|current/i);
    assert.equal(await readFile(f.file, 'utf8'), before);
  } finally { clock.mock.restore(); }
});

test('reconsideration reviews exact inputs and requires explicit transient adoption without changing saved research', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), reviewed = await f.review();
  assert.equal(f.runs.length, 0); assert.deepEqual(reviewed.prepared.comparison.criteria, comparison.criteria);
  assert.equal(reviewed.prepared.model.mode, 'chat'); assert.equal(reviewed.prepared.limits.toolAttemptLimit, 0);
  await f.start(reviewed); await waitFor(() => f.runs.length === 1);
  assert.equal(f.runs[0].prepared.prompt, reviewed.prepared.prompt);
  f.runs[0].resolve(result(f.runs[0].prepared)); await f.settle();
  const view = f.e.uiSnapshot().reconsideration;
  assert.equal(view.current, null); assert.ok(view.proposal); assert.equal(view.proposal.historical, false);
  assert.equal(view.proposal.dependencies, undefined); assert.equal(view.proposal.modelCapture, undefined);
  assert.equal(f.e.snapshot().reconsideration, undefined); assert.equal(await readFile(f.file, 'utf8'), before);
  await f.accept(view.proposal);
  assert.equal(f.e.uiSnapshot().reconsideration.current.id, view.proposal.id); assert.equal(f.e.uiSnapshot().reconsideration.proposal, null);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

test('reconsideration review rejects wrong purposes, replaced and reused tokens and changed destinations', async t => {
  const f = await fixture(t), first = await f.review(), replacement = await f.review();
  await assert.rejects(f.start(first), /obsolete/i);
  await assert.rejects(f.e.command('research', { ...f.target, token: replacement.token }), /purpose/i);
  await f.start(replacement); await waitFor(() => f.runs.length === 1); f.runs[0].resolve(result(f.runs[0].prepared)); await f.settle();
  await assert.rejects(f.start(replacement), /obsolete/i);
  const next = await f.review(), disk = JSON.parse(await readFile(f.file, 'utf8')); disk.nodes[1].research.summary = 'Changed externally';
  await writeFile(f.file, JSON.stringify(disk)); await assert.rejects(f.start(next), /saved research|saved map|sources/i);
  assert.equal(f.runs.length, 1);
});

test('failed, malformed and dismissed replacements preserve the accepted comparison and saved document', async t => {
  const f = await fixture(t), original = await f.complete(); await f.accept(original);
  const before = await readFile(f.file, 'utf8');
  for (const malformed of [false, true]) {
    const index = f.runs.length; await f.start(await f.review()); await waitFor(() => f.runs.length > index);
    if (malformed) f.runs[index].resolve({ cells: [], recommendation: {}, uncertainty: 'Bad' }); else f.runs[index].reject(Error('Fixture failure'));
    await f.settle(); assert.equal(f.e.uiSnapshot().reconsideration.current.id, original.id);
    assert.equal(f.e.uiSnapshot().reconsideration.proposal, null); assert.ok(f.e.error);
  }
  const proposal = await f.complete();
  await f.e.command('comparison-dismiss', { ...f.target, id: proposal.id });
  assert.equal(f.e.uiSnapshot().reconsideration.current.id, original.id); assert.equal(f.e.uiSnapshot().reconsideration.proposal, null);
  assert.equal(await readFile(f.file, 'utf8'), before);
});

for (const observation of ['review', 'rejected freshness check']) test(`external source A-B-A remains historical after an observed ${observation}`, async t => {
  const f = await fixture(t), accepted = await f.complete(); await f.accept(accepted);
  const proposal = await f.complete(), original = JSON.parse(await readFile(f.file, 'utf8'));
  const changed = structuredClone(original); changed.revision++; changed.nodes[1].research.summary = 'Externally changed research B';
  await writeFile(f.file, JSON.stringify(changed));
  if (observation === 'review') assert.equal((await f.review()).prepared.comparison.prior.summary, changed.nodes[1].research.summary);
  else await assert.rejects(f.e.fresh(), /Another canvas/);
  assert.equal(f.e.uiSnapshot().reconsideration.current.historical, true);
  assert.equal(f.e.uiSnapshot().reconsideration.proposal.historical, true);
  const restored = structuredClone(original); restored.revision += 2; await writeFile(f.file, JSON.stringify(restored));
  await assert.rejects(f.accept(proposal), /stale/);
  assert.equal(f.e.uiSnapshot().reconsideration.current.id, accepted.id); assert.equal(f.e.uiSnapshot().reconsideration.current.historical, true);
});

test('successful content-identical direct import clears accepted and proposed comparisons', async t => {
  const f = await fixture(t), accepted = await f.complete(); await f.accept(accepted); await f.complete();
  assert.ok(f.e.uiSnapshot().reconsideration.current); assert.ok(f.e.uiSnapshot().reconsideration.proposal);
  await f.e.command('import', { revision: f.e.doc.revision, document: structuredClone(f.e.doc) });
  assert.equal(f.e.uiSnapshot().reconsideration, null);
});

test('comparison adoption rejects changed priorities, source identity and a stale proposal without losing the original', async t => {
  const f = await fixture(t), proposal = await f.complete();
  await assert.rejects(f.e.command('comparison-accept', { ...f.target, id: proposal.id, comparison: { criteria: [{ ...comparison.criteria[0], priority: 'low' }] } }), /priorit|criteria|review/i);
  await assert.rejects(f.e.command('comparison-accept', { ...f.target, nodeId: f.doc.nodes[2].id, id: proposal.id, comparison }), /comparison|question|obsolete/i);
  await confirmAnswer(f.e, { revision: f.e.doc.revision, nodeId: f.target.nodeId, answer: 'Changed source' });
  assert.equal(f.e.uiSnapshot().reconsideration.proposal.historical, true);
  await assert.rejects(f.accept(proposal), /stale|changed|current/i);
  assert.equal(f.e.uiSnapshot().reconsideration.current, null);
});

test('cancelled reconsideration cannot replace a newer proposal, and observed source A-B-A does not revive adoption', async t => {
  const f = await fixture(t); await f.start(await f.review()); await waitFor(() => f.runs.length === 1);
  await f.e.command('cancel'); await f.start(await f.review());
  f.runs[0].resolve(result(f.runs[0].prepared)); await waitFor(() => f.runs.length === 2);
  assert.equal(f.runs[0].signal.aborted, true); f.runs[1].resolve(result(f.runs[1].prepared)); await f.settle();
  const proposal = f.e.uiSnapshot().reconsideration.proposal, before = structuredClone(f.e.doc);
  await confirmAnswer(f.e, { revision: f.e.doc.revision, nodeId: f.target.nodeId, answer: 'Changed assumption' });
  assert.equal(f.e.uiSnapshot().reconsideration.proposal.historical, true);
  await f.e.command('import', { revision: f.e.doc.revision, document: before });
  const current = f.e.uiSnapshot().reconsideration;
  assert.ok(!current?.proposal || current.proposal.historical);
  await assert.rejects(f.accept(proposal), /comparison|stale|changed|current|obsolete/i);
});

test('comparison start and adoption/dismissal require the exact write Origin over the protected HTTP route', async t => {
  const f = await fixture(t), server = await startServer(f.e); t.after(() => server.close());
  const post = (action, input, approved = false) => fetch(new URL('api/action', server.url), { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...(approved ? { Origin: new URL(server.url).origin } : {}) }, body: JSON.stringify({ action, ...f.target, ...input }) });
  const reviewed = await f.review();
  assert.equal((await post('research-reconsideration', { token: reviewed.token })).status, 403); assert.equal(f.runs.length, 0);
  assert.equal((await post('research-reconsideration', { token: reviewed.token }, true)).status, 200);
  await waitFor(() => f.runs.length === 1); f.runs[0].resolve(result(f.runs[0].prepared)); await f.settle();
  const proposal = f.e.uiSnapshot().reconsideration.proposal;
  assert.equal((await post('comparison-accept', { id: proposal.id, comparison })).status, 403);
  assert.equal(f.e.uiSnapshot().reconsideration.current, null);
  assert.equal((await post('comparison-accept', { id: proposal.id, comparison }, true)).status, 200);
  const next = await f.complete();
  assert.equal((await post('comparison-dismiss', { id: next.id })).status, 403);
  assert.equal(f.e.uiSnapshot().reconsideration.proposal.id, next.id);
  assert.equal((await post('comparison-dismiss', { id: next.id }, true)).status, 200);
  assert.equal(f.e.uiSnapshot().reconsideration.current.id, proposal.id);
});
