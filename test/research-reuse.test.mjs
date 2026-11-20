import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareFollowup, retainExchanges } from '../com.github.copilot/extensions/explorer/research-followup.mjs';
import { createReuseRecord, reusableFollowup, reuseNamespace, REUSE_TTL } from '../com.github.copilot/extensions/explorer/research-reuse.mjs';

const at = Date.parse('2026-11-20T12:00:00Z');
const original = { basis: 'reasoning', summary: 'Compare', options: [{ title: 'Pilot', description: 'Small', pros: [], cons: [] }, { title: 'Launch', description: 'Large', pros: [], cons: [] }], recommendation: 'Pilot first', uncertainty: 'Unknown costs', sources: [], claims: [{ id: 'c1', text: 'Start small', basis: 'reasoning', evidence: [], limitations: 'Judgment' }] };
const result = { answer: 'A smaller pilot tests the assumption.', uncertainty: 'Synthetic reasoning; not fresh verification.', sources: [], claims: original.claims };
function fixture(count = 0) {
  const doc = createDocument('Synthetic garden'); addQuestions(doc, doc.rootId, [{ question: 'How big?', category: 'Size' }]); doc.nodes[1].research = structuredClone(original);
  const nodeId = doc.nodes[1].id, input = { question: 'Why a pilot? 🌿', hypothetical: true };
  const namespace = reuseNamespace({ root: { path: 'C:/synthetic/project', ancestors: '1:2:3' }, binding: 'canvas-session', file: 'C:/synthetic/map.json', journey: doc.id });
  const modelCapture = { mode: 'chat', revision: 0, model: { id: 'fixture' }, account: { isAuthenticated: true, login: 'synthetic', host: 'github.com' } };
  const options = { namespace, modelCapture, scope: 'decisions', excluded: [], now: at };
  const before = count ? { id: randomUUID(), dropped: 0, exchanges: Array.from({ length: count }, (_, i) => ({ id: randomUUID(), question: `Earlier ${i}`, hypothetical: false, result })) } : null;
  const prepared = { ...prepareFollowup(doc, nodeId, input, { ...options, history: before }), preparedAt: at, reuseNamespace: namespace, reusePolicy: { scope: options.scope, excluded: [] }, modelCapture };
  const exchange = { id: randomUUID(), ...input, result: structuredClone(result) };
  const all = [...before?.exchanges ?? [], exchange], exchanges = retainExchanges(all);
  const history = { id: randomUUID(), nodeId, journey: doc.id, dependencies: prepared.followupDependencies, exchanges, dropped: all.length - exchanges.length, reuse: createReuseRecord(prepared, exchange, at + 1000) };
  const candidate = (changes = {}) => reusableFollowup(doc, nodeId, input, { ...options, history, now: at + 2000, ...changes });
  return { doc, nodeId, input, options, prepared, exchange, history, candidate };
}

test('a different selected profile or altered exchange provenance cannot reuse an answer', () => {
  const f = fixture(), profile = { id: 'product-service', version: 1 };
  assert.ok(f.candidate());
  assert.equal(f.candidate({ settings: { ...f.prepared.settings, profile } }), null);
  f.exchange.profile = profile;
  assert.equal(f.candidate(), null, 'changing provenance invalidates the private result hash');
});

test('exact completed follow-up reuses original exchange and dates without retaining another prompt', () => {
  for (const count of [0, 1, 2, 3]) {
    const f = fixture(count), before = JSON.stringify(f.history), candidate = f.candidate();
    assert.deepEqual(candidate, { exchangeId: f.exchange.id, completedAt: new Date(at + 1000).toISOString(), expiresAt: at + 1000 + REUSE_TTL });
    assert.equal(JSON.stringify(f.history), before);
    assert.ok(Buffer.byteLength(JSON.stringify(f.history.reuse)) < 512);
    assert.ok(!JSON.stringify(f.history.reuse).includes(f.input.question));
  }
  assert.equal(fixture(4).candidate(), null, 'evicted predecessor cannot be reconstructed');
});

