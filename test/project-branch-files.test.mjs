import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { branchFileContext, branchFileBasis, suggestBranchFiles } from '../com.github.copilot/extensions/explorer/project-branch-files.mjs';

function fixture() {
  const doc = createDocument('Plan the product');
  addQuestions(doc, doc.rootId, [{ question: 'How should billing work?', category: 'Billing' }, { question: 'How should reminders work?', category: 'Reminders' }]);
  const brief = { sections: { purpose: [{ text: 'A scheduling product', kind: 'file-backed', sources: [] }], architecture: [], stack: [], conventions: [], constraints: [{ text: 'Keep data local', kind: 'file-backed', sources: [{ id: 'source-1', quote: 'LOCAL QUOTE NOT IN INVENTORY' }] }] }, sources: [{ id: 'source-1', name: 'docs/constraints.md' }] };
  return { doc, brief, billing: doc.nodes[1].id, reminders: doc.nodes[2].id };
}

test('branch file suggestions distinguish saved branches and retain explained shared constraints without excerpts', () => {
  const f = fixture(), a = branchFileContext(f.doc, f.billing, '', f.brief, 3), b = branchFileContext(f.doc, f.reminders, '', f.brief, 3);
  assert.match(a.match('src/billing.ts').reason, /saved question.*billing/i);
  assert.equal(a.match('src/reminders.ts'), null); assert.ok(b.match('src/reminders.ts')); assert.equal(b.match('src/billing.ts'), null);
  assert.match(a.match('docs/constraints.md').reason, /reviewed shared constraint/i);
  assert.equal(a.summary.briefRevision, 3); assert.ok(!JSON.stringify(a.summary).includes('QUOTE'));
  assert.match(branchFileContext(f.doc, f.billing, 'Invoice export', f.brief, 3).match('src/invoiceExport.ts').reason, /direction.*invoice.*export/i);
});

test('branch matching is bounded literal Unicode matching with honest empty results and no arbitrary file authority', () => {
  const f = fixture(), context = branchFileContext(f.doc, f.billing, '温度計 café', f.brief, 3);
  assert.ok(context.match('src/温度計.ts')); assert.ok(context.match('docs/café.md')); assert.equal(context.match('src/other.ts'), null);
  assert.throws(() => branchFileContext(f.doc, f.billing, 'x'.repeat(501), f.brief, 3), /direction/i);
  assert.throws(() => branchFileContext(f.doc, 'absent', '', f.brief, 3));
  assert.deepEqual(suggestBranchFiles([], context).suggested, []);
  assert.deepEqual(suggestBranchFiles([], context).omittedShared, ['docs/constraints.md']);
});

test('suggested scope respects read/excerpt budgets and reports omitted shared sources', () => {
  const f = fixture(), context = branchFileContext(f.doc, f.billing, '', f.brief, 3);
  const files = ['src/billing.ts', 'docs/constraints.md', 'billing/a.ts', 'billing/b.ts', 'billing/c.ts'].map(name => ({ name, bytes: 40000, ...context.match(name) }));
  const result = suggestBranchFiles(files, context);
  assert.deepEqual(result.suggested, ['src/billing.ts', 'docs/constraints.md', 'billing/a.ts']);
  assert.deepEqual(result.omittedShared, []); assert.equal(result.omitted, 2);
  assert.equal(suggestBranchFiles(files.map(file => ({ ...file, bytes: 9000 })), context).suggested.length, 4);
});

test('branch basis detects contributing edits while ignoring unrelated answers and preserves answer state', () => {
  const f = fixture(), before = branchFileBasis(f.doc, f.billing);
  f.doc.nodes[2].answer = 'Unrelated saved answer'; assert.deepEqual(branchFileBasis(f.doc, f.billing), before);
  f.doc.nodes[1].answer = 'Invoice monthly'; assert.notDeepEqual(branchFileBasis(f.doc, f.billing), before);
  const answered = branchFileBasis(f.doc, f.billing); f.doc.nodes[1].answerState = 'assumption'; assert.notDeepEqual(branchFileBasis(f.doc, f.billing), answered);
  const state = branchFileBasis(f.doc, f.billing); f.doc.objective = 'New objective'; assert.notDeepEqual(branchFileBasis(f.doc, f.billing), state);
});
