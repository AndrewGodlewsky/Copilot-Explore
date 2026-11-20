# Approved Research workspace design

Issue [#90](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/90). **The owner approved all four layout decisions on 2026-11-19**, recorded in the [consolidated decision comment](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/90#issuecomment-7017092971). This document specifies the target experience; it does not claim the entire production redesign has shipped. The [offline prototype](prototypes/research-workspace.html) remains the historical review artifact: its pending-review wording and “Start reviewed research” label are superseded by these decisions and the exact **Research** label below.

Source baseline: Explorer v0.1.104, commit `362a58c80cea3e8584417fa7594b435e395a3d43`. Read the [research experience audit](research-experience-audit.md), [existing drawer contract](card-workspace.md), and [exact context review contract](research-context-review.md) alongside this proposal. The older [research directions](prototypes/research-directions.html) are historical alternatives, not the selected implementation specification.

## Approved experience

Research belongs to the selected question's existing bottom drawer. A person can move from “I do not know enough to answer” to two or more useful alternatives, understand the conditional recommendation, ask for clarification, and write their own answer without navigating through another workspace.

Use one writing surface: keep the existing answer editor mounted above the drawer. Research identifies the selected question and offers **Answer draft**, which reduces the drawer and reveals/focuses that editor. The full question is available in the scrolling content even when the header truncates it. The editor, its text, selection, answer state and private recovery remain owned by the existing draft client. Do not create a synchronized second answer textarea in the drawer. The owner explicitly approved this return action; native short/narrow-pane usability remains a separate verification item.

The visual direction preserves Explorer's Segoe UI typography and restrained blue palette: paper `#ffffff`, panel `#f5f8fa`, ink `#183544`, secondary text `#586e7a`, rules `#d8e2e8`, action/branch blue `#246783`. Existing theme tokens should supply dark mode in production. The distinctive element is the side-by-side decision tradeoff when width allows; evidence, status and conversation support it. Avoid decorative chat bubbles, confidence scores, animation and extra modal navigation.

### Layout and content order

| Region | Compact drawer | Expanded drawer |
| --- | --- | --- |
| Existing map/question stage | Remains usable above the drawer; the original editor stays mounted | Retains a usable minimum height and scrolling; Answer draft reduces/reveals it |
| Drawer header | Current question, draft access, expand/reduce, close; ordinary drawer tabs | Same controls, identity and order; no independent research window |
| Research status | Source mode, current/historical status, uncertainty and next action | Same information; never bury it in evidence disclosures |
| Main content | One column: concise alternatives/recommendation, optional comparison, follow-ups | At sufficient width, alternatives/comparison on the left and follow-ups on the right; narrow widths stack |
| Context review | Inline review panel within Research | Same panel with more space for exact details |
| Evidence | Per-option/claim disclosures | Same disclosures; expand only the evidence the person requests |

The prototype has 360 px, 560 px and wide specimen controls plus light/dark choices. These are design-review controls, not proposed production controls. Production sizing should reuse `question-drawer`, `question-stage` and existing layout rules; do not put research inside the transformed map or replace map geometry. In extremely short panes, allow existing stage/page scrolling and reachable controls rather than forcing all regions into an unreadable fixed height. Native measurements remain pending.

## Complete journey

1. **Help me answer** appears beside the question/answer actions, including unanswered questions. It opens Research and moves focus to its heading. This is local navigation only: no helper, permission request, search or automatic context refresh.
2. **Review research context** prepares the bounded saved inputs locally. Show a readable summary first: target, saved decision states, objective, constraints, source mode and exclusions. Explain that the unsaved answer draft is excluded. Exact instructions/prompt, whole selected records, omission counts/reasons and actual byte usage stay available in disclosures. Required inputs cannot be unchecked. Optional exclusions/settings create a fresh preview and invalidate the previous token.
3. **Research** consumes the exact reviewed preparation. The owner approved default help from existing map/findings without new retrieval, with one approval per bounded Research request covering its question, scope and effort. Changed scope, disclosure or effort requires renewed review; host-required permissions still apply. Preserve the existing owned helper, account/model/tool checks, cancellation, request identity, source freshness and usage receipts. Moving review into the drawer changes presentation, not these authority boundaries. Implementation and enforceability remain tracked in #88/#104; this design does not waive #41/#42 or authorize repository disclosure. Challenge Review, question regeneration and ADR review retain their separate flows unless their own issues deliberately migrate them.
4. Show meaningful known progress. The person can continue writing. Previous complete findings remain labeled as earlier findings when a new operation runs. Completion announces availability without stealing focus or replacing the answer editor.
5. Present concise, materially different answers first. Each has a plain-language explanation, pros, cons, fit to saved context, evidence basis and limitations. One conditional recommendation names an option where justified; it explains which earlier decisions favor it and what could reverse it. Do not force a winner when evidence cannot justify one or invent alternatives to meet a count.
6. **Compare** reveals tradeoffs against explicit criteria. Priorities may be explored hypothetically; changing a control does not silently recompute a winner, alter constraints or save an answer. A new assessment requires explicit review/start under the approved policy.
7. **Ask a follow-up** uses a normal multiline composer in the same drawer, beside answer options in wide panes and below them in narrow panes. Review the exact follow-up, original result and included history before starting. Distinguish explanation using existing material from fresh retrieval as specified in #88/#104; the product policy is approved, while implementation must enforce it. A follow-up does not silently update the original findings.
8. If a follow-up proposes a revised comparison, show the proposed change and its hypothetical basis. **Use revised comparison** and **Keep original comparison** are separate choices. Accepting a research revision does not save hypothetical priorities as project constraints or answers. Stable option/result identities must come from the structured contract; never infer them by matching recommendation prose.
9. **Append to my draft** preserves existing wording and adds the selected suggestion. **Replace my draft…** previews the replacement and asks for that specific local edit. Both are draft operations with conditional undo until subsequent editing; neither commits an answer. The separate existing Save action remains the only answer commitment. Choosing a nonrecommended option is equally available.

The prototype's fictional tool-library question completes this journey. Its scripted follow-up changes the hypothetical priority from simple coordination to variety/shared costs, making the broader option worth considering. It does not assert factual research about tool libraries. The “Show scripted result” button is a prototype control; real completion is asynchronous and does not move focus.

## States and recovery

| State | What appears | Allowed next steps and preservation |
| --- | --- | --- |
| Empty | Question, purpose and local context-review action | Keep writing or review; no automatic request |
| Preparing/reviewing context | Human summary, source mode, exclusions, settings, actual coverage and exact strings | Exclude optional records, refresh, start explicitly or go back; retain editor/composer text |
| Loading/queued | Known phase, cancellation, bounded effort setting; prior validated findings labeled separately | Continue drafting or cancel; no invented progress percentage or promised completion time |
| Partial | Only previously validated complete units or earlier complete findings, with explicit omissions | Read retained findings or request a fresh/deeper reviewed pass; raw streamed text is not evidence |
| Failed | Specific recoverable reason, prior result and drafts | Review/refresh and retry explicitly; no hidden retry or tool/provider fallback |
| Cancelled | Cancellation state and any earlier result; if none existed, say no findings were completed | Preserve draft/composer; new explicit review/start required; reject late output |
| Stale | Historical label, changed-source reason where known and review action | Read old material; proposal actions/follow-up require renewed review. Retain draft/caret; never relabel old evidence current |
| Resumed | Retained question/result/conversation identity, coverage/truncation and historical status | Inspect or explicitly continue after source checks; reopening does not imply new retrieval |
| Unavailable | Missing prerequisite, disallowed mode or release-barrier reason | Keep writing, inspect relevant diagnostics or retry the prerequisite explicitly; never imply permissions were granted |
| Sparse/conflicting evidence | Honest uncertainty, missing criteria and disagreement | Ask for context, use a provisional draft or defer a decision; do not manufacture confidence or a winner |

Current research does not expose arbitrary validated partial model output. The prototype therefore uses **earlier complete findings** for its partial state. #102 must define any future partial-result contract before presenting unfinished content as useful findings.

Result freshness is independent of operation status. A stale result remains historical through context review, loading, cancellation or failure; those transitions cannot restore its proposal actions. A contributing source change discards pending comparison/replacement proposals while retaining authored drafts and composer text. Only a valid replacement result restores current actions. The prototype's separate review controls can also explicitly select a fresh Complete fixture or reset the demo; those are not app recovery actions.

Closing the drawer or changing its tab hides the workspace; it does not cancel an already started helper. **Cancel research** is explicit. Canvas/session shutdown retains existing owned-helper stop semantics. On node/journey changes, bind all results, drafts and replies to their original identities. Do not deliver an old reply to a newly selected question or automatically reopen a dismissed drawer on ordinary polling.

## Keyboard, focus and text ownership

| Action/event | Focus behavior |
| --- | --- |
| Help me answer | Research heading after local open |
| Prepare context | Inline review heading; retain the originating control for Back |
| Change an exclusion/setting | Retain the same control by stable identity after the refreshed review renders |
| Explicit Start | Status/progress area; later background progress/completion uses a polite announcement without focus movement |
| Compare / Ask | Comparison heading / follow-up composer |
| Append or confirmed Replace | Existing answer editor; place selection at inserted text as appropriate, with undo available |
| Answer draft | Reveal original editor and reduce drawer; preserve its text and appropriate caret |
| Close / Escape | Original Help me answer/Research launcher. Escape first dismisses an inline replacement review or returns from context review, then closes the drawer |
| Source/journey change | Invalidate stale controls; retain correctly scoped drafts. If the focused target disappears, use a stable visible fallback and announce why |

Use native buttons, textareas, labels and disclosures. The non-modal drawer has no focus trap. Reuse the existing drawer tab keyboard behavior; do not invent another competing tab system. Enter inserts a newline in textareas; explicit controls start operations. Suppress map shortcuts while editing. Composition and dictation must not be interrupted by polling or background rendering. Avoid remounting active editors, replacing their values during refresh, or announcing every progress tick. Screen-reader, native IME and actual focus feel remain owner verification.

## State and component responsibilities

| Responsibility | Existing foundation / proposed boundary |
| --- | --- |
| Drawer geometry, selection, active tab and focus | Existing `web/app.mjs`, markup and layout; #91 refines presentation without a second workspace |
| Research context preview/token/exclusions/settings | `web/research-review-client.mjs` and server-owned `research-review.mjs`; display a human summary without reconstructing the actual model input in the browser |
| Helper lifecycle, identities, cancellation, stale-source checks, receipts | `controller.mjs`, `research.mjs` and existing SDK integration; view callbacks cannot initiate an unrelated user operation or fulfill research |
| Option/recommendation/evidence validation | Existing model/evidence validators plus #93/#95/#105/#107; UI renders literal validated text and safe HTTP(S) links |
| Conversation and revision proposals | #98/#99, with per-question persistence and bounds decided by #100; transient display state is not a shared project record by default |
| Answer text/state/private recovery | Existing draft client; append/replace/undo delegate through it and retain explicit Save |
| Project-aware context | #111–#119 and the separate #118 policy gate; repository excerpts do not enter ordinary research as a side effect of this design |

Local view state includes disclosure state, comparison visibility, scroll position, a scoped composer and draft-edit undo. Authoritative prepared inputs, result identities, saved answers, source checks and operation receipts stay in their existing owners. Request/instance/session IDs, journey/node identities and editor generations remain required after awaits. Background completion must not overwrite text typed during the request. Source replacement, cancellation, page suspension and helper release need independent tests, not just a happy-path walkthrough.

## Implementation map

| Issue | Work enabled by this design |
| --- | --- |
| #91 | Expandable drawer layout and retained editor/focus |
| #92 | Discoverable Help me answer entry |
| #93 | Concise distinct alternatives and readable tradeoffs |
| #94 | Relevant bounded map context; independently implementable after the audit |
| #95 | Structured recommendation identity and rationale |
| #96 | Comparison criteria and explicit reassessment |
| #97 | Clear append/replace/undo draft actions |
| #98 | Conversation presentation and scoped follow-up review |
| #99 | Explicit revised comparison proposals |
| #100 | Bounded per-question conversation persistence and privacy choices |
| #101 | Inline human-readable setup preserving exact review |
| #102 | Truthful progress, cancellation and retained prior findings |
| #103–#110 | Guidance profiles, source modes/evidence/freshness, effort/cache and evaluation; their own prerequisites remain binding |
| #111–#119 | Reviewed project context, Smart question generation and evaluation; no implicit research disclosure permission |

The owner-feedback prerequisite is satisfied: options first with concise explanation/pros/cons and a marked recommendation, one-click Answer draft return, inline context/effort review with expandable exact inputs and the Research label, and responsive conversation placement. Dependent production issues can proceed within their scopes. #88 separately records the approved retrieval policy and outstanding enforceability limits.

The #91 implementation adds the drawer shell, direct Research content, responsive placement of existing findings/follow-ups, current-question identity and Answer draft return. Existing compact/expanded sizing, per-tab scroll and editor ownership remain in use. [#93's option contract](research-options.md) adds concise choices first, fit conditions, stable identities, expandable depth and honest sparse results while preserving legacy research. [#95’s linked recommendations](research-recommendation.md) identify one option or no justified winner, with tradeoff, reconsideration conditions and historical prior-decision references. Richer conversation (#98) and inline request review (#101) remain separate work; the existing exact-review dialog remains until #101. #120 adds the separately approved optional dedicated research model, defaulting to the selected chat model; this iteration does not implement that setting.

## Review record and evidence

| Review item | Status |
| --- | --- |
| Source inspection against current drawer/research modules | Completed for the proposal baseline; existing behavior distinguished from proposed features |
| Offline scripted DOM walkthrough | Passed against the repository artifact: explicit review/start, initial cancellation without invented findings, append/replace/undo/separate Save, accepted hypothetical revision, stale gates retained through refresh cancellation, invalidated pending proposals, retained editor, focus and no external request. Inline script syntax and local links also passed. No model, real project or user session |
| Native visual layout and keyboard/screen-reader/IME use | Pending owner check; no browser/desktop automation |
| Live research quality, source reliability, model cost/latency | Not measured by this prototype |
| Owner decision on this design | **Approved explicitly**, [all four decisions](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/90#issuecomment-7017092971); no further design confirmation required |
| Owner internet/disclosure policy | [Existing-material-first default and Research label](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/88#issuecomment-7016077364), [bounded request approval](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/88#issuecomment-7016259614); implementation limits and private-context disclosure remain separate |

For review, open the HTML manually in Brave. Walk the scripted flow at 360 px and wide widths, compact and expanded, light and dark. Try keyboard-only navigation, multiline drafts, composition, source-state changes and cancellation. Record the visible state, action, expected behavior and actual difficulty.

The four product questions above have been answered. Manual usability observations may refine implementation, but do not reopen those approved decisions. Record actual viewport, action, expected behavior and observed difficulty separately from design approval and automated fixture results.
