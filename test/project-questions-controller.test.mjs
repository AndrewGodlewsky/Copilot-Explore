import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { parseProjectBrief, PROJECT_BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/project-brief.mjs';
import { directoryState } from '../com.github.copilot/extensions/explorer/storage-context.mjs';
import { waitFor } from './helpers/wait-for.mjs';

async function fixture(t, { hold = false, unavailable = false, approve = true, claimIds, controlledCheckout = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-project-questions-')), root = join(directory, 'project'), file = join(directory, 'map.json');
  await mkdir(root); await promisify(execFile)('git', ['init', '--quiet', root], { windowsHide: true });
  const canary = 'PRIVATE_PROJECT_QUESTION_FACT 🌿'; await writeFile(join(root, 'README.md'), canary);
  const doc = createDocument('Question grounding'), ordinary = [], calls = []; await writeFile(file, JSON.stringify(doc)); let working = root, release, signal;
  const helper = { close: async () => {}, run: async (prepared, options) => {
    calls.push(prepared); signal = options.signal; if (hold) await new Promise(resolve => { release = resolve; }); signal.throwIfAborted();
    return [{ question: 'Should the existing design change for café users 🌿?', category: 'Design', rationale: 'The future choice is unresolved.', importance: 'high', importanceReason: 'It changes future work.', claimIds: claimIds ?? [prepared.projectBrief.claims.find(claim => claim.kind === 'user').id] }];
  } };
  const projectBriefHelper = { close: async () => {}, run: async prepared => parseProjectBrief(JSON.stringify(Object.fromEntries(PROJECT_BRIEF_SECTIONS.map(section => [section, [{ id: section, text: 'Unknown.', kind: 'unknown', sources: [] }]]))), prepared) };
  const explorer = await new Explorer({ file, projectRoot: () => working, projectBriefHelper, projectQuestionHelper: unavailable ? undefined : helper, send: async input => { ordinary.push(input); } }).load();
  if (controlledCheckout) {
    // Behavior cases retain real files and ignore policy; Git-identity cases opt into the real reader below.
    explorer.projectMode.checkoutReader = async (reader, { expectedRoot, signal } = {}) => {
      signal?.throwIfAborted(); const current = await reader.root();
      if (expectedRoot && JSON.stringify(current) !== JSON.stringify(expectedRoot)) throw Error('Fixture project changed');
      const checkout = await directoryState(current.path); signal?.throwIfAborted();
      return { ...checkout, git: { branch: 'refs/heads/fixture', head: null } };
    };
  }
  t.after(async () => { explorer.clearPending(); release?.(); await explorer.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('explorer-project-questions-')); await rm(directory, { recursive: true, force: true }); });
  let scopeSequence = 0, briefSequence = 0, sequence = 0; const scopeClient = randomUUID(), briefClient = randomUUID(), clientId = randomUUID();
  const scope = (action, extra = {}) => explorer.projectModeRequest({ action, purpose: 'project-questions', journey: doc.id, clientId: scopeClient, sequence: ++scopeSequence, ...extra });
  const brief = (action, extra = {}) => explorer.projectBriefRequest({ action, purpose: 'project-brief', journey: doc.id, clientId: briefClient, sequence: ++briefSequence, ...extra });
  if (approve) {
    await scope('status'); const preview = await scope('prepare', { paths: ['README.md'], exclusions: [] }); const enabled = await scope('approve', { token: preview.token }); await scope('read', { token: enabled.readToken });
    await brief('status'); const review = await brief('prepare'); await brief('start', { id: randomUUID(), token: review.token });
    await explorer.projectBrief.work.task; assert.equal(explorer.projectBrief.work.status, 'result', explorer.projectBrief.error);
    const draft = await brief('status'); await brief('approve', { revision: draft.revision, changes: { edits: [], remove: [], additions: [{ section: 'purpose', text: canary }] } });
  }
  const review = () => explorer.reviewResearch({ action: 'prepare', purpose: 'project-questions', journey: doc.id, nodeId: doc.rootId, scope: 'decisions', excluded: [], clientId, sequence: ++sequence });
  const start = value => explorer.command('project-questions', { revision: explorer.doc.revision, journey: doc.id, nodeId: doc.rootId, token: value.token });
  const accept = () => explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: [{ index: 0, question: explorer.preview.questions[0].question }] });
  const finish = async (preview = true) => {
    await Promise.all([...explorer.researchTasks]);
    assert.equal(explorer.pending, null, explorer.error);
    if (preview) assert.ok(explorer.preview, explorer.error);
  };
  return { explorer, root, file, doc, canary, ordinary, calls, scope, brief, review, start, accept, finish, ready: () => release, release: () => release?.(), signal: () => signal, setRoot: value => { working = value; } };
}

