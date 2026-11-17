// Installed SDK/runtime, anonymous loopback model fixture; never a paid account/session.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAnswerCheckHelper, prepareAnswerCheck } from '../com.github.copilot/extensions/explorer/answer-check.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';

const sdkDirectory = process.env.COPILOT_SDK_DIR, cli = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && cli, 'Set COPILOT_SDK_DIR and COPILOT_CLI_PATH to the installed desktop pair.');
const sdk = await import(pathToFileURL(join(sdkDirectory, 'index.js')).href);
const temporary = await mkdtemp(join(tmpdir(), 'explorer-check-fixture-'));
const prompts = [], owned = new Set(), workspaces = [];
let hold = false, onHeld, initialized = 0;
const document = createDocument('Explore Unicode 🌱', { objective: 'Understand a technical question' });
const [selected] = addQuestions(document, document.rootId, [{ question: 'What does λ mean for Élodie?', category: 'Technical' }]);
document.pins = [{ id: 'constraint-00000000000000', text: 'Use familiar vocabulary' }];
const prepared = prepareAnswerCheck(document);
const output = { findings: [{ id: 'u', category: 'untested-assumption', explanation: 'The saved question may need evidence.', resolution: 'Ask the user which evidence would settle it.', sources: [{ kind: 'node', id: selected.id }] }] };
const fixture = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body); prompts.push(input);
  if (hold) { onHeld?.(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'question-help-fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }));
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const auth = { isAuthenticated: true, login: 'local-fixture', host: 'github.com' };
const model = { id: 'gpt-4o', provider: { kind: 'copilot' }, policy: { state: 'enabled' } };
const parent = { rpc: { gitHubAuth: { getStatus: async () => auth }, model: { list: async () => ({ list: [model] }), getCurrent: async () => ({ modelId: model.id }) } } };
const runtime = async () => ({ path: cli, sdk: { RuntimeConnection: sdk.RuntimeConnection, CopilotClient: class {
  constructor(options) {
    assert.equal(options.mode, 'empty'); assert.deepEqual(options.builtinPluginDirectories, []);
    this.options = options; workspaces.push(options.workingDirectory);
    const env = { ...options.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_CONFIG_DIR: join(options.baseDirectory, 'gh') };
    this.client = new sdk.CopilotClient({ ...options, useLoggedInUser: false, env: undefined,
      connection: sdk.RuntimeConnection.forStdio({ path: cli, args: ['--no-auto-update'], env }) }); owned.add(this.client);
  }
  start() { return this.client.start(); }
  forceStop() { return this.client.forceStop(); }
  async createSession(config) {
    assert.deepEqual(await readdir(config.workingDirectory), []);
    assert.equal(config.systemMessage.content, prepared.instructions);
    assert.equal(config.enableConfigDiscovery, false); assert.deepEqual(config.availableTools, []);
    assert.deepEqual(config.githubMcpToolConfig, { enableAllTools: false, additionalToolsets: [], additionalTools: [] });
    assert.deepEqual(config.mcpServers, {}); assert.deepEqual(config.pluginDirectories, []);
    assert.equal(config.enableManagedSettings, true); assert.equal(config.enforceManagedModelDefaults, true);
    for (const key of ['requestExtensions', 'requestCanvasRenderer', 'enableSkills', 'enableFileHooks', 'enableOnDemandInstructionDiscovery', 'enableSessionStore', 'enableHostGitOperations']) assert.equal(config[key], false);
    const session = await this.client.createSession({ ...config, enableManagedSettings: false,
      provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' } });
    // Only identity/catalog reads substitute the anonymous fixture. Tool initialization,
    // configuration, metadata, inference, cancellation and usage journals are real.
    return { sessionId: session.sessionId,
      sendAndWait: (...args) => { assert.ok(initialized); assert.equal(args[0].prompt, prepared.prompt); assert.equal(Buffer.byteLength(config.systemMessage.content) + Buffer.byteLength(args[0].prompt), prepared.bytes); return session.sendAndWait(...args); },
      rpc: { ...session.rpc, gitHubAuth: parent.rpc.gitHubAuth, model: { ...session.rpc.model, list: parent.rpc.model.list },
        tools: { ...session.rpc.tools, getCurrentMetadata: async () => { const result = await session.rpc.tools.getCurrentMetadata(); assert.deepEqual(result.tools, []); initialized++; return result; } },
      } };
  }
} } });
const helper = createAnswerCheckHelper(parent, { runtime, usageDirectory: join(temporary, 'usage') });
const timer = setTimeout(() => { for (const client of owned) void client.forceStop(); }, 55000);
try {
  const result = await helper.run(prepared); assert.equal(result.findings[0].explanation, output.findings[0].explanation);
  assert.equal(initialized, 1); assert.equal(prompts.length, 1);
  for (const prompt of prompts) {
    assert.equal(prompt.tools?.length ?? 0, 0);
    assert.ok(prompt.messages.some(m => m.role === 'user' && m.content.includes(selected.question)));
    assert.ok(!JSON.stringify(prompt).includes('unsaved answer'));
    assert.ok(prompt.messages.some(m => m.role === 'user' && m.content.includes('Use familiar vocabulary')));
  }
  const ids = await readdir(join(temporary, 'usage', 'session-state'));
  assert.equal(ids.length, 1);
  const labels = [];
  for (const id of ids) {
    const journal = await readFile(join(temporary, 'usage', 'session-state', id, 'events.jsonl'), 'utf8');
    labels.push(['Explorer Answer Check'].find(label => journal.includes(label)));
    assert.match(journal, /session.usage_record/); assert.ok(!journal.includes('Élodie'));
  }
  assert.deepEqual(labels.sort(), ['Explorer Answer Check'].sort());
  hold = true; const abort = new AbortController(), held = new Promise(resolve => { onHeld = resolve; });
  const cancelled = assert.rejects(helper.run(prepared, { signal: abort.signal }), /cancelled/);
  await held; abort.abort(); await cancelled; assert.equal(initialized, 2);
  assert.equal((await readdir(join(temporary, 'usage', 'session-state'))).length, 2);
  for (const workspace of workspaces) await assert.rejects(stat(workspace), { code: 'ENOENT' });
  console.log('PASS isolated answer check: exact captured SDK strings/byte budget, zero initialized tools, root-anchored context, bounded structured output, attributed receipts, cancellation and release. No paid inference or existing session.');
} finally {
  clearTimeout(timer); await helper.close(); await Promise.allSettled([...owned].map(client => client.forceStop()));
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir())); await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
