# Reviewed implementation handoff

Choose **Implementation handoff**, select 1–100 saved questions or user directions, and choose a brief, specification, plan, prompt or task list. Selection starts unchecked. Tentative, conflicting and unanswered choices are valid inputs; only settled, non-review answers can support a statement labeled user decision. The helper must preserve conflicts as open questions. Model wording still requires human review.

**Preview exact handoff input** shows the actual instructions and prompt. Topic, objective, success criteria, mode and all user constraints are mandatory. No implicit root or ancestor records are included. Research evidence is unchecked by default: enabling it includes only selected nodes' recorded source metadata and structured claims with their existing source relationships, limitations, retrieval time and recorded-read/imported provenance. Legacy bibliographies retain unknown retrieval and no invented IDs. These are prior AI interpretations, not independently verified evidence or user decisions; consultation alone does not establish support. No new source reads occur.

Drafts, private visual references, unselected records, project excerpts/file references/snapshots, previous briefs/handoffs/checks, research summaries/recommendations/proposed answers and follow-up prose are excluded. Project context remains Challenge Review-only. User-authored saved text remains literal input; Explorer adds no absolute local file paths. Native SDK journals/logs may retain model inputs/results. The original strict privacy and transport guarantees in #41/#42 remain unresolved; this feature does not claim them.

The format changes the instructions and exported sections: specifications express selected requirements and suggested validation; plans and tasks use ordered proposed work; prompts address a future implementer. Missing ownership, estimates, prerequisites or acceptance criteria remain unknown. No execution, external task creation, chat switching/sending or model change occurs.

## Review and ownership

The exact preview has a purpose-bound, one-use token expiring after ten minutes. Changing selection requires another preview. Generation uses the installed owned tool-free helper, with account/model/workspace checks, zero initialized tools and retained **Explorer Implementation Handoff** usage receipts. It shares the existing brief proposal slot and owned-helper queue. Replacing or cancelling a request invalidates its output; another helper waits for actual release, and unconfirmed release remains blocked.

Saved selected records, guidance and opted-in evidence are checked at start, after the release queue, completion, polling and acceptance. Unselected records and untransmitted research fields do not invalidate the proposal. Changed sources require explicit refresh/review/regeneration. Preview expiry does not expire an already generated proposal. Hiding the dialog retains its proposal; journey changes and canvas close invalidate it. Panel reload requests cancellation best-effort and does not promise delivery.

Edit individual proposed statements and choose **Accept reviewed handoff**. Exact edits remain authoritative and marked as user edits; original source references are retained but their support is not automatically reverified. Acceptance uses the ordinary revision check, writer lock, atomic save and history. The separate `handoff` artifact replaces only the earlier accepted handoff. Full journey JSON preserves it; imports mark source-read metadata imported. Source deletion keeps historical references and marks freshness stale. Answer text and drafts remain untouched.

**Export accepted handoff** and **Copy accepted handoff** produce the same escaped Markdown, including freshness, edit labels, source appendix, exact captured global constraints and recorded research appendix. Copy requires browser clipboard support; export remains available. Full exploration exports retain journey data. Exporting an accepted stale artifact labels its stale state; it does not silently regenerate it.

## Bounds and schema

| Boundary | Limit |
| --- | --- |
| Explicit selected question/direction IDs | 1–100; unique IDs, at most 100 characters each |
| Actual instructions plus prompt | 128 KiB UTF-8; excess rejects, never silently drops selected records/evidence |
| Research per selected node | Existing 15 sources, 12 claims, 3 evidence relations per claim |
| Source / claim fields | Source title 300, URL 2,000; claim text, limitations and supporting paraphrase 1,000 UTF-16 units each |
| Proposal output | Strict JSON, 256 KiB UTF-8 |
| Sections | Exactly `goal`, `decisions`, `constraints`, `assumptions`, `unresolved`, `nextSteps`; up to 5 statements each |
| Statement | Unique ASCII ID up to 80; nonblank exact text up to 1,000 UTF-16 units; allowed certainty; up to 8 unique references |
| Saved handoff / complete journey | 512 KiB / existing 9 MiB; oversized acceptance leaves the last saved journey intact |

Node refs are `{kind:"node",id}`; guidance refs are `{kind:"guidance",field}`; recorded research refs are `{kind:"evidence",nodeId,sourceId}`. Every ref resolves against transmitted sources. Only known HTTP(S) source URLs become export links. Stored version 1 includes format and its fingerprint, accepted timestamp, validated sections/edit flags, source fingerprints and captured states, coverage, guidance, evidence inclusion and exact validated evidence projections. User intent, source state and recorded research provenance are distinct from truth or independently verified support.

Local model/HTTP/jsdom and installed anonymous loopback helper fixtures cover these contracts. Native narrow-pane layout, keyboard/clipboard behavior and live model usefulness require manual owner checks; no native UI automation was performed.
