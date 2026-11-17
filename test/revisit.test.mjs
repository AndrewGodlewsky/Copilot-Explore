import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as model from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { record } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { viewerSnapshot } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
import { visualExport } from '../com.github.copilot/extensions/explorer/visual-export.mjs';
import { prepareResearch, sameResearchSources } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { prepareBrief, captureBrief, briefFreshness } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareHandoff, captureHandoff, handoffFreshness } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';

function document() { const doc = model.createDocument('Return to decisions'); model.addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Choice' }]); return doc; }
const reminder = (date = '2026-11-17', condition = '  When demand changes 🌱\n') => ({ date, condition, acknowledgedAt: null });
test('local-calendar statuses distinguish overlapping manual checks and date urgency without UTC day shifts', () => {
  assert.equal(typeof model.revisitStatuses, 'function');
  assert.deepEqual(model.revisitStatuses(reminder(), '2026-11-17'), ['due-today', 'manual-condition']);
  assert.deepEqual(model.revisitStatuses(reminder(), '2026-11-18'), ['overdue', 'manual-condition']);
  assert.deepEqual(model.revisitStatuses(reminder(), '2026-11-16'), ['upcoming', 'manual-condition']);
  assert.deepEqual(model.revisitStatuses({ ...reminder(), acknowledgedAt: '2026-11-17T00:00:00.000Z' }, '2026-11-18'), ['acknowledged']);
  assert.deepEqual(model.revisitStatuses(reminder(null), '2026-11-18'), ['manual-condition']);
  for (const [tz, instant, expected] of [['America/New_York', '2026-03-08T04:59:59Z', '2026-03-07'], ['America/New_York', '2026-03-08T07:00:00Z', '2026-03-08'], ['America/New_York', '2026-11-01T06:00:00Z', '2026-11-01'], ['Pacific/Kiritimati', '2026-11-17T12:00:00Z', '2026-11-18'], ['Pacific/Honolulu', '2026-11-17T01:00:00Z', '2026-11-16']]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import { localDate } from './com.github.copilot/extensions/explorer/web/revisit.mjs'; console.log(localDate(new Date('${instant}')));`], { env: { ...process.env, TZ: tz }, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), expected, tz);
  }
});
async function fixture(t, library = false) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-revisit-')), file = join(dir, 'map.explore.json');
  t.after(async () => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  await writeFile(file, JSON.stringify(document()));
  const e = await new Explorer({ file, ...(library ? { library: new Library(dir), binding: 'revisit-test' } : {}) }).load();
  if (library) await e.attach((await e.library.list()).entries[0].key);
  t.after(() => e.close());
  const command = (action, input = {}) => e.command(action, { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, ...input });
  return { e, file, dir, command };
}
test('revisit validation preserves exact metadata and rejects invalid calendar dates, fields and nonquestions', () => {
  const doc = document(), node = doc.nodes[1]; node.revisit = reminder();
  assert.deepEqual(model.validateDocument(doc).nodes[1].revisit, node.revisit);
  for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) { node.revisit = reminder(date); assert.equal(model.validateDocument(doc).nodes[1].revisit.date, date); }
  for (const date of ['1900-02-29', '2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01', '2026-11-17T00:00:00Z', '', 42]) { node.revisit = reminder(date); assert.throws(() => model.validateDocument(doc), /revisit|date/i); }
  for (const value of [null, {}, { ...reminder(), unknown: true }, reminder(null, ' '), reminder(null, 'x'.repeat(1001)), { ...reminder(), acknowledgedAt: '2026-02-30T00:00:00.000Z' }]) { node.revisit = value; assert.throws(() => model.validateDocument(doc), /revisit|date|condition/i); }
  node.revisit = reminder(null, 'x'.repeat(1000)); assert.equal(model.validateDocument(doc).nodes[1].revisit.condition.length, 1000);
  doc.nodes[0].revisit = reminder(); assert.throws(() => model.validateDocument(doc), /question/i); delete doc.nodes[0].revisit;
  const direction = model.addDirection(doc, doc.rootId, 'Explore supply'); direction.revisit = reminder(); assert.throws(() => model.validateDocument(doc), /question/i);
  assert.equal(Object.hasOwn(model.validateDocument(document()).nodes[1], 'revisit'), false);
});
test('revisit edits, acknowledgments and repeated no-ops retain answer provenance and history with stale-writer checks', async t => {
  const { e, file, command } = await fixture(t), id = e.doc.nodes[1].id;
  await command('answer', { answer: '  exact answer 🌱\n', answerState: 'assumption' });
  const withReview = structuredClone(e.doc); withReview.nodes[1].review = true; await command('import', { document: withReview });
  const prior = structuredClone(e.doc.nodes[1]);
  await command('set-revisit', { date: '2026-11-17', condition: reminder().condition });
  const scheduled = structuredClone(e.doc), beforeAck = Date.now();
  const historyBefore = await e.readHistory(e.doc.id);
  assert.deepEqual(e.doc.nodes[1], { ...prior, revisit: reminder() });
  await command('set-revisit', { date: '2026-11-17', condition: reminder().condition }); assert.deepEqual(e.doc, scheduled);
  assert.deepEqual(await e.readHistory(e.doc.id), historyBefore);
  await assert.rejects(command('acknowledge-revisit', { acknowledgedAt: '2000-01-01T00:00:00.000Z' }), /timestamp|field/i);
  await command('acknowledge-revisit'); const acknowledged = structuredClone(e.doc);
  assert.ok(Date.parse(e.doc.nodes[1].revisit.acknowledgedAt) >= beforeAck); assert.ok(Date.parse(e.doc.nodes[1].revisit.acknowledgedAt) <= Date.now());
  await command('acknowledge-revisit'); assert.deepEqual(e.doc, acknowledged);
  await command('set-revisit', { date: '2026-11-17', condition: reminder().condition }); assert.deepEqual(e.doc.nodes[1].revisit, reminder());
  await command('clear-revisit'); assert.deepEqual(e.doc.nodes[1], prior); const cleared = structuredClone(e.doc);
  await command('clear-revisit'); assert.deepEqual(e.doc, cleared);
  await command('restore', { journey: e.doc.id, snapshotRevision: acknowledged.revision }); assert.deepEqual(e.doc.nodes[1].revisit, acknowledged.nodes[1].revisit);
  const history = await e.readHistory(e.doc.id); assert.ok(history.entries.some(row => row.label === 'Revisit acknowledged'));
  const other = await new Explorer({ file }).load(); t.after(() => other.close());
  await other.command('guidance', { revision: other.doc.revision, objective: 'Changed elsewhere', successCriteria: '' });
  await assert.rejects(command('acknowledge-revisit'), /changed|canvas/i);
  await assert.rejects(command('set-revisit', { date: '2026-11-18', condition: '' }), /changed|canvas/i);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).objective, 'Changed elsewhere');
  assert.equal(e.doc.nodes[1].id, id);
});
test('native and Markdown exports preserve reminders while source and offline projections omit them', () => {
  const doc = document(), node = doc.nodes[1], prior = record(node), context = model.contextFor(doc, node.id);
  node.revisit = { ...reminder(), acknowledgedAt: '2026-11-17T13:14:15.000Z' };
  assert.deepEqual(model.importedDocument(JSON.parse(JSON.stringify(doc))).nodes[1].revisit, node.revisit);
  assert.match(model.toMarkdown(doc), /2026-11-17/); assert.match(model.toMarkdown(doc), /When demand changes 🌱/); assert.match(model.toMarkdown(doc), /2026-11-17T13:14:15.000Z/);
  assert.deepEqual(record(node), prior); assert.deepEqual(model.contextFor(doc, node.id), context);
  assert.ok(!JSON.stringify(viewerSnapshot(doc, [{ nodeId: node.id, answer: true, research: false }])).includes('demand'));
});
test('library filters count unique attention reminders, omit condition text and preserve explicit archived access over HTTP', async t => {
  const { e, command } = await fixture(t, true);
  await command('set-revisit', { date: '2026-11-17', condition: 'PRIVATE_CONDITION' });
  const list = await e.library.list({ today: '2026-11-17' }), summary = list.entries[0].revisit;
  assert.deepEqual(summary, { counts: { any: 1, attention: 1, overdue: 0, 'due-today': 1, upcoming: 0, 'manual-condition': 1, acknowledged: 0 }, nextDate: '2026-11-17' });
  assert.ok(!JSON.stringify(list).includes('PRIVATE_CONDITION'));
  for (const [filter, count] of [['all', 1], ['any', 1], ['attention', 1], ['due-today', 1], ['manual-condition', 1], ['overdue', 0], ['upcoming', 0], ['acknowledged', 0]]) assert.equal((await e.library.list({ today: '2026-11-17', reminder: filter })).entries.length, count, filter);
  assert.equal((await e.library.list({ today: '2026-11-18', reminder: 'overdue' })).entries.length, 1);
  await e.library.update(e.activeKey, { archived: true }, list.revision);
  assert.equal((await e.library.list({ reminder: 'any' })).entries.length, 0);
  assert.equal((await e.library.list({ archived: true, reminder: 'any' })).entries.length, 1);
  await command('open', { key: e.activeKey });
  assert.equal((await e.library.list({ archived: true })).entries.length, 1, 'opening reminders does not unarchive');
  const server = await startServer(e, { status: async () => ({}), close() {} }); t.after(() => server.close());
  const base = server.url;
  const response = await fetch(new URL('api/library?archived=true&reminder=due-today&today=2026-11-17', base)); assert.equal(response.status, 200); assert.equal((await response.json()).entries.length, 1);
  assert.equal((await fetch(new URL('revisit.mjs', base))).status, 200);
  const exported = await (await fetch(new URL('export.json', base))).json(); assert.deepEqual(exported.nodes[1].revisit, e.doc.nodes[1].revisit);
  for (const query of ['reminder=invalid', 'today=2026-02-29']) assert.equal((await fetch(new URL(`api/library?${query}`, base))).status, 400);
  const post = body => fetch(new URL('api/action', base), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(base).origin, 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'acknowledge-revisit', revision: e.doc.revision, nodeId: e.doc.nodes[1].id, scope: 'path', ...body }) });
  assert.equal((await post({ acknowledgedAt: '2000-01-01T00:00:00.000Z' })).status, 400);
  assert.equal((await post({})).status, 200);
  assert.equal((await e.library.list({ archived: true, reminder: 'attention' })).entries.length, 0);
  assert.equal((await e.library.list({ archived: true, reminder: 'acknowledged' })).entries.length, 1);
  const imported = await e.library.import(e.doc, { asCopy: true }); assert.deepEqual(imported.document.nodes[1].revisit, e.doc.nodes[1].revisit);
});
test('reminder-only commits preserve captured helper source freshness and every portable export omits scheduling', async t => {
  const { e, command } = await fixture(t), node = e.doc.nodes[1];
  await command('answer', { answer: 'A committed decision', answerState: 'decided' });
  const research = prepareResearch(e.doc, node.id, {}), brief = prepareBrief(e.doc), selection = { nodeIds: [node.id], includeEvidence: false, format: 'plan' }, handoff = prepareHandoff(e.doc, selection);
  const savedBrief = { dependencies: captureBrief(brief) }, savedHandoff = { dependencies: captureHandoff(handoff), format: 'plan', formatFingerprint: handoff.formatFingerprint, includeEvidence: false, evidence: [] };
  for (const action of ['set-revisit', 'acknowledge-revisit', 'clear-revisit']) {
    await command(action, action === 'set-revisit' ? { date: '2026-11-17', condition: 'REMINDER_PRIVATE_CANARY' } : {});
    assert.equal(prepareResearch(e.doc, node.id, {}).prompt, research.prompt); assert.ok(sameResearchSources(research.dependencies, e.doc));
    assert.equal(prepareBrief(e.doc).prompt, brief.prompt); assert.equal(briefFreshness(savedBrief, e.doc), 'current');
    assert.equal(prepareHandoff(e.doc, selection).prompt, handoff.prompt); assert.equal(handoffFreshness(savedHandoff, e.doc), 'current');
    for (const format of ['mermaid', 'canvas', 'svg', 'print']) assert.ok(!JSON.stringify(visualExport(e.doc, { format, scope: 'whole', nodeId: null })).includes('REMINDER_PRIVATE_CANARY'), format);
    assert.ok(!JSON.stringify(viewerSnapshot(e.doc, [{ nodeId: node.id, answer: true, research: false }])).includes('REMINDER_PRIVATE_CANARY'));
  }
  await command('answer', { answer: 'Changed source', answerState: 'tentative' });
  assert.equal(sameResearchSources(research.dependencies, e.doc), false); assert.equal(briefFreshness(savedBrief, e.doc), 'stale'); assert.equal(handoffFreshness(savedHandoff, e.doc), 'stale');
});

