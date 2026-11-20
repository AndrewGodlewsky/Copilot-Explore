# Reviewed project brief implementation plan (#113)

> Use superpowers:executing-plans. The owner authorized sequential implementation, independent review and publication. One implementation owner; one reviewer.

**Goal:** Turn explicitly captured project files into a bounded, correctable brief, with a separate reviewed model request and explicit brief approval.

**Architecture:** A project-brief contract/helper module owns structured inputs/output and edits. A transient workspace coordinates purpose/client/journey/revision/token state against ProjectMode's captured file identity. Controller serializes owned tool-free work through the existing queue and release checks; canvas creates the helper from the installed SDK. Browser controls extend the current project-context dialog. No map schema or export changes.

**Base:** v0.1.125 / e11617f. **Candidate:** v0.1.126. **Spec:** #113; #54 closed shared/private defaults; owner-approved separate tool-free route. #114 will add actual question generation. #41/#42 and native #91 acceptance remain separate unresolved requirements.

## Contracts and boundaries

- Five brief sections: purpose, architecture, stack, conventions, constraints. At most five model claims per section, each bounded text and strict source references. Distinguish file-backed claims, inference and unknown; only user edits/additions create user assertions. File-backed claims require references to transmitted captured source IDs and literal supporting quotes present in those excerpts. Quote validation does not establish semantic truth; expose interpretation for user review.
- Exact-input preview includes fixed instructions, bounded captured excerpts and retained user corrections. Actual instruction/prompt bytes stay within the existing 128KiB ceiling; invalid/oversized inputs reject rather than silently dropping context. Scope/read approval alone permits no model request.
- One-use ten-minute start token binds capture identity, correction revision, purpose, client and journey. Check current file metadata/policy for review/status, complete fingerprints before queued dispatch and after results. Verification must never replace captured bytes implicitly. Cancellation stops only the owned helper; late results cannot replace a newer draft.
- Brief edit/removal/addition and approval are explicit revision-bound operations. Editing an approved brief first revokes approval; do not restore authority after lost revocation. Corrections become labeled user assertions, without claiming repository-backed certainty. New generation preserves current user assertions within the same canonical project/journey; model output cannot overwrite them. Turning context off clears model authority/raw captures while local user correction drafts can remain recoverable until discard, changed project/journey/client or canvas close.
- Transient state only. No saved map/history/native callback/export/diagnostic fields. No web, ambient instructions, tools, new providers or repository mutation. Existing selected-chat model/account checks, zero-tool validation, usage receipts, stop confirmation and recovery remain mandatory.

## Task 1: Brief contract and helper

Files: new project-brief.mjs and focused tests; owned-helper.mjs and research-usage.mjs operation/label registration only.

- Write failing fixtures for mixed claim kinds, strict bounds, fabricated references/quotes, Unicode, prompt injection as data, edits/removals/additions and correction preservation.
- Implement exact bounded preparation, strict parsing with authoritative source metadata, user-edit revision semantics and no raw-excerpt retention in the resulting brief.
- Add the dedicated project-brief helper using createOwnedHelper and toolFreeConfig. Verify no tools, selected model/account checks, usage and cancellation with existing fake SDK fixtures.

## Task 2: Transient reviewed workflow

Files: new project-brief-workspace.mjs; narrow ProjectMode capture/freshness interface; controller.mjs, canvas.mjs and server.mjs; lifecycle/HTTP tests.

- Add capture identity/freshness checks without stealing ProjectMode's active read cancellation handle. Preserve #112's concurrent-status regression.
- Implement strict status/prepare/start/cancel/edit/revoke/approve/discard actions with request identity and one-use token checks. Async helper work must recheck capture/revision around queueing, dispatch and completion, and retain user assertions on explicit same-project refresh.
- Serialize via controller's existing tool-free queue and failed-release protection. Clear/revoke on lifecycle changes and scope invalidation. Never expose raw context through ordinary snapshots/native callbacks/exports.
- Test stale roots/files/policy, scope changes, cancelled queued/running work, changed corrections during generation, replay/lost replies, purpose/client mismatches and unchanged ordinary questions.

## Task 3: Review and correction UI

Files: existing scope dialog, dedicated brief client if it keeps scope controls small, style.css, app.mjs authoritative polling/lifecycle, DOM and Brave fixtures.

- From a captured scope, Review brief request shows summary plus expandable exact inputs, then explicit Generate brief. Status/polling starts no inference. Show selected-chat routing and existing native-log limits.
- Render five sections with claim labels, sources/hashes/quotes expandable, editable text and removal/addition. Approval remains explicit; approved content is read-only until a confirmed edit/revoke action. Retain unsaved form text across harmless polling, errors and focus changes.
- Preserve answer draft/editor and ordinary questions. Use existing app lifecycle/poll loop, no competing page listeners or standalone background timer. Check narrow/short scrolling, keyboard, visible focus, literal content and late replies in authorized Brave.

## Task 4: Verify and publish

- Update project-context/integration docs, synchronize126 and release notes. Independent review after final candidate; fix findings with regression tests.
- Run frozen test/check/installed-runtime/Brave gates and relevant research helper fixture, verify complete package byte-for-byte, fetch/commit/integrate/non-force push main and verify remote SHA.
- Update issue DoD/completion, record actual checks and pending native/live usefulness limitations, unavailable measured usage and seven-day observation. Continue #114.
