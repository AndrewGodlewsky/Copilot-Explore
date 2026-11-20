# Explicit project context scope (#111)

The owner selected an owned, isolated, tool-free helper for project-aware questions. Ordinary questions remain queued in the attached chat. This updates the previous Challenge Review-only project-input contract without granting other operations access.

## Design and scope

Deliver #111's scope approval separately from discovery (#112), reviewed brief (#113) and question grounding (#114). A **Use project context** control opens a small scope dialog using existing dialog styling. It shows the current local project, purpose, explicitly entered relative files, limits and a review/confirm step. Off is the default. Scope approval reads file metadata only, never contents or model inputs. It does not claim project-aware questions are already available: active status says **Scope ready; project brief required**, and ordinary generation continues unchanged until the later issue connects the approved brief.

The approval is transient and bound to this controller instance, current journey and freshly resolved working-root identity. A one-use, ten-minute preview token binds the exact purpose, file names and metadata. A fresh root check and stat comparison reject changed roots/files before approval. Status invalidates stale approval; disabling discards preview/approval. No scope enters native snapshots, saved maps, diagnostics or exports. Existing Challenge Review has a distinct token/store. Files are never read by status or scope approval.

Use existing ProjectContext path/root/file metadata validation and conservative exclusions; require one to five files within current byte limits. Do not introduce a general permission service, dependencies, provider or background scanner. Missing/remote project metadata produces an understandable unavailable state while ordinary exploration works.

The dialog keeps editable paths intact on errors, invalidates the preview on edits, safely ignores late replies after close/journey switch/suspension, returns focus on close, and contains content at narrow/short viewport sizes. Status and purpose remain visible when active. Enabling scope cannot invoke any model helper or send excerpts anywhere.

## Implementation sequence

1. Record owner routing approval on #111 and correct #114's obsolete attached-chat requirement for project-aware generation. Update AGENTS and integration/project-context docs in this iteration.
2. Add failing workflow/controller/HTTP tests for default off, exact purpose/token binding, root/session/journey changes, expiry/replay, conservative paths/limits, no content reads, and native/export exclusion.
3. Implement the transient scope workflow and guarded loopback API, with controller lifecycle cleanup. Use fresh metadata root checks on prepare/approve/status; metadata failures never imply approval.
4. Add the dialog/control with request identity, focus, edit and suspension guards. Test actual client interaction and extend the existing authorized Brave geometry fixture.
5. Synchronize v0.1.124 and accurate release notes. Obtain one independent review. Run focused checks, installed SDK fixture for fresh-root boundaries, frozen test/check/e2e/Brave gates, and verify package contents.
6. Fetch, commit, integrate without discarding others' work, push main without force, verify remote SHA, update #111 and proceed to #112. Record remaining native/quality limitations and measured usage availability.

## Verification boundaries

Synthetic local and installed-runtime fixtures use no paid provider or existing user session. Scope approval is not evidence that project-aware questions have run, and it does not resolve native-log privacy (#41), transport enforcement (#42), native Research acceptance (#91) or actual quality evaluation (#110). Actual project-aware helper execution is deliberately introduced with the reviewed brief/question steps, not this metadata-only scope step.
