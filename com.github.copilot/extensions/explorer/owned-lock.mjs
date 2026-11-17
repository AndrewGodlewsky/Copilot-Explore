import { open, lstat, unlink, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const lockOwner = () => ({ version: 1, pid: process.pid, host: hostname(), token: randomUUID(), createdAt: new Date().toISOString(), retention: 'preserve' });
export function validLockOwner(owner) {
  return owner?.version === 1 && Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.host === 'string' && owner.host.length > 0 && owner.host.length <= 255 &&
    typeof owner.token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(owner.token) && typeof owner.createdAt === 'string' && Number.isFinite(Date.parse(owner.createdAt)) && owner.retention === 'preserve';
}
export function ownerStatus(owner, probe = pid => process.kill(pid, 0)) {
  if (!validLockOwner(owner) || owner.host !== hostname()) return 'unknown';
  try { probe(owner.pid); return 'active'; }
  catch (error) { return error.code === 'ESRCH' ? 'exited' : 'unknown'; }
}
async function record(path) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.size > 4096) throw new Error('Lock owner is unknown. Files are preserved.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (stat.ino !== entry.ino || stat.dev !== entry.dev || stat.nlink !== 1 || !stat.isFile()) throw new Error('Lock owner changed. Retry.');
    const bytes = Buffer.alloc(4097), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 4096) throw new Error('Lock owner is unknown.');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle.close(); }
}
async function create(path) {
  const handle = await open(path, 'wx', 0o600), owner = lockOwner();
  try { await handle.writeFile(JSON.stringify(owner)); }
  catch (error) {
    // No valid owner record was published, so no cooperative reclaimer can move it.
    await handle.close(); await unlink(path); throw error;
  }
  await handle.close();
  return { async release() {
    let current;
    try { current = await record(path); } catch { throw new Error('Lock ownership could not be verified. Files are preserved.'); }
    if (current.token !== owner.token) throw new Error('Lock ownership changed. Files are preserved.');
    // A living owner cannot be reclaimed; no cooperative writer can replace this path yet.
    await unlink(path);
  } };
}
async function reclaim(path) {
  let claim;
  try { claim = await create(path + '.recover'); }
  catch { throw new Error('Lock recovery is already claimed or unavailable. Retry; recovery files are preserved.'); }
  try {
    let owner;
    try { owner = await record(path); }
    catch (error) { if (error.code === 'ENOENT') return; throw new Error('Lock owner is unknown. Files are preserved.'); }
    if (ownerStatus(owner) !== 'exited') throw new Error('Another writer may still be active, or its owner is unknown. Retry after it exits; files are preserved.');
    try { await lstat(path + '.abandoned'); throw new Error('Earlier lock recovery evidence is retained. Further recovery needs storage review.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // The claim serializes all reclaimers. A dead owner cannot release; the shared
    // path cannot change until this rename. Never unlink that shared path afterward.
    await rename(path, path + '.abandoned');
  } finally { await claim.release(); }
}
export async function acquireLock(path, { attempts = 1 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await create(path); }
    catch (error) { if (error.code !== 'EEXIST') throw new Error('Writer lock storage is unavailable. Check local storage access and retry; files are preserved.'); }
    try { await reclaim(path); return await create(path); }
    catch (error) {
      if (attempt + 1 === attempts) throw new Error(error.code === 'EEXIST' ? 'Another writer acquired the file. Retry.' : error.message);
      await delay(20);
    }
  }
}
