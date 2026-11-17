export const MODES = Object.freeze({
  understand: { label: 'Understand', description: 'Map concepts, stakeholders and unknowns.', strategy: 'Map concepts, stakeholders and unknowns.' },
  decide: { label: 'Decide', description: 'Surface choices, criteria and tradeoffs.', strategy: 'Surface choices, criteria and tradeoffs.' },
  design: { label: 'Design', description: 'Explore intended outcomes, constraints, interfaces and feasibility.', strategy: 'Explore intended outcomes, constraints, interfaces and feasibility.' },
  diagnose: { label: 'Diagnose', description: 'Ask about symptoms, reproduction, evidence and alternative causes.', strategy: 'Ask about symptoms, reproduction, evidence and alternative causes.' },
  challenge: { label: 'Challenge', description: 'Test assumptions, counterexamples and possible failure conditions.', strategy: 'Test assumptions, counterexamples and possible failure conditions.' },
});
export const effectiveMode = doc => doc?.mode ?? 'understand';
export function validMode(mode) {
  if (typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) throw new Error('Invalid exploration mode.');
  return mode;
}
export const modePolicy = mode => MODES[validMode(mode)].strategy;
