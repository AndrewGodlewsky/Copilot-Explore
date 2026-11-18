import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile, rename, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createDocument, addQuestions, addDirection, answerNode, MAX_DOCUMENT_BYTES } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Dashboard, readHelpers, aggregateHelpers } from '../com.github.copilot/extensions/explorer/dashboard.mjs';
import { createUsageRecorder } from '../com.github.copilot/extensions/explorer/research-usage.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { atomicWrite } from '../com.github.copilot/extensions/explorer/storage.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { explorerCanvas } from '../com.github.copilot/extensions/explorer/canvas.mjs';
import { StorageManagement } from '../com.github.copilot/extensions/explorer/storage-management.mjs';
import { fixtureSpecs, makeFixture } from '../scripts/perf-fixtures.mjs';
import { acquireLock } from '../com.github.copilot/extensions/explorer/owned-lock.mjs';
const digest = text => createHash('sha256').update(text).digest('hex');
const canary = 'PRIVATE_TOPIC_ANSWER_PROMPT_AUDIO';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-dashboard-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const library = new Library(directory), explorer = await new Explorer({ library }).load();
  t.after(() => explorer.close());
  return { directory, library, explorer };
}
const request = (explorer, action = 'refresh', extra = {}) => explorer.dashboardRequest({ action, scope: 'active', from: '', to: '', ...extra });

test('recorder-backed accounting and fallback receipt identities cannot collide', async t => {
  const f = await fixture(t), id = randomUUID(), recorder = await createUsageRecorder(id, join(f.directory, 'usage'));
  t.after(() => recorder.finish('completed'));
  const accounting = { type: 'session.usage_record', id: 'accounted', timestamp: '2026-11-17T00:00:00Z', data: { usage: { totalTokens: 11, accounting: { sourceSessionId: id, usageId: 'event:receipt-1', sequence: 0 } } } };
  const repeated = { ...accounting, id: 'repeat', data: { usage: { ...accounting.data.usage, totalTokens: 999 } } };
  recorder.record(accounting); recorder.record({ ...accounting, id: 'receipt-1', data: { usage: { totalTokens: 17 } } }); recorder.record(repeated);
  await recorder.flush();
  const file = join(f.directory, 'usage', 'session-state', id, 'events.jsonl');
  const retained = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => row.type === 'session.usage_record');
  assert.equal(retained.length, 2); assert.equal(retained.reduce((sum, row) => sum + row.data.usage.totalTokens, 0), 28);
  let summary = aggregateHelpers(await readHelpers(f.directory), { from: '', to: '' });
  assert.equal(summary.receipts, 2); assert.equal(summary.metrics.totalTokens.value, 28);
  await appendFile(file, JSON.stringify(repeated) + '\n');
  summary = aggregateHelpers(await readHelpers(f.directory), { from: '', to: '' });
  assert.equal(summary.receipts, 2); assert.equal(summary.metrics.totalTokens.value, 28, 'first accounting identity wins even if replayed in retained input');
});

test('dashboard metadata growth and replacement after the precheck are unknown, not active defaults', async t => {
  for (const mutation of ['grow', 'replace', 'remove']) await t.test(mutation, async t => {
    const f = await fixture(t), doc = createDocument('Map'), file = join(f.directory, 'library.json');
    await writeFile(join(f.directory, 'a.explore.json'), JSON.stringify(doc));
    const initial = JSON.stringify({ version: 1, revision: 0, entries: {}, bindings: {} }); await writeFile(file, initial);
    const dashboard = new Dashboard(f.directory); let changed = false;
    const change = async () => {
      if (changed) return; changed = true;
      if (mutation === 'grow') await appendFile(file, ' '.repeat(MAX_DOCUMENT_BYTES));
      else if (mutation === 'remove') await rm(file);
      else { const replacement = file + '.replacement'; await writeFile(replacement, initial); await rename(replacement, file); }
    };
    const safe = dashboard.storage.safe.bind(dashboard.storage);
    dashboard.storage.safe = async (path, options) => { const result = await safe(path, options); if (path === file) await change(); return result; };
    // Exercise the same mutation against the old precheck seam for the RED run.
    const safeFile = Library.prototype.safeFile;
    t.mock.method(Library.prototype, 'safeFile', async function (name, limit) { const result = await safeFile.call(this, name, limit); if (result === file) await change(); return result; });
    const result = await dashboard.request({ action: 'refresh', scope: 'active', from: '', to: '' });
    assert.equal(changed, true); assert.equal(result.stock.metadataUnavailable, true); assert.equal(result.stock.journeys, 0);
    assert.equal((await dashboard.request({ action: 'cached', scope: 'all', from: '', to: '' })).stock.journeys, 1);
  });
});

