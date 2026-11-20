// Original Explorer guidance, v1. No third-party skill text adapted. See docs/research-guidance.md.
export const researchProfiles = Object.freeze([
  {
    id: 'general', title: 'General',
    applicability: 'Default for mixed, unfamiliar or uncertain topics; choose a specific profile only when it fits the question.',
    sources: 'Use the common research source and evidence rules; no specialty is assumed.',
    criteria: 'Identify the decision and missing context before comparing plausible answers.',
    freshness: 'Use the common claim-specific freshness rules.',
    stopping: 'Use the common evidence checklist and selected effort limit.',
    uncertainty: 'Do not imply domain expertise. Ask for the missing context when a useful comparison is not justified.',
  },
  {
    id: 'software-version', title: 'Software and versions',
    applicability: 'Choose for software adoption, compatibility, upgrades or migration decisions with relevant versions and environments.',
    sources: 'Prefer official versioned documentation, release notes and compatibility statements. Separate observed project facts from assumed versions or configuration; identify the applicable version for each material claim.',
    criteria: 'Compare compatibility with stated constraints, maintenance, migration and rollback effort, operational requirements and the smallest useful trial. Mark missing project facts as questions for the user.',
    freshness: 'Check whether evidence describes the target release and the relevant deployment environment. Label historical or unknown applicability; a recent page does not establish compatibility.',
    stopping: 'Stop when the material compatibility and decision criteria have support, or the effort limit or an unresolved version gap prevents a reliable choice. State the specific fact that would resolve the gap.',
    uncertainty: 'Separate documented capabilities from inferred fit. An unknown installed version, unsupported migration claim or missing critical constraint can prevent a recommendation.',
  },
  {
    id: 'product-service', title: 'Products and services',
    applicability: 'Choose for a purchase or service comparison whose capabilities, costs, availability or terms affect the decision.',
    sources: 'Use manufacturer or provider specifications and applicable terms for factual capabilities. Distinguish seller claims from independent experience, and explain the limits of anecdotal reviews.',
    criteria: 'Compare fit to the stated use, total cost, availability, compatibility, accessibility, repair or exit options, and the tradeoff that matters most to this user. Use only criteria supported by their context.',
    freshness: 'Price, availability and terms need a relevant date, region, currency and variant. Keep unknown fields unknown. A retrieval date alone does not show when an offer or policy took effect.',
    stopping: 'Stop when the decision-relevant capabilities and constraints are covered or a missing applicable offer, specification or user priority blocks comparison. State what to check next.',
    uncertainty: 'Qualify marketing evidence, unavailable independent testing and variant differences. Avoid ranking alternatives whose decisive costs or constraints remain unknown.',
  },
  {
    id: 'concept-design', title: 'Concepts and design tradeoffs',
    applicability: 'Choose for explaining concepts or comparing approaches where goals, assumptions and tradeoffs matter more than a particular product.',
    sources: 'Use primary explanations or established references where factual grounding helps. Make definitions and assumptions explicit; distinguish a useful analogy from evidence about the user\'s situation.',
    criteria: 'Compare the competing goals, who bears each cost, reversibility, feedback and a small experiment. Use the map\'s stated examples and priorities without turning hypothetical changes into saved decisions.',
    freshness: 'Stable concepts need relevant, applicable support rather than a recent date for its own sake. Separate durable principles from claims about current tools, organizations or practices.',
    stopping: 'Stop when the alternatives and their principal tradeoffs are understandable, or a missing priority prevents choosing. Give a focused clarifying question or reversible experiment.',
    uncertainty: 'Label value judgments and context-dependent reasoning. Several coherent approaches may remain viable; explain why a recommendation is conditional or why none is justified.',
  },
].map(profile => Object.freeze({ ...profile, version: 1 })));

export function researchProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'id,version' ||
    !researchProfiles.some(profile => profile.id === value.id && profile.version === value.version)) throw Error('Invalid research guidance profile.');
  return Object.freeze({ id: value.id, version: value.version });
}
export function profileDetails(value) {
  const ref = researchProfile(value);
  return researchProfiles.find(profile => profile.id === ref.id && profile.version === ref.version);
}
export function profileLabel(value) {
  if (value === undefined) return 'Guidance profile not recorded (older or imported result).';
  const profile = profileDetails(value);
  return `Guidance: ${profile.title} (${profile.id} v${profile.version}).`;
}
export function profileText(value) {
  const profile = profileDetails(value);
  const text = [`${profile.title} (${profile.id} v${profile.version})`, profile.applicability,
    ...['sources', 'criteria', 'freshness', 'stopping', 'uncertainty'].map(key => `${key}: ${profile[key]}`)].join('\n');
  if (new TextEncoder().encode(text).byteLength > 4096) throw Error('Research guidance exceeds its 4 KiB limit.');
  return text;
}
