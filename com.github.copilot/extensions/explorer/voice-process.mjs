import { fork } from 'node:child_process';
import { accessSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';

export function spawnVoiceWorker() {
  if (process.env.COPILOT_EXTENSION_SANDBOXED === '1') throw new Error('Local dictation is not available in a sandboxed Explorer session.');
  const worker = fileURLToPath(new URL('./voice-worker.mjs', import.meta.url));
  let target = worker, env = process.env;
  if (isSea()) {
    // Copilot's SEA executable runs scripts only through its installed extension bootstrap.
    target = join(dirname(process.execPath), 'preloads', 'extension_bootstrap.mjs');
    accessSync(target);
    env = { ...process.env, EXTENSION_PATH: worker, COPILOT_EXTENSION_PARENT_PID: String(process.pid) };
  }
  return fork(target, [], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [], serialization: 'advanced' });
}

export async function listVoiceDevices(recorder) {
  const child = spawnVoiceWorker();
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Microphone discovery timed out. Try Refresh in Voice settings.')), 8000);
      const finish = fn => value => { clearTimeout(timeout); fn(value); };
      child.once('error', finish(reject));
      child.once('exit', finish(() => reject(new Error('Microphone discovery stopped unexpectedly.'))));
      child.once('message', finish(message => {
        if (message.phase !== 'devices' || !Array.isArray(message.devices) || !message.devices.every(d => typeof d === 'string' && d.length <= 500)) reject(new Error('Could not list microphones. Check your audio devices.'));
        else resolve(message.devices.slice(0, 100));
      }));
      child.send({ action: 'devices', recorder }, error => { if (error) { clearTimeout(timeout); reject(error); } });
    });
  } finally { child.kill(); }
}
