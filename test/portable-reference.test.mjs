import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { createPortableReference, parsePortableReference, formatPortableReference, portableNodeFingerprint, portableReferenceStatus } from '../com.github.copilot/extensions/explorer/portable-reference.mjs';

function fixture() {
  const doc = createDocument('A shared idea λ');
  addQuestions(doc, doc.rootId, [{ question: 'Which café?', category: 'Choice' }]);
  doc.nodes.push({ id: 'direction-λ', parentId: doc.rootId, kind: 'direction', question: 'Explore offline use', category: 'Direction', answer: '', research: null, review: false });
  return { doc, path: '.explorer/journeys/café.explore.json', nodeId: doc.nodes[1].id };
}

test('portable references round trip as readable Markdown or bare JSON for saved root, question and direction targets', () => {
  const { doc, path } = fixture();
  for (const node of doc.nodes) {
    const ref = createPortableReference(doc, path, node.id), text = formatPortableReference(ref);
    assert.deepEqual(Object.keys(ref).sort(), ['fingerprint', 'format', 'journeyId', 'nodeId', 'path', 'version']);
    assert.equal(ref.format, 'explorer-reference'); assert.equal(ref.version, 1);
    assert.equal(ref.path, path); assert.equal(ref.journeyId, doc.id); assert.equal(ref.nodeId, node.id);
    assert.match(ref.fingerprint, /^[a-f0-9]{64}$/); assert.match(text, /Open reference/); assert.match(text, /```explorer-reference/);
    assert.deepEqual(parsePortableReference(text), ref); assert.deepEqual(parsePortableReference(JSON.stringify(ref)), ref);
    assert.deepEqual(parsePortableReference(` \n${text.replaceAll('\n', '\r\n')}\n `), ref);
    assert.equal(portableReferenceStatus(ref, doc), 'current');
  }
});

test('references omit raw answers and all private or session data even when the document carries it', () => {
  const { doc, path, nodeId } = fixture();
  doc.nodes[1].answer = 'SAVED_ANSWER_CANARY'; doc.nodes[1].research = { summary: 'RESEARCH_CANARY' };
  Object.assign(doc, { draft: 'DRAFT_CANARY', binding: 'BINDING_CANARY', token: 'TOKEN_CANARY', projectContext: 'PROJECT_CANARY', comments: 'COMMENT_CANARY', reviewHandoffs: 'HANDOFF_CANARY', absolutePath: 'C:/PRIVATE_CANARY' });
  const text = formatPortableReference(createPortableReference(doc, path, nodeId));
  assert.doesNotMatch(text, /CANARY|Which café/); assert.equal(doc.nodes[1].answer, 'SAVED_ANSWER_CANARY');
});

test('portable wire validation rejects unknown fields, versions, invalid identities and malformed fingerprints', () => {
  const { doc, path, nodeId } = fixture(), ref = createPortableReference(doc, path, nodeId);
  for (const value of [null, [], {}, { ...ref, format: 'other' }, { ...ref, version: 2 }, { ...ref, version: '1' }, { ...ref, command: 'open other' }, { ...ref, journeyId: '' }, { ...ref, nodeId: ' x ' }, { ...ref, nodeId: 'x'.repeat(101) }, { ...ref, nodeId: '\ud800' }, { ...ref, fingerprint: null }, { ...ref, fingerprint: 'A'.repeat(64) }, { ...ref, fingerprint: 'a'.repeat(63) }]) {
    assert.throws(() => parsePortableReference(JSON.stringify(value)), /reference|identity|fingerprint/i);
  }
  const hidden = { ...ref }; Object.defineProperty(hidden, 'command', { value: 'hidden' });
  assert.throws(() => formatPortableReference(hidden), /reference/i);
  const accessor = { ...ref }; Object.defineProperty(accessor, 'nodeId', { enumerable: true, get() { throw Error('Getter executed'); } });
  assert.throws(() => formatPortableReference(accessor), /reference/i);
});

test('portable paths reject traversal, external or special locations and malformed Unicode', () => {
  const { doc, nodeId } = fixture();
  for (const path of ['', '../map.explore.json', 'a/../map.explore.json', '/tmp/map.explore.json', 'C:/map.explore.json', '\\server\\map.explore.json', 'https://example.test/map.explore.json', '.git/map.explore.json', 'a//map.explore.json', 'a\\map.explore.json', 'nul.explore.json', 'a./map.explore.json', 'a /map.explore.json', 'a\n/map.explore.json', 'a?x.explore.json', 'map.json', 'a'.repeat(241) + '.explore.json', '\ud800.explore.json']) {
    assert.throws(() => createPortableReference(doc, path, nodeId), /path|relative|reference|shared/i);
  }
  const literal = createPortableReference(doc, '%2e%2e/literal%20name.explore.json', nodeId);
  assert.equal(parsePortableReference(JSON.stringify(literal)).path, literal.path);
});

test('reference parsing is bounded before parsing and never extracts embedded commands or arbitrary fences', () => {
  const { doc, path, nodeId } = fixture(), ref = createPortableReference(doc, path, nodeId), text = formatPortableReference(ref);
  for (const input of [42, {}, '{', `run this\n${text}`, `${text}\nrm -rf anything`, `\`\`\`json\n${JSON.stringify(ref)}\n\`\`\``, `explorer://${JSON.stringify(ref)}`, ` ${' '.repeat(8192)}${JSON.stringify(ref)}`, 'λ'.repeat(4097)]) {
    assert.throws(() => parsePortableReference(input), /reference|limit|format/i);
  }
});