test('project questions use only a purpose-reviewed helper and stage Unicode suggestions without saving answers', async t => {
  const f = await fixture(t, { hold: true }), before = await readFile(f.file, 'utf8'), review = await f.review();
  assert.equal(f.calls.length, 0); assert.ok(review.prepared.prompt.includes(f.canary));
  assert.ok(!JSON.stringify(review).includes(f.root)); assert.equal(review.prepared.settings, undefined); assert.equal(review.prepared.model, undefined);
  await assert.rejects(f.explorer.command('regenerate-questions', { revision: f.doc.revision, journey: f.doc.id, nodeId: f.doc.rootId, token: review.token }), /purpose/);
  await f.start(review); await waitFor(() => f.ready()); assert.equal(f.ordinary.length, 0); assert.equal(f.calls[0].prompt, review.prepared.prompt);
  const requestId = f.explorer.pending.id;
  await assert.rejects(f.explorer.receive('questions', { requestId, questions: [] }), /owned|isolated/i);
  await assert.rejects(f.explorer.receive('fail', { requestId, message: 'Spoofed attached chat failure' }), /owned|isolated/i);
  f.release(); await f.finish(); assert.equal(f.explorer.preview.questions.length, 1);
  assert.equal(await readFile(f.file, 'utf8'), before); assert.ok(!JSON.stringify(await f.explorer.nativeSnapshot()).includes(f.canary));
  assert.ok(!JSON.stringify(f.explorer.uiSnapshot()).includes(f.canary)); await f.accept();
  assert.equal(f.explorer.doc.nodes.length, 2); assert.equal(f.explorer.doc.nodes[1].answer, ''); assert.match(f.explorer.doc.nodes[1].question, /café users 🌿/);
  assert.ok(!(await readFile(f.file, 'utf8')).includes(f.canary)); await assert.rejects(f.start(review));
});

test('injected helpers cannot stage unreviewed provenance and accepted references remain private and expire', async t => {
  const invalid = await fixture(t, { claimIds: ['README.md'] }); await invalid.start(await invalid.review()); await invalid.finish(false);
  assert.equal(invalid.explorer.preview, null); assert.match(invalid.explorer.error, /invalid|review/i);
  const f = await fixture(t); await f.start(await f.review()); await f.finish();
  const captureId = f.explorer.projectBrief.draft.captureId, claimId = f.explorer.preview.questions[0].claimIds[0];
  assert.equal(f.explorer.uiSnapshot().preview.projectContext.captureId, captureId);
  await f.accept(); const node = f.explorer.doc.nodes[1];
  assert.equal(node.generation.source, 'project-brief');
  assert.deepEqual(f.explorer.uiSnapshot().projectQuestions[node.id].claimIds, [claimId]);
  const native = await f.explorer.nativeSnapshot(); assert.ok(native.document.nodes.some(saved => saved.id === node.id && saved.question === node.question));
  for (const output of [await readFile(f.file, 'utf8'), JSON.stringify(native), toMarkdown(f.explorer.doc), JSON.stringify(await f.explorer.readHistory(f.doc.id))]) {
    for (const privateValue of [claimId, captureId, f.canary, 'README.md']) assert.ok(!output.includes(privateValue));
  }
  const cursor = f.explorer.pollSnapshot().cursor;
  await f.brief('revoke', { revision: f.explorer.projectBrief.revision });
  const poll = f.explorer.pollSnapshot(cursor); assert.ok(poll.snapshot); assert.deepEqual(poll.snapshot.projectQuestions[node.id], { state: 'stale' });
  assert.ok(!JSON.stringify(poll.snapshot).includes(claimId));
  const current = await f.brief('status'); await f.brief('approve', { revision: current.revision, changes: { edits: [], remove: [], additions: [] } });
  assert.deepEqual(f.explorer.uiSnapshot().projectQuestions[node.id], { state: 'stale' }, 'new approval cannot relabel historical references');
  await f.explorer.command('import', { revision: f.explorer.doc.revision, document: f.explorer.doc });
  assert.deepEqual(f.explorer.uiSnapshot().projectQuestions, {}, 'imported marker cannot recover transient context');
});

