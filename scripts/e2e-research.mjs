// Real installed SDK/runtime, anonymous local model + MCP fixtures only. No production bypass flags.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createResearcher } from '../com.github.copilot/extensions/explorer/research.mjs';

const sdkDirectory = process.env.COPILOT_SDK_DIR, cli = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && cli, 'Set COPILOT_SDK_DIR and COPILOT_CLI_PATH to the installed desktop SDK/runtime.');
const sdk = await import(pathToFileURL(join(sdkDirectory, 'index.js')).href);
const temporary = await mkdtemp(join(tmpdir(), 'explorer-research-fixture-'));
const calls = [], toolCalls = [], prompts = [];
const findings = { basis: 'reasoning', summary: 'Synthetic local comparison.', options: [
  { title: 'Pilot', description: 'Small first step.', pros: ['Learn'], cons: ['Limited'] , proposedAnswer: 'I will run a pilot.', details: [{ label: 'Size', value: 'Ten people' }] },
  { title: 'Launch', description: 'Broad first step.', pros: ['Reach'], cons: ['Cost'], proposedAnswer: 'I will launch broadly.', details: [] },
], recommendation: 'Pilot first.', proposedAnswer: 'I will run a pilot.', uncertainty: 'Local fixture: no real sources read.', sources: [] };
let hold = false, onHeld;
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
    const message = searched ? { role: 'assistant', content: JSON.stringify(findings) } : {
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
    return { sessionId: session.sessionId, sendAndWait: (...args) => session.sendAndWait(...args), rpc: {
      ...session.rpc, gitHubAuth: parent.rpc.gitHubAuth,
      model: { ...session.rpc.model, list: parent.rpc.model.list },
    } };
  }
} } });
const researcher = createResearcher(parent, { runtime, usageDirectory: join(temporary, 'usage') });
const deadline = setTimeout(() => { for (const client of owned) void client.forceStop(); }, 55000);
try {
  const progress = [];
  const context = { topic: 'Synthetic garden', objective: 'Choose a shared garden 🌿', successCriteria: 'Neighbors agree on one place', path: [{ kind: 'direction', origin: 'user', question: '  Access for everyone  ', answer: '', review: false }, { question: 'Who should join?', answer: 'Neighbors only', answerState: 'assumption', review: true }], decisionsElsewhere: [{ question: 'When?', answer: '', answerState: 'revisit-later', review: false }] };
  assert.deepEqual(await researcher.run(context, { onProgress: value => progress.push(value) }), findings);
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
  assert.match(journal, /session.usage_record/); assert.ok(!journal.includes('Neighbors only')); assert.ok(!journal.includes('Synthetic garden'));
  hold = true;
  const controller = new AbortController();
  const held = new Promise(resolve => { onHeld = resolve; });
  const cancelled = researcher.run(context, { signal: controller.signal });
  const rejected = assert.rejects(cancelled, /cancelled/);
  await held; controller.abort(); await rejected;
  assert.equal((await readdir(join(temporary, 'usage', 'session-state'))).length, 2);
  console.log('PASS isolated research: installed SDK tools initialize before inference, local MCP search runs, curated instructions/context reach the local model, structured suggestions return, receipts persist, cancellation stops the helper. No paid provider or user session.');
} finally {
  clearTimeout(deadline); await researcher.close();
  await Promise.allSettled([...owned].map(client => client.forceStop()));
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
