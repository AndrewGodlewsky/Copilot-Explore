# Project context freshness and refresh (#117)

Implement against v0.1.129. The approved isolated, tool-free project helper and explicit scope/read/brief/request approvals stay in place.

1. Reuse canonical read-only Git checkout resolution for ProjectMode, with bounded cancellation and no project code, optional locks or network retrieval. Keep physical working-root identity separate from branch/HEAD identity. Check checkout identity around reviewed scope, source reads and helper freshness boundaries; do not scan unrelated files.
2. Revoke stale authority and retain honest stale/unavailable states. Distinguish editing the scope from turning context off. Both invalidate relevant tokens/results; editing can retain a bounded comparison for the same physical project, while explicit off clears file-derived comparison. Already sent model inputs cannot be retracted.
3. Show precise scope metadata differences before enabling a replacement scope and previous/current claim differences before approving a replacement brief. Do not pretend regenerated claim IDs or file metadata establish semantic/content identity. Preserve saved corrections as user assertions and unsaved answer/editor drafts. Clear private comparisons on off/discard, project/client/journey replacement and close.
4. Cover unchanged and changed file/root/checkout cases, unavailable Git, asynchronous races, disable, retention and private/shared boundaries. Exercise existing narrow/short and keyboard flows with authorized Brave fixtures.
5. Synchronize release metadata and notes, obtain one independent review, run the frozen full verification gate and package validation, publish to main without force, verify the remote SHA and update the issue. Record native/live checks and seven-day observation as pending where unperformed.

Detailed implementation/test evidence stays in `.iteration/issue-117/`. This work introduces no continuous watcher, automatic resubmission, file persistence or broader retrieval permission.
