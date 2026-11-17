# Diagnostics and support export (0.1.40)

Open **Map settings > Diagnostics**. Opening reads prerequisites once; repeated reads use that observation until **Retry checks**. No recording, model loading, inference, authentication prompt, settings write, model download, tool initialization or helper session creation occurs. The routes and service stay private to the instance. Native `snapshot()` and ordinary conditional map polling are unchanged.

The installed SDK's `model.getCurrent()` supplies the selected model, `model.list({refresh:false})` requests its catalog without forcing refresh, and `gitHubAuth.getStatus()` supplies authentication status. Only categorical prerequisites leave the canvas adapter. This does not promise future provider access, entitlement, managed policy, tool availability or isolation. Actual helper startup retains all existing account/model/tool/workspace validation. The desktop runtime/bootstrap and installed SDK constructor/connection capabilities are checked without starting them. This installed SDK has no public runtime protocol-version export, so protocol is unknown (`null`), despite a declaration naming protocol 3. The installed CLI declaration's `0.0.0-dev` is a build stub, so desktop application version is **unknown**; cache directory names are not version evidence.

Voice inspection uses existing selected preferences, read-only host voice settings, inspected native ABI versions/DLL hashes, known downloaded speech package metadata/asset existence and device enumeration. Device enumeration uses the existing bounded child worker without opening capture. Known incomplete model assets are unavailable; incompatible formats are unsupported. Failed model metadata discovery retains only `inspection-failed`; an unresolved selected model then stays unknown. The first recorded speech inspection error takes precedence: a later microphone failure cannot erase discovery uncertainty. Microphone readiness is reported independently; device-only failures retain `device-unavailable`. Missing packages remain unavailable, and explicitly non-speech packages are ignored. Other readable model choices remain usable. Found assets do not establish model loadability. Device discovery does not establish permission or live capture. Both remain unknown. Successful native component compatibility checks are cached for this process's lifetime; Retry does not re-hash a previously cached component. Restart Explorer after a host component update.

`ready` means the stated prerequisite was observed; `unsupported` means the inspected combination/API is not supported; `unavailable` means a necessary prerequisite is missing or blocked; `unknown` means no supported conclusion was established. Unknown errors are never treated as ready. Use Voice settings beside an expanded answer for device/model selection, Copilot settings for sign-in/chat model/downloads, or Recovery for saved versions and retained operation evidence. Explorer does not change host settings or download replacements.

Current `unconfirmedResearchRelease` and `unconfirmedToolFreeRelease` markers always override successful prerequisites, including on export after an earlier cached read. A closed controller is unavailable. `no-current-blocker` means only that this controller has no unresolved-release marker; it makes no claim about an older worker. Dismissing recovery notices never changes these markers. Diagnostics projects current save/export observations; it does not scan old journals, infer worker release from request completion, or replace the separate Recovery inspection. An HTTP export response cannot prove the browser saved a file.

## Read and response limits

- One actual inspection per instance may be in flight. A 12-second response deadline yields unknown observations but retains ownership until the source promises settle. Repeated retries cannot accumulate uncancellable RPC or filesystem work. Late results from an expired pass are discarded; a subsequent explicit retry may start only after actual settlement. There is no inference retry.
- Voice preferences use a fixed 4,097-byte buffer (4 KiB accepted); installed package/model JSON uses fixed 65,537-byte buffers (64 KiB accepted). Stat checks precede reads and growth past the limit is rejected. The read-only SQLite query returns the voice-settings value only when its blob length is at most 64 KiB.
- Model traversal allows 500 total directory entries over the existing publisher/model/version depth, including non-directory entries; linked directories are skipped. Native dependency traversal allows 500 entries and at most 512 MiB cumulative streamed DLL hashing per uncached attempt. Each model checks only the existing allowlisted asset filenames; no audio or model weights are read.
- Catalog processing refuses lists above 500 entries. RPC response transport allocation belongs to the installed host/SDK; Explorer does not claim its deadline limits that transport's allocation. Device enumeration keeps the existing eight-second child-worker deadline and 100-device output limit.
- GET `api/diagnostics` reads the cached pass; POST `api/diagnostics` accepts exactly `{"action":"retry"}`. POST `api/support` accepts exactly `{}` and no client diagnostic values. POSTs require exact instance Origin, `X-Explorer-Client: 1`, JSON content type, and at most 1 KiB. All routes require loopback Host and the existing capability-token prefix. UI requests have a 15-second abort deadline and reject late replies after close/page hide.
- Support serialization is capped at 4 KiB and downloads with the fixed filename `explorer-support.json`. The UI reports failed requests or browser download initiation safely, without echoing raw exceptions or paths. It cannot observe durable browser file saving.

## Strict support schema, version 1

The server constructs each field independently. It never dumps an object and redacts it. Unknown/extra input fields, nested objects, identifiers, errors and stacks are omitted. The following keys are exhaustive; every object has no additional properties. `state` below is exactly `ready | unsupported | unavailable | unknown`.

| Field | Accepted output |
| --- | --- |
| `schemaVersion` | Constant `1` |
| `pluginVersion` | Numeric major.minor.patch, each component 1–5 digits; otherwise `unknown` |
| `desktopVersion` | Constant `unknown` |
| `host.runtime`, `host.sdk`, `host.account`, `host.model` | state |
| `host.protocol` | Integer 1–999, otherwise `null` |
| `speech.runtime`, `speech.model`, `speech.microphone` | state |
| `speech.loadability`, `speech.capture` | Constant `unknown` |
| `speech.modelCount`, `speech.deviceCount` | Integers 0–500; invalid inputs become 0 and larger counts clamp to 500. Zero during an unknown inspection does not prove absence. |
| `speech.error` | `none | source-limit | device-unavailable | inspection-failed`; arbitrary exceptions become `inspection-failed` |
| `helpers.research`, `helpers.toolFree` | state |
| `helpers.researchRelease`, `helpers.toolFreeRelease` | `unconfirmed | no-current-blocker | unknown` |
| `helpers.execution` | Constant `unknown` |
| `recovery.save` | `failed | committed | unknown` |
| `recovery.export` | `active | failed | interrupted | response-finished | unknown` |

Never included: tokens or capability URLs; accounts, sessions, request/document IDs; topics, questions, answers, prompts or drafts; source URLs; audio/model contents; usernames/home paths; precise device names; arbitrary error strings/stacks or logs. The dialog previews these categories before the explicit export action. No background upload exists.

Unit, HTTP and shipped jsdom fixtures test strict field projection with hostile multiline canaries, source limits, uncertainty, explicit retry, timeout ownership/late results, download failure and draft preservation. Installed runtime fixtures use disposable homes and local providers only. They do not establish visible native rendering, actual microphone access, live model loadability or live provider quality; those remain owner checks.
