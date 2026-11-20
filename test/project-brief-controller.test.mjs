import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { parseProjectBrief, PROJECT_BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/project-brief.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { waitFor } from './helpers/wait-for.mjs';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-brief-controller-')), root = join(directory, 'project'), file = join(directory, 'map.json');
  await mkdir(root); await promisify(execFile)('git', ['init', '--quiet', root], { windowsHide: true });
  const canary = 'PRIVATE_PROJECT_BRIEF_INPUT 🌿'; await writeFile(join(root, 'README.md'), canary);
  const doc = createDocument('Ordinary map'); await writeFile(file, JSON.stringify(doc)); let sends = 0, signal, release, working = root; const ordinary = [];
  const helper = { close: async () => {}, run: async (prepared, settings) => {
    sends++; signal = settings.signal; if (options.hold) await new Promise(resolve => { release = resolve; }); signal.throwIfAborted();
    const output = Object.fromEntries(PROJECT_BRIEF_SECTIONS.map(section => [section, [{ id: section, text: `${section} remains unknown.`, kind: 'unknown', sources: [] }]]));
    output.purpose[0] = { id: 'purpose', text: canary, kind: 'file-backed', sources: [{ id: prepared.context.sources[0].id, quote: canary }] };
    return parseProjectBrief(JSON.stringify(output), prepared);
  } };
  const explorer = await new Explorer({ file, projectRoot: () => working, projectBriefHelper: helper, send: async message => { ordinary.push(message); } }).load(), server = await startServer(explorer);
  t.after(async () => { explorer.projectBrief?.clear(); release?.(); await server.close(); await explorer.close(); assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('explorer-brief-controller-')); await rm(directory, { recursive: true, force: true }); });
  let scopeSequence = 0, sequence = 0; const scopeClient = randomUUID(), clientId = randomUUID();
  const scope = (action, extra = {}) => explorer.projectModeRequest({ action, purpose: 'project-questions', journey: doc.id, clientId: scopeClient, sequence: ++scopeSequence, ...extra });
  const send = (action, extra = {}, origin = true) => fetch(`${server.url}api/project-brief`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...(origin ? { Origin: new URL(server.url).origin } : {}) }, body: JSON.stringify({ action, purpose: 'project-brief', journey: doc.id, clientId, sequence: ++sequence, ...extra }) });
  const request = async (action, extra = {}) => { const response = await send(action, extra); const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value; };
  await scope('status'); const preview = await scope('prepare', { paths: ['README.md'], exclusions: [] }); const enabled = await scope('approve', { token: preview.token }); await scope('read', { token: enabled.readToken });
  return { explorer, server, file, root, canary, doc, request, send, scope, sends: () => sends, ordinary, signal: () => signal, ready: () => release, release: () => release?.(), setRoot: value => { working = value; } };
}

test('project brief HTTP requires Origin and purpose; explicit approved briefs stay out of maps, native context, exports and ordinary questions', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8'), native = JSON.stringify(f.explorer.nativeSnapshot());
  assert.equal((await f.send('status', {}, false)).status, 403); assert.equal((await f.send('status', { purpose: 'research' })).status, 400);
  await f.request('status'); const preview = await f.request('prepare'); assert.equal(f.sends(), 0); assert.ok(preview.prepared.prompt.includes(f.canary));
  await f.request('start', { id: randomUUID(), token: preview.token }); await waitFor(() => f.explorer.projectBrief.work?.status !== 'pending');
  const draft = await f.request('status'); assert.equal(draft.draft.sections.purpose[0].text, f.canary);
  assert.equal((await f.request('approve', { revision: draft.revision, changes: { edits: [], remove: [], additions: [] } })).approved, true);
  assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(JSON.stringify(f.explorer.nativeSnapshot()), native);
  for (const path of ['export.json', 'export.md']) assert.ok(!(await (await fetch(f.server.url + path)).text()).includes(f.canary));
  assert.ok(!JSON.stringify(f.explorer.uiSnapshot()).includes(f.canary));
  await f.explorer.command('questions', { nodeId: f.doc.rootId, revision: f.doc.revision }); await waitFor(() => f.ordinary.length);
  assert.ok(!JSON.stringify(f.ordinary).includes(f.canary)); assert.equal(f.sends(), 1);
});

test('scope disable interrupts a running brief and closing the canvas prevents queued helper invocation', async t => {
  const f = await fixture(t, { hold: true }); await f.request('status'); const preview = await f.request('prepare'); await f.request('start', { id: randomUUID(), token: preview.token });
  await waitFor(() => f.ready()); await f.scope('disable'); assert.equal(f.signal().aborted, true); f.release(); await f.explorer.toolFreeTask;
  assert.equal((await f.request('status')).draft, undefined);
  const queued = await fixture(t); let releaseQueue; queued.explorer.toolFreeTask = new Promise(resolve => { releaseQueue = resolve; });
  await queued.request('status'); const next = await queued.request('prepare'); await queued.request('start', { id: randomUUID(), token: next.token });
  const closed = queued.explorer.close(); releaseQueue(); await closed; assert.equal(queued.sends(), 0);
});

test('project briefs share the cross-feature shutdown barrier and wait for confirmed release', async t => {
  const f = await fixture(t); let release;
  f.explorer.trackToolFreeRelease({ releaseConfirmed: new Promise(resolve => { release = resolve; }) });
  await f.request('status'); const preview = await f.request('prepare'); await f.request('start', { id: randomUUID(), token: preview.token });
  await waitFor(() => f.explorer.projectBrief.work?.status === 'error'); assert.equal(f.sends(), 0);
  assert.match((await f.request('status')).error, /not confirmed shutdown/);
  release(true); await new Promise(setImmediate);
  f.explorer.projectBriefHelper.run = async () => { throw Object.assign(Error('Brief helper stop failed'), { releaseConfirmed: Promise.resolve(false) }); };
  const next = await f.request('prepare'); await f.request('start', { id: randomUUID(), token: next.token });
  await waitFor(() => f.explorer.projectBrief.work?.status === 'error');
  assert.throws(() => f.explorer.requireToolFreeRelease(), /not confirmed shutdown/);
});

test('metadata-only project changes clear saved corrections before recapture, including an already-off scope', async t => {
  for (const off of [false, true]) {
    const f = await fixture(t); await f.request('status'); const preview = await f.request('prepare'); await f.request('start', { id: randomUUID(), token: preview.token });
    await waitFor(() => f.explorer.projectBrief.work?.status !== 'pending'); const draft = await f.request('status');
    await f.request('edit', { revision: draft.revision, changes: { edits: [], remove: [], additions: [{ section: 'purpose', text: 'PROJECT_A_USER_CORRECTION' }] } });
    if (off) { await f.scope('disable'); assert.equal((await f.request('status')).corrections.length, 1, 'same-project off preserves corrections'); }
    const other = join(dirname(f.root), 'other-project'); await mkdir(other); await promisify(execFile)('git', ['init', '--quiet', other], { windowsHide: true }); f.setRoot(other);
    const mode = await f.scope('status'); assert.equal(mode.project.root, other);
    const changed = await f.request('status'); assert.deepEqual(changed.corrections, []); assert.equal(changed.project.root, other);
    assert.ok(!JSON.stringify(changed).includes('PROJECT_A_USER_CORRECTION')); assert.equal(changed.captureAvailable, false);
  }
});
