# Isolated SDK research tools

Assessed November 16, 2026 against the installed Copilot SDK/runtime pair `1.0.106-8.unstable.r43566476370.g869eef3`. No paid inference, existing user session, browser automation, downloaded SDK, or added dependency was used for this investigation.

## Finding

The installed runtime can initialize and verify `web_fetch` and `web_search` before sending a model prompt. They have different sources: `web_fetch` is a built-in tool; `web_search` comes from the runtime-managed `github-mcp-server`. An anonymous custom-provider session with configuration discovery disabled cannot demonstrate the latter's live availability. This is an explicit runtime gate, not evidence that the SDK lacks web search. [Installed runtime: `shouldInjectBuiltInGitHubMcp`, `resolveBuiltInGitHubMcpConfig`, `initializeAndValidateTools`](C:/Users/godle/AppData/Local/copilot/pkg/win32-x64/1.0.106-8.unstable.r43566476370.g869eef3/cli-main.js)

The runtime's GitHub MCP injection requires `enableConfigDiscovery === true`; it also skips injection when a custom provider is present. For explicit static GitHub tokens there is an additional gate. Explorer should use the existing logged-in-user authentication flow and compare the helper identity with the attached session, as Enhance Prompt does, rather than extract a token or manually build an authenticated MCP configuration. [Installed runtime: `shouldInjectBuiltInGitHubMcp`, `resolveSessionAuth`, `resolveBuiltInGitHubMcpConfig`](C:/Users/godle/AppData/Local/copilot/pkg/win32-x64/1.0.106-8.unstable.r43566476370.g869eef3/cli-main.js), [Enhance Prompt helper implementation](https://github.com/AndrewGodlewsky/copilot-enhance-prompt/blob/main/src/copilot/models.ts)

VS Code's agent-host documentation independently identifies this unprefixed `web_search` as an MCP tool and explains that its `mcpServerName` distinguishes it from built-ins. [VS Code agent-host instructions](https://github.com/microsoft/vscode/blob/main/src/vs/platform/agentHost/AGENTS.md)

## Configuration boundary

