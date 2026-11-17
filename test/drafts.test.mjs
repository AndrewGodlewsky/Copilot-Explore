import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { draftHash } from '../com.github.copilot/extensions/explorer/drafts.mjs';

test('state-only drafts recover without committing and become stale when committed state changes', async t => {
  const { explorer: e, input } = await fixture(t), node = e.doc.nodes[1];
  const record = await e.writeDraft({ ...input(node, ''), answerState: 'revisit-later' });
  assert.equal(record.answerState, 'revisit-later'); assert.equal(node.answerState, undefined);
  await e.command('answer', { revision: e.doc.revision, nodeId: node.id, answer: '', answerState: 'not-relevant' });
  assert.equal((await e.readDrafts(input().journey)).entries[0].stale, true);
  assert.equal((await e.readDrafts(input().journey)).entries[0].answerState, 'revisit-later');
  await assert.rejects(e.writeDraft({ ...input(node, ''), answerState: 'invalid', revision: record.revision }), /draft|state/i);
  await assert.rejects(e.writeDraft({ ...input(node, ''), answerState: ['not-relevant'], revision: record.revision }), /draft|state/i);
});

test('legacy text-only draft fingerprints recover conservatively after the state migration', async t => {
  const { explorer: e, input, dir } = await fixture(t), node = e.doc.nodes[1];
  await e.writeDraft(input(node, 'Old typed draft'));
  const file = join(dir, 'drafts.json'), store = JSON.parse(await readFile(file, 'utf8'));
  delete store.entries[0].answerState; store.entries[0].base = draftHash(JSON.stringify([node.question, node.answer]));
  await writeFile(file, JSON.stringify(store));
  const entry = (await e.readDrafts(input().journey)).entries[0];
  assert.equal(entry.stale, false); assert.equal(entry.answerState, 'tentative');
  await e.command('answer', { revision: e.doc.revision, nodeId: node.id, answer: '', answerState: 'needs-evidence' });
  assert.equal((await e.readDrafts(input().journey)).entries[0].stale, true);
});

test('answer draft conditional clear matches submitted state as well as text and revision', async t => {
  const { explorer: e, input } = await fixture(t), node = e.doc.nodes[1];
  const record = await e.writeDraft({ ...input(node, ''), answerState: 'revisit-later' });
  await e.command('answer', { revision: e.doc.revision, nodeId: node.id, answer: '', answerState: 'not-relevant', draftRevision: record.revision, draftJourney: input().journey });
  assert.equal((await e.readDrafts(input().journey)).entries[0].answerState, 'revisit-later');
  assert.equal((await e.readDrafts(input().journey)).entries[0].text, '');
  await e.command('answer', { revision: e.doc.revision, nodeId: node.id, answer: '', answerState: 'revisit-later', draftRevision: record.revision, draftJourney: input().journey });
  assert.equal((await e.readDrafts(input().journey)).entries[0].text, null);
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-drafts-')), messages = [];
  const explorer = await new Explorer({ file: join(dir, 'map.explore.json'), send: async m => messages.push(m), target: {} }).load();
  await explorer.command('start', { topic: 'Drafts' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ question: 'Who?', category: 'People' }, { question: 'When?', category: 'Time' }] });
  await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: explorer.preview.questions.map((q, index) => ({ index, question: q.question })) });
  t.after(async () => { await explorer.close(); await rm(dir, { recursive: true, force: true }); });
  const input = (node = explorer.doc.nodes[1], text = '  exact 🌿\n日本語  ') => ({ journey: explorer.activeKey ?? explorer.doc.id, nodeId: node.id, base: { question: node.question, answer: node.answer }, text, revision: 0 });
  return { dir, explorer, messages, input };
}

test('drafts recover exactly after restart, stay separate from decisions, and span nodes', async t => {
  const { explorer: e, input, messages } = await fixture(t), before = structuredClone(e.snapshot());
  assert.equal(typeof e.writeDraft, 'function', 'explicit draft API exists');
  await e.writeDraft(input()); await e.writeDraft(input(e.doc.nodes[2], 'Second'));
  assert.deepEqual(e.snapshot(), before);
  const reopened = await new Explorer({ file: e.file }).load();
  const result = await reopened.readDrafts(input().journey);
  assert.equal(result.entries.length, 2); assert.equal(result.entries[0].text, input().text);
  assert.equal(result.entries[0].stale, false);
  assert.ok(!JSON.stringify(messages).includes('日本語'));
});

test('draft revision conflicts and tombstones prevent late resurrection', async t => {
  const { explorer: e, input } = await fixture(t);
  const first = await e.writeDraft(input());
  await assert.rejects(e.writeDraft(input()), /another|changed/i);
  const cleared = await e.writeDraft({ ...input(), revision: first.revision, text: null });
  assert.ok(cleared.revision > first.revision);
  await assert.rejects(e.writeDraft({ ...input(), revision: first.revision }), /another|changed/i);
  assert.equal((await e.readDrafts(input().journey)).entries[0].text, null);
});

