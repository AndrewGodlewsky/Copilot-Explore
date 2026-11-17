import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';

test('private cleanup HTTP validates identity/origin/body; replacement/cancel cannot save or expose drafts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-clean-protocol-')), messages = [], runs = [];
  const explorer = new Explorer({ file: join(dir, 'map.explore.json'), send: async m => messages.push(m), target: {}, cleaner: {
    run(text, options) { return new Promise(resolve => { runs.push({ text, ...options, resolve }); }); },
    close: async () => {},
  } });
  await explorer.command('start', { topic: 'Topic' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ question: 'Q?', category: 'C' }] });
  await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: [{ index: 0, question: 'Q?' }] });
  const server = await startServer(explorer, { close() {} });
  t.after(async () => { runs.forEach(run => run.resolve('Late')); await server.close(); await rm(dir, { recursive: true, force: true }); });
  const origin = new URL(server.url).origin, nodeId = explorer.doc.nodes[1].id;
  const base = { id: randomUUID(), journey: explorer.doc.id, nodeId, mutation: 1 }, original = 'PRIVATE 😀 maybe 42';
  const post = (body, headers = {}) => fetch(server.url + 'api/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin, ...headers }, body: JSON.stringify(body) });
  for (const headers of [{ Origin: '' }, { Origin: 'https://other.test' }, { 'X-Explorer-Client': '' }]) assert.equal((await post({ ...base, action: 'start', text: original }, headers)).status, 403);
  assert.equal(await new Promise(resolve => { const req = request(server.url + 'api/cleanup', { method: 'POST', headers: { Host: 'other.test' } }, res => { res.resume(); resolve(res.statusCode); }); req.end('{}'); }), 403);
  for (const change of [{ text: '' }, { text: 'x'.repeat(20001) }, { journey: 'other' }, { nodeId: explorer.doc.rootId }, { mutation: -1 }, { extra: true }]) assert.equal((await post({ ...base, action: 'start', text: original, ...change })).status, 400);
  const revision = explorer.doc.revision;
  assert.equal((await post({ ...base, action: 'start', text: original })).status, 200); await delay(0);
  assert.equal(runs[0].text, original);
  for (const snapshot of [explorer.snapshot(), explorer.uiSnapshot(), await fetch(server.url + 'api/state').then(r => r.json())]) assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  const second = { ...base, id: randomUUID() };
  await post({ ...second, action: 'start', text: '\u0001'.repeat(19999) + 'a' });
  assert.equal(runs[0].signal.aborted, true); assert.equal(runs.length, 1);
  runs[0].resolve('Obsolete'); await delay(10); assert.equal(runs.length, 2);
  await post({ ...base, action: 'cancel' }); assert.equal(runs[1].signal.aborted, false);
  runs[1].resolve('<script>proposal</script>'); await delay(10);
  const proposal = await post({ ...second, action: 'poll' }).then(r => r.json());
  assert.equal(proposal.text, '<script>proposal</script>'); assert.equal(proposal.status, 'proposal');
  assert.ok(!JSON.stringify(explorer.snapshot()).includes('proposal</script>'));
  assert.equal(explorer.doc.revision, revision); assert.equal(explorer.doc.nodes[1].answer, ''); assert.equal(messages.length, 1);
  await post({ ...second, action: 'cancel' });
  assert.equal((await post({ ...second, action: 'poll' }).then(r => r.json())).status, 'cancelled');
  assert.equal((await post({ ...base, action: 'start', text: 'x'.repeat(140000) })).status, 400);
  const third = { ...base, id: randomUUID() };
  await post({ ...third, action: 'start', text: original }); await delay(0);
  await explorer.command('import', { revision: explorer.doc.revision, document: createDocument('Other journey') });
  assert.equal(runs[2].signal.aborted, true, 'journey replacement releases the helper even without browser polling');
  runs[2].resolve('Late journey');
});
