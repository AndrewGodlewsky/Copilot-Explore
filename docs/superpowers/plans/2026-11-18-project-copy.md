# Reviewed project copy

Implement approved issue #57 with the executing-plans workflow.

1. Add behavioral tests for exact committed-content previews, optional node research, lineage, source/destination changes, identical retries, divergent collisions, failed writes, and clean-clone reopening.
2. Add a narrow publication service over the existing strict shared serializer and project storage. Capture source bytes and checkout authority. Ordinary copies use a deterministic identity; an explicitly requested additional copy gets a fresh identity retained throughout its preview/retries. Confirm under the personal document lock; never mutate the original.
3. Add a Personal-only review dialog with destination, research selection, exact JSON, confirmation, and a separate continue action. Keep draft flushing and journey-switch guards. No AI or Git writes.
4. Verify DOM/HTTP and installed local SDK behavior, obtain independent review, run required tests/check/package, bump the version, publish main, and record native visual checks as pending.

The optional lineage records only source journey ID and canonical committed-content digest. Private references, drafts, local history, sessions, receipts and selected project excerpts are not copied. Accepted artifacts retain their historical evidence even when node research is omitted; the preview must state that boundary. Older clients reject the new field rather than silently normalize shared content.

## Execution record

Implemented exact reviewed copying, optional node research, lineage, safe retries and separate continuation. Nine storage/controller cases and the DOM/HTTP workflow pass. Independent review found and verified a fix for cross-folder identity collisions; copies now have independent private namespaces and same-folder retries remain stable. The installed SDK fixture passes without model calls for this flow. Full-suite and publication evidence is recorded in #57; native visual/keyboard checks remain pending.
