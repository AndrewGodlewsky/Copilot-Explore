# Card workspace, v0.1.64

Explorer helps people follow branching questions and record their own answers. The visual direction is a calm map with a readable writing surface: keep the existing Segoe UI typography, blue branch connections and restrained light/dark palette. Give the selected question and answer priority. Disclose supporting tools where they are useful. Use spacing and hierarchy rather than decorative effects to distinguish the workspace.

## What changed

- Compact map cards reserve a footer for status and branch buttons. Titles and answer previews keep complete lines, long statuses truncate with the full text in a tooltip and accessible label, and each zoom tier shares the same footer geometry.
- The expanded card with its shelf closed contains the question, answer, compact Record control, Save, Explore deeper and one bottom Question tools handle. Voice progress and errors follow the answer box. Save actions stay outside the scrolling content in normal panes. Very short panes scroll the whole card so banners cannot make its controls unreachable.
- Save and Ctrl/Command+Enter commit the answer and state. Only Explore deeper also asks for follow-up questions. Existing pending-request and draft conflict checks still apply.
- Question tools holds answer state, cleanup, reminders, context, references, research and manual follow-ups. Its scroll position and edits survive normal toggling. Escape closes the shelf and returns focus to its handle. Commands reveal the shelf and relevant disclosure before activating a tool.
- Explore deeper, request-status navigation and new question previews open the shelf at the work's beginning. Ordinary polling never repeatedly reopens a dismissed shelf. Critical answer conflicts remain beside the editor; reminder conflicts reveal their shelf.
- The global Settings gear is available from Library, Map and Outline. Voice preferences mount once, independently of an answer, alongside Map and motion, Keyboard, and Local data and diagnostics. Unsaved voice choices survive question switches and dialog close/reopen. Opening Settings cancels dictation; it never starts capture or inference.
- File holds library/import/recovery/export actions; Tools holds helpers and the dashboard. Journey details contains guidance, mode, progress and AI context controls.
- The question title is selectable. Typing, draft status updates and map-height changes no longer move the active card vertically. Outline keeps the same mounted editor and gives its stacked layout enough writing space.
- Menus close before opening dialogs and return focus to their visible launcher. Leaving branch focus returns to visible controls. Close question accurately describes the same action in Map and Outline.

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
