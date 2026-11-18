# Local usage dashboard

Open **Usage dashboard** in Explorer. It reads local saved maps and Explorer-owned helper receipts; it does not start AI work or contact an external service. **Refresh from files** starts a new bounded scan. **Continue scan** reads the next page. Filter changes reuse the compact cached result. Other canvases and external file edits require Refresh.

The dashboard is a separate dialog. It keeps the current Map/Outline mode, editor, selection, drafts and camera. Opening it moves keyboard focus into the dialog and cancels active dictation through the existing focus rule. Closing returns focus to its button. Refresh does not focus an answer field. Native desktop layout, IME and microphone behavior still require manual verification.

## What the numbers mean

| View | Source and denominator | Identity and period |
| --- | --- | --- |
| Current map distribution, mean and median | Validated current journey files. Questions exclude the idea root and direction seeds. Each included logical journey has equal weight. | Same logical ID and identical validated JSON count once. Any divergent same-ID group is excluded globally. Dates do not filter current stock. |
| All-node size, depth and branching | All nodes, including ideas/directions. Root depth is zero. Maximum depth is per journey. Branching is total child edges divided by non-leaf nodes across included journeys. | Same current-stock selection and deduplication. These are structural measures, not difficulty or time spent. |
| Saved answer composition | Mutually exclusive effective answer states for saved questions; legacy nonblank answers default to Tentative. | Drafts, including state-only drafts, are excluded. Answered means nonblank saved text; resolved means Decided/Not relevant with no review flag. Answered and resolved overlap and are not additive categories. |
| Observed activity | Newly owned canvas-controller visits and actual committed changes after observation starts. Daily net question delta compares the saved preimage with the committed map. | UTC observation timestamps, inclusive From/Through dates. Events include subsequently archived/deleted journeys. No current-stock archive filtering. Imports and initial creation establish stock, not growth events. Restores are real committed changes. |
| Owned helper outcomes | Retained operation lifecycle files, grouped by the known helper operation. Completed/failed/cancelled are recorded outcomes; active becomes unfinished/unknown. | UTC date of lifecycle `updatedAt`. A helper session is not a human visit; completion does not prove a recommendation was applied. |
| Helper metrics and model breakdown | Retained allowlisted usage receipts only. Every metric shows its own known/missing denominator. Models use the existing validated identifier field, never account or session identity. | UTC receipt timestamps. Deduplication uses source helper session plus accounting usage ID, otherwise session plus event ID. First retained identity wins, matching the existing recorder; accounting sequence is not another billable receipt. |

Identical files with mixed archive flags count as active if any copy is active. If archive metadata cannot be read, filtered current stock is excluded rather than assumed active; **All journeys** can still show identity-deduplicated stock. Deleted files leave current stock. Ambiguous, unavailable and scope-excluded counts remain visible. During a scan, all totals are **provisional**: a later conflicting copy can remove an earlier contribution. The reading interval is shown; this is not an atomic filesystem snapshot.

Token metrics are independent reported fields. Total tokens are never added to input/output, cache, reasoning or tool components. A missing field is **Unknown**, not zero; an overflowing sum is also unknown. Raw recorded **nano AI units** retain complete/partial/unavailable credit-status counts. No dollar price or credit conversion is inferred. Model rows expose missing token/nano-unit counts. Daily graphs show the last 30 observed days in the selected period, with the same rows in accessible tables; each helper metric has its own chart scale. No unobserved days are filled with invented activity.

## Inventory and measurement gaps

The v0.1.60 implementation was based on code/schema/store inventory and deterministic fixtures, without inspecting private user records:

