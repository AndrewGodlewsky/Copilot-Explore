import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createResearcher, researchFraming, publicUrl, boundedContext, hostRuntime } from '../com.github.copilot/extensions/explorer/research.mjs';
import { prepareResearch } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { researchSettings, researchLimits } from '../com.github.copilot/extensions/explorer/web/research-policy.mjs';
import { prepareFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { operationEvidence } from '../com.github.copilot/extensions/explorer/operation-recovery.mjs';
import { createUsageRecorder } from '../com.github.copilot/extensions/explorer/research-usage.mjs';
import { recommendationFindings } from './helpers/research-recommendation.mjs';
import { supportFindings } from './helpers/research-support.mjs';
import { limitationFindings } from './helpers/research-limitations.mjs';
import { freshnessFindings, FRESHNESS_NOW } from './helpers/research-freshness.mjs';
import { answerNode, addDirection } from '../com.github.copilot/extensions/explorer/model.mjs';
import { effortReport } from '../com.github.copilot/extensions/explorer/research-effort.mjs';

test('owned research follow-up sends reviewed strings, credits prior and current sources separately and attributes retained receipts', async t => {
  const doc = createDocument('Follow-up fixture'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Target' }]);
  doc.nodes[1].research = { ...result, sources: [{ id: 's1', title: 'Old', url: 'https://example.com/old', retrievedAt: '2020-01-01T00:00:00.000Z', provenance: 'imported' }], basis: 'sources' };
  const prepared = prepareFollowup(doc, doc.nodes[1].id, { question: 'What if 🌿 doubles?', hypothetical: true }, { settings: { depth: 'quick', sourceFocus: 'primary', recency: 'recent' } });
  const content = { answer: 'Prior and new evidence remain separate.', uncertainty: 'Model interpretations.', claims: [{ id: 'c1', text: 'Consider both', basis: 'sources', evidence: [{ sourceId: 'old', paraphrase: 'Old' }, { sourceId: 'new', paraphrase: 'New' }], limitations: 'Unverified relevance' }], sources: [{ id: 'old', prior: { origin: 'original', sourceId: 's1' } }, { id: 'new', title: 'New', url: 'https://example.com/new' }] };
  const f = await fixture(t, { result: content, resolve: async () => [{ address: '93.184.216.34' }], send: async calls => {
    assert.deepEqual(await calls.config.hooks.onPreToolUse({ toolName: 'web_fetch', toolCallId: 'new', toolArgs: { url: 'https://example.com/new' } }), {});
    calls.config.hooks.onPostToolUse({ toolName: 'web_fetch', toolCallId: 'new', toolResult: { resultType: 'success', textResultForLlm: 'New read' } });
  } });
  const answer = await f.researcher.runFollowup(prepared.context, { prepared });
  assert.equal(f.calls.prompt, prepared.prompt); assert.equal(f.calls.config.systemMessage.content, prepared.instructions); assert.ok(f.calls.timeout > 0 && f.calls.timeout < 60000);
  assert.equal(answer.sources[0].retrievedAt, '2020-01-01T00:00:00.000Z'); assert.equal(answer.sources[0].provenance, 'imported'); assert.equal(answer.sources[0].evidenceOrigin.origin, 'original');
  assert.equal(answer.sources[1].evidenceOrigin.origin, 'current'); assert.equal(answer.sources[1].provenance, 'recorded-read');
  const [id] = await readdir(join(f.dir, 'usage', 'session-state'));
  const receipt = JSON.parse(await readFile(join(f.dir, 'usage', 'session-state', id, 'operation.json'), 'utf8'));
  assert.equal(receipt.operation, 'research-follow-up'); assert.equal(receipt.status, 'completed');
  assert.deepEqual(await operationEvidence(f.dir), []);
});

test('follow-up attempt and startup budgets count denied attempts and startup time, with cancelled receipts', async t => {
  const doc = createDocument('Budget'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Target' }]); doc.nodes[1].research = result;
  const prepared = prepareFollowup(doc, doc.nodes[1].id, { question: 'Why?', hypothetical: false }, { settings: { depth: 'quick', sourceFocus: 'balanced', recency: 'any' } });
  let now = 0; const timers = []; const clock = { now: () => now, setTimeout(fn, ms) { timers.push(ms); return { unref() {} }; }, clearTimeout() {} };
  const f = await fixture(t, { clock, start: () => { now = 59000; }, send: async calls => { for (let i = 0; i < 9; i++) assert.equal((await calls.config.hooks.onPreToolUse({ toolName: 'denied' })).permissionDecision, 'deny'); } });
  await assert.rejects(f.researcher.runFollowup(prepared.context, { prepared }), /tool-attempt limit/);
  assert.equal(f.calls.timeout, 1000); assert.deepEqual(timers, [60000]); assert.equal(f.calls.stops, 1);
  const [id] = await readdir(join(f.dir, 'usage', 'session-state'));
  const receipt = JSON.parse(await readFile(join(f.dir, 'usage', 'session-state', id, 'operation.json'), 'utf8'));
  assert.equal(receipt.operation, 'research-follow-up'); assert.equal(receipt.status, 'cancelled');
  assert.deepEqual(await operationEvidence(f.dir), []);
});

test('research helper sends the exact prepared context without reselecting or clipping sources', async t => {
  const { researcher, calls } = await fixture(t), doc = createDocument('Unicode 🌿');
  addQuestions(doc, doc.rootId, [{ question: 'Target?', category: 'Target' }]);
  for (let i = 0; i < 8; i++) doc.nodes.push({ ...structuredClone(doc.nodes[1]), id: `source-${i}`, answer: '🌿'.repeat(10000) });
  doc.nodes[2].answer = 'EXCLUDED-SDK-CANARY\u0000\ud83c\udf3f<script>';
  const prepared = prepareResearch(doc, doc.nodes[1].id, { ...researchFraming(doc), excluded: [doc.nodes[2].id] });
  await researcher.run(prepared.context, { prepared });
  assert.equal(calls.prompt, prepared.prompt);
  assert.ok(!calls.prompt.includes('EXCLUDED-SDK-CANARY'));
  assert.equal(calls.config.systemMessage.content, prepared.instructions);
  assert.equal(Buffer.byteLength(calls.prompt) + Buffer.byteLength(calls.config.systemMessage.content), prepared.bytes);
  assert.equal(calls.prompt.split('EXPLORATION DATA\n')[1], JSON.stringify(prepared.context));
  assert.ok(prepared.context.truncated); assert.ok(prepared.bytes <= 131072);
});

test('bounded research context retains committed guidance inside its total budget', () => {
  const compact = boundedContext({ topic: 'A plan', objective: 'Decide for neighbors 🌿', successCriteria: 'Accessible to all', path: [{ question: 'Current question', answer: '' }], decisionsElsewhere: [] });
  assert.equal(compact.objective, 'Decide for neighbors 🌿');
  assert.equal(compact.successCriteria, 'Accessible to all');
  const large = boundedContext({ topic: 'A plan', objective: 'x'.repeat(2000), successCriteria: 'y'.repeat(4000), path: Array.from({ length: 200 }, (_, i) => ({ question: `Question ${i}`, answer: 'a'.repeat(1000) })), decisionsElsewhere: [] });
  assert.equal(large.objective.length, 2000);
  assert.equal(large.successCriteria.length, 4000);
  assert.ok(Buffer.byteLength(JSON.stringify(large)) <= 131072);
  assert.equal(large.truncated, true);
});

const result = { optionsVersion: 1, basis: 'reasoning', summary: 'Comparison', options: [
  { id: 'pilot', title: 'Small', description: 'Pilot', fit: 'When learning comes first.', proposedAnswer: 'I will start small.', pros: ['Simple'], cons: ['Limited'] },
  { id: 'launch', title: 'Large', description: 'Launch', fit: 'When broad reach matters.', proposedAnswer: 'I will launch broadly.', pros: ['Reach'], cons: ['Cost'] },
], recommendation: 'Pilot first.', recommendationAssessment: { optionId: 'pilot', mainTradeoff: 'The first group has limited reach.', reconsiderIf: 'If broad reach is essential immediately, consider the launch.', decisionRefs: [] }, uncertainty: 'No pages read.', sources: [], claims: [{ id: 'c1', text: 'Pilot first', basis: 'reasoning', evidence: [], limitations: 'No externally supported claim.' }] };
const auth = { isAuthenticated: true, login: 'fixture', host: 'github.com' };
const model = { id: 'fixture-model', provider: { kind: 'copilot' }, policy: { state: 'enabled' } };
const expectedTools = [{ name: 'web_fetch' }, { name: 'web_search', namespacedName: 'github-mcp-server/web_search', mcpServerName: 'github-mcp-server', mcpToolName: 'web_search' }];
const context = { topic: 'Pilot', path: [{ question: 'Who first?', answer: 'My decision' }], decisionsElsewhere: [] };

test('research distinguishes provisional states and carries no-text choices and review flags', async t => {
  const { researcher, calls } = await fixture(t);
  await researcher.run({ ...context, path: [{ question: 'Who first?', answer: 'Neighbors', answerState: 'assumption', review: true }], decisionsElsewhere: [{ question: 'When?', answer: '', answerState: 'revisit-later', review: false }, { question: 'What?', answer: '', answerState: 'needs-evidence', review: false }] });
  const supplied = JSON.parse(calls.prompt.split('EXPLORATION DATA\n')[1]);
  assert.equal(supplied.path[0].answerState, 'assumption'); assert.equal(supplied.path[0].review, true);
  assert.equal(supplied.decisionsElsewhere[0].answerState, 'revisit-later'); assert.equal(supplied.decisionsElsewhere[0].answer, '');
  assert.match(calls.prompt, /never external verification/); assert.match(calls.prompt, /Tentative is provisional/); assert.match(calls.prompt, /needs-review/);
});
test('research receives each fixed exploration strategy in its isolated prompt', async t => {
  const { researcher, calls } = await fixture(t);
  const strategies = {
    understand: /concepts, stakeholders and unknowns/i,
    decide: /choices, criteria and tradeoffs/i,
    design: /outcomes, constraints, interfaces and feasibility/i,
    diagnose: /symptoms, reproduction, evidence and alternative causes/i,
    challenge: /assumptions, counterexamples and possible failure conditions/i,
  };
  for (const [mode, strategy] of Object.entries(strategies)) {
    await researcher.run({ ...context, mode });
    assert.match(calls.prompt, strategy);
    assert.match(calls.prompt, new RegExp(`"mode":"${mode}"`));
  }
  assert.equal(calls.sends, 5);
  assert.equal(calls.stops, 5);
});

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-sdk-test-'));
  const calls = { sends: 0, stops: 0 };
  const parent = { rpc: { model: { getCurrent: async () => ({ modelId: options.selectedId ?? model.id }), list: async input => { assert.deepEqual(input, { skipCache: true }); return { list: options.models ?? [model] }; } }, gitHubAuth: { getStatus: async () => options.parentAuth ?? auth } } };
  const runtime = async () => ({ path: process.execPath, sdk: { RuntimeConnection: { forStdio: value => value }, CopilotClient: class {
    constructor(config) { calls.client = config; }
    async start() { await options.start?.(calls); }
    async forceStop() { calls.stops++; await options.stop?.(calls); }
    async createSession(config) {
      calls.config = config;
      return { sessionId: config.sessionId, rpc: { ...parent.rpc,
        model: { ...parent.rpc.model, getCurrent: async () => ({ modelId: options.actualId ?? config.model }) },
        gitHubAuth: { getStatus: async () => options.auth ?? auth },
        metadata: { snapshot: async () => ({ workingDirectory: calls.client.workingDirectory, isRemote: false }) },
        tools: { initializeAndValidate: async () => {}, getCurrentMetadata: async () => ({ tools: options.tools ?? expectedTools }) },
      }, sendAndWait: async (input, timeout) => { calls.sends++; calls.prompt = input.prompt; calls.timeout = timeout; await options.send?.(calls); return { data: { content: options.content ?? JSON.stringify(options.result ?? result) } }; } };
    }
  } } });
  const researcher = createResearcher(parent, { usageDirectory: join(dir, 'usage'), runtime, ...(options.usageRecorder ? { usageRecorder: options.usageRecorder } : {}), ...(options.clock ? { clock: options.clock } : {}), ...(options.now ? { now: options.now } : {}), ...(options.resolve ? { resolve: options.resolve } : {}), ...(options.stopTimeoutMs ? { stopTimeoutMs: options.stopTimeoutMs } : {}) });
  t.after(async () => {
    await researcher.close();
    if (calls.client) { const owned = dirname(calls.client.workingDirectory); assert.equal(dirname(resolve(owned)), resolve(tmpdir())); assert.match(owned, /explorer-research-/); await rm(owned, { recursive: true, force: true }); }
    assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true });
  });
  return { researcher, calls, dir, parent };
}

