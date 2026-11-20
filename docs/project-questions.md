# Project-aware questions

After approving a [project brief](project-context.md#reviewed-project-brief), choose **Project questions** on the journey root or a direction, or under a question's **More options → Explore** tab. Review the approved claims, saved map context, omissions and exact input strings, then choose **Generate project questions**. Opening the review starts no inference. Current implementation is context for inquiry, not a required future design. Claims retain their file-backed, inference, unknown or user-assertion labels.

The result enters the ordinary editable question preview. Accept only the questions you want. Generated interpretations never supply answers or change answer states. Existing answer drafts, caret and disclosures remain separate. Suggested wording and rationale can reflect the reviewed context and become portable map content if accepted; the raw brief, file excerpts, supporting quotes and prompt are not automatically saved with them.

## Ordinary generation and unavailable context

Existing Generate questions, Explore this direction and Explore deeper actions retain attached-session enqueue behavior. They do not include the project brief. **Use ordinary questions** in the project review explicitly selects that path. Ordinary follow-ups retain their existing saved-answer/state prerequisite; the review explains it when the selected question is unanswered. Unsaved text is never sent by fallback.

Off, missing, stale, unknown-only or unavailable project context cannot start project inference. The review explains the failure and offers ordinary generation or **Review project brief**. No failure silently switches execution routes or sends the project brief to attached chat. Changed context requires a new review; no automatic file refresh or model retry runs.

## Request and helper boundary

`project-questions.mjs` projects at most 50 approved claims as ID, section, text and kind, bound to the approved brief revision. It includes all projected claims as required context; supporting file quotes, full excerpts, absolute root and private editor text are excluded. The existing relevance selector adds saved map decisions, uncertainty and child-question coverage. Actual SDK instructions plus prompt are bounded to 128 KiB UTF-8. Exact review reports optional omissions. An unknown-only brief is insufficient; user corrections can provide useful context without becoming file evidence.

The `project-questions` review token is one-use, purpose-specific and expires after ten minutes. Scope/read, Project Brief, Research, Challenge and regeneration tokens cannot substitute for it. The helper uses the selected eligible Copilot chat model, matching account checks, isolated empty working/configuration directories and zero initialized tools. Dedicated Research model settings do not apply. Ambient instructions/skills, repository tools and web retrieval remain disabled. The model provider receives the reviewed inputs and normal Copilot usage applies; tool-free is not offline.

The helper shares the existing tool-free execution queue and confirmed-shutdown barrier. It has the existing 180-second operation allowance; shutdown/accounting can continue afterward. Cancellation stops only this owned helper. Content-free usage receipts are labeled **Explorer Project Questions**. Attached-session native callbacks, including failure callbacks, cannot fulfill this owned request.

Output is strict JSON with one to six questions, category, rationale, importance and importance reason. Unknown keys and answer fields reject; existing question length, duplicate and acceptance limits also apply. The controller stages the result, never commits model output automatically. No new native model-callable acceptance action exists.

## Freshness and retention

Private approval guards bind the brief revision/object, canonical project capture, journey and workspace epoch. Full selected-file/policy freshness is checked before review, before queued dispatch, after the result and before acceptance, including the final asynchronous source check before saving. Saved map contributors and scenario policy are rechecked too. Revoking the brief or disabling scope cancels relevant pending work and makes an existing preview stale. Changed roots, files or map inputs cannot silently produce accepted new questions.

Brief inputs, review tokens, helper work and private source guards remain in canvas memory, outside maps, history, native snapshots and exports. A cancelled helper can retain already sent inputs until shutdown; a stale preview retains its private validation state until dismissal/replacement or canvas close. Native SDK/provider logs may retain inputs (#41), and transport enforcement remains limited (#42). Turning context off prevents future use; it cannot retract already sent inputs.

## Verification

Contract and controller tests cover strict/Unicode output, exact input review, purpose separation, no automatic answers, source changes, revocation, cancellation, queued work, asynchronous approval races and ordinary fallback. Relevance checks include unchanged near-budget inputs and three authored paired examples (software storage, a community workshop and study reminders). These illustrate fewer repeated fact questions and more unresolved choices; they are synthetic examples, not a measured live-model improvement. The actual-answer pilot remains #110.

`node scripts/e2e-answer-check.mjs --project-questions` uses the installed SDK/runtime and an anonymous local model fixture to verify exact strings, zero tools, bounded output, usage and cancellation. HTTP/JSDOM and authorized Brave checks cover review, fallback, keyboard access, layouts and draft retention. These checks do not establish native Copilot rendering, assistive technology behavior or live question usefulness. Claim-reference explanations (#116), additional branch-specific file selection (#115) and richer checkout/refresh differences (#117) remain separate work.
