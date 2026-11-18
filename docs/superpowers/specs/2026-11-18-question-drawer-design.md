# Screen-level question drawer

The owner approved Option A from the interactive prototype on 2026-11-18 and asked for an unslop pass before implementation. The earlier card-local shelf misunderstood their request. The normal journey is answer, save, continue; deeper tools belong across the bottom of the Explorer viewport.

## Approved direction

- Product: a branching question map that helps people develop their own answers.
- Character: calm, deliberate, readable.
- World: a working map with a writing surface, retaining Segoe UI and the existing slate/blue palette.
- Moments: the selected answer and its branching context carry the visual emphasis.
- Signature: restrained blue connections and a selected-card edge.

Keep the question, answer, compact Record control, primary **Save & continue**, and secondary **More options** in the card. Voice preferences remain in the global Settings gear. Successful Save & continue saves without model generation, then opens an existing useful next question; if none exists, remain on the saved answer with clear feedback. Never advance after a failed/conflicted save or a stale completion.

Continuation uses the existing local suggestion when it supplies a different eligible question. Without guidance or a matching suggestion, choose the next eligible existing question in map order, wrapping once. Exclude the current question and questions marked Decided, Not relevant, Revisit later or requiring ancestor review. Do not change the separate suggestion feature's dismissal state. This is an implementation choice to make the approved normal flow work without requiring an objective first.

**More options** opens a non-modal drawer at the bottom of the entire Explorer working viewport, outside the transformed map and outside the card. It takes space from the map; the remaining map and answer stay usable. A slim bottom handle can reopen the tools. Drawer header identifies the selected question and offers expand/reduce and close. Support Map and Outline. The selected question, drawer, focus and drafts must remain coherent when switching questions or journeys.

Use a quiet tab strip for **Explore**, **Research**, **Answer details**, and **Context**. Group existing controls rather than inventing new services. Explore owns explicit follow-up generation and its preview; Research owns its existing review and results; Answer details owns state, cleanup, reminders and draft management; Context owns rationale, help, references and branch navigation. Pending work and command shortcuts must reveal the correct tab. Critical answer recovery stays beside the editor. Preserve all existing operations and protections.

Refine spacing on a 4px rhythm, align labels and controls, use one primary action per task, retain restrained light/dark colors and visible focus. Use wider columns where they help the selected task; stack naturally in a narrow pane. Drawer content scrolls independently and its close/tab controls remain reachable. Expanded mode provides more working space without moving the drawer into the card. Long text, notices, 280px panes, high map zoom and short windows must not overlap controls or strand content.

Keep editor DOM identity, selection, IME composition, voice ownership, unsaved answer/state/reminder/manual drafts and meaningful scroll state through polling and drawer toggles. Escape closes the drawer before collapsing the question and returns focus to its launcher. No keyboard trap in the non-modal drawer. Never open a dismissed drawer repeatedly on polling.

## Alternatives considered

Option B overlays a focused bottom sheet on the map. Option C opens a larger dedicated workspace with a tool rail. The owner selected A because the writing card and supporting tools can share the screen. Expand is available for occasional larger work.

## Constraints and acceptance

Use the installed SDK/runtime only; no host integration changes are planned. No runtime dependencies. Keep #41 blocked under its original requirement, #42 blocked, and #44/#49 deferred. No paid model requests, microphone capture or modification of existing user answers during testing.

Validate real rendering and interaction in Brave with synthetic data, plus Copilot desktop rendering. Preserve compact-card regressions. Run npm test and npm run check; package the complete extension. Version and publish to main under standing authorization after independent review.

Prototype source: `explorer-drawer-prototypes-8f2a.html` in this conversation's retained Orca scratch folder. The prototype is design evidence, not production code. Unslop craft guidance: Damir Sokolovsky, https://heydamir.design/unslop (CC BY 4.0).
