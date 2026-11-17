import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, symlink, link, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NavigationPreferences, defaultNavigationSettings } from '../com.github.copilot/extensions/explorer/navigation-preferences.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-navigation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'navigation-settings.json');
}

test('navigation settings default, validate bounds, save and reload with revisions', async t => {
  const file = await fixture(t), first = new NavigationPreferences(file);
  assert.deepEqual(await first.read(), defaultNavigationSettings());
  for (const value of [NaN, Infinity, .24, 3.01, '1']) {
    await assert.rejects(first.save({ wheelMode: 'pan', sensitivity: value, motion: 'full' }, 0), /Invalid navigation settings/);
  }
  await assert.rejects(first.save({ wheelMode: 'other', sensitivity: 1, motion: 'system' }, 0), /Invalid navigation settings/);
  await assert.rejects(first.save({ wheelMode: 'zoom', sensitivity: 1, motion: 'other' }, 0), /Invalid navigation settings/);
  const saved = await first.save({ wheelMode: 'pan', sensitivity: .25, motion: 'reduce' }, 0);
  assert.deepEqual(saved, { version: 1, revision: 1, wheelMode: 'pan', sensitivity: .25, motion: 'reduce' });
  assert.deepEqual(await new NavigationPreferences(file).read(), saved);
  await assert.rejects(new NavigationPreferences(file).save({ wheelMode: 'zoom', sensitivity: 3, motion: 'full' }, 0), /another canvas/i);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), saved);
});

test('navigation settings preserve malformed, oversized and linked files', async t => {
  const file = await fixture(t), store = new NavigationPreferences(file);
  for (const content of ['{broken', ' '.repeat(5000), JSON.stringify({ version: 1, revision: 0, wheelMode: 'pan', sensitivity: 4, motion: 'full' })]) {
    await writeFile(file, content);
    await assert.rejects(store.read(), /preserved/i);
    await assert.rejects(store.save({ wheelMode: 'zoom', sensitivity: 1, motion: 'system' }, 0), /preserved/i);
    assert.equal(await readFile(file, 'utf8'), content);
  }
  const target = join(file, '..', 'target.json');
  await writeFile(target, 'outside'); await rm(file);
  try {
    await symlink(target, file);
    await assert.rejects(store.read(), /preserved/i);
    await rm(file);
  } catch (error) { if (error.code !== 'EPERM') throw error; }
  assert.equal(await readFile(target, 'utf8'), 'outside');
  await link(target, file);
  await assert.rejects(store.read(), /preserved/i);
  assert.equal(await readFile(target, 'utf8'), 'outside');
});

test('navigation settings lock and failed writes leave last revision recoverable', async t => {
  const file = await fixture(t), store = new NavigationPreferences(file);
  const saved = await store.save({ wheelMode: 'zoom', sensitivity: 1, motion: 'system' }, 0);
  await writeFile(file + '.lock', 'held');
  await assert.rejects(store.save({ wheelMode: 'pan', sensitivity: 2, motion: 'full' }, 1), /owner is unknown/i);
  assert.deepEqual(await store.read(), saved);
  await rm(file + '.lock');
  const failing = new NavigationPreferences(file, async () => { throw new Error('disk full'); });
  await assert.rejects(failing.save({ wheelMode: 'pan', sensitivity: 2, motion: 'full' }, 1), /disk full/);
  assert.deepEqual(await store.read(), saved);
  const bad = new NavigationPreferences(join(file, 'invalid.json'));
  await assert.rejects(bad.save({ wheelMode: 'pan', sensitivity: 2, motion: 'full' }, 0));
  assert.deepEqual(await store.read(), saved);
});

test('two navigation writers serialize and only one revision wins', async t => {
  const file = await fixture(t), a = new NavigationPreferences(file), b = new NavigationPreferences(file);
  const results = await Promise.allSettled([
    a.save({ wheelMode: 'pan', sensitivity: 1, motion: 'system' }, 0),
    b.save({ wheelMode: 'zoom', sensitivity: 2, motion: 'full' }, 0),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await a.read()).revision, 1);
});
