import test from 'node:test';
import assert from 'node:assert/strict';
import { createEffortTracker, effortAssessment, effortReport } from '../com.github.copilot/extensions/explorer/research-effort.mjs';
import { researchLimits, researchSettings } from '../com.github.copilot/extensions/explorer/web/research-policy.mjs';
const limits = depth => researchLimits(researchSettings({ depth, sourceFocus: 'balanced', recency: 'any' }));
const search = (query, extra = {}) => ({ toolName: 'web_search', toolArgs: { query, ...extra } });
const fetch = (url, extra = {}) => ({ toolName: 'web_fetch', toolArgs: { url, ...extra } });

test('existing-material effort reports enforce zero retrieval with one recorded denied excess attempt', () => {
  const settings = researchSettings(), effort = createEffortTracker(researchLimits(settings, 'existing'));
  const complete = { settings, sourceMode: 'existing', reason: 'model-completed', elapsedMs: 12, ...effort.snapshot(), assessment: null, partial: null };
  assert.equal(effortReport(complete).toolAttempts, 0);
  assert.deepEqual(effort.attempt(fetch('https://example.com/')), { allowed: false, reason: 'attempt-limit', stop: true });
  const stopped = { ...complete, reason: 'attempt-limit', ...effort.snapshot() };
  assert.equal(effortReport(stopped).toolAttempts, 1);
  for (const patch of [{ sourceMode: 'unknown' }, { deliveredTextUnits: 1 }, { duplicateAttempts: 1 }, { truncatedResults: 1 }, { toolAttempts: 2 }, { reason: 'tool-failure' }, { reason: 'model-completed' }]) assert.throws(() => effortReport({ ...stopped, ...patch }), /Invalid research effort/);
});

test('exact repeated queries are denied once and then stop without conflating case or internal whitespace', () => {
  const effort = createEffortTracker(limits('standard'));
  assert.deepEqual(effort.attempt(search('  A "B C"  ', { range: { end: 2, start: 1 } })), { allowed: true });
  assert.deepEqual(effort.attempt({ toolName: 'github-mcp-server/web_search', toolArgs: { range: { start: 1, end: 2 }, query: 'A "B C"' } }), { allowed: false, reason: 'duplicate-request', stop: false });
  assert.equal(effort.attempt(search('a "B C"', { range: { start: 1, end: 2 } })).allowed, true);
  assert.equal(effort.attempt(search('A "B  C"', { range: { start: 1, end: 2 } })).allowed, true);
  assert.deepEqual(effort.attempt(search('A "B C"', { range: { start: 1, end: 2 } })), { allowed: false, reason: 'repeated-request', stop: true });
  assert.equal(effort.snapshot().toolAttempts, 5); assert.equal(effort.snapshot().duplicateAttempts, 2);
  assert.deepEqual(effort.attempt(search('after stop')), { allowed: false, reason: 'repeated-request', stop: true });
  assert.equal(effort.snapshot().toolAttempts, 5);
});

test('URL normalization removes fragments but preserves query, path case and other arguments', () => {
  const effort = createEffortTracker(limits('standard'));
  assert.equal(effort.attempt(fetch('https://EXAMPLE.com:443/Page?q=A#first')).allowed, true);
  assert.equal(effort.attempt(fetch('https://example.com/Page?q=A#second')).reason, 'duplicate-request');
  for (const input of [fetch('https://example.com/page?q=A'), fetch('https://example.com/Page?q=a'), fetch('https://example.com/Page?q=A', { mode: 'other' })]) assert.equal(effort.attempt(input).allowed, true);
});

test('all three aggregate ceilings include denied and invalid attempts and never upgrade depth', () => {
  for (const depth of ['quick', 'standard', 'deeper']) {
    const selected = limits(depth), effort = createEffortTracker(selected);
    for (let i = 0; i < selected.toolAttemptLimit; i++) {
      const reply = effort.attempt(i % 2 ? search(`query-${i}`) : search('x'.repeat(10000)));
      assert.equal(reply.allowed, !!(i % 2));
    }
    assert.deepEqual(effort.attempt(search('excess')), { allowed: false, reason: 'attempt-limit', stop: true });
    assert.equal(effort.snapshot().toolAttempts, selected.toolAttemptLimit + 1);
  }
});

test('malformed and oversized tool arguments cannot grow tracking or become equivalent valid requests', () => {
  const effort = createEffortTracker(limits('standard'));
  for (const input of [search(' '), search('query', { x: Infinity }), search('query', { a: { b: { c: { d: { e: true } } } } }), fetch('not a URL'), { toolName: 'web_search', toolArgs: [] }, search('query', { x: Array(33).fill('value') })]) {
    assert.deepEqual(effort.attempt(input), { allowed: false, reason: 'invalid-tool-input', stop: false });
  }
  assert.equal(effort.attempt(search('query')).allowed, true);
  assert.equal(effort.snapshot().duplicateAttempts, 0);
});

test('successful delivered text is bounded per search, page and request without splitting Unicode', () => {
  const effort = createEffortTracker(limits('deeper'));
  const page = effort.deliver('web_fetch', 'x'.repeat(32767) + '🌿tail');
  assert.equal(page.text, 'x'.repeat(32767)); assert.equal(page.truncated, true);
  const results = effort.deliver('web_search', 's'.repeat(20000));
  assert.equal(results.text.length, 8192); assert.equal(results.truncated, true);
  for (let i = 0; i < 10; i++) effort.deliver('web_fetch', 'z'.repeat(40000));
  assert.equal(effort.snapshot().deliveredTextUnits, 262144);
  assert.deepEqual(effort.deliver('web_fetch', 'not delivered'), { text: '', truncated: true });
  assert.deepEqual(effort.attempt(search('over text ceiling')), { allowed: false, reason: 'result-text-limit', stop: true });
  assert.equal(effort.snapshot().toolAttempts, 1);
});

test('small and blank text stays exact; snapshots cannot mutate operation state', () => {
  const effort = createEffortTracker(limits('quick'));
  assert.deepEqual(effort.deliver('web_fetch', '  exact 🌿\n'), { text: '  exact 🌿\n', truncated: false });
  assert.deepEqual(effort.deliver('web_search', ''), { text: '', truncated: false });
  const snapshot = effort.snapshot(); snapshot.toolAttempts = 900;
  assert.equal(effort.snapshot().toolAttempts, 0);
});

test('evidence plan and stop explanation are bounded model assessments with unknown legacy output', () => {
  const value = { plan: [{ criterion: 'Local access 🌿', neededEvidence: 'Opening hours and access constraints' }], stopReason: 'evidence-unavailable', explanation: 'The local fixture supplies no current opening hours.' };
  assert.deepEqual(effortAssessment(value), value); assert.equal(effortAssessment(undefined), null);
  assert.deepEqual(effortAssessment({ ...value, stopReason: 'in-progress' }, { partial: true }).plan, value.plan);
  for (const invalid of [{ ...value, stopReason: 'verified-truth' }, { ...value, stopReason: 'in-progress' }, { ...value, plan: [] }, { ...value, plan: Array(6).fill(value.plan[0]) }, { ...value, explanation: 'x'.repeat(601) }, { ...value, plan: [{ criterion: 'x'.repeat(201), neededEvidence: 'evidence' }] }, { ...value, extra: true }]) assert.throws(() => effortAssessment(invalid), /effort assessment/);
});
