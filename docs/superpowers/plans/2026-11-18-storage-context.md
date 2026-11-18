# Separate document and private storage implementation plan

> **For agentic workers:** use superpowers:executing-plans for this approved issue. Record progress and blockers in #54; continue ready work without requesting routine approvals.

**Goal:** implement [#54](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/54): a project journey has one shared document and checkout-specific private auxiliary data.

**Architecture:** add a storage context and project-journey persistence adapter. The context owns canonical document/checkout/local identities and a private writer lock. The adapter uses the #53 codec and existing local drafts/history/recovery machinery. Personal library behavior remains unchanged. #55 consumes this adapter from the controller and supplies fresh host project metadata plus creation/location UI.

**Tech stack:** shipped Node modules and node:test; no new dependency, host session, browser automation or paid model.

## Contract and rulings

- Shared: saved questions/directions, committed answers/states, guidance/pins, chosen saved research, accepted brief/handoff artifacts, explicit saved review/reminder/provenance fields and stable IDs. Accepted artifacts are saved user-reviewed content, not transient derived UI views.
- Private: drafts, audio, bindings, preferences, references, usage/helper receipts and journals, caches, locks, local revisions/history/recovery. Project excerpts remain transient and are absent from the shared schema.
- Namespace project auxiliary storage by canonical checkout identity plus journey identity. Different clones/worktrees must not share local state; no automatic movement of drafts between scopes.
- Only the supported shared schema is written beside the project document; local snapshots and lock evidence stay in the private root. Atomic temporary document bytes may temporarily exist beside the document, but contain only that same shared schema.
- Personal scope retains its existing storage and identity contract. Project opening creates no independently editable local head copy. Local history stores past recovery versions, not an authority.
- Reuse History's intent protocol. A project working revision is local bookkeeping, recovered by matching shared content against the local head or pending intent. Unknown external changes fail closed for later #58 reconciliation.
- Treat filesystem operations as cooperative: reject observed root/path/identity replacement and links. Do not claim portable Node operations eliminate hostile concurrent ancestor races.

## Task 1: context and shared persistence

- [x] Add failing tests for shared-only project bytes, separate namespaces, clean-clone reads, original draft retention on scope changes and invalid/unavailable roots.
- [x] Add `storage-context.mjs` with canonical checkout/document/local roots, private lock/usage locations and bounded identity-checked reads.
- [x] Add `project-journey.mjs` to open/create/save the shared document with raw-base checks, local revisions and the existing history intent protocol. Keep all writes serialized under the local context lock; no Git commands.
- [x] Preserve exact supported content and reject unknown/private fields rather than filtering an arbitrary object or copying a directory.
- [x] Verify two checkouts with the same journey ID, independent drafts/bindings/usage/locks/recovery and failed writes.

## Task 2: recovery and retention

- [x] Give History and recovery an explicit validation hook so shared working snapshots retain text without changing existing personal behavior.
- [x] Let retention use one explicitly bound external document reader and private lock, while keeping path/identity checks on local deletion candidates.
- [x] Test interrupted save before/after document replacement, reopening, draft recovery, old-snapshot cleanup, protection of authoritative document/private drafts, and stale roots/content.
- [x] Document the inventory, context API, integration obligations for #55 and honest compatibility limits.

## Task 3: release

- [ ] Run focused tests red/green and the full npm test suite; request one final independent review and fix material findings with behavioral regressions.
- [ ] Bump patch version and synchronize metadata/release notes, then run check/package/release checks and diff check.
- [ ] Fetch, integrate without discarding work, commit, push main and verify remote hash. Record completed behavior, actual tests and limits in #54 before closing and proceeding to #55.

## Review focus

Unknown/private data must not leak into shared files. Checkout identity changes must not select another checkout's auxiliary state. Failed history finalization must not roll back a committed answer. Retention must bind both authoritative content and private snapshots before deleting anything. An unsupported shared file must remain intact. Tests must exercise real persistence, not only path construction.

## Execution record

Nine project-persistence tests pass, including an observed red-to-green creation collision regression. The related history/recovery/retention/shared-codec suite passed 81 tests. Independent review reported no material findings and additionally probed accepted artifacts and a writer throwing after replacement. Installed SDK/runtime fixture passed using the paired local runtime, disposable home and loopback model; no paid provider or UI automation. Final full-suite and publication evidence are recorded in #54.
