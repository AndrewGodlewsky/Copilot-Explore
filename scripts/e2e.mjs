import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const sdkDirectory = process.env.COPILOT_SDK_DIR, cli = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && cli, 'Set COPILOT_SDK_DIR and COPILOT_CLI_PATH to the inspected installed desktop SDK/runtime.');
const { CopilotClient, RuntimeConnection } = await import(pathToFileURL(join(sdkDirectory, 'index.js')).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'explorer-runtime-'));
const project = join(temporary, 'project'); await mkdir(project);
const requests = [];
const fixture = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  requests.push(JSON.parse(body));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'explorer-fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'Fixture received. Canvas response is supplied by the test harness.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const environment = { ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, EXPLORER_DATA_DIR: join(temporary, 'explorer-data') };
const client = new CopilotClient({ mode: 'empty', baseDirectory: join(temporary, 'copilot'), workingDirectory: project,
  useLoggedInUser: false, builtinPluginDirectories: [root],
  connection: RuntimeConnection.forStdio({ path: cli, args: ['--no-auto-update'], env: environment }),
});
let session;
const deadline = setTimeout(() => { process.stderr.write('Explorer runtime fixture timed out.\n'); void client.forceStop(); }, 55000);
async function until(read, predicate, label) {
  for (let i = 0; i < 100; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  await client.start();
  session = await client.createSession({ workingDirectory: project, availableTools: [], requestExtensions: true, requestCanvasRenderer: true,
    extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false,
    onPermissionRequest: () => ({ kind: 'denied-by-rules', rules: [] }),
    model: 'gpt-4o', provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' },
  });
  const catalog = await until(() => session.rpc.canvas.list(), result => result.canvases?.some(c => c.canvasId === 'explorer'), 'canvas registration');
  const found = catalog.canvases.find(c => c.canvasId === 'explorer');
  assert.equal(found.extensionId, 'plugin:explorer:explorer');
  console.log('Installed runtime registered Explorer with its plugin ownership.');
  const instanceId = 'explorer-fixture';
  const opened = await session.rpc.canvas.open({ canvasId: 'explorer', instanceId, input: {} });
  assert.ok(opened.url);
  assert.match(await (await fetch(opened.url)).text(), /Explorer/);
  const state = async () => (await fetch(opened.url + 'api/state')).json();
  const action = async (name, input = {}) => {
    const current = await state();
    const response = await fetch(opened.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: name, revision: current.document?.revision, ...input }) });
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  await action('start', { topic: 'Synthetic garden fixture' });
  await until(async () => requests, values => values.length > 0, 'queued session message');
  assert.ok(JSON.stringify(requests).includes('Synthetic garden fixture'));
  assert.ok(JSON.stringify(requests).includes('submit_questions'));
  let snapshot = await state();
  await session.rpc.canvas.action.invoke({ instanceId, actionName: 'submit_questions', input: { requestId: snapshot.pending.id, questions: [{ question: 'Who will care for it?', category: 'People' }] } });
  snapshot = await state(); assert.equal(snapshot.document.nodes.length, 2); assert.equal(snapshot.pending, null);
  const nodeId = snapshot.document.nodes[1].id;
  await action('answer', { nodeId, answer: 'Neighbors', expand: false });
  await action('research', { nodeId });
  snapshot = await state();
  await session.rpc.canvas.action.invoke({ instanceId, actionName: 'submit_research', input: { requestId: snapshot.pending.id,
    research: { basis: 'reasoning', summary: 'Synthetic comparison.', options: [
      { title: 'Volunteer rota', description: 'Share work.', pros: ['Shared effort'], cons: ['Scheduling'] },
      { title: 'Coordinator', description: 'One owner.', pros: ['Clear ownership'], cons: ['Bottleneck'] },
    ], recommendation: 'Try a rota.', uncertainty: 'Fixture only, no actual research.', sources: [] },
  } });
  await action('finish');
  const exported = await (await fetch(opened.url + 'export.json')).json();
  assert.equal(exported.nodes[1].answer, 'Neighbors'); assert.equal(exported.nodes[1].research.options.length, 2);
  assert.match(await (await fetch(opened.url + 'export.md')).text(), /Volunteer rota/);
  const pendingLate = await action('questions', { nodeId });
  await action('cancel');
  const late = await session.rpc.canvas.action.invoke({ instanceId, actionName: 'submit_questions', input: { requestId: pendingLate.pending.id, questions: [{ question: 'Stale question?', category: 'Stale' }] } }).catch(error => ({ error: error.message }));
  assert.ok(JSON.stringify(late).match(/cancelled|completed|error/i));
  await session.rpc.canvas.close({ instanceId });
  const reopened = await session.rpc.canvas.open({ canvasId: 'explorer', instanceId, input: {} });
  assert.notEqual(reopened.url, opened.url);
  const restored = await (await fetch(reopened.url + 'api/state')).json();
  assert.deepEqual(restored.document, exported);
  const imported = await session.rpc.canvas.open({ canvasId: 'explorer', instanceId: 'explorer-import', input: {} });
  const result = await fetch(imported.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'import', document: exported }) });
  assert.equal(result.status, 200); assert.equal((await result.json()).document.nodes[1].answer, 'Neighbors');
  await session.rpc.canvas.close({ instanceId: 'explorer-import' });
  await session.rpc.canvas.close({ instanceId });
  const { version } = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
  console.log(`PASS Explorer ${version}: real SDK discovery/open, queued chat delivery, canvas callbacks, answers, research payload, exports, stale-response rejection, close/reopen and file import. Local fixture only; no paid model or UI automation.`);
} finally {
  clearTimeout(deadline);
  await session?.disconnect().catch(() => {});
  await client.forceStop();
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