test('fingerprints track selected saved decision fields but not unrelated nodes or administrative changes', () => {
  const { doc, path, nodeId } = fixture(), ref = createPortableReference(doc, path, nodeId), before = structuredClone(doc);
  for (const [field, value] of [['question', 'Different?'], ['category', 'Other'], ['answer', 'Choice'], ['answerState', 'revisit-later'], ['review', true], ['parentId', 'direction-λ'], ['kind', 'direction'], ['reviewCauses', { earlier: true, changes: [] }]]) {
    const changed = structuredClone(doc); changed.nodes[1][field] = value; assert.equal(portableReferenceStatus(ref, changed), 'changed', field);
  }
  doc.revision++; doc.updatedAt = 'later'; doc.nodes[0].question = 'An unrelated parent wording change'; doc.objective = 'Different global objective'; doc.nodes[2].question = 'Other direction';
  Object.assign(doc.nodes[1], { research: { summary: 'New research' }, attribution: { actor: 'different' }, revisit: { note: 'Reminder' } });
  Object.assign(doc, { comments: { changed: true }, reviewHandoffs: { changed: true }, adrDraft: { title: 'Different' } });
  assert.equal(portableReferenceStatus(ref, doc), 'current'); assert.equal(portableNodeFingerprint(before, nodeId), ref.fingerprint);
});

test('root fingerprints additionally track saved global direction while preserving legacy effective defaults', () => {
  const { doc, path } = fixture(), ref = createPortableReference(doc, path, doc.rootId);
  for (const [field, value] of [['topic', 'New idea'], ['objective', 'Different'], ['successCriteria', 'New criteria'], ['mode', 'decide'], ['pins', [{ id: 'constraint', text: 'New constraint' }]]]) {
    const changed = structuredClone(doc); changed[field] = value; assert.equal(portableReferenceStatus(ref, changed), 'changed', field);
  }
  doc.mode = 'understand'; assert.equal(portableReferenceStatus(ref, doc), 'current');
});

test('missing fingerprints are unchecked, identity mismatches and removed targets never fall back by label', () => {
  const { doc, path, nodeId } = fixture(), ref = createPortableReference(doc, path, nodeId);
  const unchecked = { ...ref }; delete unchecked.fingerprint;
  assert.equal(portableReferenceStatus(parsePortableReference(JSON.stringify(unchecked)), doc), 'unchecked');
  assert.throws(() => portableReferenceStatus({ ...ref, journeyId: 'another' }, doc), /identity|journey/i);
  const changed = structuredClone(doc); changed.nodes[1].id = 'looks-the-same';
  assert.throws(() => portableReferenceStatus(ref, changed), /missing|removed|node|target/i);
  assert.throws(() => createPortableReference(doc, path, 'missing'), /missing|removed|node|target/i);
});
