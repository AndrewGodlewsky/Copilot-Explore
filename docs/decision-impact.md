# Explainable downstream decision impact

Open a saved question, choose **More options → Context → Downstream decision impact**. Explorer analyzes the complete saved map locally. Opening the panel does not call a model, research the internet, edit an answer or change shared metadata.

The panel shows a low/medium/high **recorded impact** band, unique affected question count, answer-state counts, unverified assumptions and questions marked for review. These are observations about recorded reasoning, not estimated code changes, implementation effort or confidence. Historical model importance and its explanation remain separate and unchanged.

## Relationships and counts

Explorer follows three kinds of path from the selected question:

| Category | Meaning |
| --- | --- |
| Possible through tree paths | Descendant questions reached using only parent-to-child navigation links. Tree position suggests exposure; it does not prove dependence. |
| Confirmed dependents | Questions reached using only explicit prerequisite-to-dependent links. These are recorded user assertions, not externally verified facts. |
| Mixed-path-only | Questions reached through a combination of tree and dependency links, but through neither pure path type. These remain possible exposure. |

The total is the union of all reachable ordinary question IDs, excluding the selected source. A question reached by both a tree-only and a dependency-only path appears once in the total and in both category counts. Category counts therefore can overlap. Structural direction nodes may appear along a path but do not count as affected questions. The combined graph can contain a cycle even when the tree and explicit dependency graph are individually valid; bounded visited sets prevent loops and exclude the source from its own impact.

Each affected question contributes once to its saved answer-state count. Every **Assumption** is counted as unverified, regardless of its review flag. Review is counted separately and can overlap any state. Deferred or not-relevant questions remain in recorded exposure totals; their state provides context instead of erasing a recorded relationship. Draft text and draft answer state are not inputs.

Current ADR source associations are **unavailable**, with a null count. Explorer has no supported ADR association schema yet. It does not infer that no ADR would be affected; later traceability work must add that evidence explicitly.

## Bands

Apply these rules in order:

1. **High:** at least 20 unique affected questions **or** at least 5 confirmed dependents.
2. **Medium:** otherwise, at least 5 unique affected questions **or** at least 1 confirmed dependent.
3. **Low:** otherwise, including zero affected questions.

These fixed thresholds make the display reproducible. Answer states, review flags and assumptions provide visible context without arbitrary certainty weights. There are no model calls or manual score overrides. A sparse map can understate real-world impact; missing relationships are not proof of independence. A large tree can overstate likely effects because its links are only structural.

## Inspecting the evidence

The affected-question selector lists 50 questions per page in stable ID order. Select a question to inspect a reproducible shortest path. The relationship selector offers confirmed, tree or combined paths when available. Each step is labeled; any path containing a tree step remains possible exposure. Stable ID/type ordering breaks ties consistently without claiming that this is the only path.

Long paths show 30 steps per page. **Open affected question**, or a path step's button, reveals that question even if it was folded or outside the focused branch and places keyboard focus on its heading. The answer draft remains separate. Closing the panel, changing folds, panning, zooming or branch focus does not change the saved-map result.

## Connection display

Choose **Connections > Downstream impact** above the map. **Normal connections** is the default and returns to the existing display. This is a local canvas choice; it does not change the shared file or historical importance.

Each incoming tree connection represents its **child question's** recorded downstream band. It does not assert that the parent depends on that child. Direction connections remain neutral; root and direction nodes have no question impact band. Explicit dependencies contribute to the calculation but are not drawn as extra tree connectors.

| Band | Light / dark color | Width | Pattern |
| --- | --- | ---: | --- |
| Low | Slate / pale slate | 2 | Short dash, 2 on / 4 off |
| Medium | Teal / pale teal | 3 | Long dash, 10 on / 5 off |
| High | Orange / pale orange | 4 | Solid |

Widths and dash lengths use SVG units and scale with the map. The legend explains the bands and endpoint. Question outlines still show selection and keyboard focus, and question text still identifies review state. In impact mode, adjacent connections retain their band styling rather than taking the normal selection color. Forced-colors mode uses system text color with the same widths and patterns. The minimap remains a navigation overview, not an impact heatmap.

The selected question displays its band above the answer editor. Compact cards include it in accessible labels, and visible Outline rows show the same band as text. Scores use the full saved map even when descendants are folded, outside branch focus, filtered or offscreen. Switching styles and incoming saved updates retain the connected answer editor, draft text and selection.

Portable Mermaid, JSON Canvas, SVG and print maps explicitly say **Downstream impact unavailable in this export** and that their connections show tree structure. Offline viewers carry the same unavailable label. These reduced projections omit the complete dependency graph; no score is recomputed from a selected subset. Native/shared records retain relationships for reopening in a compatible Explorer version.

## Implementation and bounds

