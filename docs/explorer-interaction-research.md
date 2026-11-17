# Explorer: alternatives to a question panel

Research checked 2026-11-16. The owner selected the expanding node; it is integrated into the installed canvas from v0.1.7.

## Recommendation

The owner identified the issue: **the bottom drawer feels detached from the selected node**, then selected the **expanding node** from the [connected-workspace pair](prototypes/connected-workspace.html): "That feels right to me." The [current refinement](prototypes/expanded-node.html) keeps the question in its branch, unfolds research below a preserved draft, and adds answer previews and connected follow-up navigation.

The earlier recommendation was a local branch above a full-width question document. That could still reproduce the owner's concern if the two surfaces feel separate. The expanding node is the chosen direction. Production v0.1.7 moves the live answer/research controls into that node, reserves its measured space in the tree, and bounds long content in a scrollable body. The standalone prototype remains a reference, not the installed application.

The research supports investigating different levels of detail and complementary representations. It does **not** establish that one of these layouts will work best in Copilot. Read the [product evidence](explorer-product-patterns.md) and compare the [three concept sketches](prototypes/research-directions.html).

## What the research actually says

| Primary source | Relevant observation | Limit of the evidence |
| --- | --- | --- |
| [Cockburn, Karlson & Bederson: overview/detail, zooming, focus/context](https://www.csse.canterbury.ac.nz/andrew.cockburn/papers/fc.pdf) | A separate overview and detail pane, navigation between scales, and showing a focus within its context are different interaction strategies. Moving a panel from the side to the bottom retains spatial separation. | A broad review of interfaces, published in 2009; it does not test Explorer or AI question workflows. |
| [Sensecape, UIST 2023](https://arxiv.org/html/2305.11483v2) | Nodes can display full text, summaries, or keywords; a semantic dive opens a topic at a deeper canvas level. Its 12-person study found more concepts explored and deeper organization than an integrated chat/canvas baseline. | Participants had 20 minutes per condition. Some found the hierarchy complicated. This is promising evidence for managing levels of detail, not proof that animated zoom or a particular panel is superior. |
| [Graphologue, UIST 2023](https://arxiv.org/html/2305.11473v2) | Linked diagrams, original text, outlines, and summaries support different reading tasks. Participants valued controlling detail and using graph elements to request explanations. | The system evaluation involved seven experienced ChatGPT users. Detailed graphs could overwhelm, and some animation distracted. It studied information exploration rather than recording personal decisions. |
| [Gero et al.: sensemaking of LLM outputs, 2024](https://arxiv.org/html/2401.13726v1) | A controlled study of 24 people plus eight case studies explored comparing multiple outputs. Desired visible quantity varied with task stage and preference; users wanted to narrow to selected subsets. | The tasks involved inspecting sets of outputs, not this question tree. This supports testing a small comparison view, not importing the paper's full analysis interface. |
| [Microsoft HAX: efficient correction](https://www.microsoft.com/en-us/haxtoolkit/guideline/support-efficient-correction/) | AI interfaces should make partially wrong results easy to edit, refine, or recover from. | General design guidance, not evidence for any screen placement. |

Product documentation adds concrete precedents: Kialo's local tree navigation, TheBrain's navigation from notes, Workflowy's focused subtrees, card interactions in Heptabase and Obsidian, and historical focus behavior in Scrintal. These show that the patterns exist; marketing and help pages do not prove usability. Exact behavior and citations are recorded in the [product comparison](explorer-product-patterns.md).

## Earlier research directions

The following are design proposals inferred from the evidence and Explorer's requirements. Their layouts, labels, proportions, and workflows have not been validated with users.

### 1. Local branch + question workspace

**What it feels like:** navigating a branch and opening its working page.

1. Start in the complete idea map. Select **Who should be able to borrow tools first?**
2. The canvas moves into a branch view. A compact map across the top shows the parent idea, the selected question, neighboring questions, and a count of hidden branches.
3. Below it, the question has a readable, full-width workspace. A short answer can be entered immediately. **Explore options** reveals two or three comparable options, their evidence, and an editable answer area beneath them.
4. Saving creates follow-up question choices. The user chooses a child or a neighboring question without closing a dialog.
5. **Whole map** restores the earlier overview and highlights the current question.

**Why it differs from the drawer:** the top becomes a deliberately simplified navigation view of the current branch. The whole graph is not squeezed into the remaining space above an inspector. The question workspace is the primary content of this view.

**Benefits we expect:** keeps useful context while making room for research; closest to the owner's tentative preference; remains plausible in a narrow Copilot canvas. Kialo and TheBrain provide product precedents for local navigation beside or within detailed content.

**Cost:** distant branches are hidden while working. Preserve an explicit overview, clear breadcrumbs, and the selected node's identity. Avoid automatic recentering while the user types or an AI result arrives. Use a list of nearby questions when the branch strip cannot fit.

### 2. Research cards on the map

**What it feels like:** laying out a few possibilities around the question and choosing what to keep.

Selecting a question reveals a small local group: the question, two or three option cards, and a distinct **My answer** card. Each option has the same fields: what it means, upside, downside, and evidence. Expanding a source happens within the current group. The user's answer remains editable and separate from the suggestions. Leaving the group collapses the options to a research summary attached to the question.

**Benefits we expect:** research becomes part of the visible exploration; users can compare before composing an answer. This draws from spatial card products, Sensecape's changes in detail, and Graphologue's combination of text and relationships.

**Cost:** persistent full-text cards would swamp a deep map. Keep only the active group's research expanded, preserve other node positions, and label option cards differently from actual question branches. In narrow panes, stack the options. This alternative should be tested with substantial text, not just short labels.

### 3. Branch notebook

**What it feels like:** a readable record of the reasoning that led to the current question.

**Map / Notebook** switches between two views of the same exploration. In Notebook, the chosen branch appears as a vertical sequence: ancestor questions and saved answers, the current question, expandable research, the user's answer, then suggested follow-ups. Ancestors can fold to one-line summaries. Clicking a breadcrumb or follow-up changes the branch. **Show on map** returns to the same node.

**Benefits we expect:** long reading and writing are comfortable; the exploration record becomes tangible before export; ordinary scrolling and text controls support narrow screens and keyboard use. Workflowy supplies a focused-subtree precedent, while Graphologue supports investigating complementary text and diagram views.

**Cost:** the graph is temporarily absent, and the interface can start to resemble chat. Preserve the actual parent-child structure, separate AI suggestions from saved answers, and make sibling branches easy to find. Avoid turning it into an undifferentiated chronological transcript.

## Behaviors to carry into any design

These are proposed Explorer requirements, not findings that the studies tested as a bundle:

- Keep drafts, research, and user answers distinct. A generated recommendation must not silently become an answered node.
- Let research help someone start: show a few contrasting directions and why they differ, with more detail on demand. Do not require a long research report before a short answer.
- Preserve the route back: selected node, ancestor path, saved map position, draft text, and research reading position.
- Let users defer a question, record uncertainty, or mark a direction sufficiently explored. Infinite possible depth should not imply an endless checklist.
- Keep generation status on the question that requested it. Results should not move the user's focus or switch branches. Reuse the existing request/cancellation safeguards.
- Show consulted sources next to relevant claims and distinguish unsourced model reasoning. Keep a research result useful even when the user rejects its recommendation.
- Make navigation work with keyboard controls and reduced motion. Branch transitions should not depend on a gesture or animation to explain where the user went.

## What to test next

Compare the **attached drawer** against the **expanded node** in the current working prototypes, with the original bottom drawer as a reference. Assess whether the question and workspace now feel like one object. Keep the earlier research directions as context for future decisions; they are not the selected implementation.

Use the same sample questions and text in both variants. Complete a quick answer, compare longer options, answer a follow-up, switch to a sibling, then return to an unfinished draft. Repeat in a narrow canvas and on a map with several nested branches.

Observe whether the user can tell which question they are answering, find a sibling, recover their previous location, and distinguish their answer from research. Record unwanted scrolling, lost context, and unnecessary navigation. Ask which view feels natural after these tasks; do not choose on a screenshot or arbitrary numeric design scores alone.

The earlier sketches explain the research directions; the current pair supports the sample interaction flow. Neither is connected to Copilot. No production layout was changed. Browser/desktop visual verification remains with the owner under the repository's standing preference.
