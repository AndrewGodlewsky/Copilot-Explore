# Conflicting or insufficient research evidence

The Research drawer keeps model-identified conflicts and evidence gaps beside the options and claims they affect. Expand a limitation to see the concern, its recorded scope and a practical next step. The overview under **What is still uncertain** also includes concerns about the whole question. These are historical model interpretations, not independently verified findings or an exhaustive review.

When a limitation prevents a justified recommendation, the result says **No recommendation yet** and shows what evidence or decision is needed next. Research may return zero or one useful option instead of inventing alternatives. A gap that does not block the recommendation can remain attached to a qualified conclusion. You can still inspect alternatives, append a suggestion to your private draft or write your own answer; none of these limitations supplies or requires a user decision.

The researcher is instructed to explain disagreements through scope, dates, methodology or unresolved facts only where evidence supports that explanation. It must disclose unknown causes and circular/dependent citations, without source-count voting or confidence percentages. If usable retrieval fails, a reasoning result must disclose the missing evidence and contain no sources; this does not add a new retrieval mode or bypass runtime/account/tool checks. Research permissions and the separate reasoning-only mode work remain unchanged.

## Saved contract

Versioned research may contain an optional `limitations` array of at most 12 records:

```json
{
  "id": "access-gap",
  "kind": "conflict",
  "summary": "Two sources disagree about Sunday access; their applicable dates are unclear.",
  "claimIds": ["access"],
  "optionIds": ["cupboard"],
  "decisionIds": [],
  "blocksRecommendation": true,
  "nextStep": "Ask the host which Sunday access policy currently applies."
}
```

Kinds are `conflict`, `missing-evidence`, `assumption`, `unanswered-question` and `dependent-sources`. IDs are unique within the limitation array, 1–32 ASCII characters, starting with a letter and containing letters, digits, underscores or hyphens. `summary` and `nextStep` are nonblank and at most 600 UTF-16 code units each. References must be distinct and known: 0–3 claims in this result, 0–4 current options and 0–8 prior decision IDs already captured in `recommendationAssessment.decisionRefs`. All three scope arrays empty means the whole question. Captured decision references describe historical user intent; they are not current facts or permission to read excluded answer bodies.

Every record requires the shown fields and an actual boolean `blocksRecommendation`. Unknown fields, references, duplicates and excessive values reject the result without clipping. The array requires `optionsVersion:1` and a recommendation assessment. Any blocker requires a null recommended option; when the structured array is present, a null recommendation requires at least one blocker with a nonblank next step. The validator checks consistency and structure, not whether a limitation is true or a proposed next step will resolve it.

Missing legacy arrays stay readable with unknown structured coverage. An empty array means the model identified no structured limitations, never that the evidence is complete. New helper guidance requests these records, while old compatible output remains accepted. Existing claim/source limits, the 160,000-byte research bound and 80,000-character raw helper limit still apply to the complete result, including limitations.

## Reuse and sharing

Native save/reopen, history and imports retain records; import source provenance is still demoted. Complete Markdown gives references beside affected options/claims and includes full scope and next steps. Offline HTML uses local limitation/claim/option/context IDs, excludes unselected node identities and answer bodies, and renders all content literally. Disclosures perform no inference or automatic navigation. External source links still open only when selected.

ADR and implementation-handoff evidence selection retains selected claims, their individual limitation text and sources, plus structured qualifications attached to those claims or to the whole question. This bounded projection has at most 12 records with `id`, `kind`, `summary`, `claimIds`, `blocksRecommendation` and `nextStep`; empty claim scope means the whole question. The same 600-unit text, three-claim reference and aggregate evidence/request limits apply. It omits option bodies, option-only limitations and prior-decision identities/context. Saved captures, helper inputs and source appendices retain these qualifications; a qualification-only change makes the evidence stale. The full option/recommendation overview remains excluded. An omitted or empty projection does not certify complete evidence.

Follow-ups include limitations in the existing optional evidence record. Exact review and omission counts remain authoritative; omitted limitations and referenced bodies were not examined. Discussion does not silently replace saved evidence or clear its blockers. Tool-free priority reconsideration receives the complete prior research: while it has a recorded recommendation blocker, a returned winner is rejected. Hypothetical priorities cannot establish fresh evidence or change actual saved constraints. Useful comparisons and unknown cells remain possible, as does the user's own answer.

## Verification limits

Fixtures cover contradictory sources, circular citations, sparse/zero options, unavailable retrieval, conflicting captured constraints, nonblocking conclusions, bounds, legacy/import/history, artifact privacy and bounded omissions. DOM and Brave tests cover local disclosures, literal Unicode, draft/composer/focus retention, replacement reset, keyboard use and narrow expanded layout. Installed anonymous SDK fixtures exercise result validation and captured context without paid providers or existing sessions. Successful source-read attribution is separately exercised by deterministic hook tests; these checks do not measure live research quality or semantic truth. Native #91 acceptance, physical IME/screen readers and live #110 measurements remain separate.
