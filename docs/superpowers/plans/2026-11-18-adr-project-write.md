# ADR project writing implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preview and explicitly save a proposed ADR into the active project, with recoverable file publication and exploration association.

**Architecture:** Pure Markdown and association contracts feed a bounded filesystem writer and a controller-owned review/recovery coordinator. The writer captures the current host working root, validates identities at publication, and journals the operation privately before publishing. UI review displays exact bytes and a complete before/after comparison for managed updates; recovery reads actual file and association state rather than guessing from the last response.

**Tech Stack:** Shipped Node ESM, existing filesystem identity/lock helpers, native HTTP canvas and plain DOM/jsdom. No new package or runtime dependency.

**Spec:** [Approved issue #80](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/80), depending on completed #78/#79/#55/#58. The owner explicitly requested autonomous sequential implementation, issue records and publication; no repeated design/push approval is needed. Base: v0.1.95, `9017d88121118c6e02af58ab3f3fd597153f9c4d`.

## Global constraints and decisions

- Use fresh attached-session `rpc.metadata.snapshot().workingDirectory`, never `workspacePath`, imported absolute references or a cached project root. Installed SDK declarations and existing canvas callback were inspected. Align paths with ADR format/template's active working directory; no Git discovery is necessary.
- Only saved proposed draft wording can be written. Recompute readiness against current saved sources/scenario at preview and immediately before publication. Correctness blockers reject; advisory judgments remain optional. No model, chat, Git or external-service action.
- Render through the reviewed format. Preserve certainty and edited-wording labels, unknowns and exact Unicode text as literal Markdown. A fixed proposed-status notice remains even when the chosen layout omits Status. Do not invent dates/authors. Managed identity is a validated UUID in a fixed comment; final output is at most 64 KiB including metadata.
- New paths derive from current format/title and an explicitly chosen number (1–999999 for numbered naming). Default number 1 reserves nothing; collisions require a new review/number, never a silent path change or overwrite. Hidden/secret-default/traversal/reserved paths and unsupported types remain excluded.
- Optional `adrFiles` is a bounded array of at most 50 references: `{version:1,id,path,title,status:'proposed',sha256,artifactDigest,readinessDigest,writtenAt}`. Unique IDs and portable case-insensitive paths. These are per-exploration references, not a global register or file-write authority. Source navigation/history is #84 and formal lifecycle #85. Existing records without the field remain valid.
- Update only an explicitly selected recorded managed proposed draft whose actual regular file identity, marker and exact hash match. Show full old/new Markdown and require review again if any byte or identity changes. Preserve the original path and managed ID on update; approved/accepted replacement remains outside scope.
- Capture existing ancestor identities without creating project directories at preview. Confirm creates missing parents one at a time with checks. Stage complete UTF-8 bytes, revalidate fresh root/parents/target and source guard immediately before atomic link/rename. Never relax ordinary symlink/hardlink checks.
- Persist one private confirmed operation intent per journey before publication, including exact new bytes, captured root/ancestors, old target fingerprint, association intent and source digest. A pending intent prevents a new write from hiding unfinished work. Journal size at most 256 KiB; bounded strict UTF-8/JSON/schema; no private answer drafts.
- Record owned staging path and physical identity before publication. A crash after a new-file hard link but before temporary cleanup can leave nlink=2; recovery may remove only the verified matching owned staging link, not arbitrary links. Unverified orphan staging files remain preserved evidence. Unsupported atomic-link filesystems fail closed.
- Recovery is explicit and idempotent. Classify actual bytes and association as unpublished, published/unassociated or complete, including errors after durable association/history commit. Before-publication retry requires the original source/readiness and target proof. After-publication reconciliation records the captured historical association while retaining newer answers/draft wording; conflicting association edits block. Never delete a published ADR to compensate for a later failure.
- Existing document locks and per-target owned locks serialize cooperative writers. Portable Node cannot guarantee safety against hostile concurrent ancestor swaps or provide a compare-and-swap rename against arbitrary external processes; document the same cooperative local filesystem boundary as existing storage.
- No browser/desktop automation. Keep narrow-pane controls, text-only rendering, focus and independent editors. Native visual/keyboard/IME checks remain pending owner verification.
- One issue-sized release commit, next version .96, full npm test/check/package, installed runtime metadata fixture, one independent whole-change review and one material fix pass if required. Keep ignored audit notes per earlier cleanup rejection; no tags/releases.

## Review focus

- A root/ancestor/target replaced with identical bytes must still invalidate a preview.
- A crash between hard-link publication and cleanup must be recoverable without accepting arbitrary hardlinks.
- A file may be saved while its association is not, or association may commit before its response fails; report actual state and never duplicate the file on retry.
- Imports and fresh clones provide relative references but never trusted absolute filesystem authority.
- Late prepare/status/save responses must not enable obsolete confirmation or replace independent connected editors; save outcome must remain discoverable after hiding/reloading.

### Task 1: Markdown and association contract

**Files:** new `com.github.copilot/extensions/explorer/adr-file.mjs`, `test/adr-file.test.mjs`; update `model.mjs` strict optional field.

**Interfaces:** `adrFileMarkdown(draft,id)` renders exact bounded proposed Markdown; `adrArtifactDigest(draft)` hashes canonical validated artifact; `validateAdrFiles(value)` validates bounded references; `associateAdrFile(existing,record,base)` returns a pure updated reference array with idempotence and conflict checks. Path/record validation is reusable by the writer.

- [x] Write tests for literal Unicode/control/size boundaries, template status omission and unspecified metadata, stable managed marker, strict association schema/duplicates/limits and personal/shared/history compatibility.
- [x] Run pure tests; missing module RED.
- [x] Implement the pure contract and model field, preserving old documents and unrecognized shared-field rejection.
- [x] Run pure plus ADR draft/readiness/shared-format tests; GREEN. Eight new pure/history cases; legacy hash-input ordering retained during valid serialization tests.

### Task 2: Guarded publication and durable intent

**Files:** new `adr-file-storage.mjs` and `test/adr-file-storage.test.mjs`; reuse ProjectContext, directoryState, projectDocumentAccess, owned-lock and storage patterns without broadening their existing contracts.

**Interfaces:** an ADR-specific storage owner captures/validates a target from fresh `readRoot`; reads/writes bounded private intents; stages and publishes with final asynchronous guard; reports actual publication state and cleans only proven owned staging links. Coordinator supplies current private directory and journey identity. Fault hooks exist as internal constructor dependencies for tests, never HTTP options.

- [x] Write RED tests for new/create collision, managed update base changes, identical-byte replacement, links and parents, missing/read-only/invalid destinations, bounded journal validation and every before/after publication failure boundary including staging-link crash state.
- [x] Implement identity-bound previews, one-at-a-time parent creation, per-target writer locks, no-clobber creation, guarded replacement and journal-backed inspection/retry.
- [x] Run focused filesystem tests; GREEN. Fifteen new cases include proven staging-link cleanup, replaced staging/extra-link refusal, update interruption and private-storage boundaries. Read-only failure is injected at publication; actual filesystem permission semantics remain platform-owned.

### Task 3: Reviewed controller/API and reconciliation

**Files:** new `adr-file-workflow.mjs`, `test/adr-file-workflow.test.mjs`; controller lifecycle/API method and protected server route.

**Interfaces:** dedicated `api/adr-file` supports strict status, prepare, cancel, save and reconcile requests. Prepare has client/sequence/journey and new/update selection; response includes expiring token, exact relative path/new bytes/old bytes, report and action description. Save consumes only token/revision; rechecks document/source/scenario and physical target. Status/reconcile expose actual publication and association outcome from private intent, never inferred success. Current journey/file/key bindings and response budgets remain strict.

- [x] Write RED workflow/HTTP tests for exact preview, no model/project writes before Save, readiness/source/scenario changes, schema/origin/limits, after-file and before/after-association failures, process-style reopen/retry, conflicting later associations and retained newer answers/drafts.
- [x] Implement queue/lock coordination, source and final guards, private recovery binding and idempotent association persistence using existing history commits.
- [x] Run workflow plus storage/pure/ADR readiness tests; expected GREEN.

### Task 4: Explicit save and recovery UI

**Files:** `web/index.html`, `web/app.mjs`, minimal existing CSS if needed, `test/web.test.mjs`.

**Interfaces:** entry from saved ADR wording/Tools opens an ADR file dialog. Choose new number or a recorded proposed update, preview exact path and complete Markdown, show before/after for updates, then explicit Save ADR. Recovery offers truthful file/association status and explicit retry/reconcile. Selection edits, source/scenario changes, hide/switch/suspend invalidate pending reviews; ordinary polling does not replace editors.

- [x] Write named RED tests for preview-before-save, new/update review, collisions/errors/recovery, late response lifecycle and independent question/ADR wording preservation.
- [x] Implement accessible narrow-pane dialog using text nodes/preformatted content; no browser or automatic Git/SDK actions.
- [x] Run named UI and neighboring ADR workflows; expected GREEN. Record native checks pending.

### Task 5: Runtime proof and publication

**Files:** installed runtime fixture as appropriate, docs/adr-files.md, ADR docs/README, plan and synchronized release metadata.

- [x] Exercise fresh actual installed metadata cwd changes and exact local ADR publication in a disposable fixture, with no paid inference or existing sessions.
- [x] Document relative references, explicit new/update actions, uncertainty, recovery phases and cooperative filesystem/format limits; bump .96 and add release note <=400 characters.
- [x] Obtain one independent whole-change review. Regrade and address material findings in one RED/GREEN fix pass; no re-review loop.
- [x] Run npm test/check/package and diff check plus installed runtime fixture; record actual evidence and use check as final task gate.
- [ ] Fetch, commit, integrate/push main without force; verify remote, comment/close #80 with validation and pending manual checks; continue #81.
