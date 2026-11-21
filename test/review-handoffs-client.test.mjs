import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { ReviewHandoffsClient } from '../com.github.copilot/extensions/explorer/web/review-handoffs-client.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { changeReviewHandoffs, handoffStatuses } from '../com.github.copilot/extensions/explorer/review-handoffs.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function fixture(t, respond = (input, commit) => json(commit(input))) {
  const dom = new JSDOM(await readFile(new URL('../com.github.copilot/extensions/explorer/web/index.html', import.meta.url), 'utf8'), { url: 'http://localhost/' });
  const document = dom.window.document, $ = id => document.getElementById(`review-handoffs-${id}`), doc = createDocument('Handoff UI'); addQuestions(doc, doc.rootId, [{ question: 'Which?', category: 'Choice' }, { question: 'When?', category: 'Scope' }]);
  let snapshot = { document: doc, storage: { scope: 'project' }, reviewHandoffs: {} }, saved = doc, client, active = true, busy = false; const requests = [], copied = [];
  $('dialog').showModal = () => { $('dialog').open = true; }; $('dialog').close = () => { $('dialog').open = false; };
  const el = (tag, attrs = {}, children = []) => { const node = document.createElement(tag); for (const [key, value] of Object.entries(attrs)) { if (key.startsWith('on')) node[key] = value; else if (value === true) node.setAttribute(key, ''); else if (value !== false) node.setAttribute(key, value); } for (const child of [children].flat()) node.append(child instanceof dom.window.Node ? child : document.createTextNode(String(child))); return node; };
  const commit = fields => { const { action, revision, journey, ...input } = fields; saved = changeReviewHandoffs(saved, action.replace('review-handoff-', ''), input, { actor: null, at: '2026-11-18T12:00:00.000Z' }); saved.revision++; return { ...snapshot, document: saved, reviewHandoffs: handoffStatuses(saved) }; };
  client = new ReviewHandoffsClient({ $: id => document.getElementById(id), el, button: (text, onclick, attrs) => el('button', { ...attrs, onclick }, text), selected: () => doc.nodes[1].id, eventText: event => event.actor?.displayName ?? 'Anonymous contributor', active: () => active, canAct: () => !busy, begin: () => { busy = true; return () => { busy = false; }; }, state: () => snapshot,
    copyText: async text => copied.push(text), apply: result => { snapshot = result; client.update(); }, fetch: async (_, options) => { const input = JSON.parse(options.body); requests.push(input); return respond(input, commit, requests.length, options); } });
  t.after(() => { client.close(false); dom.window.close(); }); client.open(doc.nodes[1].id);
  const input = (field, value, kind = 'input') => { $(field).value = value; $(field).dispatchEvent(new dom.window.Event(kind)); };
  return { $, dom, client, requests, copied, input, saved: () => saved, snapshot: () => snapshot, set: result => { snapshot = result; client.update(); }, active: value => { active = value; }, busy: () => busy };
}

test('project handoffs wait for bounded Git saves and preserve drafts and IDs after the response deadline', async t => {
  let release, signal;
  const f = await fixture(t, (input, commit, count, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => { release = () => resolve(json(commit(input))); signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true }); });
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.input('note', 'Delayed handoff'); let pending = f.client.post('create');
  t.mock.timers.tick(10001); assert.equal(signal.aborted, false); release(); await pending;
  assert.equal(f.saved().reviewHandoffs.records.length, 1);
  f.input('note', 'Taking this'); pending = f.client.post('take');
  t.mock.timers.tick(29999); assert.equal(signal.aborted, false); t.mock.timers.tick(1); await pending;
  assert.equal(signal.aborted, true); assert.equal(f.busy(), false); assert.match(f.$('status').textContent, /timed out.*may have saved/);
  f.input('note', 'Newer note'); pending = f.client.post('retry'); release(); await pending;
  assert.equal(f.requests[2].transitionId, f.requests[1].transitionId); assert.equal(f.requests[2].note, 'Taking this');
  assert.equal(f.$('note').value, 'Newer note'); assert.equal(f.saved().reviewHandoffs.records[0].transitions.length, 2);
});

