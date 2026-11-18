import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
const exec = promisify(execFile);
const git = (cwd, ...args) => exec('git', ['-C', cwd, ...args], { windowsHide: true });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-repository-')); t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout'), local = join(root, 'private'), sub = join(checkout, 'src'); await mkdir(sub, { recursive: true }); await git(checkout, 'init', '-q');
  let cwd = sub;
  const repository = new ProjectRepository({ readRoot: async () => cwd, localDirectory: local });
  const doc = createDocument('Repository choice'); addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Scope' }]);
  return { root, checkout, sub, local, repository, doc, readRoot: async () => cwd, cwd: value => { cwd = value; } };
}
test('repository saves and reopens shared content from a subdirectory; a second clone isolates private data', async t => {
  const f = await fixture(t), store = await f.repository.create(f.doc);
  assert.equal(store.context.relativePath, `.explorer/journeys/${f.doc.id}.explore.json`);
  assert.equal(store.context.checkoutDirectory, f.checkout);
  assert.deepEqual(await readdir(dirname(store.context.file)), [`${f.doc.id}.explore.json`]);
  const reopened = await f.repository.open(store.context.relativePath);
  const next = structuredClone(reopened.document); next.nodes[1].answer = 'Chosen';
  await reopened.save(next, { baseDigest: reopened.baseDigest });
  assert.equal(JSON.parse(await readFile(store.context.file)).journey.nodes[1].answer, 'Chosen');
  const clone = join(f.root, 'clone'); await mkdir(clone); await git(clone, 'init', '-q');
  const copied = join(clone, store.context.relativePath); await mkdir(dirname(copied), { recursive: true }); await writeFile(copied, await readFile(store.context.file));
  f.cwd(clone); const other = await f.repository.open(store.context.relativePath);
  assert.equal(other.document.nodes[1].answer, 'Chosen'); assert.notEqual(other.context.key, store.context.key);
  await assert.rejects(store.save(next, { baseDigest: store.baseDigest }), /project|checkout|changed/i);
});
test('invalid, linked, unavailable and replaced project roots or destinations are rejected without changing content', async t => {
  const f = await fixture(t);
  for (const folder of ['../outside', '/absolute', 'C:/absolute', '.git/journeys', '.EXPLORER/../escape', 'a\\b', 'CON', 'a.', 'a//b']) {
    await assert.rejects(f.repository.create(f.doc, folder), /relative|path|folder/i);
  }
  const outside = join(f.root, 'outside'); await mkdir(outside); await symlink(outside, join(f.checkout, 'linked'), 'junction');
  await assert.rejects(f.repository.create(f.doc, 'linked/maps'), /linked|identity|root/i); assert.deepEqual(await readdir(outside), []);
  const store = await f.repository.create(f.doc), before = await readFile(store.context.file);
  f.cwd(outside); await assert.rejects(f.repository.open(store.context.relativePath), /repository|project/i);
  f.cwd(undefined); await assert.rejects(store.save(store.document, { baseDigest: store.baseDigest }), /project|root|metadata/i);
  f.cwd(f.sub); const old = join(f.root, 'old'); await rename(f.checkout, old); await mkdir(f.sub, { recursive: true }); await git(f.checkout, 'init', '-q');
  await assert.rejects(store.save(store.document, { baseDigest: store.baseDigest }), /changed|identity|root/i);
  assert.deepEqual(await readFile(join(old, store.context.relativePath)), before);
});
test('Git worktrees are separate checkout authorities', async t => {
  const f = await fixture(t);
  await git(f.checkout, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'Fixture');
  const worktree = join(f.root, 'worktree'); await git(f.checkout, 'worktree', 'add', '--detach', worktree);
  f.cwd(worktree); const store = await f.repository.create(f.doc, 'decisions/maps');
  assert.equal(store.context.checkoutDirectory, worktree); assert.match(store.context.relativePath, /^decisions\/maps\//);
  assert.deepEqual((await readdir(f.checkout)).sort(), ['.git', 'src']);
});
test('project save captures its candidate before queued work and stale reopen preserves active scope', async t => {
  const f = await fixture(t), store = await f.repository.create(f.doc);
  let release; store.queue = new Promise(resolve => { release = resolve; });
  const next = structuredClone(store.document); next.nodes[1].answer = 'Captured answer';
  const saving = store.save(next, { baseDigest: store.baseDigest }); next.nodes[1].answer = 'Later mutation'; release(); await saving;
  assert.equal(JSON.parse(await readFile(store.context.file)).journey.nodes[1].answer, 'Captured answer');
  const explorer = await new Explorer({ library: new Library(f.local), binding: 'failed-open', projectRoot: f.readRoot }).load(); t.after(() => explorer.close());
  await explorer.command('open-project', { path: store.context.relativePath });
  const current = explorer.snapshot(); await assert.rejects(explorer.command('open-project', { revision: explorer.doc.revision, path: '../outside.explore.json' }));
  assert.deepEqual(explorer.snapshot(), current);
});
test('controller switches Personal/Project without moving drafts, and reopens and continues either scope', async t => {
  const f = await fixture(t), library = new Library(f.local);
  const personal = await library.import(f.doc);
  const explorer = await new Explorer({ library, binding: 'project-fixture', projectRoot: f.readRoot, send: async () => {} }).load(); t.after(() => explorer.close());
  await explorer.command('open', { key: personal.key });
  const node = explorer.doc.nodes[1];
  await explorer.writeDraft({ journey: explorer.activeKey, nodeId: node.id, base: node, text: 'Personal draft', revision: 0 });
  await explorer.command('start', { revision: explorer.doc.revision, topic: 'Shared', storageScope: 'project' }); await explorer.command('cancel');
  const location = explorer.snapshot().storage, key = explorer.activeKey, projectFile = explorer.file;
  assert.equal(location.scope, 'project'); assert.ok(!JSON.stringify(location).includes(f.checkout));
  assert.deepEqual((await explorer.readDrafts(key)).entries, []);
  await explorer.command('add', { revision: explorer.doc.revision, nodeId: explorer.doc.rootId, question: 'Project question', category: 'Scope' });
  const question = explorer.doc.nodes[1]; await explorer.writeDraft({ journey: key, nodeId: question.id, base: question, text: 'Project draft', revision: 0 });
  await explorer.command('answer', { revision: explorer.doc.revision, nodeId: question.id, answer: 'Shared answer', expand: false });
  const dashboard = await explorer.dashboardRequest({ action: 'refresh', from: '', to: '', scope: 'all' });
  assert.equal(dashboard.stock.journeys, 1); assert.equal(dashboard.stock.questions, 1); assert.equal(dashboard.stock.answered, 1);
  assert.equal(dashboard.stock.coverage, 'current-project-journey');
  await explorer.command('open', { revision: explorer.doc.revision, key: personal.key });
  assert.equal((await explorer.readDrafts(personal.key)).entries[0].text, 'Personal draft');
  await explorer.command('open-project', { revision: explorer.doc.revision, path: location.path });
  assert.equal(explorer.doc.nodes[1].answer, 'Shared answer'); assert.equal((await explorer.readDrafts(key)).entries[0].text, 'Project draft');
  await explorer.command('finish', { revision: explorer.doc.revision });
  assert.deepEqual(await readdir(dirname(projectFile)), [projectFile.split(/[\\/]/).at(-1)]);
  assert.equal(JSON.parse(await readFile(projectFile)).journey.finishedAt, explorer.doc.finishedAt);
  const before = await readFile(projectFile); f.cwd(f.root);
  await assert.rejects(explorer.command('answer', { revision: explorer.doc.revision, nodeId: question.id, answer: 'Wrong checkout' }), /project|repository|changed/i);
  assert.deepEqual(await readFile(projectFile), before);
});
