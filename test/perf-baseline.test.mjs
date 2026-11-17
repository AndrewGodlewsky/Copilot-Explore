import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSpecs, makeFixture } from '../scripts/perf-fixtures.mjs';
import { measure, validResult } from '../scripts/perf-baseline.mjs';
import { MAX_DOCUMENT_BYTES, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';

test('synthetic performance fixtures are deterministic, validated and cover topology and limits', () => {
  assert.deepEqual(new Set(fixtureSpecs.map(spec => spec.topology)), new Set(['deep', 'wide']));
  const first = makeFixture(fixtureSpecs[0]);
  assert.equal(first.definition.fingerprint, makeFixture(fixtureSpecs[0]).definition.fingerprint);
  for (const spec of fixtureSpecs) {
    const { document, definition } = makeFixture(spec);
    assert.equal(validateDocument(document).nodes.length, spec.count);
    assert.equal(definition.questions + document.nodes.filter(node => node.kind === 'direction').length + 1, spec.count);
    assert.ok(definition.researchNodes > 0 && definition.answeredNodes > 0);
    assert.ok(document.brief && document.pins?.length && document.nodes.some(node => node.answerState === 'tentative'));
    const prepared = prepareBrief(document);
    assert.ok(prepared.bytes <= 131072);
    assert.equal(prepared.prompt, prepareBrief({ ...document, brief: undefined }).prompt);
    if (spec.nearBytes) assert.ok(definition.bytes >= MAX_DOCUMENT_BYTES - 64 * 1024 && definition.bytes <= MAX_DOCUMENT_BYTES);
  }
});

test('benchmark schema requires real samples or a bounded phase failure', () => {
  const item = { fixture: { fingerprint: 'a' }, phases: { layout: { status: 'ok', sampleMs: [2, 4], minMs: 2, medianMs: 3, maxMs: 4 } } };
  const result = { schema: 1, config: { warmups: 1, samples: 2 }, cases: [item] };
  assert.equal(validResult(result), true);
  assert.equal(validResult({ ...result, cases: [{ ...item, phases: { layout: { status: 'ok', sampleMs: [], minMs: 0, medianMs: 0, maxMs: 0 } } }] }), false);
  assert.equal(validResult({ ...result, cases: [{ ...item, phases: { layout: { status: 'failed', error: { message: 'Actual valid-map failure' } } } }] }), true);
});

test('sample timing excludes setup, reporting and cleanup', async () => {
  let clock = 0, setups = 0, reports = 0, disposals = 0;
  const phases = {};
  await measure(phases, 'write', 'synthetic write', (_, resource) => {
    assert.equal(resource.payload, 'prepared'); clock += 5; return 'written';
  }, { now: () => clock, setup: () => { setups++; clock += 1000; return { payload: 'prepared' }; },
    report: (value, resource) => { reports++; assert.equal(value, 'written'); assert.equal(resource.payload, 'prepared'); clock += 2000; return { writes: 1 }; },
    dispose: () => { disposals++; clock += 3000; } });
  assert.deepEqual(phases.write.sampleMs, [5, 5]);
  assert.deepEqual(phases.write.operations, { writes: 1 });
  assert.equal(setups, 3); assert.equal(reports, 3); assert.equal(disposals, 3);
});

test('fixture failure is retained, later cases run, both artifacts are written and exit is nonzero', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-perf-failure-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = `import { runBaseline } from './scripts/perf-baseline.mjs';
    const outcome = await runBaseline({ outputDirectory: process.env.PERF_TEST_OUTPUT,
      specs: [{ name: 'first' }, { name: 'second' }], log: () => {},
      runCase: async spec => {
        if (spec.name === 'first') throw new Error('Synthetic valid fixture failed at preparation');
        return { fixture: { name: spec.name, fingerprint: 'fixed' }, phases: { validate: {
          status: 'ok', operation: 'validate', operations: { documents: 1 }, warmups: 1,
          samples: 2, sampleMs: [1, 2], minMs: 1, medianMs: 1.5, maxMs: 2 } } };
      } });
    process.exitCode = outcome.exitCode;`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PERF_TEST_OUTPUT: dir }, encoding: 'utf8', windowsHide: true });
  assert.equal(child.status, 1, child.stderr);
  const json = JSON.parse(await readFile(join(dir, 'baseline.json'), 'utf8'));
  const markdown = await readFile(join(dir, 'baseline.md'), 'utf8');
  assert.equal(json.cases.length, 2);
  assert.equal(json.cases[0].phases.fixture.status, 'failed');
  assert.match(json.cases[0].phases.fixture.error.message, /Synthetic valid fixture failed/);
  assert.ok(json.cases[0].phases.fixture.error.message.length <= 400);
  assert.equal(json.cases[1].phases.validate.status, 'ok');
  assert.equal(validResult(json), true);
  assert.match(markdown, /first.*fixture: Synthetic valid fixture failed/);
  assert.match(markdown, /second.*validate/);
});
