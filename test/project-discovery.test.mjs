import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, link } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectContext } from '../com.github.copilot/extensions/explorer/project-context.mjs';
import { ProjectDiscovery, DISCOVERY_LIMITS, validateProjectExclusions } from '../com.github.copilot/extensions/explorer/project-discovery.mjs';
import { branchFileContext } from '../com.github.copilot/extensions/explorer/project-branch-files.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';

const exec = promisify(execFile);

test('targeted discovery finds distinct source files with no content reads and retains the existing exclusion policy', async t => {
  const f = await fixture(t, { 'docs/constraints.md': 'shared', 'src/billing.ts': 'billing', 'src/reminders.ts': 'reminders', 'src/billing-secret.ts': 'secret', 'src/billing-large.ts': 'x'.repeat(65537), 'src/billing-ignored.ts': 'ignored', '.gitignore': 'src/billing-ignored.ts\n', 'dist/billing.ts': 'generated' });
  const doc = createDocument('Plan product'); addQuestions(doc, doc.rootId, [{ question: 'Plan billing', category: 'Billing' }, { question: 'Plan reminders', category: 'Reminders' }]);
  const brief = { sections: { purpose: [], architecture: [], stack: [], conventions: [], constraints: [{ text: 'Keep data local', kind: 'file-backed', sources: [{ id: 'shared' }] }] }, sources: [{ id: 'shared', name: 'docs/constraints.md' }] };
  const billing = await f.discovery.discover([], { target: branchFileContext(doc, doc.nodes[1].id, '', brief, 2) });
  const reminders = await f.discovery.discover([], { target: branchFileContext(doc, doc.nodes[2].id, '', brief, 2) });
  assert.deepEqual(billing.candidates.map(file => file.name), ['src/billing.ts', 'docs/constraints.md']);
  assert.deepEqual(reminders.candidates.map(file => file.name), ['src/reminders.ts', 'docs/constraints.md']);
  assert.deepEqual(billing.target.suggested, ['src/billing.ts', 'docs/constraints.md']);
  assert.ok(billing.skipped.some(file => /billing-secret/.test(file.name))); assert.ok(billing.skipped.some(file => /billing-ignored/.test(file.name))); assert.ok(billing.skipped.some(file => /billing-large/.test(file.name)));
  assert.deepEqual((await f.discovery.discover(['src/'], { target: branchFileContext(doc, doc.nodes[1].id, '', brief, 2) })).candidates.map(file => file.name), ['docs/constraints.md']);
});
async function fixture(t, files = {}, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-discovery-')), root = join(directory, 'project');
  await mkdir(root); const globalConfig = join(directory, 'empty-git-config'); await writeFile(globalConfig, '');
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('explorer-discovery-'));
    await rm(directory, { recursive: true, force: true });
  });
  const run = (command, args, settings = {}) => exec(command, args, { ...settings, windowsHide: true,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig } });
  await run('git', ['init', '--quiet', root]);
  for (const [name, contents] of Object.entries(files)) { await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), contents); }
  let currentRoot = root;
  const reader = new ProjectContext(() => currentRoot);
  reader.read = async () => { throw Error('Discovery must never read source contents'); };
  return { root, directory, reader, discovery: new ProjectDiscovery(reader, { run, ...options }), run, changeRoot: value => { currentRoot = value; } };
}

test('discovery shows bounded docs, manifests and source entry points without reading contents', async t => {
  const f = await fixture(t, { 'README.md': 'purpose', 'package.json': '{}', 'docs/design.md': 'design', 'src/index.ts': 'entry', 'src/detail.ts': 'detail', '.env': 'CONTENT_NEVER_READ_SECRET', 'assets/image.png': Buffer.from([0, 1]), 'dist/main.js': 'generated' });
  const inventory = await f.discovery.discover([]);
  assert.deepEqual(inventory.candidates.map(file => file.name).sort(), ['README.md', 'docs/design.md', 'package.json', 'src/index.ts'].sort());
  assert.ok(inventory.candidates.every(file => Number.isSafeInteger(file.bytes) && file.reason));
  assert.ok(inventory.skipped.some(file => file.name === '.env' && /excluded/i.test(file.reason)));
  assert.ok(inventory.skipped.some(file => file.name === 'dist' && /generated|vendor/i.test(file.reason)));
  assert.ok(!JSON.stringify(inventory).includes('CONTENT_NEVER_READ_SECRET')); assert.equal(inventory.truncated, false);
});

