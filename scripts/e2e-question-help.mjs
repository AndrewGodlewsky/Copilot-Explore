// Installed SDK/runtime, anonymous loopback model fixture; never a paid account/session.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createQuestionHelper, helpContext } from '../com.github.copilot/extensions/explorer/question-help.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';

const sdkDirectory = process.env.COPILOT_SDK_DIR, cli = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && cli, 'Set COPILOT_SDK_DIR and COPILOT_CLI_PATH to the installed desktop pair.');
const sdk = await import(pathToFileURL(join(sdkDirectory, 'index.js')).href);
const temporary = await mkdtemp(join(tmpdir(), 'explorer-question-help-fixture-'));
const prompts = [], owned = new Set(), workspaces = [];
let hold = false, onHeld, initialized = 0;
const document = createDocument('Explore Unicode 🌱', { objective: 'Understand a technical question' });
const [selected] = addQuestions(document, document.rootId, [{ question: 'What does λ mean for Élodie?', category: 'Technical' }]);
document.pins = [{ id: 'constraint-00000000000000', text: 'Use familiar vocabulary' }];
const context = helpContext(document, selected.id);
const outputs = { rephrase: 'In other words, what does λ stand for?', example: 'Illustrative example: λ could label a rate.', terms: 'λ is the Greek letter lambda; meaning depends on context.' };
const fixture = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const input = JSON.parse(body); prompts.push(input);
  if (hold) { onHeld?.(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const prompt = input.messages.find(message => message.role === 'user')?.content ?? '';
  const operation = Object.keys(outputs).find(key => prompt.includes(`"operation":"${key}"`));
  res.end(JSON.stringify({ id: 'question-help-fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ text: outputs[operation] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }));
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
      sendAndWait: (...args) => { assert.ok(initialized); return session.sendAndWait(...args); },
      rpc: { ...session.rpc, gitHubAuth: parent.rpc.gitHubAuth, model: { ...session.rpc.model, list: parent.rpc.model.list },
        tools: { ...session.rpc.tools, getCurrentMetadata: async () => { const result = await session.rpc.tools.getCurrentMetadata(); assert.deepEqual(result.tools, []); initialized++; return result; } },
      } };
  }
} } });
const helper = createQuestionHelper(parent, { runtime, usageDirectory: join(temporary, 'usage') });
const timer = setTimeout(() => { for (const client of owned) void client.forceStop(); }, 55000);
try {
  for (const [operation, expected] of Object.entries(outputs)) assert.equal(await helper.run(operation, context), expected);
  assert.equal(initialized, 3); assert.equal(prompts.length, 3);
  for (const prompt of prompts) {
    assert.equal(prompt.tools?.length ?? 0, 0);
    assert.ok(prompt.messages.some(m => m.role === 'user' && m.content.includes(selected.question)));
    assert.ok(!JSON.stringify(prompt).includes('unsaved answer'));
    assert.ok(prompt.messages.some(m => m.role === 'user' && m.content.includes('Use familiar vocabulary')));
  }
  const ids = await readdir(join(temporary, 'usage', 'session-state'));
  assert.equal(ids.length, 3);
  const labels = [];
  for (const id of ids) {
    const journal = await readFile(join(temporary, 'usage', 'session-state', id, 'events.jsonl'), 'utf8');
    labels.push(['Explorer Question Rephrase', 'Explorer Question Example', 'Explorer Question Terms'].find(label => journal.includes(label)));
    assert.match(journal, /session.usage_record/); assert.ok(!journal.includes('Élodie'));
  }
  assert.deepEqual(labels.sort(), ['Explorer Question Rephrase', 'Explorer Question Example', 'Explorer Question Terms'].sort());
  hold = true; const abort = new AbortController(), held = new Promise(resolve => { onHeld = resolve; });
  const cancelled = assert.rejects(helper.run('terms', context, { signal: abort.signal }), /cancelled/);
  await held; abort.abort(); await cancelled; assert.equal(initialized, 4);
  assert.equal((await readdir(join(temporary, 'usage', 'session-state'))).length, 4);
  for (const workspace of workspaces) await assert.rejects(stat(workspace), { code: 'ENOENT' });
  console.log('PASS isolated question help: all operations, zero initialized tools, bounded saved Unicode context, attributed receipts, cancellation and release. No paid inference or existing session.');
} finally {
  clearTimeout(timer); await helper.close(); await Promise.allSettled([...owned].map(client => client.forceStop()));
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir())); await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
