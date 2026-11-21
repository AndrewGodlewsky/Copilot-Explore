import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, rename, mkdir, link, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const { ResearchConversations, retainConversation, conversationHistory } = await import(pathToFileURL(resolve('com.github.copilot/extensions/explorer/research-conversations.mjs')));
const { atomicWrite } = await import(pathToFileURL(resolve('com.github.copilot/extensions/explorer/storage.mjs')));
const key = (nodeId = 'question-one', research = 'a'.repeat(64), namespace = 'b'.repeat(64)) => ({ namespace, nodeId, research });
const draft = question => ({ question, hypothetical: false, sourceMode: 'existing' });
const result = () => ({ answer: 'Private answer 🌱', uncertainty: 'Reasoning only.', claims: [{ id: 'c1', text: 'A small pilot is an option.', basis: 'reasoning', evidence: [], limitations: 'Model judgment.' }], sources: [] });
const history = (count = 1) => ({ id: randomUUID(), dependencies: { identity: 'a'.repeat(64), framing: 'b'.repeat(64), destination: 'c'.repeat(64), records: [['question-one', 'd'.repeat(64)]] }, policy: 'e'.repeat(64), dropped: 0,
  exchanges: Array.from({ length: count }, (_, index) => ({ id: randomUUID(), question: `Private follow-up ${index}`, hypothetical: false, sourceMode: 'existing', profile: { id: 'general', version: 1 }, result: result() })) });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-conversations-'));
  const remove = async path => { assert.equal(dirname(resolve(path)), resolve(tmpdir())); await rm(path, { recursive: true, force: true }); };
  t.after(() => remove(directory));
  return { directory, remove, file: join(directory, 'research-conversations.json'), store: new ResearchConversations({ directory }) };
}

test('conversation reads are write-free and independent question/research drafts survive restart', async t => {
  const { directory, store } = await fixture(t);
  const empty = await store.read(key()); assert.equal(empty.entry, null); assert.deepEqual(await readdir(directory), []);
  await store.saveDraft(key(), draft('First 🌱\nline two'), empty.guard);
  const second = key('question-two'); await store.saveDraft(second, draft('Second'), (await store.read(second)).guard);
  const revision = key('question-one', 'f'.repeat(64)); await store.saveDraft(revision, draft('Replacement research'), (await store.read(revision)).guard);
  const reopened = new ResearchConversations({ directory });
  assert.equal((await reopened.read(key())).entry.draft.question, 'First 🌱\nline two');
  assert.equal((await reopened.read(second)).entry.draft.question, 'Second');
  assert.equal((await reopened.read(revision)).entry.draft.question, 'Replacement research');
  assert.equal((await reopened.read(key('question-one', 'a'.repeat(64), '9'.repeat(64)))).entry, null);
  const metadata = await reopened.list(key().namespace);
  assert.equal(metadata.length, 3); assert.equal(JSON.stringify(metadata).includes('First'), false); assert.equal(JSON.stringify(metadata).includes('Second'), false);
});

test('draft and history writers compare separate field revisions and deletion never resurrects old work', async t => {
  const { directory, store } = await fixture(t), other = new ResearchConversations({ directory });
  const created = await store.ensure(key(), (await store.read(key())).guard), original = created.guard;
  const saved = await store.saveDraft(key(), draft('Typed while model ran'), original);
  const completed = await other.saveHistory(key(), history(), original);
  assert.equal(completed.entry.draft.question, 'Typed while model ran'); assert.equal(completed.entry.history.exchanges.length, 1);
  await assert.rejects(other.saveDraft(key(), draft('stale'), original), /changed|conflict/i);
  const newer = await store.saveDraft(key(), draft('Newer typing'), saved.guard);
  assert.equal(newer.entry.history.exchanges.length, 1);
  await assert.rejects(other.delete(key(), completed.guard), /changed|conflict/i);
  await store.delete(key(), newer.guard);
  await assert.rejects(other.saveHistory(key(), history(), completed.guard), /changed|deleted|conflict/i);
  await assert.rejects(other.saveDraft(key(), draft('resurrect'), saved.guard), /changed|deleted|conflict/i);
  const absent = await store.read(key()); assert.equal(absent.entry, null);
  const recreated = await store.ensure(key(), absent.guard); assert.notEqual(recreated.guard.incarnation, original.incarnation);
  await assert.rejects(other.saveHistory(key(), history(), original), /changed|deleted|conflict/i);
});