test('effort stops repeated exact queries, counts denied attempts and reports only after shutdown', async t => {
  let allowed = 0; const reports = [];
  const f = await fixture(t, { send: async calls => {
    for (let i = 0; i < 3; i++) if ((await calls.config.hooks.onPreToolUse({ toolName: 'web_search', toolCallId: 'repeat-' + i, toolArgs: { query: 'same synthetic question' } })).permissionDecision !== 'deny') allowed++;
  } });
  const outcome = await f.researcher.run(context, { onReport: value => { assert.equal(f.calls.stops, 1); reports.push(value); } }).then(() => 'completed', error => error.message);
  t.diagnostic(JSON.stringify({ case: 'repeated-query', allowedSyntheticCalls: allowed, outcome, reports: reports.map(report => ({ reason: report.reason, toolAttempts: report.toolAttempts })) }));
  assert.match(outcome, /repeat/i); assert.equal(allowed, 1); assert.equal(reports.length, 1);
  assert.equal(reports[0].reason, 'repeated-request'); assert.equal(reports[0].toolAttempts, 3); assert.equal(reports[0].duplicateAttempts, 2); assert.equal(reports[0].partial, null);
});

test('effort records early model-assessed completion and leaves ordinary findings unchanged', async t => {
  const assessment = { plan: [{ criterion: 'Local access', neededEvidence: 'Availability of shared space' }], stopReason: 'sufficient-support', explanation: 'Synthetic reasoning is sufficient for this fixture only.' };
  const reports = [];
  const f = await fixture(t, { result: { ...result, effortAssessment: assessment }, send: async calls => {
    await calls.config.hooks.onPreToolUse({ toolName: 'web_search', toolCallId: 'access', toolArgs: { query: 'synthetic access' } });
    calls.config.hooks.onPostToolUse({ toolName: 'web_search', toolCallId: 'access', toolResult: { resultType: 'success', textResultForLlm: 'Synthetic local information.' } });
  } });
  const value = await f.researcher.run(context, { onReport: report => reports.push(report) });
  assert.equal(value.summary, result.summary); assert.equal(Object.hasOwn(value, 'effortAssessment'), false);
  assert.equal(reports[0].reason, 'model-completed'); assert.equal(reports[0].toolAttempts, 1); assert.deepEqual(reports[0].assessment, assessment); assert.equal(reports[0].partial, null);
});

test('checkpoint survives a setup-inclusive deadline while malformed and unrelated events cannot replace it', async t => {
  let elapsed = 0; const reports = [];
  const clock = { now: () => elapsed, setTimeout: () => ({ unref() {} }), clearTimeout() {} };
  const partial = { ...result, summary: 'Valid partial 🌿', recommendationAssessment: { ...result.recommendationAssessment, optionId: null } };
  const event = (findings, fields = {}) => ({ type: 'assistant.message', data: { messageId: 'checkpoint-one', content: JSON.stringify({ checkpointVersion: 1, findings }) }, ...fields });
  const f = await fixture(t, { clock, start: () => { elapsed = 59000; }, content: '{unfinished', send: async calls => {
    calls.config.onEvent(event(partial));
    const other = { ...partial, summary: 'Do not retain this other message' };
    calls.config.onEvent(event(other, { agentId: 'subagent', data: { ...event(other).data, messageId: 'subagent-message' } }));
    calls.config.onEvent(event(other, { checkpoint: true, data: { ...event(other).data, messageId: 'replay-message' } }));
    calls.config.onEvent(event(other, { data: { ...event(other).data, messageId: 'split-message', chunkCount: 2, chunkIndex: 0 } }));
    calls.config.onEvent({ type: 'assistant.message.delta', data: { deltaContent: JSON.stringify({ checkpointVersion: 1, findings: other }) } });
    calls.config.onEvent(event({ ...other, unknownField: true }, { data: { ...event({ ...other, unknownField: true }).data, messageId: 'malformed-message' } }));
    elapsed = 61000;
    calls.config.onEvent(event(other, { data: { ...event(other).data, messageId: 'late-message' } }));
  } });
  await assert.rejects(f.researcher.run(context, { settings: { depth: 'quick', sourceFocus: 'balanced', recency: 'any' }, onReport: report => reports.push(report) }), /timed out|deadline/i);
  assert.equal(f.calls.timeout, 1000); assert.equal(f.calls.stops, 1); assert.equal(reports.length, 1);
  assert.equal(reports[0].reason, 'deadline'); assert.equal(reports[0].elapsedMs, 61000);
  assert.equal(reports[0].partial.summary, partial.summary); assert.equal(reports[0].partial.recommendationAssessment.optionId, null);
});

