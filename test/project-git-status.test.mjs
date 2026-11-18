import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { ProjectGitStatus, parseGitStatus } from '../com.github.copilot/extensions/explorer/project-git-status.mjs';
import { createDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
const exec = promisify(execFile);
const git = (cwd, ...args) => exec('git', ['-C', cwd, ...args], { windowsHide: true });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-git-status-')); t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout'), local = join(root, 'private'); await mkdir(checkout); await git(checkout, 'init', '-qb', 'main');
  await git(checkout, 'config', 'user.name', 'Fixture'); await git(checkout, 'config', 'user.email', 'fixture@example.invalid');
  let cwd = checkout; const repository = new ProjectRepository({ readRoot: async () => cwd, localDirectory: local });
  const store = await repository.create(createDocument('Git state'), 'maps with spaces/[literal] 日本語');
  return { root, checkout, repository, store, path: store.context.relativePath, cwd: value => { cwd = value; },
    status: options => new ProjectGitStatus(repository, store, options).read(),
    commit: async () => { await git(checkout, 'add', '--', '.'); await git(checkout, 'commit', '-qm', 'Fixture'); } };
}
test('selected journey distinguishes untracked, staged, committed, unstaged and staged-plus-unstaged content', async t => {
  const f = await fixture(t); let status = await f.status();
  assert.equal(status.source, 'saved'); assert.equal(status.git.file, 'untracked'); assert.equal(status.git.unborn, true); assert.equal(status.git.upstream, null);
  await git(f.checkout, 'add', '--', f.path); status = await f.status(); assert.equal(status.git.index, 'A'); assert.equal(status.git.worktree, '.');
  await f.commit(); status = await f.status(); assert.equal(status.git.file, 'committed'); assert.equal(status.source, 'review');
  const value = JSON.parse(await readFile(f.store.context.file)); value.journey.topic = 'Changed'; await writeFile(f.store.context.file, JSON.stringify(value));
  status = await f.status(); assert.equal(status.git.index, '.'); assert.equal(status.git.worktree, 'M'); assert.equal(status.source, 'review');
  await git(f.checkout, 'add', '--', f.path); value.journey.topic = 'Changed again'; await writeFile(f.store.context.file, JSON.stringify(value));
  status = await f.status(); assert.equal(status.git.index, 'M'); assert.equal(status.git.worktree, 'M');
  await writeFile(join(f.checkout, 'unrelated.txt'), 'unrelated'); assert.deepEqual((await f.status()).git, status.git);
});
test('ignored and missing paths remain explicit, without changing repository or index bytes', async t => {
  const f = await fixture(t); await writeFile(join(f.checkout, '.gitignore'), 'maps with spaces/\n');
  let status = await f.status(); assert.equal(status.git.file, 'ignored');
  await git(f.checkout, 'add', '-f', '--', f.path); await git(f.checkout, 'commit', '-qm', 'Tracked');
  const index = await readFile(join(f.checkout, '.git', 'index')); await rm(f.store.context.file);
  status = await f.status(); assert.equal(status.source, 'missing'); assert.equal(status.git.worktree, 'D'); assert.deepEqual(await readFile(join(f.checkout, '.git', 'index')), index);
});
test('divergence is local tracking evidence, detached worktrees stay isolated and changed roots fail closed', async t => {
  const f = await fixture(t); await f.commit();
  await git(f.checkout, 'branch', 'upstream'); await git(f.checkout, 'branch', '--set-upstream-to=upstream');
  await writeFile(join(f.checkout, 'local.txt'), 'local'); await f.commit();
  await git(f.checkout, 'switch', '-q', 'upstream'); await writeFile(join(f.checkout, 'upstream.txt'), 'incoming'); await f.commit(); await git(f.checkout, 'switch', '-q', 'main');
  const status = await f.status(); assert.equal(status.git.ahead, 1); assert.equal(status.git.behind, 1); assert.equal(status.git.remoteFreshness, 'unknown');
  const other = join(f.root, 'other'); await git(f.checkout, 'worktree', 'add', '--detach', other); f.cwd(other);
  assert.equal((await f.status()).git.state, 'unavailable');
  const store = await f.repository.open(f.path), detached = await new ProjectGitStatus(f.repository, store).read();
  assert.equal(detached.git.detached, true); assert.equal(detached.git.upstream, null); assert.equal(detached.source, 'saved');
});
test('status uses literal bounded read-only Git arguments and rejects changed source or command failures', async t => {
  const f = await fixture(t); let invocation;
  const result = await f.status({ run: async (...args) => { invocation = args; return exec(...args); } }); assert.equal(result.git.state, 'available');
  assert.equal(invocation[0], 'git'); assert.ok(invocation[1].includes('--literal-pathspecs')); assert.equal(invocation[1].at(-1), f.path);
  assert.ok(invocation[1].includes('--no-optional-locks')); assert.equal(invocation[2].timeout, 5000); assert.equal(invocation[2].maxBuffer, 65536); assert.equal(invocation[2].windowsHide, true);
  assert.ok(invocation[1].includes('--no-lazy-fetch')); assert.ok(invocation[1].includes('--ignore-submodules=all'));
  assert.equal(Object.keys(invocation[2].env).some(key => key.toUpperCase().startsWith('GIT_')), false);
  assert.equal((await f.status({ run: async () => { throw Error('private command details'); } })).git.state, 'unavailable');
  const raced = await f.status({ run: async (...args) => { const output = await exec(...args); await writeFile(f.store.context.file, '{}'); return output; } }); assert.equal(raced.git.state, 'unavailable');
  assert.ok(!JSON.stringify(raced).includes(f.checkout));
});
test('porcelain parser treats conflicts and rename records explicitly and rejects unknown evidence', () => {
  const header = '# branch.oid ' + 'a'.repeat(40) + '\0# branch.head main\0';
  const conflict = header + 'u UU N... 100644 100644 100644 100644 a b c map.explore.json\0';
  assert.equal(parseGitStatus(conflict, 'map.explore.json', true).file, 'conflicted');
  const rename = header + '2 R. N... 100644 100644 100644 a b R100 new name.explore.json\0old name.explore.json\0';
  assert.equal(parseGitStatus(rename, 'old name.explore.json', false).index, 'R');
  assert.throws(() => parseGitStatus(header + 'unexpected\0', 'map.explore.json', true));
  assert.throws(() => parseGitStatus(header + '? unrelated\0', 'map.explore.json', true));
});

