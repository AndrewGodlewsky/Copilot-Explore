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

- [x] RED/GREEN model/controller tests for optional legacy values, validation bounds/types, direction/root exclusion, batch staging with no commit, edited/subset acceptance, source-change rejection, export/import/history preservation and document-size failure without mutation.
- [x] UI tests for missing rationale, expanded and preview disclosure, changed wording attribution, ancestor/goal changes retaining historical meaning, plain-text malicious content, draft/state/caret/voice safety, and no inference caused by reading explanations.
- [x] Update skill/callback contracts and the installed local canvas fixture to prove rationale reaches preview then accepted native data. Run npm test, npm run check, npm run package and applicable installed fixture through run-npm.mjs with unique task-16 labels. No paid provider, existing session or browser/desktop automation.
- [x] Synchronize confirmed patch metadata/README/release notes, include controller plan update, self-review and commit. No nested agents, push, merge or issue closure.
- [x] Write task-16-report.md with schema/context/UI decisions, tests, SHA, Minor resolution and remaining native/live-generation quality checks.

Published task15 integration: DraftClient.textGeneration identifies actual text mutations separately from state-only edits. CleanupClient owns transient proposal/Undo state across same-node rerenders. Preserve that controller and its focus/scroll state when adding rationale disclosures; do not trigger text edits or cleanup requests merely by reading rationale. Retain the established voice blur/cancellation boundary when focus leaves the answer/voice controls; do not create a new microphone focus exemption. The shared SDK lifecycle is now owned-helper.mjs; this issue should not need to change it.

Canvas/model preflight: canvas.mjs object() currently makes all properties required; make rationale explicitly optional without weakening required question/category or additionalProperties restrictions. acceptQuestions() reconstructs editable question plus original category; copy rationale only from the validated staged batch. Do not accept a browser-supplied replacement rationale or weaken the selected-object extra-key rejection.

Published task 16: **v0.1.28**, `97f874f`, required checks and installed canvas fixture passed; independent review approved and remote main verified.

## Task 17: Help with an unfamiliar question (#24 / original32)

Read issue-32.md, task-17-design-notes.md and AGENTS.md. BASE is `97f874fd4dba802557fbccc73fc7d2adae64d3a7`; ship version **0.1.29**. Read task-15-report.md and task-16-report.md for the published helper and rationale contracts. Reuse those foundations, not another SDK session implementation.

### Contract

- Provide three explicit actions beside the selected ordinary question: **Rephrase**, **Give an example**, **Explain terms**. Keep the original question visible and unchanged. Rephrasing is an alternate explanation, not a node edit. Examples are clearly illustrative, never the user's answer. No insertion into drafts, answer saves, answer-state changes or generated nodes.
- Use the owned, validated, tool-free SDK helper from task15 with cancellation, bounded lifetime, safe cleanup and operation-attributed retained usage. No main-chat enqueue, ambient tools/files/skills/history, library context or downloaded models. Explain that this is model help, with the existing research action available when sourced/current information is needed; do not fabricate consulted sources.
- Build one explicit bounded context from the saved selected question, exploration topic/guidance and nearest relevant saved ancestors. Exclude other branches and the user's unsaved answer draft. Cap serialized context at 16,000 JavaScript characters, include the selected question, and report omissions honestly in the request metadata. Keep original user text intact in included records; omit records that do not fit rather than silently rewriting their meaning. This later joins the shared context-budget feature; avoid a second generic context framework here.
- Keep selected input minimal: question/category, topic/objective/success criteria, and included ancestor question/answer/state records with real IDs/parent IDs. Do not include the selected answer, historical AI rationale, research, generated previews or prior help results. Include complete nearest ancestor records only when they fit; do not imply omitted ancestors were adjacent. Mandatory framing plus selected question/guidance must fit or fail explicitly. Context dependencies are the exact included records and guidance, not every node that a later recomputation might select.
- Strictly validate the three operation enums and a nonblank text result of at most 4,000 JavaScript characters. Bound serialized response and transport bytes while accommodating legal escaping/Unicode. Render all output as literal text. Output cannot define actions, URLs to auto-open, context permissions or instructions for the host.
- Bind result to request/operation/journey/node and the exact saved context sent. Cancellation, source change, replacement or navigation invalidates late results. Draft typing/state choice alone must remain safe and usable; they are not helper input and cannot be overwritten. Keep existing attached generation/research coordination intact.
- Build saved input on the server; do not accept browser-supplied replacement context. Check actual committed source freshness at start and before displaying a result, including another canvas's disk changes, without holding the writer lock during inference. Keep transient help requests/results out of native canvas/get_exploration and chat notifications. Use the protected private HTTP workflow with the existing token/Host/Origin/client checks, strict bounded schemas and allowlisted assets.
- Show concise progress/error/cancel and at most the three latest operation results for the active node, transiently. Preserve them through same-node polling, but clear on journey/node change or reload; disclose this lifetime in documentation. No persistent second chat and no automatic retry. Reuse the tool-free operation concurrency bound established by task15; make any mutual exclusion clear in UI.
- Allow at most one running cleanup-or-question-help operation per instance. Cross-feature contention may require explicit Cancel before starting the other action, with a clear UI explanation and matching server enforcement; do not silently spawn a second tool-free session. Completed review/help output is not an active inference. Preserve existing same-kind cancellation/replacement guards and unrelated attached-chat/research coordination. Choose the smallest shared ownership seam and document it, rather than a generic agent scheduler.
- Keep help in a compact optional disclosure in the expanding node. Preserve rationale/reference/voice disclosures and active draft, caret, IME and keyboard focus. Buttons and outputs remain usable in a narrow pane, and selecting help must not leave an unintended microphone capture running.

### Verification and release

- [x] RED/GREEN tests for each operation, empty/technical/Unicode and maximum context, deterministic omissions, malformed/overlong result, text-safe output, no question/draft/state mutation, cancellation/replacement/stale context and node/journey changes.
- [x] Verify no attached-chat sends, no effective helper tools/ambient context, correct operation receipts, bounded transient output and resource release using local fixtures. Extend the installed local helper fixture for all three operations; no paid provider or existing user session.
- [x] Real HTTP/jsdom coverage for controls, keyboard/focus, narrow structure, progress/error/retry and coexistence with ongoing draft edits and the published voice controls. No browser/desktop automation or live microphone capture.
- [x] Carry task16 review Minor while touching adjacent help/disclosure UI: add a focused synthetic-recording DOM test that moves focus from the answer/voice controls to the rationale summary and verifies the established cancellation boundary, retained draft text and no late insertion. The prior test only checked voice-control presence after rerender. See task-16-review.md and report the resolution; do not create a new voice focus exemption.
- [x] Run npm test, npm run check, npm run package and applicable installed SDK fixtures using run-npm.mjs with task-17 labels. Synchronize confirmed patch version/README/release note, include controller plan update, self-review and commit. No nested agents or publishing.
- [x] Write task-17-report.md with helper APIs, context/dependency/omission contract, output lifecycle, tests, SHA and manual quality/visual limitations.

Published helper seam: owned-helper.mjs exports createOwnedHelper(parent, operation, prepare, options) for account/model/workspace checks, deadlines, retained usage and release/recovery. cleanup.mjs defines zero-tool config and validates actual initialized metadata; deliberately extend the bounded operation labels/receipt attribution for question help. Preserve cleanup textGeneration, Apply/Reject/conditional Undo and voice insertion returning its durable draft-flush promise. Extract only genuinely shared policy/ownership if needed; do not duplicate the full lifecycle or invent a scheduler.

Published task 17: **v0.1.29**, `38db1e2`, required checks and applicable installed fixtures passed; independent review approved and remote main verified.

## Task 18: Exploration modes (#25 / original33)

Read issue-33.md, task-18-design-notes.md and AGENTS.md. BASE is `38db1e2a3d3cb77931d427957e46def142772f6b`; ship version **0.1.30**. Read task-17-report.md for the published help/source-freshness APIs and task-16-report.md for historical rationale. Extend existing guidance and request policies; no new model operation or setup wizard.

### Contract

- Offer **Understand**, **Decide**, **Design**, **Diagnose**, **Challenge**, each with a concise description. Persist a sparse optional document mode enum using lowercase values; missing legacy mode means understand. Reject unknown/null/wrong-type imported values rather than guessing. Leave absent default values absent when loading legacy files near the byte cap.
- Understand maps concepts, stakeholders and unknowns. Decide surfaces choices, criteria and tradeoffs. Design explores intended outcomes, constraints, interfaces and feasibility. Diagnose asks for symptoms, reproduction, evidence and alternative causes. Challenge tests assumptions, counterexamples and possible failure conditions. These are bounded thinking policies, not permission to modify files, select the host model or make the user's decision.
- Place the optional selector in existing new-journey guidance and Edit guidance, with the effective mode visible compactly in the active journey. Keep objective and success criteria distinct. Changing mode never deletes or rewrites answers, research, accepted questions or historical rationale/provenance; it applies to future requests.
- A meaningful mode change is an ordinary revision-checked, atomic, undoable guidance edit and clears finished state consistently with other guidance. An unchanged effective mode is a no-op, still checking disk freshness; selecting default on a legacy map must not create a meaningless history entry solely to materialize the default field. Preserve Unicode in other guidance fields.
- A legacy guidance request omitting mode preserves the journey's current stored/effective mode. Explicit mode `understand` resets a different mode through an ordinary meaningful edit; a new journey with absent mode still defaults to Understand.
- Include the effective mode and its fixed strategy in attached question-generation and isolated research requests through the existing data/instructions boundary. Include effective mode in bounded question-help input as described below. No user-defined prompt injection field. Keep existing prompt/context limits and account/model isolation; Clean My Answer remains answer-only.
- Preserve pending/staged source safety. Keep the current global pending guard for generation/research; mode editing must wait or use the existing explicit cancellation. A staged batch created under an old mode cannot silently be accepted as current after a mode change. Keep old rationale visibly historical; do not auto-generate replacement questions or explanations.
- Use task17's successful-source-edit behavior for question help: a successful relevant mode change invalidates pending and completed help, with understandable status. A no-op or failed save must not cancel still-valid work. Do not introduce a special mode-only block when existing guidance edits already cancel stale help after committing. Cleanup receives only answer text, so a mode-only change is not itself a cleanup dependency; do not invalidate a still-matching cleanup proposal or alter its answer state.
- Published task17 seam: web/question-help-context.mjs exports helpContext(doc,nodeId) and sameHelpContext(input,doc), re-exported by question-help.mjs. Both server and browser use this pure saved-source comparison; the private response retains the exact captured context for completed results. Include effective mode in both the transmitted help context and that comparator so already-displayed help is invalidated after a relevant mode change, not only pending help. Preserve each result's original dependency set; unrelated commits and unsaved draft/state choices should not erase valid help. Keep the 16,000-character serialized help-context limit and 96-KiB response cap, including the new field.
- Task17 review fixes add read-only check/forget actions with at most three server-retained result contexts and ordinary browser polling. Exercise external mode edits against that completed-result check too; do not weaken it to comparing only the in-memory document. Keep the shared cleanup/help unresolved-release blocker and explicit retry behavior unchanged.
- Round-trip mode through native documents, history/restore, Markdown and relevant context. Preserve truthful defaults in exports; do not infer a past mode for historical snapshots that lacked it. Keep private references/navigation/drafts outside document mode metadata.

### Verification and release

