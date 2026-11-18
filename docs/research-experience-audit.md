# Research experience audit, November 18, 2026

Issue: [#89](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/89).
Baseline: commit `84fac51`, Explorer v0.1.65. This is an audit of the existing
implementation, not a claim that the proposed redesign has shipped.

The central gap is the route from uncertainty to an answer. Research already
supports options, recommendation prose, comparisons, evidence and follow-ups,
but they are spread across nested disclosures, a separate review dialog, and
long results. The recommendations below preserve the existing request, privacy,
draft and cancellation protections.

## Installation evidence

The supported installed CLI reported `explorer@copilot-explorer` enabled at
**0.1.65**, `source: installed`. Its marketplace list reported
`GitHub: AndrewGodlewsky/Copilot-Explore`, rather than a live local checkout.
Repository metadata and fetched `origin/main` also reported v0.1.65 at `84fac51`.
There is no version mismatch in this evidence.

The inspected runtime and SDK package pair is
`1.0.106-8.unstable.r43566476370.g869eef3`. The CLI was invoked through Node using
the installed runtime's `index.js` because `copilot` is not on this shell's PATH.
No installation records or databases were edited. The supported read-only
commands were `plugin list --json` and `plugin marketplace list --json`.

CLI metadata does not identify the version already loaded in an existing native
canvas or the desktop application's own build. Those remain manual checks:
record the visible Explorer footer and host About/version information, then
start a new session after an update. Do not infer a running canvas's version
from the current checkout or install record.

## Journey findings

Priority describes user impact, not a demonstrated visual failure. Reproductions
below describe code-backed paths and are also the manual acceptance script.

| Step / reproduction | Existing behavior and evidence | Gap / direction | Issue |
| --- | --- | --- | --- |
| Open a question with no answer; look for help | `web/app.mjs` creates research for question nodes without requiring an answer. More options reveals the drawer, Research selects the tab, and Research options is another disclosure. | High discoverability gap. Put Help me answer beside the question and open research without starting inference. | [#92](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/92) |
| Expand research while retaining the question | v0.1.65 already has a full-width, non-modal, expandable bottom drawer outside the transformed map. Research content remains nested inside it. | Medium workflow gap. Reuse the drawer and simplify its contents; do not create a second workspace. | [#90](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/90), [#91](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/91) |
| Choose Research options before typing an answer | Context is prepared locally in a separate dialog. Only Start reviewed research begins the helper. Saved inputs, exclusions, exact strings, settings and byte coverage are shown. | High setup friction: raw structured records dominate. Lead with a concise summary and disclose exact details; retain the immutable single-use review. | [#101](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/101) |
| Start with an existing private draft | The research prompt uses saved map records, not the unsaved draft. The editor survives review and polling. | Existing protection to preserve. Explain this distinction near the summary so users know which answer the model sees. | [#101](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/101) |
| Read completed findings | `renderResearch` appends summary/settings and selected claims before recommendation, comparison and individual options. | High hierarchy friction. Let users scan plausible answers and the conditional recommendation first, then inspect evidence. | [#93](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/93), [#105](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/105) |
| Identify the recommended option | Recommendation is free text with a proposed answer; options have no explicit stable recommendation reference. | Missing structured capability. Name one option when justified and explain the prior decisions that favor it. | [#95](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/95) |
| Change a comparison priority | Existing priorities reorder criteria; UI explicitly says that they calculate no score/winner and leave the recommendation unchanged. | Missing reassessment capability, not a broken sorter. Offer an explicit reviewed reassessment. | [#96](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/96) |
| Use an option with text already in the answer box | Use recommendation, Use this option and selected details append to the draft with undo; they do not commit an answer. | Medium copy/interaction friction. Make append versus replace explicit and preserve separate Save. | [#97](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/97) |
| Ask why an option fits | Ask about this research has a prompt and context-review/start flow. Follow-ups are bounded, hypothetical and use their own isolated helper. | High conversation friction. Present the existing turns naturally and distinguish explanation from fresh retrieval. | [#98](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/98), [#104](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/104) |
| Say that a different priority matters | Follow-up output is answer/uncertainty/claims/sources; it cannot propose a structured replacement of the original options. | Missing reviewable refinement capability. Keep hypotheticals separate from committed answers. | [#99](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/99) |
| Switch nodes, ask on another node, reopen | One transient history retains up to four complete exchanges / 64 KiB. Navigation hides it; successful follow-up on another node replaces it. Closing the canvas discards it; page reload loses unsent follow-up text. | High continuity gap. Add bounded per-question persistence with explicit private-data policy. | [#100](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/100) |
| Cancel or retry research | Owned-helper cancellation, release barriers, prior-result preservation, recovery and usage receipts already exist. Independent answer edits are supported with source checks. | Progress/partial-result UX needs improvement; do not weaken cancellation or pretend unvalidated partial output is evidence. | [#102](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/102) |
| Research with no usable sources | Skill can return reasoning with uncertainty and no sources after unsuccessful retrieval. Current runtime still requires the verified research tools at startup; schema always requires 2-4 options. | Evidence-policy gap: reasoning fallback is not a selectable no-retrieval mode, and sparse evidence can conflict with mandatory option counts. | [#88](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/88), [#107](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/107) |
| Expect the whole map or repository to be understood | Bounded saved ancestors/other stateful nodes are selected by distance; coverage exposes omissions. Selected project files are only available to tool-free Challenge Review. | Missing Smart mode and relevance improvements. Do not quietly feed project text to web research. | [#94](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/94), [#111](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/111), [#118](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/118) |

No new native rendering defect is established by this audit. Source-level
interaction gaps and missing capabilities above should not be reported as
observed screenshots, live model failures, or measured usability results.

## Verification map

The baseline `npm test` run and release checks are recorded in the issue's
publication comment. Existing focused coverage provides reproducible behavior
evidence without paid providers or user sessions:

- `test/web.test.mjs`: drawer/tab/editor retention, comparison priorities and
  draft-only actions, follow-up navigation/reload, literal claim rendering,
  reviewed context and independent answer edits over HTTP.
- `test/research-review.test.mjs`: exact reviewed input, settings/token
  replacement, relevant-source changes, transport bounds and stale approvals.
- `test/research-followup.test.mjs`: transient history, prior-source identity,
  bounded whole records, retained dependencies and cancellation/release queues.
- `test/research-concurrency.test.mjs`: relevant versus unrelated edits,
  destination conflicts, late results and recoverable saves.
- `test/research-evidence.test.mjs` and `test/research-policy.test.mjs`: source
  attribution/limits and depth preferences. These do not establish that a live
  retrieved page supports a claim.

Read [the context/review contract](research-context-review.md),
[SDK tool findings](research-sdk-tools.md), and
[card workspace history](card-workspace.md) before changing these foundations.
Historical browser results in the last document are not fresh checks for this
audit. No browser/desktop automation, live research or reinstall was performed.

## Owner checks for tomorrow

Use a disposable exploration; do not test destructive actions on real work.
Record visible version, pane width, exact action, expected/actual behavior and
any error. The implementation audit can be complete while these are pending;
they are explicitly required before claiming native usability or live quality.

1. Confirm the footer and host version, then navigate an unanswered question to
   Research. Note which action was difficult to find and whether focus follows.
2. Repeat in a narrow side pane and with the drawer expanded. Check keyboard-only
   access, scrolling, current-question visibility and an intact answer draft.
3. Inspect context without starting research. Confirm the saved/draft distinction,
   exclusions and depth/source settings are understandable; cancel the review.
4. If desired under the existing research policy, separately start a nonprivate
   example. Judge whether the options differ, evidence actually supports them,
   and the recommendation explains fit. This uses live model/network services.
5. Ask a clarification and a hypothetical; verify neither changes the saved
   answer. Switch questions, return, reload and reopen to assess continuity.
6. Cancel an in-progress example and retry. Confirm drafts and old findings
   survive, progress is understandable, and no late result reaches another node.

The internet-access decision remains with the owner in #88. The audit supplies
no authorization to expand permissions or send repository content to retrieval.
