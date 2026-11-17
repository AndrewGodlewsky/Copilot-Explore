import test from 'node:test';
import assert from 'node:assert/strict';
import { Diagnostics, supportBundle } from '../com.github.copilot/extensions/explorer/diagnostics.mjs';
import { VoiceService } from '../com.github.copilot/extensions/explorer/voice.mjs';
import { readHostReadiness } from '../com.github.copilot/extensions/explorer/canvas.mjs';
import { downloadedModels } from '../com.github.copilot/extensions/explorer/voice-settings.mjs';
import { VoicePreferences } from '../com.github.copilot/extensions/explorer/voice-preferences.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { request } from 'node:http';

const canary = 'PRIVATE-CANARY-token/account/session/document/https://private.test\nC:\\Users\\private\\audio';
const readyHost = { runtime: 'ready', sdk: 'ready', protocol: 3, account: 'ready', model: 'ready' };
const inventory = { selectedModel: 'test', recorder: canary, models: [{ id: canary, alias: 'test', supported: true, path: canary }] };
const voiceFixture = (t, overrides = {}) => {
  const voice = new VoiceService({ inspect: async () => inventory, devices: async () => ['Microphone ' + canary], launch: () => assert.fail('must not record'), ...overrides });
  t.after(() => voice.close()); return voice;
};

test('read-only host seam reads cached prerequisites without tools, sessions, refresh or mutations', async () => {
  let calls = 0;
  const parent = { rpc: { model: { getCurrent: async () => { calls++; return { modelId: canary }; }, list: async options => { assert.deepEqual(options, { refresh: false }); calls++; return { list: [{ id: canary, provider: { kind: 'copilot' }, policy: { state: 'enabled' }, nested: canary }] }; } }, gitHubAuth: { getStatus: async () => { calls++; return { isAuthenticated: true, login: canary, host: canary }; } }, tools: new Proxy({}, { get: () => assert.fail('must not initialize tools') }) }, send: () => assert.fail('must not infer') };
  const result = await readHostReadiness(parent, async () => ({ protocol: 3, supported: true }));
  assert.deepEqual(result, readyHost); assert.equal(calls, 3); assert.ok(!JSON.stringify(result).includes(canary));
  assert.equal((await readHostReadiness({}, async () => ({ supported: false }))).sdk, 'unsupported');
  assert.equal((await readHostReadiness(parent, async () => { throw Object.assign(new Error(canary), { code: 'ERR_MODULE_NOT_FOUND' }); })).sdk, 'unavailable');
  parent.rpc.model.list = async () => ({ list: [] });
  assert.equal((await readHostReadiness(parent, async () => ({ supported: true, protocol: 3 }))).model, 'unavailable');
});

test('speech diagnostics distinguish installed prerequisites from model loadability and live capture', async t => {
  const voice = voiceFixture(t);
  const status = await voice.diagnostics();
  assert.deepEqual(status, { runtime: 'ready', model: 'ready', microphone: 'ready', loadability: 'unknown', capture: 'unknown', modelCount: 1, deviceCount: 1, error: 'none' });
  assert.ok(!JSON.stringify(status).includes(canary));
  for (const [models, expected] of [[[], 'unavailable'], [[{ alias: 'test', supported: false }], 'unsupported']]) {
    voice.inspect = async () => ({ ...inventory, models });
    assert.equal((await voice.diagnostics()).model, expected);
  }
  voice.inspect = async () => inventory; voice.devices = async () => [];
  assert.equal((await voice.diagnostics()).microphone, 'unavailable');
  voice.inspect = async () => ({ ...inventory, models: [{ alias: 'test', supported: false, readiness: 'unavailable', reason: canary }] });
  assert.equal((await voice.diagnostics()).model, 'unavailable', 'known incomplete model cannot be loaded');
  voice.inspect = async () => ({ ...inventory, models: [{ alias: 'test', supported: undefined }] });
  assert.equal((await voice.diagnostics()).model, 'unknown');
  voice.inspect = async () => { throw Object.assign(new Error(canary), { code: 'VOICE_UNSUPPORTED' }); };
  assert.equal((await voice.diagnostics()).runtime, 'unsupported');
  voice.inspect = async () => { throw Object.assign(new Error(canary), { code: 'VOICE_UNAVAILABLE' }); };
  assert.equal((await voice.diagnostics()).runtime, 'unavailable');
  voice.inspect = async () => { throw new Error(canary); };
  assert.equal((await voice.diagnostics()).error, 'inspection-failed');
  assert.equal((await voice.diagnostics()).runtime, 'unknown');
});

