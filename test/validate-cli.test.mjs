import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDocument, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareSharedMigration, readSharedDocument } from '../com.github.copilot/extensions/explorer/shared-document.mjs';
const exec = promisify(execFile), cli = resolve('com.github.copilot/extensions/explorer/validate.mjs');
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'explorer-validate-')); t.after(() => rm(cwd, { recursive: true, force: true }));
  const personal = createDocument('日本語 sample'), shared = prepareSharedMigration(JSON.stringify(personal)).content;
  const run = async args => { try { const result = await exec(process.execPath, [cli, ...args], { cwd, windowsHide: true, timeout: 10000 }); return { code: 0, ...result }; } catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; } };
  return { cwd, personal, shared, run };
}
test('standalone CLI accepts canonical shared and compatible legacy files without rewriting or private storage', async t => {
  const f = await fixture(t), legacy = JSON.stringify(f.personal); validateDocument(f.personal); readSharedDocument(f.shared);
  await writeFile(join(f.cwd, 'legacy file.json'), legacy); await writeFile(join(f.cwd, '日本語.explore.json'), f.shared);
  const before = await readdir(f.cwd), result = await f.run(['--', 'legacy file.json', '日本語.explore.json']);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /2 valid/); assert.ok(!result.stdout.includes(f.cwd));
  assert.equal(await readFile(join(f.cwd, 'legacy file.json'), 'utf8'), legacy); assert.equal(await readFile(join(f.cwd, '日本語.explore.json'), 'utf8'), f.shared); assert.deepEqual(await readdir(f.cwd), before);
});
test('CLI and shared runtime reject the same invalid schema and graph corpus', async t => {
  const f = await fixture(t), cases = [];
  for (const mutate of [doc => { doc.version = 99; }, doc => { doc.journey.nodes.push({ ...doc.journey.nodes[0] }); }, doc => { doc.journey.nodes[0].parentId = 'missing'; }, doc => { doc.journey.futureADR = { nodeId: 'missing' }; }]) {
    const doc = JSON.parse(f.shared); mutate(doc); cases.push(JSON.stringify(doc));
  }
  cases.push('<<<<<<< local\n{}\n=======\n{}\n>>>>>>> incoming', f.shared.replace('"format":', '"format":"duplicate", "format":'));
  for (let i = 0; i < cases.length; i++) { assert.throws(() => readSharedDocument(cases[i])); await writeFile(join(f.cwd, `invalid-${i}.explore.json`), cases[i]); }
  const result = await f.run(['--folder', '.']); assert.equal(result.code, 1); assert.match(result.stdout + result.stderr, /invalid-0/); assert.match(result.stdout + result.stderr, /conflict|merge/i);
  for (let i = 0; i < cases.length; i++) assert.equal(await readFile(join(f.cwd, `invalid-${i}.explore.json`), 'utf8'), cases[i]);
});
test('CLI discovery and argument failures are explicit, bounded, and do not scan subfolders', async t => {
  const f = await fixture(t); await mkdir(join(f.cwd, 'empty')); await mkdir(join(f.cwd, 'empty', 'nested')); await writeFile(join(f.cwd, 'empty', 'nested', 'bad.explore.json'), '{}');
  assert.equal((await f.run(['--folder', 'empty'])).code, 0);
  assert.equal((await f.run(['missing.json'])).code, 1); assert.equal((await f.run([])).code, 2); assert.equal((await f.run(['--folder'])).code, 2);
  assert.equal((await f.run(['--help'])).code, 0); assert.equal((await f.run(['--unknown'])).code, 2);
  for (let i = 0; i < 101; i++) await writeFile(join(f.cwd, `map-${i}.explore.json`), f.shared);
  const limited = await f.run(['--folder', '.']); assert.equal(limited.code, 1); assert.match(limited.stdout + limited.stderr, /limit|100/i);
});

