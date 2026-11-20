# Inline Research request review plan

> Use executing-plans inline with one implementation owner and one independent final reviewer. Begin only after #120 is published. Owner approved the layout in #90; Brave checks and routine main publication are authorized.

**Goal:** Review a question's research request inside the bottom drawer with a short summary first, preserving exact prepared inputs and explicit Start.

**Architecture:** Keep ResearchReviewClient and server-owned tokens/captures. Move one stable review panel between an inline Research host and the existing dialog for unrelated challenge/regeneration operations. Preserve the single draft editor and existing Research conversation. No SDK, provider, network-policy or shared-schema changes.

## Task 1: Lifecycle and placement

- [x] Write failing UI cases for ordinary initial/follow-up inline review; preserve other-purpose modal paths, editor/IME/caret and conversation. Capture late responses, node/journey switch, collapse, drawer close, page suspension and restored focus.
- [x] Introduce one stable review-panel wrapper and explicit ordinary-inline target identity. Mount in a stable Research host outside the answer/options replacement region. Restore panel to its dialog before parent teardown; never clone controls or duplicate IDs.
- [x] Update open/close/Back/Escape and source/node transitions. Inline review has no focus trap. Escape dismisses the most specific draft/review layer before the drawer. Opening or expanding review starts metadata preparation only; Start remains Research. Preserve existing single-use sequence, expiry, stale-input and cancellation contracts.

## Task 2: Readable review without changing model inputs

- [x] Lead with the complete literal question; concise saved context summary (states, objective/constraints, counts), unsaved draft exclusion, effective model/mode from120, current source behavior/provider disclosure and effort bounds.
- [x] Put exact prepared input records/strings/byte budget, optional exclusions, omission reasons/sample and advanced effort/source controls in labeled native disclosures. Use the returned payload, not independently reconstructed inputs. Preserve disclosure state and stable control focus through refresh.
- [x] Keep required inputs non-excludable and unknown evidence honest. Current Research still uses verified search/fetch tools; clearly mark no-new-retrieval explanation as unavailable until104. Approved policy88 is not a capability claim or waiver for41/42. No new selectable source mode or invented price/progress estimate.
- [x] Changing optional context/settings re-prepares and invalidates previous tokens; opening disclosures only changes local presentation. Failure leaves readable prior findings and private drafts. Model preference save refreshes relevant review without remounting text surfaces.

## Task 3: Verification and release

- [x] Adapt ordinary-review tests to inline placement while retaining exact-payload/token/IME/late-reply assertions. Keep server token tests; verify unrelated modal flows. Include large omitted context and long Unicode summaries.
- [x] Update Brave checks to reveal advanced details before inspecting exact records, and inspect drawer geometry at wide/narrow/short/minimum sizes. Keyboard focus/Back/Start/refresh and overflow must remain reachable, no model/paid/existing-session calls.
- [x] Update review/workspace/model docs and README for delivered behavior versus104/41/42 gaps. Bump next patch after120 with complete release metadata and <=400-character notes.
- [ ] Independent final review, record receipt, fresh verify:iteration ui=true/host=false with authorized Brave (reclassify if scope changes), package byte comparison, fetch/integrate/push main without force and exact remote SHA verification.
- [ ] Complete101 issue comments/checklist and local completion ledger. Keep91 native pending and measured usage unavailable unless actual counters arrive; seven-day regression observation stays pending.
