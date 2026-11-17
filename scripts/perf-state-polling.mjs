import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

// Serial benchmark only: temporary instrumentation counts actual map work at its boundary.
export async function measureStateTraffic(document) {
  const explorer = new Explorer({ target: {} }); explorer.doc = document;
  const server = await startServer(explorer, { close() {} });
  const clone = globalThis.structuredClone, stringify = JSON.stringify;
  let counts, cursor;
  globalThis.structuredClone = function(value, ...args) { if (value?.document?.nodes) counts.mapClones++; return clone(value, ...args); };
  JSON.stringify = function(value, ...args) { if (value?.document?.nodes) counts.mapSerializations++; return stringify(value, ...args); };
  const scenario = async (name, requests, conditional) => {
    counts = { requests, bodyBytes: 0, mapClones: 0, mapSerializations: 0, mapParses: 0, statuses: [] };
    for (let i = 0; i < requests; i++) {
      const response = await fetch(server.url + 'api/state', { headers: conditional && cursor ? { 'X-Explorer-State': cursor } : {} });
      const body = await response.text(); counts.bodyBytes += Buffer.byteLength(body); counts.statuses.push(response.status);
      if (body) { const snapshot = JSON.parse(body); if (!snapshot.document?.nodes) throw new Error('Missing benchmark map'); counts.mapParses++; }
      cursor = response.headers.get('X-Explorer-State');
    }
    return [name, { ...counts }];
  };
  try {
    const result = [await scenario('fullSnapshot', 1, false), await scenario('unchanged', 10, true)];
    explorer.doc = { ...document, revision: document.revision + 1, objective: 'Changed benchmark objective' };
    result.push(await scenario('documentChanged', 1, true));
    explorer.pending = { id: 'benchmark-request', kind: 'research', nodeId: document.rootId, progress: 'Reading sources' };
    result.push(await scenario('transientChanged', 1, true));
    result.push(await scenario('transientUnchanged', 10, true));
    return Object.fromEntries(result);
  } finally { globalThis.structuredClone = clone; JSON.stringify = stringify; await server.close(); }
}
