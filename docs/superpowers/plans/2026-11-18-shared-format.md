# Shared exploration format implementation plan

> **For agentic workers:** use superpowers:executing-plans for this approved issue. Keep the issue comments and implementation ledger current; record blockers there for owner review instead of pausing other ready work.

**Goal:** satisfy [#53](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/53) with a lossless, strict, deterministic codec and explicit non-destructive personal-v1 conversion.

**Architecture:** a pure `shared-document.mjs` module reuses model validation but preserves original user text and optional fields. A separate `copilot-explorer-shared` v1 envelope contains journey content without the personal local revision counter. No controller, file reader/writer, host SDK or UI is rewired in this foundation.

**Tech stack:** shipped JavaScript modules, Node standard library and node:test. No new dependency.

**Spec:** issue #53; downstream storage/privacy work #54/#55 owns publication, authoritative paths, locking and recoverable file installation. The codec prepares bytes and hashes, never performs I/O.

## Global constraints and decisions

- Preserve Unicode, whitespace, meaningful array order, stable IDs and research provenance. Do not manufacture defaults on read.
- Opening and preparing an unchanged write return the original bytes, including formatting and BOM. Changed output uses sorted object keys, two-space indentation, LF and final newline, except legacy hash-input subtrees retain key order (journey pins and accepted handoff guidance/evidence).
- SHA-256 of raw bytes is the optimistic-write base; a canonical content digest supports semantic comparison. Equal local revisions are never sufficient.
- Refuse mutation for unsupported versions, unknown/non-preservable fields, duplicate JSON keys, invalid references, invalid UTF-8 or oversize input/output. Preserve source bytes.
- `extensions` is reserved but only empty values are supported now. Future dependency/scenario/ADR/review schemas require explicit support and a compatibility decision; do not invent them here.
- Explicit migration prepares a new envelope and source digest without changing the personal source; no speculative future-version migration.
- Pure preparation is safe to abandon at any point. File installation/backups and cross-process compare-and-write are later storage responsibilities, not claims of this module.

## Task 1: codec and contract

Files: add `com.github.copilot/extensions/explorer/shared-document.mjs`, `test/shared-document.test.mjs`, `docs/shared-format.md`.

- [x] Write failing real-code tests for lossless Unicode/whitespace/optional/research round trips, meaningful array order and deterministic answer edits.
- [x] Cover unchanged byte preservation, equal-revision/different-content stale bases, malformed/duplicate/unknown/future data and invalid graph references.
- [x] Cover explicit personal conversion, retained identities/provenance, source preservation on success/failure/abandonment, and near-limit conversion failure without truncation.
- [x] Implement `readSharedDocument`, `prepareSharedWrite`, `prepareSharedMigration`, constants and documented digest/serialization helpers only where required by the tests.
- [x] Run focused tests red then green; review all public inputs for prototype/duplicate-key/UTF-8/size behavior.
- [x] Document the envelope, examples, migration contract, read-only incompatibility and downstream obligations.

## Task 2: release and handoff

- [x] Run full `npm test`; update to the next patch and synchronize all release metadata/README/lockfile fields and release notes.
- [x] Run `npm run check`, `npm run package`, release tests and `git diff --check`.
- [x] Obtain a fresh code review; fix material findings with behavioral coverage.
- [ ] Fetch, commit, integrate into main, push without force and verify remote commit.
- [ ] Post changes/checks/limits in #53, close only when its scoped contract is met, and proceed to #54.

## Review focus

Opaque future data must never disappear during an edit; whitespace must not be normalized unintentionally; raw-byte conflicts must differ from semantic equality; malicious JSON keys/encodings must be rejected before use; migration/output size limits must not destroy the input. Tests cover these cases. No fixture proves native UI or distributed persistence, and neither is implemented here.

## Execution record

Twelve focused tests passed after observed red runs. Review found and fixed generic-string certainty bypass and canonical sorting that invalidated accepted handoffs. The latter requires retaining legacy hash-input subtree order; recomputing hashes would misrepresent historical inputs. Full checks and the published commit are recorded in issue #53. Personal storage, SDK wiring and UI are unchanged.
