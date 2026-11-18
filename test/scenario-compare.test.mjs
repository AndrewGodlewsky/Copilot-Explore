import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions, addDependency, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { buildScenario } from '../com.github.copilot/extensions/explorer/scenario-fork.mjs';
import { compareScenarios, comparisonPage, ScenarioComparison } from '../com.github.copilot/extensions/explorer/scenario-compare.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';

function map() {
  const doc = createDocument('Choose storage', { objective: 'Keep data portable' });
  const [a, b] = addQuestions(doc, doc.rootId, [{ question: 'Where?', category: 'Storage' }, { question: 'Who?', category: 'People' }]);
  const [child] = addQuestions(doc, a.id, [{ question: 'What backup?', category: 'Storage' }]);
  a.answer = '  Local 🌱\nexact  '; a.answerState = 'decided';
  return { doc, a, b, child };
}
const fork = (doc, nodeId, answer = 'Remote', answerState = 'assumption') => buildScenario(doc, { nodeId, answer, answerState }).document;

test('comparison aligns recorded origins, separates answer certainty and observed absence, and never mutates maps', () => {
  const { doc, a, b, child } = map(), other = fork(doc, a.id), before = structuredClone([doc, other]);
  const [newNode] = addQuestions(other, other.forkOrigin.forkNodeId, [{ question: child.question, category: child.category }]);
  other.nodes.at(-1).review = true;
  const result = compareScenarios(doc, other), pair = result.rows.find(r => r.leftId === a.id);
  assert.equal(pair.rightId, other.forkOrigin.forkNodeId); assert.deepEqual(pair.differences, ['answer', 'answerState']);
  assert.equal(result.rows.find(r => r.leftId === child.id).rightId, null);
  assert.equal(result.rows.find(r => r.rightId === newNode.id).leftId, null);
  assert.equal(result.rows.find(r => r.leftId === b.id).relation, 'only-left');
  assert.equal(result.counts.paired, 2); assert.equal(result.counts.onlyLeft, 2); assert.equal(result.counts.onlyRight, 1);
  const page = comparisonPage(result, 0, result.rows.indexOf(pair));
  assert.equal(page.selected.left.answer, a.answer); assert.equal(page.selected.left.answerState, 'decided');
  assert.equal(page.selected.right.answerState, 'assumption'); assert.match(page.coverage, /absence.*deletion/i);
  assert.deepEqual(doc, before[0]); assert.equal(other.nodes.length, before[1].nodes.length + 1);
});

test('nested forks compare without historical originals and duplicate origin claims remain ambiguous', () => {
  const { doc, a } = map(), first = fork(doc, a.id), second = fork(first, first.forkOrigin.forkNodeId, 'Third');
  const compared = compareScenarios(first, second); assert.equal(compared.counts.paired, 2);
  const duplicate = structuredClone(second), [newNode] = addQuestions(duplicate, duplicate.rootId, [{ question: 'Unrelated', category: 'Storage' }]);
  duplicate.forkOrigin.nodes.push({ nodeId: newNode.id, sourceNodeId: 'different-source-id', origin: structuredClone(duplicate.forkOrigin.nodes.at(-1).origin) });
  const ambiguous = compareScenarios(first, duplicate);
  assert.equal(ambiguous.counts.paired, 1); assert.equal(ambiguous.counts.ambiguous, 3);
  assert.ok(ambiguous.rows.filter(r => r.ambiguous).every(r => !r.leftId || !r.rightId));
});

test('explicit copy and immediate fork aliases align but identical independent wording does not', () => {
  const { doc, a } = map(), copy = structuredClone(doc);
  copy.id = 'copy-id'; copy.copyOrigin = { kind: 'personal-copy', sourceId: doc.id, sourceDigest: 'a'.repeat(64) };
  assert.equal(compareScenarios(doc, copy).counts.paired, doc.nodes.length);
  const fromCopy = fork(copy, a.id); assert.equal(compareScenarios(copy, fromCopy).counts.paired, 2);
  const independent = map().doc; assert.equal(compareScenarios(doc, independent).counts.paired, 0);
});

