# Reusing an exact completed follow-up — implementation plan

For agentic workers: use superpowers:executing-plans in this existing isolated checkout. One implementation owner and one final independent reviewer per development-workflow.md. Issue #109 implementation on published v0.1.121/af79c735; requirements are in the approved GitHub issue and the fixed behavior below. Stack: native ES modules, Node tests, existing Explorer controller/HTTP/DOM and installed SDK metadata.

Goal: Avoid a second helper invocation for an exactly repeated, still-compatible clarification without presenting an old answer as newly verified.

Builder choice under the owner's standing implementation authorization: reuse the latest complete follow-up in the current canvas/question through an explicit secondary action in the existing inline review. Existing Research always starts fresh work. Keep the same answer, exchange ID, source provenance and dates. Do not append a duplicate conversation entry. Use existing four-exchange/64 KiB transient history plus one small private reuse record; no persistent cache or shared in-flight work.

Alternatives: raw page caching would need a supported replay contract and substantially more attribution/permission machinery; explanation-only model work belongs to #104. Both are outside this first bounded increment. Exact matching deliberately misses paraphrases and conversations whose predecessor history was evicted.

Architecture: research-reuse.mjs owns bounded validity/key rules and reconstruction; controller.mjs owns the canvas-local record, fresh project identity and consumption; research-review.mjs exposes an eligible reuse choice after ordinary context review. Browser app uses the existing inline review/history region. No new runtime dependencies or tools. Project root observation uses the existing host metadata plus directory identity contract, never repository file bodies or Git state as model input.

## Fixed behavior

- Only the latest completed follow-up, identical question including whitespace/case and identical hypothetical flag. Never a partial, failed or cancelled result. No automatic reuse, retry or escalation.
- Keys include exact original instructions/prompt, settings, scope/exclusions as needed to distinguish review policy, selected model/account/settings revision, current canvas binding/journey/file and fresh canonical project root identity, protocol/freshness policy version and result fingerprint. No private key/account/path fields in browser/native snapshots, prompts or exports.
- Capture preparation time. Reconstruct original preparation using current document/settings and retained predecessor history (remove only the latest candidate exchange) at that captured time; hash exact strings. Independently recheck input and output freshness now. Do not remove clock text with a regex or ignore arbitrary prompt differences. Miss if original predecessors/omission counts cannot be reconstructed.
- Reuse window: at most 15 minutes from completion and same UTC date as preparation; reject backwards/invalid time. This is an availability limit, not a freshness guarantee. Preserve unknown/imported evidence labels; refuse age-based needsRefresh claims. Recheck currentness at consumption, not just when showing the button.
- Resolve optional root identity with a bounded existing deadline helper. Unavailable/changed identity means no reuse; ordinary research continues through its existing rules. Revalidate identity after any await before accepting reuse. No new network/repository permissions.
- An explicit Use previous answer choice sends no helper/model/source request, creates no usage receipt and focuses the original response with a clear no-new-verification message. Do not claim avoided provider tokens, credits or source-call counts from one skipped helper.
- Add explicit Clear follow-up history. It clears the transient discussion/reuse record/review token while preserving saved research and answer/composer drafts. Refuse while work is pending; cancellation remains explicit and owned. Clear also invalidates stale reuse actions. Journey switch/close already clears history; another question/new complete exchange replaces reuse eligibility.
- Preserve source/context staleness rules, serialized controller operations, document locks, Origin/token checks, real-release queue and exact reviewed request/model checks. No reuse across canvas, journey, project, exported/imported file or process lifetime.

## Task 1 — Matching and retention behavior

Files: new research-reuse.mjs and focused research-reuse tests, research-followup.mjs only where preparation clock/private projection is required.

- [x] RED: exact repeated input reconstructs/hashes identically despite the extra latest exchange; changed question/hypothetical/settings/version/source/date/constraint/predecessor/omission/scenario/model/account/project/binding misses. No semantic-normalization claim.
- [x] Implement bounded record/key/candidate helpers using original preparation time, independent current freshness and result fingerprint. No full duplicate prompt retained per exchange.
- [x] Test expiry, UTC boundary, backwards clock, unknown/imported labels, expired current-state evidence, four-entry/byte eviction, malformed/stale private record, and preserved original result/date/ID.

## Task 2 — Reviewed controller/HTTP/UI behavior

Files: controller.mjs, research-review.mjs, server.mjs, web/app.mjs (client only if needed); controller/review/HTTP/DOM tests and check-ui-layout.mjs.

- [x] RED through real controller: complete one follow-up, review exact repeat, explicitly reuse with helper count unchanged, no new exchange or usage receipt, saved file byte-identical. Choosing Research instead still invokes helper. Cancelling review invokes nothing.
- [x] Capture optional project identity at review/result acceptance. Store one private record only after valid complete response and confirmed release. Expose only eligible exchange ID/original completion time in review. Consume under existing review+document lock with current namespace/context/freshness checks; no partial reuse.
- [x] Test stale token after clear/new result, concurrent actions, failed saved read/changed file, cancellation and late response, unavailable/changed project root, copied map in another canvas/project, changed settings/account/version/constraint/freshness, history eviction. Existing saved research and recovery remain intact.
- [x] Add protected reuse/clear actions and literal UI copy. Exact old result stays in history; status says it was reused without new research. Preserve answer/composer/caret/focus/disclosure across polling, reuse and clear. Ordinary Research label unchanged.
- [ ] DOM checks and five-viewport Brave fixture cover offered/absent choice, keyboard activation, no helper on reuse, one on explicit fresh Research, historical/expired state and clear. Native #91 remains pending separately.

## Task 3 — Measurement, review and release

- [x] Compare deterministic baseline (always fresh) and candidate helper counts on repeated compatible vs changed-context sequences. Record actual in-process timings separately from unmeasured model/network latency; quality checks cover false reuse, original output/provenance/date preservation and stale evidence rejection. Live semantic quality/token/cost remains unmeasured (#110).
- [ ] Document limits, retention, explicit clearing, selection/freshness/identity rules, and no permission expansion. Inspect installed SDK declarations and run anonymous runtime fixture for any new host metadata integration.
- [ ] Synchronize next patch version and release note. Independent final review of code/spec/evidence, fix findings, rebind approval.
- [ ] Frozen verify:iteration with owner-authorized Brave; inspect screenshots, package and compare bytes. Fetch/commit/fast-forward main/push/no force and exact remote SHA. Final release checkboxes can remain tracked in ignored completion receipt to avoid changing frozen content.
- [ ] Completion evidence: measured checks/counts, review fixes, version/SHA, package, manual/live limitations, measured usage or unavailable, seven-day observation pending. Update issue DoD/comment/close and proceed to next eligible issue.
