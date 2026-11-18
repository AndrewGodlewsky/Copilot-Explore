import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { atomicWrite } from './storage.mjs';
import { StorageManagement } from './storage-management.mjs';
import { acquireLock } from './owned-lock.mjs';
import { questionCounts } from './web/answer-state.mjs';
import { inPeriod, utcDay } from './dashboard.mjs';

export const ANALYTICS_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, events: 2000, days: 180, pending: 100 });
const hash = value => createHash('sha256').update(value).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const time = value => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && Date.parse(value) >= Date.UTC(2020, 0, 1) && Date.parse(value) < Date.UTC(2100, 0, 1) && new Date(value).toISOString() === value;
const empty = () => ({ version: 1, startedAt: null, pruned: 0, failures: 0, dropped: 0, events: [] });
const add = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
function validEvent(event) {
  return event && /^[a-f0-9]{64}$/.test(event.key) && time(event.time) &&
    (event.kind === 'visit' && Object.keys(event).sort().join(',') === 'key,kind,time' ||
      event.kind === 'commit' && Object.keys(event).sort().join(',') === 'answered,delta,key,kind,questions,resolved,time' && ['questions', 'answered', 'resolved'].every(k => integer(event[k]) && event[k] <= 5000) && event.answered <= event.questions && event.resolved <= event.questions && Number.isInteger(event.delta) && Math.abs(event.delta) <= 5000);
}
export class Analytics {
  constructor(directory, { write = atomicWrite, now = Date.now } = {}) {
    this.directory = directory; this.file = join(directory, 'analytics.json'); this.storage = new StorageManagement(directory);
    this.write = write; this.now = now; this.pending = new Map(); this.failures = 0; this.dropped = 0; this.flight = null;
  }
  async read() {
    try {
      const value = JSON.parse((await this.storage.read(this.file, ANALYTICS_LIMITS.bytes)).text);
      if (!value || Object.keys(value).sort().join(',') !== 'dropped,events,failures,pruned,startedAt,version' || value.version !== 1 || !(value.startedAt === null || time(value.startedAt)) || !['pruned', 'failures', 'dropped'].every(key => integer(value[key])) || !Array.isArray(value.events) || value.events.length > ANALYTICS_LIMITS.events || !value.events.every(validEvent) || new Set(value.events.map(event => event.key)).size !== value.events.length) throw new Error();
      return value;
    } catch (error) { if (error.code === 'ENOENT') return empty(); throw new Error('Local observations are unavailable; original storage is preserved.'); }
  }
  enqueue(event) {
    if (!this.pending.has(event.key) && this.pending.size >= ANALYTICS_LIMITS.pending) this.dropped = add(this.dropped, 1);
    else this.pending.set(event.key, this.pending.get(event.key) ?? event);
    void this.flush();
  }
  visit() { this.enqueue({ key: hash(randomUUID()), kind: 'visit', time: new Date(this.now()).toISOString() }); }
  commit(saved, next) {
    const counts = questionCounts(next);
    this.enqueue({ key: hash(`${next.id}\0${next.revision}\0${JSON.stringify(next)}`), kind: 'commit', time: new Date(this.now()).toISOString(), questions: counts.total, answered: counts.answered, resolved: counts.resolved, delta: counts.total - (saved ? questionCounts(saved).total : 0) });
  }
  async flush() {
    if (this.flight) return this.flight;
    if (!this.pending.size && !this.failures && !this.dropped) return;
    this.flight = (async () => {
      do {
        const batch = [...this.pending.values()], failures = this.failures, dropped = this.dropped;
        let lock;
        let succeeded = false;
        try {
          const root = await this.storage.root();
          lock = await acquireLock(this.file + '.lock', { attempts: 2 });
          const value = await this.read(), seen = new Set(value.events.map(e => e.key)), cutoff = this.now() - ANALYTICS_LIMITS.days * 86400000;
          for (const event of batch) if (!seen.has(event.key)) { seen.add(event.key); value.events.push(event); if (!value.startedAt || event.time < value.startedAt) value.startedAt = event.time; }
          value.events.sort((a, b) => a.time.localeCompare(b.time) || a.key.localeCompare(b.key));
          const retained = value.events.filter(event => Date.parse(event.time) >= cutoff).slice(-ANALYTICS_LIMITS.events);
          value.pruned = add(value.pruned, value.events.length - retained.length); value.events = retained;
          value.failures = add(value.failures, failures); value.dropped = add(value.dropped, dropped);
          const content = JSON.stringify(value); if (Buffer.byteLength(content) > ANALYTICS_LIMITS.bytes) throw new Error();
          await this.storage.root(root); await this.write(this.file, content);
          for (const event of batch) this.pending.delete(event.key);
          this.failures -= failures; this.dropped -= dropped;
          succeeded = true;
        } catch { this.failures = add(this.failures, 1); }
        finally { if (lock) await lock.release().catch(() => { this.failures = add(this.failures, 1); }); }
        if (!succeeded) break;
      } while (this.pending.size || this.failures || this.dropped);
    })().finally(() => { this.flight = null; });
    return this.flight;
  }
  async summary(filters) {
    await this.flush();
    let value;
    const aggregatedAt = new Date(this.now()).toISOString();
    try { value = await this.read(); } catch { return { unavailable: true, aggregatedAt, pending: this.pending.size, failures: this.failures, dropped: this.dropped, days: [] }; }
    const events = value.events.filter(event => Date.parse(event.time) >= this.now() - ANALYTICS_LIMITS.days * 86400000), daily = new Map();
    for (const event of events.filter(event => inPeriod(event.time, filters))) {
      const day = utcDay(event.time); if (!daily.has(day)) daily.set(day, { day, visits: 0, commits: 0, delta: 0 });
      const row = daily.get(day); if (event.kind === 'visit') row.visits++; else { row.commits++; row.delta += event.delta; }
    }
    return { unavailable: false, aggregatedAt, startedAt: value.startedAt, retainedFrom: events[0]?.time ?? null, pruned: value.pruned, expired: value.events.length - events.length, failures: add(value.failures, this.failures), dropped: add(value.dropped, this.dropped), pending: this.pending.size, days: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)), limits: ANALYTICS_LIMITS };
  }
}
