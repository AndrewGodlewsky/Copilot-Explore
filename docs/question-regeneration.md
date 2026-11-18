# Replacement follow-up questions

After saving a corrected answer, restarting a branch or finishing its review, open that question's **More options → Explore → Regenerate follow-ups**. The target must be an ordinary saved question with an answer state other than Unanswered and no outstanding review flag. The action uses its committed answer; unsaved text and state stay in the existing editor.

Opening the review performs local preparation only. Inspect the exact Explorer input, optionally select up to fifty current direct child questions as existing coverage, and choose **Generate reviewed follow-ups**. None are selected initially. Selecting a question does not endorse its answer or change its state. Unselected questions remain saved, and questions needing review cannot be selected as coverage. Removed historical questions remain available through History; they are not sent again as context.

The result appears as **Review new follow-up questions**. Select or edit proposed wording, then explicitly accept it through the existing candidate workflow. Acceptance adds nodes; it never deletes, replaces or answers an existing question. Existing sibling and within-batch duplicate rules still apply even to unselected coverage questions. Dismissal changes no saved map content. A stale candidate's retry opens a fresh context review without automatically sending a request.

## Context and its limits

Mandatory input includes the current target, journey guidance and constraints, scenario label when present, explicitly selected coverage questions, and current explicit prerequisites reachable from the target or its ancestors. Dependencies are user assertions, not verified evidence. Traversal is iterative and deduplicated, including when a dependency points back along the navigation tree. Required prerequisites stay included even if they also appear as optional ancestors or path-only scope is selected.

Ancestor and other saved-answer records use the existing whole-record budget and scope controls. A needs-review record retains its question, state and review flag, but its answer text is replaced by an empty string and labeled `answerOmitted: "needs-review"`. Historic research, model rationales and importance explanations are excluded. Current assumptions and tentative answers keep their uncertainty. The exact prompt tells the model not to recover old conclusions from its chat history or another map read.

The 128 KiB limit measures the actual Explorer instruction and prompt strings. Mandatory prerequisites and selected coverage cannot be silently truncated: an oversized selection requires fewer coverage hints or shorter saved context. Optional records may be omitted, with counts shown in the review. Private drafts, visual references, removed history, project excerpts and other scenario files are never read into this payload. Existing preference policy blocks an alternative unless the user explicitly enabled hypothetical work; that source remains labeled conditional.

This guarantees the Explorer-supplied strings, not the attached chat's entire context. The host retains its own conversation and can read the committed map through `get_exploration`; Explorer neither erases that history nor claims to restrict host tools. No separate research helper or retrieval operation is started by regeneration.

## Request and persistence contract

`ResearchReview` accepts the strict `question-regeneration` purpose with `journey`, `nodeId`, `scope`, `excluded`, `retained`, `clientId` and `sequence`. The existing protected `api/research-review` endpoint prepares or cancels one bounded ten-minute token. The request ID is allocated during preparation, so the inspected prompt is exactly the queued prompt. Research settings, project paths and follow-up research fields are rejected for this purpose.

`regenerate-questions` consumes that token with the current journey, node, revision and explicit browser action. Its HTTP action requires the same Origin as the protected review endpoint. It uses the attached session's existing `send({ mode: 'enqueue' })` path and native instance/session callback checks. Full saved-document fingerprint and current scenario policy are checked before dispatch, staging and final acceptance, reading the saved document after the asynchronous policy check. Any saved edit, including dependency or scenario changes, requires a new review. This conservative rule intentionally invalidates even changes outside the transmitted optional context.

Cancelling invalidates Explorer's result; it cannot stop an already queued attached-chat turn. Late errors cannot mark a replacement request's preview stale. Closing, navigation and suspended pages invalidate UI responses through the existing review sequence. Pending requests and staged candidates must be completed or dismissed before another regeneration. Saving an answer, restarting, reaffirming review or opening the context review never starts regeneration automatically. The existing separate **Explore deeper** action retains its explicit save-and-generate behavior.

There is no saved schema change. Preview purpose and context are transient; accepted nodes use existing provenance and normal revision-checked, atomic, undoable persistence. Personal and Project journeys retain the same private draft/history and shared-writer boundaries.

## Verification

Focused tests cover corrected and obsolete claims, prerequisite chains, mandatory budgets, coverage selection, exact inspected/dispatched strings, token purpose, preference and source changes, cancellation, late callbacks, no automatic generation, duplicates and explicit acceptance. HTTP/jsdom workflows preserve the connected editor and caret, reject stale retries, and ignore suspended responses. The installed SDK fixture exercises queued regeneration and native candidate staging using its local model fixture.

Native narrow-pane layout, multiple-selection keyboard behavior, screen-reader labels, themes and IME remain pending owner checks. No paid providers or browser/desktop automation are used, and fixture success does not establish live question quality.
