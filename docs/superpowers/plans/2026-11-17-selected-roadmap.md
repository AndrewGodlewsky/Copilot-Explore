# Selected Explorer roadmap implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Implement one GitHub issue at a time; do not dispatch nested implementers or reviewers.

**Goal:** Implement the owner's selected Explorer improvements, with a versioned, tested publication to main for each completed issue.

**Architecture:** Extend the existing plain-module plugin, preserving its map/model/controller/HTTP/SDK boundaries. Stable journey identity and recoverable local persistence support the library, history, and usage dashboard. AI suggestions remain proposals until the user accepts them.

**Tech stack:** JavaScript ES modules, native DOM/SVG, Node test runner and jsdom, installed Copilot Desktop SDK/runtime. No bundled SDK or additional speech models.

**Spec:** The linked GitHub issues in the issue index below are the accepted specifications, derived from the owner's November 17 selections. Each implementation receives a focused brief and tests before changes begin.

## Global constraints

- Create every selected issue before dispatching implementation agents. Work on one issue at a time.
- Original recommendations 61 and 68 are deferred: issues only, no implementation.
- Recommendation 11 is an AI-directed missing-question seed, not a manual map editor.
- Recommendation 28 is the explicit **Clean My Answer** button, using an isolated SDK session, never the main chat.
- Recommendation 26 must reuse installed Copilot Desktop speech components; no new models or dependencies.
- Preserve expanding nodes, keyboard access, narrow panes, user drafts, and explicit user commitment of answers.
- Follow AGENTS.md for host isolation, validated inputs, loopback HTTP, atomic persistence, retained usage receipts, and publication.
- Each completed issue receives a new plugin patch version, release notes, passing npm test and npm run check, applicable local runtime fixtures, review, commit, and verified push to origin/main. Never force-push.
- Automated tests must not use paid providers or existing user sessions. No browser or desktop automation without an explicit request.
- Publish only demonstrated capabilities. Historical analytics must not invent events, timings, or usage that was not recorded.

## Review focus

- Legacy files and imported duplicates: preserve text and identity, migrate optional metadata, do not double-count journeys.
- Stale helper responses and concurrent edits: preserve newer answers and drafts; accept only correlated results.
- Crashes and write failures: retain a recoverable committed document and distinguish drafts from decisions.
- Untrusted content and network redirects: render text safely, bound reads, and enforce restrictions at actual fetch boundaries.
- Large maps and narrow panes: preserve reachable controls, keyboard focus, selection, IME, and dictation during updates.

## Execution and recovery

The per-plan ignored workspace contains the issue manifest, focused briefs, review packages, and progress ledger. GitHub issue states and published commit IDs are the durable public record. Dependencies determine dispatch order; internal dependencies do not require user assistance. A task is blocked only when a specific external requirement prevents a complete implementation. Review findings must be resolved before publication.

Ruling: The owner's instruction to create issues and proceed with agents supplies execution approval. No additional planning confirmation is required. Existing isolated worktree is retained.

## Task 1: Release consistency checks (selection 51, issue 39)

**Spec:** `.superpowers/sdd/2026-11-17-selected-roadmap/issue-51.md` and https://github.com/AndrewGodlewsky/Copilot-Explore/issues/39.

**Files:** Create `scripts/release-metadata.mjs` and `test/release.test.mjs`; modify `scripts/check.mjs`, README, all version metadata, release notes. If providing the chosen safe bump command, keep it in `scripts/release-metadata.mjs` or one small dedicated script and register it in root package scripts. Include this roadmap document in the first release commit.

**Interfaces:** Export `checkReleaseMetadata(root)` from `scripts/release-metadata.mjs`; it validates relevant files under the explicit root, returns the current version, and throws an actionable file/field-specific error on mismatch. `scripts/check.mjs` invokes it before its existing syntax/assets/skill checks. Disposable fixtures call the same function. Keep historical README version references intact; identify current version declarations and installation-checklist assertions with explicit stable markers or tightly bounded sections.

- [x] Write failing fixture tests for package-lock root and packages entry mismatches, each manifest mismatch, current README and installation-checklist drift, newest release-note mismatch, invalid release summaries, and a valid document retaining historical references.
- [x] Run the focused tests and confirm they fail for the missing checks.
- [x] Implement the shared checks and a safe documented bump procedure. A script, if provided, validates inputs before mutations and synchronizes every required current-version reference without rewriting historical prose.
- [x] Add tests for rejected invalid bumps/no partial edits if a mutation script is implemented. Verify the procedure in disposable fixtures.
- [x] Bump to 0.1.13, prepend accurate release notes, and fix current README references. Preserve prior release notes and the complete plugin package.
- [x] Run `node --test test/release.test.mjs`, `npm test`, `npm run check`, and `npm run package`. No SDK fixtures are required because runtime integration is unchanged.
- [x] Self-review and commit all intended changes on the current isolated branch. Do not push, merge, or close the issue: the controller performs independent review and publishes after approval. Write the report to `.superpowers/sdd/2026-11-17-selected-roadmap/task-1-report.md` with RED/GREEN evidence, full checks, commit, and limitations.

Published task 1: **v0.1.13**, `474c1e3`, 93 tests, checks and package passed; remote main verified.

## Task 2: Exploration library (GitHub #1, original selection 1)

Read `issue-1.md` beside this file for the acceptance criteria. Read AGENTS.md and the current release procedure. This task follows release consistency checks and ships the next patch version. The controller will review, integrate, push, and close the issue after your commit.

### Goal and boundaries

Provide a library inside Explorer with recent, pinned, archived, and searchable saved journeys, plus new/open/import flows. Reopen independently of the original chat while keeping question generation attached to the currently opening session. Preserve existing files. No dashboard, draft persistence, revision history, AI changes, or scenario forks in this issue.

### Architecture decisions

- Add a focused `library.mjs` under the extension for library discovery/metadata and safe path resolution. Keep document edits and atomic revision checks in `controller.mjs`. Extract a small persistence utility only if shared locking/atomic-write code actually requires it; avoid a broad refactor.
- Keep document `id` as stable logical journey identity. Host session/canvas identity is an attachment, not a journey ID. Do not store raw user IDs as filenames: use hashes and allowlisted relative paths.
- Discover existing root `*.explore.json` files rather than requiring users to migrate manually. Do not overwrite/delete legacy files. New journeys may use a canonical hash-of-document-ID filename. A small binding file can remember the active journey for reopening the same canvas. Fresh `/explore` without a topic shows the library/start view.
- Reopening the same journey from another canvas must target the same backing document and its existing revision/lock checks, not copy it into the new canvas file. Reads and metadata changes must not increment document revisions or update its edited timestamp.
- Use a stable, opaque library entry key for addressing files. Resolve it only inside the owned data root; reject traversal, malformed keys, symlinks/junction escape, oversized files, and mismatched IDs. Do not expose absolute paths to the web UI.
- Store pin/archive/last-open metadata separately from answer data. Serialize and lock updates across instances, with revision checks for conflicting metadata changes. Archived means hidden from the default list, never deleted. Recent means a documented ordering (last opened where recorded, otherwise document updated time); do not invent past open events.
- Import of a new journey preserves the old canvas journey in the library. Import of an already-known identical journey reopens the existing one without duplicate storage. Divergent same-ID imports must not silently overwrite: present open-existing or explicit import-as-new-copy. The latter is duplicate-import handling, not the deferred scenario-fork feature. Preserve every original file if legacy duplicates already exist and surface ambiguity rather than silently selecting a divergent version.
- Keep the attached-chat `snapshot()` focused on the current document. Fetch library summaries via a separate HTTP/controller path so other journeys are not implicitly added to main-chat context.
- Keep `Explorer({file,...})` direct-file construction usable for existing tests/preview. Production canvas wires the library; avoid rewriting every test merely to satisfy the new constructor.

### UI behavior

- Add a Library entry point in the existing header and a compact library home with search, recent/pinned entries, archived filter, clear Open/Pin/Archive controls, and the existing new-topic form.
- Do not add a detached question panel. The map and expanding nodes remain unchanged when a journey is open.
- Until draft recovery lands in the next issue, block destructive journey switches when there are unsaved drafts or offer an explicit save/discard choice; never silently clear drafts. Cancel voice before switching. Pending AI work must be cancelled explicitly or block the switch; stale callbacks cannot write into another journey.
- Show understandable empty, missing/corrupt-file, storage-error, and duplicate states. One bad library file must not hide the rest of the library.
- Keep controls accessible and usable at 340px. Use existing text-only DOM construction and no new runtime dependencies.

### Files and interfaces

- Create `com.github.copilot/extensions/explorer/library.mjs`, with a small class or functions for listing safe entry summaries, resolving an entry, and updating pin/archive/open metadata. Export the exact chosen API and document it in your report for the next task.
- Modify `controller.mjs`, `canvas.mjs`, `server.mjs`, `web/app.mjs`, `web/index.html`, `web/style.css` as needed. Keep voice preferences rooted at the Explorer data directory after changing document paths.
- Add `test/library.test.mjs`; extend real-controller HTTP and jsdom tests plus `scripts/e2e.mjs` for cross-session/instance reopen. New browser modules must be in the HTTP asset allowlist and loaded by the DOM fixture.
- Read installed SDK canvas declarations and `docs/copilot-integration.md` before changing canvas integration. Installed SDK directory: `C:/Users/godle/AppData/Local/github-copilot-sdk/cli/copilot-sdk-runtime-1.0.106-8.unstable.r43566476370.g869eef3/copilot-sdk`; runtime executable is `copilot.exe` beside it. No npm SDK substitute.

### Test-first steps

- [x] Add focused failing tests: legacy discovery; create two journeys; reopen from a different canvas/session; same-file simultaneous writers; pin/archive/recent/search; malformed/oversized files; safe entry resolution; duplicate import identical versus divergent; metadata conflicts; preservation of unsaved drafts and pending callbacks during switching.
- [x] Run the focused tests and record meaningful RED output.
- [x] Implement the library service and controller lifecycle, then HTTP/UI wiring, preserving existing behaviors.
- [x] Extend the local installed-SDK fixture to create a journey in one canvas and reopen it in another without using paid inference or another existing user session.
- [x] Run focused tests as needed, then `npm test`, `npm run check`, `npm run e2e` with the specified installed runtime variables, and `npm run package`. Run research fixture only if research integration changes materially.
- [x] Update README usage, a short durable library architecture note, current version/release notes, and commit. Use the preceding issue's release procedure. Do not merge or push.
- [x] Self-review and write `.superpowers/sdd/2026-11-17-selected-roadmap/task-2-report.md` with tests/RED/GREEN, commit, chosen APIs/storage contracts, and honest native-UI limitations. Return a concise status/commit/test summary.

Do not spawn subagents. No browser/desktop automation. The controller supplies the independent reviewer. Raise concrete architecture conflicts to the controller, not the user; keep working on independent parts.

