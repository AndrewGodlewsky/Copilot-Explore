# Validate exploration files locally or in CI

The packaged plugin includes `com.github.copilot/extensions/explorer/validate.mjs`. Run it with Node 22 or newer from the repository containing the files. It requires no npm install, Copilot login/runtime, model provider, network access or user-data directory.

```sh
# Explicit files; quote spaces and use -- before names beginning with a dash.
node /path/to/explorer/com.github.copilot/extensions/explorer/validate.mjs -- "maps/decision one.explore.json" legacy.json

# Direct shared files in an explicitly chosen repository folder.
node /path/to/explorer/com.github.copilot/extensions/explorer/validate.mjs --folder .explorer/journeys
```

Use your local plugin path (quoted on Windows when it contains spaces). From the Explorer source checkout, `npm run validate -- --folder <folder>` invokes the same entry point. `--help` describes usage. No-argument/unknown/incomplete options exit **2**; any invalid/unavailable selection or exceeded limit exits **1**; all selected files valid, or an explicitly selected empty folder, exits **0**. Empty results are printed as zero valid files. Missing folders fail. Discovery is nonrecursive and includes only direct names ending in `.explore.json`; select legacy files explicitly. All paths must remain inside the current working directory. Linked directories/files, hard-linked files and changing file identities are refused.

Limits are **100 selected files**, **1,000 directory entries** during discovery, **9 MiB per file** and **64 MiB of total reads, including reads later rejected because the file changed**. Exceeding a limit fails with an incomplete-validation message; split the selection into smaller batches. Paths and errors are escaped, relative diagnostics. Reads are bounded and checked against file/directory identity. Validation is an observation of the selected files, not an atomic snapshot of all concurrent repository changes.

The CLI reuses Explorer's canonical JSON and schema/graph validation. It rejects unsupported versions/extensions, duplicate JSON keys and node identities, invalid parent/reference structure, malformed UTF-8, oversized content and unresolved Git conflict markers. Shared documents retain strict preservation rules. Legacy v1 allows known model compatibility defaults and applies the same preservation checks as explicit migration: unsupported fields or lost references fail instead of being silently discarded. This is intentionally stricter than permissive legacy import. Neither defaults nor normalized data are written back. Tentative answers and recorded research limitations can be structurally valid: success does not establish decision quality, research accuracy or readiness for an ADR. Dependency, scenario and ADR fields not yet supported by the current schema remain invalid rather than being guessed or discarded.

## Opt-in GitHub Actions example

Copy [the example workflow](examples/validate-explorations.yml) into the consuming repository only when ready to enable it. Set repository variable `EXPLORER_VALIDATOR_REF` to a reviewed **full commit SHA containing this validator**, and adjust the folder in the final command. The example checks out the proposed files and a separately pinned trusted validator, then runs the standalone command without dependency installation. It does not execute project scripts, persist checkout credentials or write exploration files. Setup/checkout steps require normal GitHub Actions network access; the validator itself is offline.

The example pins [actions/checkout v7.0.1](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1) and [actions/setup-node v7.1.0](https://github.com/actions/setup-node/tree/949feb2413d6458794dcd2491c4babbbce0c15c1), checked on 2026-11-18. Review those actions and your runner requirements when adopting or updating them. No CI workflow is installed automatically in this or another repository. Automated tests run the final validation command against a disposable sample repository and assert its contents remain unchanged; a hosted Actions run requires the consuming repository's opt-in configuration.
