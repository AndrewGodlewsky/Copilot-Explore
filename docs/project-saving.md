# Saving journeys in a project

Use **Journey details → Save and Git status** for a [read-only local status check](project-git-status.md). Private drafts, saved files, staged changes and local commits are separate states; remote freshness remains unknown.

Use the [standalone validator](validation.md) to check shared files locally or in opt-in CI without starting Copilot.

Choose **Project repository** under Save location when starting an exploration. The default folder is `.explorer/journeys`; another repository-relative folder is allowed. Explorer generates a filename from the journey ID. Journey details shows **Project**, the relative path, and the sharing reminder. **Personal library** remains the default.

Project saves are local filesystem writes. Commit the shared `.explore.json` file through your normal Git workflow so another person receives it when they pull. Explorer does not stage, commit, push, pull or change sessions. Only committed exploration content goes into the file. Drafts, local history/recovery, visual references, preferences, observations, usage receipts and helper recovery records remain private.

Use **Library → Current project** to [find and reopen shared journeys](project-library.md), including in another checkout. **File → Open project journey** also offers explicit relative-path opening. Project selection is not automatically restored when the native canvas reopens; personal library bindings still restore their personal journey. Personal imports stay personal; publishing an existing personal journey is #57. Finishing a project journey saves its finished state; Markdown remains an explicit download, rather than writing a second project file.

## Destination and persistence

`ProjectRepository` obtains fresh `rpc.metadata.snapshot().workingDirectory` through the canvas callback and uses read-only `git rev-parse --show-toplevel`. A session opened in a repository subdirectory resolves to that checkout; a Git worktree resolves to its own root. The installed SDK's `workspacePath` is the session artifact directory and is never a destination. Missing local metadata, Git or repository access produces a visible error; Personal storage remains available.

Paths must be relative, use forward slashes, and exclude traversal, `.git`, Windows special names and ambiguous trailing dots/spaces. Every existing ancestor and document must be regular and unlinked, with a usable filesystem identity. Selected checkout identity and fresh host metadata are rechecked throughout preparation and at write time. Private storage must be outside that checkout. Folder preparation can leave empty directories after failure; it cannot replace an existing document.

`ProjectJourney` writes the [shared format](shared-format.md) under its [private storage context](storage-context.md). The controller uses its already-held private document lock and `saveLocked`; direct adapter callers use queued `save`. Submitted candidates are copied before queueing. Raw content digests prevent stale saves, and local history retains the existing intent/recovery protocol. Failed saves preserve the last committed content; a failure after replacement retains the newer content and recoverable history intent. Portable Node checks detect observed replacement; they do not promise an atomic compare-and-swap against hostile filesystem writers or distributed locking across computers.

External Git edits that do not match local history fail closed, with drafts and saved versions retained. Automatic refresh/reconciliation and conflicts are tracked in #58/#60. Reopening the same shared content in a clean clone gives it independent local history and auxiliary keys. A project journey has no second editable local head document.

Helper receipt destinations are captured at invocation before asynchronous account/model/runtime setup. Later journey switching cannot redirect that operation's receipt or recovery pointer. This changes no tool permissions, research modes or helper isolation settings. User-level voice/navigation preferences remain in the existing private data directory; project history, drafts, references, observations and retention operate in the project context.

## Verification

Repository/controller tests exercise subdirectory and worktree resolution, different clone paths, rejected traversal/links/root replacement, missing metadata/repositories, private draft separation, captured queued candidates and continued edits. Existing project-persistence tests cover stale content, injected write failures and interrupted history finalization. DOM/HTTP tests exercise scope selection, creation, location text and explicit reopening. The installed SDK fixture proves fresh metadata determines the destination, artifact paths are excluded, and changed metadata prevents a save. These fixtures use disposable data and a local model only.

Owner-performed native narrow-pane layout, keyboard flow and actual filesystem permission-denial checks remain pending. Tests inject write failure; running as the owner on Windows is not a reliable simulation of every read-only ACL. No desktop/browser automation or paid provider was used.

Existing personal journeys can use the reviewed [Save a project copy](project-copy.md) flow. It preserves the original and private state and offers an explicit continuation in the shared copy.

Use [Review project changes](project-reconciliation.md) to reconcile an external edit, replacement or Git branch change without overwriting incoming content. Private drafts retain their original source bases.
