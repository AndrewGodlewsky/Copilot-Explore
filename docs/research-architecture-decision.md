# Research architecture and retrieval policy

Issue [#88](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/88).
Assessed November 18, 2026 against Explorer v0.1.66 (`b00dadc`) and installed
SDK/runtime `1.0.106-8.unstable.r43566476370.g869eef3`.

**Status: investigation delivered; owner interaction and retrieval-approval
policy approved November 19, 2026. Implementation and capability gates remain.**
The [default interaction decision](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/88#issuecomment-7016077364)
and [bounded-request approval decision](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/88#issuecomment-7016259614)
resolve the product choices that held this investigation open.
No broader network access, provider, credential, ambient skill, or runtime
dependency is enabled by this document. The owner's existing requirement in
[#41](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/41) that private
text stay absent from tool logs remains in force; this decision does not narrow
it to search-only filtering. The transport verification gap in
[#42](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/42) also remains.

## Chosen direction and approved interaction

Keep Explorer's owned installed-SDK helper, validation, review tokens and usage
receipts. Improve its packaged research guidance and evidence/option contract
incrementally. Borrow planning, source selection, counter-evidence and evaluation
practices from [the pinned prior-art comparison](research-prior-art.md); do not
import a report-writing framework or assume its settings enforce our policy.

Approved target interaction: start with help from the existing exploration map
and previous findings, with no new retrieval. Offer a separate explicit action
labeled exactly **Research** when further evidence is needed. Before starting,
show the question, scope and effort limit. One approval covers searches and page
reads within that bounded request; approval of every query/page is not the
default product interaction. Changed scope, additional disclosure or increased
effort requires a new review/start. Host-required approvals still apply.

A declined or unavailable retrieval mode must still permit useful reasoning
with visible limits. The default is approved, but general no-retrieval research
routing is not yet shipped; see #104 below. Existing wording/term help already
uses a tool-free helper. Neither tool-free path is offline: inputs can still be
sent to the model provider. If a required boundary cannot be enforced, the
dependent capability stays unavailable rather than silently broadening access.

The smallest initial work is UI, structured findings, stronger guidance and a
representative benchmark under existing permissions. A multi-researcher system
or a new service has additional latency, credentials, dependency and permission
costs; none has demonstrated a net benefit for Explorer's concise answers.

## Retrieval policies compared

Existing-material help is the approved default. Bounded explicit research is
the approved optional interaction, subject to the gates below. An exact-URL-only
mode remains a compared alternative, not a separately shipped or required mode.

| Policy | What it permits | User review and benefit | Limits and implementation gate |
| --- | --- | --- | --- |
| Existing/provided material; no new retrieval | Send approved map findings or supplied material to an owned tool-free model helper; deny search/fetch and other tools | Fast clarification; minimizes external retrieval and makes missing evidence visible | Model-provider traffic still occurs. This is not offline. Existing question-help proves a tool-free helper pattern, but general research-mode routing and its input contract require implementation and validation. |
| User-approved URLs | Fetch only exact reviewed destinations, with a deliberate redirect policy | User controls the starting sources and can seek fresh information without broad search | URLs, query strings and page access are network disclosure. Destination changes, redirects, credentials, DNS/socket binding and policy enforcement must satisfy #42. An allowlist in a prompt is insufficient. |
| Explicit web research | Approved search/fetch scope with bounded effort, inspected tool origins and disclosed query context | Finds current evidence and unknown sources across broad topics | Search may disclose sensitive context. #41 requires an enforceable boundary including tool logs; #42 covers transport. Blanket helper-start consent cannot substitute for capabilities the runtime does not expose. |

No policy permits hidden escalation from explanation to web retrieval, executing
instructions from a source, adopting ambient skills, answering host permission
prompts, or treating a saved answer as consent for a different destination.
Retrieval availability must be separate from confidence: a retrieved page can
be irrelevant, stale or wrong, and a fetch receipt cannot prove claim support.

## Implementation evidence and remaining capabilities

The November 18 baseline findings come from local source, installed declarations
and deterministic fixtures, not a live research-quality trial. Reconciliation
against v0.1.110 retains these boundaries; it does not claim a newer SDK contract:

- [`owned-helper.mjs`](../com.github.copilot/extensions/explorer/owned-helper.mjs)
  validates the host-paired runtime, creates an owned temporary workspace/home,
  matches signed-in account and eligible selected model, verifies tools before
  sending, bounds execution, stops only its helper and retains usage receipts.
  Ambient skills, hooks, instruction discovery, session memory and host Git
  operations remain disabled. Research explicitly enables config discovery in
  the isolated empty workspace because the runtime-managed GitHub MCP needs it.
- [`research.mjs`](../com.github.copilot/extensions/explorer/research.mjs) permits
  exactly the verified built-in `web_fetch` and GitHub MCP `web_search` tools.
  It denies managed-approval/sandbox-bypass requests instead of approving them
  automatically. It screens eligible public URLs, counts denied attempts, and
  checks cancellation/deadline again after asynchronous checks. Current research
  still requires both tools before inference; a reasoning-only result is an
  output fallback, not a selectable no-retrieval permission mode.
- The same module records matching successful requested-URL fetch callbacks,
  with trusted local retrieval timestamps. Search snippets, failed/blank reads,
  reused call IDs and unknown sources cannot become newly observed evidence.
  Redirect destination and publication date remain unknown. This establishes
  retrieval attribution, not factual truth or complete transport enforcement.
- [`research-review.mjs`](../com.github.copilot/extensions/explorer/research-review.mjs)
  and [`research-context.mjs`](../com.github.copilot/extensions/explorer/research-context.mjs)
  bind exact immutable bounded input to one operation, identity and source
  revisions. Tokens are single-use and expire. Relevant changes require refresh;
  unrelated edits can proceed. Review of context is not review of every future
  model-generated search query.
- [`tool-free.mjs`](../com.github.copilot/extensions/explorer/tool-free.mjs) supplies
  the existing no-tools pattern. It does not imply zero provider traffic or
  private native logging. Selected project excerpts remain limited to the
  reviewed tool-free Challenge operation; research, follow-ups and ordinary
  questions still exclude them. See [project-context boundaries](project-context.md).

The installed `types.d.ts` exposes tool allowlists, `onPreToolUse` with tool
arguments, and explicit skill/instruction switches. Its generated permission
union exposes URL `redirectedFrom`, `managedApprovalRequired` and
`requestSandboxBypass` fields. Their presence is not proof of a pre-journal
redaction seam, per-hop transport attestation or destination-bound authorization
for a custom transport. See the version-specific [SDK findings](research-sdk-tools.md)
and the prior controlled investigations recorded in #41/#42. No unsupported
runtime override or manual invocation of a permission callback is proposed.

## Representative cases and evidence

[The six recorded cases](research-architecture-cases.json) include technical and
nontechnical decisions, a changing fact, conflicting evidence, sparse evidence
and clarification. Inputs and results are retained so later benchmark work can
reuse the exact cases. Each prepared the real packaged instructions and context
with no helper or retrieval call. Ten warmups preceded 100 local preparations;
timings are a small observational sample, not model latency or a performance
guarantee. The complete fixed ancestor and unanswered target fit in each request.

| Case | Actual instruction + prompt bytes | What must distinguish a good result | Current gap |
| --- | ---: | --- | --- |
| Relational versus document storage | 7,758 | Options tied to transactions, maintenance and deadline | No calibrated quality measurement or stable recommended-option reference |
| Cohort versus individual volunteer onboarding | 7,765 | Useful tradeoffs without presenting preferences as established facts | One generic skill; applicability of formal research workflows unmeasured |
| Supported runtime release for the next year | 7,769 | Current official support/version evidence and known dates | Recency guidance does not establish publication date or freshness |
| Incompatible study recommendations | 7,753 | Scope/method differences and unresolved disagreement | No calibrated disagreement evaluation |
| Undocumented unreleased component | 7,778 | Admit missing evidence and permit abstention | Current schema always requires 2-4 options |
| Explain "reversible" in existing options | 7,749 | Explain existing findings without new retrieval | Current research follow-up is web-capable and requires the two research tools |

Local context preparation averaged 0.0120-0.0189 ms in this sample; the useful
result is that exact inputs fit the enforced 131,072-byte budget with zero
omissions. All six performed zero helper/retrieval calls by construction.
Inference quality, live latency, paid cost, factuality, source recall and actual
model tool-call counts are **unmeasured** for every external candidate and these
questions. No quality leaderboard or cost-saving claim follows from this probe.

To reproduce the recorded input sizes from the repository root with Node:

```js
import { readFile } from 'node:fs/promises';
import { prepareContext } from './com.github.copilot/extensions/explorer/research-context.mjs';
import { researchFraming } from './com.github.copilot/extensions/explorer/research.mjs';
const fixture = JSON.parse(await readFile('docs/research-architecture-cases.json', 'utf8'));
for (const item of fixture.cases) {
  const source = { topic: item.topic, objective: fixture.objective,
    successCriteria: fixture.successCriteria, mode: 'decide', pins: [],
    path: [
      { id: 'constraint', parentId: null, question: 'What constrains us?',
        answer: item.constraint, answerState: 'decided', review: false },
      { id: 'target', parentId: 'constraint', question: item.question,
        answer: '', answerState: 'unanswered', review: false },
    ], decisionsElsewhere: [] };
  const prepared = prepareContext(source, researchFraming(source));
  console.log(item.id, prepared.bytes, prepared.coverage);
}
```

Run as a module (`node --input-type=module` on standard input). Byte values are
baseline observations; later instruction changes legitimately change them.
Normal `npm test` exercises real preparation, schema, receipts, cancellation and
review contracts with local fixtures. Its outcome is recorded in #88's
publication comment. It does not evaluate live answers to the six questions.

## Settled decisions and outstanding gates

- **Interaction and ordinary approval granularity are decided.** The approvals
  above cover a single reviewed request, not ongoing permission. They do not
  grant private repository disclosure in external queries, arbitrary tools, new
  providers or permission to bypass the host.
- **#41/#42 remain technical prerequisites for relevant expansion.** The
  inspected runtime supplies neither a supported pre-journal sanitization seam
  satisfying the private-tool-log requirement nor the verified per-hop
  redirect/DNS transport contract. Generic consent cannot supply either. The
  transport gap is missing verification, not proof of a vulnerability. Project
  excerpts retain their separate reviewed, tool-free Challenge contract.
- **The initial #110 live pilot is separately approved and has not run.** Its
  [consolidated authorization](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/110#issuecomment-7017687445)
  permits at most 12 explicit requests total: six synthetic cases with identical
  fixed sources, each run once under each of two guidance variants, with web and
  ambient tools/context disabled. Capture the eligible model selected in Explore
  through a supported host boundary and pin its exact ID. Started failures,
  cancellations and timeouts count; a durable allowance ledger prevents restart
  from resetting the limit. No retries, replacements or follow-up requests.
  Preserve isolation, deadlines, cancellation and usage receipts. This is a
  request-count limit, not a dollar/credit cap. Invented source support, ignored
  critical constraints or hidden major uncertainty fail the quality gate even
  if other cases improve. Execution and human scoring remain outstanding; the
  offline benchmark does not establish actual model quality. Ordinary automated
  tests continue to use local fixtures only.

## Sequenced work and integration cost

The [workspace design #90](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/90)
is approved. The [Research drawer #91](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/91)
and [Help me answer entry #92](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/92)
shipped in v0.1.109/v0.1.110; #91's native Copilot acceptance remains pending.
[Relevant map context #94](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/94)
shipped in v0.1.108. The [benchmark #110](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/110)
has an offline harness; its separately authorized actual-answer pilot still
needs implementation, execution and human scoring.
Improve the existing [guidance #103](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/103),
[claim links #105](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/105),
[uncertainty #107](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/107)
and [effort rules #108](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/108)
without assuming new permissions. Guidance-only adaptations have the smallest
integration surface, but still need quality evaluation.

[Explanation routing #104](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/104)
adds an explicit helper/purpose contract and must implement the approved default.
[Freshness #106](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/106) and
[reuse #109](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/109) require
honest provenance and invalidation. Framework replacement would require a
separate approved dependency/runtime architecture plus comparable quality and
resource evidence; no such replacement is selected here.

[Project-aware research #118](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/118)
stays gated on #41/#42 and reviewed project-context work; the product policy is
settled. UI work and ordinary Smart question design can progress independently.
The [dedicated research model setting #120](https://github.com/AndrewGodlewsky/Copilot-Explore/issues/120)
is approved but not yet implemented. It will default to the selected chat model
and permit a personal eligible-model override. It does not expand retrieval permission or the pilot allowance and
is not a prerequisite for that pilot. Closing this investigation records the
decisions; it does not close these implementation issues or enable new access.
