# Research answer options

[Issue #93](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/93) extends the [approved Research workspace](research-workspace-design.md). Read concise choices before the deeper findings. Each new option has a short answer, explanation, fit conditions, material pros/cons and an editable draft suggestion. **Concrete details** and **Findings and evidence** expand on demand. The Research action and wording/term help remain available; existing findings do not repeat the introductory help text.

Viewing an option never saves an answer. **Append to my draft**, **Append recommendation** and selected details preserve existing private text. Equivalent **Replace** actions show a local preview and require **Replace draft** before editing. **Undo draft change** is available until further editing or saving, with deliberate answer-state choices preserved. The separate Save action commits the answer. A newly stale result disables suggestions and invalidates a pending replacement even if its result bytes have not changed; application rechecks the live state. See [draft actions and recovery](drafts.md#research-suggestions).

## New result contract

New helper comparisons require `optionsVersion: 1` and the existing claim/source contract. Normal results have 2–4 options. When evidence or constraints cannot sustain that range, zero or one option is valid only with a nonblank `optionsLimit` explanation of at most 600 UTF-16 code units. That field is rejected at normal counts. Zero options cannot include a top-level `proposedAnswer`; the drawer shows the limitation and further-context guidance without a draft winner or comparison table. A single option remains a suggestion, not proof that it is the only possible answer.

| Option field | Contract |
| --- | --- |
| `id` | Required, unique within the result, 1–32 ASCII letters/digits/underscore/hyphen, starting with a letter |
| `title` | Required short answer, at most 150 UTF-16 code units |
| `description` | Required plain explanation, at most 600 |
| `fit` | Required fit conditions, at most 400; contextual judgment, not verified project facts |
| `pros`, `cons` | Required arrays, each 0–4 nonblank strings of at most 240; empty means none established |
| `proposedAnswer` | Required editable suggestion, at most 1,000 |
| `details` | Optional 0–8 items, each with nonblank `label` (80) and `value` (1,000) |

Unknown fields/versions, duplicate IDs, duplicate titles or draft answers after Unicode NFKC/case/whitespace normalization, missing required fields and overflow are rejected without clipping. Existing claim/source references and aggregate limits remain enforced: 80,000 raw output UTF-16 code units and 160,000 UTF-8 bytes, including escaping and the saved settings/read metadata. Field maxima do not waive the total limit. A malformed response leaves prior research and saved answers recoverable under the existing controller contract.

The packaged skill requests substantively different, feasible choices and honest sparse results. Structural validation catches repeated wording; it cannot prove semantic distinctness, factual support or research quality. Those need separately authorized evaluation. Successful source reads still establish retrieval attribution rather than truth or support for every option sentence.

IDs belong to one validated result and survive order changes and native serialization. They do not identify the same choice across independent runs. The panel binds draft actions to the current saved result; it never infers option identity from recommendation prose. [Linked recommendations](research-recommendation.md) identify one current option or explicitly decline to recommend, with a rationale and historical prior-decision references. [#105](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/105) owns per-statement evidence links; unsupported fields remain rejected.

## Compatibility and retention

Older saved research without `optionsVersion` retains its original 2–4 option bounds and content. Validation does not invent IDs, fit, source support or retrieval metadata. The drawer labels the absence of separate fit conditions and keeps long legacy text readable. Reserved new fields cannot silently downgrade to the legacy format. Newly generated comparisons must use version 1, even though saved legacy data remains accepted.

Native saves, imports, history and complete JSON preserve option identity and limitations; existing imported-source provenance rules still apply. Complete Markdown includes fit, limitation and option references. The selected offline viewer includes fit and sparse limitations while replacing private option IDs with artifact-local IDs, consistent with its existing source/claim projection. Text remains literal and links retain their validated HTTP(S) boundary.

Follow-up review includes the new format and sparse limitation in mandatory context, so omitted optional options cannot hide why the original result was limited. Included option objects retain their IDs; existing record/byte limits and omission counts remain authoritative. Disclosures and detail selections survive ordinary polling and node navigation within the same canvas/result. Replacing the result resets its local choices and pending draft replacement. Persistent conversations remain separate work.

## Verification limits

Behavioral tests cover new/legacy validation, sparse results, duplicate and invalid fields/references, exact byte/character envelopes, native history, imports/exports, literal Unicode, retained editors/disclosures and draft-only actions including a late stale marker. Authorized Brave checks cover narrow/short/wide layouts, keyboard disclosures and sparse-result replacement without draft loss. The installed SDK fixture uses anonymous loopback model/MCP data for real isolation, tools, parsing, cancellation and usage handling, including zero/one-option output.

No paid provider or existing user session is used in automated tests. Native Copilot, physical IME/dictation, screen-reader experience and live model quality remain unmeasured. #91 keeps its separate pending owner acceptance. This iteration does not expand network access or alter [the approved policy and SDK gates](research-architecture-decision.md).
