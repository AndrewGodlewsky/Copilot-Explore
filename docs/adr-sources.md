# Durable ADR sources

New ADR file writes and reviewed updates retain the saved reasoning behind the proposed decision. Each `adrFiles` association has a historical source capture, and its Markdown has a readable **Captured exploration sources** appendix. They share the managed ADR identity and capture fingerprint. Refreshing current status never replaces that capture.

The appendix includes the explicitly selected saved questions or user directions, answers and answer states, review flags, global guidance and constraints. It preserves statement-to-source mappings and any research evidence selected for the accepted draft: original URLs, recorded retrieval times/provenance, structured claims, support and limitations. Statement labels in the ADR body identify their source-mapping IDs. The Markdown remains useful without Explorer or the original author's private storage.

Captures describe historical inputs, not verified truth or decision approval. Research remains recorded AI interpretation. A recorded read is the original installation's metadata, not evidence that this installation retrieved or verified the page. Missing retrieval metadata or legacy claim support stays unknown. This operation performs no external research, citation verification, model call, Git commit or push.

## Inspecting current sources

Open **Tools > Save ADR file**, select a recorded ADR of any status, then **Inspect captured sources**. The view separates the captured text from current source status. Choose a captured question to read its original answer/state and recorded research. Expand guidance, capture identity/location, or statement mappings as needed.

ADR file requests allow up to 60 seconds for bounded local Git and filesystem checks. Closing the dialog still invalidates an unconfirmed preview. If a confirmed save times out, refresh its recovery status before retrying; a timeout does not prove that nothing saved.

- **Current:** selected saved content matches the captured records, included evidence, guidance and available target fingerprints. This does not prove correctness or cover unselected ancestors/branches.
- **Changed:** a selected decision, included research, guidance or target fields differ. The original capture stays visible.
- **Missing:** at least one captured node no longer exists. No similarly named node is substituted.
- **Unavailable:** the original journey identity/location or current saved source cannot be checked, or the legacy ADR has no capture. Reconcile or reopen the intended source before relying on currentness.

Historical capture inspection remains available when the currently attached checkout becomes unavailable. If external edits require Project reconciliation, current status is unavailable until that workflow resolves them. Reading the capture never performs reconciliation or rewrites a file.

For shared Project captures, **Inspect current source in Explorer** opens the original [portable reference](portable-references.md) in the reference dialog. Inspect explicitly, then open if appropriate. Changed saved targets require acknowledgement; missing/moved/mismatched targets keep the current map. The original reference is never replaced with a freshly copied fingerprint. Normal draft flushing, pending-work, fold and focus safeguards apply. The portable target fingerprint is narrower than the ADR capture: it does not verify research or the entire branch.

Closing, changing the selected ADR, switching journeys, suspension or a changed saved revision invalidates pending source views. The list returns metadata; each explicit source inspection loads one bounded capture rather than copying every historical capture into the response.

## Locations and Git evidence

**Review ADR updates** adds dependency, included research-staleness and scenario comparison when those were captured with the reviewed scope. It reports missing wider historical coverage rather than inferring it, and compares a portable generated baseline with the actual file and a separately reviewed proposal. The source inspector above retains its narrower selected-content meaning of “current.” See [ADR update review](adr-updates.md).

Existing ADR association `path` remains relative to the attached session's current **working directory**. This preserves the original writer's destination semantics. A shared capture separately records its journey path and `adrPath` relative to the **Git repository root**. For example, an ADR written from `services/api` may have association path `docs/decisions/0001-store.md` and captured Git-relative ADR path `services/api/docs/decisions/0001-store.md`.

Updates to a captured shared ADR reject a different resolved Git-relative destination, even if a same-named copy has matching bytes and a managed marker. Open the original working folder before updating that recorded file. Legacy records cannot supply this additional captured location proof and retain their existing byte/identity checks.

A capture records a commit only when local read-only Git evidence identifies the exact regular tracked source and the committed blob parses to the same validated shared document as the saved source. Formatting differences such as equivalent JSON property order are not separate reasoning versions. Source bytes and checkout identity are also checked around the observation. Untracked, staged-only, dirty, filtered, unborn or unavailable evidence gets no invented commit. Git does not run content filters, fetch missing objects, mutate its index or contact remotes for this operation.

The recorded commit describes the source before the new association is saved. The subsequent association write may make that journey file uncommitted again. Later Git revisions never overwrite the original capture's commit or fingerprint. A null commit means no committed version is claimed; the source snapshot still preserves the selected historical reasoning. Explorer does not automatically retrieve a historical blob during source navigation: it opens the current exact path through the portable resolver.

Teammates must commit and pull both the shared journey and ADR Markdown through their ordinary Git workflow. The same relative reference can then resolve in a clone at another absolute path. Moving a file does not rewrite historical references; find the intended file and make an explicitly reviewed new reference/update rather than guessing another target.

## Compatibility, limits and recovery

`adrFiles` remains version 1 with an optional, separately versioned `sources` object. Older records remain valid and explicitly lack a historical capture. A new reviewed write/update adds one; Explorer does not infer past reasoning retroactively. Personal journeys retain captures and readable appendices with null portable locations/commit and no invented project reference. A later Project copy does not silently rewrite an older Personal capture.

Each capture has 1–100 explicit source records, at most 35 statement mappings with eight references each, and a **64 KiB UTF-8** limit. Canonical SHA-256 fingerprints bind recorded fields independently of JSON key order; they are consistency checks, not signatures or proof of authorship. Included research follows existing source/claim limits. Existing limits remain: 50 ADR associations, a 9 MiB exploration, 64 KiB Markdown and a 256 KiB private recovery intent. Oversized input is rejected without clipping or deleting prior captures.

Captured fields use an explicit saved-input projection. Private answer drafts, comments/handoffs, project excerpts, local absolute-path metadata, session bindings, authentication data, research recommendations and follow-up prose are excluded. Saved answer/guidance text, user-chosen IDs and relative names are retained literally; this is not automatic redaction of sensitive text a user placed in those fields. Review the exact Markdown before saving.

The existing [two-part ADR recovery](adr-files.md) retains the same capture in its reviewed content and pending association. If the Markdown publishes but association saving is interrupted, recovery can finish that historical association while preserving newer answers and draft wording. A conflicting newer association is not overwritten. Source status and source inspection do not rewrite either saved part.

Decision-impact and answer-change previews identify recorded ADR associations whose selected sources intersect the changed question or its reachable dependents. These are historical relationships, not current file verification or approval. Legacy/other-journey captures have explicitly unknown coverage, and the question-importance bands remain unchanged.

Automated tests cover shared round trips, fresh-checkout navigation, nested paths, Git evidence/absence, source races, publication recovery, literal UI text, late replies, impact and draft preservation. Native narrow-pane scrolling, keyboard/screen-reader operation and actual desktop clipboard/navigation checks remain pending for the owner. No browser or desktop automation was performed.
