# Curated research guidance

Implement approved issue #103 on v0.1.122 / 4b69168 in the existing isolated checkout. Use executing-plans, one implementation owner and one final independent reviewer under docs/development-workflow.md. Native ES modules, existing review/controller/model/browser boundaries; no dependency or tool expansion.

Goal: make a small versioned set of topic guidance explicitly selectable and inspectable, while keeping General as the default. Follow-ups retain their reviewed profile unless the user changes it. The live usefulness requirement remains open until #110's authorized actual-answer pilot is available; authored responses cannot establish improvement.

## Contract

- Three specific families: Software and versions, Products and services, Concepts and design tradeoffs. General handles mixed, unfamiliar or uncertain topics. Document when to choose each. No automatic classifier or unreviewed model call.
- One immutable v1 catalog with original authored guidance, ID, title, applicability and bounded source/criteria/freshness/stopping/uncertainty text. Only selected guidance enters the helper, at most 4 KiB inside the existing actual 128 KiB instructions-plus-prompt ceiling. General can defer to the common research contract rather than repeating it.
- Additive optional `settings.profile: {id, version}`. Legacy three-field settings remain valid and unchanged. New requests resolve a known effective profile; parsing attaches trusted prepared settings, never model-authored profile metadata. Unknown/malformed references reject. Historical results without metadata stay labeled unrecorded.
- Initial research defaults to General. Follow-ups inherit the latest completed exchange's recorded profile, then original research's profile, then General; explicit review selection overrides it. Record profile identity on each new exchange so later overrides do not relabel earlier turns. No new freeform instructions field.
- Review shows name/version/reason and an explicit selector beside existing settings; full guidance stays expandable with exact input. Selection changes invalidate prior review. Existing Research label and provider/source disclosure remain. Retain connected drafts/focus/disclosures under polling.
- Existing effort/source policy, ambient-skill exclusions, account/model checks, isolation, cancellation and usage receipts remain. Profile is guidance, not factual support or expertise. Project snippets and unrelated helpers remain excluded. Exact reuse must reject changed guidance/version or exchange provenance.

## Task 1: catalog, settings and prepared inputs

Files: new web/research-guidance.mjs shared by Node/browser; web/research-policy.mjs; research.mjs; research-followup.mjs; focused tests.

- [x] RED for four distinct profiles, documented manual/default rules, strict ID/version/reference shape, bounded original text and unchanged legacy settings; implement a pure frozen catalog/validation/text projection.
- [x] Resolve effective profile at preparation. Count selected text inside actual input budget and expose omission/overflow honestly. Direct helper fallback and reviewed paths agree; selected guidance appears once, other profiles do not leak into inputs.
- [x] Follow-up tests cover saved and conversation inheritance, explicit General/specific override, legacy unrecorded metadata and literal Unicode/input boundaries. Preserve all existing source/freshness validation.

## Task 2: authoritative metadata and review/UI

Files: research-review.mjs, controller.mjs, research-reuse.mjs if provenance key needs expansion; server/static/offline-viewer asset lists; web/app.mjs; controller/DOM/UI tests.

- [x] RED real review/helper/controller tests: stale token after profile change; exact prepared selection wins over model fields; saved/reopened profile survives; follow-up override is captured per exchange, cancellation/late work cannot change earlier metadata.
- [x] Keep profile references bounded and validated in saved results/history. Inspect legacy behavior without silently claiming a historical v1 profile. Include changed profile/provenance in exact-reuse eligibility.
- [x] Add selector, effective name/version/reason and expandable guidance within existing inline review. History/result labels show the profile that actually applied, not the newest profile for every turn. Use literal rendering and existing drawer focus behavior.
- [ ] DOM checks pass for override, fresh review, keyboard focus and drafts/disclosures; run final five-viewport Brave geometry checks. Offline exports preserve version metadata without external dependencies.

## Task 3: verification, evidence and release

- [x] Document profile applicability, provenance, retention and measured/unmeasured limits. Offline cases may check contract/constraint coverage but not live semantic usefulness. Keep #103's actual comparison criterion pending #110.
- [x] Inspect relevant installed SDK declarations/contracts; run the installed local research fixture where relevant to changed prompt delivery. Automated checks use no paid provider or existing user session.
- [ ] Synchronize v0.1.123 metadata and accurate release note; independent final review of implementation/spec/evidence and fix findings.
- [ ] Frozen verify:iteration --allow-ui, package byte comparison, fetch/commit/fast-forward main/push/no force and exact remote verification. Finish publication steps in ignored completion receipt so final content remains frozen.
- [ ] Record usage unavailable if counters cannot be measured, native91/live110/41/42 limitations, seven-day observation pending, and issue progress/completed implementation with live usefulness acceptance still open. Proceed to another ready issue or record the remaining genuine blockers.
