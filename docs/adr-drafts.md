# Reviewed ADR drafts

Choose **Tools → ADR draft** after saving a current ADR scope. **Review saved ADR input** shows the exact instructions and saved input. Generate only after reviewing it, edit the proposed title and statements, and choose **Accept draft wording** to retain the draft in the exploration.

The ADR status stays **proposed**. Accepting generated wording records a review of that wording; it does not approve the architectural decision, change source answers or scenario preference, or write a repository file. [Readiness checks](adr-readiness.md) explain blockers and advisory gaps before wording acceptance. Project Markdown writing, durable source navigation and formal lifecycle transitions are separate work.

## Inputs and uncertainty

The helper receives the selected saved records, mandatory global guidance and constraints, current scenario description, optionally included recorded research evidence, and the validated template layout. It receives neither unselected records nor implicit ancestors, private answer drafts, visual references, project excerpts/file references/snapshots, previous artifacts, research recommendations or follow-up prose. Template paths, example text and instructions are excluded. No new project or web read occurs. Stored repository template structure is a saved preference; refreshing the actual template remains an explicit ADR format operation.

The prompt preserves tentative answers, assumptions, unresolved choices and review flags. Missing rationale, alternatives, rejection reasons and consequences remain unknown or unspecified. A question's generated rationale is not the user's reason for choosing an answer. Recorded research remains prior AI interpretation with its original source relationships, limitations and retrieval provenance. Consultation alone does not establish support.

References resolve only against transmitted node IDs, global guidance fields or recorded evidence source IDs. Structural checks downgrade unsupported `user-decision` labels when references are not exclusively settled, non-review decided answers. These checks do not establish semantic accuracy. The user must review the model's synthesis.

## Template and editing behavior

The artifact has seven bounded statement sections: context, drivers, alternatives, outcome, consequences, confirmation and option details. Only sections supported by the selected template may contain statements. Omitted sections are shown as unspecified; nonempty generated content in an omitted section is rejected rather than discarded. Choose a fuller template when those sections are needed. Dates and people remain unspecified, and source mappings supply references for later rendering.

Text edits preserve exact Unicode and original source mappings. Title and statement edit flags distinguish user wording from the generated proposal; edited wording is not automatically verified against its references. Status, source IDs and captured provenance cannot be edited through this acceptance action.

Accepting wording makes its editors read-only immediately while retaining selection and copying. If the response is lost, they remain read-only until polling or **Refresh** confirms the save outcome. An unsaved proposal then becomes editable again with its wording intact; a saved draft shows the accepted wording. The answer editor remains independent.

Polling retains connected title and statement editors. If inputs change, the proposal becomes stale and cannot be accepted; manual wording remains available for copying. Reviewing new input does not replace it. A new generated proposal replaces the old text only after the user explicitly starts another generation and a valid result arrives. **Discard proposal / cancel** clears the transient proposal and stops its owned helper. **Close** hides the draft and invalidates its input-review token; it retains the proposal. Page suspension, journey changes and switching artifact type discard the transient request. Answer drafts remain independent.

## Ownership, persistence and limits

Generation uses the existing owned, isolated tool-free helper and its shared artifact queue. It verifies account/model/workspace identity and exactly zero initialized tools, denies permission/tool requests, preserves actual-release cancellation checks, and retains **Explorer ADR Draft** usage receipts. The parent chat is not sent a draft-generation request or switched to another model. Native SDK journals may retain model input/output; this feature does not claim the unresolved native-log privacy or web-transport guarantees in #41/#42.

Saved scope, selected records/evidence, global guidance, format and scenario are checked at review, start, dispatch, completion, polling and acceptance. ADR checks reread disk after asynchronous policy validation. Acceptance also checks the complete destination base under the existing writer lock so an unrelated external edit during the final await is not overwritten. Unselected answer edits do not by themselves invalidate a draft. A format or scope change requires another review even if answer text is unchanged.

Accepted wording is stored as version-1 `adrDraft` data in the full exploration JSON, with `acceptedAt` as a wording-review receipt, proposed status, captured source states/fingerprints, scope, format, guidance and recorded evidence. Personal/shared serialization, history and imports preserve the artifact. Imports downgrade recorded source reads to imported provenance. Removed sources remain historical references and make freshness stale. Standalone ADR Markdown writing/export is not part of this step.

| Boundary | Limit |
| --- | --- |
| Saved selected records | Existing 1–100 ADR scope records |
| Exact instructions plus prompt | 128 KiB UTF-8, with no silent truncation |
| Raw model output | Strict JSON, 256 KiB UTF-8 |
| Title | 1–200 UTF-16 units, single line |
| Statements | Seven sections, at most five per section; 1,000 UTF-16 units each |
| Statement references | At most eight unique transmitted references |
| Accepted artifact / full exploration | 512 KiB / existing 9 MiB |

Deterministic contract, HTTP, helper and jsdom tests cover these boundaries. `npm run e2e:adr` uses the installed paired SDK/runtime with an anonymous local model fixture to check exact input, zero tools, output parsing, usage attribution, cancellation and release. These checks do not prove live model usefulness or native rendering. Native narrow-pane, keyboard, screen-reader, theme and IME checks remain owner-performed; no browser/desktop automation was used.
