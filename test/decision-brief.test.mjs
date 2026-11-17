import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDocument, addQuestions, addDirection, validateDocument, toMarkdown, MAX_DOCUMENT_BYTES } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareBrief, parseBrief, acceptBrief, briefFreshness, briefMarkdown, validateBrief, BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
const output = (doc, id = doc.nodes[1]?.id) => ({ goal: [{ id: 'goal', text: 'Explore a choice; reasons remain unknown.', certainty: 'user-statement', sources: [{ kind: 'guidance', field: 'topic' }] }], decisions: id ? [{ id: 'decision', text: 'A possible choice, not yet settled.', certainty: 'user-decision', sources: [{ kind: 'node', id }] }] : [], constraints: [], assumptions: [], unresolved: [{ id: 'unknown', text: 'Missing answers remain unknown.', certainty: 'uncertain', sources: [] }], nextSteps: [{ id: 'next', text: 'Consider answering the open questions.', certainty: 'user-decision', sources: [] }] });
function fixture() {
 const doc = createDocument('Hostile <script> & \u03bb'); const [a,b] = addQuestions(doc, doc.rootId, [{question:'Choose?',category:'Choice'},{question:'Unknown?',category:'Open'}]); a.answer='Raw <b> \u03bb\r\nreason unknown'; a.answerState='tentative'; addDirection(doc, b.id, 'Explore <direction>'); return doc;
}
test('brief context admits root, stateful, open questions and directions; exact measured strings exclude prior artifacts/rationale', () => {
 const doc=fixture(); doc.nodes[1].rationale='PRIVATE RATIONALE'; doc.nodes[1].research={summary:'PRIVATE RESEARCH'};
 const prepared=prepareBrief(doc); assert.equal(prepared.context.targetId,doc.rootId); assert.equal(prepared.bytes,Buffer.byteLength(prepared.instructions)+Buffer.byteLength(prepared.prompt));
 assert.equal(prepared.dependencies.records.length,4); assert.equal(prepared.dependencies.records[1].id,doc.nodes[1].id); assert.ok(!prepared.prompt.includes('PRIVATE'));
 const proposal=parseBrief(JSON.stringify(output(doc)),prepared), accepted=acceptBrief(proposal,[]); doc.brief=accepted; assert.equal(prepareBrief(doc).prompt,prepared.prompt);
 assert.equal(accepted.sections.decisions[0].certainty,'uncertain'); assert.equal(accepted.sections.nextSteps[0].certainty,'suggestion');
 const reversed=structuredClone(doc); reversed.nodes.reverse(); assert.equal(prepareBrief(reversed).prompt,prepared.prompt);
});
test('structural certainty never promotes tentative, assumed, unanswered or review-only evidence', () => {
 for (const state of ['tentative','assumption','unanswered','needs-evidence','revisit-later','not-relevant','decided']) for (const review of [false,true]) {
  const doc=fixture(); doc.nodes[1].answerState=state; doc.nodes[1].review=review;
  const result=parseBrief(JSON.stringify(output(doc)),prepareBrief(doc)); assert.equal(result.sections.decisions[0].certainty,state==='decided'&&!review?'user-decision':'uncertain');
 }
 const empty=createDocument('Unknown goal'); const value=output(empty); const result=parseBrief(JSON.stringify(value),prepareBrief(empty)); assert.deepEqual(result.sections.decisions,[]); assert.match(result.sections.unresolved[0].text,/unknown/);
});
test('strict output/edit/native boundaries and exact Unicode; trusted source links survive edits', () => {
 const doc=fixture(), prepared=prepareBrief(doc), value=output(doc);
 for (const mutate of [v=>v.extra=[],v=>v.goal[0].extra=true,v=>v.goal.push({...v.goal[0]}),v=>v.decisions[0].sources[0].id='unknown',v=>v.goal[0].text=' ',v=>v.goal[0].text='a'.repeat(1001),v=>v.goal[0].sources=Array(9).fill({kind:'guidance',field:'topic'}),v=>v.goal[0].sources=[{kind:'guidance',field:'fake'}]]) {const v=structuredClone(value);mutate(v);assert.throws(()=>parseBrief(JSON.stringify(v),prepared),/Invalid/);}
 for (const raw of ['no json', ' '.repeat(256*1024+1)]) assert.throws(()=>parseBrief(raw,prepared));
 const proposal=parseBrief(JSON.stringify(value),prepared), text='  \u03bb <script> [click](javascript:x) &copy;\r\nExact text  ';
 const accepted=acceptBrief(proposal,[{id:'decision',text}]); assert.equal(accepted.sections.decisions[0].text,text);assert.equal(accepted.sections.decisions[0].edited,true);assert.deepEqual(accepted.sections.decisions[0].sources,proposal.sections.decisions[0].sources);
 for(const edits of [[{id:'unknown-id',text:'hi'}],[{id:'goal',text:'x',sources:[]}],[{id:'goal',text:'a'.repeat(1001)}],[{id:'goal',text:'x'},{id:'goal',text:'x'}]]) assert.throws(()=>acceptBrief(proposal,edits));
 doc.brief=accepted; assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))).brief,accepted);
 const markdown=briefMarkdown(accepted,doc); assert.ok(!markdown.includes('<script>'));assert.ok(!markdown.includes('[click](javascript:'));assert.match(markdown, /\]\(#source-1\)/);assert.match(markdown,/### Source 1/);assert.match(toMarkdown(doc),/Reviewed decision brief/);
});
test('all transmitted inputs are fingerprints, including uncited inputs; unrelated fields and new unsent nodes stay current', () => {
 const doc=fixture(), brief=acceptBrief(parseBrief(JSON.stringify(output(doc)),prepareBrief(doc)),[]);
 const unrelated=structuredClone(doc);unrelated.updatedAt=new Date().toISOString();unrelated.nodes[1].research={summary:'not sent'};addQuestions(unrelated,doc.rootId,[{question:'Unsent later',category:'Other'}]);assert.equal(briefFreshness(brief,unrelated),'current');
 const changed=structuredClone(doc);changed.nodes[2].question='Uncited changed';assert.equal(briefFreshness(brief,changed),'stale');
 const guidance=structuredClone(doc);guidance.pins=[{id:'constraint-00000000000000',text:'new'}];assert.equal(briefFreshness(brief,guidance),'stale');
 const future=structuredClone(brief);future.dependencies.projection=2;assert.equal(briefFreshness(validateBrief(future),doc),'unknown');
 doc.nodes=doc.nodes.filter(n=>n.id!==doc.nodes[1].id);doc.brief=brief;assert.ok(validateDocument(doc).brief);assert.equal(briefFreshness(brief,doc),'stale');assert.match(briefMarkdown(brief,doc),/Source unavailable/);
});
test('large context has deterministic whole-record omissions and saved artifact cap', () => {
 const doc=fixture(); for(let i=0;i<200;i++){const [node]=addQuestions(doc,doc.rootId,[{question:'Q'+i,category:'C'}]);node.answer='\u{1f331}'.repeat(9000);node.answerState='decided';}
 const prepared=prepareBrief(doc);assert.ok(prepared.bytes<=131072);assert.ok(prepared.context.omitted.decisionsElsewhere>0);assert.ok(prepared.dependencies.records.every(r=>r.answer===''||r.answer===doc.nodes[1].answer||r.answer.length===18000));
 const brief=acceptBrief(parseBrief(JSON.stringify(output(doc)),prepared),[]);assert.ok(Buffer.byteLength(JSON.stringify(brief,null,2))<512*1024);
 const oversized=structuredClone(brief);oversized.dependencies.records=Array.from({length:5000},(_,i)=>({...brief.dependencies.records[0],id:'id'+i,question:'q'.repeat(4000)}));oversized.coverage.included=5000;oversized.coverage.omitted=0;oversized.sections.decisions=[];assert.throws(()=>validateBrief(oversized),/512 KiB/);
});
async function controller(t, helper) {
 const dir=await mkdtemp(join(tmpdir(),'explorer-brief-')),file=join(dir,'map.explore.json'), doc=fixture();await writeFile(file,JSON.stringify(doc));
 const explorer=await new Explorer({file,send(){throw Error('No attached chat');},briefHelper:helper}).load();
 t.after(async()=>{await explorer.close();await rm(dir,{recursive:true,force:true});});return explorer;
}
const base=explorer=>({id:randomUUID(),journey:explorer.doc.id});
async function proposal(explorer,request) {await explorer.briefRequest({...request,action:'start'});await explorer.toolFreeTask;return explorer.briefRequest({...request,action:'poll'});}
test('HTTP proposal edits accept separately, immutable answers, revision/history, stale acceptance, discard and complete exports',async t=>{
 const explorer=await controller(t,{async run(prepared){return parseBrief(JSON.stringify(output(explorer.doc)),prepared);},close(){}}), request=base(explorer), before=structuredClone(explorer.doc.nodes);
 const server=await startServer(explorer,{close(){}});t.after(()=>server.close());
 const post=(data,origin=new URL(server.url).origin)=>fetch(server.url+'api/brief',{method:'POST',headers:{'Content-Type':'application/json','X-Explorer-Client':'1',Origin:origin},body:JSON.stringify(data)});
 assert.equal((await post({...request,action:'start'},'')).status,403);assert.equal((await post({...request,action:'start',context:{}})).status,400);
 const result=await proposal(explorer,request);assert.equal(result.status,'proposal');assert.equal(explorer.doc.brief,undefined);assert.ok(!JSON.stringify(explorer.snapshot()).includes('Explore a choice'));
 assert.equal((await post({...request,action:'accept',revision:0,edits:[{id:'goal',text:'User exact \u03bb'}]})).status,200);assert.deepEqual(explorer.doc.nodes,before);assert.equal(explorer.doc.brief.sections.goal[0].edited,true);
 const exported=await fetch(server.url+'brief.md').then(r=>r.text());assert.match(exported,/User exact \u03bb/);assert.match(await fetch(server.url+'export.md').then(r=>r.text()),/User answer/);
 assert.ok((await explorer.readHistory(explorer.doc.id)).entries.length);
 const again=base(explorer);await proposal(explorer,again);const disk=JSON.parse(await readFile(explorer.file));disk.nodes[2].question='Other source changed';disk.revision++;await writeFile(explorer.file,JSON.stringify(disk));
 assert.equal((await post({...again,action:'accept',revision:disk.revision,edits:[]})).status,400);assert.equal(explorer.doc.brief.sections.goal[0].text,'User exact \u03bb');assert.equal((await explorer.briefRequest({...again,action:'poll'})).status,'stale');
 await explorer.briefRequest({...again,action:'discard'});assert.equal(explorer.briefWork,null);assert.match(await fetch(server.url+'brief.md').then(r=>r.text()),/Freshness: stale/);
});
test('cancellation waits actual shared release, blocks help/cleanup, rejects late output and unconfirmed release',async t=>{
 let release,started,signal;const explorer=await controller(t,{run(prepared,options){signal=options.signal;started=true;return new Promise(resolve=>{release=()=>resolve(parseBrief(JSON.stringify(output(explorer.doc)),prepared));});},close(){}}),request=base(explorer);
 await explorer.briefRequest({...request,action:'start'});await new Promise(r=>setImmediate(r));assert.ok(started);
 explorer.cleaner={run(){throw Error('unexpected');},close(){}};explorer.questionHelper={run(){throw Error('unexpected');},close(){}};
 await assert.rejects(explorer.cleanupRequest({action:'start',...base(explorer),nodeId:explorer.doc.nodes[1].id,mutation:0,text:'draft'}),/Cancel the decision brief/);
 await assert.rejects(explorer.helpRequest({action:'start',...base(explorer),nodeId:explorer.doc.nodes[1].id,operation:'terms'}),/Cancel the decision brief/);
 await explorer.briefRequest({...request,action:'discard'});assert.equal(signal.aborted,true);release();await explorer.toolFreeTask;assert.equal(explorer.briefWork,null);
 explorer.unconfirmedToolFreeRelease={};await assert.rejects(explorer.briefRequest({...base(explorer),action:'start'}),/shutdown/);
});
test('near 9MiB acceptance fails atomically and preserves previous document',async t=>{
 const explorer=await controller(t,{async run(prepared){const raw=Object.fromEntries(BRIEF_SECTIONS.map((s,i)=>[s,Array.from({length:5},(_,j)=>({id:`s${i}_${j}`,text:'x'.repeat(1000),certainty:'uncertain',sources:[]}))]));return parseBrief(JSON.stringify(raw),prepared);},close(){}});
 const doc=explorer.doc;while(Buffer.byteLength(JSON.stringify(doc,null,2))<MAX_DOCUMENT_BYTES-25000){const [node]=addQuestions(doc,doc.rootId,[{question:'Large '+doc.nodes.length,category:'C'}]);node.answer='x'.repeat(19000);}
 validateDocument(doc);await writeFile(explorer.file,JSON.stringify(doc,null,2));const before=await readFile(explorer.file,'utf8'),request=base(explorer);await proposal(explorer,request);
 await assert.rejects(explorer.briefRequest({...request,action:'accept',revision:0,edits:[]}),/9 MiB/);assert.equal(await readFile(explorer.file,'utf8'),before);assert.equal(explorer.doc.brief,undefined);
});

