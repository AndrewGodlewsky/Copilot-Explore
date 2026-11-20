# Research effort and partial findings

Research uses the depth chosen in the inline review. Quick is a focused pass (60 seconds, 8 tool attempts), Standard compares the material criteria (180 seconds, 24 attempts), and Deeper allows more investigation of difficult gaps (300 seconds, 40 attempts). These are ceilings, not targets or promises about quality, price or completion time. Setup counts; waiting for an earlier helper's release does not. Shutdown and retained usage accounting may finish later.

The packaged research skill asks for a small public evidence checklist, enough applicable support for the decision, and an early conclusion when further evidence is unavailable. An optional `effortAssessment` contains 1–5 `{criterion,neededEvidence}` entries (200/300 UTF-16 units), a nonblank explanation of at most 600 units, and a model-assessed reason: `sufficient-support`, `evidence-unavailable` or `selected-budget`. A checkpoint may instead say `in-progress`. Missing assessments stay unreported. This is a public summary, not private reasoning or an independent accuracy judgment.

## Enforced bounds

- Every eligible pre-tool invocation consumes an attempt, including invalid, denied and duplicate calls. N+1 stops the operation. Cancellation, deadline and later asynchronous approval checks retain their existing authority.
- Exact repeated requests are detected within this operation. Normalize object key order, trim the search query, and canonicalize a fetch URL without its fragment. Query case, internal whitespace, URL query strings, arrays and other arguments remain significant. This is not semantic duplicate detection. Argument normalization is bounded by depth, count and 8,192 text/serialized units; oversized or unsupported input is denied.
- Deny the first exact duplicate; its next repetition stops the operation. A failed tool stops the operation. Explorer does not retry inference, retry a failed source or raise the selected depth automatically.
- Successful tool results deliver at most 32,768 UTF-16 units per page, 8,192 per search and 262,144 across the operation. Preserve surrogate pairs and omit binary model payloads. Hook guidance identifies truncation and remaining time/attempts. Once the aggregate text allowance is spent, another tool attempt stops the operation; the model may still conclude from delivered evidence.
- Accepted search/fetch calls require distinct nonblank tracking IDs of at most 256 UTF-16 units. Consume a matching pending result only once; unmatched, wrong-tool and replayed callbacks deliver empty text and cannot consume effort or establish a read. Invalid result shapes stop the operation with an empty replacement. Older runtimes without tracking IDs fail before tool execution.
- The first successful delivered page prefix remains paired with its first requested-URL/time receipt for date-label validation. Search snippets, omitted text, blank/failed responses and unmatched fetch IDs cannot establish a page read. A read does not prove truth, relevance, publication date or redirect identity.

