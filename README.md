# Explorer for GitHub Copilot

**Proof of concept, v0.1.5.** Explore an idea through a branching question map inside the GitHub Copilot desktop app. Start with `/explore`, answer the questions that matter, research options when you are unsure, and keep going as deep as you need.

## Install from GitHub

In the GitHub Copilot desktop app, open **Customize**, use the marketplace settings control, and add:

```text
https://github.com/AndrewGodlewsky/Copilot-Explore
```

Choose the **main** branch if prompted. Find **Explorer** in the `copilot-explorer` marketplace and install it. The exact plugin identifier is **`explorer@copilot-explorer`**.

Or install through Copilot CLI:

```powershell
copilot plugin marketplace add AndrewGodlewsky/Copilot-Explore
copilot plugin install explorer@copilot-explorer
```

Start a **new session** and use `/explore <your idea>`. The repository includes the complete runnable plugin; no build or npm install is needed for the GitHub installation.

If this marketplace is already registered from a local checkout, switch it to GitHub with the following commands, stopping if any command fails:

```powershell
copilot plugin uninstall explorer@copilot-explorer
copilot plugin marketplace remove copilot-explorer
copilot plugin marketplace add AndrewGodlewsky/Copilot-Explore
copilot plugin install explorer@copilot-explorer
```

Exploration files are stored separately and remain intact. For later updates, use **Update** in Copilot's installed plugins or `copilot plugin update explorer@copilot-explorer`, then start a new session.

## Install a development checkout

Requires GitHub Copilot desktop with canvas support and Node.js 22 or later for development commands. The plugin itself uses the SDK/runtime supplied by Copilot; there are no npm dependencies or separate AI keys.

From this repository:

```powershell
npm run install:copilot
```

The installer checks the package, registers this directory as the `copilot-explorer` marketplace, installs `explorer@copilot-explorer`, and lists plugins. It uses `copilot` from PATH. If that command is unavailable, set `$env:COPILOT_CLI_PATH` to the absolute path of your inspected, installed Copilot executable, then rerun. It does not download a CLI.

Equivalent commands:

```powershell
copilot plugin marketplace add (Get-Location).Path
copilot plugin install explorer@copilot-explorer
copilot plugin list --json
```

Keep the checkout in place: a local marketplace loads it live. Start a **new Copilot desktop session** after installation, then send:

```text
/explore I want to create a neighborhood tool-sharing library
```

`/explore` without a topic opens the entry form. If skill discovery has not refreshed, start another session or ask: **Open the installed Explorer canvas.** Do not use `/create-canvas`, which would create another extension.

Local marketplace installs can show a generic native tab icon due to a host issue observed in Copilot 1.4.2. The canvas is still usable. Prefer the GitHub marketplace installation above for normal use; see [integration notes](docs/copilot-integration.md).

## Use Explorer

1. Start with an idea. Copilot creates questions in several directions around it.
2. Select a question in the map or searchable **Outline**.
3. Use **Research options** to ask Copilot for alternatives, pros/cons, a recommendation, and uncertainty. Consulted sources are linked; unsourced reasoning is labeled.
4. Write your answer. **Save answer** records it; **Save & explore deeper** also generates follow-up questions on that branch. You can add a question manually.
5. **Finish exploration** saves the record and offers two downloads: Markdown and `.explore.json`. Use **Open file** to resume the latter in another canvas/session.

Pan by dragging the map background. Use the zoom controls, Ctrl+wheel, or Fit map. Keyboard users can Tab to nodes, use the map's arrow-key pan, or navigate the outline. Revising an answered node preserves its descendants and marks them for review.

AI work is queued in the canvas's attached Copilot chat and uses that session's model, tools, permissions, and normal usage accounting. It can appear in chat and wait behind other work. Web research depends on browsing tools being available there. Research does not fill in your answer. Cancel discards the pending result; it does not stop the host's chat turn. A three-minute timeout releases a stalled request and preserves saved answers.

## Files and privacy

Each canvas autosaves a versioned JSON document under `~/.copilot/plugin-data/explorer/` (`COPILOT_HOME` is respected). `EXPLORER_DATA_DIR` can override this for testing. Finish also saves a Markdown sibling there. Export names use an exploration identifier; every node's ID and parent relationship are preserved in the resumable file.

Question/answer/research data is stored locally as plain text and sent to your attached Copilot session when generating questions or researching. The plugin reads no repository files and loads no external UI assets. Downloaded files contain the exploration text. Imported files replace the current canvas after confirmation; save the current map first if you want to retain it. Unsaved text-area drafts are not part of exports; save them before leaving.

There is no fixed depth limit. This POC supports up to 5,000 nodes, 20,000 characters per answer, 9 MiB of saved map data, and 10 MiB imports. The saved-data limit keeps exports reloadable. Very large maps or prompts can hit host/context limits sooner. A crashed process may leave a `.lock` file; fully exit Copilot before removing only the matching lock, then reopen the map. Corrupt files are preserved and reported, never silently reset.

## Develop and verify

```powershell
npm test
npm run check
npm run preview
```

Preview prints a local URL to open in Brave. It uses the real UI and persistence, but has no Copilot connection; AI actions report that limitation. Manual questions, answers, imports and exports work. No browser opens automatically.

For the latest working prototype, run `npm run prototype:layouts`. The owner selected the **expanding node** as the direction to refine. Questions expand in their own branches, research opens below the draft, and collapsed nodes show saved answer previews. Try saving an answer and opening its connected follow-up. These [layout studies](docs/prototypes/README.md) use in-memory example data and are separate from the installed canvas. Earlier studies remain available on the same preview server.

The [interaction research](docs/explorer-interaction-research.md) examines six product precedents and relevant studies. It records why the owner preferred the expanding node and the remaining interaction questions. Its [earlier concept sketches](docs/prototypes/research-directions.html) remain available for reference. The selected direction is being refined in prototypes before production integration.

For the real SDK/runtime smoke test, set `COPILOT_SDK_DIR` to the installed SDK directory containing `index.js`, and `COPILOT_CLI_PATH` to its paired runtime executable, then run `npm run e2e`. The test uses a disposable home/session and a loopback model fixture. It checks actual plugin discovery, HTTP serving, queued chat delivery, canvas callbacks, persistence and export/import without paid inference or browser automation.

`npm run package` creates a clean, dependency-free installable directory under `dist/`. Register that directory as a local marketplace if you prefer a snapshot. There is no build step; the checked JavaScript/HTML/CSS is the shipped code.

Manual acceptance in Copilot:

- Invoke `/explore` and confirm the map opens in the side panel.
- Answer a question and confirm relevant deeper questions appear.
- Research another question; inspect the options, source links and uncertainty.
- Export both files, open the JSON in a new canvas, and confirm the full map returns.
- Check the narrow layout, keyboard focus, pan/zoom, and light/dark appearance.

Automated runtime fixtures cannot establish desktop rendering, actual model research quality, or successful slash-command discovery in your visible session. Those checks remain manual.

See [AGENTS.md](AGENTS.md) for development rules and [the assessed Copilot practices](docs/copilot-integration.md) imported from Usage Insights and Enhance Prompt.
