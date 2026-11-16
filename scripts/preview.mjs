import { resolve } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

const explorer = await new Explorer({ file: resolve('.preview-data/preview.explore.json'), target: { canvasId: 'explorer', instanceId: 'preview' },
  send: async () => { throw new Error('This preview has no Copilot session. Use the installed canvas for AI, or add questions manually'); },
}).load();
const server = await startServer(explorer);
console.log(`Explorer preview: ${server.url}\nOpen this URL in Brave yourself. AI actions require the installed Copilot canvas. Ctrl+C stops the preview.`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