test('monorepo entry points and empty repositories produce honest inventories', async t => {
  const mono = await fixture(t, { 'apps/web/package.json': '{}', 'apps/web/src/index.ts': 'web', 'packages/lib/README.md': 'library' });
  assert.deepEqual((await mono.discovery.discover([])).candidates.map(file => file.name).sort(), ['apps/web/package.json', 'apps/web/src/index.ts', 'packages/lib/README.md'].sort());
  const empty = await fixture(t); assert.deepEqual((await empty.discovery.discover([])).candidates, []);
});

test('Git ignores, nested negation and explicit exclusions also reject manual additions', async t => {
  const f = await fixture(t, { '.gitignore': 'ignored.md\n', 'ignored.md': 'synthetic', 'README.md': 'visible', 'docs/.gitignore': '*\n!keep.md\n', 'docs/keep.md': 'keep', 'docs/hidden.md': 'hidden', 'notes/architecture.md': 'excluded' });
  await f.run('git', ['-C', f.root, 'add', '-f', '--', 'ignored.md']);
  const inventory = await f.discovery.discover(['notes/']);
  assert.deepEqual(inventory.candidates.map(file => file.name).sort(), ['README.md', 'docs/keep.md']);
  const root = await f.reader.root();
  for (const name of ['ignored.md', 'docs/hidden.md', 'notes/architecture.md', '.env', 'dist/main.js']) {
    await assert.rejects(f.discovery.assertAllowed(root, [name], ['notes/']));
  }
  await f.discovery.assertAllowed(root, ['docs/keep.md'], []);
  assert.throws(() => validateProjectExclusions(['../'])); assert.throws(() => validateProjectExclusions(Array(11).fill('docs/')));
  assert.deepEqual(validateProjectExclusions(['docs/private/', '.env', 'assets/image.png']), ['docs/private/', '.env', 'assets/image.png']);
  for (const value of ['/docs/', 'docs//', 'docs/../', 'docs/*', 'C:/docs/', 'docs\\other/']) assert.throws(() => validateProjectExclusions([value]));
});

