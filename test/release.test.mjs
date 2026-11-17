import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkReleaseMetadata } from '../scripts/release-metadata.mjs';

const version = '0.1.13';
const readme = `# Explorer
<!-- explorer-current-version:start -->
**Proof of concept, v0.1.13.**
<!-- explorer-current-version:end -->

Historical release v0.1.7 and the v0.1.8 research note remain unchanged.

Manual acceptance in Copilot:

<!-- explorer-install-check:start -->
- Update to v0.1.13 and confirm **Explorer v0.1.13**.
<!-- explorer-install-check:end -->
`;

async function fixture(t, changes = {}) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    'package.json': { name: 'copilot-explorer', version },
    'package-lock.json': { name: 'copilot-explorer', version, packages: { '': { name: 'copilot-explorer', version } } },
    'plugin.json': { name: 'explorer', version },
    '.github/plugin/marketplace.json': { plugins: [{ name: 'explorer', version }] },
    'com.github.copilot/extensions/explorer/package.json': { name: 'explorer-canvas', version },
    'release-notes.json': [{ version, summary: 'Checks release metadata before packaging.' }, { version: '0.1.12', summary: 'Previous release.' }],
    'README.md': readme,
  };
  for (const [name, value] of Object.entries({ ...files, ...changes })) {
    await mkdir(join(root, name, '..'), { recursive: true });
    await writeFile(join(root, name), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
}

test('accepts matching release metadata while preserving historical README references', async t => {
  const root = await fixture(t);
  assert.equal(await checkReleaseMetadata(root), version);
  assert.match(await readFile(join(root, 'README.md'), 'utf8'), /Historical release v0\.1\.7/);
});

for (const [name, change, expected] of [
  ['root package', { 'package.json': { name: 'copilot-explorer', version: '0.1.12' } }, /package\.json.*version/],
  ['lockfile root', { 'package-lock.json': { name: 'copilot-explorer', version: '0.1.12', packages: { '': { name: 'copilot-explorer', version } } } }, /package-lock\.json.*version/],
  ['lockfile packages entry', { 'package-lock.json': { name: 'copilot-explorer', version, packages: { '': { name: 'copilot-explorer', version: '0.1.12' } } } }, /package-lock\.json.*packages\[""\]\.version/],
  ['marketplace', { '.github/plugin/marketplace.json': { plugins: [{ name: 'explorer', version: '0.1.12' }] } }, /marketplace\.json.*plugins\[0\]\.version/],
  ['extension package', { 'com.github.copilot/extensions/explorer/package.json': { name: 'explorer-canvas', version: '0.1.12' } }, /explorer\/package\.json.*version/],
  ['newest release note', { 'release-notes.json': [{ version: '0.1.12', summary: 'Old release.' }] }, /release-notes\.json.*\[0\]\.version/],
]) {
  test(`rejects mismatched ${name} version with its field name`, async t => {
    const root = await fixture(t, change);
    await assert.rejects(checkReleaseMetadata(root), expected);
  });
}

test('rejects stale current README version but allows historical versions', async t => {
  const root = await fixture(t, { 'README.md': readme.replace('Proof of concept, v0.1.13', 'Proof of concept, v0.1.12') });
  await assert.rejects(checkReleaseMetadata(root), /README\.md.*explorer-current-version/);
});

test('rejects stale installation checklist version', async t => {
  const root = await fixture(t, { 'README.md': readme.replaceAll('Update to v0.1.13 and confirm **Explorer v0.1.13**', 'Update to v0.1.12 and confirm **Explorer v0.1.12**') });
  await assert.rejects(checkReleaseMetadata(root), /README\.md.*explorer-install-check/);
});

test('rejects a stale unprefixed installation version alongside a matching version', async t => {
  const root = await fixture(t, { 'README.md': readme.replace('Update to v0.1.13', 'Update to 0.1.12') });
  await assert.rejects(checkReleaseMetadata(root), /README\.md.*explorer-install-check/);
});

test('rejects a missing current-version marker', async t => {
  const root = await fixture(t, { 'README.md': readme.replace('<!-- explorer-current-version:end -->', '') });
  await assert.rejects(checkReleaseMetadata(root), /README\.md.*explorer-current-version/);
});

for (const summary of ['', '   ', 'x'.repeat(401), 42]) {
  test(`rejects invalid release summary ${JSON.stringify(summary).slice(0, 20)}`, async t => {
    const root = await fixture(t, { 'release-notes.json': [{ version, summary }] });
    await assert.rejects(checkReleaseMetadata(root), /release-notes\.json.*\[0\]\.summary/);
  });
}
