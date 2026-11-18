# Reviewed ADR drafts implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkboxes.

**Goal:** Generate, edit and explicitly retain a proposed ADR from reviewed saved exploration evidence without approving a decision or writing a project file.

**Architecture:** A pure adr-draft module owns preparation, structured output, provenance and freshness. The existing reviewed-input token and owned tool-free artifact slot handle generation and acceptance. The existing artifact dialog gains an ADR mode with exact input, title/statement editing and explicit proposed status.

**Tech stack:** Existing ES modules, Node built-ins and jsdom; installed paired desktop SDK/runtime only. No dependency or new network capability.

**Spec:** GitHub #78, prerequisites #75/#76 delivered. #79 owns readiness; #80 owns writing; #84 owns durable source navigation; #85 owns lifecycle transitions. User authorizes implementation, assignment, comments and main publication without further approval.

## Global constraints

- Only current saved ADR scope, mandatory guidance, selected saved records, optional recorded evidence, scenario and validated format layout reach helper. No new project read; raw template body/path, private drafts/references, unselected records, prior artifacts and research recommendation prose excluded.
- Actual instructions+prompt <=131072 UTF-8 bytes; never silently truncate selected input. Output strict JSON <=256KiB. Saved artifact <=512KiB; complete document existing9MiB.
- Output has title<=200 single-line characters, status exactly proposed, seven fixed section arrays: context,drivers,alternatives,outcome,consequences,confirmation,optionDetails. Each<=5 statements; globally unique ASCII IDs<=80; text<=1000; <=8 transmitted node/guidance/evidence refs each. Omitted template sections remain empty and visibly unspecified; references derive from statement mappings, metadata date/people remain unspecified.
- Preserve source certainty/review flags and missing reasons/alternatives. Model explanations are not user rationale. AI synthesis/research claims are not verified facts. Source-state checks downgrade unsupported user-decision labels; semantic faithfulness still needs human review.
- doc.adrDraft stores accepted wording separately from source answers, scope/format and previous artifacts. status remains proposed; acceptedAt records wording acceptance only. User edits persist literally with titleEdited/per-statement edited flags and original references explicitly not reverified.
- Reuse owned tool-free helper, account/model checks, zero initialized tools, permission denial, cancellation/release queue, usage receipts under Explorer ADR Draft. Never send this request to attached chat or change its model.
- Root-bound review purpose adr-draft, single-use ten-minute token, no client-supplied selection/format. Freshness captures selected records/evidence, guidance, saved scope/format and scenario. Recheck after asynchronous waits and under final writer lock; source changes invalidate, never overwrite newer content.
- Proposals transient/private; accepted artifact validates/imports/roundtrips. Imported research provenance downgrades without inventing local reads. Source deletion leaves historical refs and stale status.
- Preserve answer editor/caret and artifact edits across polls/stale notices; close/suspend/switch rejects old responses. Hide can retain proposal consistently with current artifact behavior. No browser automation; native checks pending owner.
- Release .94 synchronized across manifests/lock/README; newest <=400character release note. One issue-sized commit after tests and one independent final review; pushmain and verify remote.

## Review focus

- Changing a saved format/scope or evidence during queued policy checks, result handling or final acceptance must invalidate even if node answers did not change.
- Edited title/text must not acquire new certainty or formal accepted status; malformed helper results cannot inject trusted capture/format/provenance.
- A minimal repository template must not silently discard a nonempty generated section; absent metadata and omitted sections remain explicit unknowns.
- Imported historical evidence and deleted sources must remain readable without asserting current verification or destroying the saved draft.
- Late HTTP/helper responses after cancellation, switching artifact type/journey or page suspension must not restore authority or erase private editor text.

### Task 1: ADR artifact contract

**Files:** create extension adr-draft.mjs and test/adr-draft.test.mjs; modify model.mjs validation/import/roundtrip and answer-changes.mjs affected artifacts.

**Interfaces:** prepareAdrDraft(doc,{scenario}) -> operation adr-draft, context,instructions,prompt,bytes,limit,coverage,dependencies plus server-owned capture. captureAdrDraft(prepared) supplies format,scope,guidance,includeEvidence,evidence,dependencies,coverage. parseAdrDraft(content,prepared),validateAdrDraft(value),acceptAdrDraft(proposal,edits),adrDraftFreshness(value,doc). edits contains exact title and statement updates only; no status/refs/format edits. Artifact key adrDraft; operation routing adr-draft separate.