- [x] RED/GREEN validation and round-trip tests for all modes, legacy missing/default, null/unknown values, sparse near-cap maps, guidance changes/no-op and stale writers, finish/history/restore and preserved old answer/research/provenance.
- [x] Assert each fixed strategy reaches its applicable request payload with current source identity; pending helper/generation and stale-preview behavior, no main-session model change and no automatic inference on selector render/poll.
- [x] Real HTTP/jsdom tests for creation/edit controls, explanatory text, narrow/keyboard structure, preserved drafts/state/voice/reference/rationale/help UI, conflicts and retry. No browser/desktop automation, live microphone, paid provider or existing session.
- [x] Inspect installed SDK declarations if changing callback contracts; run npm test, npm run check, npm run package and applicable local canvas/research/help fixtures with run-npm.mjs task-18 labels.
- [x] Synchronize confirmed patch metadata/README/release note, include controller plan update, self-review and commit. No nested agents/publishing. Write task-18-report.md with final enum/prompt/history/conflict contracts, tests, SHA and manual quality/appearance limits.

Published task 18: **v0.1.30**, `5723b14`, required checks and applicable installed fixtures passed; independent review approved and remote main verified.

## Task 19: Save independent work while research runs (#30 / original39)

Read issue-39.md, task-19-design-notes.md, AGENTS.md and the final helper/mode reports. BASE is `5723b14a199e2533790bb8b5d54c3f8cf91c9c64`; ship version **0.1.31**. Read task-18-report.md for the published mode schema/policies and task-17-report.md for exact help freshness and actual-release ownership. This is one concurrency issue, not a new background agent pool.

### Immutable input and ownership

- Keep one active research request per instance, with existing request/session/instance identity, bounded cancellation, progress and retained usage. Never hold the document writer lock while waiting for inference, and do not expand network permissions or helper lifetime.
- Cancellation invalidates a result before resource release finishes. Serialize replacement research behind actual owned-run release, not just pending=null. Reuse the published owned-helper releaseConfirmed failure signal: unresolved/failed shutdown blocks queued and new research until confirmed release, with bounded status/error delivery and explicit retry only. Keep cleanup/help's separate published resource slot unchanged; no generic agent scheduler.
- Introduce one small pure research-preparation seam returning the exact bounded transmitted context plus its source dependencies. The helper must send that prepared context without clipping it again differently. Capture actual included node IDs and their sent fields, guidance/mode, target/journey identity and the destination research value. Do not identify sources by question/answer text, which can be duplicated.
- Preserve the legacy research-context ceiling of 75,000 JavaScript UTF-16 code units in the final serialized context, including added identity and omission metadata. Fixed prompt/system instructions remain outside this legacy context cap; task20 introduces the complete byte-budget contract. Report omissions, retain complete included user records, and fail explicitly if mandatory target/guidance cannot fit. Do not implement pinned constraints or the full context inspector in this task.
- Freshness compares the captured inputs and ownership, not document revision alone or a freshly selected whole-map context. An unrelated new answer that would now be selected is not retroactively part of the original request. Included-source changes, changed parent relationships, changed guidance/mode, target removal or journey replacement invalidate the result.
- Published task18 uses web/modes.mjs effectiveMode/validMode/modePolicy and contextFor().mode. Compare effective mode as the source dependency, so missing legacy Understand and explicitly stored Understand are not falsely different policies. Preserve its fixed strategy in the exact outgoing prompt. Capture stable logical document identity (including its root/creation identity) as well as the owned file/library key; a replacement document must not be accepted just because it has a larger revision number.

### Edits and completion

- Allow ordinary Save answer on other branches while research is pending. Preserve ordinary draft/state validation, expected revisions, history and atomic writes. Saving the researched node or an included dependency also preserves the user's newer answer; a successful source edit cancels/discards stale research with a clear explanation. A failed write must not cancel still-valid work merely because an edit was attempted.
- Save & explore deeper and other actions starting an attached question request may still require waiting or cancelling. Keep that distinction clear in UI. History restore, import/journey switch and generation previews retain their own guards. Do not remove all pending checks indiscriminately; do not loosen cleanup/help or staged-question freshness.
- On research completion, enter the controller transaction and document writer lock, read/validate the latest committed document, match journey/file identity and captured input dependencies, then merge only the validated research result into that latest document. Preserve unrelated committed changes from this or another canvas. Use the existing history protocol with the actual current preimage and a monotonic revision.
- Current saveLocked calls fresh() against this.doc and derives revision/time from it. Add a small explicit-current-base persistence seam if needed for the under-lock latest-document merge; do not temporarily replace this.doc merely to bypass stale checks. Failed precommit writes must preserve a coherent active snapshot and recovery history; the actual atomic commit remains the state-change boundary.
- A different completed research value already on the destination is a write/write conflict, even if source answers match; do not overwrite it silently. Show a stale/conflict result and preserve the newer saved value. Missing/invalid/replaced documents and disk failures leave the last recoverable document intact.
- Check active request/abort identity immediately before accepting work. Duplicate completion, late callback, cancellation and old error handlers cannot revive or clear a replacement request. Close and rapid retry retain bounded helper release/accounting behavior.

### Verification and release

- RED/GREEN tests for unrelated answer saves, a new unrelated answer, actually included versus omitted external decisions, duplicate question text with distinct IDs, ancestor/target/state/guidance/mode changes, source-save failure and both serial orders of save versus completion.
- Cover two canvases with a shared file: unrelated latest revisions survive, destination research conflict is rejected, identity replacement/corrupt reads and before/after atomic failure preserve recovery/history. Exercise cancel/replacement/duplicate completion, journey switch/restart, pending generation/preview guards and retained failed/cancelled usage.
- Real HTTP/jsdom tests must show Save answer remains usable on an unrelated branch while Save & explore deeper explains its contention, with drafts, caret/state, focus, reference/rationale/help and voice controls preserved. No browser/desktop automation, real mic, paid inference or existing user session.
- Run npm test/check/package and applicable installed research/canvas/helper fixtures using run-npm.mjs with task-19 labels. Bump confirmed patch metadata/README/release note, include controller plan update, self-review and commit. No nested agents/publishing. Write task-19-report.md with exact preparation/dependency API, locking/conflict behavior, tests, SHA and native/live-model limitations.

Published task 19: **v0.1.31**, `9259fe9`, required checks and applicable installed fixtures passed; independent review approved and remote main verified.

## Task 20: Pinned constraints and explicit context budgets (#32 / original42)

Read issue-42.md, task-20-design-notes.md, AGENTS.md and task-19-report.md. BASE is `9259fe9c8ebe5cea077b0f188c0d2d00f5946128`; ship version **0.1.32**. Reuse task19's `research-context.mjs` preparation/dependency seam rather than creating an alternate prompt selector: `prepareResearch(doc,nodeId)` returns `{context,dependencies}`; `sameResearchSources` compares actual transmitted records and framing, and `sameResearchDestination` protects the research write target. Reconcile the final published code before changing those contracts.

### Journey data and controls

- Add an optional sparse list of user-supplied facts/constraints with stable validated opaque IDs, at most 10 entries and at most 1,000 JavaScript characters of nonblank text per entry. Preserve exact Unicode/text, reject duplicates/unknown fields/types, and keep the existing document byte cap. Legacy absence remains absence; an effective no-op must not materialize metadata or create history merely to fill defaults.
- Keep lightweight add/edit/remove controls near journey guidance. Explicitly distinguish these user statements from answered questions, AI explanations and private visual reference pins. No automatic extraction or claim that the facts are verified. Changes use ordinary expected revisions, locking, history and meaningful-change finish behavior.
- Preserve pins in native files, history/restore and complete Markdown with truthful user provenance. Stale in-flight generation/research/help must follow the captured source contract when relevant pin values change; a failed write must not cancel valid work.
- Retain the existing guidance-edit guard during active generation/research; the user cancels that work before changing pins. Pin edits share guidance's atomic revision/history action. Other-canvas edits, staged previews and pending/completed help still require exact captured-source freshness. This task does not relax the existing operation guard.

### Exact context selection

- Use a ceiling of **128 KiB (131,072 bytes)** of UTF-8 Explorer-authored request text, including serialized data and actual fixed prompt framing/instructions for the operation. This supersedes task19's 75,000-character research-context-only ceiling. This controls Explorer's payload, not provider token count or the attached chat's preexisting context. No tokenizer/model dependency.
- Measure the actual instruction and prompt string bytes supplied to the SDK (including JSON serialized inside those strings), not their character count or a second JSON-RPC transport encoding. Runtime/provider-added framing and existing main-chat content are outside Explorer's measurable budget; document that boundary rather than claiming a total provider context size.
- Mandatory content is current topic/objective/success criteria/mode, all pins and the active node's relevant question/answer/state/direction identity. Include complete mandatory values or fail explicitly with a useful scope/size explanation; never silently truncate an answer or pin. Legal escaping and multibyte Unicode count in the final serialized bytes.
- Add nearest ancestor records first, then optional other committed stateful questions by deterministic tree distance and stable ID tie-break. Keep real IDs/parent IDs and provenance. Do not use nonexistent per-answer timestamps or invent recency. Keep historical AI rationale labeled separately if transmitted; never treat it as the user's explanation or answer. Skip whole optional records that do not fit, with explicit omitted counts and reasons.
- Preserve published generation context capabilities: previously asked direct questions, user direction seeds, and historical rationale must remain eligible bounded context with actual source IDs and honest provenance. Do not silently drop those features merely because research previously sent fewer fields. They may be omitted whole for an explicit scope/budget reason; show that coverage and track only actually sent dependencies. Retain a regression proving later generation receives a historical rationale when it fits.
- Offer a clear per-request scope choice between ancestor path only and including additional decisions. Pins/guidance/active node remain mandatory. This is a small scope control and coverage summary, not task29's full per-source context inspector. Preserve the user's current action and do not start inference simply by viewing/changing scope.
- The same pure preparation produces actual transmitted data, exact serialized size/limit, coverage and immutable source dependencies. The helper and attached generation send that prepared representation without a second divergent clipping pass. Task19 compares only actual captured source values. Use bounded iterative traversal and avoid repeated whole-document serialization in selection loops.
- Extend captured-source freshness to staged question batches: accept only if the actual included values, journey and target still match. An unrelated edit to an omitted record does not retroactively add it as a dependency or invalidate the batch. Keep existing callback request/instance/session correlation and one-batch acceptance protections. No-op effective defaults remain equivalent.
- Supply the actual fixed instruction/framing strings to that pure preparation; load packaged skill text outside it if necessary. The owned helper must send those captured strings, rather than rereading or rebuilding a different instruction payload after the size calculation or later reviewed snapshot.
- This ceiling applies to question generation and research, not an automatic expansion of every helper's context. Reconcile question help separately: keep its published minimal context and smaller response/input bounds, include pinned guidance only through an explicit bounded field with matching captured dependencies, and fail clearly if mandatory help guidance cannot fit. Clean My Answer remains answer-only. Do not silently widen either helper into whole-map access.
- Exclude drafts, private references, library metadata, history snapshots and audio. Native get_exploration still exposes the full current committed map to the attached chat; label this boundary honestly. Do not silently change that established native API or promise that payload exclusions erase context already in chat.

### Verification and release

- RED/GREEN validation, sparse legacy/near-cap maps, duplicate IDs, exact text preservation, meaningful/no-op revision freshness, import/history/export and failed-save recovery.
- Test actual serialized UTF-8 boundaries at limit and +/-1, emoji/control-character escaping, mandatory overflow, many/large pins, long deep/wide paths, deterministic whole-record omission and both scope choices. Inspect actual final send strings and helper payload, not only a size helper's return value.
- Verify included/omitted dependency behavior with task19 races, staged-question invalidation, unchanged legacy callbacks, and no attached-chat privacy overclaim. UI/HTTP tests cover scope/coverage controls with active drafts, helper results, focus and voice cancellation boundaries.
- Run npm test/check/package and applicable installed generation/research/help fixtures with task-20 evidence labels. No paid provider, existing user session, browser/desktop automation, real microphone or new runtime dependency. Synchronize confirmed version/README/release note, include controller plan change, self-review and commit; no nested agents/publishing.
- Write task-20-report.md with final schema and actual-byte contract, preparation API/dependencies/coverage, scope UI, evidence/SHA and native/live-quality limitations.

