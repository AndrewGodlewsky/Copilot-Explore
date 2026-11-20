# Working on Explorer

Explorer is a GitHub Copilot desktop plugin. `/explore` opens its native canvas. The shipped source is `com.github.copilot/extensions/explorer/`; there is no bundling step or npm runtime dependency. The root `plugin.json` uses Agent Plugins 1.0, and `.github/plugin/marketplace.json` publishes the catalog.

## Host integration

- Inspect the installed desktop SDK declarations before changing integration. Copilot supplies `@github/copilot-sdk/extension`; do not bundle, download, or substitute an npm SDK/runtime.
- Keep SDK wiring in `extension.mjs` and `canvas.mjs`, map rules in `model.mjs`, persistence/request coordination in `controller.mjs`, HTTP in `server.mjs`, and browser rendering in `web/`.
- Ordinary question generation uses the attached session's `send({ mode: 'enqueue' })`. The owner approved a separate owned, isolated, tool-free helper for project-aware questions, receiving only explicitly reviewed project context and map decisions. Never steer an existing chat immediately, answer its permissions, change its model, or send to another existing session. Research uses an owned isolated SDK helper in `research.mjs`; canvas callbacks cannot fulfill owned-helper work or initiate a user operation.
- Match callback request IDs and instance/session identities. Preserve user answers; reject stale responses. Cancelling ordinary questions invalidates the result but cannot stop the attached chat turn. Cancelling owned-helper work stops only its owned helper, retaining the existing account/model checks and usage receipts.
- Use fresh `rpc.metadata.snapshot().workingDirectory` for explicitly selected project files; `session.workspacePath` is an artifact directory. Project excerpts are transient, reviewed, untrusted inputs limited to owned tool-free Challenge Review and the explicitly reviewed project-question workflow. Each purpose needs its own review; a Challenge Review token cannot authorize questions. Explicit bounded discovery may inspect metadata and Git ignore policy; scope approval alone permits no content reads or inference. A separate one-use approved-scope read may capture bounded local excerpts, honoring ignore rules, explicit exclusions, cancellation and identity checks; project briefs require a separate exact-input review and explicit owned-helper start; their approval binds the capture and revision, with user assertions distinct from file evidence. Project-aware questions additionally require an approved brief. All other operations/exports omit project captures. Preserve default-secret exclusions, canonical path/identity checks and explicit-refresh freshness. Native-log privacy is not guaranteed; see [selected project context](docs/project-context.md).
- ADR template reading has a separate explicit single-file formatting contract. Retain only validated structure and relative reference/hash; discard body/examples/metadata values. Never treat a saved template reference as file-read permission or pass raw template text into model context. See [ADR formatting](docs/adr-format.md).
- Before changing background model sessions, read [the SDK handoff](docs/copilot-integration.md#background-model-work) and [research tool findings](docs/research-sdk-tools.md). Preserve account/model/tool checks, isolation, cancellation, and retained usage receipts. The packaged research skill is loaded explicitly into the helper prompt; ambient skills/instructions remain disabled. Use Explorer's identity and data directory.

## Data and UI

- Validate imported files and AI action payloads. Preserve Unicode and user text. Render user/AI content as text; only validated HTTP(S) URLs become links.
- Save atomically; serialize edits, check revisions, and protect documents against overlapping writers. A failed save must leave the last document recoverable.
- Bind HTTP to loopback, require the instance token, check Host and write Origin, limit request sizes, and serve only allowlisted assets.
- Keep sourced research distinct from model reasoning. Research suggests; only the user supplies an answer.
- Keep the panel usable in a narrow desktop side pane, with keyboard access and visible focus. Use flat-color SVG metadata assets.
- Respect the owner's global browser restriction: no browser/desktop UI automation without an explicit request. Ask the owner to do final visual checks. Use Brave if browser opening is authorized.

## Verification and installation

Before implementing a repository change, read [the development workflow](docs/development-workflow.md) once. Use its issue brief, independent review receipt, `verify:iteration` gate and explicit usage ledger; keep detailed logs in ignored local storage. Reload only the relevant section when scope changes or context is lost. Token targets never waive required checks, review, accessibility or release steps.

Run `npm test` and `npm run check`. `npm run e2e` uses the **installed** desktop SDK/runtime selected by `COPILOT_SDK_DIR` and `COPILOT_CLI_PATH`, a disposable Copilot home, and a local model fixture. Tests must never use a paid provider or an existing user session.

Install through Copilot's CLI. Do not hand-edit its databases or installed-plugin records. A local marketplace loads the checkout live; retain its directory and start a new session after edits. Normal distribution should use a cached GitHub marketplace install. Local installs may omit the native tab icon; see [integration notes](docs/copilot-integration.md).

## Complete every iteration

The owner has given standing authorization to commit and push each completed iteration to `main`. Unless the owner explicitly requests otherwise, every iteration that changes repository files, including documentation or instructions, must finish with these steps:

1. Bump the plugin version at least one patch increment. Synchronize `package.json`, `plugin.json`, `.github/plugin/marketplace.json`, the extension's `package.json`, and the README's current version.
2. Add a newest-first entry to `release-notes.json`, with an accurate user-facing summary of at most 400 characters. Preserve older entries and ship the complete extension, panel, skill, and logo together.
3. Run `npm test` and `npm run check`, plus the runtime fixture when host integration changes. Fix failures before publishing.
4. Fetch remote changes, commit the iteration, integrate it into `main` without discarding others' work, and push to `origin/main`. Do not ask for push approval again or stop at a local commit or feature-branch push. Never force-push.
5. Verify the published commit on remote `main`. Report the plugin version, commit, checks actually run, and any pending manual verification. If publishing is blocked, state the blocker rather than claiming completion.

A passing runtime fixture does not prove visible desktop rendering or live research quality. Creating tags or GitHub Releases remains separate from the authorized routine push to `main`.

These rules were adapted from the owner's Usage Insights and Enhance Prompt repositories. Rationale and source pointers live in [docs/copilot-integration.md](docs/copilot-integration.md).