- [x] Write partial/complete source fixtures; exact selected input and template layout, missing/current scope, maxbytes, Unicode, bounds, unknown IDs/status/fields, globalduplicateIDs, empty/omittedsections, evidence certainty, edited provenance, source/format/scope freshness, import/JSON/history preservation.
- [x] Run node --test test/adr-draft.test.mjs. Expected missing module/contracts RED.
- [x] Implement pure bounded contract using existing scope/format and brief statement/source validation. Keep no filesystem/helper side effects. Validate imported source structure while retaining historical provenance.
- [x] Run pure contract and adjacent scope/format/handoff tests. Expected GREEN; source answers unchanged and unrelated artifacts preserved.

### Task 2: Reviewed tool-free generation and acceptance

**Files:** research-review.mjs,controller.mjs,decision-brief.mjs,owned-helper.mjs,research-usage.mjs,server.mjs; new test/adr-draft-workflow.test.mjs and appropriate helper fixtures.

**Interfaces:** ResearchReview purpose adr-draft exact action,clientId,journey,nodeId, purpose,sequence. Controller api/adr-draft uses briefRequest(input,'adrDraft'); private work operation adrDraft, helper operation adr-draft. start requires id,journey,token; accept revision,edits. Reuse existing queue/briefWork with operation-selected contract, no separate cancellation lifecycle.

- [x] Write RED tests for exact reviewed strings, token purpose/expiry/sequence, strict HTTP Origin/client header, zero helper before explicit start, transient proposal, malformed injected output, explicit save, declined/status edits rejected, cancel/late-result, stale source/scope/format/scenario/disk races and final async acceptance guard.
- [x] Run new workflow test. Expected unsupported purpose/route RED.
- [x] Implement narrow artifact contract dispatch and helper/usage operation. Keep trusted captures server-owned and validate status before retention. Add ADR to affected artifact warning path.
- [x] Run workflow plus existing brief/handoff/helper/review suites. Expected GREEN, cancellation retains answers and persisted drafts; actual release blocks subsequent helper appropriately.

### Task 3: Editable ADR preview and installed helper fixture

**Files:** web/app.mjs,index.html,research-review-client.mjs,style.css as needed; test/web.test.mjs; scripts/e2e-decision-brief.mjs --adr and package script.

**Interfaces:** Tools ADR draft opens existing artifact dialog ADR mode. Review saved ADR input, generate reviewed draft, proposed status, editable title/statements, accept draft wording, cancel/discard, refresh, close. No project write/export control yet. Exact review uses new purpose. Existing source provenance shown literally; durable ADR navigation belongs84.

- [x] Write named ADR draft UI tests for explicit review/generate, input exclusions, title/textediting and literalUnicode, proposedstatus, no automaticapproval/filewrite, missing/stalescope, closed/suspended/switched response guards, preserved answer draft/caret and manualartifacttext onpoll/stale.
- [x] Run named tests. Expected missingcontrols/ADRmode RED.
- [x] Implement ADR mode via existing artifact lifecycle; disable generation without fresh review, retain edited proposal on stale errors for copying, no hidden ordinarybrief fallback. Use text rendering/visiblefocus and narrowlayout patterns.
- [x] Extend installed helper fixture --adr for actual zero initialized tools, exact context bytes/omittedcanaries, strict structured parse, Explorer ADR Draft receipts, cancellation and actual release. Inspect installed SDK config declarations first; no package/runtime substitution.
- [x] Run named UI tests, installed --adr helper fixture and main e2e. Expected GREEN; record native checks pending.

### Task 4: Release and issue record

**Files:** docs/adr-drafts.md,README,plan,version metadata/release notes.

- [x] Document proposed vs wording acceptance, provenance/freshness, template limitations, missing rationale, helper isolation and pending native/livequality checks. Synchronize .94 and release note.
- [x] Run one independent whole-change review with this focus and ledger rulings. Regrade material findings; one RED/GREEN fix pass, no re-review.
- [x] Run npmtest/check/package,diffcheck plus required installed fixtures; expected GREEN. Record actual counts/results, task-done check gate references recorded full suite.
- [ ] Commit, integrate/pushmain without force, verify remote commit, complete/comment/close78, then nextreadyissue. Retain ignored notes after earlier cleanup approval rejection.

Rulings: no status transition beyond proposed; title editing cannot approve decision. Minimum template may omit semantic sections; model must leave them empty, UI marks them unspecified instead of silently discarding text. One issue-sized release commit means finalreview examines workingtree/newfiles against previouspublishedbase. User authorizes ongoing implementation; no extra approvalpause.
Release validation: npm test 1091/1091 passed (426094.4408 ms); npm run check/package and diff checks passed. Installed e2e:adr and main e2e passed with the local fixture. Independent review's single Important save-time wording-loss finding fixed with three RED/GREEN cases; no deferred minors. Publication is the final step below and its verified commit is recorded in issue78.
