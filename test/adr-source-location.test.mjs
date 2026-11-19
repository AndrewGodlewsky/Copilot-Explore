import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { captureAdrSourceLocation } from '../com.github.copilot/extensions/explorer/adr-source-location.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { adrFileDocument, saveAdrFixture } from './helpers/adr-file.mjs';

const exec = promisify(execFile), git = (cwd, ...args) => exec('git', ['-C', cwd, ...args], { windowsHide: true });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'adr-source-location-')), checkout = join(root, 'checkout'), nested = join(checkout, 'nested');
  await mkdir(nested, { recursive: true }); await git(checkout, 'init', '-qb', 'main'); await git(checkout, 'config', 'core.autocrlf', 'false');
  await git(checkout, 'config', 'user.name', 'Fixture'); await git(checkout, 'config', 'user.email', 'fixture@example.invalid');
  let cwd = nested;
  const e = await new Explorer({ library: new Library(join(root, 'private')), binding: 'PRIVATE_BINDING_CANARY', projectRoot: async () => cwd }).load();
  await e.attachProject(await e.projectRepository.create(adrFileDocument()));
  await e.save(saveAdrFixture(structuredClone(e.doc), (await e.scenarioPolicy()).label));
  const extras = []; t.after(async () => { await e.close(); for (const item of extras) await item.close(); await rm(root, { recursive: true, force: true }); });
  let sequence = 0; const clientId = randomUUID();
  const prepare = (selection = { kind: 'new', number: 1 }) => e.adrFileRequest({ action: 'prepare', journey: e.activeKey, clientId, sequence: ++sequence, selection });
  const commit = async () => { await git(checkout, 'add', '--', '.'); await git(checkout, 'commit', '-qm', 'Saved sources'); await e.attachProject(await e.projectRepository.open(e.projectStore.context.relativePath)); return (await git(checkout, 'rev-parse', 'HEAD')).stdout.trim(); };
  const target = async () => (await (await e.adrWriter.storage(e)).capture('docs/decisions/0001-source.md')).target;
  return { root, checkout, nested, e, extras, prepare, target, commit, cwd: value => { cwd = value; }, save: p => e.adrFileRequest({ action: 'save', journey: e.activeKey, revision: e.doc.revision, token: p.token }) };
}

test('shared ADR capture distinguishes nested destination base and resolves original sources in a fresh checkout', async t => {
  const f = await fixture(t), head = await f.commit(), originalAnswer = f.e.doc.nodes[1].answer, index = await readFile(join(f.checkout, '.git/index'));
  const preview = await f.prepare(), saved = await f.save(preview); assert.equal(saved.recovery.phase, 'complete');
  const association = f.e.doc.adrFiles[0], source = association.sources;
  assert.equal(source.journey.commit, head); assert.equal(source.journey.path, f.e.projectStore.context.relativePath); assert.equal(source.adrPath, `nested/${preview.path}`);
  assert.equal(association.path, preview.path); assert.equal(source.nodes[0].record.answer, originalAnswer); assert.ok(preview.content.includes(source.digest));
  assert.doesNotMatch(JSON.stringify(source), /PRIVATE_BINDING_CANARY/); assert.ok(!JSON.stringify(source).includes(f.checkout)); assert.deepEqual(await readFile(join(f.checkout, '.git/index')), index);
  const clone = join(f.root, 'fresh-clone'); await mkdir(clone); await git(clone, 'init', '-qb', 'main');
  for (const path of [source.journey.path, source.adrPath]) { await mkdir(dirname(join(clone, path)), { recursive: true }); await copyFile(join(f.checkout, path), join(clone, path)); }
  const other = await new Explorer({ library: new Library(join(f.root, 'other-private')), binding: 'OTHER', projectRoot: async () => clone }).load(); f.extras.push(other);
  const inspected = await other.portableReferenceRequest({ action: 'inspect', journey: null, revision: null, text: JSON.stringify(source.references[0]) });
  const opened = await other.command('open-reference', { journey: null, revision: null, id: inspected.id, acknowledged: false });
  assert.equal(opened.referenceNodeId, source.nodes[0].record.id); assert.deepEqual(opened.document.adrFiles[0].sources, source);
});

test('source commit evidence is absent for untracked, staged-only, dirty or filtered content and helper failures', async t => {
  const f = await fixture(t);
  assert.equal((await captureAdrSourceLocation(f.e, await f.target())).location.commit, null);
  await git(f.checkout, 'add', '--', '.'); assert.equal((await captureAdrSourceLocation(f.e, await f.target())).location.commit, null);
  await f.commit(); const next = structuredClone(f.e.doc); next.nodes[1].answer += ' New uncommitted answer'; await f.e.save(next);
  assert.equal((await captureAdrSourceLocation(f.e, await f.target())).location.commit, null);
  await f.commit(); await writeFile(join(f.checkout, '.gitattributes'), '*.explore.json filter=fixture\n');
  assert.equal((await captureAdrSourceLocation(f.e, await f.target())).location.commit, null);
  assert.equal((await captureAdrSourceLocation(f.e, await f.target(), { run: async () => { throw Error('Private command failure'); } })).location.commit, null);
});

