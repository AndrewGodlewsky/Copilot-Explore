# Explorer local dictation

The owner requires Copilot's configured voice shortcut to dictate into the expanded node's answer, using the model already downloaded in the desktop app. The earlier v0.1.8 claim that this worked automatically was incorrect.

## Design

Read only the desktop's versioned voice settings record and existing model metadata. The public canvas SDK has no dictation bridge. Use the installed, compatibility-checked Foundry SDK and desktop native libraries in a separate process, registering existing weights in an Explorer-owned temporary local catalog. Never download a model, modify host settings, or invoke the attached agent for dictation.

This first adapter supports Windows x64, the inspected Nemotron English CPU model, the default input device, and physical-key shortcuts. Unsupported configurations explain the limitation in the answer form. Recording starts only on an explicit shortcut inside the answer. Releasing it finishes push-to-talk; toggle mode uses a second press. Escape, focus loss, navigation, disconnect, or a two-minute limit cancels capture. A five-second heartbeat stops abandoned recordings. No audio files are retained.

Transcription is inserted into an unsaved draft at the captured selection. Concurrent edits, changed document/node, save, and navigation invalidate the result. Status appears immediately below the answer, including loading, listening, transcribing, errors, and the configured shortcut.

## Implementation and verification

1. Prove native local registration and inference using synthetic audio, with no microphone. Read installed SDK declarations and preserve the source model cache.
2. Add read-only discovery and a bounded recording service/helper. Test configuration rejection, cancellation during asynchronous startup, stale IDs, microphone lease expiry, finish, and server authorization.
3. Add browser keyboard binding and draft insertion. Test matching shortcuts, release of either key, repeated keydown, toggle, focus loss, cancellation, stale results, and answer limits using jsdom, without browser automation.
4. Correct research/README, bump all versions to 0.1.9, review the entire change, run tests/check/runtime fixture/package, and push main. Actual desktop microphone and focus behavior requires the owner's manual check.

## Evidence ledger

- Native local catalog registration references the existing v3 assets successfully.
- Synthetic one-second PCM silence completed with `finishReason: stop` and empty text, as expected. No microphone or model download used.
- Ruling: reuse installed compatible SDK components rather than a private desktop IPC bridge; the host does not expose that bridge to canvases.
- Ruling: reject unverified models/device IDs rather than silently switching the owner's configured model or microphone.
- Synthetic speech completed with the whole expected sentence after normalizing PCM into 100 ms frames; a large-item truncation was identified in GenAI 0.18.0.
- Review found default child-process fork incompatible with Copilot's bundled executable. The installed extension bootstrap now launches the helper; a nested runtime probe and full synthetic transcription through that executable both passed. Sandboxed execution is rejected without altering restrictions.
- Unit/DOM and installed runtime checks passed during implementation. Live microphone/key delivery remains explicitly unverified for the owner to check.
