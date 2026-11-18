# Shared contributor attribution implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Attribute new shared answers, questions and accepted synthesized drafts to explicitly chosen contributors while preserving unknown and historical provenance.

**Architecture:** Strict portable attribution contracts sit beside the content they describe. Private revisioned contributor settings supply an actor only at explicit user mutation boundaries; imports, restores, copies, merges and background bookkeeping preserve existing provenance. Derived UI status distinguishes matching recorded content from later unrecorded edits, without treating names or IDs as authenticated identity.

**Tech Stack:** Existing Node ESM, filesystem identity/lock/atomic-write helpers, native HTTP canvas and DOM/jsdom. No new dependencies or SDK wiring.

**Spec:** [Approved issue #81](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/81). Prerequisites #53/#54 are closed. Base v0.1.96, `f24c20644922f0afa308fcd54999af65d3aaabbd`, verified on remote main. The owner explicitly requested autonomous issue-by-issue implementation, comments, testing and publication; routine design and push approval need not be requested again.

## Design and global constraints

- Contributor preferences are private to Explorer's known data directory. No Git, account, environment username, email, machine name or session discovery. Optional Git defaults are unnecessary for this issue. A fresh installation has no chosen identity.
- A public actor is exactly `{id, displayName}`: UUIDv4 plus trimmed, nonempty, well-formed literal Unicode name, at most 96 characters, no control characters. The user explicitly chooses this public name; arbitrary extra personal fields are rejected. Settings retain the actor ID when renaming, clear it on explicit clear, and allocate a new ID when setting after clear. Historical snapshots are immutable.
- An event is `{actor,at}`, where actor is a validated snapshot or null and at is the actual ISO timestamp. Null means an unknown contributor. Existing unknown creation events remain null rather than inventing a legacy author/date.
- Optional node `attribution` is `{version:1,question?,answer?}`, with at least one aspect. Each aspect is `{origin,contentDigest,author,editor,accepted}`. Origin is `user`, `ai` or `unknown`; event fields are nullable. AI-origin question records have no human author; explicit acceptance and adjusted wording are separate events. Answer records represent user-stated decisions/states, not independent verification of where prose originated.
- SHA-256 binds a question record to `[kind,question,category]` and an answer record to `[answer,effectiveAnswerState]`. Digests omit node IDs so unchanged copied nodes retain provenance after fork remapping. Metadata whose digest no longer matches remains historical; it must not identify the current text's contributor. This is a descriptive consistency check, not an authenticity proof.
- Record the first justified author and latest explicit editor/acceptance, not an unbounded activity log. Unknown legacy authors remain unknown on later edits. Clearing local identity makes later events anonymous; it never deletes or relabels history. No-op saves and opening old files produce no timestamp churn.
- Optional `acceptance` inside accepted brief, handoff and ADR-draft artifacts is `{actor,at,contentDigest}`. It names the person who explicitly accepted the synthesized artifact, never its AI author or decision approver. Digest canonicalizes the validated artifact excluding only `acceptance`; source/uncertainty/user-edit labels remain unchanged.
- Stamp only explicit shared user operations: shared creation/manual question/direction, question-preview acceptance, direct answer/state/reaffirm/clear/restart, and brief/handoff/ADR wording acceptance. Derived descendant review/research-stale changes, imported/restored/merged content and file-association bookkeeping do not claim new authorship. Clone candidates inside persistence so existing final guards still compare their unmodified expected answer changes.
- Capture new provenance only for shared mutations. Personal files preserve imported/copied provenance. Scenario forks retain copied question and unchanged-answer records; the alternative answer retains prior metadata only as historical because its digest changes. Do not assign a personal fork to its opener or relabel copied text. Project copies preserve provenance as-is.
- Existing whole-node semantic merge keeps node text/attribution together. Artifact-local acceptance stays with the selected artifact. No independent global attribution ledger or new merge engine.
- Private settings are bounded to 4 KiB, strict UTF-8/JSON/schema, atomic and revision checked under an owned lock. Invalid settings are preserved and block an attributed shared write with an actionable repair/refresh message; silently claiming a previous or unintended identity is unacceptable. Missing settings allow unknown events. Existing answers remain recoverable on every failure.
- UI presents explicit Contributor settings and source/answer attribution as unverified display names, with current/historical/unknown labels. Derived status is computed server-side and cached per immutable document, not persisted or sent as actor authority. Independent editors and narrow-pane keyboard access remain intact.
- No account/authentication/permissions model, contributor analytics or personal change-since-last-visit feed. No browser/desktop automation. Native checks remain owner-performed. Keep ignored audit notes; no recursive cleanup after the earlier automated rejection.
- One issue-sized release commit, tentative v0.1.97 after verification. Synchronize all release metadata, newest release note <=400 characters, npm test/check/package, one final independent review and a single material RED/GREEN fix pass. No SDK change is planned; use installed fixture if the integration boundary changes. Fetch, integrate/push main without force, verify remote and close #81 with evidence; then #49 is unblocked.

## Review focus

- A legacy answer edited by a named contributor must not gain an invented original author or date.
- A teammate manually changing shared text while retaining old metadata must see historical attribution, not a false current-author claim.
- Shared guards, failed saves and automatic review propagation must not mutate caller candidates or attribute untouched descendants.
- Forks, imports, copies and semantic merges must preserve provenance with its actual text; changed alternatives must not inherit a false current author.
- A changed/cleared private identity or stale UI response must not rewrite historical records, expose unintended personal data, or replace connected answer editors.

### Task 1: Portable attribution contracts

**Files:** new `com.github.copilot/extensions/explorer/contributors.mjs`, `test/contributors.test.mjs`; update `model.mjs`, `decision-brief.mjs`, `implementation-handoff.mjs`, `adr-draft.mjs`, `scenario-fork.mjs` and focused compatibility tests.

**Interfaces:** validators `validateContributor`, `validateContributionEvent`, `validateNodeAttribution`, `validateArtifactAcceptance`; `nodeAttributionDigest(node,aspect)`, `artifactAcceptanceDigest(value)`; pure `attributeContributions(before,next,intent,actor,at)` returning a clone; `contributionStatus(doc)` deriving current/historical statuses. Intent identifies newly authored/accepted nodes, directly edited answer node, or accepted artifact field. It never derives an actor from document content.

- [x] Write RED contract tests for bounds/strict fields/Unicode, anonymous/legacy/AI distinctions, explicit edited aspects, same-content no-op, current/historical digest binding, immutable candidates, artifact acceptance and old/shared/import/history/fork/semantic-merge round trips.
- [x] Run `node --test test/contributors.test.mjs`; expected missing-module failure.
- [x] Implement minimal pure contracts and strict optional schema compatibility; preserve existing optional-field absence and legacy artifact hash input ordering.
- [x] Run `node --test test/contributors.test.mjs test/shared-document.test.mjs test/semantic-merge.test.mjs test/scenario-fork.test.mjs test/adr-draft.test.mjs test/implementation-handoff.test.mjs test/decision-brief.test.mjs`; expected GREEN. One release commit after all tasks.

### Task 2: Explicit private contributor settings

**Files:** new `contributor-settings.mjs`, `test/contributor-settings.test.mjs`; update controller/server routing.

**Interfaces:** a private settings owner reads `{version:1,revision,actor}` and saves a chosen name or clears identity at an expected revision. Controller exposes settings read/save using its trusted private directory; endpoint accepts only explicit name/clear fields and client/revision binding, never client-supplied public actor IDs or timestamps.

- [x] Write RED tests for missing/rename/clear settings, stale revisions/two writers, strict 4 KiB UTF-8/JSON, malformed/linked/replaced private files, atomic failure preservation and no implicit OS/Git/account reads or shared document changes.
- [x] Implement settings storage and protected bounded API using existing trusted private-directory/lock patterns.
- [x] Run `node --test test/contributor-settings.test.mjs test/contributors.test.mjs`; expected GREEN.

### Task 3: Shared mutation and portability integration

**Files:** controller explicit authored call sites, project creation as necessary, new `test/contributor-workflow.test.mjs`, shared fixtures/merge tests as appropriate.

**Interfaces:** commit/save accepts an explicit contribution intent, reads current private actor for shared writes and stamps a cloned candidate. Normal persistence/history and original final guards remain authoritative. Native callbacks/model payloads cannot supply actor metadata. Imports/restores/merges and personal saves preserve carried records without stamping the opener.

- [x] Write RED integration tests with actual two-private-directory shared writers, clone/pull simulation and semantic merge; old files opened unchanged, future identity rename/clear, explicit AI acceptance, stale/failed writes, derived descendant flags, fork/copy/import/history preservation and metadata leakage canaries.
- [x] Wire only enumerated explicit user operations; keep no-op behavior and guard identity. Add derived UI attribution statuses without exposing private preference state in ordinary snapshots or model context.
- [x] Run `node --test test/contributor-workflow.test.mjs test/contributors.test.mjs test/contributor-settings.test.mjs test/project-journey.test.mjs test/semantic-merge.test.mjs`; expected GREEN. Correct fixture filenames if repository inspection requires it and ledger the ruling.

### Task 4: Contributor settings and attribution UI

**Files:** `web/index.html`, `web/app.mjs`, minimal CSS, `test/web.test.mjs`.

**Interfaces:** explicit Contributor settings dialog with public-name preview, save/clear/refresh and privacy explanation; selected question/answer and accepted artifact views show unverified chosen names, meaningful timestamps and historical/unknown status. State updates retain editor DOM and unsaved text/caret.

- [x] Write named RED jsdom tests for settings save/rename/clear/conflicts/errors, no automatic setting, current/unknown/historical/AI-acceptance labels, literal names, late replies after hide/switch/suspend and retained drafts.
- [x] Implement narrow-pane controls and text-only provenance display with no network/account identity discovery or browser automation.
- [x] Run named attribution UI plus adjacent answer/artifact workflow cases; expected GREEN. Native checks pending owner.

### Task 5: Verification and release

**Files:** contributor documentation, README, synchronized version/release metadata and plan records.

- [x] Document covered and excluded mutation paths, private/public boundary, descriptive/unverified identity, legacy and historical behavior, fork/merge compatibility and owner checks; bump next patch and add <=400-character release note.
- [x] Obtain one independent whole-change review, regrade and fix material findings in one RED/GREEN pass; no re-review loop.
- [x] Run npm test/check/package and diff checks, plus installed runtime fixture if integration changed; record actual results.
- [ ] Fetch, commit, integrate/push main, verify remote commit, comment/close #81 with evidence and continue #49. Final task gate: npm run check on the published commit.
