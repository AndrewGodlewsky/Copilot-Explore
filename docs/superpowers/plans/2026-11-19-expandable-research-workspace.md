# Expandable Research workspace implementation plan

Issue: [#91](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/91). Binding design: [Research workspace](../../research-workspace-design.md), with the [four explicit owner approvals](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/90#issuecomment-7017092971). Baseline: v0.1.108, `3a731f2`.

Implement inline in the existing isolated worktree, with one independent final review. Keep drawer layout outside map transforms. This iteration changes presentation only: preserve exact context review, request ownership, source checks, persistence and explicit answer saving. No new network access, providers, research schemas or conversation semantics. Prototype approval is not native usability evidence.

## Task 1: Workspace shell and retained state

Files: `web/app.mjs`, `web/style.css`, `test/web.test.mjs` under the existing extension/test roots.

Interfaces: existing `setQuestionToolTab`, `setQuestionTools`, workspace regions, draft client and follow-up composer. Reuse the existing compact/expanded flag and scroll container. Add named result/conversation regions, a stable question heading/status, and one Answer draft action. Remove only the redundant outer Research details element; keep optional evidence/comparison disclosures. Label the request entry Research. Leave the exact request dialog for #101.

1. Add failing behavioral tests for direct research visibility and Answer draft retaining the original editor/caret/state/composer across resize, tabs, polling and in-flight results. Include empty, historical and failed states; use literal Unicode.
2. Run the named tests; expect failure on the missing shell/action, not fixture errors.
3. Implement the smallest shell change. Results precede conversation in DOM order; use CSS columns only where width allows. Keep the header and controls reachable and the full question available in scrolling content. Do not replace a composer when results refresh.
4. Update older tests that explicitly opened the removed disclosure to navigate using the Research tab. Run focused research/drawer regressions; expect pass.

## Task 2: Rendered geometry and approved design record

Files: `scripts/check-ui-layout.mjs`, `docs/research-workspace-design.md`, `docs/card-workspace.md`.

Interfaces: real HTTP/controller local fixtures, existing Brave executable and Playwright path. No paid model or existing session. Browser execution requires explicit owner authorization beyond the previously scoped #94 checks.

1. Extend rendered checks for wide/stacked columns, long Unicode, preserved editor/composer, Answer draft reachability, scroll/focus, and short pane header controls. Keep normal keyboard/pointer interactions; never alter geometry to pass.
2. Reconcile the four approved layout choices and exact Research label in the specification. Identify the historical prototype and remaining production issues; do not claim they all shipped.
3. With authorization, run Brave checks and inspect screenshots. Diagnose failures and add behavioral regressions where appropriate. Native Copilot/physical IME/screen-reader checks remain separately reported.

## Task 3: Review and publish

Files: synchronized release metadata, lockfile, README and release notes.

1. Bump v0.1.109 with accurate notes under 400 characters; preserve history.
2. Independent reviewer checks final diff/spec, ownership/freshness and actual UI evidence; resolve blocking findings and record approval.
3. Run `verify:iteration -- issue-91 --allow-ui` only after browser authorization. Expect npm test, check and check:ui to pass; host=false because no SDK/runtime integration changes.
   The first full run exposed an existing timing race in `test/research-evidence.test.mjs`: one `setImmediate` did not guarantee helper admission after asynchronous policy checks. Replace that timing assumption with an explicit per-request startup signal and a bounded test timeout, retaining every invalid-output/cancellation/disk-conflict assertion. A delayed-admission diagnostic must fail before and pass after this fixture correction; rereview the delta and rerun the full gate.
4. Package and compare shipped bytes, fetch/integrate safely, commit/push main without force, verify exact remote SHA. Record limitations, usage availability and pending seven-day observation in ignored completion notes and issue comments.

Review focus: no editor/composer remount during polling; focus recovery when research subtrees change; answer selection and per-tab scroll after returning; no request started by navigation; readable controls at narrow/short widths; no claim that dependent schema/policy features shipped.