test('diagnostics coalesce inspection, retry explicitly, and preserve authoritative ownership uncertainty', async () => {
  let release, reads = 0;
  const explorer = { unconfirmedResearchRelease: {}, unconfirmedToolFreeRelease: {}, recoveryNotice: { status: 'failed', message: canary }, exportObservation: { status: 'interrupted', id: canary }, error: canary };
  const diagnostics = new Diagnostics({ version: '0.1.40', explorer, readHost: () => { reads++; return new Promise(resolve => { release = resolve; }); }, voice: { diagnostics: async () => ({ runtime: 'ready', model: 'ready', microphone: 'ready' }) } });
  const first = diagnostics.inspect(), duplicate = diagnostics.inspect();
  await Promise.resolve(); release(readyHost);
  assert.deepEqual(await first, await duplicate); assert.equal(reads, 1);
  let value = await diagnostics.inspect(); assert.equal(reads, 1);
  assert.equal(value.helpers.research, 'unavailable'); assert.equal(value.helpers.toolFree, 'unavailable');
  explorer.recoveryNotice = null;
  value = await diagnostics.inspect(); assert.equal(value.helpers.researchRelease, 'unconfirmed');
  explorer.unconfirmedResearchRelease = null; explorer.unconfirmedToolFreeRelease = null;
  value = await diagnostics.inspect(); assert.equal(value.helpers.research, 'ready'); assert.equal(value.helpers.execution, 'unknown');
  const retry = diagnostics.inspect(true); await Promise.resolve(); release({ ...readyHost, account: 'unavailable' });
  assert.equal((await retry).helpers.research, 'unavailable'); assert.equal(reads, 2);
});

test('support bytes project exact fields, reject canaries everywhere, and bound versions/counts/output', () => {
  const source = { schemaVersion: canary, pluginVersion: '0.1.40', desktopVersion: canary, host: { ...readyHost, protocol: canary, private: { token: canary } }, speech: { runtime: 'ready', model: 'unavailable', microphone: 'unknown', modelCount: 9999999, deviceCount: -3, error: canary, label: canary, models: [canary] }, helpers: { research: 'unavailable', toolFree: 'unknown', researchRelease: 'unconfirmed', toolFreeRelease: 'unconfirmed', prompt: canary }, recovery: { save: 'failed', export: 'interrupted', error: canary, id: canary }, extra: { [canary]: canary } };
  const bytes = supportBundle(source), parsed = JSON.parse(bytes);
  assert.ok(Buffer.byteLength(bytes) < 4096); assert.ok(!bytes.includes('PRIVATE-CANARY')); assert.ok(!bytes.includes('private.test'));
  assert.deepEqual(Object.keys(parsed), ['schemaVersion', 'pluginVersion', 'desktopVersion', 'host', 'speech', 'helpers', 'recovery']);
  assert.deepEqual(Object.keys(parsed.host), ['runtime', 'sdk', 'protocol', 'account', 'model']);
  assert.deepEqual(Object.keys(parsed.speech), ['runtime', 'model', 'microphone', 'loadability', 'capture', 'modelCount', 'deviceCount', 'error']);
  assert.deepEqual(Object.keys(parsed.helpers), ['research', 'toolFree', 'researchRelease', 'toolFreeRelease', 'execution']);
  assert.deepEqual(Object.keys(parsed.recovery), ['save', 'export']);
  assert.equal(parsed.desktopVersion, 'unknown'); assert.equal(parsed.host.protocol, null); assert.equal(parsed.speech.error, 'inspection-failed');
  assert.equal(parsed.speech.modelCount, 500); assert.equal(parsed.speech.deviceCount, 0);
  assert.equal(JSON.parse(supportBundle({ pluginVersion: canary })).pluginVersion, 'unknown');
  for (const section of [undefined, 'host', 'speech', 'helpers', 'recovery']) {
    for (const key of Object.keys(section ? parsed[section] : parsed)) for (const malicious of [canary, { nested: [canary], message: canary, stack: canary }, [canary]]) {
      const poisoned = structuredClone(parsed);
      (section ? poisoned[section] : poisoned)[key] = malicious;
      const output = supportBundle(poisoned);
      assert.ok(!output.includes('PRIVATE-CANARY')); assert.ok(!output.includes('private.test')); assert.ok(Buffer.byteLength(output) < 4096);
    }
  }
});

