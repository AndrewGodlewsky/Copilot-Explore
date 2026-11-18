# Issue #67: impact-aware next questions

Extend NextQuestion using DecisionImpact's bounded band cache; materialize full counts only for the selected recommendation. Rank high/medium/low, then assumptions needing review, other review, constraint matches, goal matches, historical importance and stable ID. Deferred questions remain excluded even with review flags. Decided/not-relevant questions reopen eligibility only when review is needed. Other unresolved states remain eligible.

Medium/high impact or a review flag is sufficient evidence without guidance matches. Low-impact ordinary maps retain the objective and literal-match fallback. Show actual downstream total, explicit-dependency/tree counts, unanswered and review counts. Clearly distinguish computed impact from historical AI importance. Do not read drafts/research/project context, call models, mutate saved maps or automatically navigate from a suggestion.

Dismissal binds own saved source, review causes and current impact band; unrelated edits and same-band changes do not reset it. Rebuild derived index on relevant saved-content changes, including same-revision replacements, without retaining stale answer objects. Existing UI follows saved snapshots and navigation preserves drafts.

Prove ranking/eligibility/fallback/dismissal with failing then passing tests, extend HTTP/jsdom next-question coverage, and measure cold selection using existing 4,950-node/10,000-link fixtures. Run full test/check/package and impact benchmark; independent final review; patch version, release note and verified push to main. No SDK changes or native UI automation planned; owner visual/keyboard checks remain pending.
