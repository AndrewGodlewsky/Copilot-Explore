# Explorer library storage

Personal library behavior is described below. See [project saving](project-saving.md) for shared repository files, explicit reopening, and the private auxiliary-data boundary.

`library.mjs` owns discovery, safe entry resolution, duplicate imports, and library metadata. `controller.mjs` still owns document revisions and the per-document exclusive writer lock. `Explorer({ file, ... })` remains available for tests and preview; production uses `Explorer({ library, binding, ... })`.

The Explorer data root contains the original version-1 `.explore.json` documents. New files use `journey-<sha256(document.id)>.explore.json`; existing root files are discovered and never renamed or removed. Document IDs identify journeys independently of host sessions/canvases. An entry key is SHA-256 of its filename, a NUL separator, and its document ID. The UI receives keys and summaries, never file paths. Different legacy files with the same logical ID remain separate entries; divergent contents are visibly marked as ambiguous.

`Library(directory)` provides:

- `list({ search = '', archived = false })`: returns `{ revision, entries, errors }`. Topic search is case-insensitive. Pinned entries come first, then descending `lastOpenedAt`, falling back to the document's `updatedAt`. Reading does not invent open events. Each unreadable document has an independent error.
- `resolve(key)`: returns `{ key, file, document }` for backend use. Cached filenames avoid scanning all journeys on every save. Every resolution rechecks confinement, file type, byte limit, document validity, and identity. Unknown keys trigger discovery. Symlinks, directory junctions, traversal keys, missing files, and changed IDs are rejected.
- `update(key, { pinned?, archived? }, expectedRevision)`: changes metadata with a global revision check.
- `opened(key, binding)`: records the current opening time and hashed canvas binding, returning the resolved document. `bound(binding)` restores an existing binding, with a fallback for the old 32-character canvas filename hash. A fresh binding has no selected journey.
- `import(document, { asCopy = false })`: validates and preserves a new document's content/identity, reopens an identical known document deterministically, or returns `{ conflict: summaries }` for divergent same-ID files. Explicit copies receive a fresh journey ID, revision zero, current creation/update dates, and no finish date; node IDs and content remain intact. Canonical filename collisions never overwrite a file.

`library.json` has `{ version: 1, revision, entries, bindings }`. Entries are keyed by the opaque library key and hold only `pinned`, `archived`, and `lastOpenedAt`; bindings map a hash of the attachment identifier to an entry key. Metadata updates use `library.json.lock` and atomic replacement. Opening events merge under the lock; user metadata edits reject stale revisions. A corrupt metadata file is preserved, with a visible recovery error; readable documents still appear. Remove stale locks only after Copilot has fully exited.

The controller exposes `activeKey`, and its snapshot adds `library: true` and `activeKey` without adding other journeys. UI commands are `open` with `key`, `library-update` with `key`/`patch`/`metadataRevision`, `start`, and `import` with optional `asCopy`. Import conflict responses add `importConflict: { entries }` without changing the active journey. `GET api/library?search=...&archived=true` is separate from the attached-chat snapshot.

Question requests remain correlated to the currently attached canvas/session and request ID. Switching blocks pending AI requests until cancellation and unsaved manual-question text. Answer drafts flush to the separate revision-checked local store before switching; failures preserve text and block the switch until retried or explicitly discarded. Library navigation cancels voice capture. See [draft recovery](drafts.md). Committed revision history is described in [history and recovery](history.md); forks and dashboard features remain separate.

Discovery parses each root map when listing or checking imports; normal edits revalidate only the selected file. The library is local to this Explorer data directory, with no cloud synchronization. jsdom and the installed-SDK fixture verify behavior; native desktop layout, keyboard flow, and live research quality require manual acceptance.
