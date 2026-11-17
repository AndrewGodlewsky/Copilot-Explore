import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocument, validateDocument, addQuestions, contextFor, toMarkdown, MAX_DOCUMENT_BYTES } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { helpContext, sameHelpContext } from '../com.github.copilot/extensions/explorer/question-help.mjs';
import { boundedContext } from '../com.github.copilot/extensions/explorer/research.mjs';

const modes = ['understand', 'decide', 'design', 'diagnose', 'challenge'];

test('all exploration modes round trip, export truthfully, and reject invalid imports', () => {
  for (const mode of modes) {
    const doc = createDocument('Garden 🌿', { mode });
    const saved = validateDocument(JSON.parse(JSON.stringify(doc)));
    assert.equal(saved.mode ?? 'understand', mode);
    assert.equal(contextFor(saved, saved.rootId).mode, mode);
    assert.match(toMarkdown(saved), new RegExp(`Mode: ${mode}`, 'i'));
  }
  const legacy = createDocument('Garden');
  assert.ok(!Object.hasOwn(legacy, 'mode'));
  assert.ok(!Object.hasOwn(validateDocument(legacy), 'mode'));
  assert.match(toMarkdown(legacy), /Mode: Understand/);
  for (const mode of [null, '', 'unknown', 3, {}, []]) assert.throws(() => validateDocument({ ...legacy, mode }), /mode/i);
});

test('mode is a saved help dependency and research guidance travels within its bound', () => {
  const doc = createDocument('Garden', { mode: 'challenge' });
  const [node] = addQuestions(doc, doc.rootId, [{ question: 'Who?', category: 'People' }]);
  const input = helpContext(doc, node.id);
  assert.equal(input.mode, 'challenge');
  assert.equal(sameHelpContext(input, doc), true);
  doc.mode = 'decide';
  assert.equal(sameHelpContext(input, doc), false);
  const context = boundedContext(contextFor(doc, node.id));
  assert.equal(context.mode, 'decide');
  assert.ok(JSON.stringify(context).length <= 75000);
});

test('legacy guidance edit retains an imported explicit Understand field', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-explicit-understand-')), file = join(dir, 'map.explore.json');
  const imported = { ...createDocument('Garden'), mode: 'understand' };
  await writeFile(file, JSON.stringify(imported));
  const e = await new Explorer({ file }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  await e.command('guidance', { revision: e.doc.revision, objective: 'Keep this text 🌿', successCriteria: '' });
  assert.equal(e.doc.mode, 'understand');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).mode, 'understand');
  const before = e.doc.revision;
  await e.command('guidance', { revision: before, objective: 'Keep this text 🌿', successCriteria: '', mode: 'understand' });
  assert.equal(e.doc.revision, before, 'same effective mode stays a no-op');
  await e.command('guidance', { revision: before, objective: 'Keep this text 🌿', successCriteria: '', mode: 'decide' });
  await e.command('guidance', { revision: e.doc.revision, objective: 'Keep this text 🌿', successCriteria: '', mode: 'understand' });
  assert.equal(Object.hasOwn(e.doc, 'mode'), false, 'a switch back to Understand returns to the sparse default');
});

test('legacy map near the saved-data cap remains sparse when loaded', () => {
  const doc = createDocument('Large legacy map');
  for (let i = 0; i < 4800; i++) doc.nodes.push({ id: `q${i}`, parentId: doc.rootId, question: 'Question?', category: 'Scope', answer: 'x'.repeat(1750), research: null, review: false });
  let remaining = MAX_DOCUMENT_BYTES - Buffer.byteLength(JSON.stringify(doc, null, 2)) - 20;
  for (const node of doc.nodes.slice(1)) { const add = Math.min(remaining, 20000 - node.answer.length); node.answer += 'x'.repeat(add); remaining -= add; if (!remaining) break; }
  const imported = validateDocument(doc);
  assert.equal(imported.mode, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(imported, null, 2)) <= MAX_DOCUMENT_BYTES);
});

