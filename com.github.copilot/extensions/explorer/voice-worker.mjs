import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { microphoneIndex } from './voice-audio.mjs';
import { runVoiceStream } from './voice-stream.mjs';

let recorder, finishing = false;
const control = {};
process.once('disconnect', () => process.exit(0));
process.on('message', message => {
  if (message.action === 'finish') { finishing = true; control.finish?.(); }
  if (message.action === 'ack') control.ack?.(message.sequence);
});
process.once('message', async message => {
  if (message.action === 'probe') { process.send({ phase: 'ready' }, () => process.exit(0)); return; }
  if (message.action === 'devices') {
    try {
      const { PvRecorder } = await import(pathToFileURL(message.recorder));
      process.send({ phase: 'devices', devices: PvRecorder.getAvailableDevices() }, () => process.exit(0));
    } catch { process.send({ phase: 'error' }, () => process.exit(1)); }
    return;
  }
  if (message.action !== 'start') return process.exit(1);
  const c = message.config;
  let manager, model, outcome;
  try {
    const sdk = await import(pathToFileURL(c.sdk));
    manager = await sdk.FoundryLocalManager.createAsync({ appName: 'copilot-explorer-voice', appDataDir: c.directory,
      logsDir: join(c.directory, 'logs'), modelCacheDir: join(c.directory, 'catalog'), libraryPath: c.libraryPath,
      disableNonessentialTelemetry: true, logLevel: 'error' });
    const metadata = new sdk.MutableModelInfo().setStringProperty('task', 'automatic-speech-recognition');
    try { model = await manager.getCatalog(sdk.CatalogType.Local).registerModel(c.modelPath, 'explorer-voice:1', metadata); }
    finally { metadata.dispose(); }
    await model.load();
    if (finishing || !process.connected) return;
    let read;
    if (message.pcm) {
      // Internal IPC fixture only; no HTTP route accepts audio or filesystem paths.
      const pcm = Buffer.from(message.pcm); let offset = 0;
      if (pcm.length > 960000 || pcm.length % 2) throw new Error('Invalid synthetic fixture');
      read = async () => { if (offset >= pcm.length) return null; await new Promise(resolve => setTimeout(resolve, 100)); const frame = pcm.subarray(offset, offset + 3200); offset += frame.length; return frame; };
    } else {
      const { PvRecorder } = await import(pathToFileURL(c.recorder));
      const index = microphoneIndex(c.microphoneName || '', PvRecorder.getAvailableDevices());
      recorder = new PvRecorder(1600, index, 50);
      if (recorder.sampleRate !== 16000) throw new Error('Unsupported sample rate');
      recorder.start();
      read = async () => { const frame = await recorder.read(); return Buffer.from(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)); };
    }
    const stop = () => { if (recorder?.isRecording) recorder.stop(); };
    const release = () => { if (recorder) { stop(); recorder.release(); recorder = null; } };
    await runVoiceStream({ sdk, model, source: { read, stop, release, language: c.language }, control, send: message => { if (process.connected) process.send(message); } });
    outcome = { phase: 'done' };
  } catch (error) { outcome = { phase: 'error', error: ['VOICE_DEVICE', 'VOICE_STREAM'].includes(error.code) ? error.message : undefined }; }
  finally {
    if (recorder) { if (recorder.isRecording) recorder.stop(); recorder.release(); }
    await model?.unload(); manager?.dispose();
    if (process.connected && outcome) process.send(outcome, () => process.exit(0));
    else process.exit(0);
  }
});