test('edited subset keeps the original claim binding and moved files expire references without rewriting answers', async t => {
  const f = await fixture(t), run = f.explorer.projectQuestionHelper.run;
  f.explorer.projectQuestionHelper.run = async (prepared, options) => {
    const [first] = await run(prepared, options);
    return [first, { ...first, question: 'Which unresolved constraint needs evidence?', claimIds: [prepared.projectBrief.claims[0].id] }];
  };
  await f.start(await f.review()); await f.finish();
  const batch = f.explorer.preview, expected = batch.questions[1].claimIds;
  const result = await f.explorer.command('accept-questions', { revision: f.explorer.doc.revision, batchId: batch.id, selected: [{ index: 1, question: 'Which constraint needs evidence first?' }] });
  const id = result.acceptedIds[0]; assert.deepEqual(result.projectQuestions[id].claimIds, expected);
  assert.equal(f.explorer.doc.nodes[1].generation.adjusted, true);
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: id, answer: 'Keep this decision 🌿', answerState: 'tentative' });
  await rename(join(f.root, 'README.md'), join(f.root, 'moved.md')); await f.scope('status');
  assert.deepEqual(f.explorer.uiSnapshot().projectQuestions[id], { state: 'stale' });
  assert.equal(f.explorer.doc.nodes[1].answer, 'Keep this decision 🌿');
});

test('brief correction changes only a later explicitly reviewed request and leaves accepted answers intact', async t => {
  const f = await fixture(t); await f.start(await f.review()); await f.finish(); await f.accept();
  const node = f.explorer.doc.nodes[1]; await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: node.id, answer: 'Keep my saved answer', answerState: 'decided' });
  await f.brief('revoke', { revision: f.explorer.projectBrief.revision });
  const current = await f.brief('status'), claim = current.draft.sections.purpose.find(claim => claim.kind === 'user');
  await f.brief('approve', { revision: current.revision, changes: { edits: [{ id: claim.id, text: 'Corrected project purpose' }], remove: [current.draft.sections.stack[0].id], additions: [] } });
  assert.equal(f.calls.length, 1); const review = await f.review(); assert.ok(review.prepared.projectBrief.claims.some(claim => claim.text === 'Corrected project purpose'));
  assert.ok(!review.prepared.projectBrief.claims.some(claim => claim.id === current.draft.sections.stack[0].id));
  assert.equal(f.explorer.doc.nodes[1].answer, 'Keep my saved answer'); assert.equal(f.explorer.doc.nodes.length, 2);
  assert.deepEqual(f.explorer.uiSnapshot().projectQuestions[node.id], { state: 'stale' });
  const run = f.explorer.projectQuestionHelper.run;
  f.explorer.projectQuestionHelper.run = async (...args) => (await run(...args)).map(question => ({ ...question, question: 'What does the corrected purpose change?' }));
  await f.start(review); await f.finish(); assert.equal(f.explorer.doc.nodes.length, 2);
  await f.accept(); assert.equal(f.explorer.doc.nodes.length, 3); assert.equal(f.explorer.doc.nodes[1].answer, 'Keep my saved answer');
});

test('revoking a brief or disabling scope aborts owned questions and cannot install a late preview', async t => {
  for (const action of ['revoke', 'disable']) {
    const f = await fixture(t, { hold: true }), review = await f.review(); await f.start(review); await waitFor(() => f.ready());
    if (action === 'disable') await f.scope('disable'); else await f.brief('revoke', { revision: f.explorer.projectBrief.revision });
    assert.equal(f.signal().aborted, true); f.release(); await f.finish(false);
    assert.equal(f.explorer.preview, null); assert.equal(f.explorer.doc.nodes.length, 1);
  }
});

test('changed project content, root and saved map reject a completed project preview before acceptance', async t => {
  for (const change of ['content', 'root', 'map']) {
    const f = await fixture(t), review = await f.review(); await f.start(review); await f.finish();
    if (change === 'content') await writeFile(join(f.root, 'README.md'), 'Changed input');
    if (change === 'root') f.setRoot(join(dirname(f.root), 'another-project'));
    if (change === 'map') f.explorer.doc.objective = 'Changed goal';
    await assert.rejects(f.accept(), /changed|stale|review/i); assert.equal(f.explorer.doc.nodes.length, 1);
  }
});

test('unavailable or unapproved project mode leaves ordinary enqueue usable without project disclosure', async t => {
  for (const options of [{ unavailable: true }, { approve: false }]) {
    const f = await fixture(t, options); await assert.rejects(f.review(), /brief|SDK|unavailable|ordinary/i); assert.equal(f.calls.length, 0);
    await f.explorer.command('questions', { revision: f.explorer.doc.revision, nodeId: f.doc.rootId }); await waitFor(() => f.ordinary.length);
    assert.equal(f.ordinary[0].mode, 'enqueue'); assert.ok(!f.ordinary[0].prompt.includes(f.canary));
  }
});

