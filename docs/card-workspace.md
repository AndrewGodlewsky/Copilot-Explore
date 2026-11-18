# Card workspace, v0.1.62

Explorer helps people follow branching questions and record their own answers. The visual direction is a calm map with a readable writing surface: keep the existing Segoe UI typography, blue branch connections and restrained light/dark palette. Give the selected question and answer priority. Disclose supporting tools where they are useful. Use spacing and hierarchy rather than decorative effects to distinguish the workspace.

## What changed

- Answer editing comes before context, references and research. Save, Answer state and Explore deeper sit outside the scrolling content so they remain reachable.
- Save and Ctrl/Command+Enter commit the answer and state. Only Explore deeper also asks for follow-up questions. Existing pending-request and draft conflict checks still apply.
- Question context & tools contains ancestors, branch controls, explanations, importance, model help and references. Revisit this question opens optional reminder controls, including existing reminders and conflicts.
- File holds library/import/recovery/export actions; Tools holds helpers, dashboard and map settings. Journey details contains guidance, mode, progress and AI context controls. Critical request and recovery notices remain visible.
- The question title is selectable. Typing, draft status updates and map-height changes no longer move the active card vertically. Outline keeps the same mounted editor and gives its stacked layout enough writing space.
- Menus close before opening dialogs and return focus to their visible launcher. Leaving branch focus returns to visible controls. Close question accurately describes the same action in Map and Outline.

## Experience verification

The installed Copilot desktop canvas was inspected before changes; that running canvas reported v0.1.56. Updated rendering and interactions were tested using the installed Brave executable, disposable browser contexts, synthetic journeys and Explorer's real local HTTP server/controller. No paid provider or existing user journey was used.

| Brave viewport | Before: answer visible on opening | After: answer visible on opening |
| --- | ---: | ---: |
| 1200 × 900, light | 0 px | 116 px |
| 460 × 780, dark | 0 px | 116 px |
| 360 × 640, light | 0 px | 107 px |

Checks exercise typing and polling without replacing the editor, stable question position, scrolling without moving the map, references, reminder drafts, Map/Outline switching, menu/dialog focus, Escape, saving without generation, and closing/reopening a question. Outline's short-pane answer visibility was also measured and corrected. Regression tests cover save semantics, editor ownership, viewport anchoring, text selection and focus restoration.

Fresh native rendering of this version, hardware microphone behavior, screen-reader announcements and live research quality are separate acceptance checks. The Brave fixture does not establish them. The blocked privacy requirement in #41, other runtime blockers and deferred roadmap issues are unchanged.
