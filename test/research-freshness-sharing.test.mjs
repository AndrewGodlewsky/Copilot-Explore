import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDocument, addQuestions, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { viewerSnapshot, viewerArtifact, viewerDigest } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';
import { freshnessFindings, FRESHNESS_NOW } from './helpers/research-freshness.mjs';

test('offline sharing retains literal date observations and classifications with an explicit export-time assessment', () => {
  const doc = createDocument('Freshness'), [node] = addQuestions(doc, doc.rootId, [{ question: 'Current access?', category: 'Access' }]);
  node.research = freshnessFindings();
  node.research.sources[0].dateObservations.push({ kind: 'ambiguous', text: '<img src=x onerror=bad()> 中文 🌿' });
  const selection = [{ nodeId: node.id, answer: false, research: true }], snapshot = viewerSnapshot(doc, selection), before = structuredClone(snapshot);
  const input = { journey: doc.id, revision: doc.revision, selection }, digest = viewerDigest(input, snapshot);
  assert.deepEqual(snapshot.nodes[0].research.sources[0].dateObservations, node.research.sources[0].dateObservations);
  assert.deepEqual(snapshot.nodes[0].research.claims[0].freshness, node.research.claims[0].freshness);
  const artifact = viewerArtifact(snapshot, FRESHNESS_NOW + 86400000);
  assert.deepEqual(snapshot, before); assert.equal(viewerDigest(input, snapshot), digest);
  for (const id of [doc.id, node.id]) assert.equal(artifact.content.includes(id), false);
  const dom = new JSDOM(artifact.content, { runScripts: 'dangerously' });
  const body = dom.window.document.body.textContent;
  assert.match(body, /Evaluated as of 2026-11-21/); assert.match(body, /static export.*does not update/i);
  assert.match(body, /Recommendation needs evidence review/); assert.match(body, /Review needed/);
  assert.match(body, /Published: unknown; updated: unknown/); assert.match(body, /Retrieval time: 2026-11-20/);
  assert.match(body, /<img src=x onerror=bad\(\)> 中文 🌿/); assert.equal(dom.window.document.querySelector('img'), null);
  dom.window.close();
  const markdown = toMarkdown(doc);
  assert.match(markdown, /price availability/i); assert.match(markdown, /Published: unknown; updated: unknown/);
  assert.match(markdown, /ambiguous.*\\<img/);
});
