# Shared exploration format

Issue [#53](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/53) introduces a pure codec for portable exploration content. It does not change personal saves, publish anything to a repository, or install a shared file. Storage selection and the shared/private data split are separate work in #54 and #55.

## Contract

The envelope is `copilot-explorer-shared`, version `1`. `journey` contains the existing personal-v1 content with its `format`, `version`, and machine-local `revision` fields removed. Journey and node IDs remain stable across copies. Research provenance is preserved; conversion is not a new research run or evidence verification.

```json
{
  "extensions": {},
  "format": "copilot-explorer-shared",
  "journey": {
    "createdAt": "2026-11-18T12:00:00.000Z",
    "finishedAt": null,
    "id": "journey-1",
    "nodes": [
      {
        "answer": "",
        "category": "Your idea",
        "id": "root-1",
        "parentId": null,
        "question": "Choose a storage approach",
        "research": null,
        "review": false
      }
    ],
    "rootId": "root-1",
    "topic": "Choose a storage approach",
    "updatedAt": "2026-11-18T12:00:00.000Z"
  },
  "version": 1
}
```

Existing optional fields may be absent. Reading never inserts model defaults, creates IDs, advances timestamps, trims user text, normalizes Unicode, sorts arrays, or changes provenance. Schema validation reuses `model.mjs`, but its normalized object is used only to check compatibility, never as replacement shared content. Values that would change identity or meaning during model normalization are rejected.

`extensions` may be absent or an empty object. It reserves a location for later schemas. Optional confirmed dependencies now live in `journey.dependencies`; see [decision dependencies](decision-dependencies.md) for their schema, bounds and compatibility policy. A future change must define its schema and compatibility/version policy explicitly. This client rejects nonempty extensions, unknown fields at any supported level, and unsupported versions, so it cannot silently strip unfamiliar data. Derived views, local operation state, usage receipts and machine bindings must remain outside shared content; the storage work must classify and select publishable content before writing a project file.

## Entry points

Import from `com.github.copilot/extensions/explorer/shared-document.mjs`. All functions are synchronous and perform **no file I/O**.

```js
import {
  readSharedDocument, prepareSharedWrite, prepareSharedMigration,
} from './com.github.copilot/extensions/explorer/shared-document.mjs';

const opened = readSharedDocument(originalBytes); // UTF-8 Buffer or string
const edited = structuredClone(opened.document);
edited.journey.nodes[0].answer = 'Keep project records in Git';
// A storage implementation must reread under its lock before this step.
const prepared = prepareSharedWrite(currentBytes, edited, opened.baseDigest);
// prepared.changed is false for an unchanged document; do not touch the file.
// Otherwise, atomically save prepared.content only while holding that lock.

const conversion = prepareSharedMigration(personalV1Bytes);
// conversion.content is a proposed separate shared copy, not a persisted file.
```

`readSharedDocument` returns `{ document, content, baseDigest, contentDigest }`. `content` retains the original UTF-8 text, including BOM, indentation, line endings and final whitespace. Writing it as UTF-8 recovers the original bytes.

`prepareSharedWrite` returns `{ changed, content, baseDigest, contentDigest }`. It checks the exact current base first. If content is unchanged, it returns the original text; a changed document is serialized with sorted object keys, meaningful array order, two-space indentation, LF and a final newline. There are three compatibility exceptions: journey pins, accepted handoff guidance, and accepted handoff evidence retain object-key order throughout their subtrees. Legacy accepted artifacts use order-sensitive hashes of these values; sorting them could invalidate a handoff or change its freshness. Historical hashes are never recomputed against current answers or guidance. Numeric object-key ordering follows JavaScript JSON serialization; currently supported schemas have no numeric-key maps. On already canonical documents, a single answer edit changes only that field. The first edit of a differently formatted file also canonicalizes its formatting.

- `baseDigest` is lowercase SHA-256 of the exact UTF-8 file bytes. Formatting-only changes invalidate this optimistic-write base too. A local revision counter cannot substitute for it.
- `contentDigest` is SHA-256 of canonical shared JSON. Object-key order outside the three legacy hash-input subtrees and whitespace outside strings do not affect it; exact string contents, array order, presence of optional fields, and legacy hash-input ordering do. It is a comparison aid, not authorship or authenticity evidence.
- `prepareSharedMigration` returns `{ sourceDigest, document, content, contentDigest }`. It accepts only supported personal-v1 input and drops only its envelope metadata and local revision. It never rewrites the source or creates a backup, project file, or revision history. The existing personal reader remains unchanged.

## Compatibility, limits and recovery

Both source and changed/migrated output have a 9 MiB UTF-8 bound. Existing model limits and graph invariants also apply. A compact supported source may be read and preserved unchanged when canonical formatting would exceed the output bound; edits or migration that exceed the bound fail without truncation. JSON must be a plain tree with finite numbers, valid graph references and no duplicate keys, hidden values, accessors, cycles, sparse arrays, or unsupported fields. Invalid UTF-8 input fails rather than replacing characters.

Failures throw an explanation and leave source buffers and candidate objects untouched. Unsupported files are not writable with this client. A caller should retain the original file, display the explanation, and allow the user to use a compatible client or work on a separate copy. Do not fall back to the personal validator and save its normalized output.

Conversion is explicit and safe to abandon: successful preparation, a thrown validation/size error, or interruption before installation leaves the personal file untouched because this module has no I/O. Later storage work must provide the recoverable installation boundary: keep the original, validate the prepared bytes, recheck the source digest and canonical destination identity under a writer lock, install atomically, and preserve the last recoverable document on failure. A standalone digest check is not a cross-process lock or a complete compare-and-swap implementation.

Tests in `test/shared-document.test.mjs` exercise exact text/provenance/optional-field round trips, deterministic edits, unchanged bytes, raw versus semantic identity, unknown data, malformed encodings and keys, invalid references, accepted brief/handoff certainty and freshness, explicit conversion, abandonment, and near-limit failure. They do not establish distributed persistence, native rendering, merge behavior, or live research quality.

Project copies may include optional journey.copyOrigin lineage (kind personal-copy, sourceId, sourceDigest). It identifies the committed personal source without local paths or revisions; see [project copy](project-copy.md). Older clients reject unsupported lineage in shared files.
