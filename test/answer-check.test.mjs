import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareAnswerCheck, parseAnswerCheck, validateCheck, captureCheck, checkFreshness } from '../com.github.copilot/extensions/explorer/answer-check.mjs';
import { prepareBrief, parseBrief, acceptBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

function fixture() {
  const doc = createDocument('Choose a route');
  const [a, b] = addQuestions(doc, doc.rootId, [{ question: 'Route A?', category: 'Routes' }, { question: 'Route B?', category: 'Routes' }]);
  a.answer = 'Use route A'; a.answerState = 'decided'; b.answer = 'Use route B'; b.answerState = 'decided';
  return doc;
}
const ref = id => ({ kind: 'node', id });
const output = doc => ({ findings: [{ id: 'routes', category: 'possible-tension', explanation: 'The saved choices may compete for the same route.', resolution: 'Compare their intended scope with the owner.', sources: [ref(doc.nodes[1].id), ref(doc.nodes[2].id)] }] });
const request = explorer => ({ id: randomUUID(), journey: explorer.doc.id });
async function makeExplorer(t, helper) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-check-')), file = join(dir, 'map.explore.json'), doc = fixture();
  await writeFile(file, JSON.stringify(doc));
  const explorer = await new Explorer({ file, send() { throw Error('No main-chat send'); }, checkHelper: helper }).load();
  t.after(async () => { await explorer.close(); await rm(dir, { recursive: true, force: true }); });
  return explorer;
}
test('bounded context captures exact sent inputs and excludes drafts, research and previous brief', () => {
  const doc = fixture(); doc.nodes[1].research = { private: 'not sent' }; doc.nodes[1].rationale = 'PRIVATE'; doc.brief = { private: 'not sent' };
  const prepared = prepareAnswerCheck(doc), dependencies = captureCheck(prepared);
  assert.equal(prepared.context.targetId, doc.rootId);
  assert.equal(prepared.bytes, Buffer.byteLength(prepared.instructions) + Buffer.byteLength(prepared.prompt));
  assert.ok(prepared.bytes <= 131072); assert.ok(prepared.prompt.includes('Use route A')); assert.ok(!prepared.prompt.includes('PRIVATE'));
  assert.equal(dependencies.records.length, 3); assert.ok(checkFreshness(dependencies, doc));
  const changed = structuredClone(doc); changed.nodes[2].answer = 'Use route C'; assert.equal(checkFreshness(dependencies, changed), false);
  const unrelated = structuredClone(doc); unrelated.nodes[1].research = { private: 'updated' }; unrelated.brief = { other: 'accepted' }; assert.ok(checkFreshness(dependencies, unrelated));
});
test('strict findings validate categories, IDs, text, references and size; compatible empty result is valid', () => {
  const doc = fixture(), prepared = prepareAnswerCheck(doc), raw = output(doc);
  assert.deepEqual(parseAnswerCheck('{"findings":[]}', prepared), { findings: [] });
  assert.equal(parseAnswerCheck(JSON.stringify(raw), prepared).findings[0].explanation, raw.findings[0].explanation);
  for (const mutate of [v => v.extra = true, v => v.findings.push(v.findings[0]), v => v.findings[0].category = 'proven',
    v => v.findings[0].explanation = ' ', v => v.findings[0].resolution = 'x'.repeat(1001), v => v.findings[0].sources = [],
    v => v.findings[0].sources.push(ref('missing')), v => v.findings[0].sources.push(ref(doc.nodes[1].id)),
    v => v.findings[0].sources = [{ kind: 'guidance', field: 'invalid' }], v => v.findings[0].sources[0].extra = true,
    v => v.findings[0].id = 'bad id', v => v.findings = Array(13).fill(v.findings[0])]) {
    const value = structuredClone(raw); mutate(value); assert.throws(() => validateCheck(value, prepared), /Invalid answer check/);
  }
  for (const value of ['broken', ' '.repeat(256 * 1024 + 1)]) assert.throws(() => parseAnswerCheck(value, prepared), /Invalid answer check/);
  const guidance = structuredClone(raw); guidance.findings[0].sources = [{ kind: 'guidance', field: 'pins' }];
  assert.deepEqual(parseAnswerCheck(JSON.stringify(guidance), prepared).findings[0].sources, guidance.findings[0].sources);
});
test('tentative alternatives are unresolved choices, while two decided sources remain a possible tension', () => {
  const doc = fixture(); assert.equal(parseAnswerCheck(JSON.stringify(output(doc)), prepareAnswerCheck(doc)).findings[0].category, 'possible-tension');
  doc.nodes[2].answerState = 'tentative'; assert.equal(parseAnswerCheck(JSON.stringify(output(doc)), prepareAnswerCheck(doc)).findings[0].category, 'unresolved-choice');
  doc.nodes[2].answerState = 'decided'; doc.nodes[2].review = true; assert.equal(parseAnswerCheck(JSON.stringify(output(doc)), prepareAnswerCheck(doc)).findings[0].category, 'unresolved-choice');
});
test('HTTP results and dismissals are transient, source edits stale them, unrelated brief updates preserve them', async t => {
  const explorer = await makeExplorer(t, { async run(prepared) { return parseAnswerCheck(JSON.stringify(output(explorer.doc)), prepared); }, close() {} });
  const server = await startServer(explorer, { close() {} }); t.after(() => server.close());
  const post = (data, origin = new URL(server.url).origin) => fetch(server.url + 'api/check-answers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: origin }, body: JSON.stringify(data) });
  const req = request(explorer), original = structuredClone(explorer.doc.nodes);
  assert.equal((await post({ ...req, action: 'start' }, '')).status, 403);
  assert.equal((await post({ ...req, action: 'start', extra: true })).status, 400);
  await explorer.checkRequest({ ...req, action: 'start' }); await explorer.toolFreeTask;
  let result = await explorer.checkRequest({ ...req, action: 'poll' }); assert.equal(result.status, 'result'); assert.equal(result.findings.length, 1);
  assert.deepEqual(explorer.doc.nodes, original); assert.ok(!JSON.stringify(explorer.snapshot()).includes('possible-tension'));
  result = await post({ ...req, action: 'dismiss', findingId: 'routes' }).then(r => r.json()); assert.deepEqual(result.dismissed, ['routes']);
  const otherCanvas = structuredClone(explorer.doc);
  otherCanvas.brief = acceptBrief(parseBrief(JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] }), prepareBrief(otherCanvas)), []);
  otherCanvas.revision++; await writeFile(explorer.file, JSON.stringify(otherCanvas));
  result = await explorer.checkRequest({ ...req, action: 'poll' }); assert.equal(result.status, 'result'); assert.deepEqual(result.dismissed, ['routes']);
  const changed = JSON.parse(await readFile(explorer.file, 'utf8')); changed.nodes[2].answer = 'Edited source'; await writeFile(explorer.file, JSON.stringify(changed));
  result = await explorer.checkRequest({ ...req, action: 'poll' }); assert.equal(result.status, 'stale'); assert.equal(result.findings, undefined);
  assert.equal((await post({ ...req, action: 'dismiss', findingId: 'routes' })).status, 400);
});
test('cancelled, replaced and late results cannot overwrite current check; shared slot waits for release', async t => {
  let release, calls = 0; const explorer = await makeExplorer(t, { run(prepared) {
    calls++; if (calls === 1) return new Promise(resolve => { release = () => resolve(parseAnswerCheck(JSON.stringify(output(explorer.doc)), prepared)); });
    return Promise.resolve(parseAnswerCheck('{"findings":[]}', prepared));
  }, close() {} });
  const one = request(explorer), two = request(explorer);
  await explorer.checkRequest({ ...one, action: 'start' }); await new Promise(setImmediate);
  assert.equal(calls, 1);
  await explorer.checkRequest({ ...one, action: 'cancel' });
  await explorer.checkRequest({ ...two, action: 'start' }); assert.equal(calls, 1);
  release(); await explorer.toolFreeTask;
  assert.equal(calls, 2); assert.equal((await explorer.checkRequest({ ...one, action: 'poll' })).status, 'idle');
  assert.deepEqual((await explorer.checkRequest({ ...two, action: 'poll' })).findings, []);
  explorer.unconfirmedToolFreeRelease = {}; await assert.rejects(explorer.checkRequest({ ...request(explorer), action: 'start' }), /shutdown/);
});
test('pending check and decision brief require explicit cancellation before another tool-free operation', async t => {
  let release; const explorer = await makeExplorer(t, { run(prepared) { return new Promise(resolve => { release = () => resolve(parseAnswerCheck('{"findings":[]}', prepared)); }); }, close() {} });
  explorer.cleaner = { run() { throw Error('Unexpected cleanup'); }, close() {} };
  explorer.questionHelper = { run() { throw Error('Unexpected help'); }, close() {} };
  explorer.briefHelper = { async run(prepared) { return parseBrief(JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] }), prepared); }, close() {} };
  const check = request(explorer); await explorer.checkRequest({ ...check, action: 'start' }); await new Promise(setImmediate);
  await assert.rejects(explorer.checkRequest({ ...request(explorer), action: 'start' }), /Cancel the running answer check/);
  await assert.rejects(explorer.briefRequest({ ...request(explorer), action: 'start' }), /Cancel the answer check/);
  await assert.rejects(explorer.cleanupRequest({ ...request(explorer), action: 'start', nodeId: explorer.doc.nodes[1].id, mutation: 0, text: 'draft' }), /Cancel the answer check/);
  await assert.rejects(explorer.helpRequest({ ...request(explorer), action: 'start', nodeId: explorer.doc.nodes[1].id, operation: 'terms' }), /Cancel the answer check/);
  await explorer.checkRequest({ ...check, action: 'cancel' }); release(); await explorer.toolFreeTask;
  const brief = request(explorer); await explorer.briefRequest({ ...brief, action: 'start' });
  // The brief can finish immediately; the shared release path still yields a valid proposal.
  await explorer.toolFreeTask; assert.equal((await explorer.briefRequest({ ...brief, action: 'poll' })).status, 'proposal');
});
test('omitted context is reported beside an empty result', async t => {
  const explorer = await makeExplorer(t, { async run(prepared) { return parseAnswerCheck('{"findings":[]}', prepared); }, close() {} });
  for (let i = 0; i < 100; i++) { const [node] = addQuestions(explorer.doc, explorer.doc.rootId, [{ question: 'Long ' + i, category: 'Other' }]); node.answer = 'x'.repeat(12000); node.answerState = 'decided'; }
  await writeFile(explorer.file, JSON.stringify(explorer.doc));
  const req = request(explorer); await explorer.checkRequest({ ...req, action: 'start' }); await explorer.toolFreeTask;
  const result = await explorer.checkRequest({ ...req, action: 'poll' }); assert.equal(result.status, 'result'); assert.deepEqual(result.findings, []); assert.ok(result.coverage.omitted > 0);
});
