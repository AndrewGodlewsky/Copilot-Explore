# ADR freshness and reviewed updates

> Execute inline with superpowers:executing-plans and one independent final reviewer. The owner authorizes sequential issue implementation and publication to main.

**Goal:** Explain why a linked ADR needs review and compare its generated baseline, current file and explicitly regenerated proposal without silently losing manual edits.
**Spec:** #86. Baseline ae3dd7cb7b3627b8c7249f4f4c9ef0ec8cdbc8c8, v0.1.102. Prerequisites #84/#85 published.
**Architecture:** Optional portable baseline and reviewed-context fields extend existing records. Pure projections explain freshness. A selected-record review reuses the ordinary guarded writer with distinct association/file bases. Existing explicit scope/draft/readiness and successor workflows remain the generation/approval boundaries.
**Stack:** Node ESM, plain browser modules, node:test/jsdom; no new runtime dependency.

## Contracts and decisions

- `adrReviewContext(doc,nodeIds,includeEvidence)` captures version 1, canonical relevant dependency edges, upstream prerequisite record fingerprints, and selected research-stale flags when evidence is included. Traverse incoming prerequisites, and include edges incident to selected records plus edges in that upstream closure. Entirely unrelated changes must not alter the projection. Unselected prerequisite content is fingerprinted, not added as admissible model source text. Explain that limit in the reviewed prompt. Bound context to 64 KiB; reject rather than clip.
- `validateAdrReviewContext(value,nodeIds,includeEvidence)` strictly validates bounded keys, unique IDs/edges, hashes, booleans and canonical ordering. `adrReviewContextChanges(before,after)` returns bounded specific edge/prerequisite/research reasons. No network, filesystem or model work.
- Newly reviewed ADR scopes retain optional `reviewContext`; their reviewed prompt contains the same projection. Scope/draft freshness checks it when present. Legacy scopes remain readable and retain previous narrow freshness semantics, while the new ADR update view explicitly reports broader evidence unavailable. Never sample new dependency context and attach it to old wording as if it had been reviewed.
- New source captures copy the draft's reviewed context and existing scenario digest into optional `freshness:{version:1,context,scenarioDigest}`. Its checksum includes these fields. Existing capture fingerprints/portable references remain unchanged; old captures remain valid. Status combines existing selected-source comparisons with context/scenario reasons; unknown scenario or absent historical context is unavailable coverage, not proof of freshness.
- Optional `generated:{version:1,content}` on an ADR association retains the literal last generated Markdown, at most 64 KiB, with the matching managed identity marker. It is historical, not current file authority. Ordinary generation and successor creation set it; lifecycle transitions preserve it. No baseline is inferred from current bytes or another private journal. Existing 9 MiB document and private journal limits remain enforced.
- Keep source-currentness, on-disk file state and baseline availability separate. Missing, oversized, linked, invalid UTF-8, wrong-location or externally changed files remain visible unresolved states. Only explicit selected-record open/refresh/relevant visible local saves read the selected file; no repository scans or background file watcher.
- Three-way review uses conservative whole-file conflict choices. Default is keep current (no write). Explicit replacement authorizes the complete displayed generated file and may discard manual differences; do not imply an automatic merge. The user may first edit generated wording through the existing draft editor. An unavailable baseline needs the same explicit replacement choice. All three texts render literally and in full within response limits.
- Add a dedicated `review-update` selection to the ordinary writer. Read exact current bytes and capture its identity/stamp even if they differ from the recorded association. Store the original association separately from a synthetic filesystem base differing only in sha256. An optional private `associationBase` is allowed only for this explicit reviewed variant; validate identical remaining fields, IDs and paths, and require the low-level base hash to match the observed target. Ordinary update remains strict. Save requires an explicit replacement resolution when the preview reports conflicts/unknown baseline.
- Association commit checks the original association base. Publication checks the exact observed filesystem base, sources, root and preview lifetime, including the existing final synchronous metadata guard. Persist both bases through interruption/recovery; no new coordinator. Preview/cancel/default keep creates no write intent or project mutation. Reject oversized previews before issuing a token.
- Accepted/deprecated/superseded substantive text never updates in place. Eligible accepted records route to #85 successor proposals and later separate acceptance. Externally edited accepted parents remain unresolved under existing lifecycle guards; no silent re-baselining.
- Regeneration remains explicit: review current scope, start the owned tool-free draft helper, review/edit wording, check readiness, then compare files. No automatic helper call, wording acceptance, answer write, ADR approval, Git operation or external research.
- UI must retain private answer text/caret and reject hidden/stale/changed-record responses. Show why current selected draft scope differs from the original capture, so unrelated draft content cannot silently replace a record. Reuse ordinary recovery for confirmed interrupted writes.
- Release v0.1.103 with synchronized metadata and <=400-character note. Full tests/check/package; installed local ADR fixture for the changed helper-context contract. No paid providers/existing sessions. No browser/desktop automation; native visual/keyboard checks pending owner. Retain ignored evidence files.

