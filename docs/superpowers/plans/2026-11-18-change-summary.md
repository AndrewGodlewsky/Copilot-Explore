# Exploration change summaries implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task, with one independent final reviewer. The owner has authorized sequential issue implementation and publication to main.

**Goal:** Give a PR reviewer an editable, deterministic Markdown account of two explicitly selected saved exploration versions.
**Architecture:** A pure allowlisted comparison produces the artifact. A small coordinator reads exact retained history or local Git/current shared sources and rechecks them before reuse. A dedicated browser client owns the editable preview and its lifetime.
**Tech Stack:** Node ESM, node:test/jsdom, existing local Git/history readers; no runtime dependency or model work.
**Spec:** GitHub #87, assigned to AndrewGodlewsky; start comment 6996850487. Baseline d0398058aceaa0b898c1065521d79234dbdd5d19 / v0.1.103. Prerequisites #55/#58 complete.

## Global constraints

- Preserve source text and Unicode. Read only validated saved/committed inputs. Exclude private drafts, selected project excerpts, local usage, helper prompts, and unrelated files through an explicit projection.
- Do not create/edit a PR/comment, commit, or send messages from the product feature. Copy/download requires explicit user action. No AI or external research.
- Exact before/after journey id, root id and creation identity must match. No inferred pairing across forks/copies. An explicitly chosen Git commit is the before side; do not substitute a common merge base.
- Prefer existing `History.list` and `ProjectMerge.capture` rather than a new Git reader. Reject unavailable/conflicted/unsupported selected-file Git states using `ProjectGitStatus`. Preserve current working-folder/checkout/file/ref guards, bounded local commands, and no filters/network/index writes.
- Source identities remain visible: saved revision/hash or Git ref/resolved commit/hash, plus relative project path when available. Current saved content is not labeled committed merely because HEAD exists.
- Saved scenario lineage can be compared. Historical external preference-register state is unavailable and explicitly omitted. ADR effects describe saved association/source metadata; no external Markdown reads or claims of current file freshness.
- Full output is bounded to 2 MiB UTF-8 and response to 4 MiB JSON; reject rather than truncate. Empty/whitespace authored values remain distinguishable. Literal fenced JSON/text prevents authored Markdown becoming summary labels or active HTML.
- No browser/desktop automation. Native narrow-pane/keyboard/theme/screen-reader/IME checks remain owner verification.
- Release .104 with synchronized package/lock/plugin/marketplace/extension/README versions and newest release note <=400 characters. Run full npm test/check/package, fetch/integrate/push main without force, verify remote and comment/close #87. No SDK integration changes expected; runtime fixture only if that changes.

## Contracts

- New `change-summary.mjs`: `changeSummary(before, after, { beforeSource, afterSource, path = null })` returns `{ markdown, bytes, limit, counts, coverage }`. Sources are `{ kind:'saved', revision, digest }` or `{ kind:'git', ref, commit, digest }`; strict fields/identity validation, acquisition proof belongs to the coordinator. `CHANGE_SUMMARY_LIMIT` is 2 MiB.
- Compare canonical stable-ID records and relationships independent of array ordering. Cover added/removed questions/directions, changed wording/parent/category/answer/effective state/review causes/research-stale flags; topic/objective/success criteria/mode/pins; dependencies and explanations; saved scenario/copy lineage; ADR id/path/title/status/hash/lifecycle/source-capture changes and linked-source change indications. Label assumptions and uncertainty without declaring an answer verified.
- Authored content stays in literal blocks. Omit raw research, full accepted artifacts, ADR generated baselines, comments/actor attribution and unrelated metadata; coverage says exactly what is omitted. Portable references for changed question records use existing helpers when a project-relative path is available, and explicitly remain historical snapshot references. A removed record may no longer resolve.
- New `change-summary-workflow.mjs`: `ChangeSummary.request(explorer,input)` under the controller's transaction/document lock. Strict `list`, `preview`, `check`, `cancel` request shapes bound to journey/current revision. `list` returns retained revision identities plus current and Git availability. `preview` takes `{kind:'saved',before:<revision>,after:<revision>}` or `{kind:'git',ref}` and returns a single bounded token, expiry (15 minutes), source identities and Markdown. `check` rereads exact sources and compares captured fingerprints; it never receives the browser's edited text. `cancel` clears only the matching preview.
- All actions reject changed selected journey/store/current revision/root. History snapshots are selected by actual retained revision; missing/pruned versions are unavailable. Git preview uses incoming/current from the existing capture, never merge resolution; check selected-file Git state before/after. Invalid JSON, unmerged index, unavailable base, changed ref/file/head/context reject without guessed content.
- New `web/change-summary-client.mjs` owns explicit selection, request/timeout/epoch, editable textarea, status and buttons. API through `api/change-summary`; add its asset to the server allowlist. App supplies current state/availability and calls update/close on source/journey/page changes. Stale previews retain edited text but disable copy/download. Recheck server token on explicit reuse, then use client-local edited text; late responses or changed editor generation cannot copy/download. Download status means requested, not saved.

