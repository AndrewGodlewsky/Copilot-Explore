// Real installed SDK/runtime, anonymous local model + MCP fixtures only. No production bypass flags.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareFollowup } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { createDocument, addQuestions, addDirection, addDependency } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareResearch } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { createResearcher, researchFraming } from '../com.github.copilot/extensions/explorer/research.mjs';
import { captureResearchModel } from '../com.github.copilot/extensions/explorer/research-model.mjs';
import { prepareReconsideration } from '../com.github.copilot/extensions/explorer/research-comparison.mjs';

const sdkDirectory = process.env.COPILOT_SDK_DIR, cli = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && cli, 'Set COPILOT_SDK_DIR and COPILOT_CLI_PATH to the installed desktop SDK/runtime.');
const sdk = await import(pathToFileURL(join(sdkDirectory, 'index.js')).href);
const temporary = await mkdtemp(join(tmpdir(), 'explorer-research-fixture-'));
const calls = [], toolCalls = [], prompts = [], captured = [], sendTimeouts = [], createdModels = [];
const findings = { optionsVersion: 1, basis: 'reasoning', summary: 'Synthetic local comparison.', options: [
  { id: 'pilot', title: 'Pilot', description: 'Small first step.', fit: 'When learning with a small group matters.', pros: ['Learn'], cons: ['Limited'] , proposedAnswer: 'I will run a pilot.', details: [{ label: 'Size', value: 'Ten people' }] },
  { id: 'launch', title: 'Launch', description: 'Broad first step.', fit: 'When broad reach matters more than setup cost.', pros: ['Reach'], cons: ['Cost'], proposedAnswer: 'I will launch broadly.', details: [] },
], recommendation: 'Pilot first while shared space remains an unconfirmed assumption.', recommendationAssessment: { optionId: 'pilot', mainTradeoff: 'The pilot reaches fewer neighbors.', reconsiderIf: 'If shared space and demand are confirmed, consider a broader launch.', decisionRefs: [] }, uncertainty: 'Local fixture: no real sources read.', sources: [], claims: [
  { id: 'c1', text: 'A pilot could help learning.', basis: 'reasoning', evidence: [], limitations: 'Model judgment; no page fetched.', freshness: { type: 'durable-concept', reason: 'A conceptual learning strategy, not current availability.', version: null } },
  { id: 'c2', text: 'Local cost is unknown.', basis: 'unknown', evidence: [], limitations: 'Search snippets do not establish fetched evidence.' },
] };
let hold = false, onHeld, falseCitation = false, followupMode = false, limitedCount = null;
let reconsideration = null;
const comparisonOutput = prepared => ({ cells: prepared.comparison.criteria.flatMap(criterion => prepared.comparison.options.map(option => ({ criterionId: criterion.id, optionId: option.id, explanation: 'Historical model judgment only.', basis: 'prior-claim', claimIds: ['c1'] }))),
  recommendation: { optionId: 'pilot', reason: 'Fits the hypothetical priorities.', changed: 'Coordination is prioritized.', unchanged: 'Participation remains unknown.' }, uncertainty: 'No new retrieval or verification.' });
