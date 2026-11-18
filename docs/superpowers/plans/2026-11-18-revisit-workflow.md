# Issue #70: one revisit workflow

Spec: GitHub #70; prerequisites #66, #44, #68 and #69 are published. Base: 0d270aa. Implement inline in the existing isolated worktree. No SDK, storage schema or new mutation command is needed.

Add Revisit this answer to ordinary-question tools and command navigation. The chooser lives in the bottom drawer, leaving the current editor mounted. Its retain, fork and restart choices call the existing save/fork handlers. Keep existing direct actions available. Show the current journey identity, structural consequence counts and the differences between preserving descendants, saving an alternative, and checkpointed removal. Actual saves continue through the existing full-source consequence proofs; fork uses its existing source-bound preview.

Preserve the editor, selected state, text and caret through changing choices, cancellation, errors and stale sources. Capture a read-only source snapshot when the chooser opens; a changed source requires explicit Refresh choices. Pending/staged work blocks routing with reasons. The personal-library requirement disables fork with an explanation. History-capacity and read-only-save failures surface existing recoverable errors. Name the selected journey in the existing consequence confirmation too.

RED/GREEN workflow tests cover command navigation/Escape, all three routes, exact drafts and source identity, pending/unavailable/stale choices, checkpoint capacity and failed saves. Use real controller/HTTP behavior with jsdom; no browser automation. Run the full suite, check, package and installed local fixture, one independent final review, then release 0.1.86 to main and record validation plus pending native checks on #70.

Review focus: no mutation handler duplication; stale or detached controls cannot route to another node; drawer Escape must not consume child-dialog confirmation; failures must preserve draft and allow retry; impact overview must stay bounded and distinguish predicted review from actual deletion.
