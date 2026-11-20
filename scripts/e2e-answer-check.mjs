// Installed SDK/runtime, anonymous loopback model fixture; never a paid account/session.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAnswerCheckHelper, prepareAnswerCheck, prepareChallenge } from '../com.github.copilot/extensions/explorer/answer-check.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { ProjectContext } from '../com.github.copilot/extensions/explorer/project-context.mjs';
import { createProjectBriefHelper, prepareProjectBrief, PROJECT_BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/project-brief.mjs';
import { createProjectQuestionHelper, prepareProjectQuestions } from '../com.github.copilot/extensions/explorer/project-questions.mjs';

const sdkDirectory = process.env.COPILOT_SDK_DIR, cli = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && cli, 'Set COPILOT_SDK_DIR and COPILOT_CLI_PATH to the installed desktop pair.');
const sdk = await import(pathToFileURL(join(sdkDirectory, 'index.js')).href);
const temporary = await mkdtemp(join(tmpdir(), 'explorer-check-fixture-'));
const prompts = [], owned = new Set(), workspaces = [];
let hold = false, onHeld, initialized = 0;
const document = createDocument('Explore Unicode 🌱', { objective: 'Understand a technical question' });
const [selected] = addQuestions(document, document.rootId, [{ question: 'What does λ mean for Élodie?', category: 'Technical' }]);
document.pins = [{ id: 'constraint-00000000000000', text: 'Use familiar vocabulary' }];
const challenge = process.argv.includes('--challenge');
const projectBrief = process.argv.includes('--project-brief');
const projectQuestions = process.argv.includes('--project-questions');
assert.ok([challenge, projectBrief, projectQuestions].filter(Boolean).length <= 1, 'Choose one fixture operation.');
selected.answer = 'Use the simpler route'; selected.answerState = 'tentative';
const project = join(temporary, 'selected-project'); await mkdir(project);
const projectCanary = 'INSTALLED-CHALLENGE-FILE-CANARY 🌿'; await writeFile(join(project, 'design.md'), projectCanary);
const selectedFiles = await new ProjectContext(async () => project).select(['design.md']);
const prepared = projectQuestions ? prepareProjectQuestions(document, selected.id, { revision: 2, claims: [{ id: 'claim-fixture', section: 'purpose', text: projectCanary, kind: 'user' }] }) : projectBrief ? prepareProjectBrief({ id: 'fixture-project-capture', sources: selectedFiles.sources }) : challenge ? prepareChallenge(document, [], selectedFiles.sources) : prepareAnswerCheck(document);
const usageLabel = projectQuestions ? 'Explorer Project Questions' : projectBrief ? 'Explorer Project Brief' : challenge ? 'Explorer Challenge Review' : 'Explorer Answer Check';
const output = projectQuestions ? { questions: [{ question: 'Should the current design change for Élodie 🌿?', category: 'Design', rationale: 'The future choice remains open.', importance: 'high', importanceReason: 'It changes later decisions.', claimIds: ['claim-fixture'] }] } : projectBrief ? Object.fromEntries(PROJECT_BRIEF_SECTIONS.map(section => [section, [{ id: section, text: 'Synthetic project claim.', kind: 'file-backed', sources: [{ id: selectedFiles.sources[0].id, quote: projectCanary }] }]])) : { findings: [{ id: 'u', category: challenge ? 'counterargument' : 'untested-assumption', explanation: 'The saved question may need evidence.', resolution: 'Ask the user which evidence would settle it.', sources: [{ kind: 'node', id: selected.id }] }] };
if (challenge) output.findings[0].sources.push({ kind: 'project', id: selectedFiles.sources[0].id });
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
const helper = (projectQuestions ? createProjectQuestionHelper : projectBrief ? createProjectBriefHelper : createAnswerCheckHelper)(parent, { runtime, usageDirectory: join(temporary, 'usage') });
const timer = setTimeout(() => { for (const client of owned) void client.forceStop(); }, 55000);
try {
  const result = await helper.run(prepared);
  if (projectQuestions) assert.equal(result[0].question, output.questions[0].question);
  else if (projectBrief) { assert.equal(result.sections.purpose[0].text, output.purpose[0].text); assert.equal(result.sources[0].excerpt, undefined); }
  else assert.equal(result.findings[0].explanation, output.findings[0].explanation);
  assert.equal(prepared.operation === 'challenge-review', challenge);
  assert.ok(prepared.bytes <= 131072);
  assert.equal(initialized, 1); assert.equal(prompts.length, 1);
  for (const prompt of prompts) {
    assert.equal(prompt.tools?.length ?? 0, 0);
    assert.equal(prompt.messages.some(m => m.role === 'user' && m.content.includes(selected.question)), !projectBrief);
    assert.ok(!JSON.stringify(prompt).includes('unsaved answer'));
    assert.equal(JSON.stringify(prompt).includes(projectCanary), challenge || projectBrief || projectQuestions);
    assert.equal(prompt.messages.some(m => m.role === 'user' && m.content.includes('Use familiar vocabulary')), !projectBrief);
  }
  const ids = await readdir(join(temporary, 'usage', 'session-state'));
  assert.equal(ids.length, 1);
  const labels = [];
  for (const id of ids) {
    const journal = await readFile(join(temporary, 'usage', 'session-state', id, 'events.jsonl'), 'utf8');
    labels.push([usageLabel].find(label => journal.includes(label)));
    assert.match(journal, /session.usage_record/); assert.ok(!journal.includes('Élodie'));
    assert.ok(!journal.includes(projectCanary), 'project bytes excluded from retained usage receipts; native logs are not covered');
  }
  assert.deepEqual(labels.sort(), [usageLabel].sort());
  hold = true; const abort = new AbortController(), held = new Promise(resolve => { onHeld = resolve; });
  const cancelled = assert.rejects(helper.run(prepared, { signal: abort.signal }), /cancelled/);
  await held; abort.abort(); await cancelled; assert.equal(initialized, 2);
  assert.equal((await readdir(join(temporary, 'usage', 'session-state'))).length, 2);
  for (const workspace of workspaces) await assert.rejects(stat(workspace), { code: 'ENOENT' });
  console.log((projectQuestions ? 'PASS isolated project questions: ' : projectBrief ? 'PASS isolated project brief: ' : challenge ? 'PASS isolated challenge review: ' : 'PASS isolated answer check: ') + ' exact captured SDK strings/byte budget, zero initialized tools, reviewed context, bounded structured output, attributed receipts, cancellation and release. No paid inference or existing session.');
} finally {
  clearTimeout(timer); await helper.close(); await Promise.allSettled([...owned].map(client => client.forceStop()));
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir())); await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
