# ADR formatting conventions implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Explicitly select a safe repository ADR template and naming preferences, preview the supported structure, and retain portable formatting preferences without creating an ADR.

**Architecture:** `adr-format.mjs` owns the bounded parser, stored schema, deterministic renderer and filename proposal. `adr-format-review.mjs` owns separate template-specific reading and transient preview authority. Controller/HTTP use existing serialization, locks/history and safe revision checks. UI is an explicit Tools dialog.

**Tech stack:** Shipped ES modules, Node built-ins, existing HTTP and DOM UI. No new runtime dependency, template engine, model or SDK session.

**Spec:** GitHub #76, prerequisite #53 complete. Base release 0.1.91. Primary format reference: https://adr.github.io/madr/ and the 4.0.0 template repository.

## Global constraints

- Template selection is one explicit project-relative `.md` file, max240 path characters, max32KiB bytes, strict UTF-8 and text controls. Same default secret/hidden/traversal/link/hardlink/root identity protections as selected files; separate contract, never a permission for arbitrary excerpts.
- Reuse only ProjectContext's physical read/root checks and path validation. Do not call excerpt selection or pass raw template text to a model, native canvas context, saved map, history, exports or diagnostics. No ambient discovery, includes, evaluation or tools.
- Fresh attached-session metadata supplies the root. Defaults work without a project root. A selected template is rechecked before saving; saved configuration is not future file access authorization.
- Persist one optional `adrFormat` per journey: version1, relative directory, naming, digits, template kind/path/hash and derived layout. No absolute root, raw text, decision content or token.
- Support a documented Markdown subset: one title; known ordered section headings and optional known metadata keys. Preserve recognized labels/order. Reject unsupported structural headings and duplicate/conflicting declarations; ignore body guidance and examples. Required context/outcome sections; optional empty content is omitted, unknown required values explicit.
- Rendering takes explicit validated text content. Do not copy example decisions/status/dates/people from a template or invent them. Nonempty content cannot disappear because its section is absent; reject with correction guidance. Escape Markdown and preserve Unicode/newlines.
- Numbered or slug filenames; 2-6 digit minimum width, default4. A supplied positive number produces only a proposal. Collision/identity checks happen at #80 writing, never reserve now. No directory scanning or repository writes in this issue.
- One 10-minute single-use preview per controller, ordered client requests, cancel/close/switch invalidation, final document digest after asynchronous template validation. Revision and writer locking preserve concurrent corrections.
- UI preserves the connected answer editor and private drafts. Native narrow-pane/keyboard/IME checks pending owner; no browser automation. Release .92 with full checks, one final review, main push and remote verification.

## Review focus

- Template body instructions, examples and metadata values cannot become saved decisions, model instructions, tool authority or ambient project context.
- Invalid paths and overlarge files reject before content reads, and physically changed file/root identities reject without reading outside the selected current root.
- Missing sections/metadata never invent values or silently remove nonempty decision content.
- Stored format round trips preserve meaning while importing a relative reference never triggers an automatic file read.
- A late preview/save response or final asynchronous file check cannot overwrite newer map content or reactivate a cancelled preview.

### Task 1: Pure formatting contract

**Files:** create `com.github.copilot/extensions/explorer/adr-format.mjs`, `test/adr-format.test.mjs`; modify `model.mjs` optional-field validation.

**Interfaces:** `parseAdrTemplate(text)` returns strict layout; `defaultAdrFormat()` returns a fresh default config; `validateAdrFormat(value)` returns a bounded clone. `renderAdr(format, content)` returns Markdown from explicit known text fields; `adrFilename(format, title, number)` returns a relative filename proposal. `validateAdrSelection(value)` validates user directory/naming/digits/templatePath input. Defaults reference own minimal MADR-based headings, no copied prose.

- [x] Add failing tests for default/classic/minimal-MADR structure and faithful Unicode content, optional metadata/sections, ignored template directives, unsupported/duplicate headings, nonempty omitted content, size/type constraints, safe filenames and personal/shared round trips.
- [x] Run `node --test test/adr-format.test.mjs`. Expected missing feature failure.
- [x] Implement the pure contract and model field validation. Directory validation checks syntax only; final physical destination validation remains writer work.
- [x] Run `node --test test/adr-format.test.mjs test/adr-scope.test.mjs`. Expected all pass.

