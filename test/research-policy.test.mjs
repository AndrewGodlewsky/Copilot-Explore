import test from 'node:test';
import assert from 'node:assert/strict';
import { researchSettings, researchLimits } from '../com.github.copilot/extensions/explorer/web/research-policy.mjs';

test('research preferences have exact bounded defaults and reject unsupported input', () => {
  assert.deepEqual(researchSettings(), { depth: 'standard', sourceFocus: 'balanced', recency: 'any' });
  for (const [depth, timeLimitMs, toolAttemptLimit] of [['quick', 60000, 8], ['standard', 180000, 24], ['deeper', 300000, 40]]) {
    assert.deepEqual(researchLimits(researchSettings({ depth, sourceFocus: 'primary', recency: 'recent' })), { timeLimitMs, toolAttemptLimit });
  }
  for (const value of [null, {}, [], { depth: 'unlimited', sourceFocus: 'balanced', recency: 'any' }, { depth: 'quick', sourceFocus: 'official-only', recency: 'any' }, { depth: 'quick', sourceFocus: 'primary', recency: 2026 }, { depth: 'quick', sourceFocus: 'primary', recency: 'recent', toolAttemptLimit: 999 }]) assert.throws(() => researchSettings(value), /settings/i);
});
