import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { CommentsClient } from '../com.github.copilot/extensions/explorer/web/comments-client.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { changeComments, commentStatuses } from '../com.github.copilot/extensions/explorer/comments.mjs';

async function fixture(t, respond) {
  const dom = new JSDOM(await readFile(new URL('../com.github.copilot/extensions/explorer/web/index.html', import.meta.url), 'utf8'), { url: 'http://localhost/' });
  const document = dom.window.document, $ = id => document.getElementById(id), doc = createDocument('Comments'); addQuestions(doc, doc.rootId, [{ question: 'Which?', category: 'Decision' }]);
  let snapshot = { document: doc, storage: { scope: 'project' }, comments: {} }, saved = doc, client; const requests = [];
  $('comments-dialog').showModal = () => { $('comments-dialog').open = true; }; $('comments-dialog').close = () => { $('comments-dialog').open = false; };
  const el = (tag, attrs = {}, children = []) => { const node = document.createElement(tag); for (const [key, value] of Object.entries(attrs)) { if (key === 'onclick') node.onclick = value; else if (value === true) node.setAttribute(key, ''); else if (value !== false) node.setAttribute(key, value); } for (const child of [children].flat()) node.append(child instanceof dom.window.Node ? child : document.createTextNode(String(child))); return node; };
  const commit = fields => { const { action, revision, journey, ...input } = fields; saved = changeComments(saved, action.slice(8), input, { actor: null, at: '2026-11-18T12:00:00.000Z' }); saved.revision++; return { ...snapshot, document: saved, comments: commentStatuses(saved) }; };
  client = new CommentsClient({ $, el, button: (text, onclick, attrs) => el('button', { ...attrs, onclick }, text), selected: () => doc.nodes[1].id, eventText: () => 'Anonymous', active: () => true, canAct: () => true, begin: () => () => {}, append() {}, state: () => snapshot,
    apply: result => { snapshot = result; client.update(); }, fetch: async (_, options) => { const input = JSON.parse(options.body); requests.push(input); return respond(input, commit, requests.length, options); } });
  t.after(() => { client.close(false); dom.window.close(); }); client.open(doc.nodes[1].id);
  const type = (field, value) => { $(`comments-${field}`).value = value; $(`comments-${field}`).dispatchEvent(new dom.window.Event('input')); };
  return { $, client, requests, type, saved: () => saved, snapshot: () => snapshot };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('project comments wait for bounded Git saves and retain retry identity after the response deadline', async t => {
  let release, signal;
  const f = await fixture(t, (input, commit, count, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => { release = () => resolve(json(commit(input))); signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true }); });
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.type('text', 'Delayed save'); let pending = f.client.post('create');
  t.mock.timers.tick(10001); assert.equal(signal.aborted, false); release(); await pending;
  assert.equal(f.saved().comments.threads.length, 1);
  f.type('text', 'Next submission'); pending = f.client.post('reply');
  t.mock.timers.tick(29999); assert.equal(signal.aborted, false); t.mock.timers.tick(1); await pending;
  assert.equal(signal.aborted, true); assert.match(f.$('comments-status').textContent, /timed out.*may have saved/);
  assert.equal(f.$('comments-text').value, 'Next submission');
  f.type('text', 'Newer private text'); pending = f.client.post('reply'); release(); await pending;
  assert.equal(f.requests[2].messageId, f.requests[1].messageId); assert.equal(f.requests[2].text, 'Next submission');
  assert.equal(f.$('comments-text').value, 'Newer private text'); assert.equal(f.saved().comments.threads.length, 1); assert.equal(f.saved().comments.threads[0].messages.length, 2);
});

test('comment composer validates blank proposed wording before freezing a submission and allows corrected wording', async t => {
  const f = await fixture(t, (input, commit) => { try { return json(commit(input)); } catch (error) { return json({ error: error.message }, 400); } });
  f.type('text', 'A comment'); f.type('suggestion', '   '); await f.client.post('create'); assert.equal(f.requests.length, 0);
  f.type('suggestion', 'Corrected wording'); await f.client.post('create'); assert.equal(f.saved().comments.threads[0].messages[0].suggestion, 'Corrected wording');
});

test('a fresh server absence receipt releases rejected submission content for correction', async t => {
  const f = await fixture(t, (input, commit, count) => count === 1 ? json({ error: 'Collection size exceeded', commentSubmission: 'absent' }, 400) : json(commit(input)));
  f.type('text', 'Long comment'); await f.client.post('create'); f.type('text', 'Short'); await f.client.post('create');
  assert.equal(f.requests[1].text, 'Short'); assert.notEqual(f.requests[1].messageId, f.requests[0].messageId); assert.equal(f.saved().comments.threads[0].messages[0].text, 'Short');
});

test('a retained proposal stays editable when its target changes from a question to a direction', async t => {
  const f = await fixture(t, (input, commit) => json(commit(input)));
  f.type('text', 'Keep discussion'); f.type('suggestion', 'Earlier question proposal');
  f.snapshot().document.nodes[1].kind = 'direction'; f.client.update();
  assert.equal(f.$('comments-suggestion-area').hidden, false, 'retained text must remain accessible for correction');
  f.type('suggestion', ''); await f.client.post('create'); assert.equal(f.saved().comments.threads[0].messages[0].text, 'Keep discussion');
});

for (const receipt of ['present', 'unknown', undefined]) test(`an error with ${receipt ?? 'no'} receipt preserves retry identity after a possible commit`, async t => {
  const f = await fixture(t, (input, commit, count) => { const result = commit(input); return count === 1 ? json({ error: 'History completion failed', ...(receipt ? { commentSubmission: receipt } : {}) }, 400) : json(result); });
  f.type('text', 'Original post'); await f.client.post('create'); f.type('text', 'Newer text'); await f.client.post('create');
  assert.equal(f.requests[1].text, 'Original post'); assert.equal(f.requests[1].messageId, f.requests[0].messageId); assert.equal(f.saved().comments.threads.length, 1); assert.equal(f.$('comments-text').value, 'Newer text');
});
