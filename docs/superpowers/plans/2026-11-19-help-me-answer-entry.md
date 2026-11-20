# Help me answer implementation plan

> Implement inline with `superpowers:executing-plans`; one independent final review. Follow the repository iteration workflow and existing authorization for Brave checks and main publication.

**Goal:** Reach Research from the question in one explicit action before entering an answer, with understandable assistance choices and predictable return focus.

**Architecture:** Reuse the existing drawer, retained answer editor, question-help client and reviewed Research action. Entry and explanation navigation are local UI operations. No SDK, schema, storage or network-policy changes.

**Spec:** [#92](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/92), using the [approved workspace](../../research-workspace-design.md) and published #91 shell (v0.1.109, `e591ce8`). Actual Copilot native acceptance remains pending on #91; its implemented foundation is available here.

## Task 1: Entry and return behavior

Files: `com.github.copilot/extensions/explorer/web/app.mjs`, `web/style.css`, `test/web.test.mjs`.

- Add failing Help me answer tests for empty, researched, unavailable and in-progress questions. Entry must make no helper/research/review call and preserve saved answers and retained editor text/caret/state.
- Cover Close/Escape after polling, tab changes and resize, More options as a separate return target, composition retention, and local navigation to existing explanation controls.
- Run the named tests and observe missing-launcher failures.
- Add `#question-help-open` in the existing answer action row, outside the answer-label/voice grid. It opens Research, reveals and focuses its stable question heading, and remains usable while inference is unavailable or running. An initial row above the editor failed the existing 80px writing-space check at 460px; keep that failed evidence and preserve the original threshold.
- Add concise assistance copy and `#research-explain-question`, which opens the existing Context help summary without invoking it. Retain the explicit Research request review and its error handling.
- Extend `setQuestionTools(open, returnId)` with an optional explicit source ID; polling without a source retains it. Close/Escape restore the visible current-node launcher. Keep launcher expanded state truthful when changing tabs. Preserve existing More options behavior and mounted editors.
- Run focused drawer/research/help tests; expect pass without navigation-side model work.

## Task 2: Rendered checks and release

Files: `scripts/check-ui-layout.mjs`, `docs/card-workspace.md`, synchronized release metadata.

- Extend the existing authorized Brave fixture for Help me answer entry, keyboard Enter/Escape, visible return focus, short/minimum-width writing space and overflow. Keep existing Answer draft/map-transform assertions.
- Update documentation and v0.1.110 release metadata with an accurate note under 400 characters.
- Run rendered checks and inspect screenshots; obtain independent review and resolve findings. Declare ui=true, host=false. Native Copilot, physical IME/dictation and screen-reader experience remain explicitly unmeasured.
- Record review, run `verify:iteration -- issue-92 --allow-ui`, package/compare, fetch/integrate/push main without force, verify exact remote SHA, and update the issue and ignored completion record.

Review focus: current-node visible return target; polling cannot reset launcher identity; local navigation cannot initiate model/retrieval/review operations; long/localized content and voice controls remain usable; no answer/composer remount during navigation.
