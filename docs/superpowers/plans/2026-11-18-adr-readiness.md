# ADR readiness implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkboxes.

**Goal:** Explain recorded ADR gaps and block stale or invalid references without approving decisions, changing answers or losing manual wording.

**Architecture:** A pure readiness module checks draft structure and current saved sources. The existing ADR HTTP workflow returns reports and recomputes them under the acceptance writer lock. The existing dialog shows reasons, navigation and optional acknowledgments, keeping its connected editors intact.

**Tech stack:** Existing ES modules, Node built-ins, HTTP and jsdom. No dependencies, model calls, web access or implicit repository reads.

**Spec:** GitHub #79; #78 shipped in v0.1.94. The user authorizes sequential implementation/publication and asks for genuine blockers in issues. Routine design choices below are implementer rulings, not additional owner approvals.

## Design and constraints

- Deterministic source/structure checks explain what saved data establishes. A model critique adds cost and unverifiable semantic judgments; a readiness score hides uncertainty. Use neither.
- Free prose has no reliable structured rationale field. Report an advisory asking the user to check the recorded reason; do not infer rationale from keywords. Separately identify an empty outcome and an outcome without a settled selected answer. Missing alternatives and unchanged tentative/assumption/needs-evidence/review states are advisory. Changed/missing references and changed capture inputs block acceptance.
- Reports include stable gap IDs, code, severity, reason and target question/section/control. No numerical confidence score. At most 640 items for the existing 100 sources and 35 statements.
- A canonical digest binds exact draft wording/capture and current relevant saved inputs/scenario, excluding acceptance timestamp and readiness receipt. Unrelated answers and private drafts do not invalidate it. Current review causes and included evidence staleness participate even when answer text is unchanged.
- Optional `adrDraft.readiness` receipt is `{version:1,reviewedAt,digest,acknowledged:[unique 64hex IDs]}` with at most 640 IDs. Existing artifacts without it remain valid. Acknowledgments are judgments, never source facts, approval or an exemption from blockers. Changed inputs leave receipts historical. User attribution is #81.
- Generated/injected helper output cannot supply a readiness receipt. Pure generation and prompts remain unchanged.
- Correcting an answer may resolve a current-state advisory while leaving the old capture stale. Preserve title/statement edits; do not silently rebase provenance. Source navigation hides the dialog and uses the normal saved question editor. Draft targets focus their section or statement.
- Native layout/accessibility/IME checks remain owner-performed; browser/desktop automation prohibited. Formal decision status, Markdown writing/export and durable ADR provenance links remain #80/#84/#85. Future write/export must reuse the readiness checker.
- One issue-sized release commit; synchronous versions .95 and newest release note <=400 characters; full tests/check/package and one independent whole-change review. No SDK wiring/helper change expected, so installed runtime is required only if that scope changes. Retain ignored audit workspace after the prior cleanup rejection.

## Review focus

- Rationale and source-state uncertainty must not become a false correctness judgment or automatic decision approval.
- Receipts must not silently remain current after edits, template/source/scenario changes, reordered serialization or imports.
- Navigating to and correcting a source must retain connected ADR wording and expose old capture staleness.
- A late readiness response after edits, source changes, hide, switch or suspension cannot restore acceptance authority.
- Acceptance must check the exact edited wording and acknowledgment IDs against fresh disk/scenario under the writer lock, including its final asynchronous guard.

### Task 1: Pure readiness and receipt contract

**Files:** new `com.github.copilot/extensions/explorer/adr-readiness.mjs`, `test/adr-readiness.test.mjs`; update `adr-draft.mjs` optional receipt validation.

**Interfaces:** `adrReadiness(draft,doc,scenario)` returns `{version:1,digest,items,blockers,advisories,acknowledged}`. Items have `{id,code,severity,reason,target}`. Targets are `{kind:'node',id}`, `{kind:'section',section,statementId?}`, or `{kind:'control',id}` for existing scope/format/guidance controls. `captureAdrReadiness(report,submitted?)` validates optional `{digest,acknowledged}` against current advisory IDs and returns a server-timestamped receipt; blockers or mismatched digest reject. `validateAdrReadinessReceipt(value)` lives in adr-draft to avoid adding an import cycle.

