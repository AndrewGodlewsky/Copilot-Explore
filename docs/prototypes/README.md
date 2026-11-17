# Question placement study

Four interactive alternatives to the current question sidebar. These are standalone design sketches with sample data, separate from the installed canvas. No layout has been selected for the plugin yet.

Run `npm run prototype:layouts` from the repository and open the printed URL in Brave. No dependencies or Copilot session are needed. You can also open [question-placement.html](question-placement.html) directly as a local file.

| Variant | Placement | Tradeoff |
| --- | --- | --- |
| `inline` | The selected node expands into an answer/research workspace. | Keeps work in the map, but rearranges nearby branches. |
| `floating` | A compact card is attached below the selected node. | Quick to open, but covers nearby nodes and gives research less room. |
| `bottom` | A wide drawer appears below the map. | More room for comparisons, less vertical map space. |
| `focus` | A centered overlay brings one question forward. | More room to think, but other branches wait until it closes. |

Use the top choices, bottom arrows, or left/right keys to compare. The URL supports `?variant=inline`, `floating`, `bottom`, or `focus`. Keyboard shortcuts leave text entry and tab navigation alone.

Try the same task in each layout:

1. Select a question and type a draft.
2. Switch layouts; the selected question, tab, and draft stay with you.
3. Open **Research options**, compare the sample pros/cons, and use one as a starting point.
4. Save the answer to reveal a follow-up. Select that question to continue.
5. Compare **Narrow**, **Dark preview**, and keyboard navigation. Escape closes the question workspace.

All data lives in memory until refresh or **Reset**. Research and follow-ups are illustrative, not generated. This study does not implement production pan/zoom, map layout, persistence, import/export, or Copilot integration. The prototype server serves only this HTML page over loopback; it does not open a browser or alter an exploration.

Visual comparison remains a manual check by the owner, in accordance with the repository's browser restriction. Once a direction is chosen, implement it in the real canvas rather than promoting this prototype into runtime code.

## Research follow-up

The [sourced interaction research](../explorer-interaction-research.md) investigates broader alternatives after the initial placement study. Open [research-directions.html](research-directions.html) directly in Brave for three explanatory sketches: local branch + workspace, research cards on the map, and branch notebook. The layout selector and narrow-width control work; the screen controls inside each sketch are illustrative. This file is self-contained and requires no preview server.