test('comparison retains original evidence provenance and flags research, review, guidance and dependency differences', () => {
  const { doc, a, b } = map(), other = fork(doc, a.id);
  a.research = { basis: 'sources', summary: 'Evidence', options: [{ title: 'Local', description: 'Local data', pros: [], cons: [] }, { title: 'Remote', description: 'Remote data', pros: [], cons: [] }], recommendation: 'Consider local', uncertainty: 'May change', sources: [{ id: 's1', title: 'Docs', url: 'https://example.com/docs', retrievedAt: '2026-11-18T00:00:00.000Z', provenance: 'imported' }], claims: [{ id: 'c1', text: 'Recorded claim', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Recorded support' }], limitations: 'Not independently verified' }] };
  a.researchStale = true; a.review = true; addDependency(doc, a.id, b.id, 'Premise'); other.objective = 'A changed objective';
  const result = compareScenarios(doc, other), index = result.rows.findIndex(r => r.leftId === a.id), row = comparisonPage(result, 0, index).selected;
  assert.ok(row.differences.includes('research')); assert.ok(row.differences.includes('review')); assert.ok(row.differences.includes('dependencies'));
  assert.equal(row.left.research.sources[0].provenance, 'imported'); assert.equal(row.left.researchStale, true);
  assert.equal(row.left.dependencies[0].prerequisite.id, b.id); assert.equal(result.context.objective.same, false);
});

test('comparison pages cap summaries while retaining complete selected long text and rejecting invalid positions', () => {
  const left = createDocument('Large'), right = createDocument('Independent');
  for (const [doc, prefix] of [[left, 'l'], [right, 'r']]) for (let i=0; i<4999; i++) doc.nodes.push({ id: `${prefix}${i}`, parentId: doc.rootId, question: `Question ${i}`, category: 'Scope', answer: i === 0 ? '🌱'.repeat(5000) : '', research: null, review: false });
  const result = compareScenarios(left, right), page = comparisonPage(result, 0, 1);
  assert.equal(result.rows.length, 10000); assert.equal(page.items.length, 25); assert.equal(page.selected.left.answer, left.nodes[1].answer);
  assert.equal(comparisonPage(result, 399, 9999).items.length, 25);
  for (const args of [[-1,0], [400,10000], [0,25], [0,1.5]]) assert.throws(() => comparisonPage(result, ...args), /page|row/i);
});

test('dense ambiguous imported origin claims stay unpaired without a cross-product of candidate nodes', () => {
  const {doc,a}=map(), left=fork(doc,a.id), right=fork(doc,a.id,'Different');
  const common=left.forkOrigin.nodes[1].origin;
  for(const [value,prefix] of [[left,'left'],[right,'right']]) {
    for(let i=0;i<2000;i++) {
      const id=`${prefix}-${i}`;
      value.nodes.push({id,parentId:value.rootId,question:`Claim ${i}`,category:'Scope',answer:'',research:null,review:false});
      value.forkOrigin.nodes.push({nodeId:id,sourceNodeId:`claimed-${i}`,origin:structuredClone(common)});
    }
  }
  const compared=compareScenarios(left,right); assert.equal(compared.counts.paired,1); assert.equal(compared.counts.ambiguous,4002);
});

test('captured comparison rejects changed or missing selected sources and expired tokens before later reads', async () => {
  const { doc, a } = map(); let left = validateDocument(doc), right = fork(doc, a.id);
  const comparison = new ScenarioComparison(async () => ({ left, right }));
  const p = await comparison.preview(); assert.equal((await comparison.page(p.id, 0, 1)).selected.left.id, a.id);
  right = structuredClone(right); right.nodes[1].answer = 'Later';
  await assert.rejects(comparison.page(p.id, 0, 1), /changed/i);
  const fresh = await comparison.preview(); left = null; await assert.rejects(comparison.page(fresh.id, 0, 0), /source|document|journey/i);
  left = validateDocument(doc); const newer = await comparison.preview(); comparison.entry.time = 0;
  await assert.rejects(comparison.page(newer.id, 0, 0), /expired/i);
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scenario-compare-')), library = new Library(dir), { doc, a } = map();
  const left = await library.import(doc), right = await library.import(fork(doc, a.id));
  const e = await new Explorer({ library, binding: 'comparison', send: async () => { throw Error('Unexpected model request'); } }).load();
  await e.command('open', { key: left.key });
  t.after(async () => { await e.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (action, extra = {}) => e.scenarioCompareRequest({ action, journey: e.activeKey, revision: e.doc.revision, ...extra });
  return { e, library, left, right, a, dir, request };
}

test('comparison controller is read-only until explicit source navigation and rejects changed selected files', async t => {
  const { e, left, right, a, dir, request } = await fixture(t);
  await e.writeDraft({ journey: e.activeKey, nodeId: a.id, base: a, text: 'Private draft 🌱', answerState: 'tentative', stateSelected: true, revision: 0 });
  const metadata = await readFile(join(dir, 'library.json')), drafts = await e.readDrafts(left.key), bytes = await readFile(left.file);
  const p = await request('preview', { target: { scope: 'personal', key: right.key } });
  await request('page', { id: p.id, page: 0, selected: 1 });
  assert.deepEqual(await readFile(left.file), bytes); assert.deepEqual(await readFile(join(dir, 'library.json')), metadata); assert.deepEqual(await e.readDrafts(left.key), drafts); assert.equal(e.activeKey, left.key);
  const changed = structuredClone(right.document); changed.nodes[1].answer = 'Updated outside'; changed.revision++;
  await writeFile(right.file, JSON.stringify(changed));
  await assert.rejects(request('page', { id: p.id, page: 0, selected: 1 }), /changed/i);
  await assert.rejects(e.command('open-compared-source', { id: p.id, journey: e.activeKey, revision: e.doc.revision, side: 'right', nodeId: right.document.nodes[1].id }), /changed/i);
  const fresh = await request('preview', { target: { scope: 'personal', key: right.key } });
  const result = await e.command('open-compared-source', { id: fresh.id, journey: e.activeKey, revision: e.doc.revision, side: 'right', nodeId: changed.nodes[1].id });
  assert.equal(e.activeKey, right.key); assert.equal(result.comparedNodeId, changed.nodes[1].id); assert.equal(e.doc.nodes[1].answer, 'Updated outside');
  await e.command('open', { revision: e.doc.revision, key: left.key }); assert.deepEqual(await e.readDrafts(left.key), drafts);
});

test('comparison HTTP rejects malformed targets, stale selection, invalid pages and untrusted writes', async t => {
  const { e, right, request } = await fixture(t), server = await startServer(e); t.after(() => server.close());
  const post = (body, origin = true) => fetch(server.url + 'api/scenario-compare', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', ...(origin ? { Origin: new URL(server.url).origin } : {}) }, body: JSON.stringify(body) });
  const input = { action: 'preview', journey: e.activeKey, revision: e.doc.revision, target: { scope: 'personal', key: right.key } };
  assert.equal((await post(input, false)).status, 403);
  for (const invalid of [{ ...input, extra: true }, { ...input, target: { ...input.target, path: '../../secret' } }, { ...input, journey: 'old' }]) assert.equal((await post(invalid)).status, 400);
  const response = await post(input); assert.equal(response.status, 200); const p = await response.json();
  await assert.rejects(request('page', { id: p.id, page: 0, selected: 30 }), /page|row/i);
  await request('discard', { id: p.id }); await assert.rejects(request('page', { id: p.id, page: 0, selected: 0 }), /expired/i);
});

test('comparison token cannot survive switching away and back to the same unchanged source', async t => {
  const { e, left, right, request } = await fixture(t);
  const p = await request('preview', { target: { scope: 'personal', key: right.key } });
  await e.command('open', { key: right.key, revision: e.doc.revision }); await e.command('open', { key: left.key, revision: e.doc.revision });
  await assert.rejects(request('page', { id: p.id, page: 0, selected: 0 }), /expired/i);
});

test('comparison preserves exact retained shared text and bounds dense dependency details', () => {
  const { doc, a } = map(); a.question='  Exact question 🌱  ';
  a.research={basis:'reasoning',summary:'  Exact retained explanation\r\n',options:['A','B'].map(title=>({title,description:title,pros:[],cons:[]})),recommendation:' A ',uncertainty:' Not verified ',sources:[]};
  for(let i=0;i<40;i++) { const [n]=addQuestions(doc,doc.rootId,[{question:`Premise ${i}`,category:'Scope'}]); addDependency(doc,a.id,n.id); }
  const other=structuredClone(doc), row=comparisonPage(compareScenarios(doc,other),0,1).selected.left;
  assert.equal(row.question,a.question); assert.equal(row.research.summary,a.research.summary); assert.equal(row.dependencyCount,40); assert.equal(row.dependencies.length,25);
});

test('project comparison stays read-only, preserves project text and uses fresh listing and checkout guards', async t => {
  const { e, library, a, request }=await fixture(t), root=await mkdtemp(join(tmpdir(),'comparison-project-'));
  t.after(()=>rm(root,{recursive:true,force:true})); await promisify(execFile)('git',['-C',root,'init','-q'],{windowsHide:true});
  let currentRoot=root; e.projectRepository=new ProjectRepository({readRoot:async()=>currentRoot,localDirectory:library.directory});
  const doc=buildScenario(e.doc,{nodeId:a.id,answer:'Project option',answerState:'assumption'}).document;
  doc.nodes[1].question='  Preserved project question 🌱  ';
  const project=await e.projectRepository.create(doc), bytes=await readFile(project.context.file), original=e.activeKey;
  let listing=await e.projectLibraryRequest({action:'refresh',folder:'.explorer/journeys'}), target={scope:'project',listing:listing.listing,key:listing.entries[0].key};
  const p=await request('preview',{target}), page=await request('page',{id:p.id,page:0,selected:1});
  assert.equal(page.selected.right.question,doc.nodes[1].question); assert.equal(e.activeKey,original); assert.deepEqual(await readFile(project.context.file),bytes);
  await e.projectLibraryRequest({action:'refresh',folder:'.explorer/journeys'}); await assert.rejects(request('page',{id:p.id,page:0,selected:1}),/expired/i);
  listing=await e.projectLibraryRequest({action:'refresh',folder:'.explorer/journeys'}); target={scope:'project',listing:listing.listing,key:listing.entries[0].key};
  const fresh=await request('preview',{target}); currentRoot=join(root,'missing-checkout'); await assert.rejects(request('page',{id:fresh.id,page:0,selected:1})); currentRoot=root;
  const ready=await request('preview',{target}); const result=await e.command('open-compared-source',{journey:e.activeKey,revision:e.doc.revision,id:ready.id,side:'right',nodeId:doc.nodes[1].id});
  assert.equal(result.storage.scope,'project'); assert.equal(result.comparedNodeId,doc.nodes[1].id); assert.deepEqual(await readFile(project.context.file),bytes);
});