test('CLI rejects oversized, malformed UTF-8, linked and escaping selections without exposing file text', async t => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, 'large.explore.json'), Buffer.alloc(9 * 1024 * 1024 + 1, 32));
  await writeFile(join(f.cwd, 'encoding.explore.json'), Buffer.from([0xff, 0xfe]));
  let result = await f.run(['large.explore.json', 'encoding.explore.json']); assert.equal(result.code, 1); assert.match(result.stdout, /size limit/); assert.match(result.stdout, /UTF-8/);
  await mkdir(join(f.cwd, 'real')); await writeFile(join(f.cwd, 'real', 'data.explore.json'), f.shared);
  await symlink(join(f.cwd, 'real'), join(f.cwd, 'link'), 'junction'); result = await f.run(['link/data.explore.json']); assert.equal(result.code, 1); assert.match(result.stdout, /linked|identity/);
  result = await f.run(['../outside.json']); assert.equal(result.code, 1); assert.match(result.stdout, /inside the current directory/);
  assert.equal(await readFile(join(f.cwd, 'real', 'data.explore.json'), 'utf8'), f.shared);
});

test('the opt-in workflow validation command checks a disposable sample repository without modifications', async t => {
  const f = await fixture(t), folder = join(f.cwd, '.explorer', 'journeys'); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'sample.explore.json'), f.shared); await exec('git', ['init', '-q', f.cwd], { windowsHide: true });
  const status = () => exec('git', ['-C', f.cwd, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'], { windowsHide: true });
  const before = (await status()).stdout, result = await f.run(['--folder', '.explorer/journeys']);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /1 valid/); assert.equal((await status()).stdout, before);
  assert.equal(await readFile(join(folder, 'sample.explore.json'), 'utf8'), f.shared);
  const example = await readFile('docs/examples/validate-explorations.yml', 'utf8'); assert.match(example, /run: node .*validate\.mjs --folder \.explorer\/journeys/);
});

test('legacy compatibility does not silently accept unknown reference families or extensions', async t => {
  const f = await fixture(t);
  for (const field of ['dependencies', 'scenarios', 'adr', 'extensions']) {
    const doc = { ...f.personal, [field]: [{ nodeId: 'missing-node' }] }, content = JSON.stringify(doc); await writeFile(join(f.cwd, `${field}.json`), content);
    const result = await f.run([`${field}.json`]); assert.equal(result.code, 1, `${field}: ${result.stdout}`); assert.match(result.stdout, /unsupported field/);
    assert.equal(await readFile(join(f.cwd, `${field}.json`), 'utf8'), content);
  }
});

test('CLI caps actual aggregate reads even when files change after reading', async t => {
  const f = await fixture(t), size = 9 * 1024 * 1024;
  const content = Buffer.alloc(size, 32); Buffer.from(f.shared).copy(content);
  for (let i = 0; i < 8; i++) await writeFile(join(f.cwd, `${i}.explore.json`), content);
  const probe = `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.open; let bytes = 0;
fs.open = async (...args) => { const handle = await original(...args), read = handle.read.bind(handle);
  handle.read = async (...values) => { const result = await read(...values); bytes += result.bytesRead;
    if (process.argv[2] === 'changed' && result.bytesRead) await fs.utimes(args[0], new Date(0), new Date(0));
    return result; }; return handle; };
syncBuiltinESMExports();
const { runValidation } = await import(${JSON.stringify(new URL('../com.github.copilot/extensions/explorer/validate.mjs', import.meta.url).href)});
const code = await runValidation(['--folder', '.']); console.log(JSON.stringify({ code, bytes }));`;
  await writeFile(join(f.cwd, 'probe.mjs'), probe);
  for (const mode of ['stable', 'changed']) {
    const result = await exec(process.execPath, ['probe.mjs', mode], { cwd: f.cwd, windowsHide: true, timeout: 20000 });
    const measured = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(measured.code, 1); assert.ok(measured.bytes <= 64 * 1024 * 1024, `${mode}: read ${measured.bytes} bytes`);
    assert.match(result.stdout, /total read limit.*incomplete/);
  }
});
