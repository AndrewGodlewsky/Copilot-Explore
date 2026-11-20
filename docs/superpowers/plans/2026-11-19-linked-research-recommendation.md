# Linked research recommendation implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. One independent final reviewer is required by the repository workflow. Keep roadmap issues sequential.

**Goal:** Give one clearly identified, conditional research recommendation, or an honest inability to recommend, while preserving the user's ownership of every answer.

**Architecture:** Extend the validated research result with an optional saved recommendation assessment; require it for new helper comparisons. Reuse the existing reviewed map context, owned helper and stale-result behavior. Carry the assessment through current consumers rather than introducing a new storage or request layer.

**Tech stack:** Native ESM, Node tests/jsdom, installed Copilot SDK/local model fixtures and explicitly authorized Playwright/Brave. No new runtime dependency.

**Spec:** GitHub #95, approved #90 research workspace, docs/research-options.md and docs/research-context-review.md. #93 and #94 must be published before implementation.

## Constraints and decisions

- Keep the Research label and approved adaptive bottom drawer. No automatic answer selection/save, new model request on viewing, permission expansion or attached-session/model changes.
- `recommendationAssessment` is optional for saved compatibility, required for new helper output. It requires optionsVersion1 and strict keys: `optionId`, `mainTradeoff`, `reconsiderIf`, `decisionRefs`.
- `optionId` is exactly one existing option ID or null. Null means no justified recommendation, including when there are multiple plausible options. `recommendation` remains the rationale; limit it to800 UTF-16 units when assessment exists, preserving legacy5000. Tradeoff and changed-assumption text are each required/nonblank<=600. Do not invent calibration.
- Refs are0-8 distinct records. Helper supplies `{nodeId,reason}` (ID<=100, nonblank reason<=400). Only actually included saved, nonblank question answers in prepared path/decisionsElsewhere qualify; root, direction, omitted/unanswered and unknown IDs reject. Enrich refs with the actual prepared `answerState` and boolean `review` before saving; model-supplied state/review and other unknown ref fields reject. Historical native/imported references may outlive their source node and remain readable; they are not proof of present truth.
- A result with assessment must omit top-level proposedAnswer. Use recommendation applies the referenced option's proposedAnswer; never free-text rationale as a modern answer. Older results retain their explicit draft/prose behavior with a compatibility explanation and no inferred winner.
- Existing answerNode/guidance/restart paths mark research stale; preserve that conservative behavior. Polling changes recommendation badges/warnings and disables draft controls without replacing the active editor. No new dependency graph edges/digests are required.
- Follow-up input retains assessment in mandatory context; omitted optional option/decision bodies stay honestly omitted. Full exports preserve references; selected offline export remaps option/node IDs and substitutes null for references outside selection. Do not copy extra saved answer bodies.
- No live-quality claim from authored fixture output. #105 owns per-statement support, #97 draft replacement and #110 separately authorized pilot. #91 remains pending native acceptance.

## Review focus

1. Missing, malicious, duplicate or unreviewed decision references must not be credited as context; historical missing nodes must still open safely.
2. A null recommendation with viable alternatives must not expose a winner action or disable independent choices/custom answering.
3. Unicode/escaped inputs, exact raw output envelopes and added trusted metadata must respect existing character/byte limits.
4. Offline selection must not leak private option/node IDs through the new assessment; follow-ups must not imply omitted referenced bodies were read.
5. Late stale markers, node/result replacement and reference navigation must preserve the active private draft and block obsolete suggestions.

### Task1: Contract, helper attribution and consumers

Files: model.mjs, research.mjs, research-followup.mjs, offline-viewer.mjs, offline-viewer-runtime.mjs, packaged research SKILL.md; new test/research-recommendation.test.mjs; test/research-sdk.test.mjs; authored fixtures in scripts/e2e-research.mjs and scripts/research-benchmark.mjs. Keep existing optionFindings fixture for pre-assessment compatibility; add a separate recommendation fixture.

- [x] Write model tests for one known winner, null winner, duplicate/unknown/multiple winner forms, strict fields, bounds, unsupported legacy downgrade, independent two-option availability, no competing top-level draft, refs with historical state, and missing historical nodes. Assert native/import/history/Markdown projection preservation and offline ID remapping including unselected refs. Assert follow-up mandatory assessment with accurate option omission accounting.
- [x] Run focused tests and record expected new failures before implementation.
- [x] Add strict validation inside research(); keep legacy bounds and source/claim validation. Enrich new helper refs against prepared.context before model validation; retain request-local ownership and fail without changing saved answers/results. New raw output must include assessment; follow-up parser remains its own contract.
- [x] Extend full Markdown and offline consumers with literal rationale/tradeoff/reversal and historical ref labels. Offline IDs use existing oN/nN identity maps; unselected refs expose no original ID. Render any links only to included nodes. Preserve all other export privacy choices.
- [x] Write SDK cases proving a fixed cross-branch decision selects a different authored rationale/winner and that excluded/unknown/root/direction/unanswered refs reject. Capture supplied tentative/assumption/review status rather than treating it as settled fact. Explicitly characterize these as protocol fixtures, not a quality benchmark.
- [x] Update helper skill and authored output fixtures. Preserve exact80000UTF16/160000UTF8 boundary checks using valid Unicode claims/option details within modern bounds. Run focused contract/helper/context/export/benchmark tests to green.
- [x] Run installed local research fixture for actual parsing/context/isolation/cancellation/usage; include a referenced prior decision and a null-winner case. No paid provider or user session.

### Task2: Prominent, optional recommendation in the drawer

Files: web/app.mjs, minimal web/style.css if needed, test/web.test.mjs, scripts/check-ui-layout.mjs.

- [x] Write failing DOM tests: exactly one passive Recommended badge for a linked option, rationale/main tradeoff/reversal visible; all option actions and private editor remain available; viewing never edits/saves. Use recommendation appends only winning option draft. Null assessment has clear explanation, no winner badge/action and still permits alternatives/custom draft. Pre-assessment result has readable compatibility label and no guessed badge.
- [x] Cover referenced prior-decision navigation with historical state labels, missing-node handling, poll preservation/caret, and late stale marker changing badge and disabling suggestion actions.
- [x] Implement within renderResearch and retained-workspace polling. Reference activation rechecks current map and uses existing select() navigation. Keep options first and findings expandable. Render all text literally; no confidence percentages or radio preselection.
- [x] Run focused UI tests green. Extend authorized Brave cases for narrow/short/wide, keyboard action, Unicode, null/legacy/stale result states and draft preservation. Inspect representative screenshots; don't weaken geometry thresholds.

### Task3: Documentation, release and issue record

Files: docs/research-options.md, docs/research-context-review.md as appropriate, plan; all required synchronized metadata and release-notes.json.

- [x] Document modern/legacy/no-winner semantics, historical prior-context refs, export treatment, permission boundaries and unmeasured native/live quality. Finalize version metadata and newest release note<=400 characters.
- [ ] Run focused checks/diff whitespace and local doc-link checks; request one independent whole-candidate review with brief, plan, diff and evidence. Resolve findings; record actual reviewer receipt.
- [ ] Fresh `verify:iteration` with ui=true, host=true, authorized Brave and installed SDK paths. Require npm test, npm run check, e2e and check:ui to pass. Package and compare shipped bytes.
- [ ] Fetch, check main worktree cleanliness, commit, verify readiness, fast-forward main and push without force. Verify exact origin/main SHA. Update DoD/completion comment and close #95 only after publication; keep manual #91 separate. Usage totals remain unavailable unless measured counters exist; seven-day regression window is pending.

