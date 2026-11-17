import { audioLevel } from './voice-audio.mjs';

const problem = message => Object.assign(new Error(message), { code: 'VOICE_STREAM' });

// The inspected Nemotron path emits immutable decoded-token deltas with kind NONE.
// Chunks below are transport records, not utterance boundaries or model hypotheses.
export async function runVoiceStream({ sdk, model, source, send, control, now = Date.now, timers = globalThis }) {
  const session = new sdk.AudioSession(model), queue = new sdk.ItemQueue(), abort = new AbortController();
  let stream, captureTask, timer, drainTimer, stopped = false, complete = false, failure, pending, sequence = 0;
  let transcript = '', buffered = '', bytes = 0, lastDecoded = now(), lastDelivery = now(), lastFlush = now();
  const started = now(); let wake;
  const notify = () => { wake?.(); wake = null; };
  const finish = note => {
    if (stopped) return;
    stopped = true;
    try { source.stop(); } catch { fail(problem('Microphone capture could not stop cleanly. Previously inserted text remains in your draft.')); }
    queue.markFinished();
    send({ phase: 'transcribing', note });
    drainTimer = timers.setTimeout(() => fail(problem('Local transcription exceeded its 45-second finishing limit. Previously inserted text remains in your draft.')), 45000);
  };
  const fail = error => {
    if (failure) return;
    failure = error; finish(); abort.abort(); notify();
  };
  const pump = (force = false) => {
    if (failure || pending || !buffered.length || (!force && buffered.length < 512 && now() - lastFlush < 1000)) return;
    let length = Math.min(512, buffered.length);
    if (/[\uD800-\uDBFF]/.test(buffered[length - 1])) length--;
    if (!length) { if (force) fail(problem('Local dictation returned incomplete Unicode text.')); return; }
    const text = buffered.slice(0, length);
    if (!text.isWellFormed()) return fail(problem('Local dictation returned invalid Unicode text.'));
    buffered = buffered.slice(length); lastFlush = now();
    pending = { sequence: ++sequence, text, since: now() };
    send({ phase: 'segment', sequence, text });
  };
  control.finish = () => finish();
  control.cancel = () => fail(problem('Dictation cancelled. Previously inserted text remains in your draft.'));
  control.ack = received => {
    if (pending?.sequence !== received) return;
    pending = null; pump(complete); notify();
  };
  const tick = () => {
    if (failure) return;
    if (pending && now() - pending.since >= 5000) return fail(problem('Local draft acknowledgment timed out. Capture stopped; review the draft recovery controls.'));
    if (!stopped) {
      if (now() - lastDelivery >= 4000) return fail(problem('Microphone delivery stalled for four seconds. Audio may be incomplete. Capture stopped; previously inserted text remains in your draft.'));
      if (now() - started >= 600000) finish('The ten-minute recording limit was reached. Capture stopped; finishing captured audio.');
      else if (now() - lastDecoded >= 180000) finish('No decoded text arrived for three minutes. Capture stopped; finishing captured audio. Silence can reach this limit.');
      else if (queue.size >= 50) finish('The local model fell five seconds behind. Capture stopped explicitly; finishing buffered audio.');
    }
    pump(complete);
  };
  try {
    const request = new sdk.Request().addItem(sdk.Item.audioDescriptor('pcm', 16000, 1)).addItem(queue);
    if (source.language) request.setOptions({ additionalOptions: { language: source.language } });
    stream = session.processStreamingRequest(request, { signal: abort.signal });
    send({ phase: 'listening' });
    timer = timers.setInterval(tick, 100);
    const capture = async () => {
      while (!stopped) {
        if (queue.size >= 50) { finish('The local model fell five seconds behind. Capture stopped explicitly; finishing buffered audio.'); break; }
        let frame;
        try { frame = await source.read(); }
        catch (error) { if (!stopped) throw error; break; }
        if (stopped) break;
        if (frame === null) { finish(); break; }
        if (now() - lastDelivery >= 4000) throw problem('Microphone delivery stalled for four seconds. Audio may be incomplete; previously inserted text remains in your draft.');
        if (!(frame instanceof Uint8Array) || !frame.length || frame.length > 3200 || frame.length % 2) throw problem('Local microphone returned an invalid audio frame.');
        lastDelivery = now(); bytes += frame.length;
        if (bytes > 19200000) throw problem('Local audio exceeded its memory limit. Capture stopped.');
        queue.push(sdk.Item.bytes(frame));
        send({ phase: 'level', level: audioLevel(new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2)), elapsedMs: bytes / 32 });
        if (bytes === 19200000) finish('The ten-minute audio limit was reached. Capture stopped; finishing captured audio.');
      }
    };
    const consume = async () => {
      for await (const item of stream) {
        if (item.type !== 'speechSegment' || item.kind !== 'none' || typeof item.text !== 'string') throw problem('The installed model returned unsupported transcript semantics. Previously inserted text remains in your draft.');
        if (transcript.length + item.text.length > 20000) throw problem('Dictation reached the 20,000-character transcript limit. Previously inserted text remains in your draft.');
        if (buffered.length + (pending?.text.length || 0) + item.text.length > 4096) throw problem('The local draft backlog exceeded its text limit. Capture stopped; review retained text before retrying.');
        transcript += item.text; buffered += item.text;
        if (item.text.length) lastDecoded = now();
        pump();
        if (failure) throw failure;
      }
      const response = await stream.response;
      if (response.finishReason !== 'stop') throw problem('Local transcription did not complete. Previously inserted text remains in your draft.');
      const results = response.output.filter(item => item.type === 'speechResult');
      if (results.length !== 1 || results[0].text !== transcript) throw problem('Local transcript aggregate did not match the delivered tokens. Previously inserted text remains in your draft; review it before retrying.');
      complete = true; pump(true);
      while ((pending || buffered.length) && !failure) await new Promise(resolve => { wake = resolve; });
      if (failure) throw failure;
    };
    captureTask = capture().finally(() => source.release?.()).catch(error => { fail(error); throw failure; });
    await Promise.all([captureTask, consume().catch(error => { fail(error); throw failure; })]);
    if (failure) throw failure;
  } finally {
    timers.clearInterval(timer); timers.clearTimeout(drainTimer);
    if (!stopped) { stopped = true; source.stop(); queue.markFinished(); }
    abort.abort();
    await Promise.allSettled([captureTask, stream?.response]);
    queue.dispose(); session.dispose();
    control.finish = control.ack = control.cancel = () => {};
  }
}