- [x] Write tests for partial/settled sources, specific missing/changed/unsupported reference locations, missing outcome/alternatives and unconfirmed rationale, unchanged review flags, optional acknowledgment, canonical personal/shared receipt roundtrip and imported historical state. Assert changed text/template/source/evidence/scenario/review causes invalidate; unrelated answers do not; answers untouched.
- [x] Run `node --test test/adr-readiness.test.mjs`; expected missing module/export RED.
- [x] Implement bounded deterministic reports and strict optional receipt schema; no side effects or model work.
- [x] Run readiness plus ADR draft/scope/format tests; expected GREEN.

### Task 2: Current reports and guarded acceptance

**Files:** `controller.mjs`; workflow tests in `test/adr-draft-workflow.test.mjs` and pure tests as needed. Reuse existing server ADR endpoint/limits.

**Interfaces:** `api/adr-draft` action `readiness` accepts exact `{action,id,journey,edits}`. Edits are title/statements for its retained proposal (including stale), or null for the saved artifact. Returns `{id,readiness}` after fresh scenario/disk checks, no save/helper. View/poll returns base readiness for the unedited retained proposal/saved draft. Accept optionally accepts top-level `readiness:{digest,acknowledged}`; always recomputes and blocks correctness errors, even for older callers without this field. Save a trusted receipt with the proposed wording and recheck in final writer guard.

- [x] Write tests for read-only reports, manual edits, stale reports still explain retained sources, cross-request/unknown fields and IDs, optional no-ack compatibility, receipt persistence, acknowledgment mismatch/blocker rejection, no injected helper receipt, source/scenario/external-writer changes during final awaits.
- [x] Run workflow tests; expected unsupported action/receipt contract RED.
- [x] Implement strict routing, current reports and guarded acceptance using Task1; keep existing queue/isolation and source authority.
- [x] Run workflow/readiness plus neighboring artifact/review tests; expected GREEN, no answers/drafts mutated and no helper called for readiness.

### Task 3: Inspectable readiness in the ADR dialog

**Files:** `web/app.mjs`, `web/index.html`, minimal `web/style.css` if needed, `test/web.test.mjs`.

**Interfaces:** ADR-only readiness region shows blockers and advisories, Check readiness, optional proposal acknowledgment checkboxes, source/section navigation. Base report may display automatically for untouched wording; edits invalidate report and acknowledgments until explicitly checked. Accept requires a current UI report but not acknowledged advisories. Saved artifacts show recorded judgments only if current, otherwise historical. Readiness request has its own epoch/abort and does not replace editor DOM; hide/switch/suspend/source change/edits/save invalidate late results. Existing save-in-flight read-only protection remains.

- [x] Write named tests for report/reason rendering, edit/check/optional-ack acceptance, source and section navigation, source correction with retained manual text/caret and remaining stale blocker, invalidation and late responses, unknown/removed targets and saved historical acknowledgment. Update earlier ADR acceptance UI tests to check changed wording explicitly.
- [x] Run named tests; expected missing controls/new behavior RED.
- [x] Implement readiness rendering and request lifecycle with text-only content and connected editor preservation.
- [x] Run named ADR draft/readiness UI and neighboring handoff/brief tests; expected GREEN. Native checks pending owner.

### Task 4: Release and issue record

**Files:** docs/adr-readiness.md, docs/adr-drafts.md, README, plan, version metadata and release notes.

- [x] Document judgments versus facts, semantic limits, exact report invalidation, stale capture correction and future write/export integration; bump .95 consistently.
- [x] Obtain one independent whole-change review. One Important late view/poll readiness race reproduced in four RED tests and fixed; all 24 focused ADR/readiness/handoff UI cases GREEN. No minors or re-review loop.
- [x] Run npm test/check/package and diff check; final full suite 1116/1116 passed. One existing research-test fixture startup race was reproduced with a delayed policy check and fixed by awaiting actual helper start; 16 tests and ten whole-file repetitions passed. Check/package passed for .95; no SDK session configuration or prompt changed. Use check as the task-done gate referencing the recorded full-suite result.
- [ ] Commit/integrate/push main without force, verify remote, comment/close #79 with actual validation and rulings, continue #80. Publication proof belongs in the issue record after the release commit.
