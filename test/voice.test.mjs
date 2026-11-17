import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { parseVoiceSettings } from '../com.github.copilot/extensions/explorer/voice-settings.mjs';
import { VoiceService } from '../com.github.copilot/extensions/explorer/voice.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

const settings = { version: 1, state: { shortcut: { keys: 'ctrl+Space', useKeyCode: true }, recordingMode: 'push_to_talk', selectedModelId: 'nemotron-speech-streaming-en-0.6b', selectedInputDeviceId: 'default', dictationLanguage: 'auto' } };
test('host voice settings preserve the shortcut and reject incompatible configurations', () => {
  const parsed = parseVoiceSettings(settings);
  assert.equal(parsed.shortcut.code, 'Space'); assert.equal(parsed.shortcut.ctrl, true);
  assert.equal(parsed.label, 'Ctrl + Space'); assert.equal(parsed.mode, 'push_to_talk');
  assert.throws(() => parseVoiceSettings({ ...settings, version: 2 }), /settings format/);
  assert.equal(parseVoiceSettings({ ...settings, state: { ...settings.state, selectedInputDeviceId: 'unmapped-device' } }).label, 'Ctrl + Space', 'Explorer selects its own microphone');
  assert.throws(() => parseVoiceSettings({ ...settings, state: { ...settings.state, selectedModelId: '<invalid>' } }), /invalid/);
});

function fixture(options = {}) {
  let launches = 0, child;
  const service = new VoiceService({ discover: async () => ({ ...parseVoiceSettings(settings), ready: true }),
    launch: async () => { launches++; child = new EventEmitter(); child.send = message => { child.lastMessage = message; }; child.kill = () => { child.killed = true; child.emit('exit', 0); }; return { child, cleanup: async () => {} }; }, ...options });
  return { service, get child() { return child; }, get launches() { return launches; } };
}
const id = '12345678-1234-1234-1234-123456789012';
test('release during discovery prevents any late microphone process', async t => {
  let release;
  const f = fixture({ discover: () => new Promise(resolve => { release = resolve; }) }); t.after(() => f.service.close());
  f.service.start(id); await delay(0); f.service.finish(id); release({ ready: true }); await delay(10);
  assert.equal(f.launches, 0); assert.equal(f.service.poll(id).phase, 'cancelled');
});
test('a release arriving before a new start prevents reordered capture', async t => {
  const f = fixture(); t.after(() => f.service.close());
  f.service.cancel(id);
  const next = id.replace('12345678', 'abcdefgh');
  f.service.finish(next); f.service.start(next); await delay(10);
  assert.equal(f.launches, 0); assert.equal(f.service.poll(next).phase, 'cancelled');
});
test('recording is bounded, correlated, and cancelled when its browser stops checking in', async t => {
  let now = 0; const f = fixture({ now: () => now }); t.after(() => f.service.close());
  f.service.start(id); await delay(10); f.child.emit('message', { phase: 'listening' });
  f.service.finish('stale-recording'); assert.equal(f.service.poll(id).phase, 'listening');
  now = 6000; f.service.tick(); assert.equal(f.child.killed, true);
  assert.equal(f.service.poll(id).phase, 'cancelled');
});
test('finish stops capture and returns only the matching completed transcript', async t => {
  const f = fixture(); t.after(() => f.service.close());
  f.service.start(id); await delay(10); f.child.emit('message', { phase: 'listening' });
  f.service.finish(id); assert.deepEqual(f.child.lastMessage, { action: 'finish' });
  f.child.emit('message', { phase: 'done', text: 'Neighbors share tools.' });
  assert.equal(f.service.poll(id).text, 'Neighbors share tools.');
  f.service.cancel(id); assert.equal(f.service.poll(id).text, undefined);
});

test('cancel releases the local microphone owner and worker for an immediate retry', async t => {
  const f = fixture(); t.after(() => f.service.close());
  f.service.start(id); await delay(10); f.child.emit('message', { phase: 'listening' });
  const first = f.child; f.service.cancel(id);
  assert.equal(first.killed, true);
  const retry = id.replace('12345678', 'abcdefgh');
  assert.equal(f.service.start(retry).phase, 'loading'); await delay(10);
  assert.equal(f.launches, 2);
  f.service.cancel(retry); assert.equal(f.child.killed, true);
});

test('voice HTTP requires the canvas origin and rejects injected model paths and oversized bodies', async t => {
  const f = fixture(), server = await startServer({ close: async () => {} }, f.service); t.after(() => server.close());
  const headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin };
  const send = (input, requestHeaders = headers) => fetch(server.url + 'api/voice', { method: 'POST', headers: requestHeaders, body: JSON.stringify(input) });
  assert.equal((await send({ action: 'start', id }, { ...headers, Origin: 'http://attacker.test' })).status, 403);
  assert.equal((await send({ action: 'start', id }, { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' })).status, 403);
  assert.equal((await send({ action: 'start', id, modelPath: 'C:/wrong' })).status, 400);
  assert.equal((await send({ action: 'start', id: 'x'.repeat(2000) })).status, 400);
  assert.equal(f.launches, 0);
  const readiness = await (await fetch(server.url + 'api/voice')).json();
  assert.equal(readiness.ready, true); assert.equal(readiness.sdk, undefined); assert.equal(readiness.modelPath, undefined);
  assert.equal((await send({ action: 'start', id })).status, 200); await delay(10);
  assert.equal(f.launches, 1); f.child.emit('message', { phase: 'listening' });
  assert.equal((await send({ action: 'cancel', id })).status, 200); assert.equal(f.child.killed, true);
});

test('closing during asynchronous child creation kills a late child', async () => {
  let release, killed = false;
  const f = fixture({ launch: () => new Promise(resolve => { release = resolve; }) });
  f.service.start(id); await delay(10); f.service.close();
  release({ child: { kill: () => { killed = true; } } }); await delay(10);
  assert.equal(killed, true);
});

test('live levels are bounded, retain recent audio only and disappear outside listening', async t => {
  let now = 0; const f = fixture({ now: () => now }); t.after(() => f.service.close());
  f.service.start(id); await delay(10);
  f.child.emit('message', { phase: 'level', level: 1 }); assert.deepEqual(f.service.poll(id).levels, []);
  f.child.emit('message', { phase: 'listening' }); now = 2400;
  for (let i = 0; i < 30; i++) f.child.emit('message', { phase: 'level', level: .5 });
  f.child.emit('message', { phase: 'level', level: NaN }); f.child.emit('message', { phase: 'level', level: 100 });
  const listening = f.service.poll(id); assert.equal(listening.levels.length, 24); assert.equal(listening.levels.at(-1), 1); assert.equal(listening.elapsedMs, 2400);
  f.service.finish(id); assert.deepEqual(f.service.poll(id).levels, []);
  f.child.emit('message', { phase: 'level', level: .8 }); assert.deepEqual(f.service.poll(id).levels, []);
});
