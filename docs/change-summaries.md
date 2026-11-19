# Exploration change summaries

Choose **Tools → Summarize exploration changes** to prepare Markdown for a pull-request review. Explorer compares two explicitly selected saved sources. It does not ask a model to infer why decisions changed, post to GitHub, commit files or write the summary into the repository.

## Select and review

1. **Refresh versions** reads available retained revisions. Choose **Before** and **After**, including the current saved revision if appropriate. Both must belong to the same exploration identity. Private history follows the existing retention/checkpoint limits; a pruned or damaged version is unavailable, not replaced with another base.
2. For a shared project journey, you can instead choose **Local Git revision and current saved version**. Type a locally available branch, ref or commit ID. Explorer reads that exact committed version of the same relative exploration file, then compares it with current saved content. It does not substitute a merge base, fetch remote objects, run content filters, stage or commit. Revision expressions and option-like names are unsupported. Missing, conflicted, filtered, unsupported or mismatched sources must be resolved before comparison.
3. **Generate preview** shows the exact source identities, hashes and comparison coverage, then fills **Editable Markdown**. A saved working version is not described as committed. The chosen Git alias and resolved commit are both visible.
4. Edit the Markdown locally as needed. **Copy Markdown** and **Download Markdown** recheck the selected sources before using the edited text. Edited text is not sent back to the server. Downloads use `exploration-changes.md`; “download requested” does not establish that the browser saved a file. Clipboard failures remain visible, with explicit retry/download available.

Generation replaces the editable summary present when you click Generate. If you type or start composing text while generation is pending, Explorer retains your newer text and caret, discards that preview and asks you to generate again explicitly. Copy or download edits you want to retain before regenerating or reloading the canvas. These edits are not persisted as another exploration draft. A saved change marks an open preview stale, disables reuse and preserves its textarea/caret. Refresh versions and generate explicitly to continue. Changing a selection also invalidates the preview. Closing, changing journeys or suspending the page rejects late responses. Checks do not provide continuous filesystem monitoring: changes after a completed check may require a later refresh.

## What is compared

The whole selected exploration is compared by stable IDs, not similar wording. Separate forks/copies with different journey/root/creation identities are rejected rather than paired heuristically. The result has deterministic labels and literal before/after values for:

- Added/removed questions and user directions; changed wording, category, parentage, answer, effective answer state, review flags/causes and research-staleness metadata.
- Topic, objective, success criteria, mode and ordered constraints. Constraint order remains meaningful, matching History.
- Added, removed or changed dependency assertions and explanations.
- Saved scenario/copy lineage. External scenario preference-register history is unavailable; today's preference is not attached to a historical source.
- Saved ADR association metadata, status/relationships and source-review effects where captured evidence permits comparison. These describe saved claims, not current external Markdown contents. Legacy or missing source proof remains unavailable. The existing ADR reason limit is disclosed with an omitted-reason count if reached.

Assumption means unverified, tentative means provisional, and decided means a user decision rather than external verification. Review flags and earlier unretained review causes remain visible. Selected research-staleness flags can reflect the existing conservative invalidation policy; this summary does not reassess research quality.

Authored values appear in fenced JSON blocks separate from generated labels. JSON escapes retain exact whitespace, CR/LF line endings and control characters; Unicode is preserved. Embedded Markdown/HTML stays literal. “No changes” applies only to the stated comparison coverage, not to every field in a native JSON file.

When an exact project-relative location is available, changed records include [portable references](portable-references.md) to their before/after snapshots. These references may open changed content or report a removed target in another checkout. They are not immutable Git-file URLs. Personal versions have no fabricated portable location.

## Exclusions and limits

An explicit field projection omits raw research, accepted artifact wording, ADR generated baseline text, generation metadata, reminders, comments/contributor attribution, private drafts, selected project excerpts, local usage and helper state. No unrelated repository content enters the output. Text the user deliberately saved into included questions or answers remains included; this is not content redaction.

History selection can perform existing private history reconciliation/housekeeping; it does not change the saved project exploration. Local Git reads reuse the guarded comparison/status readers and require the currently selected working directory and checkout. Tokens are scoped to the current journey/revision and expire after 15 minutes. Replacing storage, closing the canvas or preparing another preview invalidates earlier ownership. A missing/pruned snapshot, changed ref/file/root, damaged data or unmerged selected file cannot be silently used as a base.

Complete generated or edited Markdown is limited to **2 MiB UTF-8**, and a preview response to **4 MiB JSON**. Oversized output is rejected rather than clipped. Large explorations may need inspection of their native versions separately. Source reads retain the existing 9 MiB document and bounded local Git-command limits.

Automated coverage includes pure comparisons, exact history/Git reads, HTTP boundaries, interrupted/stale UI responses, editable copy/download, and private answer/caret preservation. Native narrow-pane layout, keyboard/screen-reader/theme/IME behavior, actual clipboard permissions and download handling remain pending owner verification. No browser/desktop automation was used.
