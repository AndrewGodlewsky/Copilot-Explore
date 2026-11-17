import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { downloadedModels, selectVoice } from '../com.github.copilot/extensions/explorer/voice-settings.mjs';
import { VoiceService } from '../com.github.copilot/extensions/explorer/voice.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { VoicePreferences } from '../com.github.copilot/extensions/explorer/voice-preferences.mjs';
import { microphoneIndex, audioLevel } from '../com.github.copilot/extensions/explorer/voice-audio.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-voice-controls-'));
  t.after(async () => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
test('microphone selection follows its name across reorder and fails for missing or ambiguous names', () => {
  assert.equal(microphoneIndex('', ['USB', 'Headset']), -1);
  assert.equal(microphoneIndex('USB', ['Headset', 'USB']), 1);
  assert.throws(() => microphoneIndex('USB', ['Headset']), /unavailable/);
  assert.throws(() => microphoneIndex('USB', ['USB', 'USB']), /same name/);
});
test('measured audio level distinguishes silence from speech and stays bounded', () => {
  assert.equal(audioLevel(new Int16Array(1600)), 0);
  const quiet = audioLevel(new Int16Array(1600).fill(100));
  const loud = audioLevel(new Int16Array(1600).fill(10000));
  assert.ok(quiet > 0 && loud > quiet && loud <= 1);
  assert.equal(audioLevel(new Int16Array(1600).fill(-32768)), 1);
});
test('Explorer preferences persist independently, protect against stale saves and preserve malformed files', async t => {
  const file = join(await temporary(t), 'voice-settings.json'), store = new VoicePreferences(file);
  assert.deepEqual(await store.read(), { version: 1, revision: 0, microphone: '', model: 'copilot' });
  await store.save({ microphone: 'USB', model: 'downloaded-model-id' }, 0);
  const reopened = new VoicePreferences(file);
  assert.equal((await reopened.read()).microphone, 'USB');
  await assert.rejects(() => store.save({ microphone: '', model: 'copilot' }, 0), /changed/);
  assert.equal((await reopened.read()).model, 'downloaded-model-id');
  await writeFile(file, '{broken');
  await assert.rejects(() => store.read(), /preserved/);
  assert.equal(await readFile(file, 'utf8'), '{broken');
});
test('model choices come only from downloaded speech packages and retain unsupported formats visibly', async t => {
  const root = await temporary(t);
  const add = async (folder, type, sampleRate = 16000) => {
    const dir = join(root, 'Microsoft', folder, 'v3'); await mkdir(dir, { recursive: true });
    const model = { type, sample_rate: sampleRate, encoder: { filename: 'encoder.onnx' }, decoder: { filename: 'decoder.onnx' }, joiner: { filename: 'joint.onnx' } };
    await writeFile(join(dir, 'genai_config.json'), JSON.stringify({ model }));
    await writeFile(join(dir, 'inference_model.json'), JSON.stringify({ Name: folder.replace(/-\d+$/, ':3') }));
    for (const name of ['encoder.onnx', 'decoder.onnx', 'joint.onnx', 'encoder.onnx.data', 'decoder.onnx.data', 'joint.onnx.data', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt']) await writeFile(join(dir, name), 'fixture');
  };
  await add('nemotron-speech-streaming-en-0.6b-generic-cpu-3', 'nemotron_speech');
  await add('whisper-large-v3-generic-cpu-1', 'whisper');
  await add('phi-4-generic-cpu-1', 'phi3');
  await writeFile(join(root, 'foundry.modelinfo.json'), JSON.stringify({ catalogOnly: 'another-model' }));
  const models = await downloadedModels(root);
  assert.equal(models.length, 2);
  assert.equal(models.find(m => m.alias === 'nemotron-speech-streaming-en-0.6b').supported, true);
  assert.equal(models.find(m => m.type === 'whisper').supported, false);
  assert.ok(models.every(m => /^[a-f0-9]{24}$/.test(m.id)));
  const modelPath = models.find(m => m.supported).path;
  await rm(join(modelPath, 'encoder.onnx.data'));
  const partial = (await downloadedModels(root)).find(m => m.path === modelPath);
  assert.equal(partial.supported, false, 'missing model weights are not selectable'); assert.match(partial.reason, /incomplete/i);
});

test('voice choices validate devices and downloaded IDs, preserve revisions and never expose native paths', async t => {
  const inventory = { shortcut: { code: 'Space', ctrl: true }, label: 'Ctrl + Space', mode: 'push_to_talk', selectedModel: 'english', language: 'auto', recorder: 'C:/private/recorder', sdk: 'C:/private/sdk',
    models: [{ id: 'local-english', alias: 'english', path: 'C:/private/model', supported: true, label: 'English' }, { id: 'unsupported', supported: false, reason: 'Unsupported format', label: 'Whisper' }] };
  let names = ['USB', 'Duplicate', 'Duplicate'];
  const preferencesFile = join(await temporary(t), 'voice-settings.json');
  const voice = new VoiceService({ preferencesFile, inspect: async () => inventory, devices: async () => names, discover: async prefs => selectVoice(inventory, prefs) });
  t.after(() => voice.close());
  const initial = await voice.options(); assert.equal(initial.ready, true); assert.equal(initial.microphones[1].supported, false); assert.equal(JSON.stringify(initial).includes('C:/private'), false);
  await assert.rejects(() => voice.configure({ microphone: 'Gone', model: 'copilot', revision: 0 }), /unavailable/);
  await assert.rejects(() => voice.configure({ microphone: '', model: 'unsupported', revision: 0 }), /Unsupported/);
  await assert.rejects(() => voice.configure({ microphone: '', model: 'C:/injected', revision: 0 }), /not downloaded/);
  const saved = await voice.configure({ microphone: 'USB', model: 'local-english', revision: 0 });
  assert.equal(saved.preferences.revision, 1); assert.equal(saved.preferences.microphone, 'USB');
  await assert.rejects(() => voice.configure({ microphone: '', model: 'copilot', revision: 0 }), /changed/);
  names = [];
  assert.equal((await voice.options()).ready, false); assert.equal((await voice.options()).preferences.microphone, 'USB', 'no silent fallback');
  const resolved = selectVoice(inventory, await voice.preferences.read()); assert.equal(resolved.modelPath, 'C:/private/model'); assert.equal(resolved.microphoneName, 'USB'); assert.equal(resolved.language, undefined);
});

test('voice settings HTTP blocks other origins, injected fields and invalid revisions before configuration', async t => {
  let calls = 0;
  const server = await startServer({ close: async () => {} }, { configure: async input => { calls++; return { preferences: input }; }, options: async () => ({ models: [] }), close() {} });
  t.after(() => server.close());
  const headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin };
  const send = (input, h = headers) => fetch(server.url + 'api/voice/settings', { method: 'POST', headers: h, body: JSON.stringify(input) });
  const valid = { microphone: '', model: 'copilot', revision: 0 };
  assert.equal((await send(valid, { ...headers, Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await send(valid, { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await send({ ...valid, modelPath: 'C:/injected' })).status, 400);
  assert.equal((await send({ ...valid, revision: -1 })).status, 400);
  assert.equal((await send({ ...valid, microphone: 'x'.repeat(5000) })).status, 400); assert.equal(calls, 0);
  assert.equal((await send(valid)).status, 200); assert.equal(calls, 1);
});
