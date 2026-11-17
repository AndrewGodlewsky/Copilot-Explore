import { startResearch } from './helpers/research-review.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { research, createDocument, addQuestions, toMarkdown, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';

export const findings = { basis: 'reasoning', summary: 'Compare audiences.', options: [
  { title: 'Individuals', description: 'Start small.', pros: ['Simple'], cons: ['Limited reach'], proposedAnswer: 'I will start with individuals.', details: [{ label: 'Pilot size', value: 'Ten people' }] },
  { title: 'Teams', description: 'Start together.', pros: ['Shared learning'], cons: ['Coordination'], proposedAnswer: 'I will start with a team.', details: [] },
], recommendation: 'Start small to learn.', proposedAnswer: 'I will run a small pilot.', uncertainty: 'No sources consulted.', sources: [] };

test('research preserves optional draft suggestions in files and Markdown, accepting older records', () => {
  assert.deepEqual(research(findings), findings);
  const older = structuredClone(findings); delete older.proposedAnswer;
  for (const o of older.options) { delete o.proposedAnswer; delete o.details; }
  assert.deepEqual(research(older), older);
  assert.throws(() => research({ ...findings, proposedAnswer: 'a'.repeat(20001) }));
  const doc = createDocument('Pilot'); addQuestions(doc, doc.rootId, [{ question: 'Who first?', category: 'People' }])[0].research = findings;
  assert.match(toMarkdown(doc), /Ten people/); assert.match(toMarkdown(doc), /I will run a small pilot/);
  assert.match(toMarkdown(doc), /settings unknown/); assert.ok(!Object.hasOwn(validateDocument(doc).nodes[1].research, 'settings'));
  const settings = { depth: 'deeper', sourceFocus: 'primary', recency: 'recent' };
  doc.nodes[1].research = research({ ...findings, settings });
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).nodes[1].research.settings, settings);
  assert.match(toMarkdown(doc), /Deeper: 300 seconds.*40 tool attempts/); assert.match(toMarkdown(doc), /unknown publication dates stay unknown/);
  assert.throws(() => research({ ...findings, settings: { ...settings, depth: '<script>' } }), /settings/);
  assert.throws(() => research({ ...findings, settings: null }), /settings/);
});

test('research is isolated, abortable, rejects chat callbacks and preserves answers on late completion or failure', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-research-test-'));
  let resolveRun, rejectRun, signal, context; const messages = [];
  const explorer = new Explorer({ file: join(dir, 'map.explore.json'), send: async m => messages.push(m), target: {},
    researcher: { run: (data, options) => { context = data; signal = options.signal; options.onProgress('Reading sources'); return new Promise((yes, no) => { resolveRun = yes; rejectRun = no; }); } } });
  t.after(async () => { resolveRun?.(findings); await explorer.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  await explorer.command('start', { topic: 'Pilot' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ question: 'Who first?', category: 'People' }] });
  await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: explorer.preview.questions.map((q, index) => ({ index, question: q.question })) });
  const nodeId = explorer.doc.nodes[1].id;
  await explorer.command('answer', { revision: explorer.doc.revision, nodeId, answer: 'My decision' });
  const begin = () => startResearch(explorer, { revision: explorer.doc.revision, nodeId });
  await begin(); await delay(0);
  assert.equal(messages.length, 1); assert.equal(context.path.at(-1).answer, 'My decision');
  assert.equal(explorer.pending.progress, 'Reading sources');
  await assert.rejects(explorer.receive('research', { requestId: explorer.pending.id, research: findings }), /chat/);
  await assert.rejects(explorer.receive('fail', { requestId: explorer.pending.id, message: 'spoof' }), /chat/);
  await explorer.command('cancel'); assert.equal(signal.aborted, true);
  resolveRun(findings); await delay(10); assert.equal(explorer.doc.nodes[1].research, null);
  await begin(); await delay(0); rejectRun(new Error('Research unavailable')); await delay(10);
  assert.equal(explorer.pending, null); assert.match(explorer.error, /Research unavailable/); assert.equal(explorer.doc.nodes[1].answer, 'My decision');
  await begin(); await delay(0); resolveRun({ ...findings, settings: { depth: 'quick', sourceFocus: 'primary', recency: 'recent' } }); await Promise.all([...explorer.researchTasks]);
  assert.equal(explorer.pending, null); assert.deepEqual(explorer.doc.nodes[1].research, { ...findings, settings: { depth: 'standard', sourceFocus: 'balanced', recency: 'any' } });
  assert.equal(messages.length, 1);
});
