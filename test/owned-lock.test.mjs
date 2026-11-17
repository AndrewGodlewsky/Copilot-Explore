import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access, open } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as locks from '../com.github.copilot/extensions/explorer/owned-lock.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return join(dir, 'data.lock');
}
async function childOwner(t, path) {
  const module = new URL('../com.github.copilot/extensions/explorer/owned-lock.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireLock } from ${JSON.stringify(module)}; await acquireLock(process.argv[1]); process.stdout.write('ready'); setInterval(()=>{},1000);`, path], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill()); await once(child.stdout, 'data'); return child;
}
test('owned locks retain live, legacy, malformed, foreign and inaccessible owners', async t => {
  const path = await fixture(t);
  const lock = await locks.acquireLock(path);
  const raw = await readFile(path, 'utf8');
  assert.equal(JSON.parse(raw).pid, process.pid);
  await assert.rejects(locks.acquireLock(path), /writer|owner/i);
  assert.equal(await readFile(path, 'utf8'), raw); await lock.release();
  for (const content of ['', '{', JSON.stringify({ version: 1, pid: process.pid, host: 'foreign', token: randomUUID(), createdAt: new Date().toISOString() })]) {
    await writeFile(path, content); await assert.rejects(locks.acquireLock(path), /unknown|writer|owner/i); assert.equal(await readFile(path, 'utf8'), content); await rm(path);
  }
  assert.equal(locks.ownerStatus({ version: 1, pid: process.pid, host: hostname(), token: randomUUID(), createdAt: new Date().toISOString(), retention: 'preserve' }, () => { throw Object.assign(Error(), { code: 'EPERM' }); }), 'unknown');
});
test('killed writer is quarantined once; two recoverers never remove a new writer', async t => {
  const path = await fixture(t), child = await childOwner(t, path), old = await readFile(path, 'utf8');
  await assert.rejects(locks.acquireLock(path), /writer|owner/i);
  child.kill(); await once(child, 'exit');
  const results = await Promise.allSettled([locks.acquireLock(path), locks.acquireLock(path)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.find(r => r.status === 'fulfilled').value, current = await readFile(path, 'utf8');
  assert.notEqual(current, old); assert.equal(await readFile(path + '.abandoned', 'utf8'), old);
  await assert.rejects(locks.acquireLock(path), /writer|owner/i);
  assert.equal(await readFile(path, 'utf8'), current); await winner.release();
  const fresh = await locks.acquireLock(path); await fresh.release();
  await assert.rejects(access(path), { code: 'ENOENT' });
});
test('abandoned recovery claim is preserved and never recursively reclaimed', async t => {
  const path = await fixture(t), child = await childOwner(t, path);
  child.kill(); await once(child, 'exit');
  await writeFile(path + '.recover', 'unknown claim'); const old = await readFile(path, 'utf8');
  await assert.rejects(locks.acquireLock(path), /recovery/i); assert.equal(await readFile(path, 'utf8'), old);
});
test('reclaimer paused after quarantine cannot unlink a newly acquiring writer or admit another recoverer', async t => {
  const path = await fixture(t), owner = await childOwner(t, path);
  owner.kill(); await once(owner, 'exit');
  const module = new URL('../com.github.copilot/extensions/explorer/owned-lock.mjs', import.meta.url).href;
  const script = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; import {once} from 'node:events';
    const rename = fs.rename; fs.rename = async (...args) => { await rename(...args); process.stdout.write('moved'); await once(process.stdin,'data'); };
    syncBuiltinESMExports(); const {acquireLock} = await import(${JSON.stringify(module)});
    try { const lock=await acquireLock(process.argv[1]); await lock.release(); process.exit(2); } catch { process.exit(0); }`;
  const reclaimer = spawn(process.execPath, ['--input-type=module', '-e', script, path], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => reclaimer.kill()); assert.equal(String((await once(reclaimer.stdout, 'data'))[0]), 'moved');
  const writer = await locks.acquireLock(path), current = await readFile(path, 'utf8');
  await assert.rejects(locks.acquireLock(path), /recovery/i);
  reclaimer.stdin.write('continue'); assert.equal((await once(reclaimer, 'exit'))[0], 0);
  assert.equal(await readFile(path, 'utf8'), current); await writer.release();
});
test('reused/live PID and failed probes never prove death; release refuses replacement nonce', async t => {
  const path = await fixture(t), lock = await locks.acquireLock(path);
  const owner = JSON.parse(await readFile(path, 'utf8'));
  owner.createdAt = '2000-01-01T00:00:00.000Z';
  assert.equal(locks.ownerStatus(owner), 'active');
  for (const code of ['EPERM', 'EACCES', 'EINVAL']) assert.equal(locks.ownerStatus(owner, () => { throw Object.assign(Error(), { code }); }), 'unknown');
  owner.token = randomUUID(); await writeFile(path, JSON.stringify(owner));
  await assert.rejects(lock.release(), /ownership changed/i);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).token, owner.token);
});
test('metadata-write failure removes only its own exclusive attempt and permits the next writer', async t => {
  const path = await fixture(t), handle = await open(path + '.probe', 'wx'), prototype = Object.getPrototypeOf(handle), write = prototype.writeFile;
  await handle.close();
  prototype.writeFile = async () => { throw Object.assign(Error('injected metadata failure'), { code: 'EIO' }); };
  try { await assert.rejects(locks.acquireLock(path), /storage is unavailable/); }
  finally { prototype.writeFile = write; }
  await assert.rejects(access(path), { code: 'ENOENT' });
  const next = await locks.acquireLock(path); await next.release();
});
