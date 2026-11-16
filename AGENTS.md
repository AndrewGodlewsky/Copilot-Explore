# Working on Explorer

Explorer is a GitHub Copilot desktop plugin. `/explore` opens its native canvas. The shipped source is `com.github.copilot/extensions/explorer/`; there is no bundling step or npm runtime dependency. The root `plugin.json` uses Agent Plugins 1.0, and `.github/plugin/marketplace.json` publishes the catalog.

## Host integration

- Inspect the installed desktop SDK declarations before changing integration. Copilot supplies `@github/copilot-sdk/extension`; do not bundle, download, or substitute an npm SDK/runtime.
- Keep SDK wiring in `extension.mjs` and `canvas.mjs`, map rules in `model.mjs`, persistence/request coordination in `controller.mjs`, HTTP in `server.mjs`, and browser rendering in `web/`.
- Generation/research uses the attached session's `send({ mode: 'enqueue' })`. Never steer immediately, answer permissions, change the session's model, or send to another session. Canvas callbacks only fulfill an existing request; they cannot initiate a user operation.
- Match callback request IDs and instance/session identities. Preserve user answers; reject stale responses. Cancelling invalidates a result but cannot stop the attached chat turn.
- Use `metadata.snapshot().workingDirectory` if project reads are added; `session.workspacePath` is an artifact directory. Explorer currently reads no project context.
- Before introducing background model sessions, read [the SDK handoff](docs/copilot-integration.md#future-background-model-work). It requires account/model checks, isolation, cancellation, and retained usage receipts. Do not copy the other plugins' product identity or data directory.

## Data and UI

- Validate imported files and AI action payloads. Preserve Unicode and user text. Render user/AI content as text; only validated HTTP(S) URLs become links.
- Save atomically; serialize edits, check revisions, and protect documents against overlapping writers. A failed save must leave the last document recoverable.
- Bind HTTP to loopback, require the instance token, check Host and write Origin, limit request sizes, and serve only allowlisted assets.
- Keep sourced research distinct from model reasoning. Research suggests; only the user supplies an answer.
- Keep the panel usable in a narrow desktop side pane, with keyboard access and visible focus. Use flat-color SVG metadata assets.
- Respect the owner's global browser restriction: no browser/desktop UI automation without an explicit request. Ask the owner to do final visual checks. Use Brave if browser opening is authorized.

## Verification and installation

Run `npm test` and `npm run check`. `npm run e2e` uses the **installed** desktop SDK/runtime selected by `COPILOT_SDK_DIR` and `COPILOT_CLI_PATH`, a disposable Copilot home, and a local model fixture. Tests must never use a paid provider or an existing user session.

Install through Copilot's CLI. Do not hand-edit its databases or installed-plugin records. A local marketplace loads the checkout live; retain its directory and start a new session after edits. Normal distribution should use a cached GitHub marketplace install. Local installs may omit the native tab icon; see [integration notes](docs/copilot-integration.md).

For version changes, synchronize `package.json`, `plugin.json`, `.github/plugin/marketplace.json`, and the extension's `package.json`. Add a newest-first entry to `release-notes.json`, with a user-facing summary of at most 400 characters. The check script enforces this. Ship the full extension, panel, skill, and logo together.

Completion reports state the plugin version, checks actually run, whether it was installed or published, and pending manual verification. A passing runtime fixture does not prove visible desktop rendering or live research quality. Publishing, pushing, and releases require authorization in this project; the other repositories' automatic-push policy is not inherited.

These rules were adapted from the owner's Usage Insights and Enhance Prompt repositories. Rationale and source pointers live in [docs/copilot-integration.md](docs/copilot-integration.md).
