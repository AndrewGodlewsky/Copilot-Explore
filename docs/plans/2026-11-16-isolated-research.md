# Isolated research implementation plan

> Use executing-plans for implementation and one independent final review. The owner approved the proposed architecture and requested implementation.

**Goal:** Run Explore options in a dedicated SDK researcher, with curated instructions, sourced comparisons, editable recommendation/detail application and undo. Keep question generation in the attached chat.

**Architecture:** Adapt Enhance Prompt's installed-runtime helper lifecycle and durable usage projection. Explorer supplies a bounded context snapshot and its own research skill. Only research web tools and a structured result tool are available. The controller owns cancellation and result correlation; the browser owns unsaved draft edits.

**Constraints:** Ship plain JavaScript, no SDK dependency/download, use the installed pair, validate same account and eligible Copilot model, isolate workspace/home and ambient instructions, retain usage before cleanup. Do not automate a browser, use paid inference for tests, or touch another user session. Publish v0.1.11 to main after checks. The user-authorized research route supersedes the old AGENTS.md attached-chat-only research rule.

## Tasks

1. Backend and schema
   - Add compatible optional proposed answers and named details to research records and Markdown export; old maps remain valid.
   - Add controller tests proving research never sends to attached chat, cancellation aborts owned work, late results cannot save, failures preserve answers, and question generation still queues.
   - Add isolated adapter with strict runtime/account/model/tool checks, bounded lifecycle, progress events, research instructions, structured result validation and source provenance from successful reads.
   - Adapt usage recorder and test filtered/deduplicated live and durable receipts, cancellation and failures. Use Explorer's own usage directory and identity.
2. UI and integration
   - Add Use recommendation, Use this option, selectable details, and Undo addition within the expanded node. Append to drafts, never auto-save or overwrite typing; guard stale undo and the length limit.
   - Show real research progress and cancel controls; failures remain in the node/map. Retain legacy research rendering.
   - Wire owned helpers into canvas lifecycle; remove research completion authority from the attached chat. Update skill and development instructions.
3. Verification and publication
   - Run isolated installed-runtime fixtures with local model/tool responses to verify actual outgoing context, skill injection, structured result, tool limits and lifecycle without paid calls.
   - Run npm test, check, e2e and package; review complete diff, fix important findings, synchronize versions/release notes/README, commit and push main, verify remote hash.

## Review focus

- New cancellation overlapping startup/cleanup must not launch late inference or delete live helper files.
- Missing search, mismatched identity/model and managed permission requirements must fail visibly without widening access or using the main chat as fallback.
- Model-produced citations must refer to successfully retrieved pages; unverified reasoning stays labeled.
- Background updates and applying/undoing findings must preserve typed and dictated drafts and keyboard focus.
- Accounting failures preserve recoverable receipts and never trigger additional model calls.

## Progress

Initial inspection: v0.1.10, clean tree. A disposable anonymous runtime probe exposes web_fetch; web_search availability is under investigation because it comes from the runtime's GitHub MCP integration. No paid inference or existing sessions used.

Implementation: backend routing/schema, helper lifecycle/account/model/tool validation, curated instructions, source eligibility, usage retention, draft application/undo and canvas wiring are implemented. 61 tests plus both installed-runtime fixtures passed before final edge-case additions. Documentation and synchronized v0.1.11 manifests are prepared; independent final review is underway.

Ruling: use strictly validated final JSON instead of a third result tool. This keeps the helper's executable tool set limited to search and fetch; malformed responses fail visibly instead of saving. Cost: malformed output requires a user retry.

Ruling: read the packaged research SKILL.md explicitly into the helper system prompt, rather than enabling skill discovery or an SDK custom-agent registry. This guarantees the curated instructions are present without ambient skills. Cost: changing the playbook requires a plugin update.

Final review: two important findings, both reproduced with failing tests and fixed. Managed human approval/sandbox bypass now ends research visibly even if the model later supplies valid reasoning JSON. Missing hook IDs now fail closed, preventing overlapping page reads from incorrectly verifying citations. No critical or minor findings remain.

Final verification limits: live account/search entitlement, source quality, visible rendering, real dictation and a real successful public web_fetch remain manual checks. The fixtures exercise actual installed SDK startup, search tools, prompts, cancellation and accounting using local servers, plus simulated fetch-hook outcomes. No paid inference or desktop automation was used.

Verification complete: all 65 tests passed, `npm run check`, `npm run e2e`, `npm run e2e:research`, `git diff --check` and `npm run package` passed. The release is v0.1.11. Both final-review findings passed targeted RED→GREEN regressions and the complete suite. Publication follows the standing main-branch workflow in AGENTS.md.
