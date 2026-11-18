import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureSpecs, makeFixture } from '../scripts/perf-fixtures.mjs';
import { measure, validResult, runBaseline } from '../scripts/perf-baseline.mjs';
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

test('benchmark schema rejects missing cases/phases and nonfinite or negative samples', () => {
  const sample = { status: 'ok', sampleMs: [2, 4], minMs: 2, medianMs: 3, maxMs: 4 };
  const item = { fixture: { name: 'small-deep', fingerprint: 'a' }, phases: { layout: sample } };
  const result = { schema: 1, config: { warmups: 1, samples: 2 }, cases: [item] };
  const contract = { cases: ['small-deep'], phases: ['layout'] };
  const valid = value => validResult(value, contract);
  assert.equal(valid(result), true);
  assert.equal(validResult(result), false, 'production default requires all expected cases and phases');
  for (const cases of [[], [item, item], [{ ...item, fixture: { name: 'unexpected', fingerprint: 'a' } }], [{ ...item, phases: {} }], [{ ...item, phases: { wrong: sample } }]]) assert.equal(valid({ ...result, cases }), false);
  for (const value of [NaN, Infinity, -1]) {
    assert.equal(valid({ ...result, cases: [{ ...item, phases: { layout: { ...sample, sampleMs: [value, 4] } } }] }), false);
    for (const field of ['minMs', 'medianMs', 'maxMs']) assert.equal(valid({ ...result, cases: [{ ...item, phases: { layout: { ...sample, [field]: value } } }] }), false);
  }
  assert.equal(valid({ ...result, cases: [{ ...item, phases: { layout: { ...sample, sampleMs: [] } } }] }), false);
  assert.equal(valid({ ...result, cases: [{ ...item, phases: { layout: { status: 'failed', error: { message: 'Actual valid-map failure' } } } }] }), true);
  assert.equal(valid({ ...result, cases: [{ fixture: { name: 'small-deep' }, phases: { fixture: { status: 'failed', error: { message: 'x'.repeat(401) } } } }] }), false);
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
      specs: [{ name: 'first' }, { name: 'second' }], expectedPhases: ['validate'], log: () => {},
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
  assert.equal(validResult(json, { cases: ['first', 'second'], phases: ['validate'] }), true);
  assert.match(markdown, /first.*fixture: Synthetic valid fixture failed/);
  assert.match(markdown, /second.*validate/);
});


test('synthetic benchmark executes current shipped app imports and retains original phase counts', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-perf-imports-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outcome = await runBaseline({ specs: [fixtureSpecs[0]], outputDirectory: dir, log: () => {} });
  const result = JSON.parse(await readFile(join(dir, 'baseline.json'), 'utf8'));
  for (const [name, phase] of Object.entries(result.cases[0].phases)) assert.equal(phase.status, 'ok', name + ': ' + phase.error?.message);
  assert.equal(outcome.exitCode, 0);
  assert.equal(result.cases[0].phases.renderMap.operations.nodeButtons, 64);
  assert.equal(result.cases[0].viewInteractions.panZoom.operations.sameEditor, true);
});
