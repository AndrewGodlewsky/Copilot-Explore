# Finding and reopening project journeys

Open **Library**, choose **Current project**, and refresh the exploration folder. The default is `.explorer/journeys`; enter another repository-relative folder to inspect it explicitly. The list shows topics, relative file locations, question counts, private pins and recent openings. **Personal** retains the existing personal-library filters and saved-question search.

Only direct `.explore.json` children of the selected folder are read. Explorer does not search the repository recursively, inspect unrelated source files, browse remote repositories or run a model. A clean clone containing shared files needs no original author's data, credentials, chat/session IDs or private bindings. Open attaches the selected content to the current user's current canvas; question generation remains an explicit subsequent operation in that attached session.

Unreadable, malformed, linked, oversized and unsupported files get individual errors; other valid entries remain visible. Files sharing a valid journey ID are shown separately and marked duplicate, even when their content is identical. Resolve duplicate identities before opening them from the list: there must be one authoritative file for that identity in the selected folder. No file is silently deleted, merged or chosen over another. This check is limited to the selected folder, not the entire repository.

## Bounds, freshness and private metadata

Discovery examines at most 1,000 directory entries, 100 shared files and 64 MiB of document bytes per refresh. Each document also has the shared format's 9 MiB bound. Status shows examined/discovered counts, coverage and limits. If a limit prevents complete discovery, readable summaries are still shown but opening/pinning from that incomplete list is disabled; choose a smaller folder. Subfolders are never implicitly traversed. A missing folder is empty; an unavailable or changed repository/folder produces an explicit refresh error.

The listing captures checkout/folder identities, directory names, file identity/size/time signatures, and each readable file's raw content digest. Refresh uses fresh attached-session metadata. Opening or pinning revalidates that authority and rejects a replaced checkout, changed folder inventory, stale file, duplicate identity, expired listing or changed private metadata revision. Existing shared-content/history reconciliation rules still apply; external Git reconciliation remains #58.

`ProjectLibrary` reuses the personal Library's metadata format and locked metadata updates, but stores them under the checkout-specific private `projects/<checkout identity>/library` directory. Keys include relative path and journey ID. Pins, recent opening times and hashed current-user attachment bindings never enter shared files. A different clone/worktree has independent metadata. Corrupt private metadata is preserved and reported; restore it before opening/pinning through that list. Source files remain available for inspection.

Resume is explicit through the list or relative-path opening. Project attachment records are private audit/resume metadata; they do not automatically select a journey when the native canvas opens. Existing personal bindings retain their behavior. The folder field belongs to the current panel; it is not a tracked repository configuration or a cross-project index.

The controller serializes discovery, metadata edits and opening with other user actions. Refresh/pin never replace the active map or reset its draft client. Opening uses the existing draft-flush, pending request and unsaved-preview guards. Returning to the map, changing the folder/library scope or suspending the page invalidates pending listing responses. No imported field selects a session or changes a model.

## Verification

Behavioral fixtures cover mixed file validity, duplicate IDs, oversized/future files, nonrecursive bounds, linked/missing folders, stale content/checkout, independent clean-clone metadata and retained drafts. DOM/HTTP coverage exercises refresh, pinning and listed opening. The installed SDK fixture verifies discovery/open on the current canvas without new model requests. Native narrow-pane appearance and keyboard checks remain pending for the owner; no browser/desktop automation or paid provider is used.
