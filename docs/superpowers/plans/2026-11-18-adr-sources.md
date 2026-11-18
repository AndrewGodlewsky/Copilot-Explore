# Durable ADR sources implementation plan

> Use superpowers:executing-plans inline, task by task, with one independent final reviewer. The owner authorizes sequential issue implementation and publication to main.

**Goal:** Preserve the selected reasoning behind each written ADR and let another checkout inspect its exact current sources without losing the historical capture.
**Spec:** [#84](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/84). Prerequisites #80 and #83 are closed. Baseline b1b183b76a5b13ba48f7d5a2ea7ee958fff127c2, v0.1.100.
**Architecture:** An optional validated source capture extends existing ADR associations and their recoverable write journal. Captured public decision records and recorded evidence render a readable Markdown appendix. Explicit source navigation reuses portable references; decision-impact analysis consumes recorded source IDs.
**Tech stack:** Existing Node ESM, plain browser modules, node:test/jsdom and local Git. No runtime dependency or external retrieval.

## Contracts and constraints

- Keep existing `adrFiles` v1 records valid. Add optional `sources`; a legacy record without it has unavailable historical capture, never inferred sources. Personal ADR writing remains supported with null portable locations and commit. Only newly reviewed writes/updates capture sources; status and refresh never update historical hashes or Git revisions.
- Source v1 object has exactly `version,capturedAt,journey,adrPath,guidance,includeEvidence,nodes,evidence,references,statements,digest`. `journey` is exactly `{id,rootId,createdAt,path,commit}`. Shared path is validated Git-root-relative `.explore.json`; `adrPath` is separately validated Git-root-relative Markdown. Personal paths/commit are null and references empty. Commit is null or a proven 40/64-character lowercase Git object ID. Existing association `path` remains attached-working-directory-relative; never reinterpret it.
- `guidance` is the explicit `framing()` projection. One to 100 unique nodes each have `{record,fingerprint}`; record is the exact `research-context.record()` question/direction projection (IDs, parent, question, saved answer/state or direction origin, review flag). Do not capture comments, handoffs, drafts, project excerpts, research prose, local metadata, tokens or session bindings. IDs preserve valid Unicode within 100 characters; source questions/answers retain existing bounds and literal text. Selected roots are not supported by the existing ADR scope. Captured parents may be outside the selected subset.
- Evidence uses the accepted draft's selected `researchEvidence` projection, including original URLs, recorded retrieval/provenance, claims and limitations. Omitted evidence is explicitly absent. Included evidence has exactly one entry for each selected node. Source fingerprints use a recursively key-sorted SHA-256 over the record and its captured evidence (or null); arrays retain order. Capture digest covers the validated object except itself, also canonically. Shared JSON property reordering must not break hashes. Captured research is not external verification or a user decision.
- Shared captures contain exactly one strict #83 reference per selected node, with matching journey/path/ID and required target fingerprint. Statement mappings are at most 35 entries `{id,section,sources}`, preserving the accepted draft's at most eight references per statement. Validate all node, guidance and evidence references against the capture. Capture size is at most 64 KiB UTF-8; the existing 50-association/9 MiB document, 64 KiB Markdown and 256 KiB journal limits remain. Reject overflow without clipping or evicting history.
- Create a capture only from fresh accepted draft inputs, using existing `adrDraftFreshness`/`selectedInputs`. `adrSourcesStatus(capture,doc,path)` reports current/changed/missing/unavailable and per-node details without modifying the capture. Compare saved records, included research, guidance and shared target fingerprints; later replacement of the accepted draft alone does not erase or rebase the old capture. Different journey identity or original shared path cannot be reported current. Missing nodes and edited research stay distinct from matching content.
- `adrSourcesMarkdown(capture,managedId)` renders captured questions, answers, states, guidance, evidence limitations and statement mappings with literal Markdown escaping, IDs/paths/digests and optional committed revision. Include copyable portable references and explicit unavailable/uncertain statements. `adrFileMarkdown(draft,id,scenario,sources = null)` adds the appendix before the final managed marker. The Markdown and persisted association identify the same managed ID and capture digest. No raw project excerpts or private sources.
- Writer preparation captures the exact destination first, then resolves safe portable locations and any committed source revision. Local read-only Git must use literal arguments, no lazy fetch/optional locks/fsmonitor/content filters, scrub ambient Git overrides, and verify the source against the committed blob. Dirty, untracked, unborn, filtered or unavailable sources get no invented commit. Revalidate checkout/source around asynchronous observation and before publication. Existing file/association two-part recovery retains the exact reviewed capture.
- Source details are available for individual ADR associations in the existing ADR file workflow; no project-wide index. Render captured/current states literally. Opening a recorded source explicitly prefills #83 inspection; it must not navigate as a rendering side effect or copy a new current fingerprint over the old reference. Missing/moved locations never auto-retarget. Preserve ordinary draft/pending/selection guards and stale-response lifecycle. Native checks remain owner-only.
- Decision-impact previews identify recorded ADR IDs/titles/paths whose selected sources intersect the changed question plus structural/confirmed dependent closure. Counts describe historical associations, not approval or verified ADR freshness. Report legacy unknown coverage. Existing importance bands remain unchanged; the impact cache key includes association inputs.
- Next release v0.1.101: synchronized metadata and newest release note, full tests/check/package, installed runtime fixture if host integration changes, exact remote main verification and issue comments. No browser/desktop automation. Retain ignored audit notes after the earlier cleanup rejection.

### Task 1: Captured source contract and Markdown appendix

**Files:** new `adr-sources.mjs`, `test/adr-sources.test.mjs`; `adr-file.mjs`, `portable-reference.mjs` strict validator export, related file/shared tests. Extract the unchanged path validator to `project-path.mjs` and re-export it from `project-repository.mjs` to keep schema loading independent of repository storage.
**Interfaces:** `captureAdrSources(doc,{journeyPath = null,adrPath = null,commit = null},capturedAt)`, `validateAdrSources(value)`, `adrSourcesStatus(value,doc,path = null)`, `adrSourcesMarkdown(value,managedId)`; optional `sources` in `validateAdrFile` and fourth renderer argument.
- [x] RED strict schemas, Unicode/bounds, literal captured answers/evidence/mappings, privacy canaries, legacy records, canonical shared round trips, no mutation after current/draft changes, missing nodes and changed research/guidance.
- [x] Implement the bounded capture, strict cross-reference validation, currentness and readable appendix with existing projections/validators.
- [x] Gate: source/file/shared-document tests GREEN.

### Task 2: Writer integration, portable paths and committed evidence

**Files:** `adr-file-workflow.mjs`, `adr-source-location.mjs`, `test/adr-source-location.test.mjs`; real Git workflow/storage tests. Status lists metadata rather than duplicating all captures into its bounded response.
**Interfaces:** validated capture joins the existing reviewed `record`, content and journal; exact source/location proof remains transient until confirmation.
- [x] RED nested working directory and fresh clone, committed versus dirty/untracked/unborn/filtered/unavailable source, historical commit retention, source/checkout races, file-published/association-pending recovery and stale update bases.
- [x] Prepare safe locations and optional proven commit; attach one consistent capture to Markdown and association. Preserve existing journal and final source checks.
- [x] Gate: ADR workflow/storage and project Git-status tests GREEN.

### Task 3: Source inspection/navigation and ADR decision impact

**Files:** focused source-details client as needed, app/index/server integration, portable-reference-client prefill, web/decision-impact and answer-changes; focused tests.
**Interfaces:** status returns bounded source details for recorded entries; explicit prefill opens portable-reference inspection; impact includes historical association identities and unknown coverage.
- [x] RED captured/current distinctions, literal evidence limitations, explicit source opening, missing/moved sources, same/cross-map draft safeguards, stale view/close responses, dependency closure and impact-cache updates without band changes.
- [x] Implement source details and reuse #83 navigation, with bounded rendering and accessible controls.
- [x] Gate: focused UI/client/impact/answer-change tests GREEN.

### Task 4: Documentation, final review and publication

**Files:** ADR documentation, links, plan records and synchronized release metadata.
- [x] Document path bases, capture/current distinction, Git proof limitations, legacy/Personal behavior, bounds and pending owner native checks.
- [x] One independent final reviewer; classify findings and fix material issues in one RED/GREEN pass, no re-review.
- [x] Full `npm test`, `npm run check`, `npm run package`, diff check; installed fixture if host integration changes.
- [ ] Commit/integrate/push main without force, verify exact remote commit, post evidence and close #84; continue #85. Final task gate `npm run check` on published commit.

## Review focus

- Mixed working-directory/Git-root paths must not navigate or overwrite another file after moving between nested folder and root checkout.
- Partial ADR publication/recovery must preserve one immutable source capture across independently saved Markdown and shared association.
- Imported/reordered historical captures must keep valid hashes without treating unverified research as current or approved.
- A source/checkout change in the last asynchronous Git/storage preparation must keep prior data and require new review.
- Missing nodes, legacy records, no portable Personal location and edited research must remain distinct from successful current-source resolution.

## Final review and release evidence

One independent reviewer found an Important publication race: the original source check preceded the last asynchronous destination/staging reads. Two regression cases reproduced stale new-file publication and replacement of the previous ADR. Publication now checks source authority again after those reads while retaining destination guards; both regressions and all 20 storage tests passed. No second review was requested.

A real shared-project preview measured 10,988.95 ms, exceeding the old 10-second dialog deadline. The ADR file dialog now allows a bounded 60 seconds. Two UI deadline cases failed before the change and passed afterward, covering a slow valid preview and a still-bounded timeout without losing the answer draft. Native narrow-pane, keyboard, screen-reader and clipboard checks remain owner-performed and pending.

The first full run passed 1,347/1,348, with one obsolete UI assertion still expecting unsupported ADR associations. Its corrected expectation passed in isolation. The final full run loaded the two new deadline cases and passed **1,350/1,350** tests (808,051.7 ms). `npm run check`, `npm run package` and staged diff checks passed for v0.1.101. No SDK wiring, helper configuration or host routing changed, so the installed runtime fixture was not rerun. Exact publication/remote verification is recorded in issue #84 after the release commit.