test('cancelling a queued project request prevents helper invocation and retains the shared shutdown barrier', async t => {
  const f = await fixture(t); let releaseQueue; f.explorer.toolFreeTask = new Promise(resolve => { releaseQueue = resolve; });
  try { const review = await f.review(); await f.start(review); await f.explorer.command('cancel'); }
  finally { releaseQueue(); }
  await f.explorer.toolFreeTask;
  assert.equal(f.calls.length, 0); assert.equal(f.explorer.preview, null);
  let release; f.explorer.trackToolFreeRelease({ releaseConfirmed: new Promise(resolve => { release = resolve; }) });
  await assert.rejects(f.start(await f.review()), /not confirmed shutdown/); assert.equal(f.calls.length, 0); release(true);
});

test('project approval revoked during the last asynchronous map read cannot pass source validation', async t => {
  const f = await fixture(t), review = await f.review(); await f.start(review); await f.finish();
  const read = f.explorer.readCurrent.bind(f.explorer), verify = f.explorer.projectBrief.assertApproval.bind(f.explorer.projectBrief); let verified = false;
  f.explorer.projectBrief.assertApproval = async (...args) => { await verify(...args); verified = true; };
  f.explorer.readCurrent = async () => { const current = await read(); if (verified) f.explorer.projectBrief.approval = null; return current; };
  await assert.rejects(f.explorer.checkQuestionSource(f.doc.rootId), /changed/); assert.equal(f.explorer.preview.stale, true);
});

test('branch discovery preserves approval and cannot read added files before exact scope/read consent', async t => {
  const f = await fixture(t); await mkdir(join(f.root, 'src')); await writeFile(join(f.root, 'src/billing.ts'), 'NEW BILLING CONTENT');
  const original = f.explorer.projectContext.read.bind(f.explorer.projectContext), reads = [];
  f.explorer.projectContext.read = async (...args) => { reads.push(args[1]); return original(...args); };
  const approval = f.explorer.projectBrief.approval, before = await readFile(f.file, 'utf8');
  const found = await f.scope('target', { nodeId: f.doc.rootId, direction: 'billing', exclusions: [] });
  assert.deepEqual(found.inventory.target.suggested, ['src/billing.ts']); assert.equal(f.explorer.projectBrief.approval, approval);
  assert.equal(found.state, 'active'); assert.ok(!reads.includes('src/billing.ts')); assert.equal(f.calls.length, 0);
  await assert.rejects(f.scope('target', { nodeId: f.doc.rootId, direction: '', exclusions: [], claims: [] }), /invalid/i);
  const preview = await f.scope('prepare', { paths: ['README.md', 'src/billing.ts'], exclusions: [] });
  assert.equal(f.explorer.projectBrief.approval, null); await assert.rejects(f.review(), /brief/i); assert.ok(!reads.includes('src/billing.ts'));
  const enabled = await f.scope('approve', { token: preview.token }); assert.ok(!reads.includes('src/billing.ts'));
  const captured = await f.scope('read', { token: enabled.readToken }); assert.equal(captured.receipt.sources[1].excerpt, 'NEW BILLING CONTENT');
  await assert.rejects(f.review(), /brief/i); assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.calls.length, 0);
});

test('branch discovery rejects changed approval, root, target context or cancelled operation before returning suggestions', async t => {
  for (const change of ['brief', 'root', 'map', 'cancel']) {
    const f = await fixture(t); let release, entered;
    const waiting = new Promise(resolve => { entered = resolve; }), discover = f.explorer.projectMode.discovery.discover.bind(f.explorer.projectMode.discovery);
    f.explorer.projectMode.discovery.discover = async (...args) => { const value = await discover(...args); entered(); await new Promise(resolve => { release = resolve; }); return value; };
    // The deliberate hold tests invalidation; the work deadline has separate clock coverage.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = f.scope('target', { nodeId: f.doc.rootId, direction: '', exclusions: [] }); const rejected = assert.rejects(pending, /changed|obsolete|abort/i);
    try {
      await waiting;
      if (change === 'brief') await f.brief('revoke', { revision: f.explorer.projectBrief.revision });
      if (change === 'root') f.setRoot(join(dirname(f.root), 'missing'));
      if (change === 'map') { const doc = JSON.parse(await readFile(f.file, 'utf8')); doc.objective = 'Changed saved branch objective'; doc.revision++; await writeFile(f.file, JSON.stringify(doc)); }
      if (change === 'cancel') await f.scope('cancel');
    } finally { release?.(); }
    await rejected; assert.ok(!f.explorer.projectMode.inventory?.target); assert.equal(f.calls.length, 0);
    t.mock.timers.reset();
  }
});

