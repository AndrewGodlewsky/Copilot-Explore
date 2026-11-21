// Acceptance preparation only; adopt with the client implementation after #104 publishes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { ConversationClient } = await import(pathToFileURL(resolve('com.github.copilot/extensions/explorer/web/research-conversations-client.mjs')));
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
const input = question => ({ question, hypothetical: false, sourceMode: 'existing' });
const binding = nodeId => ({ conversationScope: 'c'.repeat(64), journey: 'journey-one', nodeId, revision: 0, researchKey: 'rendered-' + nodeId });
const guard = revision => ({ incarnation: 'entry-one', revision, draftRevision: revision, historyRevision: 0, storeRevision: revision });
const reply = (nodeId, question = '', revision = 0) => ({ conversationScope: 'c'.repeat(64), journey: 'journey-one', nodeId, research: nodeId === 'one' ? 'a'.repeat(64) : 'b'.repeat(64), guard: guard(revision), draft: input(question), history: null, historical: false, durable: true, archives: [] });
function client(handler) {
  const requests = [];
  const value = new ConversationClient({ changed: () => {}, fetch: async (url, options) => {
    assert.equal(url, 'api/research-conversations'); assert.equal(options.method, 'POST'); assert.equal(options.headers['X-Explorer-Client'], '1');
    const body = JSON.parse(options.body); requests.push(body); const result = await handler(body);
    return { ok: true, json: async () => result };
  } });
  return { value, requests };
}

test('conversation mutation callbacks run only after validated successful mutation responses', async () => {
  let result = reply('one'), ok = true, captured = 0, completed = 0;
  const value = new ConversationClient({ changed: () => {}, beforeMutation: () => { captured++; return () => completed++; }, fetch: async () => ({ ok, json: async () => result }) });
  const extra = { nodeId: 'one', research: 'a'.repeat(64), guard: guard(0) };
  await value.request(binding('one'), 'read', { nodeId: 'one', revision: 0 });
  assert.equal(captured, 0);
  for (const invalid of [{ ...reply('one'), conversationScope: 'd'.repeat(64) }, { ...reply('one'), journey: 'another' }, reply('two'), { ...reply('one'), research: 'e'.repeat(64) }]) {
    result = invalid; await assert.rejects(value.request(binding('one'), 'clear', extra));
  }
  result = { error: 'Unconfirmed write' }; ok = false; await assert.rejects(value.request(binding('one'), 'delete', extra), /Unconfirmed/);
  assert.equal(completed, 0);
  result = { ...reply('one'), clearedWork: ['followup'] }; ok = true;
  await value.request(binding('one'), 'clear', extra); assert.equal(completed, 1);
  result = { conversationScope: 'c'.repeat(64), deleted: false };
  await assert.rejects(value.request(binding('one'), 'cleanup', { target: {}, guard: guard(0) }), /not be confirmed/);
  assert.equal(completed, 1); value.dispose();
});

test('typing before recovery is retained and a different saved composer becomes an explicit conflict', async () => {
  const read = deferred(), f = client(() => read.promise), entry = f.value.open(binding('one'));
  f.value.edit(entry, input('New typing 🌿'));
  read.resolve(reply('one', 'Saved private text', 3)); await entry.ready;
  assert.equal(entry.draft.question, 'New typing 🌿'); assert.equal(entry.conflict.draft.question, 'Saved private text');
  assert.equal(entry.guard.draftRevision, 3); assert.equal(f.requests.length, 1);
  f.value.dispose();
});

test('a late save acknowledges only its generation and newer typing is saved next', async () => {
  const first = deferred(), started = deferred(); let saves = 0;
  const f = client(async body => {
    if (['read', 'archive'].includes(body.action)) return reply('one');
    if (++saves === 1) { started.resolve(); return first.promise; }
    return reply('one', body.draft.question, 2);
  });
  const entry = f.value.open(binding('one')); await entry.ready;
  f.value.edit(entry, input('First')); const flushing = f.value.flush(); await started.promise;
  f.value.edit(entry, input('Second 🌱')); first.resolve(reply('one', 'First', 1)); await flushing;
  assert.equal(entry.draft.question, 'Second 🌱'); assert.equal(entry.dirty, false);
  assert.deepEqual(f.requests.filter(item => item.action === 'draft').map(item => item.draft.question), ['First', 'Second 🌱']);
  f.value.dispose();
});

test('late question recovery updates only its captured composer', async () => {
  const first = deferred(), second = deferred(), f = client(body => body.nodeId === 'one' ? first.promise : second.promise);
  const one = f.value.open(binding('one')), two = f.value.open(binding('two'));
  second.resolve(reply('two', 'Second draft', 2)); await two.ready;
  first.resolve(reply('one', 'First draft', 1)); await one.ready;
  assert.equal(one.draft.question, 'First draft'); assert.equal(two.draft.question, 'Second draft');
  assert.equal(f.value.open(binding('one')), one); await one.ready; assert.equal(f.requests.length, 3);
  f.value.dispose();
});

