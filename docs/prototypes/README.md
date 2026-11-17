# Explorer prototype studies

## Current: refine the expanding node

The owner selected the expanding node: "That feels right to me." [expanded-node.html](expanded-node.html) is a focused refinement of that direction. Run `npm run prototype:layouts` and open the printed URL in Brave, or open the HTML file directly. This is now the default preview.

The question this iteration tests is whether an expanding node remains easy to navigate as answers, research, and follow-ups take more space:

- **Place:** opening and collapsing preserve the question's screen anchor where scroll bounds allow. The tree makes room within its branch; opening research grows down from the same header.
- **Thinking:** research unfolds below the answer instead of replacing it in a tab. Adding an option appends to the existing draft. Drafts and research expansion stay with each question.
- **Orientation:** collapsed nodes show saved answer previews; follow-ups connect below their parent. The ancestry trail, **Whole map**, and **Center question** help navigate deeper branches.

Try **Explore options**, type a few words, **Add to my answer**, then **Save & go deeper**. Open the connected follow-up, use the ancestry trail to return, and collapse the parent to see its saved answer. Try the same flow with **Narrow** and **Dark preview**. Escape collapses a question; Ctrl/Command + Enter saves and reveals a follow-up. The map scrolls horizontally and vertically. Opening a node respects reduced motion.

This is still a throwaway prototype. Sample research and follow-ups are illustrative; data lives in memory until reset or refresh. The tree uses simple spacing and native scrolling, not production pan/zoom or a large-map layout engine. Research can make a node taller than the visible canvas; scrolling to compare long options with the draft is a remaining design tradeoff. This iteration does not change the installed canvas. Visual assessment remains manual under the owner's browser-control preference.

## Previous: keep the selected node connected

The owner clarified that the bottom drawer feels detached from the selected node. [connected-workspace.html](connected-workspace.html) provides two working alternatives with the question itself forming the workspace header:

- **Attached drawer** (`?variant=attached`): the selected node forms a raised top edge, joined to a wider drawer by one continuous outline.
- **Expanded node** (`?variant=expanded`): the question grows into a card within the map, with its parent and nearby questions connected around it.

Run `npm run prototype:layouts` and open `/connected-workspace.html` on the printed server in Brave, or open the HTML file directly. Top choices, bottom arrows, and left/right keys switch variants. Drafts and saved answers stay with each question across switches. No Copilot connection, persistence, or browser launch is involved.

Try **Research options**, expand an option, use it as a starting point, and **Save & go deeper**. The follow-up appears connected below the workspace and can be opened. **Show whole map** exposes the entire sample tree; select another question to see it open from that node. **Narrow**, **Dark preview**, and keyboard access are included. User-triggered expansion respects reduced motion. Reset or refresh clears all example data.

These prototypes tested perceived connection and working space, not production graph layout or actual AI research. The owner preferred the expanded node; the current refinement above follows that choice.

## Earlier: question placement

Four earlier alternatives to the question sidebar. These are standalone design sketches with sample data, separate from the installed canvas.

Run `npm run prototype:layouts` from the repository and open `/question-placement.html` on the printed server in Brave. No dependencies or Copilot session are needed. You can also open [question-placement.html](question-placement.html) directly as a local file.

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

All data lives in memory until refresh or **Reset**. Research and follow-ups are illustrative, not generated. This study does not implement production pan/zoom, map layout, persistence, import/export, or Copilot integration. The prototype server serves the allowlisted study pages over loopback; it does not open a browser or alter an exploration.

Visual comparison remains a manual check by the owner, in accordance with the repository's browser restriction. Once a direction is chosen, implement it in the real canvas rather than promoting this prototype into runtime code.

## Research follow-up

The [sourced interaction research](../explorer-interaction-research.md) investigates broader alternatives after the initial placement study. Open [research-directions.html](research-directions.html) directly in Brave for three explanatory sketches: local branch + workspace, research cards on the map, and branch notebook. The layout selector and narrow-width control work; the screen controls inside each sketch are illustrative. This file is self-contained and requires no preview server.