Published task 2: **v0.1.14**, `8353367`, 110 tests, check, package and installed-SDK cross-session fixture passed; remote main verified.

## Task 3: Automatic answer-draft recovery (GitHub #2, selection 2)

Read `.superpowers/sdd/2026-11-17-selected-roadmap/issue-2.md`, `task-3-design-notes.md` in that same directory, AGENTS.md, and the completed task-2-report.md library report before editing. Library is published at 835336774557e49abc6ae58b5a22028e3f857845. Ship version **0.1.15**. No main-chat or research generation changes.

## Goal

Recover unfinished typed/dictated answers after reload, canvas close, or restart, without silently committing them as decisions or overwriting newer text. Preserve drafts across node navigation and journey reopen.

## Consumed library interfaces

The preceding task adds `Library(directory)`, `list({search,archived})`, `resolve(key) -> {key,file,document}`, `opened(key,binding)`, and `bound(binding)`. `Explorer` has optional `library`, `binding`, and `activeKey`; production snapshots identify `library: true` and `activeKey`, while direct-file fixtures remain supported. Current document data stays in `explorer.doc`; library data is not part of attached-chat context. Re-read its final report for changes to this contract.

## Design decisions

- Add a focused `drafts.mjs` local store and a small browser coordinator if needed. Keep draft persistence outside `doc.nodes[].answer`, document revisions, model prompts, and native/Markdown exports of committed decisions.
- Key drafts by stable library entry and node identity (use a stable direct-file equivalent in fixtures/preview). Legacy divergent files sharing a document ID must not exchange drafts. Include a base fingerprint of both the question and committed answer so a recovered draft can be recognized as stale.
- Each persisted draft has exact text, a revision, and a timestamp. Keep tombstones/revision identity when clearing so late writes cannot resurrect a discarded or committed draft. Use serialized atomic writes and cross-instance locks/revision comparisons. Never silently overwrite another canvas's newer draft.
- Bound individual text at the existing 20,000-character limit and aggregate storage sensibly. Validate files, identities, shapes, size, and canonical paths; preserve malformed files. Reuse existing safe storage utilities where appropriate, without moving unrelated code.
- Debounce edits (approximately 500 ms), persist dictated text and research-proposal additions/undo, and expose Saving draft / Draft saved locally / Draft could not be saved states distinct from Answer saved.
- Initial recovery is asynchronous: do not overwrite local typing, selection, or IME that started while a recovery read was pending. Guard both source journey/node identity and local edit generation.
- On a clean matching base, restore the draft into the editor. On a changed committed base, keep both and provide an explicit recover/use or discard choice; no automatic overwrite of the newer answer. Keep orphaned draft text recoverable rather than silently deleting it.
- Before switching/importing/creating another journey, flush pending writes and preserve persisted drafts; if saving fails, keep text and block the switch unless the user explicitly discards. Cancel active dictation before changing context. Manual missing-direction drafts remain under the existing guard; this issue persists answer drafts only.
- An explicit answer save clears only the matching saved draft, never subsequent typing or a newer draft from another canvas. Failed answer saves retain the draft. Discard is explicit and revision-checked.
- Keep finishing/export behavior honest about uncommitted drafts; they are not answered questions. Do not send drafts to AI implicitly. A saved local draft need not trigger an unsaved-data close warning, but pending/failed persistence must remain visible and warn appropriately.
- Lifecycle flush is best effort; document the debounce window and avoid claiming recovery of unflushed keystrokes after abrupt process termination.

## Files and interfaces

