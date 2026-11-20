# Research Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. One implementation owner and one independent final reviewer follow the repository workflow.

**Goal:** Keep time-sensitive evidence from silently appearing current while preserving useful historical and conceptual research.

**Architecture:** Add a pure shared freshness module for bounded metadata, conservative date interpretation and injected-clock evaluation. Existing model, owned-helper tracking, reviewed requests and live/offline evidence views consume it. Reuse current persistence, support links, request limits, permissions and explicit refresh.

**Tech Stack:** Existing native JavaScript modules, Node tests, installed Copilot SDK/local model fixtures and Brave; no added dependency.

**Spec:** [Research freshness](../../research-freshness.md), approved issue106. Policy values are implementation choices within the delegated scope.

## Global constraints

- Claim classifications are interpretations, not truth/currency certificates. Preserve read versus publication/update distinction and legacy unknown coverage.
- Existing160000-byte research,80000-character helper,128KiB reviewed request and output/history bounds remain. Three date labels max160 units; classification reason300, named version120.
- Policy intervals1/7/180days, with no age-only expiry for durable/named-version evidence. Unknown/future/ambiguous clocks and dates stay conservative.
- No new retrieval, tools, model permissions, ambient context, dependencies or background internet polling. Preserve SDK identity/read correlation, cancellation and retained receipts.
- Preserve Unicode, literal rendering, local artifact IDs, excluded context, answer/composer/focus and last recoverable saved research.
- Version120 synchronized release; fresh required gates, package comparison, main push/exactremote, issue records. Native91/live110 exclusions remain.

## Review focus

- Repeated reads must not pair a first-read timestamp with another response's date label.
- A changed status during review or queueing must not silently change an approved prompt.
- A stale unrelated alternative must not invalidate a supported conditional conclusion; missing associations remain unknown.
- Calendar boundaries, future/rollback clocks, conflicting publication/update ordering and imported observations must never imply current facts.
- Dynamic evaluation timestamps must not make every saved ADR/handoff capture instantly stale; preserve metadata without changing existing evidence identity on every view.

## Task1: metadata and pure policy

Files: new web/research-freshness.mjs; model.mjs; new test/research-freshness.test.mjs and fixtures.

- [x] RED deterministic classification/date/boundary/unknown/legacy/bounds tests and model roundtrip assertions.
- [x] Add minimal bounded metadata validation and pure date/status evaluation with injected clock. No network or mutation.
- [x] Integrate optional fields into researchEvidence, selected evidence and import/history; GREEN focused tests.

## Task2: source observations and reviewed use

Files: research.mjs; research-followup.mjs; research-comparison.mjs; research-review.mjs and queue guards if required; packaged research SKILL.md; focused SDK/review/comparison tests and e2e-research.mjs.

- [x] RED actual fetched-text label occurrence, bounded transient text, failed/late/repeated reads and forged/unread date cases.
- [x] Track only bounded successful text alongside existing first-read receipts; validate new model date observations, preserving current tools/permissions.
- [x] RED exact captured freshness context, age-change review rejection, stale material premise/current recommendation guards, prior-source retention and failed/cancelled refresh preserving old evidence.
- [x] Integrate snapshots and bounded guidance/guards without silently replacing approved inputs; GREEN tests and installed anonymous research fixture.

## Task3: readable evidence and sharing

Files: web/app.mjs; offline-viewer.mjs; offline-viewer-runtime.mjs; model Markdown; selected ADR/handoff source presentation as needed; server asset allowlist; DOM/export tests and scripts/check-ui-layout.mjs.

- [x] RED separate dates, unknown/review reasons, scope labels, material recommendation warnings and literal safe export retention.
- [x] Use existing nearby claim/source/support disclosures. Keep Research explicit, user answer independent and old evidence readable. No new workspace or automatic fetch.
- [x] GREEN DOM/export behavior, Brave five viewport keyboard/focus/overflow checks; inspect narrow/wide screenshots.

## Task4: release

- [x] Finish policy docs, synchronized120 metadata/README/release notes and focused checks.
- [ ] One independent final code/spec review; resolve consolidated findings and bind approval.
- [ ] Fresh verify:iteration --allow-ui; package byte comparison; fetch/integrate clean main, push and verify exact remote SHA.
- [ ] Complete issue record, unavailable measured usage and pending seven-day observation; continue next eligible issue.
