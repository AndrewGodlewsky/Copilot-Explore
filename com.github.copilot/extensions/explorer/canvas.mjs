import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Explorer } from './controller.mjs';
import { Library } from './library.mjs';
import { startServer } from './server.mjs';
import { createResearcher } from './research.mjs';

const string = (maxLength = 5000) => ({ type: 'string', minLength: 1, maxLength });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const object = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const requestId = string(100);
export const actionSchemas = {
  get_exploration: object({}),
  submit_questions: object({ requestId, questions: { ...array(object({ question: string(600), category: string(60) }), 6), minItems: 1 } }),
  fail_request: object({ requestId, message: string(2000) }),
};

export function explorerCanvas({ createCanvas, getSession, directory }) {
  const library = new Library(directory);
  const instances = new Map();
  const starting = new Map();
  const get = ctx => {
    if (ctx.sessionId !== getSession().sessionId) throw new Error('This canvas belongs to a different session.');
    const instance = instances.get(ctx.instanceId);
    if (!instance) throw new Error('Open the Explorer canvas first.');
    return instance;
  };
  const canvas = createCanvas({
    id: 'explorer', displayName: 'Explorer',
    description: 'Explore an idea in a branching map of questions, research, and user decisions. Open with a topic or an empty input.',
    inputSchema: { type: 'object', properties: { topic: string(4000) }, additionalProperties: false },
    actions: [
      { name: 'get_exploration', description: 'Read the current map and pending request.', inputSchema: actionSchemas.get_exploration, handler: ctx => get(ctx).explorer.snapshot() },
      { name: 'submit_questions', description: 'Stage specific questions for a pending request in an unsaved preview. Only the user can accept questions in the canvas; this callback never saves nodes.', inputSchema: actionSchemas.submit_questions, handler: ctx => get(ctx).explorer.receive('questions', ctx.input) },
      { name: 'fail_request', description: 'Explain why a pending request cannot be completed.', inputSchema: actionSchemas.fail_request, handler: ctx => get(ctx).explorer.receive('fail', ctx.input) },
    ],
    async open(ctx) {
      if (ctx.sessionId !== getSession().sessionId) throw new Error('Session mismatch.');
      if (!instances.has(ctx.instanceId) && !starting.has(ctx.instanceId)) {
        starting.set(ctx.instanceId, (async () => {
          const key = createHash('sha256').update(`${ctx.sessionId}\0${ctx.instanceId}`).digest('hex').slice(0, 32);
          const explorer = await new Explorer({ library, binding: key,
            researcher: createResearcher(getSession(), { usageDirectory: join(directory, 'usage') }),
            target: { extensionId: ctx.extensionId, canvasId: 'explorer', instanceId: ctx.instanceId },
            send: async options => {
              try { return await getSession().send(options); }
              catch { throw new Error('The attached Copilot session is unavailable'); }
            },
          }).load();
          const server = await startServer(explorer);
          const entry = { explorer, server };
          instances.set(ctx.instanceId, entry);
          try {
            if (!explorer.doc && ctx.input?.topic) await explorer.command('start', { topic: ctx.input.topic });
          } catch (error) { instances.delete(ctx.instanceId); await server.close(); throw error; }
          return entry;
        })());
      }
      try {
        const entry = instances.get(ctx.instanceId) ?? await starting.get(ctx.instanceId);
        return { url: entry.server.url, title: 'Explorer' };
      } finally { starting.delete(ctx.instanceId); }
    },
    async onClose(ctx) {
      if (starting.has(ctx.instanceId)) await starting.get(ctx.instanceId);
      const entry = instances.get(ctx.instanceId);
      if (entry) { instances.delete(ctx.instanceId); await entry.server.close(); }
    },
  });
  return { canvas, async close() { await Promise.allSettled([...starting.values()]); await Promise.all([...instances.values()].map(entry => entry.server.close())); instances.clear(); } };
}