test('brief acceptance and research completion preserve both artifacts in either serialized order',async t=>{
 for(const first of ['brief','research']) {
  let finish;const explorer=await controller(t,{async run(prepared){return parseBrief(JSON.stringify(output(explorer.doc)),prepared);},close(){}});
  const finding={basis:'reasoning',summary:'Choices',options:[{title:'A',description:'First',pros:[],cons:[]},{title:'B',description:'Second',pros:[],cons:[]}],recommendation:'Consider A',uncertainty:'No sources',sources:[]};
  explorer.researcher={run(){return new Promise(resolve=>{finish=()=>resolve(finding);});}};
  const request=base(explorer);await proposal(explorer,request);await explorer.command('research',{revision:explorer.doc.revision,nodeId:explorer.doc.nodes[1].id});await new Promise(setImmediate);
  const accept=()=>explorer.briefRequest({...request,action:'accept',revision:explorer.doc.revision,edits:[]});const researched=async()=>{finish();await Promise.all([...explorer.researchTasks]);};
  if(first==='brief'){await accept();await researched();}else{await researched();await accept();}
  assert.deepEqual(explorer.doc.nodes[1].research,finding);assert.ok(explorer.doc.brief);assert.equal(briefFreshness(explorer.doc.brief,explorer.doc),'current');assert.equal(explorer.doc.revision,2);
  const previous=await explorer.readHistory(explorer.doc.id,1);assert.equal(!!previous.document.brief,first==='brief');assert.equal(!!previous.document.nodes[1].research,first==='research');
 }
});

