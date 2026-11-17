import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const plugin = await json('plugin.json');
const catalog = await json('.github/plugin/marketplace.json');
const pkg = await json('package.json');
const extension = await json('com.github.copilot/extensions/explorer/package.json');
const notes = await json('release-notes.json');
assert.equal(plugin.name, 'explorer');
assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.equal(catalog.plugins[0].name, plugin.name);
assert.equal(catalog.plugins[0].source, './');
for (const version of [pkg.version, extension.version, catalog.plugins[0].version, notes[0].version]) assert.equal(version, plugin.version);
assert.ok(notes.every(note => typeof note.summary === 'string' && note.summary.length > 0 && note.summary.length <= 400));
const logo = await readFile(join(root, plugin.extensions['com.github.copilot'].logo));
assert.match(logo.toString(), /<svg\b/);
assert.ok(logo.toString('base64').length < 350000);
const skill = await readFile(join(root, 'skills/explore/SKILL.md'), 'utf8');
assert.match(skill, /^---\r?\nname: explore\r?\n/);
assert.match(skill, /open_canvas/);
async function checkTree(folder) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, item.name);
    if (item.isDirectory()) await checkTree(path);
    else if (item.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    }
  }
}
for (const folder of ['com.github.copilot', 'scripts', 'test']) await checkTree(join(root, folder));
for (const name of ['index.html', 'style.css', 'app.mjs', 'layout.mjs', 'voice.mjs']) await access(join(root, 'com.github.copilot/extensions/explorer/web', name));
console.log(`Explorer ${plugin.version}: syntax, skill, assets, marketplace and release versions passed.`);