test('a failed save retains text and does not silently retry or clear the dirty marker', async () => {
  const f = client(body => { if (['read', 'archive'].includes(body.action)) return reply('one'); throw Error('disk full'); });
  const entry = f.value.open(binding('one')); await entry.ready;
  f.value.edit(entry, input('Keep this private draft'));
  await assert.rejects(f.value.flush(), /disk full/);
  assert.equal(entry.draft.question, 'Keep this private draft'); assert.equal(entry.dirty, true);
  assert.equal(f.requests.filter(item => item.action === 'draft').length, 1);
  f.value.dispose();
});


test('an old A read cannot become current after an A to B to A attachment return', async () => {
  const old = deferred(); let reads = 0;
  const f = client(body => {
    if (body.conversationScope === 'd'.repeat(64)) return { ...reply('one', 'B draft'), conversationScope: body.conversationScope };
    return ++reads === 1 ? old.promise : reply('one', 'Current A draft', 2);
  });
  const a = f.value.open(binding('one')), oldReady = a.ready;
  const b = f.value.open({ ...binding('one'), conversationScope: 'd'.repeat(64) }); await b.ready;
  const returned = f.value.open(binding('one')); await returned.ready;
  f.value.edit(returned, input('New A typing'));
  old.resolve(reply('one', 'Old A draft', 9)); await oldReady;
  assert.equal(returned.draft.question, 'New A typing'); assert.equal(returned.guard.draftRevision, 2);
  assert.equal(b.draft.question, 'B draft'); f.value.dispose();
});

test('delete waits for its own held save and only a deliberate new edit recreates a draft', async () => {
  const held = deferred(), began = deferred(); let saves = 0;
  const f = client(body => {
    if (['read', 'archive'].includes(body.action)) return reply('one');
    if (body.action === 'delete') { assert.equal(body.guard.draftRevision, 1); return { ...reply('one'), guard: { incarnation: null, revision: 0, draftRevision: 0, historyRevision: 0, storeRevision: 2 } }; }
    if (++saves === 1) { began.resolve(); return held.promise; }
    assert.equal(body.guard.incarnation, null); return reply('one', body.draft.question, 3);
  });
  const entry = f.value.open(binding('one')); await entry.ready; f.value.edit(entry, input('Delete this draft'));
  const saving = f.value.flush(entry); await began.promise; const deleting = f.value.mutate(entry, 'delete');
  held.resolve(reply('one', 'Delete this draft', 1)); await saving; await deleting;
  assert.equal(entry.draft.question, ''); assert.equal(entry.dirty, false); assert.equal(saves, 1);
  f.value.edit(entry, input('Deliberately start again')); await f.value.flush(entry); assert.equal(saves, 2); f.value.dispose();
});

test('clear preserves a not-yet-saved composer and saves it with the independent draft revision', async () => {
  const f = client(body => {
    if (['read', 'archive'].includes(body.action)) return reply('one');
    if (body.action === 'clear') return { ...reply('one'), guard: { ...guard(0), revision: 1, historyRevision: 1, storeRevision: 1 } };
    assert.equal(body.guard.draftRevision, 0); return { ...reply('one', body.draft.question, 1), guard: { ...guard(1), revision: 2, historyRevision: 1, storeRevision: 2 } };
  });
  const entry = f.value.open(binding('one')); await entry.ready; f.value.edit(entry, input('Keep composing'));
  await f.value.mutate(entry, 'clear'); assert.equal(entry.draft.question, 'Keep composing'); assert.equal(entry.dirty, false);
  assert.deepEqual(f.requests.map(item => item.action), ['read', 'clear', 'draft']); f.value.dispose();
});

for (const choice of ['local', 'saved']) test(`draft conflict uses a fresh guard for explicit ${choice} choice`, async () => {
  let reads = 0, saves = 0;
  const f = client(body => {
    if (['read', 'archive'].includes(body.action)) return ++reads === 1 ? reply('one', 'Original', 1) : reply('one', 'Other canvas', 3);
    if (++saves === 1) throw Error('Draft changed in another canvas');
    assert.equal(body.guard.draftRevision, 3); return reply('one', body.draft.question, 4);
  });
  const entry = f.value.open(binding('one')); await entry.ready; f.value.edit(entry, input('My draft'));
  await assert.rejects(f.value.flush(entry), /changed/); assert.equal(entry.draft.question, 'My draft');
  await f.value.resolve(entry, choice); assert.equal(entry.draft.question, choice === 'local' ? 'My draft' : 'Other canvas'); assert.equal(entry.dirty, false);
  assert.equal(saves, choice === 'local' ? 2 : 1); f.value.dispose();
});


test('clean refresh preserves restoration generation and differing remote text needs explicit choice', async () => {
  let remote = reply('one', 'Saved text', 1);
  const f = client(() => remote), entry = f.value.open(binding('one')); await entry.ready;
  const restored = entry.restoreVersion;
  await f.value.refresh(entry); assert.equal(entry.restoreVersion, restored); assert.equal(entry.conflict, null);
  remote = reply('one', 'Other writer', 2); await f.value.refresh(entry);
  assert.equal(entry.draft.question, 'Saved text'); assert.equal(entry.restoreVersion, restored);
  assert.equal(entry.conflict.draft.question, 'Other writer');
  await f.value.resolve(entry, 'saved'); assert.equal(entry.draft.question, 'Other writer'); f.value.dispose();
});