test('a nested Git repository and ignored index flags cannot masquerade as committed project files', async t => {
  const f = await fixture(t), nested = join(f.checkout, 'nested'); await mkdir(nested); await git(nested, 'init', '-qb', 'main');
  await writeFile(join(nested, 'seed.txt'), 'seed'); await git(nested, 'add', '.');
  await git(nested, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Inner'); await f.commit();
  const inner = await f.repository.create(createDocument('Nested'), 'nested/maps');
  const innerStatus = await new ProjectGitStatus(f.repository, inner).read(); assert.equal(innerStatus.git.state, 'unavailable');
  await git(f.checkout, 'update-index', '--assume-unchanged', '--', f.path);
  const changed = JSON.parse(await readFile(f.store.context.file)); changed.journey.topic = 'Hidden from Git status'; await writeFile(f.store.context.file, JSON.stringify(changed));
  assert.equal((await f.status()).git.state, 'unavailable');
});

test('refresh never executes repository clean or process filters', async t => {
  const f = await fixture(t), marker = join(f.root, 'filter-ran'), script = join(f.root, 'filter.cjs');
  await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.pipe(process.stdout);`);
  await writeFile(join(f.checkout, '.gitattributes'), '*.explore.json filter=fixture\n');
  await git(f.checkout, 'config', 'filter.fixture.clean', `node "${script.replaceAll('\\', '/')}"`); await f.commit(); await rm(marker);
  const content = await readFile(f.store.context.file, 'utf8'); await writeFile(f.store.context.file, content.replace('Git state', 'Git STATE'));
  const status = await f.status();
  await assert.rejects(readFile(marker), { code: 'ENOENT' }); assert.equal(status.git.state, 'unavailable');
});
