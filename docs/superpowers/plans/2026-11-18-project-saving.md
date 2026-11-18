# Project saving implementation plan

Implement approved issue #55 using superpowers:executing-plans. Follow the standing release authorization and record progress in the issue.

## Contract

- Personal remains the default. Project creation selects a validated relative folder (default `.explorer/journeys`) and a generated filename; explicit reopening accepts a relative shared-file path. Automatic discovery belongs to #56.
- Resolve the checkout with fresh attached-session metadata and read-only Git discovery. Support subdirectories and worktrees. Never use the artifact workspace, imported absolute paths, or Git mutations.
- Revalidate the selected checkout and captured filesystem identities before project reads/writes. Reuse the shared codec, private context, history intent protocol and atomic writes. External content changes remain fail-closed until #58.
- Route drafts, references, history, retention, observations and helper receipts to the active private context. Capture helper receipt destinations when each operation starts. Switching scope does not migrate personal data.
- Show storage scope and relative location, and explain that sharing requires the user's Git workflow. Finish marks project content complete; Markdown remains an explicit download rather than a second repository write.

## Steps

1. Write failing repository/controller tests for creation, reopening, continued edits, private-data isolation, two clones, subdirectories/worktrees, invalid paths and stale host metadata.
2. Add repository resolution and safe destination preparation. Connect ProjectJourney to the controller's existing locked transactions without nested locks or normalization of saved text.
3. Add scope/folder controls, explicit relative-path reopening and location details; exercise these through the existing DOM/HTTP fixture without browser automation.
4. Extend the installed SDK fixture to prove fresh metadata controls the project destination and changed metadata rejects saves. Use only its disposable home and local model.
5. Request final independent review, fix material findings with regressions, run full tests/check/package/e2e, bump patch metadata and release notes, push main and verify. Record manual narrow-pane/keyboard checks as pending.

## Execution record

Implemented scope selection, relative-path reopening, fresh repository resolution, controller storage routing and captured helper receipt destinations. Repository/controller, DOM/HTTP and installed SDK fixtures pass. Independent review found false project dashboard zeros; a red/green regression now verifies the dashboard reads the authoritative project document and identifies its coverage. A separate red/green test protects submitted candidates against mutations while waiting in the save queue. Final full-suite and publication evidence are recorded in #55. Native layout/keyboard and actual ACL-denial checks remain pending; no browser automation or paid model calls were made.
