# Generated-question review

Question callbacks stage a temporary proposal. The user accepts selected questions, optionally changing their wording, or dismisses the batch at its parent node. A legacy `{requestId, questions:[{question,category}]}` callback has exactly the same staging behavior. There is no callback that commits proposed nodes.

## Ownership and lifetime

Each canvas controller holds at most one batch, tied to its active journey, parent and pending request ID. Existing native instance/session checks and enqueue-only attached-session delivery remain in force. A cancelled, failed, completed or replaced request cannot stage another batch. Switching journeys, importing, restoring or generating a replacement requires explicitly dismissing the current preview first. Cancelling a pending chat request invalidates its result without stopping the chat turn.

The batch is memory-only and disappears on canvas close/restart. Browser selection and wording edits survive state polls and node navigation in that renderer. Reloading the renderer loses those edits, although the original batch can still be read while its controller lives. No proposal file is written. Dismissal and wording edits change neither document revision nor history. Root dismissal leaves a user-triggered Generate questions button.

`Explorer.snapshot()` remains committed map/pending/error state for native `get_exploration`. `uiSnapshot()` adds `preview: null | {id, journey, nodeId, questions, stale}` only for the authenticated browser API. Generation, research, exports and history read committed nodes, excluding proposals. Native callback success reports `{saved:false, staged:true, candidateCount, message}`.

## Validity and acceptance

Private source capture serializes journey identity and `contextFor`: topic, objective, criteria, ancestor questions/answers/effective states/review flags, existing child questions and saved decisions elsewhere. It contains no draft text and is never placed in provenance or a UI response. Before staging and acceptance, the controller compares both its committed state and the current disk document with that capture. Changed context rejects the result; stale staging clears the pending request, and stale acceptance retains the preview for explicit dismissal/regeneration. Presentation state and checkpoint names do not invalidate it. Another writer's newer document revision still requires an explicit refresh before saving, even if its question context is unchanged.

The browser posts `accept-questions` with `{revision, batchId, selected:[{index,question}]}` or `dismiss-questions` with `{batchId}` to the private `api/action` endpoint. Acceptance requires 1–6 unique valid indices and revalidates normalized wording (1–600 characters), original category (1–60), case-insensitive sibling/selected duplicates, the 5,000-node cap and 9 MiB pretty-JSON document cap. Any failure preserves the current map and proposal. All selected nodes commit together through the existing document lock, disk revision check, atomic save and history protocol, labeled **Questions accepted**. The result includes `acceptedIds` and `acceptedParentId` for local reveal/highlighting. This adds no native model-callable acceptance action.

## Portable provenance

Accepted nodes optionally carry `generation: {requestId, originalQuestion, originalCategory, adjusted}`. Request IDs are nonempty text up to 100 characters; original wording/category use the same 600/60-character limits. Unknown fields are rejected. `adjusted` must be a boolean exactly matching whether normalized accepted wording differs from original wording; category must remain the original category. The field is additive to document format v1, preserved by JSON validation/import/export/history. Legacy nodes omit it. Markdown shows original wording/category and whether the user adjusted it. No full prompt, source context, answers or model transcript is stored in provenance.

## View behavior and verification

Acceptance reveals the new node path through existing fold helpers without opening unrelated folds or switching the selected editor. A static border and an added-question count/link make the result discoverable without animation, including reduced-motion mode. If branch focus hides the destination, the explicit link opens its parent using normal focus navigation. Existing answer drafts, answer states, caret and per-node disclosures remain separate.

Node/controller tests cover staging, subsets, provenance, duplicates, source/disk changes, cancellation, dismissal, atomic limits and history. Real HTTP/jsdom tests cover preview controls, polls, explicit retry, switching guards, narrow-pane structure, drafts and focused/folded reveal. The installed local runtime fixture verifies native staging/exclusion, explicit browser-command acceptance and close/reopen disposal without a paid provider or an existing user session. Native rendering, keyboard feel and live question quality remain manual checks.
