# Restoring one historical branch

Open **History**, select a retained revision, then choose a **Historical branch** and **Preview branch restoration**. The branch can be a question or structural direction that still exists or has been removed. The root uses the separate **Restore whole version** action.

The preview lists exact node and dependency changes in pages of fifty. Select a row to inspect its complete before/after content. It reports restored and removed nodes, review flags, historical research, affected accepted artifacts and removed private references. Conflicts disable **Restore this branch**. Cancel preserves the saved map and private drafts.

Confirmation replaces that historical subtree, including its selected node, as one new revision. Later sibling answers and other unaffected node data remain unchanged. Current journey identity, creation time, global guidance, pinned constraints, scenario lineage and accepted briefs/handoffs remain current. A successful change clears the finished marker. No questions, research or ADRs are generated automatically.

## Identity, dependencies and historical evidence

The snapshot must belong to the same journey identity, root, creation time and recorded scenario lineage. Restored IDs remain stable. A missing parent, an ID now used outside the branch, or an existing ID with incompatible parent, kind or question wording blocks restoration. Explorer does not guess whether a reused ID names the same decision. Restore a missing parent branch first, select a compatible revision, resolve the map separately, or use the existing whole-map restore when appropriate.

The retained non-root parent and historical dependency endpoints outside the branch must also keep their parent, kind and question identity. Changed answers are allowed and trigger context review; a moved or repurposed endpoint cannot inherit an old relationship. The root can keep its current topic and guidance.

Historical internal dependency links return with the branch. Current boundary links survive when both endpoints remain valid; compatible historical boundary links return too. Wholly outside links stay unchanged. Conflicting explanations, missing historical endpoints, current boundary links to removed nodes and directed dependency cycles block confirmation. Correct the current link explicitly or restore the missing endpoint, then preview again. There is no automatic conflict winner.

Changed outside context marks restored content for review while preserving its saved answer state: an assumption never becomes a decided answer. Restored research remains historical/stale because older results do not retain complete captured prerequisites. Recorded outside dependents of changed nodes or links gain review flags; unrelated nodes are preserved exactly. Accepted artifacts remain stored and their existing source checks can mark them stale. ADR associations are not yet implemented, so no ADR impact is inferred.

## Drafts, requests and undo

The current private answer drafts must flush before preview and again before confirmation. Resolve manual-question/direction and reminder edits first. No private historical draft is imported. Surviving drafts whose bases changed require the existing recovery choice; removed-node drafts remain in orphan recovery. Private reference selections stay saved and display an unavailable source when a referenced node is removed. Restoring that source never applies its draft automatically over a changed base.

Cancel pending question/research work and dismiss staged questions before restoring. Question cancellation invalidates its callback without stopping the attached chat turn. Other owned results retain their existing stale-source checks. Restoration never revives a cancelled request even when its node ID returns.

The normal history commit protocol stores the current map as an undo preimage. **Undo** can restore that preimage as another revision. The selected historical snapshot is never edited; ordinary retention still applies after the new commit. Existing fifty-revision/128 MiB and checkpoint bounds remain unchanged. Unlike branch restart, scoped restoration does not add another named checkpoint.

Preview is private and expires after fifteen minutes. It binds the saved map, snapshot hash, source binding, active work and private reference selection. Navigation, changed sources and invalid pages reject the old token. Confirmation revalidates the immutable source and current map after asynchronous history preparation, immediately before the normal save boundary. The UI also invalidates changed draft input and ignores responses from closed or suspended pages.

A precommit failure preserves the current file. A post-commit history-finalization error uses the existing **Map saved, but history finalization failed** recovery behavior; inspect the current map before retrying. A lost HTTP response may represent a successful save and is never replayed automatically. If the page remains open, confirmation stays visibly in flight until its request completes. Refresh the saved history after an uncertain result.

## Project journeys and interfaces

Project restoration changes only the shared map through its existing checkout and byte-conflict protections. Snapshots, undo history, drafts, references and preview tokens remain private to that checkout's local storage. Teammates receive the resulting map through the normal Git workflow, not this local history. No Git commit, push, fetch or remote request is performed by the feature.

- `branchRestoration(current, historical, nodeId)` validates both documents and returns a candidate with precise changes, or blocking conflicts with no candidate. Neither input is mutated.
- `Explorer.branchRestoreRequest` accepts strict `prepare`, `page` and `discard` inputs through protected `POST api/branch-restore` (2 KiB request cap). Prepare selects `journey`, current `revision`, `snapshotRevision` and `nodeId`; page selects `token`, `page` and an optional global `selected` row index (`null` uses the page's first row). Responses return at most fifty row labels and one exact detail. No edited candidate is accepted from the client.
- `command('restore-branch', { journey, revision, token, confirm: true })` uses the existing serialized document lock and commit protocol. It compares the rederived candidate to the inspected result. It does not reconcile history while an active commit intent is staged; it rechecks the immutable snapshot directly.

Focused model, controller, Project-history and HTTP/jsdom tests cover replacement, missing subtrees, dependency/identity conflicts, immutable snapshots, final-boundary writes, undo, draft recovery, cancelled callbacks, paging, cancel and page resume. Native narrow-pane layout, keyboard/screen-reader behavior, themes and IME remain pending owner verification. No browser/desktop automation is used.