Published task 20: **v0.1.32**, `778deda`, required checks and applicable installed fixtures passed; independent review approved and remote main verified.

## Task 21: Reviewed decision brief (#6 / original7)

Read issue-7.md, task-21-design-notes.md, AGENTS.md and the final reports for the shared helper/context tasks. BASE is `778dedac878e5198048a433a399e1e300248cdaa`; ship version **0.1.33**. Read task-20-report.md for the published exact-byte preparation/dependency APIs and task-17-report.md for actual-release tool-free ownership.

### Behavior and provenance

- Add an explicit Generate decision brief action. Use the owned isolated tool-free SDK helper and task20 bounded committed-map context. Do not use the attached chat or silently start synthesis on Finish. Empty or partially answered maps are valid: describe what is unknown, not invented commitments.
- Reuse the instance's actual-release tool-free ownership slot shared with cleanup/question help. A completed proposal is not an active inference. Give an explicit contention/cancel path, keep unknown shutdown blocked until confirmed release, and do not add a new parallel helper pool.
- Produce a concise structured proposal covering goal, decisions and rationale, constraints, assumptions, unresolved questions and next steps. Distinguish user decisions from tentative answers, untested assumptions and AI suggestions. Keep already-generated question rationale separate from a user's actual reason for choosing an answer.
- Use an honestly labeled journey-summary scope. Reconcile task20's selector carefully: a research selector containing only stateful answers cannot expose every unanswered question needed for the unresolved section. Reuse its packing/byte/dependency seam, with an explicit deterministic synthesis candidate policy that admits saved open questions/direction seeds as optional whole records after required guidance and relevant decisions. Show omissions; never claim all unresolved questions were examined if some were excluded. Do not read drafts, private references, history or prior brief artifacts to fill gaps.
- The default is a bounded journey summary anchored at the root, not the previously selected node's path-only research setting. Prefer committed stateful questions, then open questions and direction seeds deterministically by tree distance and stable ID. Reuse `prepareContext`/the task20 captured-input projection seam; do not make a competing byte-packer. Saved research and historical AI rationale are not required brief inputs: user reasons must come from their own supplied text, and missing reasons remain unknown.
- Link statements to validated source node IDs present in the transmitted context. The UI can reveal each source through existing fold/focus navigation without losing drafts. Global goal/constraint references need an explicit truthful representation rather than fabricated node IDs. Do not invent external citations or research sources.
- Retain source answer states/review flags in trusted provenance. Reject or conservatively label a claimed settled decision that is supported only by tentative/assumption/unanswered/needs-review sources; do not rely solely on the model's chosen certainty label. User constraints remain user statements, not verified facts, and model-proposed next steps remain suggestions. Tests must exercise these structural certainty boundaries without claiming to prove live semantic accuracy.
- Keep the proposed brief transient until the user reviews it. Allow bounded plain-text editing of proposed statements, with explicit Accept and Discard. User-edited statements retain their source links and are visibly distinguished from unchanged AI synthesis. Accept commits only the brief artifact, never answers or answer states. Use ordinary document locking/revision/history; undo/checkpoints can recover a previous accepted brief.
- Store one bounded accepted brief with source provenance and schema validation in the native file. Do not create an unlimited document editor or duplicate all source answers into the artifact. The next synthesis context must exclude the prior brief to prevent recursive summaries. The full Markdown/native exploration remains complete.
- Persist bounded source fingerprints/IDs and a versioned projection contract for freshness rather than embedding a second full copy of every source answer. Compare the whole captured input set, not merely the IDs cited in output: uncited inputs may still have influenced the synthesis. If a future projection cannot be interpreted, label freshness unknown/historical instead of silently current. Final schema and size limits are reconciled against task20's published preparation API.
- Capture the exact transmitted dependency set and guidance when generation starts. Reject a late result or acceptance after relevant source changes, and show a regenerate/review path while preserving an older accepted brief. An accepted brief whose source data later changes must be labeled historical/stale rather than silently treated as current. Source freshness must be content-based where unrelated document edits do not change what was actually synthesized.
- A previously accepted artifact may outlive a source node after later history changes. Preserve that historical artifact with an unavailable-source label; do not silently discard it or pretend a broken source link still resolves. New proposal/acceptance references must be validated against the captured actual input, while imported historical provenance is schema-checked and assessed honestly against the current document.
- Surface context coverage and omissions before/with the proposal. A concise brief based on selected context must not claim to represent omitted branches. Keep bounded operation cancellation/progress, owned-session cleanup and usage receipts. Render model/user text as text and use safe Markdown escaping for exports.

### Export and verification

- Bound the proposal to the six named sections, at most 5 statements per section, at most 1,000 UTF-16 code units of nonblank exact text per statement, and at most 8 validated source references per statement. Reject unknown fields/IDs and duplicate statement IDs. Bound the raw structured helper output to 256 KiB UTF-8 and the accepted native brief artifact (including provenance/freshness metadata) to 512 KiB of its serialized saved representation, still subject to the document's existing 9 MiB ceiling. Do not silently truncate generated or edited text.
- The server retains the trusted proposal/source references. The acceptance payload may supply bounded text edits to known statement IDs; it cannot substitute source IDs, source fingerprints or certainty/provenance labels. Mark changed statements as user edited and explain that their original source links were not automatically reverified against the edited wording. Reject stale acceptance before any artifact mutation.
- Export a separate reviewed brief Markdown file while retaining existing complete Markdown/native exports. Include certainty labels, AI/user authorship where relevant, source IDs/usable links and coverage/staleness metadata. Do not replace the existing full record with the summary.
- Exported source links must actually resolve in the artifact or accompanying full record. Prefer a bounded source-reference appendix with stable node IDs and useful question labels over guessed heading anchors or a hard-coded local filename that the user may rename. Do not expose local filesystem paths or turn user text into raw HTML.
- Test truthful missing data, contradictory/tentative inputs, unknown/duplicate source IDs, malformed and overlong output, proposal edit/accept/discard, relevant and unrelated source changes, cancellation, hostile text, import/history/export round trips and near9MiB atomic-save rejection preserving the previous document.
- Verify the actual isolated SDK payload/tools/usage with local fixtures and real app HTTP/jsdom flows. No paid provider, existing user session, desktop/browser automation or real microphone. Run required npm test/check/package and applicable installed runtime fixtures.
- Synchronize the confirmed patch/release metadata/README and include controller plan changes. Self-review and commit; controller independently reviews/publishes. No nested agents, merge/push or issue closure. Write task-21-report.md with final schema/limits, source/dependency freshness contracts, user edit lifecycle, evidence, commit and manual/model-quality limitations.

Published task 21: **v0.1.33**, `b14e3f2`, required checks and applicable installed fixtures passed; independent review approved and remote main verified.

## Task 22: Possible contradictions and untested assumptions (#7 / original8)

Read issue-8.md, task-22-design-notes.md and AGENTS.md. BASE is `b14e3f2065d54494923a0f6d6c8c06a8b03c33b4`; ship version **0.1.34**. Read task-21-report.md and task-20-report.md for the published shared tool-free ownership, source-reference/fingerprint and exact-byte context contracts.

### Behavior

- Offer an explicit Check answers action over the selected branch or another clearly displayed bounded scope of committed answers. Reuse the owned isolated tool-free SDK helper and the actual context-selection/dependency contract. Do not run on each edit, in the attached chat, or with private drafts/audio/project files.
- Reuse the instance's published actual-release tool-free ownership slot, including the decision brief from task21. Completed findings are not active inference; contention/cancel and unresolved shutdown retain the same behavior. Do not add a parallel helper pool or automatically retry a timed-out check.
- Task21's published APIs are `prepareBrief(doc)` over `prepareResearch(...,{operation:'brief'})`, shared `identity/framing/record` projections, and `Explorer.toolFreeTask` with `trackToolFreeRelease`/`requireToolFreeRelease`. Use the same bounded root-anchored journey context if choosing a journey-wide check; label that scope before starting. Supply check-specific instructions/prefix and capture the exact actual SDK strings, not decision-brief instructions. Transient checks can retain existing exact dependencies; do not persist a second fingerprint archive merely to share the brief artifact format.
- Return a bounded structured set of possible tensions or untested assumptions. Explain the issue and what would help resolve it, with actual source node IDs from the sent context. Preserve certainty labels and distinguish conflicting user decisions from tentative alternatives that may simply remain undecided. Never present model judgment as proof or invent a confidence percentage.
- Limit each check to at most 12 findings. Each has a unique validated opaque ID, a supported category, nonblank explanation and suggested resolution of at most 1,000 UTF-16 code units each, and 1–8 distinct validated source references from the transmitted input. An empty findings list is valid. Bound raw structured output to 256 KiB UTF-8, reject unknown fields/IDs, and preserve text without silent truncation. Reconcile source-reference types with task21, including explicit guidance/constraint references rather than fabricated node IDs.
- Task21 references are exactly `{kind:'node',id}` or `{kind:'guidance',field}`, with field `topic|objective|successCriteria|pins`. Reuse this representation and small common validation/navigation seams where appropriate. Source state/review labels must come from captured trusted records, never the model's self-description. A pair of tentative alternatives can be presented as an unresolved choice, not asserted to be contradictory settled decisions. Do not imply the structural validator proves the model's semantic judgment.
- Render source-linked findings as plain text with Dismiss and Go to source. Source navigation must reveal folded/out-of-focus nodes using existing navigation, preserving draft text and current map semantics. The feature must never rewrite answers, set answer states, add questions or silently edit constraints.
- Keep one bounded transient check result for the active journey. Results and dismissals survive ordinary same-journey polling/rerenders, but reload/replacement/check rerun may clear them; state this limit. Do not create a new persistent review database or implement deferred human review. A relevant source edit makes that finding stale and unusable as a current claim; show why and offer an explicit rerun. Dismissal is local review state, not a document/history write.
- Keep result/dismissal identity scoped to the check, not unrelated accepted-brief or research metadata. A separate canvas accepting a brief must not reset a still-current check or restore dismissed findings. Add a focused unrelated-artifact update regression alongside relevant-source invalidation.
- Retain exact captured dependency IDs/values so unrelated edits are preserved and need not invalidate every finding. Include target/scope/guidance and all sent dependencies needed for reliable stale-result checks. No stale completion can replace a newer check, another journey's state or a cancellation result.
- Here unrelated means outside the actual captured input set. All inputs sent to a check may have influenced its findings even if the output cites only some of them; it is safe to mark that check's findings stale after any included source changes. Do not infer independence merely from missing output citations. Use the source links for navigation and explanation, not as a substitute for captured-input freshness.
- Show omitted-context coverage alongside a no-findings result. Say no possible issues were found in the reviewed context, not that the whole map is proven consistent. Missing evidence is not automatically a contradiction. Keep bounded cancellation/progress/retry and operation-specific retained usage receipts.

### Verification and completion

- Test contradictory and compatible deterministic helper outputs, tentative/decided distinctions, missing/invalid source IDs, duplicate findings, malformed/oversized output, relevant/unrelated edits, dismissal/navigation, late/cancelled/replaced results, omitted context and safe text rendering. Test no main-chat send, zero actual tools and preserved drafts/answers through real HTTP/jsdom fixtures.
- Reuse existing helper/schema/source-navigation seams only where genuinely shared. No generic workflow framework or parallel agent pool. Require local installed SDK fixtures when the integration path changes; no paid provider, existing user session, microphone or browser/desktop automation.
- Run npm test/check/package, synchronize confirmed patch/release metadata/README, include controller plan changes, self-review and commit. No nested agents or push/merge/issue closure. Write task-22-report.md with final schema/limits, dependency/invalidation behavior, exact test evidence, commit and live-model/native-UI limitations. Controller independently reviews and publishes.

Published task 22: **v0.1.34**, `88868a4`, required checks and applicable installed fixtures passed; code-quality review approved with one Minor fixed-scope metadata gap tracked for task29/#40; remote main verified.

