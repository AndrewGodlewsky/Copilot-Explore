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

- [ ] Add focused failing tests: legacy discovery; create two journeys; reopen from a different canvas/session; same-file simultaneous writers; pin/archive/recent/search; malformed/oversized files; safe entry resolution; duplicate import identical versus divergent; metadata conflicts; preservation of unsaved drafts and pending callbacks during switching.
- [ ] Run the focused tests and record meaningful RED output.
- [ ] Implement the library service and controller lifecycle, then HTTP/UI wiring, preserving existing behaviors.
- [ ] Extend the local installed-SDK fixture to create a journey in one canvas and reopen it in another without using paid inference or another existing user session.
- [ ] Run focused tests as needed, then `npm test`, `npm run check`, `npm run e2e` with the specified installed runtime variables, and `npm run package`. Run research fixture only if research integration changes materially.
- [ ] Update README usage, a short durable library architecture note, current version/release notes, and commit. Use the preceding issue's release procedure. Do not merge or push.
- [ ] Self-review and write `.superpowers/sdd/2026-11-17-selected-roadmap/task-2-report.md` with tests/RED/GREEN, commit, chosen APIs/storage contracts, and honest native-UI limitations. Return a concise status/commit/test summary.

Do not spawn subagents. No browser/desktop automation. The controller supplies the independent reviewer. Raise concrete architecture conflicts to the controller, not the user; keep working on independent parts.

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
