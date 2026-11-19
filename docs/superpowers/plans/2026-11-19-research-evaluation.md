# Research evaluation implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Keep one implementation owner and independent final review; use changed-scope review as required by the project workflow.

**Goal:** Make research changes comparable with 20 diverse, versioned cases, explicit human rubrics and a repeatable offline behavioral baseline.

**Architecture:** A data-only corpus defines saved-map constraints, alternatives, evidence conditions and follow-up expectations. A development CLI prepares actual research inputs and replays scripted model/retrieval fixtures through the existing owned helper using an injected fake SDK. Optional candidate guidance changes measured instructions only; the same scripted responses never establish candidate quality. Documentation defines human scoring and the separately authorized live protocol.

**Tech stack:** Existing Node ESM, node:test and Explorer context/helper modules. No production runtime, SDK wiring, provider, network, package dependency or UI change.

**Spec:** [Issue 110](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/110), [architecture investigation](../../research-architecture-decision.md), current AGENTS.md/development workflow.

## Global constraints

- Keep #94's unpublished candidate out of this branch; baseline is main v0.1.106/5aab46f.
- At least 20 cases span software, product comparisons, project/process decisions, concepts and unfamiliar domains; cover stale, conflicting, missing and adversarial evidence.
- No real network, provider, installed user session or browser is opened by the benchmark. Unknown token/cost/live-quality measures are null, not invented zeroes or scores.
- Corpus and scripted outputs are synthetic examples, not current product facts or recommendations. Human quality scores require separate evidence and author attribution.
- Five public held-out cases are excluded from default development runs; disclose that this is not a secret or blind evaluation.
- Preserve exact input limits, uncertain states, source validation, cancellation and owned-helper cleanup; never promote fixture read callbacks into claims about real transport.

## Review focus

Inspect accidental live-runtime fallback; synthetic metrics confused with observed provider usage; swallowed fixture failures; candidate comparison fairness; and whether held-out/difficult cases are actually exercised and reproducible rather than merely counted.

### Task 1: Corpus and offline comparison harness

- [ ] Write the versioned 20-case corpus and a minimal harness interface; add behavioral tests that fail for missing replay/validation/metrics behavior.
- [ ] Implement actual context preparation plus an injected SDK fixture for complete, unread-citation rejection and cancellation outcomes. Track exact strings, helper/tool attempts, cleanup status, input bytes and local elapsed time.
- [ ] Support current guidance versus an explicitly selected bounded candidate file on the same corpus/split. CLI has no live/network option and rejects unsupported arguments.
- [ ] Run focused tests covering every case, whole inputs, source-read evidence, negative cases, cancellation, no saved-answer mutation and unavailable provider metrics. Expected: passing.

### Task 2: Rubric, baseline and repeatable handoff

- [ ] Document 0–3 scoring anchors, failure examples, follow-up/context/agency checks, regressions, evaluator bias and future live-evaluation authorization requirements.
- [ ] Add a clearly unshipped candidate-guidance example based on the #88 proposal; run both candidates across all cases and retain an honest baseline report.
- [ ] Link the corpus/command/report in README and prepare the next unused patch metadata and release note. Distinguish delivered fixture work from pending owner policy/live quality comparison.

### Task 3: Review and publish

- [ ] Obtain independent approval of the final tooling/docs candidate; address findings with meaningful regression evidence.
- [ ] Run fresh verify:iteration with ui=false/host=false, package validation and whitespace checks. Existing runtime source is unchanged; no installed runtime fixture or browser automation is claimed.
- [ ] Safely integrate and push main, verify the remote commit, post evidence and remaining owner-dependent acceptance in #110. Leave the issue open if live/human comparison required by its intent remains unavailable.

Interfaces: Task 1 emits case/version/hash-labelled conformance and resource records. Task 2 interprets only measured fields and must leave live-quality fields null. Task 3 binds review and release evidence to the final corpus, harness and documentation.
