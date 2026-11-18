# Compare and merge shared exploration decisions

Open a project journey, then choose **File → Compare and merge project journey**. Enter a locally available branch, tag or commit ID, such as `origin/main`. Explorer reads that revision's file at the current journey's relative path and finds a unique Git common ancestor with the current `HEAD`. It does not contact a remote, fetch, stage, commit, switch branches or run a Git merge. Local tracking branches may be stale; use your normal Git workflow to update them first.

The local candidate is the saved project file, including saved changes not yet committed to Git. Unsent answer drafts are separate. Finish pending AI requests/question previews and reconcile external file or branch changes before comparing. Missing, renamed, conflicted or invalid current files remain untouched; preserve the displayed version through **Review project changes** and use **Recovery** or your Git tools. This workflow does not repair conflict-marker files or resolve unrelated repository conflicts.

If a unique supported common-base file is unavailable, or journey identities differ, Explorer shows separate source files for comparison and copying. It never invents a base. **Inspect or copy source files** exposes the original local, incoming and available base JSON. Copying does not save a file; retain a separate file yourself when needed.

## Resolution rules

| Content | Rule |
| --- | --- |
| Same node on both sides | Keep the identical record. |
| One side unchanged from the base | Keep the other side's edit or deletion. |
| Independent edits to different node IDs | Combine them, then validate the whole graph. |
| Both sides change the same node | Require an explicit local/incoming choice. A node is one record: question, answer, answer state, research, provenance, importance, reminder and review flag stay together. No text or AI resolution is invented. |
| Delete versus changed or newly added descendants | Expose choices for the deleted ancestor and affected records; reject missing-parent combinations. |
| Journey guidance, mode, constraints, copy lineage, finish status, accepted brief/handoff | Compare each metadata field as a whole value. Competing edits require an explicit choice. Historical artifact contents/hashes are retained. |
| Node order | Compare relative order of surviving base IDs. Competing reorders require a choice; append unmatched additions deterministically using the chosen order, then remaining base/local/incoming IDs. |
| Invalid combined graph or metadata | Saving stays disabled. Adjust conflicting choices, or explicitly choose one complete original file using the additional graph-conflict choice. That whole-file choice replaces the other merge choices; review the resulting JSON before saving. |
| Unknown future metadata/version | Refuse the unsupported source; never silently discard it. |

Change a conflict's selection and choose **Preview chosen result**. A selector presents one conflict at a time, so large records do not require side-by-side panes. Both candidates and the full sources remain available until resolution. No candidate is selected by default. The result must pass the complete canonical shared validator, including graph and identity rules.

Changing an upstream question, parent relationship, answer or answer state relative to the common base marks descendants for review. Guidance changes conservatively mark every non-root node. The result lists these affected questions/directions and retains their existing answer text. This also catches clean textual merges that change an assumption under somebody else's answer. Review flags are conservative reminders, not judgments that an answer is wrong. Accepted artifacts remain historical; existing freshness checks still apply.

Review the proposed JSON and consequences, select the acknowledgment, then **Save reviewed merge**. Private drafts flush to private storage and retain their original answer bases; changed or removed source questions produce normal stale/orphan draft recovery. Save uses the usual atomic file/history boundary and updates the save timestamp. Git commits and sharing remain your responsibility. The proposed JSON is a content preview; normal canonical formatting and the save timestamp are applied when saving.

## Bounds and recovery

Sources use the existing 9 MiB/5,000-node limits; at most three source documents are compared. Git metadata output is bounded to 64 KiB, blobs to 9 MiB and each Git command to five seconds. Git reads disable optional locks, lazy fetching and replacement objects, use literal paths, strip ambient Git overrides and read raw blobs without filters or text conversion. An internal `GIT_GRAFT_FILE` override points at the operating system's null device, disabling legacy grafts that could otherwise invent a common ancestor. File access checks regular-file and directory identities. No private history, credentials or drafts enter shared content.

A preview lasts 15 minutes and binds the current journey/revision, file bytes and identity, `HEAD`, incoming commit and common-base fingerprints. A changed choice replaces the previous acceptance token. Saving rechecks the sources, including after the final asynchronous read immediately before the normal write. Cancellation invalidates the preview. Closing or suspending the UI ignores late preview responses. A save already submitted may complete after a response timeout or page suspension; inspect the saved map before retrying. Independent Git/filesystem writers cannot participate in an atomic cross-system transaction; the checks detect observed changes, and normal private recovery remains available.

Failed writes preserve the previous file; interrupted history finalization follows the existing recovery path. Automated tests cover semantic cases, supported metadata, real Git divergence, unrelated histories (including legacy grafts), stale refs/bytes, edits during the last Git check for both changed and no-op saves, final-read cancellation, write failures, unchanged index/HEAD, and HTTP/jsdom draft preservation. Native narrow-pane, keyboard and screen-reader verification is pending the owner's manual check; no desktop/browser automation was used.
