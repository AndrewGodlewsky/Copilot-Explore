# Approved research policy reconciliation

> Execute inline with one independent final review and the repository iteration workflow. Existing publication authorization applies.

**Goal:** Complete [#88](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/88)'s decision record using the owner's settled choices, while preserving the distinction between policy, implementation and SDK capability.

**Scope:** Documentation and release metadata only. The original pinned investigation and six local preparation measurements remain dated evidence. No runtime, network, model or privacy behavior changes.

## Task 1: Reconcile the record

- Update `docs/research-architecture-decision.md`: approved existing-context-first help, separate **Research**, one approval per bounded question/scope/effort, new review for changed scope/disclosure/effort, and host permissions unchanged.
- Keep the three-policy comparison. Distinguish the selected target from currently shipped research, which still requires its verified search/fetch tools. An output fallback is not a no-retrieval mode.
- Keep #41/#42 as capability prerequisites, not unanswered owner preferences. Preserve private-context exclusions, source evidence limits and model-provider disclosure.
- Replace stale owner-decision wording in `docs/research-prior-art.md` and README. Link #110's consolidated authorization from the decision and evaluation documents: the bounded synthetic/fixed-source/no-web live pilot is approved but has not run. No quality or monetary claim follows.
- Update dependent-work sequencing and retain #91's pending native acceptance. Check local documentation targets and unchanged historical measurements; no external repository re-investigation or live calls.

## Task 2: Verify and publish

- Bump synchronized metadata to v0.1.111 with a documentation-only release note under 400 characters.
- Declare ui=false, host=false. Obtain an independent review of accuracy, approved-versus-shipped boundaries, historical evidence and release metadata.
- Record review; run `verify:iteration -- issue-88-policy`, package and compare shipped files, fetch/integrate/push main without force, and verify remote SHA.
- Update #88's acceptance/completion record and close it after publication. Keep #41/#42 and #91 open for their own requirements. Record usage as unavailable and the seven-day observation window as pending.
