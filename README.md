# Explorer for GitHub Copilot

Contributors can compare research changes with the [20-case offline benchmark, human rubric and baseline](docs/research-evaluation.md). Run `npm run benchmark:research` for development cases, or add `-- --split all --candidate docs/research-evaluation-candidate.md` for the complete scripted comparison. Fixture results do not measure live research quality or provider cost.

<!-- explorer-current-version:start -->
**Proof of concept, v0.1.117.** Explore an idea through a branching question map inside the GitHub Copilot desktop app. Start with `/explore`, answer the questions that matter, research options when you are unsure, and keep going as deep as you need. Questions expand into workspaces inside the installed map. **History** previews saved revisions and named checkpoints; **Undo** previews the latest committed change before you restore it.

**Usage dashboard** compares current maps, saved answer states and structure, newly observed canvas visits/committed question growth, and retained owned-helper outcomes and usage. UTC date filters apply to observations and receipts, not current stock. Scans are bounded and explicitly refreshed; missing usage and incomplete coverage stay visible. It preserves your editor and drafts. See [metric definitions, inventory, privacy and retention](docs/usage-dashboard.md).

**Commands** opens a keyboard-accessible palette for existing map, history, export and review actions, plus current-journey or saved-library node search. Use Arrow Up/Down, Enter and Escape; unavailable actions explain why. Search covers saved questions, answers, categories and journey topics. Private answer draft text requires opt-in on each opening; research, reminder edits, files and history are excluded. Current results and library pages mount at most 200 rows. Saved-library pages retain the local search limits (16 files, 32 MiB, discovery capped at 2,000 directory entries); coverage and continuation are shown. Refresh after files change. Existing draft, preview, request and source checks still apply when opening a result.

The optional **Ctrl+Shift+P** shortcut is off by default and lasts only for this canvas. It works outside text fields only after Explorer knows a different configured voice shortcut, and ignores IME, repeats and other dialogs. Copilot or the OS may reserve it; the Commands button always remains available. Opening the palette cancels active dictation while retaining inserted draft text. Palette navigation does not save answers or start model work; helper entries open their existing review screens.

<!-- explorer-current-version:end -->

Save a local-calendar **review date** and/or **manual revisit condition** on a question. Filter reminders in the question list or Library, including archived journeys, and use **Revisit** to return to a source. Acknowledge, reschedule/reactivate or clear with History while keeping answer certainty and ancestor review separate. Conditions are evaluated by you; no monitoring, notifications or calendar writes run. See [reminder semantics and export coverage](docs/revisit-reminders.md).

**Scenario preference** selects one current direction within a recorded fork family, with a reason and retained change history. Alternatives remain intact. AI work and decision exports use the preferred source or an explicitly permitted, labeled hypothetical alternative. Personal and Project selections are separate. See [selection, sharing and recovery rules](docs/scenario-preference.md).

## Reviewed implementation handoff

**Tools → ADR scope** selects one focal question and explicit supporting records from any branch. Preview the exact saved input, including global guidance and optional recorded evidence, then save a source reference for later ADR work. Partial answers keep their uncertainty; drafts and existing artifacts stay intact. This step performs no inference or ADR file writing. See [ADR scope, freshness and compatibility](docs/adr-scope.md).

**Tools → ADR format** selects an ADR directory, numbered or title-only filenames, and a bundled MADR-based or explicit repository Markdown template. Review the recognized structure and sample, then save preferences. Template examples and instructions are discarded; no decision is generated, file written or number reserved. See [supported templates, path limits and naming](docs/adr-format.md).

**Tools → ADR questions** reviews the saved ADR scope and format, then queues up to three optional questions about missing reasons, options, consequences or revisit conditions. Review and accept only the questions you want. An empty result is advice, not approval or proof of readiness. Draft answers stay private, and changed inputs require a fresh review. See [ADR questions and source boundaries](docs/adr-questions.md).

**Tools → ADR draft** reviews saved scope and template input, then generates a proposed ADR with an isolated helper that has no tools. Edit the title and statements, check readiness, and explicitly accept the wording into the exploration. Readiness explains stale-reference blockers and advisory gaps with source/section navigation and optional acknowledgments. The decision stays proposed; no project file is written. Manual edits remain available when sources change. See [ADR drafts](docs/adr-drafts.md) and [readiness checks and limits](docs/adr-readiness.md).

**Tools → Save ADR file** previews the exact saved proposed Markdown and relative project path before writing. New files never overwrite an occupied path; recorded proposed updates show the complete before/after text and require unchanged original bytes. Interrupted writes report file and association status separately, with explicit retry or unpublished-operation discard. The current session working directory is the base, and saving does not approve a decision or commit to Git. See [ADR files and recovery](docs/adr-files.md).

Written ADRs retain their selected saved answers, guidance and recorded evidence in a historical source appendix. **Inspect captured sources** distinguishes original reasoning from changed or missing current sources and explicitly opens shared questions through portable references. Decision-impact previews identify affected recorded ADRs. See [durable source captures and Git/path limits](docs/adr-sources.md).

**Tools → ADR lifecycle** explicitly accepts or deprecates decisions and creates proposed successors while preserving older reasoning. Accepting a successor separately supersedes its predecessor. Review every file and source warning; interrupted operations show each saved part and support explicit reconciliation. See [status history, relationships and recovery](docs/adr-lifecycle.md).

**Tools → Review ADR updates** explains changed saved sources, dependencies, research staleness and scenario context. Compare the historical generated baseline, current Markdown and a separately regenerated proposal. Keep manual edits by default or explicitly replace the complete proposed file; accepted decisions use successor proposals. See [freshness, conflict choices and compatibility](docs/adr-updates.md).

**Tools → Summarize exploration changes** prepares editable Markdown from two retained saved versions, or a chosen local Git revision and current saved project content. Review question/answer/uncertainty, dependency, scenario-lineage and linked ADR changes, then explicitly copy or download after source checks. See [comparison coverage and limits](docs/change-summaries.md).

**Settings → Contributor name** chooses the public name for future shared questions, answers and accepted wording. Existing authors stay unchanged; unknown legacy authors remain unknown. Question details distinguish user contributions from accepted AI suggestions, and externally changed text marks old attribution historical. Names are unverified, and the local setting never infers a Git email or account identity. See [contributors and sharing limits](docs/contributors.md).

**Tools → Review comments** shares attributed discussions through the Project journey file. Reply, explicitly resolve/reopen, and find discussions whose saved question/answer changed or was removed. Concurrent replies survive merge review. Proposed wording can be appended to a private answer draft; comments never answer questions or become AI instructions. Unposted comments stay only in the current canvas. See [review comments and file handoffs](docs/comments.md).

**Tools → Review handoffs** requests investigation of a branch or journey with a note, requested reviewer and selected unresolved questions. Explicitly take, reassign or complete responsibility while preserving prior notes. Changed or removed branch context stays historical; completion never changes answers or uncertainty. Handoffs travel through the shared file, without notifications or external assignments. See [branch handoffs and ownership](docs/review-handoffs.md).

**Copy portable reference** shares a saved Project question or journey location in an issue, PR or document. In another checkout, use **Tools > Open reference** to inspect and explicitly open the exact saved target. Changed content needs acknowledgement; missing or mismatched targets leave the current map intact. See [portable reference scope and limits](docs/portable-references.md).

Choose **Implementation handoff**, explicitly select saved decisions or open questions, and choose **Brief**, **Specification**, **Plan**, **Prompt** or **Tasks**. Optionally include recorded research sources and structured claims; these remain unverified AI interpretation with their original provenance and limitations. Preview the exact input before generating, then edit and explicitly accept the proposal before copying or exporting its Markdown. Your map and answer drafts stay intact.

