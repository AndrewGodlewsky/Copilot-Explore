import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, link, rename, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContributorSettings } from '../com.github.copilot/extensions/explorer/contributor-settings.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-contributors-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, 'contributor-settings.json'), store: new ContributorSettings({ directory }) };
}

test('contributor identity is explicit, private, revisioned and stable across renames only', async t => {
  const { directory, file, store } = await fixture(t);
  assert.deepEqual(await store.read(), { version: 1, revision: 0, actor: null });
  assert.deepEqual(await readdir(directory), []);
  const first = await store.save('Alice 👩‍💻', 0);
  assert.match(first.actor.id, /^[a-f0-9-]{36}$/);
  assert.equal(first.actor.displayName, 'Alice 👩‍💻');
  const renamed = await store.save('Alicia', 1);
  assert.equal(renamed.actor.id, first.actor.id);
  assert.equal(first.actor.displayName, 'Alice 👩‍💻');
  assert.deepEqual(await store.save('Alicia', 2), renamed);
  await assert.rejects(store.save('Bob', 1), /another canvas/);
  assert.equal((await store.save(null, 2)).actor, null);
  assert.deepEqual(await store.save(null, 3), { version: 1, revision: 3, actor: null });
  const next = await store.save('Alice', 3);
  assert.notEqual(next.actor.id, first.actor.id);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), next);
  for (const name of ['', ' Alice', 'Alice ', 'x'.repeat(97), 'A\nB', '\ud800', { displayName: 'forged' }]) await assert.rejects(store.save(name, 4), /contributor/);
  for (const revision of [-1, '4', NaN, Number.MAX_SAFE_INTEGER]) await assert.rejects(store.save('Alice', revision), /revision/);
});

test('contributor settings preserve invalid UTF-8, duplicate fields, extra identities and oversized files', async t => {
  const { file, store } = await fixture(t);
  const samples = ['{broken', ' '.repeat(4097), '{"version":1,"revision":0,"actor":null,"actor":null}', JSON.stringify({ version: 1, revision: 0, actor: null, email: 'private@example.test' }), Buffer.from([0xff, 0xfe])];
  for (const content of samples) {
    await writeFile(file, content);
    const bytes = await readFile(file);
    await assert.rejects(store.read(), /preserved/);
    await assert.rejects(store.save('Alice', 0), /preserved/);
    assert.deepEqual(await readFile(file), bytes);
  }
});

test('contributor settings refuse linked files and replaced private roots', async t => {
  const { directory, file, store } = await fixture(t);
  const original = await store.save('Alice', 0), target = join(directory, 'original.json');
  await rename(file, target); await link(target, file);
  await assert.rejects(store.read(), /preserved/);
  await assert.rejects(store.save('Bob', 1), /preserved/);
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), original);
  await rm(file);
  const moved = directory + '-moved'; t.after(() => rm(moved, { recursive: true, force: true }));
  await rename(directory, moved); await mkdir(directory);
  await assert.rejects(store.read(), /preserved/);
  await assert.rejects(store.save('Bob', 1), /preserved/);
  assert.deepEqual(await readdir(directory), []);
});

test('two contributor settings writers serialize and a failed save preserves the last choice', async t => {
  const { directory, store } = await fixture(t), other = new ContributorSettings({ directory });
  const results = await Promise.allSettled([store.save('Alice', 0), other.save('Bob', 0)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  const saved = await store.read();
  const failing = new ContributorSettings({ directory, write: async () => { throw Error('disk full'); } });
  await assert.rejects(failing.save('New name', 1), /disk full/);
  assert.deepEqual(await other.read(), saved);
});

test('private contributor API is protected, bounded and cannot accept forged public identity fields', async t => {
  const { directory } = await fixture(t), explorer = await new Explorer({ library: new Library(directory), binding: 'test' }).load();
  const server = await startServer(explorer); t.after(() => server.close());
  const origin = new URL(server.url).origin;
  const post = (value, extra = {}) => fetch(server.url + 'api/contributor-settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-explorer-client': '1', origin, ...extra }, body: JSON.stringify(value) });
  assert.equal((await post({ action: 'read' }, { origin: 'https://example.test' })).status, 403);
  const read = await (await post({ action: 'read' })).json();
  assert.equal(read.available, true); assert.equal(read.settings.actor, null);
  const saved = await (await post({ action: 'save', revision: 0, displayName: 'Chosen name' })).json();
  assert.equal(saved.settings.actor.displayName, 'Chosen name');
  for (const value of [{ action: 'save', revision: 1, displayName: 'Eve', actor: saved.settings.actor }, { action: 'read', file: 'outside' }, { action: 'save', revision: 1, displayName: 'x'.repeat(5000) }]) assert.equal((await post(value)).status, 400);
  assert.equal(explorer.doc, null);
  assert.equal(JSON.stringify(explorer.uiSnapshot()).includes('Chosen name'), false);
  const preview = new Explorer({ file: join(directory, 'map.json') });
  assert.deepEqual(await preview.contributorSettingsRequest({ action: 'read' }), { available: false, settings: null });
  await assert.rejects(preview.contributorSettingsRequest({ action: 'save', revision: 0, displayName: 'Nope' }), /unavailable/);
});
