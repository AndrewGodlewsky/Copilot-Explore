import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { ChangeSummary } from '../com.github.copilot/extensions/explorer/change-summary-workflow.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

const exec = promisify(execFile), git = (cwd, ...args) => exec('git', ['-C', cwd, ...args], { windowsHide: true });
function document() {
  const doc = createDocument('Comparison λ'); addQuestions(doc, doc.rootId, [{ question: 'Which choice?', category: 'Design' }]);
  doc.nodes[1].answer = 'Original answer'; doc.nodes[1].answerState = 'tentative'; return doc;
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-summary-')), file = join(dir, 'map.explore.json'); await writeFile(file, JSON.stringify(document()));
  let calls = 0; const e = await new Explorer({ file, send() { calls++; throw Error('No chat'); }, briefHelper: { run() { calls++; throw Error('No model'); }, close() {} } }).load();
  for (const answer of ['First saved answer', 'Second saved answer']) { const doc = structuredClone(e.doc); doc.nodes[1].answer = answer; await e.save(doc); }
  await e.writeDraft({ journey: e.doc.id, nodeId: e.doc.nodes[1].id, base: e.doc.nodes[1], text: 'PRIVATE_DRAFT_CANARY', revision: 0 });
  const server = await startServer(e); t.after(async () => { await server.close(); await e.close(); await rm(dir, { recursive: true, force: true }); });
  const request = input => e.changeSummaryRequest({ journey: e.activeKey ?? e.doc.id, revision: e.doc.revision, ...input });
  const preview = (before = 0, after = e.doc.revision) => request({ action: 'preview', selection: { kind: 'saved', before, after } });
  const post = async (input, headers = {}) => {
    const response = await fetch(server.url + 'api/change-summary', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin, ...headers }, body: JSON.stringify({ journey: e.doc.id, revision: e.doc.revision, ...input }) });
    return { status: response.status, value: await response.json() };
  };
  return { dir, file, e, server, request, preview, post, calls: () => calls };
}

test('change summary selects exact retained saved versions without mutating the map, drafts or invoking models', async t => {
  const f = await fixture(t), bytes = await readFile(f.file), list = await f.request({ action: 'list' });
  assert.equal(list.current.revision, 2); assert.deepEqual(list.entries.map(row => row.revision), [1, 0]); assert.equal(list.gitAvailable, false);
  const p = await f.preview(0, 1); assert.equal(p.sources.before.revision, 0); assert.equal(p.sources.after.revision, 1);
  assert.match(p.markdown, /Original answer/); assert.match(p.markdown, /First saved answer/); assert.doesNotMatch(p.markdown, /Second saved answer|PRIVATE_DRAFT_CANARY/);
  assert.equal(p.revision, 2); assert.equal((await f.request({ action: 'check', token: p.token })).valid, true);
  assert.deepEqual(await readFile(f.file), bytes); assert.equal((await f.e.readDrafts(f.e.doc.id)).entries[0].text, 'PRIVATE_DRAFT_CANARY'); assert.equal(f.calls(), 0);
});

test('change summary rejects missing revisions, malformed selections and mismatched owner identity', async t => {
  const f = await fixture(t);
  for (const selection of [{ kind: 'saved', before: 999, after: 2 }, { kind: 'saved', before: -1, after: 2 }, { kind: 'saved', before: '0', after: 2 }, { kind: 'saved', before: 0, after: 2, draft: 'forbidden' }, { kind: 'git', ref: 'HEAD' }, { kind: 'unknown' }]) {
    await assert.rejects(f.request({ action: 'preview', selection }), /revision|selection|project|available|saved/i);
  }
  await assert.rejects(f.request({ action: 'list', journey: 'another' }), /journey|selection|changed/i);
  await assert.rejects(f.request({ action: 'list', revision: 0 }), /revision|selection|changed/i);
  await assert.rejects(f.request({ action: 'list', extra: 'forbidden' }), /request|selection/i);
  await assert.rejects(f.request({ action: 'cancel', token: {} }), /request|token/i);
});