function limitedFindings(count) {
  const value = { ...findings, recommendation: 'Gather the missing context before choosing.', recommendationAssessment: { ...findings.recommendationAssessment, optionId: null }, options: findings.options.slice(0, count), optionsLimit: 'The fixture supplies insufficient evidence for further choices.' };
  value.support = findings.support.filter(entry => value.options.some(option => option.id === entry.optionId));
  value.limitations = [{ ...findings.limitations[0], optionIds: [], blocksRecommendation: true, nextStep: 'Confirm the local cost and access requirements before choosing.' }];
  return value;
}
const fixture = createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk;
    if (req.url === '/mcp' && req.method === 'GET') { res.writeHead(405); res.end(); return; }
    const input = JSON.parse(body || '{}');
    if (req.url === '/mcp') {
      calls.push(input.method);
      if (input.id === undefined) { res.writeHead(202); res.end(); return; }
      const result = input.method === 'initialize' ? { protocolVersion: input.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'research-fixture', version: '1' } } :
        input.method === 'tools/list' ? { tools: [
          { name: 'web_search', description: 'Search fixture', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
          { name: 'unwanted_tool', description: 'Must be excluded', inputSchema: { type: 'object', properties: {} } },
        ] } : input.method === 'tools/call' ? { content: [{ type: 'text', text: 'Synthetic search result. No real sources are available in this fixture.' }] } : {};
      if (input.method === 'tools/call') toolCalls.push(input.params);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result })); return;
    }
    prompts.push(input);
    if (hold) { onHeld?.(); return; }
    if (reconsideration) {
      assert.equal(input.tools?.length ?? 0, 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'comparison-fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(comparisonOutput(reconsideration)) }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })); return;
    }
    const searched = input.messages.some(m => m.role === 'tool');
    const searchName = input.tools.find(t => t.function.name.includes('web_search')).function.name;
    const output = followupMode ? { answer: 'A prior source can inform the hypothetical.', uncertainty: 'Prior imported metadata; no new read.', claims: [{ id: 'c1', text: 'Prior support only', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Previously recorded support' }], limitations: 'Historical evidence, not a new fetch' }], sources: falseCitation ? [{ id: 's1', title: 'Unread new source', url: 'https://example.com/unread' }] : [{ id: 's1', prior: { origin: 'original', sourceId: 's1' } }] } : falseCitation ? { ...findings, basis: 'sources', sources: [{ id: 's1', title: 'Unread search result', url: 'https://example.com/unread', retrievedAt: '1900-01-01T00:00:00.000Z', provenance: 'recorded-read' }], claims: [{ id: 'c1', text: 'Unsupported claim', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Invented support' }], limitations: 'Fixture' }, ...findings.claims.slice(1)] } : findings;
    const message = searched ? { role: 'assistant', content: JSON.stringify(limitedCount === null ? output : limitedFindings(limitedCount)) } : {
      role: 'assistant', content: null, tool_calls: [{ id: 'search-fixture', type: 'function', function: { name: searchName, arguments: JSON.stringify({ query: 'synthetic pilot options' }) } }],
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'fixture-completion', object: 'chat.completion', choices: [{ index: 0, message, finish_reason: searched ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }));
  } catch { res.writeHead(500); res.end('Fixture failed'); }
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${fixture.address().port}`;
const auth = { isAuthenticated: true, login: 'local-fixture', host: 'github.com' };
const model = { id: 'gpt-4o', provider: { kind: 'copilot' }, policy: { state: 'enabled' } };
const dedicated = { ...model, id: 'gpt-4.1' }; let selectedId = model.id;
const parent = { rpc: { gitHubAuth: { getStatus: async () => auth }, model: { list: async input => { assert.deepEqual(input, { skipCache: true }); return { list: [model, dedicated] }; }, getCurrent: async () => ({ modelId: selectedId }) } } };
const owned = new Set();
const runtime = async () => ({ path: cli, sdk: { RuntimeConnection: sdk.RuntimeConnection, CopilotClient: class {
  constructor(options) {
    this.options = options;
    const env = { ...options.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_CONFIG_DIR: join(options.baseDirectory, 'gh') };
    this.client = new sdk.CopilotClient({ ...options, useLoggedInUser: false, env: undefined,
      connection: sdk.RuntimeConnection.forStdio({ path: cli, args: ['--no-auto-update'], env }),
    }); owned.add(this.client);
  }
  start() { return this.client.start(); }
  forceStop() { return this.client.forceStop(); }
  async createSession(config) {
    createdModels.push(config.model);
    const toolFree = config.availableTools?.length === 0;
    if (toolFree) {
      assert.equal(config.systemMessage.content, reconsideration.instructions);
      assert.equal(config.enableConfigDiscovery, false); assert.deepEqual(config.pluginDirectories, []); assert.deepEqual(config.mcpServers, {});
      assert.deepEqual(config.githubMcpToolConfig, { enableAllTools: false, additionalToolsets: [], additionalTools: [] });
      for (const key of ['requestExtensions', 'requestCanvasRenderer', 'enableSkills', 'enableFileHooks', 'enableOnDemandInstructionDiscovery', 'enableSessionStore', 'enableHostGitOperations']) assert.equal(config[key], false);
    }
    const session = await this.client.createSession({ ...config, enableManagedSettings: false,
      provider: { type: 'openai', baseUrl: base + '/v1', apiKey: 'fixture', wireApi: 'completions' },
      ...(toolFree ? {} : { mcpServers: { 'github-mcp-server': { type: 'http', url: base + '/mcp', tools: ['*'] } } }),
    });
    // The local provider deliberately has no GitHub identity/catalog. Only these read-only checks
    // are substituted; session configuration, tools, inference, hooks and journals are real.
    return { sessionId: session.sessionId, sendAndWait: (...args) => { captured.push({ instructions: config.systemMessage.content, prompt: args[0].prompt }); sendTimeouts.push(args[1]); return session.sendAndWait(...args); }, rpc: {
      ...session.rpc, gitHubAuth: parent.rpc.gitHubAuth,
      model: { ...session.rpc.model, list: parent.rpc.model.list },
      ...(toolFree ? { tools: { ...session.rpc.tools, getCurrentMetadata: async () => { const result = await session.rpc.tools.getCurrentMetadata(); assert.deepEqual(result.tools, []); return result; } } } : {}),
    } };
  }
} } });
const researcher = createResearcher(parent, { runtime, usageDirectory: join(temporary, 'usage') });
const deadline = setTimeout(() => { for (const client of owned) void client.forceStop(); }, 150000);
try {
  const progress = [];
  const researchDoc = createDocument('Synthetic garden', { objective: 'Choose a shared garden 🌿', successCriteria: 'Neighbors agree on one place' });
  const direction = addDirection(researchDoc, researchDoc.rootId, '  Access for everyone  ');
  const [target] = addQuestions(researchDoc, direction.id, [{ question: 'Who should join?', category: 'Participants' }]);
  Object.assign(target, { answer: 'Neighbors only', answerState: 'assumption', review: true });
  const [deferred, prerequisite, excluded] = addQuestions(researchDoc, researchDoc.rootId, [{ question: 'When?', category: 'Timing' }, { question: 'Shared space constraints?', category: 'Prerequisite' }, { question: 'Secret source?', category: 'Excluded' }]);
  deferred.answerState = 'revisit-later'; Object.assign(prerequisite, { answer: 'Shared space availability remains unconfirmed', answerState: 'assumption' });
  excluded.answer = 'EXCLUDED-INSTALLED-CANARY\u0000\ud83c\udf3f<script>';
  researchDoc.pins = [{ id: 'constraint-00000000000000', text: 'Preserve the user constraint exactly' }];
  addDependency(researchDoc, target.id, prerequisite.id);
  const settings = Object.freeze({ depth: 'quick', sourceFocus: 'primary', recency: 'recent' });
  const modelCapture = captureResearchModel(await researcher.models(), { revision: 0, modelId: null });
  assert.equal(owned.size, 0); assert.equal(prompts.length, 0); selectedId = dedicated.id;
  const prepared = Object.freeze({ ...prepareResearch(researchDoc, target.id, { ...researchFraming(researchDoc, settings), excluded: [excluded.id] }), settings, modelCapture });
  findings.recommendationAssessment.decisionRefs = [{ nodeId: prerequisite.id, reason: 'Unconfirmed shared space favors testing access with a small pilot.' }];
  findings.support = [
    { optionId: 'pilot', field: 'pros', text: findings.options[0].pros[0], claimIds: ['c1'], decisionIds: [] },
    { optionId: null, field: 'recommendation', text: findings.recommendation, claimIds: ['c1'], decisionIds: [prerequisite.id] },
  ];
  findings.limitations = [{ id: 'local-cost', kind: 'missing-evidence', summary: 'The pilot budget is unknown; its scope can still be compared provisionally.', claimIds: ['c2'], optionIds: ['pilot'], decisionIds: [prerequisite.id], blocksRecommendation: false, nextStep: 'Ask for the available pilot budget before committing funds.' }];
  const expected = value => ({ ...value, recommendationAssessment: { ...value.recommendationAssessment, decisionRefs: value.recommendationAssessment.decisionRefs.map(ref => ({ ...ref, answerState: 'assumption', review: false })) }, settings });
  assert.ok(prepared.context.decisionsElsewhere.find(node => node.id === prerequisite.id).selection.includes('Explicit prerequisite'));
  const completed = await researcher.run(prepared.context, { prepared, onProgress: value => progress.push(value) });
  assert.deepEqual(completed, expected(findings));
  assert.match(prepared.instructions, /"support"/);
  assert.deepEqual(completed.support[1].decisionIds, [prerequisite.id]);
  assert.deepEqual(completed.limitations, findings.limitations);
  assert.equal(completed.recommendationAssessment.decisionRefs[0].answerState, 'assumption');
  assert.match(prepared.instructions, /Quick: 60 seconds.*8 tool attempts/);
  assert.match(prepared.instructions, /Prefer recently published/);
  assert.ok(sendTimeouts[0] > 0 && sendTimeouts[0] < 60000);
  assert.ok(JSON.stringify(prompts).includes('Preserve the user constraint exactly'));
  assert.deepEqual(captured[0], { instructions: prepared.instructions, prompt: prepared.prompt });
  assert.ok(captured[0].prompt.includes('Shared space availability remains unconfirmed'));
  assert.ok(captured[0].prompt.includes('Explicit prerequisite')); assert.ok(captured[0].prompt.includes('selectionPolicy'));
  assert.ok(!captured[0].prompt.includes('EXCLUDED-INSTALLED-CANARY')); assert.ok(!JSON.stringify(prompts[0]).includes('EXCLUDED-INSTALLED-CANARY'));
  assert.ok(prompts[0].messages.some(m => m.role === 'user' && m.content.includes(prepared.prompt)));
  assert.equal(Buffer.byteLength(captured[0].instructions) + Buffer.byteLength(captured[0].prompt), prepared.bytes);
  assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
  assert.ok(prepared.bytes <= 131072);
  assert.ok(JSON.stringify(prompts).includes('Access for everyone'));
  assert.ok(JSON.stringify(prompts).includes('direction'));
  assert.ok(calls.includes('initialize')); assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0].name, 'web_search');
  assert.ok(progress.includes('Searching the web'));
  assert.ok(JSON.stringify(prompts).includes('explorer-research'));
  assert.ok(JSON.stringify(prompts).includes('Neighbors only'));
  assert.ok(JSON.stringify(prompts).includes('Choose a shared garden 🌿'));
  assert.ok(JSON.stringify(prompts).includes('Neighbors agree on one place'));
  assert.ok(JSON.stringify(prompts).includes('revisit-later'));
  assert.ok(JSON.stringify(prompts).includes('assumption'));
  assert.ok(JSON.stringify(prompts).includes('never external verification'));
  for (const prompt of prompts) {
    assert.equal(prompt.tools.length, 2); assert.ok(!JSON.stringify(prompt.tools).includes('unwanted_tool'));
  }
  const sessions = await readdir(join(temporary, 'usage', 'session-state'));
  assert.equal(sessions.length, 1);
  const journal = await readFile(join(temporary, 'usage', 'session-state', sessions[0], 'events.jsonl'), 'utf8');
  const operation = JSON.parse(await readFile(join(temporary, 'usage', 'session-state', sessions[0], 'operation.json'), 'utf8'));
  assert.equal(operation.operation, 'research'); assert.equal(operation.status, 'completed'); assert.equal(operation.model, model.id); assert.equal(createdModels[0], model.id);
  assert.match(journal, /session.usage_record/); assert.ok(!journal.includes('Neighbors only')); assert.ok(!journal.includes('Synthetic garden'));
  falseCitation = true;
  await assert.rejects(researcher.run(prepared.context, { prepared }), /sources.*successfully read/);
  assert.equal(toolCalls.length, 2); assert.ok(toolCalls.every(call => call.name === 'web_search'));
  const rejectedSessions = await readdir(join(temporary, 'usage', 'session-state'));
  assert.equal(rejectedSessions.length, 2);
  const rejectedId = rejectedSessions.find(id => id !== sessions[0]);
  const rejectedOperation = JSON.parse(await readFile(join(temporary, 'usage', 'session-state', rejectedId, 'operation.json'), 'utf8'));
  assert.equal(rejectedOperation.operation, 'research'); assert.equal(rejectedOperation.status, 'failed');
  assert.match(await readFile(join(temporary, 'usage', 'session-state', rejectedId, 'events.jsonl'), 'utf8'), /session.usage_record/);
  falseCitation = false;
  followupMode = true;
  const doc = createDocument('Scoped follow-up fixture'); addQuestions(doc, doc.rootId, [{ question: 'Why pilot?', category: 'Target' }]);
  doc.nodes[1].research = { ...completed, basis: 'sources', sources: [{ id: 's1', title: 'Earlier imported source', url: 'https://example.com/prior', retrievedAt: '2020-01-01T00:00:00.000Z', provenance: 'imported', dateObservations: [{ kind: 'published', text: 'Published: 2019-12-01' }] }] };
  const followup = { ...prepareFollowup(doc, doc.nodes[1].id, { question: 'What if the budget doubles? ??', hypothetical: true }, { settings }), modelCapture: captureResearchModel(await researcher.models(), { revision: 1, modelId: dedicated.id }) };
  selectedId = model.id;
  const startIndex = captured.length;
  const followupResult = await researcher.runFollowup(followup.context, { prepared: followup });
  assert.deepEqual(captured[startIndex], { instructions: followup.instructions, prompt: followup.prompt });
  assert.ok(sendTimeouts[startIndex] > 0 && sendTimeouts[startIndex] < 60000);
  assert.deepEqual(followupResult.sources[0].dateObservations, doc.nodes[1].research.sources[0].dateObservations);
  assert.ok(followup.followup.original.find(item => item.kind === 'evidence').freshness.evaluatedAt);
  assert.equal(followupResult.sources[0].retrievedAt, '2020-01-01T00:00:00.000Z'); assert.equal(followupResult.sources[0].provenance, 'imported'); assert.equal(followupResult.sources[0].evidenceOrigin.origin, 'original');
  falseCitation = true;
  await assert.rejects(researcher.runFollowup(followup.context, { prepared: followup }), /new source.*successfully read/);
  falseCitation = false;
  const followupReceipts = [];
  for (const id of await readdir(join(temporary, 'usage', 'session-state'))) followupReceipts.push(JSON.parse(await readFile(join(temporary, 'usage', 'session-state', id, 'operation.json'), 'utf8')));
  assert.deepEqual(followupReceipts.filter(item => item.operation === 'research-follow-up').map(item => item.status).sort(), ['completed', 'failed']);
  assert.ok(followupReceipts.filter(item => item.operation === 'research-follow-up').every(item => item.model === dedicated.id));
  assert.equal(createdModels[startIndex], dedicated.id);
  assert.ok(toolCalls.length >= 4); assert.ok(toolCalls.every(call => call.name === 'web_search'));
  hold = true;
  const controller = new AbortController();
  const held = new Promise(resolve => { onHeld = resolve; });
  const cancelled = researcher.runFollowup(followup.context, { prepared: followup, signal: controller.signal });
  const rejected = assert.rejects(cancelled, /cancelled/);
  await held; controller.abort(); await rejected;
  assert.equal((await readdir(join(temporary, 'usage', 'session-state'))).length, 5);
  hold = false; followupMode = false;
  for (const count of [0, 1]) {
    limitedCount = count;
    assert.deepEqual(await researcher.run(prepared.context, { prepared }), expected(limitedFindings(count)));
  }
  assert.equal((await readdir(join(temporary, 'usage', 'session-state'))).length, 7);
  const toolCount = toolCalls.length, mcpCount = calls.length;
  for (const modelId of [null, dedicated.id]) {
    selectedId = model.id;
    reconsideration = { ...prepareReconsideration(doc, doc.nodes[1].id, { criteria: [{ id: 'effort', label: 'Coordination effort 🌿', priority: 'high' }] }), modelCapture: captureResearchModel(await researcher.models(), { revision: 2, modelId }) };
    selectedId = dedicated.id;
    const index = captured.length, result = await researcher.runReconsideration(reconsideration.context, { prepared: reconsideration });
    assert.deepEqual(result, comparisonOutput(reconsideration));
    assert.deepEqual(captured[index], { instructions: reconsideration.instructions, prompt: reconsideration.prompt });
    assert.equal(createdModels[index], modelId ?? model.id); assert.ok(sendTimeouts[index] > 0 && sendTimeouts[index] < 180000);
    assert.equal(Buffer.byteLength(captured[index].instructions) + Buffer.byteLength(captured[index].prompt), reconsideration.bytes);
  }
  hold = true; const comparisonAbort = new AbortController(), comparisonHeld = new Promise(resolve => { onHeld = resolve; });
  const comparisonCancelled = assert.rejects(researcher.runReconsideration(reconsideration.context, { prepared: reconsideration, signal: comparisonAbort.signal }), /cancelled/);
  await comparisonHeld; comparisonAbort.abort(); await comparisonCancelled;
  assert.equal(toolCalls.length, toolCount); assert.equal(calls.length, mcpCount, 'Reconsideration never initializes MCP or retrieves new sources.');
  const comparisonReceipts = [];
  for (const id of await readdir(join(temporary, 'usage', 'session-state'))) {
    const receipt = JSON.parse(await readFile(join(temporary, 'usage', 'session-state', id, 'operation.json'), 'utf8'));
    if (receipt.operation !== 'research-reconsideration') continue;
    comparisonReceipts.push(receipt);
    const journal = await readFile(join(temporary, 'usage', 'session-state', id, 'events.jsonl'), 'utf8');
    assert.match(journal, /Explorer Research Reconsideration/); assert.doesNotMatch(journal, /Coordination effort|Scoped follow-up fixture/);
    if (receipt.status === 'completed') assert.match(journal, /session.usage_record/);
  }
  assert.deepEqual(comparisonReceipts.map(item => item.status).sort(), ['cancelled', 'completed', 'completed']);
  assert.deepEqual(comparisonReceipts.filter(item => item.status === 'completed').map(item => item.model).sort(), [model.id, dedicated.id].sort());
  console.log('PASS reconsideration: exact reviewed Unicode criteria/options/prior research, selected and dedicated models, zero initialized tools/MCP/retrieval, completed and cancelled attributed receipts; anonymous installed runtime only.');
  console.log('PASS Research model discovery starts no inference; captured selected-chat model and dedicated follow-up model survive later chat changes; actual installed helper models and retained operation receipts match both captures.');
  console.log('PASS isolated research and scoped follow-up: linked recommendation with captured prior-context state, honest null recommendations and zero/one-option results; historical imported evidence unchanged, unread new source rejected, separate completed/failed/cancelled operation receipts, real installed MCP search, reasoning/unknown claims, rejection of search-only fabricated source/time, exact reviewed inputs, retained completed/failed receipts and cancellation/release. Successful builtin web_fetch is NOT exercised; deterministic hook tests separately cover successful read provenance. No paid provider or user session.');
} finally {
  clearTimeout(deadline); await researcher.close();
  await Promise.allSettled([...owned].map(client => client.forceStop()));
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
