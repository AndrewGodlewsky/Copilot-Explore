# Answer states

States describe the user's committed meaning, not question importance, model confidence or external verification. The root remains the idea and has no state control or question count.

| Stored value | Label | Answer text |
| --- | --- | --- |
| `unanswered` | Unanswered | Empty; the user must explicitly clear existing text |
| `decided` | Decided | Required |
| `tentative` | Tentative | Required |
| `assumption` | Assumption | Required |
| `needs-evidence` | Need evidence | Optional note |
| `not-relevant` | Not relevant | Optional note |
| `revisit-later` | Revisit later | Optional note |

Whitespace-only text counts as empty. Answer text preserves exact Unicode and whitespace. Invalid state/text combinations retain editor input and show an explanation; explicit invalid state values are rejected by imports and commands.

## Shared semantics and version-1 migration

`web/answer-state.mjs` is a dependency-free module shared by the model, drafts, prompts and browser. It exports `ANSWER_STATES`, `effectiveAnswerState(node)`, `answerStateError(answer, state)`, `questionCounts(document)` and `ANSWER_CONTEXT_GUIDANCE`. The model re-exports the effective-state and count helpers. Future dashboards and filters should use these helpers.

Missing state in a v1 document means Tentative for nonempty answers and Unanswered for empty answers. Validation leaves those missing fields sparse; it does not add thousands of redundant default fields and push a near-limit legacy map beyond the unchanged 9 MiB limit. Native JSON remains v1 and preserves explicit states. Its absent fields carry the documented legacy meaning. A meaningful answer save persists an explicit state. No content is dropped and existing research is preserved.

`questionCounts` returns `{ total, answered, resolved, deferred, unresolved }`, excluding the root:

- Answered: nonempty committed answer text, in any state.
- Resolved: Decided or Not relevant, with `review === false`.
- Deferred: Revisit later, including questions needing review.
- Unresolved: total minus resolved, never total minus answered.

These sets overlap: a tentative answer is both answered and unresolved; a no-note Not relevant choice is resolved but not answered. Local drafts affect none of these counts.

## Saves, review and context

[Guided review](guided-review.md) exposes outstanding causes one at a time. Reaffirm preserves text/state and acknowledges only the selected current cause; revise/clear and ordinary saves explicitly confirm acknowledgment of all current causes. Dependency edits now retain both endpoints and mark the dependent reasoning for review. Legacy flags and bounded historical gaps remain explicit.

`answerNode(document, nodeId, answer, answerState?)` validates text and state, returns whether saved data changed, and marks tree/dependency/mixed downstream nodes for review when text or effective state changes. A save acknowledges the node's own current review causes. Consequential changes require a fresh [answer-change preview](answer-consequences.md), with bounded saved-base provenance and separate retained-research warnings. Omitting state retains the existing effective state where valid, otherwise defaults to Tentative for text or Unanswered for empty text. The editor preserves a deliberate selection and explains invalid combinations.

`Explorer.command('answer', { revision, nodeId, answer, answerState, expand?, draftRevision?, draftJourney? })` commits both fields through the existing revision-checked atomic save. A no-op preserves revision, timestamp and finished status but still reads the current on-disk revision. No-text states can save and deepen without fabricated answers; Unanswered cannot deepen. `refresh-answer` is a read-only counterpart to `refresh-guidance`: it validates the active identity and current disk revision and refreshes the controller snapshot. Changed answer bases then require an explicit draft choice before retrying. Another intervening writer still fails normal save checks.

Map nodes, outline rows and Markdown show state labels as text. `contextFor` includes each question's effective state and review flag, including state-only choices elsewhere. The historical `decisionsElsewhere` key is retained for compatibility; its items are saved answers and state choices, not necessarily decisions. Queued question and isolated research prompts explicitly distinguish decisions, assumptions, provisional text, unresolved/deferred issues and review flags. No state implies external verification. Drafts are excluded from these contexts and exports.

See [draft storage and recovery](drafts.md) for click-time capture, legacy draft hashing and conflict semantics. Visible native layout, focus and live research relevance still require manual checks in Copilot.

## Next-question eligibility

The local next-question heuristic excludes root/direction nodes and every Revisit later question, including deferred questions needing review. Decided and Not relevant are excluded when current, but become eligible when flagged for review. Unanswered, Tentative, Assumption and Need evidence remain eligible. Review counts overlap eligible/deferred counts.

Ranking uses computed downstream impact band, then assumptions needing review, other questions needing review, distinct constraint-word matches, objective/success-criteria word matches, historical AI importance and stable ID. Medium/high impact or a review flag can justify a recommendation without an objective or word match; ordinary low-impact questions still require the existing objective and literal-match rules. Exact downstream counts explain only the selected recommendation; they are not hidden within-band tie-breakers. Tree exposure is an estimate, while explicit links are recorded dependencies. No model calls, draft text or research are used.

Dismissal binds the question's saved source, review causes and impact band. A same-band topology change or unrelated answer wording does not reset it; fresh counts still reflect the current saved map. Guidance changes, journey changes, source removal and reload retain the existing reset behavior. Suggestions do not navigate automatically. Explicit Open question navigates only; Save & continue may use the recommendation after the user's answer save, with its existing unresolved-map-order fallback.
