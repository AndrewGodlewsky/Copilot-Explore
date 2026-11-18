# Asynchronous review comments

Open **Tools → Review comments**, or a node's **More options → Answer details → Review comments on this node**. Start a discussion about the saved question, idea or direction; select an existing discussion to reply. Filters include open/resolved, changed sources and removed sources. Lists show ten discussions per page; the selected discussion shows all its messages.

Posted comments live in the shared Project journey. Commit and push that file, then have a teammate pull it and open it in Explorer. Explorer does not commit, push, fetch, notify people or run a multiplayer service. A personal copy can inspect its carried discussions and use proposed wording, but posting or resolving requires a current shared Project journey. This is asynchronous file collaboration, not simultaneous editing or authenticated accounts.

## Comments, drafts and decisions

The comment box and optional proposed wording are separate from saved answers. They remain in this canvas across polls, navigation, closing/reopening the dialog, failures and page suspension. **Closing the canvas can lose unposted comments.** They are not written to the shared file or the private durable answer-draft store until explicitly posted. Posted names and text are public in the file and its Git history; choose a contributor name in Settings or post anonymously.

Use **Add to answer draft** on proposed wording to append it to the ordinary private answer draft. Existing text is kept. Review a recovered/conflicting answer draft first; an addition beyond 20,000 characters is rejected without changing it. Saving that answer still uses the ordinary answer/state and consequence-review workflow. Copying wording never resolves discussion or accepts an AI suggestion, ADR or decision. A missing or non-question target cannot receive proposed answer wording.

Posted comments are literal text: no HTML, Markdown execution or automatic links. Comments and names are omitted from current model/research prompts, decision Markdown and offline viewer projections. Native JSON, shared imports and history retain them. A comment is never an instruction to a helper. Explicitly copying proposed wording into an answer makes it ordinary user draft text; it enters future decision context only if the user saves the answer.

## Context and resolution

Each thread captures its saved question, node kind and answer/state digest. The interface reports whether those values match, changed, or became an orphan because the node was removed. This compares the captured question and answer, not every downstream or upstream assumption. Resolving a discussion does not update that source snapshot or approve the answer. Removed-node discussions remain available under **Removed source**.

Resolve or reopen explicitly. A resolved thread must be reopened before replying. The resolution records the chosen public contributor, local timestamp and exact message-set digest. If later file merges add or edit a message, the old resolution becomes historical and the discussion needs attention. Reordering messages does not invalidate resolution; timestamps and array order are not a trusted chronology. A new explicit resolution can cover the combined messages while the original source still shows changed.

Contributor snapshots follow [the shared contribution rules](contributors.md). Names are optional and unverified; neither the name nor UUID proves identity or grants permissions. Corrupt private contributor settings block new posts rather than silently guessing an actor. The compact record keeps the latest status; earlier resolution events remain in ordinary history/Git, not an additional activity log.

## Saves, retries and merges

Posting uses the same revision checks, cooperative lock, fresh source checks and atomic save path as other Project edits. Stale or failed saves retain the saved file and composing text. An ambiguous response may mean a post already saved. The canvas retains submission IDs and exact submitted content for **Retry previous post**; an exact retry does not post twice. Newer text typed while waiting is kept separately. A retry with reused IDs but different submitted content is rejected. IDs are correlation keys, not authentication.

Blank proposed wording and malformed text are checked before freezing a submission. After a server rejection, corrected text gets a new submission only when a fresh read under the shared-file lock confirms the original message is absent. A present or unknown result retains the original retry IDs, including errors after a committed save whose history finalization failed. An HTTP error alone is never proof that nothing saved.

The existing shared-file merge combines distinct threads and replies. Conflicting edits to one message, competing resolutions and resolution versus concurrent replies require explicit review. Selecting an older resolution retains the combined messages and cannot claim they were reviewed. A one-sided deletion of an existing thread or message also requires a choice. Deleting only the source node retains an orphan discussion.

If a thread's target or captured source differs between candidates, choose one complete thread; replies are not silently moved between different decisions. The merge interface shows actual thread, message and status candidates, including the messages covered by a status. Whole-source previews remain available. A combined result exceeding limits requires the existing explicit complete-source fallback, rather than truncation. Git/history retain alternatives. No last-writer-wins timestamp rule is used.

Scenario forks copy discussions only for retained path nodes and remap their node links. Message IDs, contributor snapshots and source captures remain unchanged. An alternative answer makes the copied discussion historical. Other discussions stay in the original journey. Imports and restores preserve the records they carry; opening legacy files adds no comment fields or events. Older Explorer versions may reject this optional schema; use a current version for shared discussions.

## Bounds and verification

The optional `comments` v1 object permits 64 threads, 32 messages per thread, 256 total messages and 512 KiB of pretty-serialized discussion data. Each comment is at most 4,000 JavaScript characters and proposed wording at most 5,000; the shared document's 9 MiB limit also applies. Stable thread/message IDs are UUIDv4; existing bounded node IDs remain supported. Unknown fields, duplicate IDs, malformed Unicode, invalid events and excessive collections are rejected. There is no comment edit/delete UI in this iteration; external file changes remain visible during merge review.

Automated checks cover schemas, legacy/import/history/fork preservation, independent replies, resolution conflicts, limits, actual two-contributor file handoffs, stale and failed saves, private-data/prompt boundaries and protected HTTP requests. jsdom covers literal display, paging, proposed-wording transfer, composing/answer draft preservation and late responses. Native rendering, narrow-pane keyboard flow and two installed clients exchanging files through Git remain owner checks. Automated checks do not use browser/desktop automation or a paid model.
