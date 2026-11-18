# Preferred scenarios

Open **Tools → Scenario preference** or find it in **Commands**. The dialog names the open map, recorded family and storage scope. **Prefer this scenario** makes that saved source the current direction. An optional reason accompanies each change. **Clear preference** removes the selection without deleting a map. Selecting a retained history entry and restoring it records a new change; it does not restore or merge answers.

The original and every alternative remain saved. Preference is independent of certainty: assumptions stay unverified, tentative answers stay tentative, and review warnings and stale research remain unsettled. Comparison alone never chooses a winner.

## Personal and Project scope

Personal preferences live in private Explorer storage under `scenario-preferences/<family-hash>.json`. A Project preference lives at `.explorer/scenarios/<family-hash>.json` in the currently selected Git checkout. The dialog displays that relative path. Reading an absent preference does not create repository files. Choosing a shared preference is an explicit repository write and requires a shared scenario in that checkout.

Commit the Project preference and its referenced shared scenario files through your normal Git workflow. Explorer does not commit, push, fetch or contact a remote for this operation. Private drafts, history, usage and Personal preference records remain outside the repository. Personal and Project preferences are separate; copying a scenario to Project storage does not silently copy its Personal preference.

The family is the recorded earliest root identity in `forkOrigin`, or the map's own identity if it has no fork origin. Nested forks and copies of an existing fork retain that explicit family. A copy of an unforked original starts a separate family. Comparison's aliases do not merge preference families. Missing or contradictory root mappings cannot establish a family. These are recorded identity claims, not independently verified provenance.

## Using a scenario as context

With no selection, the existing active-map workflow remains available and is labeled **unselected**. The preferred map supplies ordinary AI context. Opening a retained alternative does not redirect the current editor or send another map's answers invisibly. Open the preferred source explicitly, change the preference explicitly, or choose **Use this alternative hypothetically**.

Hypothetical use permits that alternative to supply conditional context. It lasts only for the current canvas, map binding and unchanged preference. Closing the dialog retains it; **Stop hypothetical use**, switching journeys or closing Explorer removes it. An unavailable preferred source cannot authorize hypothetical use. Reconcile the missing source, select an available scenario, or explicitly clear the preference.

The banner shows the last observed classification. Opening a map, inspecting the dialog and performing a context operation refreshes it. Passive map polling does not repeatedly read Git state. Refresh the dialog after teammates or another canvas change a selection. All AI operations independently revalidate saved preference bytes before dispatch and before retaining results; queued requests, callbacks, proposal acceptance and native `get_exploration` reads cannot reuse an obsolete selection.

Questions, reviewed research and follow-ups, question help, answer checks, Challenge Review, decision briefs and implementation handoffs receive the exact source identity, recorded family, scope, preference revision, classification and optional selection rationale within their existing input limits. Rationale is untrusted user context. Labels do not elevate assumptions, reasoning or recorded sources into verified facts. Answer cleanup remains a separate operation receiving only the explicit draft text.

## Exports and historical results

Markdown decision exports and Finish require the same current selection policy and include exact source/family identities. A hypothetical export states that it is a conditional alternative, not a current project decision. Selected visual copies and the offline viewer also require explicit alternative use and show classification, scope and preference revision. They retain their existing omission of original source identifiers. Review the offline viewer preview again if the preference changes before download.

These labels describe the preference **at export time**. They do not invent which preference was active when older research or an accepted artifact was created. Existing answer certainty, source provenance and stale-input warnings remain visible. Transient follow-up history becomes historical when a newly observed preference no longer matches its captured selection.

**Save file** (`export.json`) is an unmodified, reopenable map backup. It does not carry the separate preference registry or declare a winner, and remains available for retained alternatives. Older Explorer versions can still open map files but do not enforce or display these new preference records. Avoid using older clients to infer which scenario is current.

## Record and recovery contract

Version 1 uses one canonical record per family and scope:

```json
{
  "format": "copilot-explorer-scenario-preference",
  "version": 1,
  "scope": "project",
  "family": { "id": "original-map", "rootId": "original-root", "createdAt": "2026-11-18T00:00:00.000Z" },
  "revision": 1,
  "events": [{
    "revision": 1,
    "at": "2026-11-18T01:00:00.000Z",
    "preferred": {
      "identity": { "id": "original-map", "rootId": "original-root", "createdAt": "2026-11-18T00:00:00.000Z" },
      "location": ".explorer/journeys/original.explore.json"
    },
    "rationale": "Current direction after comparing alternatives"
  }]
}
```

The actual stored JSON occupies one line plus a newline so competing Git edits conflict in the same hunk. The file is limited to 256 KiB, with strict UTF-8, duplicate-key, known-field, identity, path and revision validation. `preferred: null` records a clear. Reasons preserve user text up to 2,000 JavaScript characters. Only the latest 32 consecutive events remain; the dialog discloses the number omitted. Restoring an omitted selection requires opening and selecting its available source explicitly.

Personal locations are opaque validated library keys. Project locations are validated repository-relative `.explore.json` paths. Stable identity and family must match the source found at that location; a moved, missing or replaced source is unresolved, never silently substituted. Choose its new available location explicitly after opening it.

Writes use a family writer lock, expected revision and original byte digest, guarded atomic creation/replacement, and fresh source/root checks. Selection previews expire after 15 minutes and reject changed map content, changed preference bytes and changed bindings. Failure before publication retains the previous record. Inspect after an interrupted response before retrying; a submitted change might already have completed.

Malformed JSON, Git conflict markers, unknown versions or contradictory lineage fail closed. Reconcile competing preference-file edits in Git, preserving a coherent event sequence and one chosen current reference, then refresh. No merge winner is inferred. Reverting a valid preference file in Git changes its observed bytes and invalidates outstanding work; the current UI history reflects only the resulting retained record, not all Git history.

## Verification

Behavioral tests cover Personal and Project records, overlapping writers, stale source races, missing/replaced targets, bounded history, restore, strict parsing, native/HTTP policy, queued and returning helper work, acceptance after asynchronous history preparation, source labels and text limits. jsdom exercises selection, history restoration, hypothetical use, explicit source navigation, stale responses and draft/editor preservation.

Owner-performed native checks remain required: narrow-pane wrapping and scrolling, keyboard/focus behavior, screen-reader announcements, and preference refresh after a real Git pull. Local fixtures do not establish live model quality or visible desktop rendering.