test('keys reject changed question, hypothetical, model, scope, source policy, constraints and identity', () => {
  const f = fixture();
  for (const input of [{ ...f.input, question: f.input.question + ' ' }, { ...f.input, hypothetical: false }]) assert.equal(reusableFollowup(f.doc, f.nodeId, input, { ...f.options, history: f.history, now: at + 2000 }), null);
  for (const changes of [{ namespace: 'f'.repeat(64) }, { namespace: null }, { scope: 'path' }, { excluded: [f.nodeId] }, { settings: { depth: 'deeper', sourceFocus: 'primary', recency: 'any' } },
    { settings: { depth: 'standard', sourceFocus: 'primary', recency: 'any' } }, { settings: { depth: 'standard', sourceFocus: 'balanced', recency: 'recent' } },
    { modelCapture: { ...f.options.modelCapture, revision: 1 } }, { modelCapture: { ...f.options.modelCapture, account: { ...f.options.modelCapture.account, login: 'another' } } },
    { modelCapture: { ...f.options.modelCapture, model: { id: 'another-version' } } }]) assert.equal(f.candidate(changes), null);
  f.doc.nodes[0].question += ' New version constraint'; assert.equal(f.candidate(), null);
  const namespaces = ['binding', 'file', 'journey'].map(key => reuseNamespace({ root: { path: 'C:/synthetic/project', ancestors: '1:2:3' }, binding: 'canvas-session', file: 'C:/synthetic/map.json', journey: 'same', [key]: 'changed-' + key }));
  assert.equal(new Set(namespaces).size, 3);
  assert.notEqual(reuseNamespace({ root: { path: 'C:/synthetic/project', ancestors: 'different' }, binding: 'canvas-session', file: 'C:/synthetic/map.json', journey: f.doc.id }), f.options.namespace);
});

test('bounded reuse rejects expiration, changed UTC date, backwards clocks, corrupt versions and receipts', () => {
  const f = fixture();
  for (const now of [NaN, Infinity, at - 1, at + 1000 + REUSE_TTL, Date.parse('2026-11-21T00:00:00Z')]) assert.equal(f.candidate({ now }), null);
  for (const patch of [{ version: 999 }, { freshnessVersion: 999 }, { exchangeId: randomUUID() }, { resultHash: '0'.repeat(64) }, { inputHash: '0'.repeat(64) }, { preparedAt: at + 99999 }]) {
    assert.equal(f.candidate({ history: { ...f.history, reuse: { ...f.history.reuse, ...patch } } }), null);
  }
  assert.equal(f.candidate({ history: { ...f.history, historical: true } }), null);
  assert.equal(f.candidate({ history: { ...f.history, exchanges: [] } }), null);
  const late = { ...f.prepared, preparedAt: Date.parse('2026-11-20T23:59:50Z') };
  assert.equal(createReuseRecord(late, f.exchange, Date.parse('2026-11-21T00:00:01Z')), null);
});

test('changed result and expired or undated time-sensitive claims cannot become a reuse hit', () => {
  const f = fixture(); f.history.exchanges[0].result.answer = 'Tampered answer'; assert.equal(f.candidate(), null);
  for (const type of ['product-version', 'evolving-guidance', 'price-availability']) {
    const g = fixture(); g.exchange.result.claims = [{ ...g.exchange.result.claims[0], freshness: { type, version: null, reason: 'Needs current sources.' } }];
    g.history.exchanges = [g.exchange]; g.history.reuse = createReuseRecord(g.prepared, g.exchange, at + 1000);
    assert.equal(g.candidate(), null, type);
  }
  assert.equal(createReuseRecord({ ...f.prepared, reuseNamespace: null }, f.exchange, at + 1000), null);
});

test('already expired input evidence cannot be reused even when its freshness state has not changed', () => {
  const f = fixture();
  f.doc.nodes[1].research.claims[0].freshness = { type: 'product-version', version: null, reason: 'Current support is unknown.' };
  const prepared = { ...prepareFollowup(f.doc, f.nodeId, f.input, f.options), preparedAt: at, reuseNamespace: f.options.namespace, reusePolicy: f.prepared.reusePolicy, modelCapture: f.options.modelCapture };
  assert.equal(createReuseRecord(prepared, f.exchange, at + 1000), null, 'reasoning output does not make stale input current');
});

test('a saved research-stale marker prevents reuse even when retained research bytes match', () => {
  const f = fixture(); assert.ok(f.candidate()); f.doc.nodes[1].researchStale = true;
  assert.equal(f.candidate(), null);
});

test('reused named-version evidence preserves imported provenance and its original old date', () => {
  const f = fixture();
  const source = { id: 's1', title: 'Archived version', url: 'https://example.com/v1', retrievedAt: '2020-01-01T00:00:00.000Z', provenance: 'imported', evidenceOrigin: { origin: 'original', sourceId: 's1' } };
  f.exchange.result.sources = [source]; f.exchange.result.claims = [{ id: 'c1', text: 'Version1 behavior.', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Archived specification.' }], limitations: 'Not current compatibility.', freshness: { type: 'named-version', version: 'v1', reason: 'Historical version only.' } }];
  f.history.exchanges = [f.exchange]; f.history.reuse = createReuseRecord(f.prepared, f.exchange, at + 1000);
  const before = JSON.stringify(f.history.exchanges); assert.ok(f.candidate()); assert.equal(JSON.stringify(f.history.exchanges), before);
  assert.deepEqual(f.history.exchanges[0].result.sources[0], source);
  f.exchange.result.claims[0].freshness.version = 'v2'; assert.equal(f.candidate(), null);
});
