# Product evidence for Explorer question interactions

Checked: 2026-11-16. Scope: first-party documentation of six products that combine connected ideas with substantial text. No product was operated or visually tested. Documented interactions are evidence of existing designs, not evidence that those designs outperform alternatives. Explorer implications below are design judgments to test.

The strongest transfer is to make the selected question a place to work, with a small, useful representation of its relationships. Moving the existing editor into another rectangle does not by itself resolve the transition between surveying a map, reading research, and answering a question.

## 1. Kialo: local argument map above readable claims

**Documented interaction.** Kialo Edu defaults to a tree showing the current claim's ancestor route and nearby descendants. Its alternative Sunburst displays the whole discussion and outlines claims shown below the minimap. Kialo recommends the restricted tree for newcomers because the sunburst can overwhelm them. [Discussion minimap documentation](https://support.kialo-edu.com/en/hc/discussion-minimap/)

**For Explorer.** A compact local map above a full-width question document could preserve context while giving research and answers enough width. Following a child could advance both views without reopening an editor.

**Tradeoff and limit.** Other branches become less visible; retain a whole-map view. Kialo's pro/con structure differs from Explorer's open questions. This is product guidance, not comparative usability evidence.

## 2. TheBrain: recenter around one thought, carry navigation into its notes

**Documented interaction.** TheBrain 14's guide shows activated thoughts recentering in the Plex. Its navigation article describes parent, child, sibling, and jump links beneath notes. Selecting one updates the active thought and graph; navigation can continue with the Plex minimized. [Version 14 guide](https://assets.thebrain.com/documents/TheBrain14/TheBrain14-User-Guide-v01.pdf), [Navigation article](https://www.thebrain.com/blog/navigating-beyond-the-plex)

**For Explorer.** Put parent and deeper-question navigation inside the question document so exploration continues when the graph is collapsed. Recenter only when explicitly navigating.

**Tradeoff and limit.** Repeated movement may weaken positional memory. This is a historical precedent: the guide is version 14, examined through an indexed passage, and the article dates from 2022. Current desktop behavior was not tested.

## 3. Workflowy: a node becomes the document

**Documented interaction.** Clicking a bullet makes that node fill the view; outside content disappears. Breadcrumbs return to ancestors. Expansion/collapse is separate. Panes can keep multiple outline locations open side by side. [Navigation documentation](https://community.workflowy.com/t/navigate-around/1653), [Panes documentation](https://community.workflowy.com/t/panes/1656)

**For Explorer.** A dedicated question view could retain the ancestor path, show research and answers as document sections, and place child questions below. A Map action could restore the saved viewport. This gives writing the full pane width.

**Tradeoff and limit.** Breadcrumbs preserve hierarchy but lose spatial geometry and cross-branch comparison. Transfer from an outliner to Explorer's graph is an inference; multiple panes are unlikely to fit narrow windows.

## 4. Heptabase: promote the same card from board to focused workspace

**Documented interaction.** A whiteboard card can open in a popup, then a card tab. Multiple selected cards can become one main card with the others beside it. Creating a new main card can retain the previous one as reference material. [Keyboard shortcuts](https://wiki.heptabase.com/keyboard-shortcuts)

**For Explorer.** Offer an explicit transition from brief inspection to a full question workspace for research and composition. Preserve the question and draft. Reference material could sit beside the answer on wide windows and above it on narrow ones.

**Tradeoff and limit.** More modes add state complexity. The useful precedent is gaining working space; it does not validate another popup. Documentation establishes operations, not usability, draft handling, or fit in Explorer.

## 5. Obsidian Canvas: edit the object where it lives

**Documented interaction.** Double-clicking edits a text/note card in the canvas; clicking outside or Escape exits. Commands zoom to selected cards or fit all cards. Cards are resizable; note cards can display a selected heading or block. [Canvas documentation](https://obsidian.md/help/plugins/canvas)

**For Explorer.** Inline editing could suit short answers. Zooming deliberately to a question keeps it attached to its branch. Showing an answer excerpt would keep long text from enlarging every node.

**Tradeoff and limit.** Long research inside cards risks nested scrolling and large geometry. This supports a short-answer path, not reviving the rejected expanded-node prototype unchanged. The source does not establish comfort with large cards in narrow panes.

## 6. Scrintal: change a card's reading density, then focus

**Documented interaction.** Scrintal describes folded cards and full-screen focus. Its shortcuts list entering focus mode, leaving with Escape, and moving between documents. The card page explicitly marks itself outdated. [Cards page, historical evidence](https://scrintal.com/features/cards), [Support shortcuts](https://scrintal.gitbook.io/scrintal-support-docs/keyboard-shortcuts)

**For Explorer.** Keep nodes compact during map survey, then explicitly enter a writing state with a predictable return. A bottom workspace could expand for research, then return to the same map position.

**Tradeoff and limit.** Focus removes context, and unclear density changes risk inconsistency. Treat this as a historical pattern, not today's verified implementation. Sources do not establish animation behavior, retained context, or usability outcomes.

## What these precedents suggest testing

1. **Question document with a local map:** small branch context at the top; full-width answer and research below; child questions at the end. Kialo supplies the local-map precedent, TheBrain supplies navigation beneath notes.
2. **Enter a question, return to the map:** breadcrumbs and a dedicated question document; Map restores the previous viewport. Workflowy supplies the traversal precedent. The restoration behavior is an Explorer proposal, not a sourced product claim.
3. **Bottom workspace that can grow:** a compact map remains above a resizable question workspace; an explicit focus action grants the document most of the height. Heptabase and Scrintal support promotion into a larger workspace, but do not establish that a bottom drawer is optimal.

The common requirement is a continuous path from question to research to answer to deeper questions. For all candidates, keep research separate from the user's committed answer, retain drafts during navigation, and reveal newly generated child questions without forcing a switch before the user is ready. These are Explorer requirements and proposed interaction safeguards, not findings about the products above.