test('source commit proof reads a bounded blob without filters or network and rejects a different committed document', async t => {
  const f = await fixture(t), head = await f.commit(), calls = [];
  const proof = await captureAdrSourceLocation(f.e, await f.target(), { run: async (...args) => { calls.push(args); return exec(...args); } });
  assert.equal(proof.location.commit, head); const blob = calls.find(call => call[1].includes('cat-file')); assert.ok(blob);
  assert.ok(blob[1].includes('--no-lazy-fetch')); assert.ok(blob[1].includes('--no-optional-locks')); assert.ok(blob[1].includes('--literal-pathspecs')); assert.ok(blob[1].includes('core.fsmonitor=false'));
  assert.equal(blob[2].windowsHide, true); assert.equal(blob[2].timeout, 5000); assert.equal(Object.keys(blob[2].env).some(k => k.toUpperCase().startsWith('GIT_')), false);
  const mismatch = await captureAdrSourceLocation(f.e, await f.target(), { run: async (...args) => {
    const result = await exec(...args); if (args[1].includes('cat-file')) { const value = JSON.parse(result.stdout); value.journey.nodes[1].answer = 'Different committed source'; return { ...result, stdout: Buffer.from(JSON.stringify(value)) }; } return result;
  } });
  assert.equal(mismatch.location.commit, null);
});

test('source bytes or checkout changes during asynchronous Git observation reject the location proof', async t => {
  for (const change of ['bytes', 'checkout']) {
    const f = await fixture(t); await f.commit(); const target = await f.target(); let changed = false;
    await assert.rejects(captureAdrSourceLocation(f.e, target, { run: async (...args) => {
      const output = await exec(...args); if (!changed) { changed = true; if (change === 'bytes') await writeFile(f.e.file, `${await readFile(f.e.file)}\n`); else { const other = join(f.root, 'other'); await mkdir(other); await git(other, 'init', '-qb', 'main'); f.cwd(other); } } return output;
    } }), /changed|unavailable|checkout|source/i);
    assert.equal(f.e.doc.adrFiles, undefined);
  }
});

test('a recorded ADR cannot update a same-named copied file from a different working-folder base', async t => {
  const f = await fixture(t), preview = await f.prepare(); await f.save(preview); const association = f.e.doc.adrFiles[0];
  const wrong = join(f.checkout, association.path); await mkdir(dirname(wrong), { recursive: true }); await copyFile(join(f.nested, association.path), wrong); const before = await readFile(wrong);
  f.cwd(f.checkout);
  for (const kind of ['update', 'review-update']) await assert.rejects(f.prepare({ kind, id: association.id }), /location|directory|destination|changed/i);
  const inspection = await f.e.adrFileRequest({ action: 'inspect', journey: f.e.activeKey, id: association.id, revision: f.e.doc.revision }); assert.equal(inspection.file.status, 'unavailable'); assert.equal(inspection.file.content, null);
  assert.deepEqual(await readFile(wrong), before);
});

test('captured ADR history remains inspectable when the attached checkout is no longer available', async t => {
  const f = await fixture(t), preview = await f.prepare(); await f.save(preview); const record = structuredClone(f.e.doc.adrFiles[0]);
  const other = join(f.root, 'other-project'); await mkdir(other); await git(other, 'init', '-qb', 'main'); f.cwd(other);
  const result = await f.e.adrFileRequest({ action: 'sources', journey: f.e.activeKey, revision: f.e.doc.revision, id: record.id });
  assert.equal(result.sourceStatus.status, 'unavailable'); assert.deepEqual(result.capture, record.sources); assert.ok(!JSON.stringify(result).includes(f.checkout));
});

test('ADR lifecycle changes preserve nested portable identity and source history in a fresh Git clone', async t => {
  const f = await fixture(t); await f.commit(); await f.save(await f.prepare());
  const original = structuredClone(f.e.doc.adrFiles[0]), clientId = randomUUID();
  const accepted = await f.e.adrLifecycleRequest({ action: 'prepare', journey: f.e.activeKey, clientId, sequence: 1, selection: { kind: 'accept', id: original.id } });
  assert.equal((await f.e.adrLifecycleRequest({ action: 'save', journey: f.e.activeKey, token: accepted.token, revision: f.e.doc.revision })).recovery.phase, 'complete');
  await f.commit(); const clone = join(f.root, 'lifecycle-clone'); await git(f.root, '-c', 'core.autocrlf=false', 'clone', '--quiet', '--local', '--no-hardlinks', f.checkout, clone);
  let cwd = join(clone, 'nested'); const other = await new Explorer({ library: new Library(join(f.root, 'clone-private')), binding: 'CLONE', projectRoot: async () => cwd }).load(); f.extras.push(other);
  await other.attachProject(await other.projectRepository.open(original.sources.journey.path)); const index = await readFile(join(clone, '.git/index'));
  const prepare = sequence => other.adrLifecycleRequest({ action: 'prepare', journey: other.activeKey, clientId, sequence, selection: { kind: 'deprecate', id: original.id } });
  const wrong = join(clone, original.path); await mkdir(dirname(wrong), { recursive: true }); await copyFile(join(cwd, original.path), wrong); const wrongBytes = await readFile(wrong);
  cwd = clone; await assert.rejects(prepare(2), /location|folder|changed/i); assert.deepEqual(await readFile(wrong), wrongBytes);
  cwd = join(clone, 'nested'); const preview = await prepare(3);
  assert.equal((await other.adrLifecycleRequest({ action: 'save', journey: other.activeKey, revision: other.doc.revision, token: preview.token })).recovery.phase, 'complete');
  assert.equal(other.doc.adrFiles[0].status, 'deprecated'); assert.deepEqual(other.doc.adrFiles[0].sources, original.sources); assert.deepEqual(await readFile(join(clone, '.git/index')), index);
  assert.equal(await readFile(join(cwd, original.path), 'utf8'), preview.files[0].content); assert.ok(!JSON.stringify(preview).includes(clone));
});