test('large and deep trees stop at server bounds and never traverse generated or linked content', async t => {
  const f = await fixture(t, { 'README.md': 'root', 'docs/a/b/c/design.md': 'too deep', 'dist/README.md': 'generated' }, { now: () => 0 });
  for (let index = 0; index < 330; index++) await writeFile(join(f.root, `README-${index}.md`), 'small');
  await mkdir(join(f.directory, 'outside')); await writeFile(join(f.directory, 'outside', 'README.md'), 'outside');
  await symlink(join(f.directory, 'outside'), join(f.root, 'alias'), 'junction');
  const inventory = await f.discovery.discover([]);
  assert.ok(inventory.examined <= DISCOVERY_LIMITS.entries); assert.ok(inventory.candidates.length <= DISCOVERY_LIMITS.candidates);
  assert.equal(inventory.truncated, true); assert.ok(!inventory.candidates.some(file => /^(alias|dist)\//.test(file.name)));
});

test('hardlinks and changing or unavailable policy/root identities never become readable candidates', async t => {
  const f = await fixture(t, { 'README.md': 'root' }); await link(join(f.root, 'README.md'), join(f.root, 'design.md'));
  assert.equal((await f.discovery.discover([])).candidates.length, 0);
  const root = await f.reader.root(); f.changeRoot(join(f.directory, 'missing'));
  await assert.rejects(f.discovery.assertAllowed(root, ['README.md'], []));
  const unavailable = await fixture(t, {}, { run: async () => { throw Object.assign(Error('private stderr must not escape'), { code: 128, stderr: 'PRIVATE_CONFIG' }); } });
  await assert.rejects(unavailable.discovery.discover([]), error => !/PRIVATE|private/.test(error.message) && /ignore|policy/i.test(error.message));
});

test('discovery cancellation and time limits prevent subsequent operations', async t => {
  const f = await fixture(t, { 'README.md': 'root' }); const abort = new AbortController(); abort.abort();
  await assert.rejects(f.discovery.discover([], { signal: abort.signal }));
  let now = 0; const slow = new ProjectDiscovery(f.reader, { run: f.run, now: () => { now += 6000; return now; } });
  await assert.rejects(slow.discover([]), /time budget/i);
});

test('depth, directory and alias bounds hold independently of the entry limit', async t => {
  const f = await fixture(t, { 'docs/a/b/c/design.md': 'too deep', 'docs/design.md': 'visible' }, { now: () => 0 });
  await mkdir(join(f.directory, 'outside')); await writeFile(join(f.directory, 'outside', 'README.md'), 'outside');
  await symlink(join(f.directory, 'outside'), join(f.root, 'alias'), 'junction');
  let inventory = await f.discovery.discover([]);
  assert.deepEqual(inventory.candidates.map(file => file.name), ['docs/design.md']);
  assert.ok(inventory.skipped.some(file => file.name === 'alias' && /linked/i.test(file.reason)));
  assert.ok(inventory.skipped.some(file => /depth/i.test(file.reason))); assert.equal(inventory.truncated, true);
  for (let index = 0; index < 45; index++) { const name = join(f.root, `folder-${index}`); await mkdir(name); await writeFile(join(name, 'README.md'), 'small'); }
  inventory = await f.discovery.discover([]); assert.equal(inventory.directories, 40); assert.ok(inventory.examined < 300); assert.equal(inventory.truncated, true);
});

test('Git policy preserves spaces and Unicode and discovery rejects changes during inspection', async t => {
  const f = await fixture(t, { 'docs/ plan 🌿.md': 'visible', 'docs/ignored 🌿.md': 'hidden', '.gitignore': 'docs/ignored 🌿.md\n' });
  assert.deepEqual((await f.discovery.discover([])).candidates.map(file => file.name), ['docs/ plan 🌿.md']);
  const root = await f.reader.root(); await f.discovery.assertAllowed(root, ['docs/ plan 🌿.md'], []);
  await assert.rejects(f.discovery.assertAllowed(root, ['docs/ignored 🌿.md'], []), /ignored/i);
  const entry = f.reader.entry.bind(f.reader); f.reader.entry = async (...args) => { const value = await entry(...args); f.changeRoot(f.directory); return value; };
  await assert.rejects(f.discovery.discover([]), /changed/i);
});

test('disappearing directories are reported and cancellation after policy prevents subsequent metadata reads', async t => {
  const f = await fixture(t, { 'docs/README.md': 'disappears', 'README.md': 'root' }); let removed = false;
  const discovery = new ProjectDiscovery(f.reader, { run: async (...args) => {
    let result; try { result = await f.run(...args); } finally {
      if (!removed && args[1].includes('docs')) { removed = true; const target = resolve(f.root, 'docs'); assert.equal(dirname(target), resolve(f.root)); await rm(target, { recursive: true }); }
    } return result;
  } });
  const inventory = await discovery.discover([]); assert.ok(inventory.skipped.some(file => file.name === 'docs' && /unavailable/i.test(file.reason)));
  const abort = new AbortController(); let entries = 0; f.reader.entry = async () => { entries++; throw Error('Unexpected metadata read'); };
  const cancelled = new ProjectDiscovery(f.reader, { run: async (...args) => { try { return await f.run(...args); } finally { abort.abort(); } } });
  await assert.rejects(cancelled.discover([], { signal: abort.signal })); assert.equal(entries, 0);
});