Global guidance and all user constraints remain included. Unselected nodes, implicit ancestors, project-file excerpts/references/snapshots, drafts, private references and earlier briefs/handoffs/checks are excluded. Research summaries, recommendations, proposed answers and follow-up prose are also excluded. The handoff never executes code, creates external tasks or sends to another chat. See [handoff contracts and limits](docs/implementation-handoff.md).

## Recovery

Open **Recovery** to retry a saved read and incomplete history finalization, inspect a validated saved version, or open it as a separate recovery copy. Inspection does not change the active journey. Copies preserve the original file, history and original-journey drafts, including malformed bytes and draft tombstones. A damaged bound journey can reach Recovery before any map loads. The preview shows up to 100 nodes; the copy contains the whole validated version.

A failed save before atomic replacement keeps the earlier committed map. If replacement succeeded but history finalization failed, the newer saved content remains authoritative. Retry reads that disk state; it never replays model inference. After a safe read, retry an answer save through the ordinary editor. Research requires a fresh explicit Research action with the usual account, model and context checks.

Recovery shows only recorded helper lifecycle evidence. An exited recorded owner proves interrupted coordination, not that an orphan helper stopped. A live or reused PID alone is unknown; only a currently tracked operation in this process is shown as active. Dismiss hides a known interrupted/failed notice for this canvas and retains all receipts and journals. Legacy journal pointers are never followed. Export observations are limited to this canvas: generation failure, response interruption or response finish. None confirms that the browser saved a file; **Retry export** is explicit.

All six cooperative writer locks use validated owner records. Only a known local PID proven absent may be quarantined. Legacy, malformed, foreign-host, live/reused-PID, inaccessible-owner or abandoned-recovery-claim locks stay untouched. A timeout is not proof of death. Each lock retains at most one `.abandoned` record; another abandoned writer stays blocked pending storage review. No broad cleanup is performed. See [recovery contracts](docs/recovery.md) for bounded discovery, evidence retention and remaining manual checks.

## Install from GitHub

In the GitHub Copilot desktop app, open **Customize**, use the marketplace settings control, and add:

```text
https://github.com/AndrewGodlewsky/Copilot-Explore
```

Choose the **main** branch if prompted. Find **Explorer** in the `copilot-explorer` marketplace and install it. The exact plugin identifier is **`explorer@copilot-explorer`**.

Or install through Copilot CLI:

```powershell
copilot plugin marketplace add AndrewGodlewsky/Copilot-Explore
copilot plugin install explorer@copilot-explorer
```

Start a **new session** and use `/explore <your idea>`. The repository includes the complete runnable plugin; no build or npm install is needed for the GitHub installation.

If this marketplace is already registered from a local checkout, switch it to GitHub with the following commands, stopping if any command fails:

```powershell
copilot plugin uninstall explorer@copilot-explorer
copilot plugin marketplace remove copilot-explorer
copilot plugin marketplace add AndrewGodlewsky/Copilot-Explore
copilot plugin install explorer@copilot-explorer
```

Exploration files are stored separately and remain intact. For later updates, use **Update** in Copilot's installed plugins or `copilot plugin update explorer@copilot-explorer`, then start a new session.

## Install a development checkout

Requires GitHub Copilot desktop with canvas support and Node.js 22 or later for development commands. The plugin itself uses the SDK/runtime supplied by Copilot; there are no npm runtime dependencies or separate AI keys. The development tests use jsdom.

For reproducible synthetic performance measurements, run `npm run benchmark`; see [the baseline guide](docs/performance-baseline.md) for fixtures, output, and native-check limits.

From this repository:

```powershell
npm run install:copilot
```

The installer checks the package, registers this directory as the `copilot-explorer` marketplace, installs `explorer@copilot-explorer`, and lists plugins. It uses `copilot` from PATH. If that command is unavailable, set `$env:COPILOT_CLI_PATH` to the absolute path of your inspected, installed Copilot executable, then rerun. It does not download a CLI.

Equivalent commands:

```powershell
copilot plugin marketplace add (Get-Location).Path
copilot plugin install explorer@copilot-explorer
copilot plugin list --json
```

Keep the checkout in place: a local marketplace loads it live. Start a **new Copilot desktop session** after installation, then send:

```text
/explore I want to create a neighborhood tool-sharing library
```

`/explore` without a topic opens the entry form. If skill discovery has not refreshed, start another session or ask: **Open the installed Explorer canvas.** Do not use `/create-canvas`, which would create another extension.

Local marketplace installs can show a generic native tab icon due to a host issue observed in Copilot 1.4.2. The canvas is still usable. Prefer the GitHub marketplace installation above for normal use; see [integration notes](docs/copilot-integration.md).

## Use Explorer

While creating a journey, open **Add exploration guidance** to choose a mode or enter an objective and success criteria. **Understand** maps concepts and unknowns; **Decide** compares choices and tradeoffs; **Design** explores outcomes and feasibility; **Diagnose** investigates symptoms and causes; **Challenge** tests assumptions and failure conditions. Understand is the default. Open **Journey details** above an existing map and use **Edit guidance** to change these settings. Mode guides future questions and isolated research; earlier answers, research and explanations stay intact. Objective and success criteria remain separate inputs. Cancel pending Copilot work before editing guidance, and dismiss an old question preview before accepting new suggestions.

**File** holds Library, import, recovery, exports and Finish. **Tools** holds decision helpers and the Usage dashboard. The **Settings** gear opens Voice, Map and motion, Keyboard, and Local data and diagnostics from any view. **Journey details** holds guidance, mode, progress and AI context controls. Within a question, the answer, compact Record control, **Save & continue** and **More options** stay up front. More options opens a full-width drawer below the map with **Explore**, **Research**, **Answer details** and **Context** tabs. Expand the drawer for more room. It remembers drafts and your place; Escape closes it without closing the question. See the [card workspace design and experience checks](docs/card-workspace.md).

