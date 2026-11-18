# Question Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Replace the in-card shelf with approved Option A: a full-width bottom drawer and a simple answer/save/continue flow.

**Architecture:** Keep the existing mounted answer editor in the map/outline. Mount its supporting tools in a sibling drawer beneath the map controls, with tab-specific containers and explicit reveal routing. Preserve the existing request and draft coordinators.

**Tech Stack:** Native ES modules, HTML/CSS, node:test/jsdom, Brave via existing Playwright installation.

**Spec:** docs/superpowers/specs/2026-11-18-question-drawer-design.md

## Global Constraints

- No runtime dependencies or SDK/runtime substitutions; no host integration changes planned.
- Preserve original #41 blocked requirement, #42 blocked, deferred #44/#49.
- Keep user text and drafts, validate existing actions, and preserve request identity/cancellation rules.
- Tests use synthetic data and local fixtures, no paid providers, existing user answers or microphone capture.
- Publish one reviewed, versioned iteration to main; retain existing history and release entries.

## Review Focus

- Polling and cross-question updates must not replace the editor, lose drawer drafts or steal focus.
- Hidden tabs must be correctly revealed by Commands, incoming previews, reminder conflicts and request navigation.
- Late save completion must not navigate away from a newer question, journey or draft.
- The drawer must stay outside the zoomed map in Map and Outline, including 280px panes and short windows.
- Library/removed-node/closed-question transitions must not leave stale tools attached to another question.

### Task 1: Dock the tools and simplify the answer flow

**Files:**
- Modify: com.github.copilot/extensions/explorer/web/app.mjs, web/style.css, web/index.html.
- Modify/add behavioral regressions in test/ using the existing browser harness.
- Root owns scripts/check-ui-layout.mjs, docs/card-workspace.md, design/plan docs and publication metadata.

**Interfaces:**
- Consumes: existing renderWorkspace, captureWorkspace, setQuestionTools, revealQuestionTool, revealQuestionWork, DraftClient save and NextQuestion local suggestion logic.
- Produces: one viewport-level question drawer; stable editor; correct tool-tab routing; explicit save-only continuation and separate generation.

- [x] Add failing behavioral tests: drawer sibling placement and stable editor identity; draft/state/reminder retention; close/Escape focus; tab routing for Commands/pending/preview; save continuation only after success and only for the still-current draft context.
- [x] Run focused node:test cases and confirm the specific old-behavior failures.
- [x] Implement the approved design in the existing UI structure. Use existing operations, no fake prototype fields. Keep context tools available for root/direction nodes without fabricating answers. Use local NextQuestion semantics for continuation; report no next question without generating one.
- [x] Remove obsolete card-local shelf CSS and update connected selectors/tests. Preserve existing compact-card fixes, voice settings and request/draft protections. Perform the unslop craft pass in spacing/color/icons/copy/type/layout/details/motion order.
- [x] Run focused behavioral tests and report exact results and known limitations to .superpowers/sdd/2026-11-18-question-drawer/task-1-report.md. Do not spawn agents or publish. Root will perform the independent visual checks, final versioning and publication.
- [x] Root extends Brave layout checks for full-width unscaled drawer, tab reachability, keyboard/draft retention, Save & continue, long content and Map/Outline in wide/narrow/short panes; inspect screenshots.
- [x] Independent review of complete changes against design; address material findings and obtain scoped rereview.
- [ ] Final release gate: update docs, synchronize patch version/release notes, run npm test, npm run check and npm run package; fetch/integrate and push main without force; verify remote commit. Install the published marketplace version and inspect Copilot rendering. Final results belong in the retained iteration ledger, because native acceptance happens after this plan is published.
