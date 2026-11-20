# Inspect support for research statements

Each pro, con and recommendation premise has an expandable support label beside its text. Open only the statements you want to check; the option and answer editor stay in place. Opening a disclosure makes no model call and does not open a source. A source link opens a separate page only when selected.

The labels distinguish source-linked model interpretation, historical user context, model reasoning without external support, and unknown support. Inside are the recorded claim, bounded model paraphrase, source link, retrieval metadata and limitations. Historical user references retain their captured answer state and review qualification; they are user intent, not current project facts. Explanations and fit summaries remain contextual model judgments, and comparison detail cells retain their separate unknown-support qualification.

A successful page read records retrieval of the requested URL. It does not establish that a paraphrase is accurate, relevant, current or sufficient to support a claim. An irrelevant citation or contradictory passage can be structurally valid; the interface keeps the model's limitations visible and never calls these claims verified. The validator checks identities and exact statement associations, not semantic truth. Missing links remain **Support unknown**, including plausible factual statements and older research. No support is inferred by matching similar prose to a claim.

## Saved format

Research with `optionsVersion: 1` may include `support`, an array of at most 35 entries:

```json
{
  "optionId": "option-a",
  "field": "pros",
  "text": "The exact complete saved pro",
  "claimIds": ["c1"],
  "decisionIds": []
}
```

For option tradeoffs, `optionId` is a current option ID and `field` is `pros` or `cons`. For the complete `recommendation`, `mainTradeoff` or `reconsiderIf` field, `optionId` is null. `text` matches that complete string after the existing whitespace validation. Each distinct option/field/text target appears once; identical repeated text in one field shares its association. Reordering options or tradeoffs preserves links. Changing or removing a target requires updating or removing its entry; mismatched targets are rejected.

`claimIds` contains 0–3 distinct known claim IDs. `decisionIds` contains 0–8 distinct node IDs already captured in `recommendationAssessment.decisionRefs`. Arbitrary current map nodes do not qualify. Both arrays may be empty, meaning support is unknown. Unknown fields, references, duplicate targets and excessive counts are rejected without clipping. A linked claim still obeys its existing basis/source rules. The limits of 12 claims, 15 sources and 3 source paraphrases per claim remain unchanged. Associations count toward the existing 160,000-byte saved/result bound and 80,000-character raw helper-output limit; field maxima do not waive those limits.

The packaged researcher requests these associations. Omitted annotations are accepted with visible unknown status so older saved research and older output remain readable. An annotation cannot silently downgrade into unversioned research. Existing text fields and original evidence remain intact; no global document migration or extra retrieval is introduced.

## Retention and sharing

Native save/reopen, history and JSON imports preserve associations. External imports still mark source metadata as imported; native reopen preserves recorded provenance. Changes to saved decisions retain research as historical under the existing freshness rules.

Complete Markdown places support references beside the statements and retains the full claim/source/limitations section. Offline HTML shows local disclosures, remaps option/claim/source identities, and uses artifact-local context IDs; unselected original question IDs and answer bodies stay outside the selected artifact. Historical context reasons are deliberately part of the selected research, as before. Only separately selected questions receive navigation targets.

Follow-up preparation includes support inside the existing optional evidence record. It can omit that record or an option body to meet the existing budget; exact review and omission counts remain authoritative. An included association is historical model interpretation and does not establish that an omitted record was read. Priority reconsideration already receives the complete prior research snapshot and retains these same qualifications.

## Verification limits

Fixtures cover exact/reordered/revised targets, missing and duplicate references, limits and Unicode, irrelevant citations, contradictory paraphrases, plausible unsupported statements, imported provenance, save/history/reopen, export identity privacy, follow-up exclusions, disclosure focus and draft retention. The installed SDK fixture uses anonymous local model/MCP data; real page-read provenance is covered by deterministic hook tests. It does not measure live research quality or entailment. Brave checks cover five viewport sizes and keyboard disclosure behavior. Native Copilot acceptance remains pending under #91, and physical IME/screen-reader experience remains separate. This change adds no runtime/network permissions and does not resolve #41/#42 or the #110 live-quality pilot.
