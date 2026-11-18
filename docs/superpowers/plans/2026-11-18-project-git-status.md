# Local save and Git handoff status

Implement approved issue #59 using the executing-plans workflow.

1. Write failing behavior tests for selected-file untracked, ignored, staged, unstaged, committed, conflicted and missing states; unborn/detached/no-upstream/divergent branches; literal paths, worktrees, failures and source races.
2. Add a bounded read-only status service over fresh ProjectRepository authority. Use Git porcelain output scoped to the selected literal path; never use shell interpolation, network operations or Git mutations. Check physical checkout and source identity before/after. Unknown evidence stays unknown.
3. Add an explicit inline status disclosure with refresh. Separate private editor work, saved file and Git state; label branch counts as repository-level local tracking evidence with unknown remote freshness. Preserve connected editors, focus, selection and pending work. Discard late page/journey responses.
4. Verify DOM/HTTP behavior, obtain independent whole-change review, run tests/check/package and the installed local SDK fixture, synchronize the next patch release and publish main. Record actual evidence on #59 and leave native visual/keyboard checks pending.

Status is an observation at a displayed time, never a claim of synchronization. Local changes invalidate cached observations; remote freshness cannot be established without a user Git fetch. A clean selected file says nothing about other repository files.

## Execution record

Implemented bounded literal-path Git observations and an inline status disclosure that preserves connected drafts and pending questions. Review reproduced three gaps: an empty outer-repository status falsely labeled a nested file committed; Git could execute configured content filters; and a same-byte branch reload retained old cached status. Failing regressions now cover all three. Exact HEAD/index proof, filter refusal, disabled lazy fetching/submodule scanning, and reconciliation-transition invalidation address them. Independent final review found no remaining material issues. Actual release verification is recorded in #59; native visual/keyboard checks remain pending.

Ruling: return unknown for unsupported filters and hidden/nonregular index entries rather than run repository code or infer committed content. This limits status availability for those repositories but preserves a read-only local feature.
