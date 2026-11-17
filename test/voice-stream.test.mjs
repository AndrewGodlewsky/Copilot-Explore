import test from 'node:test';
import assert from 'node:assert/strict';
import { runVoiceStream } from '../com.github.copilot/extensions/explorer/voice-stream.mjs';

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture({ acknowledge = true, holdResponse = false } = {}) {
  let clock = 0, input, queue, wake, read, closed = false, failure, resolveResponse, rejectResponse;
  const events = [], timeouts = new Map(), intervals = new Set(), control = {}, tokens = [], aggregate = [];
  const resources = { stopped: 0, released: 0, queues: 0, sessions: 0, bytes: 0, frames: 0 };
  const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; }); response.catch(() => {});
  const sdk = {
    Item: { audioDescriptor: () => ({}), bytes: data => ({ data }) },
    ItemQueue: class {
      size = 0;
      constructor() { queue = this; }
      push(item) { resources.frames++; resources.bytes += item.data.length; }
      markFinished() { if (!holdResponse) { closed = true; resolveResponse({ finishReason: 'stop', output: [{ type: 'speechResult', text: aggregate.join('') }] }); wake?.(); } }
      dispose() { resources.queues++; }
    },
    Request: class { addItem() { return this; } },
    AudioSession: class {
      processStreamingRequest(_, { signal }) {
        signal.addEventListener('abort', () => { if (closed) return; failure = new Error('Native aborted'); closed = true; rejectResponse(failure); wake?.(); });
        return { response, async *[Symbol.asyncIterator]() {
          while (!closed || tokens.length) {
            if (tokens.length) yield { type: 'speechSegment', kind: 'none', text: tokens.shift() };
            else await new Promise(resolve => { wake = resolve; });
          }
          if (failure) throw failure;
        } };
      }
      dispose() { resources.sessions++; }
    },
  };
  const timers = { setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
    setTimeout(fn, ms) { timeouts.set(fn, clock + ms); return fn; }, clearTimeout(fn) { timeouts.delete(fn); } };
  const source = { read: () => new Promise(resolve => { read = resolve; }), stop: () => { resources.stopped++; read?.(null); }, release: () => { resources.released++; } };
  input = runVoiceStream({ sdk, source, control, now: () => clock, timers, send: event => { events.push(event); if (acknowledge && event.phase === 'segment') control.ack(event.sequence); } });
  const result = input.then(() => null, error => error);
  return { events, resources, control, result, queue: () => queue,
    text(text) { tokens.push(text); aggregate.push(text); wake?.(); },
    async frame(ms = 100) { clock += ms; read(Buffer.alloc(3200)); await settle(); this.tick(); await settle(); },
    tick(ms = 0) { clock += ms; for (const fn of intervals) fn(); for (const [fn, deadline] of timeouts) if (clock >= deadline) { timeouts.delete(fn); fn(); } },
    timers: () => intervals.size + timeouts.size,
  };
}

test('stream limits end capture explicitly before audio queue overflow and release resources', async () => {
  const f = fixture(); f.queue().size = 50; f.tick();
  assert.equal(await f.result, null);
  assert.match(f.events.find(e => e.phase === 'transcribing').note, /five seconds behind/);
  assert.equal(f.resources.frames, 0); assert.equal(f.resources.stopped, 1); assert.equal(f.resources.queues, 1); assert.equal(f.resources.sessions, 1); assert.equal(f.timers(), 0);
});

test('stream rejects a four-second delivery gap without claiming complete audio', async () => {
  const f = fixture(); await f.frame(4000);
  assert.match((await f.result).message, /stalled.*incomplete/);
  assert.equal(f.resources.frames, 0); assert.equal(f.resources.stopped, 1); assert.equal(f.timers(), 0);
});

test('stream explicitly drains after three minutes without decoded text', async () => {
  const f = fixture();
  for (let i = 0; i < 1800; i++) await f.frame();
  assert.equal(await f.result, null);
  assert.match(f.events.find(e => e.phase === 'transcribing').note, /three minutes/);
  assert.equal(f.resources.frames, 1800); assert.equal(f.resources.stopped, 1);
});

test('stream total audio remains bounded at ten minutes with decoded progress', async () => {
  const f = fixture();
  for (let i = 0; i < 6000; i++) { if (i % 10 === 0) f.text(' word'); await f.frame(); }
  assert.equal(await f.result, null);
  assert.equal(f.resources.bytes, 19200000); assert.equal(f.resources.frames, 6000);
  assert.match(f.events.find(e => e.phase === 'transcribing').note, /ten-minute/);
  assert.equal(f.events.filter(e => e.phase === 'segment').map(e => e.text).join(''), ' word'.repeat(600));
});

test('stream draft acknowledgment and final drain have bounded deadlines', async () => {
  const f = fixture({ acknowledge: false }); f.text('a'.repeat(512)); await settle();
  for (let i = 0; i < 50; i++) await f.frame();
  assert.match((await f.result).message, /draft acknowledgment timed out/); assert.equal(f.resources.stopped, 1);
  const draining = fixture({ holdResponse: true }); draining.control.finish(); draining.tick(45000);
  assert.match((await draining.result).message, /45-second/); assert.equal(draining.timers(), 0);
});

test('stream Stop retains pending text until acknowledgment and Cancel releases capture and transcription', async () => {
  const f = fixture({ acknowledge: false }); f.text('Keep these words'); await settle(); f.control.finish(); await settle();
  assert.equal(f.events.find(e => e.phase === 'segment').text, 'Keep these words');
  assert.equal(f.resources.released, 1, 'release microphone after its pending read settles, before waiting for a draft acknowledgment');
  f.control.ack(99); await settle(); assert.equal(f.resources.queues, 0, 'wrong ack cannot release pending text');
  f.control.ack(1); assert.equal(await f.result, null); assert.equal(f.resources.queues, 1);
  for (const stopFirst of [false, true]) {
    const c = fixture({ holdResponse: true }); if (stopFirst) c.control.finish(); c.control.cancel();
    assert.match((await c.result).message, /cancelled/); assert.equal(c.resources.stopped, 1); assert.equal(c.resources.queues, 1); assert.equal(c.timers(), 0);
  }
});
