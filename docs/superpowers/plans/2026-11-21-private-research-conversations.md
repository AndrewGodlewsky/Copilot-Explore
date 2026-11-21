# Private research conversations (#100)

Issue: https://github.com/AndrewGodlewsky/Copilot-Explore/issues/100

Keep each question's research discussion and composer available after navigation and restart. Store them privately, outside shared journeys. A research replacement or changed source context must never make old conversation look current. No model request, review approval, reusable-response authority or hypothetical consent is restored automatically.

The owner approved the existing bottom-drawer layout and local Brave checks. Retain those interactions, including explicit source mode, inline exact-context review and Answer draft. This is the final requested issue after #104 and #91; stop after publication.

## Constraints

- Use existing private-directory identity checks, strict JSON parsing, writer locks and atomic replacement. Unsafe or unknown files are preserved and block writes. Direct-file previews without a trusted private directory use memory only and say so.
- Bind private records to the trusted journey/checkout identity, question and SHA-256 research revision. Copies and unrelated imports must not inherit another journey's conversation. Reads do not create files.
- Retain at most 128 conversations / 8 MiB per private store and 20 whole exchanges / 256 KiB per displayed history. Do not silently evict conversations or drafts at capacity. Explicit deletion releases space; within a history, drop oldest whole exchanges and report the count.
- Use separate draft/history revisions, an entry incarnation and a monotonic store revision. Typing cannot invalidate a reviewed history; clear/delete/history replacement must. A stale writer cannot restore a deleted entry.
- Prepare each prompt from at most four complete exchanges / 64 KiB, counting omitted retained turns separately from older dropped turns. Exact review remains authoritative. Omitted evidence cannot resolve a source reference.
- Persist only validated completed discussion, bounded dependency fingerprints, a stable scenario-policy fingerprint and composer fields. Exclude helper/session/account/model captures, tokens, approvals, runtime reuse receipts, scenario consent and raw project captures.

## Implementation sequence

1. Add the private store and validators in `research-conversations.mjs`. Exercise independent fields, restart/namespace isolation, atomic failure, deletion races, malformed/unknown files, links/root replacement, capacity and display retention. Prepared fixtures live in the prior iteration's ignored evidence until moved into `test/`.
2. Enforce prompt limits inside `prepareFollowup`, independently of retained display history. First reproduce the current 20-turn inclusion; then test exact included/omitted counts and rejection of sources from excluded exchanges.
3. Add a small conversation workspace coordinator for trusted store bindings, historical views, review guards and unsaved replies. Hydrate only before an explicit follow-up review; compare authoritative history at dispatch and result commit. Ordinary reads/navigation must not replace an in-flight singleton or grant authority. A failed history save retains the prior file and exposes the validated new reply with explicit save-again/discard controls.
4. Add a bounded private HTTP endpoint and browser client. Recover per-question/revision drafts; serialize autosaves; retain newer typing/caret through late reads and writes; surface conflicts with explicit local/saved choices. Invalidate pending callbacks on deletion. Flush on navigation and page lifecycle without starting model work.
5. Connect the existing drawer with draft status, historical archive selection, fresh/clear/delete controls and retention/privacy copy. Preserve current source controls and Answer draft. Add a protected metadata-only storage inventory category; exports, shared files, native context and diagnostics omit private conversation content.
6. Run focused controller/client/DOM/privacy tests and approved Brave checks. Update docs and synchronized v0.1.134 metadata/release notes. Obtain one independent final review, resolve findings, run the frozen full iteration gate and installed local runtime fixtures where required. Package and compare shipped bytes; safely push main, verify remote SHA, record checks/limits and close #100. Stop.

## Acceptance evidence

- Two questions and multiple research revisions recover independent histories/drafts after restart without additional model calls.
- Changed context is historical until explicitly cleared; older research stays separately inspectable. No archive is silently included in a current prompt.
- Concurrent draft/history saves, clear/delete during held results, failed atomic writes and stale client callbacks preserve data and reject obsolete work.
- Display retention and prompt limits are tested separately, including Unicode and byte bounds.
- Private content canaries are absent from native/shared/export/diagnostic outputs; restored records contain no operation authority.
- Keyboard/focus, narrow/short geometry, source selection and one-click Answer draft remain usable in synthetic Brave fixtures. Native/live quality checks are reported separately, never inferred from fixtures.

Use `.iteration/issue-100/` for the brief, detailed progress, tests, reviewer report and publication evidence. The development workflow's fresh receipt and AGENTS.md release requirements remain mandatory; measured token usage is reported unavailable when no trusted counters exist.


## Location and attachment binding (independently reviewed)

Apply next-100-location-review.md. Derive the opaque conversationScope from the trusted private namespace: project key + normalized relative location + stable document id/rootId/createdAt; personal key + document identity; direct instance/file + identity. Exclude revisions, timestamps and inode identity. Require scope before all private endpoint operations and before follow-up review order/clear mutation, including cancellation. Carry the captured binding through hydration, queued dispatch, result persistence, reuse and retry. Only UI responses carry the opaque scope; native/model/shared/export outputs omit it. Browser callbacks also need attachment/read generations so an A -> B -> A return cannot accept an old response. An unsaved reply retains its original scope and reveals its text only there. Moved files start a separate namespace; old metadata remains explicitly cleanupable without transcript reads. Exact same-location clones preserving all stable identity are intentionally indistinguishable.

Regression coverage: raw same-ID copies at different paths; stale private requests and prepare/cancel requests delivered after switching; held reads/save acknowledgements across A -> B -> A; unsaved reply isolation; move/metadata cleanup; same-path replacement with different createdAt; ordinary saves preserve identity; privacy canaries stay out of exports and native context.