test('checkpoint never retains an unread citation, recommendation winner, oversized body or malformed fragment', async t => {
  let elapsed = 0; const reports = [];
  const clock = { now: () => elapsed, setTimeout: () => ({ unref() {} }), clearTimeout() {} };
  const partial = { ...result, recommendationAssessment: { ...result.recommendationAssessment, optionId: null } };
  const f = await fixture(t, { clock, send: async calls => {
    const bodies = [result, { ...partial, basis: 'sources', sources: [{ id: 's1', title: 'Unread', url: 'https://example.com/unread' }] }, { ...partial, summary: 'x'.repeat(90000) }];
    for (const [index, findings] of bodies.entries()) calls.config.onEvent({ type: 'assistant.message', data: { messageId: `invalid-${index}`, content: JSON.stringify({ checkpointVersion: 1, findings }) } });
    calls.config.onEvent({ type: 'assistant.message', data: { messageId: 'fragment', content: '{"checkpointVersion":1,"findings":' } });
    elapsed = 180001;
  } });
  await assert.rejects(f.researcher.run(context, { onReport: report => reports.push(report) }), /timed out|deadline/i);
  assert.equal(reports.length, 1); assert.equal(reports[0].partial, null);
});

test('effort bounds delivered page text and cannot cite a date outside the delivered prefix', async t => {
  const findings = freshnessFindings(); findings.sources[0].dateObservations = [{ kind: 'updated', text: 'Updated: 2026-11-20' }];
  let delivered;
  const f = await fixture(t, { result: findings, now: () => FRESHNESS_NOW, resolve: async () => [{ address: '93.184.216.34' }], send: async calls => {
    await calls.config.hooks.onPreToolUse({ toolName: 'web_fetch', toolCallId: 'bounded-read', toolArgs: { url: findings.sources[0].url } });
    delivered = calls.config.hooks.onPostToolUse({ toolName: 'web_fetch', toolCallId: 'bounded-read', toolResult: { resultType: 'success', textResultForLlm: 'x'.repeat(32768) + 'Updated: 2026-11-20', binaryResultsForLlm: [{ data: 'not retained' }] } });
  } });
  const outcome = await f.researcher.run(context).then(() => 'accepted', error => error.message);
  assert.match(outcome, /invalid comparison/); assert.equal(delivered.modifiedResult.textResultForLlm.length, 32768);
  assert.equal(Object.hasOwn(delivered.modifiedResult, 'binaryResultsForLlm'), false); assert.match(delivered.additionalContext, /truncat|prefix/i);
});

test('effort stops failed fetch retries without crediting the failed page', async t => {
  const reports = []; let retry;
  const f = await fixture(t, { resolve: async () => [{ address: '93.184.216.34' }], send: async calls => {
    await calls.config.hooks.onPreToolUse({ toolName: 'web_fetch', toolCallId: 'failed-read', toolArgs: { url: 'https://example.com/page' } });
    calls.config.hooks.onPostToolUseFailure({ toolName: 'web_fetch', toolCallId: 'failed-read', error: 'synthetic failure' });
    retry = await calls.config.hooks.onPreToolUse({ toolName: 'web_fetch', toolCallId: 'retry-read', toolArgs: { url: 'https://example.com/page' } });
  } });
  await assert.rejects(f.researcher.run(context, { onReport: report => reports.push(report) }), /source failed/i);
  assert.equal(retry.permissionDecision, 'deny'); assert.equal(reports[0].reason, 'tool-failure'); assert.equal(reports[0].partial, null); assert.equal(f.calls.sends, 1);
});

test('checkpoint reports are withheld after user cancellation or failed cleanup', async t => {
  for (const cleanup of [false, true]) {
    const reports = [], abort = new AbortController();
    const partial = { ...result, recommendationAssessment: { ...result.recommendationAssessment, optionId: null } };
    const f = await fixture(t, { ...(cleanup ? { stop: async () => { throw Error('synthetic stop failure'); } } : {}), send: async calls => {
      calls.config.onEvent({ type: 'assistant.message', data: { messageId: 'one', content: JSON.stringify({ checkpointVersion: 1, findings: partial }) } });
      if (!cleanup) abort.abort();
    } });
    await assert.rejects(f.researcher.run(context, { signal: abort.signal, onReport: report => reports.push(report) }), cleanup ? /cleanup or usage accounting failed/ : /cancelled/);
    assert.equal(reports.length, 0);
  }
});

test('follow-up checkpoints retain only validated answers to the captured hypothetical question', async t => {
  const doc = createDocument('Follow-up checkpoint'); addQuestions(doc, doc.rootId, [{ question: 'Which pilot?', category: 'Scope' }]); doc.nodes[1].research = result;
  const prepared = prepareFollowup(doc, doc.nodes[1].id, { question: 'What if capacity doubles? 🌿', hypothetical: true });
  const partial = { answer: 'Capacity might justify a wider pilot, but access is still unknown.', uncertainty: 'Incomplete hypothetical judgment.', sources: [], claims: [{ id: 'capacity', text: 'A wider pilot may fit.', basis: 'reasoning', evidence: [], limitations: 'Not externally verified.' }] };
  let elapsed = 0; const reports = [];
  const f = await fixture(t, { clock: { now: () => elapsed, setTimeout: () => ({ unref() {} }), clearTimeout() {} }, send: async calls => {
    assert.ok(calls.prompt.includes('What if capacity doubles? 🌿'));
    calls.config.onEvent({ type: 'assistant.message', data: { messageId: 'followup-checkpoint', content: JSON.stringify({ checkpointVersion: 1, findings: partial }) } });
    elapsed = 180001;
  } });
  await assert.rejects(f.researcher.runFollowup(prepared.context, { prepared, onReport: value => reports.push(value) }), /timed out|deadline/i);
  assert.deepEqual(reports[0].partial, partial); assert.equal(reports[0].reason, 'deadline'); assert.equal(f.calls.sends, 1);
});

test('checkpoint attempt ceiling preserves the last valid bounded message and ignores absent IDs', async t => {
  let elapsed = 0; const reports = [], partial = { ...result, recommendationAssessment: { ...result.recommendationAssessment, optionId: null } };
  const f = await fixture(t, { clock: { now: () => elapsed, setTimeout: () => ({ unref() {} }), clearTimeout() {} }, send: async calls => {
    const send = (messageId, findings) => calls.config.onEvent({ type: 'assistant.message', data: { messageId, content: JSON.stringify({ checkpointVersion: 1, findings }) } });
    send('first', { ...partial, summary: 'Keep this checkpoint' });
    for (let i = 0; i < 3; i++) send('invalid-' + i, { ...partial, unsupported: true });
    send('fifth', { ...partial, summary: 'Too many checkpoints' }); send(undefined, { ...partial, summary: 'No ID' });
    elapsed = 180001;
  } });
  await assert.rejects(f.researcher.run(context, { onReport: value => reports.push(value) }), /timed out|deadline/i);
  assert.equal(reports[0].partial.summary, 'Keep this checkpoint');
});

test('completed comparison and follow-up never inherit an earlier checkpoint assessment', async t => {
  for (const followup of [false, true]) {
    const final = followup ? { answer: 'Complete answer.', uncertainty: 'Fixture judgment.', sources: [], claims: result.claims } : result;
    const partial = { ...final, ...(!followup ? { recommendationAssessment: { ...result.recommendationAssessment, optionId: null } } : {}),
      effortAssessment: { plan: [{ criterion: 'Access', neededEvidence: 'Opening hours' }], stopReason: 'in-progress', explanation: 'Still investigating.' } };
    const reports = [], f = await fixture(t, { result: final, send: async calls => {
      calls.config.onEvent({ type: 'assistant.message', data: { messageId: 'in-progress', content: JSON.stringify({ checkpointVersion: 1, findings: partial }) } });
    } });
    let prepared;
    if (followup) { const doc = createDocument('Scope'); addQuestions(doc, doc.rootId, [{ question: 'Which pilot?', category: 'Scope' }]); doc.nodes[1].research = result; prepared = prepareFollowup(doc, doc.nodes[1].id, { question: 'What if?', hypothetical: true }); }
    const value = await f.researcher[followup ? 'runFollowup' : 'run'](prepared?.context ?? context, { ...(prepared ? { prepared } : {}), onReport: report => reports.push(effortReport(report, () => assert.fail('Complete report has no partial'))) });
    assert.equal(value.summary ?? value.answer, final.summary ?? final.answer); assert.equal(reports[0].assessment, null);
  }
});

