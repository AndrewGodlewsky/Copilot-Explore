# Local storage and explicit history cleanup

Open **Map settings → Local storage**, or **Local storage** on the library/welcome screen, including when a damaged bound journey cannot load. Inventory, preview, preference saving and removal are separate actions. Nothing is deleted by opening settings, refreshing, exceeding a target or saving a preference. Other settings and diagnostics remain available when storage inspection is partial.

Cleanup intentionally manages only old unnamed history snapshots. All journey JSON and Markdown files, library metadata, recoverable drafts and clear-marker tombstones, usage receipts, recovery evidence, unknown files and preferences remain protected. Archive remains a reversible library operation, not deletion. Usage records have no trustworthy discard/reconciliation watermark yet, so even terminal helper records are retained. Temporary helper homes outside the owned root and legacy recovery-pointer targets are never followed or inventoried.

## Owned inventory and accounting

| Category | Owned location | Cleanup policy |
|---|---|---|
| Journeys | Root `*.explore.json` | Always preserve, including active and archived journeys |
| Saved Markdown | Root `*.md`, including Finish siblings | Always preserve; classification does not validate content |
| Library metadata | `library.json` | Preserve pins, archive state and bindings |
| Drafts | `drafts.json` | Preserve every record, including tombstones; 8 MiB / 10,000 records |
| History | `history/<key>/manifest.json` and content-addressed snapshots | Only explicitly previewed eligible snapshots |
| Recovery/staging | `intent.json`, `.tmp`, `.lock`, `.lock.recover`, `.lock.abandoned`, `usage/recovery-*.json` | Preserve regardless of age |
| Usage | `usage/session-state/<UUID>/` receipts, `workspace.yaml`, `operation.json` | Preserve all accounting and lifecycle evidence |
| Preferences | Voice/navigation/storage settings and `references/<key>.json` | Preserve; explicit revision-checked preference save is separate |
| Unknown | Other root files and files inside recognized directories | Preserve; unknown directory contents are not scanned |

Traversal recognizes only `history/<64-lowercase-hex-key>`, `references`, and `usage/session-state/<UUID>` beneath the configured Explorer root. Linked/nonregular entries and unknown subdirectories are excluded and reported. Every configured-root ancestor and each traversed owned parent must be an actual directory, not a symbolic link/junction. The canonical root and parent identities are checked again on cleanup.

Category `apparentBytes` sums observed file lengths per pathname. `uniqueBytes` deduplicates reliable bigint device/inode identities across the inventory; category attribution belongs to the first encountered path. `duplicateBytes` counts additional hardlink paths. These are **not allocated disk blocks**, compressed/sparse storage measurements or a volume quota. Unknown identities are counted conservatively and flagged. Content-readability and snapshot health are not established merely by successful stat accounting.

`manifestDeclaredHistoryBytes` separately sums entry byte declarations in validated readable manifests. It excludes the live journey, manifests and staging; missing/damaged snapshot content can still make this declaration differ from usable history. The physical-file-length category includes manifests and unreferenced files. Unknown/unreadable/unscanned data is not silently treated as zero: `partial`, bounded issues and incomplete totals are displayed.

## Exact bounds and preferences

Inventory visits at most 10,000 entries, depth four, retaining at most 100 issue details. It reads at most 8 MiB of history manifest metadata; an individual manifest is capped at 128 KiB. Additional subtrees/metadata remain unscanned or logically uncounted with an explicit partial status. Inventory otherwise uses file metadata rather than reading user content.

Library preview discovers at most 2,000 journey identities and reads at most 64 MiB of journey content. Direct-file previews only consider their loaded journey. Normal document validation uses the existing 9 MiB per-file limit. Preview validates at most 256 MiB total across journey, manifest and snapshot reads, then captures at most 500 candidates. Cleanup attempts independently permit at most 256 MiB of reads and cannot add candidates. Budget exhaustion preserves remaining files and reports failure/incomplete coverage. Snapshot limits remain 50 entries / 128 MiB per journey and ten protected checkpoint names; this feature does not change normal history retention.

`storage-settings.json` is at most 4 KiB: `{version:1, revision, keepHistory}`. `keepHistory` is exactly 5, 10, 25 or 50 (default 50). It is a **preview preference**, never an automatic retention scheduler. Saves compare revision under `storage-settings.json.lock`; invalid/unreadable settings are preserved, saving is disabled, and an explicit preview choice remains usable. Default existing lock recovery behavior is unchanged; storage management uses the shared lock's `recover:false` option so it never reclaims, renames or deletes pre-existing writer evidence.

