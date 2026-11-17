# Local answer drafts

`drafts.mjs` owns draft storage; `web/drafts.mjs` owns browser persistence coordination. Draft text and answer-state selection never enter the committed document, canvas snapshot, AI context, document revisions/timestamps, counters or exports until an explicit answer save. Manual-question text is not persisted by this feature.

## Storage

Explorer's data root contains `drafts.json`: `{ version: 1, revision, entries }`. Each new entry has `{ key, nodeId, base, text, answerState, stateSelected, revision, updatedAt }`. `text` preserves exact whitespace and Unicode, up to 20,000 JavaScript characters. `null` is a retained clear marker; an empty string is a real draft, including a state-only edit. `answerState` uses the shared stable state values. Drafts may retain invalid text/state combinations while the user edits; explicit answer saves validate them. `stateSelected` records whether the selector was deliberately chosen, so text-only insertion preserves that choice and an automatic empty default can still become Tentative on later typing. Entry revisions increase from the store's global counter. `updatedAt` is an ISO timestamp.

`draftBase` now hashes `JSON.stringify([question, committedAnswer, effectiveAnswerState])`. `matchesDraftBase` also accepts the old `[question, committedAnswer]` hash only when the record has no state field and the current committed state has the same legacy meaning. Thus old text-only drafts remain recoverable while a newer committed state requires an explicit choice. Old draft text defaults to Tentative when nonempty or Unanswered when empty; absent selection metadata means an automatic default for old text-only drafts and a deliberate selection for state-bearing records. Reads normalize these fields without rewriting the whole store. New writes use the state-aware hash.

The key is the library's stable `activeKey`. Direct-file previews use SHA-256 of canonical `realpath(file) + NUL + document.id`. Divergent files sharing a document ID therefore keep separate drafts. Clear markers prevent delayed writes from resurrecting committed or discarded text. Records for removed questions remain readable and appear in the UI for copying or explicit discard.

`new Drafts(directory)` exposes `list(key)` and `update({ key, nodeId, base, text, answerState?, stateSelected?, revision })`. Updates compare the record revision under an exclusive `drafts.json.lock`, waiting up to approximately one second for another writer, then atomically replace the file through the shared `atomicWrite` helper. The optional `{ matchingText, matchingState }` second argument clears only matching revision/text/state and returns `null` when it no longer matches. `read()`/`write()` validate and persist the complete store. A corrupt/oversized/linked file is preserved and rejected. The root must not be a link; file canonical paths remain confined to it. Limits are 8 MiB and 10,000 records including clear markers. Clearing text frees bytes but does not remove revision markers or free record slots.

After fully exiting Copilot, restore a damaged `drafts.json` from a backup. Remove a stale `drafts.json.lock` only after Copilot fully exits. The current feature has no automatic garbage collection, cloud sync, or backup rotation.

## Controller and HTTP

- `Explorer.readDrafts(journey)` returns `{ journey, entries }`, adding `stale` and `orphaned` flags to each record. `journey` must equal the active library key, or the current document ID in direct-file mode.
- `Explorer.writeDraft({ journey, nodeId, base: { question, answer, answerState? }, text, answerState?, stateSelected?, revision })` validates the active journey and current node, hashes the supplied source base, then returns the stored record. Discarding an existing removed-node record is allowed.
- Both methods run through the controller transaction queue, so a late request cannot write into a different active journey.
- `GET api/drafts?journey=...` and `POST api/drafts` are private local UI endpoints. Both require the instance-token route and exact Host. Writes also require exact Origin, `X-Explorer-Client: 1`, JSON, and a 160 KiB body limit.
- `answer` accepts optional `draftRevision` and `draftJourney`. It commits text and state first, then clears only that exact draft revision, submitted text and state. A clear failure reports that the answer saved but its draft remains; a newer draft is left intact. Document and draft files are deliberately not presented as one atomic transaction.

## Browser API and behavior

`new DraftClient({ fetch, drafts, changed, restored })` uses the existing `Map<nodeId, text>` as editor text, with separate metadata in `entries`. `reset(journey, nodes)` begins recovery; `ready` tracks it. `updateNodes(nodes)` tracks committed base changes; `touch(id)` protects editing/selection/IME during initial reads; `edit(id, text)` schedules a 500 ms debounce. `flush(keepalive = false, onlyId = null)` serializes revision-checked writes. A failed/conflicting node does not stop other nodes from persisting. `retry()` retries initial read failures and pending writes.

`state(id)` reads the current draft state; `selectState(id, state, text)` records a deliberate choice and schedules persistence. `edit(id, text)` preserves deliberate choices during typing, dictation, research additions and undo. State-only changes enter the same drafts map and persistence queue as text changes.

`choose(id, 'recover' | 'keep' | 'discard', node)` explicitly resolves both text and state with revision checks. `discardUnsaved(id, node)` abandons failed in-memory edits without clearing any previously persisted draft. `save(id, operation, currentNode)` captures click-time text and state, flushes, calls `operation(text, draftRevision, draftJourney, answerState)`, and retains later edits to either field. `pending()` supplies close-warning state; `uncommitted()` protects finishing, including state-only edits. Callbacks update the editor only on deliberate recovery/clear and update status separately, preserving normal caret/IME behavior.

Navigation cancels dictation before changing context. Journey switches flush before opening/importing/creating; failed local writes block switching until resolved or explicitly abandoned. Same-base recovery is automatic unless editing began while the read was pending. Stale or conflicting recovery keeps both texts and requires a choice. Draft text is not automatically sent to AI.

Visibility/pagehide/beforeunload attempt best-effort flushing. Small lifecycle writes use fetch keepalive; larger bodies avoid the browser's keepalive quota. Abrupt termination can lose the last debounce window or in-flight write. Wait for **Draft saved locally** when recovery matters. jsdom tests exercise real modules, HTTP, and persistence but do not prove native desktop rendering, close behavior, or actual dictation hardware.
