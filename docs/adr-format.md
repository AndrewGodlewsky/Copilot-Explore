# ADR formatting preferences

Choose **Tools → ADR format** (also in **Commands**) to select a directory, filename convention and bundled or repository template. **Read / review format** shows the recognized structure and sample Markdown with unspecified decision values. **Save reviewed preferences** saves the configuration in this exploration, through normal revision checks, History and Project writer locks. It does not generate a decision, change an answer, contact a model, write an ADR or reserve a filename. Private answer drafts and existing artifacts remain intact.

The bundled layout follows the concepts in [MADR](https://adr.github.io/madr/): context, drivers, alternatives, outcome, consequences and references, with optional status/date metadata. The [MADR 4.0.0 templates](https://github.com/adr/madr/tree/4.0.0/template) informed the supported structure; Explorer does not install MADR or copy its guidance into prompts.

## Supported template structure

Select one Markdown file with one ATX title (`# Title`). Its title text is a placeholder, never the generated decision title. Recognized section labels are case insensitive, preserve their original spelling/order, and use `##` unless noted:

| Content field | Supported heading labels |
| --- | --- |
| `context` (required) | Context and Problem Statement; Context; Problem Statement |
| `drivers` | Decision Drivers; Drivers |
| `alternatives` | Considered Options; Alternatives; Options |
| `outcome` (required) | Decision Outcome; Decision; Outcome |
| `consequences` | Consequences |
| `confirmation` | Confirmation |
| `optionDetails` | Pros and Cons of the Options |
| `references` | References; More Information |
| `status`, `date` | Status; Date |

Consequences and Confirmation can be `###` subsections under the outcome. Under Pros and Cons, `###` option headings are discarded as examples. A leading `---` metadata block may declare unique `status`, `date`, `decision-makers`, `consulted` and `informed` keys. Only these key names and their order are retained; all values are discarded. A metadata field cannot also be declared as a section. Nested YAML, arbitrary metadata keys, unknown/duplicate headings, missing required sections, multiple titles and unclosed fences/comments reject with an error. Setext headings, translated/custom section labels and executable template expressions are not supported. Use a supported copy if a repository template needs a different grammar.

Body prose, comments, code blocks, example people/dates/statuses/decisions and template directives are not retained or executed. Comments and code fences do not contribute headings. The recognized layout is formatting data, not an ambient instruction source or evidence. Its keys can guide later ADR features, but no raw template content is authorized for model input.

`renderAdr(format, content)` is a deterministic formatter for explicit text fields, not an AI generator. Required missing values say **Unspecified**; a missing title says **Unspecified decision**. Empty optional sections are omitted. Declared metadata without a value remains unspecified. Nonempty content for an absent section/metadata key rejects rather than silently disappearing. Unknown fields, invalid explicit dates and excessive text reject. Content is escaped as Markdown text, Unicode is retained, and line endings normalize to LF. The preview uses sample values only; no map decision is inferred or approved.

## Separate template path contract

This is separate from [selected project excerpts](project-context.md). It reuses physical root/file checks, not excerpt selection or Challenge Review's permission to transmit reviewed excerpts. Opening this dialog, loading saved preferences, importing a map and ordinary polling do **not** read a template. Only an explicit review names a file to read; confirming its save rechecks that same captured source. The bundled default needs no project metadata.

The root is the attached local session's fresh `rpc.metadata.snapshot().workingDirectory`. The session artifact directory is never used. No recursive scans, imports/includes, project instruction discovery, template engine, tool call or repository write occurs. Directory preferences are checked syntactically here; existence, canonical destination safety and write access are not guaranteed until a later explicit ADR write.

| Bound | Limit |
| --- | --- |
| Selected template | One regular `.md` file |
| Full relative paths | 240 UTF-16 code units, forward slashes |
| Directory preference | 235 code units, leaving room for a minimal filename; final combined path must fit |
| Template bytes | 32 KiB, checked before reading content; strict UTF-8 |
| Known metadata / section entries | 5 / 10, unique and validated |
| Explicit rendered title / other text field | 200 / 16,384 code units |
| Rendered Markdown | 64 KiB UTF-8 |
| Preview authority | One payload, 10 minutes, single-use save token |

Hidden/traversal/absolute/device/stream paths, reserved Windows names, trailing dots/spaces, unsupported extensions and secret-name defaults reject before reading. These include `.github` paths under the conservative hidden-path rule; choose a regular supported location explicitly. Links/junctions, hardlinks, nonregular files and unknown identities reject. Canonical root/ancestors/file identity are checked around bounded reads. These are the existing cooperative local-filesystem checks; portable Node cannot atomically bind every ancestor against a malicious concurrent swap. UNC/remote roots are unsupported.

Raw template bytes/text are discarded after structure extraction. The transient preview retains only private root/file identity, relative selection, hash, derived format and saved-document fingerprint. No body text or absolute root goes to the UI, native canvas context, model prompts, map, History, exports or diagnostics. The chosen relative template path and SHA-256 are intentionally portable configuration metadata. General filename exclusions cannot identify every sensitive name; select an appropriate template.

## Freshness, cancellation and storage

Preference edits invalidate the preview. Closing, changing journeys, suspending the page, canvas close, expiry and replacement discard preview authority; late responses cannot re-enable saving. A save that already committed may still succeed if the response is lost or the dialog closes. **Reload saved journey and preferences** explicitly reloads what was saved; it does not reread a template. A changed/missing template or root requires another explicit review. The final save reads the document again after asynchronous file checks so concurrent corrections are not overwritten.

Personal v1 and shared v1 documents can contain optional `adrFormat`: `{version: 1, directory, naming, digits, template, layout}`. The template is `{kind: 'bundled'}` or `{kind: 'repository', path, sha256}`; layout contains ordered `metadata` names and `{key,label,level}` sections. It contains no raw template, decision content, absolute paths, tokens or file-access permission. The bundled layout must match the shipped default. Import and canonical shared serialization preserve this structure, but never automatically read its referenced path. A saved repository reference is **not checked** until explicitly reviewed again. Full JSON carries configuration; ADR questions receives only its derived layout, while other AI input projections and reduced exports omit the configuration. Older shared readers reject the unfamiliar field; older personal readers can drop it. Use v0.1.92 or newer when editing these preferences.

One configuration belongs to one exploration. Full exploration copies preserve it as portable preferences; focused scenario forks omit it with prior artifacts. It is not a project-wide settings file or ADR register. Later drafts must capture their chosen format rather than treating mutable preferences as permanent draft identity.

## Naming and the later writer

Default proposal: `docs/decisions/0001-title.md`. Choose numbered titles or title-only names. Number width is 2–6 (default 4); numbers from 1 through 999999 are explicit formatter input and may exceed the minimum width. Titles become lowercase hyphenated slugs, with diacritics folded and Unicode letters/numbers retained, bounded to 100 code units and 240 UTF-8 bytes for the filename component. Empty, malformed-Unicode, reserved and overlong proposals reject. No number is selected by scanning or reserved when preferences/drafts open.

The later repository writer (#80) must choose/recheck a final number and target at confirmation, detect collisions and publish without overwriting another document. A preview filename is only an example. Existing manually written ADRs and templates are never edited by this feature.

Focused tests cover faithful formatting, untrusted examples, missing/omitted values, paths/size/encoding/links, changed roots/files, cancellation/expiry/revision/final asynchronous corrections, Project writer locks, round trips and UI draft preservation. The installed local fixture checks real metadata-root behavior. Native narrow-pane rendering, keyboard/screen-reader, theme and IME checks remain pending owner verification; no browser automation or paid model is used.
