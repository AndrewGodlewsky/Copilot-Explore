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

The owner subsequently confirmed v0.1.9 dictation works in the installed app. Automated checks alone do not establish live desktop key delivery, microphone permission, or speech quality.

## v0.1.10 controls and feedback

Explorer now keeps its own microphone/model preferences in `voice-settings.json` beside exploration files. Writes are atomic and revision checked. Shortcut and recording mode still come from the read-only Copilot record. The default is the system microphone and Copilot-selected model; choosing another input/model does not modify Copilot.

Microphones are enumerated with static `PvRecorder.getAvailableDevices()` in a disposable helper; no recorder is constructed for enumeration. The [Node API](https://github.com/Picovoice/pvrecorder/blob/main/binding/nodejs/README.md#usage) exposes names and current indices, not persistent OS identifiers. Explorer saves a name and resolves it again before capture. Missing or duplicate names fail visibly. Read-only enumeration on this machine found two distinct inputs.

The downloaded inventory scans existing model package directories for `genai_config.json` and `inference_model.json`, retaining speech formats only. Recognized Nemotron packages must also have nonempty encoder/decoder/joiner graphs and external weights, tokenizer/vocabulary files, and the configured VAD graph. Missing assets or unfamiliar packaging disable the choice; this presence check does not prove file integrity. Cached online catalog entries are not evidence of a download. The inspected Copilot voice worker and [GenAI streaming processor](https://github.com/microsoft/onnxruntime-genai/blob/v0.18.0/src/models/preprocessing/streaming_processor.cpp#L118-L130) support the Nemotron PCM path. Recognized CPU metadata variants are:

| Model | Variant | Verification |
| --- | --- | --- |
| Nemotron English | `nemotron-speech-streaming-en-0.6b-generic-cpu` | Downloaded version 3, synthetic transcription and owner-confirmed v0.1.9 live dictation |
| Nemotron Spanish | `nemotron-speech-streaming-es-0.6b-ft-generic-cpu` | Installed worker and upstream source inspection; weights not exercised |
| Nemotron 3.5 Multilingual | `nemotron-3.5-asr-streaming-0.6b-generic-cpu` | Installed worker and upstream source inspection; weights not exercised |

Only English is downloaded on this machine. The host catalog contains more speech entries, which are intentionally absent from the picker. Downloaded Whisper and Parakeet formats remain visible but disabled because they need a different inference path. Language hints are passed only for the multilingual family: [Foundry's audio session](https://github.com/microsoft/Foundry-Local/blob/main/sdk_v2/cpp/src/inferencing/generative/audio/audio_session.cc) translates language options, and [GenAI's Nemotron model](https://github.com/microsoft/onnxruntime-genai/blob/v0.18.0/src/models/nemotron_speech.cpp#L488-L494) only has that input when declared by the model. The downloaded English config has no language input.

While listening, the helper computes RMS loudness from each 100 ms PCM frame, maps −60 to 0 dBFS onto a bounded 0–1 value, and sends only that scalar to the server. The server retains 24 recent measurements. The UI polls every 200 ms and displays those levels plus elapsed recording time; silence is flat. Loading and transcription use an indeterminate indicator, with text and reduced-motion support. No partial transcript is claimed.

Automated coverage includes preferences/revision conflicts, unavailable devices, duplicate names, unsupported models, HTTP authorization, level bounds/history, UI save/refresh, retained settings drafts, and all bar phases. Device enumeration and synthetic audio do not open a microphone. The new controls' visual appearance, alternate device capture, and additional model families remain manual acceptance checks.

## v0.1.26 continuous dictation and recoverable transport chunks

Rechecked the installed components on November 17, 2026. Foundry 2.2.1 declares `speechSegment.kind` as `none`, `partial` or `final`, but declarations alone do not establish the selected model's behavior. The downloaded Nemotron English CPU v3 produced 45 `none` token fragments during a probe containing two identical synthetic sentences, each followed by five seconds of silence. All fragments arrived while the input queue was open; no final utterance, timestamp or `utteranceStart` marker appeared. The terminal aggregate exactly matched concatenated tokens. The [Foundry implementation](https://raw.githubusercontent.com/microsoft/Foundry-Local/main/sdk_v2/cpp/src/inferencing/generative/audio/audio_session.cc) deliberately emits NONE for this model's decoded tokens and builds its aggregate by concatenating them. Its PARTIAL/FINAL support remains a future model capability.

Explorer therefore transports immutable token text through one continuously loaded `AudioSession` and live `ItemQueue`. It groups text at 512 UTF-16 characters or roughly one second, preserving surrogate pairs, repeated words and all token spacing. These are transport records, not speech or silence boundaries. It rejects mixed hypothesis semantics and verifies exact equality with the final aggregate; mismatch reports failure and preserves accepted draft text. It never appends the aggregate a second time or rewrites transcripts with another model.

The helper assigns each record a monotonic sequence. The service retains one unacknowledged record, and the browser inserts it only into the recording's original span after checking its current context, value and caret. Its own insert advances those expectations. The existing `DraftClient.flush` must acknowledge the local revision before the browser acknowledges that sequence. Duplicate polling cannot repeat an insertion. Save failure leaves text visible with the usual draft recovery controls, stops capture and does not claim it was saved. Stop drains captured audio; Cancel keeps earlier inserts and cancels remaining work. Neither operation commits an answer.

| Resource or deadline | Bound and outcome |
| --- | --- |
| Recording | 600,000 ms / 10 minutes; explicitly stop and drain |
| No decoded-text progress | 180,000 ms / 3 minutes, including silence; explicitly stop and drain |
| PCM input | 16 kHz mono PCM16, 100 ms / 3,200-byte items |
| Native input backlog | 50 items / 5 seconds; explicitly stop capture and drain |
| Pinned queue PCM | 19,200,000 bytes for the queue lifetime; buffers remain pinned even after consumption |
| Recorder circular buffer | 50 frames / 160,000 bytes; independent of the queue |
| Capture delivery stall | At least 4,000 ms; fail with potentially incomplete audio |
| Unacknowledged text | One record; at most 4,096 UTF-16 characters across the record and buffered token text |
| Draft acknowledgment | 5,000 ms; stop on failure or timeout |
| Transcript and complete answer | 20,000 UTF-16 characters; reject exceeding text without truncation |
| Loading / finishing | 60,000 ms / 45,000 ms |
| Canvas heartbeat | 5,000 ms; release the owned worker on connection loss |

These PCM bounds do not cap total process RAM, model weights, native decoder state or SDK bookkeeping. PvRecorder exposes overflow debug logging but no dropped-frame counter; the stall guard does not detect every hardware drop. Its asynchronous wrapper calls native read on a timer, so a long read/delivery delay must not be reported as complete audio. Native resources and the owned catalog are released on completion, errors or worker termination. Audio remains memory-only in the product; the existing native Foundry operational-telemetry caveat still applies.

The shipped worker's synthetic smoke passed with 17.73 seconds of test PCM under Node and the installed Copilot executable, each yielding eight ordered text chunks and exact native aggregate equality. The fixture used an already-installed offline Windows speech synthesizer solely to create temporary test audio, which is separate from production microphone handling. Deterministic tests cover a simulated ten minutes, queue/text bounds, Unicode token splits, repeated words, aggregate mismatch, cancellation, deadlines and recoverable draft failures. They do not establish real microphone quality, every hardware dropout, additional model-family behavior or visible desktop rendering.
