// Portable historical identity claims. No source lookup or current-content claim.
export function scenarioOrigin(value) {
  const fail = () => { throw Error('Invalid scenario origin lineage.'); };
  const fields = (v, keys) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.split(',').sort().join(',')) fail(); };
  const id = v => { if (typeof v !== 'string' || !v || v.trim() !== v || v.length > 100) fail(); return v; };
  const identity = v => {
    for (const key of ['journeyId', 'rootId', 'nodeId']) id(v[key]);
    if (typeof v.createdAt !== 'string' || v.createdAt.length > 100 || !Number.isFinite(Date.parse(v.createdAt))) fail();
    return { journeyId: v.journeyId, rootId: v.rootId, createdAt: v.createdAt, nodeId: v.nodeId };
  };
  fields(value, 'version,source,forkNodeId,nodes'); if (value.version !== 1) fail();
  fields(value.source, 'journeyId,rootId,createdAt,nodeId,digest,revision');
  const source = identity(value.source);
  if (typeof value.source.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.source.digest) || !Number.isSafeInteger(value.source.revision) || value.source.revision < 0) fail();
  Object.assign(source, { digest: value.source.digest, revision: value.source.revision });
  if (!Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 5000) fail();
  const seen = new Set(), sources = new Set();
  const nodes = value.nodes.map(row => {
    fields(row, 'nodeId,sourceNodeId,origin'); fields(row.origin, 'journeyId,rootId,createdAt,nodeId');
    const nodeId = id(row.nodeId), sourceNodeId = id(row.sourceNodeId);
    if (seen.has(nodeId) || sources.has(sourceNodeId) || nodeId === sourceNodeId) fail();
    seen.add(nodeId); sources.add(sourceNodeId);
    return { nodeId, sourceNodeId, origin: identity(row.origin) };
  });
  const forkNodeId = id(value.forkNodeId);
  if (!nodes.some(row => row.nodeId === forkNodeId && row.sourceNodeId === source.nodeId)) fail();
  return { version: 1, source, forkNodeId, nodes };
}
