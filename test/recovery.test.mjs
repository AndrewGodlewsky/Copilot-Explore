import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { createUsageRecorder } from '../com.github.copilot/extensions/explorer/research-usage.mjs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { recoveryHash } from '../com.github.copilot/extensions/explorer/recovery.mjs';
import { lockOwner } from '../com.github.copilot/extensions/explorer/owned-lock.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-recovery-')), library = new Library(dir), binding = 'recovery-test';
  const original = createDocument('Recovery'); addQuestions(original, original.rootId, [{ question: 'Why?', category: 'Scope' }]);
  const record = await library.import(original); await library.opened(record.key, binding);
  const e = await new Explorer({ library, binding }).load();
  await e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: 'Newer saved answer' });
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, library, binding, record, e };
}
test('cold damaged bound journey offers validated inspection and separate copy, preserving original and drafts', async t => {
  const f = await fixture(t), history = await f.e.history(f.record.key), root = await history.root();
  await writeFile(f.record.file, '{broken private text');
  await writeFile(join(root, 'intent.json'), '{bad pointer ../private');
  await writeFile(join(root, 'manifest.json'), '{bad manifest');
  await writeFile(join(root, 'partial.tmp'), 'partial original');
  const drafts = '{"version":1,"revision":2,"entries":[]}'; await writeFile(join(f.dir, 'drafts.json'), drafts);
  const fresh = await new Explorer({ library: new Library(f.dir), binding: f.binding }).load(); t.after(() => fresh.close());
  assert.equal(fresh.doc, null);
  const list = await fresh.recoveryRequest({ action: 'list' });
  assert.equal(list.journey, f.record.key); assert.equal(list.entries.length, 1);
  const request = { action: 'inspect', journey: list.journey, revision: list.revision, candidate: list.entries[0].hash };
  const inspected = await fresh.recoveryRequest(request); assert.equal(inspected.document.id, f.record.document.id); assert.equal(fresh.doc, null);
  await fresh.command('recover-copy', { ...request, action: 'recover-copy' });
  assert.notEqual(fresh.doc.id, f.record.document.id);
  assert.equal(await readFile(f.record.file, 'utf8'), '{broken private text');
  assert.equal(await readFile(join(f.dir, 'drafts.json'), 'utf8'), drafts);
  assert.equal(await readFile(join(root, 'intent.json'), 'utf8'), '{bad pointer ../private');
  assert.equal(await readFile(join(root, 'partial.tmp'), 'utf8'), 'partial original');
});
test('retry reconciles committed history without rolling back newer content, and rejects stale recovery copy', async t => {
  const f = await fixture(t), h = await f.e.history(f.record.key); let writes = 0;
  h.write = async (path, data) => { if (path.endsWith('manifest.json') && ++writes === 2) throw Error('private disk failure'); await atomicWrite(path, data); };
  await assert.rejects(f.e.command('answer', { revision: f.e.doc.revision, nodeId: f.e.doc.nodes[1].id, answer: 'Committed latest' }), /Map saved/);
  assert.equal(f.e.doc.nodes[1].answer, 'Committed latest');
  h.write = atomicWrite;
  const before = await f.e.recoveryRequest({ action: 'list' });
  await f.e.command('recovery-retry', { journey: before.journey, revision: before.revision });
  assert.equal(f.e.doc.nodes[1].answer, 'Committed latest');
  await f.e.command('guidance', { revision: f.e.doc.revision, objective: 'new', successCriteria: '' });
  await assert.rejects(f.e.command('recover-copy', { journey: before.journey, revision: before.revision, candidate: before.entries[0].hash }), /changed|stale/i);
});
test('protected recovery API rejects origin, traversal and corrupt snapshots without changing current journey', async t => {
  const f = await fixture(t), server = await startServer(f.e, { close() {}, status: async () => ({}) }); t.after(() => server.close());
  const call = (input, origin = new URL(server.url).origin) => fetch(server.url + 'api/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin }, body: JSON.stringify(input) });
  assert.equal((await call({ action: 'list' }, 'http://evil.test')).status, 403);
  const list = await (await call({ action: 'list' })).json(); assert.equal(list.entries.length, 1);
  const original = JSON.stringify(f.e.doc);
  assert.equal((await call({ action: 'inspect', journey: list.journey, revision: list.revision, candidate: '../private' })).status, 400);
  const root = await (await f.e.history(f.record.key)).root(); await writeFile(join(root, list.entries[0].hash + '.json'), '{malformed');
  const result = await (await call({ action: 'list' })).json(); assert.equal(result.entries.length, 0); assert.ok(result.unavailable > 0);
  assert.equal(JSON.stringify(f.e.doc), original);
});
test('recorded helper interruption is distinguished from active and unknown; dismissal retains usage and never follows pointers', async t => {
  const f = await fixture(t), root = join(f.dir, 'usage'), activeId = randomUUID(), deadId = randomUUID();
  const active = await createUsageRecorder(activeId, root);
  const module = new URL('../com.github.copilot/extensions/explorer/research-usage.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {createUsageRecorder} from ${JSON.stringify(module)}; await createUsageRecorder(process.argv[1], process.argv[2]); process.stdout.write('ready'); setInterval(()=>{},1000);`, deadId, root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill()); await once(child.stdout, 'data'); child.kill(); await once(child, 'exit');
  await writeFile(join(root, `recovery-${randomUUID()}.json`), JSON.stringify({ directory: '../private', sessionId: '../escape' }));
  let view = await f.e.recoveryRequest({ action: 'list' });
  assert.equal(view.operations.find(o => o.id === activeId).status, 'active');
  assert.equal(view.operations.find(o => o.id === deadId).status, 'interrupted');
  assert.ok(view.operations.some(o => o.status === 'unknown'));
  await assert.rejects(f.e.recoveryRequest({ action: 'dismiss', operation: activeId }), /active|unknown/i);
  const journal = await readFile(join(root, 'session-state', deadId, 'events.jsonl'), 'utf8');
  await f.e.recoveryRequest({ action: 'dismiss', operation: deadId });
  view = await f.e.recoveryRequest({ action: 'list' }); assert.ok(!view.operations.some(o => o.id === deadId));
  assert.equal(await readFile(join(root, 'session-state', deadId, 'events.jsonl'), 'utf8'), journal);
  await active.finish('failed'); view = await f.e.recoveryRequest({ action: 'list' }); assert.equal(view.operations.find(o => o.id === activeId).status, 'failed');
});
test('export failures are observed and explicitly retryable without claiming a durable download', async t => {
  const f = await fixture(t), server = await startServer(f.e, { close() {}, status: async () => ({}) }); t.after(() => server.close());
  const original = await readFile(f.record.file, 'utf8'); await writeFile(f.record.file, '{private broken');
  const failed = await fetch(server.url + 'export.json'); assert.equal(failed.status, 400);
  assert.doesNotMatch(await failed.text(), /private broken/);
  let view = await f.e.recoveryRequest({ action: 'list' }); assert.equal(view.export.status, 'failed');
  await writeFile(f.record.file, original); const retried = await fetch(server.url + 'export.json'); assert.equal(retried.status, 200); await retried.text();
  view = await f.e.recoveryRequest({ action: 'list' }); assert.equal(view.export.status, 'response-finished');
  assert.equal(view.export.downloadSaved, 'unknown');
});
test('killed save before and after atomic document replacement recovers only the actual committed side', async t => {
  for (const stage of ['before', 'after']) {
    const f = await fixture(t), module = new URL('../com.github.copilot/extensions/explorer/controller.mjs', import.meta.url).href;
    const libraryModule = new URL('../com.github.copilot/extensions/explorer/library.mjs', import.meta.url).href;
    const script = `import {Explorer,atomicWrite} from ${JSON.stringify(module)}; import {Library} from ${JSON.stringify(libraryModule)};
      const e=await new Explorer({library:new Library(process.argv[1]),binding:'recovery-test'}).load();
      const h=await e.history(e.activeKey); let manifests=0;
      h.write=async(path,data)=>{ if(path.endsWith('manifest.json')) manifests++;
        if(process.argv[2]==='before' && path.endsWith('intent.json')) { await atomicWrite(path,data); process.stdout.write('paused'); await new Promise(()=>{}); }
        if(process.argv[2]==='after' && path.endsWith('manifest.json') && manifests===2) { process.stdout.write('paused'); await new Promise(()=>{}); }
        await atomicWrite(path,data); };
      setInterval(()=>{},1000); await e.command('answer',{revision:e.doc.revision,nodeId:e.doc.nodes[1].id,answer:'Child committed answer'});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.dir, stage], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill()); assert.equal(String((await once(child.stdout, 'data'))[0]), 'paused'); child.kill(); await once(child, 'exit');
    const fresh = await new Explorer({ library: new Library(f.dir), binding: f.binding }).load(); t.after(() => fresh.close());
    const view = await fresh.recoveryRequest({ action: 'list' });
    await fresh.command('recovery-retry', { journey: view.journey, revision: view.revision });
    assert.equal(fresh.doc.nodes[1].answer, stage === 'before' ? 'Newer saved answer' : 'Child committed answer');
    assert.equal(JSON.parse(await readFile(f.record.file, 'utf8')).nodes[1].answer, fresh.doc.nodes[1].answer);
    assert.ok(await readFile(f.record.file + '.lock.abandoned', 'utf8'));
  }
});
test('recovery preserves draft tombstones and rejects linked, oversized, wrong-identity snapshots and unavailable storage', async t => {
  const f = await fixture(t), node = f.e.doc.nodes[1], journey = f.e.activeKey;
  const draft = await f.e.writeDraft({ journey, nodeId: node.id, base: node, text: 'Typed later', revision: 0 });
  await f.e.writeDraft({ journey, nodeId: node.id, base: node, text: null, revision: draft.revision });
  const before = await readFile(join(f.dir, 'drafts.json'), 'utf8');
  const h = await f.e.history(journey), root = await h.root(), list = await f.e.recoveryRequest({ action: 'list' });
  const file = join(root, list.entries[0].hash + '.json'), original = await readFile(file, 'utf8');
  await link(file, join(root, 'linked-evidence.tmp'));
  assert.equal((await f.e.recoveryRequest({ action: 'list' })).entries.length, 0);
  await rm(join(root, 'linked-evidence.tmp')); await writeFile(file, 'x'.repeat(10 * 1024 * 1024 + 1));
  assert.equal((await f.e.recoveryRequest({ action: 'list' })).entries.length, 0);
  await writeFile(file, original);
  const wrong = JSON.stringify(createDocument('Wrong identity')); await writeFile(join(root, recoveryHash(wrong) + '.json'), wrong);
  assert.equal((await f.e.recoveryRequest({ action: 'list' })).entries.length, 1);
  await writeFile(f.record.file + '.lock', 'legacy unknown lock');
  await assert.rejects(f.e.command('recovery-retry', { journey, revision: f.e.doc.revision }), /preserved/);
  assert.equal(await readFile(join(f.dir, 'drafts.json'), 'utf8'), before);
  await assert.rejects(f.e.writeDraft({ journey, nodeId: node.id, base: node, text: 'Late resurrected text', revision: draft.revision }), /changed this draft/);
  await rm(f.record.file + '.lock'); await mkdir(f.record.file + '.lock');
  await assert.rejects(f.e.command('recovery-retry', { journey, revision: f.e.doc.revision }), /preserved/);
  assert.equal(await readFile(join(f.dir, 'drafts.json'), 'utf8'), before);
});
test('live or reused PID alone cannot identify a still-active historical helper operation', async t => {
  const f = await fixture(t), id = randomUUID(), root = join(f.dir, 'usage', 'session-state', id); await mkdir(root, { recursive: true });
  await writeFile(join(root, 'operation.json'), JSON.stringify({ version: 1, id, operation: 'research', status: 'active', owner: lockOwner(), updatedAt: new Date().toISOString(), retention: 'preserve' }));
  assert.equal((await f.e.recoveryRequest({ action: 'list' })).operations.find(row => row.id === id).status, 'unknown');
});

test('protected ordinary save hides quarantine permission errors and retains document and stale ownership', async t => {
  const f = await fixture(t), path = f.record.file + '.lock', before = await readFile(f.record.file, 'utf8');
  const module = new URL('../com.github.copilot/extensions/explorer/owned-lock.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {acquireLock} from ${JSON.stringify(module)}; await acquireLock(process.argv[1]); process.stdout.write('ready'); setInterval(()=>{},1000);`, path], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill()); await once(child.stdout, 'data'); child.kill(); await once(child, 'exit');
  const owner = await readFile(path, 'utf8'), server = await startServer(f.e, { close() {}, status: async () => ({}) }); t.after(() => server.close());
  const rename = fs.rename; let injected = false;
  fs.rename = async (...args) => {
    if (args[0] === path) { injected = true; throw Object.assign(Error(`PRIVATE_OS_FAILURE ${path} -> ${path}.abandoned`), { code: 'EACCES' }); }
    return rename(...args);
  };
  syncBuiltinESMExports();
  let response, result;
  try {
    response = await fetch(server.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin }, body: JSON.stringify({ action: 'answer', revision: f.e.doc.revision, nodeId: f.e.doc.nodes[1].id, answer: 'Never committed' }) });
    result = await response.json();
  } finally { fs.rename = rename; syncBuiltinESMExports(); }
  assert.equal(injected, true); assert.equal(response.status, 400);
  assert.equal(await readFile(path, 'utf8'), owner); assert.equal(await readFile(f.record.file, 'utf8'), before);
  assert.equal(result.error.includes(f.dir), false); assert.equal(result.error.includes('PRIVATE_OS_FAILURE'), false);
  assert.match(result.error, /lock storage is unavailable/i);
});
test('unavailable helper evidence does not disable independent saved-version recovery', async t => {
  const f = await fixture(t); await writeFile(join(f.dir, 'usage'), 'unavailable directory');
  const value = await f.e.recoveryRequest({ action: 'list' });
  assert.equal(value.operationsUnavailable, true); assert.equal(value.entries.length, 1);
});
test('cold direct-file read retry uses the newly validated identity once storage is readable', async t => {
  const f = await fixture(t), file = join(f.dir, 'direct.explore.json'); await writeFile(file, '{broken');
  const direct = await new Explorer({ file }).load(); t.after(() => direct.close());
  const before = await direct.recoveryRequest({ action: 'list' }); assert.equal(before.journey, null);
  const doc = createDocument('Readable again'); await writeFile(file, JSON.stringify(doc));
  await direct.command('recovery-retry', { journey: before.journey, revision: before.revision });
  assert.equal(direct.doc.id, doc.id); assert.match(direct.error, /read successfully/);
});
test('HTTP response interruption is observed without inference replay and recovery selection rejects a new journey', async t => {
  const f = await fixture(t), server = await startServer(f.e, { close() {}, status: async () => ({}) }); t.after(() => server.close());
  const before = await f.e.recoveryRequest({ action: 'list' }), read = f.e.readCurrent.bind(f.e); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  f.e.readCurrent = async () => { entered(); await gate; return read(); };
  const abort = new AbortController(), download = fetch(server.url + 'export.json', { signal: abort.signal });
  await started; abort.abort(); await assert.rejects(download, /abort/i);
  for (let i = 0; i < 100 && f.e.exportObservation.status !== 'interrupted'; i++) await delay(5);
  assert.equal(f.e.exportObservation.status, 'interrupted'); release(); await delay(10); f.e.readCurrent = read;
  const next = await f.library.import(createDocument('Other journey'));
  await f.e.command('open', { revision: f.e.doc.revision, key: next.key });
  const response = await fetch(server.url + 'api/recovery', { method: 'POST', headers: { 'X-Explorer-Client': '1', Origin: new URL(server.url).origin }, body: JSON.stringify({ action: 'inspect', journey: before.journey, revision: before.revision, candidate: before.entries[0].hash }) });
  assert.equal(response.status, 400); assert.equal(f.e.activeKey, next.key);
});