test('a captured absent entry cannot overwrite a create-delete cycle', async t => {
  const { store } = await fixture(t), absent = await store.read(key());
  const created = await store.saveDraft(key(), draft('briefly present'), absent.guard);
  await store.delete(key(), created.guard);
  await assert.rejects(store.saveDraft(key(), draft('late absent writer'), absent.guard), /changed|deleted|conflict/i);
  assert.equal((await store.read(key())).entry, null);
});

test('clear history preserves its composer, and failed atomic saves preserve exact prior bytes', async t => {
  const { store, directory, file } = await fixture(t);
  let current = await store.saveDraft(key(), draft('Keep me'), (await store.read(key())).guard);
  current = await store.saveHistory(key(), history(), current.guard);
  const bytes = await readFile(file), failing = new ResearchConversations({ directory, write: async () => { throw Error('disk full'); } });
  await assert.rejects(failing.saveHistory(key(), history(2), current.guard), /disk full/);
  assert.deepEqual(await readFile(file), bytes);
  const cleared = await store.clearHistory(key(), current.guard);
  assert.equal(cleared.entry.history, null); assert.equal(cleared.entry.draft.question, 'Keep me');
  await assert.rejects(store.saveHistory(key(), history(), current.guard), /changed|conflict/i);
});

test('simultaneous private history saves allow one winner and preserve unrelated drafts', async t => {
  const { store, directory } = await fixture(t), other = new ResearchConversations({ directory });
  const base = await store.ensure(key(), (await store.read(key())).guard);
  const settled = await Promise.allSettled([store.saveHistory(key(), history(), base.guard), other.saveHistory(key(), history(), base.guard)]);
  assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter(item => item.status === 'rejected').length, 1);
  const otherKey = key('other'); await other.saveDraft(otherKey, draft('Unrelated'), (await other.read(otherKey)).guard);
  const updated = await store.saveDraft(key(), draft('Independent field'), base.guard);
  assert.equal(updated.entry.history.exchanges.length, 1); assert.equal((await other.read(otherKey)).entry.draft.question, 'Unrelated');
});

test('a committed history with lost confirmation reconciles exactly without duplicate append', async t => {
  const { store, directory } = await fixture(t), base = await store.ensure(key(), (await store.read(key())).guard), completed = history();
  const lostConfirmation = new ResearchConversations({ directory, write: async (...args) => { await atomicWrite(...args); throw Error('Synthetic confirmation lost after rename'); } });
  // Either immediate read-only reconciliation or an explicit retry may acknowledge the exact committed write.
  await lostConfirmation.saveHistory(key(), completed, base.guard).catch(error => assert.match(error.message, /confirmation lost/));
  const disk = await store.read(key()); assert.equal(disk.entry.history.exchanges.length, 1);
  const acknowledged = await store.saveHistory(key(), completed, base.guard);
  assert.equal(acknowledged.guard.historyRevision, base.guard.historyRevision + 1);
  assert.deepEqual(acknowledged.entry.history, conversationHistory(completed));
  const different = { ...completed, exchanges: [{ ...completed.exchanges[0], question: 'A different payload cannot borrow the ID' }] };
  await assert.rejects(store.saveHistory(key(), different, base.guard), /changed|conflict/i);
  await store.delete(key(), acknowledged.guard);
  const recreated = await store.ensure(key(), (await store.read(key())).guard);
  assert.notEqual(recreated.guard.incarnation, base.guard.incarnation);
  await assert.rejects(store.saveHistory(key(), completed, base.guard), /changed|deleted|conflict/i);
});

test('invalid, future, duplicate-key, oversized and malformed UTF-8 files are preserved', async t => {
  const { file, store } = await fixture(t);
  for (const content of ['{bad', '{"version":2,"revision":0,"entries":[]}', '{"version":1,"revision":0,"revision":0,"entries":[]}', '{"version":1,"revision":0,"entries":[],"token":"private"}', Buffer.from([255, 254]), ' '.repeat(8 * 1024 * 1024 + 1)]) {
    await writeFile(file, content); const bytes = await readFile(file);
    await assert.rejects(store.read(key()), /preserved/i); await assert.rejects(store.ensure(key(), { incarnation: null, revision: 0, draftRevision: 0, historyRevision: 0, storeRevision: 0 }), /preserved/i);
    assert.deepEqual(await readFile(file), bytes);
  }
});

