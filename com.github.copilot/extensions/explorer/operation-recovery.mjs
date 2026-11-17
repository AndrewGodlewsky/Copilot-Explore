import { join } from 'node:path';
import { boundedNames, recoveryRead } from './recovery.mjs';
import { ownerStatus, validLockOwner } from './owned-lock.mjs';
import { activeUsageOwner } from './research-usage.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const helperOperations = ['research', 'decision-brief', 'answer-check', 'cleanup', 'question-help-rephrase', 'question-help-example', 'question-help-terms'];
export async function operationEvidence(directory) {
  const operations = [], root = join(directory, 'usage');
  let names;
  try { await boundedNames(directory, 2000); names = await boundedNames(root, 1024); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const sessions = join(root, 'session-state');
  if (names.includes('session-state')) for (const id of await boundedNames(sessions, 512)) {
    if (!uuid.test(id)) continue;
    const entry = { id, kind: 'Helper', status: 'unknown' };
    try {
      await boundedNames(join(sessions, id), 16);
      const value = JSON.parse(await recoveryRead(join(sessions, id), 'operation.json', 4096));
      if (value.version !== 1 || value.id !== id || !helperOperations.includes(value.operation) || !['active', 'completed', 'failed', 'cancelled'].includes(value.status) || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) || value.retention !== 'preserve' || !validLockOwner(value.owner)) throw new Error('Unknown operation.');
      entry.kind = value.operation;
      const owner = ownerStatus(value.owner);
      entry.status = value.status === 'active' ? owner === 'exited' ? 'interrupted' : activeUsageOwner(value.owner) ? 'active' : 'unknown' : value.status;
      if (['completed', 'cancelled'].includes(entry.status)) continue;
    } catch { /* Missing or damaged lifecycle evidence never implies interruption. */ }
    operations.push(entry);
  }
  for (const name of names) {
    if (!/^recovery-[0-9a-f-]{36}\.json$/i.test(name)) continue;
    const id = name.slice(9, -5);
    if (!uuid.test(id) || operations.some(row => row.id === id)) continue;
    // Legacy pointers only establish retained recovery evidence. Never read their
    // directory targets or infer that an orphan helper has stopped.
    operations.push({ id, kind: 'Retained helper recovery', status: 'unknown' });
  }
  return operations;
}
