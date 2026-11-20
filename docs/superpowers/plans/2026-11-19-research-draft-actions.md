# Research suggestion draft actions implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. One independent final reviewer is required by the repository workflow. Keep roadmap issues sequential.

**Goal:** Make research suggestion insertion explicit and reversible without losing the user's draft or committing an answer.

**Architecture:** Reuse the existing single answer editor, DraftClient, local draft storage and research result identity. Add explicit append and previewed replace controls within the approved Research drawer. Extend the existing conditional draft undo rather than adding a new persistence format or model operation.

**Tech stack:** Native ESM, Node/jsdom tests, authorized Playwright with Brave. No new runtime dependency or SDK change.

**Spec:** GitHub #97 and approved docs/research-workspace-design.md (append, replacement preview and conditional undo). #93 and #95 provide current option/result identity; #91 native acceptance remains pending and does not block this independent draft work.

## Decisions and boundaries

- Use explicit Append to my draft and Replace my draft… on option suggestions, equivalent labeled recommendation actions, and append/replace selected details. Empty append inserts directly. Preserve existing IDs for append actions where useful; no implicit answer save or model request.
- Replacement opens a local, literal text preview within Research, with Replace draft / Keep my draft. This is a specific user edit confirmation, not a repeated permission request. Do not create a second editable answer textarea. Preserve current text and state until confirmation.
- Bind a proposal to the current journey/page, node, exact result, current saved answer base and local draft edit generation. Recheck live state on confirmation; invalidate on changed source/staleness, edited or recovered draft, removed question, navigation or replaced result. Same-result polling preserves proposal/focus. Cancellation preserves all text.
- Apply only through draftClient.edit; retain deliberate answer states, full Unicode/whitespace, dictation text and the 20,000-character limit. Active composition or answer-save/conflict/recovery must not be overwritten. Cancel owned voice capture at actual application, not simply opening preview, unless existing navigation requires it.
- Replace/append share one conditional Undo draft change, reachable from Research and existing Answer details. Undo only the immediate insertion when the same node's text and generation still match; never overwrite subsequent edits or silently restore an older answer-state selection. Preserve state metadata through normal draft client semantics.
- Successful application reveals/focuses the existing answer editor, keeping Research accessible and results mounted. No duplicate editor or research transcript in exports. Existing private draft persistence/recovery is reused; pending proposal and undo are canvas-local and not exported. Full durable conversation/draft history remains #100.

## Review focus

1. Retained DOM handlers and rapid node/result switching cannot edit another node or apply an obsolete proposal.
2. Composition, in-flight dictation, answer-save completion and draft recovery cannot silently overwrite newer text or state.
3. Unicode/multiline/blank and maximum-length drafts keep exact contents on append, replace, cancel and undo.
4. A late stale marker disables all draft controls and invalidates previews without replacing the editor or resetting caret.
5. Keyboard and narrow/short layouts keep preview, cancel, confirmation and undo reachable with a clear focus destination.

## Task 1: Draft actions and behavioral coverage

Files: web/app.mjs; minimal web/style.css as needed; test/web.test.mjs. Existing web/drafts.mjs API remains unless a demonstrated gap requires a focused extension.

- [x] Inspect all existing addition/undo callers, comparison detail actions, retained workspace refresh, draft generations/composition and answer-save/recovery callbacks.
- [x] Add failing tests for explicit append and previewed replacement on empty/populated drafts, any option/recommendation/combined details, cancel/undo, Unicode/multiline, deliberate answer state and unchanged committed answer before Save.
- [x] Add identity/race tests: navigate away and invoke detached controls, source/result replacement, same-result polling/focus, intervening local edit/state change, stale marker, composition and failed saves. Verify local recovery through the existing store after application and correct journey/node identity.
- [x] Implement minimal actions/preview with current-source validation and generation checks. Reuse existing scroll/focus and DraftClient edit/recovery; no host or transport changes.
- [x] Run focused relevant tests; update previous append-only labels/assertions without dropping behavior. Keep exact output and draft bounds, stale gates and no-auto-save assertions.

## Task 2: Rendered checks and release