test('handoff composer creates a literal request, takes/completes/reassigns explicitly and copies only the selected record', async t => {
  const f = await fixture(t), before = structuredClone(f.saved().nodes);
  f.input('note', '<script>Review λ</script> https://example.test'); f.input('recipient', 'Reviewer <script>');
  const check = f.$('questions').querySelector('input'); check.checked = true; check.dispatchEvent(new f.dom.window.Event('change'));
  await f.client.post('create'); const record = f.saved().reviewHandoffs.records[0];
  assert.equal(record.unresolved.length, 1); assert.equal(record.transitions[0].recipient, 'Reviewer <script>'); assert.match(f.$('history').textContent, /<script>Review λ/); assert.equal(f.$('history').querySelector('script,a'), null);
  assert.match(f.$('context').textContent, /requested/i); f.input('note', 'Taking this'); await f.client.post('take'); assert.match(f.$('context').textContent, /taken/i);
  await f.client.post('complete'); assert.match(f.$('context').textContent, /complete/i); f.input('recipient', ''); f.input('note', 'Another review'); await f.client.post('reassign'); assert.match(f.$('context').textContent, /unassigned/i);
  assert.equal(f.saved().reviewHandoffs.records[0].transitions.length, 4); assert.deepEqual(f.saved().nodes, before);
  await f.client.copy(); assert.equal(f.copied.length, 1); assert.match(f.copied[0], /Review λ|Another review/); assert.match(f.copied[0], /Anonymous|unverified/i);
});

for (const taken of [true, false]) test(`completed handoff distinguishes ${taken ? 'anonymous acceptance' : 'no acceptance'} in its summary and selected export`, async t => {
  const f = await fixture(t); f.input('note', 'Review this'); await f.client.post('create');
  if (taken) await f.client.post('take');
  await f.client.post('complete'); await f.client.copy();
  if (taken) assert.match(f.$('context').textContent, /Taken by an anonymous contributor/i);
  else assert.doesNotMatch(f.$('context').textContent, /Taken by/i);
  assert.match(f.copied[0], taken ? /taken by: Anonymous contributor/ : /taken by: Not recorded/);
  f.input('recipient', 'Another reviewer'); await f.client.post('reassign'); await f.client.post('complete'); await f.client.copy();
  assert.doesNotMatch(f.$('context').textContent, /Taken by/i);
  assert.match(f.copied[1], /taken by: Not recorded/);
});

test('handoff prevalidation allows correction before freezing IDs and a confirmed absence permits a new submission', async t => {
  const f = await fixture(t, (input, commit, count) => count === 1 ? json({ error: 'Collection limit', handoffSubmission: 'absent' }, 400) : json(commit(input)));
  f.input('note', ' '); await f.client.post('create'); assert.equal(f.requests.length, 0);
  f.input('note', 'First'); f.input('recipient', '\u202eName'); await f.client.post('create'); assert.equal(f.requests.length, 0);
  f.input('recipient', 'Reviewer'); await f.client.post('create'); f.input('note', 'Corrected'); await f.client.post('create');
  assert.notEqual(f.requests[0].transitionId, f.requests[1].transitionId); assert.equal(f.saved().reviewHandoffs.records[0].transitions[0].note, 'Corrected');
});

for (const receipt of ['present', 'unknown', undefined]) test(`handoff ${receipt ?? 'missing'} receipt retains exact retry IDs and newer text after a possible save`, async t => {
  const f = await fixture(t, (input, commit, count) => { const result = commit(input); return count === 1 ? json({ error: 'History failed', ...(receipt ? { handoffSubmission: receipt } : {}) }, 400) : json(result); });
  f.input('note', 'Original'); await f.client.post('create'); f.input('note', 'Newer composing text'); f.input('recipient', 'New recipient'); await f.client.post('retry');
  assert.equal(f.requests[0].transitionId, f.requests[1].transitionId); assert.equal(f.requests[1].note, 'Original'); assert.equal(f.saved().reviewHandoffs.records.length, 1); assert.equal(f.$('note').value, 'Newer composing text'); assert.equal(f.$('recipient').value, 'New recipient');
});

test('handoff drafts and caret survive unchanged polling, close/reopen, branch navigation and scope changes', async t => {
  const f = await fixture(t), [a, b] = f.saved().nodes.slice(1); f.input('note', 'Private handoff draft'); f.input('recipient', 'Reviewer');
  const textarea = f.$('note'); textarea.focus(); textarea.setSelectionRange(2, 6); f.client.update(); assert.equal(f.$('note'), textarea); assert.equal(textarea.selectionStart, 2); assert.equal(f.dom.window.document.activeElement, textarea);
  f.client.close(); f.client.open(b.id); assert.equal(f.$('note').value, ''); f.client.close(); f.client.open(a.id); assert.equal(f.$('note').value, 'Private handoff draft');
  f.input('scope', 'journey', 'change'); f.input('note', 'Journey request'); f.input('scope', 'branch', 'change'); assert.equal(f.$('note').value, 'Private handoff draft'); f.input('scope', 'journey', 'change'); assert.equal(f.$('note').value, 'Journey request');
});