## Task 23: Repeatable performance evidence (#36 / original46)

Read issue-46.md, task-23-design-notes.md and AGENTS.md. BASE is `88868a4213167117fbb9cb120819161380f4dbc8`; ship version **0.1.35**. Read task-21-report.md and task-22-report.md for the current saved brief and transient check/context contracts before constructing fixtures.

### Scope

- Add a documented explicit benchmark command, using deterministic generated synthetic maps. Keep giant fixture files out of git. Cover small, medium, large and near5000-node maps, both deep and wide topology, populated answer/research fields and a saved document close to the9MiB limit. Build fixtures with actual validation rules including optional node kinds/states, rather than silently bypassing limits.
- Benchmark model validation, context preparation, Markdown/native export, branchView/layout, atomic controller/history writes and real-app jsdom rendering separately. Current modules are web/layout.mjs (branchView/layout), web/app.mjs (renderMap/renderWorkspace/renderOutline/poll), model.mjs and controller.mjs; no web/map.mjs exists. Reconcile added helpers before measuring.
- Include a representative saved brief/provenance case, user constraints and decision states using the published schemas, so export/validation/context measurements cover current documents rather than only the original minimal map. Do not include accepted briefs recursively in synthesis input. Keep comparisons reproducible with stable fixture definitions and label any newly added cases separately.
- Use a bounded warmup/sample policy and report sample count, median and range, with Node/OS/CPU, fixture byte/node/question counts and relevant configuration. Report actual elapsed measurements and operation counts, not invented native paint/frame rates. jsdom does not measure browser paint, actual pointer latency, IME or native embedding.
- Provide machine-readable results suitable for comparison across versions and a concise Markdown summary. Record version/commit/dirty status; do not claim a comparison if fixtures or measurement procedures changed. Output belongs in an explicit ignored directory, with bounded temporary files and safe cleanup.
- Keep npm test deterministic. It may verify fixture shapes, complexity/operation counters and result-schema correctness, but must not fail due to a tight wall-clock budget on a shared computer. An explicit benchmark may report conservative targets as informational evidence. Do not optimize production paths in this baseline issue; tasks24–26 use the same harness to demonstrate their changes.
- If a valid large fixture exposes a production failure, report that measurement as failed with its phase and bounded error; do not record zero latency or silently reduce the fixture. Keep the runner able to finish other cases and release resources, then route the concrete failure to the applicable optimization task. A broken benchmark harness itself must be fixed here. Do not call a baseline with production failures an all-passing performance result.
- Bound repeats and memory: process large fixtures sequentially and release jsdom windows, servers, timers and owned temporary history between samples. Never inspect real user documents or use paid providers, existing sessions, a microphone or browser/desktop automation.
- Document a short owner-only native checklist for typing, focus, expand/fold, pan/zoom and narrow resize. Separate those pending checks from measured local evidence.

### Completion

- Verify deterministic fixtures and benchmark schema with focused tests, run a complete bounded benchmark once, inspect the report for meaningful measurements and retain its artifact path. Fix harness errors rather than publishing misleading zero/not-measured values.
- Run npm test/check/package and applicable fixtures only when integration actually changes. Synchronize the confirmed patch/release metadata/README and include the controller plan update. Self-review and commit; no merge/push/issue closure or nested agents.
- Report task-23-report.md with module/API seams, fixture and sample definitions, exact commands/exit evidence, observed baseline and limits, artifact path and commit. The controller reviews and publishes.

Published task 23: **v0.1.35**, `5775e02`, required checks passed and bounded benchmark evidence retained; independent review approved and remote main verified.

## Task 24: Preserve editors through incremental updates (#33 / original43)

Read issue-43.md, task-24-design-notes.md, AGENTS.md and the task23 benchmark report. BASE is `5775e0259cdbf9e2e204b23165d843c2ed102c72`; ship version **0.1.36**. Read task-23-report.md and its retained benchmark results for the exact fixture/measurement contract and any concrete rendering failures. Resolve the carried task2/task6 minors named below.

### Behavior and boundaries

- Update the selected workspace, node cards, status, research/help/proposal areas and library rows by stable identity. Preserve the actual active answer textarea element during unrelated polling, status changes and sibling updates where its identity has not changed; copying value/caret into a replacement is not equivalent for IME or dictation.
- Keep draft text/state and text-mutation generation, selection range/direction, editor scroll, focus, composition, disclosure state and transient helper/proposal state intact. Respect existing source invalidation and voice cancellation boundaries; DOM reuse must not keep an old node's callback active or accept a stale result.
- Use small targeted rendering seams in the existing modules, without a framework/runtime dependency, generic virtual DOM or full application rewrite. A real journey or selected-node replacement may rebuild its workspace, with existing explicit draft flush and cancellation behavior. Document where replacement is necessary.
- Each reusable element must resolve actions against current valid identity, not stale captured node data. Bound listener lifetimes and detached elements; repeated renders must not multiply operations, subscriptions, timers or acknowledgments.
- Fix carried task2 Minor: Pin/Unpin/Archive library operations retain a sensible keyboard focus target on the same surviving row, or the nearest remaining control if it disappears. Preserve the search/filter and visible scroll position; announce meaningful status without stealing focus.
- Fix carried task6 Minor: selection must not rebuild the hidden Outline. Refresh it when revealed or its visible content actually changes, preserving visible search, focus and scroll. Keep full-map accessibility even when branches are folded or focused.
- Preserve the selected editor through relevant non-destructive updates where possible, but do not disguise a removed/replaced node as still editable. After removal or journey replacement, move focus to an existing meaningful target and retain recoverable drafts according to existing contracts.

### Evidence and release

- Use actual-app HTTP/jsdom regressions for element identity, typing during polling and research, selection/scroll, composition start/update/end, synthetic dictation, cleanup Apply/Undo, question help, references/rationale, focus switching and removed nodes. Exercise repeated updates with deterministic operation/listener counts and prove one user activation causes one action. No browser/desktop automation, real microphone, paid provider or existing session.
- Compare the same task23 benchmark cases before/after, including hidden-outline work and repeated selected-workspace updates; retain machine-readable artifacts and explain changed counters. Use the final task23-specific retained JSON/MD and procedure, not an earlier superseded run or an overwritten .perf-baseline output. Preserve original comparable phases; label any extra steady-state/update counters separately so a changed harness cannot masquerade as a performance improvement. Do not claim jsdom measurements prove native paint/typing latency. Do not broaden this task into task25 viewport virtualization or task26 HTTP polling redesign.
- While extending benchmark counters, resolve carried task23 Minor from task-23-review.md: reject missing/empty expected cases or phases and nonfinite/negative samples in the result validator. Preserve the explicit bounded fixture-failure representation; deterministic malformed-result tests belong here, not new timing thresholds.
- Run npm test/check/package, and installed fixtures only if host integration changes. Synchronize the confirmed patch metadata/README/release note and include the controller plan update. Self-review and commit; no nested agents, publishing or issue closure.
- Write task-24-report.md with rendering ownership and disposal contracts, carried Minor resolutions, actual checks/benchmark evidence, SHA and owner-only native IME/typing/layout checks. Controller independently reviews and publishes.

Published task 24: **v0.1.36**, `ea156d4`, required checks and rendering evidence retained; independent review approved and remote main verified.

## Task 25: Keep large maps responsive (#34 / original44)

Read issue-44.md, task-25-design-notes.md, AGENTS.md and task23/task24 benchmark and rendering reports. BASE is `ea156d4c55d56d5265a23849b5a5139e40f65349`; ship version **0.1.37**. Preserve the published task24 editor identity, current-callback and disposal contracts. Use the final retained task23/task24 comparison artifacts and disclose any measurement-procedure change.

- Separate the full logical document, folded/focused layout and viewport-mounted nodes. Cull unnecessary offscreen compact-node contents with a small overscan boundary, without deleting logical nodes, answers, drafts or source dependencies. Keep the expanded selected editor mounted and usable even near a viewport edge.
- Cache stable geometry so ordinary pan/zoom does not repeat full tree layout. Use explicit invalidation inputs for topology, folded/focused visibility, relevant node dimensions and expansion; measured size changes, font/viewport resize, generated children and history/journey replacement must invalidate correctly. Bound caches to the active journey and release stale references.
- Preserve connectors crossing the viewport even when endpoints lie offscreen. Do not infer visibility solely from endpoint inclusion. Screen/world coordinate conversion must remain consistent at supported zoom extremes, resize and negative pan positions.
- Navigation/reveal must mount a target before focusing it and leave it reachable. Preserve Fit visible/whole-map recovery, folding/focus semantics, selected expanded node and the full Outline accessibility alternative. Do not silently change the user's selection because a compact card is culled.
- Do not remove the currently keyboard-focused control merely because it moves outside the overscan area. Keep that active element mounted until focus changes, or use an explicit meaningful focus transfer when its logical owner is removed. Test focused-card pan/cull and reveal-before-focus ordering, not only selected-editor retention.
- Use the existing no-dependency SVG/DOM layout modules and current validated map limits. Do not raise capacity or claim infinite rendering/storage. Keep task24 stable editor DOM and listener lifecycle guarantees.
- Add deterministic deep/wide/long-text near-limit cases, viewport/edge crossings, pan/zoom/resize and folds/focus/history replacement. Assert geometry, mounted-node/edge counts, cache invalidation and resource disposal; never treat jsdom as proof of native frame rate or real IME.
- Compare the same task23 benchmark cases and record before/after counts and timings. Fix any baseline layout failure that this task explicitly owns and retain transparent failure/coverage reporting. Native appearance, pointer responsiveness and narrow-pane checks remain manual; no browser/desktop automation, live mic, paid provider or existing user session.
- Run npm test/check/package and applicable fixtures only when integration changes. Synchronize confirmed patch metadata/README/release note, include controller plan update, self-review and commit. No nested agents or publication. Write task-25-report.md with cache/culling contracts, tests, benchmark artifacts, SHA and remaining manual checks.

Published task 25: **v0.1.37**, `c919e99`, required checks and rendering evidence retained; independent review approved and remote main verified.

## Task 26: Avoid transferring unchanged maps (#35 / original45)

Read issue-45.md, task-26-design-notes.md, AGENTS.md and published context/concurrency/rendering reports. BASE is `c919e995b732f01c8fd2cd8af6a13fa17d00e6c5`; ship version **0.1.38**. Preserve task24 connected-editor ownership and task25 geometry/viewport invalidation. Read their final reports and use retained task23/task24/task25 benchmark artifacts for clearly labeled comparison. Existing private completed-help freshness checks and actual-release barriers remain authoritative.