test('tool result accounting consumes each matching accepted callback once and suppresses unmatched payloads', async t => {
  for (const toolName of ['web_search', 'web_fetch']) {
    const reports = [], f = await fixture(t, { resolve: async () => [{ address: '93.184.216.34' }], send: async calls => {
      const input = { toolName, toolCallId: 'one-call', toolArgs: toolName === 'web_fetch' ? { url: 'https://example.com/page' } : { query: 'one query' } };
      const post = data => calls.config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: 'x'.repeat(40000), binaryResultsForLlm: [{ data: 'omit' }] }, ...data });
      assert.deepEqual(await calls.config.hooks.onPreToolUse(input), {});
      for (const data of [{ toolCallId: 'unknown' }, { toolName: toolName === 'web_fetch' ? 'web_search' : 'web_fetch' }]) assert.equal(post(data).modifiedResult.textResultForLlm, '');
      assert.equal(post().modifiedResult.textResultForLlm.length, toolName === 'web_fetch' ? 32768 : 8192);
      for (let i = 0; i < 25; i++) { const duplicate = post(); assert.equal(duplicate.modifiedResult.textResultForLlm, ''); assert.equal(Object.hasOwn(duplicate.modifiedResult, 'binaryResultsForLlm'), false); }
      calls.config.hooks.onPostToolUseFailure({ ...input, error: 'Stale duplicate failure' });
    } });
    await f.researcher.run(context, { onReport: report => reports.push(effortReport(report, () => assert.fail('No checkpoint'))) });
    assert.equal(reports[0].toolAttempts, 1); assert.equal(reports[0].truncatedResults, 1); assert.equal(reports[0].deliveredTextUnits, toolName === 'web_fetch' ? 32768 : 8192);
  }
});

test('malformed accepted results and missing or oversized search tracking IDs fail closed', async t => {
  for (const kind of ['binary-only', 'missing-id', 'oversized-id']) {
    const f = await fixture(t, { send: async calls => {
      const input = { toolName: 'web_search', toolArgs: { query: 'query' }, ...(kind === 'missing-id' ? {} : { toolCallId: kind === 'oversized-id' ? 'x'.repeat(257) : 'accepted' }) };
      await calls.config.hooks.onPreToolUse(input);
      if (kind === 'binary-only') {
        const output = calls.config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', binaryResultsForLlm: [{ data: 'not model input' }] } });
        assert.deepEqual(output.modifiedResult, { resultType: 'success', textResultForLlm: '' });
      }
    } });
    await assert.rejects(f.researcher.run(context), /tracking|invalid.*result/i);
  }
});

test('Research model discovery does not start a helper and reviewed dedicated/default models are pinned with receipts', async t => {
  for (const modelId of [null, 'dedicated-model']) {
    const options = { models: [model, { ...model, id: 'dedicated-model', name: 'Dedicated' }] };
    const f = await fixture(t, options), metadata = await f.researcher.models();
    assert.equal(f.calls.sends, 0); assert.equal(f.calls.client, undefined);
    const { captureResearchModel } = await import('../com.github.copilot/extensions/explorer/research-model.mjs');
    const modelCapture = captureResearchModel(metadata, { revision: 1, modelId });
    options.selectedId = 'dedicated-model';
    const doc = createDocument('Pinned'); addQuestions(doc, doc.rootId, [{ question: 'What?', category: 'Target' }]);
    const prepared = { ...prepareResearch(doc, doc.nodes[1].id, researchFraming(doc)), modelCapture };
    await f.researcher.run(prepared.context, { prepared });
    assert.equal(f.calls.config.model, modelId ?? model.id); assert.equal(f.calls.sends, 1);
    assert.equal(f.calls.prompt.includes('modelCapture'), false); assert.equal(f.calls.prompt.includes('fixture-model'), false);
    const [id] = await readdir(join(f.dir, 'usage', 'session-state'));
    const receipt = JSON.parse(await readFile(join(f.dir, 'usage', 'session-state', id, 'operation.json'), 'utf8'));
    assert.equal(receipt.model, modelId ?? model.id); assert.equal(receipt.status, 'completed');
  }
});

