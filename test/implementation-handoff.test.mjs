import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { createDocument, addQuestions, validateDocument, importedDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareHandoff, parseHandoff, acceptHandoff, validateHandoff, handoffFreshness, handoffMarkdown } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';

function fixture() {
  const doc = createDocument('Build λ');
  const [a, b] = addQuestions(doc, doc.rootId, [{ question: 'Choose?', category: 'Scope' }, { question: 'Private question', category: 'Other' }]);
  a.answer = 'Possible answer'; a.answerState = 'tentative'; b.answer = 'UNSELECTED_CANARY';
  a.research = { basis: 'sources', sources: [{ id: 's1', title: 'Recorded source', url: 'https://example.com/source', retrievedAt: '2026-11-17T00:00:00.000Z', provenance: 'imported' }], claims: [{ id: 'c1', text: 'A research interpretation', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Recorded support' }], limitations: 'Unverified' }], summary: 'SUMMARY_CANARY', recommendation: 'RECOMMENDATION_CANARY', proposedAnswer: 'PROPOSAL_CANARY' };
  doc.brief = { secret: 'BRIEF_CANARY' }; doc.handoff = { secret: 'HANDOFF_CANARY' }; doc.projectCapture = { excerpt: 'PROJECT_CANARY' };
  doc.pins = [{ id: 'constraint-00000000000000', text: 'Preserve this exact constraint λ' }];
  return doc;
}
const output = doc => ({ goal: [], decisions: [{ id: 'decision', text: 'Tentative choice remains open', certainty: 'user-decision', sources: [{ kind: 'node', id: doc.nodes[1].id }] }], constraints: [], assumptions: [], unresolved: [], nextSteps: [{ id: 'step', text: 'Consider reviewing the choice', certainty: 'suggestion', sources: [] }] });

test('handoff full Markdown protects source anchors from multiline setext topic and preserves captured mode', () => {
  const doc = fixture(); delete doc.brief; delete doc.handoff; delete doc.projectCapture;
  doc.nodes[1].research = null;
  doc.topic = doc.nodes[0].question = 'Topic\n\nHandoff source 1\n---'; doc.mode = 'decide';
  const prepared = prepareHandoff(doc, { nodeIds: [doc.nodes[1].id], format: 'tasks', includeEvidence: false });
  doc.handoff = acceptHandoff(parseHandoff(JSON.stringify(output(doc)), prepared), []);
  const full = toMarkdown(doc);
  assert.match(handoffMarkdown(doc.handoff, doc), /Mode: decide/);
  assert.equal(full.split('\n')[0], '# Exploration');
  assert.ok(full.indexOf('### Handoff source 1') < full.indexOf('Handoff source 1\n---'));
});

test('handoff exact explicit subset and five formats omit private/previous artifacts; selected evidence is opt-in', () => {
  const doc = fixture(), nodeIds = [doc.nodes[1].id];
  for (const format of ['brief', 'specification', 'plan', 'prompt', 'tasks']) {
    const p = prepareHandoff(doc, { nodeIds, format, includeEvidence: false });
    assert.deepEqual(p.dependencies.records.map(r => r.id), nodeIds);
    assert.equal(p.bytes, Buffer.byteLength(p.prompt) + Buffer.byteLength(p.instructions));
    assert.equal(p.context.format, format); assert.equal(p.context.evidence.length, 0);
    assert.ok(!p.prompt.includes('CANARY')); assert.ok(!p.prompt.includes('Recorded support'));
  }
  const p = prepareHandoff(doc, { nodeIds, format: 'tasks', includeEvidence: true });
  assert.match(p.prompt, /Recorded support/); assert.match(p.prompt, /imported/); assert.ok(!p.prompt.includes('CANARY'));
  assert.deepEqual(p.context.evidence[0].claims, doc.nodes[1].research.claims);
  for (const selection of [{ nodeIds, format: 'execute', includeEvidence: false }, { nodeIds: [], format: 'brief', includeEvidence: false }, { nodeIds: [doc.rootId], format: 'brief', includeEvidence: false }, { nodeIds: [...nodeIds, ...nodeIds], format: 'brief', includeEvidence: false }]) assert.throws(() => prepareHandoff(doc, selection));
});

test('handoff strict labels/evidence refs, exact edits and provenance-safe export preserve uncertainty', () => {
  const doc = fixture(), p = prepareHandoff(doc, { nodeIds: [doc.nodes[1].id], format: 'tasks', includeEvidence: true });
  const value = output(doc); value.goal = [{ id: 'e', text: 'Research is interpretation', certainty: 'user-decision', sources: [{ kind: 'evidence', nodeId: doc.nodes[1].id, sourceId: 's1' }] }];
  const proposal = parseHandoff(JSON.stringify(value), p);
  assert.equal(proposal.sections.decisions[0].certainty, 'uncertain'); assert.equal(proposal.sections.goal[0].certainty, 'uncertain');
  const text = '  λ <script> [click](javascript:x)\r\nExact  ';
  const accepted = acceptHandoff(proposal, [{ id: 'decision', text }]);
  assert.equal(accepted.sections.decisions[0].text, text); assert.equal(accepted.sections.decisions[0].edited, true);
  const md = handoffMarkdown(accepted, doc); assert.ok(!md.includes('<script>')); assert.match(md, /Preserve this exact constraint/); assert.match(md, /imported/); assert.match(md, /Recorded support/);
  for (const mutate of [v => v.goal[0].sources[0].sourceId = 'missing', v => v.goal[0].extra = true, v => v.nextSteps[0].id = 'decision', v => v.goal[0].text = 'x'.repeat(1001)]) { const v = structuredClone(value); mutate(v); assert.throws(() => parseHandoff(JSON.stringify(v), p)); }
  const unrelated = structuredClone(doc); unrelated.nodes[2].answer = 'Changed'; unrelated.nodes[1].research.summary = 'Changed';
  assert.equal(handoffFreshness(accepted, unrelated), 'current');
  unrelated.nodes[1].research.claims[0].limitations = 'Changed'; assert.equal(handoffFreshness(accepted, unrelated), 'stale');
  const changed = structuredClone(doc); changed.nodes[1].answer = 'Changed'; assert.equal(handoffFreshness(accepted, changed), 'stale');
});

async function setup(t, helper) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-handoff-')), file = join(dir, 'map.explore.json'), doc = fixture();
  delete doc.brief; delete doc.handoff; delete doc.projectCapture;
  doc.nodes[1].research = null;
  await writeFile(file, JSON.stringify(doc));
  const explorer = await new Explorer({ file, briefHelper: helper, send() { throw Error('No attached chat'); } }).load();
  const server = await startServer(explorer, { close() {} });
  t.after(async () => { await server.close(); await explorer.close(); await rm(dir, { recursive: true, force: true }); });
  const post = async (route, input) => { const r = await fetch(server.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin }, body: JSON.stringify(input) }); return { status: r.status, value: await r.json() }; };
  const selection = { nodeIds: [doc.nodes[1].id], format: 'tasks', includeEvidence: false };
  const preview = async (overrides = {}) => post('api/research-review', { action: 'prepare', clientId: randomUUID(), sequence: 1, journey: doc.id, nodeId: doc.rootId, purpose: 'implementation-handoff', selection, ...overrides });
  const request = { id: randomUUID(), journey: doc.id };
  const action = (action, fields = {}) => post('api/handoff', { ...request, action, ...fields });
  return { explorer, server, doc, post, preview, action, request, selection };
}