test('unrelated unselected file edits do not discard a valid pending project question result', async t => {
  const f = await fixture(t, { hold: true }); await f.start(await f.review()); await waitFor(() => f.ready());
  await writeFile(join(f.root, 'unrelated.md'), 'Unselected file changed'); f.release(); await f.finish();
  await f.accept(); assert.equal(f.explorer.doc.nodes.length, 2); assert.equal(f.explorer.doc.nodes[1].answer, '');
});

test('checkout changes invalidate project question review, queued execution, results and acceptance', async t => {
  for (const stage of ['review', 'queue', 'result', 'accept']) {
    const f = await fixture(t, { hold: stage === 'result', controlledCheckout: false }), before = await readFile(f.file, 'utf8');
    const change = () => promisify(execFile)('git', ['-C', f.root, 'symbolic-ref', 'HEAD', 'refs/heads/changed-checkout'], { windowsHide: true });
    const review = await f.review();
    if (stage === 'review') { await change(); await assert.rejects(f.start(review), /changed|scope|brief/i); }
    if (stage === 'queue') {
      let release; f.explorer.toolFreeTask = new Promise(resolve => { release = resolve; });
      try { await f.start(review); await change(); } finally { release(); }
      await Promise.all([...f.explorer.researchTasks]);
    }
    if (stage === 'result') { await f.start(review); await waitFor(() => f.ready()); await change(); f.release(); await Promise.all([...f.explorer.researchTasks]); }
    if (stage === 'accept') { await f.start(review); await f.finish(); await change(); await assert.rejects(f.accept(), /changed|scope|brief|stale/i); }
    assert.equal(f.explorer.doc.nodes.length, 1, stage); assert.equal(await readFile(f.file, 'utf8'), before, stage);
    assert.equal(f.explorer.projectBrief.approval, null, stage); assert.ok(!f.explorer.preview || f.explorer.preview.stale, stage);
    assert.equal(f.calls.length, ['review', 'queue'].includes(stage) ? 0 : 1, stage);
  }
});

test('observed checkout change expires accepted project provenance without changing saved answers', async t => {
  const f = await fixture(t, { controlledCheckout: false }); await f.start(await f.review()); await f.finish(); await f.accept();
  const node = f.explorer.doc.nodes[1]; await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: node.id, answer: 'Keep my decision', answerState: 'decided' });
  const before = await readFile(f.file, 'utf8'); await promisify(execFile)('git', ['-C', f.root, 'symbolic-ref', 'HEAD', 'refs/heads/changed-checkout'], { windowsHide: true });
  assert.equal((await f.scope('status')).state, 'stale'); assert.deepEqual(f.explorer.uiSnapshot().projectQuestions[node.id], { state: 'stale' });
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.explorer.projectQuestionOrigins.get(node.id).guard, null);
});

test('scope and brief refresh comparisons stay private and explicit Off clears file-derived summaries', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8');
  await f.scope('revise'); const brief = await f.brief('status'); assert.ok(JSON.stringify(brief.comparison).includes(f.canary));
  const scope = await f.scope('prepare', { paths: ['README.md'], exclusions: [] }); assert.ok(scope.comparison); assert.ok(JSON.stringify(scope).includes('README.md'));
  const native = await f.explorer.nativeSnapshot(); assert.equal(native.document.id, f.doc.id);
  for (const output of [JSON.stringify(native), JSON.stringify(f.explorer.uiSnapshot()), toMarkdown(f.explorer.doc), JSON.stringify(await f.explorer.readHistory(f.doc.id)), await readFile(f.file, 'utf8')]) {
    for (const value of [f.canary, f.root, 'README.md']) assert.ok(!output.includes(value), 'private comparison escaped its local endpoint');
  }
  await f.scope('disable'); assert.equal(f.explorer.projectMode.comparison, null); assert.equal(f.explorer.projectBrief.previous, null);
  assert.equal(await readFile(f.file, 'utf8'), before); assert.ok(f.explorer.projectBrief.assertions.some(claim => claim.text === f.canary));
});
