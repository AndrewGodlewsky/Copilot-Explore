# Reusing a previous follow-up answer

After a completed follow-up, enter the exact same question and choose **Review follow-up context**. When the earlier answer still qualifies, the inline review offers **Use previous answer**. This returns to the original response without a new helper, model inference, source request or usage receipt. Its question, hypothetical label, exchange ID, source provenance and dates stay unchanged. It does not add another exchange or certify the answer as current or correct. **Research** always requests a new answer through the ordinary reviewed path.

The current question's completed conversation is already held transiently: at most four exchanges within 64 KiB. Reuse adds one small private record for the latest complete exchange. It retains hashes and timestamps, not another prompt, page archive or source body. A partial, failed or cancelled attempt cannot become reusable. Older visible answers can still be read when reuse is unavailable.

## When reuse is available

- The question is identical, including whitespace and case, with the same hypothetical flag. Paraphrases are not matched.
- The saved question, map branch, relevant committed context, scenario, original research, scope, exclusions and effort/source/recency settings still match. A saved `researchStale` marker prevents reuse.
- The selected Research model, account and settings revision match. Reuse has its own one-use context review; a stale token or another history cannot authorize it.
- The canvas instance, journey/file and currently observed canonical project-root identity match. The existing installed SDK metadata supplies the working root; directory identities are checked, without reading repository file contents. Missing, remote, changed, linked or unresponsive roots disable reuse. The optional root lookup is bounded to two seconds; ordinary Research remains available under its existing rules.
- The original input can be reconstructed from retained predecessor exchanges at its captured preparation time. Explorer compares the exact instructions/prompt and separately reevaluates evidence freshness now. If adding the answer evicted required predecessors, the earlier input cannot be reconstructed and reuse is unavailable.
- Neither the included input evidence nor the answer has an age-based `needsRefresh` finding. Policy/version and freshness-state changes reject reuse. Unknown classifications remain unknown; named-version evidence retains its historical scope. An imported source never becomes an observed read through reuse.
- Completion was less than 15 minutes ago, the current UTC date matches preparation, and the clock has not moved backwards. These are conservative availability limits, not freshness guarantees. Reusing an answer never renews this window or any source date.

The controller rechecks eligibility when the user chooses reuse, under the existing serialized operation and document-lock boundaries. A changed or unreadable saved file rejects the action. There is no shared in-flight work: cancellation still belongs to the single owned request. Unconfirmed helper release blocks a new operation as before. A new Research request never silently switches to a cached answer.

This matches the saved Explorer context, including relevant map branches. Repository contents and Git refs are not research inputs here; this feature does not discover or interpret changes to them. Repository-context features must bind any newly introduced inputs before they can participate in reuse. Existing project excerpts remain exclusive to the selected-file, tool-free Challenge Review contract. No source permission, network access or tool-result replay is added.

## Clearing and retention

**Clear follow-up history** removes the current canvas's completed discussion, reusable record, reuse notice, outstanding context review and any matching transient follow-up attempt. It preserves the saved research and answer/composer drafts, and returns keyboard focus to the composer. Finish or explicitly cancel active work before clearing. A stale clear action cannot remove a replacement history.

Switching journeys or closing the canvas already clears this transient state. Another question's completed follow-up replaces its eligibility; ordinary new research makes the old conversation historical. Nothing is written to the journey, project cache or exports. Native snapshots exclude follow-up history; browser snapshots omit the private reuse key, model/account capture and project identity. Existing native SDK journals from the original helper remain subject to the documented #41 limitation; clearing Explorer's transient discussion does not delete those journals or retained usage records.

The original response receives a visible reuse notice. Polling updates that notice only when its content changes, preserving open source disclosures and avoiding repeated live announcements. Drafts and their editors stay connected. The inline review's model-input disclosure continues to describe the **Research** action; **Use previous answer** sends none of those inputs for inference.

## Offline comparison

Measured 2026-11-20 against the actual shipped v0.1.121 extension from commit `af79c7355079b702f6039a40837219a5fb34bc9c`, using a Git archive and the unpublished #109 candidate. Each variant runs the real controller, review, validation and transient history with an injected synthetic helper. The wall clock is fixed for repeatability and advanced explicitly for expiry. No provider, external research network or existing user session is used.

| Sequence | Baseline helper calls | Candidate helper calls | Baseline / candidate local ms |
| --- | ---: | ---: | ---: |
| Three exact compatible follow-ups | 3 | 1 | 36.64 / 34.37 |
| Changed question/version wording | 2 | 2 | 16.18 / 18.38 |
| Changed source preference | 2 | 2 | 16.29 / 20.56 |
| Changed project identity | 2 | 2 | 18.37 / 19.96 |
| Changed committed constraint | 2 | 2 | 44.26 / 40.38 |
| Expired reuse window | 2 | 2 | 16.40 / 17.37 |
| Changed hypothetical status | 2 | 2 | 15.25 / 20.75 |

All 14 rows preserved their authored expected response and saved map. The two intended reuse hits preserved the existing exchange; all changed-context cases required new work. Separate focused tests cover original source dates/imported provenance, stale input and output evidence, model/account changes, eviction, cancellation, concurrent actions, failed reads, stale receipts and clear behavior. Browser tests cover literal content, focus, drafts and disclosures at five viewport sizes.

These are actual controller-to-fixture helper invocations, not provider request counts. Local timings include review, filesystem and root-identity work; the baseline runs first and no model/network latency is measured. Added checks can cost local time, as these observations show. Matching scripted answers do not prove live semantic quality or factual accuracy. Provider token/cost and live quality values are unmeasured, not zero; #110 retains the live evaluation work. Detailed repeatable scripts/results are kept in ignored `.iteration/issue-109/` storage.
