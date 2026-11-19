# Research map relevance implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Keep implementation ownership local and use one independent final reviewer, with changed-scope review as required by the project workflow.

**Goal:** Research the current question using relevant whole saved decisions across the map, with inspectable selection, bounded inputs and accurate freshness.

**Architecture:** A pure relevance module ranks current saved records. Existing context assembly owns byte admission and immutable prepared inputs; existing review and controller boundaries retain explicit start and stale-result rejection. Follow-ups retain bounded contributor fingerprints. The review adds literal selection-policy and omission information without redesigning the drawer.

**Tech stack:** Existing Node ESM, HTTP, DOM/jsdom and installed Copilot SDK fixtures; no new dependency or provider.

**Spec:** [Issue 94](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/94), [context review contract](../../research-context-review.md), current AGENTS.md and development workflow.

## Global constraints

- Required target, guidance and pins remain complete; actual instructions plus prompt stay within 131,072 UTF-8 bytes. Optional records are omitted whole.
- No repository excerpts, private drafts, historical research/rationales, ambient instructions or new network permission. Assumptions and hypothetical context never become verified decisions.
- Preserve reviewed-token identity, explicit start, helper isolation, cancellation, saved destinations and unrelated-edit tolerance. Attached questions and briefs keep their separate selection behavior.
- No browser/desktop automation is authorized. Declare the visible review additions `ui=true`; record its required browser gate as pending if authorization is still absent. SDK fixtures use only the installed runtime, disposable home and local model.
- Each completed release needs synchronized metadata, independent review, required gates, package validation and verified origin/main publication. Do not claim an incomplete gate or issue passed.

## Review focus

Check non-English lexical matching limitations; the difference between new relevant candidates and new unrelated fallback answers; omission response size and literal rendering; historical follow-up contributor reasons after exclusions; and actual installed-runtime prompt content versus simulated fixture quality.

### Task 1: Integrate bounded selection and source freshness

- [ ] Reconcile the prepared scratch implementation against published v0.1.106. Copy only the changed files; preserve all concurrent main changes.
- [ ] Run the new behavioral cases against the unchanged runtime and observe failure, then integrate research-relevance.mjs, research-context.mjs and research-followup.mjs.
- [ ] Preserve explicit prerequisite/literal relevance ranking, uncertainty and complete records. During freshness checks retain prior sent fallback membership while recomputing stronger relevance; retain the full optional arrays for exact omission-metadata accounting.
- [ ] Run research relevance, review, concurrency, byte-budget and follow-up tests. Expected: passing with exact-boundary, excluded-record, stale-token and late-result cases.

### Task 2: Integrate inspectable review and installed-runtime evidence

- [ ] Add a failing DOM assertion for visible selection policy and review-only omission descriptors, then integrate the two review display additions. Preserve draft/caret/composition and keep excluded answers out of both model input and omission descriptors.
- [ ] Integrate the research runtime fixture using a real saved-map preparation and distant prerequisite; verify actual captured instructions/prompt with the installed disposable runtime.
- [ ] Document ranking, limits, uncertainty, omission samples and precise freshness behavior. Run focused DOM and runtime checks. Native usability remains unperformed.

### Task 3: Review, verify and publish or record the concrete blocker

- [ ] Prepare v0.1.107 or the next unused patch, release notes and a bounded independent review package. Record real approval after resolving findings.
- [ ] Run all authorized required checks and package validation. Invoke verify:iteration honestly; do not supply --allow-ui without explicit owner authorization. Record any pending UI gate and exact instruction in issue 94 instead of claiming readiness.
- [ ] If every required publication gate is satisfied, integrate and push main, verify exact remote commit and close issue 94 with evidence. Otherwise preserve the reviewable implementation and tests, comment the blocker and continue independently ready work without mixing candidates.

Interfaces: Task 1 supplies immutable prepared context, coverage and source fingerprints; Task 2 displays only review metadata and verifies actual helper input. Task 3 binds review/check evidence to that final candidate. No task may treat omitted records as previously transmitted evidence.