test('changed answers mark drafts stale; explicit answer save clears only its matching revision', async t => {
  const { explorer: e, input } = await fixture(t);
  const first = await e.writeDraft(input());
  await e.command('answer', { revision: e.doc.revision, nodeId: input().nodeId, answer: 'New committed answer' });
  assert.equal((await e.readDrafts(input().journey)).entries[0].stale, true);
  const newer = await e.writeDraft({ ...input(), text: 'Other canvas draft', revision: first.revision });
  await e.command('answer', { revision: e.doc.revision, nodeId: input().nodeId, answer: input().text, draftRevision: first.revision, draftJourney: input().journey });
  assert.equal((await e.readDrafts(input().journey)).entries[0].text, 'Other canvas draft');
  await e.command('answer', { revision: e.doc.revision, nodeId: input().nodeId, answer: 'Other canvas draft', draftRevision: newer.revision, draftJourney: input().journey });
  assert.equal((await e.readDrafts(input().journey)).entries[0].text, null);
});

test('divergent files with identical document IDs never exchange drafts', async t => {
  const { explorer: e, input, dir } = await fixture(t);
  await e.writeDraft(input());
  const file = join(dir, 'other.explore.json'); await writeFile(file, JSON.stringify(e.doc));
  const other = await new Explorer({ file }).load();
  assert.deepEqual((await other.readDrafts(input().journey)).entries, []);
});

test('malformed storage is preserved and failed writes leave the last draft recoverable', async t => {
  const { explorer: e, input, dir } = await fixture(t);
  const first = await e.writeDraft(input());
  const write = e.draftStore.write;
  e.draftStore.write = async () => { throw new Error('Disk full'); };
  await assert.rejects(e.writeDraft({ ...input(), text: 'Lost?', revision: first.revision }), /Disk full/);
  assert.equal((await e.readDrafts(input().journey)).entries[0].text, input().text);
  e.draftStore.write = write;
  await writeFile(join(dir, 'drafts.json'), '{malformed');
  await assert.rejects(e.writeDraft(input()), /preserved/i);
  assert.equal(await readFile(join(dir, 'drafts.json'), 'utf8'), '{malformed');
});

test('draft HTTP requires origin, client and active journey; exports and state contain no drafts', async t => {
  const { explorer: e, input } = await fixture(t), server = await startServer(e, { close() {} });
  t.after(() => server.close());
  const headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin };
  const post = (value, h = headers) => fetch(server.url + 'api/drafts', { method: 'POST', headers: h, body: JSON.stringify(value) });
  assert.equal((await post(input(), { ...headers, Origin: 'https://bad.example' })).status, 403);
  assert.equal((await post(input())).status, 200);
  assert.equal((await post({ ...input(), journey: 'wrong' })).status, 400);
  assert.equal((await post({ ...input(), text: 'x'.repeat(20001) })).status, 400);
  for (const path of ['api/state', 'export.json', 'export.md']) assert.ok(!(await (await fetch(server.url + path)).text()).includes('日本語'));
});

test('overlapping canvas writers preserve the winning revision and reject delayed pre-switch requests', async t => {
  const { explorer: e, input } = await fixture(t), other = await new Explorer({ file: e.file }).load();
  const outcomes = await Promise.allSettled([e.writeDraft(input()), other.writeDraft({ ...input(), text: 'Other writer' })]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const original = input(), next = structuredClone(e.doc); next.id = 'another-journey';
  await e.command('import', { revision: e.doc.revision, document: next });
  await assert.rejects(e.writeDraft(original), /active journey changed/);
  await assert.rejects(e.readDrafts(original.journey), /active journey changed/);
});

test('removed-node drafts remain recoverable and validated storage rejects malformed identities', async t => {
  const { explorer: e, input, dir } = await fixture(t);
  await e.writeDraft(input());
  const next = structuredClone(e.doc); next.nodes.splice(1, 1);
  await e.command('import', { revision: e.doc.revision, document: next });
  const record = (await e.readDrafts(input().journey)).entries[0];
  assert.equal(record.orphaned, true); assert.equal(record.text, input().text);
  const file = join(dir, 'drafts.json'), original = await readFile(file, 'utf8'), bad = JSON.parse(original);
  bad.entries[0].key = '../outside'; await writeFile(file, JSON.stringify(bad));
  await assert.rejects(e.readDrafts(input().journey), /preserved/);
  assert.equal(await readFile(file, 'utf8'), JSON.stringify(bad));
});