test('change summary drops preview ownership when storage is replaced or the canvas closes', async t => {
  const f = await fixture(t); await f.preview(); assert.ok(f.e.changeSummaries.entry);
  f.e.replaceStorage(undefined); assert.equal(f.e.changeSummaries.entry, null);
  await f.preview(); await f.e.close(); assert.equal(f.e.changeSummaries.entry, null);
});

test('change summary tokens expire, cancel and invalidate on new previews or any current saved edit', async t => {
  const f = await fixture(t); let now = 1000; f.e.changeSummaries = new ChangeSummary({ now: () => now });
  let p = await f.preview(); now = p.expiresAt + 1; await assert.rejects(f.request({ action: 'check', token: p.token }), /expired|preview/i);
  p = await f.preview(); await f.request({ action: 'cancel', token: p.token }); await assert.rejects(f.request({ action: 'check', token: p.token }), /expired|preview/i);
  p = await f.preview(); await f.preview(1); await assert.rejects(f.request({ action: 'check', token: p.token }), /expired|preview/i);
  p = await f.preview(0, 1); const doc = structuredClone(f.e.doc); doc.objective = 'Unrelated current saved edit'; await f.e.save(doc);
  await assert.rejects(f.request({ action: 'check', token: p.token }), /changed|revision|preview/i);
});

test('change summary detects a pruned or damaged selected historical snapshot instead of guessing a base', async t => {
  const f = await fixture(t), p = await f.preview(0, 1), history = await f.e.history(f.e.doc.id);
  const manifest = JSON.parse(await history.read('manifest.json', 128 * 1024)); const old = manifest.entries.find(row => row.revision === 0), oldFile = join(await history.root(), `${old.hash}.json`), original = await readFile(oldFile);
  await writeFile(join(await history.root(), `${old.hash}.json`), '{}');
  await assert.rejects(f.request({ action: 'check', token: p.token }), /history|snapshot|recover/i);
  // Restore the exact retained bytes, then prune that entry with an otherwise current preview.
  await writeFile(oldFile, original); const fresh = await f.preview(0, 1);
  manifest.entries = manifest.entries.filter(row => row.revision !== 0);
  await writeFile(join(await history.root(), 'manifest.json'), JSON.stringify(manifest));
  await rm(join(await history.root(), `${old.hash}.json`));
  await assert.rejects(f.request({ action: 'check', token: fresh.token }), /revision|available|preview/i);
});

test('change summary rejects external saved-file changes and owners closed during an awaited read', async t => {
  const f = await fixture(t), p = await f.preview(), before = await readFile(f.file);
  const changed = JSON.parse(before); changed.nodes[1].answer = 'External correction'; await writeFile(f.file, JSON.stringify(changed));
  await assert.rejects(f.request({ action: 'check', token: p.token }), /changed|saved|source/i); assert.match(await readFile(f.file, 'utf8'), /External correction/);
  await writeFile(f.file, before);
  const read = f.e.readCurrent.bind(f.e); f.e.readCurrent = async () => { const value = await read(); f.e.closed = true; return value; };
  await assert.rejects(f.preview(), /closed|changed|selection/i); f.e.closed = false;
});

test('change summary HTTP requires explicit origin, bounded schema and saved input; oversized summaries expose no preview', async t => {
  const f = await fixture(t);
  assert.equal((await f.post({ action: 'list' }, { Origin: 'http://wrong.invalid' })).status, 403);
  assert.equal((await f.post({ action: 'list', extra: 'forbidden' })).status, 400);
  assert.equal((await f.post({ action: 'list', extra: 'x'.repeat(10000) })).status, 400);
  const list = await f.post({ action: 'list' }); assert.equal(list.status, 200); assert.equal(list.value.current.revision, 2);
  const doc = structuredClone(f.e.doc);
  for (let i = 0; i < 115; i++) doc.nodes.push({ ...doc.nodes[1], id: `large-${i}`, question: `Large ${i}?`, answer: 'x'.repeat(20000) });
  await f.e.save(doc); const large = await f.post({ action: 'preview', selection: { kind: 'saved', before: 0, after: f.e.doc.revision } });
  assert.equal(large.status, 400); assert.match(large.value.error, /summary.*limit|summary.*MiB/i); assert.equal(f.e.changeSummaries.entry, null);
});

