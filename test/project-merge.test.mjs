import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { ProjectMerge } from '../com.github.copilot/extensions/explorer/project-merge.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
const exec = promisify(execFile), git = (cwd, ...args) => exec('git', ['-C', cwd, ...args], { windowsHide: true });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-merge-')); t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout'); await mkdir(checkout); await git(checkout, 'init', '-qb', 'main');
  await git(checkout, 'config', 'user.name', 'Fixture'); await git(checkout, 'config', 'user.email', 'fixture@example.invalid');
  const repository = new ProjectRepository({ readRoot: async () => checkout, localDirectory: join(root, 'private') });
  const doc = createDocument('Shared merge'), [a, b] = addQuestions(doc, doc.rootId, [{ question: 'Storage?', category: 'Scope' }, { question: 'Delivery?', category: 'Scope' }]);
  const initial = await repository.create(doc, 'maps with spaces/日本語'), path = initial.context.relativePath, file = initial.context.file;
  const commit = async message => { await git(checkout, 'add', '--', path); await git(checkout, 'commit', '-qm', message); };
  await commit('Base'); const base = (await git(checkout, 'rev-parse', 'HEAD')).stdout.trim(); await git(checkout, 'switch', '-qc', 'incoming');
  const incoming = JSON.parse(await readFile(file)); incoming.journey.nodes.find(n => n.id === b.id).answer = 'Incoming answer'; await writeFile(file, JSON.stringify(incoming)); await commit('Incoming'); await git(checkout, 'switch', '-q', 'main');
  const store = await repository.open(path), local = structuredClone(store.document); local.nodes.find(n => n.id === a.id).answer = 'Local answer'; await store.save(local, { baseDigest: store.baseDigest });
  return { root, checkout, repository, store, path, file, base, a: a.id, b: b.id, merge: new ProjectMerge(repository, store), commit };
}

test('real Git common base merges independent saved edits through normal history without Git writes', async t => {
  const f = await fixture(t), index = await readFile(join(f.checkout, '.git', 'index')), before = await readFile(f.file);
  const preview = await f.merge.preview('incoming'); assert.equal(preview.baseCommit, f.base); assert.equal(preview.plan.unresolved.length, 0); assert.ok(preview.plan.token);
  assert.deepEqual(await readFile(f.file), before);
  await f.merge.accept(preview.id, preview.plan.token, true);
  assert.equal(f.store.document.nodes.find(n => n.id === f.a).answer, 'Local answer'); assert.equal(f.store.document.nodes.find(n => n.id === f.b).answer, 'Incoming answer');
  assert.deepEqual(await readFile(join(f.checkout, '.git', 'index')), index); assert.equal((await git(f.checkout, 'rev-parse', 'HEAD')).stdout.trim(), f.base);
  const manifest = JSON.parse(await f.store.history.read('manifest.json', 128 * 1024)); assert.equal(manifest.head.label, 'Merged shared exploration');
  assert.ok((await f.store.versions()).entries.length);
});

test('stale refs or local bytes reject acceptance without overwriting the newer source', async t => {
  const f = await fixture(t), preview = await f.merge.preview('incoming'); await git(f.checkout, 'update-ref', 'refs/heads/incoming', f.base);
  const before = await readFile(f.file); await assert.rejects(f.merge.accept(preview.id, preview.plan.token, true), /changed|preview/i); assert.deepEqual(await readFile(f.file), before);
  const next = await f.merge.preview('incoming'); await writeFile(f.file, before.toString() + '\n');
  await assert.rejects(f.merge.accept(next.id, next.plan.token, true), /changed|preview/i); assert.equal(await readFile(f.file, 'utf8'), before.toString() + '\n');
});

test('unrelated histories offer comparison only and never invent a base', async t => {
  const f = await fixture(t), tree = (await git(f.checkout, 'rev-parse', 'incoming^{tree}')).stdout.trim();
  const orphan = (await git(f.checkout, 'commit-tree', tree, '-m', 'Unrelated')).stdout.trim(); await git(f.checkout, 'update-ref', 'refs/heads/unrelated', orphan);
  const before = await readFile(f.file), preview = await f.merge.preview('unrelated'); assert.equal(preview.baseCommit, null); assert.equal(preview.plan, null); assert.match(preview.message, /base/);
  assert.ok(preview.sources.local && preview.sources.incoming); await assert.rejects(f.merge.accept(preview.id, 'invented', true), /preview|resolution/i); assert.deepEqual(await readFile(f.file), before);
});

test('unresolved choices, obsolete resolution tokens and unacknowledged consequences cannot save', async t => {
  const f = await fixture(t); const local = structuredClone(f.store.document); local.nodes.find(n => n.id === f.b).answer = 'Competing local'; await f.store.save(local, { baseDigest: f.store.baseDigest });
  const preview = await f.merge.preview('incoming'); assert.equal(preview.plan.token, null);
  await assert.rejects(f.merge.accept(preview.id, null, true), /resolved|resolution/);
  const first = f.merge.resolve(preview.id, { [`node:${f.b}`]: 'incoming' }); const second = f.merge.resolve(preview.id, { [`node:${f.b}`]: 'local' });
  await assert.rejects(f.merge.accept(preview.id, first.token, true), /resolved|resolution/); await assert.rejects(f.merge.accept(preview.id, second.token, false), /acknowledge/i);
  await f.merge.accept(preview.id, second.token, true); assert.equal(f.store.document.nodes.find(n => n.id === f.b).answer, 'Competing local');
});

