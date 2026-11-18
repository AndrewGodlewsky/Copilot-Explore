# Confirmed decision dependencies

Open an ordinary question, choose **More options → Context**, then **Confirmed decision dependencies**. Choose a saved question in **This question depends on**, optionally explain why, and select **Add dependency**. Nothing is selected by default. These are user assertions: **B depends on A means changing A may affect B**. They do not establish that an answer is correct or externally verified.

Both directions are visible: prerequisites under **This question depends on**, and dependents under **Questions that depend on this**. Each question is a native button that opens its workspace and focuses its heading, revealing the path even if it was folded or outside the focused branch. Each relationship has an explicit remove button. Removal is reversible through History. To change an explanation, remove and add the relationship again. Unsaved explanation/target selections remain in this panel's memory during polling and navigation; they are not durable answer drafts.

The parent/child tree remains the navigation structure. Tree relationships suggest possible impact; they are never automatically confirmed dependencies. Private pinned references, project constraints, AI suggestions and research remain separate. Root ideas and structural directions cannot be endpoints. Dependencies are between questions in this map, including questions in separate branches. A dependency may point opposite a tree path; only the explicit dependency graph must be acyclic.

Adding/removing relationships preserves question text, saved answers and answer states, research, parentage and review flags. The connected answer editor and private drafts are retained. [Downstream decision impact](decision-impact.md) now explains reachable questions from saved relationships. Edge colors and downstream review actions are subsequent work. Current AI context projections and reduced visual/offline exports do not include this new metadata. Native JSON export and Markdown include it.

## Stored contract and compatibility

Personal v1 documents and shared v1 `journey` content may contain an optional `dependencies` array:

```json
{
  "dependencies": [
    {
      "dependentId": "question-B",
      "prerequisiteId": "question-A",
      "explanation": "Delivery timing relies on the storage choice."
    }
  ]
}
```

The ordered pair of stable question IDs identifies a relationship; a separate edge ID is unnecessary. Explanation text is optional, at most 1,000 characters, and preserved exactly, including Unicode and whitespace. There are at most 10,000 relationships, within the existing 5,000-node/9 MiB document limits. Validation rejects unknown relationship fields, missing or structural endpoints, self-links, duplicate pairs and directed dependency cycles. Iterative validation is bounded by nodes plus links.

Legacy documents without this field remain unchanged. Removing the final relationship omits it again. Shared-format readers older than **v0.1.77** reject this unfamiliar metadata instead of discarding it. Older personal-format readers may drop unknown metadata: use **v0.1.77 or newer** when editing personal exports with dependencies. The shared envelope version remains v1 because its existing unknown-field refusal provides the compatibility boundary; `extensions` remains reserved and empty.

Normal revision checks, writer locks, atomic saves and History apply. History previews explicitly identify changed dependencies and allow inspection of the full saved content. Imports/restores reject dangling relationships or cycles before saving. Removing a referenced question through a file edit/import requires removing its relationships in the same valid document. Semantic merge treats the dependency array as one metadata value; competing array changes need an explicit choice. Every combined result is validated, including clean-looking node deletions that would leave a dependency dangling.

Shared files contain relationships and explanations so another checkout can resume them without private metadata. They are repository content; use Personal storage if the exploration should stay private. Nothing fetches, stages or pushes Git content automatically.

## Verification

Behavioral tests cover exact text/node preservation, direction, duplicate/self/missing/structural endpoints, cycles, 5,000-node traversal, limits, stale writers, history restore/import refusal, fresh Git clone, semantic merge validation, and HTTP/jsdom add/remove/navigation with retained drafts. Native narrow-pane, keyboard and screen-reader checks remain pending owner verification; no browser/desktop automation was used.
