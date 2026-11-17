import { spawnVoiceWorker } from '../../com.github.copilot/extensions/explorer/voice-process.mjs';
import { isSea } from 'node:sea';
import assert from 'node:assert/strict';

assert.ok(isSea(), 'This fixture must run inside the installed Copilot executable.');
const child = spawnVoiceWorker();
const timeout = setTimeout(() => { child.kill(); process.exit(1); }, 10000);
child.once('error', () => { clearTimeout(timeout); process.exit(1); });
child.once('message', message => {
  assert.equal(message.phase, 'ready');
  clearTimeout(timeout);
  process.send({ voiceWorker: 'ready' }, () => { child.kill(); process.exit(0); });
});
child.send({ action: 'probe' });
