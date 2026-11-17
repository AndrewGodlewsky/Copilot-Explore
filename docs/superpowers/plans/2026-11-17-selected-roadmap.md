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

- [ ] RED/GREEN model/controller tests for initial and deeper batches, subset acceptance/all dismissed, optional wording and original provenance, duplicate/invalid edits, exact limits and atomic near-limit failure, source changes/disk staleness, cancellation and late/legacy-shaped callbacks, no-op dismissal and acceptance history.
- [ ] Real HTTP/jsdom tests for preview controls, keyboard/selection, retry, drafts/state/caret, focused/folded parent reveal, polls/restart/journey-switch semantics and unchanged committed exports/context until accepted.
- [ ] Extend and run the installed local canvas runtime fixture for generation staging and explicit acceptance using simulated authorized user commands; no paid provider or existing user session. Run npm test, npm run check and npm run package. Research fixture only if helper context changes.
- [ ] Bump to **0.1.22**, synchronize all release metadata/README/release notes, document temporary-preview/provenance contracts, include controller plan update, self-review and commit. No merge/push/issue closure.
- [ ] Write task-10-report.md in this workspace with APIs/schema, TDD/final command evidence, commit and native limitations. No nested agents or browser/desktop UI automation. Raise concrete conflicts to the controller while continuing independent work.

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