test('mode change preserves old nodes, clears finish and invalidates staged questions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-mode-'));
  const messages = [];
  const e = await new Explorer({ file: join(dir, 'map.explore.json'), send: async message => messages.push(message), target: { instanceId: 'mode-test' } }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  await e.command('start', { topic: 'Garden' });
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'Who?', category: 'People', rationale: 'Old why' }] });
  await e.command('accept-questions', { revision: e.doc.revision, batchId: e.preview.id, selected: [{ index: 0, question: 'Who?' }] });
  await e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: 'Neighbors 🌿', answerState: 'tentative' });
  const researched = structuredClone(e.doc);
  researched.nodes[1].research = { basis: 'reasoning', summary: 'Two paths.', options: [
    { title: 'Small', description: 'A pilot.', pros: ['Simple'], cons: ['Limited'] },
    { title: 'Large', description: 'A launch.', pros: ['Reach'], cons: ['Cost'] },
  ], recommendation: 'Try a pilot.', uncertainty: 'No external sources.', sources: [] };
  await e.save(researched, 'Research replaced');
  await e.command('finish', { revision: e.doc.revision });
  const oldNodes = structuredClone(e.doc.nodes), revision = e.doc.revision;
  await e.command('guidance', { revision, objective: '', successCriteria: '', mode: 'understand' });
  assert.equal(e.doc.revision, revision);
  await e.command('guidance', { revision, objective: '', successCriteria: '', mode: 'diagnose' });
  assert.equal(e.doc.mode, 'diagnose');
  assert.equal(e.doc.finishedAt, null);
  assert.deepEqual(e.doc.nodes, oldNodes);
  assert.equal(e.doc.revision, revision + 1);
  assert.equal(validateDocument(JSON.parse(await readFile(e.file, 'utf8'))).mode, 'diagnose');
  await e.command('questions', { revision: e.doc.revision, nodeId: e.doc.rootId });
  assert.match(messages.at(-1).prompt, /symptoms.*reproduction.*evidence.*alternative causes/i);
  await assert.rejects(e.command('guidance', { revision: e.doc.revision, objective: '', successCriteria: '', mode: 'design' }), /Wait/);
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'How?', category: 'Plan' }] });
  await e.command('guidance', { revision: e.doc.revision, objective: '', successCriteria: '', mode: 'design' });
  await assert.rejects(e.command('accept-questions', { revision: e.doc.revision, batchId: e.preview.id, selected: [{ index: 0, question: 'How?' }] }), /stale|changed/i);
  await e.command('dismiss-questions', { batchId: e.preview.id });
  const history = await e.readHistory(e.doc.id, revision);
  assert.equal(history.preview.guidanceChanged, true);
  await e.command('restore', { revision: e.doc.revision, journey: e.doc.id, snapshotRevision: revision });
  assert.equal(e.doc.mode, undefined, 'historical default does not acquire later mode');
  assert.ok(e.doc.finishedAt, 'historical finish state is retained');
  assert.deepEqual(e.doc.nodes, oldNodes);
  await e.command('restore', { revision: e.doc.revision, journey: e.doc.id, snapshotRevision: revision + 1 });
  assert.equal(e.doc.mode, 'diagnose');
});

test('each strategy reaches attached generation without changing its enqueue policy', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-mode-prompts-'));
  const messages = [];
  const e = await new Explorer({ file: join(dir, 'map.explore.json'), send: async message => messages.push(message), target: { instanceId: 'mode-prompts' } }).load();
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  await e.command('start', { topic: 'Garden' }); await e.command('cancel');
  const strategy = {
    understand: /concepts, stakeholders and unknowns/i,
    decide: /choices, criteria and tradeoffs/i,
    design: /outcomes, constraints, interfaces and feasibility/i,
    diagnose: /symptoms, reproduction, evidence and alternative causes/i,
    challenge: /assumptions, counterexamples and possible failure conditions/i,
  };
  for (const mode of modes) {
    await e.command('guidance', { revision: e.doc.revision, objective: '', successCriteria: '', mode });
    await e.command('questions', { revision: e.doc.revision, nodeId: e.doc.rootId });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.at(-1).mode, 'enqueue');
    assert.match(messages.at(-1).prompt, strategy[mode]);
    assert.match(messages.at(-1).prompt, new RegExp(`"mode":"${mode}"`));
    assert.equal(e.questionSource.dependencies.framing.mode, mode);
    await e.command('cancel');
  }
  const before = e.doc.revision;
  await e.command('guidance', { revision: before, objective: '', successCriteria: '' });
  assert.equal(e.doc.mode, 'challenge', 'legacy guidance request preserves the current mode');
  assert.equal(e.doc.revision, before);
  await assert.rejects(e.command('guidance', { revision: before, objective: '', successCriteria: '', mode: null }), /mode/i);
});