- `model.mjs` stores current documents (5,000 nodes / 9 MiB maximum), revision, imported dates, optional answer state and research. These fields cannot reconstruct historical daily growth, past answer transitions, visits or active time.
- `library.mjs` separates logical document IDs from filename-derived entry keys. `lastOpenedAt` overwrites the previous value; it is not a visit log. Explicit import-as-copy creates another logical identity.
- `web/answer-state.mjs` owns the shared question and resolution predicates. Dashboard aggregation uses those rules directly.
- `history.mjs` retains at most 50 revisions / 128 MiB and up to 10 protected checkpoints. Snapshot row time is document `updatedAt`; imported dates, partial retention and pending intents do not establish observation time. The dashboard does not backfill from snapshots or treat checkpoints as activity.
- `controller.mjs` commits inside the atomic document replacement callback. History finalization can fail afterward. Observation is captured at that real commit boundary, including a committed-then-finalization failure; identical-content reconciliation records no event.
- `research-usage.mjs` retains allowlisted `session.usage_record` rows and separate operation lifecycle metadata under `usage/session-state/<uuid>`. Dashboard reads only those owned files, never native journals, recovery-pointer targets, main-chat totals or prompt/answer/audio records. Missing or deleted old receipt directories cannot be detected, so usage is always **retained-only**, not a lifetime total.
- The installed SDK declarations distinguish reopening an existing `instanceId` from renderer reload. A visit starts once after a new Explorer controller/server obtains canvas ownership. Repeated opens and page reloads reuse it; closing/reopening or recovery after a process crash creates another owner. No end time or duration is inferred.

## Local observation retention and failure behavior

`analytics.json` contains only a version, observation-start/retention/gap counters and bounded events. Events contain an opaque hash key, UTC observation timestamp, visit/commit category and, for commits, numeric question/answered/resolved counts and net question delta. They contain no answer, question, prompt, audio, topic, raw document ID, host/session/account identity or file path. The normal cooperative writer-lock metadata is operational storage, separate from event payloads.

Commit keys hash logical identity, revision and validated committed content. The timestamp is captured once before enqueueing and retained through retries. Observation is asynchronous and cannot reject a saved answer. Successful writes drain their bounded queue; failed writes retry on another observation, dashboard read or close. Writers reread the latest store under the cooperative lock before merging, preserving other controllers' events and counters. Corrupt storage is preserved and reported unavailable.

Limits are **100 pending observations**, **2,000 retained events**, **180 rolling days** and **2 MiB per store**. Appends discard expired/oldest events and retain a cumulative discard count. Reads exclude expired records and report them separately until the next append prunes storage. A retry outside the retention window cannot reappear as fresh activity. Failed attempts are not necessarily lost facts; pending retries, known dropped observations and retention discards are distinct. Counters saturate rather than wrap. A crash between map replacement and recording, or before unsaved failure counters persist, can leave an undetectable gap. The dashboard always discloses this limitation. No historical completeness is claimed.

Storage inventory recognizes observations as a protected category. Existing cleanup remains strictly limited to previewed old unnamed history snapshots; it cannot remove observations or helper receipts. Observation aging/count retention is independent of history cleanup. Usage receipts keep their existing preserve policy with no automatic pruning.

## Resource and freshness bounds

| Operation | Bound |
| --- | --- |
| Current-stock discovery | First 10,000 directory entries in filesystem order, then sort recognized journey filenames; additional entries explicitly unscanned |
| Current-stock page | At most 16 files and a conservative 32 MiB read budget; sequential validated reads, one document at a time; near-9 MiB files typically yield three per page |
| Current-stock cache | Compact numeric/categorical projections only, at most 10,000 discovered entries; no full-document array; no scan on ordinary state polls |
| Helper discovery | First 512 directory entries, including unrecognized entries; recognized UUID directories only |
| Helper reads | 8 MiB per receipt file, 4 KiB lifecycle files, conservative 64 MiB total budget including failed/partial reads; at most 20,000 unique receipts |
| Helper categories and days | At most 32 named model categories plus Unknown/Other; newest 180 matching UTC daily summaries (older matching receipts remain in period totals); charts/tables show newest 30 days |
| Dashboard transport | Authenticated loopback POST, exact write Origin and client header, 1 KiB request / 512 KiB response ceiling; categorical errors omit JSON source contents and private paths |

Same-controller saves, imports, archive edits and observed helper-state changes mark cached data stale. Other writers require explicit Refresh. Cached helper and stock timestamps are shown separately. Linked, replaced, oversized or unreadable files are excluded using bounded storage reads and identity checks; no private parse or I/O message reaches the dashboard. A scan can be partial because of a bound, corruption or concurrent replacement. These exclusions are not zero-usage claims.