test('linked conversation files and replaced private roots fail closed', async t => {
  const { store, file, directory, remove } = await fixture(t);
  const saved = await store.saveDraft(key(), draft('Original'), (await store.read(key())).guard), target = join(directory, 'original.json');
  const bytes = await readFile(file); await rename(file, target); await link(target, file);
  await assert.rejects(store.read(key()), /preserved/i); await assert.rejects(store.saveDraft(key(), draft('No'), saved.guard), /preserved/i);
  assert.deepEqual(await readFile(target), bytes); await rm(file);
  const moved = directory + '-moved'; t.after(() => remove(moved)); await rename(directory, moved); await mkdir(directory);
  await assert.rejects(store.read(key()), /preserved/i); await assert.rejects(store.saveDraft(key(), draft('No'), saved.guard), /preserved/i);
  assert.deepEqual(await readdir(directory), []);
});

test('display retention keeps whole exchanges independently of prompt limits', () => {
  const value = history(25), retained = retainConversation(value.exchanges);
  assert.equal(retained.length, 20); assert.deepEqual(retained, value.exchanges.slice(-20));
  const large = value.exchanges.map(item => ({ ...item, question: '🌱'.repeat(1900), result: { ...result(), answer: '🌱'.repeat(2400), uncertainty: '🌱'.repeat(1400) } }));
  const bounded = retainConversation(large);
  assert.ok(bounded.length > 4); assert.ok(bounded.length < 20); assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 256 * 1024);
  assert.deepEqual(bounded, large.slice(-bounded.length));
});

test('history serialization removes runtime authority and retains literal validated discussion', async t => {
  const { store, file } = await fixture(t), value = history();
  Object.assign(value, { reuse: { token: 'reuse-secret' }, scenarioPolicy: { proof: 'consent-secret' }, modelCapture: { model: 'account-secret' }, reviewToken: 'review-secret', sessionId: 'session-secret' });
  Object.assign(value.exchanges[0], { token: 'nested-token-secret', reuse: { key: 'nested-reuse-secret' }, modelCapture: { account: 'nested-account-secret' } });
  const projected = conversationHistory(value); assert.equal(projected.exchanges[0].result.answer, result().answer);
  assert.deepEqual(Object.keys(projected).sort(), ['dependencies', 'dropped', 'exchanges', 'id', 'policy']);
  await store.saveHistory(key(), projected, (await store.read(key())).guard);
  const bytes = await readFile(file, 'utf8'); for (const secret of ['reuse-secret', 'consent-secret', 'account-secret', 'review-secret', 'session-secret', 'nested-token-secret', 'nested-reuse-secret', 'nested-account-secret']) assert.equal(bytes.includes(secret), false);
});

test('capacity never silently removes a conversation or draft and explicit deletion releases space', async t => {
  const { store } = await fixture(t);
  for (let index = 0; index < 128; index++) { const id = key(`q-${index}`, 'a'.repeat(64), (index % 2 ? 'c' : 'b').repeat(64)); await store.saveDraft(id, draft(`Keep ${index}`), (await store.read(id)).guard); }
  const overflow = key('overflow'); await assert.rejects(store.saveDraft(overflow, draft('No eviction'), (await store.read(overflow)).guard), /full|capacity|limit/i);
  assert.equal((await store.read(key('q-0'))).entry.draft.question, 'Keep 0');
  const inventory = await store.list(); assert.equal(inventory.length, 128); assert.equal(JSON.stringify(inventory).includes('Keep '), false);
  assert.equal((await store.list(key().namespace)).length, 64);
  const otherKey = key('q-1', 'a'.repeat(64), 'c'.repeat(64)), removed = await store.read(otherKey);
  const edited = await store.saveDraft(otherKey, draft('Keep a newer orphan draft'), removed.guard);
  await assert.rejects(store.delete(otherKey, removed.guard), /changed|conflict/i);
  await store.delete(otherKey, edited.guard);
  await store.saveDraft(overflow, draft('Now fits'), (await store.read(overflow)).guard);
  assert.equal((await store.list()).length, 128); assert.equal((await store.list(key().namespace)).length, 65);
});

test('memory-only previews retain the same revision and deletion guarantees without disk writes', async () => {
  const store = new ResearchConversations({ directory: null });
  const saved = await store.saveDraft(key(), draft('Until this preview closes'), (await store.read(key())).guard);
  assert.equal(saved.durable, false); await store.delete(key(), saved.guard);
  await assert.rejects(store.saveDraft(key(), draft('stale'), saved.guard), /changed|deleted|conflict/i);
  assert.equal((await store.read(key())).entry, null);
});
