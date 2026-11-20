# Research freshness

Issue [#106](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/106) asks Explorer to distinguish time-sensitive evidence from durable guidance, explain when research needs review, and preserve older findings until an explicitly requested replacement succeeds. The owner approved this feature and delegated implementation choices. The categories and intervals below are implementation policy choices, not owner-selected accuracy guarantees.

## Meaning and scope

Retrieval time records when the owned helper received a successful read of the requested URL. It does not establish the page's publication/update date, redirect destination, applicability, truth or currency. Source date labels and claim classifications are model interpretations, even when their exact wording occurred in a successful read. Imported metadata is historical evidence from another installation, not a local observation.

No status certifies a fact as current. Unknown classification or source dates stay unknown. Stable concepts remain useful without an age-only expiry; named-version evidence supports its named historical scope and never proves the latest release. Changed exploration context (`researchStale`) is separate from age of evidence.

## Bounded metadata

- A structured source may have `dateObservations`, at most three records with `kind` (`published`, `updated` or `ambiguous`) and `text` (an exact nonblank source label/passage, at most160 UTF-16 units). Missing or empty observations mean unknown dates. No URL/search-snippet/fetch-time inference.
- A structured claim may have `freshness` with `type`, a nonblank `reason` of at most300 UTF-16 units, and `version`. Types are `price-availability`, `product-version`, `evolving-guidance`, `durable-concept`, `named-version`, `unknown`. `version` is a nonblank string of at most120 units only for `named-version`, otherwise null. Missing classification stays unknown.
- Existing source/claim counts and the160000-byte research aggregate limit still apply. Saved sources, selected ADR/handoff evidence, followups, history/import and exports retain this metadata; they do not acquire new read authority.
- New date labels must occur literally in the correlated successful fetch text actually delivered to the model. Keep its transient prefix of at most 32,768 UTF-16 units from each first read, within the 262,144-unit aggregate delivered-tool-text allowance, alongside its first-read receipt; never persist complete page text. An absent usable occurrence prevents an unsupported date observation being accepted; omit such a label and leave the date unknown. Text occurrence does not prove that the date applies to the cited claim. See [research effort](research-effort.md).

## Policy version1

| Claim type | Review interval | Meaning |
| --- | --- | --- |
| Current price or availability | 1 day | Obtain current evidence before a current-state conclusion after the interval. |
| Current product or version behavior | 7 days | Recheck the applicable release/product details. |
| Evolving guidance or standard | 180 days | Check whether guidance was revised or superseded. |
| Durable concept | No age-only expiry | Age alone does not invalidate the concept; correctness still needs assessment. |
| Named version | No age-only expiry | Retain the named scope; never infer latest/current compatibility. |
| Unknown | Unknown | Classify the claim and inspect its evidence before claiming currency. |

These intervals are conservative product heuristics. They are not service-level promises or facts about how often a topic changes. Evaluate with an injected clock in tests. Retrieval age uses elapsed milliseconds; supported calendar date labels use UTC calendar days. A boundary is reached at, not after, its interval. Unknown/future timestamps and clock rollback must not become age zero or imply freshness.

Recognize only a valid ISO calendar date alone or with a short English label (`Published`, `Updated`, `Last updated`, `Publication date`, `Date published`, `Date modified`, `Modified`, optionally `on` and a colon). The label must agree with its recorded kind. Other wording/languages remain inspectable without an inferred date. Non-ISO numeric dates, multiple conflicting dates, timestamp/timezone ambiguity and unsupported date wording stay unknown. A published date and an updated date are distinct; a consistent updated date may describe a later revision, while contradictory date ordering remains unknown. A recent retrieval cannot make an old publication current. Show the original short label so the user can inspect the interpretation.

Use statuses for review needed, currentness unknown, within the policy's review window (unverified), durable concept and named historical version. Known expired evidence takes precedence over otherwise unknown dates. Do not treat a count of agreeing sources as a freshness vote.

## Requests, recommendations and refresh

Freshness accompanies included evidence in exact reviewed followup and tool-free reconsideration inputs, with policy version and evaluation time. A changed meaningful status before dispatch requires a fresh review; never rewrite approved input silently. Captured evaluations are historical, not permission to poll sources.

Recommendation checks use recorded support links to identify material premises, retaining unknown coverage for legacy/unlinked evidence. A material volatile premise with expired or unknown currentness cannot silently justify a current recommendation. Tool-free priorities cannot renew old evidence. Keep unrelated supported conclusions and the user's answer usable. No text parser claims to detect every incorrectly classified or unsupported model assertion.

Existing Research opens the approved inline request review and uses the selected or dedicated research model. Viewing dates, expanding disclosures or loading a map never triggers retrieval. Keep prior research readable on failure, cancellation or invalid replacement; only a successful current result replaces it. No additional network permissions or scheduled internet polling are introduced.

The live pane reevaluates age during its ordinary local state updates without replacing the answer editor or open disclosures. Shared HTML evaluates age when the artifact is generated, labels that time, and explicitly states that the static export does not update. Source labels and classifications are preserved in the selected snapshot; derived presentation timestamps never enter selection digests or saved ADR/handoff evidence identities. Markdown and selected evidence appendices label their evaluation time as well. None of these views renews a source read.

## Verification limits

Deterministic tests cover boundary clocks, old/undated/future/conflicting/timezone labels, volatile and durable claims, named versions, imports, exact reviewed context, rejection of unsupported labels and replacement preservation. Installed anonymous SDK/local model fixtures and authorized Brave checks validate integration and UI, not live source quality. Native #91 acceptance and the separately authorized #110 live pilot remain separate.
