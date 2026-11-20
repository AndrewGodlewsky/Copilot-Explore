import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectContext } from '../com.github.copilot/extensions/explorer/project-context.mjs';
import { ProjectMode } from '../com.github.copilot/extensions/explorer/project-mode.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { waitFor } from './helpers/wait-for.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-mode-')), root = join(directory, 'project'); await mkdir(root);
  await writeFile(join(root, 'notes.md'), 'PRIVATE PROJECT CANARY 🌿');
  let working = root, journey = 'journey-a', now = 1000;
  const reader = new ProjectContext(async () => working);
  reader.read = reader.select = async () => { throw Error('Scope approval must not read file contents'); };
  const mode = new ProjectMode(reader, () => journey, () => now), clientId = randomUUID(); let sequence = 0;
  const request = (action, extra = {}) => mode.request({ action, journey, clientId, sequence: ++sequence, purpose: 'project-questions', ...extra });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, root, reader, mode, request, clientId, setRoot: value => { working = value; }, setJourney: value => { journey = value; }, advance: value => { now += value; } };
}

test('scope is off by default; metadata-only review and one-use approval expose exact local purpose/files', async t => {
  const f = await fixture(t); assert.equal((await f.request('status')).state, 'off');
  const review = await f.request('prepare', { paths: ['notes.md'] });
  assert.equal(review.state, 'review'); assert.equal(review.project.root, f.root); assert.equal(review.purpose, 'project-questions');
  assert.deepEqual(review.scope.files, [{ name: 'notes.md', bytes: Buffer.byteLength('PRIVATE PROJECT CANARY 🌿') }]);
  assert.ok(!JSON.stringify(review).includes('PRIVATE PROJECT CANARY'));
  const active = await f.request('approve', { token: review.token }); assert.equal(active.state, 'active'); assert.equal(active.token, undefined);
  await assert.rejects(f.request('approve', { token: review.token }), /expired|review|token/i);
  assert.equal((await f.request('status')).state, 'active'); assert.equal((await f.request('disable')).state, 'off');
});

test('scope rejects other purposes, unreviewed authority, unsafe paths and aggregate bounds', async t => {
  const f = await fixture(t); await f.request('status');
  for (const extra of [{ purpose: 'challenge' }, { project: { paths: ['notes.md'] } }, { token: 'foreign-token' }]) await assert.rejects(f.request('prepare', { paths: ['notes.md'], ...extra }), /invalid/i);
  for (const paths of [[], ['../notes.md'], ['auth.json'], ['.env'], ['notes.md', 'notes.md'], Array.from({ length: 6 }, (_, i) => `${i}.md`)]) await assert.rejects(f.request('prepare', { paths }));
  for (const name of ['a.md', 'b.md', 'c.md']) await writeFile(join(f.root, name), 'x'.repeat(50000));
  await assert.rejects(f.request('prepare', { paths: ['a.md', 'b.md', 'c.md'] }), /128|limit/i);
  assert.equal((await f.request('status')).state, 'off');
});

test('root, file, journey, client and expiration changes cannot inherit or replay approval', async t => {
  for (const change of ['root', 'file', 'journey', 'client', 'expired']) {
    const f = await fixture(t); await f.request('status'); const review = await f.request('prepare', { paths: ['notes.md'] });
    if (change === 'root') f.setRoot(f.directory);
    if (change === 'file') await writeFile(join(f.root, 'notes.md'), 'changed');
    if (change === 'journey') f.setJourney('journey-b');
    if (change === 'client') await f.request('status', { clientId: randomUUID() });
    if (change === 'expired') f.advance(600001);
    await assert.rejects(f.request('approve', { token: review.token }), /changed|stale|expired|review|client/i, change);
    assert.notEqual((await f.request('status')).state, 'active', change);
  }
});

test('active scope becomes stale on observed file/root changes; unavailable metadata and clear stay off', async t => {
  const f = await fixture(t); await f.request('status'); const review = await f.request('prepare', { paths: ['notes.md'] }); await f.request('approve', { token: review.token });
  await writeFile(join(f.root, 'notes.md'), 'new source'); assert.equal((await f.request('status')).state, 'stale');
  f.setRoot(null); assert.equal((await f.request('status')).state, 'unavailable'); assert.equal((await f.request('disable')).state, 'off');
  f.mode.clear(); f.setRoot(f.root); assert.equal((await f.request('status')).state, 'off');
});