for (const otherScope of [false, true]) test(`returning to a cached ${otherScope ? 'journey' : 'question'} revalidates history without replacing dirty text`, async () => {
  let remote = reply('one', 'Original', 1);
  const f = client(body => body.nodeId === 'one' ? remote : { ...reply('two'), conversationScope: body.conversationScope });
  const entry = f.value.open(binding('one')); await entry.ready;
  f.value.edit(entry, input('New local typing')); clearTimeout(entry.timer);
  const other = f.value.open({ ...binding('two'), ...(otherScope ? { conversationScope: 'd'.repeat(64) } : {}) }); await other.ready;
  remote = { ...reply('one', 'Changed elsewhere', 2), history: { id: 'new-history', exchanges: [] } };
  assert.equal(f.value.open(binding('one')), entry); await entry.ready;
  assert.equal(entry.value.history.id, 'new-history'); assert.equal(entry.draft.question, 'New local typing');
  assert.equal(entry.conflict.draft.question, 'Changed elsewhere'); f.value.dispose();
});


test('a held explicit conflict choice cannot restore an old draft after A to B to A', async () => {
  const held = deferred(); let reads = 0;
  const f = client(body => body.conversationScope !== binding('one').conversationScope ? { ...reply('two'), conversationScope: body.conversationScope } : ++reads === 2 ? held.promise : reply('one', reads === 1 ? 'Original' : 'Current saved', reads));
  const entry = f.value.open(binding('one')); await entry.ready;
  const choosing = f.value.resolve(entry, 'saved'); const rejected = assert.rejects(choosing, /changed|attachment|question/i);
  await f.value.open({ ...binding('two'), conversationScope: 'd'.repeat(64) }).ready;
  await f.value.open(binding('one')).ready;
  const version = entry.restoreVersion; held.resolve(reply('one', 'Obsolete choice', 2)); await rejected;
  assert.equal(entry.draft.question, 'Original'); assert.equal(entry.conflict.draft.question, 'Current saved'); assert.equal(entry.restoreVersion, version); f.value.dispose();
});


test('a conflict choice waiting on a save loses ownership when its question is left', async () => {
  const held = deferred(), f = client(body => body.action === 'draft' ? held.promise : reply(body.nodeId));
  const entry = f.value.open(binding('one')); await entry.ready; f.value.edit(entry, input('Saving text'));
  const flushing = f.value.flush(entry); await new Promise(setImmediate);
  const choice = f.value.resolve(entry, 'saved'), rejected = assert.rejects(choice, /attachment|changed/);
  await f.value.open(binding('two')).ready;
  held.resolve(reply('one', 'Saving text', 1)); await flushing; await rejected;
  assert.equal(f.requests.filter(item => item.action === 'read' && item.nodeId === 'one').length, 1);
  assert.equal(entry.draft.question, 'Saving text'); f.value.dispose();
});


test('an earlier absent revision conflict can be explicitly saved without silently rebasing other pending entries', async () => {
  let firstSaved = false;
  const f = client(body => {
    if (['read', 'archive'].includes(body.action)) return { ...reply(body.nodeId), guard: guard(firstSaved ? 1 : 0) };
    if (body.nodeId === 'one') firstSaved = true;
    else assert.equal(body.guard.storeRevision, 1, 'explicit archive resolution reads a new absence guard');
    return reply(body.nodeId, body.draft.question, 2);
  });
  const first = f.value.open(binding('one')); await first.ready;
  const second = f.value.open(binding('two')); await second.ready;
  f.value.edit(first, input('Earlier private text')); await f.value.flush(first);
  f.value.edit(second, input('Other private text')); clearTimeout(second.timer); second.error = 'Changed absence guard';
  f.value.open(binding('one')); await first.ready;
  await f.value.resolve(second, 'local'); assert.equal(second.dirty, false); assert.equal(second.error, '');
  assert.ok(f.requests.some(item => item.action === 'archive' && item.nodeId === 'two')); f.value.dispose();
});

test('scope changes do not flush another journey draft and explicit local discard invalidates held reads', async () => {
  const held = deferred(), f = client(body => body.nodeId === 'one' ? reply('one') : held.promise);
  const first = f.value.open(binding('one')); await first.ready; f.value.edit(first, input('Keep in original journey')); clearTimeout(first.timer);
  const second = f.value.open({ ...binding('two'), conversationScope: 'd'.repeat(64) });
  f.value.discardLocal(second); held.resolve({ ...reply('two', 'Late'), conversationScope: 'd'.repeat(64) }); await second.ready;
  await f.value.flush(); assert.equal(f.requests.filter(item => item.action === 'draft').length, 0);
  assert.equal(first.draft.question, 'Keep in original journey'); assert.equal(first.dirty, true); assert.equal(second.value, null); f.value.dispose();
});