Files: scripts/check-ui-layout.mjs, docs/drafts.md, docs/research-options.md, docs/research-recommendation.md, docs/research-workspace-design.md, README and synchronized release metadata.

- [x] Add authorized Brave coverage for replacement preview wrapping/keyboard/focus, cancel, confirmation, undo, draft retention and stale invalidation across existing viewport scenarios. Inspect screenshots; preserve geometry thresholds.
- [x] Document draft-only controls, local preview/undo lifetime and recovery limitations. Bump one patch and add <=400-character release note, preserving older notes.
- [ ] Independent final review, then fresh verify:iteration with ui=true,host=false and --allow-ui (no new SDK behavior). npm test/check/check:ui must pass. Run any extra required focused checks, package and byte-compare.
- [ ] Fetch, check main worktree clean, commit, content-preserving readiness, fast-forward main, push, verify exact remote SHA. Update issue acceptance/completion and close only after publication. No paid models/user sessions; native/physical IME/screen-reader/live quality remain unmeasured. Usage counters unavailable; seven-day regression window pending.

Implementation baseline: v0.1.113, c45c8db86220f129e54316d51dffa09e54e247cc. #95 published and closed; reuse the current isolated worktree on codex/issue-97-research-drafts.

## Implementation tracing notes (read-only preparation)

- Existing research add closure at app.mjs~2880 appends through DraftClient.edit; use-recommendation/add-option-<id>/add-details/comparison-add-details are existing IDs. Only two existing text-based tests depend on Use this option/Use recommendation/Undo addition/Add selected details labels; preserve IDs and update literal labels deliberately.
- ui.addition has only research insertion/undo callers. answerStatus updates Undo addition state. Current undo compares text alone; extend with textGeneration and drafts.has plus saved-base identity so later edit-away-and-back or completed save cannot resurrect an old undo. Preserve current answer state, including later deliberate choices; don't restore a guessed earlier state.
- DraftClient.edit increments generation/edits and textGeneration only on changed text; selectState also edits. Recovery/choose can change textGeneration without edits. Preview snapshot should therefore bind generation AND textGeneration/current base; mere text equality is insufficient. Set undo snapshot after edit returns because its changed callback runs synchronously. No storage format change needed.
- renderWorkspace current() already binds owner, selected node, expanded and connected panel. renderResearch can capture its connected section + journey/result key; retained detached option/confirmation controls must reject even after navigating back to the same question. Store a per-render sync callback in ui (or equivalent existing owner) for answerStatus and workspace.update to invalidate preview; new rendering replaces it. Avoid broad persistent proposal state.
- Generic polling at~2544 resets all [data-draft-suggestion] disabled flags based on stale/selection. Do not put a separately invalidated confirmation under that selector without a final preview-specific sync after it. Closing/replacing a focused preview needs a stable visible focus fallback; ordinary editor typing must not steal focus.
- revealQuestionTool(target) opens the drawer/tab, ancestors and scrolls within it. Answer draft existing handler handles drawer reduction/editor reveal; reuse when applying edits rather than scrolling map ancestors. Preview is literal preformatted text, not another textarea.
- Current undo exists only in Answer details; add reachable Research undo using the same handler, not duplicate state. Selected-details actions from comparison must share preview/apply checks and respect selection-required disabling. Legacy result suggestions must remain explicit.
- Tests use fixture(t,width,voice,useLibrary,options), recommendationFindings(), f.open/f.type/f.poll, real controller/server/storage and synthetic DOM. f.window.__updates.apply allows direct stale/result snapshots. Draft store is available through explorer.readDrafts(activeKey ?? document.id); wait for local status before asserting durable recovery. Full fixtures stay anonymous.
- Undo is a private user edit and must remain available when unrelated source changes make research stale, provided the applied draft/generation/base still match. Only new suggestion application and replacement previews require fresh research. Do not conflate historical evidence with undoing the user's own recent edit.
- Add an oversized selected-detail combination test (four valid modern options, eight bounded detail values each can exceed 20,000 together) for both append and replacement; keep existing text intact and show a specific length notice. Individual option draft max1,000 does not bound the combined selection.