test('history restore recovers prior accepted brief and native reload preserves it',async t=>{
 const explorer=await controller(t,{async run(prepared){return parseBrief(JSON.stringify(output(explorer.doc)),prepared);},close(){}});
 const one=base(explorer);await proposal(explorer,one);await explorer.briefRequest({...one,action:'accept',revision:0,edits:[{id:'goal',text:'First reviewed goal'}]});
 const two=base(explorer);await proposal(explorer,two);await explorer.briefRequest({...two,action:'accept',revision:1,edits:[{id:'goal',text:'Replacement reviewed goal'}]});
 await explorer.command('restore',{revision:2,journey:explorer.doc.id,snapshotRevision:1});assert.equal(explorer.doc.brief.sections.goal[0].text,'First reviewed goal');
 const reload=await new Explorer({file:explorer.file}).load();assert.deepEqual(reload.doc.brief,explorer.doc.brief);await reload.close();
});

test('shared brief/cleanup cancellation queues wait for actual release in both directions',async t=>{
 for(const first of ['brief','cleanup']) {
  let release, running=0, maximum=0, latePrepared;const calls=[];
  const begin=(name,value)=>{calls.push(name);running++;maximum=Math.max(maximum,running);if(calls.length===1)return new Promise(resolve=>{release=()=>{running--;resolve(name==='brief'?parseBrief(JSON.stringify(output(explorer.doc)),value):'cleaned');};});running--;return Promise.resolve(name==='brief'?parseBrief(JSON.stringify(output(explorer.doc)),value):'cleaned');};
  const explorer=await controller(t,{run(value){latePrepared=value;return begin('brief',value);},close(){}});explorer.cleaner={run(value){return begin('cleanup',value);},close(){}};
  const brief=base(explorer),cleanup={...base(explorer),nodeId:explorer.doc.nodes[1].id,mutation:0,text:'draft'};
  const startBrief=()=>explorer.briefRequest({...brief,action:'start'}),startCleanup=()=>explorer.cleanupRequest({...cleanup,action:'start'});
  await (first==='brief'?startBrief():startCleanup());await new Promise(setImmediate);
  if(first==='brief'){await explorer.briefRequest({...brief,action:'discard'});await startCleanup();}else{const {text,...cancel}=cleanup;await explorer.cleanupRequest({...cancel,action:'cancel'});await startBrief();}
  assert.equal(calls.length,1);release();await explorer.toolFreeTask;assert.equal(calls.length,2);assert.equal(maximum,1);assert.ok(latePrepared);
 }
});