- Prefer a bounded conditional snapshot cursor over a new socket service. A cursor must identify instance, journey and document content plus all state represented in that response. Document revision alone misses progress, cancellation, errors and question previews; same revision in another journey must never reuse old content. Unknown/invalid/old cursor or changed instance gets a full validated snapshot.
- An unchanged response must avoid full map serialization, transfer and parse, not merely discard the body after doing the same work. Keep token/Host/Origin/body validation and cache-control rules. Do not expose secrets or absolute paths in cursors; keep the native get_exploration/callback snapshot complete and unchanged unless its separate contract explicitly requires an update.
- Keep private cleanup/help requests and results private. Poll optimization must not suppress the task17 read-only committed-source checks for completed help or confuse retained browser results with native snapshot state. No automatic inference or private draft upload is allowed to establish freshness.
- Fix carried task17 Minor: the error/timeout path of an older completed-help check must only invalidate the result IDs it checked, not a newer same-node replacement. Cover old check -> replacement result -> old timeout/rejection, alongside ordinary stale-result suppression. See task-17-rereview-1.md.
- Keep separate draft/library/history/reference/navigation metadata reads scoped to their actual needs, rather than adding those contents to every map poll. Their revision/conflict controls still apply; status changes must become visible without requiring an unrelated answer save.
- Preserve action epochs and response ordering. A late response from before a user action, journey switch, cancellation or reconnect cannot install an old map, lose a draft or revive an obsolete request. Do not queue stale document writes for replay after reconnect.
- Show a concise reconnect state and use bounded retry/backoff; retain draft content and explicit user controls during disconnect. Recover from missed updates with a complete snapshot when needed. Stop timers/listeners and pending polling when the canvas closes; rapid reopening must not duplicate loops.
- Test actual payload bytes and serialization counters for unchanged large maps, document-only/transient-only changes, same-revision different journeys, out-of-order responses and concurrent actions. Include preview accept/dismiss, research completion/failure, saved document with history-finalization error, help freshness, cancel/replacement, connection gaps and shutdown.
- Compare identical task23 benchmark cases and retain machine-readable before/after artifacts; no tight wall-clock assertions in npm test. No browser/desktop automation, real mic, paid inference or existing session.
- Run npm test/check/package and applicable installed fixtures for changed snapshot/host contracts. Synchronize confirmed patch metadata/README/release note, include controller plan update, self-review and commit; no nested agents or publication. Write task-26-report.md with cursor/invalidation/fallback semantics, measured bytes/work, checks, SHA and native/manual limits.

Published task 26: **v0.1.38**, `557da5d`, required checks and protocol evidence retained; independent review approved and remote main verified.

## Task 27: Understandable interruption and recovery flows (#37 / original47)

Read issue-47.md, task-27-design-notes.md, AGENTS.md and current history/draft/owned-helper reports. BASE is `557da5d1213829b4a81bfc34108e3a334f9ea77a`; ship version **0.1.39**. Preserve the published conditional snapshot protocol and transient-state invalidation from task26; read its final report. The document atomic replacement remains the commit point, history intent may need later finalization, and draft tombstones and unreconciled usage journals protect recovery. The design notes inventory the current cooperative lock paths; reconcile against source before choosing a shared lock seam.

### Recovery behavior

- Build on the published document commit point, history intent reconciliation, local draft recovery and owned-helper usage journals. Distinguish a failed precommit save from a document saved successfully with incomplete history finalization. Do not report committed newer text as lost or overwrite it with the old in-memory snapshot.
- Offer useful explicit actions: retry a safe read/save/reconciliation, inspect/open a validated recoverable version, or dismiss a known interrupted operation. Explain which data each action affects. Retry inference only after a fresh explicit user request, with normal context/model/account checks and retained receipts; do not automatically replay a crashed research operation.
- A recoverable snapshot must pass normal schema, size and identity checks. Preserve the active file, its original malformed bytes where applicable, history and drafts before recovery. For a broken active file, importing a validated snapshot as a separate recoverable copy can be safer than overwriting it. This is recovery, not deferred scenario forks or a new backup/sync product.
- Use actual recorded operation/recovery evidence. Distinguish interrupted, failed, still active and unknown. Missing historical records are unknown, not invented interruptions. Bounded discovery must not read arbitrary paths from tampered journal pointers or recursively scan the user's computer.
- Treat exports honestly: an HTTP response does not prove the browser saved a file. Detect only observable generation/response failures or interruption evidence that is actually recorded, offer an explicit retry, and state the visibility limit. Do not claim durable download completion or infer that an old partial file is safe to replace.
- Preserve draft text/state/caret and existing current-journey content during recovery inspection or errors. A recoverable version preview must not silently become the active journey. Surface safe actionable errors without gratuitous private paths, source text or raw stack traces.

### Lock ownership

- Inspect all current cooperative lock acquisition/release paths. Introduce validated owner metadata and a narrowly scoped recovery protocol only where needed. Never use age alone as proof of abandonment, and treat unknown legacy/malformed ownership conservatively.
- Prove a prior owner has exited before reclaiming a known owned lock. A live/reused PID, inaccessible process check or permission failure is not proof of death. A timeout only means the caller stopped waiting.
- Prevent the two-recoverer/new-writer race described in task-27-design-notes.md. Read/stat followed by unlink of a shared lock path is insufficient. Use an exclusive recovery claim respected by all recovery paths, or a demonstrated OS-supported equivalent; reread and verify the dead-owner record while holding that claim, then atomically quarantine only that stale lock. Never subsequently unlink the shared lock path after a new owner could have acquired it.
- An abandoned recovery claim itself must fail conservatively rather than recurse into unsafe claim deletion. Keep any quarantine/repair artifacts bounded and recoverable, with explicit retention metadata for the later storage-management task; do not implement broad cleanup here.

### Verification and release

- Use disposable child-process/filesystem fixtures for killed writers, live owners, PID reuse/unknown ownership, two recoverers and a newly acquiring writer. Test interrupted before/after atomic replacement, malformed/truncated active files, corrupt history/intent/journal pointers, partial temp files, unavailable storage, failed recovery/export/retry, and preserved newer answers/draft tombstones.
- Exercise actual protected HTTP and jsdom recovery controls, stale revisions and journey changes. Avoid a test that merely reimplements the lock algorithm. No real user file repair, browser/desktop automation, real microphone, paid provider or existing session tests.
- Run npm test/check/package and applicable installed local runtime fixtures. Synchronize confirmed patch/release metadata/README and controller roadmap change, self-review and commit; no nested agents/push/merge/issue closure.
- Write task-27-report.md with lock proof/limitations, exact commit/recovery semantics, observed-versus-unknown operation states, evidence/SHA and owner-only checks. Root reviews and publishes.

Published task 27: **v0.1.39**, `634c4b6`, required checks and recovery evidence retained; independent review approved and remote main verified.

## Task 28: Readiness diagnostics and safe support export (#38 / original48)

Read issue-48.md, task-28-design-notes.md, AGENTS.md and final recovery/helper/voice reports. BASE is `634c4b685d272933aad27df396f8e9edb682e294`; ship version **0.1.40**. Read task27 final recovery/lock/operation contracts and task26 polling invalidation before implementation. Preserve authoritative helper release uncertainty and the distinction between observed recovery evidence and unknown state. The support artifact must be constructed from an explicit allowlist, not raw logs with later redaction.

- Add a compact diagnostics view reachable from existing settings. Show the plugin version and detected host/runtime capabilities, installed speech/model readiness and research/tool-free-helper readiness. Keep ready, unsupported, unavailable and unknown distinct. A found model directory does not establish valid loadability, and selected hardware does not prove live capture works.
- Inspect the installed SDK declarations and existing inspectors before integrations. Diagnostics may perform bounded read-only readiness checks, but opening/polling it must never record audio, start inference, prompt authentication, modify host settings, download a model or replace host components. Give actionable routes to existing settings or explicit retry where available.
- Include helper ownership/recovery failure states accurately. A failed shutdown is not ready merely because its request promise settled. Reuse the published ownership state rather than guessing from UI pending labels.
- Offer an explicit user-requested support export with a documented strict schema and allowlisted categorical codes, version identifiers, booleans and bounded counts. Construct it from approved fields; do not collect arbitrary logs/stacks and then attempt regex redaction. Show what categories will be included before export, and report export failure without leaking private paths.
- Exclude tokens/capability URLs, account/session/request/document IDs, topic/questions/answers/prompts/drafts, source URLs, audio/model data, usernames/home paths, arbitrary error strings/stacks and precise device names unless a demonstrated diagnostic need is approved in the task brief. Normal diagnostics may show locally useful selected-device labels, but the support bundle defaults to generic readiness.
- Retain useful safe error categories when raw exceptions contain sensitive strings. Unknown errors become a documented generic category; do not falsely classify them as supported or resolved. Bound source reads and output size, and preserve existing safe download/path behavior.
- Fix carried task1 Minor: valid JSON null in release metadata must produce a file/field-specific actionable diagnostic instead of a generic TypeError, with a focused fixture regression. Avoid unrelated release-tool refactoring.
- Test missing/unsupported SDK, model absent/unloadable/unknown, unavailable microphone, read-only no-side-effects behavior, ownership uncertainty, retry and export failure. Inject canaries into all freeform source fields, nested objects, malicious multiline errors and sensitive identifiers, then assert exported bytes contain only the allowlist and none of the canaries. No real microphone, paid model, existing session or browser/desktop automation.
- Run npm test/check/package and installed local fixtures when readiness integration changes. Preserve old evidence; use run-npm.mjs to capture stdout/stderr/exit separately, without suppressing unexpected diagnostics. Synchronize patch metadata/README/release note and controller plan update, self-review and commit. No nested agents/publication. Write task-28-report.md with detection limitations, support schema, carried Minor resolution, checks/SHA and owner-only native verification.

Published task 28: **v0.1.40**, `9bb724c`, required checks and diagnostics evidence retained; independent review approved and remote main verified.

## Task 29: Review research context before sending (#40 / original52)

Read issue-52.md, task-29-design-notes.md, AGENTS.md and the final task20 context and task19 concurrency contracts. BASE is `9bb724cf990f73f6534852157fcc4a8320c12661`; ship version **0.1.41**. Reconcile final task27 recovery/ownership and task28 diagnostics contracts before implementation. Preserve task26 immutable document replacement and conditional state invalidation, existing helper release gates and exact sent-source freshness. Project attachments are not yet implemented; keep that boundary explicit.

- Resolve carried task22 Minor: `captureCheck` currently omits its fixed `prepared.context.scope` from captured dependencies. Retain and compare the actual sent scope with a focused changed-scope regression. The published check has only a fixed scope, so this is contract hardening; do not use it as a reason to add an unrequested check-scope selector. See task-22-review.md and open-minors.md.

- Show the actual prepared context for an Explore options request: selected question, committed guidance/mode/pins, included ancestors and optional other answers, plus existing selected source attachments if supported at this point. Do not build project crawling ahead of task38. State explicitly when no project files are included.
- Reuse the exact pure preparation result and coverage manifest that the owned research helper sends. Do not independently reconstruct a friendly display that can diverge from the payload. Distinguish user statements, answer states, historical AI rationale and source material; display literal text safely and label omissions and enforced limits in their real units.
- Identify required context and let the user exclude optional records. Exclusions must change both the exact outgoing payload and captured dependency set, never only the visual preview. Preserve mandatory-overflow errors and complete-record omission rules. Changes to the selection must not start inference.
- Bind review and start to one immutable server-owned snapshot and its journey/node/source identity. Recheck relevant committed values at start; if they changed, require refreshing the displayed snapshot and an explicit start rather than silently sending newer values. Unrelated edits should remain unrelated according to the published exact dependency contract.
- Keep choices local to the current request, distinct from committed answers and permanent journey guidance. Raw drafts remain excluded; this issue does not need an include-draft option. Cancel/dismiss/reload ends the pending review without inference and without losing the answer draft. Bound preview retention and reject obsolete or cross-journey tokens.
- Explain the boundary accurately: this controls the isolated research helper's Explorer-supplied input. It does not erase previous main-chat context or constrain the separate native get_exploration snapshot. No host model/permission changes, new agent pool or automatic network request is authorized by viewing context.
- Test actual final helper prompt bytes for excluded canaries, Unicode/escaping/limit boundaries, whole-record omissions, changed sources between review/start, unrelated commits, invalid/old tokens, out-of-order previews, cancellation and rapid replacement. Real HTTP/jsdom tests preserve draft/state/caret/composition, keyboard focus and voice cancellation while reviewing context. No browser/desktop automation, real mic, paid provider or existing session.
- Run npm test/check/package and applicable installed research/canvas fixtures. Synchronize confirmed patch metadata/README/release note and controller plan update, self-review and commit; no nested agents/publication. Write task-29-report.md with preview token/source lifecycle, exact sent-versus-displayed contract, tests/SHA and native/manual limits.

Published task 29: **v0.1.41**, `8f0af45`, required checks and context-review evidence retained; independent review approved and remote main verified.

## Task 30: Research depth and source preferences (#26 / original34)

