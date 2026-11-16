import { createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { explorerCanvas } from './canvas.mjs';

let session;
const extension = explorerCanvas({ createCanvas, getSession: () => session,
  directory: process.env.EXPLORER_DATA_DIR || join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'plugin-data', 'explorer') });
session = await joinSession({ canvases: [extension.canvas] });
process.stderr.write('[Explorer] Canvas registered.\n');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await extension.close();
  await session.disconnect();
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
