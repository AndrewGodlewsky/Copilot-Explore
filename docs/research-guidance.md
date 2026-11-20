# Topic guidance for Research

Research offers four explicitly selected guidance profiles in **Guidance, effort and source preferences** inside its existing bottom-drawer review. The summary identifies the effective profile, version and selection reason before starting. Expand **Selected topic guidance** to read the entire profile; **Exact inputs** shows the actual instructions and prompt. Changing a profile prepares a new review and invalidates the old one-use token. It never starts research automatically.

| Profile | Choose it when | Distinct guidance |
| --- | --- | --- |
| General (`general` v1) | The topic is mixed, unfamiliar or uncertain, or no specific profile fits. This is the initial default. | Apply the common evidence contract, identify missing context and avoid implying specialty expertise. |
| Software and versions (`software-version` v1) | Adoption, compatibility, upgrade or migration depends on versions and environments. | Versioned official documentation; compatibility, migration, rollback and trials; unknown installed versions can block a recommendation. |
| Products and services (`product-service` v1) | A purchase or service comparison depends on capabilities, costs, availability or terms. | Provider specifications versus independent experience; total cost and exit options; applicable date, region, currency and variant. |
| Concepts and design tradeoffs (`concept-design` v1) | Definitions, goals and competing approaches matter more than a particular product. | Explicit assumptions, primary explanations, reversibility and experiments; separate stable principles from changing practices and value judgments. |

There is no automatic topic classifier or extra model request. Choose General whenever the narrower criteria would distract from the decision. A profile guides the inquiry; it is neither factual evidence nor a guarantee of expertise, accuracy or a recommendation. The user still chooses their answer.

## Scope and provenance

The immutable catalog is [web/research-guidance.mjs](../com.github.copilot/extensions/explorer/web/research-guidance.mjs). Its v1 text is original Explorer guidance authored for #103; no third-party skill text was copied or adapted and no external license is claimed. Each profile covers sources, criteria, freshness, stopping and uncertainty. Common evidence/output rules stay in the explicitly loaded [research skill](../com.github.copilot/extensions/explorer/research/skills/explorer-research/SKILL.md). General deliberately defers to those shared rules.

Only the selected catalog text enters the helper instructions. A selected profile is limited to 4 KiB of UTF-8 text and counts within the existing 128 KiB instructions-plus-prompt ceiling. Optional context is omitted as complete records with coverage counts; oversized mandatory input rejects. Profile metadata cannot supply arbitrary instructions. Fetched pages, saved map content and imported metadata remain untrusted data. Project excerpts remain excluded from Research.

Profiles grant no tools, permissions, providers, downloads or dependencies. All four use the same isolated owned helper, selected eligible Research model, matching account, source permissions, effort limits, cancellation and retained usage receipts. Ambient skills/instructions remain disabled. Reconsideration, questions, Challenge Review, ADRs and handoffs do not acquire topic guidance through this feature.

## Recorded identity and follow-ups

New saved research records the authoritative reviewed `{id, version}` in `settings.profile`. Model-authored settings cannot override it. Existing three-field settings and older results without settings remain valid and visibly unrecorded historically. Unknown IDs, versions, extra reference fields and malformed references reject during validation; future profile revisions must retain support for previously recorded versions or provide an explicit migration.

Follow-ups inherit the latest completed exchange's profile, otherwise the original saved research profile, otherwise General. An explicit choice in review overrides that inheritance, including choosing General. Each completed exchange records its own profile identity; changing or cancelling a later request does not relabel earlier answers. Clearing transient history returns inheritance to the original saved result. Follow-up profiles share the existing four-exchange / 64 KiB memory bound and are not saved as new research. Saved profiles survive normal save/reopen/import and appear in Markdown and offline selected-research exports.

Exact-answer reuse checks the actual selected instructions/settings and the completed exchange's profile provenance. A different profile or version cannot authorize the same cached answer. Reuse retains the original label and source dates; it does not rerun or revalidate research. No profile is a global personal preference.

## Evidence and pending acceptance

The focused fixtures exercise every family, General/default behavior, explicit override, version validation, Unicode input accounting, save/reopen, trusted result metadata, follow-up inheritance/cancellation, reuse invalidation, drawer focus/drafts and offline rendering. The installed-SDK local research fixture inspects the selected software profile in the actual provider request while other profiles remain absent. These establish delivery and behavioral contracts, not improved answer quality.

The profile differences above are authored expectations, not results from a real research comparison. #103 remains open for its comparative usefulness criterion through #110: actual paired generic/profile answers, human scoring and recorded regressions are still required. No paid provider or existing user session is used by automated fixtures. Native Copilot rendering, live source quality and the unresolved #41/#42 transport/log limits are not established by passing DOM, Brave or local-runtime checks.
