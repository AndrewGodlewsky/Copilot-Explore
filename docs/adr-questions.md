# Questions for ADR reasoning

Choose **Tools → ADR questions** or **ADR questions** in Commands after saving a current [ADR scope](adr-scope.md). Review the focal question, format sections and exact Explorer input, then choose **Generate reviewed ADR questions**. Opening or refreshing the review starts no inference. [ADR format](adr-format.md) supplies stored validated structure; the bundled default is used if no preferences exist. This action never rereads the referenced template or project files.

The attached chat assesses six kinds of missing reasoning: decision drivers, considered options, rejected alternatives and reasons, the chosen or provisional outcome and its reasons, consequences, and conditions for reconsideration. It proposes **zero to three** specific optional questions. This is semantic model assessment, not a deterministic completeness score. A decided answer alone does not prove its reasoning is complete. Existing reasons remain user text; missing reasons remain unknown. A question's AI rationale explains why the question matters and must not be treated as the user's reason for choosing an answer.

The normal preview lets you adjust wording, select questions and explicitly accept them beneath the saved focal question. Acceptance adds unanswered questions; it never supplies answers, approves an ADR or changes existing answer states. Exact case-insensitive duplicates of saved ordinary questions are rejected, including edited acceptance wording. The model receives only the selected records, so an unseen duplicate may need correction or deselection. Semantic paraphrase duplicates still need human judgment. Newly accepted questions are not silently added to the saved ADR scope; select them explicitly when they should inform later work.

An empty result remains a dismissible unsaved preview: the AI found no material gaps in the supplied context. It is **not** proof of readiness, architectural quality or decision approval. No map mutation occurs. Ordinary generation still requires one to six questions; the canvas callback accepts empty arrays only for this ADR operation.

## Supplied input and ownership

The prompt contains current saved focal/supporting records, global user guidance, scenario classification, explicitly opted-in recorded evidence, selected-record revisit reminders, stored template structure and the six inquiry checks. Tentative answers, assumptions, needs-evidence, deferred and needs-review states retain their meaning. Reminder acknowledgment records a review, not resolution. Recorded evidence remains prior interpretation, not independent verification.

Unselected answers and implicit ancestors, drafts, historical question rationales, research summaries/recommendations/follow-up prose, prior artifacts, project excerpts and raw template text are omitted. Template paths/hashes and directory/naming preferences are also omitted. All supplied text is untrusted data. Required input and instructions must fit 128 KiB of actual UTF-8 strings; overflow rejects without truncation. Narrow the saved scope explicitly to recover.

This reuses the attached session's `send({mode:'enqueue'})` and correlated canvas callback. It starts no isolated helper, research, new exploration mode, file write or decision-status change. The attached chat retains its own history and existing host capabilities; the preview describes Explorer-supplied input, not a sandbox around that conversation. Prompts instruct it to use only this scope and perform no research or file edits. Cancellation invalidates the result but cannot stop the attached chat turn.

## Freshness and recovery

One token is bound to its purpose, journey, root, client sequence and ten-minute expiry. The root identifies the review; the focal question identifies the candidate destination. Starting consumes the token once. Current scope/scenario checks and a complete saved-document fingerprint protect dispatch, callback and atomic acceptance. Any saved edit, including scope, format preferences, revisit information or unrelated records, requires another review. This intentionally stricter request fingerprint differs from saved-scope freshness. Scenario preference changes are checked independently even when map bytes stay identical.

Closing, switching journeys, page suspension or replacing a review discards its authority; late UI responses cannot reopen it. A start already delivered may still be pending after closing the dialog or losing its response. Check the global pending request and cancel there before retrying. Stale candidate retry returns to ADR review. **Refresh saved context** rereads the journey and preserves the connected editor. A stale saved scope needs explicit review/save through ADR scope; refresh does not silently change that selection.

No new persisted field is introduced. Accepted questions use existing generation provenance, rationale and importance fields; previews/tokens are transient. Reopening the canvas discards unaccepted candidates, including empty results. Source/session/instance/request changes cannot grant late candidates permission to modify a map.

## Verification limits

Pure tests check complete/incomplete source fixtures, states, omissions, structure, budgets and duplicates. Controller/HTTP tests cover exact delivery, explicit acceptance, zero/bounded output, invalid tokens, source/scenario changes, final asynchronous corrections and strict headers. jsdom covers draft/caret preservation, empty results, stale retry and closed/suspended responses. The installed local SDK fixture covers callback schema behavior, empty ADR versus ordinary results, cross-session rejection and explicit acceptance without a paid provider.

These fixtures do not establish live model question quality or visible desktop rendering. Native narrow-pane, keyboard/screen-reader, theme and IME checks remain pending owner verification; browser/desktop automation was not used.
