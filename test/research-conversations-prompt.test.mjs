import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const base = 'com.github.copilot/extensions/explorer/';
const { createDocument, addQuestions } = await import(pathToFileURL(resolve(base + 'model.mjs')));
const { prepareFollowup, parseFollowup } = await import(pathToFileURL(resolve(base + 'research-followup.mjs')));

test('a long retained display history sends only four whole exchanges and declares every omission', () => {
  const doc = createDocument('Private discussion'); addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Choice' }]);
  const node = doc.nodes[1];
  node.research = { basis: 'reasoning', summary: 'Compare', options: [{ title: 'Pilot', description: 'Small', pros: [], cons: [] }, { title: 'Launch', description: 'Large', pros: [], cons: [] }], recommendation: 'Pilot first', uncertainty: 'Unknown costs', sources: [], claims: [] };
  const source = { id: 's1', title: 'Old source', url: 'https://example.test/old', provenance: 'imported', retrievedAt: null, evidenceOrigin: { origin: 'original', sourceId: 's1' } };
  const exchanges = Array.from({ length: 20 }, (_, index) => ({ id: randomUUID(), question: `Question ${index}`, hypothetical: false, sourceMode: 'existing', result: { answer: `Answer ${index}`, uncertainty: 'Historical', claims: [], sources: index === 0 ? [source] : [] } }));
  const prepared = prepareFollowup(doc, node.id, { question: 'What is unclear?', hypothetical: false }, { history: { id: randomUUID(), exchanges, dropped: 5 } });
  assert.deepEqual(prepared.followup.exchanges.map(item => item.id), exchanges.slice(-4).map(item => item.id));
  assert.equal(prepared.followup.coverage.exchangesIncluded, 4); assert.equal(prepared.followup.coverage.exchangesOmitted, 16); assert.equal(prepared.followup.coverage.previouslyDropped, 5);
  assert.equal(prepared.prompt.includes(exchanges[0].id), false);
  assert.throws(() => parseFollowup(JSON.stringify({ answer: 'Cannot use excluded evidence', uncertainty: 'Unknown', claims: [], sources: [{ id: 's1', prior: { origin: exchanges[0].id, sourceId: 's1' } }] }), prepared, new Map()), /not included/i);
  assert.equal(exchanges.length, 20);
});