test('research helper preserves scoped conflicts and gaps with real hook attribution and captured constraint state', async t => {
  const doc = createDocument('Limitations fixture'), [target, prior] = addQuestions(doc, doc.rootId, [{ question: 'Where?', category: 'Storage' }, { question: 'Access?', category: 'Access' }]);
  answerNode(doc, prior.id, 'Appointment only and at any time.', 'assumption'); prior.review = true;
  const prepared = prepareResearch(doc, target.id, researchFraming(doc));
  assert.match(prepared.instructions, /"limitations": \[/); assert.match(prepared.instructions, /counting|vote/i);
  for (const kind of ['conflict', 'dependent-sources', 'sparse', 'unavailable', 'constraints', 'invalid-winner']) {
    const raw = limitationFindings(kind === 'invalid-winner' ? 'conflict' : kind, prior.id);
    raw.sources = raw.sources.map(({ id, title, url }) => ({ id, title, url }));
    raw.recommendationAssessment.decisionRefs = raw.recommendationAssessment.decisionRefs.map(({ nodeId, reason }) => ({ nodeId, reason }));
    if (kind === 'invalid-winner') raw.recommendationAssessment.optionId = 'cupboard';
    const f = await fixture(t, { result: raw, resolve: async () => [{ address: '93.184.216.34' }], send: async calls => {
      for (const source of raw.sources) {
        assert.deepEqual(await calls.config.hooks.onPreToolUse({ toolName: 'web_fetch', toolCallId: source.id, toolArgs: { url: source.url } }), {});
        calls.config.hooks.onPostToolUse({ toolName: 'web_fetch', toolCallId: source.id, toolResult: { resultType: 'success', textResultForLlm: 'Synthetic conflicting or dependent schedule, not independent verification.' } });
      }
    } });
    if (kind === 'invalid-winner') await assert.rejects(f.researcher.run(prepared.context, { prepared }), /invalid comparison/);
    else {
      const output = await f.researcher.run(prepared.context, { prepared });
      assert.deepEqual(output.limitations, raw.limitations); assert.equal(output.recommendationAssessment.optionId, null);
      assert.ok(output.sources.every(source => source.provenance === 'recorded-read'));
      if (kind === 'constraints') assert.deepEqual(output.recommendationAssessment.decisionRefs[0], { ...raw.recommendationAssessment.decisionRefs[0], answerState: 'assumption', review: true });
      assert.equal(f.calls.prompt, prepared.prompt); assert.equal(f.calls.config.systemMessage.content, prepared.instructions);
    }
  }
});

test('research helper links exact tradeoffs to observed reads and captured user intent without claiming verification', async t => {
  const doc = createDocument('Support fixture'), [target, prior] = addQuestions(doc, doc.rootId, [{ question: 'Where?', category: 'Storage' }, { question: 'Access?', category: 'Access' }]);
  answerNode(doc, prior.id, 'Two key holders might help.', 'assumption'); prior.review = true;
  const prepared = prepareResearch(doc, target.id, researchFraming(doc));
  assert.match(prepared.instructions, /"support"/);
  for (const mode of ['valid', 'changed-text', 'missing-source', 'unknown-context']) {
    const raw = supportFindings(prior.id); raw.sources = raw.sources.map(({ id, title, url }) => ({ id, title, url }));
    raw.recommendationAssessment.decisionRefs = raw.recommendationAssessment.decisionRefs.map(({ nodeId, reason }) => ({ nodeId, reason }));
    if (mode === 'changed-text') raw.options[0].pros[0] = 'A revised factual claim.';
    if (mode === 'missing-source') raw.claims[0].evidence[0].sourceId = 'missing';
    if (mode === 'unknown-context') raw.support[2].decisionIds = ['not-reviewed'];
    const f = await fixture(t, { result: raw, resolve: async () => [{ address: '93.184.216.34' }], send: async calls => {
      assert.deepEqual(await calls.config.hooks.onPreToolUse({ toolName: 'web_fetch', toolCallId: 'support-read', toolArgs: { url: 'https://example.com/hours' } }), {});
      calls.config.hooks.onPostToolUse({ toolName: 'web_fetch', toolCallId: 'support-read', toolResult: { resultType: 'success', textResultForLlm: 'The office closes on Sunday. No fee information.' } });
    } });
    if (mode !== 'valid') await assert.rejects(f.researcher.run(prepared.context, { prepared }), /invalid comparison/);
    else {
      const result = await f.researcher.run(prepared.context, { prepared });
      assert.deepEqual(result.support, raw.support); assert.equal(result.sources[0].provenance, 'recorded-read');
      assert.match(result.claims[0].limitations, /contradicts/); assert.match(result.claims[1].limitations, /irrelevant/);
      assert.equal(result.recommendationAssessment.decisionRefs[0].answerState, 'assumption'); assert.equal(result.recommendationAssessment.decisionRefs[0].review, true);
      assert.equal(f.calls.prompt, prepared.prompt); assert.equal(f.calls.config.systemMessage.content, prepared.instructions);
    }
  }
});

test('Research reviewed model rejects changed accounts, policy and actual helper model without fallback', async t => {
  const { captureResearchModel } = await import('../com.github.copilot/extensions/explorer/research-model.mjs');
  for (const change of [options => { options.parentAuth = { ...auth, login: 'other' }; }, options => { options.models = [{ ...model, policy: { state: 'disabled' } }]; }, options => { options.actualId = 'substituted'; }]) {
    const options = {}, f = await fixture(t, options), modelCapture = captureResearchModel(await f.researcher.models(), { revision: 0, modelId: null });
    change(options);
    const doc = createDocument('Review'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Target' }]);
    const prepared = { ...prepareResearch(doc, doc.nodes[1].id, researchFraming(doc)), modelCapture };
    await assert.rejects(f.researcher.run(prepared.context, { prepared }));
    assert.equal(f.calls.sends, 0);
  }
});

test('Research discovery supports dedicated choice when the chat model is unavailable and sanitizes catalog failures', async t => {
  const f = await fixture(t); f.parent.rpc.model.getCurrent = async () => { throw Error('PRIVATE-CURRENT-ERROR'); };
  const metadata = await f.researcher.models(); assert.equal(metadata.selectedId, null); assert.equal(metadata.models[0].id, model.id); assert.equal(f.calls.sends, 0);
  f.parent.rpc.model.list = async () => { throw Error('PRIVATE-CATALOG-ERROR'); };
  await assert.rejects(f.researcher.models(), error => /catalog/.test(error.message) && !error.message.includes('PRIVATE'));
  assert.equal(f.calls.client, undefined);
});

test('helper uses isolated configuration, explicit research instructions, exact tools and no parent send', async t => {
  const { researcher, calls } = await fixture(t);
  assert.deepEqual(await researcher.run(context), { ...result, settings: researchSettings() });
  assert.ok(calls.timeout > 170000 && calls.timeout <= 180000);
  assert.equal(calls.sends, 1); assert.equal(calls.stops, 1);
  assert.equal(calls.config.requestExtensions, false); assert.equal(calls.config.enableFileHooks, false);
  assert.equal(calls.config.enableConfigDiscovery, true); assert.equal(calls.client.useLoggedInUser, true);
  assert.match(calls.config.systemMessage.content, /explorer-research/);
  assert.match(calls.prompt, /My decision/);
  assert.deepEqual(calls.config.availableTools, ['builtin:web_fetch', 'mcp:web_search']);
  await assert.rejects(stat(calls.client.workingDirectory), { code: 'ENOENT' });
});

test('missing search or mismatched account prevents inference', async t => {
  for (const options of [{ tools: [{ name: 'web_fetch' }] }, { auth: { ...auth, login: 'other' } }]) {
    const { researcher, calls } = await fixture(t, options);
    await assert.rejects(researcher.run(context)); assert.equal(calls.sends, 0); assert.equal(calls.stops, 1);
  }
});

test('cancelling during startup never sends and stops the owned client', async t => {
  const controller = new AbortController();
  const { researcher, calls } = await fixture(t, { start: () => controller.abort() });
  await assert.rejects(researcher.run(context, { signal: controller.signal }), /cancelled/);
  assert.equal(calls.sends, 0); assert.equal(calls.stops, 1);
});

test('evidence age changing during startup or awaited model accounting stops before any inference', async t => {
  for (const phase of ['startup', 'accounting']) {
    const doc = createDocument('Age boundary'), [node] = addQuestions(doc, doc.rootId, [{ question: 'Current access?', category: 'Access' }]); node.research = freshnessFindings();
    let now = FRESHNESS_NOW + 86400000 - 1;
    const prepared = prepareFollowup(doc, node.id, { question: 'Why?', hypothetical: false }, { now });
    const f = await fixture(t, { now: () => now, start: () => { if (phase === 'startup') now++; },
      usageRecorder: async (...args) => { const recorder = await createUsageRecorder(...args); return { ...recorder, async captureModel(id) { await recorder.captureModel(id); if (phase === 'accounting') now++; } }; } });
    await assert.rejects(f.researcher.runFollowup(prepared.context, { prepared }), /freshness.*changed/i);
    assert.equal(f.calls.sends, 0); assert.equal(f.calls.stops, 1);
  }
});

test('source date labels bind to the first correlated successful read without retaining full page text', async t => {
  const raw = freshnessFindings('durable-concept'), source = raw.sources[0]; let now = FRESHNESS_NOW;
  const f = await fixture(t, { result: raw, now: () => now, resolve: async () => [{ address: '93.184.216.34' }], send: async ({ config }) => {
    const first = { toolName: 'web_fetch', toolCallId: 'first-date', toolArgs: { url: source.url } };
    await config.hooks.onPreToolUse(first);
    config.hooks.onPostToolUse({ ...first, toolResult: { resultType: 'success', textResultForLlm: 'PRIVATE_PAGE_BODY\nUpdated: 2026-11-20\nOnly the short label is retained.' } });
    now += 1000;
    const second = { ...first, toolCallId: 'second-date' }; await config.hooks.onPreToolUse(second);
    config.hooks.onPostToolUse({ ...second, toolResult: { resultType: 'success', textResultForLlm: 'Updated: 2026-11-21' } });
  } });
  const output = await f.researcher.run(context);
  assert.equal(output.sources[0].retrievedAt, new Date(FRESHNESS_NOW).toISOString());
  assert.deepEqual(output.sources[0].dateObservations, source.dateObservations);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_PAGE_BODY|Only the short label/);
});

test('unobserved, later-read and over-budget date labels cannot become supported source dates', async t => {
  for (const mode of ['unobserved', 'later-read', 'page-limit', 'request-limit']) {
    const raw = freshnessFindings('durable-concept'), source = raw.sources[0];
    const f = await fixture(t, { result: raw, now: () => FRESHNESS_NOW, resolve: async () => [{ address: '93.184.216.34' }], send: async ({ config }) => {
      const read = async (id, url, text) => { const input = { toolName: 'web_fetch', toolCallId: id, toolArgs: { url } }; await config.hooks.onPreToolUse(input); config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: text } }); };
      if (mode === 'request-limit') for (let i = 0; i < 16; i++) await read(`filler-${i}`, `https://example.com/filler-${i}`, 'x'.repeat(65536));
      await read('date-page', source.url, mode === 'request-limit' ? source.dateObservations[0].text : mode === 'page-limit' ? 'x'.repeat(65536) + source.dateObservations[0].text : 'No publication date is available.');
      if (mode === 'later-read') await read('later', source.url, source.dateObservations[0].text);
    } });
    await assert.rejects(f.researcher.run(context), mode === 'request-limit' ? /delivered evidence-text limit/ : /date|invalid comparison/, mode);
  }
});

test('research rejects a current winner grounded in an expired volatile premise but retains honest abstention', async t => {
  for (const abstain of [false, true]) {
    const raw = freshnessFindings(); raw.sources[0].dateObservations[0].text = 'Updated: 2020-01-01';
    if (abstain) {
      raw.recommendationAssessment.optionId = null; raw.recommendation = 'Obtain the current schedule before choosing.';
      raw.support[0].text = raw.recommendation;
      raw.limitations = [{ id: 'expired', kind: 'missing-evidence', summary: 'The schedule is historical.', claimIds: ['access'], optionIds: [], decisionIds: [], blocksRecommendation: true, nextStep: 'Obtain the current schedule.' }];
    }
    const f = await fixture(t, { result: raw, now: () => FRESHNESS_NOW, resolve: async () => [{ address: '93.184.216.34' }], send: async ({ config }) => {
      const input = { toolName: 'web_fetch', toolCallId: 'old-page', toolArgs: { url: raw.sources[0].url } }; await config.hooks.onPreToolUse(input);
      config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: raw.sources[0].dateObservations[0].text } });
    } });
    if (!abstain) await assert.rejects(f.researcher.run(context), /freshness|current|outdated/i);
    else { const output = await f.researcher.run(context); assert.equal(output.recommendationAssessment.optionId, null); assert.equal(output.claims.length, 1); assert.deepEqual(output.limitations, raw.limitations); }
  }
});

