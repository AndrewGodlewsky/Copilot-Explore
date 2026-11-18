# Saving proposed ADR files

Tools → **Save ADR file** opens the project-file review. The saved ADR draft also has **Preview saved ADR file**. Accept wording edits into the exploration first: file review uses only the saved proposed artifact and never generates wording or answers a question.

Choose a new file, enter its number when the saved format uses numbering, and select **Preview exact Markdown and path**. Read the complete relative path and Markdown, readiness advisories, and current scenario label. Correctness blockers prevent publication; advisory gaps remain judgments for the author. **Save ADR** writes exactly the reviewed bytes and records the association in the exploration. It does not approve the decision or commit/push Git changes. Hidden or late reviews cannot authorize saving.

Paths are relative to the attached session's current **working directory**, read from fresh host metadata. This is not the session artifact workspace or an inferred Git root. If the session works in a nested project folder, that folder is the base. The default is `docs/decisions/0001-title.md`; saved ADR format preferences control the convention. A number reserves nothing, and Explorer does not scan or allocate the next number. An occupied path requires another explicit choice and review.

To revise an existing file, select its recorded proposed ADR. Review the complete **Before** and **After** Markdown. The path and managed identity stay the same. Every original byte, file identity and managed marker must still match the recorded version. External modifications, same-byte file replacements, missing files or changed roots require investigation and another review; they are never silently overwritten. Formal acceptance, rejection and supersession are separate work in #85.

## Interrupted operations

Status distinguishes the project file from its exploration association. A timeout is not proof that neither saved. Reopen this dialog or use **Refresh saved journey and file status** to inspect actual saved state.

| Observed state | Available action |
| --- | --- |
| Unpublished | Retry the confirmed operation if its original source and destination still match, or explicitly discard it. Discard only removes a proven owned staging file; it never deletes a published ADR. |
| File saved, association incomplete | Retry / finish association. The published bytes are retained; newer answers and draft wording remain intact. The association describes the captured historical artifact. |
| File and association saved | Complete. Repeating recovery is idempotent and creates no duplicate record or file. |
| Unknown or conflicting file/association | Preserve the journal and existing files; inspect the reported conflict. Explorer does not guess which version to keep. |
| Association saved, file subsequently changed/unavailable | The old association is retained and file status is unknown. Another new-file preview is allowed; this does not authorize replacing the changed file. |

History finalization may fail after the association becomes durable. Status still reports the durable record, and retry reconciles history. An unrelated external edit during a history transaction can require the ordinary **Recovery** workflow before association can proceed. Refresh alone does not bypass that protection.

Closing the dialog cancels its preview, not an already confirmed write. Private recovery survives reopening. It records the exact confirmed bytes, original destination identity, source/readiness digests and expected association. A changed unpublished source cannot be silently replayed. After publication, recovery may finish the historical association while preserving newer sources. A conflicting newer association blocks reconciliation.

## Portability and boundaries

The `.md` file is ordinary UTF-8 Markdown, readable without Explorer, its private storage or Copilot. It retains certainty, AI synthesis/user-edited labels, explicit unknowns, the current scenario classification and a fixed proposed-status notice. Unspecified authors or dates are not invented. User text is escaped as literal Markdown. The fixed managed UUID comment is identity metadata, not decision approval.

Personal and shared journey files can carry up to 50 `adrFiles` references with relative paths, titles, proposed status, stable IDs, timestamps, exact file/artifact/readiness digests. New reviewed writes/updates also capture their selected saved reasoning and recorded evidence in a readable source appendix. **Inspect captured sources** separates the original capture from current source status and opens shared sources through explicit portable-reference inspection. See [durable ADR sources, path bases and Git evidence](adr-sources.md). References do not grant filesystem authority or approval. Older records stay readable without inferred historical sources; older Explorer versions may reject the new optional capture. Team members must commit/pull the Markdown and shared journey through their normal Git process.

Files are limited to 64 KiB; the private intent to 256 KiB. Only validated relative Markdown paths are supported. Secret-default, hidden, traversal, reserved, linked and non-regular destinations are rejected. Private recovery storage must remain outside the selected working root. Preview does not create project directories; confirmed publication may create missing parents and stage a complete file. New creation uses a no-clobber link; managed updates use a guarded rename. Unsupported filesystems fail without a fallback that overwrites occupied files.

The intent records staging identity before publication. A crash between a new-file link and staging cleanup may leave two links; recovery accepts that case only when both identities and bytes prove ownership. Extra or unrelated hard links are rejected. Unverified orphan staging files remain preserved for inspection. Document and destination locks coordinate Explorer writers. Portable Node cannot guarantee an atomic compare-and-swap rename or defend against hostile concurrent ancestor replacement by arbitrary external processes; this uses the existing cooperative local-filesystem boundary.

Contract, filesystem fault-injection, HTTP, shared-journey and jsdom tests exercise publication, recovery, conflicts and late UI responses. The installed-runtime fixture checks fresh metadata working-directory changes, exact publication and reopen without model calls. Native narrow-pane rendering, keyboard/screen-reader operation, theme and IME checks remain owner-performed; no browser or desktop automation was used.