test('a stalled inspection remains single-flight and returns unknown without replaying source reads', async () => {
  let reads = 0;
  const diagnostics = new Diagnostics({ version: '0.1.40', explorer: {}, timeoutMs: 10, readHost: () => { reads++; return new Promise(() => {}); }, voice: { diagnostics: async () => ({}) } });
  const value = await diagnostics.inspect(); assert.equal(value.host.sdk, 'unknown');
  assert.equal((await diagnostics.inspect(true)).host.sdk, 'unknown'); assert.equal(reads, 1);
});

test('expired late results are discarded and closed or newly blocked helpers override cached readiness', async () => {
  let release, reads = 0;
  const explorer = {};
  const diagnostics = new Diagnostics({ version: '0.1.40', explorer, timeoutMs: 5, readHost: () => { reads++; return new Promise(resolve => { release = resolve; }); }, voice: { diagnostics: async () => ({}) } });
  assert.equal((await diagnostics.inspect()).host.sdk, 'unknown');
  release(readyHost); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await diagnostics.inspect()).host.sdk, 'unknown', 'late success cannot replace timed-out observation');
  const retry = diagnostics.inspect(true); await Promise.resolve(); release(readyHost); await retry;
  assert.equal((await diagnostics.inspect()).helpers.research, 'ready'); assert.equal(reads, 2);
  explorer.closed = true; assert.equal((await diagnostics.inspect()).helpers.research, 'unavailable');
  explorer.closed = false; explorer.unconfirmedToolFreeRelease = {};
  assert.equal((await diagnostics.inspect()).helpers.toolFree, 'unavailable');
});

test('speech metadata and preference reads enforce byte and traversal bounds', async t => {
  const root = await mkdtemp(join(tmpdir(), 'explorer-diagnostics-')); t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'publisher', 'model'); await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'genai_config.json'), ' '.repeat(65537));
  await assert.rejects(downloadedModels(root), { code: 'DIAGNOSTIC_LIMIT' });
  await rm(join(folder, 'genai_config.json'));
  for (let i = 0; i < 501; i++) await mkdir(join(folder, 'v' + i));
  await assert.rejects(downloadedModels(root), { code: 'DIAGNOSTIC_LIMIT' });
  const preferences = join(root, 'voice-settings.json'); await writeFile(preferences, ' '.repeat(4097));
  await assert.rejects(new VoicePreferences(preferences).read(), { code: 'DIAGNOSTIC_LIMIT' });
});

