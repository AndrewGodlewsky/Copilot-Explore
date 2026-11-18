# Replacement questions from corrected assumptions

Goal: Explicitly review and generate replacement follow-up questions using corrected committed context, keeping existing questions and drafts intact until normal candidate acceptance.
Spec: GitHub #74. Base: 0.1.89, d1b5b12e0ec157272c52d8de4b1aae1d7f045748.
Architecture: Reuse ResearchReview prepare/cancel/consume and ResearchReviewClient exact-input dialog with question-regeneration purpose. Add a focused pure regeneration context builder; keep queued question request/callback/persistence in controller. No SDK substitution, schema migration, network tools or runtime dependency.

Constraints/rulings:
- Target is a saved ordinary question with an explicit effective state other than unanswered and no outstanding review flag. Uncertainty remains uncertainty; no implicit answer or state change.
- Build only from current map. Removed historic content stays in History and is not loaded into model input. Other scenario files are never read; existing scenario preference policy still applies and hypothetical sources remain labeled conditional.
- Needs-review answer text and all historic research/rationale/importance claims are excluded. Current guidance, selected answer, ancestors and transitive explicit prerequisites are visible in exact input. Applicable links retain user-assertion semantics.
- User explicitly selects valid direct child questions as existing coverage hints. All saved children stay on map regardless of selection; existing sibling and selected-candidate duplicate checks still apply.
- Preview allocates its request ID so dispatched strings are exactly inspected. Bounded one-token lifetime, source binding/full saved document digest and scenario policy checked before dispatch, staging and acceptance. Cancellation invalidates only Explorer results; attached chat may continue.
- Saving, reset and guided review never auto-generate. New button uses saved answer; private editor/drafts are neither submitted nor overwritten. Existing explicit Explore deeper behavior remains.
- Full saved digest is deliberately conservative; any saved edit requires a fresh regeneration preview. Attached chat has its own history and can read the committed map; guarantee exact Explorer input, not the host's entire model context.
- Browser/desktop automation prohibited; native checks pending owner. Local installed SDK/model fixture only.

Tasks (execute RED -> GREEN):
1. Pure bounded context: tests corrected target, excluded obsolete answer claims/research, current dependency closure, retained selection/dedup eligibility, scope/budget and invalid target. Implement builder, keeping source unchanged. Expected focused tests pass after observed failures.
2. Review/request coordination: tests exact inspected strings/request ID, strict purpose/selection validation, no auto-generation after save/reset/review, changed sources/dependencies/scenario, cancellation/late callbacks and staging/acceptance. Extend existing owner rather than new unbounded state. Expected focused controller/HTTP tests pass.
3. UI: explicit Regenerate follow-ups action, retained selection and exact context inspection, normal candidate staging labels. Tests no inference on open/cancel, private editor/caret unchanged, selected existing hints, source invalidation, page suspension and late callbacks. Expected real HTTP/jsdom workflows pass; no browser.
4. Documentation/release: docs compatibility/input guarantees, README and 0.1.90 metadata/release entry; one independent final review. Fix material findings RED/GREEN, npm test/check/package/diff, installed fixture; commit/integrate/push main, remote verification and issue completion.

Shared interfaces: pure builder produces immutable bounded context, source digest and requestId; ResearchReview owns selection and expiry; controller retains digest throughout pending/staged lifetime; client uses existing sequence lifecycle and must not expose research/project settings for this purpose. Normal candidate acceptance remains only node mutation.
Review focus: exact preview/requestId correspondence; full-source checks at dispatch and after asynchronous final save guard; dependency context cycle/mixed tree paths and budget omissions; stale question claims reintroduced through rationale or native map; purpose confusion bypassing helper/tool checks; preserved editor and old dialog response across close/resume/navigation.

Final review: the independent reviewer reproduced an external correction arriving during final scenario validation being overwritten at candidate acceptance. The regression failed before moving the final saved-document read after that asynchronous check, then passed. The new inference action's missing strict Origin check was also reproduced and fixed. Native rendering and live question quality remain outside the local fixture's guarantees; the attached session's independent context remains explicitly documented.

Release verification: all 15 regeneration core tests and eight related UI flows passed. The first full run passed 993 of 994 tests; one existing research follow-up fixture dereferenced its helper before asynchronous scenario validation had dispatched it. The positive-start assertions now wait for actual helper calls instead of one event-loop turn. All 32 follow-up/regeneration tests pass after that fixture correction. Syntax/version/asset checks, packaging, whitespace checks and the installed SDK/local-model fixture passed after the production fixes. Final full-suite and publication results are recorded on #74 before closure.

Final full suite: 994/994 passed. All four tasks are complete; native narrow-pane, keyboard/multiselection, screen-reader, theme and IME verification remains pending owner checks. No paid provider or browser automation was used.
