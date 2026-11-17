export const toolFreeConfig = {
  availableTools: [],
  githubMcpToolConfig: { enableAllTools: false, additionalToolsets: [], additionalTools: [] },
  onPermissionRequest: () => ({ kind: 'denied-by-rules', rules: [] }),
  hooks: { onPreToolUse: () => ({ permissionDecision: 'deny', permissionDecisionReason: 'This Explorer helper cannot use tools.' }) },
};

export function validateNoTools(value, fail) {
  if (!Array.isArray(value.tools) || value.tools.length !== 0) throw fail('Explorer could not verify a tool-free helper session. Update Copilot and try again.');
}
