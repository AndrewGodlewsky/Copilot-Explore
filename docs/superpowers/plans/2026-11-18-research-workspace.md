# Research Workspace Prototype Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline with one independent final review. Publish the concrete design deliverables, then leave #90 open for the explicitly required owner design feedback. Continue independently ready issues.

**Goal:** Provide an implementation-ready, reviewable bottom-drawer Research design covering the whole question-to-answer journey and changed-priority follow-up.

**Architecture:** One offline HTML prototype plus an interaction/component specification. Production drawer, controller, model and network behavior remain under their existing contracts. This issue's required owner review gates dependent production UI implementation.

**Tech Stack:** Standalone HTML/CSS/JavaScript; temporary Node/jsdom smoke; existing repository checks.

**Spec:** GitHub #90; #89 audit closed. Baseline v0.1.104 / 362a58c80cea3e8584417fa7594b435e395a3d43. Assigned AndrewGodlewsky; start comment 6997955637. Prepared scratch materials while #87 release verification ran; they are proposals, not validated owner decisions.

## Global Constraints

- Reuse the existing bottom drawer outside the transformed map; preserve one mounted answer editor and existing tabs/theme direction.
- Opening research is local navigation. Context preparation and explicit Start remain separate; exact inputs, source identities, bounds, exclusions and stale-token guarantees remain visible.
- Suggestions and conversation never commit answers or hypothetical priorities. Append/replace/undo affect drafts only; Save remains explicit.
- Cover compact/expanded/narrow layouts, source mode, recommendation, comparison, conversation, evidence/uncertainty, exceptional states and keyboard/focus ownership.
- No runtime permissions, SDK changes, external assets, internet retrieval, real inference or persistence in the prototype. #88 owns network policy.
- No browser/desktop automation. Source inspection and local DOM behavior do not prove native layout, accessibility, IME or live research quality.
- Owner feedback is an explicit definition-of-done item. Publish concrete artifacts and note the pending feedback; do not close #90 or implement dependent production UI without it.
- Reversible design artifacts need meaningful smoke verification, not a new production test framework. Existing full npm test/check/package remain the repository publication gate. No installed SDK fixture is needed without host/model contract changes.
- Synchronize v0.1.105 metadata and a truthful <=400-character release note; fetch, integrate and push main without force; verify remote. Retain ignored scratch notes.

## Interfaces and review focus

- `docs/prototypes/research-workspace.html` is a standalone offline fixture. Review controls are clearly separate from app controls; fabricated evidence, completed results and progress are forbidden. Cancellation before any completed run shows no findings.
- `docs/research-workspace-design.md` names existing versus proposed behavior, state/focus transitions, component ownership, backlog dependencies, limits and pending owner decisions. Relative links must resolve.
- The prototype and specification agree on one editor, explicit request/answer/revision acceptance and stale-result treatment. Scripted follow-up content is labeled canned reasoning, not generated or sourced research.
- Follow-ups/option IDs/persistence and internet policy remain assigned to their own issues; no implicit implementation authorization through a mockup.

### Task 1: Integrate the concrete design artifacts
**Files:** create the two docs above; add a concise README link. Use scratch drafts only after reading and reconciling them with the current published baseline.
- [x] Assign #90 to AndrewGodlewsky and comment with scope and pending owner-review gate. Read current AGENTS/source/docs and record baseline.
- [x] Integrate prototype/spec, update actual source baseline and review evidence, and verify every required state and the complete follow-up journey.
- [x] Run a temporary DOM smoke against the repository artifact. Expected: local entry/review/start, cancellation without fabricated findings, options, append/replace/undo/separate Save, explicit revised-comparison acceptance, stale gates, retained drafts, focus and no external requests pass.
- [x] Verify relative links and static script syntax. Expected: all local destinations exist; the prototype loads no external asset and performs no model/network/filesystem request. Native checks remain pending.
- [x] Task gate: `npm run check` and record the separate smoke evidence. Expected: pass.

### Task 2: Review and release verification
**Files:** docs above plus synchronized package/lock/plugin/marketplace/extension/README version and release notes.
- [x] Prepare truthful .105 metadata/release summary describing design artifacts, not shipped production redesign.
- [x] One independent final reviewer reads the complete delta and new-file inventory. Regrade actual effects; fix material findings in one demonstrated failure/pass cycle; no re-review loop.
- [x] Run full npm test/check/package and diff check after fixes. Expected: pass; record actual counts, artifact checks and pending owner verification. No paid services or existing sessions.

Verification found a pre-existing project-copy UI test racing its Git-backed save response. Its preview/save/open assertions now await the existing bounded HTTP response before checking the DOM. The focused test and final full suite passed; production behavior is unchanged. The final suite passed 1,470/1,470 tests. Task 2's final gate is `npm run check`; the full-suite and packaging receipts remain in the task ledger.

### Task 3: Publish the reviewable result and record the blocker
- [ ] Fetch remote, commit, integrate into main without discarding work, push and verify exact remote commit.
- [ ] Post links to the published prototype/spec, checks, review rulings and four concrete feedback points in #90. Leave it open pending owner design review; do not infer approval.
- [ ] Record dependency impact on production UI and continue #94 (independently ready after #89). Do not blanket-block unrelated context/fixture work.
- [ ] Final gate `npm run check` on the published commit; ledger receipt. Expected: pass.