test('real speech discovery preserves unknown metadata failures while absence and non-speech remain clean', async t => {
  const root = await mkdtemp(join(tmpdir(), 'explorer-speech-discovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const voice = voiceFixture(t, { inspect: async () => {
    let modelDiscoveryError = 'none';
    const models = await downloadedModels(root, category => { modelDiscoveryError = category; });
    return { ...inventory, selectedModel: 'nemotron-speech-streaming-en-0.6b', models, modelDiscoveryError };
  } });
  const check = async (model, error, microphone = 'ready') => {
    const speech = await voice.diagnostics();
    assert.equal(speech.model, model); assert.equal(speech.error, error);
    assert.equal(speech.runtime, 'ready'); assert.equal(speech.microphone, microphone);
    const bytes = supportBundle({ speech });
    assert.equal(JSON.parse(bytes).speech.error, error);
    assert.equal(JSON.parse(bytes).speech.model, model); assert.equal(JSON.parse(bytes).speech.microphone, microphone);
    assert.ok(!bytes.includes('PRIVATE-CANARY')); assert.ok(!bytes.includes(root)); assert.ok(!bytes.includes('private.test'));
  };
  await check('unavailable', 'none'); // No installed package.
  const folder = join(root, 'publisher', 'model'); await mkdir(folder, { recursive: true });
  const config = join(folder, 'genai_config.json'), metadata = join(folder, 'inference_model.json');
  await writeFile(config, JSON.stringify({ model: { type: 'phi3' } }));
  await writeFile(metadata, '{"Name":' + canary);
  await check('unavailable', 'none'); // Non-speech metadata is irrelevant.
  await writeFile(config, JSON.stringify({ model: { type: 'nemotron_speech', sample_rate: 16000 } }));
  await check('unknown', 'inspection-failed'); // Truncated known speech metadata.
  await rm(metadata); await mkdir(metadata);
  await check('unknown', 'inspection-failed'); // Known metadata is not readable as a file.
  await rm(metadata, { recursive: true });
  await check('unknown', 'inspection-failed'); // Known speech package has missing identity metadata.
  await writeFile(metadata, JSON.stringify({ Name: null, private: canary }));
  await check('unknown', 'inspection-failed'); // Parsed JSON still lacks usable identity.
  await writeFile(metadata, JSON.stringify({ Name: 'nemotron-speech-streaming-en-0.6b-generic-cpu:3' }));
  await check('unavailable', 'none'); // Readable known model with missing assets is genuinely unavailable.
  assert.equal((await voice.diagnostics()).modelCount, 1);
  await writeFile(config, '{"model":' + canary);
  await check('unknown', 'inspection-failed'); // Unreadable configuration cannot establish non-speech status.
  await writeFile(config, JSON.stringify({ model: { type: 'nemotron_speech', sample_rate: 16000 } }));
  await writeFile(metadata, '{"Name":' + canary);
  voice.preferences.read = async () => ({ microphone: canary, model: 'copilot' });
  await check('unknown', 'inspection-failed', 'unavailable'); // Simultaneous selected-device failure must not erase discovery uncertainty.
  voice.devices = async () => { throw Object.assign(new Error(canary), { code: 'VOICE_DEVICE' }); };
  await check('unknown', 'inspection-failed', 'unknown'); // Failed enumeration must preserve the earlier category too.
  voice.devices = async () => ['Other device'];
  await writeFile(config, JSON.stringify({ model: { type: 'phi3' } }));
  await check('unavailable', 'device-unavailable', 'unavailable'); // Device-only failure keeps its specific category.
});

test('private diagnostics and explicit support HTTP export enforce origin, schema, safe failure and snapshot isolation', async t => {
  const explorer = new Explorer({}), original = explorer.snapshot(), cursor = explorer.pollSnapshot().cursor;
  let reads = 0;
  const server = await startServer(explorer, { diagnostics: async () => ({ runtime: 'ready', model: 'ready', microphone: 'ready', label: canary, error: canary }), close() {} }, { readHost: async () => { reads++; return { ...readyHost, accountId: canary }; } });
  t.after(() => server.close());
  const headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin };
  const post = (path, input = {}, head = headers) => fetch(server.url + path, { method: 'POST', headers: head, body: JSON.stringify(input) });
  assert.equal(reads, 0);
  assert.equal((await fetch(server.url + 'api/diagnostics')).status, 200); assert.equal(reads, 1);
  assert.equal((await post('api/diagnostics', { action: 'retry' })).status, 200); assert.equal(reads, 2);
  assert.equal((await fetch(server.url + 'api/support')).status, 404);
  assert.equal((await post('api/support', {}, { ...headers, Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('api/support', {}, { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' })).status, 403);
  assert.equal((await post('api/support', { host: readyHost })).status, 400);
  assert.equal((await post('api/support', { text: canary.repeat(300) })).status, 400);
  const badHost = await new Promise(resolve => { const req = request(new URL('api/support', server.url), { method: 'POST', headers: { ...headers, Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); }); req.end('{}'); });
  assert.equal(badHost, 403);
  const exported = await post('api/support'), bytes = await exported.text();
  assert.equal(exported.status, 200); assert.equal(exported.headers.get('content-disposition'), 'attachment; filename="explorer-support.json"');
  assert.ok(!bytes.includes('PRIVATE-CANARY')); assert.equal(reads, 2);
  assert.deepEqual(explorer.snapshot(), original); assert.equal(explorer.pollSnapshot(cursor).snapshot, null);
  Object.defineProperty(explorer, 'unconfirmedResearchRelease', { configurable: true, get() { throw new Error(canary); } });
  const failed = await post('api/support'); assert.equal(failed.status, 400);
  assert.deepEqual(await failed.json(), { error: 'Support export failed. Retry diagnostics, then explicitly export again. No private paths or logs were collected.' });
  Object.defineProperty(explorer, 'unconfirmedResearchRelease', { value: null, writable: true });
});