These are Explorer model-context bounds. They do not bound all host transport allocation, prevent native journaling before hooks, or establish a safe fetch transport. [#41](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/41) and [#42](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/42) remain separate blockers; no new tools or network permissions are introduced.

## Retaining a stopped pass

An owned research helper may emit one complete root `assistant.message` with exactly `{checkpointVersion:1,findings:{...}}`, usually alongside its next necessary tool request. Inspect at most four tagged messages and keep one latest valid checkpoint. Require a bounded, nonempty message ID; reject replay, ephemeral, subagent, split and delta messages. Never assemble fragments. The findings must satisfy the ordinary comparison or follow-up parser, output-size ceilings, actual source receipts, date observations and reviewed freshness checks. A comparison checkpoint cannot name a recommended winner. Malformed later checkpoints cannot replace a valid earlier one.

Only deadline, attempt-limit, repeated-request, result-text-limit or tool-failure termination can expose a checkpoint. User cancellation, unconfirmed cleanup/accounting, managed permission failure, changed journey, conflicting saved research or stale reviewed context cannot publish it. No checkpoint means **No validated partial findings were retained**; incomplete raw text is not a usable answer.

After confirmed shutdown, accounting and cleanup, the controller checks the current saved document and scenario again. It retains at most one attempt in memory for this canvas, separately from completed research. A successful request replaces saved research normally; a stopped request cannot overwrite it. Follow-up partials do not become completed conversation exchanges. The attempt reports observed tool attempts, denied duplicates, delivered text, truncations and elapsed execution before shutdown. Model-assessed explanations remain separate from these observed stop reasons. Token/credit receipts remain in the existing accounting system; the drawer does not estimate a total price.

## Drawer behavior

The Research drawer shows a concise attempt summary, an expandable model-assessed plan, and an optional **Partial findings · incomplete and not saved** disclosure. Options, limitations, claims and sources remain inspectable without applying an incomplete answer. Historical context changes mark the retained attempt historical; polling preserves the current editor, composer, focus and open disclosures.

A follow-up attempt displays its exact captured question and hypothetical status independently of the current composer draft. A completed result uses only its final optional assessment; a checkpoint's unfinished assessment cannot become the final stopping explanation.

**Review deeper research** opens the existing inline review at the next depth. At Deeper it reads **Review another pass**. It never starts a helper by itself. A follow-up retry keeps its captured question and hypothetical flag; current context must still be reviewed. The existing **Research** action starts the new request explicitly. A previous attempt may remain visible while that pass runs.

**Clear attempt details** removes only this transient attempt. Switching journeys or closing Explorer clears it; navigation to another node hides it. Reloading the page can reconnect while the canvas remains alive. Attempt details and partial text never enter the saved map, native snapshot, exports or later model prompts. They are not a persistent research cache. Copy anything needed before closing the canvas.

## Deterministic comparison for #108

On 2026-11-20, a local comparison loaded the unchanged v0.1.120 extension from commit `bd8a8b8034d7ca13580d8d69df922946753da8bb` and the v0.1.121 candidate into the same mock runtime. Both used Quick, the same fixed findings/tool sequences and a fixed clock. Each normal case had 1,000 ms scripted elapsed time; deadline cases had 60,001 ms. These values are fixture inputs, not measured latency. No provider or web request occurred.

| Fixed case | v0.1.120 | v0.1.121 |
| --- | --- | --- |
| Simple early conclusion | Complete result, 0 tools | Same complete result, 0 tools; observed completion report |
| Remaining evidence unavailable | Complete abstention, 0 tools | Same abstention, 0 tools; no invented winner |
| Three identical search attempts | 3 allowed synthetic tool calls | 1 allowed; 2 duplicates denied; stopped honestly |
| Failed fetch followed by retry | 2 allowed synthetic tool calls | 1 allowed; failed source stops the pass |
| Setup uses the whole allowance | 0 model sends, 0 tools | 0 model sends, 0 tools |
| Valid checkpoint then deadline | No retained findings | Separate validated partial, no recommended winner |
| Deadline without a checkpoint | No retained findings | Explicitly no retained partial |
| 9,500-unit search result | 9,500 units delivered | 8,192 units delivered; truncation recorded |

All cases except setup exhaustion used one scripted model send. The structural rubric checked complete versus incomplete status, abstention, missing checkpoint behavior and unsupported source-claim relations: neither version created an unsupported source claim in these fixed inputs, and the candidate never gave a partial a winner. This establishes bounded behavior and preserved useful structure, not factual accuracy or live research sufficiency. Stopping a failed lookup can leave fewer findings than a model would produce by continuing; the explicit reviewed pass is the recovery path. Token counts and provider charges were unavailable, not zero. The separate authorized [#110](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/110) live pilot remains at zero calls.

Ignored local evidence: `.iteration/issue-108/compare-effort.mjs`, `comparison-results.json`, RED/GREEN hook/controller/UI logs and `runtime.log`. Reusable behavioral tests live in `test/research-effort*.test.mjs`, `test/research-sdk.test.mjs` and `test/web.test.mjs`. The installed anonymous `e2e:research` fixture verifies a complete checkpoint and bounded search prefix through real SDK events/hooks; it does not exercise successful built-in fetch or prove visible native rendering. Brave layout fixtures use synthetic findings and no paid provider. The owner's native Copilot acceptance in #91 remains pending.
