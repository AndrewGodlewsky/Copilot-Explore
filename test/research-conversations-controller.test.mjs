import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const base = 'com.github.copilot/extensions/explorer/';
const { Explorer } = await import(pathToFileURL(resolve(base + 'controller.mjs')));
const { Library } = await import(pathToFileURL(resolve(base + 'library.mjs')));
const { createDocument, addQuestions } = await import(pathToFileURL(resolve(base + 'model.mjs')));
const { fixtureResearchModels } = await import(pathToFileURL(resolve('test/helpers/research-model.mjs')));
const findings = { basis: 'reasoning', summary: 'Compare', options: [{ title: 'Pilot', description: 'Small', pros: [], cons: [] }, { title: 'Launch', description: 'Large', pros: [], cons: [] }], recommendation: 'Pilot first', uncertainty: 'Unknown costs', sources: [], claims: [{ id: 'c1', text: 'A small pilot is an option.', basis: 'reasoning', evidence: [], limitations: 'Model judgment.' }] };
const response = { answer: 'PRIVATE_REPLY 🌿', uncertainty: 'Model reasoning only.', sources: [], claims: [{ id: 'c1', text: 'A small pilot is an option.', basis: 'reasoning', evidence: [], limitations: 'Model judgment.' }] };
const draft = question => ({ question, hypothetical: false, sourceMode: 'existing' });
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-private-conversations-')), library = new Library(directory), doc = createDocument('Private conversations');
  addQuestions(doc, doc.rootId, [{ question: 'First?', category: 'Choice' }, { question: 'Second?', category: 'Choice' }]);
  for (const node of doc.nodes.slice(1)) node.research = structuredClone(findings);
  const record = await library.import(doc), explorers = [], runs = []; let started;
  const open = async () => {
    const e = await new Explorer({ library, binding: 'conversation-fixture', researcher: { models: fixtureResearchModels, runFollowup(context, options) { let resolve; const result = new Promise(done => resolve = done); runs.push({ context, options, resolve }); started?.(); return result; } } }).load();
    await e.attach(record.key); explorers.push(e); return e;
  };
  const e = await open(), clientId = randomUUID(); let sequence = 0;
  const request = (instance, action, nodeId, extra = {}) => instance.conversationRequest({ action, conversationScope: instance.uiSnapshot().conversationScope, journey: record.key, nodeId, ...(action === 'read' ? { revision: instance.doc.revision } : {}), ...extra });
  const read = (instance, nodeId) => request(instance, 'read', nodeId);
  const review = (instance, nodeId, question) => instance.reviewResearch({ action: 'prepare', conversationScope: instance.uiSnapshot().conversationScope, journey: record.key, nodeId, scope: 'decisions', excluded: [], clientId, sequence: ++sequence, followup: draft(question) });
  const start = async (instance, nodeId, value) => {
    const prior = runs.length, began = new Promise(done => started = done);
    await instance.command('research-follow-up', { journey: record.key, nodeId, token: value.token });
    await Promise.race([began, Promise.all([...instance.researchTasks]).then(() => {
      if (runs.length === prior) throw Error(instance.error || 'The fixture helper did not start.');
    })]);
  };
  const complete = async (instance, nodeId, question) => {
    const prior = runs.length; await start(instance, nodeId, await review(instance, nodeId, question));
    assert.equal(runs.length, prior + 1);
    runs.at(-1).resolve(response); await Promise.all([...instance.researchTasks]); assert.equal(instance.pending, null); assert.equal(instance.error, '');
  };
  t.after(async () => { for (const run of runs) run.resolve(response); for (const instance of explorers) await instance.close(); assert.equal(resolve(directory).startsWith(resolve(tmpdir()) + '\\'), true); await rm(directory, { recursive: true, force: true }); });
  return { directory, library, record, doc, e, open, runs, request, read, review, start, complete };
}

