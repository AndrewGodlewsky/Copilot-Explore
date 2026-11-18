# Portable journey and question references

Choose **Copy portable reference** in the selected node's Answer details to share an exact saved location. Copying requires a shared Project journey; save and open a Project copy first for a Personal journey. A reference targets the selected idea, question or user direction. It contains its repository-relative `.explore.json` location, stable journey/node IDs and a saved-target fingerprint. It omits raw answers, private drafts, project excerpts, local absolute paths, instance tokens, session bindings and authentication details. This is a field allowlist: a user-chosen file name or ID is retained literally.

The copy dialog shows the complete text. If desktop clipboard access fails, select the read-only text and copy it manually. Paste the Markdown block into an issue, PR or document. The readable JSON and relative location remain usable without a registered protocol or link service. These references are separate from the private questions pinned as AI context.

In another checkout, start `/explore` and choose **Open a shared reference** on the welcome screen or **Tools > Open reference**. Paste the whole generated block or its JSON, then choose **Inspect reference**. Inspection reads the exact file under the current attached project's Git checkout, validates the journey and target identity, and displays the saved question and source status. It does not open the map or call a model. Choose **Open reference** to navigate. Folded ancestors are revealed and an incompatible branch focus is cleared.

Source status is one of:

- **Matches:** the selected saved target matches its fingerprint.
- **Changed:** the target still exists, but its saved fields differ. Explicitly acknowledge the change before opening current content.
- **Unchecked:** an otherwise valid reference has no fingerprint. No source match is claimed.

The v1 fingerprint covers journey identity and the selected node's ID, parent, kind, question, category, saved answer/effective state, review flag and review causes. An idea/root target also covers topic, objective, success criteria, mode and pinned constraints. It excludes revision/timestamps, other nodes, research, comments, handoffs, contribution attribution, reminders and accepted artifacts. A match does not verify correctness, research freshness or the entire branch. Ordinary-question references do not fingerprint their ancestors or global guidance.

Opening checks the current map selection, pending work, checkout identity, exact file bytes and target identities again. A file changed after inspection requires another inspection even if the original reference was already acknowledged as changed. Opening never changes answers, shared files or Git state, clones a repository, sends a message, or controls another session. Private local history may be initialized by the normal Project open workflow.

The usual navigation safeguards apply: finish/cancel active question or research work, dismiss question previews, and save or clear missing-direction/reminder edits before switching. Answer drafts must flush successfully first. Failed flushes preserve the editor and block navigation. Same-journey navigation retains scoped discussion/handoff drafts; other journeys retain their separate drafts. Pasted reference text stays in the current canvas across closing/reopening the dialog, but is not durable after the canvas closes. Suspension invalidates pending UI results. If an opening response is lost, already-processed server navigation may have completed; refresh or inspect again. No cancellation claims to undo navigation already processed.

If the file is missing or moved, Explorer keeps the current map and reports it. Locate the moved file through the Project library and create a new reference from its new location. Explorer does not search for similar names, substitute a different node, or scan other repositories. A different journey at the referenced path, removed target, unsupported/malformed file or linked file is rejected. An exact relative path is authoritative; this is not a globally unique repository identifier, and it cannot find an uncommitted file that a teammate has not received.

The wire object is exactly:

```json
{
  "format": "explorer-reference",
  "version": 1,
  "path": ".explorer/journeys/example.explore.json",
  "journeyId": "saved-journey-id",
  "nodeId": "saved-node-id"
}
```

Copy adds optional `fingerprint`, a lowercase SHA-256 string. The generated wrapper has a fixed instruction line and one `explorer-reference` Markdown fence. The parser accepts that wrapper or bare JSON, at most **8 KiB UTF-8**. Unknown fields/versions, malformed Unicode, invalid IDs/digests and other wrappers are rejected. Paths are at most **240 characters**, with forward slashes and existing Project path restrictions: no traversal, external/absolute paths, Git metadata, reserved names or special path syntax. IDs are nonblank trimmed strings up to **100 characters**. Percent escapes are ordinary file-name characters and are never URL-decoded. No embedded text is executed or rendered as HTML.

The installed SDK's `canvas.d.ts` and `extension.d.ts` (runtime `1.0.106-8.unstable.r43566476370.g869eef3`) expose canvas lifecycle/actions but no documented external deep-link route. Explorer therefore adds no custom OS protocol, model navigation action or host routing contract. Copy/paste works in the existing canvas.

Automated coverage uses separate checkout paths and fresh private libraries, exact source/identity failure cases, final asynchronous source changes, protected HTTP routes and jsdom UI/draft/lifecycle tests. Actual desktop narrow-pane layout, keyboard focus/scrolling, clipboard success/manual selection and fresh-canvas navigation remain owner checks. No browser or desktop automation was performed.
