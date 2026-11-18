# Scoped branch restoration implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. One independent final review; no per-task implementer delegation.

**Goal:** Restore a selected historical subtree as a new, undoable revision without reverting unrelated work.

**Spec:** [Issue #73](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/73), following completed #68. Base: `83e76e208f7d0b415c9132ad07bef89294123e85` / 0.1.88.

**Architecture:** Keep graph rules in `model.mjs`, preview coordination in a focused `branch-restoration.mjs`, persistence in the controller's existing locked history boundary, HTTP in `server.mjs`, and the interaction within the existing History dialog. No new saved schema or runtime dependency.

**Tech stack:** Shipped ES modules, Node filesystem/history primitives, native HTML controls, node:test and jsdom with the real local server.

## Global constraints and decisions

- Same journey identity, root, creation time and scenario lineage only. Select a non-root question or direction; whole-map restoration remains a separate existing action.
- Missing parents, incompatible/reused IDs, unsafe dependency combinations and incompatible snapshots block confirmation. Never guess an identity from wording.
- Restore historical internal dependencies. Retain compatible current boundary links and restore compatible historical boundary links. Conflicting explanations, missing endpoints, links to removed boundary nodes or cycles require explicit correction before a fresh preview. Wholly outside links remain unchanged.
- Preserve current global guidance, accepted artifacts and lineage. Preserve every unaffected node at the domain-data level. Only recorded outside dependents of changed content gain review flags. Restored answers retain their certainty; changed outside context marks restored content for review. Restored research is historical/stale because complete captured prerequisites are unavailable.
- Preserve all private current drafts and references; import no historical drafts. Removed references remain visibly unavailable. Draft recovery uses existing stale/orphan rules. ADR associations are explicitly unavailable until implemented.
- Preview is a single bounded, fifteen-minute token tied to the full saved document, immutable snapshot, binding epoch and local references. Page exact changes and conflicts; recheck after asynchronous history preparation before replacing the file.
- Cancel pending question/research work and dismiss staged questions explicitly. No generation, research rerun, source switch, global guidance rollback or private data publication.
- No browser/desktop automation or paid providers. Keep fresh host working-directory authority, atomic writes and current SDK isolation.

## Tasks

- [x] **Model:** Write failing tests in `test/branch-restoration.test.mjs` for replacing an existing subtree, restoring a missing subtree, unrelated-node equality, compatible boundary links, historical research/review, no-op, missing parent, reused IDs, lineage mismatch, dependency conflicts/cycles and deep iterative traversal. Implement `branchRestoration(current, historical, nodeId)` in `model.mjs`. Return the validated candidate, precise node/dependency effects and blocking conflicts without mutating either input. Run the focused file; expected all cases pass after first observing RED.
- [x] **Coordinator and persistence:** Add `BranchRestoration` with strict prepare/page/discard/confirmation contracts. Connect controller lifecycle resets, protected HTTP and a final locked commit guard. Test immutable snapshot freshness, byte/revision changes, navigation A-B-A, local-reference changes, failed writes, undo, stale callbacks and private Project history/drafts. Preview must match committed content; failures preserve originals. Run focused restoration/history tests and the installed fixture when integration changes.
- [x] **History UI:** Add historical branch selection, explicit preview, paged change/conflict inspection, before/after detail and confirmation alongside whole-map restore. Flush drafts before preview/commit; block unresolved manual/reminder edits. Reject stale page/dialog callbacks and retain the connected editor, caret and recovery data. Add failing real HTTP/jsdom workflows for restore/cancel, draft-write failure, intervening edits, missing branches and suspended requests, then make them pass. Native checks remain pending owner verification.
- [x] **Release:** Document behavior and limits in `docs/branch-restoration.md`, link from README, and obtain one independent final review. Fix material findings with RED/GREEN coverage. Synchronize 0.1.89 and release notes, run npm test/check/package, whitespace checks and the installed local-runtime fixture. Publish to main, verify the remote commit and record completion/native checks on #73.

## Shared interfaces / preflight

The model result drives both preview and commit. The coordinator captures the full candidate digest and verifies it again before writing; UI cannot submit an edited candidate. History reads inside the transaction use the service directly, avoiding reentrant controller methods. Reference inspection uses the existing private store directly. Preview source binding resets even when navigation returns to the same file. Existing commit finalization and draft recovery retain their current failure semantics.

## Review focus

- Restoring a missing node must not commandeer a reused identity elsewhere or import another scenario's lineage.
- Boundary dependencies and unaffected-node equality must agree with the preview, including directions and cycles formed only through restored links.
- An asynchronous history/reference read must not permit an obsolete source to pass the final write guard.
- Removed/restored nodes must not revive an old helper request or silently consume current private draft text.
- Narrow History controls, Escape, refresh, page suspension and stale responses must not leave destructive actions enabled for another selection.

Private working notes: `explorer-73-preflight.md` and the session implementation ledger in the task's temporary directory. The issue and this plan are the portable specification.

## Final verification

975/975 tests passed. Check, packaging, whitespace and installed local SDK/runtime fixture passed for 0.1.89. One independent review found reused outside parent/dependency identities; two regressions failed before the compatibility fix and passed afterward, with valid answer/root-guidance changes preserved. No deferred minor findings. Native visual/keyboard/IME checks remain pending owner verification; ADR associations and live research quality are outside this iteration. Publication evidence is recorded on issue #73.
