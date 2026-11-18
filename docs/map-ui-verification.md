# Map interaction fixes in v0.1.12

The sweep covered panning, pointer cancellation, text selection, zoom, viewport resizing, keyboard focus, expanded editors, large trees, draft editing, and background updates. The expanding-node design remains in place.

| Finding | Change |
| --- | --- |
| Only empty background could start a drag; a partly visible card or editor blocked recovery. | Compact cards and expanded question headings also drag. Middle-button dragging works over editor content. A movement threshold separates dragging from clicking. |
| Drag gestures could select text or activate a node afterward. | Pan surfaces suppress native selection and the click following a drag. Answer fields and research content retain ordinary text selection. |
| Unrelated pointers or focus loss could corrupt a drag. | Track one pointer, release capture on cancellation or blur, and ignore capture transfer from a child to the map. |
| Maps could be dragged arbitrarily far away. | Bound pan distance to the map's extent; reverse dragging responds immediately at a boundary. Whole map and Center question remain available. |
| A browser could scroll the map independently of its transform when focusing content. | The map and outer frame use `overflow: clip`. Applying research scrolls only the editor's content pane. |
| Zoom was limited and reset whenever the map resized. | Pointer-centered wheel/pinch zoom, controls up to 300%, a percentage reset button, and preserved view on resize. Ordinary editor scrolling stays local. |
| High zoom put expanded controls outside a narrow pane. | Expanded width and height account for zoom. Zoom and editor focus reveal the workspace, while its contents remain scrollable. |
| Whole map stopped at 12%, leaving large trees off screen. | Fit computes the scale needed for the complete tree, including below 10%. |
| A hidden canvas could initialize at nearly invisible scale. | Wait for a nonzero viewport before the first fit. Hiding and showing an existing canvas preserves its view. |
| Keyboard focus could land on an invisible node. | Reveal focused nodes. Add +/−, 0 and Home controls; Escape closes the outline and returns focus. |
| Background redraws lost textarea scroll position, resize height and selection direction, or interrupted IME composition. | Restore editor state and defer replacement during composition. IME confirmation cannot trigger Save & explore deeper. |
| A delayed background response could hide a just-saved answer. | Discard reads that overlap a newer user action. Stop polling/layout work when the canvas closes. |

## Verification

`test/web.test.mjs` executes the shipped browser module against the real HTTP server, controller and temporary exploration files. The new cases cover the failures above, including 340px panes, 300% zoom, wide/deep 103-node maps, capture transfer, out-of-order responses, and input composition. Existing research, answer saving and voice tests remain in the suite. `test/layout.test.mjs` checks nonoverlapping expanded nodes and descendant placement.

The DOM harness supplies geometry because jsdom has no rendering engine. It cannot establish native pointer feel, actual text-selection painting, scrollbars or platform wheel behavior. No browser or desktop UI was automated, per the owner's instructions. Manual Copilot checks still needed: drag a partly hidden node back, select answer text, zoom with the mouse/trackpad, resize a narrow canvas, Tab through an expanded editor, and confirm dictation still feels right.

Browser semantics checked against primary documentation: [MDN overflow](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow) explains why `clip` avoids hidden programmatic scrolling; the [Pointer Events capture algorithm](https://www.w3.org/TR/pointerevents3/#process-pending-pointer-capture) defines capture-transfer events.

## Downstream impact display (v0.1.79)

Automated HTTP/jsdom checks cover child-endpoint bands, line widths/patterns, legend, folded/focused full-map scores, visible Outline text, selected-question labels, saved and same-revision dependency changes, and preserved answer editor/draft/caret. Styles define light/dark colors and forced-color system strokes with unchanged patterns. Export tests verify visible unavailable labels.

Owner native verification pending: choose Connections > Downstream impact in light, dark and Windows high-contrast themes at a narrow width; distinguish short-dash low, long-dash medium and solid thick high connectors; select/review a question and tab through controls; fold descendants and compare the unchanged band; use Outline with a screen reader; switch back to Normal connections. Check legend wrapping, zoomed line legibility, focus visibility and retained answer typing/IME. No browser or desktop automation was used.

Critical paths (v0.1.80): automated tests cover ties, paged Outline reachability, suspended filters/folds, selected and excluded-question navigation, retained card content, draft/caret preservation and safe restoration after saved removals/reparenting or a journey switch. Native keyboard/screen-reader, narrow-pane, light/dark/high-contrast and IME checks remain pending; see [critical-path verification](critical-paths.md).

For v0.1.81 / #66, native checks remain pending: review a changed ancestor and cross-branch dependency in a narrow pane; inspect paged items and long paths with keyboard/screen reader; use Escape and Keep editing to retain exact text/state/caret; confirm once, verify review labels and retained-research warning, and test changed sources, IME composition and page suspension. Confirm ordinary no-impact leaf saves remain direct. No browser or desktop automation was used.
# Impact-aware next question (v0.1.82)

Owner-only: in a narrow native pane, request a suggestion for a high-impact assumption needing review. Check the computed impact, exact downstream counts and separate historical importance are readable with keyboard/screen reader access. Open it, return to another draft and confirm its text/caret are retained. Explicitly deferred questions must stay out of suggestions. These checks are pending; jsdom does not establish native rendering.