test('two private question histories and composer drafts survive switching and restart without inference', async t => {
  const f = await fixture(t), ids = f.e.doc.nodes.slice(1).map(node => node.id);
  for (const [index, nodeId] of ids.entries()) {
    const value = await f.read(f.e, nodeId);
    await f.request(f.e, 'draft', nodeId, { research: value.research, guard: value.guard, draft: draft('PRIVATE_DRAFT_' + index) });
    await f.complete(f.e, nodeId, 'PRIVATE_PROMPT_' + index);
  }
  await f.e.close(); const reopened = await f.open();
  for (const [index, nodeId] of ids.entries()) {
    const saved = await f.read(reopened, nodeId);
    assert.equal(saved.draft.question, 'PRIVATE_DRAFT_' + index); assert.equal(saved.history.exchanges[0].question, 'PRIVATE_PROMPT_' + index);
    assert.equal(saved.history.exchanges[0].result.answer, response.answer); assert.equal(saved.historical, false);
  }
  assert.equal(f.runs.length, 2); assert.equal(reopened.pending, null); assert.equal(reopened.researchReview.current, null);
  const native = await reopened.nativeSnapshot(); assert.equal(native.document.id, reopened.doc.id);
  const publicValues = JSON.stringify([native, reopened.snapshot(), reopened.doc]);
  assert.equal(publicValues.includes('PRIVATE_'), false);
  const bytes = await readFile(reopened.file, 'utf8'); assert.equal(bytes.includes('PRIVATE_'), false);
  const review = await f.review(reopened, ids[0], 'After restart'); assert.equal(review.prepared.followup.exchanges.length, 1); assert.equal(review.prepared.reuse, undefined);
});

test('draft autosave preserves a reviewed history but explicit clear invalidates it', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  await f.complete(f.e, nodeId, 'First turn');
  const reviewed = await f.review(f.e, nodeId, 'Second turn'), saved = await f.read(f.e, nodeId);
  await f.request(f.e, 'draft', nodeId, { research: saved.research, guard: saved.guard, draft: draft('Typing while reviewed') });
  await f.start(f.e, nodeId, reviewed); await new Promise(setImmediate); f.runs.at(-1).resolve(response); await Promise.all([...f.e.researchTasks]); assert.equal(f.e.error, '');
  const nextReview = await f.review(f.e, nodeId, 'Third turn'), other = await f.open(), current = await f.read(other, nodeId);
  await f.request(other, 'clear', nodeId, { research: current.research, guard: current.guard });
  await assert.rejects(f.start(f.e, nodeId, nextReview), /history|conversation|changed|review/i);
  assert.equal(f.runs.length, 2); assert.equal((await f.read(other, nodeId)).draft.question, 'Typing while reviewed');
});

test('deletion in another canvas prevents a held reply from restoring private history', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  await f.start(f.e, nodeId, await f.review(f.e, nodeId, 'Held private turn')); await new Promise(setImmediate);
  const other = await f.open(), current = await f.read(other, nodeId);
  await f.request(other, 'delete', nodeId, { research: current.research, guard: current.guard });
  f.runs.at(-1).resolve(response); await Promise.all([...f.e.researchTasks]);
  const after = await f.read(other, nodeId); assert.equal(after.history, null); assert.equal(after.draft.question, '');
  assert.match(f.e.error, /history|conversation|changed|deleted/i); assert.equal(f.e.pending, null);
});

test('explicit copied journeys do not inherit the original private discussion or draft', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  const baseline = await f.read(f.e, nodeId);
  await f.request(f.e, 'draft', nodeId, { research: baseline.research, guard: baseline.guard, draft: draft('Original private composer') });
  await f.complete(f.e, nodeId, 'Original private discussion');
  const copied = await f.library.import(f.e.doc, { asCopy: true }); assert.notEqual(copied.key, f.record.key);
  await f.e.attach(copied.key);
  const copy = await f.e.conversationRequest({ action: 'read', conversationScope: f.e.uiSnapshot().conversationScope, journey: copied.key, nodeId: f.e.doc.nodes[1].id, revision: f.e.doc.revision });
  assert.equal(copy.history, null); assert.equal(copy.draft.question, '');
  await f.e.attach(f.record.key); const original = await f.read(f.e, nodeId);
  assert.equal(original.history.exchanges[0].question, 'Original private discussion'); assert.equal(original.draft.question, 'Original private composer');
  assert.equal(f.runs.length, 1);
});

