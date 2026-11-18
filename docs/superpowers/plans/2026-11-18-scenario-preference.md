# Preferred scenario implementation plan

> Execute inline with superpowers:executing-plans. The approved issue is the specification; preserve saved alternatives and answer certainty.

**Goal:** Explicitly select the current direction within a recorded fork family, retain alternative scenarios, and identify the scenario supplying AI inputs and decision exports.

**Spec:** [GitHub #72](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/72). Base 9ca8bfc3, Explorer 0.1.87. Prerequisites #44 and #71 are published.

**Architecture:** A strict, bounded preference record holds one current selection and a bounded change history. A canonical file per family avoids multi-file winner flags. Personal records remain in private storage; Project records live at an explicit `.explorer/scenarios/<family-hash>.json` path. The coordinator captures current document, preference bytes and storage identity; writes serialize, recheck revisions and bytes, and preserve prior selections. Read-only inspection never guesses a replacement for a missing preferred source.

**Family ruling:** Use the recorded earliest root origin of a fork, or the current identity of an unforked map. An unforked copy starts its own family; copying an existing fork preserves its explicit origin. Comparison copy aliases do not merge preference families. Incomplete or contradictory root lineage is unresolved. Personal and Project selections are distinct, visibly named scopes; choosing a shared preference requires an explicitly shared scenario. Recorded lineage remains an identity claim, not verified provenance.

**Context ruling:** Without a preference, the existing active-map workflow remains available and is labeled unselected. A preferred current map supplies ordinary context. A retained alternative requires opening the preferred source or explicit hypothetical use bound to the current map and captured selection. Missing/replaced preferred sources and malformed/conflicted records remain unresolved. Revalidate before queued dispatch and result retention. Export labels describe the source and preference at export time, not an invented historical selection. Cleanup still receives only explicit answer draft text and no map metadata.

**Constraints:** No answer copying/merging, deletion, automatic ADR acceptance, promotion of assumptions/research, hidden repository discovery, private draft publication, model/provider changes or new runtime dependencies. Preserve fresh host project authority, canonical path checks, owned helper isolation, cancellation and accounting. No browser/desktop automation or paid providers.

## Tasks

- [x] RED/GREEN pure record and policy tests: original/nested/copied families, incomplete origin, strict fields/UTF-8/duplicate JSON keys/size limits, one current selection, rationale and bounded history, restoring a previous selection as a new change, missing/replaced source, certainty/research unchanged. A file conflict is never an inferred winner.
- [x] RED/GREEN filesystem/coordinator coverage: Personal and Project scope, atomic creation/replacement, revision and byte conflicts, overlapping writers, source edits during asynchronous validation, failed saves, changed checkout/linked paths, no private data or map edits. Reading an absent Project preference does not create repository files. Preferences use the existing protected storage primitives and local Git authority.
- [x] RED/GREEN operation policy coverage: exact source identity in reviewed AI context and decision exports; alternative use is explicit and hypothetical; unavailable preferred source remains unresolved. Changing selection before queued dispatch/callback/result acceptance rejects stale work. Existing answer-state and stale-research rules remain in force. Context byte limits include source labels; cleanup's text-only boundary remains unchanged.
- [x] RED/GREEN controller/HTTP/jsdom workflows: explicit current selection, optional rationale, clear/restore history, open preferred through normal draft-flushing guards, hypothetical consent, and refresh. Preserve the connected editor, drafts, caret and focus. Reject stale tokens, detached callbacks, closed/resumed pages and replaced bindings. Show scope, exact source, conflicts and missing-source recovery plainly in a narrow stacked dialog.
- [x] Document format, family/scope rules, compatibility and limitations. Obtain one independent final review; fix material findings with RED/GREEN tests. Synchronize 0.1.88 and release notes, run npm test/check/package and the installed local SDK fixture. Publication and remote verification are recorded on issue #72.

## Review focus

- Multiple sibling files must not each claim a separate winner for the same recorded family/scope.
- Shared selection conflicts, incomplete lineage and missing preferred targets must not silently fall back to the currently open map.
- Preference changes must not promote answer certainty, stale research or hypothetical conclusions into confirmed project decisions.
- Queued requests, callbacks, accepted artifacts and exports must not use an obsolete preference or silently switch their source.
- Project preference writes must preserve byte conflicts and checkout identity; no private paths, drafts, usage or local history may leak into the repository.
- Inspection, selection, history restore and source navigation must preserve drafts, expose failures and reject old-page actions.

Implementation notes and tentative interface exploration are also recorded in the private task scratch file `explorer-72-preflight.md`; the issue and this plan are the portable specification.

## Final review and verification notes

The independent final review found one dispatch-ordering race: an asynchronous project/source check could follow preference validation. RED tests reproduced disallowed dispatch and result retention; final policy checks now follow those prerequisites at dispatch, retention and polling, including handoff dispatch. No further material findings were reported. Existing asynchronous test fixtures now wait for actual dispatch/response signals. Project creation retains its original request timeout; redundant preference reads were removed while preserving final dispatch validation. Full verification also exposed unchanged preference observations invalidating conditional polling; a RED/GREEN regression now retains the observation object until its content changes. Final full-suite, package and installed-runtime results are recorded on the issue before closure.

The next full run passed 948 of 949 tests; the existing ten-second project-create request expired under concurrent native Git process contention, while its isolated workflow passed in 5.2 seconds. The test runner now caps parallel files at four. This bounds fixture contention without extending application timeouts or removing fresh checkout checks. The final full run uses that limit.

Final verification passed: 949 tests, syntax/asset/version checks, packaging, whitespace checks, and the installed SDK/runtime fixture using a disposable home and local model. Native narrow-pane, keyboard/screen-reader, themes and IME checks remain pending owner verification.
