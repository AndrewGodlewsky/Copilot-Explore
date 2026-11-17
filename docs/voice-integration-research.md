# Local dictation in Explorer

Investigated November 16, 2026 against GitHub Copilot desktop 1.4.2, its installed SDK/runtime, and primary upstream sources.

## Correction and root cause

The v0.1.8 claim that native dictation already entered Explorer was incorrect. The owner clarified that Ctrl+Space works in the main chat composer but **does not work with Explorer's answer focused**. An earlier response had been misinterpreted; it was not successful manual verification.

Read-only inspection of the installed frontend establishes why. Its composer voice bridge tracks an active editable element and recording controls. The dictation feature registers the main composer and checks its focus before starting. Explorer's separate canvas does not register with that bridge. Native transcription commands are private application commands, not a guest-canvas API.

GitHub's [voice guide](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions#using-voice-dictation) documents local setup and prompt-box insertion. It does not promise arbitrary canvas input support. The installed `extension.d.ts`, `canvas.d.ts`, and `types.d.ts` expose no voice service, shortcut query, or transcription callback. Public [canvas](https://github.com/microsoft/copilot-sdk/blob/bc4f9a19d190021c27554d3c1d95121ab61e8d43/nodejs/src/canvas.ts) and [extension](https://github.com/microsoft/copilot-sdk/blob/bc4f9a19d190021c27554d3c1d95121ab61e8d43/nodejs/src/extension.ts) sources agree with that bounded audit.

## Installed evidence

Only relevant configuration and assets were inspected. No host configuration or database was edited, and no microphone was opened during investigation.

| Component | Finding |
| --- | --- |
| Settings | `~/.copilot/data.db`, `app_state` record `voice-mode-settings`, version 1. Tested settings: physical `ctrl+Space`, `push_to_talk`, default microphone, Nemotron English. |
| Model | Existing CPU assets under `~/.github-copilot-cli/cache/models/Microsoft/`; configuration type `nemotron_speech`. Desktop Foundry app name: `github-copilot-cli`. |
| Components | Copilot's support package includes Foundry SDK 2.2.1 and PvRecorder 1.2.9. The SDK and desktop `foundry_local.dll` hashes match. Discovery checks both versions and hash equality. |
| Bridge | Installed `composerVoiceBridgeStore`, `voiceState`, and `voice-dictation` assets tie capture to composer controls. `voiceTranscriptionSession` invokes native commands and session-tagged events. The canvas SDK exposes none of this. |

These settings and paths are implementation details, not a GitHub compatibility promise. Explorer reports unsupported configurations; it does not patch the desktop or invoke private Tauri commands.

## v0.1.9 adapter

Explorer reads the configured shortcut and downloaded model metadata. A shortcut press inside the focused answer starts an isolated helper using the compatible installed SDK and native libraries. The helper registers existing weights in an Explorer-owned temporary **local catalog**, as Microsoft's [real-model fixture](https://github.com/microsoft/Foundry-Local/blob/main/sdk_v2/js/test/_fixtures/realModelManager.ts) does. It never downloads or copies model weights or writes host settings.

The helper loads the model, then captures the default microphone. **Listening** marks when to speak. Releasing during loading cancels startup. Push-to-talk finishes on release of the main key or a required modifier; toggle mode uses a second press. Capture stops before transcription. Audio stays in memory; no audio file is retained.

Escape, focus loss, edits, navigation, closure, a lost five-second heartbeat, and timeouts cancel capture. Recording is limited to two minutes. Only a matching document, node, and unchanged draft receives the result at the captured selection. Dictation never saves or submits an answer.

Transcription uses public `AudioSession`, `Request`, `ItemQueue`, and final `speechResult` APIs, following Microsoft's [Nemotron tests](https://github.com/microsoft/Foundry-Local/blob/main/sdk_v2/js/test/audio-session.test.ts). PCM is divided into 100 ms frames. The initial synthetic test truncated a sentence when sent as one large item: GenAI 0.18.0 processes one model chunk per call and trims excess buffered audio during flush. [Native implementation](https://github.com/microsoft/onnxruntime-genai/blob/v0.18.0/src/models/preprocessing/nemotron_streaming_processor.cpp#L101-L137). Frame normalization produced the complete synthetic sentence: “Our neighbors can borrow tools from the community library”.

The adapter avoids public-catalog discovery, which can refresh metadata online. Local registration references existing assets. Foundry initialization can emit operational telemetry even with `disableNonessentialTelemetry`; the native library is not guaranteed network-silent. Audio is processed locally and is not sent to the attached agent for transcription.

## Compatibility and verification

The first adapter supports Windows x64, Nemotron English CPU, the default microphone, English/auto language, and physical-key shortcuts. Other models/devices/platforms or incompatible native libraries receive a visible explanation. Loading latency applies to each recording. Settings refresh when the answer gains focus; reopen Explorer after a Copilot native-component upgrade.

Automated tests cover configuration rejection, asynchronous cancellation, reordered requests, timeout/closure, HTTP authorization, shortcut matching, both recording modes, selection insertion, unsaved drafts, focus loss, edits, and stale results. The installed runtime fixture checks the shipped asset and clean unavailability in a disposable home.

Copilot runs extensions with its single-executable Node runtime. A normal `fork(worker)` would launch the CLI instead of that file. The adapter uses the installed extension bootstrap with the helper path and updated parent PID. The runtime fixture probes this exact nested launch without loading a model or microphone. Sandboxed extension sessions are explicitly unsupported; the adapter preserves their restrictions.

`node scripts/voice-smoke.mjs` runs the shipped helper with synthetic silence. An optional file argument accepts at most 30 seconds of raw PCM16 mono at 16 kHz, never microphone input. Synthetic spoken audio verified complete transcription using the existing model, both under Node and through Copilot's actual bundled runtime. No browser/desktop automation, microphone capture, model download, or paid inference was used.

These checks do not establish live desktop key delivery, microphone permission, device selection, or speech quality. Those remain the owner's manual acceptance check in the installed app.