## Review focus

- Source identity vs mutable aliases: a moved ref, pruned history or external checkout change cannot validate an older preview. Task 2 pins these cases.
- Private metadata hidden inside saved artifacts must not leak via generic serialization; only explicit fields enter Markdown. Task 1 canaries cover exclusions.
- Whitespace, Unicode and authored Markdown must not turn into misleading generated labels or lose answer meaning. Task 1 covers these boundaries.
- Historical scenario/ADR claims must not be replaced with today's external preference/file state. Task 1 checks coverage and saved-only effects.
- Delayed responses while editing, switching journeys or suspending must preserve private and summary drafts without enabling stale reuse. Task 3 covers those lifetimes.

### Task 1: Deterministic saved-content summary
**Files:** create `com.github.copilot/extensions/explorer/change-summary.mjs` and `test/change-summary.test.mjs`; reuse model, portable-reference and ADR source/context helpers where appropriate.
**Interfaces:** pure `changeSummary` and limit contract above, consumed by Task 2.
- [x] Write RED tests for additions/removals, state-only assumptions/review flags, changed wording/parent/guidance/dependencies, saved lineage, ADR metadata/source effects, stable array/key ordering, literal Unicode/whitespace/Markdown, portable references, excluded artifact canaries, mismatched identities and output bounds.
- [x] Run `node --test test/change-summary.test.mjs`. Expected: new module missing/behavior assertions fail before implementation.
- [x] Implement the bounded pure projection; never mutate source objects or include unselected metadata through broad serialization.
- [x] Gate `node --test test/change-summary.test.mjs test/portable-reference.test.mjs`. Expected: all pass. Record exact test evidence; code commits as one reviewed issue release after Task 4.

### Task 2: Validated versions and source rechecks
**Files:** create `com.github.copilot/extensions/explorer/change-summary-workflow.mjs`, `test/change-summary-workflow.test.mjs`; modify controller/server for a narrow route/delegation. Reuse history/project readers.
**Interfaces:** request/response shapes and token lifetime above. Existing owner transaction and document lock serialize read/reconciliation boundaries; final identity guard after awaits.
- [x] RED retained saved before/after and current selections, exact local Git reference/current comparison, missing/pruned/mismatched bases, changed revisions/ref/root/file, unmerged/filtered/unavailable Git, cancellation/expiry, response bounds, no project/index/Git writes, HTTP Origin/schema/body limits and no private canaries.
- [x] Run `node --test test/change-summary-workflow.test.mjs`. Expected: missing coordinator/route, then assertion failures until complete.
- [x] Implement strict sources and single preview coordinator. Avoid introducing another Git command layer or mutation path.
- [x] Gate `node --test --test-concurrency=4 test/change-summary.test.mjs test/change-summary-workflow.test.mjs test/history.test.mjs test/project-merge.test.mjs test/project-git-status.test.mjs`. Expected: all pass; revise exact existing test filename if inventory differs.

### Task 3: Editable preview with explicit copy/download
**Files:** create `web/change-summary-client.mjs`; modify web/app/index/style and server asset allowlist; add focused UI tests to `test/web.test.mjs` or a dedicated jsdom client test where sufficient.
**Interfaces:** Tools > Summarize exploration changes; explicit saved-version/Git selection and Generate preview, editable literal Markdown, source/coverage text, Copy Markdown/Download Markdown with source recheck. App-state updates invalidate preview, not private editors.
- [x] RED explicit selection and accurate identities, edits/copy/download, no automatic generation/posting, stale saves and selection changes, failed checks, late/reordered hide/switch/suspend responses, edits during awaited copy, retained private text/caret and keyboard labels.
- [x] Implement bounded controls and one request owner. Explicit regenerate replaces summary wording; stale text remains visible until that action. Clipboard/download failures make no success claim.
- [x] Gate focused new summary UI and surrounding export/history UI tests. Expected: all pass. No browser automation.

### Task 4: Documentation, review and release
- [x] Document scope/coverage, history retention, exact Git-before semantics, stale reuse, saved-only scenario/ADR limitations, output limits and manual verification.
- [x] Synchronize .104 metadata; one independent final reviewer against baseline plus complete new-file inventory. Regrade user effects, one material RED/GREEN fix pass, no re-review. Record rulings and deferred minors.
- [x] Run full npm test/check/package and diff check. Expected: all pass; record actual counts and test scope. SDK fixture only if an integration contract changes.
- [ ] Fetch/integrate/commit/push main without force; verify published commit, comment/close #87 and continue the next ready issue. Final task gate `npm run check` on published commit; receipt in issue/ignored ledger.

Release verification: final full suite 1,470/1,470 passed (737,299.8882 ms); check/package/diff checks passed and all 116 shipped extension files match the package. One independent review found a delayed-generation draft overwrite, fixed with input/composition regression coverage. The full-suite failure pass also corrected the benchmark import harness and asynchronous UI test synchronization without changing product behavior. Native checks remain pending. The publication receipt belongs in #87 and the execution ledger after remote verification.