test('handoff HTTP exact preview token, revision-checked acceptance, unrelated edits, source freshness, complete saved history and exports', async t => {
  let received;
  const f = await setup(t, { async run(prepared) { received = prepared; return parseHandoff(JSON.stringify(output(f.doc)), prepared); }, close() {} });
  const preview = await f.preview(); assert.equal(preview.status, 200);
  assert.equal((await f.action('start', { token: 'wrong' })).status, 400);
  assert.equal((await f.action('start', { token: preview.value.token })).status, 200);
  await f.explorer.toolFreeTask;
  assert.equal(received.prompt, preview.value.prepared.prompt); assert.equal(received.instructions, preview.value.prepared.instructions);
  assert.equal((await f.action('start', { token: preview.value.token })).status, 400);
  assert.equal((await f.action('poll')).value.status, 'proposal'); assert.equal(f.explorer.doc.handoff, undefined);
  await f.explorer.command('answer', { revision: 0, nodeId: f.doc.nodes[2].id, answer: 'Other saved choice' });
  assert.equal((await f.action('poll')).value.status, 'proposal');
  assert.equal((await f.action('accept', { revision: 0, edits: [] })).status, 400);
  const exact = '  User λ <script>\r\nTask  ';
  assert.equal((await f.action('accept', { revision: 1, edits: [{ id: 'step', text: exact }] })).status, 200);
  assert.equal(f.explorer.doc.handoff.sections.nextSteps[0].text, exact); assert.equal(f.explorer.doc.nodes[1].answer, f.doc.nodes[1].answer);
  assert.equal((await f.explorer.readHistory(f.doc.id)).entries.length, 2);
  const exported = await fetch(f.server.url + 'handoff.md').then(r => r.text()); assert.match(exported, /Reviewed implementation tasks/); assert.ok(!exported.includes('<script>'));
  const native = await fetch(f.server.url + 'export.json').then(r => r.json()); assert.equal(native.handoff.sections.nextSteps[0].text, exact);
  const again = await f.preview(); await f.action('start', { token: again.value.token }); await f.explorer.toolFreeTask;
  const disk = JSON.parse(await readFile(f.explorer.file)); disk.nodes[1].answer = 'New selected choice'; disk.revision++; await writeFile(f.explorer.file, JSON.stringify(disk));
  assert.equal((await f.action('poll')).value.status, 'stale'); assert.equal((await f.action('accept', { revision: disk.revision, edits: [] })).status, 400);
  assert.equal(f.explorer.doc.handoff.sections.nextSteps[0].text, exact);
});

