import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { discoverVoice } from '../com.github.copilot/extensions/explorer/voice-settings.mjs';
import { spawnVoiceWorker } from '../com.github.copilot/extensions/explorer/voice-process.mjs';

// Uses only caller-provided PCM16/16kHz/mono or generated silence. Never opens a microphone.
const pcm = process.argv[2] ? await readFile(resolve(process.argv[2])) : Buffer.alloc(32000);
assert.ok(pcm.length <= 16000 * 2 * 30 && pcm.length % 2 === 0, 'Provide at most 30 seconds of raw PCM16 mono at 16kHz.');
const config = await discoverVoice();
const directory = await mkdtemp(join(tmpdir(), 'explorer-voice-smoke-'));
let child;
try {
  child = spawnVoiceWorker();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Native voice smoke timed out.')), 55000);
    child.on('message', message => { clearTimeout(timer); message.phase === 'done' ? resolve(message) : reject(new Error(JSON.stringify(message))); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Voice worker exited ${code}`)); });
    child.send({ action: 'start', config: { ...config, directory }, pcm });
  });
  console.log(`PASS native local voice: ${JSON.stringify(result.text)}. Existing model, separate catalog, no microphone or download.`);
} finally {
  if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