`DecisionImpact` and `impactPath` are exported from `model.mjs` and the browser-safe `web/decision-impact.mjs`. The constructor snapshots the validated saved map into adjacency and lightweight state records. Callers must create a new index when saved content changes. `analyze(sourceId)` returns counts, band, affected records, compact predecessor maps and an actual edge-visit counter. `impactPath(result, targetId, kind)` materializes only one requested path. It returns an empty list when that relation cannot explain the target.

Index construction sorts adjacency for deterministic paths; each analysis performs three iterative traversals bounded by nodes plus tree/dependency edges. Memory is linear in the map size. No per-question full path arrays or all-pairs reachability matrices are retained. A path is at most the number of saved nodes. Existing 5,000-node, 10,000-dependency and 9 MiB input bounds apply.

The UI builds an index only when impact inspection or connection display is enabled and retains at most one saved-map index. Full analysis is used only for the inspected question. Its result is keyed by the saved map identity, node relationships, question text, effective answer states, review flags and dependency pairs. A relevant change invalidates it even when a replacement keeps the same revision. Identical HTTP snapshots and status-only updates reuse the result and retain paging. `decisionImpactKey` produces this deterministic key; the UI weakly memoizes keys for immutable received snapshots. A closed inspection panel does not run full analysis. The same mounted panel does no additional analysis or DOM reconstruction for unchanged saved-document updates. `bandFor(sourceId)` computes exactly the same band using early-stop traversals: 20 unique reachable questions prove high total impact, and 5 explicit dependents prove high confirmed impact. Otherwise complete relevant traversals establish the medium/low rules. It stores only a band per queried question in the current index, bounded by map size. The UI requests bands only for visible cards/connections, paged Outline rows and the selected workspace. No all-pairs matrix or full analysis per drawn connection is needed. Structural chains may still require a complete traversal; this is bounded traversal, not constant-time scoring.

Derived impact is not stored in the shared file. Visual/offline exports label unavailable impact explicitly, as described above. This feature changes no schema or historical importance field.

## Verification

Run `npm run benchmark:impact` for synthetic deep/wide maps near 5,000 nodes (with 10,000 explicit links), plus a near-9 MiB map without extra links. It reuses the existing benchmark's one-warmup/two-sample measurement helper and jsdom harness. `.perf-baseline/impact.json` and `.perf-baseline/impact.md` record environment, version, commit/dirty state, fingerprints, byte counts, median/min/max timings, actual edge visits and DOM row bounds. Fixture setup/teardown are excluded. Initial workspace construction is outside the impact-open phase. No native browser, user map or provider is used.

Tests cover leaves, wide/deep maps, thresholds, overlapping and mixed paths, cycles in the combined graph, states/review, unavailable ADR evidence, historical importance preservation, paged details, saved dependency changes, and unchanged drafts/folds/focus. Native narrow-pane, keyboard and screen-reader verification remains pending owner checks. Synthetic timing is not native paint or input-latency evidence.

Measured on Windows 10.0.26300, Intel Core Ultra 9 285K, Node v24.22.1, v0.1.78 worktree based on `7538d81` (dirty during implementation):

| Fixture | Nodes / explicit links | Index median | Analysis median | Actual edge visits | Open panel median (jsdom) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Deep | 4,950 / 10,000 | 2.02 ms | 2.84 ms | 44,553 | 13.06 ms |
| Wide | 4,950 / 10,000 | 2.00 ms | 2.55 ms | 37,305 | 10.58 ms |
| Near 9 MiB wide | 4,950 / 0 | 0.94 ms | 0.63 ms | 5,103 | 6.13 ms |

Each run passed the 50-option/30-path-row DOM bounds. These are two-sample observations, not latency guarantees or an all-node scoring benchmark. The deep combined explanation inspected 2,215 steps on demand in a 0.09 ms median.


The v0.1.79 display benchmark adds cold-cache exact bands for every question and enabling the connection mode at full-map Fit, with all 4,949 connections rendered in jsdom. Same machine and fixtures, worktree based on `845f60c` (dirty during implementation), one warmup/two samples:

| Fixture | Questions scored | All bands median | Enable display median (jsdom) |
| --- | ---: | ---: | ---: |
| Deep, 10,000 links | 4,658 | 6.49 ms | 294.20 ms |
| Wide, 10,000 links | 4,658 | 9.14 ms | 344.81 ms |
| Near 9 MiB wide, no links | 4,658 | 1.62 ms | 313.97 ms |

The all-bands phase excludes index construction and starts from an empty band cache. Display mode includes the saved-content key/index, workspace refresh and visible map rendering. Full-map DOM work dominates this synthetic measurement; it is not a native responsiveness guarantee. Later renders reuse bands until relevant saved content changes. This fixture result does not establish constant-time behavior for every structural/dependency topology.
