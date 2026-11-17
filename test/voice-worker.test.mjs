import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

async function worker(t, { tokens, aggregate = tokens.join(''), kinds = [], acknowledge = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-worker-test-')), sdk = join(directory, 'sdk.mjs'), report = join(directory, 'resources.json');
  await writeFile(sdk, `
    import { writeFileSync } from 'node:fs';
    const counters = { loads:0, unloads:0, sessions:0, queues:0, bytes:0, frames:0 };
    export const CatalogType={Local:'local'};
    const model={load:async()=>counters.loads++,unload:async()=>counters.unloads++};
    export const FoundryLocalManager={createAsync:async()=>({getCatalog:()=>({registerModel:async()=>model}),dispose:()=>writeFileSync(${JSON.stringify(report)},JSON.stringify(counters))})};
    export class MutableModelInfo {setStringProperty(){return this;}dispose(){}}
    export class ItemQueue {size=0;finished=false;push(item){counters.frames++;counters.bytes+=item.data.length;}markFinished(){this.finished=true;}dispose(){counters.queues++;}}
    export const Item={audioDescriptor:()=>({}),bytes:data=>({data})};
    export class Request {addItem(item){if(item instanceof ItemQueue)this.queue=item;return this;}setOptions(){return this;}}
    export class AudioSession {
      dispose(){counters.sessions++;}
      processStreamingRequest(request,{signal}){
        let resolve,reject;const response=new Promise((a,b)=>{resolve=a;reject=b;});response.catch(()=>{});
        return {response,async *[Symbol.asyncIterator](){
          try {
            const tokens=${JSON.stringify(tokens)}, kinds=${JSON.stringify(kinds)};
            for(let i=0;i<tokens.length;i++){if(signal.aborted)throw new Error('Aborted');yield {type:'speechSegment',kind:kinds[i]||'none',text:tokens[i]};}
            while(!request.queue.finished){if(signal.aborted)throw new Error('Aborted');await new Promise(r=>setTimeout(r,1));}
            resolve({finishReason:'stop',output:[{type:'speechResult',text:${JSON.stringify(aggregate)}}]});
          }catch(error){reject(error);throw error;}finally{reject(new Error('Stopped'));}
        }};
      }
    }
  `);
  const child = fork(fileURLToPath(new URL('../com.github.copilot/extensions/explorer/voice-worker.mjs', import.meta.url)), [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced' });
  const messages = [], stderr = [];
  child.stderr.on('data', data => stderr.push(data.toString()));
  child.on('message', message => { messages.push(message); if (acknowledge && message.phase === 'segment') child.send({ action: 'ack', sequence: message.sequence }); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => { if (child.exitCode === null) child.kill(); await exited; assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true }); });
  child.send({ action: 'start', config: { sdk, directory }, pcm: Buffer.alloc(6400) });
  return { messages, child, async result() { const timeout = setTimeout(() => child.kill(), 8000); await exited; clearTimeout(timeout); assert.deepEqual(stderr, []); return { messages, resources: JSON.parse(await readFile(report, 'utf8')) }; } };
}

test('live worker emits ordered exact token chunks once and disposes native resources', async t => {
  const tokens = [' repeat repeat ', 'x'.repeat(500), '\ud83c', '\udf31 café', ' end'];
  const f = await worker(t, { tokens }); const { messages, resources } = await f.result();
  const segments = messages.filter(m => m.phase === 'segment');
  assert.ok(segments.length >= 2, 'transport chunks arrive before completion');
  assert.deepEqual(segments.map(s => s.sequence), segments.map((_, i) => i + 1));
  assert.equal(segments.map(s => s.text).join(''), tokens.join(''));
  assert.ok(segments.every(s => s.text.isWellFormed()), 'never deliver half a surrogate pair');
  assert.equal(messages.at(-1).phase, 'done'); assert.equal(messages.at(-1).text, undefined, 'aggregate is verification, not duplicate insertion');
  assert.deepEqual(resources, { loads: 1, unloads: 1, sessions: 1, queues: 1, bytes: 6400, frames: 2 });
});

test('live worker preserves accepted chunks and visibly rejects an aggregate mismatch or mixed hypothesis semantics', async t => {
  for (const options of [{ tokens: ['a'.repeat(512), ' tail'], aggregate: 'different' }, { tokens: ['a'.repeat(512), ' changed'], kinds: ['none', 'partial'] }]) {
    const f = await worker(t, options), { messages, resources } = await f.result();
    assert.equal(messages.find(m => m.phase === 'segment')?.text, 'a'.repeat(512));
    assert.equal(messages.at(-1).phase, 'error'); assert.match(messages.at(-1).error, /aggregate|semantics/i);
    assert.equal(resources.unloads, 1); assert.equal(resources.queues, 1);
  }
});

test('live worker bounds unacknowledged text and retains the first published record on failure', async t => {
  const f = await worker(t, { tokens: ['a'.repeat(512), 'b'.repeat(4096)], acknowledge: false });
  const { messages, resources } = await f.result();
  assert.equal(messages.filter(m => m.phase === 'segment').length, 1);
  assert.equal(messages.at(-1).phase, 'error'); assert.match(messages.at(-1).error, /draft|backlog/i);
  assert.equal(resources.unloads, 1);
});

test('live worker treats silence as empty and does not fabricate transcript records', async t => {
  const f = await worker(t, { tokens: [] }), { messages, resources } = await f.result();
  assert.equal(messages.filter(m => m.phase === 'segment').length, 0);
  assert.equal(messages.at(-1).phase, 'done'); assert.equal(resources.queues, 1);
});
