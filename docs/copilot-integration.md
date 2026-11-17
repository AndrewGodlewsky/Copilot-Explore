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

Initial questions and Save & explore deeper deliberately queue a request in the attached chat. `/explore <topic>` authorizes initial generation. The host owns that chat's model, permissions and billing. Its generated questions return through a correlated canvas action into an unsaved preview. Only explicit user acceptance commits nodes; native get_exploration and future generation context exclude proposals. See [question preview contracts](question-preview.md). Research options instead starts the isolated helper described below; its conversation stays out of the main chat.

Enhance Prompt's automatic-send approval flow, rewrite styles, code-reading policies, vendor migrations, React build pipeline, and product-specific usage aggregation are not Explorer requirements. They were not copied. Explorer's iteration and publishing workflow follows the owner's direct instructions recorded in [AGENTS.md](../AGENTS.md#complete-every-iteration).

Explorer reads no repository context and changes neither reference project. The attached agent can use its existing conversation for questions. The researcher receives only a bounded snapshot of the selected path and saved decisions, plus Explorer's packaged research instructions; it has no access to the main conversation or unsaved drafts.

## Background model work

Research follows Enhance Prompt's `docs/copilot-sdk-agent-handoff.md`, `docs/copilot-background-rewriting.md`, `src/copilot/models.ts`, and `src/copilot/usage.ts`. It uses the host-paired executable and SDK, verifies matching GitHub identity and an eligible Copilot catalog model, creates an empty temporary workspace/configuration, validates exactly two web tools before inference, and retains usage receipts before cleanup. The parent model is read, never changed. External providers or unavailable models fail before inference.

`research.mjs` explicitly reads `research/skills/explorer-research/SKILL.md` into the helper's system prompt. This makes the curated instructions available on every research run without ambient skill discovery. The model returns strict JSON validated by `model.mjs`; a third result tool is unnecessary. Only built-in `web_fetch` and GitHub MCP `web_search` are enabled. Public URL and MCP permissions are narrowly scoped; managed human approval and sandbox bypass stop the helper with a visible error. Successful fetch hooks establish citation eligibility, not factual correctness. Missing hook IDs fail visibly rather than attributing a read to the wrong page. Missing search fails visibly; retrieval failures may produce clearly labeled reasoning without sources. See [the installed-runtime findings](research-sdk-tools.md) for why configuration discovery must be enabled inside the isolated directories.

The helper has a three-minute overall deadline and a 24-tool-call ceiling; its instructions request at most four searches and eight page reads. Cancel or canvas close stops the owned client. The controller rejects late results and does not expose a research callback to the main chat. The helper's temporary conversation is removed after stopping and reconciling usage. Failure to stop or retain accounting preserves the temporary directory and a `usage/recovery-<session>.json` pointer where possible.

Usage projection was adapted from Enhance Prompt into `research-usage.mjs`, with Explorer's identity and explicit data directory. Live and durable receipts are deduplicated by accounting ID. Retained fields include model, tokens, credits/status and accounting identifiers, excluding prompts, results, account names, provider endpoints and credentials. Explorer's `usage/` directory uses a Copilot-compatible `session-state/` layout. Usage Insights does not automatically discover this new location; add it as an extra Copilot home there if desired. No changes were made to that plugin.

Do not hardcode the reference runtime's versioned directory in production. Development scripts accept explicit paths to the inspected installed pair. Do not copy source-repository paths into runtime behavior.

`npm run e2e:research` runs the actual installed SDK with anonymous loopback model/MCP fixtures. Only identity/catalog reads are substituted for the local provider; tool discovery, permissions, hooks, prompts, JSON validation, cancellation and usage journals are real. It does not verify production account entitlement, organization policy enforcement, live source quality or desktop rendering. Unit tests separately cover mismatches, missing tools, unread citations, late results and draft preservation.

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

## Direction seeds

Missing-direction input uses the existing browser command/persistence boundary, followed by attached-session `send({ mode: 'enqueue' })`; it adds no SDK helper or native action. Generation accepts an unanswered user direction and stages children for explicit preview acceptance. The saved seed remains available after a failed or cancelled send. Direction ancestors remain labeled user context in the isolated research helper and never become user decisions. See [direction schema and counting contracts](question-preview.md#missing-directions). The installed fixtures cover no-answer seed generation/acceptance and direction context reaching isolated research; visible native rendering and live model quality remain manual checks.
