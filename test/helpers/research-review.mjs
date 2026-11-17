import { randomUUID } from 'node:crypto';

export async function startResearch(explorer, input = {}) {
  const journey = explorer.activeKey ?? explorer.doc.id;
  const review = await explorer.reviewResearch({ action: 'prepare', clientId: randomUUID(), sequence: 1, journey,
    nodeId: input.nodeId, scope: input.scope ?? 'decisions', excluded: input.excluded ?? [] });
  return explorer.command('research', { ...input, journey, token: review.token });
}