test('a ref change at the final async write check aborts before atomic replacement and recovery remains available', async t => {
  const f = await fixture(t), preview = await f.merge.preview('incoming'), before = await readFile(f.file), original = f.store.write;
  let written = false; f.store.write = async (...args) => { written = true; return original(...args); };
  const commit = f.store.history.commit.bind(f.store.history);
  f.store.history.commit = async (a, b, label, write) => commit(a, b, label, async () => { await git(f.checkout, 'update-ref', 'refs/heads/incoming', f.base); return write(); });
  await assert.rejects(f.merge.accept(preview.id, preview.plan.token, true), /changed|preview/i); assert.equal(written, false); assert.deepEqual(await readFile(f.file), before);
  assert.ok((await f.store.versions()).entries.length);
});

test('invalid selections and conflict-marker sources are rejected without mutation', async t => {
  const f = await fixture(t);
  for (const ref of ['--help', 'HEAD:secret', '', 'incoming\nother']) await assert.rejects(f.merge.preview(ref), /ref|branch/i);
  const source = '<<<<<<< ours\n{}\n=======\n{}\n>>>>>>> theirs'; await writeFile(f.file, source);
  await assert.rejects(f.merge.preview('incoming'), /JSON|changed|conflict/i); assert.equal(await readFile(f.file, 'utf8'), source);
});

test('cancellation during the final asynchronous source read invalidates acceptance before writing', async t => {
  const f = await fixture(t), originalRun = f.merge.run, before = await readFile(f.file); let reads = 0;
  f.merge.run = async (...args) => { const result = await originalRun(...args); if (args[1].includes('merge-base') && ++reads === 3) f.merge.cancel(); return result; };
  const preview = await f.merge.preview('incoming');
  await assert.rejects(f.merge.accept(preview.id, preview.plan.token, true), /expired|changed|preview/i); assert.deepEqual(await readFile(f.file), before);
});

test('failed atomic writes keep the saved file recoverable and safe Git reads never invoke filters', async t => {
  const f = await fixture(t), originalRun = f.merge.run, commands = [];
  f.merge.run = async (...args) => { commands.push(args); return originalRun(...args); };
  const preview = await f.merge.preview('incoming'), before = await readFile(f.file);
  f.store.write = async () => { throw Error('Write unavailable'); };
  await assert.rejects(f.merge.accept(preview.id, preview.plan.token, true), /Write unavailable/); assert.deepEqual(await readFile(f.file), before);
  const reopened = await f.repository.open(f.path); assert.equal(reopened.document.nodes.find(n => n.id === f.a).answer, 'Local answer'); assert.ok((await reopened.versions()).entries.length);
  for (const [, args, options] of commands) {
    for (const flag of ['--no-optional-locks', '--no-lazy-fetch', '--no-replace-objects', '--literal-pathspecs']) assert.ok(args.includes(flag));
    assert.equal(options.timeout, 5000); assert.equal(options.windowsHide, true); assert.ok(options.maxBuffer <= 9 * 1024 * 1024);
    assert.deepEqual(Object.keys(options.env).filter(key => key.toUpperCase().startsWith('GIT_')), ['GIT_GRAFT_FILE']);
    assert.equal(options.env.GIT_GRAFT_FILE, devNull);
    assert.ok(!args.some(arg => ['--filters', '--textconv', 'merge', 'fetch', 'add', 'checkout', 'commit'].includes(arg)));
  }
});

for (const mode of ['changed', 'no-op']) test(`external file edits during final Git verification survive a ${mode} save`, async t => {
  const f = await fixture(t); if (mode === 'no-op') await git(f.checkout, 'update-ref', 'refs/heads/incoming', f.base);
  const originalRun = f.merge.run; let reads = 0, external;
  f.merge.run = async (...args) => {
    const result = await originalRun(...args);
    if (args[1].at(-1) === 'incoming^{commit}' && ++reads === 6) {
      const value = JSON.parse(await readFile(f.file)); value.journey.objective = 'EXTERNAL NEW CONTENT'; external = JSON.stringify(value); await writeFile(f.file, external);
    }
    return result;
  };
  const preview = await f.merge.preview('incoming');
  await assert.rejects(f.merge.accept(preview.id, preview.plan.token, true), /changed|preview/i);
  assert.ok(external); assert.equal(await readFile(f.file, 'utf8'), external);
});

test('legacy Git grafts cannot manufacture a trustworthy merge base for unrelated histories', async t => {
  const f = await fixture(t), tree = (await git(f.checkout, 'rev-parse', 'incoming^{tree}')).stdout.trim();
  const orphan = (await git(f.checkout, 'commit-tree', tree, '-m', 'Unrelated')).stdout.trim(); await git(f.checkout, 'update-ref', 'refs/heads/unrelated', orphan);
  await mkdir(join(f.checkout, '.git', 'info'), { recursive: true }); await writeFile(join(f.checkout, '.git', 'info', 'grafts'), `${orphan} ${f.base}\n`);
  const before = await readFile(f.file), preview = await f.merge.preview('unrelated');
  assert.equal(preview.baseCommit, null); assert.equal(preview.plan, null); assert.deepEqual(await readFile(f.file), before);
});
