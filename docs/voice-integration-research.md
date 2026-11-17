# Host voice dictation and Explorer

Checked November 16, 2026 using public primary sources and the owner's manual test. This note concerns the **GitHub Copilot app**, Explorer's desktop host. Microsoft Copilot Studio is a separate low-code agent/workflow product; its voice channels are not evidence of a GitHub canvas API. [GitHub app](https://github.com/github/app), [Copilot Studio overview](https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-what-is-copilot-studio).

## Finding

**Native dictation already works in Explorer on the owner's tested installation.** The owner focused Explorer's answer box, used their usual Copilot voice shortcut, and confirmed that the transcription entered that answer box directly. This manual observation establishes the desired behavior locally; it is not a cross-version API guarantee.

Explorer therefore needs no separate recording flow, shortcut, transcription model, or model-download detection for this use. Voice setup remains in the host. The absence of a documented plugin voice API does not prevent the host from inserting text into a focused canvas field.

## What the host supports

| Evidence | What it establishes | Limit |
| --- | --- | --- |
| [App session guide: voice dictation](https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions#using-voice-dictation) | Setup uses Settings > Voice dictation, a chosen shortcut, OS microphone permission, and a downloaded local transcription model. It documents prompt-box insertion before submission. | Its prompt-box example does not establish that canvas fields are unsupported; the owner's test confirms Explorer field insertion locally. |
| [App v0.2.13 release](https://github.com/github/app/releases/tag/v0.2.13) | The feature introduced local capture, composer insertion, push-to-talk or toggle modes, microphone selection, and local model management. | Historical feature introduction; does not name a universal default shortcut. |
| [App v1.1.30 release](https://github.com/github/app/releases/tag/v1.1.30) | Recording continues when the user clicks a canvas or browser preview. | Continued recording is not evidence that its destination changes to that canvas. |
| [App changelog, v1.1.24 and v1.2.0](https://github.com/github/app/blob/eb1ca2573ebfb00d41cd0fc413cb32261bdf3827/changelog.md) | Dictation became enabled by default; a later release added a downloadable multilingual model and language selection. | No extension-facing voice API is described. |

The [CLI voice guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/voice-input) separately documents local transcription, `/voice`, `/voice models`, `/voice devices`, hold-Space input, and Ctrl+X then V toggling. These are interactive CLI controls. They should not be presented as desktop canvas bindings or as a supported transcription service for Explorer.

## Extension contract inspected

Local inspection also covered the installed desktop SDK and its paired runtime `1.0.106-8.unstable.r43566476370.g869eef3`. Their `extension.d.ts`, `canvas.d.ts`, and `types.d.ts` declare no voice, dictation, speech-recognition, transcription, or voice-shortcut API. This says nothing about native field insertion, which the owner's manual check confirmed. Explorer already treats answer-field input as a draft through its ordinary `input` listener in [the shipped app](../com.github.copilot/extensions/explorer/web/app.mjs).

GitHub's [extension tutorial](https://docs.github.com/en/copilot/tutorials/create-an-extension) uses the bundled `@github/copilot-sdk/extension`, with `joinSession()` attaching a separate extension process. The public repository currently redirects from `github/copilot-sdk` to `microsoft/copilot-sdk`, whose current documents use `@microsoft/copilot-sdk`. This discrepancy is a reason to use the installed host declarations for implementation, not to change Explorer's imports from web examples.

The following public source was inspected at SDK commit `bc4f9a19d190021c27554d3c1d95121ab61e8d43`:

- [`extension.ts`](https://github.com/microsoft/copilot-sdk/blob/bc4f9a19d190021c27554d3c1d95121ab61e8d43/nodejs/src/extension.ts) exports `joinSession()` and canvas construction/types; it does not export a voice service.
- [`canvas.ts`](https://github.com/microsoft/copilot-sdk/blob/bc4f9a19d190021c27554d3c1d95121ab61e8d43/nodejs/src/canvas.ts) exposes `createCanvas()`, open/close handling, and declared agent-callable actions. These lifecycle/action callbacks are not recording or dictation callbacks.
- [`generated/rpc.ts`](https://github.com/microsoft/copilot-sdk/blob/bc4f9a19d190021c27554d3c1d95121ab61e8d43/nodejs/src/generated/rpc.ts) defines `CanvasHostContextCapabilities` with `canvases?: boolean`, and `CanvasProviderOpenResult` with `url`, `title`, and `status`. Neither supplies audio capability negotiation or a voice bridge.
- Searches of the full `canvas.ts`, `generated/rpc.ts`, and [`session.ts`](https://github.com/microsoft/copilot-sdk/blob/bc4f9a19d190021c27554d3c1d95121ab61e8d43/nodejs/src/session.ts) found no `voice`, `dictat`, `speech`, or `transcrib` matches. Matches for `transcript` concerned conversation history/recovery. This is a bounded source audit, not proof that private host facilities do not exist.

The public [extension examples](https://github.com/microsoft/copilot-sdk/blob/bc4f9a19d190021c27554d3c1d95121ab61e8d43/nodejs/docs/examples.md) include `onUserPromptSubmitted` and `session.send()`. Those operate on submitted chat messages; they do not provide an unsent dictation draft. Routing voice through submitted chat would be a different interaction with possible agent activity, not direct speech-to-text entry in Explorer.

## Decision and limits

Keep Explorer's ordinary editable answer field and use the host's configured voice shortcut. No Explorer voice implementation is needed for the confirmed workflow. The owner performed the manual check; no browser or desktop automation was used.

The inspected public contracts still provide no supported way for Explorer to query downloaded voice models, read the host shortcut, start recording, or subscribe to raw speech transcripts. Those capabilities are unnecessary for the working focus-and-dictate flow. Do not add undocumented IPC or personal-settings reads to detect them. Broader operating-system, host-version, and draft-preservation coverage was not tested here.
