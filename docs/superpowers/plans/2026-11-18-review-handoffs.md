# Branch review handoffs and responsibility

**Issue/spec:** [#82](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/82), assigned to AndrewGodlewsky. Prerequisites #49 and #81 are published and closed. Baseline 921c7ee3f6d21dd0e55e15356418639202061916, Explorer v0.1.98. Execute inline, one independent final review, one patch release. No additional approval menu; the owner authorized sequential implementation and publication.

## Intended behavior and contracts

Create a small, explicit shared request to investigate a whole journey or one branch. Keep the original note and selected unresolved questions, distinguish a requested recipient from a contributor taking responsibility, and record explicit reassign/complete actions. Completion never changes answers, uncertainty, comments, review flags, ADR state or reminders. Nothing sends a notification or creates an external assignment.

- Optional `reviewHandoffs: {version:1, records:[...]}` avoids collision with the existing AI implementation-handoff artifact. Maximum 32 records, 16 transitions per record, 256 transitions total, 256 KiB pretty-serialized metadata, plus the ordinary 9 MiB document limit. Opening legacy files adds nothing.
- Record: `{id,scope,source,unresolved,transitions}`. `scope` is exactly `{kind:'journey'}` or `{kind:'branch',nodeId}`. Stable UUIDv4 record and transition IDs are correlation keys, not contributor identity. `source` is `{version:1,label,digest,nodeCount}`. Unresolved references are at most 24 unique `{nodeId,question}` snapshots selected explicitly from ordinary questions inside the scope; selections need not be automatically inferred from answer state.
- Capture the branch's tree descendants plus ancestor/prerequisite closure; a journey includes every node. Hash identity, global guidance/mode/pins, selected structural IDs, saved question/category/answer/state, review flags/causes, and relevant dependency relationships. Hash each node projection once per document observation. Exclude administrative records, contributor attribution, revisions/timestamps, reminders, research, artifacts and private data. Clearly document this decision-context coverage. Added/removed descendants and changed prerequisite context invalidate the capture. A deleted branch root becomes an accessible orphan; a changed capture stays historical even after completion.
- Keep the original source capture immutable. Reassigning does not silently rewrite the original summary. To summarize changed work, create a new handoff. The interface shows current/changed/orphaned independently from requested/taken/complete.
- Transition: `{id,action,note,event,recipient?}`; first action is `create`, later actions are `take|reassign|complete`. `event` is #81's server-created contributor snapshot/time. Notes preserve exact well-formed Unicode, at most 2000 characters; create requires nonblank text, later notes can be empty. `recipient` is required for create/reassign, either null (unassigned) or a trimmed public display label of at most 96 characters with contributor-name control-character exclusions. No Git/email/account inference or account directory.
- Take is an explicit choice by the current contributor, including honestly unknown identity. Requested recipient never proves acceptance. Once taken, use Reassign before another Take; Complete is allowed from requested/taken. Reassign can reopen a completed record. Complete is unavailable when already complete. Preserve every prior note/event; no transition edit/delete UI. Imported sequence shapes and legal state transitions are validated. Timestamps are display metadata, not ordering authority.
- Strict `review-handoff-create|take|reassign|complete` commands on existing protected `api/action`. Require shared Project storage, current journey/revision, serialized fresh reads and server-owned source/event data. Stable submission IDs allow exact retries even after later transitions; reject ID reuse for different target/action/content. Fresh locked `handoffSubmission: absent|present|unknown` receipts permit correcting rejected submissions only when absence is proven. No HTTP-error-implies-no-commit assumption.
- Merge distinct records; competing edits/transitions to one record require one complete-candidate choice, preserving the alternatives in existing source previews/history. Do not guess event ordering or ownership from timestamps. One-sided deletion and any differing scope/source pair require explicit review. A conflicting transition must not disappear through field-level mixing. Combined limits use existing explicit complete-source fallback.
- Native shared JSON/import/history retains records. Scenario forks omit ownership requests because they target a new alternative; the original keeps them. AI context, decision Markdown and offline viewer projections omit notes. Provide explicit **Copy selected handoff** text export containing just that record and its freshness/identity caveats; native JSON export explains that it includes full shared metadata.
- UI: Tools **Review handoffs** dialog and selected-node entry. Select whole journey or selected branch for a new request, enter optional requested recipient, concise note and explicitly chosen unresolved questions. Review one record's complete transition history with literal text, source freshness and saved unresolved labels. Explicit Take, Reassign and Complete; no dates or scheduling controls. Existing Revisit remains separate.
- Bounded record list/filter/page; unresolved question picker uses a bounded searchable/pageable list rather than silently omitting large branches. Unposted text/selections remain canvas-local by journey/record/scope through polls, hide, navigation, errors and suspension; closing the canvas can lose them. Preserve existing answer/comment drafts and caret. Freeze exact submitted inputs for ambiguous retries, retain newer edits separately, and reject late responses after hide/switch/suspend. Reuse the normal busy/epoch coordination, without introducing a generic workflow framework.

### Task 1: Strict handoff model and context capture

**Files:** new `review-handoffs.mjs`, `test/review-handoffs.test.mjs`; optional schema in `model.mjs`.

**Interfaces:** `validateReviewHandoffs`, `handoffScope`, `handoffCapture`, `handoffStatuses`, immutable `changeReviewHandoffs(doc, action, input, event)`. Validate exact fields, bounded arrays/Unicode/IDs/events, legal transitions and source references. Scope/status calculation uses one graph/projection index per observation.

- [x] Write and observe RED cases for strict schema/limits/legacy absence, clone/import/history/fork behavior, immutable notes, legal actions, unknown/unassigned identity, exact retry/mismatched IDs, changed/orphan source and branch/prerequisite/guidance coverage without self-invalidation.
- [x] Implement the small pure module and optional document field. Prove saved answers/artifacts/reminders/comments and helper/export context stay unchanged.
- [x] Gate: `node --test test/review-handoffs.test.mjs test/shared-document.test.mjs test/scenario-fork.test.mjs`. Expected: GREEN.

### Task 2: Shared commands and conflict review

**Files:** `controller.mjs`, `server.mjs`, `semantic-merge.mjs`; new `test/review-handoff-workflow.test.mjs` and `test/review-handoff-merge.test.mjs`.

**Interfaces:** four strict protected commands and cached `uiSnapshot.reviewHandoffs` status; `handoff-record:<uuid>` complete-candidate merge IDs. Bind server-owned capture/event and exact submission receipts to the existing lock/fresh-save path.

- [x] RED tests with two actual Project stores/private identities: request, pull, take/reassign/complete, absent assignee, orphan, stale revision/external writer, failed save and committed-but-response-failed retry, malformed/forged input, private-draft/prompt canaries, HTTP guards.
- [x] RED merge tests for independent records, concurrent reassignment/completion, unchanged-side extension, deletion, divergent scope/capture, combined limits and complete candidates.
- [x] Implement persistence and explicit merge outcomes; no notification/network/model side effects.
- [x] Gate: `node --test test/review-handoff-workflow.test.mjs test/review-handoff-merge.test.mjs test/review-handoffs.test.mjs test/semantic-merge.test.mjs`. Expected: GREEN.

### Task 3: Explicit narrow-pane handoff workflow

**Files:** new `web/review-handoffs-client.mjs`, `web/app.mjs`, `web/index.html`, minimal `web/style.css`; module allowlist and explicit jsdom/performance harness import lists; focused client and HTTP UI tests.

**Interfaces:** callback-owned current state/action epoch, explicit selection/export, per-canvas draft/submission state and complete merge candidate extraction. Source captions must match the model's actual fingerprint coverage.

- [x] Observe RED tests for create/take/reassign/complete, literal text/unknown recipients, unresolved selection, changed/orphan/historical completed labels, personal inspection, explicit export, draft/caret retention, failed/ambiguous retries, late responses after hide/switch/suspend, filters and large-list paging.
- [x] Implement accessible controls preserving ordinary answer/comment editors. Native visual checks remain owner-only.
- [x] Gate: named handoff UI tests plus adjacent comments/contributor/merge UI cases and `test/perf-baseline.test.mjs`. Expected: GREEN.

### Task 4: Documentation, review and publication

**Files:** `docs/review-handoffs.md`, README/contributor/library links as useful, plan records and synchronized version/release metadata.

- [x] Document scope, identity/ownership, source freshness, merge/retry/export/fork behavior, limits and canvas draft lifetime. Bump next patch after #49, with release summary at most 400 characters.
- [x] One independent read-only whole-change review; reproduce/fix material findings in one RED/GREEN pass. No per-task review or re-review loop.
- [x] Run `npm test`, `npm run check`, `npm run package`, diff checks. Installed e2e only if SDK/host integration changes. Record actual results and pending owner checks.
- [ ] Fetch, commit, integrate/push main, verify exact remote commit, comment/close #82 with evidence, then continue #83. Final task gate: `npm run check` on the published commit.

## Review focus

Review attribution versus requested responsibility; legal imported transition sequences and replay IDs after later actions; same-record concurrent reassign/complete evidence; capture coverage and self-invalidation; preservation of orphan/stale records and prior notes; failed-write versus post-commit error receipts; explicit export and prompt omission; detached/late UI actions and newer draft preservation; large-branch selection completeness and bounded rendering. Confirm no notifications, scheduling, account lookup or automatic decision/review changes.

## Review result

One independent whole-change review found no Critical or Important defects. The Minor anonymous Take-to-Complete summary inconsistency was reproduced with a failing regression test and fixed by distinguishing a recorded Take from nullable contributor identity. All 14 focused client tests passed, including direct completion without a Take and reassignment resetting responsibility. No re-review loop was used. Native visual/keyboard checks remain owner-only.

Final v0.1.99 verification: `npm test` passed all 1,285 tests in 598,388 ms, with no failures or skips. `npm run check`, `npm run package`, the installed-SDK/local-model `npm run e2e`, and `git diff --check` passed. The runtime fixture covers native collaboration-note exclusion and native JSON retention. No paid provider, existing user session or browser/desktop automation was used. Publication and its exact remote commit are recorded in the issue completion comment after the release commit exists.
