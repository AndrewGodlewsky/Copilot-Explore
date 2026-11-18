# Contributors to shared explorations

In **Settings → Contributor name**, explicitly choose the display name to record with future shared contributions. Review the public preview, then save. No name is inferred from Git, an account, the operating system or a session. Leaving the setting empty uses an anonymous contributor. Use **Clear name** to return to anonymous contributions; submitting an empty name does not silently clear it.

The chosen name and random UUID are stored in `contributor-settings.json` in Explorer's private library directory. Renaming keeps the UUID; clearing and subsequently choosing a name creates a new one. Changes affect future contributions only. A second canvas must refresh a stale settings revision before saving. Invalid or unreadable settings are preserved and block new attributed shared writes until repaired and refreshed. A direct-file development preview has no trusted private settings location and reports unavailable. A standalone shared-storage adapter uses its asserted private journey directory; the installed plugin uses the library-wide setting.

## What is shared

Each public identity snapshot contains only `id` and `displayName`. Contribution events add an ISO timestamp from the local clock. They do not include an email, machine name, path, session identifier or credentials. Names are descriptive and **unverified**, not authentication or permissions. Contributors can choose the same display name; different UUIDs do not establish different real people. Timestamps are recorded times, not a trusted ordering service.

Optional versioned attribution travels inside the affected question or answer. It records the first known author, latest explicit editor and, for an AI suggestion, its explicit accepter. User wording remains user wording; accepting or adjusting an AI question does not claim authorship of the original suggestion. The first known author is not proof that the contributor personally composed every copied word.

Shared writes that record a contribution:

- Creating a shared topic, adding a manual question or adding a direction.
- Explicitly accepting suggested questions, including adjusted wording and ADR questions.
- Saving an answer or answer state, restarting a branch, reaffirming an individual review cause or clearing a reviewed answer. Only the directly targeted node receives the event; derived descendant review flags do not.
- Explicitly accepting a synthesized decision brief, implementation handoff or proposed ADR draft. The artifact records its accepter separately from its AI synthesis. Accepting ADR wording does not approve the decision.

No event is inferred for opening, polling, imports, copies to Project storage, restores, semantic merges, background research, ADR-file association, reminders, dependencies or guidance updates. Personal mutations retain carried attribution but do not create new shared contribution records. No-op saves do not create events. Local settings changes do not rewrite a journey.

## Reading provenance

Open a question's **More options → Answer details → Contributions** to inspect the question and saved answer. Accepted artifact views also show who accepted the saved wording. Names are rendered literally. The saved record is separate from any unsaved answer draft.

Legacy files remain unchanged on opening. Unknown authors and times stay unknown. A later edit of an existing legacy answer records its editor without inventing the original author. A review-only acknowledgment on an unanswered legacy node similarly records an editor, not an answer author.

Each record binds to a digest of the saved question/category or answer/state; artifact acceptance binds to the complete accepted artifact excluding the acceptance record itself. If someone changes saved content outside a covered operation while retaining its old attribution, the UI labels the retained record **historical** and the current contributor **unknown**. These digests detect a mismatch; they are not signatures and do not prove identity or integrity against deliberate file editing. ADR readiness excludes administrative acceptance metadata from its content judgment.

## Portability and limits

Clone/pull and native shared-file import preserve identity snapshots without needing the original private setting. Semantic merge selects a node's text and attribution together; conflicting answers remain explicit conflicts. Artifact acceptance stays with its selected artifact. History and restore retain the corresponding snapshots. Scenario forks retain attribution on copied content despite remapped node IDs; a newly changed personal alternative shows the prior answer record as historical rather than attributing it to whoever opened the fork.

The optional fields are validated on import and save. Earlier Explorer versions may reject files containing these fields; use the current version for shared work. Names are public in saved JSON and its copies/exports. Clearing a local setting does not remove names from existing files or Git history. This feature is a compact provenance record, not a full activity feed, author analytics, account system or cryptographic audit log. It does not automatically commit, push or resolve Git conflicts.

Private writes use the existing cooperative lock and atomic replacement conventions, bounded strict UTF-8/JSON reads and root/file identity checks. Arbitrary noncooperating filesystem writers are not a transactional database boundary.

## Verification

Automated coverage exercises strict schemas, Unicode, legacy absence, provenance mismatch, settings revisions, malformed/linked/replaced private storage, failed saves, two-contributor clone/pull and merge, history/fork/import preservation, explicit AI acceptance and UI races. jsdom tests preserve answer text and caret through updates and settings dialogs. Owner checks remain: visible native rendering and keyboard flow in a narrow pane, plus two installations choosing names, exchanging a shared file through Git and inspecting its history. No desktop/browser automation or paid model call is needed for automated attribution tests.