- Create `com.github.copilot/extensions/explorer/drafts.mjs` and `test/drafts.test.mjs`. A focused `web/drafts.mjs` is allowed if it keeps persistence coordination out of rendering; register any new asset and load the real module in the DOM fixture.
- Add explicit controller methods and bounded GET/POST draft endpoints in `server.mjs`; require the instance token, Host checks, same write Origin and client header. Draft operations must verify the active journey identity so delayed requests cannot cross a switch. Do not expose drafts through the agent-callable canvas snapshot.
- Integrate the existing `drafts` Map, answer input, voice insertion callback, recommendation application/undo, answer save, import/library switching, and page lifecycle in `web/app.mjs`. Avoid broad rendering refactors (separate issue #33).
- Document exact store/client APIs in the report; upcoming Clean My Answer and search issues will use them.

## Test-first steps

- [x] Add failing store/controller tests for reload/restart, exact Unicode/whitespace, multiple nodes, source answer change, identical IDs in divergent files, overlapping writers, malformed storage, failed writes, and stale write after clear.
- [x] Add real HTTP/jsdom regressions for typing during recovery, debounced save, dictation/recommendation persistence, save while typing, switch with pending/failed write, discard/reopen, and no draft content in exports or AI context.
- [x] Run focused RED tests, implement the smallest complete design, and run focused GREEN tests.
- [x] Run `npm test`, `npm run check`, and `npm run package`. Run local installed-SDK fixture if canvas/host wiring changes; no paid inference or existing user sessions.
- [x] Update README limitations/usage and release metadata/notes with the current documented procedure, self-review, and commit on the current isolated branch. Include the controller's roadmap update. Do not merge, push, or close the issue.
- [x] Write the full report to `.superpowers/sdd/2026-11-17-selected-roadmap/task-3-report.md`: RED/GREEN, commands/results, commit, APIs, and remaining manual native checks. Return a concise status/commit/test summary.

No subagents or browser/desktop automation. The controller performs independent review and publishes after approval. Raise concrete conflicts to the controller while continuing independent work.

Published task 3: **v0.1.15**, `516653e`, 132 tests, check and package passed; independent review and remote main verified.

## Task 4: Optional exploration objective and success criteria (#3 / selection 4)

Draft recovery now supplies DraftClient and a separate drafts.json store; read docs/drafts.md and preserve its exact-text/race guarantees. Guidance does not change a node's question or committed answer, so avoid unnecessarily invalidating unrelated draft bases.

Read the accepted issue at .superpowers/sdd/2026-11-17-selected-roadmap/issue-4.md, AGENTS.md, and task-3-report.md before editing. Draft recovery is published at 516653e924ff4c8ec218df0287e9df0db90a30a0. Ship **0.1.16**. Work only on optional objectives and criteria.

### Goal and model

Let a user say what they want to understand or decide, and what would make the exploration useful enough to finish. Keep free exploration available when these fields are omitted. Treat criteria as guidance, never an automatic completion verdict.

- Add top-level objective and successCriteria strings to the existing version-1 document. Absent legacy values normalize to empty; explicit invalid types are rejected. Objective max 2,000 characters and successCriteria max 4,000. Keep Unicode and safe text rendering, and document the fields/limits.
- Extend creation and later edits through the controller's existing serialized revision-checked save. Preserve the topic, nodes, stable identity, drafts, history compatibility, and archived/library metadata. Reset finishedAt on meaningful changed guidance; a no-op must not manufacture a document edit.
- Native JSON and Markdown include committed guidance with clear labels; validation/import/export round-trip both fields. Do not create an incompatible format or conflate criteria with answered questions.
- contextFor must include committed guidance in question generation. boundedContext must retain it in isolated research within the existing total budget. Treat these fields as exploration data under the current injection/isolation instructions. Do not send draft settings or answer drafts.
- Retain current pending-operation policy; metadata edits while a generation/research task runs should be blocked clearly rather than allow stale guidance to commit. Independent work policy is a later issue.

### UI

- Creation: compact optional disclosure containing Objective and Success criteria fields; both optional. Avoid burdening a quick topic-only start.
- Existing journey: lightweight header entry to revise guidance in a dialog/disclosure. No permanent question side panel. Use labels, keyboard focus/escape behavior, length limits, saving/error feedback, and narrow-pane wrapping.
- Preserve the active expanded node, unsaved answer drafts, selection/caret, and view when guidance is saved. Failed/stale saves retain the settings input for retry. Switching journeys must not carry unsaved guidance into another journey.
- Documentation explains what guidance affects and that finishing remains the user's decision.

### Files and verification

Likely model.mjs, controller.mjs, research.mjs, web/app.mjs, web/index.html/style.css as needed; corresponding model/controller/research/web tests. Add a focused UI module only if responsibility requires it; no runtime dependency or broad refactor.

- [x] Add focused failing regressions for absent legacy fields; invalid types/lengths; Unicode/native and Markdown round trips; create/edit/no-op/stale writer; main-question and isolated research inclusion/budget; uncommitted exclusion.
- [x] Add real HTTP/jsdom checks for optional creation, edit/cancel/error, preserving a draft and focus while saving, and no settings leakage across journeys.
- [x] Implement and pass focused tests. Run npm test, npm run check, npm run package. Run the installed local research fixture because its payload changes; no paid providers or existing user sessions. Use the installed SDK, not an npm replacement.
- [x] Bump to **0.1.16** and synchronize required metadata/README/release notes using the established procedure. Include controller's roadmap update, self-review, commit on this isolated branch. No merge/push/issue closure.
- [x] Write .superpowers/sdd/2026-11-17-selected-roadmap/task-4-report.md with exact fields/APIs, RED/GREEN/full commands and results, commit, and manual native visual limits. Return concise status.

No subagents or browser/desktop UI automation. Controller performs independent review and publication. Raise concrete conflicts without stopping independent work.

Published task 4: **v0.1.16**, `f557d94`, 144 tests, check, package and installed local research fixture passed; independent review clean and remote main verified.

## Task 5: Answer states (#4 / selection 5)

Read .superpowers/sdd/2026-11-17-selected-roadmap/issue-5.md, AGENTS.md, docs/drafts.md,  .superpowers/sdd/2026-11-17-selected-roadmap/task-3-report.md, and .superpowers/sdd/2026-11-17-selected-roadmap/task-4-report.md. BASE is f557d94a5ffd4e08d70381cac9d3a60df7798c7a; ship **0.1.17**. This adds the meaning of a committed answer; it is not question importance or AI confidence.

### Model and semantics

- Add answerState with stable values unanswered, decided, tentative, assumption, needs-evidence, not-relevant, revisit-later. Display labels Unanswered, Decided, Tentative, Assumption, Need evidence, Not relevant, Revisit later.
- Missing legacy state becomes Tentative for nonempty answers and Unanswered for empty ones. Reject explicit invalid state values. Keep the existing version-1 import format additive and preserve text/research. The root remains the idea and is excluded from question counts/state controls.
- Decided, Tentative and Assumption require nonempty answer text. Need evidence, Not relevant and Revisit later may have an optional note or no text. Unanswered cannot silently discard nonempty text: require the user to clear the text explicitly. These rules apply in validation, UI and commands.
- Preserve near-limit legacy maps when adding state defaults; avoid materializing redundant default fields across thousands of nodes if that would make a previously valid file exceed its size cap. A shared effective-state helper can provide documented legacy defaults while keeping persisted defaults sparse. Test this migration boundary; do not silently drop user content or widen all storage limits without a concrete reason.
- A new nonempty answer defaults conservatively to Tentative until the user selects otherwise; edits retain an explicitly chosen state unless they make it invalid. Persist state and answer together on the existing explicit save action. AI research, dictation and draft recovery cannot commit a state or answer by themselves.
- A meaningful change to committed state or text marks descendants for review, consistent with existing ancestor-change behavior. No-op save must not manufacture a change and must still validate on-disk revision freshness. Task 4 added a read-only refresh-guidance command and explicit guidance conflict choices; follow the same freshness discipline for answer-state saves. Keep request correlation, library identity, atomic revision/conflict rules and objective fields intact.
- Provide a shared question-count helper. Total excludes root; answered means nonempty committed text; resolved means Decided or Not relevant with no needs-review flag; deferred means Revisit later; unresolved means total minus resolved. These categories overlap; never derive unresolved by subtracting answered. Document these definitions for future dashboard/filter tasks.
- Preserve/display state in map, outline, native JSON, Markdown, contextFor and isolated research. Include state-only choices in contextual information even when no answer note exists. Prompts explicitly distinguish decisions, assumptions, tentative statements, deferred/unresolved issues and review flags without treating any state as external verification.

### Editor and draft integration

- Use one compact labeled selector inside the expanding answer node. Avoid a new side panel or editing-heavy workflow. Show saved state on compact nodes and in outline with text, not color alone. Keep keyboard focus and narrow-pane wrapping.
- State selection is a draft until Save answer or Save & explore deeper. Preserve it with automatic draft recovery; a state-only edit must be recoverable and counted as uncommitted. A text-only insertion from voice/research/undo must preserve a deliberate state selection.
- Extend the focused draftBase/store/client/save contracts centrally to include committed/draft state. Old persisted text-only drafts remain recoverable; changed hashing must not silently drop them. Newer committed states require the same explicit stale-draft choice as newer text.
- Save captures both text and state at click time. Later changes to either remain a draft. Conditional clear matches expected revision and submitted content; do not clear another canvas's later state. Keep drafts excluded from context/exports/counters.
- Explain invalid combinations without discarding input. Do not automatically mark an AI proposal Decided when a user applies it. Finishing and any deepening control should handle no-text states honestly; do not fabricate an answer solely to satisfy old guards.

### Verification and release

Likely model/controller/research prompt, browser rendering and draft modules, corresponding tests and docs. No new runtime dependencies or broad unrelated restructuring.

- [x] Focused RED/GREEN tests for every state and empty-text rule, conservative legacy import, malformed values, root exclusion, shared counts/review flags, state-only and no-op saves, descendants, native/Markdown/context round trips.
- [x] Real HTTP/jsdom tests for choose/save, text-only draft insertion preserving choice, state-only reload, legacy draft recovery, stale state conflicts, click-time state capture/later edits, failure preservation and exported/context draft exclusion.
- [x] Verify existing question generation/research remains attached/isolated as before. Run npm test, npm run check, npm run package and local research fixture for changed context/prompt. Use installed runtime and disposable/local provider only; no paid calls or existing sessions.
- [x] Bump to **0.1.17**, synchronize metadata/README/release notes, document semantics and draft migration, include controller roadmap update, self-review and commit on the current isolated branch. No push/merge/issue close.
- [x] Write .superpowers/sdd/2026-11-17-selected-roadmap/task-5-report.md with exact APIs/migration, RED/GREEN/commands/results, commit and native manual limits. Return concise status.

No nested agents or browser/desktop automation. Raise concrete conflicts to controller while continuing independent work. Controller reviews and publishes.

Published task 5: **v0.1.17**, `3e84bbc`, 161 tests, check, package and installed local research fixture passed; review approved and remote main verified. Minor orphan-state label follow-up assigned to task 7.

## Task 6: Collapse and expand branches (#5 / selection 6)

Read .superpowers/sdd/2026-11-17-selected-roadmap/issue-6.md, AGENTS.md, docs/answer-states.md, and .superpowers/sdd/2026-11-17-selected-roadmap/task-5-report.md for final answer-state count APIs. BASE is 3e84bbc179c9fa8ca553407da203fe9fa7a45c47; ship **0.1.18**. This changes map visibility, never the exploration's saved content.

### Behavior

- Provide explicit branch collapse/expand controls. Distinguish them from closing the expanded node editor. A collapsed branch keeps its own node visible and hides all descendants/edges, with hidden-question and unresolved-descendant counts. Use task 5's shared effectiveAnswerState/questionCounts semantics (web/answer-state.mjs); do not count nonempty answers as automatically resolved.
- Keep collapsed IDs stable during polling, answer/research changes and layout recalculation. Do not open or close unrelated branches as a side effect. A fresh journey starts with its own view state. View folding must not write document revisions or remove answers/research.
- Build visibility and subtree counts through iterative traversal suitable for supported deep/wide 5,000-node maps. Compute each node's contribution once and aggregate postorder, avoiding repeated whole-subtree scans. A small shared resolved predicate is permitted if needed to keep counts consistent. Lay out only visible nodes and edges. Use one focused pure helper in the existing layout area or a small browser branch module; no graph dependency or broad rendering refactor.
- If an ancestor of the selected node is collapsed, preserve the descendant's draft text, state selection (including stateSelected) and editor state, cancel dictation, and move visible selection/focus to the ancestor. Never leave the expanded editor floating for a hidden node. Navigation via outline to a hidden node expands only its ancestor path and reveals it.
- Keep the complete outline available, with collapsed indicators and accessible branch controls, so hidden questions remain discoverable before the later full search feature. No content deletion or manual tree editing.
- Keep controls usable by keyboard with clear labels and visible focus; avoid nested buttons inside node buttons. Preserve panning/selection guards, zoom and expanding-node geometry. Compact nodes communicate hidden counts using text, not color alone.
- Existing drafts, source research, pending requests and native/Markdown exports must retain the full document irrespective of view folding. Completion under a folded branch updates its content without forcing visibility.

### Work and verification

Likely web/app.mjs, web/layout.mjs or a focused branch helper, web/style.css, relevant layout/web tests. Register any new asset in server/check/real-module DOM fixture.

- [x] Write failing pure tests for deep/wide/nested folds, descendant/unresolved counts, visible edges, root folding and path reveal. Include maximum supported depth without recursive overflow.
- [x] Real HTTP/jsdom regressions for fold/unfold, active descendant drafts/focus, pending research completion in a folded subtree, poll stability, outline reveal and no committed revision/data loss. Test selectors/labels reachable at narrow fixture geometry; don't claim native visual proof.
- [x] Implement focused GREEN, run npm test, npm run check and npm run package. No SDK fixture needed unless host wiring is unexpectedly changed; no paid inference or existing user sessions.
- [x] Bump to **0.1.18** and synchronize metadata/README/release notes, document controls, include controller roadmap update, self-review and commit. No merge/push/issue closure.
- [x] Write .superpowers/sdd/2026-11-17-selected-roadmap/task-6-report.md with visibility/helper contracts, RED/GREEN and commands/output, commit and manual checks; return concise status.

No nested agents or browser/desktop automation. Controller reviews and publishes. Raise concrete conflicts while continuing independent work. Upcoming focus/minimap/semantic-zoom tasks should be able to reuse the visible-node contract.

Published task 6: **v0.1.18**, `6ade380`, 166 tests, check and package passed; review approved and remote main verified. Minor hidden-outline work assigned to task 24.

## Task 7: Undo, revision history and named checkpoints (#9 / selection 10)

Read .superpowers/sdd/2026-11-17-selected-roadmap/issue-10.md, task-7-design-notes.md, AGENTS.md, docs/library.md and docs/drafts.md. Read the final task-5-report.md and task-6-report.md in that same directory. Answer state and draft recovery include stateSelected; branch folding is independent in-memory presentation state. BASE is 6ade38089dbdd3937664de48717fa5e80a02025b; ship **0.1.19**.

### Scope and storage

- Make committed answer/state changes, question additions, research replacements, guidance and other supported document changes recoverable. Provide Undo latest change, history preview/restore and named checkpoints. Do not implement deferred scenario forks or general manual editing.
- Key history by stable library entry identity, preserving the isolation of divergent same-ID files and direct-file fixtures. Imported copies get independent history; an ordinary reopen does not fabricate a change or historical usage.
- Add a focused history service; integrate at the existing serialized, locked document-save boundary. Reuse atomic-write utilities. Do not claim multiple file renames are atomic together: define a crash-recoverable protocol whose committed-document outcome and history outcome reconcile deterministically. A failure before replacing the document must leave the previous document recoverable, and a stored preimage alone must not be displayed as proof of a completed mutation.
- Store immutable validated committed snapshots with honest revision/time and action labels. Retain research sources and exact user content; no drafts, microphone/audio data, full chat logs or view-only pan/zoom/fold changes in history. No events for a true no-op.
- Bound history to at most 50 retained snapshot revisions and 128 MiB of snapshot content per journey; allow at most 10 named checkpoints with names of 1?120 characters. Named checkpoints reference protected immutable revisions and count against the same storage limits. Exclude the live document itself from this separate history budget. Provide documented retention, a visible oldest available point, and explicit failure when protected named checkpoints prevent safe pruning. Do not silently remove named checkpoints. Test the exact count/byte/name limits and report them; keep ordinary edits practical for maps near the existing file cap. A directory and manifest design is allowed, with no new runtime dependency.
- Treat corrupted history entries conservatively: preserve them and surface a readable recovery error. They must not silently overwrite the active journey. Validate all IDs, paths, byte limits, imported shapes and snapshot identity; no symlink/junction escape.
- Restore validates the chosen snapshot against the current schema, preserves the active stable identity, and creates a fresh monotonic revision/time through current writer checks. It never mutates the source snapshot or rewinds a revision. Make restore undoable as another committed change. Reconcile schema defaults while preserving compatible old text/research.
- Undo means the latest relevant committed transition shown to the user, not an arbitrary older local edit. Preview scope and require the displayed current revision; another canvas's intervening edit must reject safely. A stale no-op still checks disk freshness. Pending generation/research must be explicitly canceled or block restore; old callbacks cannot overwrite the restored map.

Task 7 clarification: a content-changing history restore creates a fresh monotonic revision. An identical-content restore checks on-disk freshness, reports that the selected version already matches, and adds no revision or history event. Direct-file imports with a changed document ID use a new path-plus-ID history identity; old history is retained separately.

### UI and drafts

- Add compact History access and Undo without adding a question side panel. Show meaningful time/action/revision labels, checkpoint names and a preview describing what will be restored; require an explicit restore action. Naming a checkpoint does not edit the document or imply a new usage session.
- Keep dialog keyboard access, cancel/Escape/focus return, narrow-pane layout and readable loading/error/empty/retention states. Async history responses must be bound to the journey that requested them.
- Restore must not silently discard local drafts. Flush/preserve them under their original base; normal stale-base recovery offers explicit choices for changed answers. Removed-node draft text and state stay recoverable. Resolve task-5-review.md Minor: orphan recovery must visibly label the saved state, including no-text drafts; cover this with a real-editor regression. Retain view state where IDs survive; repair selection/folding safely when they do not. Task 6 provides branchView(nodes,rootId,collapsed) -> {nodes,edges,descendants} and revealPath(nodes,collapsed,id); use these existing contracts. isResolvedQuestion is the shared resolved-state predicate.
- Return summaries for the history list and fetch only a requested snapshot/preview; do not add all history to normal state polling. Do not include history snapshots implicitly in main-chat/research context. The active committed document remains the only ordinary context source.

### Verification and release

- [x] Test-first coverage for initial legacy baseline, every supported mutation class, true no-op, checkpoint persistence, exact count/byte limits and protected retention, restoring twice, restored provenance, identity isolation, schema validation and near-limit maps.
- [x] Inject failures around snapshot/manifest/active-document writes and simulate interrupted recovery. Verify the active document remains valid, history does not invent successful commits, original files remain recoverable, and retry is safe.
- [x] Real two-controller/HTTP/jsdom checks for stale restore, undo after unrelated edits, draft preservation/stale choice, pending work, late response after journey switch, keyboard dialog actions and missing/corrupt history.
- [x] Run npm test, npm run check and npm run package; applicable installed local SDK fixture only if host wiring changes. Never paid providers or existing sessions; no UI automation.
- [x] Bump to **0.1.19**, synchronize metadata/README/release notes, document recovery/retention/API contracts, include controller roadmap edit, self-review and commit. No merge/push/issue close.
- [x] Write .superpowers/sdd/2026-11-17-selected-roadmap/task-7-report.md with the atomicity/recovery protocol, exact APIs/limits/migration, test RED/GREEN and final command outputs, commit and remaining manual checks.

No nested agents. Raise a concrete storage-protocol ambiguity to the controller while progressing independently. Controller reviews and publishes.

Published task7: **v0.1.19**, `bc63012`, 192 tests, checks and package passed; independent review approved and remote main verified.

## Task 8: Focus a branch (#13 / selection 14)

Read .superpowers/sdd/2026-11-17-selected-roadmap/issue-14.md, task-8-design-notes.md, AGENTS.md and final task-6/task-7 reports in that workspace. BASE is bc630125740762ace935c6982a55a54fd8161d09; ship **0.1.20**. This is optional presentation focus, not an AI scope or graph edit. History read/restore APIs and saved-outcome contracts are documented in docs/history.md; focus changes must not call save/history. Capture test output and exit codes without PowerShell treating ordinary npm stderr notices as test errors.

### Behavior

- Add an explicit Focus branch action to the current question workspace (including leaves) and a clear Show whole map action/status while focused. Keep root and the complete ancestor path visible with the chosen subtree; hide unrelated branches. Focusing the root is equivalent to whole map.
- Keep focus ID separate from the existing collapsed Set. Reuse/extend branchView/revealPath instead of changing saved nodes. Preserve unrelated folds; folds within the focused subtree still work. Ancestors necessary to reach the focus root remain visible. If the user explicitly collapses an ancestor above the focus root, exit focus and perform the requested collapse through the existing safe selection/draft path.
- Keep the complete outline. Selecting an out-of-focus node through outline/search deliberately exits focus, expands only its ancestor path and reveals it. Ordinary poll/research completion never resets focus or expands unrelated branches. Opening another journey resets focus.
- On Show whole map retain the current selected node, editor/draft state and underlying folds; keep the selected node reachable using existing reveal/fit behavior. Preserve the prior whole-map view when practical, without restoring a transform that strands selection offscreen. Fit/Home acts on the currently visible map; Show whole map is a separate explicit action.
- A history restore can remove focused/selected IDs. Fall back safely to the whole map/root as needed, retaining surviving folds and all draft recovery data. No floating editor for a hidden or removed node.
- Focus changes must not modify document revision/timestamps, question counts, native/Markdown exports, research data, AI context or committed history. Pending research can continue in unrelated branches without being silently retargeted.
- Keep controls inside the existing expanding-node/header flow, no question sidebar. Use visible focus, labels/pressed state, text focus status, narrow-pane wrapping and existing pointer/text selection guards. Do not introduce a graph dependency or broad render rewrite.

### Verification and release

- [x] Focused RED/GREEN pure visibility tests for deep paths, root/leaf/nested focus, nested collapse interaction and restoration of unrelated folds; keep supported 5,000-node traversal iterative.
- [x] Real HTTP/jsdom tests for explicit focus/whole-map controls, out-of-focus outline reveal, drafts/state/caret retention, polling/hidden research, history removal of IDs, fit bounds and unchanged document/export/context/history.
- [x] Run npm test, npm run check and npm run package; installed SDK fixture only if integration changes. No paid inference or existing sessions.
- [x] Bump to **0.1.20**, synchronize metadata/README/release notes, document focus versus fold behavior, include controller roadmap update, self-review and commit. No merge/push/issue closure.
- [x] Write .superpowers/sdd/2026-11-17-selected-roadmap/task-8-report.md with visibility/focus APIs, RED/GREEN/final commands and outputs, commit and native manual limits.

No nested agents or browser/desktop automation. Controller reviews and publishes. Raise concrete conflicts while continuing independent work.

Published task8: **v0.1.20**, `09b60b8`, 200 tests, checks and package passed; independent review/fix review approved and remote main verified.

## Task 9: Map navigation preferences (#16 / selection 18)

Read .superpowers/sdd/2026-11-17-selected-roadmap/issue-18.md, task-9-design-notes.md, AGENTS.md and final task-8 focus/fix and task-6 folding reports in this workspace. BASE is09b60b8e7950b829ea5c43dcc38144870c01ae95; ship **0.1.21**. Preserve existing recoverable map bounds and answer editing.

### Preferences and interaction

- Add a compact Map settings entry/dialog in existing map controls. Persist Explorer-wide navigation settings in its owned data root, separately from documents/history/drafts and voice settings. Never modify Copilot settings or put preferences into AI context.
- Version-1 settings contract: revision, wheelMode ('zoom' or 'pan', default 'zoom'), sensitivity (finite number 0.25 through 3, default 1), motion ('system', 'reduce' or 'full', default 'system'). Use labeled controls, useful descriptions, reset-to-defaults, save/cancel/error states and focus return. Reset requires an explicit save to persist.
- Store bounded validated JSON atomically with an exclusive lock and expected revision. Preserve corrupt/unreadable files and explain the problem while leaving the map usable with safe in-memory defaults. Failed/stale saves retain field choices and permit deliberate refresh/retry; do not silently overwrite another canvas's settings. Read/write endpoints use existing instance token, Host, Origin/client header protections and a small bounded body.
- Zoom mode retains cursor-anchored wheel zoom. Pan mode uses horizontal/vertical wheel/trackpad deltas, normalizing pixel/line/page modes. Ctrl/Meta wheel remains anchored zoom in either mode. Shift-wheel with only a vertical delta may pan horizontally; do not double-transform a device's existing horizontal delta. Sensitivity scales wheel input only; keyboard/button steps remain predictable.
- Normal scrolling inside expanded-node controls/content must remain native unless the explicit zoom modifier is held. Keep text selection, IME, drag threshold, pointer cancellation, recoverable pan bounds and min/max zoom safeguards.
- System motion follows prefers-reduced-motion and reacts to OS changes. Explicit Reduce/Full overrides it. Apply effective preference to existing spinner/meter transitions/scroll behavior; preserve useful nonanimated recording/status feedback. Do not add decorative movement just to demonstrate the setting.
- Show a short current-mode hint near map controls without obscuring content. Existing microphone/model settings and configured voice shortcut remain usable. Persist settings across journey and canvas changes, not per ephemeral HTTP origin.

### Implementation boundaries

Keep navigation preference parsing/persistence in a small focused extension module, using storage.mjs atomic writes directly. Reuse established root/path/lock patterns where applicable without copying the older voice preference module's unbounded read or changing voice settings in this issue. Keep browser preference controls in a focused module if adding them would further tangle app.mjs; report the chosen API for later features. Register any browser asset in the existing server allowlist and real-editor fixture. Production data-root wiring may touch canvas.mjs, so inspect the installed SDK declarations and run the runtime fixture if that integration changes.

### Verification and release

- [x] RED/GREEN store tests for defaults, bounds/type validation, persisted reload, same-file writers, corrupt/oversized/linked storage and failed write preservation. Keep failures recoverable without user file deletion by tests.
- [x] Real HTTP/jsdom tests for setting save/cancel/reset/retry, wheel mode/modifier/delta normalization, horizontal pan, sensitivity, zoom bounds, cursor anchoring, answer scroll/selection, system motion updates and explicit override. Verify docs/history/context unchanged.
- [x] Run npm test, npm run check and npm run package; runtime fixture only if host integration changes. No paid providers or existing sessions.
- [x] Bump to **0.1.21**, synchronize metadata/README/release notes, document navigation/motion behavior and limitations, include controller roadmap edit, self-review and commit. No merge/push/issue closure.
- [x] Write .superpowers/sdd/2026-11-17-selected-roadmap/task-9-report.md with storage/API contracts, RED/GREEN/final checks, commit and manual hardware/visual limits.

Capture native exit codes/stdout/stderr without wrapping ordinary npm notices as PowerShell test errors. No nested agents or browser/desktop automation. Controller reviews and publishes. Raise concrete conflicts while continuing independent work.

Published task9: **v0.1.21**, `ccc02a3`, 210 tests, checks, package and installed local canvas fixture passed; independent review/fix review approved and remote main verified.

## Task 10: Review generated questions before adding them (#17 / selection19)

Read issue-19.md and task-10-design-notes.md in this workspace, AGENTS.md, docs/copilot-integration.md and final history/focus/navigation reports. BASE is ccc02a3d10c86c436887f42acacad7a412eeb164; ship **0.1.22**. This changes the existing generation callback from permanent insertion to a proposal; answering/deepening still uses the attached main chat.

### Contract

- submit_questions fulfills only the existing correlated request by staging a validated batch. It cannot initiate work or commit nodes. Preserve request/instance/session identity checks, enqueue-only attached-session wiring, failure/cancellation behavior, and compatibility with the existing {requestId,questions:[{question,category}]} callback shape.
- Root initial generation and deeper generation both show a compact candidate preview at the relevant expanding node. Provide Accept selected and Dismiss all, individually selected candidates, and optional wording adjustment before acceptance. No question sidebar or general map editor. Empty-map dismissal leaves an explicit user-triggered retry.
- Use a single explicit acceptance to add the selected subset atomically. Revalidate edited candidates, duplicates and document/file limits at acceptance; reject invalid input without partial changes. Keep original generated wording/category plus user-adjustment provenance separately from final question text, with bounded validated additive schema fields. Legacy nodes retain their meaning.
- A candidate batch is temporary and owned by the current canvas/journey/request/parent. Label it as not saved. It survives state polls within this canvas, but is discarded on close/restart; an intentional journey switch or replacement generation requires explicit dismissal or confirmation so preview work is not silently lost. Do not add a new persistent proposal store for this issue. Do not include unaccepted candidates as committed map/export/history/AI context.
- Bind source validity to the actual committed generation context (contextFor currently includes topic/objective/criteria, ancestor question+answer+state+review, existing child questions and answered/stateful nodes elsewhere), not merely the draft text. Detect relevant changes before staging and before accepting, including disk changes from another canvas; reject stale proposals with a clear regenerate path. Pending callbacks after cancel/switch/restore cannot revive a batch. Draft edits do not become implicit AI context.
- Dismissal and preview wording changes do not increment document revision or history. Acceptance creates one committed change through the existing save/history protocol. Preserve saved answer states, local text/state drafts, caret and disclosure state; existing source answer save may already be a separate committed change.
- Reveal accepted nodes through focus/fold contracts without opening unrelated branches, with a clear discoverable count/link or highlight that honors reduced-motion settings. Do not force selection away from a dirty editor. Ordinary hidden-branch research/polling must retain focus/folds.
- Update the /explore skill, callback description and documentation so a legacy callback stages questions and never bypasses review. Inspect installed SDK declarations before wiring changes. Keep all controls keyboard-accessible and usable in narrow panes; safe text rendering only.

### Published integration seams to preserve

- Navigation preferences now use `NavigationPreferences(file)` and private GET/POST `api/navigation-settings`. Browser `attachNavigation({document,window,fetch,zoom,pan})` in `web/navigation.mjs` owns preferences, wheel interpretation and effective root `data-motion`. New-node feedback must honor that motion setting. Read the final task-9 report for its validated bounds/revision contract.
- Full Outline already searches question/answer/category; do not replace it or add a detached editor. `branchView(nodes,rootId,collapsed,focusId=null)` preserves an ancestor path plus focused subtree and honors subtree folds; fold/focus are browser view state, not document edits.
- The skill file is root `skills/explore/SKILL.md` (the issue starting-point shorthand is not an extension-local skill path). `Explorer.snapshot()` currently serves both HTTP UI and native `get_exploration`; separate browser-only preview payloads from attached-chat context so adding a preview property does not expose unaccepted candidates through the native action. The callback result must describe staging honestly rather than report that nodes were saved. Keep source fingerprints/private captured context out of the portable document and UI unless needed.
- Do not put full source context or user answers into node provenance. Keep only the bounded generation/original wording/category and adjustment information necessary for this feature. Name the chosen additive fields and their validation/export semantics in the report.

### Verification and release

- [x] RED/GREEN model/controller tests for initial and deeper batches, subset acceptance/all dismissed, optional wording and original provenance, duplicate/invalid edits, exact limits and atomic near-limit failure, source changes/disk staleness, cancellation and late/legacy-shaped callbacks, no-op dismissal and acceptance history.
- [x] Real HTTP/jsdom tests for preview controls, keyboard/selection, retry, drafts/state/caret, focused/folded parent reveal, polls/restart/journey-switch semantics and unchanged committed exports/context until accepted.
- [x] Extend and run the installed local canvas runtime fixture for generation staging and explicit acceptance using simulated authorized user commands; no paid provider or existing user session. Run npm test, npm run check and npm run package. Research fixture only if helper context changes.
- [x] Bump to **0.1.22**, synchronize all release metadata/README/release notes, document temporary-preview/provenance contracts, include controller plan update, self-review and commit. No merge/push/issue closure.
- [x] Write task-10-report.md in this workspace with APIs/schema, TDD/final command evidence, commit and native limitations. No nested agents or browser/desktop UI automation. Raise concrete conflicts to the controller while continuing independent work.

Published task10: **v0.1.22**, `27ba4ae`, 222 tests, checks, package and installed local canvas fixture passed; independent review approved and remote main verified.

## Task 11: Suggest a missing direction (#10 / selection11)

Read issue-11.md and task-11-design-notes.md in this workspace, AGENTS.md, and the final task-10 report. BASE is **27ba4aeb507fcdc5b1a7aef16473de804dcfb265**; ship **0.1.23**. The candidate/provenance seams below match the published task10 report. The user explicitly wants guided exploration, not manual map editing.

### Contract

- Replace the visible manual question/category form with one unobtrusive missing-direction input associated with the current branch. Use an explicit action to preserve the direction and ask AI to develop questions underneath it. No general node editing, reparenting, freehand layout or category management.
- A user-supplied direction is a seed node, not a settled answer or an unresolved research question. Use optional `kind: 'direction'` for these user-origin structural nodes, with a shared effective-kind/question predicate. Missing kind preserves every legacy node's root/question meaning; do not infer kind from wording/category. Reject unknown kinds and kind on the root.
- Bound direction text to **600 JavaScript characters**, reject empty/whitespace-only and invalid types, preserve Unicode and original user text. Store the original text in the direction node's question field without trimming; ordinary legacy/generated question normalization stays unchanged. Show a clear user-origin Direction label. Retain original direction provenance when saving/importing/exporting; do not fabricate AI authorship or a user answer. No arbitrary file/project instructions are followed from the seed text. A direction seed has empty answer, no answerState field, no research result and no AI generation provenance; validate those distinctions. Its kind identifies user origin and its unchanged text is the original direction, so do not duplicate that text into a second provenance blob without a demonstrated need.
- Persist the seed through the existing revision-checked atomic history path. Then use the existing attached-session enqueue/correlated generation flow and temporary candidate preview to develop children. This may be a single explicit Add and explore action, but a send failure or cancellation leaves the committed seed available for retry. Generated children are saved only after user acceptance.
- Allow generation beneath a direction without requiring an answer/state. Direction presentation offers its text, children and explicit generation/retry, not an answer editor that pretends the seed is a question. Reject answer mutations for direction nodes through backend validation too. Existing ordinary legacy manually added questions remain answerable.
- Keep map-node limits inclusive of roots and seeds, while question counts/answered/resolved/deferred/unresolved/hidden-question counts exclude both idea roots and direction seeds. Reuse the shared predicate in model validation, answer-state counters, branch summaries, outline labels, Markdown, generation/research context, and later-facing summaries. Avoid multiple inconsistent count definitions. Layout/folds/focus still include seed nodes as structural nodes.
- Preserve unrelated text/state drafts, caret, disclosure and voice cancellation rules when adding a seed. Guard a typed but unsent direction during journey switches just as the old manual form was guarded. Do not switch away from a dirty answer editor silently; make the new seed/preview reachable through existing focus/fold contracts and reduced-motion behavior.
- Keep request/session/instance identities, cancellation and source-staleness rules from task10. Include original direction as labeled context data; it is not a fact or decision. Research remains isolated; this issue does not add a new helper type.
- Root skill is skills/explore/SKILL.md. Update generation prompt/docs and runtime fixture for explicit no-answer seed generation and preview acceptance. Keep old add-command support only if existing compatibility requires it; no new visible manual editor.

### Published candidate integration

- Explorer.uiSnapshot() adds browser-only preview to committed native snapshot(); preview is {id:requestId, journey:activeKey||doc.id, nodeId, questions:[{question,category}], stale}. Captured source context stays private.
- accept-questions takes {revision,batchId,selected:[{index,question}]} and returns UI state plus acceptedIds/acceptedParentId. dismiss-questions takes {batchId}, with no document save. Reuse this explicit acceptance rather than bypassing it for seed-generated questions.
- Model candidateQuestions(doc,parentId,values) validates proposals; acceptQuestions(doc,parentId,batch,selected) returns {document,ids}.
- AI-generated question provenance is optional generation={requestId,originalQuestion,originalCategory,adjusted}; bounded lengths match request/question/category, final category equals originalCategory, and adjusted matches normalized wording difference. Do not misuse this AI-generation object for user-origin seed provenance. Keep the new distinction small and validated.

### Verification and release

- [x] RED/GREEN model/controller tests for Unicode/empty/length/type input, legacy root/question behavior, shared counts and exports, seed provenance round trip, no-answer generation, successful candidate acceptance, failed send/retry, cancel/late callbacks, duplicate/bound/near-limit atomic failure, same-file stale writes and history.
- [x] Real HTTP/jsdom tests for lightweight form, existing answer/state draft and unsent direction guards, keyboard access, focused/folded reveal, root/question/seed retry, and safe text rendering. No browser or desktop UI automation.
- [x] Run npm test, npm run check, npm run package and installed local canvas runtime fixture. Run research fixture if its actual context changes. Never use a paid provider or existing user session.
- [x] Bump to **0.1.23** and synchronize metadata/README/release notes; document seed semantics and update relevant integration notes. Include controller plan update; self-review and commit, no merge/push/issue closure.
- [x] Write task-11-report.md with exact chosen schema/API/counting contracts, TDD/final command evidence, SHA and native limitations. No nested agents. Raise concrete conflicts while continuing independent work.

For clean native command evidence, use the controller-provided ignored helper: `node .superpowers/sdd/2026-11-17-selected-roadmap/run-npm.mjs task-11-test test` (and unique labels with `run check`, `run package`, applicable `run e2e`). It invokes the installed adjacent npm CLI through Node, captures stdout/stderr separately and writes result JSON with the exact exit code. Do not rerun a passing suite only to improve logging. The demonstrated installed runtime executable is sibling `copilot.exe`, not `copilot-runtime.exe`.

Published task11: **v0.1.23**, `fcb8a6a`, 229 tests, checks, package and installed local canvas/research fixtures passed; independent review approved and remote main verified. Two Minor follow-ups recorded for related/final review.

## Task 12: Pin prior questions as references (#19 / selection22)

Read issue-22.md and task-12-design-notes.md in this workspace, AGENTS.md, and final task10/11 reports before edits. BASE is **fcb8a6a3cfdee688b7f292e297359792687db88b**; ship **0.1.24**. These are optional visual references, separate from later AI-context constraints.

### Contract

- Let users pin up to three ordinary question nodes as read-only references near the active expanding editor, in an optional compact disclosure. Do not add a mandatory detached sidebar. A question can be open or answered; show its actual saved state/review flag, never call it a settled decision merely because it was pinned. Roots/direction seeds are not answer references.
- Show source question and saved answer, with a short summary and accessible full-text disclosure for long answers. Use literal text rendering, preserve Unicode, and never substitute another node's unsaved draft. Label the active editable question separately. Removing a reference only unpins it.
- Source updates refresh content from the current committed document. If history restore removes a pinned source, keep an explicit missing-source row with Remove; never silently point at a different node or erase the pin. Restoring the same source ID can make it available again. Do not add pin copies of answer content to disk.
- Provide a deliberate source jump through existing select/reveal/focus/fold rules. It retains the current text/state draft and respects voice cancellation. Merely displaying references cannot change selection, folds or AI context. Removing a pin returns focus to a stable nearby control; all operations are keyboard-accessible and usable in a narrow pane.
- Persist reference node IDs as private per-journey view metadata across canvas reopen, independently of exploration documents/history/drafts/navigation settings. Use stable library entry identity, not only document ID, so divergent same-ID entries stay separate. Direct-file construction uses canonical-path-plus-ID identity as drafts/history already do. Portable exports do not include these local view preferences; document that behavior.
- Use a small focused store under Explorer's owned root, with a references/ directory containing one safe hashed-journey-key .json file. Version-1 record is {version:1,revision,nodeIds:[...]}, with at most three unique valid node IDs (current model ID bounds), nonnegative safe integer revision and no unknown keys. Limit each file to 4096 bytes and write HTTP JSON body to 1024 bytes. Use atomic write, exclusive lock and expected revision; reject linked/non-regular files. Store no answers, prompts, paths or host IDs. Missing is empty; corrupt/linked/oversized data remains preserved with safe UI fallback/error. Reject stale writes without silently overwriting another canvas and provide a deliberate refresh/retry. Document the exact store/body limits and stale retry contract. Do not widen library summary or native get_exploration payloads to expose private view metadata.
- Validate newly added IDs against ordinary questions in the active saved journey. Existing pins that become missing/non-question after restore/import remain explicit unavailable rows; permit retaining or removing them, but never adding arbitrary absent/non-question IDs. Unchanged metadata saves should check freshness and remain no-ops. Source text/state follows the current committed map and its established explicit-refresh semantics for another canvas's edits; do not add a silent document reload that could replace drafts.
- Use existing token/Host/Origin/client protections for private HTTP access; validate active journey identity on each read/write. Preserve edited fields/reference choices through async responses and journey changes; do not let an old read repaint another journey's pins. Pin/unpin does not increment document revision/history/updated time or automatically send anything to AI.
- Keep this focused: no shared references across journeys, broad note editor, collaboration, AI pinning or backend retrieval. A compact browser module is acceptable to keep existing app.mjs changes focused; register any browser asset in allowlists/fixtures.

### Published integration seams

- Task11 supplies effectiveKind(node), isQuestion(node), nodeStatus(node) in web/answer-state.mjs, with model re-exports for the predicates. Effective kind is idea for parentId===null, otherwise explicit direction or legacy question. Reuse isQuestion for pin eligibility; do not infer roles from labels/answers. Generic library nodeCount remains inclusive of structural seeds.
- Task10 uiSnapshot() is browser-only preview plus committed snapshot(); native get_exploration excludes previews/private metadata. Keep references on their private endpoint, not added to the native snapshot/context.
- Existing canonical journey/draft/history identity already handles activeKey vs direct-file realpath+ID. Reuse that safety contract rather than inventing identity from topic, session ID or only document ID.

### Verification and release

- [x] RED/GREEN store/controller tests for cap, duplicates, invalid/missing node IDs, same-ID divergent journeys, direct-file support, reopen, stale writer conflicts, bounded/corrupt/linked files and failed-write preservation. Missing-after-restore behavior must remain removable/recoverable.
- [x] Real HTTP/jsdom tests for answer/state/review updates, long/Unicode/unsafe text, disclosure and keyboard removal/focus, source jumps through focus/folds retaining drafts, delayed reads across journey changes, and no document/history/native context effect.
- [x] Run npm test, npm run check, npm run package; installed runtime fixture if host/data-root integration changes. No paid providers/existing user sessions or browser/desktop UI automation.
- [x] Bump to **0.1.24**, sync release metadata/README/release notes, document private-view semantics; include controller plan changes, self-review/commit, no merge/push/issue closure.
- [x] Write task-12-report.md with exact store/API contract, TDD and final command evidence, SHA and native limits. No nested agents. Raise concrete conflicts while continuing independent work.

For clean native command evidence, use the controller-provided ignored helper: `node .superpowers/sdd/2026-11-17-selected-roadmap/run-npm.mjs task-12-test test` (and unique labels with `run check`, `run package`, applicable `run e2e`). It invokes the installed adjacent npm CLI through Node, captures stdout/stderr separately and writes result JSON with the exact exit code. Do not rerun a passing suite only to improve logging. The demonstrated installed runtime executable is sibling `copilot.exe`, not `copilot-runtime.exe`.

Published task 12: **v0.1.24**, `a6f754f`, 239 tests, checks/package/installed local SDK fixture passed; remote main verified.

## Task 13: Visible dictation controls (#20 / selection23)

Read issue-23.md and task-13-design-notes.md, AGENTS.md and final preceding UI reports. BASE is `a6f754f683a577c2f186efc7ecdf984fe5638a34`; ship version **0.1.25**. Reuse the installed local dictation path; this issue makes it discoverable, not a new speech service.

Task12's current UI seam: optional #references disclosure and #references-summary live inside the question workspace. Go to source uses existing select() and cancels voice; Remove focuses the reference summary. These are separate reference/navigation actions, not voice controls: preserve their established behavior while narrowing the answer-to-voice-control focus boundary. Task12 independent review approved without findings. Read task-12-report.md only for these integration seams.

### Contract

- Add labeled Record, Stop and Cancel controls beside the answer's existing voice status/meter/settings. Record starts a hands-free recording until Stop, independent of Copilot's configured hold/toggle mode. Keep the current configured shortcut and its host hold/toggle behavior unchanged for shortcut-started recordings. Never change host settings or install another runtime/model.
- One shared recording lifecycle owns buttons and shortcuts; track initiation so releasing a shortcut key cannot stop a button-started job accidentally. A deliberate configured shortcut press during a button-started recording may finish it once; repeats and subsequent keyup cannot restart/finish another job. Define and test that behavior. No duplicate capture or microphone ownership.
- Make phases understandable: loading explains to wait for Listening; listening has the existing real input-level and elapsed feedback; transcribing shows progress/state. Stop is available when listening; Cancel remains available during loading/listening/transcribing. Do not pretend an early Stop captured audio. Show recoverable error/no-speech/timeout states and the existing microphone/model settings when unavailable.
- The current answer blur handler cancels immediately, so change the focus boundary deliberately. Moving by Tab or pointer between the answer and its voice controls must not cancel before Stop/Cancel can run. Genuinely leaving that answer workspace, editing its text, switching node/journey, window blur, hidden/pagehide and Escape still invalidate/cancel the recording. Normal action/menu navigation should not keep a hidden microphone running. Account for app rerenders without leaking listeners or losing the active control focus.
- Capture answer context/value/caret before button focus changes. On a valid final transcript, insert once at the captured selection using the existing draft insertion callback; preserve state choice and the answer limit. Do not auto-save, submit or launch generation. Late/cancelled/old-node/old-value transcripts cannot overwrite new text or a later recording. Keep the original draft when transcription fails or exceeds the limit.
- Respect the existing Map settings effective motion behavior. Retain useful text/status/input-level information with reduced motion. Keep controls usable by keyboard at narrow width, with accessible names and focus return after Stop/Cancel where appropriate.
- Existing service contracts remain: one module-wide microphone owner, job IDs/cancel-before-start protection, heartbeat and bounded duration/phase timeouts, process close/release and no audio persisted to disk. Longer dictation is the next issue; do not expand limits here. Actual worker is voice-worker.mjs. Keep installed-component discovery, existing microphone/model choices and owned storage.

### Verification and release

- [x] RED/GREEN browser/voice fixture tests for pointer and keyboard button use, captured caret, focus moving within/outside voice controls, Record/Stop/Cancel in each phase, shortcut hold/toggle interoperation/repeat/keyup, rapid retry, pending requests, app refresh, edits/navigation and stale transcript rejection.
- [x] Assert exactly-once draft insertion, state preservation, answer limit, no implicit commit, unavailable settings/error recovery, and microphone process/owner release with local mocked hardware/worker fixtures. Do not record the real microphone or drive desktop/browser UI.
- [x] Run npm test, npm run check, npm run package; run existing installed local runtime fixture only if SDK/canvas integration changes. Installed component smoke may inspect availability without capture/download. No paid providers/existing sessions.
- [x] Bump confirmed patch, synchronize metadata/README/release notes, document button versus shortcut semantics; include controller plan update, self-review and commit. No merge/push/issue closure.
- [x] Write task-13-report.md with lifecycle/focus contracts, TDD/final checks, SHA and native microphone/appearance limits. No nested agents. Raise concrete conflicts while continuing independent work.

For clean native command evidence, use the controller-provided ignored helper: `node .superpowers/sdd/2026-11-17-selected-roadmap/run-npm.mjs task-13-test test` (and unique labels with `run check`, `run package`, applicable `run e2e`). It invokes the installed adjacent npm CLI through Node, captures stdout/stderr separately and writes result JSON with the exact exit code. Do not rerun a passing suite only to improve logging. The demonstrated installed runtime executable is sibling `copilot.exe`, not `copilot-runtime.exe`.

Published task 13: **v0.1.25**, `b5c20d2`, full suite 250 tests plus 21 covering tests after reviewed focus fix, final checks/package passed; remote main verified.

## Task 14: Longer dictation with installed components (#21 / selection26)

Read issue-26.md and task-14-design-notes.md, AGENTS.md, docs/voice-integration-research.md, the current actual voice-worker.mjs and final task13 voice lifecycle report. BASE is `b5c20d265d889eb41e83ecaea89c5e094d562c78`; target version **0.1.26**. User constraint: no added model, download or runtime dependency; use only components already supplied/downloaded through Copilot Desktop.

Published task13 seam: web/voice.mjs remains the one browser job owner. Job initiation distinguishes button/shortcut; receive checks original captured value/context, and app callback updates drafts. Record pointerdown captures caret; keyboard uses retained textarea selection. Only answer/voice-root focus transitions are exempt from cancellation; Stop/Cancel focus answer, rerender restores the stable control ID. Rapid retry awaits prior cancel/release, and cancel while waiting invalidates start. Keep these guards while advancing a long job's own accepted partial value/caret.

Carry task13 Minor while touching this lifecycle: a Record pointerdown that never becomes a click can leave pointerSelection for a later keyboard activation. Associate capture only with its matching pointer click or clear aborted capture; test aborted pointer then changed caret then keyboard Record. See task-13-review.md/open-minors.md and report resolution. Task13 Important focus fix is published and independently re-reviewed: lockControls moves focused Record to enabled Cancel during Loading, then Stop during Listening; a disabled Stop moves to Cancel without stealing deliberately outside focus. Preserve this tested phase/redraw behavior.

### Feasibility first

Inspect installed Foundry/PvRecorder declarations and actual selected model capabilities before changing capture/transcription. Current worker records all PCM then stops the mic before one streaming request; the presence of processStreamingRequest/ItemQueue alone does not prove recoverable interim transcript semantics. Report to the controller the available API evidence, smallest safe segmentation approach and proposed exact bounds (total recording duration, audio per segment, queued audio/backlog, transcription timeout and transcript size) before implementing that protocol. Continue unrelated fixture preparation while awaiting the ruling. Do not substitute another SDK/model/download. If safe segmentation is impossible using installed components, document the exact unsupported behavior and request a controller blocker decision rather than claiming long dictation works.

### Contract

- Provide bounded multi-segment capture/transcription beyond the existing short-recording limit, with clear progress and ordered partial results. Avoid hidden gaps between recordings or repeated model reloads; if capture must pause due to resource limits, stop/pause explicitly and tell the user rather than silently dropping audio.
- Give each segment a stable sequence identity; duplicate or out-of-order polling/IPC responses cannot insert text twice or reorder it. Handle speech/silence boundaries using the real installed API. Do not fuzzy-delete repeated words or use another model to rewrite transcripts. Explain any real transcription-boundary limitations honestly.
- Successfully accepted partial transcripts go through the existing local draft path and are recoverable, never auto-saved as final answers or history. Advance the job's own expected draft/value after its inserts, while detecting independent typing/state/context/caret changes. A stale response cannot overwrite a user's subsequent work or another recording.
- Distinguish inserted text from a durably acknowledged local draft. A draft write failure must preserve visible partial text and show the existing save failure/recovery state; do not describe that chunk as saved. Bound any unacknowledged transcript retention and stop further capture explicitly if persistence/backpressure prevents safe progress. Do not bypass the draft store's revision/tombstone protections.
- Keep button/shortcut semantics from task13, visible input feedback, accessibility and reduced-motion behavior. Stop ends capture and lets already captured accepted work finish within bounds. Cancel cancels remaining capture/transcription but retains previously inserted recoverable draft text; communicate that outcome. Preserve original pre-recording text. Release mic/native resources on every completion/error/cancel/navigation/window/lost-heartbeat path.
- Partial failure reports how much was retained and a useful retry path. It cannot erase successful prior chunks or pretend untranscribed audio was saved. Keep the existing 20,000-character answer bound; do not silently truncate a chunk. Audio remains memory-only; do not add audio files, telemetry, providers or user-account access. Existing owned local catalog/log handling remains subject to current cleanup and its documented native telemetry limitations; do not claim the installed Foundry library is network-silent.
- Keep backend ownership/idempotency/cancel-before-start and HTTP protections. Limit buffered data and pending transcript records with backpressure/acknowledgment or a comparably bounded design. A slow local model or disconnected canvas cannot create an unbounded queue. One active microphone job remains the rule.
- Update the voice architecture explanation/diagram and limits after the actual protocol is proven. Keep selected microphone/model choices from installed Desktop components; never modify host shortcut/model downloads.

### Verification and release

- [x] RED/GREEN worker/service/browser tests for segment order/identity/duplicate deliveries, silence/Unicode/boundary behavior, partial failure, cancellation at each phase, stale responses, Stop/Cancel/shortcut interplay, resource/backlog/time limits, draft/state/caret preservation and exact answer limit.
- [x] Prove memory/resource cleanup and recoverable partial drafts using deterministic synthetic PCM/local worker fixtures; no real microphone capture, desktop/browser UI automation, paid provider or existing user session.
- [x] Run npm test, npm run check, npm run package and applicable installed-runtime/voice synthetic smoke if protocol integration changes. Capture native logs through the ignored run-npm.mjs helper; use installed sibling copilot.exe for CLI fixtures.
- [x] Bump confirmed patch and synchronize release metadata/README/release notes; record installed API findings/limitations and protocol. Include controller plan change, self-review/commit; no merge/push/issue closure.
- [x] Write task-14-report.md with feasibility evidence, exact selected limits, APIs, TDD/final command outputs, SHA and remaining native speech-quality limits. No nested agents. Return a precise blocker if unavailable, never add a dependency to get around the owner's constraint.

### Revised protocol ruling after installed-model probe

The installed Nemotron model emitted 45 immutable decoded-token speechSegment items, all kind NONE and all while the input queue was open. It emitted no PARTIAL/FINAL boundaries; upstream Foundry AudioSession MakeNoneSegment/JoinTokens corroborates this. This supersedes the initial native-FINAL-only feasibility proposal.

- Use one loaded model/session/live queue and ordered NONE-token transport chunks. These are transport records, not finalized utterances. Reject mixed or unknown partial semantics. Preserve exact token concatenation, including repeated words, spaces and Unicode; never trim or add spaces per chunk or fuzzy-deduplicate. Verify the final aggregate equals concatenated tokens and never append it twice. A mismatch is a visible error preserving already accepted draft text.
- Flush a transport chunk about every 1000ms or at 512 UTF-16 characters, without splitting a surrogate pair. Bound pending transcript text to 4096 characters and allow one unacknowledged record. Draft acknowledgment deadline is 5000ms. The final complete answer remains bounded at 20000 UTF-16 characters; fail explicitly rather than truncate.
- Recompose only the owned insertion span from captured prefix/suffix and cumulative transcript; apply ordinary outside spacing once. Validate the evolving expected value/context/caret before insertion. Never repeatedly call the old whole-transcript insertion on individual fragments.
- Bounds: 600000ms total recording, 180000ms without decoded-text progress then explicit stop/drain, 100ms/3200-byte PCM items, 50 queued PCM frames, 19200000 lifetime pinned PCM bytes, recorder 50 frames/160KB, loading 60000ms, final drain 45000ms, heartbeat 5000ms. Capture read/delivery gap at least 4000ms stops with a potentially incomplete audio error. PCM bounds are not a total process-memory guarantee; recorder cannot detect every hardware drop.
- Stop ends capture and drains within bounds. Cancel retains previously accepted text. A failed draft acknowledgment must retain visible text and show failure rather than claim it is saved. Audio remains memory-only in production. No new model/runtime/dependency or downloads.
- Prove exact native token-to-aggregate equality with the existing offline speech fixture. Add deterministic chunk splitting, repeated-word, Unicode, aggregate mismatch, persistence failure, timeout/resource/cancellation and stale-context tests. Update README/diagram and API findings to distinguish text transport chunks from speech boundaries.

Ruling rationale: decoded tokens are append-only in the actual installed runtime, enabling recoverable text during recording without fabricated finalization or a second model. If compatibility changes, fail explicitly and preserve accepted drafts rather than guessing about revised hypotheses.

Published task 14: **v0.1.26**, `ab19622`, 272 tests/check/package/installed local SDK fixture and native speech smoke passed; remote main verified. Native smoke has expected host startup diagnostics.

## Task 15: Clean My Answer (#22 / original28)

Read issue-28.md and task-15-design-notes.md, AGENTS.md, docs/copilot-integration.md, docs/research-sdk-tools.md, and the installed SDK declarations. BASE is `ab19622ef60cd14f2a39758f6250dccb78770f2e`; ship version **0.1.27**. Task14 is published and independently approved.

Published task14 integration: attachVoice insert(value,caret) synchronously updates DraftClient and the textarea, returns draftClient.flush(false,selected), and acknowledges the exact voice sequence only after that promise succeeds. Cleanup must observe these programmatic text changes while preserving the returned durability promise and current voice context/caret guards. Starting cleanup is an action outside the answer/voice-control focus boundary; cancel any active voice explicitly. Reopening the same node after polling must preserve pending cleanup/review controls without replacing newer text.

### User behavior

- Add the exact button **Clean My Answer** beside the current answer editor. It operates on the current nonblank unsaved answer text, using an owned isolated SDK helper. It must never enqueue a cleanup request into the attached chat, submit an answer, generate nodes, change answer state, or select a different host model.
- Request conservative punctuation, clarity and repetition cleanup while preserving the user's meaning, uncertainty, names, numbers and voice. No invented facts or new decisions. Model compliance is not guaranteed: present original and proposed text for explicit Apply/Reject, with plain text rendering and a reminder to review meaning where appropriate.
- Until Apply, the original remains the editable, recoverable draft. Apply uses the ordinary draft-edit path, preserves current answerState/stateSelected and caret/focus sensibly, and never saves the answer. Offer an immediate Undo that restores the captured original only while the applied text still matches; later editing or changing journey/node invalidates that undo rather than overwriting newer work. Keep this bounded transient proposal/undo state through same-node polling/rerenders; document that reload/navigation ends proposal review and immediate undo. Do not add a new historical draft store for this issue.
- Bind each operation to its request ID, journey, node and captured draft text/edit generation. Typing, dictation, journey/node change, replacement request or cancellation invalidates an older result. A state-only choice should be preserved, never replaced by the helper. Keep editing usable during the request; a pending cleanup must not become an implicit document commit or attached-chat request.
- Use a text-mutation identity, not the DraftClient generation blindly: selectState() currently calls edit() and increments generations without necessarily changing text. State-only choices remain valid, whereas text A-to-B-to-A, dictation and recovered/programmatically replaced drafts must invalidate an earlier proposal even if the final string matches again. Cover both cases.
- Expose understandable progress, cancellation and retry after errors. A cancelled/failed/malformed/overlong result leaves original/current text untouched. One active cleanup per Explorer instance; cancellation and close release the owned session. Do not silently retry model inference after cleanup/accounting failure.

### SDK and data contract

- The current helper lifecycle is in research.mjs, not a research-sdk.mjs file. Reuse the genuinely common owned-session/account/model/receipt/cleanup foundation through a small shared seam; preserve existing research behavior. Avoid duplicating that full lifecycle and avoid a speculative general agent framework.
- Inspect actual installed declarations and verify the effective helper configuration with the local SDK fixture: an empty availableTools allowlist alone is not sufficient evidence. Initialize/validate and require zero actual tool metadata before sending. Deny tool/permission hooks, disable GitHub MCP/config discovery and all ambient plugins, instructions, skills, memory, project reads and chat inheritance. Keep managed settings/account/model policy checks, empty owned workspace/home, bounded force-stop and safe cleanup/recovery files.
- Only send the captured answer plus fixed cleanup instructions. Question, other answers, history, library metadata, audio, host chat and project files are unnecessary for text cleanup. Treat user text as data, including embedded instructions.
- Keep captured draft text, cleanup proposals and temporary Undo state out of the native canvas snapshot/get_exploration response and main-chat notifications. They are private browser/helper workflow data, like existing drafts; use the protected UI protocol. Review the actual snapshot/UI-snapshot separation before choosing the endpoint shape.
- Existing answer limit is 20,000 JavaScript characters. Validate nonblank input and nonblank output within that limit without truncating user text. Keep exact original Unicode. Use a strict output schema and reject unknown/malformed fields; bound the serialized response as well as decoded text, allowing legitimate JSON escaping expansion. HTTP input limits must support the permitted text after encoding but stay bounded. Do not conflate character and byte limits.
- Keep the shared helper's current 180-second overall lifetime ceiling and existing bounded phase deadlines unless installed API evidence requires a controller ruling. Do not extend research timeouts or network policy as part of cleanup.
- Usage accounting currently labels sessions Explorer Research. Add explicit bounded operation attribution for cleanup while preserving legacy research receipts and journal reconciliation/deduplication. Retained normal receipts must not contain raw answer text, prompts, audio, unrelated context or credentials. Failed/cancelled calls retain usage when the runtime supplies it; missing usage is not fabricated as zero. Existing recovery handling must not delete the only unreconciled journal.

### Verification and release

- [x] RED/GREEN tests for empty/maximum/Unicode answers, strict malformed output, names/numbers/uncertainty prompt contract, cancellation, rapid replacement, delayed response, edits/dictation during the request, node/journey changes, state preservation, proposal review, Apply/Reject/conditional Undo and no automatic save or attached-chat send.
- [x] Verify actual HTTP input/client/identity/Origin guards and safe text rendering with local fixtures. Exercise narrow DOM structure/keyboard focus using jsdom without opening a browser or recording the real microphone.
- [x] Test isolated SDK account/model/workspace/tool-free assertions, cancellation/release, usage attribution/deduplication/recovery and no ambient configuration. Use installed runtime with a disposable Copilot home/local model fixture, never a paid provider or existing user session. If the common research lifecycle changes, run its existing installed local fixture too.
- [x] Run npm test, npm run check, npm run package, applicable installed runtime fixtures. Use run-npm.mjs with unique task-15 labels for clean stdout/stderr/exit evidence; do not repeat passing tests solely for reassurance.
- [x] Bump confirmed patch and synchronize all release metadata/README/release note; include controller plan update, self-review and commit. Controller reviews/publishes; do not push/merge/close the issue and do not spawn nested agents.
- [x] Write task-15-report.md with final helper and UI APIs, context limits, original/Undo lifecycle, TDD/final evidence, SHA and native/live-model quality limitations. Raise concrete integration conflicts while continuing independent work.

Published task 15: **v0.1.27**, `bc50a35`, 281 tests/check/package and installed cleanup/research/canvas fixtures passed; remote main verified.

## Task 16: Explain why a question was suggested (#23 / original31)

Read issue-31.md, task-16-design-notes.md and AGENTS.md. BASE is `bc50a352900516982b3f66386939f21c57b1d2f2`; ship version **0.1.28**. Task15 is published and independently approved. Read the installed canvas SDK declarations before changing callback schemas. This task augments attached-chat question generation; it does not create another model operation.

### Contract

- Add optional nonblank rationale text, at most 1,000 JavaScript characters, to generated question candidates and accepted ordinary question nodes. Preserve absence on older payloads/maps; do not invent legacy explanations. Reject invalid type/empty/overlong fields, and do not attach generated rationale to the idea or user-supplied direction seeds. Retain sparse metadata and the existing total document byte/node bounds.
- Request a concise explanation of the uncertainty being explored and its consequence for the exploration objective/relevant context. Rationale is model reasoning at generation time, distinct from answer certainty and the later Low/Medium/High importance feature. No automatic importance ranking or confidence scores in this issue.
- Carry rationale through callback staging, browser preview, subset acceptance, native import/export, revision history, Markdown and relevant further-generation context. Preserve request/instance/source correlation and existing legacy callback acceptance. Only explicit user acceptance adds the candidate and rationale to the saved map.
- Show an optional **Why this question?** disclosure near the expanded question and an unobtrusive equivalent in candidate review. Keep compact map cards uncluttered. Render rationale as text, with no arbitrary HTML/links. Preserve the active draft, state, caret, IME, reference disclosure and voice controls through ordinary rerenders.
- Rationale is historical: explain that it was generated for the original suggested wording and context. When the user adjusted wording in preview, clearly associate the rationale with generation.originalQuestion rather than asserting it explains the rewritten question. Ancestor-review indicators remain visible where applicable. Objective/answer changes must not silently regenerate or relabel historical rationale as current advice.
- Use that explicit historical contract instead of a whole-context hash that becomes stale immediately when its own batch is accepted. No automatic inference on polls, legacy selection or objective edits. A freshly accepted unchanged question must not appear stale merely because acceptance added siblings.
- For later generation context, label any included rationale as historical model explanation, not a user fact/decision; keep the normal context bounds. Never add unavailable rationale text to legacy maps just to satisfy a prompt.
- Fix the carried task11 Minor in root skills/explore/SKILL.md:10 while updating this same skill: "starts an exploration, saves an answer and asks for follow-ups, or explicitly adds a missing direction." Record the Minor resolution in the report/open-minors ledger through the controller.

### Verification and release

- [ ] RED/GREEN model/controller tests for optional legacy values, validation bounds/types, direction/root exclusion, batch staging with no commit, edited/subset acceptance, source-change rejection, export/import/history preservation and document-size failure without mutation.
- [ ] UI tests for missing rationale, expanded and preview disclosure, changed wording attribution, ancestor/goal changes retaining historical meaning, plain-text malicious content, draft/state/caret/voice safety, and no inference caused by reading explanations.
- [ ] Update skill/callback contracts and the installed local canvas fixture to prove rationale reaches preview then accepted native data. Run npm test, npm run check, npm run package and applicable installed fixture through run-npm.mjs with unique task-16 labels. No paid provider, existing session or browser/desktop automation.
- [ ] Synchronize confirmed patch metadata/README/release notes, include controller plan update, self-review and commit. No nested agents, push, merge or issue closure.
- [ ] Write task-16-report.md with schema/context/UI decisions, tests, SHA, Minor resolution and remaining native/live-generation quality checks.

Published task15 integration: DraftClient.textGeneration identifies actual text mutations separately from state-only edits. CleanupClient owns transient proposal/Undo state across same-node rerenders. Preserve that controller and its focus/scroll state when adding rationale disclosures; do not trigger text edits or cleanup requests merely by reading rationale. Retain the established voice blur/cancellation boundary when focus leaves the answer/voice controls; do not create a new microphone focus exemption. The shared SDK lifecycle is now owned-helper.mjs; this issue should not need to change it.

Canvas/model preflight: canvas.mjs object() currently makes all properties required; make rationale explicitly optional without weakening required question/category or additionalProperties restrictions. acceptQuestions() reconstructs editable question plus original category; copy rationale only from the validated staged batch. Do not accept a browser-supplied replacement rationale or weaken the selected-object extra-key rejection.

## Issue index

Dispatch order (dependencies first). Each row retains the original recommendation identifier.

| Order | Selection | Issue |
|---|---|---|
| 1 | 51 | [#39: Enforce release version consistency across metadata and documentation](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/39) |
| 2 | 1 | [#1: Exploration library with recent, pinned, and archived journeys](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/1) |
| 3 | 2 | [#2: Recover unfinished answer drafts automatically](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/2) |
| 4 | 4 | [#3: Optional exploration objective and success criteria](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/3) |
| 5 | 5 | [#4: Distinguish decisions, assumptions, tentative answers, and deferred questions](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/4) |
| 6 | 6 | [#5: Collapse and expand entire branches](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/5) |
| 7 | 10 | [#9: Undo, revision history, and named checkpoints](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/9) |
| 8 | 14 | [#13: Focus one branch while retaining its context](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/13) |
| 9 | 18 | [#16: Map navigation preferences](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/16) |
| 10 | 19 | [#17: Preview generated questions before adding them to the map](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/17) |
| 11 | 11 | [#10: Suggest a missing direction for AI-generated questions](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/10) |
| 12 | 22 | [#19: Pin reference decisions beside the active question](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/19) |
| 13 | 23 | [#20: Visible Record, Stop, and Cancel controls for dictation](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/20) |
| 14 | 26 | [#21: Recoverable long-form dictation using installed Copilot components only](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/21) |
| 15 | 28 | [#22: Clean My Answer with an isolated SDK helper](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/22) |
| 16 | 31 | [#23: Explain why a question matters](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/23) |
| 17 | 32 | [#24: Question help: simpler wording, examples, and term explanations](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/24) |
| 18 | 33 | [#25: Exploration modes for understanding, deciding, designing, diagnosing, and challenging](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/25) |
| 19 | 39 | [#30: Allow independent edits while another branch researches](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/30) |
| 20 | 42 | [#32: Pinned constraints and a visible AI context budget](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/32) |
| 21 | 7 | [#6: Generate a reviewed decision brief alongside the full exploration export](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/6) |
| 22 | 8 | [#7: Check cross-branch contradictions and assumptions](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/7) |
| 23 | 46 | [#36: Repeatable performance benchmarks for real exploration maps](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/36) |
| 24 | 43 | [#33: Targeted DOM updates that preserve editing state](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/33) |
| 25 | 44 | [#34: Render large maps efficiently with visibility and layout caching](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/34) |
| 26 | 45 | [#35: Revision-aware state polling and reconnect handling](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/35) |
| 27 | 47 | [#37: Recover cleanly from interrupted operations and damaged saves](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/37) |
| 28 | 48 | [#38: Compatibility status and redacted diagnostics](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/38) |
| 29 | 52 | [#40: Preview and control the context sent to AI research](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/40) |
| 30 | 34 | [#26: Research depth and source-focus controls](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/26) |
| 31 | 37 | [#29: Link research claims to supporting evidence](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/29) |
| 32 | 35 | [#27: Follow-up questions within node research](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/27) |
| 33 | 36 | [#28: Compare research options against user criteria](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/28) |
| 34 | 40 | [#31: Optional bounded challenge review](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/31) |
| 35 | 56 | [#42: Verify and harden redirect and DNS boundaries for research fetching](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/42) |
| 36 | 54 | [#41: Protect sensitive details in external research search queries](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/41) |
| 37 | 58 | [#43: Storage and retention management for local Explorer data](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/43) |
| 38 | 63 | [#45: Explicitly selected project and document context](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/45) |
| 39 | 64 | [#46: Reviewed handoff from exploration to implementation](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/46) |
| 40 | 65 | [#47: Additional portable exports: Mermaid, SVG/PDF, and JSON Canvas](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/47) |
| 41 | 67 | [#48: Export a standalone read-only exploration viewer](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/48) |
| 42 | 70 | [#50: Review dates and revisit conditions for decisions](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/50) |
| 43 | importance | [#51: Rank question importance as low, medium, or high](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/51) |
| 44 | 9 | [#8: Suggest the most useful next question](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/8) |
| 45 | 12 | [#11: Semantic zoom for map readability](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/11) |
| 46 | 13 | [#12: Optional minimap for large explorations](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/12) |
| 47 | 16 | [#14: Search and filter journeys and questions by useful states](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/14) |
| 48 | 17 | [#15: Keyboard command palette for Explorer actions and navigation](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/15) |
| 49 | 20 | [#18: Complete outline alternative to the visual map](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/18) |
| 50 | dashboard | [#52: Usage dashboard with graphical insights across exploration sessions](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/52) |

Deferred, do not implement:

- Selection 61: [#44: Deferred: scenario forks and comparison of alternative paths](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/44)
- Selection 68: [#49: Deferred: asynchronous human review and comments](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/49)
