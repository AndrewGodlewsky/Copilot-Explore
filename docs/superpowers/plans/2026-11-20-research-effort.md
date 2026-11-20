# Bounded research effort implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task, with one final independent reviewer. Checkboxes record implementation; the ignored iteration completion receipt records the final frozen release gates.

**Goal:** Deliver approved issue #108: useful research that stops within chosen limits, explains why, and retains a validated partial without replacing completed research.

**Architecture:** Keep the existing owned helper and fixed budgets. A request-local effort tracker bounds exact repeated tool arguments and delivered successful tool text. A narrow optional event/report seam observes complete checkpoints and reports only after cleanup; the controller validates current context before retaining one transient attempt. The bottom drawer displays that attempt separately from durable research. No new provider, tool, global cache or inference retry.

**Tech stack:** Shipped ES modules, Node test runner/JSDOM, installed Copilot SDK/runtime, authorized Brave. No runtime dependency or bundling.

**Spec:** [#108](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/108), including its resolved-readiness and implementation comments; [development workflow](../../development-workflow.md); existing reviewed context and freshness contracts. Implementation choices are delegated by the owner. Details below are implementation decisions, not additional owner-selected promises.

## Constraints and decisions

- Quick remains 60000ms/8 attempts; Standard180000ms/24; Deeper300000ms/40. Startup and denied attempts count; shutdown/accounting may finish later.
- A small evidence checklist and sufficient-support/unavailable-evidence explanation are model assessments. Host-observed deadline, attempt ceiling, repeated request, text ceiling and tool failure are separate reasons.
- Normalize only exact tool arguments: stable object-key order, trimmed search query, canonical fragment-free fetch URL. Preserve query case, internal whitespace, other arguments, URL query strings and arrays. Do not claim semantic deduplication. Bound arguments and reject unsupported shapes.
- Deny the first exact duplicate; stop on its next repetition. All denied calls count. No application retry. Stop on tool failure; do not feed an unbounded error/retry loop back through research.
- Deliver at most32768 UTF-16 units per successful page,8192 per successful search and262144 across the request, without splitting surrogate pairs. Remove binary model payloads. Pair date-label eligibility with the actual delivered prefix. This is a model-context bound, not a transport or native-log privacy guarantee; #41/#42 remain open.
- Reserve remaining effort for a final answer through bounded hook guidance. Guidance cannot enforce factual sufficiency or force a model to return useful findings; hard ceilings remain authoritative.
- Optional `effortAssessment` is a bounded public checklist/explanation, never private chain of thought: up to5 `{criterion,neededEvidence}` records,200/300 units each; stopReason is `sufficient-support`, `evidence-unavailable`, `selected-budget` or checkpoint-only `in-progress`; explanation max600. Missing assessment remains unreported.
- A checkpoint is exactly `{checkpointVersion:1,findings:{...ordinary-or-followup-output}}` in one complete root `assistant.message`, not deltas, reasoning, replay, subagent or split chunks. Inspect at most4 tagged checkpoints and retain one valid normalized result. Ordinary partials cannot name a recommended winner. Existing result size, source receipt, date, qualification and freshness validation remains required.
- Report observed tool attempts, denied duplicates, delivered text and elapsed operation time; do not invent token/credit totals or prices. Retained accounting remains authoritative and separate.
- Keep one last attempt per canvas. Partials never enter durable research, context preparation, exports or native snapshots; navigation may hide them, journey switch/close clears them, and explicit Clear removes them. Explain this retention. A new failed attempt cannot replace the previous complete research or the answer.
- Publish a report only after confirmed shutdown, accounting and cleanup. Cancellation, identity/context/freshness conflict or cleanup failure cannot publish late partials. An explicit deeper-pass button opens review at the next depth, never starts inference; Deeper offers ordinary reviewed retry.

## Review focus

- Duplicate permission requests already awaiting DNS when a later attempt stops: no late approval or read receipt.
- Valid checkpoint followed by malformed/fabricated/late output: retain only the earlier validated partial and never overwrite the completed result.
- Provider emits replay/subagent/chunk/delta events: no unrelated content enters the attempt.
- Journey or saved answer changes during failure cleanup: reject the attempt, including A-to-B-to-A as existing dependency identity permits.
- Partial rendering and deeper-review controls during typing/polling: preserve editor/composer identity, focus and disclosure state.

## Task1 — Bound request effort

Files: new `com.github.copilot/extensions/explorer/research-effort.mjs`, new `test/research-effort.test.mjs`; then `research.mjs` hooks and the packaged research skill.

- [x] Write failing policy tests for exact argument equivalence/distinction, first denied duplicate/second repeated stop, all three aggregate ceilings including denied calls, oversized arguments, page/search/aggregate text bounds and Unicode boundaries.
- [x] Implement `createEffortTracker(limits)` with `attempt(input)`, `deliver(toolName,text)` and `snapshot()`, plus strict `effortAssessment(value,{partial})`. All retained state is request-local and bounded.
- [x] Run the focused tests; integrate policy into existing permission/tool hooks without altering tool allowlists, account/model isolation or first-read attribution. Preserve fail-closed missing/reused tool IDs.
- [x] Add SDK-hook regressions for failed/blank reads, denied then retried calls, pending DNS approval and date labels outside the delivered prefix. Include qualitative effort and bounded checklist/stopping instructions in exact reviewed prompts.

## Task2 — Retain only validated checkpoints after release

Files: `owned-helper.mjs`, `research.mjs`, `controller.mjs`, new effort module, `test/research-sdk.test.mjs`, focused controller tests, `scripts/e2e-research.mjs`.

- [x] Add failing tests for a valid complete checkpoint followed by a hard limit; malformed/oversize/unread-citation/winner-bearing checkpoints; delta/replay/subagent/chunk/late events; no checkpoint; cleanup failure; cancellation and source/journey conflict. Previous completed research remains byte-identical.
- [x] Extend the helper's preparation context with elapsed/remaining clocks, optional complete-event observation and a report callback after successful cleanup. Existing helpers without these hooks remain unchanged. Keep usage recording independent of event filtering.
- [x] Parse optional assessment separately from the unchanged findings schema, retaining no raw model text. Validate checkpoint findings with the same parser/receipt rules. At safe bounded stop return a separately validated report through `onReport`, preserving the normal success/error result contract.
- [x] Add controller-only last-attempt state to UI snapshot/polling, bound to originating journey/node/dependencies/scenario. Store it only after current-disk validation, expose explicit clear, and exclude it from model context, durable files and native snapshots.
- [x] Extend the installed anonymous fixture to prove complete checkpoint delivery through the actual production seam and cancellation/cleanup. The preliminary ignored probe already observed a complete root checkpoint plus tool request; it does not prove product acceptance by itself.

## Task3 — Explain effort and partial value in the existing drawer

Files: `web/app.mjs`, `web/research-policy.mjs`, relevant controller/server command allowlist, `test/web.test.mjs`, `scripts/check-ui-layout.mjs`, new `docs/research-effort.md`, existing context/diagnostic documentation.

- [x] Write failing UI tests for completed/partial/no-checkpoint attempts, model-assessed versus observed reasons, literal evidence/Unicode, historical context, explicit clearing and deeper review with zero automatic inference.
- [x] Render a concise attempt summary and optional checklist/partial findings disclosures beside prior completed findings. Preserve complete claim/source/limitation context in disclosures. No direct partial-to-saved-answer action.
- [x] Add explicit reviewed deeper pass after termination; it uses the existing review token/settings flow. Keep partials and answer/composer text while opening/reducing review. Update same-node polling without remounting focused editors or unchanged details.
- [x] Test narrow/short panes and keyboard focus in authorized Brave. Document transient retention, accounting/quality limitations and unsupported native/live acceptance.

## Task4 — Compare, review and release

- [x] Record deterministic baseline/candidate cases for early completion, unavailable evidence, repeated query, failed fetch, setup exhaustion, valid partial then limit, and no usable checkpoint. Report observed calls/elapsed and rubric outcomes with fixed clocks; do not treat scripted outcomes as live quality or monetary savings. #110 live pilot remains separate and at zero calls.
- [x] Synchronize version0.1.121 and newest-first release notes; request one independent final review after focused and installed runtime checks.
- [ ] Resolve blocking findings, bind approval and run frozen `verify:iteration -- issue-108 --allow-ui`; package and compare all shipped bytes.
- [ ] Fetch, commit, integrate/push main without force, verify exact remote SHA, update issue evidence/checklist accurately, and continue the next eligible issue. Record unavailable measured agent usage and pending seven-day observation in ignored completion.md.
