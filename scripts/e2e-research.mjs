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

const sdkDirectory = process.env.COPILOT_SDK_DIR, cli = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && cli, 'Set COPILOT_SDK_DIR and COPILOT_CLI_PATH to the installed desktop SDK/runtime.');
const sdk = await import(pathToFileURL(join(sdkDirectory, 'index.js')).href);
const temporary = await mkdtemp(join(tmpdir(), 'explorer-research-fixture-'));
const calls = [], toolCalls = [], prompts = [], captured = [], sendTimeouts = [];
const findings = { optionsVersion: 1, basis: 'reasoning', summary: 'Synthetic local comparison.', options: [
  { id: 'pilot', title: 'Pilot', description: 'Small first step.', fit: 'When learning with a small group matters.', pros: ['Learn'], cons: ['Limited'] , proposedAnswer: 'I will run a pilot.', details: [{ label: 'Size', value: 'Ten people' }] },
  { id: 'launch', title: 'Launch', description: 'Broad first step.', fit: 'When broad reach matters more than setup cost.', pros: ['Reach'], cons: ['Cost'], proposedAnswer: 'I will launch broadly.', details: [] },
], recommendation: 'Pilot first.', proposedAnswer: 'I will run a pilot.', uncertainty: 'Local fixture: no real sources read.', sources: [], claims: [
  { id: 'c1', text: 'A pilot could help learning.', basis: 'reasoning', evidence: [], limitations: 'Model judgment; no page fetched.' },
  { id: 'c2', text: 'Local cost is unknown.', basis: 'unknown', evidence: [], limitations: 'Search snippets do not establish fetched evidence.' },
] };
let hold = false, onHeld, falseCitation = false, followupMode = false, limitedCount = null;
function limitedFindings(count) {
  const value = { ...findings, options: findings.options.slice(0, count), optionsLimit: 'The fixture supplies insufficient evidence for further choices.' };
  if (!count) { delete value.proposedAnswer; value.recommendation = 'Gather the missing context before choosing.'; }
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
    const searched = input.messages.some(m => m.role === 'tool');
    const searchName = input.tools.find(t => t.function.name.includes('web_search')).function.name;
    const output = followupMode ? { answer: 'A prior source can inform the hypothetical.', uncertainty: 'Prior imported metadata; no new read.', claims: [{ id: 'c1', text: 'Prior support only', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Previously recorded support' }], limitations: 'Historical evidence, not a new fetch' }], sources: falseCitation ? [{ id: 's1', title: 'Unread new source', url: 'https://example.com/unread' }] : [{ id: 's1', prior: { origin: 'original', sourceId: 's1' } }] } : falseCitation ? { ...findings, basis: 'sources', sources: [{ id: 's1', title: 'Unread search result', url: 'https://example.com/unread', retrievedAt: '1900-01-01T00:00:00.000Z', provenance: 'recorded-read' }], claims: [{ id: 'c1', text: 'Unsupported claim', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Invented support' }], limitations: 'Fixture' }] } : findings;
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
const parent = { rpc: { gitHubAuth: { getStatus: async () => auth }, model: { list: async () => ({ list: [model] }), getCurrent: async () => ({ modelId: model.id }) } } };
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
    const session = await this.client.createSession({ ...config, enableManagedSettings: false,
      provider: { type: 'openai', baseUrl: base + '/v1', apiKey: 'fixture', wireApi: 'completions' },
      mcpServers: { 'github-mcp-server': { type: 'http', url: base + '/mcp', tools: ['*'] } },
    });
    // The local provider deliberately has no GitHub identity/catalog. Only these read-only checks
    // are substituted; session configuration, tools, inference, hooks and journals are real.
    return { sessionId: session.sessionId, sendAndWait: (...args) => { captured.push({ instructions: config.systemMessage.content, prompt: args[0].prompt }); sendTimeouts.push(args[1]); return session.sendAndWait(...args); }, rpc: {
      ...session.rpc, gitHubAuth: parent.rpc.gitHubAuth,
      model: { ...session.rpc.model, list: parent.rpc.model.list },
    } };
  }
} } });
const researcher = createResearcher(parent, { runtime, usageDirectory: join(temporary, 'usage') });
const deadline = setTimeout(() => { for (const client of owned) void client.forceStop(); }, 90000);
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
  const prepared = Object.freeze({ ...prepareResearch(researchDoc, target.id, { ...researchFraming(researchDoc, settings), excluded: [excluded.id] }), settings });
  assert.ok(prepared.context.decisionsElsewhere.find(node => node.id === prerequisite.id).selection.includes('Explicit prerequisite'));
  assert.deepEqual(await researcher.run(prepared.context, { prepared, onProgress: value => progress.push(value) }), { ...findings, settings });
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
  assert.equal(operation.operation, 'research'); assert.equal(operation.status, 'completed');
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
  doc.nodes[1].research = { ...findings, basis: 'sources', sources: [{ id: 's1', title: 'Earlier imported source', url: 'https://example.com/prior', retrievedAt: '2020-01-01T00:00:00.000Z', provenance: 'imported' }] };
  const followup = prepareFollowup(doc, doc.nodes[1].id, { question: 'What if the budget doubles? ??', hypothetical: true }, { settings });
  const startIndex = captured.length;
  const followupResult = await researcher.runFollowup(followup.context, { prepared: followup });
  assert.deepEqual(captured[startIndex], { instructions: followup.instructions, prompt: followup.prompt });
  assert.ok(sendTimeouts[startIndex] > 0 && sendTimeouts[startIndex] < 60000);
  assert.equal(followupResult.sources[0].retrievedAt, '2020-01-01T00:00:00.000Z'); assert.equal(followupResult.sources[0].provenance, 'imported'); assert.equal(followupResult.sources[0].evidenceOrigin.origin, 'original');
  falseCitation = true;
  await assert.rejects(researcher.runFollowup(followup.context, { prepared: followup }), /new source.*successfully read/);
  falseCitation = false;
  const followupReceipts = [];
  for (const id of await readdir(join(temporary, 'usage', 'session-state'))) followupReceipts.push(JSON.parse(await readFile(join(temporary, 'usage', 'session-state', id, 'operation.json'), 'utf8')));
  assert.deepEqual(followupReceipts.filter(item => item.operation === 'research-follow-up').map(item => item.status).sort(), ['completed', 'failed']);
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
    assert.deepEqual(await researcher.run(prepared.context, { prepared }), { ...limitedFindings(count), settings });
  }
  assert.equal((await readdir(join(temporary, 'usage', 'session-state'))).length, 7);
  console.log('PASS isolated research and scoped follow-up: concise stable options and honest zero/one-option results; historical imported evidence unchanged, unread new source rejected, separate completed/failed/cancelled operation receipts, real installed MCP search, reasoning/unknown claims, rejection of search-only fabricated source/time, exact reviewed inputs, retained completed/failed receipts and cancellation/release. Successful builtin web_fetch is NOT exercised; deterministic hook tests separately cover successful read provenance. No paid provider or user session.');
} finally {
  clearTimeout(deadline); await researcher.close();
  await Promise.allSettled([...owned].map(client => client.forceStop()));
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
