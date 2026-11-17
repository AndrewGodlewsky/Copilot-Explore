# Local answer drafts

`drafts.mjs` owns draft storage; `web/drafts.mjs` owns browser persistence coordination. Draft text never enters `document.nodes[].answer`, the canvas snapshot, AI context, document revisions/timestamps, or exports until an explicit answer save. Manual-question text is not persisted by this feature.

## Storage

Explorer's data root contains `drafts.json`: `{ version: 1, revision, entries }`. Each entry has `{ key, nodeId, base, text, revision, updatedAt }`. `text` preserves exact whitespace and Unicode, up to 20,000 JavaScript characters. `null` is a retained clear marker; an empty string is a real draft. `base` is SHA-256 of `JSON.stringify([question, committedAnswer])`, centralized in `draftBase`. Entry revisions increase from the store's global counter. `updatedAt` is an ISO timestamp.

The key is the library's stable `activeKey`. Direct-file previews use SHA-256 of canonical `realpath(file) + NUL + document.id`. Divergent files sharing a document ID therefore keep separate drafts. Clear markers prevent delayed writes from resurrecting committed or discarded text. Records for removed questions remain readable and appear in the UI for copying or explicit discard.

`new Drafts(directory)` exposes `list(key)` and `update({ key, nodeId, base, text, revision })`. Updates compare the record revision under an exclusive `drafts.json.lock`, waiting up to approximately one second for another writer, then atomically replace the file through the shared `atomicWrite` helper. The optional `{ matchingText }` second argument clears only a matching revision/text pair and returns `null` when it no longer matches. `read()`/`write()` validate and persist the complete store. A corrupt/oversized/linked file is preserved and rejected. The root must not be a link; file canonical paths remain confined to it. Limits are 8 MiB and 10,000 records including clear markers. Clearing text frees bytes but does not remove revision markers or free record slots.

After fully exiting Copilot, restore a damaged `drafts.json` from a backup. Remove a stale `drafts.json.lock` only after Copilot fully exits. The current feature has no automatic garbage collection, cloud sync, or backup rotation.

## Controller and HTTP

- `Explorer.readDrafts(journey)` returns `{ journey, entries }`, adding `stale` and `orphaned` flags to each record. `journey` must equal the active library key, or the current document ID in direct-file mode.
- `Explorer.writeDraft({ journey, nodeId, base: { question, answer }, text, revision })` validates the active journey and current node, hashes the supplied source base, then returns the stored record. Discarding an existing removed-node record is allowed.
- Both methods run through the controller transaction queue, so a late request cannot write into a different active journey.
- `GET api/drafts?journey=...` and `POST api/drafts` are private local UI endpoints. Both require the instance-token route and exact Host. Writes also require exact Origin, `X-Explorer-Client: 1`, JSON, and a 160 KiB body limit.
- `answer` accepts optional `draftRevision` and `draftJourney`. It commits the answer first, then clears only that exact draft revision and submitted text. A clear failure reports that the answer saved but its draft remains; a newer draft is left intact. Document and draft files are deliberately not presented as one atomic transaction.

## Browser API and behavior

`new DraftClient({ fetch, drafts, changed, restored })` uses the existing `Map<nodeId, text>` as editor text, with separate metadata in `entries`. `reset(journey, nodes)` begins recovery; `ready` tracks it. `updateNodes(nodes)` tracks committed base changes; `touch(id)` protects editing/selection/IME during initial reads; `edit(id, text)` schedules a 500 ms debounce. `flush(keepalive = false, onlyId = null)` serializes revision-checked writes. A failed/conflicting node does not stop other nodes from persisting. `retry()` retries initial read failures and pending writes.

`choose(id, 'recover' | 'keep' | 'discard', node)` explicitly resolves a saved draft with revision checks. `discardUnsaved(id, node)` abandons failed in-memory edits without clearing any previously persisted draft. `save(id, operation, currentNode)` captures click-time text, flushes, invokes the answer command with the draft revision/journey, and retains later typing. `pending()` supplies close-warning state; `uncommitted()` protects finishing. Callbacks update the editor only on deliberate recovery/clear and update status separately, preserving normal caret/IME behavior.

Navigation cancels dictation before changing context. Journey switches flush before opening/importing/creating; failed local writes block switching until resolved or explicitly abandoned. Same-base recovery is automatic unless editing began while the read was pending. Stale or conflicting recovery keeps both texts and requires a choice. Draft text is not automatically sent to AI.

Visibility/pagehide/beforeunload attempt best-effort flushing. Small lifecycle writes use fetch keepalive; larger bodies avoid the browser's keepalive quota. Abrupt termination can lose the last debounce window or in-flight write. Wait for **Draft saved locally** when recovery matters. jsdom tests exercise real modules, HTTP, and persistence but do not prove native desktop rendering, close behavior, or actual dictation hardware.
