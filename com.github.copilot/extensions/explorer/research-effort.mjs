import { researchSettings, researchLimits } from './web/research-policy.mjs';
const searchNames = new Set(['web_search', 'github-mcp-server-web_search', 'github-mcp-server/web_search']);
const MAX_TOOL_TEXT = 262144;

function toolKey(input) {
  const fetch = input.toolName === 'web_fetch', search = searchNames.has(input.toolName);
  if (!fetch && !search) return null; // Other tools are denied by the existing allowlist, but still consume an attempt.
  const budget = { nodes: 0, units: 0 };
  const normalize = (value, depth = 0) => {
    if (++budget.nodes > 128 || depth > 4) throw Error();
    if (typeof value === 'string') { budget.units += value.length; if (budget.units > 8192) throw Error(); return value; }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) { if (value.length > 32) throw Error(); return value.map(item => normalize(item, depth + 1)); }
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error();
    const keys = Object.keys(value).sort(); if (keys.length > 32) throw Error();
    return Object.fromEntries(keys.map(key => { budget.units += key.length; if (budget.units > 8192) throw Error(); return [key, normalize(value[key], depth + 1)]; }));
  };
  const args = normalize(input.toolArgs);
  if (!args || Array.isArray(args) || typeof args !== 'object') throw Error();
  if (fetch) {
    if (typeof args.url !== 'string' || args.url.length > 2000) throw Error();
    const url = new URL(args.url); url.hash = ''; args.url = url.href;
  } else {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 4000) throw Error();
    args.query = args.query.trim();
  }
  const key = JSON.stringify([fetch ? 'fetch' : 'search', args]);
  if (key.length > 8192) throw Error();
  return key;
}

export function createEffortTracker(limits) {
  const maximum = limits?.toolAttemptLimit;
  if (![8, 24, 40].includes(maximum)) throw Error('Invalid research effort limit.');
  const seen = new Map();
  let toolAttempts = 0, duplicateAttempts = 0, deliveredTextUnits = 0, truncatedResults = 0, stopped;
  const stop = reason => { stopped = reason; return { allowed: false, reason, stop: true }; };
  return {
    attempt(input) {
      if (stopped) return stop(stopped);
      if (++toolAttempts > maximum) return stop('attempt-limit');
      if (deliveredTextUnits >= MAX_TOOL_TEXT) return stop('result-text-limit');
      let key;
      try { key = toolKey(input); } catch { return { allowed: false, reason: 'invalid-tool-input', stop: false }; }
      if (key !== null) {
        const count = (seen.get(key) ?? 0) + 1; seen.set(key, count);
        if (count > 1) {
          duplicateAttempts++;
          if (count > 2) return stop('repeated-request');
          return { allowed: false, reason: 'duplicate-request', stop: false };
        }
      }
      return { allowed: true };
    },
    deliver(toolName, value) {
      if (typeof value !== 'string') throw Error('Invalid research tool text.');
      let length = stopped ? 0 : Math.min(value.length, toolName === 'web_fetch' ? 32768 : 8192, MAX_TOOL_TEXT - deliveredTextUnits);
      if (length < value.length && length > 0 && /[\uD800-\uDBFF]/.test(value[length - 1]) && /[\uDC00-\uDFFF]/.test(value[length])) length--;
      const text = value.slice(0, length), truncated = length < value.length;
      deliveredTextUnits += text.length; if (truncated) truncatedResults++;
      return { text, truncated };
    },
    snapshot: () => ({ toolAttempts, duplicateAttempts, deliveredTextUnits, truncatedResults }),
  };
}

export function effortAssessment(value, { partial = false } = {}) {
  if (value === undefined) return null;
  const validText = (text, max) => typeof text === 'string' && !!text.trim() && text.length <= max;
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'explanation,plan,stopReason' ||
    !Array.isArray(value.plan) || !value.plan.length || value.plan.length > 5 ||
    ![...(partial ? ['in-progress'] : []), 'sufficient-support', 'evidence-unavailable', 'selected-budget'].includes(value.stopReason) || !validText(value.explanation, 600) ||
    value.plan.some(item => !item || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'criterion,neededEvidence' || !validText(item.criterion, 200) || !validText(item.neededEvidence, 300))) throw Error('Invalid research effort assessment.');
  return { plan: value.plan.map(item => ({ criterion: item.criterion, neededEvidence: item.neededEvidence })), stopReason: value.stopReason, explanation: value.explanation };
}

export function effortReport(value, validatePartial) {
  const invalid = () => { throw Error('Invalid research effort report.'); };
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'assessment,deliveredTextUnits,duplicateAttempts,elapsedMs,partial,reason,settings,toolAttempts,truncatedResults') invalid();
  const settings = researchSettings(value.settings), limit = researchLimits(settings).toolAttemptLimit;
  const reasons = ['model-completed', 'deadline', 'attempt-limit', 'repeated-request', 'result-text-limit', 'tool-failure', 'helper-failure'];
  if (!reasons.includes(value.reason) || value.elapsedMs !== null && (!Number.isSafeInteger(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > 3600000)) invalid();
  for (const [key, max] of [['toolAttempts', limit + 1], ['duplicateAttempts', value.toolAttempts], ['deliveredTextUnits', MAX_TOOL_TEXT], ['truncatedResults', limit]]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > max) invalid();
  }
  if (value.reason === 'model-completed' && (value.partial !== null || value.toolAttempts > limit) ||
    value.reason === 'helper-failure' && value.partial !== null || value.reason === 'attempt-limit' && value.toolAttempts !== limit + 1 ||
    value.reason === 'repeated-request' && value.duplicateAttempts < 2 || value.partial === undefined) invalid();
  return { settings, reason: value.reason, elapsedMs: value.elapsedMs, toolAttempts: value.toolAttempts, duplicateAttempts: value.duplicateAttempts,
    deliveredTextUnits: value.deliveredTextUnits, truncatedResults: value.truncatedResults,
    assessment: effortAssessment(value.assessment ?? undefined, { partial: value.reason !== 'model-completed' }), partial: value.partial === null ? null : validatePartial(value.partial) };
}