Read issue-34.md, task-30-design-notes.md, AGENTS.md and the published task20/task29 context-preparation reports. BASE is `8f0af4544e5f01449a70e06409d8f7938ae165ba`; ship version **0.1.42**. Reconcile the final task29 reviewed-context token and exact payload contracts before implementation. Preserve task27 lifecycle/ownership evidence and task28 diagnostic readiness limits. Exact research ceilings are defined below and do not change tool-free helper defaults.

### Request behavior

- Add Quick, Standard and Deeper choices beside the reviewed research context, with visible time/tool ceilings before an explicit start. Changing a preference or inspecting scope must never start inference or change the main chat's selected model.
- Inspect the then-current owned helper timer and tool gate before setting budgets. At v0.1.31 Standard used a 180,000 ms overall operation timer and at most 24 attempted tool calls. Preserve Standard unless a measured reason justifies a documented change. Use Quick = 60,000 ms / 8 attempted tool calls, Standard = 180,000 ms / 24 attempted calls, and Deeper = 300,000 ms / 40 attempted calls. The elapsed limit starts at owned execution, including runtime/account/model/tool setup; cancellation/accounting/shutdown may continue afterward. Count every attempted tool call, including denied attempts, at the existing pre-tool gate. Do not silently multiply only a prompt instruction.
- Enforce the selected elapsed-time limit and tool allowance at actual owned-session execution boundaries. Define whether startup counts and whether denied calls count; use one honest definition for UI, code, tests and retained provenance. Existing bounded shutdown/accounting may continue after the operation timer; do not promise a hard process-wall-clock finish if shutdown cannot be confirmed.
- Keep actual-release ownership, cancellation invalidation, exact captured dependencies, current-disk merge and conflict checks. A timeout does not grant permission to overlap a replacement run, approve managed permissions, use a different account/model, widen tools, or retry inference automatically.
- Offer a small, validated source-focus choice such as balanced versus primary-source preference, and an optional recent-source preference where useful. Preferences guide retrieval; they do not prove that sources exist, are current or are correct. Unknown publication dates remain unknown. Avoid an elaborate filtering query language.
- Include actual chosen settings in the captured immutable request, budget accounting, helper instructions and structured research provenance. Imported legacy research without settings stays unknown, not retrospectively Standard. Preserve existing user answers and earlier saved research on failure.
- Integrate the selection with task29's actual context preview so the preview and request cannot disagree. Relevant edits after review require the existing refresh/review path. Scope and source preferences are distinct controls: a recency preference does not widen access to omitted map data.

### Verification and release

- Test every exact time/tool boundary with deterministic local fixtures, attempted/denied call counting, cancel during startup and inference, stop failure/late release, unsupported/invalid preferences, stale context and no automatic retry. Do not wait for real multi-minute timers in ordinary tests; inject a narrow clock/timer seam if needed and verify real production defaults independently.
- Inspect actual isolated SDK configuration and transmitted instruction/prompt strings; assert no parent model change and retained operation-specific usage/provenance. Verify legacy import/history/Markdown behavior and safe text rendering. Do not invent historical settings or publication dates in local fixtures.
- Run focused tests, npm test/check/package and applicable installed local runtime fixtures. No paid provider, existing user session, browser/desktop automation, microphone or new runtime dependency.
- Synchronize confirmed version/release metadata/README, include controller roadmap change, self-review and commit. No nested agents, push/merge/issue closure. Write task-30-report.md with exact budgets/units, enforcement and provenance contracts, evidence/SHA and native/live-quality limits. Root reviews and publishes.

Published task 30: **v0.1.42**, `811687e`, required checks and research-budget evidence retained; independent review approved and remote main verified.

## Task 31: Research claims with inspectable evidence (#29 / original37)

Read issue-37.md, task-31-design-notes.md, AGENTS.md and the final task30 research report. BASE is `811687e1d14a4ffbaf98df64ff7d7b02de1db960`; ship version **0.1.43**. Reconcile final task30 research budgets, preference provenance and actual tool hooks before implementation. Preserve task29 immutable reviewed-context/dependency contracts, actual-release gates and current-disk completion checks. Do not fabricate provenance for legacy/imported research.

### Behavior and provenance

- Extend research with bounded claim-to-source references and concise supporting paraphrases, retrieval time and limitations. Preserve useful options/recommendation/apply behavior. Display evidence alongside the claim it is intended to support, and preserve it in native, history and complete Markdown exports.
- Separate actual consulted-source provenance from a model's interpretation of what that source supports. A successful page read establishes that a page was consulted, not that every linked claim is true. Use explicit reasoning/unknown labels where support is missing; do not invent confidence percentages or call semantic truth automatically verified.
- Capture successful retrieval identity and time from actual owned research tool activity. Never accept model-generated retrieval timestamps as observation. Search snippets alone are not fetched evidence. Match each referenced source to an actual successful read from this request; no prior-request source bleed, failed fetch, invented URL or fabricated claim ID.
- Prefer supporting paraphrases and links. Quotes are optional, not required for this issue; if implemented, cap and attribute short excerpts and verify them against captured fetched content. Do not preserve entire pages in the journey or accept model text as a verified direct quotation.
- Give claims and sources stable validated IDs within the result, reject duplicate/unknown references, and set explicit count/length/serialized limits before implementation. Reconcile those limits with existing research fields, tool budgets, the 9 MiB document cap and the actual SDK output envelope. Reject malformed/oversized output rather than silently clipping evidence or replacing the previous saved research.
- Preserve legacy research honestly: old URL lists remain consulted-source lists with unknown claim-level support and unknown historical retrieval time. No fabricated migration/backfill and no claim that imported provenance was observed by this installation.
- Treat all page/model/user text as data. Render plain text and validated HTTP(S) links, escape exports, and retain current network restrictions/usage receipts/source freshness. No unbounded extra fact-checking agent, automatic retries or additional provider/model.
- Keep saved answers unchanged. Research evidence remains guidance; only an explicit existing apply action may put selected text into a draft, and only the user saves that answer.

### Verification and completion

- Test fetched/unfetched/failed/previous-request sources, duplicate or mismatched IDs, reasoning-only and mixed support, exact retrieval observation, malicious text/URLs, legacy imports, size failures preserving prior research, cancellation and current-disk source invalidation. If quotes exist, test invented/modified excerpts and source attribution limits.
- Exercise actual HTTP/jsdom evidence disclosure/navigation and native/Markdown/history round trips. Use the installed local SDK research fixture to prove actual tool provenance and retained receipts, with no paid provider, existing user session, real microphone or browser/desktop automation.
- Run npm test/check/package and applicable installed fixtures. Synchronize the confirmed patch metadata/README/release notes, include controller plan changes, self-review and commit. No nested agents, merge/push or issue closure.
- Write task-31-report.md with the final schema, bounds, source and retrieval contracts, legacy behavior, exact evidence/commit and semantic-quality/native-UI limitations. Controller independently reviews and publishes.

Published task 31: **v0.1.43**, `c6e7e25`, required checks and claim-evidence provenance retained; independent review approved and remote main verified.

## Task 32: Scoped follow-up questions on research (#27 / original35)

Read issue-35.md, task-32-design-notes.md, AGENTS.md and the final task29–31 context/research/evidence reports. BASE is `c6e7e25f8a35093108ae199e49cd4345c2e75bef`; ship version **0.1.44**. Reconcile final task31 claim/source evidence and task30 research budgets with task29 immutable reviewed-context contracts. Preserve actual-release ownership, receipts and current-disk freshness. Define concrete bounded exchange and output limits before implementation.

### Behavior

- Add an explicit node-scoped way to ask why a recommendation was made, request clarification, or explore a changed assumption. Keep the original research visible and unchanged. Follow-up questions and results belong to the selected research result, not the attached chat or a new permanent conversation product.
- Use owned isolated SDK work and the existing actual-release research ownership, permissions, tool/deadline budget and retained usage receipts. No indefinite hidden session, parallel helper pool, background auto-retry or changes to the attached session's model. Each explicit request must have bounded inputs, output, lifetime and cancellation.
- Tie the history to journey/node plus the exact research identity/content and captured source context. Relevant changes invalidate a pending result and mark existing follow-ups historical or clear them with an explanation. Unrelated metadata edits must not discard current follow-up text/history or overwrite newer work. Rerun/replacement/cancellation tokens must prevent late results from entering a different node's history.
- A changed assumption is hypothetical unless the user explicitly commits it through the existing answer/guidance flow. Label hypothetical inputs and distinguish them from saved constraints. Never silently change answers, answer states, guidance, research or the accepted brief. If offering apply, seed only an editable draft through the existing explicit mechanism.
- Reuse the actual prepared-context preview and byte limits. Include the user's complete current follow-up, relevant committed context, the bounded original recommendation/evidence and a bounded history of complete exchanges. Omit optional whole records/exchanges deterministically with visible coverage, never silently truncate the current question or pretend omitted history was read.
- Define explicit limits for question length, retained exchanges, history bytes and structured response before coding. Prefer a small transient history for the active journey/node; disclose reload/navigation retention. Do not introduce a new persistent chat database or duplicate full research records for every turn.
- Reuse the claim/evidence schema from task31 where genuinely applicable. Previously consulted sources retain their original retrieval provenance and are labeled prior evidence; they are not new successful fetches. New factual claims require evidence from a permissible source or an explicit reasoning/unknown label. Do not fabricate fresh retrieval dates for old sources.
- Keep sources, limitations, progress, cancel and retry visible within the research flow. Preserve answer drafts, caret, focus and source navigation. Render all text safely; links and IDs follow existing validation rules.

### Approved concrete bounds and state

- Preserve the complete nonblank current question, at most 4,000 UTF-16 code units. Changes described by a follow-up are hypothetical until saved separately.
- Each raw structured response is at most 12,000 UTF-16 code units and 24,576 UTF-8 serialized bytes; validate the normalized result including trusted metadata against the byte ceiling. Answer text allows 5,000 code units and uncertainty 3,000. Reuse task31 bounded claim/source validation without synthesizing fake options.
- Retain one transient active journey/node/research conversation, at most four complete exchanges and 65,536 serialized UTF-8 bytes including exact questions and metadata. Drop only oldest complete exchanges with a clear retention/omission notice. Navigation can hide it; asking on a different node replaces it. Completed history may reconnect after a web-panel reload while the same canvas controller remains alive; canvas close/restart discards it. Unsent typed questions are browser-only and reload clears them. Disclose and test this distinction without duplicate inference.
- Keep a separate source-dependency union of at most 5,000 actually transmitted record fingerprints and 4 MiB serialized UTF-8 bytes, plus identity/framing/original-research fingerprints within that cap. Show actual tracking count/bytes in review coverage; reject overflow before inference. This is separate from the 65,536-byte complete-exchange history and never duplicates full research or prepared contexts per exchange.
- The immutable review includes the exact current question, hypothetical marker, original recommendation and mandatory committed target/guidance. Optional whole original evidence/options/summary, then newest complete exchanges, then optional committed context are admitted deterministically under the existing actual instruction-plus-prompt byte ceiling, with honest coverage counts.
- Prior evidence references use the original result or a retained exchange UUID plus its exact result-local source ID. Resolve only included prior sources; unknown or omitted references reject. Trusted parsing copies prior metadata unchanged and labels it prior, preserving imported origin and original dates. Newly consulted evidence must come from this run's successful-fetch map.
- Reuse the single-use ResearchReview and shared research release queue. A distinct research-follow-up operation must reconcile time/tool-budget branches, usage labels and recovery evidence. Original research and answers remain unchanged; no follow-up draft-apply feature is required.

### Verification and completion

- Carry the task31 Minor from open-minors.md: correct README.md:86 `claim?s` to `claim's` with an encoding-safe edit while updating documentation.

