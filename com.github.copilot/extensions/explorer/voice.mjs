import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverVoice } from './voice-settings.mjs';
import { spawnVoiceWorker } from './voice-process.mjs';

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
  constructor({ discover = discoverVoice, launch: spawn = launch, now = Date.now } = {}) {
    this.discover = discover; this.launch = spawn; this.now = now; this.job = null; this.closed = false; this.cancelled = new Set();
    this.timer = setInterval(() => this.tick(), 500); this.timer.unref();
  }
  async status() {
    try { const { shortcut, label, mode } = await this.discover(); return { ready: true, shortcut, label, mode }; }
    catch (error) { return { ready: false, error: error.message }; }
  }
  start(id) {
    if (this.closed) throw new Error('Voice session is closed.');
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(id)) throw new Error('Invalid recording identifier.');
    if (this.cancelled.has(id)) return { id, phase: 'cancelled' };
    if (this.job?.id === id) return this.poll(id);
    if (microphoneOwner || active(this.job?.phase)) throw new Error('Another Explorer recording is already active.');
    const job = this.job = { id, phase: 'loading', started: this.now(), heartbeat: this.now() };
    microphoneOwner = job;
    void (async () => {
      try {
        const config = await this.discover();
        if (this.job !== job || job.phase !== 'loading') return;
        const { child } = await this.launch(config);
        if (this.job !== job || job.phase !== 'loading') { child.kill(); return; }
        job.child = child;
        child.on('message', message => {
          if (this.job !== job || !active(job.phase)) return;
          if (message.phase === 'listening' && job.phase === 'loading') { job.phase = 'listening'; job.started = this.now(); }
          if (message.phase === 'done' && job.phase === 'transcribing' && typeof message.text === 'string' && message.text.length <= 20000) { job.phase = 'done'; job.text = message.text; }
          if (message.phase === 'error') { job.phase = 'error'; job.error = 'Local dictation failed. Check microphone access and Copilot’s downloaded model, then try again.'; }
          if (!active(job.phase)) this.stop(job);
        });
        child.once('error', () => this.fail(job, 'Could not start Copilot’s installed local voice runtime.'));
        child.once('exit', () => { if (active(job.phase)) this.fail(job, 'Local voice stopped unexpectedly. Try again.'); });
      } catch (error) { if (this.job === job && active(job.phase)) this.fail(job, error.message); }
    })();
    return this.poll(id);
  }
  current(id) { if (!this.job || this.job.id !== id) throw new Error('This recording is no longer active.'); return this.job; }
  poll(id) { if (this.job?.id !== id && this.cancelled.has(id)) return { id, phase: 'cancelled' }; const job = this.current(id); job.heartbeat = this.now(); return { id: job.id, phase: job.phase, text: job.text, error: job.error }; }
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
    const job = this.current(id); job.phase = 'cancelled'; job.text = undefined; job.error = message; this.stop(job); return this.poll(id);
  }
  tick() {
    const job = this.job;
    if (!job || !active(job.phase)) return;
    if (this.now() - job.heartbeat > 5000 || this.now() - job.started > (job.phase === 'listening' ? 120000 : 60000)) this.cancel(job.id, 'Dictation stopped after a timeout or lost connection.');
  }
  close() { this.closed = true; clearInterval(this.timer); if (this.job) this.cancel(this.job.id); }
}
