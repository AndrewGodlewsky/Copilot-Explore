# Issue #44: separate alternative scenario

Spec: GitHub issue #44 (November 18 approved replacement scope). Base: a51e798.

Use the existing isolated worktree and inline execution. No browser automation or live providers. Publish one patch after behavioral tests, the full suite, check, package, installed runtime fixture and one independent review.

## Decisions

- Save a fork in the personal library first, even from a project journey. Explicitly open it afterward; existing project-copy workflow can share it. No implicit session switch or generation.
- Copy only the root-to-question path, guidance and internal dependencies. Omit other nodes, research, accepted artifacts, reminders, generation metadata and private state. Retain review flags, with historical details available in the source. Mark copied answers affected by omitted premises or the alternative for review.
- Persist bounded versioned lineage with immediate source identity/fingerprint and stable earliest origin mappings. Historical mappings can outlive deleted nodes; they are lineage claims, not proof of current source content. Native JSON and shared format preserve them; Markdown shows them.
- Derive the destination ID from the saved source and exact alternative. Retries reuse an identical destination; an evolved destination is never overwritten. Preview tokens expire and bind source content, selection and pending work. Save under the source lock and recheck immediately before destination write.

## Steps and expected evidence

1. RED/GREEN pure model tests: fresh IDs, exact ancestor copy, outside dependencies, nested origins, strict validation, 5,000-node bound and shared/native portability. Expected: source unchanged and deterministic fork intent.
2. RED/GREEN controller tests: preview/cancel, stale source, pending work, failed save/retry, duplicate prevention, explicit reopening and private draft isolation. Expected: no source writes or helper dispatch.
3. RED/GREEN jsdom tests: accessible review modal, exact alternative and copied context, cancellation retains editor, explicit save/open and draft flush failures. Expected: no implicit source answer save.
4. Document compatibility and manual checks, synchronize patch metadata and release note, run required validation and review, publish main and close issue with evidence.

## Review focus

Look for source/destination write races, retry duplication, false lineage after import/copy/deletion, accidental private-state copying, and modal/editor races. Check maximum-depth and cross-branch cases. SDK helpers must remain isolated and ordinary generation explicit.
