# Scenario comparison implementation plan

> For agentic workers: use superpowers:executing-plans inline. The approved issue is the specification; do not add scenario preference or merging here.

**Goal:** Compare explicitly selected saved scenarios without changing either map or their private drafts.

**Spec:** [GitHub #71](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/71). Base c453a26; prerequisite #44 is published.

**Architecture:** A pure comparison module aligns unique recorded identity aliases and reports observed differences. A serialized controller coordinator captures both sources and revalidates their full fingerprints before paging or navigation. Personal and Project library rows launch a stacked, bounded dialog while keeping the existing editor mounted. Source navigation remains an explicit guarded journey operation.

**Constraints:** No semantic matching, model calls, winner, merge, schema change, hidden repository discovery, or comparison-time document/private metadata writes. Preserve exact selected answer and research text; render it as text. No browser/desktop automation or paid providers. Every release follows AGENTS.md.

## Tasks

- [x] Add RED/GREEN model tests and `scenario-compare.mjs`: original/alternative, nested forks without the original, independently generated similar wording, missing descendants, ambiguous origin claims, copy aliases, evidence/provenance/stale and answer-state differences. Use self, earliest origin, immediate source and explicit personal-copy aliases only. Ambiguous mappings stay unpaired. A missing row means observed absence, not proof of deletion. Guidance is current shared/different context, not a reconstructed historical base.
- [x] Add RED/GREEN coordinator and HTTP tests. Strict preview/page/source/discard inputs bind active identity and both saved digests; token expiry is 15 minutes. Revalidate selected project listing and current checkout through existing access rules. Page 25 row summaries and show one complete selected pair with a 1 MiB response cap. Sources changing, disappearing or switching invalidate later actions. Navigation uses existing draft-flushing and fresh-target checks; comparison itself stays read-only.
- [x] Add RED/GREEN HTTP/jsdom workflows and the stacked dialog. Explicitly name Left (current) and Right (selected library row), compute only after choice, preserve draft/caret on close, support pages and source navigation, and reject stale/resumed/detached callbacks. Display original evidence provenance and freshness limits separately from answer certainty and review flags. Test project and personal selection, malformed inputs, narrow-pane markup, cancellation and late responses.
- [x] Document behavior and compatibility limits, obtain one independent final review, synchronize 0.1.87 and release notes, run npm test/check/package and installed local e2e, then integrate/push main and verify. Record native layout/keyboard verification as pending owner checks.

## Review focus

- Imported duplicate identity claims must not silently pair different questions.
- A fork's deliberately omitted branches must not be labeled confirmed deletions.
- Comparison must not promote stale research or assumptions to decided facts.
- Source navigation after asynchronous reads must not reuse obsolete bindings or lose drafts.
- Maximum-size maps, exact long text, page resume and detached controls must stay bounded and recoverable.

Preflight ruling: the selected current map and explicit library target are the two chosen scenarios. No historical source lookup is required: portable lineage can be compared even when the original is unavailable. Recorded identity claims are not independently verified provenance. Personal-copy aliases use only the recorded source ID together with preserved root/date/node identity; ambiguous matches remain separate.

Verification: 913/913 full tests, syntax/release checks, packaging and installed SDK/runtime local fixture passed. Independent review found one duplicate DOM ID; the regression was reproduced and fixed. Full verification also exposed a Windows private-metadata rename sharing denial (three RED/GREEN regressions, 20 repeated UI passes) and two Git UI waits incorrectly using a DOM-only deadline. Metadata retries remain bounded and revision/byte guarded; those UI tests await the actual bounded HTTP response. Native narrow-pane/keyboard checks remain pending. Publication evidence is recorded on issue #71.
