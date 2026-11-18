# ADR readiness

**Tools → ADR draft** shows a readiness report for the proposed wording and its saved source capture. It explains correctness blockers separately from advisory gaps. After editing the title or a statement, use **Check readiness** before accepting the wording. A report does not approve a decision or establish architectural quality.

## What the checks establish

Correctness blockers identify missing or changed selected sources, changed guidance, scope, format, included recorded evidence or scenario, a different exploration identity, and invalid references. They prevent acceptance. Acknowledgment cannot waive them.

Advisories describe missing outcome/alternatives, an outcome without a mapped settled decision, unresolved saved answer states, needs-review flags, stale included research, unmapped statements, edited wording and explicit assumptions. A proposed ADR may retain these unknowns. There is no readiness score, automatic research or change to source answers.

The rationale advisory asks the user to check that the outcome explains a recorded reason or explicitly leaves it unknown. Free-form text has no reliable structured rationale indicator: a word such as “because,” a model's explanation of its question, or a populated section does not establish a user rationale. These deterministic checks do not assess semantic accuracy or prove that a source supports a claim.

## Checking, navigating and acknowledging

Each gap links to its saved question, draft section, ADR scope or format where applicable. A removed source is shown as unavailable with its captured question. Opening a question hides the ADR dialog and uses the existing answer editor. Returning retains connected title and statement editors, including manual wording. Saving a corrected answer refreshes the current-source gaps, while the old draft capture remains stale. Explorer does not silently attach old wording to new evidence; use a newly reviewed generation for new source inputs.

Advisory checkboxes are optional. Choosing **Accept draft wording** records the selected judgments with the wording. It keeps the ADR status **proposed** and leaves source states unchanged. Saved drafts display matching recorded acknowledgments; when wording or input differs, the receipt is historical. Independent editing of a saved acknowledgment and collaborator attribution are separate workflow work. The receipt identifies a recorded action, not an authenticated author.

Editing wording invalidates the displayed report and choices immediately. A changed saved snapshot or scenario also clears them conservatively, so an unrelated map update can require another check for an edited draft. Polling an unchanged report preserves its controls. Late responses after edits, source changes, hiding, switching or suspension cannot restore an old report. A failed check leaves manual wording intact and requires retry. The save-time read-only/copyable behavior described in [ADR drafts](adr-drafts.md) still applies.

## Persistence and integration contract

`adr-readiness.mjs` computes a version-1 report with a canonical digest, concrete gap reasons and targets, blocker/advisory counts and matching recorded judgments. The digest binds exact normalized wording/capture and current relevant saved inputs, including review causes and opted-in research staleness. It excludes acceptance timestamps, the receipt, unrelated answers and private drafts. Property reordering in shared serialization does not itself invalidate it. No file, repository or web access occurs in this checker.

An optional `adrDraft.readiness` receipt contains `version: 1`, `reviewedAt`, `digest` and up to 640 unique acknowledgment IDs. Existing artifacts without receipts remain valid. The existing 512 KiB artifact and 9 MiB document limits still apply. Source and statement bounds imply fewer than 640 report items; fixed reason text uses separate targets rather than repeating long question text. Full exploration backups/history preserve historical receipts. Imports that change recorded evidence provenance make those judgments historical; the receipt never claims local retrieval or authenticated authorship.

`api/adr-draft` accepts `action: "readiness"` with its existing request ID/journey and exact title/statement edits, or `edits: null` for the saved artifact. It returns a read-only current report, including for a retained stale proposal. View/poll also returns the base report. Acceptance may supply `{digest, acknowledged}` at top-level `readiness`; the controller always recomputes, validates advisory IDs and rechecks the final disk/scenario state under the writer lock. Older callers without acknowledgments still get correctness checks and a trusted empty receipt. Generated helper output cannot create a user receipt.

ADR Markdown writing/export and formal status transitions remain separate issues. Their implementation must call the same checker against fresh saved inputs immediately before the action; a stored receipt is not authorization to skip validation. Existing full-exploration exports preserve historical reasoning rather than presenting it as a finalized ADR.

Behavioral tests cover pure reports, schema/roundtrip, HTTP and acceptance races, and jsdom editing/navigation/late responses. No SDK session configuration or model prompt changed. Native narrow-pane, keyboard/screen-reader, theme and IME checks remain owner-performed; browser/desktop automation was not used.
