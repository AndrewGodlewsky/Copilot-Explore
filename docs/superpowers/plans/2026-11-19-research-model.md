# Dedicated Research model implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, one implementation owner and one independent final reviewer. Keep roadmap issues sequential.

**Goal:** Follow the selected chat model by default and offer an explicit personal Research model choice, with exact reviewed routing and no silent fallback.

**Architecture:** Add a bounded personal preference store beside existing preferences. Resolve host metadata without inference, bind a private model/account capture to research review, and pass only that capture to the existing owned Research helper. Keep unrelated helper routing and shared map schemas unchanged.

**Tech stack:** Existing native ESM, Node tests, installed Copilot SDK/runtime and authorized Brave fixtures; no dependency or SDK download.

**Spec:** GitHub #120, approved owner default/override direction, AGENTS.md, docs/development-workflow.md, docs/copilot-integration.md background work, docs/research-sdk-tools.md. Base must be published97 before implementation.

The current production context review is a separate dialog; its approved move into the drawer belongs to #101. This iteration shows the model in that existing review and keeps its start label Research.

## Constraints and review focus

- Initial Research and Research follow-up only. Future Research explanation can reuse this contract when104 lands. No routing change to attached generation, cleanup, question help, ADRs or Challenge Review.
- Metadata discovery, opening/selecting/saving settings and preparing review perform no inference or retrieval. Never change the attached model or use existing user sessions for tests.
- Preserve isolation, account/entitlement/policy, actual helper model, initialized tools, cancellation, deadline, retained usage and recovery. Model selection grants no new network permission;41/42 remain blocked,110 live requests remain zero.
- Setting is personal, versioned/revisioned, atomic and bounded. Missing file means default. Invalid/linked/replaced files are preserved and rejected. Missing/disabled dedicated choice stays visible until explicitly replaced/reset.
- Review shows effective model and default/dedicated mode; private account identity never enters prompts, browser response, map or exports. Relevant default selection and preference revision changes invalidate before Start; running operations retain capture.
- Preserve the mounted editor, text/state, composition, caret, Research conversation and modal focus. Literal catalog labels, narrow/short layouts and stale-response guards are required.

## Task1: Preference and metadata contract

Files: new research-model-settings.mjs; narrow model-selection functions in a new research-model.mjs or existing owned-helper.mjs as source cohesion warrants; controller/server; focused settings/model tests.

- [x] Write failing tests for absent/default/dedicated/reset/reopen, strict bounded IDs/revisions, duplicate/extra/invalid bytes, linked files/root replacement, competing writers and failed atomic save.
- [x] Implement the existing ContributorSettings private-directory/owned-lock/atomicWrite pattern with modelId:null default, preserving corrupt files and conflicts. No generic preference framework.
- [x] Add metadata-only current model/catalog/auth discovery with sanitized errors and bounded literal id/name projection. Use installed **list({skipCache:true})**, not the currently unsupported refresh property. Validate provider.kind Copilot and enabled/absent policy, account identity and chosen model presence; keep invalid saved preference and explicit reset available.
- [x] Add protected POST api/research-model-settings read/save with strict fields/size/origin, safe controller directory and explicit unavailable preview state. Validate dedicated choice before persisting, allow reset even when catalog unavailable. Tests prove zero inference and no preference in snapshots/exports.

## Task2: Exact reviewed routing and receipts

Files: research-review.mjs, research.mjs, owned-helper.mjs, research-usage.mjs if receipt addition needed, related tests and explicit synthetic metadata fixtures.

- [x] Add failing tests for reviewed default/dedicated selection, preference A-to-B-to-A revisions, default model changes, dedicated independence from chat changes, account/catalog/policy failures, helper model mismatch, running pinning, cancellation and unrelated helper regression.
- [x] Capture model outside AI context/prompt only for ordinary research/followup; expose just effective model and selection mode in review. Check async review order/page identity after metadata reads. Consume compares a fresh preference/catalog/account capture before launch, not browser model IDs.
- [x] Researcher's metadata method supplies discovery; run/runFollowup carry the trusted captured selection to the shared helper. Fresh helper catalog/account checks and actual model validation remain mandatory. Never silently fall back or retry inference.
- [x] Verify actual model stays in retained operation/usage receipts even when no usage event contains it. Prefer a backward-compatible private operation.json model field after actual-model verification; do not duplicate accounting or relabel historical saved research.
- [x] Update fixture-only injected researchers with explicit synthetic model discovery; no production synthetic fallback. Correct supported cache argument with assertions. Installed e2e:research covers dedicated/default routing, actual model receipts and existing cancellation/tools; generic e2e remains required.

## Task3: Settings and reviewed model UI

Files: web/index.html, web/app.mjs (small dedicated module if genuinely cohesive), style.css only as needed, test/web.test.mjs, scripts/check-ui-layout.mjs.

- [x] Add failing UI tests for default/dedicated/reset, unavailable choice, empty/loading/error catalog, stale/closed/suspended replies, no inference, draft/state/composition/focus preservation and reviewed model display.
- [x] Add Research model within existing Settings, with default option, literal catalog names, retained unavailable-choice label, Refresh and explicit Save. Follow existing modal lifecycle/abort/page/journey identity patterns.
- [x] Show effective model/mode in existing research review. A local saved preference refreshes/invalidates only a research review; preserve conversation and other-purpose reviews. Server rejects an externally stale preference/default model on Start.
- [x] Extend authorized Brave fixture for keyboard/narrow/short, catalog loading/errors, review mode and unchanged draft. Inspect rendered screenshots; no paid or existing-session fixture work.

## Task4: Review, verification and publication

- [x] Document default/dedicated behavior, unsupported/removed choices, exact review lifetime and receipt provenance. Synchronize next patch version and <=400-character release note after97's published version.
- [ ] Independent final review on finalized candidate and resolve consolidated findings. Record actual reviewer receipt.
- [ ] Run fresh verify:iteration with ui=true,host=true,--allow-ui and installed SDK/local-model environment, plus relevant e2e:research. Do not edit candidate during gate.
- [ ] Package complete plugin and byte-compare, fetch, integrate clean main without discarding changes, push without force, verify exact remote SHA. Update/close120 only after publication with actual checks and native/manual exclusions. Record unavailable measured usage and pending seven-day observation.
