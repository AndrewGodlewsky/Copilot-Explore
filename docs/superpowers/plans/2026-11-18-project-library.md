# Project library implementation plan

Implement approved issue #56 using superpowers:executing-plans. Keep the existing Personal library and search behavior intact.

## Contract

- Add a Project library view beside Personal, with an explicit repository-relative folder and Refresh. Default to `.explorer/journeys`; scan only direct children of that folder, with entry/file/byte limits and visible partial coverage.
- Read only validated shared documents. Preserve readable unique entries when other files are malformed, oversized, unsupported or duplicate identities. Identify duplicate files individually and require resolving the duplicate before editing through this list; never silently choose an authority.
- Capture checkout, folder, file content and identity for each listing. A stale listed selection must refresh before opening; never use imported session IDs or absolute paths. Missing folder is empty; unavailable/changed checkout is explicit.
- Keep pins, recents and current-user attachment bindings in checkout-specific private storage. A clean clone needs none of that metadata. Opening is explicit and attaches to the current canvas without starting inference or changing the model/session.
- Use existing draft-flush and pending/preview guards for opening. Library refresh does not reset active editor state. Project file changes remain subject to #58 reconciliation.

## Steps

1. Add failing discovery tests for valid/mixed files, duplicate IDs, limits, missing/linked folders, replaced checkout, stale selection and independent clone metadata.
2. Implement a bounded project library over ProjectRepository/shared readers and reuse private Library metadata behavior where its contract fits. Add controller/HTTP routes for refresh, pin and open.
3. Add accessible Personal/Project selection and project folder/list controls. Exercise refresh/open/pin/draft preservation through DOM/HTTP tests without browser automation.
4. Verify current-session behavior through the installed local SDK fixture, request final independent review, fix material findings, run full tests/check/package/e2e, bump the patch and publish main. Record native layout/keyboard checks as pending.

## Execution record

Implemented bounded Project library discovery, private pins/recents/bindings, captured-source opening and UI controls alongside Personal. Four discovery/controller tests and the DOM/HTTP workflow pass; a red/green regression rejects non-string folder inputs before coercion. The installed SDK fixture verifies discovery/open adds no model requests. Independent review reports no material findings. Final full-suite and publication results are recorded in #56; native appearance/keyboard checks remain pending for the owner.