test('dashboard archive metadata is bounded, schema-validated and compact with missing metadata still active', async t => {
  const f = await fixture(t), doc = createDocument('Map'), file = join(f.directory, 'library.json'), key = digest(`a.explore.json\0${doc.id}`);
  await writeFile(join(f.directory, 'a.explore.json'), JSON.stringify(doc));
  const dashboard = new Dashboard(f.directory), input = { action: 'refresh', scope: 'active', from: '', to: '' };
  assert.equal((await dashboard.request(input)).stock.journeys, 1, 'missing metadata preserves legacy active default');
  const metadata = { version: 1, revision: 0, entries: { [key]: { pinned: false, archived: true, lastOpenedAt: null, ignored: canary } }, bindings: { [digest('binding')]: key }, ignored: canary.repeat(1000) };
  await writeFile(file, JSON.stringify(metadata));
  let result = await dashboard.request({ ...input, scope: 'archived' }); assert.equal(result.stock.journeys, 1);
  assert.deepEqual(dashboard.scan.metadata, { [key]: true });
  assert.ok(!JSON.stringify(dashboard.scan).includes(canary)); assert.ok(JSON.stringify(dashboard.scan).length < 2000);
  for (const invalid of [{ ...metadata, bindings: { invalid: key } }, { ...metadata, entries: { [key]: { ...metadata.entries[key], pinned: 'yes' } } }]) {
    await writeFile(file, JSON.stringify(invalid)); result = await dashboard.request(input); assert.equal(result.stock.metadataUnavailable, true); assert.equal(result.stock.journeys, 0);
  }
  await writeFile(file, JSON.stringify(metadata) + ' '.repeat(MAX_DOCUMENT_BYTES));
  result = await dashboard.request(input); assert.equal(result.stock.metadataUnavailable, true); assert.equal(result.stock.journeys, 0);
});
test('dashboard deduplicates identical stock, excludes ambiguous IDs across archives, and separates answer measures', async t => {
  const f = await fixture(t), doc = createDocument(canary);
  addQuestions(doc, doc.rootId, [{ question: canary, category: 'Scope' }, { question: 'Scope?', category: 'Scope' }]);
  addDirection(doc, doc.rootId, 'A direction');
  answerNode(doc, doc.nodes[1].id, canary, 'decided');
  doc.nodes[2].answerState = 'not-relevant';
  for (const name of ['a', 'b']) await writeFile(join(f.directory, `${name}.explore.json`), JSON.stringify(doc));
  const bad = createDocument('Ambiguous');
  await writeFile(join(f.directory, 'c.explore.json'), JSON.stringify(bad));
  bad.objective = 'Divergent'; await writeFile(join(f.directory, 'd.explore.json'), JSON.stringify(bad));
  const meta = { version: 1, revision: 1, bindings: {}, entries: { [digest(`d.explore.json\0${bad.id}`)]: { archived: true, pinned: false, lastOpenedAt: null } } };
  await writeFile(join(f.directory, 'library.json'), JSON.stringify(meta));
  await writeFile(join(f.directory, 'broken.explore.json'), `{ "${canary}`);
  assert.equal(typeof f.explorer.dashboardRequest, 'function', 'dashboard endpoint exists');
  const result = await request(f.explorer);
  assert.equal(result.stock.journeys, 1); assert.equal(result.stock.duplicates, 1); assert.equal(result.stock.ambiguous, 1); assert.equal(result.stock.unavailable, 1);
  assert.equal(result.stock.questions, 2); assert.equal(result.stock.allNodes, 4); assert.equal(result.stock.answered, 1); assert.equal(result.stock.resolved, 2);
  assert.equal(result.stock.mean, 2); assert.equal(result.stock.median, 2);
  assert.equal(result.stock.states.decided, 1); assert.equal(result.stock.states['not-relevant'], 1);
  assert.ok(!JSON.stringify(result).includes(canary)); assert.ok(!JSON.stringify(result).includes(doc.id)); assert.ok(!JSON.stringify(result).includes(f.directory));
  const filtered = await request(f.explorer, 'cached', { from: '2099-01-01', to: '2099-01-01' });
  assert.equal(filtered.stock.questions, 2, 'dates never time-travel current stock');
  assert.equal(filtered.activity.days.length, 0);
});
test('dashboard scans incrementally and cached reads never rescan documents; refresh accounts for deletions', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 35; i++) await writeFile(join(f.directory, `${i}.explore.json`), JSON.stringify(createDocument(`Map ${i}`)));
  assert.equal(typeof f.explorer.dashboardRequest, 'function');
  let result = await request(f.explorer); assert.equal(result.stock.examined, 16); assert.equal(result.stock.next, true);
  result = await request(f.explorer, 'continue'); assert.equal(result.stock.examined, 32);
  result = await request(f.explorer, 'continue'); assert.equal(result.stock.journeys, 35); assert.equal(result.stock.next, false);
  await rm(join(f.directory, '0.explore.json'));
  const cached = await request(f.explorer, 'cached'); assert.equal(cached.stock.journeys, 35); assert.equal(cached.cached, true);
  result = await request(f.explorer); while (result.stock.next) result = await request(f.explorer, 'continue');
  assert.equal(result.stock.journeys, 34);
});
test('dashboard uses only owned receipt identities, keeps absent usage unknown and never adds total to components', async t => {
  const f = await fixture(t), id = randomUUID(), directory = join(f.directory, 'usage', 'session-state', id);
  await mkdir(directory, { recursive: true });
  const row = { type: 'session.usage_record', id: 'event-1', timestamp: '2026-11-17T00:30:00+01:00', data: { usage: { totalTokens: 30, inputTokens: 20, outputTokens: 10, aiCreditsStatus: 'partial', copilotUsage: { totalNanoAiu: 50 }, accounting: { sourceSessionId: id, usageId: 'receipt-1', sequence: 0 } } } };
  await writeFile(join(directory, 'events.jsonl'), [row, { ...row, id: 'event-2' }, { type: 'session.usage_record', id: 'unknown', timestamp: '2026-11-17T00:30:00Z', data: { usage: {} } }].map(x => JSON.stringify(x)).join('\n'));
  await writeFile(join(directory, 'operation.json'), JSON.stringify({ version: 1, id, operation: 'research', status: 'completed', updatedAt: '2026-11-17T01:00:00Z', retention: 'preserve' }));
  assert.equal(typeof f.explorer.dashboardRequest, 'function');
  const result = await request(f.explorer);
  assert.equal(result.helpers.receipts, 2); assert.equal(result.helpers.metrics.totalTokens.value, 30); assert.equal(result.helpers.metrics.totalTokens.known, 1); assert.equal(result.helpers.metrics.totalTokens.missing, 1);
  assert.equal(result.helpers.days[0].day, '2026-11-16'); assert.equal(result.helpers.credits.partial, 1); assert.equal(result.helpers.outcomes.research.completed, 1);
  const filtered = await request(f.explorer, 'cached', { from: '2026-11-17', to: '2026-11-17' });
  assert.equal(filtered.helpers.metrics.totalTokens.value, null); assert.equal(filtered.helpers.metrics.totalTokens.missing, 1);
  assert.ok(!JSON.stringify(result).includes(id));
});
test('observations follow successful atomic commits even when History finalization fails, without draft or no-op events', async t => {
  const f = await fixture(t), doc = createDocument(canary), file = join(f.directory, 'map.explore.json');
  addQuestions(doc, doc.rootId, [{ question: canary, category: 'Scope' }]); await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file }).load(); t.after(() => e.close());
  assert.equal(typeof e.startObservation, 'function');
  e.startObservation(); e.startObservation();
  const history = await e.history(e.doc.id); let manifests = 0;
  history.write = async (path, data) => { if (path.endsWith('manifest.json') && ++manifests === 2) throw new Error('Injected finalization failure'); return atomicWrite(path, data); };
  await assert.rejects(e.command('answer', { revision: 0, nodeId: doc.nodes[1].id, answer: canary, answerState: 'decided' }));
  assert.equal(e.doc.revision, 1); assert.equal(e.recoveryNotice.status, 'committed');
  history.write = atomicWrite; await e.save(structuredClone(e.doc));
  const result = await request(e), raw = await readFile(join(f.directory, 'analytics.json'), 'utf8');
  assert.equal(result.activity.days.reduce((s, row) => s + row.visits, 0), 1);
  assert.equal(result.activity.days.reduce((s, row) => s + row.commits, 0), 1);
  assert.ok(!raw.includes(canary)); assert.ok(!raw.includes(doc.id)); assert.ok(!raw.includes(doc.nodes[1].id));
});
test('analytics retries idempotently, merges concurrent owners, prunes old facts and preserves corrupt storage', async t => {
  const f = await fixture(t); assert.equal(typeof f.explorer.startObservation, 'function');
  const { Analytics } = await import('../com.github.copilot/extensions/explorer/analytics.mjs');
  let fail = true, now = Date.parse('2026-11-17T00:30:00Z');
  const first = new Analytics(f.directory, { now: () => now, write: async (file, text) => { if (fail) throw new Error(canary); return atomicWrite(file, text); } });
  const second = new Analytics(f.directory, { now: () => now });
  first.visit(); await first.flush(); assert.equal((await first.summary({ from: '', to: '' })).pending, 1);
  fail = false; second.visit(); await second.flush(); await first.flush(); await first.flush();
  const saved = JSON.parse(await readFile(join(f.directory, 'analytics.json'), 'utf8'));
  assert.equal(saved.events.length, 2); assert.ok(saved.failures >= 1);
  const doc = createDocument(canary); first.commit(null, doc); first.commit(null, doc); await first.flush();
  assert.equal(JSON.parse(await readFile(join(f.directory, 'analytics.json'), 'utf8')).events.length, 3);
  fail = true; first.visit(); await first.flush(); now += 181 * 86400000; fail = false; await first.flush();
  const pruned = await first.summary({ from: '', to: '' }); assert.equal(pruned.days.length, 0); assert.ok(pruned.pruned >= 4);
  await writeFile(join(f.directory, 'analytics.json'), `{ ${canary}`);
  first.visit(); await first.flush(); const bad = await first.summary({ from: '', to: '' });
  assert.equal(bad.unavailable, true); assert.ok(!JSON.stringify(bad).includes(canary)); assert.equal(await readFile(join(f.directory, 'analytics.json'), 'utf8'), `{ ${canary}`);
});
test('dashboard HTTP sanitizes malformed JSON and protects refresh with exact origin', async t => {
  const f = await fixture(t), server = await startServer(f.explorer, { close() {} }); t.after(() => server.close());
  const url = new URL('api/dashboard', server.url), headers = { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: url.origin };
  const malformed = await fetch(url, { method: 'POST', headers, body: `{ ${canary}` });
  assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes(canary));
  const denied = await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://example.test' }, body: '{}' }); assert.equal(denied.status, 403);
  const result = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'refresh', scope: 'all', from: '', to: '' }) });
  assert.equal(result.status, 200); assert.equal((await result.json()).stock.journeys, 0);
});
test('receipt aggregation bounds day/model output and rejects overflow without returning a plausible total', async t => {
  const f = await fixture(t), id = randomUUID(), directory = join(f.directory, 'usage', 'session-state', id); await mkdir(directory, { recursive: true });
  const rows = Array.from({ length: 400 }, (_, i) => ({ type: 'session.usage_record', id: `event-${i}`, timestamp: new Date(Date.UTC(2024, 0, i + 1)).toISOString(), data: { usage: { model: `model-${i}`, totalTokens: Number.MAX_SAFE_INTEGER, prompt: canary } } }));
  await writeFile(join(directory, 'events.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'));
  const result = await request(f.explorer);
  assert.equal(result.helpers.metrics.totalTokens.value, null); assert.equal(result.helpers.metrics.totalTokens.overflow, true);
  assert.ok(result.helpers.models.length <= 34); assert.equal(result.helpers.models.reduce((sum, row) => sum + row.receipts, 0), 400);
  assert.ok(result.helpers.days.length <= 180); assert.equal(result.helpers.omittedDays, 220);
  assert.ok(!JSON.stringify(result).includes(canary));
});
test('archive metadata corruption stays unknown instead of fabricating active journeys', async t => {
  const f = await fixture(t); await writeFile(join(f.directory, 'a.explore.json'), JSON.stringify(createDocument('A'))); await writeFile(join(f.directory, 'library.json'), `{ ${canary}`);
  const active = await request(f.explorer); assert.equal(active.stock.journeys, 0); assert.equal(active.stock.metadataUnavailable, true);
  const all = await request(f.explorer, 'cached', { scope: 'all' }); assert.equal(all.stock.journeys, 1); assert.ok(!JSON.stringify(all).includes(canary));
});
test('cached current stock becomes stale after local import and archive changes', async t => {
  const f = await fixture(t), record = await f.library.import(createDocument('A')); await f.explorer.attach(record.key);
  await request(f.explorer); await f.explorer.command('library-update', { key: record.key, metadataRevision: (await f.library.metadata()).revision, patch: { archived: true } });
  assert.equal((await request(f.explorer, 'cached')).stale, true);
});
test('large documents use sequential bounded pages and compact projections without rescanning a cached result', async t => {
  const f = await fixture(t), { document } = makeFixture(fixtureSpecs.find(spec => spec.nearBytes));
  for (let i = 0; i < 5; i++) await writeFile(join(f.directory, `${i}.explore.json`), JSON.stringify(document, null, 2));
  let result = await request(f.explorer); assert.equal(result.stock.examined, 3); assert.equal(result.stock.next, true);
  const storage = f.explorer.dashboard.storage, read = storage.read.bind(storage); let reads = 0, bytes = 0, active = 0, maximum = 0;
  storage.read = async (...args) => { reads++; maximum = Math.max(maximum, ++active); try { const result = await read(...args); bytes += Buffer.byteLength(result.text); return result; } finally { active--; } };
  result = await request(f.explorer, 'continue'); assert.equal(result.stock.examined, 5); assert.equal(result.stock.journeys, 1); assert.equal(result.stock.duplicates, 4);
  assert.equal(maximum, 1); assert.equal(reads, 2); assert.ok(bytes < 32 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(f.explorer.dashboard.scan.rows)) < 10000, 'retained cache contains compact numeric projections');
  await request(f.explorer, 'cached'); assert.equal(reads, 2, 'cached view does not read journeys');
});
test('canvas ownership adds one visit across repeated opens and reloads, another only after closing the owner', async t => {
  const f = await fixture(t), extension = explorerCanvas({ createCanvas: options => options, getSession: () => ({ sessionId: 'HOST_ID_MUST_NOT_BE_RETAINED', send: async () => {} }), directory: f.directory }); t.after(() => extension.close());
  const context = { sessionId: 'HOST_ID_MUST_NOT_BE_RETAINED', extensionId: 'test', canvasId: 'explorer', instanceId: 'RAW_INSTANCE', input: {} };
  const first = await extension.canvas.open(context), again = await extension.canvas.open(context); assert.equal(first.url, again.url);
  await fetch(first.url); await fetch(first.url);
  const get = async url => { const target = new URL('api/dashboard', url); const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: target.origin }, body: JSON.stringify({ action: 'cached', from: '', to: '', scope: 'all' }) }); return response.json(); };
  assert.equal((await get(first.url)).activity.days.reduce((sum, row) => sum + row.visits, 0), 1);
  await extension.canvas.onClose(context); const reopened = await extension.canvas.open(context);
  assert.equal((await get(reopened.url)).activity.days.reduce((sum, row) => sum + row.visits, 0), 2);
  const raw = await readFile(join(f.directory, 'analytics.json'), 'utf8'); assert.ok(!raw.includes('HOST_ID')); assert.ok(!raw.includes('RAW_INSTANCE'));
});
test('analytics recording failure does not fail saved answers and imports do not invent observed growth', async t => {
  const f = await fixture(t), file = join(f.directory, 'a.explore.json'), doc = createDocument('Original'); addQuestions(doc, doc.rootId, [{ question: 'Why?', category: 'Scope' }]); await writeFile(file, JSON.stringify(doc));
  const e = await new Explorer({ file }).load(); t.after(() => e.close()); e.startObservation(); await e.analytics.flush();
  e.analytics.write = async () => { throw new Error(canary); };
  await e.command('answer', { revision: 0, nodeId: doc.nodes[1].id, answer: canary, answerState: 'tentative' });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).nodes[1].answer, canary);
  const failed = await request(e); assert.ok(failed.activity.pending > 0); assert.ok(failed.activity.failures > 0);
  e.analytics.write = atomicWrite; await e.analytics.flush();
  const imported = createDocument('Imported'); addQuestions(imported, imported.rootId, [{ question: 'One?', category: 'Scope' }, { question: 'Two?', category: 'Scope' }]);
  await e.command('import', { revision: e.doc.revision, document: imported });
  const result = await request(e); assert.equal(result.activity.days.reduce((sum, row) => sum + row.commits, 0), 1);
  assert.equal(result.activity.days.reduce((sum, row) => sum + row.delta, 0), 0);
});
test('analytics storage count retention and queue bounds remain visible and history cleanup protects observations', async t => {
  const f = await fixture(t), { Analytics } = await import('../com.github.copilot/extensions/explorer/analytics.mjs'), now = Date.parse('2026-11-17T00:00:00Z');
  const events = Array.from({ length: 2000 }, (_, i) => ({ key: digest(String(i)), kind: 'visit', time: new Date(now - 1000 + i % 1000).toISOString() }));
  await writeFile(join(f.directory, 'analytics.json'), JSON.stringify({ version: 1, startedAt: events[0].time, failures: 0, dropped: 0, pruned: 0, events }));
  const store = new Analytics(f.directory, { now: () => now }); store.visit(); await store.flush();
  let result = await store.summary({ from: '', to: '' }); assert.equal(result.pruned, 1); assert.equal(result.days.reduce((sum, row) => sum + row.visits, 0), 2000);
  const inventory = await new StorageManagement(f.directory).inventory(); assert.equal(inventory.categories.analytics.files, 1); assert.equal(inventory.categories.usage.files, 0);
  const failing = new Analytics(f.directory, { now: () => now, write: async () => { throw new Error(); } });
  for (let i = 0; i < 150; i++) failing.visit(); await failing.flush();
  result = await failing.summary({ from: '', to: '' }); assert.equal(result.pending, 100); assert.equal(result.dropped, 50);
});
test('observations queued during a successful write drain without requiring another user action', async t => {
  const f = await fixture(t), { Analytics } = await import('../com.github.copilot/extensions/explorer/analytics.mjs');
  let release, entered; const started = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
  const store = new Analytics(f.directory, { write: async (file, text) => { entered(); await hold; return atomicWrite(file, text); } });
  store.visit(); await started; store.visit(); store.visit(); release(); await store.flush();
  assert.equal(JSON.parse(await readFile(join(f.directory, 'analytics.json'), 'utf8')).events.length, 3);
});
test('helper completion after a refresh marks cached receipts stale without rescanning', async t => {
  const f = await fixture(t); f.explorer.cleanup = { status: 'pending', abort: new AbortController() };
  await request(f.explorer); f.explorer.cleanup.status = 'proposal';
  assert.equal((await request(f.explorer, 'cached')).stale, true);
});
test('receipt discovery and failed reads have independent hard budgets and categorical errors', async t => {
  const f = await fixture(t), base = join(f.directory, 'usage', 'session-state'); await mkdir(base, { recursive: true });
  for (let i = 0; i < 520; i++) await writeFile(join(base, `unrecognized-${i}`), canary);
  const { readHelpers } = await import('../com.github.copilot/extensions/explorer/dashboard.mjs');
  let result = await readHelpers(f.directory); assert.equal(result.truncated, true); assert.equal(result.rows.length, 0); assert.equal(result.bytes, 0);
  const other = join(f.directory, 'other'), sessions = join(other, 'usage', 'session-state'); await mkdir(sessions, { recursive: true });
  for (let i = 0; i < 10; i++) await mkdir(join(sessions, randomUUID()));
  result = await readHelpers(other); assert.equal(result.truncated, true); assert.ok(result.bytes <= 64 * 1024 * 1024); assert.ok(result.unavailable > 0 && result.unavailable < 20); assert.ok(!JSON.stringify(result).includes(canary));
});
test('a held analytics lock cannot prevent the answer commit and retained retries recover after release', async t => {
  const f = await fixture(t), record = await f.library.import(createDocument('Locked')); await f.explorer.attach(record.key); f.explorer.startObservation(); await f.explorer.analytics.flush();
  const lock = await acquireLock(join(f.directory, 'analytics.json.lock'));
  try {
    await f.explorer.command('guidance', { revision: f.explorer.doc.revision, objective: 'Saved despite analytics lock', successCriteria: '' });
    const result = await request(f.explorer); assert.equal(f.explorer.doc.objective, 'Saved despite analytics lock'); assert.ok(result.activity.pending > 0); assert.ok(result.activity.failures > 0);
  } finally { await lock.release(); }
  await f.explorer.analytics.flush(); assert.equal((await request(f.explorer, 'cached')).activity.pending, 0);
});
