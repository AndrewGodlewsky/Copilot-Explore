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

Answer cleanup shares `owned-helper.mjs` with research for owned client/session creation, account/catalog/model/workspace checks, the 180-second overall ceiling and existing phase deadlines, cancellation, journal reconciliation and cleanup/recovery. `research.mjs` retains its curated prompt, web permissions, tool budget and source verification. `cleanup.mjs` supplies fixed conservative instructions and only the captured answer as JSON data; it disables configuration discovery and GitHub MCP tools, denies permission/tool hooks, and requires an initialized metadata list of exactly zero tools before inference. No question, other answer, project file or attached-chat context is supplied. The selected host model is read and validated, never changed. Enhance Prompt's focused `models.ts` empty-helper implementation and installed SDK declarations were checked read-only for this seam.

The browser uses protected `POST api/cleanup` with `start`, `poll` and `cancel`, bound to request ID, journey, node and text-mutation identity. Each instance has one operation; a replacement waits for the previous helper to release. The controller's private proposal never enters `snapshot()`, `uiSnapshot()`, native `get_exploration` or chat notifications. The browser owns original/proposed/undo text until review ends. State-only edits and focus do not increment `DraftClient.textGeneration`; text edits, recovery/discard and committed-text replacement do, including A-to-B-to-A. Apply and Undo use ordinary draft editing and preserve state selection; streaming voice still returns its durable draft flush promise before acknowledgment.

Input and decoded output are nonblank and at most 20,000 UTF-16 code units, without truncation. Output is strict JSON with exactly one `text` field and a 121,000-character serialized cap allowing six-character escapes. The HTTP request cap is 128 KiB, measured in bytes. Normal retained usage is allowlisted and labeled `Explorer Answer Cleanup`; legacy research receipts remain `Explorer Research`. Receipts exclude original/proposed text and prompts. Recovery retains an unreconciled helper journal when stopping/accounting fails, without retrying inference.

`npm run e2e:cleanup` uses the installed pair with disposable directories and an anonymous loopback model fixture. It verifies real empty tool metadata, isolation configuration, captured Unicode input, strict output, attributed usage and cancelled-session release; only account/catalog reads are substituted. It does not prove live model meaning preservation, account entitlement, organization policy or visible desktop rendering. Review actual proposals and perform native keyboard/narrow-pane checks manually.

Question help shares that owned tool-free lifecycle and a single per-instance cleanup/help release queue. Only one inference can run; the other feature requires explicit cancellation while one is pending. Its prompt receives the saved selected question/category, topic/objective/success criteria and complete nearest ancestor question/answer/state records within 16,000 serialized JavaScript characters. Omitted ancestor IDs (or a count when IDs no longer fit) are reported in the prompt; omitted records do not become freshness dependencies. The controller compares included saved records and guidance with disk at start and before returning a result, without holding the writer lock during inference. The protected `api/question-help` workflow returns one transient result with the exact context sent; the browser keeps up to three operation results only for the active node, clearing any whose included source changes, or all on navigation or reload. The selected answer, drafts, rationale, research, sibling branches and previous help are excluded. Output is strict `{text}` up to 4,000 characters, rendered as literal text. Usage receipts are attributed separately to Rephrase, Example and Terms. `npm run e2e:question-help` checks all three operations against the installed local runtime with zero initialized tools, attributed usage and cancellation.

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