- Test repeated exchanges and exact limits, omitted history, changed hypothetical versus committed assumptions, missing/invalid input and structured output, relevant/unrelated changes, replacement research, duplicate/late/cancelled results, release contention and receipts. Verify the original research and answers remain byte-for-byte unchanged unless the user uses an existing explicit save operation.
- Use actual HTTP/jsdom for typing during polling, source links and navigation/reopen behavior. Use installed SDK/local tool fixtures for captured strings, budgets, prior versus newly retrieved evidence, tools, cancellation and receipts. No paid provider, existing session, real microphone or desktop/browser automation.
- Run npm test/check/package and applicable installed fixtures; synchronize confirmed version metadata/release notes/README, include controller plan changes, self-review and commit. No nested agents, merge/push or issue closure.
- Write task-32-report.md with final bounds, state/ownership/provenance contracts, exact evidence and commit, plus manual native-UI and live-model limitations. Controller independently reviews and publishes.

Published task 32: **v0.1.44**, `7066f34`, required checks and scoped follow-up evidence retained; independent review approved and remote main verified.

## Task 33: Compare researched options (#28 / original36)

Read issue-36.md, task-33-design-notes.md, AGENTS.md and the published claim-evidence/context/research reports. BASE is `7066f3409b24e145aecf6ad8b8064d1b66676b72`; ship version **0.1.45**. Reconcile final task31 claim/source evidence and task32 follow-up state with the actual saved options. Preserve bounded reviewed SDK execution if needed, user drafts and explicit commitment. Define concrete criteria/preference bounds and actual-vs-unknown cell semantics before implementation.

### Behavior

- Offer an optional accessible comparison matrix for the actual options in the selected saved research. Let the user select useful criteria and optionally express the relative importance of those criteria. This is a focused decision aid, not a general spreadsheet or manual map editor.
- Use actual option details and evidence where available; missing cells are Unknown. Distinguish cited information, model judgments, unknowns and user preferences in the cell or its immediately available details. Do not turn absent facts into zero scores or infer a precise numeric utility from qualitative prose.
- User weights express personal priorities, not evidence quality or confidence. Explain their effect. Qualitative priorities are sufficient; avoid fabricated decimal rankings. Conflicting criteria should expose a tradeoff rather than invent one universally best option.
- Preserve current research/source provenance. If additional comparison reasoning is necessary, make it an explicit isolated SDK request with the existing actual prepared-context preview, bounds, permissions/release/cancellation and receipts. Do not trigger inference on every checkbox/weight change, run in main chat, or silently refetch/rewrite the original research.
- Tie comparison state to journey/node and the exact research/content it uses. Relevant research/source replacement invalidates current comparison output; unrelated metadata updates must preserve criteria, weights, selections and focus. Label whether criteria/preferences are transient and what navigation/reload retains. Avoid a new persistent comparison database.
- Provide existing explicit actions to use the recommendation, a chosen option or selected values as an editable answer draft. Preserve original user text and selected answer state under existing draft insertion/undo rules. Never commit a decision or save an answer automatically.
- Keep the matrix usable in a narrow pane: semantic row/column headers, keyboard-reachable controls, full text/evidence available, and a contained horizontal-scroll or stacked alternative that does not make the whole canvas unmanageable. No new chart/table runtime dependency.

### Verification and completion

- Test missing evidence, uneven options, unknown cells, contradictory criteria, weight changes, actual source links, malformed/hostile text and relevant/unrelated updates. Exercise actual HTTP/jsdom keyboard/focus/selection/apply/undo behavior and draft preservation, including stale or cancelled helper output if a helper is added.
- Verify table semantics and narrow-layout structure locally without claiming jsdom proves native visual layout. No paid provider, existing user session, microphone or browser/desktop automation. Run installed SDK fixtures if integration changes.
- Run npm test/check/package, synchronize confirmed patch metadata/release notes/README, include controller plan changes, self-review and commit. No nested agents, merge/push or issue closure.
- Write task-33-report.md with the data/preference ownership contract, exact bounds and evidence, commit, and native-layout/live-model limitations. Controller independently reviews and publishes.

### Accepted comparison contract

The browser-only comparison uses existing per-journey/per-node UI state and exact full saved-research JSON identity. Only retained comparison nodes are reconciled on observed snapshots; research/source replacement or removal resets preferences and selected details even off-node, while unrelated document metadata and follow-up changes preserve controls, focus and selections. Node navigation retains choices; journey switches, panel reload and canvas restart discard them. No persistence, helper request, refetch or new SDK operation is added.

Compare the 2–4 validated saved options using three built-in criteria (Description, Pros, Cons) plus at most 32 distinct exact, case-sensitive saved detail labels: at most 35 selectable criteria, 140 option cells, 32 individually selectable detail records. All criteria start selected at Normal priority. Labels are not normalized or semantically merged by comparison, and built-in criteria have separate indexed identity from identically named detail labels. Repeated labels within an option retain every value in original order and use existing option/detail position IDs. Existing bounds remain title150, description3000, pros/cons6x1000 each, details8x{label80,value1000}, proposedAnswer5000; actual validated research/document envelopes remain authoritative.

Low/Normal/High are the only personal priorities; High rows sort first, then Normal, then Low, with saved criterion order breaking ties. They change row order only, not evidence confidence, original recommendation, numerical utility or a winning option. Each populated cell says Model judgment / Cell source support unknown because saved option fields have no validated claim relations. Missing detail values or empty lists say Unknown, never zero. Existing source-linked claims, limitations, read provenance and safe links remain separate and unchanged; no string matching transfers evidence.

Matrix and original option cards share exact selected detail IDs and the existing explicit append-to-draft/undo path, its 20,000-character limit, newer-typing guard and unchanged answer state. Hiding criteria retains selected details, disclosed in the UI. Existing Use recommendation and Use this option remain available. Native semantic table headers, a labeled keyboard-focusable contained horizontal scroll region and native controls provide access without replacing answer/follow-up editors. No visual/native layout proof is claimed from jsdom.

Published task 33: **v0.1.45**, `ac03c74`, required checks and option comparison evidence retained; independent review approved and remote main verified.

## Task 34: Deliberate challenge review (#31 / original40)

Read issue-40.md, task-34-design-notes.md, AGENTS.md and the final answer-check, context-preview and claim-evidence reports. BASE is `ac03c74d30e33fa46f4b283efe88f4a81d706394`; ship version **0.1.46**. Reconcile the current answer-check lifecycle, reviewed context and claim/source contracts before implementation. Preserve actual-release ownership, retained usage, source freshness and explicit user commitment. Propose the concrete bounded scope, tool choice and reused seam before broad edits.

### Behavior

- Add an explicit challenge action over selected committed decisions with visible scope and bounded owned SDK work. This is a deliberate review action, distinct from the journey's existing Challenge exploration mode. Do not change the mode or rerun checks automatically.
- Return assumptions, counterarguments, overlooked alternatives and evidence gaps with validated source references to the actual transmitted decisions/guidance. Respect tentative, assumed and needs-review labels. Empty or partially decided contexts must remain truthful about what can be challenged.
- Separate model speculation from existing sourced information and any newly consulted evidence. Reuse the current claim/source provenance contract; a previously consulted source is not a new fetch or proof of semantic truth. Tool-free reasoning must be clearly labeled. If actual new research is provided, it must use the existing bounded research tools/permissions and its appropriate actual-release ownership; never add ambient project access.
- Reuse the answer-check lifecycle, source navigation, transient dismissal and context-preview seams where their behavior is genuinely shared. Do not create a second parallel implementation of the same request state machine or a generic workflow engine. No permanent agent swarm, debate loop, automatic re-challenge until agreement or extra model downloads.
- Treat review results as suggestions only. The user may dismiss, inspect evidence or navigate to an original answer; preserve drafts/caret and committed decisions. Relevant changes invalidate captured results; unrelated saves preserve current findings/dismissals. Keep cancellation, late-result identity checks, explicit retry and retained operation-specific usage.
- Define explicit finding counts, text/source bounds and lifetime before coding, aligned with the existing check/evidence contracts. Explain omitted context and available usage without fabricated prices, precision or confidence percentages.

### Verification and completion

- Test coherent, contradictory, tentative and empty deterministic scenarios; actual included/omitted sources; malformed references/output; relevant/unrelated edits; dismissal and navigation; cancelled/replaced/stale completions; release contention and receipt attribution. Verify no saved decision changes and no attached-chat send.
- Exercise shipped HTTP/jsdom UI and installed local SDK fixtures for actual instructions/tool boundaries, bounds and cleanup. No paid provider, existing user session, real microphone or browser/desktop automation. Live semantic quality and native layout remain explicit manual limits.
- Run npm test/check/package and applicable fixtures, synchronize confirmed patch metadata/release notes/README, include controller plan changes, self-review and commit. No nested agents, merge/push or issue closure.
- Write task-34-report.md with the final scope/tool choice, reused interfaces, bounds, certainty/evidence/freshness rules, exact test evidence and commit. Controller independently reviews and publishes.

### Approved concrete contract

Use the existing ResearchReview frozen context/token seam and the answer-check request, result, dismissal, navigation, freshness and actual-release queue. Add operation `challenge-review`; keep ordinary check categories and tentative-conflict normalization unchanged. Root/guidance are mandatory; saved stateful question records are optional selected records with per-request exclusions. At least one transmitted nonempty saved answer is required; empty/guidance-only selection shows a local explanation and cannot start. Root context is not presented as a settled choice.

No prior research/claims, drafts, private references, project context or new evidence is transmitted/consulted. All findings are explicitly tool-free hypotheses; node/guidance references identify actual user inputs, not citation support. Existing sourced material remains inspectable at the original answer. Categories: assumption, counterargument, alternative, evidence-gap. Limits: 0-12 findings; unique 1-80 ASCII alphanumeric/underscore/hyphen IDs; 1-8 distinct actual node/guidance refs; nonblank explanation and resolution each at most 1000 UTF-16 code units; raw output at most 256 KiB UTF-8; complete input strings at most 131072 UTF-8 bytes. No clipping.

One owned helper with zero tools and the existing 180000-ms operation allowance; shutdown/accounting can continue afterward. Operation-specific Explorer Challenge Review receipts. Preview is one frozen slot, 10-minute TTL, existing 1-MiB response and 512-KiB request limits, up to 5000 distinct exclusion IDs of at most100 code units. Existing sequence/tombstone, purpose and one-shot token rules apply. Start validates current disk and in-memory sources and never reprepares strings. Results/dismissals last in the shared canvas check slot until replacement/close/journey change; relevant observed source changes stale them, unrelated/excluded changes preserve them. No automatic rerun or decision write. Tool-free preview/start work without a web researcher.

Published task 34: **v0.1.46**, `25a935a`, required checks recorded in the task report; independent review approved and remote main verified.

## Task 35: Verify and enforce public-network research fetching (#42 / original56)

Read issue-56.md, task-35-design-notes.md, AGENTS.md and the current installed SDK integration notes. BASE is `25a935ab451dc73375c2021cd1ee4625ae6b52ff`; planned version **0.1.47** was not created for this blocked task. Reconcile the published interfaces against the current implementation before editing. Propose concrete bounds, ownership, freshness and verification seams before broad edits; record the accepted contract in this task and its brief.

### Behavior and boundaries

