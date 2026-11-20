import { createBriefHelper } from './decision-brief.mjs';
import { createProjectBriefHelper } from './project-brief.mjs';
import { createAnswerCheckHelper } from './answer-check.mjs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Explorer } from './controller.mjs';
import { Library } from './library.mjs';
import { startServer } from './server.mjs';
import { createResearcher } from './research.mjs';
import { createCleaner } from './cleanup.mjs';
import { createQuestionHelper } from './question-help.mjs';
import { hostRuntime } from './owned-helper.mjs';

async function installedCapabilities() {
  try { hostRuntime(); } catch { return { runtime: 'unsupported', supported: false }; }
  const sdk = await import('@github/copilot-sdk');
  return { supported: typeof sdk.CopilotClient === 'function' && typeof sdk.RuntimeConnection?.forStdio === 'function' };
}
export async function readHostReadiness(parent, capabilities = installedCapabilities) {
  const result = { runtime: 'unknown', sdk: 'unknown', protocol: null, account: 'unknown', model: 'unknown' };
  const failure = error => ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ENOENT'].includes(error?.code) ? 'unavailable' : error?.code === -32601 ? 'unsupported' : 'unknown';
  try {
    const capability = await capabilities();
    result.runtime = capability.runtime ?? 'ready'; result.sdk = capability.supported ? 'ready' : 'unsupported'; result.protocol = capability.protocol ?? null;
  } catch (error) { result.sdk = failure(error); return result; }
  const rpc = parent?.rpc;
  if (!rpc?.model?.getCurrent || !rpc?.model?.list || !rpc?.gitHubAuth?.getStatus) { result.sdk = 'unsupported'; return result; }
  const [auth, model] = await Promise.allSettled([
    rpc.gitHubAuth.getStatus(),
    Promise.all([rpc.model.getCurrent(), rpc.model.list({ skipCache: false })]),
  ]);
  result.account = auth.status === 'fulfilled' ? auth.value?.isAuthenticated === true ? 'ready' : auth.value?.isAuthenticated === false ? 'unavailable' : 'unknown' : failure(auth.reason);
  if (model.status === 'rejected') result.model = failure(model.reason);
  else {
    const [selected, catalog] = model.value;
    if (typeof selected?.modelId === 'string' && Array.isArray(catalog?.list) && catalog.list.length <= 500) {
      const found = catalog.list.find(m => m?.id === selected.modelId);
      result.model = !found ? 'unavailable' : found.provider?.kind !== 'copilot' ? 'unsupported' : found.policy && found.policy.state !== 'enabled' ? 'unavailable' : 'ready';
    }
  }
  return result;
}

const string = (maxLength = 5000) => ({ type: 'string', minLength: 1, maxLength });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const requestId = string(100);
export const actionSchemas = {
  get_exploration: object({}),
  submit_questions: object({ requestId, questions: { ...array({ ...object({ question: string(600), category: string(60), rationale: string(1000), importance: { type: 'string', enum: ['low', 'medium', 'high'] }, importanceReason: string(600) }, ['question', 'category']), dependentRequired: { importance: ['importanceReason'], importanceReason: ['importance'] } }, 6), minItems: 0 } }),
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
      { name: 'get_exploration', description: 'Read the current map and pending request with its scenario classification, excluding review comments and responsibility handoffs. Retained alternatives require explicit hypothetical use.', inputSchema: actionSchemas.get_exploration, handler: ctx => get(ctx).explorer.nativeSnapshot() },
      { name: 'submit_questions', description: 'Stage specific questions for a pending request in an unsaved preview. Only the user can accept questions in the canvas; this callback never saves nodes. An empty array is allowed only for an ADR questions request with no material gaps.', inputSchema: actionSchemas.submit_questions, handler: ctx => get(ctx).explorer.receive('questions', ctx.input) },
      { name: 'fail_request', description: 'Explain why a pending request cannot be completed.', inputSchema: actionSchemas.fail_request, handler: ctx => get(ctx).explorer.receive('fail', ctx.input) },
    ],
    async open(ctx) {
      if (ctx.sessionId !== getSession().sessionId) throw new Error('Session mismatch.');
      if (!instances.has(ctx.instanceId) && !starting.has(ctx.instanceId)) {
        starting.set(ctx.instanceId, (async () => {
          const key = createHash('sha256').update(`${ctx.sessionId}\0${ctx.instanceId}`).digest('hex').slice(0, 32);
          let explorer;
          const usageDirectory = () => join(explorer?.auxiliaryDirectory() ?? directory, 'usage');
          explorer = await new Explorer({ library, binding: key,
            projectRoot: async () => {
              const session = getSession();
              if (session.sessionId !== ctx.sessionId) throw new Error('Project session changed.');
              const metadata = await session.rpc.metadata.snapshot();
              if (getSession().sessionId !== ctx.sessionId || metadata.sessionId !== ctx.sessionId || metadata.isRemote !== false) throw new Error('Local project metadata unavailable.');
              return metadata.workingDirectory;
            },
            researcher: createResearcher(getSession(), { usageDirectory }),
            cleaner: createCleaner(getSession(), { usageDirectory }),
            briefHelper: createBriefHelper(getSession(), { usageDirectory }),
            projectBriefHelper: createProjectBriefHelper(getSession(), { usageDirectory }),
            checkHelper: createAnswerCheckHelper(getSession(), { usageDirectory }),
            questionHelper: createQuestionHelper(getSession(), { usageDirectory }),
            target: { extensionId: ctx.extensionId, canvasId: 'explorer', instanceId: ctx.instanceId },
            send: async options => {
              try { return await getSession().send(options); }
              catch { throw new Error('The attached Copilot session is unavailable'); }
            },
          }).load();
          const server = await startServer(explorer, undefined, { readHost: () => readHostReadiness(getSession()) });
          const entry = { explorer, server };
          instances.set(ctx.instanceId, entry);
          explorer.startObservation();
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
