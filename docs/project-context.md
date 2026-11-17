# Selected project files

In **Challenge decisions**, enter relative paths and choose **Read / refresh selected files**. Review the exact excerpts and model input, then choose **Start reviewed challenge**. Selection starts empty each time. Saved answers are still required: files alone cannot start a challenge. File instructions are quoted untrusted data; they cannot grant permissions, select more files or become user decisions or verified evidence.

This feature is limited to the existing owned challenge helper with zero initialized tools. The reviewed excerpts go to the selected eligible Copilot model when the challenge starts. They are excluded from attached-session question generation, web research/follow-ups, cleanup, question help, ordinary answer checks, decision briefs, implementation handoffs, native map context, saved journeys, history, exports and diagnostics. The attached chat retains its own host-controlled permissions and conversation. No public-search disclosure enforcement is claimed.

## Selection and limits

The permitted root is the attached local session's current `rpc.metadata.snapshot().workingDirectory`, checked again during selection and freshness checks. `session.workspacePath` is an artifact directory and is never used as the project root. Missing/remote metadata disables file selection, while ordinary no-file challenges continue. No recursive discovery, indexing, ambient instructions or project writes occur.

| Bound | Limit |
| --- | --- |
| Selected regular files | 5 unique paths |
| Relative path | 240 UTF-16 code units, forward slashes |
| Source bytes | 64 KiB per file, 128 KiB selected total |
| UTF-8 prefix excerpt | 8 KiB per file, 32 KiB selected total |
| Actual instructions plus prompt | Existing 128 KiB UTF-8 ceiling |
| Review retention | One preview, 10-minute expiry |

Excerpts end on whole Unicode code points and show included/total byte counts. A complete file is decoded as strict UTF-8; binary/control content rejects. The source's full-file SHA-256 and excerpt SHA-256 are retained. Excerpt and aggregate limits reject excess selection rather than silently dropping a file. Normal optional saved-answer context can still be omitted by the existing budget; the exact preview reports those omissions.

Allowed extensions are md, txt, rst, adoc, json, yaml, yml, toml, xml, csv, tsv, js, mjs, cjs, jsx, ts, tsx, css, html, py, rb, go, rs, java, c, h, cpp, hpp, cs, swift, kt, sql, sh and ps1. Hidden paths, traversal, absolute/device/stream syntax, Windows reserved names, trailing dots/spaces and secret-name defaults reject before content reads. Secret defaults include env, auth/oauth, API keys, service accounts, keys, secrets, credentials, passwords, tokens, private and standard SSH identity names. This conservative filename filter cannot identify every secret inside otherwise permitted text; review what you select.

Links/junctions, hardlinks, nonregular files and unknown file identities reject. Ancestors/canonical paths and bigint file identities are checked before opening; handle identity is checked before content reads. Reads are length-bounded even if a file grows. Root, ancestors and file identity/stats are checked around reads. This is the repository's cooperative local-filesystem boundary: it detects observed replacement, but portable Node on Windows cannot atomically bind every ancestor against a malicious concurrent directory swap. UNC roots are unsupported.

## Freshness and retention

Public source fields are `{id,name,fingerprint,excerptFingerprint,bytes,excerptBytes,truncated,excerpt}`. IDs remain stable for the same path during explicit refresh within a review; names are relative. Internal root/file identity and absolute root remain private to the reader/request owner. No root/home path is added to portable data or diagnostics.

Ordinary context refresh and answer exclusions retain the reviewed file snapshot. Changed, missing, renamed or replaced sources/roots mark that snapshot stale; only explicit file refresh can replace its bytes and issue a new preview. Start and queued dispatch verify the full selected sources, and completion rechecks them. Later result polling uses bounded metadata/root/stat checks without full content rereads. This detects ordinary edits and replacements; it is not a filesystem watcher or a claim to detect hostile metadata spoofing. The UI source disclosure shows the original reviewed excerpt, relative name, ID, full hash and observed freshness.

Browser sequence, client, journey and one-use review-token ownership reject stale replies and mismatched starts. Preview cancel/close, expiry, journey switch or canvas close discards selected preview content. A running/completed challenge owns its captured sources until cancellation, replacement, journey switch or canvas close; hiding the result dialog alone retains that transient result. Panel reload requests cancellation best-effort; if delivery fails, captures may remain in the canvas controller until replacement, successful cancellation or canvas close. Stale results stop exposing findings. A running helper may retain already captured strings until it actually stops. Failure to reconcile native helper usage can preserve a recovery journal under the existing helper policy.

Explorer does not persist these excerpts or references in its map/exports/diagnostics or reuse them in later operations. **Native SDK helper journals/logs may retain prompts/results.** Tool-free does not mean offline, and strict native-log privacy remains unresolved (#41). Full network transport enforcement (#42) also remains unresolved. This feature does not claim either guarantee.

Local tests cover actual read boundaries, traversal/links/encoding/size, freshness, HTTP/UI selection and source canaries. Installed local fixtures verify metadata working-root selection and exact zero-tool helper strings without a paid provider or existing session. Native narrow-pane/keyboard rendering and live model usefulness remain owner checks.