- First establish the installed fetch implementation's actual connection, redirect, resolver, proxy and credential behavior. Cite inspected declarations/implementation and runtime version. Distinguish verified protections, missing guarantees and facts that cannot be established; do not infer a vulnerability from absent documentation.
- Preserve the installed SDK and account/model/tool/managed-policy isolation. If existing supported controls meet the requirement, use them. If a minimal custom Node fetch is necessary, verify that its network authorization preserves the host's permission and sandbox boundary; custom-tool registration alone is not permission to bypass unavailable or denied web access. Never silently fall back to a less restricted fetch path.
- Validate every actual connection and bounded redirect against public-network-only destinations, including all returned DNS addresses and IPv4/IPv6/mapped variants. Pin the approved destination for the connection while preserving intended hostname and TLS verification. An ambient proxy or alternate transport must not circumvent this contract. Reject unsupported or unverifiable connection paths visibly.
- Bound protocols, URL lengths, DNS results, redirects, elapsed time, incoming/decompressed bytes and output. Declare exact limits before implementation, reconcile existing research depth/tool budgets, and propagate cancellation to actual transport release. Never forward ambient authorization, cookies or proxy credentials.
- Preserve successful-fetch provenance and claim-source associations established by earlier research work. Failed or blocked requests cannot become fetched evidence. Keep error messages useful without exposing restricted destinations or credentials in diagnostic receipts.
- Keep any resolver/transport injection strictly in test seams; no shipped private-host allowlist or unsafe test-mode bypass. Do not expand this task into the next issue's semantic search-disclosure controls.

### Evidence and release

- Use controlled resolver/transport fixtures for public-to-private redirects, mixed DNS answers, rebinding, unusual address forms, loops, excessive bytes/decompression, timeout, cancellation and TLS/hostname/header behavior. Tests must exercise the actual enforcing boundary, not only a helper predicate. Never probe third-party private systems.
- Test denied/unavailable managed network capability and actual custom-tool/builtin identity handling if integration changes. Run the installed local research fixture, npm test/check/package and focused tests; no paid provider, existing session, desktop/browser automation or real user data.
- Document precisely what is enforced in this installed runtime and which host assumptions remain. Synchronize patch metadata/README/release note, self-review and commit; no nested agents, publishing or issue closure.
- Write task-35-report.md with inspected runtime evidence, authorization/connection contract, exact limits, failure and cancellation semantics, test evidence, SHA and any genuine external blocker. Controller reviews and publishes.

### External blocker, independently reviewed

Task35 remains incomplete and issue #42 stays open. Installed runtime 1.0.106-8.unstable.r43566476370.g869eef3 blocks the controlled loopback target and honors tested built-in managed/sandbox denials. Its native implementation and public contract do not establish every required socket, all-answer DNS, redirect, proxy and credential guarantee. A no-network custom override probe receives generic custom-tool authorization and executes despite the tested host restrictions; that authorization cannot safely substitute for built-in URL policy. No supported exact-URL authorization plus pinned-transport capability was found. This is a verification/integration blocker, not a demonstrated vulnerability.

No production changes or release were made for Task35. Existing research remains unchanged. Upstream unblock requires a version-specific verifiable built-in contract/fixture seam or a supported per-destination managed/sandbox authorization capability for a custom pinned transport. Continue other actionable issues without treating this guarantee as delivered; preserve deferred #44 and #49. Evidence: ignored task-35-report.md, final twelve-case no-network probe and independent task-35-blocker-review.md; public issue #42 retains the finding.

## Task 36: Review and enforce public-search disclosure (#41 / original54)

Read issue-54.md, task-36-design-notes.md, AGENTS.md and the published context-preview/fetch contracts. BASE is `25a935ab451dc73375c2021cd1ee4625ae6b52ff`; target version **0.1.47** if completed. Task35/#42 is externally blocked; its full network guarantee is not available. Preserve current host authorization and verified prechecks, and assess whether this issue can be independently completed without weakening its acceptance criteria. Reconcile actual interfaces, inspect runtime argument/logging order with controlled canaries, and propose concrete scope/bounds/ownership before broad edits. If a required boundary is unsupported, report it precisely before implementing a partial substitute.

### Behavior and boundaries

- Let the user mark sensitive names/internal details and review a generalized public-search scope before research starts. Clearly distinguish context sent to Copilot's model from queries and URLs sent to external services. Private marking must not silently rewrite the saved answer or map.
- Define an enforceable, bounded disclosure contract at actual search and fetch tool boundaries. Prefer explicitly reviewed public queries and narrowly defined URL permissions over a claim that arbitrary generated prose can be proven semantically secret-free. The design must explain its exact guarantee and preserve useful research intent.
- Check marked values and obvious normalized/encoded variants at every request, retry and redirect, including URL path/query disclosure. Respect prior network restrictions, tool budgets and permission isolation. Model prompting and tool naming are not enforcement. A disallowed or malformed call must produce a redacted actionable failure rather than silently broadening scope.
- User-approved exceptions must identify the precise disclosure being allowed, apply only to their captured request/scope and be visible before execution. Later jobs, changed source context or stale prepared requests cannot inherit an exception accidentally. Scope changes require fresh explicit start through the existing context-preview contract.
- Retain only the minimum bounded local configuration needed; no secret-bearing diagnostic/tool error strings or new raw request logging. Inspect runtime tool logging behavior before claiming private values are absent. State limitations honestly, including what the model already receives and semantic paraphrases that no simple filter can identify.
- Keep saved answers, draft focus, research source provenance and existing helper cancellation/actual-release ownership intact. No hidden inference on keystrokes, no main-chat research, no additional model downloads or dependency substitution.

### Evidence and release

- Exercise actual tool dispatch for exact, case/whitespace/punctuation/Unicode/encoding variants; multiple values; approved exceptions; malformed requests; retries/tool aliases; search versus fetch URL and redirect disclosure; cancellation and stale captured scope. Canary strings must be absent from rejected outbound calls and retained diagnostic/receipt/error output.
- Use the installed local research fixture and actual HTTP/jsdom review/start flow as applicable. Run npm test/check/package; no paid provider, existing sessions, native UI automation or real sensitive user content.
- Synchronize patch metadata/README/release note, document the boundary and its limits, self-review and commit; no nested agents, publication or issue closure.
- Write task-36-report.md with the actual scope and enforcement API, persistence/privacy choices, precise guarantee, evidence, SHA and owner-only native checks. Controller independently reviews and publishes.

### Blocker and scope decision

Task36 remains incomplete and #41 open. Independent review confirms that original model-generated tool arguments are emitted in native events before the pre-tool callback and later retained in the journal even when denied. Existing hooks and logging settings cannot satisfy the current strict absence-of-marked-text-in-tool-logs criterion. Exact fixed reviewed queries preserve the tested native MCP permission decision and protect outgoing arguments, but arbitrary provider results also enter native journals. The latter is incoming public text persistence, not demonstrated disclosure of user data.

A no-fetch, fixed-reviewed-query mode is a viable narrower direction for outbound privacy; #42 does not automatically block it. It requires an explicit scope decision about local tool-result logs, new provenance/usage ownership design and the full acceptance tests. The owner was offered this scope choice while other actionable work continues. Until changed, retain the original requirement and keep #41 blocked; no partial implementation, version or release was made. Evidence is retained in ignored task-36-report.md and task-36-blocker-review.md with synthetic installed-runtime probes. Existing research is unchanged.

## Task 37: Inspect and manage local storage safely (#43 / original58)

Read issue-58.md, task-37-design-notes.md, AGENTS.md and the published recovery/history/draft contracts. BASE is `25a935ab451dc73375c2021cd1ee4625ae6b52ff`; ship version **0.1.47**. Tasks35/#42 and36/#41 remain open under their documented runtime blockers; this task is independent. Reconcile actual owned storage, locking, recovery and usage interfaces before editing. Propose concrete inventory/retention/deletion bounds, candidate identity, locking and failure semantics before broad edits, then record the accepted contract in this task and its brief.

### Behavior and boundaries

- Inventory only Explorer-owned storage: journeys, library metadata, drafts, history/checkpoints, recovery/staging files, usage receipts and preferences. Report category totals, limits and unreadable/unknown entries honestly. Distinguish logical retained data from physical staging or duplicate accounting; do not follow junctions or scan another plugin/user directory.
- Provide a dry-run cleanup preview and a separate explicit user action. Bind each candidate to identity, observed version/stat and the applicable data-root/lock contract; revalidate immediately before changing it. The preview must state what remains protected and what will be removed. No automatic deletion on opening settings or exceeding a target.
- Preserve active/current journeys, recoverable drafts, live/unknown writer locks, pending write-ahead intents, last recoverable versions, named protected checkpoints and unreconciled usage. Respect the published recovery claims/ownership protocol. Unknown corrupt/temp files are not safe merely because they are old.
- Preserve draft tombstones or introduce and prove an explicit generation/epoch stale-write barrier before pruning them. A late writer must never resurrect discarded text. Retention preferences cannot silently invalidate named checkpoint protection or discard records required to reconcile model usage.
- Resolve canonical owned roots and each target, reject link/junction escapes and avoid computed recursive deletes. Use selective bounded operations; reparse-point and identity changes between preview and action must be handled conservatively. Do not assume a UI preview authorizes an enlarged later candidate set.
- Interrupted or partial cleanup reports exactly which operations succeeded, failed or became ineligible. Retry may reconsider the original explicit candidates safely, not expand scope or hide failures. Preserve usable settings and diagnostics if inventory itself is partial.

### Evidence and release

- Use disposable roots for exact accounting, malformed metadata, protected state, changed candidate identity, outside-root symlink/junction attempts, concurrent writers/recoverers, access failures, interrupted deletion and safe retry. Prove no write outside the allowed root and no late draft resurrection. Never test cleanup on the owner's real data.
- Verify the actual HTTP/UI preview-to-confirm flow, keyboard focus and draft retention with local jsdom. Run npm test/check/package and installed fixtures only if host integration changes; no browser/desktop automation or paid/existing sessions.
- Synchronize patch metadata/README/release note, document retention and irrecoverability of explicitly removed versions, self-review and commit; no nested agents, publication or issue closure.
- Write task-37-report.md with the final storage inventory, deletion/ownership contract, exact limits, failure recovery, tests, SHA and owner-only UI checks. Controller reviews and publishes.

### Accepted Task37 implementation contract

Cleanup is deliberately limited to explicitly previewed old unnamed history snapshots. Inventory covers root journeys and Markdown exports, library metadata, drafts/tombstones, history, recovery/staging/lock evidence, usage and preferences/references. All non-history categories remain protected; no receipt or tombstone pruning, external helper-home traversal, pointer following or recursive deletion. Keep-history choices 5/10/25/50 (default50) are saved preview preferences, never automatic cleanup. Preserve newest-N, undo, every named checkpoint, last recovery, intents and unknown/live/recovery locks; protected entries can exceed the target.

Bounds: 10,000 inventory entries/depth4, 100 issue details, 8MiB manifest metadata, 128KiB per manifest, 2,000 journey identities/64MiB discovery, 500 candidates/256MiB preview validation, independently 256MiB reads per cleanup attempt, 15-minute single captured preview/controller, 1KiB HTTP body/512KiB response. Report file-length apparent/deduplicated bytes using bigint device/inode identities, not allocated blocks; separate manifest-declared logical retained bytes from staging/metadata and flag partial/unreadable/unscanned data. Direct-file mode considers only its loaded journey.

Read-only preview never reconciles history. Confirmation supplies only an opaque server-held ID. Revalidate root/parent/file identities, current document, manifest and protection under the existing document lock (`recover:false`) for each exact candidate. Publish the reduced manifest atomically before selective unlink, repeat protection/ancestry checks and validate newest recovery immediately before unlink. No generic reconciliation broadens removal. Report each observed removed/failed/ineligible/absent result; absence alone means outcome unknown. Exact captured retry retains known successes and failures and never adds candidates. Identity/protection changes preserve files.

Accepted lifecycle limit: preview/outcome ledger is canvas memory, not a durable cross-crash audit. Lost HTTP replies can retry the same controller/TTL. Replacement controller/process invalidates the ID, does not automatically resume and does not expand scope. A fresh preview does not authorize orphan files; published History recovery may separately reconcile validated unreferenced snapshots. Cooperative local-filesystem guarantees and observed junction checks do not claim hostile concurrent ancestor-swap atomicity or power-loss durability. All implementation tests use disposable roots. Task35/#42 and Task36/#41 stay blocked; deferred #44/#49 stay untouched.

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
