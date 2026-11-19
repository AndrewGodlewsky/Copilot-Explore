# Reviewed ADR scope

Choose **Tools → ADR scope** or find **ADR scope** in Commands. Choose one ordinary question as the focal decision, then select supporting saved questions or user directions from any branch. The focal question is required. **Add focal question's ancestors** and **Add focal question's branch** explicitly select those records; opening the dialog never expands a selection automatically. The root is represented by global guidance, not an implicit selected record.

Unanswered, tentative, needs-evidence and needs-review questions remain selectable with their saved states shown. Selecting or saving them does not answer, approve, verify or reaffirm anything. Topic, objective, success criteria, mode and all pinned user constraints are mandatory and visible in the preview. Global guidance is user intent, not evidence that its statements are correct.

Recorded research sources and structured claims are optional and start excluded for a new scope. When included, their IDs, URLs, retrieval provenance, limitations and recorded claim-support relationships remain visible. Research summaries, recommendations, proposed answers and follow-up prose are excluded. No new web reads occur.

## Exact review and saving

**Preview exact ADR scope input** displays the actual instructions and JSON projection. It contains exactly the focal/supporting records selected, mandatory guidance, current scenario label and any explicitly included recorded evidence. It reports included/omitted record counts and actual UTF-8 string bytes. All selected records are required: more than 100 records or more than 128 KiB of instructions/input is rejected without truncating content. Selection controls remain editable after an error.

Unselected questions/answers, implicit ancestors, answer drafts, private references, project-file excerpts/captures, previous accepted briefs/handoffs and other synthesized artifacts are omitted. The complete saved-map JSON/Markdown exports still contain the whole saved map under their existing contract; the new scope appendix is only a source reference, not a filtered map export.

**Save reviewed scope** stores one current scope reference in the active Personal or Project journey. Replacing it preserves answers, answer states, review flags, private drafts and previously accepted artifacts. The change is revision-checked, atomic and available through History. Closing an unsaved selection leaves the earlier saved scope untouched. Once Save is explicitly requested, closing or losing the response does not undo a committed save: refresh to inspect the actual saved reference.

This feature does not generate an ADR, approve a decision, invoke a model, inspect repository files or write an ADR file. Future drafting must review current saved inputs again; the saved scope is not reusable permission to send text. Templates, draft generation, readiness review and writing are separate roadmap issues.

## Freshness and missing sources

Reopening preselects the saved scope. **Refresh saved journey and status** explicitly rereads the journey and checks source/scenario freshness while preserving the answer editor. Current/stale/unknown describes the last check, not continuous verification. Changing a selection or observed saved context invalidates an open exact preview. The server also checks source and scenario changes, including changes not yet seen by the UI.

Selected question text, parentage, saved answer/state/review, global guidance, optional evidence and scenario label are fingerprinted. Unrelated records, timestamps and unselected research prose do not stale a saved reference. Missing selected records remain historical references and make it stale. They appear as unavailable selections that can be explicitly removed; a missing focal question must be replaced. An unavailable or unresolved scenario policy reports unknown freshness rather than claiming current. Existing scenario preference rules govern preparation; alternatives require explicit hypothetical use.

New reviews also retain bounded dependency relationships, upstream prerequisite fingerprints and selected research-stale flags when evidence is included. Relevant dependency or prerequisite changes stale both scope and draft wording. The exact input shows this metadata, but unselected prerequisite answer text remains omitted and cannot support a generated statement. Legacy scopes retain their earlier narrower comparison until explicitly reviewed again. [ADR update review](adr-updates.md) discloses unavailable historical coverage.

The final save checks the complete saved document after asynchronous scenario validation and history preparation, so an unrelated concurrent correction cannot be overwritten. That acceptance guard is intentionally stricter than ongoing scoped freshness.

## Portable stored contract

Personal v1 and shared v1 journey documents may contain optional `adrScope`:

- `version: 1` and `selectedAt` identify this selection record.
- `selection` contains `focalId`, ordered unique `nodeIds` (1–100, including focal), and `includeEvidence`.
- `dependencies` reuses the brief projection capture: identity/guidance fingerprints and selected source IDs, hashes, question text, answer states and review flags.
- `evidenceDigest` and `scenarioDigest` fingerprint the included recorded evidence and scenario label. No machine location, preference proof, token or session identity is stored.
- `coverage` records the exact input byte limit, measured bytes and selected/omitted counts.

The reference is bounded to 128 KiB and stores no copy of answer or research text. It preserves historical labels and fingerprints even when current sources disappear. Shared canonical serialization retains these fingerprints. A complete copy preserves the reference but a changed journey identity/storage scenario makes it stale; a focused scenario fork omits it with the other prior artifacts. Future ADR drafts will need independent captures rather than treating this one mutable selection as their permanent source record.

Native JSON preserves the reference; Markdown includes a concise **Saved ADR scope** appendix explicitly labeled as selection, not an approved ADR. Reduced visual/offline exports and other AI input projections omit it. Readers older than **v0.1.91** reject unfamiliar shared metadata; older personal readers may silently discard it. Use a compatible client when editing these records. Shared envelope version remains v1 under its existing unknown-field refusal contract.

## Verification

Behavioral tests cover exact selections, partial states, omissions, evidence opt-in, mandatory budgets, strict import validation, canonical shared round trips, stale/missing sources and scenario changes. Controller/HTTP tests verify token purpose, cancellation/replacement, explicit saving, History, final asynchronous correction protection and Project writer-lock/reopen behavior. HTTP/jsdom tests cover private editor/caret preservation, explicit branch/cross-branch selection, errors, missing-source repair and suspended preview/save responses.

Native narrow-pane layout, keyboard/screen-reader behavior, themes and IME remain pending owner checks. No browser/desktop automation or paid model was used. There is no live generation-quality claim because scope selection performs no inference.