Preview protects the newest N manifest entries, every named checkpoint, the undo preimage and therefore the last/newest recoverable version. Protected entries can exceed N. Existing intents, recovery claims/quarantines, active/unknown locks, corrupt or missing required history, unsafe links and unverifiable identities exclude a journey. Preview is read-only: it does not create directories, acquire/recover locks, reconcile intent, prune orphan files, or alter history. Its response contains exact topic summaries (first 160 characters), journey keys, revision, hash, time and byte count. User text is rendered as text.

## Captured action, failures and recovery

One opaque random preview ID per controller expires after 15 minutes. A new preview replaces the prior captured list. Internal candidates bind the owned root, parent directory identities, journey identity/current file stat, expected manifest bytes/stat and snapshot hash/stat (bigint device/inode and nanosecond times). The client supplies only the ID when confirming; it cannot supply paths or enlarge the set.

For each original candidate, cleanup takes that journey's existing document writer lock without recovery, rereads the active document/manifest and rejects stale content/protection or pending intents. It atomically removes only that entry from the manifest, retaining named entries, newest recovery and undo. It then rereads ownership, manifest and protection, verifies the newest recovery snapshot, rechecks the candidate's exact identity/hash, and unlinks only that exact file. There is no recursive deletion, directory removal, usage pruning, tombstone pruning or general orphan reconciliation.

Manifest publication is the retention commit point. A pre-publication failure leaves the old manifest/snapshot. A post-publication interruption can leave an unreferenced but recoverable snapshot. Successful manifest changes update only this captured preview's expected manifest. Failure of an unlink preserves the exact candidate for explicit retry. A candidate newly referenced/protected or replaced becomes ineligible. A failed lock release is reported separately without misrepresenting a confirmed unlink.

The response retains per-candidate `removed`, `failed`, `ineligible` or `absent` outcomes. `removed` means this controller observed a successful unlink and is never repeated on retry; a newly created file at that old path is left alone. `absent` means the path disappeared after a known manifest removal but deletion outcome is unknown. Absence is never converted into a successful-deletion claim. The UI lists each hash/revision and outcome, including failures and recovery evidence.

The captured list and observed-outcome ledger are **canvas memory**, not a durable audit journal. A lost HTTP response can be retried with the same ID within the same controller/TTL. After canvas/controller/process restart the ID is invalid, no cleanup automatically resumes, and a new preview cannot select unreferenced orphan files. Existing History operations may reconcile validated unreferenced snapshots under their already published recovery contract; that is distinct from resuming storage cleanup. Recovery can inspect validated remaining snapshot files before such reconciliation. The ledger does not promise exact cross-crash deletion attribution.

Removal is irreversible through Explorer once the snapshot is gone. Current journeys, drafts and retained checkpoints are not cloud backups. The shared atomic-write protocol does not promise power-loss durability. These checks cover cooperating writers on a local filesystem and observed identity/link replacements, not a hostile process swapping ancestors atomically between Node path operations or distributed/network-filesystem locking.

## Private HTTP and verification

`POST api/storage` requires the instance-token URL, exact Host, exact write Origin, `X-Explorer-Client: 1` and JSON. The body is capped at 1 KiB and response at 512 KiB. Exact request shapes are `{action:'inspect'}`, `{action:'settings',keepHistory,revision}`, `{action:'preview',keepHistory}`, and `{action:'clean',id}`. Controller transaction serialization coordinates this with journey operations; storage results are not added to ordinary state polling or AI context.

Disposable tests cover exact accounting/hardlinks/unknown subtrees, malformed metadata, preview-only behavior, protected checkpoints/undo/current content, archived journeys, drafts and late tombstone writers, active/unknown locks, intents, access/write failures, changed candidates/roots/junctions, newly referenced snapshots, unpreviewed orphans, lost HTTP replies, unknown unlink outcomes, idempotent retry, expiry and controller replacement. jsdom exercises the shipped HTML/app through the actual HTTP route, keyboard focus and unchanged live/persisted drafts, including a cold damaged journey. No real user storage, native UI automation, paid provider or existing user session is used.

Owner checks remain: inspect long lists and partial/error text in the native narrow pane, keyboard scrolling/Escape/focus, storage entry from the library, and exact unsent editor/IME preservation. Automated tests do not prove native rendering or operating-system power-loss behavior.