test('follow-up preserves prior date labels and validates only actually read new date observations', async t => {
  for (const observed of [true, false]) {
    const doc = createDocument('Date followup'); const [node] = addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Access' }]); node.research = freshnessFindings('durable-concept');
    const prepared = prepareFollowup(doc, node.id, { question: 'Explain the historical schedule.', hypothetical: false }, { now: FRESHNESS_NOW });
    const raw = { answer: 'Historical schedules remain conditional.', uncertainty: 'Not current verification.', claims: [{ ...node.research.claims[0], evidence: [{ sourceId: 'old', paraphrase: 'Prior schedule' }, { sourceId: 'new', paraphrase: 'Another schedule' }] }],
      sources: [{ id: 'old', prior: { origin: 'original', sourceId: 'host' } }, { id: 'new', title: 'New read', url: 'https://example.com/new', dateObservations: [{ kind: 'published', text: 'Published: 2026-11-19' }] }] };
    const f = await fixture(t, { result: raw, now: () => FRESHNESS_NOW, resolve: async () => [{ address: '93.184.216.34' }], send: async ({ config }) => {
      const input = { toolName: 'web_fetch', toolCallId: 'new-date', toolArgs: { url: raw.sources[1].url } }; await config.hooks.onPreToolUse(input);
      config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: observed ? raw.sources[1].dateObservations[0].text : 'Undated response' } });
    } });
    if (!observed) await assert.rejects(f.researcher.runFollowup(prepared.context, { prepared }), /date|source/i);
    else {
      const output = await f.researcher.runFollowup(prepared.context, { prepared });
      assert.deepEqual(output.sources[0].dateObservations, node.research.sources[0].dateObservations); assert.equal(output.sources[0].evidenceOrigin.origin, 'original');
      assert.deepEqual(output.sources[1].dateObservations, raw.sources[1].dateObservations); assert.equal(output.sources[1].retrievedAt, new Date(FRESHNESS_NOW).toISOString());
    }
  }
});

test('unread citations are rejected; successful page reads are required for sourced findings', async t => {
  const sourced = { ...result, basis: 'sources', sources: [{ id: 's1', title: 'Source', url: 'https://8.8.8.8/reference' }] };
  const bad = await fixture(t, { result: sourced });
  await assert.rejects(bad.researcher.run(context), /sources/);
  const good = await fixture(t, { result: sourced, send: async ({ config }) => {
    const input = { toolName: 'web_fetch', toolArgs: { url: sourced.sources[0].url }, toolCallId: 'read1' };
    assert.notEqual((await config.hooks.onPreToolUse(input))?.permissionDecision, 'deny');
    await config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: 'Reference content' } });
  } });
  const observed = await good.researcher.run(context);
  assert.equal(observed.sources[0].provenance, 'recorded-read'); assert.ok(Number.isFinite(Date.parse(observed.sources[0].retrievedAt)));
  assert.deepEqual(observed, { ...sourced, sources: [{ ...sourced.sources[0], retrievedAt: observed.sources[0].retrievedAt, provenance: 'recorded-read' }], settings: researchSettings() });
});

test('overlapping fetches without hook IDs cannot credit an unread page', async t => {
  const sourced = { ...result, basis: 'sources', sources: [{ id: 's1', title: 'Unread B', url: 'https://8.8.8.8/b' }] };
  const { researcher } = await fixture(t, { result: sourced, send: async ({ config }) => {
    const a = { toolName: 'web_fetch', toolArgs: { url: 'https://8.8.8.8/a' } };
    const b = { toolName: 'web_fetch', toolArgs: { url: 'https://8.8.8.8/b' } };
    await config.hooks.onPreToolUse(a); await config.hooks.onPreToolUse(b);
    config.hooks.onPostToolUse({ ...a, toolResult: { resultType: 'success', textResultForLlm: 'Only A was read' } });
    config.hooks.onPostToolUse({ ...b, toolResult: { resultType: 'failure', textResultForLlm: 'B failed' } });
  } });
  await assert.rejects(researcher.run(context), /tracking|sources/);
});

test('claim provenance uses actual successful read time, requested URL and this request only', async t => {
  const url = 'https://8.8.8.8/reference?q=1', sourced = { ...result, basis: 'sources', sources: [{ id: 's1', title: 'Reference', url, retrievedAt: '1900-01-01T00:00:00.000Z', provenance: 'forged' }], claims: [{ id: 'c1', text: 'A model assertion', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'A model interpretation of content' }], limitations: 'Read does not verify meaning.' }] };
  let afterRead, beforeRead, runs = 0;
  const f = await fixture(t, { result: sourced, send: async ({ config }) => {
    if (++runs > 1) return;
    const input = { toolName: 'web_fetch', toolArgs: { url: url + '#part' }, toolCallId: 'read-exact' };
    await config.hooks.onPreToolUse(input);
    beforeRead = Date.now();
    config.hooks.onPostToolUse({ ...input, toolResult: { resultType: 'success', textResultForLlm: 'Actual content', finalUrl: 'https://other.example/redirect' } });
    afterRead = Date.now();
  } });
  const observed = await f.researcher.run(context), source = observed.sources[0];
  assert.equal(source.url, url); assert.equal(source.provenance, 'recorded-read');
  assert.ok(Date.parse(source.retrievedAt) >= beforeRead && Date.parse(source.retrievedAt) <= afterRead);
  assert.deepEqual(observed.claims, sourced.claims); assert.equal(source.finalUrl, undefined);
  await assert.rejects(f.researcher.run(context), /sources.*read/);
});

test('search, blank, failed, mismatched and duplicate fetch IDs cannot fabricate claim provenance', async t => {
  const source = { id: 's1', title: 'Source', url: 'https://8.8.8.8/a' };
  for (const mode of ['search', 'blank', 'failed', 'mismatched', 'duplicate']) {
    const f = await fixture(t, { result: { ...result, basis: 'sources', sources: [source] }, send: async ({ config }) => {
      const input = { toolName: mode === 'search' ? 'web_search' : 'web_fetch', toolArgs: mode === 'search' ? { query: 'source' } : { url: source.url }, toolCallId: 'read' };
      await config.hooks.onPreToolUse(input);
      if (mode === 'duplicate') await config.hooks.onPreToolUse({ ...input, toolArgs: { url: 'https://8.8.8.8/b' } });
      if (mode === 'failed') config.hooks.onPostToolUseFailure({ ...input, error: 'Fetch failed' });
      config.hooks.onPostToolUse({ ...input, toolCallId: mode === 'mismatched' ? 'other' : 'read', toolResult: { resultType: 'success', textResultForLlm: mode === 'blank' ? '  ' : 'Page' } });
    } });
    await assert.rejects(f.researcher.run(context), mode === 'failed' ? /source failed/ : /sources.*read|tracking/, mode);
  }
});

test('new helper results require claim records and enforce raw UTF-8 output envelope', async t => {
  const missing = { ...result }; delete missing.claims;
  const f = await fixture(t, { result: missing }); await assert.rejects(f.researcher.run(context), /invalid comparison/);
  const huge = { ...result, summary: '界'.repeat(5000), recommendation: '界'.repeat(5000), options: Array.from({ length: 4 }, () => ({ title: 'Option', description: '界'.repeat(3000), pros: Array(6).fill('界'.repeat(1000)), cons: [], proposedAnswer: '界'.repeat(5000) })) };
  assert.ok(JSON.stringify(huge).length < 80000); assert.ok(Buffer.byteLength(JSON.stringify(huge)) > 160000);
  const h = await fixture(t, { result: huge }); await assert.rejects(h.researcher.run(context), /invalid comparison/);
});

test('new helper comparisons require concise option identity while accepting honest sparse results', async t => {
  const legacy = structuredClone(result); delete legacy.optionsVersion;
  for (const option of legacy.options) { delete option.id; delete option.fit; }
  const old = await fixture(t, { result: legacy }); await assert.rejects(old.researcher.run(context), /invalid comparison/);
  for (const count of [0, 1]) {
    const limited = structuredClone(result); limited.options.length = count; limited.optionsLimit = 'More evidence is needed to compare alternatives.';
    limited.recommendationAssessment.optionId = null;
    const current = await fixture(t, { result: limited });
    assert.deepEqual(await current.researcher.run(context), { ...limited, settings: researchSettings() });
  }
});

