# ADR decision lifecycle

Open **Tools → ADR lifecycle**, or **Manage ADR lifecycle** in the file dialog. Select a recorded ADR and review an explicit status change or a new successor proposal. The view shows its current status, dated history, optional self-declared contributor, and predecessor/successor paths. Accepting AI wording, choosing a scenario, refreshing sources, and importing a journey never approve a decision.

| Current status | Available change |
| --- | --- |
| Proposed | Accept or deprecate the decision. |
| Accepted | Deprecate it, or create a new proposed successor. |
| Deprecated after acceptance | Create a proposed successor. Accepting that successor can supersede the deprecated decision. |
| Deprecated before acceptance | Retain it as a rejected proposal. No re-acceptance. |
| Superseded | Retain its history and superseding reference. No further status transition. |

For acceptance or deprecation, read every **Before** and **After** file, the status changes and source-currentness notice, then confirm. No current ADR draft is required. These changes update only generated status metadata, the lifecycle history and relationship footer. The original decision, rationale, certainty labels, artifact identity and captured source appendix remain intact. A changed or missing source is advisory context, not proof of correctness and not automatic decision invalidation.

Contributor names come only from the existing optional private contributor setting. They are self-declared, not verified authorship. An unset contributor stays unspecified; no Git, operating-system or chat identity is inferred. Event times are fixed when preparing the exact preview, which expires after ten minutes, and are persisted only when confirmed. Historical attribution is not renamed by later setting changes.

## Replacing a decision

1. Review and save new proposed ADR wording through the normal ADR draft/readiness flow. Keep uncertain statements uncertain.
2. Select the older accepted (or previously accepted deprecated) ADR in **ADR lifecycle**. Choose **Create successor proposal from saved ADR wording** and a free number if the format is numbered.
3. Review both files. Confirmation creates a **new proposed file** and adds reciprocal references to the older file. The older status, substantive text and source capture remain unchanged.
4. When ready to approve the replacement, select the new proposal and explicitly review **Accept decision**. This changes the proposal to accepted and its predecessor to superseded, with a matching superseding reference. Confirm both file previews.

Several proposed successors can coexist. Deprecating one does not erase its relationship or prevent another proposal from being accepted. Only one replacement can supersede a predecessor; competing acceptance is rejected. A later replacement forms another link in the chain. Self-references, cycles, missing records and mismatched reciprocal paths are invalid.

Ordinary **Save ADR file** updates remain available only for proposed records and preserve their relationships. Accepted, deprecated and superseded reasoning cannot be regenerated in place. Source inspection stays available for every status. There is no repository-wide ADR register, automatic approval, model call, external research or Git commit in this workflow.

## Interrupted saves

Two file publications and the exploration association are not a globally atomic transaction. A private journal records the exact confirmed plan before either file changes. The UI reports each file separately as saved, not saved or unknown, and reports the exploration association independently. A new successor publishes before its predecessor reference changes. Closing the dialog or a timed-out response does not prove that nothing saved.

Reopen the view and **Refresh journey and saved parts**. **Reconcile saved parts** resumes the same confirmed operation, verifies publication and cleanup, then saves the complete reciprocal association together. It preserves newer unrelated source answers and the original reviewed captures after partial publication. Conflicting file bytes, association bases, unavailable storage or changed checkout identity block reconciliation; no published file is rolled back or silently replaced. Some conflicts require the ordinary Project/History Recovery workflow first.

**Discard unpublished operation** is offered only when every file is known to be unpublished. It cleans only proven owned staging files. Pending lifecycle work blocks ordinary ADR writing, and pending ordinary writing blocks lifecycle work. A saved association with unfinished history or completion receipt still needs reconciliation. Repeating completion creates no duplicate events, files or revisions.

Completed journals remain historical receipts after later legitimate file/status changes. They do not become pending again and do not claim that the original bytes still match. No private journal is committed into the shared journey; collaborators exchange the journey and Markdown using normal Git commits and pulls.

## Paths, compatibility and limits

Paths remain relative to the fresh session working directory, including nested folders. Shared source captures also retain their Git-root-relative ADR location. Open the original working-folder base in another clone; an identical filename copied into another base is insufficient authority. Personal and legacy records without portable locations keep the original working-directory limitation described in [ADR files](adr-files.md).

Every existing file must match its recorded bytes and identity. Git checkout line-ending conversion or another external edit can change those bytes, and lifecycle editing then stops rather than overwriting the difference. Preserve the original recorded file and investigate the checkout settings/change; there is no automatic re-baselining. The local clone fixture disables line-ending conversion to verify unchanged-byte portability.

The optional version-1 lifecycle field adds validated status events and reciprocal references to existing `adrFiles` records. Legacy proposed records remain valid without inferred history. Each exploration holds at most 50 ADR records; each lifecycle has at most three status events, 49 successor references and 32 KiB of metadata. Files remain limited to 64 KiB. The private coordinator holds one or two exact child operations within 1 MiB; individual write journals retain the 256 KiB limit. Requests are limited to 16 KiB and responses to 512 KiB. Oversized exact previews fail before issuing a save token; nothing is clipped.

The old `copilot-explorer-adr:v1:…:proposed` comment remains stable **identity metadata** for compatibility. Current decision status comes from the association, visible generated status and lifecycle footer, not that historical marker. Older plugin versions may reject lifecycle-bearing records; use the same current version across collaborators.

Destination and document locks coordinate Explorer writers, with the same cooperative filesystem limits as [ADR publication](adr-files.md). Portable Node cannot provide a global multi-file compare-and-swap transaction or protection from hostile external ancestor replacement. Recovery exposes partial outcomes instead of claiming such guarantees.

Pure/schema, filesystem fault, HTTP, fresh local Git clone and jsdom tests cover transitions, reciprocal proposals, file conflicts, interruption/restart, history finalization, final source/root checks, response limits, late UI replies and private editor preservation. Native narrow-pane layout, keyboard, screen-reader, theme and IME verification remain owner-performed. No browser or desktop automation was used.
