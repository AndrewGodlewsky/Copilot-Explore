# Research statement support implementation plan

> Execute inline with executing-plans, one implementation owner and one independent final review. Baseline: published v0.1.117 / 9e54fca. Use the existing isolated worktree and authorized main publication workflow.

**Goal:** Make the support behind option tradeoffs and recommendation premises inspectable beside the statements, without implying a fetched page verifies them.

**Spec:** Approved issue #105 and the per-option/claim disclosures in docs/research-workspace-design.md. The owner delegated implementation choices and resumed sequential issue execution; no new retrieval or layout approval is implied.

**Architecture:** Keep option strings, optionsVersion: 1 and existing bounded claims/sources. Add optional `support` entries to research, each `{optionId,field,text,claimIds,decisionIds}`. `optionId` is a current stable ID for `pros`/`cons`, or null for `recommendation`/`mainTradeoff`/`reconsiderIf`. Text must match a current complete literal statement after existing string validation. A target may occur once; reordered unchanged statements remain linked. Up to 35 targets (32 tradeoffs plus 3 recommendation fields), up to 3 known distinct claims and 8 distinct historical decision references per entry. Empty/missing links mean unknown support. Historical decision IDs must refer to the captured recommendation assessment, never arbitrary current map nodes. Source relevance/entailment remains model interpretation.

**Implementation choices:** Optional associations preserve old documents and avoid rewriting strings as structured objects. Automatic fuzzy matching was rejected because revised prose could silently inherit unrelated evidence. A semantic verification model pass would expand cost/authority without establishing truth, and is outside #105. Description/fit remain explicitly model explanation/contextual judgment; saved criterion cells retain #96's unknown-support wording. This issue maps the required pros/cons and recommendation premises.

**Tech:** Existing ES modules, node:test, JSDOM, installed Copilot SDK/local fixture and explicitly authorized Brave. No new dependency or network/tool capability.

## Constraints and review focus

- UI=true, host=true conservatively for the packaged helper contract. Preserve source read accounting, model capture, exact review and current 160,000-byte / 80,000-character result limits. Claims<=12, sources<=15, evidence<=3 unchanged.
- Reject malformed/unknown/mismatched references; do not promote structural validity to factual verification. Irrelevant/contradictory source paraphrases remain visibly unverified with limitations. Missing factual support is visible, including legacy data.
- Existing user answers/drafts, generation guards and view identities remain authoritative. Disclosure toggles make no model call and do not navigate. Preserve mounted editors/composer, keyboard focus and narrow wrapping.
- Imported sources retain imported provenance; historical user-context states never become current facts. Offline artifacts must remap option/claim/context identities and omit unselected original node IDs.
- Followup packing may omit records. Include associations with historical evidence, but never imply omitted option/evidence bodies were read. Reconsideration already captures complete prior research.

## Task 1: Bounded support contract and persistence

- [x] Add test/helpers/research-support.mjs with sourced, reasoning, unknown and historical-context examples, including irrelevant/contradictory passages and unsupported prose.
- [x] RED then GREEN test/research-support.test.mjs: exact targets, reordering, changed/removed text, malformed/unknown/duplicate refs/targets, 35/3/8/byte bounds, Unicode and legacy rejection/compatibility.
- [x] Implement researchSupport(value,result) in model.mjs after validation of options/assessment/claims. Optional field only for versioned results; include in returned validated research and aggregate output bounds.
- [x] Test imported provenance, native save/history/reopen, no mutation and stale research retaining historical associations.

## Task 2: Helper guidance, portable representations and reviewed followup

- [x] Read writing-for-agents guidance before updating packaged skill; request exact support entries without inventing citations or user-context refs, explicitly label reasoning/unknown and retrieval-only receipts.
- [x] Extend anonymous SDK fixture coverage for accepted mappings and rejection of missing source/wrong target/context identities; keep compatible older helper output visibly unknown instead of making evidence up. No new mandatory retrieval.
- [x] Add toMarkdown near-statement support labels/IDs; keep full claim/source/limitations sections. Render legacy unknown statuses.
- [x] Extend offline-viewer projection and runtime: remap claims and options; assign projection-local dN IDs to captured decision refs and map support decision IDs to them, retaining selected-only node navigation. Near-statement native details with text-only content and validated links.
- [x] Put optional support inside the existing followup evidence candidate; update omission caveat. Test no dangling resolution/invented source or excluded answer-body disclosure. Keep existing count/budget packing.

## Task 3: Inline support disclosure

- [x] RED then GREEN live DOM tests: each pro/con and recommendation field has concise visible status; expansion shows exact claims, source paraphrase/limitations, historical context qualifiers and unknowns. Existing described/fit judgments remain clearly labeled.
- [x] Implement small local helpers in renderResearch, reusing sourceLink/retrieval/disclosure. Stable IDs by option/field/index for view state; support lookup by stable option ID/field/exact text. Do not use HTML interpolation or add navigation/model calls.
- [x] Style compact native disclosure controls within option list items and recommendation blocks. Retain focus/drafts/composer/disclosure state across polling and reset on research replacement.
- [x] Add Brave fixture inspection across five sizes: narrow/short wrapping, keyboard expansion/close, visible contrary/irrelevant/unknown caveats, draft retention and no unsolicited inference. Inspect screenshots.

## Task 4: Release

- [x] Document contract/limitations and newest release 0.1.118; synchronize all metadata/README/lockfile/release notes. Update this task record before final review.
- [ ] Independent review of final candidate; fix findings with RED/GREEN and bounded rereview. Record actual reviewer receipt.
- [ ] Run fresh verify:iteration --allow-ui, additional installed anonymous e2e:research, package and byte comparison. No tracked edits during gates. Required checks cannot be waived by token targets.
- [ ] Fetch, integrate into clean main without discarding work, push and verify exact remote SHA. Update #105 DoD/comments/close only for delivered acceptance; record native #91 pending, live #110 calls: 0, usage unavailable and seven-day observation pending.