test('included contradictory/tentative sources remain explicit and prevent a structurally settled mixed claim',()=>{
 const doc=fixture();doc.nodes[1].answer='Choose A';doc.nodes[1].answerState='decided';doc.nodes[2].answer='Choose B';doc.nodes[2].answerState='tentative';const prepared=prepareBrief(doc),raw=output(doc);raw.decisions[0].sources.push({kind:'node',id:doc.nodes[2].id});
 assert.match(prepared.prompt,/Choose A/);assert.match(prepared.prompt,/Choose B/);assert.equal(parseBrief(JSON.stringify(raw),prepared).sections.decisions[0].certainty,'uncertain');
});

test('standalone and complete brief source anchors resolve to the appendix before colliding research headings', () => {
 const doc = fixture(), value = output(doc);
 doc.topic = 'Source 1\n==='; doc.nodes[0].question = doc.topic;
 doc.nodes[1].question = 'Source 2\n===';
 value.goal[0].text = 'A statement\n\nSource 1\n===';
 value.goal[0].sources = [{ kind: 'node', id: doc.nodes[1].id }, { kind: 'guidance', field: 'topic' }];
 const proposal = parseBrief(JSON.stringify(value), prepareBrief(doc));
 doc.brief = acceptBrief(proposal, []);
 doc.nodes[1].research = { basis: 'reasoning', summary: 'Summary', options: [
  { title: 'Source 1', description: 'Unrelated first option', pros: [], cons: [] },
  { title: 'Source 2', description: 'Unrelated second option', pros: [], cons: [] },
 ], recommendation: 'Unknown', uncertainty: 'No sources', sources: [] };
 for (const markdown of [briefMarkdown(doc.brief, doc), toMarkdown(doc)]) {
  for (const number of [1, 2]) {
   assert.ok(markdown.includes(`[Source ${number}](#source-${number})`));
   // The first heading with this text receives the unsuffixed fragment in GitHub-style Markdown.
   const headings = [...markdown.matchAll(new RegExp(`^(#{1,6}) Source ${number}$`, 'gm'))];
   assert.equal(headings[0][1], '###', `source-${number} belongs to the brief appendix`);
   const content = markdown.slice(headings[0].index).split(/\n#{1,6} /)[0];
   assert.match(content, number === 1 ? /Node ID:/ : /Global user guidance/);
  }
  assert.ok(markdown.includes('Source 1\n\\=\\=\\='), 'statement text cannot create a Setext heading');
  assert.ok(markdown.includes('Source 2\n\\=\\=\\='), 'source question text cannot create a Setext heading');
 }
 const complete = toMarkdown(doc);
 assert.match(complete, /^# Exploration\n/);
 assert.ok(complete.indexOf('### Source 2') < complete.indexOf('#### Source 1'));
 assert.ok(complete.indexOf('### Source 2') < complete.indexOf('## Topic'));
 assert.ok(complete.includes('## Topic\n\nSource 1\n==='), 'the original multiline topic is preserved after the appendix');
 assert.match(complete, /Unrelated first option/);
 assert.match(complete, /Unrelated second option/);
});
