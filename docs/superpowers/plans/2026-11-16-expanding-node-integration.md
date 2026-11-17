# Expanding node production integration

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the selected expanding-node design in the installed Explorer canvas, replacing the question sidebar.

**Architecture:** Keep the existing controller, HTTP actions, persistence, and Copilot callbacks. Render the selected question as a measured card inside the map's world. A top-down tree, matching the selected prototype, reserves space for the expanded card and connects follow-ups beneath it.

**Tech stack:** Plain browser JavaScript/CSS, Node tests, jsdom for DOM interaction tests only. No runtime dependency or build step.

**Spec:** The owner's request to integrate the selected design, and [the refined prototype](../../prototypes/expanded-node.html). This is implementation of the chosen design, not another prototype iteration.

## Constraints and review focus

- Preserve drafts on navigation, research results, failed saves, and edits made while a save is in flight.
- Keep the question, answer, research, pending/cancel controls, and manual questions inside the expanded node.
- Preserve saved maps and exports; no document schema or SDK changes.
- Expanded nodes must not overlap adjacent branches. Measure their height; keep the selected header anchored during content changes.
- Keep typing, selection, scrolling and keyboard navigation separate from canvas panning.
- No browser/desktop automation. DOM tests verify events/state; final visible desktop rendering remains manual.
- Bump all release versions and publish to `main` under the standing authorization.

## Task 1: Layout and production interaction regression tests

**Files:** `test/layout.test.mjs`, `test/web.test.mjs`, `test/explorer.test.mjs`, root development dependency metadata.

- [x] Add failing tests for variable-size tree packing, descendants below parents, and stable selected-header position when its height grows.
- [x] Add DOM tests that load the actual shipped HTML/JavaScript and use the real loopback server/controller. Click a question and require its answer form inside the map, with no sidebar.
- [x] Cover draft retention, saving/deepening, research callback delivery, option insertion, collapse/overview, and map drag exclusion for inputs. Stub geometry explicitly; do not claim visual coverage.
- [x] Run the new tests and confirm the old UI fails the requested behavior.

## Task 2: Integrate the expanding workspace

**Files:** `web/layout.mjs`, `web/app.mjs`, `web/index.html`, `web/style.css` under the extension.

**Interface:** `layout(nodes, rootId, sizes = new Map())` returns a map of `{x,y,width,height,branch}`. `sizes` supplies measured boxes; compact boxes default to 220 by 110.

- [x] Implement iterative top-down layout with subtree spacing and variable box sizes; run layout tests.
- [x] Replace the sidebar with one expanded card inside `#world`. Measure the card and relayout while retaining its header anchor.
- [x] Move the existing answer/research/manual/pending flows into the card. Add research disclosure, non-destructive option insertion, follow-up links, collapse and overview controls, and saved-answer previews.
- [x] Preserve focus, drafts and disclosure state across asynchronous updates. Limit the card to available canvas space and scroll its contents; keep its heading accessible.
- [x] Run DOM tests and the existing suite. Fix failures before continuing.

## Task 3: Verify and publish the real plugin

**Files:** synchronized version manifests, `release-notes.json`, README and prototype/research status documentation.

- [x] Update docs to describe expanding nodes as the installed layout; retain prototype artifacts as historical references.
- [x] Bump to v0.1.7 and run `npm test`, `npm run check`, and the installed runtime fixture if its paired SDK/runtime are available.
- [x] Review the complete change with a fresh reviewer while checking the packaged assets locally. Resolve material findings and rerun affected checks.
- Publication procedure: commit, fast-forward main, push and verify the remote commit. Record the published hash and remaining manual desktop check in the completion message.

## Execution notes

- The user already selected the design and explicitly requested its integration. Continue implementation without another approval round.
- One release commit will include the complete iteration, following this repository's version-and-publish workflow.
- Final automated verification: all 22 tests passed; syntax/assets/version checks, packaging, and the installed SDK/runtime fixture passed. A package HTTP smoke check confirmed v0.1.7, the in-map workspace, no inspector, source-matching UI assets, and no runtime npm dependencies.
- Fresh review found clipped parent context and lost keyboard focus during research. Regression tests reproduced both; selection now reserves parent space, and focus survives pending state and background updates. A disclosure-state test also caught delayed events from detached elements; current open state is captured before rerender and detached toggle events are ignored.
- No desktop/browser automation was performed. Visible rendering in Copilot and live model quality remain manual checks.
