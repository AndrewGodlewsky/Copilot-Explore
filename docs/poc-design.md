# Explorer proof of concept

The user wants to understand an idea by choosing how deeply to explore each direction. A central idea branches into questions; answering grows a branch, and research offers options before the user decides. Finish produces a complete Markdown record and a portable file that can be reopened.

## Implementation choice

Use a native GitHub Copilot canvas and a bundled `/explore` skill. A separate browser app would lose the requested in-app workflow; an MCP UI would add an unnecessary integration layer. The desktop runtime supplies the SDK. This POC has no npm dependencies or separate AI credentials.

The active Copilot session handles generation and research through queued messages and structured canvas actions. Research depends on the tools and permissions available in that session. The interface identifies sourced research versus model reasoning. AI never answers a question on the user's behalf.

## Interaction

```
Explorer                 Open file   Save file   Finish
                  | Selected question
  question—IDEA—question | Category / breadcrumb
           |            | Research options + sources
         question       | Your answer
                        | Save & explore deeper
```

The idea stays at the center, with branches growing left and right. A dotted map, blue selection, muted category colors, and visible answered/open states carry the visual hierarchy. Segoe UI/system text, paper white #f5f8fa, ink #183544, blue #246783, amber #b47d22, and slate #6d7d87. The map is the distinctive element; controls stay quiet. A keyboard-accessible outline complements pan and zoom. Narrow panels stack the inspector below the map.

## Data and boundaries

- Flat nodes with parent IDs; no fixed exploration depth. Practical POC limits: 5,000 nodes, 9 MiB saved data, 10 MiB imports, 20,000 characters per answer.
- Each canvas instance has an independent, atomically saved `.explore.json` document in Copilot's plugin-data directory.
- UI writes and agent callbacks are serialized. Correlated request IDs reject stale replies. Cancel stops accepting a result, not the host's running turn.
- Editing an answer preserves existing descendants and marks them for review.
- Export includes unanswered branches, answers, research, sources, and relationships. Imported schema versions and parent links are validated before replacing state.
- Loopback HTTP, per-instance capability token, same-origin writes, plain-text rendering, and no network assets.

This is an iteration POC, not a production release. Browser/desktop UI automation is excluded by the user's preference; the user performs the final visual and in-app checks. Automated checks cover map behavior, save/reload/export, server boundaries, and the SDK registration contract.

## Host references

- https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- Installed runtime SDK `canvas.d.ts`, `extension.d.ts`, and `docs/extensions.md`, inspected November 16, 2026.
