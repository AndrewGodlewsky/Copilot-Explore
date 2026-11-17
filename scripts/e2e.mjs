import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { fork } from 'node:child_process';

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
let session, secondSession;
const deadline = setTimeout(() => { process.stderr.write('Explorer runtime fixture timed out.\n'); void client.forceStop(); }, 55000);
async function until(read, predicate, label) {
  for (let i = 0; i < 100; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error(`Timed out: ${label}`);
}
try {
  // Run the launcher inside the actual SEA extension bootstrap; plain Node misses this path.
  await new Promise((resolve, reject) => {
    let ready = false;
    const probe = fork(join(dirname(cli), 'preloads', 'extension_bootstrap.mjs'), [], {
      execPath: cli, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...environment, COPILOT_SDK_PATH: sdkDirectory, EXTENSION_PATH: join(root, 'test', 'fixtures', 'voice-runtime.mjs'), COPILOT_EXTENSION_PARENT_PID: String(process.pid), COPILOT_EXTENSION_SANDBOXED: '0' },
    });
    const timer = setTimeout(() => { probe.kill(); reject(new Error('Installed runtime voice launcher timed out.')); }, 12000);
    probe.once('error', error => { clearTimeout(timer); reject(error); });
    probe.once('exit', code => { clearTimeout(timer); if (!ready) reject(new Error(`Voice launcher exited ${code} before readiness.`)); });
    probe.once('message', message => {
      clearTimeout(timer);
      if (message.voiceWorker !== 'ready') { probe.kill(); reject(new Error('Unexpected voice launcher fixture response.')); return; }
      ready = true; resolve();
    });
  });
  console.log('Installed extension runtime launched the isolated voice helper; no microphone or model opened.');
  await client.start();
  const sessionOptions = { workingDirectory: project, availableTools: [], requestExtensions: true, requestCanvasRenderer: true,
    extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false,
    onPermissionRequest: () => ({ kind: 'denied-by-rules', rules: [] }),
    model: 'gpt-4o', provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' },
  };
  session = await client.createSession(sessionOptions);
  const catalog = await until(() => session.rpc.canvas.list(), result => result.canvases?.some(c => c.canvasId === 'explorer'), 'canvas registration');
  const found = catalog.canvases.find(c => c.canvasId === 'explorer');
  assert.equal(found.extensionId, 'plugin:explorer:explorer');
  console.log('Installed runtime registered Explorer with its plugin ownership.');
  const instanceId = 'explorer-fixture';
  const opened = await session.rpc.canvas.open({ canvasId: 'explorer', instanceId, input: {} });
  assert.ok(opened.url);
  assert.match(await (await fetch(opened.url)).text(), /Explorer/);
  const navigationUrl = opened.url + 'api/navigation-settings';
  assert.equal((await (await fetch(navigationUrl)).json()).settings.wheelMode, 'zoom');
  const navigationSave = await fetch(navigationUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(opened.url).origin }, body: JSON.stringify({ revision: 0, wheelMode: 'pan', sensitivity: 1.5, motion: 'reduce' }) });
  assert.equal(navigationSave.status, 200, await navigationSave.clone().text());
  assert.match(await (await fetch(opened.url + 'voice.mjs')).text(), /matchesShortcut/);
  const voice = await (await fetch(opened.url + 'api/voice')).json();
  assert.equal(voice.ready, false, 'The disposable home has no configured host voice model; do not record or download.');
  assert.ok(voice.error);
  const voiceOptions = await fetch(opened.url + 'api/voice/settings');
  assert.equal(voiceOptions.status, 400, 'Settings explain missing host configuration without enumerating or recording devices.');
  assert.ok((await voiceOptions.json()).error);
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
  snapshot = await state(); assert.equal(snapshot.document.nodes.length, 1); assert.equal(snapshot.pending, null);
  assert.equal(snapshot.preview.questions.length, 1);
  const native = await session.rpc.canvas.action.invoke({ instanceId, actionName: 'get_exploration', input: {} });
  assert.ok(!JSON.stringify(native).includes('Who will care for it?'), 'Native context excludes candidates');
  assert.equal((await (await fetch(opened.url + 'export.json')).json()).nodes.length, 1);
  snapshot = await action('accept-questions', { batchId: snapshot.preview.id, selected: [{ index: 0, question: 'Who will care for it?' }] });
  assert.equal(snapshot.document.nodes.length, 2); assert.equal(snapshot.preview, null);
  const nodeId = snapshot.document.nodes[1].id;
  await action('answer', { nodeId, answer: 'Neighbors', expand: false });
  await action('research', { nodeId });
  snapshot = await until(state, value => !value.pending, 'research access check');
  assert.match(snapshot.error, /Sign in|enabled Copilot model|Checking Copilot access/);
  const researchAction = await session.rpc.canvas.action.invoke({ instanceId, actionName: 'submit_research', input: {} }).catch(error => ({ error: error.message }));
  assert.match(JSON.stringify(researchAction), /error|not found|unknown/i);
  await action('finish');
  const exported = await (await fetch(opened.url + 'export.json')).json();
  assert.equal(exported.nodes[1].answer, 'Neighbors'); assert.equal(exported.nodes[1].research, null);
  assert.match(await (await fetch(opened.url + 'export.md')).text(), /Neighbors/);
  const pendingLate = await action('questions', { nodeId });
  await action('cancel');
  const late = await session.rpc.canvas.action.invoke({ instanceId, actionName: 'submit_questions', input: { requestId: pendingLate.pending.id, questions: [{ question: 'Stale question?', category: 'Stale' }] } }).catch(error => ({ error: error.message }));
  assert.ok(JSON.stringify(late).match(/cancelled|completed|error/i));
  await session.rpc.canvas.close({ instanceId });
  const reopened = await session.rpc.canvas.open({ canvasId: 'explorer', instanceId, input: {} });
  assert.notEqual(reopened.url, opened.url);
  assert.equal((await (await fetch(reopened.url + 'api/navigation-settings')).json()).settings.wheelMode, 'pan');
  const restored = await (await fetch(reopened.url + 'api/state')).json();
  assert.deepEqual(restored.document, exported);
  const imported = await session.rpc.canvas.open({ canvasId: 'explorer', instanceId: 'explorer-import', input: {} });
  const result = await fetch(imported.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'import', document: exported }) });
  assert.equal(result.status, 200); assert.equal((await result.json()).document.nodes[1].answer, 'Neighbors');
  const library = await (await fetch(imported.url + 'api/library')).json();
  assert.equal(library.entries.length, 1, 'identical import reopens without another stored document');
  secondSession = await client.createSession(sessionOptions);
  await until(() => secondSession.rpc.canvas.list(), value => value.canvases?.some(c => c.canvasId === 'explorer'), 'second-session canvas registration');
  const across = await secondSession.rpc.canvas.open({ canvasId: 'explorer', instanceId: 'library-other-session', input: {} });
  assert.equal((await (await fetch(across.url + 'api/state')).json()).document, null);
  const acrossPost = async input => fetch(across.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
  const crossOpen = await acrossPost({ action: 'open', key: library.entries[0].key });
  assert.equal(crossOpen.status, 200); assert.deepEqual((await crossOpen.json()).document, exported);
  const crossAnswer = await acrossPost({ action: 'answer', revision: exported.revision, nodeId, answer: 'Another session, same journey', expand: false });
  assert.equal(crossAnswer.status, 200);
  const crossState = await crossAnswer.json();
  const staleSave = await fetch(imported.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'answer', revision: exported.revision, nodeId, answer: 'Stale writer', expand: false }) });
  assert.equal(staleSave.status, 400); assert.match((await staleSave.json()).error, /Another canvas/);
  const followup = await acrossPost({ action: 'questions', revision: crossState.document.revision, nodeId });
  const crossPending = await followup.json(); assert.ok(crossPending.pending);
  await until(async () => requests, values => JSON.stringify(values).includes('library-other-session'), 'currently attached session question delivery');
  await secondSession.rpc.canvas.action.invoke({ instanceId: 'library-other-session', actionName: 'submit_questions', input: { requestId: crossPending.pending.id, questions: [{ question: 'How will the new group coordinate?', category: 'People' }] } });
  const staged = await (await fetch(across.url + 'api/state')).json(); assert.equal(staged.document.nodes.length, 2);
  const accepted = await acrossPost({ action: 'accept-questions', revision: staged.document.revision, batchId: staged.preview.id, selected: [{ index: 0, question: staged.preview.questions[0].question }] });
  assert.equal(accepted.status, 200); assert.equal((await accepted.json()).document.nodes.length, 3);
  const unsaved = await acrossPost({ action: 'questions', revision: staged.document.revision + 1, nodeId });
  const unsavedRequest = await unsaved.json();
  await secondSession.rpc.canvas.action.invoke({ instanceId: 'library-other-session', actionName: 'submit_questions', input: { requestId: unsavedRequest.pending.id, questions: [{ question: 'Unsaved proposal?', category: 'People' }] } });
  await secondSession.rpc.canvas.close({ instanceId: 'library-other-session' });
  const previewReopen = await secondSession.rpc.canvas.open({ canvasId: 'explorer', instanceId: 'library-other-session', input: {} });
  const previewRestored = await (await fetch(previewReopen.url + 'api/state')).json();
  assert.equal(previewRestored.preview, null); assert.equal(previewRestored.document.nodes.length, 3);
  const seedResponse = await fetch(previewReopen.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'add-direction', revision: previewRestored.document.revision, nodeId, direction: '  Safety seed  ' }) });
  assert.equal(seedResponse.status, 200); const seeded = await seedResponse.json();
  const seed = seeded.document.nodes.find(n => n.id === seeded.directionId);
  assert.equal(seed.kind, 'direction'); assert.equal(seed.question, '  Safety seed  '); assert.equal(seed.answer, ''); assert.equal(seed.answerState, undefined);
  await until(async () => requests, values => JSON.stringify(values).includes('user-supplied direction'), 'no-answer seed generation');
  await secondSession.rpc.canvas.action.invoke({ instanceId: 'library-other-session', actionName: 'submit_questions', input: { requestId: seeded.pending.id, questions: [{ question: 'Which safety concern first?', category: 'Safety' }] } });
  const seedPreview = await (await fetch(previewReopen.url + 'api/state')).json();
  assert.equal(seedPreview.document.nodes.length, 4); assert.equal(seedPreview.preview.nodeId, seed.id);
  const seedAccept = await fetch(previewReopen.url + 'api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'accept-questions', revision: seedPreview.document.revision, batchId: seedPreview.preview.id, selected: [{ index: 0, question: 'Which safety concern first?' }] }) });
  assert.equal(seedAccept.status, 200); const developed = await seedAccept.json();
  assert.equal(developed.document.nodes.at(-1).parentId, seed.id); assert.equal(developed.document.nodes.at(-1).generation.adjusted, false);
  await secondSession.rpc.canvas.close({ instanceId: 'library-other-session' });
  await session.rpc.canvas.close({ instanceId: 'explorer-import' });
  await session.rpc.canvas.close({ instanceId });
  const { version } = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
  console.log(`PASS Explorer ${version}: real SDK discovery/open, queued chat delivery, preview staging/explicit acceptance/native exclusion/close discard, no-answer direction seed/preview acceptance, answers, research access guard, exports, stale-response rejection, close/reopen, duplicate import, cross-session library reopen and shared-writer protection. Local fixture only; no paid model or UI automation.`);
} finally {
  clearTimeout(deadline);
  await session?.disconnect().catch(() => {});
  await secondSession?.disconnect().catch(() => {});
  await client.forceStop();
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
