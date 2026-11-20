# Research comparison and reconsideration implementation plan

> Continue inline with one implementation owner using executing-plans and one independent final reviewer. Baseline: published v0.1.116 / 07a5d96. Owner has resumed sequential issue work.

**Goal:** Compare decision-specific criteria and explicitly reconsider the recommendation against personal hypothetical priorities, retaining original research and all user answers.

**Spec:** Issue96 and the owner-approved comparison/revision flow in docs/research-workspace-design.md and docs/prototypes/research-workspace.html. The prototype already distinguishes Use revised comparison from Keep original comparison.

**Architecture:** Keep saved option details and the shared document schema. Add bounded comparison preparation/result validation in research-comparison.mjs; run an owned zero-tool helper through the existing reviewed Research slot. Keep one accepted comparison and one replacement proposal in private controller state, absent from shared/native snapshots. Keep local priorities in the browser; explicit adoption requires an unchanged page-local review. Existing answer editor and97 draft actions remain authoritative.

**Implementation choices:** New results use consistent question-relevant detail labels rather than duplicate generic Description/Pros/Cons criteria; old research remains readable and can receive custom local criteria. Reconsideration uses existing evidence and current saved map context, with no new retrieval. Use Research's reviewed default/dedicated model. This is a narrow operation, not completion of104's general explanation route. All comparison judgments remain model reasoning; a prior-claim reference is not proof of entailment or a new source read.

## Constraints and review focus

- UI=true and host=true. Installed SDK only, existing isolated directories/account/model checks, zero initialized tools, deny permissions, retained usage and release queue.
- No automatic model call from priority edits/disclosures; no automatic web retrieval, retry, saved decision changes or adopted recommendation.
- Exact reviewed mandatory input includes every compared option, chosen criterion/priority and prior evidence. Use existing131072-byte instructions+prompt packer; fail mandatory overflow, omit optional map records whole with existing explanations.
- Stable option identities: retain versioned IDs; use deterministic request-local IDs for legacy options bound to the complete research snapshot. Do not match recommendation prose.
- Proposed result must match actual captured option/criterion/prior-claim IDs exactly. Bound counts, strings and serialized bytes; literal rendering only. Unknown evidence is explicit, with no invented scores/percentages.
- Relevant map/research/scenario changes reject review/start/result/adoption. Relevant model changes invalidate an unused review; accepted operations keep their captured model. Local criteria edits invalidate unused review, including replacement reviews while an older Start finishes. Preserve composer/editor/caret/IME and old comparison on failure/cancel.
- Navigation/reload and source A-B-A must not revive a discarded proposal. Retained proposals after page reload are read-only until a new reconsideration. No transient comparison payload in native snapshots or shared export.

## Task1: Bounded comparison contract and preparation

- [x] Add pure strict criteria-input and comparison-result validators in research-comparison.mjs, with limits of8 explicitly selected criteria,160 UTF-16 characters per label and4 current options; existing32 possible detail labels remain readable. Selection exceeding the reassessment bound must be visible and rejected, never silently truncated.
- [x] Add prepareReconsideration using prepareResearch, operation research-reconsideration, fixed180000ms/zero tools, mandatory current option/evidence/priorities data and current optional map scope/exclusions. Reject absent/invalid/stale saved research and unsupported IDs.
- [x] Result includes a complete selected-criterion Ã— option grid, concise explanations, reasoning/unknown/prior-evidence labels with valid prior claim references, a single option or explicit no recommendation, changed/unchanged reasoning and uncertainty. Validate output against prepared inputs at helper and controller boundaries.
- [x] Failing then passing unit coverage: long Unicode criteria, duplicate/missing/extra IDs/cells, malformed/oversized output, fabricated support, unknown evidence, complete mandatory data and optional omission accounting. Preserve legacy research imports.

## Task2: Reviewed zero-tool execution and transient result lifecycle

- [x] Extend ResearchReview with the new explicit purpose and criteria field; bind immutable input, model, sources/destination/scenario, expiry and single-use token. Keep other purpose schemas strict.
- [x] Add createResearcher.runReconsideration backed by createOwnedHelper/toolFreeConfig/validateNoTools. Separate Research model-family capture/deadlines from actual web-tool capability/stage labels. Add usage operation label without weakening unrelated helper routing.
- [x] Extend controller's existing Research release/request slot and protected api/action with the new purpose. Maintain one accepted comparison and one proposal with originating node, source dependencies and reviewed criteria. Preserve the accepted comparison until explicit adoption of a validated proposal. Clear/invalidate on relevant lifecycle changes; keep out of native/shared snapshots.
- [x] Test review identity/expiry/reuse/mismatch/stale source/destination/model/scenario, exact strings, missing/unavailable dedicated model, zero-tool metadata, cancellation/release and usage. Test old completed comparison survives denied/malformed/timeout/cancel, relevant late result cannot replace it, and answering other nodes retains existing coordination rules.
- [x] Add installed SDK/local fixture proving zero tools, exact reviewed data, captured default/dedicated model and usage/cancellation. Never invoke paid/existing sessions.

## Task3: Local priorities, inline review and explicit comparison adoption

- [x] Update renderComparison in app.mjs without broad renderer refactoring. Decision-specific saved detail labels seed criteria; support bounded custom criteria and existing High/Normal/Low priorities. Edits remain local, show absent values as unknown and retain97 detail selections/draft guards.
- [x] Add explicit Reconsider recommendation review in the101 inline panel. Show hypothetical priorities, model provider disclosure, existing-evidence/no-new-retrieval mode and fixed effort; reveal exact inputs and exclusions. Hide irrelevant web source controls. Research model save refreshes this review too; browser timeout accommodates its metadata lookup.
- [x] Show a validated proposal beside the prior comparison, with changed/unchanged reasoning and Use revised comparison / Keep original comparison. Adoption is local and requires matching reviewed criteria and current sources. Distinguish saved recommendation from hypothetical comparison recommendation; all options remain available and no answer is saved.
- [x] Stack comparisons with explicit option/criterion labels at narrow widths; retain accessible table semantics and keyboard focus. Keep existing mounted answer/composer through edits/review/progress/results.
- [x] Red/green UI coverage for no inference on edits, unknown evidence, long/custom criteria, selection bounds, review invalidation (including101 race), stale proposal/adoption, failures/cancel/navigation and safe draft operations. Update synthetic Brave checks across five sizes and inspect screenshots.

## Task4: Complete the iteration

- [x] Read current issue/comments, assign/start comment, create next clean branch/brief after101. Record new decisions as implementer choices, not invented owner approvals. Use the approved prototype and existing stack.
- [x] Update research instructions/docs and release metadata to v0.1.117 (recheck remote version before publication). Mark limits and native/live exclusions accurately.
- [ ] Independent final review, fixes and fresh approval receipt; then full verify:iteration including installed runtime and authorized Brave, package byte comparison, fetch/integrate/push main and exact remote verification.
- [ ] Complete issue checklist/comment and ignored completion/usage ledger. Keep91 native pending,110livecalls0,41/42 unresolved, and seven-day observation pending.
