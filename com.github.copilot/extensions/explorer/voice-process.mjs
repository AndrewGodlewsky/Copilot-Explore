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