for (const committed of [false, true]) test(`an ${committed ? 'acknowledgement-lost' : 'unwritten'} reply stays scoped across navigation and explicitly saves once`, async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  await f.complete(f.e, nodeId, 'First private turn');
  await f.start(f.e, nodeId, await f.review(f.e, nodeId, 'Second private turn'));
  const store = f.e.conversations.binding(f.e).store, write = store.write;
  store.write = async (...args) => { if (committed) await write(...args); throw Error('Synthetic save confirmation failure'); };
  f.runs.at(-1).resolve(response); await Promise.all([...f.e.researchTasks]);
  const pending = f.e.uiSnapshot().unsavedConversation; assert.ok(pending?.id); assert.match(f.e.error, /could not be confirmed/);
  assert.equal((await f.read(f.e, nodeId)).history.exchanges.length, 2);
  const disk = await store.read(f.e.conversations.key(f.e, f.e.doc, nodeId)); assert.equal(disk.entry.history.exchanges.length, committed ? 2 : 1);
  await assert.rejects(f.review(f.e, nodeId, 'Do not overwrite unsaved reply'), /save again|unsaved reply/i);
  const copy = await f.library.import(f.e.doc, { asCopy: true }); await f.e.attach(copy.key);
  const scopeB = f.e.uiSnapshot().conversationScope, other = await f.e.conversationRequest({ action: 'read', conversationScope: scopeB, journey: copy.key, nodeId: f.e.doc.nodes[1].id, revision: f.e.doc.revision });
  assert.equal(other.history, null); assert.equal(other.unsaved.here, false); assert.equal(JSON.stringify(other).includes('Second private turn'), false);
  await assert.rejects(f.e.conversationRequest({ action: 'retry-save', conversationScope: scopeB, journey: copy.key, nodeId, id: pending.id }), /scope|changed/);
  await f.e.attach(f.record.key); store.write = write;
  await f.e.conversationRequest({ action: 'retry-save', conversationScope: f.e.uiSnapshot().conversationScope, journey: f.record.key, nodeId, id: pending.id });
  assert.equal(f.e.uiSnapshot().unsavedConversation, null); assert.equal(f.runs.length, 2);
  const reopened = await f.open(), saved = await f.read(reopened, nodeId);
  assert.deepEqual(saved.history.exchanges.map(item => item.question), ['First private turn', 'Second private turn']);
});

test('deletion while an unconfirmed reply is retained rejects retry and permits explicit discard', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  await f.start(f.e, nodeId, await f.review(f.e, nodeId, 'Unconfirmed private reply'));
  const store = f.e.conversations.binding(f.e).store, write = store.write;
  store.write = async () => { throw Error('Synthetic disk full'); };
  f.runs.at(-1).resolve(response); await Promise.all([...f.e.researchTasks]); store.write = write;
  const pending = f.e.uiSnapshot().unsavedConversation, other = await f.open(), before = await f.read(other, nodeId);
  await f.request(other, 'delete', nodeId, { research: before.research, guard: before.guard });
  const target = { journey: f.record.key, conversationScope: f.e.uiSnapshot().conversationScope, id: pending.id };
  await assert.rejects(f.e.conversationRequest({ action: 'retry-save', nodeId, ...target }), /changed|deleted/);
  assert.equal((await f.read(other, nodeId)).history, null);
  await f.e.conversationRequest({ action: 'discard-unsaved', ...target }); assert.equal(f.e.uiSnapshot().unsavedConversation, null);
});

test('queued follow-up checks authoritative history before invoking its helper', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  let release; f.e.researchTask = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const review = await f.review(f.e, nodeId, 'Queued question');
  await f.e.command('research-follow-up', { journey: f.record.key, nodeId, token: review.token });
  const other = await f.open(), before = await f.read(other, nodeId);
  await f.request(other, 'delete', nodeId, { research: before.research, guard: before.guard });
  release(); await Promise.all([...f.e.researchTasks]);
  assert.equal(f.runs.length, 0); assert.match(f.e.error, /changed|deleted/); assert.equal(f.e.pending, null);
});