test('large unresolved-question selection is paged and searchable, retains choices and exposes removed choices for correction', async t => {
  const f = await fixture(t), doc = f.saved(), parent = doc.nodes[1];
  for (let i = 0; i < 45; i++) doc.nodes.push({ id: `question-${i}`, parentId: parent.id, question: `Detail ${i}?`, category: 'Detail', answer: '', research: null, review: false });
  f.client.update(); assert.equal(f.$('questions').querySelectorAll('input').length, 20);
  const original = f.$('questions').querySelector('input[data-handoff-question="question-0"]'); original.checked = true; original.dispatchEvent(new f.dom.window.Event('change'));
  f.$('questions-next').click(); assert.equal(f.$('questions').querySelectorAll('input').length, 20); original.checked = false; original.dispatchEvent(new f.dom.window.Event('change')); assert.match(f.$('selected').textContent, /Detail 0/);
  f.input('search', 'Detail 44'); const last = f.$('questions').querySelector('input'); assert.equal(f.$('questions').querySelectorAll('input').length, 1); last.checked = true; last.dispatchEvent(new f.dom.window.Event('change')); assert.match(f.$('selected').textContent, /Detail 44/);
  doc.nodes = doc.nodes.filter(node => node.id !== 'question-0'); f.client.update(); assert.match(f.$('selected').textContent, /removed|unavailable/i);
  f.$('selected').querySelector('[data-remove-question="question-0"]').click(); assert.doesNotMatch(f.$('selected').textContent, /Detail 0/);
  f.input('note', 'Investigate last detail'); await f.client.post('create'); assert.deepEqual(f.requests[0].unresolvedIds, ['question-44']);
});

test('changed and orphaned completed handoffs stay historical, personal files are read-only and exports are explicit', async t => {
  const f = await fixture(t); f.input('note', 'Historical request'); await f.client.post('create'); await f.client.post('complete');
  const doc = structuredClone(f.saved()); doc.nodes[1].answer = 'Changed'; doc.nodes[1].answerState = 'tentative';
  f.set({ ...f.snapshot(), document: doc, reviewHandoffs: handoffStatuses(doc) }); assert.match(f.$('context').textContent, /changed/i); assert.match(f.$('context').textContent, /complete/i);
  doc.nodes.splice(1, 1); f.set({ ...f.snapshot(), document: doc, reviewHandoffs: handoffStatuses(doc), storage: { scope: 'personal' } });
  assert.match(f.$('context').textContent, /removed|orphan/i); assert.equal(f.$('reassign').disabled, true); assert.match(f.$('history').textContent, /Historical request/); assert.equal(f.copied.length, 0);
  await f.client.copy(); assert.match(f.copied[0], /orphan|removed/i); const count = f.requests.length; await f.client.post('reassign'); assert.equal(f.requests.length, count);
});

test('handoff record pages and status filters stay bounded and selected export excludes other requests', async t => {
  const f = await fixture(t); let doc = f.saved(); const event = { actor: null, at: '2026-11-18T12:00:00.000Z' };
  for (let i = 0; i < 23; i++) doc = changeReviewHandoffs(doc, 'create', { id: randomUUID(), transitionId: randomUUID(), scope: { kind: 'journey' }, note: `Request ${i} ONLY_${i}_CANARY`, recipient: null, unresolvedIds: [] }, event);
  const selected = doc.reviewHandoffs.records[12]; doc = changeReviewHandoffs(doc, 'complete', { id: selected.id, transitionId: randomUUID(), note: 'Completed' }, event);
  f.set({ ...f.snapshot(), document: doc, reviewHandoffs: handoffStatuses(doc) }); assert.equal(f.$('record').options.length, 11); f.$('next').click(); assert.equal(f.$('record').options.length, 11); f.$('next').click(); assert.equal(f.$('record').options.length, 4);
  f.input('filter', 'complete', 'change'); assert.equal(f.$('record').options.length, 2); f.input('record', selected.id, 'change'); await f.client.copy(); assert.match(f.copied[0], /ONLY_12_CANARY/); assert.doesNotMatch(f.copied[0], /ONLY_11_CANARY|ONLY_13_CANARY/);
});

for (const leave of ['hide', 'suspend', 'switch']) test(`late handoff response after ${leave} cannot overwrite the current snapshot or draft`, async t => {
  let finish, result;
  const f = await fixture(t, (input, commit) => { result = commit(input); return new Promise(resolve => { finish = () => resolve(json(result)); }); });
  f.input('note', 'Submitted'); const pending = f.client.post('create'); assert.ok(finish); f.input('note', 'Newer private note');
  f.client.close(false); if (leave === 'suspend') f.active(false); if (leave === 'switch') f.set({ ...f.snapshot(), document: createDocument('Another journey'), reviewHandoffs: {} });
  finish(); await pending; assert.equal(f.busy(), false); assert.equal(f.snapshot().document.reviewHandoffs, undefined);
  if (leave !== 'switch') { f.active(true); f.client.open(f.snapshot().document.nodes[1].id); assert.equal(f.$('note').value, 'Newer private note'); }
});