The approved Research redesign has an [offline interactive prototype](docs/prototypes/research-workspace.html) and [interaction specification](docs/research-workspace-design.md). The drawer, Help me answer entry and Answer draft return have shipped. [Concise answer options](docs/research-options.md) now come before expandable findings, with fit conditions and an honest limitation when fewer than two choices are supported. [Linked recommendations](docs/research-recommendation.md) explain one option’s fit, tradeoff and prior-decision context, or explicitly decline to recommend. [Append, previewed replacement and undo](docs/drafts.md#research-suggestions) keep suggestions in your private draft until you save. Stale research and outdated previews cannot apply them. Native Copilot acceptance and the remaining redesign issues are tracked separately. The [approved research policy](docs/research-architecture-decision.md) calls for existing-context help first and a separate bounded **Research** request. General no-retrieval routing and the technical prerequisites for expanded access remain implementation work.

1. Use `/explore` to open your library, or `/explore <idea>` to start a journey. Search saved topics, pin favorites, or show archived journeys. **Open** continues a journey in the current chat; **New exploration** starts another without replacing the saved map. Copilot creates questions in several directions around a new idea.
2. Select a question in the map or searchable **Outline**. The node expands in its branch for writing; research and follow-up controls are in its screen-level drawer.
   Combine text, saved answer state, research available, needs review, answer drafts, importance and reminder filters. All selected filters must match the same node. Legacy nonempty answers are Tentative; missing importance is Unranked. Search matches question, saved answer and category, ignoring case and repeated whitespace. Outline shows an exact matching count and pages of at most 200 nodes; Reset clears its filters. Selecting a result reveals it through folds or focus and preserves your editor drafts.
   In Library, choose **Saved questions and answers** to search node content plus journey topics; use **Archived journeys** for archived-only scope. Private answer draft presence is separate from **Include private answer draft text**, which starts unchecked. Only that opt-in allows draft text matches or snippets. Active Outline includes local and conflicted answer/state drafts for existing questions; Library includes persisted answer/state drafts matched to the exact saved file identity. Removed-question drafts, reminder edits, missing-direction drafts, reminder conditions and research prose are outside search. Draft search never adds text to AI input, exports or diagnostics.
   Library node search reads a local page on request, with no remote index or background polling scan. Each page examines at most 16 files and reads at most 32 MiB of document data, returning at most 200 snippets. **Next search page** continues inside long journeys as needed; counts describe that page, not the whole library. Discovery considers at most the first 2,000 directory entries in filesystem order and prominently warns when more entries were not searched. Unreadable files and draft-store failures show incomplete coverage. **Refresh** restarts after file changes; changed continuation sources and stale result opens are rejected. Ordinary topic browsing uses its existing separate library path.
   Open **More options > Context > Context & navigation** for **Focus branch** in a question's workspace, including a leaf, to show its root and ancestor path with that subtree. **Show whole map** in the map heading returns to the wider view and keeps the selected question reachable. **Collapse branch** hides a node's descendants; **Expand branch** restores them. Folds within a focused subtree still work, and unrelated folds return when you leave focus. Folding an ancestor above the focused branch exits focus. **Close question** closes the answer editor instead. Outline searches the whole map; page through results or filter to find a question. Selecting one outside focus exits focus and reveals its ancestor path. Focus and folding change only this canvas view; saved content, drafts, research, history and exports remain complete.
3. Open **More options > Research**, then use **Research options** for alternatives, pros/cons, a recommendation, and uncertainty. A separate Copilot researcher works inside this node. Open each claim's evidence disclosure for supporting paraphrases, source links, recorded read time and limitations. These are selected model assertions, not an exhaustive verification of the comparison; reasoning and unknown support are labeled. **Use recommendation**, **Use this option**, or **Add selected details** appends suggestions to your editable draft. **Undo addition** restores the previous draft until you edit it. Nothing is saved as your answer until you choose Save & continue or explicitly save and explore deeper.
4. Write your answer. New text defaults to Tentative; change **Answer state** in **More options > Answer details** when needed. **Save & continue** records text and state together, then opens an existing eligible next question without asking a model. If none remains, it keeps you on your saved answer. **Explore deeper**, in the drawer’s Explore tab, explicitly saves and asks for follow-up questions on that branch. You can add a direction manually there.
5. **Decision brief** opens an explicit **Generate decision brief** action. A separate tool-free helper summarizes committed guidance, decisions, open questions and direction seeds from the root within the same 128 KiB context budget. Coverage shows omitted records; omitted branches have not been examined. Review the six sections, uncertainty and source links, edit statements if needed, then **Accept reviewed brief** or discard. User edits keep original links, which are not automatically reverified against new wording. Acceptance changes only the brief artifact, never answers or answer states. A changed captured source makes proposals stale and accepted briefs historical; refresh and regenerate explicitly. Use **Export reviewed brief** for a separate Markdown file. The complete native and Markdown record also retains the accepted brief, and history can restore an earlier one. Missing historical sources remain labeled unavailable. No drafts, private references, saved research, question rationale or prior brief enter synthesis; reasons for choices must come from user text or remain unknown.
6. **Check answers** explicitly examines a bounded journey summary of committed answers, open questions, direction seeds and guidance. It may suggest a possible tension, an unresolved choice or an untested assumption, with links to the saved sources and a way to resolve it. Source states show whether an answer was decided or tentative. Dismiss a finding locally or go to its source; no answer or answer state changes. The check shows omitted records, so no findings means only that no possible issues were found in the reviewed context. A change to any sent source makes its results stale and requires an explicit rerun. Results and dismissals stay in this canvas only; reload, journey replacement or a new check may clear them.

   **Challenge decisions** is a separate deliberate action, independent of Challenge exploration mode. Select saved answer records in the context review, inspect exact input strings and omitted records, then choose **Start reviewed challenge**. At least one included nonempty saved answer is required; tentative, assumed and needs-review states retain their meaning. The owned helper has a 180-second operation allowance and zero tools, returning at most 12 assumptions, counterarguments, overlooked alternatives or evidence gaps. Findings are model hypotheses, with references to your inputs; no prior research is sent and no new evidence is consulted. Use original-answer navigation to inspect existing Claims and evidence separately. Closing the context preview preserves drafts and caret. Results share the transient answer-check slot and dismissal/source-freshness rules; a rejected start preserves the earlier request and its Cancel control. A new ordinary check still uses the unchanged consistency-check rules. Usage receipts are retained separately as Explorer Challenge Review, without a fabricated price estimate.
7. **Export maps** offers complete Markdown and `.explore.json`, portable maps, and an [offline read-only viewer](docs/offline-viewer.md). For the viewer, select exact nodes and optional saved answers/research, review the full included-content preview, then download one searchable HTML file. **Finish exploration** saves the record and opens these export choices. Use **Library** to reopen it from any canvas/session, or **Open file** to import an exported journey.

Answer states distinguish intent from evidence. **Decided**, **Tentative** and **Assumption** require text. **Need evidence**, **Not relevant** and **Revisit later** can have an optional note or no text. Clear the text yourself before saving **Unanswered**. State selection, dictation and research additions remain drafts until Save; changing state alone is recoverable. If another canvas changed the saved journey, use **Refresh saved journey**, then explicitly keep the draft or discard it in favor of the saved answer.

**Clean My Answer** uses only your current nonblank answer text (up to 20,000 JavaScript characters) in a separate, tool-free Copilot helper. It requests conservative punctuation, clarity and repetition edits while preserving meaning, uncertainty, names, numbers and voice. Review the original and proposal: a model can still change meaning. **Apply** updates the local draft; **Reject** keeps your text. Your answer state stays unchanged, and neither action submits an answer or generates questions. Normal Copilot usage applies.

**Help with this question** offers **Rephrase**, **Give an example**, and **Explain terms** beside an expanded question. The original stays visible. Examples are illustrative, not your answer. The separate tool-free model helper receives only the selected saved question, exploration topic and guidance, and complete nearest saved ancestor records that fit its 16,000-character context limit. It does not receive your unsaved draft, selected answer, other branches, research or past help. Help is transient: at most one result for each action stays beside the active question through ordinary refreshes, then disappears when its saved source changes, you change nodes or journeys, or reload. Cancel a running help request before starting Clean My Answer, and cancel running cleanup before starting help. Neither action edits your answer or state. Use **Explore options** when you need sourced or current information. Normal Copilot usage applies.

You can keep editing during cleanup. Text changes, including dictation, cancel older results; changing only the answer state preserves the proposal. Starting cleanup cancels active dictation. **Undo cleanup** restores the captured original only until another text edit or navigation. Same-question polling preserves review and undo, but switching questions/journeys, leaving the editor or reloading ends them. The ordinary local draft remains recoverable; cleanup adds no historical draft store.

The root is the idea and is excluded from question counts. **Answered** means nonempty saved text; **resolved** means Decided or Not relevant without a needs-review flag; **deferred** means Revisit later; **unresolved** means total questions minus resolved. These counts overlap. Changed ancestor text or state marks descendants for review. Older nonempty answers are Tentative, and empty answers are Unanswered; no old answer is promoted to Decided. See [answer-state semantics](docs/answer-states.md).

The library shows pinned journeys first, then most recently opened journeys. Files saved before the library existed use their last edited date until you open them. Archive hides a journey from the default list; it never deletes the file. Importing an identical saved journey opens the existing one. A changed file with the same identity offers **Open saved** or **Import as new copy**, preserving both versions. Answer drafts save locally after about 500 ms of inactivity and flush before journey switches. Save or clear manual-question drafts and cancel pending Copilot work before switching. **Back to current map** returns to unfinished drafts.

Typed answers, accepted dictation, research additions, and undo are recovered independently for each journey and question. **Saving draft**, **Draft saved locally**, and **Draft could not be saved** describe local draft persistence; **Answer saved** or **State saved** means an explicit save, with the meaning you chose. If the question, committed answer or saved state changed, Explorer keeps the saved answer and offers **Use recovered draft**, **Keep editor draft**, or **Discard draft**. Drafts for removed questions remain available to copy or discard. Another canvas's newer draft is never overwritten silently.

A failed write keeps the editor text and blocks journey switching until retry succeeds or you explicitly **Discard unsaved editor text**; that option leaves any previously stored draft intact. **Save file** exports committed answers and states only; finishing requires resolving local drafts. Manual-question text is still held only in memory. Closing or hiding the page attempts a final flush, but abrupt termination can lose keystrokes within the debounce window or an unfinished write. Wait for **Draft saved locally** before closing. The draft store is limited to 8 MiB and 10,000 journey/question records, including retained clear markers. Malformed files are preserved and need manual restoration; there is no cloud backup. See [draft storage and recovery](docs/drafts.md).

Pan by dragging the background, a compact card, or empty space in an expanded question heading. Question text can be selected and copied. Middle-button dragging also works over the editor. Scroll over the map to zoom around the pointer, or use Ctrl/Command+wheel (including trackpad pinch) anywhere on the map. Normal scrolling inside an expanded node scrolls its contents. The +/? controls zoom up to 300%; click the percentage to return to 100%. **Close question** keeps your place and shows a saved-answer preview; **Fit** collapses the workspace and fits the currently visible nodes. **Show whole map** leaves branch focus without closing the editor. **Center** returns to the selected node at reading size. Keyboard users can Tab to nodes (including those off screen), navigate the outline, or press Escape to close the outline or collapse a question. With the map focused, arrow keys pan, +/? zoom, 0 resets zoom, and Home fits the currently visible map. Window resizing preserves your zoom and position. Ctrl/Command + Enter saves the answer without generating questions. Revising an answered node preserves its descendants and marks them for review.

Choose **Outline view** for a text hierarchy and the same selected-node editor: answer, set answer state, review importance, research, and fold branches without returning to the map. **Map view** restores the expanding-node canvas. This choice lasts for the open canvas; view changes do not add history. The editor stays in place, preserving drafts, disclosures and caret. A pointer click on the view toggle keeps editor focus and active dictation; moving keyboard focus outside the editor keeps the existing dictation cancellation boundary. Research and private proposals remain attached to their original source.

Outline shows up to 200 rows per page in depth-first order. Folds hide descendants in the hierarchy; **Search and filters** searches the full journey, including folded branches, and labels results with their original level and parent. Native Tab/Enter controls, Previous/Next matches and capped indentation keep deep maps navigable. Filters and page changes do not hide the selected editor. **Show selected in outline** clears filters, expands its ancestors and reveals its page; explicit source links do the same. Pure view toggles retain filters and map camera. The minimap remembers its visibility choice while suspended in Outline. Narrow panes stack the hierarchy above the editor with separate scrolling; native readability, IME and microphone behavior still require manual checks.

Generated questions first appear in a **not saved** preview inside the requesting node. Select a subset, optionally adjust wording, then use **Accept selected** to add them in one undoable change, or **Dismiss all**. Dismiss before switching journeys, restoring history or generating again. Empty maps retain **Generate questions** for an explicit retry. A saved source change makes the preview stale; dismiss, refresh and generate again. Draft answers are preserved and do not become generation context. Accepted questions keep their original wording/category and adjustment provenance. **Why suggested?** in the preview and **Why this question?** in an expanded question show the optional model explanation of its uncertainty and consequence for your goal. It describes the original suggested wording and context, even after you edit wording or change the objective or an earlier answer. Older questions have no invented explanation; this is neither a confidence score nor an importance rank. The added-question link and static outline highlight make new nodes discoverable while respecting focus, folds and reduced motion.

New generated questions may also carry **Low**, **Medium** or **High importance** and a concise **Why?** explanation tied to the goal, constraints and decision consequences. Importance describes potential impact, not confidence, answer certainty or completion. Map cards and Outline show text labels; use **Importance in this list** to combine a rank with text and reminder filters while keeping the full map available. Old/manual questions stay **Unranked**; ideas and direction seeds are not ranked. Assessments remain historical model reasoning for the original wording and context after edits or guidance/ancestor changes, without automatic reassessment. Native/Markdown, portable maps and selected offline viewer nodes retain recorded ranks, reasons and original wording; the viewer preview shows the exact included content.

**Restart branch**, in the Explore drawer, previews the exact revised answer and descendants to remove. Confirmation creates a protected local History checkpoint, then saves the answer and removal together. Outside dependent answers survive with review flags, and removed-node private drafts remain recoverable. Cancel pending requests and resolve manual direction/reminder drafts first. No questions regenerate automatically. See [branch restart and recovery](docs/branch-restart.md).

**History → Restore one branch** previews a historical subtree without reverting unrelated later work. It preserves compatible node identities, reports dependency conflicts, keeps private drafts recoverable and saves an undoable revision. See [scoped restoration and its limits](docs/branch-restoration.md).

**Review affected answers**, under Tools or an answer's review notice, explains outstanding upstream changes. Reaffirm one cause at a time, revise in the retained editor, or explicitly clear the saved answer. Other causes, private drafts and stale research stay visible. Source changes require a fresh review. See [guided review](docs/guided-review.md).

**Fork alternative**, in the Explore drawer, saves a separate scenario with the ancestor path and a different answer. Preview copied context and omitted dependencies, save to the personal library, then explicitly open it. The original answers, descendants and private drafts stay intact. Origin mappings survive exports and project copies. See [alternative scenarios](docs/scenario-forks.md).

**Revisit this answer**, in Explore or Commands, brings those choices together: change and retain descendants for review, fork an alternative, or restart below the question. The chooser keeps your editor intact, names the target journey, and routes through the existing consequence/copy confirmations. See [revisiting answers](docs/revisiting-answers.md).

**Compare with current**, on Personal or Project library entries, compares two explicitly selected saved journeys using recorded origins. Page through matched or unpaired nodes and inspect complete selected answers, states and retained evidence. Comparison preserves both maps and drafts; source navigation is a separate choice. See [scenario comparison](docs/scenario-comparison.md).

**Suggest next question** offers one optional existing question using a local heuristic. Computed downstream impact band comes first, then assumptions needing review, other questions needing review, distinct constraint-word matches, objective/success-criteria matches, historical High/Medium/Low/Unranked importance and stable question ID. The explanation shows exact affected-question counts, tree exposure versus explicit dependencies, unanswered/review counts, matched words and separately labeled historical AI reasons. Counts explain the winner; they do not rank questions within the same band. Medium/high impact or a review flag can justify a recommendation without an objective or literal match. Ordinary low-impact maps retain the objective and literal-word fallback. This is not semantic analysis or a claim about the optimal next action. Unicode words are case-normalized; short words and common English stop words are excluded, with no stemming or synonym matching.

The heuristic scans the complete saved map (at most 5,000 nodes) and complete objective, criteria and constraints (at most 16,000 characters). Directions, ideas and explicitly deferred questions are excluded, including deferred questions needing review. Decided/not-relevant questions become eligible only when flagged for review; other unresolved states remain eligible. Reminder urgency is separate. Drafts, research, project files and private references are not consulted. **Open question** reveals ancestors, exits unrelated focus and preserves independent drafts. **Dismiss** does not open another suggestion and persists until the question's own source, review causes, impact band or saved guidance changes. Same-band topology changes, unrelated answer wording, reminders and polling do not reset it. Removed sources are pruned; switching journeys or reloading clears dismissals. Visible results refresh with saved snapshots. Opening a recommendation only navigates; no answer is saved and no model runs. Save & continue may use this recommendation after the explicit answer save. See [eligibility and compatibility](docs/answer-states.md#next-question-eligibility).


Previews are temporary canvas memory, excluded from exports, history and native map context. Closing or restarting the canvas discards them; polling preserves selections and wording edits. A renderer reload can recover the original batch while the canvas remains alive, but loses browser-only wording/selection edits. See [question preview contracts](docs/question-preview.md).

After correcting an answer, choose **More options → Explore → Regenerate follow-ups** to inspect saved context and select existing questions as coverage. Current prerequisites stay in scope; answers needing review are withheld. Generation starts only after confirmation, and new candidates still require acceptance. Private drafts and existing questions remain intact. See [replacement-question behavior and limits](docs/question-regeneration.md).

Open an ordinary question and choose **Pin this question as a reference** to keep its saved question and answer near another editor. The optional **References** disclosure holds up to three sources, shows saved answer state and review flags, and offers **Go to source** or **Remove reference**. Missing sources after a history restore stay visibly unavailable until removed or restored. Pins are private per-journey view preferences, survive reopening, and do not alter answers, history, exports or AI context. If another canvas edits the pins, **Refresh & retry references** deliberately reloads the latest revision before applying your choice. See [pinned reference storage and API](docs/pinned-references.md).

Initial questions and **Explore deeper** are queued in the attached Copilot chat. Research uses a fresh SDK session with the same verified account and an enabled Copilot model. **Settings > Research model** follows the selected chat model by default or saves a dedicated personal choice. Each request review shows the model; accepted requests keep that captured model, and unavailable choices never silently fall back. See [Research model settings and receipts](docs/research-model.md). Normal Copilot usage applies. It receives your saved question path, answers and states with a dedicated [research skill](com.github.copilot/extensions/explorer/research/skills/explorer-research/SKILL.md), and checks web search/fetch availability before inference. The main chat receives no research transcript. Status shows preparation, search, reading and comparison; Cancel stops the research helper. Question cancellation still only discards the result, since Explorer cannot stop the main chat turn.

**Save & continue** remains available while research runs. New independent answers survive its completion, including another canvas's committed edits. Changing an answer or state that was included in the research snapshot saves your newer input and discards stale research. **Explore deeper**, guidance edits and journey/history changes still require waiting or cancelling. A replacement research run waits for its previous helper to stop; unconfirmed shutdown blocks further research until release is confirmed, then you can explicitly retry. Conflicting research saved by another canvas is preserved.

Open **Compare options** inside saved research to compare question-specific detail labels, add custom criteria and set local High/Normal/Low priorities. Edits make no model call. **Reconsider recommendation** reviews all options, priorities, prior research and current saved context before one tool-free reassessment using your Research model. Review changed and unchanged reasoning, then **Use revised comparison** or **Keep current comparison**. Saved research and answers remain intact; narrow panes stack the comparisons. See [comparison controls, evidence labels and transient-state limits](docs/research-comparison.md).

Research offers Quick (60 seconds / 8 tool attempts), Standard (180 seconds / 24 attempts, default), and Deeper (300 seconds / 40 attempts). Time starts at owned execution and includes setup; denied attempts count. Shutdown and accounting may continue afterward. Choose balanced evidence or primary-source preference and optional recent-source guidance in the review; preferences do not guarantee source availability, freshness or accuracy. It reads public web pages, compares practical options and validates its returned data and source URLs. New research links bounded claims to sources that were successfully fetched during that request. Read timestamps come from tool activity for the requested URL, not the model; redirect destination and publication date remain unknown. Supporting paraphrases are model interpretations, not automatically verified truth. Legacy results have unknown claim support and retrieval time. Imported read metadata remains labeled imported, including in history and complete exports. See [claim evidence limits and provenance](docs/research-context-review.md#claim-evidence). Use **Ask about this research** to clarify a recommendation or explore a hypothetical change through an explicitly reviewed isolated follow-up. Original research and saved answers remain unchanged. Up to four complete exchanges (64 KiB) stay in the active canvas; prior evidence keeps its original provenance. See [follow-up bounds and retention](docs/research-context-review.md#scoped-follow-ups). If pages cannot be consulted, the result is clearly labeled model reasoning. Missing account, model or search access produces an error without falling back to the main chat. Save relevant draft answers and states before research so they are included. The research snapshot retains complete records within 131,072 UTF-8 bytes for actual instructions plus prompt, including identities, omission counts and research preferences. It prioritizes explicit prerequisites and literal matches to constraints, goals and the current question across branches, while preserving answer uncertainty. Review selection reasons and a bounded sample of omitted questions before starting; excluded answers stay out. It refuses required content that cannot fit. Contributor changes and changed relevant selection require a fresh review; unrelated new fallback answers do not cancel pending work. See [map selection and freshness](docs/research-context-review.md).

Map detail changes with zoom. At a distance, cards emphasize short labels, status, importance and branch counts; moving closer reveals fuller questions and saved-answer excerpts. Extremely distant **Fit** uses a schematic overview: use **Outline** or zoom in to read individual nodes. Full question and answer text remains available to assistive technology. The expanded editor stays at reading size while you zoom, preserving draft text, caret, reminders and dictation. Zoom stays anchored at the pointer; use **Center**, select a source, or focus an editor control to bring it back into view. Fit/Home deliberately collapse the editor and retain its drafts. Detail thresholds have small hysteresis bands to avoid flicker and repeated layout at their boundaries. Zoom and detail are view state and do not change saved documents, history or exports.

**Show minimap** opens a compact overview below the canvas. It shows every node in the current visible layout, including offscreen cards, folded branch markers, branch focus, the selected node and a clipped viewport box. Click or drag to move the viewport, or focus the overview and use arrow keys. Home, Enter or Space centers that layout without changing zoom or selection; Escape hides the overview and returns focus to its toggle. **Hide minimap** reclaims the row. This visibility choice lasts for the canvas, including journey switches, and resets on reload. The row never overlays the editor; short panes can scroll to the controls. Overview navigation is instant and does not change documents, history or exports. Moving focus to its controls cancels active dictation and keeps already inserted draft text. Use **Outline** for individual questions and **Center** to return to the readable editor.

**Settings > Map and motion** switches ordinary wheel/trackpad input between pointer-anchored zoom (the default) and two-axis pan. Ctrl/Command+scroll always zooms; Shift+vertical scroll pans horizontally in Pan mode when the device supplies no horizontal delta. Pixel, line and page deltas are normalized. Sensitivity from 0.25 to 3 scales wheel input only; buttons and keyboard steps remain fixed. Scrolling inside an expanded question stays native unless Ctrl/Command is held. Motion follows the operating system by default; Reduce stops the recording spinner and meter transitions and uses instant scrolling, while Full allows them even when the OS requests reduced motion. Map transforms are already instant. Settings are stored in bounded `navigation-settings.json` in Explorer's data directory, separately from journeys, drafts, history, voice settings and Copilot settings. A corrupt or unreadable settings file is preserved; the map uses safe defaults until the file is repaired and settings are refreshed. Reset to defaults requires Save.

**Local storage** in **Settings > Local data and diagnostics** or the library/welcome screen shows bounded category sizes, duplicate hardlink lengths, declared retained history and incomplete inventory. Choose a keep-history preview target (5, 10, 25 or 50), then **Preview cleanup** and separately **Remove listed history versions**. Only captured old unnamed snapshots are eligible; journeys, drafts/tombstones, named checkpoints, undo/newest recovery, usage, locks, intents and unknown files stay protected. Protected history can exceed the target. Saving the preference never deletes anything. Removal is irreversible; exact-candidate retries report failures and unknown outcomes. The 15-minute preview/observed-outcome ledger lives only in this canvas; restart never resumes cleanup. See [storage bounds, ownership and interruption semantics](docs/storage-management.md).

## Voice dictation

Select **Record** beside **Your answer**, wait for **Listening**, then speak hands-free. Text appears in your local draft as the model decodes it. **Stop** ends capture and finishes buffered audio; **Cancel** stops remaining work and keeps text already inserted. Cancelling during loading captures no audio. You can also focus the answer and use your Copilot voice shortcut (for example **Ctrl+Space**): hold and release in push-to-talk mode, or press twice in toggle mode. A deliberate shortcut press can finish a button-started recording; releasing a shortcut key cannot stop one. Explorer reads your shortcut and recording mode from Copilot without changing either setting. Review the text before saving an answer.

The bar beneath the answer distinguishes three stages:

| Stage | What you see | What is happening |
| --- | --- | --- |
| Loading model | Loading indicator and a reminder to wait | The helper loads the selected local model. The microphone has not started yet. |
| Listening | Moving audio bars, elapsed recording time and saved chunk count | Your microphone is recording while the local model decodes speech. Silence stays flat. |
| Transcribing | Finishing indicator and any stop reason | The microphone has stopped. Buffered audio and pending draft writes are finishing. |

One model load and continuous audio request serve each recording. Ordered text chunks arrive about once a second or after 512 characters, without splitting a Unicode surrogate pair. These are transport chunks, not complete words or finalized utterances: the installed model exposes decoded tokens but no speech-boundary markers. Repeated words and the model's spacing are preserved. The final aggregate is checked against those tokens and never inserted again.

**Saving draft** and **Draft saved locally** distinguish visible text from recoverable text. Explorer acknowledges a chunk only after the existing local draft store accepts it. A failed write keeps the visible text, stops further dictation and exposes **Retry saving draft** or the existing conflict recovery controls. Chunks never commit an answer or add answer history. Cancel, Escape, edits, caret moves, leaving the answer and voice controls, or switching questions stop remaining work and retain inserted text. The indicators respect reduced-motion preferences.

Recordings end at **10 minutes**, or after **3 minutes without decoded text** (including silence). Capture also stops explicitly if the model falls five seconds behind, a draft chunk is not acknowledged within five seconds, or text buffering reaches its limit. A four-second audio-delivery stall reports potentially incomplete audio; the recorder cannot detect every hardware drop. Finishing captured audio has a 45-second limit. The complete answer remains limited to **20,000 characters**; an exceeding chunk is rejected whole. Review retained text and record the remainder after a failure. See the [technical bounds](docs/voice-integration-research.md#v0126-continuous-dictation-and-recoverable-transport-chunks).

### Microphone and model settings

Open the **Settings** gear, then **Voice**. No question needs to be open:

- **Microphone:** choose the system default or a named input device. Explorer checks the name again when recording starts, so changing device order does not select a different microphone. A disconnected or duplicate device name produces an explanation instead of silently switching inputs.
- **Downloaded voice model:** keep **Follow Copilot** or choose a supported downloaded model. The list reads actual local model folders, not the online catalog. Unsupported speech models are visible but disabled. Download additional models through Copilot, then use **Refresh devices and models**.
- **Save voice settings** applies your choices to subsequent recordings and future Explorer sessions. These preferences belong to Explorer; they do not change Copilot's microphone or model selection. Opening Settings cancels active dictation before changing preferences. Unsaved choices survive switching questions and closing Settings.

This Windows x64 preview supports the inspected Nemotron English, Nemotron Spanish, and Nemotron 3.5 Multilingual CPU formats with installed Foundry SDK 2.2.1, PvRecorder 1.2.9, and matching desktop libraries. English is the model verified on this machine. Spanish and multilingual compatibility is based on source inspection; their weights were not downloaded or exercised here. Whisper and Parakeet use a different audio path and cannot currently be selected. See the [voice integration findings](docs/voice-integration-research.md).

### From shortcut to answer

Explorer handles recording inside its canvas and reuses Copilot's installed libraries and downloaded model weights. It does not route dictation through the main chat composer. The owner confirmed the v0.1.9 adapter works in the installed app; the earlier v0.1.8 claim of automatic native canvas dictation was incorrect.

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant UI as Explorer answer box
    participant Server as Explorer localhost server
    participant Files as Settings and model files
    participant Helper as Explorer voice helper
    participant Mic as Selected microphone
    participant Draft as Local draft store

    You->>UI: Focus the answer box
    UI->>Server: Check voice availability
    Server->>Files: Read Copilot shortcut and Explorer preferences
    Files-->>Server: Shortcut, recording mode, selected model
    Server-->>UI: Ready and configured shortcut

    You->>UI: Press and hold Ctrl+Space
    UI->>UI: Check focus and shortcut, then remember draft and cursor
    UI->>Server: Start with a unique recording ID
    Note over UI,Server: Token-protected HTTP on this computer only
    Server->>Helper: Launch isolated helper with installed Copilot runtime
    Helper->>Files: Load installed voice libraries and selected model weights
    Note over Files,Helper: No model download or copying of weights
    Helper->>Mic: Resolve device and start PvRecorder
    Helper-->>Server: Listening

    loop While you speak
        Mic->>Helper: Audio frames, kept in memory
        Helper->>Helper: Stream 100 ms PCM frames through one loaded model
        Helper-->>Server: Measured audio level
        UI->>Server: Poll recording status
        Helper-->>Server: One ordered decoded-token chunk
        Server-->>UI: Pending chunk, levels and elapsed time
        UI->>UI: Check context, draft and caret; update owned insertion
        UI->>Server: Persist local draft with revision
        Server->>Draft: Atomic draft write
        Draft-->>UI: Durable draft acknowledgment through server
        UI->>Server: Acknowledge chunk sequence
        Server->>Helper: Release pending chunk
        UI-->>You: Text and local draft save status
    end

    You->>UI: Release Space or Ctrl
    UI->>Server: Finish this recording
    Server->>Helper: Stop capture and drain
    Helper->>Mic: Stop and release microphone
    Helper->>Helper: Verify final aggregate equals decoded tokens
    Helper-->>Server: Completed, or visible failure with prior chunks retained
    Server->>Helper: End process and clean temporary catalog
    UI->>Server: Poll for completed result
    Server-->>UI: Completion for this recording ID
    UI-->>You: Review the local draft before saving an answer
```

PvRecorder captures mono, 16-bit PCM audio at 16 kHz. Foundry Local runs the speech model while capture continues. Only loudness measurements, status and text chunks travel between Explorer's helper, local server and answer UI; raw audio stays in the helper's memory. Queue lifetime PCM is capped at 19.2 MB, with a separate 160 KB recorder buffer; these are audio limits, not a total process-memory guarantee. Lost connections and timeouts stop capture, and recording IDs plus chunk sequences prevent stale or repeated insertion.

## Files and privacy

Committed objective, success criteria and optional exploration mode are stored on the version-1 journey document and included in JSON and Markdown exports. Older files open in Understand mode without adding a field to the saved file. The objective is limited to 2,000 characters and success criteria to 4,000; invalid explicit guidance and modes are rejected on import. Mode changes are undoable guidance revisions and clear a finished state while preserving old content. Guidance influences future questions and research, but finishing remains your choice.

Journeys autosave as versioned JSON documents under `~/.copilot/plugin-data/explorer/` (`COPILOT_HOME` is respected). `EXPLORER_DATA_DIR` can override this for testing. New filenames hash the stable journey ID; canvas/session identity is only an attachment. Legacy `.explore.json` files are discovered in place. Opening a journey from another canvas uses the same file and revision protection. Finish also saves a Markdown sibling there. Export names use an exploration identifier; every node's ID and parent relationship are preserved in the resumable file. Pin/archive/recent metadata and canvas bindings live separately in `library.json`; opening or pinning never changes the journey's edited timestamp. See the [library storage contract](docs/library.md).

Question/answer/research data is stored locally as plain text. Generating questions sends only the current map context to the attached chat; the library listing is not added to that context. Research sends a bounded saved-context snapshot to its isolated Copilot session and may include relevant terms in web searches. Selected project files are read only after explicit approval in Challenge decisions and sent only to that tool-free review. Other operations omit them. The plugin loads no external UI assets. Downloaded files contain the exploration text. Importing a journey keeps the previously open journey in the library. Local answer drafts are stored separately in plain text and never included in exports, question generation, or research input. Only explicitly saved text and states enter the map; only Decided records a user decision.

Research usage receipts are retained under `~/.copilot/plugin-data/explorer/usage/session-state/`, respecting the same directory overrides. They contain model, token/credit metrics and accounting IDs, without prompts, answers, account names or credentials. The temporary research conversation is removed after the helper stops and usage is retained. Cleanup/accounting failures preserve recovery files rather than losing receipts; `usage/recovery-<session>.json` identifies the temporary directory when a pointer can be saved. See [integration notes](docs/copilot-integration.md#background-model-work).

Dictation reads Copilot's voice settings record and local voice assets. Explorer's microphone and model choices are saved in `voice-settings.json` in its data directory, separately from exploration exports and Copilot settings. Audio stays in memory in a separate helper and is processed locally; no recording file is saved. Temporary Explorer catalog metadata is removed when the helper exits. Foundry's native library can emit operational telemetry. Dictated text follows the same save/research behavior as typed answers.

There is no fixed depth limit. This POC supports up to 5,000 nodes, 20,000 characters per answer, 9 MiB of saved map data, and 10 MiB imports. The saved-data limit keeps exports reloadable. Very large maps or prompts can hit host/context limits sooner. A crashed process may leave a `.lock` file; fully exit Copilot before removing only the matching lock, then reopen the map. Corrupt files are preserved and reported, never silently reset.

Unchanged maps use conditional polling, avoiding repeated map downloads and parsing. A connection gap shows **Reconnecting** while the editor and local draft remain available. Polling retries automatically with a bounded delay and requests a full snapshot after reconnect. Failed document actions are never replayed automatically; refresh the saved map before retrying an action whose response timed out, because it may already have saved.

## Develop and verify

For repository changes, follow [the development workflow](docs/development-workflow.md): a short issue brief, independent review, checks tied to the tested files, and optional measured token accounting. `npm run verify:iteration -- <id>` gathers the required checks into one local receipt; it does not publish or open a browser unless an authorized UI check is explicitly enabled.

```powershell
npm ci
npm test
npm run check
npm run preview
```

Preview prints a local URL to open in Brave. It uses the real UI and persistence, but has no Copilot connection; AI actions report that limitation. Manual questions, answers, imports and exports work. No browser opens automatically.

The **expanding node is integrated into the installed canvas from v0.1.7**. The [earlier layout studies](docs/prototypes/README.md) remain available with `npm run prototype:layouts` for design reference; those pages use in-memory example data. Use `npm run preview` to inspect the real shipped interface locally.

The [interaction research](docs/explorer-interaction-research.md) examines six product precedents and relevant studies. It records why the owner preferred the expanding node. Its [earlier concept sketches](docs/prototypes/research-directions.html) remain available for reference.

DOM interaction tests run the shipped HTML/JavaScript against the real local server and persistence controller, with geometry stubs because [jsdom does not render a visual browser](https://github.com/jsdom/jsdom#pretending-to-be-a-visual-browser). They cover in-map forms, drafts, saves, research results and follow-up navigation. Layout tests separately check variable-size boxes and branch separation. `npm test` runs at most four test files concurrently to bound native Git process contention; application request timeouts remain unchanged.

For the real SDK/runtime smoke tests, set `COPILOT_SDK_DIR` to the installed SDK directory containing `index.js`, and `COPILOT_CLI_PATH` to its paired runtime executable, then run `npm run e2e` and `npm run e2e:research`. Disposable homes and loopback model/MCP fixtures check plugin discovery, HTTP serving, queued chat delivery, canvas callbacks, isolated research tools/context, cancellation, accounting and export/import without paid inference or browser automation.

`npm run package` creates a clean, dependency-free installable directory under `dist/`. Register that directory as a local marketplace if you prefer a snapshot. There is no build step; the checked JavaScript/HTML/CSS is the shipped code.

For each release, run `npm version <next-version> --no-git-tag-version --ignore-scripts` to update the root package and both lockfile version fields. Update `plugin.json`, `.github/plugin/marketplace.json`, and `com.github.copilot/extensions/explorer/package.json` to the same version. Change only the current-version and installation-check sections marked below and near the top of this README; leave historical version references in place. Prepend a `release-notes.json` entry with the new version and a user-facing summary of at most 400 characters, preserving older entries. Run `npm test`, `npm run check`, and `npm run package` before committing. The check rejects missing or mismatched current release fields, and packaging runs it again.

Manual acceptance in Copilot:

<!-- explorer-install-check:start -->
- Update to v0.1.117, start a new session, invoke `/explore`, and confirm the bottom label reads **Explorer v0.1.117**. In a narrow pane, choose each mode in creation and Edit guidance; check its description, active label, keyboard focus, retained draft, and old question explanations after a change.
<!-- explorer-install-check:end -->
- Open **Settings > Map and motion** in a narrow pane. Try wheel zoom and pan with a mouse and trackpad, Ctrl/Command+scroll over an answer, Shift+vertical scroll in Pan mode, and a system reduced-motion change. Check the mode hint, focus return, and recording feedback in light and dark themes.
- Select a question and confirm it expands within the map, with no separate question sidebar. Collapse it and check its saved-answer preview.
- Pin a saved question, open another question, and expand References in a narrow pane. Check long answer disclosure, source jump with an unsent draft, keyboard focus after Remove reference, and unavailable-source text after restoring an earlier history version.
- Open **Challenge decisions**, select/exclude saved answers, review the exact tool-free scope, cancel/retry, and inspect hypothesis labels and source navigation. Confirm empty selection cannot start, native keyboard/narrow-pane layout is usable, and drafts survive. Local fixtures do not prove live model reasoning quality.
- Open **Check answers** in a narrow pane. Run it on a saved journey, inspect possible findings and omitted coverage, dismiss one, reveal a source outside the current focus or behind a fold, and confirm an unsaved draft remains intact. Change a sent answer in another canvas, refresh and confirm the old result is stale before an explicit rerun. Live model judgments still need human review.
- Collapse a branch with an active descendant editor, confirm focus moves to the visible ancestor, then select the hidden question from Outline. Check that its draft text and state return, the other branches stay as they were, and the compact hidden/unresolved counts remain readable in a narrow pane.
- Focus a deep branch and a leaf, use Fit visible map, then Show whole map. Check root and ancestors remain visible during focus, unrelated branches return with their prior folds, and the answer editor and caret remain usable in a narrow pane. Select a hidden question from Outline and check focus exits.
- Focus the answer, select **Record**, wait for **Listening**, and speak for more than two minutes. Confirm ordered text appears at the earlier caret, becomes **Draft saved locally**, and never commits an answer. Stop should finish buffered speech; Cancel should keep inserted text. Repeat with the configured shortcut, silence, deliberate repeated words, caret changes, model lag and draft recovery. Check Escape, Tab through controls, moving to References or another question, and narrow-pane button focus. Automated synthetic audio does not establish these microphone/UI checks.
- Open **Settings > Voice**, choose a microphone and downloaded model, save, and reopen Explorer to check persistence. Disconnect a selected device and confirm Explorer explains the problem. Check that the recording bars respond to your speech, stay flat in silence, and stop during transcription.
- Answer a question and confirm relevant deeper questions appear.
- Research another question; confirm progress appears in the node and the main chat stays quiet. Inspect relevance, source links and uncertainty. Add a recommendation and selected details to an existing draft, undo an addition, then save explicitly. Cancel another research run and confirm your answer is preserved.
- Export both files, open the JSON in a new canvas, and confirm the full map returns.
- Open Library in a different chat, search/pin/archive/unarchive a journey, then reopen it. Confirm questions arrive in the new attached chat. Try importing a changed export with the same identity and verify both duplicate choices. Type an answer, wait for **Draft saved locally**, reopen the journey and restart Explorer to check recovery. Check changed-answer and cross-canvas recovery choices, explicit discard, and manual-question switch guards.
- Check the narrow layout, keyboard focus, pan/zoom, and light/dark appearance. Show and hide the minimap at 280px width and in a short pane; verify its viewport box, selected/fold/focus markers, pointer cancellation, arrow keys and visible schematic recovery hint. Confirm the editor and map controls remain reachable and late cancelled dictation does not insert text.

Automated runtime fixtures cannot establish desktop rendering, actual model research quality, or successful slash-command discovery in your visible session. Those checks remain manual.

See [AGENTS.md](AGENTS.md) for development rules and [the assessed Copilot practices](docs/copilot-integration.md) imported from Usage Insights and Enhance Prompt.

History retains up to 50 snapshots and 128 MiB per journey, with up to 10 protected named checkpoints. Older unnamed snapshots are pruned first. Restoring preserves local drafts for explicit recovery and creates a new revision when content changes. See [history storage and recovery](docs/history.md) for the commit protocol, limits and recovery instructions.

Suggest a missing direction from a branch's **Missing a direction?** disclosure. **Add & explore** saves your original text and asks Copilot to develop questions underneath it. Seeds are labeled as user directions, stay separate from answers and question counts, and remain available for retry after generation fails or is cancelled. Accept proposed questions in the preview before they enter the map. [Schema and behavior](docs/question-preview.md#missing-directions).

### Pinned constraints and AI request scope

Edit guidance to add up to ten user-supplied constraints, each with up to 1,000 JavaScript characters. Text stays exact; these statements are not verified facts or answers. They are separate from private visual reference pins and remain in native files, history and complete Markdown. Empty legacy metadata stays absent. Guidance changes require cancelling an active generation/research request; staged questions and help are invalidated when their captured sources change.

**Research** opens an inline review in the bottom drawer before an explicit **Research** start. The question, saved-context summary, model, source behavior and effort appear first; exact inputs, omissions and advanced preferences are expandable. **Back** returns to the findings; **Answer draft** preserves the review while focusing the existing editor. Inspect required guidance, pins and the selected question, exclude optional ancestors or other answers, and inspect the exact prompt and instructions. Depth and source preferences refresh this exact preview without starting inference. Saved results retain these settings; older results show unknown settings. Choices are request-local and expire after ten minutes; changed saved sources require refresh and a new explicit start. No project files or source attachments are included. Drafts remain untouched. See [research context review](docs/research-context-review.md) for limits and lifecycle.

AI request context offers ancestor-path-only or additional-decision scope for the next request. Checking coverage or changing scope does not start inference. Topic, objective, success criteria, mode, all constraints and the active node are mandatory. Nearest ancestors are considered first, then other saved stateful questions by tree distance and stable ID. Optional records are omitted whole with counts and reasons; no answer or constraint is truncated. Mandatory overflow requires shortening the selected answer or guidance/pins.

The 128 KiB (131,072 byte) ceiling measures UTF-8 bytes in the actual Explorer-authored SDK prompt and instruction strings, including serialized JSON escaping and the packaged research instructions. It is not a token estimate, provider limit or measure of existing attached-chat context. Native `get_exploration` still exposes the full current committed map to the attached chat. Payload exclusions do not erase information already in chat. Drafts, private visual references, library metadata, history and audio are excluded from these prepared payloads. Generation also uses bounded child question/direction cues and separately labeled historical model explanations to avoid repeats and preserve reasoning continuity. Path-only scope excludes child cues. These are never user decisions; research does not acquire those generation-only fields.

Question help retains its smaller 16,000 serialized-character input bound, adding only explicit pinned guidance and matching freshness checks; it can fail if mandatory guidance cannot fit. It still excludes the selected answer and other branches. Clean My Answer remains answer-only. Visible native layout, microphone behavior and live model quality require manual checks.

Large maps mount compact cards near the viewport while keeping the selected editor and the current keyboard-focused control connected. Pan and zoom reuse stable layout geometry; resizing, folding and changed editor dimensions refresh it. Use **Outline** to reach any logical node and **Fit** to recover the visible map. Existing document/node limits still apply; fitting an entire map can mount every visible card.

### Diagnostics and support

Open **Settings > Local data and diagnostics > Diagnostics** for read-only host, speech and owned-helper prerequisites. **Retry checks** refreshes observations without recording, inference, sign-in prompts or downloads. Ready describes observed prerequisites; model loadability, live capture and future provider/tool access remain unknown. Installed speech component compatibility stays cached until Explorer restarts.

**Export support JSON** explicitly downloads only the categories shown in the dialog. It excludes user content, identities, paths, device names and raw errors. Helper shutdown uncertainty remains a blocker even after a recovery notice is dismissed. See [the support schema and detection limits](docs/diagnostics.md). Native layout, microphone operation and live provider quality still need owner verification.

### Selected project files

In **Challenge decisions**, enter up to five relative text/source paths and choose **Read / refresh selected files**. Review exact Unicode excerpts, source hashes and included/total bytes before starting. Changed or missing sources require explicit refresh. Files only ground this tool-free challenge; questions, web research/follow-ups, other helpers and exports omit them. Selection/results are transient, but native SDK helper journals may retain input. [Limits, freshness and retention](docs/project-context.md).

Portable map exports: use **Export maps** for Mermaid, JSON Canvas, SVG or a downloadable print document with a manual Brave Save as PDF path. Choose the whole saved journey or the selected branch and all descendants, independently of folds and focus. See [portable export scope, limits and fidelity](docs/portable-exports.md). Complete native and Markdown archives remain available.

Confirmed cross-branch decision relationships are available in Question tools > Context; see [decision dependencies](docs/decision-dependencies.md).

[Downstream decision impact](docs/decision-impact.md) explains saved-map tree/dependency exposure from Question tools > Context; its counts and bands remain separate from historical AI importance. Choose **Connections > Downstream impact** for full-map bands on incoming question connections, with patterns, widths and matching Outline text.

[Critical paths](docs/critical-paths.md) temporarily highlights all high-impact decisions and unresolved recorded dependency chains, keeps explanatory context visible, and restores prior navigation when you return.

[Answer-change consequences](docs/answer-consequences.md) previews affected reasoning before a consequential save, preserves drafts on cancel, and retains review provenance and research warnings.
