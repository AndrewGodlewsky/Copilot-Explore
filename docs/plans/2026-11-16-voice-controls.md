# Voice settings and feedback implementation plan

The owner confirmed v0.1.9 live dictation works. Add the Mermaid architecture explanation to README, local microphone/downloaded-model settings, and clear animated feedback during dictation.

## Design

Keep the existing expanded answer node and palette. Place a quiet Voice settings disclosure under the voice status. Use labeled native selects, Save voice settings and Refresh devices/models. Save Explorer-only preferences next to exploration files, with revision checks and atomic writes. Continue reading the shortcut/recording mode from Copilot. Default to the system microphone and Copilot-selected model. Resolve a named microphone again at capture time; never fall back silently if it disappeared or became ambiguous.

List actual model directories, not cached catalog entries. Enable the inspected Nemotron English, Spanish and multilingual CPU families using the existing PCM pipeline. Mark other downloaded speech formats unavailable. No model downloads or host settings edits. Only English is downloaded locally, so other families have source-level compatibility evidence but remain untested with live weights.

Show Loading, Listening and Transcribing in a compact bar attached to the answer. Listening displays recent real microphone levels and elapsed time; idle/silence must not fabricate activity. Loading/transcription use an indeterminate indicator, never a made-up percentage. Preserve reduced-motion behavior and textual status for screen readers. All existing cancellation/draft safeguards remain.

## Steps and checks

- [x] Add tests for saved preferences/revisions, downloaded inventory, named-device resolution, and level measurement/forwarding; then implement settings/inventory, worker enumeration and capture telemetry.
- [x] Add DOM tests for settings save/refresh, missing options, and idle/loading/listening/transcribing meter states; implement controls within the existing answer form and responsive CSS.
- [x] Add/update README Mermaid diagram, user guide, compatibility evidence, version/release notes. Run unit/DOM checks, installed runtime fixture and native enumeration/synthetic audio without recording a microphone.
- [x] Review the whole change and fix findings. Package, commit, integrate and push main under the standing AGENTS.md release workflow after the final checks; verify the published hash. Live appearance and alternate microphone/model behavior remain manual checks.

## Decisions

- Prefer a local disclosure over a separate settings page: choices stay beside the answer and avoid another navigation surface.
- Prefer measured audio levels over looping waveform decoration: silence and a disconnected/quiet microphone must remain distinguishable from input.
- Reuse installed libraries and the existing isolated helper. Enumerating microphones does not construct a recorder or start capture.

## Verification and review record

The new settings/meter DOM tests failed before implementation, then passed with the existing dictation tests. The complete suite passed 43 tests, syntax/version checks and the installed SDK/runtime fixture. Read-only enumeration found two named microphones and one downloaded English model. Synthetic spoken PCM returned the complete sentence under ordinary Node and Copilot's SEA runtime without opening a microphone. README Mermaid grammar and relative links passed using the installed parser, without browser automation.

The independent final review found no major issues and one incomplete-download concern. Regraded that concern as important for a picker promising usable local choices: a regression test demonstrated missing external weights remained selectable, then passed after checking the known package's graph, weight, tokenizer and VAD assets. This is a presence check, not model-integrity verification; unfamiliar package layouts remain unavailable until inspected. No review findings were deferred.

Visual rendering, live alternate-device capture, and Spanish/multilingual quality were outside automated verification because the owner prohibits UI automation and only English weights are installed. These remain explicit manual acceptance checks, not assumed successes.