For an isolated research helper, retain a new temporary workspace, a new `baseDirectory`/`configDirectory`, `mode: 'empty'`, no bundled plugin directories, and `useLoggedInUser: true`. Do not set a custom provider in production. Use the host-paired SDK and executable already selected by the extension. These preserve the identity, model eligibility, accounting, and cancellation checks described in the [integration handoff](copilot-integration.md#background-model-work).

The relevant research-specific session settings are:

```js
{
  enableConfigDiscovery: true,
  githubMcpToolConfig: {
    enableAllTools: false,
    additionalToolsets: [],
    additionalTools: ['web_search'],
  },
  availableTools: ['builtin:web_fetch', 'mcp:web_search'],
  mcpServers: {},
  requestExtensions: false,
  requestCanvasRenderer: false,
  pluginDirectories: [],
  enableSkills: false,
  enableFileHooks: false,
  skipCustomInstructions: true,
  enableOnDemandInstructionDiscovery: false,
  enableSessionStore: false,
  enableHostGitOperations: false,
  skillDirectories: [],
  agentDirectories: [],
  instructionDirectories: [],
  hookDirectories: [],
  memory: { enabled: false },
  infiniteSessions: { enabled: false },
}
```

`additionalTools` requests search from the GitHub MCP configuration; it does not by itself restrict the session to search. The source-qualified `availableTools` filter supplies that restriction. In particular, `builtin:web_search` would identify the wrong source. The SDK documents source-qualified allowlists and deny-wins exclusions. [Installed SDK `types.d.ts`, `GitHubMcpToolConfig` and `SessionConfigBase`](C:/Users/godle/AppData/Local/github-copilot-sdk/cli/copilot-sdk-runtime-1.0.106-8.unstable.r43566476370.g869eef3/copilot-sdk/types.d.ts)

Configuration discovery reads settings, installed plugins, and MCP configuration using the session's configuration directory, and can discover workspace sources. Consequently, `mcpServers: {}` is not a general MCP-disable switch: explicit entries merge with discovered entries. An empty disposable configuration directory and workspace remain necessary when enabling discovery. Keep explicit opt-outs above and verify the resulting tools; do not turn discovery on against the user's real project or configuration directory. [Installed runtime: `resolveDiscoveredConfig`, `resolveBuiltInGitHubMcpConfig`, session creation merge](C:/Users/godle/AppData/Local/copilot/pkg/win32-x64/1.0.106-8.unstable.r43566476370.g869eef3/cli-main.js)

## Verification before inference

Run `session.rpc.tools.initializeAndValidate()`, then `session.rpc.tools.getCurrentMetadata()`. The installed implementation awaits MCP catalog readiness during initialization. The public RPC declaration explicitly identifies initialization before `send` as a supported use. A paid bootstrap prompt is unnecessary. [Installed runtime: `initializeAndValidateTools`](C:/Users/godle/AppData/Local/copilot/pkg/win32-x64/1.0.106-8.unstable.r43566476370.g869eef3/cli-main.js), [Installed SDK RPC declarations, `tools.initializeAndValidate`, `tools.getCurrentMetadata`](C:/Users/godle/AppData/Local/github-copilot-sdk/cli/copilot-sdk-runtime-1.0.106-8.unstable.r43566476370.g869eef3/copilot-sdk/generated/rpc.d.ts)

Require exactly the intended tools and validate their origins, not only the display names:

| Tool | Expected metadata |
| --- | --- |
| Fetch | `name: 'web_fetch'`, with no MCP identity |
| Search | `name: 'web_search'`, `namespacedName: 'github-mcp-server/web_search'`, `mcpServerName: 'github-mcp-server'`, `mcpToolName: 'web_search'` |

If search is absent or initialization fails, fail before sending research to the model. Do not present a reasoning-only answer as sourced research. If needed for diagnostics, `session.rpc.mcp.list()` can initialize and wait for servers; `mcp.listConfigured()` is configuration-only and explicitly is not a readiness guarantee. `mcp.listTools({ serverName: 'github-mcp-server' })` makes a live tools/list request to an already-connected server. [Installed SDK RPC declarations, `CurrentToolMetadata` and `mcp`](C:/Users/godle/AppData/Local/github-copilot-sdk/cli/copilot-sdk-runtime-1.0.106-8.unstable.r43566476370.g869eef3/copilot-sdk/generated/rpc.d.ts)

## Permissions

The installed MCP permission shape is `{ kind: 'mcp', serverName, toolName, toolTitle, readOnly, args?, toolCallId? }`. The URL permission shape includes `{ kind: 'url', url, intention, managedApprovalRequired?, requestSandboxBypass?, redirectedFrom?, toolCallId? }`. Approve only the verified GitHub MCP search identity and eligible public HTTP(S) URL requests for this research operation; deny unrelated permission kinds. A managed human-approval requirement or a sandbox-bypass request must not receive a blanket automatic approval. Preserve redirect URL validation. These are the actual discriminated union members, not generic strings inferred from tool names. [Installed SDK session-event declarations, `PermissionRequestMcp` and `PermissionRequestUrl`](C:/Users/godle/AppData/Local/github-copilot-sdk/cli/copilot-sdk-runtime-1.0.106-8.unstable.r43566476370.g869eef3/copilot-sdk/generated/session-events.d.ts)

## Local evidence and remaining limits

An anonymous disposable test used the installed executable/SDK with a loopback MCP fixture named `github-mcp-server`, a local custom-provider URL that rejected inference, and the exact allowlist `['builtin:web_fetch', 'mcp:web_search']`. The fixture advertised both `web_search` and an unwanted tool. Before any `send`, `initializeAndValidate()` caused MCP initialize/tools/list requests and produced exactly the two metadata entries shown above. The unwanted tool was excluded. The model endpoint received **zero requests**. The process was stopped and its verified temporary directory was removed.

That result verifies filter syntax, tool provenance metadata, MCP initialization, and readiness before inference on the installed runtime. It does not verify the signed-in account's remote GitHub MCP entitlement, live search quality, or current web results. Those remain account/runtime checks in the production helper and manual functional verification. The local-provider fixture intentionally cannot test the built-in GitHub MCP injection gate.
