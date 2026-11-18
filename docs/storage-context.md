# Shared documents and private working data

The #54 persistence foundation separates an authoritative project document from private working data. #55 connects `ProjectJourney` to the controller and [project-storage UI](project-saving.md). Personal Library remains the default. No existing personal file or draft is moved automatically.

## Data inventory

| Data | Location and sharing rule |
| --- | --- |
| Saved questions/directions, answers and answer states, global guidance and pins | Shared journey content |
| Saved research explicitly accepted into a question, including evidence and provenance | Shareable content; publication UI must preview the selection |
| Accepted decision briefs and implementation handoffs | Shareable saved user-reviewed artifacts, with historical inputs and freshness retained |
| Saved review flags, reminders and generation provenance | Shareable supported schema fields; not machine bindings |
| Answer drafts and draft clear markers | Private auxiliary directory; never automatically copied to another scope |
| Session/canvas bindings, recents, private pins, visual references and preferences | Private auxiliary directory or existing personal settings; never imported as session authority |
| Audio and transient editor/operation state | Local/transient; never part of a shared document |
| Usage receipts, helper journals and owned-helper runtime state | Private `usage` directory supplied to helpers |
| Local revision counters, snapshots, history intents, checkpoints and recovery evidence | Private local history; Git history is separate |
| Writer locks, caches, analytics and cleanup preferences | Private auxiliary directory |
| Selected project-file excerpts | Transient under the existing project-context policy; no shared/exported copy |

The shared codec is an allowlisted schema. Unknown fields, including draft/session/usage/project-source properties, are rejected rather than silently swept into a repository or filtered from an arbitrary runtime object. Saved text can itself contain sensitive material; this boundary is not an automatic secret detector. A publication workflow must show the actual selected content.

## Storage context

`await projectStorageContext({ checkoutDirectory, file, localDirectory, journeyId })` in `storage-context.mjs` returns a frozen context:

- `file`: the one authoritative shared document, inside the selected checkout.
- `directory`: private auxiliary root under `localDirectory/projects/<checkout-hash>/<journey-hash>`.
- `key`: a stable local key derived from canonical checkout path/ancestor identities and journey ID.
- `usageDirectory`: the helper receipt/journal root under that private directory.
- `lockFile`: the private journey writer lock. `creationLockFile` serializes creation in the checkout across different journey IDs so two creators cannot replace the same new destination.
- `read()`: a bounded raw-byte read with file/ancestor identity checks before and after reading.
- `assertCurrent()`, `withLock(work)`, `withCreationLock(work)`: revalidate roots and coordinate cooperative local writers.

The caller supplies an existing checkout and document parent. This API does not discover Git roots, obtain host metadata, create a project folder, choose a destination from imported data, or follow links. Those are #55/#56 responsibilities. Private directories are created only outside the checkout. Linked/nonregular/multiply linked documents and observed root replacements are rejected. UTF-8 decoding and schema checks happen in the shared codec.

Canonical checkout identity includes the path and filesystem identities, so different clones/worktrees and a replacement checkout at the same path do not inherit each other's drafts or bindings. Reopening the same checkout/journey reuses its private namespace. Copying or renaming a checkout can produce a new namespace; old private data is retained for explicit recovery, not moved implicitly. The personal Library continues using its existing root and entry keys, and direct-file personal previews retain their existing path-based draft identity.

## Project persistence adapter

```js
const context = await projectStorageContext({ checkoutDirectory, file, localDirectory, journeyId });
const store = new ProjectJourney(context);
await store.create(newPersonalShapeDocument); // only a new destination; shared schema on disk
// Or: await store.load();
const next = structuredClone(store.document);
next.nodes[1].answer = 'Chosen answer';
await store.save(next, { baseDigest: store.baseDigest, label: 'Answer saved' });
```

`ProjectJourney` serializes calls under the private journey lock. It uses the #53 byte base check immediately before persistence, preserves exact text, and performs atomic document replacement. An unchanged save retains the source bytes and timestamp. A changed save advances the shared update time and a **local-only** working revision. The working object has personal-v1 fields for existing model consumers; `format`, `version`, and `revision` are removed from its shared `journey` envelope.

There is no second local head document. Existing `History` snapshots preserve past versions, and its manifest/intent hashes identify which local revision matches the authoritative shared content. On a fresh clone with no private history, the local counter starts at zero. An interrupted save before document replacement keeps the old document; an interruption after replacement keeps the new answer and finalizes local history on reopening. If shared content matches neither the recorded head nor pending intent, mutation is refused and all files remain for #58's external-change reconciliation. Some external object-key reordering also requires reconciliation because legacy local snapshot hashes are order-sensitive.

`versions(hash?)` inspects validated local recovery snapshots. `retention()` returns a `StorageManagement` instance bound to exactly this external authoritative file, private key/lock and reader; use `record()` for its preview input. Cleanup still checks the authoritative content stamp and private manifest/snapshot identities before deletion. It never deletes the project document or moves private drafts. A changed document invalidates a captured cleanup preview.

History and recovery accept an internal `validate` hook; the default is unchanged for personal journeys. Project snapshots use `validateProjectWorkingDocument` to retain supported whitespace and Unicode. `validateSharedDocument` is the shared codec's object-validation entry point; it preserves the supplied object and rejects unsupported/non-JSON values. Serialization and byte bounds remain the responsibility of the read/write preparation functions.

## Integration obligations and limits

Before #55 enables Project storage, it must obtain fresh attached-session working-directory metadata, validate the repository and chosen relative folder again at write time, and pass this context to every private-data consumer. Drafts, references, bindings, preferences, history/recovery, analytics and usage helpers must use `directory`/`usageDirectory`; no component may infer its private root from `dirname(file)`. Journey switches must flush drafts and release owned helpers using the existing rules. Failed scope changes preserve the old private data and show an error; there is no automatic draft migration.

This adapter performs local filesystem work only: no stage/commit/push/pull, project scan, model call, session selection, distributed lock or automatic publishing. Locks coordinate callers sharing the same private data root. Other user accounts, Git processes and independent private roots do not share that lock; digest and identity checks reject observed changes, but portable Node operations cannot provide an atomic ancestor-bound compare-and-swap against hostile or uncooperative concurrent writers. The intended collaboration is asynchronous work through Git, with explicit external-change reconciliation.

Tests use disposable directories, real shared files, existing personal/controller draft behavior, real history/intent recovery, independent clone namespaces and protected retention. They also exercise same-destination creation races, private/unknown field rejection, stale bases, failed writes, unsupported versions and linked/replaced roots. They do not prove native UI, live helpers, host metadata integration, or Git merge behavior.
