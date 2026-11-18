# Card workspace, v0.1.65

Explorer helps people follow branching questions and record their own answers. The approved Option A design keeps the existing Segoe UI typography, blue branch connections and restrained light/dark palette. The card is a writing surface; occasional tools occupy the bottom of the Explorer viewport.

## What changed

- The card contains the question, answer, compact Record control, Save & continue and More options. Voice progress and critical answer recovery remain beside the editor. Voice preferences remain in the global Settings gear.
- More options opens a full-width non-modal drawer outside both the card and transformed map. The drawer takes space from the working view, leaving the map usable above. Expand/reduce and close remain in its header, alongside the selected question. A slim bottom handle reopens the drawer.
- Explore holds explicit follow-up generation, previews and manual directions. Research holds existing research review, results and research follow-ups. Answer details holds state, cleanup, reminders and draft management. Context holds rationale, help, references and branch navigation. Columns use available width and stack in narrow panes.
- Save & continue commits text and state without model generation. It opens an eligible existing next question using the local suggestion or map order when guidance supplies no candidate. It stays on the saved answer when none exists. Failed saves, conflicts and stale completions cannot advance the question.
- The editor stays mounted through drawer toggles, tabs, polling and Map/Outline changes. Answer/state/reminder/manual drafts stay associated with their question. Escape exits an open Revisit this answer chooser first, returning focus to the editor; otherwise it closes the drawer before collapsing the question and returns focus to its launcher.
- Commands, request status and new previews reveal the appropriate tab. Ordinary polling does not reopen a dismissed drawer. Reminder conflicts reveal Answer details; critical answer conflicts remain visible at the editor.
- Compact cards retain reserved footers for status and branch buttons. Very short panes retain manual scrolling and reachable actions. Journey chrome and the map share a scrollable stage above the drawer, so a notice cannot squeeze the card below its usable height.

The selected design and implementation decisions are recorded in [the drawer design](superpowers/specs/2026-11-18-question-drawer-design.md).

[Revisit this answer](revisiting-answers.md) coordinates retaining affected descendants, forking a separate scenario, and restarting a branch. Its bottom-drawer chooser preserves the editor and uses each existing domain workflow; temporarily unavailable or stale choices provide a reason and a recovery action.

## Current verification

The final Brave run passes 550 rendered card samples with no layout failures across 1200x900, 460x780, 360x640, 720x480 and 280x640 in light/dark scenarios. It checks full-width drawer placement, expanded/reduced sizing, tabs, editor/reminder retention, voice states, Map/Outline, zoom independence, multiline notices and card actions within all clipping ancestors. Save & continue makes no model request; explicit Explore deeper uses one local fixture request. Independent code review and the scoped short-height correction review have no remaining findings.

The final full suite passes 702/702 tests; npm run check and npm run package pass. The complete package matches all 68 shipped source files. Native Copilot acceptance is recorded separately after the marketplace update. Hardware microphone behavior, live research quality, screen-reader announcements and OS IME input are not established by these fixtures. The historical results below describe their specific earlier versions.

## Experience verification

### v0.1.64 layout regression checks

The earlier pass concentrated on the expanded writing surface. It missed compact-card overlaps: fixed card heights and an independently positioned branch button occupied the same text space. Long folded/reminder status text also shrank title lines. The new check measures actual rendered text and button rectangles in Brave; DOM-only tests do not catch these CSS failures.

`scripts/check-ui-layout.mjs` uses the real HTTP server/controller with a disposable synthetic journey and voice states. It downloads nothing and starts no model inference. The explicit Explore deeper check reaches one local send fixture and receives a synthetic preview. Run it with an existing Playwright installation and Brave:

```powershell
$env:EXPLORER_PLAYWRIGHT_PATH = 'C:/path/to/playwright/index.mjs'
npm run check:ui -- .preview-data/ui-layout --screenshots
```

`BRAVE_PATH` optionally overrides the standard Windows Brave executable. Screenshots are optional; the JSON report is always written. Check only with the owner's browser-automation permission.

The regression reproduced 214 overlap/line-height failures before the compact-card fix. Additional checks reproduced insufficient status contrast, a hidden answer box when dictation was unavailable, and three banner-height cases where a card could scroll programmatically but not manually. The corrected layout passes 435 rendered card samples across 1200×900, 460×780, 360×640 and 280×640, using light and dark themes, all four zoom tiers, folded branches, answer previews, importance and reminder labels. The same run checks menu bounds, shelf reachability, voice loading/listening/transcribing, draft/editor retention, and closed/open shelves with a multiline error banner. Wheel scrolling, request-status navigation and new previews use the correct scroll container. The smallest measured status-text contrast is 4.66:1. Two focused regressions also verify that adding research at 300% zoom reveals the answer in either scrolling layout without moving the map.

### Earlier v0.1.63 interaction checks

The native pre-publication inspection confirmed Copilot running v0.1.62. Updated shelf/settings rendering and interactions were tested using the installed Brave executable, disposable browser contexts, synthetic journeys, local voice choices and Explorer's real HTTP server/controller. No paid provider or existing user answers were used. Post-publication native acceptance is reported separately from this source verification.

| Brave viewport | Answer visible, shelf closed | Long-question answer visible | Open shelf viewport |
| --- | ---: | ---: | ---: |
| 1200 × 900, light | 116 px | 116 px | 130 px |
| 460 × 780, dark | 116 px | 116 px | 116 px |
| 360 × 640, light | 87 px | 87 px | 75 px |

Checks exercise settings before a card opens, unsaved voice choices and explicit saving, typing/polling without replacing the editor, pointer toggling without losing caret selection, reminder drafts, shelf scroll retention, Escape, Map/Outline switching, dialog focus return, Unicode and long text. Save performs no generation; explicit Explore deeper starts exactly one local fixture request. Pending work and new previews reset the shelf scroll while ordinary toggles retain it. Independent review identified the scroll-reveal bug, verified its failing regression and accepted the correction. Brave identified and verified a narrow heading-height correction to preserve writing space.

Hardware microphone behavior, screen-reader announcements and live research quality are separate acceptance checks. The Brave fixture does not establish them. #41 retains its current requirement and stays blocked; #42 remains blocked, and #44/#49 remain deferred.
