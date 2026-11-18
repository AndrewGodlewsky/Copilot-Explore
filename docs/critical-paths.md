# Critical paths: decision influence

Choose **Critical paths** above the map to inspect influential decisions and unresolved recorded dependencies. This is a temporary local navigation view, not a project schedule, a mathematically unique path, or a recommendation to change an answer. **Return to previous view** restores your earlier navigation.

## What is highlighted

Every ordinary saved question qualifies if either rule applies:

- Its [downstream impact band](decision-impact.md) is **High**.
- It participates in at least one explicit dependency and needs review or has an unresolved state: Unanswered, Tentative, Assumption, Needs evidence or Revisit later.

Decided and Not relevant are treated as resolved unless their review flag is set. Unlinked low/medium questions are not highlighted merely because they are unanswered. Draft text and draft state never change eligibility. All qualifying ties are included; there is no arbitrary winning chain. Sparse recorded relationships may omit real-world dependencies.

The view includes the complete explicit dependency component around each highlighted question in both directions, including resolved intermediate questions and alternative routes. These additional questions are **context**, not inferred critical decisions. Their tree ancestors are also included so the projection remains a navigable tree. An ancestor added only for navigation does not pull in another unrelated dependency component. The selected question and its ancestors remain available as context even when they do not qualify.

Tree connectors still show tree structure; they do not depict every cross-branch dependency. Use **Question tools > Context** for the explicit relationship lists and full-map impact counts/paths. The impact connection style retains its existing child-endpoint meaning. A densely connected map may remain almost entirely visible; the view does not invent separations to make it smaller.

## Reading and leaving the view

Highlighted cards have a solid top border; context cards have a thin dashed top border. Existing selection/keyboard outlines and needs-review labels remain separate. Card tooltips and accessible labels state the reason. The selected workspace and each Outline row show the reason as visible text. Outline retains its existing 200-row pagination so every highlighted question remains reachable. An empty result says **No matching decisions** and keeps the selected question's ancestry available.

While active, folds, branch focus and Outline filters are suspended. Their controls cannot silently hide the explanation. Navigation, answer editing, research and saved updates continue normally. Choosing a previously excluded question brings its ancestry into the context view without making it a highlight.

Return restores the previous selection/expansion, camera, connection display, branch focus, folds, Outline mode/page and filter settings. Drafts from questions visited inside the view stay recoverable. Removed IDs are dropped; a removed original selection falls back to the root. If a saved question moved outside its former branch focus, that obsolete focus is cleared and its current ancestry is revealed. A different journey discards the old navigation snapshot instead of applying it to the new map. Reloading the canvas ends this transient view.

## Implementation and bounds

`criticalPaths(doc, index)` is a pure export from the browser-safe decision-impact module and `model.mjs`. It returns highlighted reasons, included IDs and the number of explicit neighbor visits. It reuses the exact band calculation, then performs iterative membership walks. Every explicit link is visited at most twice; ancestor membership is built without enumerating paths. Memory is bounded by nodes plus links. Band scoring retains the topology-dependent bounds documented in [decision impact](decision-impact.md); it is not claimed to be constant time.

The UI keeps one current result keyed by relevant saved content. Cached membership contains IDs, not old node objects, so identical-structure snapshots can still display updated saved answers. Current node records are filtered into the existing geometry/culling pipeline. Selected-question ancestry is added before navigation changes the workspace. Retained cards reuse their content; decorations update separately. Neither the source map nor exports are modified by entering this view.

## Verification and measurements

Automated tests cover equal high-band chains, every saved unresolved state/review rule, resolved intermediate links, unrelated components, direction ancestry, empty results, near-5,000-node/10,000-link bounds, filter/fold suspension, draft/caret retention, restoration after pan and mode changes, saved dependency changes, removed/reparented questions, new journeys, excluded-question navigation, card reuse and 205 equal results across Outline pages.

`npm run benchmark:impact` adds `criticalSelection` (new index, cold bands, index construction excluded) and `criticalView` (entering the shipped UI in jsdom from full-map Fit, setup excluded). One warmup and two samples on Windows 10.0.26300, Intel Core Ultra 9 285K, Node v24.22.1; v0.1.80 worktree based on `af42e99`, dirty during measurement:

| Fixture | Highlighted / included | Explicit neighbor visits | Selection median | Enter view median (jsdom) |
| --- | ---: | ---: | ---: | ---: |
| 4,950-node deep, 10,000 links | 4,657 / 4,950 | 20,000 | 10.26 ms | 396.60 ms |
| 4,950-node wide, 10,000 links | 4,657 / 4,700 | 20,000 | 9.37 ms | 542.83 ms |
| Near-9 MiB wide, no links | 95 / 96 | 0 | 4.92 ms | 210.21 ms |

Full-Fit DOM work dominates these synthetic UI measurements. They are observations, not native paint/input latency guarantees or worst-case timing bounds. The ignored `.perf-baseline/impact.json` and `.md` record fingerprints, environment, min/median/max and workload counts.

Owner native verification remains pending: enter from a folded/focused map and a filtered Outline, navigate highlights with keyboard/screen reader, edit answers, return and check saved navigation/drafts. Inspect solid/dashed context cues, selection/review separation and wrapping in a narrow pane with light, dark and Windows high-contrast themes. No browser/desktop automation was used.