test('an identical explicitly rerun research result keeps earlier discussion historical after restart', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  f.e.researcher.run = async () => structuredClone(findings);
  const research = async () => {
    const value = await f.e.reviewResearch({ action: 'prepare', journey: f.record.key, nodeId, scope: 'decisions', excluded: [], clientId: randomUUID(), sequence: 1 });
    await f.e.command('research', { journey: f.record.key, nodeId, token: value.token }); await Promise.all([...f.e.researchTasks]); assert.equal(f.e.error, '');
  };
  await research(); await f.complete(f.e, nodeId, 'Before replacement');
  const original = structuredClone(f.e.doc.nodes[1].research); await research(); assert.deepEqual(f.e.doc.nodes[1].research, original);
  const reopened = await f.open(), saved = await f.read(reopened, nodeId);
  assert.equal(saved.historical, true); assert.equal(saved.history.exchanges[0].question, 'Before replacement');
  await assert.rejects(f.review(reopened, nodeId, 'New discussion'), /historical.*fresh conversation/);
  await f.request(reopened, 'clear', nodeId, { research: saved.research, guard: saved.guard });
  assert.equal((await f.review(reopened, nodeId, 'Fresh discussion')).prepared.followup.exchanges.length, 0);
});


test('private HTTP conversations require scoped exact inputs and omit transcripts from diagnostics and public snapshots', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  const { startServer } = await import(pathToFileURL(resolve(base + 'server.mjs')));
  const server = await startServer(f.e, { status: async () => ({ ready: false }), close() {} }); t.after(() => server.close());
  const origin = new URL(server.url).origin, route = server.url + 'api/research-conversations';
  const post = (body, headers = {}, url = route) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const read = { action: 'read', journey: f.record.key, conversationScope: f.e.uiSnapshot().conversationScope, nodeId, revision: f.e.doc.revision };
  assert.equal((await post(read, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post(read, { 'X-Explorer-Client': '0' })).status, 403);
  assert.notEqual((await post(read, {}, origin + '/api/research-conversations')).status, 200);
  for (const changed of [{ conversationScope: 'f'.repeat(64) }, { file: 'outside.json' }, { namespace: 'a'.repeat(64) }, { revision: read.revision + 1 }]) assert.equal((await post({ ...read, ...changed })).status, 400);
  assert.equal((await post(' '.repeat(32769))).status, 400);
  const saved = await (await post(read)).json();
  assert.equal((await post({ action: 'draft', journey: read.journey, conversationScope: read.conversationScope, nodeId, research: saved.research, guard: saved.guard, draft: draft('PRIVATE_HTTP_CANARY') })).status, 200);
  const diagnostics = await fetch(server.url + 'api/diagnostics'); const support = await post({}, {}, server.url + 'api/support');
  for (const response of [diagnostics, support]) assert.equal((await response.text()).includes('PRIVATE_HTTP_CANARY'), false);
  const native = await f.e.nativeSnapshot(); assert.equal(native.document.id, f.e.doc.id);
  assert.equal(JSON.stringify([f.e.snapshot(), native, f.e.doc]).includes('PRIVATE_HTTP_CANARY'), false); assert.equal(f.runs.length, 0);
});


for (const deleted of [false, true]) test(`failed final private-store read retains reply and ${deleted ? 'rejects deletion on retry' : 'saves once after recovery'}`, async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  await f.start(f.e, nodeId, await f.review(f.e, nodeId, 'PRIVATE_READ_FAILURE'));
  const store = f.e.conversations.binding(f.e).store, read = store.read;
  store.read = async () => { throw Error('Synthetic temporary read failure'); };
  f.runs.at(-1).resolve(response); await Promise.all([...f.e.researchTasks]);
  const pending = f.e.uiSnapshot().unsavedConversation; assert.ok(pending?.id);
  const native = await f.e.nativeSnapshot(); assert.equal(native.document.id, f.e.doc.id);
  assert.equal(JSON.stringify([native, f.e.snapshot()]).includes('PRIVATE_'), false);
  await assert.rejects(f.review(f.e, nodeId, 'Blocked'), /save again|unsaved reply/i);
  store.read = read;
  const other = await f.open(), saved = await f.read(other, nodeId);
  if (deleted) await f.request(other, 'delete', nodeId, { research: saved.research, guard: saved.guard });
  const retry = () => f.e.conversationRequest({ action: 'retry-save', journey: f.record.key, conversationScope: f.e.uiSnapshot().conversationScope, nodeId, id: pending.id });
  if (deleted) { await assert.rejects(retry(), /changed|deleted/); assert.equal((await f.read(other, nodeId)).history, null); }
  else { await retry(); assert.equal((await f.read(other, nodeId)).history.exchanges.length, 1); assert.equal(f.e.uiSnapshot().unsavedConversation, null); }
  assert.equal(f.runs.length, 1);
});

