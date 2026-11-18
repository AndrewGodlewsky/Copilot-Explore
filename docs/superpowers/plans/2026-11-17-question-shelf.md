# Question Shelf and Global Settings Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for the shelf and settings shell; delegate the independently owned voice controls extraction. Review the integrated change before publishing.

**Goal:** Keep answering a question quiet and direct, with one optional bottom shelf and one global settings gear.

**Architecture:** Retain the existing mounted answer editor and controller. Put supporting question controls in a collapsible shelf within the card; preserve their DOM and drafts when toggling. Extend the existing settings dialog to host persistent voice preferences, map preferences, the command shortcut, storage and diagnostics.

**Tech Stack:** Existing browser JavaScript, HTML and CSS; Node tests/jsdom; installed Brave for real layout and interaction checks. No runtime dependencies or SDK changes.

**Spec:** The owner's follow-up asks to remove per-card voice settings, add a global settings gear and simplify cards to answering and save actions with a manually expandable bottom shelf. Earlier authorization covers reasonable design choices, Brave/Copilot UI testing and publishing each completed iteration to main.

## Design

Explorer remains a calm question map and writing surface, using its existing type, palette and branch connections. A closed shelf shows only its handle. The main card contains the question, answer, compact Record control, Save and Explore deeper. Answer state, cleanup, research, context, references, reminders and manual follow-ups belong in the shelf. Save and Ctrl/Command+Enter retain save-only semantics. Important conflicts and request status remain discoverable; explicit tool actions reveal the relevant shelf content.

The gear opens Settings from Library, Map or Outline. Voice/device/model choices live there once, independently of a selected card. Preferences keep their existing persistence and conflict handling; opening settings never starts capture or model work.

## Constraints and review focus

- Never replace/reparent the answer element when toggling shelf, settings or Map/Outline. Preserve drafts, caret, composition and source identity.
- Closing the shelf must leave focus on a visible control. Programmatic navigation to a shelf tool must reveal it first.
- Long questions, short panes and open shelf content must scroll without hiding the shelf handle or Save actions.
- Recording retains its existing owner; moving focus to global settings cancels it and rejects late audio.
- Keep #41/#42 blocked and #44/#49 deferred. Test, version, package and push the complete iteration to main.

## Tasks

- [x] Extract persistent global voice settings in `web/voice.mjs`; test settings before any card is bound and across editor changes.
- [x] Add the global gear/settings sections in `web/index.html`, wire `web/app.mjs`, retain `web/navigation.mjs` save/conflict behavior.
- [x] Implement one stable card shelf in `web/app.mjs` and responsive styling in `web/style.css`; add behavioral regressions in `test/web.test.mjs`.
- [x] Exercise real Brave layouts, shelf/keyboard/focus/long-text flows and settings. Inspect Copilot desktop where possible without paid inference or changing existing answers.
- [x] Independent code review; fix findings. Run `npm test`, `npm run check`, `npm run package`; synchronize release metadata for v0.1.63.

## Verification and publication

The separate voice implementation and integrated shelf review are complete. Review found retained shelf scroll hiding request controls; the regression failed before `revealQuestionWork()` and passes after it. Rereview found no remaining substantive issue. Brave passed at 1200 × 900, 460 × 780 and 360 × 640; a measured short-pane heading correction preserves at least 87 px of answer visibility with the shelf closed, including long questions. See [workspace experience evidence](../../card-workspace.md).

`npm test`: 694 passed, zero failed/skipped. `npm run check` and `npm run package` passed; all 68 packaged files match source. Runtime integration is unchanged. Pre-publication native inspection found Copilot running v0.1.62. The publication commit, verified remote main and post-publication native acceptance are reported in the delivery message rather than embedded into their own commit.