test('raw Unicode bytes and SDK character envelope accept their exact boundaries and reject one over', async t => {
  const value = { ...result, summary: '界'.repeat(5000), recommendation: '界'.repeat(800), uncertainty: '界'.repeat(3000),
    recommendationAssessment: { ...result.recommendationAssessment, mainTradeoff: '界'.repeat(600), reconsiderIf: '界'.repeat(600) },
    options: result.options.map(option => ({ ...option, description: '界'.repeat(600), fit: '界'.repeat(400), proposedAnswer: option.id + '界'.repeat(980), pros: Array(4).fill('界'.repeat(240)), cons: Array(4).fill('界'.repeat(240)), details: Array.from({ length: 4 }, () => ({ label: '界'.repeat(80), value: '界'.repeat(1000) })) })),
    claims: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, text: '界'.repeat(1000), basis: 'reasoning', evidence: [], limitations: '界'.repeat(1000) })) };
  const json = JSON.stringify(value), raw = json + ' '.repeat(160000 - Buffer.byteLength(json));
  assert.ok(raw.length < 80000); assert.equal(Buffer.byteLength(raw), 160000);
  const exact = await fixture(t, { content: raw }); assert.deepEqual(await exact.researcher.run(context), { ...value, settings: researchSettings() });
  const over = await fixture(t, { content: raw + ' ' }); await assert.rejects(over.researcher.run(context), /invalid comparison/);
  const small = JSON.stringify(result), chars = small + ' '.repeat(80000 - small.length);
  const exactChars = await fixture(t, { content: chars }); assert.deepEqual(await exactChars.researcher.run(context), { ...result, settings: researchSettings() });
  const overChars = await fixture(t, { content: chars + ' ' }); await assert.rejects(overChars.researcher.run(context), /invalid comparison/);
});

test('helper denies managed approval, sandbox bypass and unrelated permissions', async t => {
  const { researcher, calls } = await fixture(t); await researcher.run(context);
  const permit = calls.config.onPermissionRequest;
  for (const request of [{ kind: 'shell' }, { kind: 'read' }, { kind: 'url', url: 'http://127.0.0.1' }, { kind: 'url', url: 'https://8.8.8.8', managedApprovalRequired: true }, { kind: 'url', url: 'https://8.8.8.8', requestSandboxBypass: true }, { kind: 'mcp', serverName: 'other', toolName: 'web_search' }]) assert.equal((await permit(request, {})).kind, 'denied-by-rules');
  assert.equal((await permit({ kind: 'url', url: 'https://8.8.8.8' }, { promptRequest: { managedApprovalRequired: true } })).kind, 'denied-by-rules');
});

test('managed human approval or sandbox bypass terminates research visibly even if the model returns reasoning', async t => {
  for (const restriction of [{ managedApprovalRequired: true }, { requestSandboxBypass: true }]) {
    const { researcher, calls } = await fixture(t, { send: async ({ config }) => {
      assert.equal((await config.onPermissionRequest({ kind: 'url', url: 'https://8.8.8.8', ...restriction }, {})).kind, 'denied-by-rules');
    } });
    await assert.rejects(researcher.run(context), /requires.*approval|sandbox/i);
    assert.equal(calls.sends, 1); assert.equal(calls.stops, 1);
  }
});

test('public URL guard rejects local addresses, credentials, unusual ports and DNS answers', async () => {
  for (const url of ['file:///private', 'http://localhost', 'http://127.1', 'http://169.254.169.254', 'http://[::1]', 'http://10.1.2.3', 'https://user:secret@example.com', 'https://example.com:8443', 'https://local.test']) assert.equal(await publicUrl(url, async () => [{ address: '192.168.1.1' }]), false, url);
  assert.equal(await publicUrl('https://8.8.8.8'), true);
});

test('bounded context prioritizes the current question and marks omissions; runtime rejects ordinary node', () => {
  const large = { ...context, path: Array.from({ length: 200 }, (_, i) => ({ question: `Question ${i}`, answer: 'x'.repeat(20000) })), decisionsElsewhere: [] };
  const compact = boundedContext(large);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= 131072); assert.equal(compact.path.at(-1).question, 'Question 199'); assert.equal(compact.truncated, true);
  assert.throws(() => hostRuntime(process.execPath, ['node', 'script.mjs'], process.ppid, {}));
});

test('accounting failure preserves the helper journal and recovery pointer without retrying inference', async t => {
  const { researcher, calls, dir } = await fixture(t, {
    usageRecorder: async () => ({ record() {}, async flush() { throw new Error('private failure'); } }),
    send: async ({ client, config }) => {
      const folder = join(client.baseDirectory, 'session-state', config.sessionId); await mkdir(folder, { recursive: true });
      await writeFile(join(folder, 'events.jsonl'), JSON.stringify({ type: 'assistant.message', data: { content: 'recoverable private transcript' } }) + '\n');
    },
  });
  await assert.rejects(researcher.run(context), /accounting failed/);
  assert.equal(calls.sends, 1); assert.equal(calls.stops, 1);
  assert.ok(await stat(calls.client.workingDirectory));
  const pointer = (await readdir(join(dir, 'usage'))).find(name => name.startsWith('recovery-'));
  const recovery = JSON.parse(await readFile(join(dir, 'usage', pointer), 'utf8'));
  assert.equal(recovery.directory, dirname(calls.client.workingDirectory));
  assert.equal(recovery.sessionId, calls.config.sessionId);
});

test('failed page reads cannot validate sources and arbitrary SDK errors stay out of the UI', async t => {
  const sourced = { ...result, basis: 'sources', sources: [{ id: 's1', title: 'Reference', url: 'https://8.8.8.8/reference' }] };
  const { researcher } = await fixture(t, { result: sourced, send: async ({ config }) => {
    const input = { toolName: 'web_fetch', toolArgs: { url: sourced.sources[0].url }, toolCallId: 'failed-read' };
    await config.hooks.onPreToolUse(input);
    config.hooks.onPostToolUseFailure({ ...input, error: 'Unable to retrieve' });
  } });
  await assert.rejects(researcher.run(context), /source failed/);
  const unsafe = await fixture(t, { send: () => { throw new Error('SECRET prompt endpoint token'); } });
  await assert.rejects(unsafe.researcher.run(context), error => !error.message.includes('SECRET') && /could not finish/.test(error.message));
});
test('operation eligibility never replaces the enabled Copilot model checks', async t => {
  for (const candidate of [{ ...model, provider: { kind: 'external' } }, { ...model, policy: { state: 'disabled' } }]) {
    const { researcher, calls } = await fixture(t, { models: [candidate] });
    await assert.rejects(researcher.run(context), /enabled Copilot model/); assert.equal(calls.sends, 0); assert.equal(calls.config, undefined);
  }
});

