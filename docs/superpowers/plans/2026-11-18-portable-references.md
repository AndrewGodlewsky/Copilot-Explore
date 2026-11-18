# Portable journey references implementation plan

> Use superpowers:executing-plans inline, one task at a time, with one fresh independent final reviewer. The owner has authorized sequential issue implementation and publication to main.

**Goal:** A teammate can copy a saved journey/question reference into a GitHub issue or Markdown document and explicitly open that exact location in their own current checkout.
**Spec:** [#83](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/83). Prerequisite #56 is closed. Baseline ea825e01b996e2d74ad540fc9c80ad4d29fb0f30, Explorer v0.1.99.
**Architecture:** A strict portable wire format and saved-node digest feed a transient, identity-bound inspection workflow. The existing project storage validation and guarded journey switch perform navigation; the canvas selects/reveals the target. Native bindings, shared files and model sessions are not modified by this feature.
**Tech stack:** Existing Node ESM, plain browser JS, node:test/jsdom and installed Copilot SDK declarations. No runtime dependency or custom protocol.

## Contracts and constraints

- Distinguish these public portable references from private pinned context in `references.mjs`. Reference object: exactly `{format:'explorer-reference',version:1,path,journeyId,nodeId,fingerprint?}`. A reference always has a node target; the root represents a journey. Root, ordinary question and user-direction targets must exist in the saved document. IDs preserve well-formed Unicode and obey the model's nonblank 100-character limit. `path` uses existing validated project-relative forward-slash rules and `.explore.json` suffix, at most 240 characters; add well-formed Unicode validation. Never interpret a URI, command, absolute path or shell fragment.
- Maximum reference text 8 KiB UTF-8. Copy canonical pretty JSON inside a single `explorer-reference` Markdown fence with a fixed plain-language heading telling the reader to use Explorer's Open reference. Parse either that exact generated wrapper or bare JSON. Reject other wrappers/trailing commands, unknown keys/version, bad fingerprint and malformed payload. Expose the JSON in a visible read-only copy area if clipboard is unavailable. No rendered links/HTML from user content.
- Optional fingerprint is lowercase SHA-256 over the selected saved node's identity/parent/kind/question/category/answer/effective answer state/review fields and journey identity; root additionally covers topic/guidance/mode. Exclude timestamps, revision, research, comments, handoffs, attribution, artifacts, private drafts and project excerpts. Match means this saved target matches, not that all branch/research context is current or correct. Missing fingerprint is explicitly unchecked; differing fingerprint is changed and requires explicit acknowledgement before opening current content.
- Source text contains only portable location/IDs/digest. No absolute machine paths, instance token, session/chat binding, authentication data, raw answers or private draft text. Saved IDs/path can be user-supplied data; this is a field allowlist, not redaction of arbitrary user naming.
- `PortableReferences.request(explorer,input)` handles copy/inspect/cancel under controller serialization; strict current `{journey,revision}` binding uses null/null on a fresh canvas. Copy requires a current saved Project map and fresh saved read. Inspect parses before reading, resolves only the exact current project-relative path via fresh metadata-backed ProjectRepository.selection, projectDocumentAccess and readSharedDocument, checks journey and node identity, and stores one transient selection ID with source digest/stamp, checkout revalidation and current map identity/revision. Return only literal summary/path/IDs/freshness and bounded caveats. Inspect does not attach or write shared files.
- `PortableReferences.open(explorer,input)` consumes a prepared selection ID, matching current map identity/revision and changed-source acknowledgement. Reject pending questions/research or unaccepted question previews. Revalidate current source, prepared project root/checkout/source stamp+digest/IDs; then ProjectRepository.openSelected and compare again before attachProject. Return target node ID alongside the UI snapshot. Read/navigation only: no shared writes, model calls, account lookup, cloning, notifications or another session's binding.
- Missing/moved path, unsupported/corrupt/linked target, mismatched journey, deleted node, changed checkout or replaced source yields a safe specific error and keeps the current map. Never scan for similarly named nodes or auto-retarget a duplicate identity at another path. A moved file needs a new reference made from its new location. One exact path is authoritative; this is not a global cross-repository identifier.
- POST `api/portable-reference`: instance token, strict Origin and X-Explorer-Client, bounded body. `open-reference` uses protected action handling with exact fields; retain early current/null bindings and pending/preview checks rather than weakening global guards. Clear prepared captures on edits/new inspection/cancel/close; validate stale current state even if a capture has not been proactively cleared.
- UI: Open reference on welcome and Tools; Copy reference in saved selected-node details for Project storage. One narrow dialog has paste text, Inspect, literal source preview, changed-source acknowledgement, Open and Close. Copy output remains manually selectable. Inspect never switches a map; opening is explicit. Editing pasted text clears the old preview and late requests cannot restore it. Existing busy/epoch, pagehide and suspension guards apply.
- Use existing `switchJourney` draft flush and pending/direction/reminder safeguards; target selection uses `select()` to reveal folded ancestors and clear an incompatible focus. Same-journey navigation avoids unnecessary reset of in-memory editors; cross-journey drafts remain scoped. Never silently discard newer pasted text, handoff/comment notes or answer drafts. Clipboard success is not a claim that the target was opened.
- Installed canvas.d.ts/extension.d.ts for runtime 1.0.106-8.unstable.r43566476370.g869eef3 expose no documented external deep-link route. Generic canvas input/action callbacks are not an OS/link route. No host wiring addition or invented protocol is planned. Reinspect declarations/run installed e2e if actual host integration scope changes.
- Native UI verification belongs to the owner; no browser/desktop automation. Next release v0.1.100, synchronized metadata/release notes, full tests/check/package, commit/push main and exact remote verification. Preserve ignored audit scratch notes.

### Task 1: Portable wire format and source matching

**Files:** new `portable-reference.mjs`, `test/portable-reference.test.mjs`.
**Interfaces:** `parsePortableReference(text)`, `createPortableReference(doc,path,nodeId)`, `formatPortableReference(reference)`, `portableNodeFingerprint(doc,nodeId)`, `portableReferenceStatus(reference,doc)`; source functions return validated portable data and current/changed/unchecked only, never raw private projections.
- [x] Write and observe RED tests for canonical JSON/Markdown round trips, root/question/direction, Unicode, exact field/version/byte/path/ID/digest rejection, malicious wrappers/paths, privacy canaries and correct saved-node freshness exclusions.
- [x] Implement the small pure format module using existing path validation/digest primitives and explicit saved-field projection.
- [x] Gate: `node --test test/portable-reference.test.mjs` GREEN.

### Task 2: Exact project resolution and guarded navigation

**Files:** new `portable-reference-workflow.mjs`, `test/portable-reference-workflow.test.mjs`; controller/server integration.
**Interfaces:** one transient `PortableReferences` instance per Explorer, request copy/inspect/cancel and open, exact prepared IDs/current bindings; protected API and `open-reference` response `referenceNodeId`.
- [x] RED real-repository tests: copy in checkout A, inspect/open same shared file in checkout B with fresh library/canvas and different absolute path; existing current map and private drafts preserved; zero model sends/shared writes.
- [x] RED missing/moved/mismatched/deleted source, stale fingerprint requiring acknowledgement, no fingerprint, traversal/external/linked/bad Unicode/oversize, stale current map/target/checkout between inspect/open, close/cancel/reinspection and pending/preview guards. Assert no attach on failure and no absolute paths in responses.
- [x] RED HTTP tests for strict origin/auth/action shape/limits, valid copy/inspect/open and failed identity checks.
- [x] Implement using current ProjectRepository and storage checks without adding another filesystem traversal layer or model route.
- [x] Gate: `node --test test/portable-reference.test.mjs test/portable-reference-workflow.test.mjs test/project-library.test.mjs` GREEN.

### Task 3: Copy/inspect/open UI and navigation

**Files:** focused `web/portable-reference-client.mjs`, app/index/minimal style integration, allowlisted module and explicit test/performance import wiring, new client tests and named HTTP UI cases.
**Interfaces:** callbacks for active/current state/busy lifecycle/copy/switch/select; local text/preview identity controls; no fetch as a side effect of paste alone.
- [x] RED jsdom tests for literal/manual copy fallback, personal-storage explanation, fresh welcome inspect/open, selected Project copy, same/cross journey navigation with folds/focus, answer/comment/handoff draft retention, pending/preview/unsaved-direction/reminder guards, changed acknowledgement and missing target errors.
- [x] RED client tests for newer text, stale inspected source, delayed response after hide/edit/suspend/journey switch, request cancellation, repeated navigation and keyboard-addressable labelled controls. Native visual checks stay pending.
- [x] Implement small client/dialog and use existing switch/selection lifecycle. Update explicit harness imports only as necessary.
- [x] Gate: focused client/named UI plus existing navigation/project library UI and performance harness cases GREEN.

### Task 4: Documentation, final review and release

**Files:** `docs/portable-references.md`, relevant library/export/integration/README links, plan records and synchronized version/release metadata.
- [x] Document format, explicit inspect/open, saved content scope, moved/missing repair, matching limits, clone portability, personal storage and lack of external deep linking.
- [x] One independent whole-change reviewer; classify findings, reproduce/fix material issues in one RED/GREEN pass, no re-review loop.
- [x] Run full `npm test`, `npm run check`, `npm run package`, diff checks; installed e2e if host integration changes. Record actual evidence and pending owner native checks.
- [ ] Commit next patch, fetch/integrate/push main without force, verify exact remote commit, post completion evidence and close #83; continue #84. Final task gate `npm run check` on published commit.

## Review focus

- Reference path/identity mismatch, duplicate or moved files must never produce a similar-looking navigation target.
- Checkout or selected bytes changing across asynchronous inspection/open must retain the original map and drafts.
- Null fresh-canvas binding and same-journey navigation must follow the same pending-work protections as ordinary library opens.
- Late inspection/open responses and newer pasted text must not revive obsolete navigation or lose scoped drafts.
- Optional source fingerprints and the Markdown fallback must have honest coverage, literal rendering, and no model/session/private-data inclusion.

## Final review evidence

One independent review found one Important attachment race and no Critical or minor findings. The final reference guard originally preceded `analytics.flush()` inside attachment. Target edits, checkout switches and canvas closure during that await all reproduced failed rejection. Attachment now prepares analytics first, validates the reference, and then replaces storage and the map synchronously. Five focused regressions passed after the three new cases failed before the fix. No second review was requested. Native layout, keyboard and clipboard verification remain owner checks.

Final release checks: `npm test` passed 1,320/1,320 tests (670,476.7 ms); `npm run check`, `npm run package` and `git diff --check` passed for v0.1.100. No SDK wiring, helper configuration or host route changed, so the installed runtime fixture was not rerun. Publication and exact remote verification are recorded in issue #83 after the release commit.
