import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { runCase } from '../scripts/research-benchmark.mjs';

const corpus = JSON.parse(await readFile(new URL('../docs/research-evaluation-cases.json', import.meta.url), 'utf8'));

test('versioned benchmark spans distinct topics, difficult evidence and a public held-out split', () => {
  assert.equal(corpus.version, 1); assert.equal(corpus.cases.length, 20);
  assert.equal(new Set(corpus.cases.map(item => item.id)).size, 20);
  assert.equal(new Set(corpus.cases.map(item => item.family)).size, 5);
  assert.equal(corpus.cases.filter(item => item.split === 'held-out').length, 5);
  for (const condition of ['stale', 'conflicting', 'missing', 'adversarial']) assert.ok(corpus.cases.some(item => item.condition === condition));
  for (const item of corpus.cases) {
    assert.equal(item.options.length, 2); assert.notEqual(item.options[0].title, item.options[1].title);
    assert.ok(item.criteria.length >= 2 && item.followup.expectation && item.followup.question);
  }
});

test('every case exercises actual helper completion, unread-source rejection, cancellation and follow-up without live metrics', async () => {
  for (const item of corpus.cases) {
    const result = await runCase(item);
    assert.deepEqual(result.checks, { completed: true, unreadCitationRejected: true, cancelled: true, followup: true, savedMapUnchanged: true, exactInput: true }, item.id);
    assert.equal(result.fixtureModelCalls, 4); assert.equal(result.helperStops, 4);
    assert.equal(result.providerTokens, null); assert.equal(result.providerCost, null); assert.equal(result.liveQuality, null);
    assert.ok(result.inputBytes > 0 && result.inputBytes <= 131072);
    assert.ok(result.followupBytes > result.inputBytes && result.followupBytes <= 131072);
    assert.ok(result.inProcessMs >= 0); assert.ok(result.inputHash && result.responseHash);
    assert.equal(result.fixtureReadCallbacks, 2);
    assert.equal(result.fixtureFetchAttempts, 3);
    assert.deepEqual(result.statuses, ['completed', 'failed', 'cancelled', 'completed']);
  }
});

test('candidate guidance changes measured input but cannot earn a quality improvement from scripted answers', async () => {
  const item = corpus.cases[0], baseline = await runCase(item), candidate = await runCase(item, { guidance: 'Explain counter-evidence and missing decision criteria. 🌿' });
  assert.ok(candidate.inputBytes > baseline.inputBytes); assert.notEqual(candidate.inputHash, baseline.inputHash);
  assert.equal(candidate.responseHash, baseline.responseHash); assert.deepEqual(candidate.checks, baseline.checks);
  assert.equal(candidate.liveQuality, null);
  const repeat = await runCase(item);
  assert.equal(repeat.inputHash, baseline.inputHash); assert.equal(repeat.responseHash, baseline.responseHash);
  await assert.rejects(runCase(item, { guidance: 'x'.repeat(32769) }), /guidance.*32 KiB/i);
  await assert.rejects(runCase(item, { guidance: '界'.repeat(10923) }), /guidance.*32 KiB/i);
});

test('CLI separates development and held-out cases and compares the same inputs with a bounded candidate', () => {
  const execute = args => {
    const result = spawnSync(process.execPath, ['scripts/research-benchmark.mjs', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const development = execute([]);
  assert.equal(development.runs.length, 1); assert.equal(development.runs[0].results.length, 15);
  assert.ok(development.runs[0].results.every(item => item.split === 'development'));
  const heldOut = execute(['--split', 'held-out', '--candidate', 'docs/research-evaluation-candidate.md']);
  assert.equal(heldOut.runs.length, 2);
  const [current, candidate] = heldOut.runs.map(run => run.results);
  assert.equal(current.length, 5); assert.ok(current.every(item => item.split === 'held-out'));
  assert.deepEqual(candidate.map(item => item.id), current.map(item => item.id));
  assert.deepEqual(candidate.map(item => item.responseHash), current.map(item => item.responseHash));
  assert.ok(candidate.every((item, i) => item.inputBytes > current[i].inputBytes && item.inputHash !== current[i].inputHash));
});

test('benchmark CLI rejects live execution and unknown options instead of falling back to a real provider', () => {
  const result = spawnSync(process.execPath, ['scripts/research-benchmark.mjs', '--live'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /unknown|unsupported|offline/i);
});
