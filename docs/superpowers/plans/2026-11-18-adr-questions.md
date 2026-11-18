# Targeted ADR questions implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Steps use checkboxes.

**Goal:** Help users fill missing ADR reasoning from their saved decision scope, through an explicit queued request and optional candidate acceptance.

**Architecture:** A pure `adr-questions.mjs` prepares bounded scope/format/gap-checklist input and validates ADR candidates. Existing ResearchReview owns the reviewed token; controller owns queue/staleness/acceptance. A small Tools dialog reviews exact input and hands proposals to the existing preview.

**Tech stack:** Existing ES modules, built-in Node APIs and jsdom; installed desktop canvas callback schema. No dependency or new model/helper.

**Spec:** GitHub #77; prerequisites #75/#76. User explicitly authorized sequential implementation, publishing main and recording blockers without approval pauses.

## Global constraints

- Only saved current ADR scope records, global user guidance, explicitly included recorded evidence, selected-record revisit conditions and saved validated template layout. No automatic project read, unselected answers, template body, research prose, historical model rationale, drafts or previous artifacts.
- Scope freshness and scenario policy must be current. Use bundled layout if no saved format. Saved repository structure is historical preferences, not a fresh file read.
- Six explicit semantic checks: drivers, considered options, rejected alternatives/reasons, outcome/reasons, consequences, revisit conditions. The model assesses these from text; deterministic code must not claim completeness from keyword matches or answer state alone.
- 0-3 optional questions. Zero means model found no material gap in supplied context, never approval/readiness or proof. Questions must not duplicate saved question wording (case-insensitive), including on edited acceptance. Preserve answer states/review flags and missing rationale as unknown.
- New purpose `adr-questions`; root-anchored review token, focal-question destination. Existing attached-session send mode enqueue. No implicit research/helper/general mode. Native callback may only stage; user explicitly accepts into map.
- Whole-document digest guards this request through pre-dispatch, callback and acceptance, including format/scope/revisit changes. Scenario identity separately checked; existing session/instance/request checks retained. No durable new schema field.
- Actual instructions+prompt <=128KiB; reject rather than truncate selected scope. Existing10minute single-use review and strict HTTP protections reused.
- Preserve connected editor drafts/caret and lifecycle ownership. Native checks remain owner-only. Release .93; full suite/check/package and installed local SDK fixture; one final independent review.

## Review focus

- A complete-looking decided answer does not imply all rationale exists or authorize an ADR; empty results remain dismissible, unsaved advice.
- Scope/format changes during queued policy awaits or external writes reject before dispatch, candidate staging and atomic acceptance.
- Model explanation of a question never becomes user decision rationale; tentative/assumption/needs-review remain explicit.
- Exact duplicate rejection covers proposed and edited questions without disclosing unselected answer text.
- Suspended/closed/switched UI cannot revive review authority or cause an old callback to write a map.

### Task 1: Pure ADR inquiry contract

**Files:** new `com.github.copilot/extensions/explorer/adr-questions.mjs`, `test/adr-questions.test.mjs`; `research-context.mjs` explicit ADR digest check.

**Interfaces:** `prepareAdrQuestions(doc,{scenario,prefix,requestId})` returns operation,requestId,targetId,context,instructions,prompt,bytes,limit,coverage,dependencies. `validateAdrQuestions(doc,parentId,values)` accepts0..3 bounded existing question records and rejects duplicates against all saved ordinary questions; controller uses for callback and edited acceptance. Digest field `adrQuestionsDigest` works with `sameResearchSources`.

- [x] Write tests for incomplete/complete text fixtures: unchanged saved reasons vs missing reasons, six check descriptions, chosen layout, selected revisit, retained answer states, no implicit unselected input or generated rationale, freshness, strict size and duplicate/count constraints.
- [x] Run `node --test test/adr-questions.test.mjs`; expected missing contract failure.
- [x] Implement bounded pure preparation using prepareAdrScope and validated layout. Prompt asks model to identify unanswered material gaps, cite relevant source IDs in question rationale, avoid repeated settled questions and output no commitments. Keep root token/focal destination distinct.
- [x] Run pure tests plus `test/adr-scope.test.mjs`; expected pass.

