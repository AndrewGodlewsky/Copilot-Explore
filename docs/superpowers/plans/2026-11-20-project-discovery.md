# Bounded project discovery implementation plan (#112)

> For agentic workers: use superpowers:executing-plans. The owner authorized sequential implementation and publication; one implementation owner and one independent reviewer apply.

**Goal:** Let users discover, select and explicitly read a small, inspectable project-context capture before creating a project brief.

**Architecture:** Extend the transient #111 scope workflow. A dedicated discovery module owns bounded filesystem enumeration and Git ignore checks; ProjectContext remains the canonical read boundary. ProjectMode binds inventory, exclusions, approved selection and read receipts to the current project/client/journey. No helper or model call occurs in #112.

**Tech stack:** Node filesystem/child-process standard library, existing plain browser modules, node:test/JSDOM and installed Copilot/Brave fixtures. No dependency or bundled SDK.

**Spec:** https://github.com/AndrewGodlewsky/Copilot-Explore/issues/112; AGENTS.md; docs/project-context.md. Base: published #111, v0.1.124 / 505b589. Candidate: v0.1.125.

## Constraints and review focus

- Keep existing limits: five selected files, 64KiB per file, 128KiB total source, 8KiB per excerpt, 32KiB total excerpt. Reject aggregate limits before reading contents.
- Bound discovery by depth3, 40 directories, 300 examined entries, 40 candidates and five seconds. Count skipped entries too; report truncation and skipped categories. Check the budget between filesystem operations and bound Git subprocess time; portable filesystem operations already in progress cannot be forcibly cancelled.
- Use fresh workingDirectory and canonical root/ancestor/file identities. Never follow symlinks, junctions, hardlinks or aliases; no repository execution, dependency install, network or automatic content ingestion.
- Honor Git ignore policy and explicit exact path/directory exclusions. If policy cannot be verified, fail closed for this operation with a useful message; ordinary questions remain available. Manual additions cannot bypass policy.
- Retain captures only in memory and show excerpts only in the local scope UI. Do not change native context, map persistence, exports or Challenge Review's separate permission contract.
- Review focus/tests: ignored tracked files and nested negation; large directories consuming enumeration budget; selected-file replacement between metadata approval and read; lost read replies/replays; suspended or changed-project late replies.

## Task 1: Metadata discovery and exclusions

Files: new `com.github.copilot/extensions/explorer/project-discovery.mjs`, new `test/project-discovery.test.mjs`.

- [ ] Write failing fixtures for small/monorepo/empty/large-generated trees, hidden/secret/binary-extension skips, links/aliases/inaccessible directories, budgets and root replacement.
- [ ] Implement a bounded opendir walk, canonical directory checks, relevance categories for docs/manifests/source entry points, and structured candidates/skips/limits/truncation. Discovery reads metadata only.
- [ ] Implement bounded read-only Git check-ignore using stripped Git environment, no optional locks/lazy fetch/fsmonitor, timeout/output limits and exact validated output. Use --no-index to exclude tracked ignored files too. Paths reject newline/control/quote/backslash, permitting core.quotePath=false and exact newline-delimited argv results without a custom parser. Never inspect secret contents for display.
- [ ] Validate up to ten explicit exact-path/directory-prefix exclusions; no glob language. Apply identical policy to manual selections. Test nested ignores, negation, spaces/Unicode, manual bypass, unavailable Git and changed roots. Run focused tests to green.

## Task 2: Bind explicit reads to reviewed scope

Files: modify `project-context.mjs`, `project-mode.mjs`, `controller.mjs`/`server.mjs` only if the existing route requires it; tests `project-context.test.mjs`, `project-mode.test.mjs`.

- [ ] Add a failing read-after-replacement case proving selected metadata must match before any file contents are read.
- [ ] Extend ProjectContext.select with an optional expected metadata capture; preserve existing callers. Check complete root/path/entry equality before any contents, then reuse bounded guarded reads, UTF8/binary checks and fingerprint/excerpt receipts.
- [ ] Add explicit discovery and read actions to ProjectMode with exact request keys, purpose/client/journey/sequence checks. A read consumes a one-use token issued only for approved scope; status must never read or silently refresh contents. Clear inventory/receipts on scope/root/lifecycle changes.
- [ ] Recheck exclusions/metadata on prepare, approve and read; reject changed identities or altered scope. Return local-only excerpts plus names, hashes, byte/truncation counts and capture time. No AI call or saved-map changes.
- [ ] Test token replay, cancellation/late reads, unknown/replaced project, byte limits, binary content under text extension, native/export omission and ordinary question isolation. Run focused tests to green.

## Task 3: Extend the existing scope dialog

Files: `web/project-mode-client.mjs`, `web/index.html`, `web/style.css`, `test/project-mode-client.test.mjs`, `scripts/check-ui-layout.mjs`, `scripts/e2e.mjs`.

- [ ] Add Find candidate files, bounded checkbox candidates with reason/size, skipped summary, and optional exclusions above the current editable selected-path list. Preserve default empty selection and manual additions.
- [ ] Selection/exclusion changes invalidate approval and receipts. Keep Review scope/Enable explicit; Read reviewed files is separate and only available for approved current scope. Local excerpts/receipts are expandable. Keep the honest project-brief-required state.
- [ ] Test literal rendering, focus/keyboard/scroll geometry, selection bounds, failure drafts, uncertainty, late responses and lifecycle. Use existing app polling; no independent timer or competing page lifecycle.
- [ ] Extend authorized Brave and installed runtime fixtures with synthetic project content and zero paid calls. No native/live usefulness claim.

## Task 4: Review and publish

- [ ] Update project-context/integration docs and AGENTS narrowly for explicitly requested bounded discovery/read, leaving other operations unchanged. Synchronize v0.1.125 and release notes after confirming #111's final published version.
- [ ] Independent review of correctness/spec/privacy, fix findings, record review receipt. Run frozen verify:iteration with test/check/e2e/authorized Brave gates; verify complete package byte for byte.
- [ ] Fetch, commit, integrate main without discarding others' work, push without force, verify remote commit, update/close #112 with evidence and manual limits. Record unavailable usage counts and pending seven-day observation. Continue #113.