test('research A to B to A keeps the original A discussion historical across restart', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id; let summary = 'A';
  f.e.researcher.run = async () => ({ ...structuredClone(findings), summary });
  const research = async () => {
    const review = await f.e.reviewResearch({ action: 'prepare', journey: f.record.key, nodeId, scope: 'decisions', excluded: [], clientId: randomUUID(), sequence: 1 });
    await f.e.command('research', { journey: f.record.key, nodeId, token: review.token }); await Promise.all([...f.e.researchTasks]); assert.equal(f.e.error, '');
  };
  await research(); await f.complete(f.e, nodeId, 'Original A conversation');
  summary = 'B'; await research(); summary = 'A'; await research();
  const reopened = await f.open(), saved = await f.read(reopened, nodeId);
  assert.equal(saved.history.exchanges[0].question, 'Original A conversation'); assert.equal(saved.historical, true);
  await assert.rejects(f.review(reopened, nodeId, 'Fresh?'), /historical/);
});

for (const failure of ['read', 'write', 'lost-ack']) test(`research replacement cannot commit ahead of its historical boundary on ${failure} failure`, async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  f.e.researcher.run = async () => structuredClone(findings);
  const research = async () => {
    const review = await f.e.reviewResearch({ action: 'prepare', journey: f.record.key, nodeId, scope: 'decisions', excluded: [], clientId: randomUUID(), sequence: 1 });
    await f.e.command('research', { journey: f.record.key, nodeId, token: review.token }); await Promise.all([...f.e.researchTasks]);
  };
  await research(); await f.complete(f.e, nodeId, 'Before failure');
  const revision = f.e.doc.revision, store = f.e.conversations.binding(f.e).store, method = failure === 'read' ? 'read' : 'write', original = store[method];
  store[method] = async (...args) => { if (failure === 'lost-ack') await original.apply(store, args); throw Error('Synthetic marker failure'); };
  await research(); assert.match(f.e.error, /Synthetic marker failure/); store[method] = original;
  const reopened = await f.open(); assert.equal(reopened.doc.revision, revision, 'map replacement is not committed before its boundary');
  const saved = await f.read(reopened, nodeId); assert.equal(saved.historical, failure === 'lost-ack');
  assert.equal(f.e.uiSnapshot().unsavedConversation, null, 'boundary failure is not a new unsaved follow-up reply');
});


test('observed stale context stays historical after context reversion, question switching and restart', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id;
  await f.complete(f.e, nodeId, 'Original context');
  const original = structuredClone(f.e.doc), changed = structuredClone(original); changed.nodes[1].question = 'A changed question?';
  await f.e.save(changed); assert.equal((await f.read(f.e, nodeId)).historical, true);
  await f.e.save(original); await f.complete(f.e, f.doc.nodes[2].id, 'Other question');
  const reopened = await f.open(), saved = await f.read(reopened, nodeId);
  assert.equal(saved.historical, true); await assert.rejects(f.review(reopened, nodeId, 'Original again?'), /historical/);
});


for (const action of ['clear', 'delete']) test(`historical marking cannot overwrite a concurrent ${action}`, async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id; await f.complete(f.e, nodeId, 'Before context change');
  const other = await f.open(), before = await f.read(other, nodeId);
  const changed = structuredClone(f.e.doc); changed.nodes[1].question = 'Changed wording?'; await f.e.save(changed);
  const store = f.e.conversations.binding(f.e).store, save = store.saveHistory;
  store.saveHistory = async (...args) => { await f.request(other, action, nodeId, { research: before.research, guard: before.guard }); return save.apply(store, args); };
  await assert.rejects(f.read(f.e, nodeId), /changed|deleted/); store.saveHistory = save;
  assert.equal((await f.read(f.e, nodeId)).history, null); assert.equal(f.e.uiSnapshot().unsavedConversation, null);
});