### Task 2: Explicit template reading and reviewed preferences save

**Files:** create `adr-format-review.mjs`, `test/adr-format-review.test.mjs`; modify `project-context.mjs` to export existing strict path validation only; wire controller reset/close and protected server route.

**Interfaces:** `AdrFormatReview(readRoot)` owns a separate physical reader and one preview; `.request(explorer,input)` actions status/prepare/save/cancel. Controller wraps transact; save uses withDocumentLock and commitCurrentLocked. Prepare input contains journey/clientId/sequence/selection; save contains journey/token/revision; cancel has journey/clientId/sequence. API `POST api/adr-format`, strict Origin/client header,16KiB body.

- [x] Write failing tests for explicit file selection/default without metadata, singlefile bounds/encoding/links/secrets/no scan, changed root/file/identity, status no reads, cancel/sequence/expiry/revision/purpose rejection, final async external correction and portable config without source text. Include normal Project writer-lock save/reopen coverage.
- [x] Run `node --test test/adr-format-review.test.mjs`. Expected unavailable endpoint/workflow.
- [x] Implement local read→parse→preview→explicit save. Response contains structure/hash and clearly labeled sample output only. Read bytes die after parsing; private capture contains root/file identity and hash. Final save rechecks file then rereads document digest before commit.
- [x] Run `node --test test/adr-format-review.test.mjs test/project-context.test.mjs test/adr-format.test.mjs`. Expected pass; old selected-excerpt behavior unchanged.

### Task 3: Explicit format UI and installed metadata fixture

**Files:** `web/app.mjs`, `web/index.html`, `web/style.css`, `test/web.test.mjs`, `scripts/e2e.mjs`.

**Interfaces:** Tools/Commands `ADR format`; directory, numbered/slug/digit selection, bundled/repository template and explicit path; Review template/Save preferences/Close. Status loads stored configuration without reading files. Changed controls cancel token, saved snapshot applies normal page/action ownership. Clear explanation of ignored template body, unverified directory and sample filename with no reservation.

- [x] Add failing jsdom workflows for review/save/reopen, no-file default, explicit file read, invalid selection recovery, draft/caret preservation, changed inputs, cancel/page suspension and delayed preview/save responses.
- [x] Run named ADR-format UI tests. Expected missing controls.
- [x] Implement UI using existing safe text nodes and narrow modal styles. No answer editing or model action.
- [x] Extend installed fixture to read only selected template from metadata cwd, reject changed cwd before save, and confirm body canary absent from portable/native context. Existing SDK declarations and callback inspected; no SDK changes planned.
- [x] Run named UI plus related ADRscope tests and installed local runtime fixture. Expected pass. Native visual behavior remains unverified.

### Task 4: Release

**Files:** docs/adr-format.md, README, plan, version manifests/lock and release-notes.

- [x] Document supported templates, mapping/omissions, separate path contract, limits, naming/writer collision responsibilities, untrusted data and compatibility. Cite official MADR.
- [x] Bump .91→.92 across all release files, add accurate ≤400-character release note.
- [x] One independent final whole-change review, material fixes RED/GREEN once, record declined scope/native checks and rulings.
- [x] Run full `npm test`, `npm run check`, `npm run package`, diffcheck and installed runtime fixture. Expected all pass.
- [ ] Commit this issue-sized release, fetch/integrate main without losing others' work, push and verify remote. Update issue with actual tests/pending native checks and close. Retain caller workspace for next issue and ignored audit notes.

Ruling: tasks are staged under one issue-sized release commit, so final reviewer must inspect working-tree changes and new files before the final commit; no empty committed-range review.

## Verification record

Full release suite: 1,039/1,039 passed. Check and package passed for v0.1.92. Installed local SDK fixture passed, including current-metadata template reading and rejection after the project root changes. Independent review found one JSON property-order bug; a personal/shared round-trip regression reproduced it and normalization fixed it. An existing research-review test assumed a helper would start after one event-loop turn; holding the asynchronous policy check reproduced the failure, and event-based waits fixed the fixture without changing production timing. All 13 focused research-review tests passed before the full green rerun. Native visual, keyboard, screen-reader, theme and IME checks remain pending owner verification. Publication and remote commit are recorded in issue #76.