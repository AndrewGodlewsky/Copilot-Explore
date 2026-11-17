import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { audioLevel, microphoneIndex } from './voice-audio.mjs';

let recorder, finishing = false;
process.once('disconnect', () => process.exit(0));
process.on('message', message => {
  if (message.action === 'finish') { finishing = true; if (recorder?.isRecording) recorder.stop(); }
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
  let manager, model, session, queue, stream;
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
    const chunks = [];
    if (message.pcm) {
      // Internal IPC fixture only; no HTTP route accepts audio or filesystem paths.
      chunks.push(Buffer.from(message.pcm));
    } else {
      const { PvRecorder } = await import(pathToFileURL(c.recorder));
      const index = microphoneIndex(c.microphoneName || '', PvRecorder.getAvailableDevices());
      recorder = new PvRecorder(1600, index, 50);
      if (recorder.sampleRate !== 16000) throw new Error('Unsupported sample rate');
      recorder.start(); process.send({ phase: 'listening' });
      const deadline = Date.now() + 120000;
      while (!finishing && Date.now() < deadline) {
        try {
          const frame = await recorder.read(); chunks.push(Buffer.from(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)));
          if (process.connected && !finishing) process.send({ phase: 'level', level: audioLevel(frame) });
        }
        catch (error) { if (!finishing) throw error; }
      }
      if (recorder.isRecording) recorder.stop(); recorder.release(); recorder = null;
    }
    session = new sdk.AudioSession(model); queue = new sdk.ItemQueue();
    const request = new sdk.Request().addItem(sdk.Item.audioDescriptor('pcm', 16000, 1)).addItem(queue);
    if (c.language) request.setOptions({ additionalOptions: { language: c.language } });
    // Nemotron consumes one streaming frame per item; larger items can truncate speech.
    for (const chunk of chunks) for (let offset = 0; offset < chunk.length; offset += 3200) queue.push(sdk.Item.bytes(chunk.subarray(offset, offset + 3200)));
    queue.markFinished();
    stream = session.processStreamingRequest(request, { signal: AbortSignal.timeout(45000) });
    for await (const item of stream) { /* Final response contains the complete transcript. */ }
    const response = await stream.response;
    if (response.finishReason === 'error') throw new Error('Transcription failed');
    const text = response.output.filter(item => item.type === 'speechResult').map(item => item.text).join(' ').trim();
    process.send({ phase: 'done', text });
  } catch (error) { if (process.connected) process.send({ phase: 'error', error: error.code === 'VOICE_DEVICE' ? error.message : undefined }); }
  finally {
    if (recorder) { if (recorder.isRecording) recorder.stop(); recorder.release(); }
    if (stream) await stream.response.catch(() => {});
    queue?.dispose(); session?.dispose(); await model?.unload(); manager?.dispose();
    process.exit(0);
  }
});
