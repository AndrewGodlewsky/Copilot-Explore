# Research limitations implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. One implementation owner and one independent final reviewer, as required by the repository workflow.

**Goal:** Explain conflicting or insufficient evidence beside affected research choices and identify a practical next step when a recommendation cannot be justified.

**Architecture:** Extend versioned saved research with optional bounded `limitations`. Reuse existing model validation, native disclosures, artifact projection and helper context packing. These are model interpretations, not an automated fact checker; user answers remain independent.

**Tech stack:** Native JavaScript modules, Node test runner, JSDOM and authorized Brave fixtures; installed Copilot SDK only.

**Spec:** Approved [#107](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/107), [research options](../../research-options.md) and [statement support](../../research-support.md). Baseline v0.1.118, commit62669899.

## Constraints and contract

- No additional retrieval/model authority, dependencies or ambient context. Sources remain retrieval records, never verified truth. Follow SDK handoff and research-tool findings.
- Optional `limitations`: at most12 entries `{id,kind,summary,claimIds,optionIds,decisionIds,blocksRecommendation,nextStep}`. IDs use existing evidence-ID rules, unique within the array. Kinds: conflict, missing-evidence, assumption, unanswered-question, dependent-sources.
- Summary/nextStep are nonblank, at most600 UTF-16 units. Reference arrays contain distinct known IDs: at most3 claims,4 current options,8 captured assessment decisions. Empty scope means the whole question. Unknown fields/references reject, never clip.
- Requires `optionsVersion:1` and an assessment. A blocker requires null recommended option. When structured limitations exist, null recommendation requires a blocker with a concrete nextStep. Missing legacy coverage stays unknown; an empty array never promises all evidence was checked.
- Retain existing12claims/15sources/3paraphrases and160000-byte aggregate/80000-character helper bounds. No global migration. Existing zero/one-option explanations remain.
- Use the approved bottom-drawer layout: options first, local native disclosures, deeper evidence expandable. Preserve answer/composer ownership, focus and saved disclosures through polling; replacement resets them.

## Review focus

- Circular repetition must not become independent corroboration; structural validation cannot detect a semantically false conflict.
- Scoped nonblocking gaps must not prevent use of unrelated conclusions or the user's own answer.
- Reconsidering hypothetical priorities cannot establish missing evidence or change actual saved constraints.
- Exported context references must not leak identities or answer bodies outside the selected artifact.
- Long Unicode, absent legacy fields and narrow expanded disclosures must stay usable without false all-clear labels.
- Review corrections: selected ADR/handoff claims carry at most12 structured claim/whole-question qualifications, excluding option/prior-decision identities and bodies. Keep them in validation, helper inputs, captures, freshness and appendices. Disclosure IDs use per-render ordinals under the existing research-key reset to avoid delimiter collisions.

## Task1: validated limitations and behavioral fixtures

Files: model.mjs; new test/helpers/research-limitations.mjs and test/research-limitations.test.mjs.

- [x] RED cases for contradictory sources, circular citations, sparse/zero choices, reasoning-only unavailable retrieval and conflicting historical constraints; include a nonblocking qualified winner.
- [x] Add minimal strict validator, known-reference checks and abstention consistency. Cover malformed/duplicate/unknown IDs, bounds, Unicode, no mutation and legacy compatibility.
- [x] GREEN focused model tests, saved history/reopen/import retention and independent answer editing.

## Task2: helper context and sharing

Files: research/skills/explorer-research/SKILL.md, research-followup.mjs, research-comparison.mjs, model.mjs, offline-viewer.mjs, offline-viewer-runtime.mjs; focused SDK/comparison/export tests and scripts/e2e-research.mjs.

- [x] RED scoped retention/remapping/privacy/omission and blocked-reconsideration tests.
- [x] Add helper guidance for supported scope/date/method disagreements, dependence, practical next evidence and explicit reasoning; never source-count votes or invented precision.
- [x] Preserve records in optional followup evidence with explicit omission/historical caveats. Reject a new winner from tool-free reconsideration while prior recommendation blockers remain; preserve useful comparisons and manual answers.
- [x] Render Markdown scope and full records; project offline IDs to artifact-local limitation/option/claim/context IDs and display literal text. Run focused GREEN and installed anonymous research fixture.

## Task3: nearby usable disclosures

Files: web/app.mjs, web/style.css as needed, test/web.test.mjs, scripts/check-ui-layout.mjs.

- [x] RED affected-option/claim scope, overview, visible abstention next step, legacy unknown and draft/composer/focus/polling tests.
- [x] Reuse native disclosure state and existing compact styles; no new workspace, automatic navigation or request.
- [x] GREEN DOM and Brave five-viewport/keyboard/overflow checks, including offline export. Inspect narrow and wide screenshots.

## Task4: release

Files: new docs/research-limitations.md, related docs, synchronized metadata/README/release-notes.

- [x] Document model-interpretation and verification limits; bump119 and accurate short release note.
- [ ] One independent final review; resolve findings and bind approval to final candidate.
- [ ] Fresh verify:iteration --allow-ui, package and byte comparison; fetch, safe main integration, push and exact remote verification.
- [ ] Issue acceptance/completion record, measured usage or unavailable, native91/live110 exclusions, pending seven-day observation. Continue next eligible issue.
