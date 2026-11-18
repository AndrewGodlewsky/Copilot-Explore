# Restarting a branch

In the selected question's Explore drawer, edit the proposed answer/state and choose **Restart branch**. Explorer previews the exact old/new answer, every tree descendant to remove, surviving downstream questions/directions needing review, affected research/artifacts and every dependency link removed. Nodes have 50-item pages, paths 30 steps and links 25 entries per page. Cross-boundary links are explicitly labeled. The selected question and unrelated branches remain saved. Explicit dependency chains do not enlarge the deletion set.

Confirm creates a protected named History checkpoint, then saves the answer and removal as one revision. Outside dependents reachable through the original tree/dependency graph are marked for review with the original saved-base cause, even when the selected answer is unchanged. Links touching removed nodes are removed; other links remain. Surviving research is conservatively flagged for reconsideration because saved results lack complete captured context dependencies. Accepted briefs/handoffs retain historical sources and become stale when their captured inputs disappear. ADR associations remain unavailable until that feature exists.

Keep editing or Escape preserves the exact proposed answer/state and caret. Confirmation binds the restart operation separately from an ordinary answer save, plus the saved map, selected answer/draft, pending/proposed work and current local reference selections. Changed sources reject the old proof without clearing the draft. A leaf can still save a revised answer through this workflow; an identical leaf no-op creates neither checkpoint nor revision.

Before restart, cancel pending question/research requests and dismiss staged question batches with the existing explicit controls. Cancelling questions invalidates their result without stopping the attached chat. Cancelled research belongs only to its isolated helper. Late callbacks cannot commit after cancellation; changed brief/check captures become stale through their existing freshness checks. Restart never generates replacement questions or starts research. Use Explore deeper explicitly afterward.

Private answer drafts must flush successfully before preview. Manual direction and reminder edits must be resolved first. Removed-node answer drafts remain in orphan recovery with their exact text/state. Local reference selections are retained and visibly unavailable until the referenced nodes return; they are not silently redirected or deleted. The selected question remains open after success.

## Recovery and failure behavior

The checkpoint contains the complete pre-change saved map, including descendants, dependencies and saved research. History can inspect and restore it; restore is a new revision under existing freshness and draft-recovery rules. Checkpoints are private, including for shared repository journeys. Other collaborators receive only the resulting shared map; they do not automatically receive this local checkpoint.

The existing History bounds apply: ten named checkpoints, fifty retained revisions and 128 MiB. A full named-checkpoint allowance blocks restart before the map changes. Explicitly remove a checkpoint name in History when appropriate; Explorer never removes protection automatically. Keep external backups for durability beyond the local history protocol.

Failure to create the checkpoint or a precommit save failure leaves the original map intact. A checkpoint created successfully may remain after a later failure; retrying the same still-valid preview reuses that exact checkpoint. Starting a fresh preview creates a different name and may require managing the retained checkpoint. As with ordinary saves, post-commit history-finalization failure reports that the map was saved and preserves both the new map and recovery files for reconciliation. No multi-file filesystem or power-loss atomicity is claimed.

## Verification

Tests cover exact leaf/interior/deep removal, surviving external dependents, checkpoint inspection/restore and failure, separate operation proofs, source/reference freshness, full checkpoint limits, paged HTTP links/Origin checks, cancelled late work, shared/private storage boundaries and drawer cancel/confirm/orphan behavior. Native narrow-pane layout, keyboard/screen reader, themes and IME remain pending owner verification. No browser/desktop automation is used.
