import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverVoice, inspectVoice, selectVoice } from './voice-settings.mjs';
import { spawnVoiceWorker, listVoiceDevices } from './voice-process.mjs';
import { VoicePreferences, validatePreferences } from './voice-preferences.mjs';
import { microphoneIndex } from './voice-audio.mjs';
import { diagnosticError } from './diagnostics.mjs';

const active = phase => ['loading', 'listening', 'transcribing'].includes(phase);
let microphoneOwner;
async function launch(config) {
  const parent = join(tmpdir(), 'copilot-explorer-voice');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'session-'));
  const cleanup = async () => {
    if (dirname(resolve(directory)) !== resolve(parent)) throw new Error('Invalid voice scratch directory.');
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    const child = spawnVoiceWorker();
    child.once('exit', () => { void cleanup().catch(() => {}); });
    child.send({ action: 'start', config: { ...config, directory } }, error => { if (error) child.kill(); });
    return { child, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export class VoiceService {
  constructor({ discover = discoverVoice, inspect = inspectVoice, devices = listVoiceDevices, preferencesFile, launch: spawn = launch, now = Date.now } = {}) {
    this.preferences = new VoicePreferences(preferencesFile); this.inspect = inspect; this.devices = devices;
    this.discover = discover; this.launch = spawn; this.now = now; this.job = null; this.closed = false; this.cancelled = new Set();
    this.timer = setInterval(() => this.tick(), 500); this.timer.unref();
  }
  async status() {
    try { const { shortcut, label, mode } = await this.discover(await this.preferences.read()); return { ready: true, shortcut, label, mode }; }
    catch (error) { return { ready: false, error: error.message }; }
  }
  async diagnostics() {
    const result = { runtime: 'unknown', model: 'unknown', microphone: 'unknown', loadability: 'unknown', capture: 'unknown', modelCount: 0, deviceCount: 0, error: 'none' };
    try {
      const preferences = await this.preferences.read(), inventory = await this.inspect();
      result.runtime = 'ready'; result.modelCount = inventory.models.length;
      if (inventory.modelDiscoveryError === 'inspection-failed') result.error = 'inspection-failed';
      const model = preferences.model === 'copilot'
        ? inventory.models.find(m => m.alias === inventory.selectedModel && m.supported) ?? inventory.models.find(m => m.alias === inventory.selectedModel)
        : inventory.models.find(m => m.id === preferences.model);
      result.model = !model ? result.error === 'inspection-failed' ? 'unknown' : 'unavailable' : model.readiness ?? (model.supported === true ? 'ready' : model.supported === false ? 'unsupported' : 'unknown');
      const names = await this.devices(inventory.recorder); result.deviceCount = names.length;
      result.microphone = !names.length ? 'unavailable' : 'ready';
      try { microphoneIndex(preferences.microphone, names); }
      catch (error) { result.microphone = 'unavailable'; if (result.error === 'none') result.error = diagnosticError(error); }
    } catch (error) {
      if (result.error === 'none') result.error = diagnosticError(error);
      if (error?.code === 'VOICE_UNSUPPORTED') result.runtime = 'unsupported';
      if (error?.code === 'VOICE_UNAVAILABLE') result.runtime = 'unavailable';
    }
    return result;
  }
  async options() {
    const preferences = await this.preferences.read(), inventory = await this.inspect();
    const names = await this.devices(inventory.recorder);
    let ready = true, error;
    try { selectVoice(inventory, preferences); microphoneIndex(preferences.microphone, names); }
    catch (e) { ready = false; error = e.message; }
    return { ready, error, label: inventory.label, mode: inventory.mode, shortcut: inventory.shortcut, preferences,
      microphones: [...new Set(names)].map(name => ({ name, supported: names.filter(n => n === name).length === 1 })),
      models: inventory.models.map(({ id, label, supported, reason }) => ({ id, label, supported, reason })),
      copilotModel: inventory.models.find(m => m.alias === inventory.selectedModel && m.supported)?.label || 'Unavailable or unsupported',
    };
  }
  async configure(input) {
    if (active(this.job?.phase)) throw new Error('Finish dictation before changing voice settings.');
    validatePreferences(input);
    const inventory = await this.inspect();
    selectVoice(inventory, input);
    microphoneIndex(input.microphone, await this.devices(inventory.recorder));
    if (this.closed || active(this.job?.phase)) throw new Error('Finish dictation before changing voice settings.');
    await this.preferences.save(input, input.revision);
    return this.options();
  }
  start(id) {
    if (this.closed) throw new Error('Voice session is closed.');
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(id)) throw new Error('Invalid recording identifier.');
    if (this.cancelled.has(id)) return { id, phase: 'cancelled' };
    if (this.job?.id === id) return this.poll(id);
    if (microphoneOwner || active(this.job?.phase)) throw new Error('Another Explorer recording is already active.');
    const job = this.job = { id, phase: 'loading', started: this.now(), heartbeat: this.now(), levels: [], sequence: 0, acknowledged: 0, characters: 0 };
    microphoneOwner = job;
    void (async () => {
      try {
        const config = await this.discover(await this.preferences.read());
        if (this.job !== job || job.phase !== 'loading') return;
        const { child } = await this.launch(config);
        if (this.job !== job || job.phase !== 'loading') { child.kill(); return; }
        job.child = child;
        child.on('message', message => {
          if (this.job !== job || !active(job.phase)) return;
          if (message.phase === 'listening' && job.phase === 'loading') { job.phase = 'listening'; job.started = this.now(); }
          if (message.phase === 'level' && job.phase === 'listening' && Number.isFinite(message.level)) { job.levels.push(Math.max(0, Math.min(1, message.level))); job.levels = job.levels.slice(-24); }
          if (message.phase === 'segment') {
            const { sequence, text } = message;
            if (Number.isSafeInteger(sequence) && sequence > 0 && sequence <= job.acknowledged) return;
            if (job.segment?.sequence === sequence && job.segment.text === text) return;
            if (!Number.isSafeInteger(sequence) || sequence !== job.sequence + 1 || job.segment || typeof text !== 'string' || !text.length || text.length > 4096 || job.characters + text.length > 20000) return this.fail(job, 'Local dictation returned an invalid or out-of-order chunk. Previously inserted text remains in your draft.');
            job.sequence = sequence; job.characters += text.length; job.segment = { sequence, text }; job.pendingSince = this.now();
          }
          if (message.phase === 'transcribing' && job.phase === 'listening') { job.phase = 'transcribing'; job.started = this.now(); job.note = typeof message.note === 'string' ? message.note.slice(0, 500) : undefined; }
          if (message.phase === 'done' && job.phase === 'transcribing' && typeof message.text === 'string' && message.text.length <= 20000) { job.phase = 'done'; job.text = message.text; }
          if (message.phase === 'done' && job.phase === 'transcribing' && message.text === undefined && !job.segment) job.phase = 'done';
          if (message.phase === 'error') { job.phase = 'error'; job.error = typeof message.error === 'string' ? message.error.slice(0, 500) : 'Local dictation failed. Check microphone access and Copilot’s downloaded model, then try again.'; }
          if (!active(job.phase)) this.stop(job);
        });
        child.once('error', () => this.fail(job, 'Could not start Copilot’s installed local voice runtime.'));
        child.once('exit', () => { if (active(job.phase)) this.fail(job, 'Local voice stopped unexpectedly. Try again.'); });
      } catch (error) { if (this.job === job && active(job.phase)) this.fail(job, error.message); }
    })();
    return this.poll(id);
  }
  current(id) { if (!this.job || this.job.id !== id) throw new Error('This recording is no longer active.'); return this.job; }
  poll(id) { if (this.job?.id !== id && this.cancelled.has(id)) return { id, phase: 'cancelled' }; const job = this.current(id); job.heartbeat = this.now(); return { id: job.id, phase: job.phase, text: job.text, segment: job.segment, acknowledged: job.acknowledged, error: job.error, note: job.note, levels: job.phase === 'listening' ? job.levels : [], elapsedMs: job.phase === 'listening' ? Math.max(0, this.now() - job.started) : 0 }; }
  ack(id, sequence) {
    const job = this.current(id);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > job.sequence || (sequence > job.acknowledged && sequence !== job.segment?.sequence)) throw new Error('Invalid dictation acknowledgment.');
    if (sequence > job.acknowledged) {
      job.acknowledged = sequence; job.segment = undefined;
      if (active(job.phase)) job.child.send({ action: 'ack', sequence }, error => { if (error && active(job.phase)) this.fail(job, 'Local voice connection closed. Previously inserted text remains in your draft.'); });
    }
    return this.poll(id);
  }
  finish(id) {
    if (this.job?.id !== id) return this.cancel(id);
    const job = this.current(id);
    if (job.phase === 'loading') return this.cancel(id, 'Released before listening. Hold the shortcut until “Listening” appears.');
    if (job.phase === 'listening') { job.phase = 'transcribing'; job.started = this.now(); job.child.send({ action: 'finish' }, error => { if (error && active(job.phase)) this.fail(job, 'Local voice connection closed. Try again.'); }); }
    return this.poll(id);
  }
  stop(job) { if (microphoneOwner === job) microphoneOwner = null; job.child?.kill(); }
  fail(job, message) { job.phase = 'error'; job.error = message; this.stop(job); }
  cancel(id, message = 'Dictation cancelled.') {
    // Remember a cancellation arriving before its start request.
    this.cancelled.add(id);
    if (this.cancelled.size > 32) this.cancelled.delete(this.cancelled.values().next().value);
    if (this.job?.id !== id) return { id, phase: 'cancelled', error: message };
    const job = this.current(id); job.phase = 'cancelled'; job.text = undefined; job.segment = undefined; job.error = message; this.stop(job); return this.poll(id);
  }
  tick() {
    const job = this.job;
    if (!job || !active(job.phase)) return;
    if (this.now() - job.heartbeat > 5000) return this.cancel(job.id, 'Dictation stopped after a lost connection. Previously inserted text remains in your draft.');
    if (job.segment && this.now() - job.pendingSince > 5000) return this.fail(job, 'Dictation stopped because the local draft was not acknowledged in time. Check the draft recovery controls before recording again.');
    if (job.phase === 'listening' && this.now() - job.started >= 600000) { job.note = 'The ten-minute recording limit was reached. Capture stopped; finishing captured audio.'; this.finish(job.id); }
    else if (this.now() - job.started > (job.phase === 'transcribing' ? 45000 : 60000) && job.phase !== 'listening') this.fail(job, 'Local dictation timed out. Previously inserted text remains in your draft; retry to record the remaining speech.');
  }
  close() { this.closed = true; clearInterval(this.timer); if (this.job) this.cancel(this.job.id); }
}
