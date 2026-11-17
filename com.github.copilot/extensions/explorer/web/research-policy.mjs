const budgets = Object.freeze({ quick: [60000, 8], standard: [180000, 24], deeper: [300000, 40] });
export function researchSettings(value = { depth: 'standard', sourceFocus: 'balanced', recency: 'any' }) {
  if (!value || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'depth,recency,sourceFocus' ||
    !Object.hasOwn(budgets, value.depth) || !['balanced', 'primary'].includes(value.sourceFocus) || !['any', 'recent'].includes(value.recency)) throw new Error('Invalid research settings.');
  return Object.freeze({ depth: value.depth, sourceFocus: value.sourceFocus, recency: value.recency });
}
export function researchLimits(settings) {
  const [timeLimitMs, toolAttemptLimit] = budgets[researchSettings(settings).depth];
  return Object.freeze({ timeLimitMs, toolAttemptLimit });
}
export function researchSettingsText(settings) {
  if (!settings) return 'Research settings unknown (older or imported result).';
  const value = researchSettings(settings), limits = researchLimits(value);
  return `${value.depth[0].toUpperCase() + value.depth.slice(1)}: ${limits.timeLimitMs / 1000} seconds of operation time, including setup; at most ${limits.toolAttemptLimit} tool attempts, including denied attempts. Source focus: ${value.sourceFocus === 'primary' ? 'prefer primary sources' : 'balanced evidence'}. Recency: ${value.recency === 'recent' ? 'prefer recent sources when relevant' : 'no recency preference'}. Shutdown and usage accounting may continue afterward. Preferences do not guarantee source availability, freshness or accuracy; unknown publication dates stay unknown.`;
}
