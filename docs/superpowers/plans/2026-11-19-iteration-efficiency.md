# Iteration efficiency implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. One implementation task and an independent review cover this tightly coupled tooling change.

**Goal:** Make the approved token-saving workflow easy to follow and provide fresh, inspectable verification and usage records without changing Explorer's runtime.

**Architecture:** A dependency-free Node CLI manages ignored per-iteration briefs, review attestations, check receipts and usage entries. It delegates checks to existing npm scripts. A short AGENTS.md pointer loads the workflow guide only for implementation work.

**Tech stack:** Node >=22, Git, existing npm scripts and node:test. No new dependency or hosted service.

**Spec:** The owner's approved four-part recommendation in this conversation: concise repository instructions; issue brief and completion receipt; one verification command with stale-evidence detection; per-issue token ledger. Preserve independent review, final checks, UI coverage, sequential roadmap issues and per-iteration publication.

## Global constraints

- Work only in the isolated iteration-efficiency worktree; preserve the other worktree's uncommitted changes.
- Use existing test/check/e2e/check:ui scripts; host and UI checks are conditional, never silently reported as passed when unavailable.
- Browser automation requires existing explicit user authorization. The CLI's UI flag is an attestation by the caller, not new user permission.
- Record only explicit aggregate usage and evidence references. Do not discover/read private session journals, use paid model fixtures, or modify blocked/deferred issues.
- Every published iteration still bumps all release versions, passes npm test and npm run check, and reaches verified origin/main without force push.
- Missing usage is unknown, not zero. Cost targets never waive quality requirements.

## Review focus

1. Post-check content edits, new/deleted files and changes during a running check invalidate evidence.
2. Failed, interrupted or unavailable checks and stale review attestations cannot produce a ready receipt.
3. Iteration IDs/evidence paths cannot escape the worktree's ignored storage; shell arguments are not executable user commands.
4. Cached input remains a subset of input; duplicate usage IDs and invalid/unsafe numbers are rejected.
5. Changing metadata, brief requirements or review evidence after verification cannot retain a false ready status.

### Task 1: Durable workflow and verification receipts

**Files:** scripts/iteration.mjs, test/iteration.test.mjs, package.json, .gitignore, docs/development-workflow.md, AGENTS.md, and normal release metadata.

**Interface:** `npm run iteration -- <command> <id> [arguments]`; `npm run verify:iteration -- <id>` aliases verification. Commands: start, review, verify, status, usage. Detailed CLI contract is in the task brief under .superpowers/sdd/2026-11-19-iteration-efficiency/.

- [ ] Add meaningful failing tests for stale code/review/brief/evidence, conditional gates, failed commands, path validation, and usage accounting/deduplication.
- [ ] Implement the CLI with Node built-ins and compact console receipts; full output stays in ignored local files.
- [ ] Add the focused guide and short AGENTS.md pointer; preserve existing safety/publication requirements.
- [ ] Run focused tests, then obtain independent spec/quality review; fix findings and review the changed scope.
- [ ] Bump synchronized release metadata; run the actual iteration verifier and package validation on the final candidate.
- [ ] Commit, integrate remote changes safely, push main, verify the remote commit, and report actual checks and limits.

The reviewer should inspect the full change once; subsequent review is limited to fixes. The cost-saving percentages from the retrospective are hypotheses, not acceptance promises. Count automation setup and rework in the next ten-issue pilot.
