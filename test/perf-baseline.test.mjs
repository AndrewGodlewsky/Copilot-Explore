import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSpecs, makeFixture } from '../scripts/perf-fixtures.mjs';
import { validResult } from '../scripts/perf-baseline.mjs';
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
