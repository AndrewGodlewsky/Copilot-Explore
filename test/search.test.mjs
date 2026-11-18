import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { Drafts, draftBase } from '../com.github.copilot/extensions/explorer/drafts.mjs';
import { createDocument, acceptQuestions, contextFor, toMarkdown, MAX_DOCUMENT_BYTES } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { matchSearch, searchFilters } from '../com.github.copilot/extensions/explorer/web/search.mjs';

function document(count = 3) {
  const doc = createDocument('Garden');
  for (let start = 0; start < count; start += 6) {
    const questions = Array.from({ length: Math.min(6, count - start) }, (_, i) => ({ question: `Café 🌱 ${start + i}`, category: 'People' }));
    Object.assign(doc, acceptQuestions(doc, doc.rootId, { id: `batch-${start}`, questions }, questions.map((q, index) => ({ index, question: q.question }))).document);
  }
  return doc;
}
async function fixture(t, doc = document()) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-search-'));
  t.after(async () => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); });
  const library = new Library(dir), record = await library.import(doc), drafts = new Drafts(dir);
  return { dir, library, record, drafts };
}
test('library node search combines saved state, importance, review, research and Unicode text', async t => {
  const doc = document();
  Object.assign(doc.nodes[1], { answer: '  provisional\n choice  ', answerState: 'tentative', importance: 'high', importanceReason: 'Consequential', review: true });
  const { library } = await fixture(t, doc);
  assert.equal(typeof library.search, 'function', 'bounded local node search is available');
  const result = await library.search({ query: '  CAFÉ   🌱 ', state: 'tentative', importance: 'high', review: true });
  assert.equal(result.results.length, 1); assert.equal(result.results[0].nodeId, doc.nodes[1].id);
  assert.equal((await library.search({ state: 'unanswered', importance: 'unranked' })).results.length, 2);
  assert.equal((await library.search({ state: 'decided' })).results.length, 0);
  assert.equal((await library.search({ research: true })).results.length, 0);
  assert.equal((await library.search({ query: 'provisional choice' })).results.length, 1);
  assert.equal((await library.search({ query: 'not present' })).results.length, 0);
});
test('private draft content requires opt-in, uses file identity and excludes tombstones and orphans', async t => {
  const { dir, library, record, drafts } = await fixture(t), [node, second] = record.document.nodes.slice(1);
  await drafts.update({ key: record.key, nodeId: node.id, base: draftBase(node), text: 'PRIVATE_CANARY 🌿', revision: 0 });
  await drafts.update({ key: record.key, nodeId: second.id, base: draftBase(second), text: null, revision: 0 });
  await drafts.update({ key: record.key, nodeId: 'removed-node', base: draftBase(node), text: 'ORPHAN_CANARY', revision: 0 });
  await writeFile(join(dir, 'duplicate.explore.json'), JSON.stringify(record.document));
  assert.equal(typeof library.search, 'function');
  assert.equal((await library.search({ query: 'PRIVATE_CANARY' })).results.length, 0);
  const presence = await library.search({ drafts: true });
  assert.equal(presence.results.length, 1); assert.equal(presence.results[0].key, record.key);
  assert.ok(!JSON.stringify(presence).includes('PRIVATE_CANARY'));
  const opted = await library.search({ query: 'PRIVATE_CANARY', draftText: true });
  assert.equal(opted.results.length, 1); assert.match(opted.results[0].snippet, /Private draft: PRIVATE_CANARY/);
  assert.equal((await library.search({ query: 'ORPHAN_CANARY', draftText: true })).results.length, 0);
});
test('bounded results resume inside long documents and reject changed source and query cursors', async t => {
  const { library, record } = await fixture(t, document(240));
  assert.equal(typeof library.search, 'function');
  const first = await library.search({ query: 'café' });
  assert.equal(first.results.length, 200); assert.ok(first.next);
  const second = await library.search({ query: 'café', cursor: first.next });
  assert.equal(second.results.length, 40); assert.equal(second.next, null);
  assert.equal(new Set([...first.results, ...second.results].map(r => r.nodeId)).size, 240);
  await assert.rejects(library.search({ query: 'other', cursor: first.next }), /changed|refresh/i);
  record.document.topic = record.document.nodes[0].question = 'Changed';
  await writeFile(record.file, JSON.stringify(record.document));
  await assert.rejects(library.search({ query: 'café', cursor: first.next }), /changed|refresh/i);
  assert.equal((await library.search({ query: 'Changed' })).results.length, 200);
});
test('archive scope is explicit, corrupt files isolated, search navigation checks content before switching', async t => {
  const { library, record, dir } = await fixture(t);
  assert.equal(typeof library.search, 'function');
  await writeFile(join(dir, 'broken.explore.json'), '{');
  const result = await library.search({ query: 'café' });
  assert.equal(result.results.length, 3); assert.equal(result.errors.length, 1);
  const explorer = await new Explorer({ library, binding: 'search-test', send: async () => {} }).load(); t.after(() => explorer.close());
  const server = await startServer(explorer); t.after(() => server.close());
  const origin = new URL(server.url).origin;
  const response = await fetch(new URL('api/search', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin }, body: JSON.stringify({ query: 'café' }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).results.length, 3);
  assert.equal((await fetch(new URL('api/search', server.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  await explorer.command('open', { key: record.key, searchResult: result.results[0] });
  const old = explorer.doc;
  record.document.topic = record.document.nodes[0].question = 'Different saved text';
  await writeFile(record.file, JSON.stringify(record.document));
  await assert.rejects(explorer.command('open', { key: record.key, revision: old.revision, searchResult: result.results[0] }), /changed|refresh/i);
  assert.equal(explorer.doc, old);
  await library.update(record.key, { archived: true }, (await library.metadata()).revision);
  assert.equal((await library.search({})).results.length, 0);
  assert.equal((await library.search({ archived: true })).results.length, 4);
  await rm(record.file);
  assert.equal((await library.search({ archived: true })).results.length, 0);
});

test('draft conflicts and state-only drafts do not affect saved-state filtering or portable/AI content', async t => {
  const { library, record, drafts } = await fixture(t), [first, second] = record.document.nodes.slice(1);
  await drafts.update({ key: record.key, nodeId: first.id, base: draftBase(first), text: 'CONFLICT_CANARY', answerState: 'assumption', revision: 0 });
  await drafts.update({ key: record.key, nodeId: second.id, base: draftBase(second), text: '', answerState: 'revisit-later', revision: 0 });
  first.answer = 'Saved decision'; first.answerState = 'decided'; await writeFile(record.file, JSON.stringify(record.document));
  assert.equal((await library.search({ drafts: true })).results.length, 2);
  assert.equal((await library.search({ drafts: true, state: 'decided', draftText: true, query: 'CONFLICT_CANARY' })).results.length, 1);
  assert.equal((await library.search({ drafts: true, state: 'assumption' })).results.length, 0);
  assert.equal((await library.search({ drafts: true, state: 'unanswered' })).results.length, 1);
  assert.ok(!toMarkdown(record.document).includes('CANARY')); assert.ok(!JSON.stringify(contextFor(record.document, first.id)).includes('CANARY'));
});

test('shared matcher handles legacy states, Unicode normalization, all filters and plain text snippets', () => {
  const node = { id: 'n', parentId: 'root', question: 'CAFE\u0301 🌱 <img onerror=bad>', category: 'People', answer: 'Legacy answer', review: true, research: {}, importance: 'high', revisit: { date: '2026-11-16', condition: 'HIDDEN_CONDITION', acknowledgedAt: null } };
  const filters = searchFilters({ query: ' café   🌱 ', state: 'tentative', review: true, research: true, importance: 'high', drafts: true, reminder: 'overdue', today: '2026-11-17' });
  assert.ok(matchSearch(node, filters, { draft: '' }));
  for (const patch of [{ state: 'unanswered' }, { importance: 'unranked' }]) {
    assert.equal(matchSearch(node, searchFilters({ ...filters, ...patch }), { draft: '' }), null);
  }
  assert.equal(matchSearch(node, searchFilters({ query: 'HIDDEN_CONDITION' })), null);
  assert.equal(matchSearch({ ...node, parentId: null }, searchFilters({ state: 'tentative' })), null);
  assert.throws(() => searchFilters({ query: 'x'.repeat(4001) }), /Invalid/);
  assert.throws(() => searchFilters({ draftText: 'true' }), /Invalid/);
});

test('matching snippets retain the actual hit after long original whitespace', () => {
  const source = 'Context' + ' '.repeat(300) + 'TaRGeT Cafe\u0301 🌱';
  const result = matchSearch({ parentId: 'root', question: 'Other', answer: source }, searchFilters({ query: 'target café' }));
  assert.match(result.snippet, /TaRGeT Cafe\u0301 🌱/);
  const excerpt = result.snippet.replace(/^Saved answer: …?/, '').replace(/…$/, '');
  assert.ok(source.includes(excerpt)); assert.ok(Array.from(excerpt).length <= 180);
});

test('matching snippets preserve original case and Unicode while searching normalized text', () => {
  const source = 'Lea\u0301d 👩‍🌾 İ '.repeat(30) + 'US_API Cafe\u0301 🌱\n  MiXeD_Case <tag>';
  const node = { parentId: 'root', question: 'Question', answer: source, category: 'People' };
  const match = matchSearch(node, searchFilters({ query: 'us_api café 🌱 mixed_case' }));
  assert.ok(match); assert.match(match.snippet, /US_API Cafe\u0301 🌱\n  MiXeD_Case <tag>/);
  assert.ok(source.includes(match.snippet.replace(/^Saved answer: …?/, '').replace(/…$/, '')), 'excerpt consists of unchanged source characters');
  assert.equal(node.answer, source);
});

test('corrupt private drafts leave saved matches visible with explicit coverage and scans are single-flight', async t => {
  const { library, dir } = await fixture(t);
  await writeFile(join(dir, 'drafts.json'), '{');
  const ordinary = await library.search({ query: 'café' }); assert.equal(ordinary.results.length, 3); assert.equal(ordinary.errors.length, 0);
  const opted = await library.search({ query: 'café', draftText: true }); assert.equal(opted.results.length, 3); assert.match(opted.errors[0].message, /incomplete/);
  const first = library.search({}); await assert.rejects(library.search({}), /still running/); await first;
});

test('file-count and discovery bounds expose partial coverage and continuation without caching documents', async t => {
  const { library, dir, record } = await fixture(t, createDocument('Small saved journey'));
  for (let i = 0; i < 20; i++) await writeFile(join(dir, `copy-${i}.explore.json`), JSON.stringify({ ...record.document, id: `copy-${i}` }));
  const first = await library.search({ query: 'Small' });
  assert.equal(first.examined, 16); assert.equal(first.results.length, 16); assert.ok(first.next);
  const second = await library.search({ query: 'Small', cursor: first.next });
  assert.equal(second.results.length, 5); assert.equal(second.next, null);
  for (const cursor of [{ ...first.next, node: -1 }, { ...first.next, file: 2000 }, { ...first.next, extra: true }, { ...first.next, node: 1, source: null }]) await assert.rejects(library.search({ query: 'Small', cursor }), /changed|refresh/i);
  await writeFile(join(dir, 'new.explore.json'), JSON.stringify({ ...record.document, id: 'new' }));
  await assert.rejects(library.search({ query: 'Small', cursor: first.next }), /changed|refresh/i);
  for (let i = 0; i < 2001; i++) await writeFile(join(dir, `irrelevant-${i}.txt`), '');
  const bounded = await library.search({}); assert.equal(bounded.truncated, true); assert.ok(bounded.discovered <= 2000);
});

test('document reads stay under the page byte allowance with large nonmatching maps and isolate oversize files', async t => {
  const doc = document(280); for (const node of doc.nodes.slice(1)) node.answer = 'x'.repeat(20000);
  const { library, dir, record } = await fixture(t, doc);
  for (let i = 0; i < 5; i++) await writeFile(join(dir, `large-${i}.explore.json`), JSON.stringify({ ...record.document, id: `large-${i}` }));
  const page = await library.search({ query: 'NONMATCH' }); assert.equal(page.results.length, 0); assert.ok(page.bytes <= 32 * 1024 * 1024); assert.ok(page.next); assert.ok(page.examined < 6);
  await writeFile(join(dir, 'a-oversized.explore.json'), ' '.repeat(MAX_DOCUMENT_BYTES + 1));
  assert.ok((await library.search({ query: 'NONMATCH' })).errors.length);
});

test('failed document reads still consume the actual page byte budget', async t => {
  const doc = document(280); for (const node of doc.nodes.slice(1)) node.answer = 'x'.repeat(20000);
  const { library, dir, record } = await fixture(t, doc);
  for (let i = 0; i < 7; i++) await writeFile(join(dir, `failure-${i}.explore.json`), JSON.stringify({ ...record.document, id: `failure-${i}` }));
  const probe = await open(record.file, 'r'), prototype = Object.getPrototypeOf(probe), read = prototype.read; await probe.close();
  const seen = new WeakSet(); let bytesRead = 0;
  t.mock.method(prototype, 'read', async function (...args) {
    if (seen.has(this)) throw new Error('Simulated I/O failure after a successful partial read');
    seen.add(this); const result = await read.apply(this, args); bytesRead += result.bytesRead; return result;
  });
  const result = await library.search({ query: 'NONMATCH' });
  assert.ok(result.errors.length); assert.ok(bytesRead <= 32 * 1024 * 1024, `failed reads consumed ${bytesRead} bytes`);
  assert.equal(result.bytes, bytesRead); assert.ok(result.next);
});