### Task 1: Reviewed context, freshness and portable baseline contracts
**Files:** new adr-review-context.mjs and adr-update.mjs/tests; adr-scope/draft/sources/file modules and related tests.
**Interfaces:** projection/validator/change reasons above; `adrUpdateStatus(record,doc,path,scenario)` returns source state, reasons and coverage without file reads. Baseline validation stays in adr-file.
- [x] RED relevant vs unrelated changes, selected certainty/deletion/guidance, upstream prerequisites, dependency reorder, research stale/omitted evidence, scenario changed/unavailable, legacy unknown context/baseline, malformed/oversized fields, portability and immutable lifecycle baseline.
- [x] Implement optional contracts and reviewed projection through scope/draft/source capture. Preserve old imports and existing narrow source status semantics.
- [x] Gate focused pure/context/scope/draft/source/file/lifecycle/shared tests: 86/86 passed in 6976.4146 ms.

### Task 2: Exact current-file review and guarded replacement
**Files:** adr-file-storage/workflow and tests, lifecycle writer baseline integration, controller/server request validation as required.
**Interfaces:** bounded observation, explicit review-update preview, original association plus observed file base, required replacement resolution, existing recovery API.
- [x] RED full three-way preview, default keep/cancel, explicit proposed replacement preserving identity, missing/edited files, legacy baseline, stale source/file/root/association, exact final-await guard, interrupted file/association/completion and restart, unrelated answers retained after publication, response bounds and location portability.
- [x] Implement narrow reviewed variant; preserve ordinary and lifecycle exact-byte behavior. Set generated baseline on new/proposed/successor outputs.
- [x] Gate affected filesystem/workflow/HTTP and local Git portability tests passed in 110941.0962 ms; full output retained in task-2-tests.log.

### Task 3: Selected-record freshness and update review UI
**Files:** web/app/index/style and focused web tests; small client module only if justified by ownership.
**Interfaces:** explicit record selection/refresh, currentness reasons and coverage, three literal texts, keep-current/replacement choice, regeneration navigation, successor route, existing recovery.
- [x] RED manual additions survive default keep, explicit replacement shows consequences, unknown baseline, missing/edited/accepted states, relevant visible saves refresh, unrelated saves avoid reads, stale/hidden replies, scope mismatch acknowledgment and private editor preservation.
- [x] Implement narrow-pane controls with labels, focus and bounded requests. No browser automation.
- [x] Surrounding ADR UI gate passed in 49702.3014 ms; full output retained. Native rendering pending owner.

### Task 4: Documentation, review, verification and publication
- [x] Document whole-file conflict resolution, source coverage, baseline compatibility, lifecycle routing and recovery.
- [x] One independent final reviewer against baseline and complete tracked/untracked inventory. No Critical or Important findings. Deferred minor: an unrelated saved revision can leave the dialog's save revision old until explicit refresh/reinspection, causing a safe rejection. Recorded in #86 comment 6996618829. Reviewer did not reproduce tests or perform native checks; implementer owns the verification below. No re-review.
- [x] Synchronized .103 metadata. Full npm test passed 1438/1438 in 872616.7791 ms, with no failures/skips/cancellations. npm run check, npm run package, git diff --check and the installed local ADR fixture passed. Packaged new modules and UI bytes matched the source. No live/paid provider or existing-session interaction; native checks remain pending owner.
- [ ] Fetch/integrate/commit/push main without force; verify remote commit, comment/close #86, continue #87. Final task gate npm run check on published commit; receipt in issue/ignored ledger.
