# Linked research recommendations

[Issue #95](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/95) adds an explicit recommended-option reference to [research answer options](research-options.md). One option can carry a passive **Recommended option** badge. The explanation states why it fits the reviewed context, its main tradeoff and what changed assumption would make it worth reconsidering. This is contextual judgment from the model, not a verified project fact or an answer the user has accepted.

All alternatives and custom answering stay available. Viewing a recommendation never selects or saves an answer. **Use recommendation** appends the referenced option's editable suggestion to the private draft; Save remains separate. If evidence or constraints do not justify a winner, the result says **No recommendation yet**, explains the limitation and offers no winner action. A null recommendation can accompany multiple viable options as well as an honest zero/one-option result.

## Result and context contract

New helper comparisons require `recommendationAssessment` together with `optionsVersion: 1`. Older saved results may omit it. The assessment accepts only these fields:

| Field | Contract |
| --- | --- |
| `optionId` | Exactly one ID from the result's options, or `null`; unknown IDs, arrays and multiple winners are rejected |
| `mainTradeoff` | Required nonblank text, at most 600 UTF-16 code units |
| `reconsiderIf` | Required nonblank text, at most 600 |
| `decisionRefs` | Required array of 0–8 unique prior-decision references |

The existing `recommendation` text is the rationale, limited to 800 code units for assessed results. A separate top-level `proposedAnswer` is forbidden: the chosen option supplies its own draft. Existing aggregate character/UTF-8 limits still apply; field limits do not guarantee the whole result fits.

The helper supplies each prior reference as `{nodeId, reason}`: a nonblank exact ID of at most 100 code units and a nonblank explanation of at most 400. References must identify ordinary question answers actually included in the reviewed ancestor or cross-branch context. Root/direction nodes, unknown or excluded nodes, unanswered questions and blank saved answers cannot become credited prior decisions. The helper cannot supply state/review assertions. Explorer captures the actual `answerState` and `review` flag from the prepared request before validation and storage.

The drawer displays that historical state beside each reason, including assumptions, unresolved evidence and needs-review flags. **Review prior decision** navigates to the question when it still exists. The saved reference does not copy its answer body, assert present truth or authorize another read. References can outlive a deleted question; their explanation and historical label remain readable without a broken navigation action. Follow-up context retains the assessment and explicitly warns when referenced option or decision bodies have been omitted by its existing limits.

## Changes, compatibility and exports

Existing answer/guidance/branch changes conservatively mark research as stale. The drawer then marks its recommendation as needing review and disables suggestion application, including when polling only changes the stale marker. Existing private text, caret and editor ownership stay intact. This does not create new dependency edges or silently rerun research.

Older saved recommendations retain their text and original bounds. They show a compatibility explanation with no guessed option badge; their existing explicit draft action remains available when fresh. Imports and native history preserve validated assessments, including historical references whose source nodes no longer exist. Full Markdown describes the winner or inability to recommend, tradeoff, reconsideration condition and historical state. Selected offline export replaces option/node identities with artifact-local IDs and labels references outside the selection without exposing their original IDs.

The packaged skill asks for an honest conditional judgment. Structural validation and authored cross-branch fixtures cannot prove factual support, relevance or live research quality. Per-statement evidence links remain [#105](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/105); richer draft replacement is [#97](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/97).

## Verification and boundaries

Focused tests cover strict winner/reference validation, context exclusions, historical state, changed cross-branch fixture rationale, Unicode/output limits, native/import/history/export preservation, legacy and null winners, draft-only actions and late staleness. The installed anonymous loopback SDK fixture exercises real parsing, isolation, cancellation and retained usage. Authorized Brave checks cover narrow/short/wide layouts, keyboard access and retained drafts; they use synthetic data without a paid provider or existing session.

Native Copilot acceptance remains pending in [#91](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/91). Physical IME/dictation, screen-reader experience and live model quality are not established by these tests. This change grants no additional internet, project-file, model or attached-session access; [the approved research policy and SDK gates](research-architecture-decision.md) remain in force.
