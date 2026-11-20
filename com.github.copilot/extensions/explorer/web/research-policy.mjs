import { researchProfile, profileDetails, profileText, profileLabel } from './research-guidance.mjs';
const budgets = Object.freeze({ quick: [60000, 8], standard: [180000, 24], deeper: [300000, 40] });
export function researchSettings(value = { depth: 'standard', sourceFocus: 'balanced', recency: 'any' }) {
  if (!value || Array.isArray(value) || !['depth,recency,sourceFocus', 'depth,profile,recency,sourceFocus'].includes(Object.keys(value).sort().join(',')) ||
    !Object.hasOwn(budgets, value.depth) || !['balanced', 'primary'].includes(value.sourceFocus) || !['any', 'recent'].includes(value.recency)) throw new Error('Invalid research settings.');
  return Object.freeze({ depth: value.depth, sourceFocus: value.sourceFocus, recency: value.recency, ...(Object.hasOwn(value, 'profile') ? { profile: researchProfile(value.profile) } : {}) });
}
export function guidedResearchSettings(value, inherited) {
  const settings = researchSettings(value);
  const profile = researchProfile(settings.profile ?? inherited ?? { id: 'general', version: 1 });
  const details = profileDetails(profile);
  const reason = settings.profile ? 'Selected in this review.' : inherited ? 'Retained from the latest recorded profile in this research discussion.' : 'General is the default; no topic classification was inferred.';
  return Object.freeze({ settings: Object.freeze({ ...settings, profile }), guidance: Object.freeze({ ...profile, title: details.title, applicability: details.applicability, reason, text: profileText(profile) }) });
}
export function researchLimits(settings) {
  const [timeLimitMs, toolAttemptLimit] = budgets[researchSettings(settings).depth];
  return Object.freeze({ timeLimitMs, toolAttemptLimit });
}
export function researchSettingsText(settings) {
  if (!settings) return 'Research settings unknown (older or imported result).';
  const value = researchSettings(settings), limits = researchLimits(value);
  const effort = { quick: 'A focused first pass for a small evidence gap.', standard: 'Room to compare the main decision criteria.', deeper: 'More room for difficult or conflicting evidence.' }[value.depth];
  return `${profileLabel(value.profile)} ${value.depth[0].toUpperCase() + value.depth.slice(1)}: ${limits.timeLimitMs / 1000} seconds of operation time, including setup; at most ${limits.toolAttemptLimit} tool attempts, including denied attempts. ${effort} Stop early when sufficient support is assessed or remaining evidence is unavailable; no automatic deeper pass. Source focus: ${value.sourceFocus === 'primary' ? 'prefer primary sources' : 'balanced evidence'}. Recency: ${value.recency === 'recent' ? 'prefer recent sources when relevant' : 'no recency preference'}. Shutdown and usage accounting may continue afterward. Preferences do not guarantee source availability, freshness or accuracy; unknown publication dates stay unknown.`;
}
