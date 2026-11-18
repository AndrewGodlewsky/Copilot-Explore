# Shared comments and explicit discussion resolution

**Issue/spec:** [#49](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/49), assigned to AndrewGodlewsky. Prerequisites #55/#81 are closed. Baseline `6c37f197ad89c2ce5973371413844ac26bfa4685`, Explorer v0.1.97. Follow this plan inline; one independent final review, one issue-sized release commit. The owner has authorized sequential implementation and publication without another approval menu.

## Intended behavior

Share bounded, attributed discussion threads through the existing Project journey file. A comment never answers a question, changes a decision/scenario/ADR, sends a chat message or becomes model context. Resolution describes the discussion only. New replies and changed source answers remain visible as unreviewed context; orphan threads survive node deletion. Suggested wording may be explicitly appended to the normal private answer draft, preserving existing text, then saved through the ordinary consequence workflow.

## Contracts and decisions

- Add optional `comments: {version:1, threads:[...]}` to the document schema. No field or timestamp is added on opening an old file. Maximum 64 threads, 32 messages/thread, 256 messages total and 512 KiB serialized comments. Existing 9 MiB document limit also applies.
- A thread is exactly `{id,nodeId,source,messages,status}`. IDs for threads/messages are lowercase UUIDv4, generated once by the canvas per submission and validated by the server. Exact retries with the same target, IDs and content are no-ops; mismatched reuse is rejected. IDs provide idempotency, never identity or permission. `nodeId` is an exact, well-formed, nonempty bounded legacy node identifier (100 characters). Missing nodes are valid historical orphans.
- `source` is `{question,kind,answerDigest}`: the exact saved question (maximum 4000 characters), effective kind `idea|question|direction`, and `nodeAttributionDigest(node,'answer')`. Comparing all three to the current node yields current/changed; missing node yields orphaned. This is a captured question/answer reference, not proof that the whole branch is unchanged.
- A message is exactly `{id,text,event,suggestion?}`. Text is nonempty, well-formed Unicode, preserved exactly up to 4000 characters. Optional suggested answer text is nonempty and preserved up to 5000 characters. `event` uses #81's strict `{actor,at}` snapshot. No Markdown/HTML interpretation or automatic links. No message edit/delete UI in this issue; history/Git retain saved revisions.
- `status` is exactly `{state,event,messagesDigest}`, with state `open|resolved`. Its digest binds the complete set of messages, canonicalized by message ID; array display order is not trusted chronology. The initial open event belongs to the thread creator. Explicit Resolve/Reopen records the current contributor/time and current message digest. A resolved record whose digest no longer matches is historical and the discussion needs attention; it must not imply newer replies were reviewed.
- Replies require an effectively open thread; explicitly reopen a resolved thread first. Repeating an already-current resolve/open choice is a no-op. Changed source answers remain visibly changed even after resolving discussion; the original source snapshot is not silently refreshed.
- Use the existing protected `api/action` route with new commands `comment-create`, `comment-reply`, `comment-resolve`, `comment-reopen`; strict action-specific inputs, existing journey/revision protection, private actor selection and serialized normal persistence. Shared Project writes only. Personal copies can inspect carried comments and copy/apply wording, but do not silently start a new shared conversation.
- Commands accept only the target, submission IDs, body/suggestion and existing request bindings. They never accept actor IDs, names, timestamps, source digests or status receipts from the client. The server derives those from the current saved source and private contributor setting. New comments do not change `finishedAt`, answer state, answer attribution or stored artifacts.
- A failed post may return a server-derived `commentSubmission` receipt (`absent|present|unknown`) after a fresh read under the existing lock. Only confirmed absence releases frozen submission IDs so rejected text can be corrected. HTTP errors alone never establish non-commit; history finalization can fail after saving. The client validates blank proposed wording and malformed Unicode before retaining submission IDs.
- Expose derived comment context/resolution status in `uiSnapshot`, cached by immutable document identity. No extra endpoint, background service, model tools or runtime dependencies. Native JSON/import/history carries comments; existing decision/model/Markdown/offline-viewer projections omit discussion text unless a future explicit feature adds it.
- Semantic merge operates per thread, combining distinct message IDs. The target/source pair stays atomic. Same-ID divergent message edits or competing status edits require an explicit choice. Resolution versus concurrently added/changed messages is an explicit conflict; preserve the merged messages regardless of the selected status. A selected old resolution remains historical until a new explicit resolve. Never use timestamp last-writer-wins.
- A one-sided external thread deletion requires a visible whole-thread choice; deletion of the target node alone retains the thread as an orphan. Conflicting choices and graph/size fallback retain existing complete source previews and explicit final acknowledgment. The merge UI must display the actual thread/message/status candidates for its new conflict identifiers.
- Scenario forks copy threads attached to retained nodes, remap their node IDs, and preserve message/event IDs and snapshots. Unrelated threads stay in the original journey. A changed alternative answer makes copied discussion context historical; no contributor or resolution is invented for the fork opener.
- UI: a global **Review comments** dialog lists current and orphan threads, with a per-question entry from Answer details. Show original question, current/changed/orphaned source, discussion state, literal attributed messages and explicit Reply/Resolve/Reopen. Compose a new thread on the selected node. Page/filter the bounded thread list; render one thread's messages at a time.
- Suggested wording's explicit **Add to answer draft** action appends to existing private text and keeps the ordinary draft state handling. It cannot overwrite text, save an answer, resolve the thread or start AI work. Reject an append over the answer limit without changing the draft. Missing/non-question targets cannot receive a suggestion.
- Unposted comment drafts remain in the current canvas by journey and thread/new-thread target through polls, close/reopen, navigation, errors and suspension. They are not shared or silently saved as answers. State this scope honestly; durable cross-restart comment drafts are not added to the existing answer-draft store. Existing durable answer drafts and caret are preserved.
- No browser/desktop automation. Native pane, keyboard and multi-installation handoff checks remain owner checks. No accounts, permissions, notifications, real-time service or external messaging.

### Task 1: Strict comment model and source/status semantics

**Files:** new `comments.mjs`, `test/comments.test.mjs`; `model.mjs`, `scenario-fork.mjs` and targeted compatibility tests.

**Interfaces:** `validateComments`, `commentSource`, `commentMessagesDigest`, `commentStatuses`, pure clone-returning `changeComments(document, action, input, event)`; strict input/event/ID validation. Import/validation remains read-only; orphans are valid. Fork explicitly remaps copied thread links.

- [x] Write RED tests for strict shape/version/IDs/Unicode/bounds/duplicate records, legacy absence, immutable source capture, changed/orphan context, explicit open/resolve behavior, stale resolution digests, suggestion separation and fork/import/history round trips.
- [x] Implement the schema and pure mutation/status functions, optional model field and fork projection. Keep saved answers/artifacts and caller objects unchanged.
- [x] Run `node --test test/comments.test.mjs test/shared-document.test.mjs test/scenario-fork.test.mjs`; expected GREEN.

### Task 2: Evidence-preserving semantic merge

**Files:** `comments.mjs` or a small dedicated `comment-merge.mjs`, `semantic-merge.mjs`, `test/comment-merge.test.mjs`, merge candidate UI extraction.

**Interfaces:** comments merge accepts the existing `pick(id,label,base,local,incoming,forced)` conflict callback. Whole-thread choices (including divergent target/source pairs), message IDs and status use `comment-thread`, `comment-message` and `comment-status` conflict IDs. Incompatible targets select one complete thread instead of assigning replies to a different decision. Existing unrelated field/node/order semantics stay intact. Candidate extraction must match these IDs exactly in Task 4.

- [x] Write RED cases for independent threads, concurrent replies, same-ID edits, resolution-versus-new-message conflicts, competing resolutions, external thread deletion and node-only deletion, stale choices, merge limits and literal candidate display.
- [x] Merge distinct messages without silently losing evidence; preserve status provenance and require explicit conflict choices. Do not let an old resolution claim review of merged replies.
- [x] Run `node --test test/comment-merge.test.mjs test/semantic-merge.test.mjs`; expected GREEN. UI candidate cases join Task 4's named gate.

### Task 3: Shared mutation workflow and two-contributor handoff

**Files:** `controller.mjs`, new `test/comment-workflow.test.mjs`; small workflow module only if it gives a useful isolated boundary.

**Interfaces:** the four protected commands validate exact inputs, read the private actor, lock/reread the saved document and commit a cloned comment-only candidate. API revision and final source checks remain authoritative. UI snapshot gets derived current/changed/orphaned and effective discussion status.

- [x] Write RED tests with actual shared storage and two private identities: create/reply/resolve/reopen, clone/pull and merge, stale writes, failed atomic save, corrupt identity settings, unknown actors, hostile client metadata, node deletion, old-file no churn and private/model-context leakage canaries.
- [x] Wire the explicit shared commands and cached UI status. Verify comments never change answers, answer states, scenario preference, accepted artifacts or helper call counts.
- [x] Run `node --test test/comment-workflow.test.mjs test/comments.test.mjs test/comment-merge.test.mjs test/project-journey.test.mjs`; expected GREEN.

### Task 4: Narrow-pane comments, draft transfer and async UI safety

**Files:** `web/index.html`, `web/app.mjs`, isolated `web/comments-client.mjs`, minimal `web/style.css`, `test/web.test.mjs`, focused `test/comments-client.test.mjs`.

**Interfaces:** explicit comment dialog and selected-node entry; per-canvas unposted text keyed by journey/target/thread; literal event labels reuse contributor formatting. Actions capture journey/revision/thread/message identity and ignore late replies after hide/switch/suspend. Saved comments arrive through the normal snapshot/refresh path. Selected thread renderer retains composing text and caret across unrelated updates.

- [x] Write named RED jsdom cases for posting/reply/resolve/reopen, changed/orphan labels, literal names/text/URLs, filters/paging, absent project storage, failed/stale saves, lost/late responses, preserved comment/answer drafts and focus, and explicit suggested wording append with size bounds.
- [x] Add merge conflict candidate UI coverage for thread/message/status choices, preserving both comment text and the current answer draft during review.
- [x] Implement keyboard-accessible controls with explicit draft scope and no implicit model or decision action.
- [x] Run named comment UI and adjacent contributor/drawer/merge UI tests; expected GREEN. Owner native checks remain pending.

### Task 5: Documentation, verification and publication

**Files:** `docs/comments.md`, README, plan records, synchronized version/release metadata.

- [x] Document private/public/draft boundaries, supported mutations, unknown identity and stale-context semantics, merge/conflict/fork behavior, orphan access, limits and compatibility. Bump the next patch (tentatively v0.1.98); release summary at most 400 characters.
- [x] Obtain one independent whole-change read-only review; regrade findings and fix material defects in one RED/GREEN pass. No per-task reviewer or re-review loop.
- [x] Run npm test, npm run check, npm run package and diff checks; installed runtime fixture only if host integration changes. Record actual final results; no paid provider or existing session.
- [ ] Fetch, commit, integrate/push main without force, verify remote commit, comment/close #49 with evidence and owner checks, then continue #82. Final task gate: `npm run check` on the published commit.

## Review focus

Check resolution-versus-reply races and whether all evidence remains visible; partial merge choices and per-thread deletion; source ID remapping and historical fork/orphan semantics; imported malformed Unicode/oversized collections; actual private identity authority and failed-write recovery; comment text leaking into any helper projection; detached/late UI actions, duplicate posts after ambiguous replies, retained private answer/comment drafts and append limits. Distinguish descriptive event names from authentication and discussion resolution from decision approval. The state model must stay small enough to inspect without a generic collaboration framework.

## Final verification before publication

Final complete suite: 1,246/1,246 passed in 559,987.7 ms. Syntax/assets/marketplace/version checks, packaging and diff checks passed. One independent review found two material defects; rejected-post correction and divergent thread targets were reproduced and fixed. Retained proposed wording after an external kind change and the synthetic benchmark import harness were also verified with failing-then-passing tests. No SDK integration changed, so the installed runtime fixture was not rerun. Native narrow-pane/keyboard and two-installation handoff checks remain owner checks. Publication is recorded on issue #49 after remote verification.
