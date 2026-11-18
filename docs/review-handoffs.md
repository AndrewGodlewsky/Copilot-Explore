# Branch review handoffs

Open **Tools → Review handoffs**, or a node's **More options → Answer details → Review handoffs for this branch**. Choose the selected branch or whole journey, enter a short note and optionally name the requested recipient. Explicitly select up to 24 saved questions to investigate; the searchable picker shows 20 questions per page and keeps selections across pages. Selecting a question does not change its answer or state.

Handoffs are shared through the Project journey file. Commit and push the file, then have another contributor pull and open it. Explorer does not perform these Git operations, notify anyone, create a GitHub assignment, look up accounts or schedule work. A personal copy can inspect carried handoffs and explicitly copy a selected record, but changing responsibility requires a current shared Project journey.

## Requested, taken and complete

The requested recipient is an unverified public label, not an account or proof of acceptance. Blank means unassigned. A label can name someone who has never opened Explorer; there is no matching directory or missing-account lookup. **Take responsibility** explicitly records the current [contributor name](contributors.md), or an anonymous contributor when no name is selected. Names and UUIDs do not authenticate identity or grant permissions.

**Complete handoff** records that a person considers this investigation complete. It never answers a question, changes uncertainty, clears review flags, resolves comments, approves an ADR or changes reminders. Completion is allowed for requested or taken work. **Reassign responsibility** records a new requested label or unassigned state and can reopen completed work; take again only after reassignment. Each action can add a note. The original request and every prior transition remain visible. There is no transition edit/delete UI or additional activity feed.

Notes preserve exact text and render literally, without HTML, Markdown execution or automatic links. Events use the selected contributor snapshot and local timestamp. Sequence order records explicit actions; timestamps are not used to decide the winner of concurrent edits. Corrupt private identity settings block new shared actions rather than inventing an actor.

## What source freshness means

The original request captures a source label and fingerprint. For a branch, coverage includes its tree descendants plus ancestors and recursive prerequisites of that context. A journey covers all its nodes. The fingerprint compares journey identity, topic/objective/success criteria, mode/pinned constraints, saved question/category/answer/state, structural relationships, review flags/causes and dependency explanations. Adding or removing a descendant or changing a captured prerequisite makes the source changed. A missing branch root leaves an accessible orphan handoff.

Research, comments, handoff metadata, contributor attribution, reminders, artifacts, revision/timestamps and private drafts are excluded. A matching fingerprint is a comparison of this saved decision context, not proof that evidence is fresh or every fact is correct. Handoff actions do not invalidate their own capture. Changes elsewhere in an unrelated branch do not invalidate a branch request unless that context is a prerequisite or shared guidance.

Reassigning, taking or completing does not refresh the original summary. Changed and orphaned requests remain visibly historical, including completed ones. Create a new request to summarize changed work. Captured unresolved-question labels survive edits or removal; completion never removes their uncertainty automatically.

## Drafts, retries and concurrent changes

Unposted notes, recipient text and question selections stay only in this canvas, keyed by journey and request/scope. Polling, hiding/reopening the dialog, changing branches, errors and suspension retain them and preserve ordinary answer/comment drafts. **Closing the canvas can lose unposted handoff text.** It is not placed in the shared file or durable answer-draft store before an explicit action.

Actions use the normal revision checks, shared-file lock, fresh source validation and atomic save. The canvas retains exact submission IDs and content if a response is ambiguous. **Retry previous action** checks that same transition; it does not take responsibility or append a note twice. Newer composing text stays separate. A fresh locked server read can report the transition absent, allowing corrected content with a new ID. Present or unknown outcomes retain the original retry identity, including a committed write followed by failed history finalization. An HTTP error alone never proves nothing saved.

Independent handoff records merge. Competing changes to one record, one-sided deletion and differing scope/source captures require a complete-candidate choice. The merge UI shows both records and their full notes. It does not mix transitions or infer ownership from timestamps. Original file candidates and normal history/Git retain the alternatives; if a combined collection exceeds its limit, the existing explicit complete-source fallback applies. A source node deletion alone retains the orphan request.

## Copies, exports and compatibility

Native/shared JSON, clone/pull, import and history retain handoffs. Importing as a new journey identity makes retained fingerprints historical. Scenario forks deliberately omit ownership requests because they describe a different alternative; the original keeps its notes and an explicit new request can assign the fork's work.

AI prompts, research context, the native `get_exploration` tool, ordinary decision Markdown and offline viewers omit handoff notes. The native tool also omits review comments; UI snapshots and saved files retain both. **Copy selected handoff** is the explicit supported text export: it includes only the selected record's original scope, unresolved labels, notes/events, current status and freshness caveats. It excludes other handoffs, answers and private drafts. Native JSON carries the complete shared metadata; review the native file before sharing it.

The optional `reviewHandoffs` v1 field permits 32 records, 16 transitions per record, 256 transitions total and 256 KiB of pretty-serialized metadata. A note is at most 2,000 JavaScript characters, a recipient label at most 96 and unresolved selections at most 24. The ordinary 9 MiB document limit also applies. Unknown fields, malformed Unicode, duplicate IDs, invalid contributor events and illegal transition sequences are rejected. Opening older files adds no handoff field. Use a current Explorer version for these files; older versions may reject or omit metadata they do not support.

Automated coverage exercises schema/limits, source coverage, clone/pull/history/fork behavior, independent and conflicting records, two private contributor identities, failed/stale saves, post-commit retries, prompt/export boundaries and protected HTTP actions. jsdom covers literal rendering, draft/caret preservation, question/record paging, filters, explicit export and late responses. Owner checks remain: native narrow-pane layout, keyboard/focus/scroll flow and two installed clients exchanging the file through Git. No browser/desktop automation or paid model is used by these checks.
