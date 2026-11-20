# Project-aware questions — issue 114

Owner-approved design: a separate isolated tool-free helper receives only explicitly reviewed project context. Implement sequentially on v0.1.126. Existing ordinary question generation remains attached-session enqueue. Initial UI reuses the established review modal and editable question preview; no new workspace layout is needed.

## Behavior

1. Add an explicit **Project questions** action for the selected root, direction or question. Review the current approved project brief and bounded relevant saved-map inputs before **Generate project questions**. Show uncertainty labels and exact inputs. Missing, off, stale, unknown-only or unavailable context explains the limitation and offers ordinary generation by user choice; failures never silently disclose project inputs to attached chat.
2. Use a purpose-specific one-use token. The owned helper receives projected brief claims (IDs, section, text, kind), not full excerpts, supporting quotes or an absolute root. It uses the selected eligible Copilot model, zero tools, matching account, owned cancellation and existing usage/release handling. Dedicated Research model/settings do not apply.
3. Ask about unresolved decisions and consequences rather than already established facts. Current implementation is changeable evidence, not a mandatory future design. Inferences, user assertions, conflicts and unknowns retain their labels. Generate questions only; existing saved answers and editor drafts are never supplied by the model.
4. Stage strict bounded JSON in the existing preview. Accepting selected questions is the only map write. Exact approved context and private guards remain transient. Accepted wording/rationale can reflect the context the user reviewed; the raw brief and prompts are not automatically persisted. Durable claim references are #116.

## Implementation sequence

- Add failing contract tests for project-question preparation, paired synthetic cases, parser boundaries, Unicode and relevance/budget revalidation.
- Add `project-questions.mjs` for preparation/parser/owned-helper adapter. Reuse relevance selection and generation coverage from `research-context.mjs`; retain the operation in freshness rechecks.
- Give `ProjectBriefWorkspace` a narrow server-only approved snapshot/current contract. Check approval/revision/capture/epoch/journey and bounded full freshness at operation boundaries. Unknown-only briefs do not supply useful project grounding.
- Extend the review manager/client with explicit `project-questions` handling, exact input review and no Research settings/model capture. Preserve token/client/sequence/TTL guards.
- Integrate the helper with the controller's tool-free queue and shutdown barrier. Distinguish owned pending questions from native callbacks. Recheck project/map/scenario before dispatch, staging and final commit; invalidate on scope/brief changes and abort on cancellation/close.
- Add the action, explanatory fallback and review copy to the current UI. Preserve answer drafts, caret, disclosures, narrow-pane overflow, keyboard focus and existing ordinary entry points.
- Add contract/controller/HTTP/jsdom/SDK/Brave coverage. Update the installed local-model fixture and docs; extend AGENTS.md only for the already-approved project-question purpose.
- Synchronize v0.1.127 and release notes, obtain one independent review, fix/rereview findings, freeze the candidate and run the full iteration gate. Validate package, integrate/push main without force and verify remote SHA. Update/close #114 only after publication.

## Verification limits

Synthetic paired fixtures establish input/output contracts and relevance examples, not measured live-model improvement. Automated checks use no paid provider or existing user session. Native rendering, assistive technology, IME/microphone and live usefulness remain explicit manual limitations. #91, #110 and #41/#42 retain their own unresolved requirements. No new internet access or repository mutation is authorized by this feature.
