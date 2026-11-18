# Reconcile external project changes

Implement approved issue #58 with the executing-plans workflow. Do not fetch, pull, merge or switch Git branches.

## Contract

- Capture the physical checkout plus Git branch/HEAD identity for project selections. A changed checkout, branch, file identity or content fingerprint invalidates the displayed base before edits and on explicit/periodic refresh. Matching revision integers do not establish freshness.
- Keep the displayed document and exact private drafts while surfacing missing, replaced, malformed or conflicted incoming files. Invalidate candidate questions and owned helper work, reject late callbacks, and never stop the attached user's chat turn.
- Provide a bounded explicit reconciliation preview, a reload choice, and preservation of the displayed committed base as a recoverable version. Reload reads incoming content without rewriting it; changes after preview reject acceptance.
- Preserve prior history by switching an atomic private history pointer to a fresh history namespace. Build the new history using the existing intent/reconcile protocol, retain the displayed base there, and leave every previous namespace intact. Draft/reference/usage namespaces remain stable. Read the current pointer for every operation; stale writers cannot retain a superseded history authority.
- Recover across interrupted pointer/history finalization. Aggregate validated recovery versions under bounded scanning; retention operates on the active history and protects prior namespaces.
- Keep explicit source/checkout identity checks across all helper and history acceptance paths. Future ADR generation must use the same freshness boundary.

## Steps

1. Write failing tests for same-revision external edits, atomic replacement, changed/deleted paths, Git branch switches (including unchanged bytes), conflicted/invalid files, rapid preview races, and isolated worktrees.
2. Add private history selection and non-destructive adoption to ProjectJourney; add a captured reconciliation service using fresh repository authority. Exercise crash/finalization recovery and preserved history/drafts.
3. Integrate freshness observation/invalidation in controller and HTTP, then add a review/reload interface that flushes drafts and retains original bases. Add DOM/HTTP checks without browser automation.
4. Add installed SDK fixture coverage, obtain independent final review, run the full suite/check/package/e2e, patch version and publish main. Record owner native checks as pending.

## Execution record

Implemented explicit external-change review/reload, exact private draft preservation, owned-work invalidation, private history selection and recovery. Review reproduced final-read identity races and bounded recovery omissions; failing regressions now cover same-byte replacement, recent preservation after reopen and damaged older namespaces. All review findings are addressed. Full-suite and publication evidence is recorded in #58. The installed SDK fixture uses only disposable local fixtures; native visual/keyboard checks remain pending.
