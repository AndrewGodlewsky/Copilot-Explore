# Standalone exploration validation

Implement approved issue #61 with the executing-plans workflow.

1. Add failing CLI tests against disposable directories: valid legacy/shared parity, invalid graph/schema/duplicates, conflict markers, Unicode/spaced paths, missing/empty folders, limits, and exact bytes retained.
2. Expose a pure source validator that reuses the current JSON and schema/graph validators. Ship a Node CLI inside the extension with explicit files or one direct discovery folder, bounded safe reads, relative escaped diagnostics and deterministic exit codes. Do not create private storage, launch Copilot, access the network, rewrite or repair files.
3. Add local usage and an opt-in GitHub Actions example using a trusted pinned Explorer checkout. The validation command must run against a disposable sample repository without modifying it; no automatic CI installation or paid service.
4. Obtain independent final review, run the full suite/check/package, synchronize the next patch release, publish main and record evidence on #61. Host wiring/UI are unchanged, so runtime/native UI checks are not required for this CLI-only iteration unless scope changes.

Ruling: validation covers the canonical shared metadata available now. Future dependency/scenario/ADR fields remain unsupported until the shared schema implements them; the command must reject them, never invent or discard references. Legacy files use the existing v1 model validator with strict migration preservation checks: known compatibility defaults are allowed, unsupported fields/references are rejected, and normalized output is never written.

## Execution record

- Seven CLI process tests pass, including supported legacy/shared fixtures, strict unknown-field rejection, graph/schema failures, Unicode paths, unchanged bytes, no private storage, missing/empty folders, bounds and an unchanged disposable Git repository.
- Independent final review found legacy unknown-field acceptance and aggregate reads checked too late. Both reproduced in failing regression tests and now pass; the aggregate probe measures physical reads for stable and post-read-changed files.
- Final `npm test`: 775/775; `npm run check`, `npm run package` and `git diff --check` pass for v0.1.75. No SDK wiring or rendered UI changed, so no installed-runtime or native visual check was needed for this issue. The optional hosted CI workflow was not enabled or run.