test('handoff actual-release queue rechecks sources at dispatch, rejects cancellation late output and stale preview', async t => {
  let release, calls = 0;
  const f = await setup(t, { async run(prepared) { calls++; return parseHandoff(JSON.stringify(output(f.doc)), prepared); }, close() {} });
  f.explorer.toolFreeTask = new Promise(resolve => { release = resolve; });
  const p = await f.preview(); await f.action('start', { token: p.value.token });
  const disk = structuredClone(f.explorer.doc); disk.nodes[1].answer = 'Changed while queued'; disk.revision++;
  await writeFile(f.explorer.file, JSON.stringify(disk));
  release(); await f.explorer.toolFreeTask; assert.equal(calls, 0); assert.equal((await f.action('poll')).value.status, 'stale');
  await f.explorer.command('refresh-answer', { revision: f.explorer.doc.revision });
  await f.action('discard');
  const stale = await f.preview(); await f.explorer.command('answer', { revision: 1, nodeId: f.doc.nodes[1].id, answer: 'Changed after review' });
  assert.equal((await f.action('start', { token: stale.value.token })).status, 400);
  let signal, finish;
  f.explorer.briefHelper.run = (prepared, options) => { signal = options.signal; return new Promise(resolve => { finish = () => resolve(parseHandoff(JSON.stringify(output(f.doc)), prepared)); }); };
  const running = await f.preview(); await f.action('start', { token: running.value.token });
  for (let i = 0; !signal && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await f.action('discard'); assert.equal(signal.aborted, true); finish(); await f.explorer.toolFreeTask; assert.equal(f.explorer.briefWork, null);
  f.explorer.unconfirmedToolFreeRelease = {}; const blocked = await f.preview(); assert.equal((await f.action('start', { token: blocked.value.token })).status, 400);
});

test('handoff source/evidence bounds reject excess rather than truncating and mixed contradictory sources remain uncertain', () => {
  const doc = fixture(), a = doc.nodes[1], b = doc.nodes[2]; b.answer = 'Contradictory choice'; b.answerState = 'decided';
  const p = prepareHandoff(doc, { nodeIds: [a.id, b.id], format: 'specification', includeEvidence: true });
  const raw = output(doc); raw.decisions[0].sources.push({ kind: 'node', id: b.id });
  const proposal = parseHandoff(JSON.stringify(raw), p); assert.equal(proposal.sections.decisions[0].certainty, 'uncertain');
  for (const content of ['no JSON', ' '.repeat(256 * 1024 + 1), JSON.stringify({ ...raw, extra: [] }), JSON.stringify({ ...raw, nextSteps: Array(6).fill(raw.nextSteps[0]) })]) assert.throws(() => parseHandoff(content, p));
  const accepted = acceptHandoff(proposal, []);
  assert.throws(() => validateHandoff({ ...accepted, format: 'plan' }), /Invalid/);
  for (const mutate of [v => v.format = 'execute', v => v.evidence.push(v.evidence[0]), v => v.evidence[0].sources[0].url = 'file:///C:/private.txt', v => v.evidence[0].claims[0].evidence[0].sourceId = 'missing', v => v.guidance.pins[0].text = 'Forged constraints']) { const v = structuredClone(accepted); mutate(v); assert.throws(() => validateHandoff(v)); }
  a.answer = 'λ'.repeat(70000); assert.throws(() => prepareHandoff(doc, { nodeIds: [a.id], format: 'brief', includeEvidence: true }), /128 KiB/);
  assert.deepEqual(p.context.records[0].answer, 'Possible answer');
});

test('accepted handoff import marks recorded reads imported and native history/export preserve the complete reviewed artifact', async t => {
  const f = await setup(t, { async run(prepared) { return parseHandoff(JSON.stringify(output(f.doc)), prepared); }, close() {} });
  const p = await f.preview(); await f.action('start', { token: p.value.token }); await f.explorer.toolFreeTask; await f.action('accept', { revision: 0, edits: [] });
  const saved = structuredClone(f.explorer.doc.handoff);
  const reload = await new Explorer({ file: f.explorer.file }).load(); assert.deepEqual(reload.doc.handoff, saved); await reload.close();
  await f.explorer.command('restore', { revision: 1, journey: f.doc.id, snapshotRevision: 0 }); assert.equal(f.explorer.doc.handoff, undefined);
  await f.explorer.command('restore', { revision: 2, journey: f.doc.id, snapshotRevision: 1 }); assert.deepEqual(f.explorer.doc.handoff, saved);
  const doc = fixture(); delete doc.brief; delete doc.handoff; delete doc.projectCapture;
  doc.nodes[1].research = { ...doc.nodes[1].research, options: [{ title: 'A', description: 'A', pros: [], cons: [] }, { title: 'B', description: 'B', pros: [], cons: [] }], recommendation: 'Unknown', uncertainty: 'Not verified' };
  doc.nodes[1].research.sources[0].provenance = 'recorded-read';
  const prepared = prepareHandoff(doc, { nodeIds: [doc.nodes[1].id], format: 'brief', includeEvidence: true });
  doc.handoff = acceptHandoff(parseHandoff(JSON.stringify(output(doc)), prepared), []);
  assert.ok(validateDocument(doc).handoff); const imported = importedDocument(doc);
  assert.equal(imported.handoff.evidence[0].sources[0].provenance, 'imported'); assert.equal(handoffFreshness(imported.handoff, imported), 'current');
  const markdown = toMarkdown(imported); assert.match(markdown, /\]\(#handoff-source-1\)/); assert.match(markdown, /### Handoff source 1/);
});

test('handoff completion refuses changed selected disk sources; cancellation retains actual queue ownership until release', async t => {
  let finish, entered = 0;
  const f = await setup(t, { run(prepared) { entered++; return new Promise(resolve => { finish = () => resolve(parseHandoff(JSON.stringify(output(f.doc)), prepared)); }); }, close() {} });
  const waitEntered = async target => { for (let i = 0; entered < target && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(entered, target); };
  const p = await f.preview(); await f.action('start', { token: p.value.token }); await waitEntered(1);
  const disk = structuredClone(f.explorer.doc); disk.nodes[1].answer = 'Updated externally'; disk.revision++; await writeFile(f.explorer.file, JSON.stringify(disk));
  finish(); await f.explorer.toolFreeTask; assert.equal((await f.action('poll')).value.status, 'stale');
  await f.explorer.command('refresh-answer', { revision: f.explorer.doc.revision }); await f.action('discard');
  const next = await f.preview(); await f.action('start', { token: next.value.token }); await waitEntered(2);
  const priorFinish = finish; await f.action('discard');
  const replacement = await f.preview(); await f.action('start', { token: replacement.value.token }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(entered, 2);
  priorFinish(); await waitEntered(3); finish(); await f.explorer.toolFreeTask; assert.equal((await f.action('poll')).value.status, 'proposal');
});