### Task 2: Review, queued dispatch and optional completion

**Files:** `research-review.mjs`, `controller.mjs`, `canvas.mjs`, new `test/adr-questions-workflow.test.mjs`.

**Interfaces:** ResearchReview purpose adr-questions accepts exactly action,clientId,journey,nodeId(root),purpose,sequence. Controller action adr-questions accepts journey,nodeId(root),token,revision plus common action/scope envelope. request questions uses prepared.targetId; preview.purpose adr-questions. submit_questions schema permits0..6; runtime ADR validates0..3, normal questions remain1..6. Zero stages an empty unsaved preview, not a map mutation.

- [x] Add workflow tests for exact reviewed enqueue/no model before start,0..3 proposals, explicit acceptance, ordinary empty rejection, reviewed-token purpose/expiry/cancel, current scope, format/map/scenario/disk changes, final async source changes, edited duplicate rejection and strict HTTP boundary.
- [x] Run workflow tests; expected unsupported purpose/action failures.
- [x] Implement through existing request/preview/commit guard; capture purpose and recheck all ADR sources before dispatch just as regeneration does. Strict callback validation before staging. No new model operation/tool permissions.
- [x] Run `node --test test/adr-questions-workflow.test.mjs test/question-preview.test.mjs test/question-regeneration.test.mjs`; expected pass.

### Task 3: Explicit ADR question review and host fixture

**Files:** `web/app.mjs`, `web/index.html`, `web/style.css`, `web/research-review-client.mjs`, `test/web.test.mjs`, `scripts/e2e.mjs`, applicable canvas schema test.

**Interfaces:** Tools/Commands ADR questions opens modal with saved-scope requirements, selected format/checklist summary and exact input disclosure; Generate reviewed ADR questions, Refresh saved context, Close. ResearchReviewClient purpose special case sends no ordinary settings/excluded. Candidate preview ADR title, empty explanation and disabled acceptance, stale retry returns ADR review.

- [x] Add failing jsdom tests for prepare/no-send, exact explicit generation, draft/caret preservation, empty result, stale source refresh, closed/suspended late review response and correct retry routing.
- [x] Run named ADR questions UI tests; expected missing controls.
- [x] Implement UI with text-only rendering and normal API ownership. Closing/pagehide/journey changes cancel review. Existing preview is the only proposal state.
- [x] Extend installed fixture to save scope, review/request, invoke0..3 ADR callback, reject ordinary empty and cross-session/old-request behavior, accept only explicitly. Installed canvas.d.ts inspected: declaration schema serialized, handler receives provider instance/session context; no substitute SDK.
- [x] Run named UI tests and installed local runtime fixture against release .93; expected pass. Native UI checks explicitly pending.

### Task 4: Release and issue record

**Files:** `docs/adr-questions.md`, README, plan, manifests/lock/release notes.

- [x] Document optional semantic gap assessment, exact supplied context vs attached chat history, no readiness guarantee, source invalidation and compatibility.
- [x] Synchronize .93 and <=400character release note. Run one fresh final whole-change review, fix material findings once with RED/GREEN, ledger all rulings.
- [x] Run full `npm test`, `npm run check`, `npm run package`, installed fixture, diffcheck; expected pass. Task-done check gate references full independently recorded run, no duplicate full suite.
- [ ] Commit one issue-sized release, fetch/integrate/pushmain and verify remote; completion comment with actualchecks/nativepending then close77. Retain caller worktree and ignored audit notes for continuity.

Rulings: one issue release commit means reviewer inspects full working-tree diff/new files, not empty HEAD range. User authorized implementation and main publication, so no intermediate approval wait. Native UI checks remain pending rather than automated. Existing read-only source review is reused, no new external access.
Final verification before publication: 1060/1060 npm tests passed; npm run check, npm run package, installed local SDK/runtime e2e and git diff --check passed. Independent review recovery finding reproduced for dispatch/callback failures and fixed with RED/GREEN tests. Native UI/live quality remain owner checks. Publication outcome is recorded in issue77 and Git history.