test('change summary uses the chosen local Git revision, not its common base, with no Git/index/file mutation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'summary-git-')), checkout = join(root, 'checkout'); await mkdir(checkout);
  await git(checkout, 'init', '-qb', 'main'); await git(checkout, 'config', 'user.name', 'Fixture'); await git(checkout, 'config', 'user.email', 'fixture@example.invalid');
  let cwd = checkout; const e = await new Explorer({ library: new Library(join(root, 'private')), binding: 'summary', projectRoot: async () => cwd, send() { throw Error('No model'); } }).load();
  t.after(async () => { await e.close(); await rm(root, { recursive: true, force: true }); });
  await e.attachProject(await e.projectRepository.create(document(), 'maps with spaces/日本語'));
  const path = e.projectStore.context.relativePath, file = e.projectStore.context.file;
  const commit = async message => { await git(checkout, 'add', '--', path); await git(checkout, 'commit', '-qm', message); return (await git(checkout, 'rev-parse', 'HEAD')).stdout.trim(); };
  const base = await commit('Base'); await git(checkout, 'switch', '-qc', 'comparison');
  const incoming = JSON.parse(await readFile(file)); incoming.journey.nodes[1].answer = 'Chosen Git version'; await writeFile(file, JSON.stringify(incoming)); const chosen = await commit('Chosen before'); await git(checkout, 'switch', '-q', 'main');
  await e.attachProject(await e.projectRepository.open(path)); const doc = structuredClone(e.doc); doc.nodes[1].answer = 'Current saved version'; await e.save(doc);
  const request = input => e.changeSummaryRequest({ action: 'preview', journey: e.activeKey, revision: e.doc.revision, ...input });
  const bytes = await readFile(file), index = await readFile(join(checkout, '.git/index'));
  let p = await request({ selection: { kind: 'git', ref: 'comparison' } });
  assert.equal(p.sources.before.commit, chosen); assert.equal(p.sources.after.kind, 'saved'); assert.match(p.markdown, /Chosen Git version/); assert.doesNotMatch(p.markdown, /Original answer/);
  assert.equal((await request({ action: 'check', token: p.token })).valid, true);
  assert.deepEqual(await readFile(file), bytes); assert.deepEqual(await readFile(join(checkout, '.git/index')), index); assert.equal((await git(checkout, 'rev-parse', 'HEAD')).stdout.trim(), base);
  await git(checkout, 'update-ref', 'refs/heads/comparison', base); await assert.rejects(request({ action: 'check', token: p.token }), /changed|preview/i);
  await writeFile(join(checkout, '.gitattributes'), '*.explore.json filter=do-not-run\n'); await assert.rejects(request({ selection: { kind: 'git', ref: 'main' } }), /filter|Git|available/i); await rm(join(checkout, '.gitattributes'));
  p = await request({ selection: { kind: 'git', ref: 'main' } }); cwd = root; await assert.rejects(request({ action: 'check', token: p.token }), /changed|project|checkout/i); cwd = checkout;
  await e.attachProject(await e.projectRepository.open(path)); await commit('Current branch'); await git(checkout, 'update-ref', 'refs/heads/comparison', chosen);
  await assert.rejects(git(checkout, 'merge', '--no-edit', 'comparison'));
  await writeFile(file, bytes); await e.attachProject(await e.projectRepository.open(path));
  await assert.rejects(request({ selection: { kind: 'git', ref: 'comparison' } }), /conflict|Git|available/i);
  assert.deepEqual(await readFile(file), bytes);
});
