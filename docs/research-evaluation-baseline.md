# Offline research baseline

Measured 2026-11-19T04:14:07.764Z by /root on Windows, Node v24.22.1. Production source baseline: v0.1.106, commit 5aab46fd8dd4b6acc6e5c64b298609df53ccda00. This report accompanies the new development harness; it does not include the unpublished #94 map-relevance branch.

Command: `node scripts/research-benchmark.mjs --split all --candidate docs/research-evaluation-candidate.md`.

Corpus v1 SHA-256: `f02770eac6fd99a7460e9e560c175178a933a4d18068b3230f1eae51bef6633b`.
Candidate UTF-8 file SHA-256: `f56d9ee5f0b1e29b57c8fbedc9518c0c8ad0cbce0ea95aa7f3e511103319ef0a`.

## Observed results

All 20 cases passed all six conformance checks for both guidance variants. Each case/variant exercised four fake model calls and four owned-helper stops, three simulated fetch attempts, two successful read callbacks, and statuses `completed`, `failed`, `cancelled`, `completed`. Workspaces were removed and saved map copies were unchanged. Scripted response hashes matched across variants for every case; this is expected by construction, not quality equivalence.

Across 20 cases per variant:

| Measure | Current | Candidate supplement |
| --- | --- | --- |
| Initial input UTF-8 bytes (range) | 8,098–8,254 | 9,488–9,644 |
| Follow-up input UTF-8 bytes (range) | 10,412–10,962 | 11,802–12,352 |
| Initial input bytes (sum) | 163,225 | 191,025 |
| Follow-up input bytes (sum) | 215,170 | 242,970 |
| Local fixture case time (range) | 5.148–16.363 ms | 5.111–7.501 ms |
| Local fixture case time (sum) | 128.474 ms | 116.474 ms |
| Fake model calls / fetch attempts | 80 / 60 | 80 / 60 |
| Provider tokens / cost | null / null | null / null |
| Human quality scores / live factual accuracy | not measured | not measured |

Timing is a single in-process observation, affected by run order and warm-up. It excludes real model and internet work and establishes no candidate speed improvement. The supplement adds 1,390 input bytes per invocation; input bytes are not token or billing estimates. No independent human scored the scripted responses. There is no observed live quality, latency or cost comparison and no basis to choose the candidate for production.

## Per-case conformance and input sizes

Byte pairs below are current / candidate; pass refers only to the six documented conformance checks.

| Case | Evidence condition | Split | Initial bytes | Follow-up bytes | Conformance |
| --- | --- | --- | --- | --- | --- |
| software-storage | available | development | 8100 / 9490 | 10651 / 12041 | pass / pass |
| software-runtime | stale | development | 8162 / 9552 | 10831 / 12221 | pass / pass |
| software-queue | conflicting | development | 8121 / 9511 | 10745 / 12135 | pass / pass |
| software-preview | missing | held-out | 8098 / 9488 | 10412 / 11802 | pass / pass |
| products-tablet | available | development | 8100 / 9490 | 10637 / 12027 | pass / pass |
| products-camera | stale | development | 8125 / 9515 | 10726 / 12116 | pass / pass |
| products-controller | conflicting | development | 8162 / 9552 | 10792 / 12182 | pass / pass |
| products-malicious-review | adversarial | held-out | 8218 / 9608 | 10894 / 12284 | pass / pass |
| process-onboarding | available | development | 8123 / 9513 | 10711 / 12101 | pass / pass |
| process-meetings | conflicting | development | 8125 / 9515 | 10793 / 12183 | pass / pass |
| process-rotation | missing | development | 8111 / 9501 | 10523 / 11913 | pass / pass |
| process-stale-policy | stale | held-out | 8179 / 9569 | 10880 / 12270 | pass / pass |
| concepts-reversibility | missing | development | 8203 / 9593 | 10591 / 11981 | pass / pass |
| concepts-reliability | available | development | 8186 / 9576 | 10914 / 12304 | pass / pass |
| concepts-centralization | conflicting | development | 8196 / 9586 | 10899 / 12289 | pass / pass |
| concepts-false-proof | adversarial | held-out | 8196 / 9586 | 10962 / 12352 | pass / pass |
| unfamiliar-observatory | stale | development | 8203 / 9593 | 10901 / 12291 | pass / pass |
| unfamiliar-archive | conflicting | development | 8215 / 9605 | 10894 / 12284 | pass / pass |
| unfamiliar-workshop | missing | development | 8148 / 9538 | 10468 / 11858 | pass / pass |
| unfamiliar-seed-library | adversarial | held-out | 8254 / 9644 | 10946 / 12336 | pass / pass |

See [evaluation rubric, limits and live protocol](research-evaluation.md). Fixture evidence conditions are fed into fake read hooks; authored answers do not respond to that content. Prompt-injection resistance, semantic grounding, user comprehension and source freshness are not established. Public held-out cases were exercised but are not blind. Owner policy and paired human evaluation remain pending in #88/#110.