test('clearing or changing the journey while metadata is pending rejects the late preview', async t => {
  const f = await fixture(t); await f.request('status'); let release;
  const original = f.reader.root.bind(f.reader); f.reader.root = async () => { await new Promise(resolve => { release = resolve; }); return original(); };
  const pending = f.request('prepare', { paths: ['notes.md'] }); await new Promise(setImmediate); f.mode.clear(); release();
  await assert.rejects(pending, /changed|closed|obsolete/i); f.reader.root = original;
  assert.equal((await f.request('status')).state, 'off');
});

test('scope endpoint checks Origin and purpose; native/saved/export data stay unchanged and a new canvas is off', async t => {
  const f = await fixture(t), doc = createDocument('Ordinary exploration'), file = join(f.directory, 'map.explore.json'); await writeFile(file, JSON.stringify(doc));
  await promisify(execFile)('git', ['init', '--quiet', f.root], { windowsHide: true });
  const explorer = await new Explorer({ file, projectRoot: async () => f.root }).load(), server = await startServer(explorer);
  t.after(async () => { await server.close(); await explorer.close(); });
  const before = await readFile(file, 'utf8'), snapshot = JSON.stringify(explorer.nativeSnapshot()), clientId = randomUUID(); let sequence = 0;
  const send = (action, extra = {}, validOrigin = true) => fetch(`${server.url}api/project-mode`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...(validOrigin ? { Origin: new URL(server.url).origin } : {}) }, body: JSON.stringify({ action, journey: doc.id, clientId, sequence: ++sequence, purpose: 'project-questions', ...extra }) });
  assert.equal((await send('status', {}, false)).status, 403); assert.equal((await send('status', { purpose: 'research' })).status, 400);
  assert.equal((await (await send('status')).json()).state, 'off'); const review = await (await send('prepare', { paths: ['notes.md'] })).json();
  const enabled = await (await send('approve', { token: review.token })).json(); assert.equal(enabled.state, 'active');
  assert.equal((await send('read', { token: enabled.readToken }, false)).status, 403);
  const captured = await (await send('read', { token: enabled.readToken })).json(); assert.equal(captured.receipt.sources[0].excerpt, 'PRIVATE PROJECT CANARY 🌿');
  assert.equal((await send('read', { token: enabled.readToken })).status, 400);
  assert.equal(await readFile(file, 'utf8'), before); assert.equal(JSON.stringify(explorer.nativeSnapshot()), snapshot);
  assert.ok(!(await (await fetch(`${server.url}export.md`)).text()).includes('notes.md'));
  assert.ok(!JSON.stringify(explorer.uiSnapshot()).includes(f.root));
  const other = await new Explorer({ file, projectRoot: async () => f.root }).load(); t.after(() => other.close());
  assert.equal((await other.projectModeRequest({ action: 'status', journey: doc.id, clientId, sequence: 1, purpose: 'project-questions' })).state, 'off');
  await explorer.close(); await assert.rejects(explorer.projectModeRequest({ action: 'status', journey: doc.id, clientId, sequence: 50, purpose: 'project-questions' }), /closed/i);
});

test('ordinary questions never request project access or include an approved scope', async t => {
  const f = await fixture(t), doc = createDocument('Ordinary questions'), file = join(f.directory, 'plain.explore.json'); await writeFile(file, JSON.stringify(doc));
  await promisify(execFile)('git', ['init', '--quiet', f.root], { windowsHide: true });
  const sent = []; let rootReads = 0;
  const explorer = await new Explorer({ file, send: async message => { sent.push(message); }, projectRoot: async () => { rootReads++; return f.root; } }).load(); t.after(() => explorer.close());
  const clientId = randomUUID(), base = { journey: doc.id, clientId, purpose: 'project-questions' };
  await explorer.projectModeRequest({ ...base, action: 'status', sequence: 1 });
  const preview = await explorer.projectModeRequest({ ...base, action: 'prepare', sequence: 2, paths: ['notes.md'] });
  const enabled = await explorer.projectModeRequest({ ...base, action: 'approve', sequence: 3, token: preview.token });
  await explorer.projectModeRequest({ ...base, action: 'read', sequence: 4, token: enabled.readToken }); rootReads = 0;
  await explorer.command('questions', { nodeId: doc.rootId, revision: doc.revision });
  await waitFor(() => sent.length === 1);
  assert.equal(rootReads, 0); assert.equal(sent.length, 1); assert.ok(!JSON.stringify(sent).includes('notes.md')); assert.ok(!JSON.stringify(sent).includes('PRIVATE PROJECT CANARY'));
});
