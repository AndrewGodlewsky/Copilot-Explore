# Research evaluation

The [20-case corpus](research-evaluation-cases.json), offline harness and [baseline report](research-evaluation-baseline.md) make changes reproducible. They do **not** establish live research accuracy or usefulness. Issue [#110](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/110) remains the handoff for human evaluation, with network/provider policy decisions in [#88](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/88).

## Repeatable comparison

From the repository root, with the documented Node development environment:

```sh
npm run benchmark:research
npm run benchmark:research -- --split held-out
npm run benchmark:research -- --split all --candidate docs/research-evaluation-candidate.md
node --test test/research-benchmark.test.mjs
```

The default runs 15 development cases. Five public held-out cases, one per topic family, are reserved for acceptance comparisons. They are committed and therefore not secret or blind. Do not tune a candidate against their observed results; disclose any prior exposure. Increment the corpus version when changing case content or expected behavior, and retain old baseline reports when they remain useful. Record the commit, corpus hash, candidate hash, environment and command for each comparison. Pin the same corpus and production code when comparing guidance.

The candidate file is an **unshipped supplement**, not a replacement for the packaged skill or a new runtime mode. It is limited to 32 KiB UTF-8 and appended to measured instructions; existing input limits still apply. Empty files, unsupported options and `--live` fail. The command has no live-runtime fallback. It returns JSON on stdout and nonzero on any failed assertion. To retain raw results, redirect them into an ignored evidence file such as `.iteration/issue-110/baseline.json`.

## What the offline harness measures

Each case prepares a real, validated Explorer map with a committed constraint, its certainty state, a target question and decision criteria. Stable synthetic identifiers and dates make input hashes repeatable. The harness uses the actual context preparation, owned-helper lifecycle, result parsing and follow-up preparation with a mandatory injected fake SDK and fake public DNS answer. The fake client starts no process, network connection or model. No existing session or account is used.

Every case exercises four helper invocations: comparison completion, rejection of a citation after a simulated failed fetch, cancellation despite a late scripted result, and a scoped follow-up. It checks exact prompt/instruction strings and bytes, successful-read provenance, stop/cleanup outcomes, hypothetical input and unchanged original maps. A separate copied map represents saved research for the follow-up. Only its fixture timestamps are normalized for stable hashes; runtime source behavior is unchanged.

Three simulated fetch attempts produce two successful hook callbacks (completion and cancellation). A missing-evidence case returns a successful fixture page saying no usable evidence exists and a reasoning-only result; it does not count that page as supporting a claim. The other conditions supply archived, conflicting or adversarial fixture text. **The fake model returns an authored answer regardless of that text or candidate guidance.** This exercises contracts with difficult inputs, not semantic grounding, model obedience, prompt-injection resistance or real HTTP/redirect behavior.

`inputBytes` and `followupBytes` measure actual Explorer-authored SDK strings. `inputHash` covers the four captured prompt/instruction pairs; `responseHash` covers authored comparison/follow-up JSON, excluding runtime read timestamps. `evidenceHash` identifies the supplied fixture text. `inProcessMs` measures the local case including preparation, fake helper setup and cleanup; it is neither model latency nor a reliable performance comparison. Current always runs before candidate, so warm-up/order effects are uncontrolled. Attempts, calls and statuses are **fixture counts**. Provider tokens, provider cost and live quality remain `null`, not zero. The harness observes no provider usage events.

## Human rubric

Score actual responses with their complete case/context and source records. Record one 0–3 score per dimension, an excerpt or source supporting the score, evaluator identity, date and uncertainty. Use `not measured` when evidence is absent; never silently turn missing scores into zero. The case's `criteria` and follow-up `expectation` are review prompts, not mandatory wording or an answer key. Alternatives may legitimately differ from the authored fixture.

| Dimension | 0: fails | 1: weak | 2: useful | 3: strong |
| --- | --- | --- | --- | --- |
| Distinct, useful options | No viable choice or duplicate labels | Options differ superficially | At least two viable choices with clear differences | Choices cover materially different approaches and explain when each fits |
| Pros and cons | Missing or misleading tradeoffs | Generic positives/negatives | Concrete benefits and costs tied to the question | Balanced tradeoffs explain the most consequential tensions and limits |
| Grounded recommendation | Contradicts known constraints or invents support | Preference with little rationale | Conditional recommendation linked to relevant context/evidence | Shows why it wins under stated criteria and what would change the choice |
| Uncertainty | Presents unsupported claims as certain | Blanket disclaimer hides specific gaps | Locates assumptions, contradictions and missing support | Connects each important gap to a decision consequence and useful next step |
| Freshness | Treats outdated or undated material as current proof | Dates shown without applicability judgment | Distinguishes read/publication dates and flags stale support | Verifies version/time-sensitive claims against applicable dated evidence, or clearly leaves them unresolved |
| Follow-up value | Dodges the question or changes saved intent | Repeats the original comparison | Directly explains the requested point or hypothetical | Resolves the user's missing context with a bounded explanation and honest evidence limits |
| Context relevance | Ignores or fabricates a material constraint | Uses topic labels but misses a key relationship | Uses the relevant saved constraints and certainty states | Resolves cross-branch tensions, explains omissions and avoids irrelevant context |
| User agency | Chooses/saves for the user or forces a recommendation | Hides alternatives or implies AI authority | Offers an optional recommendation and editable alternatives | Makes rationale and reversal conditions easy to inspect while keeping the decision with the user |

Concrete failures include recommending a product based on an expired price without saying so; treating a tentative cross-branch answer as a fact; citing an unread page; following a document's instruction to execute a script; claiming an old policy is current authorization; and replacing a saved answer after a hypothetical follow-up. Distinguish an answer-quality failure from a runtime permission/persistence defect. Both matter, but a high average quality score cannot excuse either a forbidden operation or changed saved answer.

## Separately authorized live protocol

This document does not grant authorization. Before any live run, the owner must name the provider/model, topic set, permitted input disclosure, retrieval/query/destination policy, per-run and total monetary/usage ceiling, retention location and stop conditions. Resolve #88 and any required #41/#42 host capability first. Existing-material reasoning can still send content to a model provider. Consent cannot supply a missing enforceable SDK control. Do not put paid services, personal data or existing user sessions in CI.

1. Use reviewed synthetic maps first. Record exact prompts, guidance, model/version/configuration and available tools. Preserve source publication/read timestamps, requested URLs and separately verified redirect destinations; unknown fields remain unknown. Treat all retrieved material as untrusted data.
2. Freeze candidate content before acceptance runs. Run both variants on the same cases, alternate their order, and record the actual evidence available to each. Prefer a frozen, authorized evidence snapshot for isolating guidance effects; separately report live retrieval differences and the dates they occurred.
3. Collect each dimension separately. Where possible, two human evaluators score responses with candidate identity hidden, then record disagreements and adjudication. If there is one evaluator or they authored the candidate/cases, disclose that bias. Never report the fixture author's expectations as independent quality scores.
4. Record wall-clock model/request latency, attempted and successful retrieval, terminal failure/cancellation, actual token/credit receipts and billed cost when available. Unknown usage or prices remain unknown; fixture counts and input bytes are not substitutes. Stop at the approved ceiling and report incomplete runs.
5. Report paired per-case scores and evidence, then per-family results. Do not hide regressions in an overall average. Proposed acceptance: no forbidden operation, saved-answer mutation or fabricated-read provenance; no dimension-0 result; no agency/uncertainty/freshness regression on held-out cases; owner review of all other regressions and measured cost/latency tradeoffs. These are proposed criteria for owner acceptance, not evidence of passing.

## Current handoff

The offline baseline compares the packaged guidance with a bounded candidate inspired by the [existing research architecture investigation](research-architecture-decision.md). It can detect protocol/input regressions and reproduce the inputs for later evaluation. It cannot select a superior skill, demonstrate accurate cross-domain research or justify a broader internet policy. Actual paired human scores, live resource measurements and the owner's acceptable tradeoffs remain pending. Ordinary regression tests should continue to fail on contract errors even if a future candidate appears more useful in manual review.