test('historical observation does not create missing records, and unavailable policy alone is not durable invalidation', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id, store = f.e.conversations.binding(f.e).store;
  const changed = structuredClone(f.e.doc); changed.nodes[1].researchStale = true; await f.e.save(changed);
  await f.read(f.e, nodeId); assert.equal((await store.list()).length, 0);
  delete changed.nodes[1].researchStale; await f.e.save(changed); await f.complete(f.e, nodeId, 'Known context');
  const policy = f.e.scenarioPolicy; f.e.scenarioPolicy = async () => { throw Error('Temporarily unavailable'); };
  assert.equal((await f.read(f.e, nodeId)).historical, true); f.e.scenarioPolicy = policy;
  assert.equal((await f.read(f.e, nodeId)).historical, false);
  const newer = structuredClone(f.e.doc); newer.nodes[1].question = 'Changed again?'; await f.e.save(newer);
  const write = store.write, bytes = await readFile(store.file); store.write = async () => { throw Error('Marker write failed'); };
  await assert.rejects(f.read(f.e, nodeId), /Marker write failed/); assert.deepEqual(await readFile(store.file), bytes); assert.equal(f.e.uiSnapshot().unsavedConversation, null);
  store.write = write; assert.equal((await f.read(f.e, nodeId)).historical, true);
});


test('a delayed earlier-research composer saves privately as historical without becoming current history', async t => {
  const f = await fixture(t), nodeId = f.doc.nodes[1].id, before = await f.read(f.e, nodeId);
  const changed = structuredClone(f.e.doc); changed.nodes[1].research.summary = 'Replacement'; await f.e.save(changed);
  await f.request(f.e, 'draft', nodeId, { research: before.research, guard: before.guard, draft: draft('Earlier research private draft') });
  const current = await f.read(f.e, nodeId); assert.equal(current.draft.question, ''); assert.equal(current.history, null);
  const older = await f.request(f.e, 'archive', nodeId, { research: before.research }); assert.equal(older.draft.question, 'Earlier research private draft');
  assert.equal((await f.review(f.e, nodeId, 'Current question')).prepared.followup.exchanges.length, 0);
  await f.request(f.e, 'delete', nodeId, { research: older.research, guard: older.guard });
  await assert.rejects(f.request(f.e, 'draft', nodeId, { research: before.research, guard: before.guard, draft: draft('Stale late draft') }), /changed|deleted/);
  const guard = (await f.read(f.e, nodeId)).guard;
  await assert.rejects(f.request(f.e, 'draft', f.e.doc.rootId, { research: 'f'.repeat(64), guard, draft: draft('Not a question') }), /changed|history/);
});


test('metadata cleanup frees an unrelated record while preserving an unsaved validated reply', async t => {
  const f = await fixture(t), [nodeId, otherId] = f.doc.nodes.slice(1).map(node => node.id);
  await f.complete(f.e, nodeId, 'First history'); await f.complete(f.e, otherId, 'Unrelated history');
  await f.start(f.e, nodeId, await f.review(f.e, nodeId, 'Retain this unsaved reply'));
  const store = f.e.conversations.binding(f.e).store, save = store.saveHistory;
  store.saveHistory = async (...args) => { if ((await store.list()).length > 1) throw Error('Synthetic capacity limit'); return save.apply(store, args); };
  f.runs.at(-1).resolve(response); await Promise.all([...f.e.researchTasks]);
  const pending = f.e.uiSnapshot().unsavedConversation; assert.ok(pending?.id);
  const input = { conversationScope: f.e.uiSnapshot().conversationScope, journey: f.record.key };
  const inventory = await f.e.conversationRequest({ action: 'inventory', ...input });
  assert.equal(JSON.stringify(inventory).includes('Unrelated history'), false);
  const own = inventory.entries.find(item => item.target.nodeId === nodeId), other = inventory.entries.find(item => item.target.nodeId === otherId);
  await assert.rejects(f.e.conversationRequest({ action: 'cleanup', ...input, target: own.target, guard: own.guard }), /unsaved|reply/i);
  await f.e.conversationRequest({ action: 'cleanup', ...input, target: other.target, guard: other.guard });
  await f.e.conversationRequest({ action: 'retry-save', ...input, nodeId, id: pending.id });
  assert.equal((await f.read(f.e, nodeId)).history.exchanges.length, 2); assert.equal(f.e.uiSnapshot().unsavedConversation, null); assert.equal(f.runs.length, 3);
});
