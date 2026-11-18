import { createHash } from 'node:crypto';
import { opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { Library } from './library.mjs';
import { StorageManagement } from './storage-management.mjs';
import { validateDocument, MAX_DOCUMENT_BYTES } from './model.mjs';
import { ANSWER_STATES, questionCounts, effectiveAnswerState, isQuestion } from './web/answer-state.mjs';
import { effectiveMode, MODES } from './web/modes.mjs';
import { helperOperations } from './operation-recovery.mjs';

export const DASHBOARD_LIMITS = Object.freeze({ entries: 10000, pageFiles: 16, pageBytes: 32 * 1024 * 1024, helperEntries: 512, helperFileBytes: 8 * 1024 * 1024, helperBytes: 64 * 1024 * 1024, models: 32, receipts: 20000 });
const hash = text => createHash('sha256').update(text).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeId = (value, max = 256) => typeof value === 'string' && value.length <= max && /^[a-z0-9][a-z0-9._:+\/-]*$/i.test(value) && !value.includes('://');
const count = value => Number.isSafeInteger(value) && value >= 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) >= Date.UTC(2020, 0, 1) && Date.parse(value) < Date.UTC(2100, 0, 1);
export const utcDay = value => new Date(value).toISOString().slice(0, 10);
export const inPeriod = (time, filters) => (!filters.from || utcDay(time) >= filters.from) && (!filters.to || utcDay(time) <= filters.to);
export function dashboardFilters(input) {
  if (!input || Object.keys(input).sort().join(',') !== 'action,from,scope,to' || !['refresh', 'continue', 'cached'].includes(input.action) || !['active', 'archived', 'all'].includes(input.scope) || ![input.from, input.to].every(v => v === '' || date(v)) || input.from && input.to && input.from > input.to) throw new Error('Invalid dashboard filters.');
  return input;
}
export function projectMap(doc) {
  const counts = questionCounts(doc), states = Object.fromEntries(Object.keys(ANSWER_STATES).map(name => [name, 0]));
  const children = new Map(doc.nodes.map(n => [n.id, []]));
  for (const node of doc.nodes) { if (isQuestion(node)) states[effectiveAnswerState(node)]++; if (node.parentId !== null) children.get(node.parentId).push(node.id); }
  let depth = 0, parents = 0, edges = 0;
  const stack = [[doc.rootId, 0]];
  while (stack.length) { const [id, level] = stack.pop(), list = children.get(id); depth = Math.max(depth, level); if (list.length) { parents++; edges += list.length; } for (const child of list) stack.push([child, level + 1]); }
  return { id: hash(doc.id), fingerprint: hash(JSON.stringify(doc)), allNodes: doc.nodes.length, questions: counts.total, answered: counts.answered, resolved: counts.resolved, states, depth, parents, edges, mode: effectiveMode(doc) };
}
const distribution = (values, bounds) => bounds.map(([label, min, max]) => ({ label, value: values.filter(n => n >= min && n <= max).length }));
export class Dashboard {
  constructor(directory) { this.directory = directory; this.storage = new StorageManagement(directory); this.library = new Library(directory); this.scan = null; this.helpers = null; this.stale = false; }
  invalidate() { this.stale = true; }
  async start() {
    const scan = { names: [], rows: [], examined: 0, unavailable: 0, truncated: false, metadataUnavailable: false, startedAt: new Date().toISOString(), metadata: null };
    this.scan = scan; this.stale = false;
    try {
      await this.storage.root(); let discovered = 0;
      for await (const entry of await opendir(this.directory)) { if (++discovered > DASHBOARD_LIMITS.entries) { scan.truncated = true; break; } if (entry.name.endsWith('.explore.json')) scan.names.push(entry.name); }
      scan.names.sort();
      try { scan.metadata = await this.library.metadata(); } catch { scan.metadataUnavailable = true; }
    } catch { scan.unavailable++; scan.truncated = true; }
    this.helpers = await readHelpers(this.directory);
  }
  async advance() {
    const scan = this.scan; let files = 0, bytes = 0;
    while (scan.examined < scan.names.length && files < DASHBOARD_LIMITS.pageFiles && bytes + MAX_DOCUMENT_BYTES + 1 <= DASHBOARD_LIMITS.pageBytes) {
      const name = scan.names[scan.examined++]; files++;
      try {
        const read = await this.storage.read(join(this.directory, name), MAX_DOCUMENT_BYTES); bytes += Buffer.byteLength(read.text);
        const doc = validateDocument(JSON.parse(read.text)), row = projectMap(doc), key = hash(`${name}\0${doc.id}`);
        row.archived = scan.metadata ? scan.metadata.entries[key]?.archived ?? false : null;
        scan.rows.push(row);
      } catch { scan.unavailable++; bytes += MAX_DOCUMENT_BYTES + 1; }
    }
    scan.aggregatedAt = new Date().toISOString();
  }
  stock(scope) {
    const scan = this.scan, groups = new Map();
    for (const row of scan.rows) { if (!groups.has(row.id)) groups.set(row.id, []); groups.get(row.id).push(row); }
    let ambiguous = 0, duplicates = 0, excluded = 0;
    const rows = [];
    for (const group of groups.values()) {
      if (new Set(group.map(row => row.fingerprint)).size !== 1) { ambiguous++; continue; }
      duplicates += group.length - 1;
      const archived = group.every(row => row.archived === true);
      if (scope !== 'all' && (scan.metadataUnavailable || (scope === 'archived') !== archived)) { excluded++; continue; }
      rows.push(group[0]);
    }
    const sizes = rows.map(row => row.questions).sort((a, b) => a - b), sum = field => rows.reduce((total, row) => total + row[field], 0), n = rows.length;
    return { journeys: n, duplicates, ambiguous, excluded, unavailable: scan.unavailable, metadataUnavailable: scan.metadataUnavailable, truncated: scan.truncated, examined: scan.examined, discovered: scan.names.length, next: scan.examined < scan.names.length,
      startedAt: scan.startedAt, aggregatedAt: scan.aggregatedAt, questions: sum('questions'), allNodes: sum('allNodes'), answered: sum('answered'), resolved: sum('resolved'),
      mean: n ? sum('questions') / n : null, median: n ? (sizes[Math.floor((n - 1) / 2)] + sizes[Math.floor(n / 2)]) / 2 : null,
      branching: sum('parents') ? sum('edges') / sum('parents') : null, branchingParents: sum('parents'),
      sizes: distribution(sizes, [['0', 0, 0], ['1–5', 1, 5], ['6–20', 6, 20], ['21–50', 21, 50], ['51+', 51, Infinity]]),
      depths: distribution(rows.map(row => row.depth), [['0', 0, 0], ['1–2', 1, 2], ['3–5', 3, 5], ['6–10', 6, 10], ['11+', 11, Infinity]]),
      states: Object.fromEntries(Object.keys(ANSWER_STATES).map(name => [name, rows.reduce((total, row) => total + row.states[name], 0)])), modes: Object.fromEntries(Object.keys(MODES).map(mode => [mode, rows.filter(row => row.mode === mode).length])) };
  }
  async request(input, analytics) {
    const filters = dashboardFilters(input), cached = filters.action === 'cached' && !!this.scan;
    if (filters.action === 'refresh' || !this.scan) await this.start();
    if (!cached) await this.advance();
    return { stock: this.stock(filters.scope), helpers: aggregateHelpers(this.helpers, filters), activity: await analytics?.summary(filters) ?? { unavailable: false, startedAt: null, retainedFrom: null, pruned: 0, failures: 0, dropped: 0, pending: 0, days: [] }, cached, stale: this.stale, filters, limits: DASHBOARD_LIMITS };
  }
}
const fields = ['totalTokens', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'toolTokenCount', 'totalNanoAiu'];
export async function readHelpers(directory) {
  const storage = new StorageManagement(directory), base = join(directory, 'usage', 'session-state');
  const result = { rows: [], operations: [], unavailable: 0, malformed: 0, truncated: false, bytes: 0, scannedAt: new Date().toISOString() };
  try {
    await storage.safe(base, { file: false }); let discovered = 0; const seen = new Set();
    for await (const entry of await opendir(base)) {
      if (++discovered > DASHBOARD_LIMITS.helperEntries || result.bytes >= DASHBOARD_LIMITS.helperBytes || result.rows.length >= DASHBOARD_LIMITS.receipts) { result.truncated = true; break; }
      if (!uuid.test(entry.name)) continue;
      const id = entry.name, root = join(base, id);
      try {
        const data = JSON.parse((await storage.read(join(root, 'operation.json'), 4096)).text); result.bytes += 4096;
        if (data.version !== 1 || data.id !== id || !helperOperations.includes(data.operation) || !['active', 'completed', 'failed', 'cancelled'].includes(data.status) || !timestamp(data.updatedAt) || data.retention !== 'preserve') throw new Error();
        result.operations.push({ operation: data.operation, status: data.status === 'active' ? 'unfinished' : data.status, time: data.updatedAt });
      } catch { result.unavailable++; result.bytes += 4096; }
      if (result.bytes + DASHBOARD_LIMITS.helperFileBytes > DASHBOARD_LIMITS.helperBytes) { result.truncated = true; break; }
      let text;
      try { text = (await storage.read(join(root, 'events.jsonl'), DASHBOARD_LIMITS.helperFileBytes)).text; result.bytes += Buffer.byteLength(text); }
      catch { result.unavailable++; result.bytes += DASHBOARD_LIMITS.helperFileBytes; continue; }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        if (result.rows.length >= DASHBOARD_LIMITS.receipts) { result.truncated = true; break; }
        try {
          const event = JSON.parse(line); if (event.type === 'session.start') continue;
          const usage = event?.data?.usage;
          if (event.type !== 'session.usage_record' || !safeId(event.id) || !timestamp(event.timestamp) || !usage || typeof usage !== 'object' || Array.isArray(usage)) throw new Error();
          const accounting = usage.accounting, key = accounting?.sourceSessionId === id && safeId(accounting.usageId) && count(accounting.sequence) ? `${id}:${accounting.usageId}` : `${id}:event:${event.id}`;
          if (seen.has(key)) continue; seen.add(key);
          const row = { time: new Date(event.timestamp).toISOString(), model: safeId(usage.model, 128) ? usage.model : 'Unknown', credits: ['complete', 'partial', 'unavailable'].includes(usage.aiCreditsStatus) ? usage.aiCreditsStatus : 'unavailable' };
          for (const field of fields) { const value = field === 'totalNanoAiu' ? usage.copilotUsage?.totalNanoAiu : usage[field]; if (count(value)) row[field] = value; }
          result.rows.push(row);
        } catch { result.malformed++; }
      }
    }
  } catch (error) { if (error.code !== 'ENOENT') result.unavailable++; }
  return result;
}
function metric(rows, field) {
  const known = rows.filter(row => count(row[field])), sum = known.reduce((total, row) => total + BigInt(row[field]), 0n), overflow = sum > BigInt(Number.MAX_SAFE_INTEGER);
  return { value: known.length && !overflow ? Number(sum) : null, known: known.length, missing: rows.length - known.length, overflow };
}
export function aggregateHelpers(source, filters) {
  const rows = source.rows.filter(row => inPeriod(row.time, filters)), operations = source.operations.filter(row => inPeriod(row.time, filters));
  const dailyRows = new Map();
  for (const row of rows) { const day = utcDay(row.time); if (!dailyRows.has(day)) dailyRows.set(day, []); dailyRows.get(day).push(row); }
  const days = [...dailyRows.keys()].sort().slice(-180).map(day => { const daily = dailyRows.get(day); return { day, receipts: daily.length, totalTokens: metric(daily, 'totalTokens'), totalNanoAiu: metric(daily, 'totalNanoAiu') }; });
  const modelRows = new Map();
  for (const row of rows) { const name = row.model === 'Unknown' || modelRows.has(row.model) || modelRows.size < DASHBOARD_LIMITS.models ? row.model : 'Other models'; if (!modelRows.has(name)) modelRows.set(name, []); modelRows.get(name).push(row); }
  return { receipts: rows.length, retainedReceipts: source.rows.length, retainedFrom: source.rows.map(row => row.time).sort()[0] ?? null, scannedAt: source.scannedAt, unavailable: source.unavailable, malformed: source.malformed, truncated: source.truncated,
    metrics: Object.fromEntries(fields.map(field => [field, metric(rows, field)])), days, omittedDays: Math.max(0, dailyRows.size - days.length),
    models: [...modelRows].map(([model, items]) => ({ model, receipts: items.length, totalTokens: metric(items, 'totalTokens'), totalNanoAiu: metric(items, 'totalNanoAiu') })),
    credits: Object.fromEntries(['complete', 'partial', 'unavailable'].map(status => [status, rows.filter(row => row.credits === status).length])),
    outcomes: Object.fromEntries(helperOperations.map(operation => [operation, Object.fromEntries(['completed', 'failed', 'cancelled', 'unfinished'].map(status => [status, operations.filter(row => row.operation === operation && row.status === status).length]))])) };
}
