# Copilot integration knowledge carried into Explorer

Assessed November 16, 2026 from `A:\Claude\copilot-usage-insights` and `A:\Claude\copilot-enhance-prompt`. Neither source repository was modified. Their current source and installed SDK declarations take precedence over historical handoff examples.

## Practices adopted

| Source | Lesson | Explorer implementation |
| --- | --- | --- |
| Enhance Prompt `AGENTS.md`, `src/copilot/extension.ts` | The host supplies the experimental SDK. Ship runnable backend and UI assets. | SDK imports stay external; the plugin ships plain JavaScript and local web assets. |
| Enhance Prompt `AGENTS.md`, `scripts/e2e.mjs` | Separate unit checks, real runtime fixtures, and manual/account verification. | Node tests plus a disposable runtime/local-provider smoke test; no desktop automation. |
| Enhance Prompt `src/copilot/server.ts` | Authenticate loopback traffic, validate origins and confine asset paths. | Random per-instance capability URLs, Host/Origin checks, JSON request cap, asset allowlist. |
| Enhance Prompt `AGENTS.md` | Atomic persistence and isolated async ownership prevent data loss. | Serialized writes, disk revision checks, exclusive write lock, request IDs and instance ownership. |
| Usage Insights `AGENTS.md` | Synchronize versions and write short release notes. | Four version checks and `release-notes.json`; no dashboard release browser was copied. |
| Both marketplace manifests and Enhance Prompt installation handoff | Use Copilot's CLI and the user's profile; local and GitHub installs behave differently. | `.github/plugin/marketplace.json`, CLI installer, explicit CLI path when absent from PATH. |
| Enhance Prompt icon investigation | A local install can lack session logo metadata; canvas icon overrides do not fix it. | Compact manifest SVG; document the local limitation and prefer GitHub marketplace distribution later. |

## Intentional differences

Explorer's Research and Save & explore deeper buttons deliberately queue a request in their attached chat. `/explore <topic>` authorizes the initial generation. The host owns model selection, permissions, tool availability, and billing records. The skill and queued instructions ask the agent to browse when appropriate, then complete a structured canvas action. Plain model reasoning is explicitly labeled. This route can create visible chat activity and wait behind other queued work.

Enhance Prompt's automatic-send approval flow, rewrite styles, code-reading policies, vendor migrations, React build pipeline, and product-specific usage aggregation are not Explorer requirements. They were not copied. Explorer's iteration and publishing workflow follows the owner's direct instructions recorded in [AGENTS.md](../AGENTS.md#complete-every-iteration).

Explorer does not read repository files, launch independent models, retain another plugin's credentials, or alter either reference project. Existing conversation context is naturally available to the attached Copilot agent; Explorer only submits the map context described in its request.

## Future background model work

Before replacing the attached-chat flow with hidden model sessions, read Enhance Prompt's `docs/copilot-sdk-agent-handoff.md`, `docs/copilot-background-rewriting.md`, `src/copilot/models.ts`, and `src/copilot/usage.ts`, plus Usage Insights' scanner integration. The host-paired executable and SDK, verified matching GitHub identity, eligible Copilot catalog, isolated temporary workspace, explicit tool permissions, cancellation, and durable accounting are all part of that approach. A general `CopilotClient` call alone is not an equivalent port.

Do not hardcode the reference runtime's versioned directory in production. Development scripts accept explicit paths to the inspected installed pair. Do not copy source-repository paths into runtime behavior.

## Install and release boundaries

For development, register this checkout as a local marketplace. Edits take effect in a new/restarted session. For distribution, publish the complete plugin package and register its GitHub repository. Adding a marketplace, installing a plugin, enabling it, and starting a session are distinct steps. CLI success plus plugin-list verification proves registration, not rendering.

The measured icon issue applies to Copilot desktop 1.4.2: local marketplace installs sometimes omit the owning plugin's logo from session metadata. The compact SVG is still correct. Native tab rendering remains a manual check.

## References

- [Enhance Prompt agent instructions](https://github.com/AndrewGodlewsky/copilot-enhance-prompt/blob/main/AGENTS.md)
- [Usage Insights agent instructions](https://github.com/AndrewGodlewsky/copilot-usage-insights/blob/main/AGENTS.md)
- [SDK handoff](https://github.com/AndrewGodlewsky/copilot-enhance-prompt/blob/main/docs/copilot-sdk-agent-handoff.md)
- [Plugin installation handoff](https://github.com/AndrewGodlewsky/copilot-enhance-prompt/blob/main/docs/copilot-plugin-installation-handoff.html)
- [Canvas icon investigation](https://github.com/AndrewGodlewsky/copilot-enhance-prompt/blob/main/docs/canvas-icon-investigation.md)
- [GitHub canvas documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions)
