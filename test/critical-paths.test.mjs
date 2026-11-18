import test from 'node:test';
import assert from 'node:assert/strict';
import * as impact from '../com.github.copilot/extensions/explorer/web/decision-impact.mjs';
import { createDocument, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';

const question = (id, parentId, answerState = 'decided', review = false) => ({ id, parentId, question:id, category:'Choice', answer:answerState === 'unanswered' ? '' : 'Saved', answerState, research:null, review });
function inspect(doc) { assert.equal(typeof impact.criticalPaths, 'function'); return impact.criticalPaths(doc); }

test('critical paths keep every high-band tie and ancestors without labeling structural context as critical', () => {
  const doc=createDocument('Tied influence');
  for (const id of ['a','b']) { doc.nodes.push(question(id,doc.rootId)); for(let i=0;i<20;i++) doc.nodes.push(question(`${id}${i}`,id)); }
  const before=structuredClone(doc), result=inspect(doc);
  assert.deepEqual([...result.highlights.keys()].sort(), ['a','b']);
  assert.deepEqual([...result.ids].sort(), [doc.rootId,'a','b'].sort());
  assert.deepEqual(result.highlights.get('a'), ['High downstream impact']); assert.deepEqual(doc,before);
});

test('unresolved dependency seeds retain complete components including resolved intermediate paths and direction ancestry', () => {
  const doc=createDocument('Recorded chains');
  doc.nodes.push({id:'direction',parentId:doc.rootId,kind:'direction',question:'Direction',category:'Direction',answer:'',research:null,review:false}, ...['a','b','c','d','e','other'].map(id=>question(id,id==='c'?'direction':doc.rootId,id==='a'?'assumption':'decided')));
  doc.dependencies=[['b','a'],['c','b'],['d','b'],['e','c'],['e','d']].map(([dependentId,prerequisiteId])=>({dependentId,prerequisiteId}));
  validateDocument(doc); const result=inspect(doc);
  assert.deepEqual([...result.highlights.keys()], ['a']);
  assert.deepEqual(result.highlights.get('a'), ['Unresolved recorded dependency']);
  assert.deepEqual([...result.ids].sort(), [doc.rootId,'direction','a','b','c','d','e'].sort()); assert.ok(!result.ids.has('other'));
});

test('critical eligibility uses saved state and review, leaves unsupported paths empty and never mutates input', () => {
  for (const [state,review,expected] of [['unanswered',false,true],['tentative',false,true],['assumption',false,true],['needs-evidence',false,true],['revisit-later',false,true],['decided',false,false],['not-relevant',false,false],['decided',true,true]]) {
    const doc=createDocument('States');doc.nodes.push(question('a',doc.rootId,state,review),question('b',doc.rootId));doc.dependencies=[{dependentId:'b',prerequisiteId:'a'}];
    const result=inspect(doc);assert.equal(result.highlights.has('a'),expected,`${state}/${review}`);
    if(!expected) assert.equal(result.highlights.size,0);
  }
  const doc=createDocument('No recorded dependence');doc.nodes.push(question('a',doc.rootId,'assumption'));
  assert.equal(inspect(doc).highlights.size,0);assert.deepEqual([...inspect(doc).ids], [doc.rootId]);
});

test('critical membership stays linear on near-limit trees and dense recorded components', () => {
  const doc=createDocument('Bounded');
  for(let i=0;i<4999;i++)doc.nodes.push(question(`q${i}`,i?`q${i-1}`:doc.rootId,i===4998?'assumption':'decided'));
  doc.dependencies=[];
  for(let distance=1;doc.dependencies.length<10000;distance++)for(let i=distance;i<4999 && doc.dependencies.length<10000;i++)doc.dependencies.push({dependentId:`q${i}`,prerequisiteId:`q${i-distance}`});
  const result=inspect(doc);assert.equal(result.ids.size,5000);assert.ok(result.highlights.size<=4999);assert.ok(result.visitedLinks<=20000);
});