function manualClock() {
  let now = 0, timer;
  return { now: () => now, setTimeout(fn, ms) { timer = { fn, ms }; return timer; }, clearTimeout(value) { assert.equal(value, timer); },
    advance(ms, fire = false) { now += ms; if (fire) timer.fn(); }, get limit() { return timer.ms; } };
}
for (const depth of ['quick', 'standard', 'deeper']) {
  const settings = researchSettings({ depth, sourceFocus: 'primary', recency: 'recent' }), limits = researchLimits(settings);
  test(`${depth} counts startup and sends only remaining milliseconds with trusted settings`, async t => {
    const clock = manualClock();
    const { researcher, calls } = await fixture(t, { clock, start: () => clock.advance(1234), result: { ...result, settings: { depth: 'forged' } } });
    const output = await researcher.run(context, { settings });
    assert.equal(clock.limit, limits.timeLimitMs); assert.equal(calls.timeout, limits.timeLimitMs - 1234);
    assert.deepEqual(output.settings, settings); assert.equal(calls.sends, 1);
    assert.match(calls.config.systemMessage.content, new RegExp(`${limits.toolAttemptLimit} tool attempts`));
    assert.match(calls.config.systemMessage.content, /Prioritize original studies/); assert.match(calls.config.systemMessage.content, /do not.*invent dates/);
    assert.doesNotMatch(calls.config.systemMessage.content, /at most 4 searches/);
  });
  test(`${depth} rejects at the exact startup deadline and allows one millisecond before`, async t => {
    for (const delta of [-1, 0, 1]) {
      const clock = manualClock(), f = await fixture(t, { clock, start: () => clock.advance(limits.timeLimitMs + delta) });
      if (delta < 0) { await f.researcher.run(context, { settings }); assert.equal(f.calls.timeout, 1); }
      else { await assert.rejects(f.researcher.run(context, { settings }), /timed out/); assert.equal(f.calls.sends, 0); }
      assert.equal(f.calls.stops, 1);
    }
  });
  test(`${depth} inference timer cancels and rejects late results without retry`, async t => {
    const clock = manualClock(), f = await fixture(t, { clock, send: () => clock.advance(limits.timeLimitMs, true) });
    await assert.rejects(f.researcher.run(context, { settings }), /timed out/); assert.equal(f.calls.sends, 1); assert.equal(f.calls.stops, 1);
  });
  test(`${depth} allows exactly the attempt ceiling and counts denied attempts`, async t => {
    for (const denied of [false, true]) {
      const f = await fixture(t, { send: async ({ config }) => {
        const hook = config.hooks.onPreToolUse;
        for (let i = 1; i <= limits.toolAttemptLimit; i++) {
          const response = await hook({ toolName: denied && i === 1 ? 'shell' : 'web_search', toolCallId: 'budget-' + i, toolArgs: { query: `distinct-${i}` } });
          assert.equal(response.permissionDecision, denied && i === 1 ? 'deny' : undefined);
        }
        assert.equal((await hook({ toolName: 'web_search', toolCallId: 'excess', toolArgs: { query: 'excess' } })).permissionDecision, 'deny');
      } });
      await assert.rejects(f.researcher.run(context, { settings }), /tool-attempt limit/); assert.equal(f.calls.sends, 1); assert.equal(f.calls.stops, 1);
    }
    const atLimit = await fixture(t, { send: async ({ config }) => { for (let i = 0; i < limits.toolAttemptLimit; i++) assert.deepEqual(await config.hooks.onPreToolUse({ toolName: 'web_search', toolCallId: 'budget-' + i, toolArgs: { query: `distinct-${i}` } }), {}); } });
    await atLimit.researcher.run(context, { settings });
  });
}
test('held DNS callbacks cannot approve after deadline, explicit cancellation or an overlapping over-budget attempt', async t => {
  for (const reason of ['timeout', 'cancel', 'attempts']) {
    const clock = manualClock(), controller = new AbortController(), releases = [];
    const f = await fixture(t, { clock, resolve: () => new Promise(resolve => releases.push(() => resolve([{ address: '8.8.8.8' }]))), send: async ({ config }) => {
      const fetch = config.hooks.onPreToolUse({ toolName: 'web_fetch', toolCallId: 'held', toolArgs: { url: 'https://public.example/read' } });
      const permission = config.onPermissionRequest({ kind: 'url', url: 'https://public.example/read' });
      assert.equal(releases.length, 2);
      if (reason === 'timeout') clock.advance(60000);
      if (reason === 'cancel') controller.abort();
      if (reason === 'attempts') for (let i = 0; i < 8; i++) await config.hooks.onPreToolUse({ toolName: 'shell' });
      releases.forEach(release => release());
      assert.equal((await fetch).permissionDecision, 'deny'); assert.equal((await permission).kind, 'denied-by-rules');
    } });
    await assert.rejects(f.researcher.run(context, { settings: { depth: 'quick', sourceFocus: 'balanced', recency: 'any' }, signal: controller.signal }), reason === 'attempts' ? /tool-attempt limit/ : /cancelled/);
    assert.equal(f.calls.sends, 1); assert.equal(f.calls.stops, 1);
  }
});
test('a timed-out research run exposes late actual release instead of retrying inference', async t => {
  const clock = manualClock(); let release;
  const f = await fixture(t, { clock, stopTimeoutMs: 5, stop: () => new Promise(resolve => { release = resolve; }), send: () => clock.advance(60000, true) });
  let error;
  try { await f.researcher.run(context, { settings: { depth: 'quick', sourceFocus: 'balanced', recency: 'any' } }); } catch (value) { error = value; }
  assert.match(error.message, /cleanup or usage accounting/); assert.ok(error.releaseConfirmed); assert.equal(f.calls.sends, 1);
  release(); assert.equal(await error.releaseConfirmed, true); assert.equal(f.calls.stops, 1);
});
test('recommendation rationale changes with included cross-branch constraints and retains their provisional status', async t => {
  const summaries = [];
  for (const [answer, winner] of [['Two neighbors may hold keys.', 'cupboard'], ['No shared location is available.', 'distributed']]) {
    const doc = createDocument('Tool library');
    const [target, prior] = addQuestions(doc, doc.rootId, [{ question: 'Where do tools stay?', category: 'Storage' }, { question: 'What access do we have?', category: 'Access' }]);
    answerNode(doc, prior.id, answer, 'assumption'); prior.review = true;
    const prepared = prepareResearch(doc, target.id, researchFraming(doc)), raw = recommendationFindings();
    const f = await fixture(t, { result: raw, send: async calls => {
      const supplied = JSON.parse(calls.prompt.split('EXPLORATION DATA\n')[1]);
      const constraint = supplied.decisionsElsewhere.find(n => n.id === prior.id);
      assert.equal(constraint.answer, answer); assert.equal(constraint.answerState, 'assumption'); assert.equal(constraint.review, true);
      // Authored protocol fixture, not a test of a real model's research quality.
      raw.recommendationAssessment.optionId = constraint.answer.startsWith('Two') ? 'cupboard' : 'distributed';
      if (raw.recommendationAssessment.optionId === 'distributed') {
        raw.recommendationAssessment.mainTradeoff = 'Distributed storage needs more separate collection arrangements.';
        raw.recommendationAssessment.reconsiderIf = 'If a shared location and reliable key holders become available, consider one cupboard.';
      }
      raw.recommendation = `Given the unverified earlier answer “${constraint.answer}”, consider ${raw.recommendationAssessment.optionId}. Recheck access before committing.`;
      raw.recommendationAssessment.decisionRefs = [{ nodeId: prior.id, reason: `The provisional access constraint “${constraint.answer}” changes which arrangement is plausible.` }];
    } });
    const output = await f.researcher.run(prepared.context, { prepared });
    assert.equal(output.recommendationAssessment.optionId, winner);
    assert.deepEqual(output.recommendationAssessment.decisionRefs, [{ ...raw.recommendationAssessment.decisionRefs[0], answerState: 'assumption', review: true }]);
    assert.equal(f.calls.prompt, prepared.prompt); summaries.push(output.recommendation);
  }
  assert.notEqual(summaries[0], summaries[1]);
});

test('new helper recommendation rejects omitted, unknown, structural and unanswered prior references', async t => {
  for (const kind of ['excluded', 'unknown', 'root', 'direction', 'unanswered', 'model-state']) {
    const doc = createDocument('Tool library');
    const direction = addDirection(doc, doc.rootId, 'Consider storage access');
    const [target] = addQuestions(doc, direction.id, [{ question: 'Where do tools stay?', category: 'Storage' }]);
    const [prior] = addQuestions(doc, doc.rootId, [{ question: 'What access do we have?', category: 'Access' }]);
    answerNode(doc, prior.id, 'Two neighbors may hold keys.', 'tentative');
    const prepared = prepareResearch(doc, target.id, { ...researchFraming(doc), ...(kind === 'excluded' ? { excluded: [prior.id] } : {}) });
    const raw = recommendationFindings();
    raw.recommendationAssessment.decisionRefs = [{ nodeId: kind === 'unknown' ? 'absent' : kind === 'root' ? doc.rootId : kind === 'direction' ? direction.id : kind === 'unanswered' ? target.id : prior.id, reason: 'This prior input favors storage.', ...(kind === 'model-state' ? { answerState: 'decided', review: false } : {}) }];
    const f = await fixture(t, { result: raw });
    await assert.rejects(f.researcher.run(prepared.context, { prepared }), /invalid comparison/, kind);
  }
});

test('new helper requires an explicit recommendation assessment and accepts no justified winner', async t => {
  const old = recommendationFindings(); delete old.recommendationAssessment;
  const absent = await fixture(t, { result: old }); await assert.rejects(absent.researcher.run(context), /invalid comparison/);
  const raw = recommendationFindings(); raw.recommendationAssessment.optionId = null;
  raw.recommendation = 'No location or access evidence is available to prefer either choice.';
  const none = await fixture(t, { result: raw });
  assert.deepEqual(await none.researcher.run(context), { ...raw, settings: researchSettings() });
});
