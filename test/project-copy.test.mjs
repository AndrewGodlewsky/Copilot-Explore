import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectRepository } from '../com.github.copilot/extensions/explorer/project-repository.mjs';
import { ProjectCopy } from '../com.github.copilot/extensions/explorer/project-copy.mjs';
import { createDocument, addQuestions, FORMAT } from '../com.github.copilot/extensions/explorer/model.mjs';
import { projectStorageContext } from '../com.github.copilot/extensions/explorer/storage-context.mjs';
import { ProjectJourney } from '../com.github.copilot/extensions/explorer/project-journey.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { prepareBrief, parseBrief, acceptBrief, briefFreshness } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareHandoff, parseHandoff, acceptHandoff } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';
const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explorer-copy-')); t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout'), local = join(root, 'private'); await mkdir(checkout); await mkdir(local);
  await exec('git', ['-C', checkout, 'init', '-q'], { windowsHide: true }); let cwd = checkout;
  const repository = new ProjectRepository({ readRoot: async () => cwd, localDirectory: local });
  const doc = createDocument('Share this'); addQuestions(doc, doc.rootId, [{ question: 'Which option?', category: 'Scope' }]);
  doc.nodes[1].answer = '  Exact Unicode answer: 日本語  '; doc.nodes[1].research = { basis: 'sources', summary: 'Recorded comparison', options: ['A', 'B'].map(title => ({ title, description: title, pros: [], cons: [] })), recommendation: 'A', uncertainty: 'Historical observation', sources: [{ id: 's1', title: 'Evidence', url: 'https://example.org/', retrievedAt: '2026-11-18T00:00:00.000Z', provenance: 'recorded-read' }], claims: [{ id: 'c1', text: 'Recorded claim', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Supports claim' }], limitations: 'May change' }] };
  let source = JSON.stringify(doc); const copy = new ProjectCopy(repository, async () => source);
  return { root, checkout, local, repository, doc, copy, source: () => source, change: value => { source = value; }, cwd: value => { cwd = value; } };
}
test('project copy previews exact committed text with lineage and optional node research; clone retains content', async t => {
  const f = await fixture(t), original = f.source();
  const preview = await f.copy.preview({ folder: '.explorer/journeys', includeResearch: false, newCopy: false });
  const expected = JSON.parse(preview.content); assert.notEqual(expected.journey.id, f.doc.id);
  assert.equal(expected.journey.copyOrigin.sourceId, f.doc.id); assert.equal(expected.journey.nodes[1].answer, f.doc.nodes[1].answer);
  assert.equal(expected.journey.nodes[1].research, null); assert.equal(expected.journey.rootId, f.doc.rootId);
  assert.deepEqual(await readdir(f.checkout), ['.git']);
  const saved = await f.copy.confirm(preview.id); assert.equal(saved.path, preview.path); assert.equal(f.source(), original);
  assert.equal(await readFile(join(f.checkout, saved.path), 'utf8'), preview.content);
  const clone = join(f.root, 'clone'); await mkdir(clone); await exec('git', ['-C', clone, 'init', '-q'], { windowsHide: true });
  await mkdir(dirname(join(clone, saved.path)), { recursive: true }); await writeFile(join(clone, saved.path), preview.content); f.cwd(clone);
  const opened = await f.repository.open(saved.path); assert.equal(opened.document.nodes[1].answer, f.doc.nodes[1].answer);
  assert.deepEqual(opened.document.copyOrigin, expected.journey.copyOrigin);
});
test('lost responses and fresh previews find one identical copy; divergent copies require explicit additional copy', async t => {
  const f = await fixture(t), options = { folder: '.explorer/journeys', includeResearch: true, newCopy: false };
  const preview = await f.copy.preview(options); await f.copy.confirm(preview.id); await f.copy.confirm(preview.id);
  assert.deepEqual(JSON.parse(preview.content).journey.nodes[1].research, f.doc.nodes[1].research);
  const again = await new ProjectCopy(f.repository, async () => f.source()).preview(options);
  assert.equal(again.path, preview.path); assert.equal(again.existing, true);
  assert.equal((await readdir(dirname(join(f.checkout, preview.path)))).length, 1);
  const store = await f.repository.open(preview.path), changed = structuredClone(store.document); changed.nodes[1].answer = 'Shared edit';
  await store.save(changed, { baseDigest: store.baseDigest }); const bytes = await readFile(store.context.file);
  await assert.rejects(f.copy.confirm(preview.id), /different|changed|additional/i);
  await assert.rejects(f.copy.preview(options), /different|changed|additional/i); assert.deepEqual(await readFile(store.context.file), bytes);
  const extra = await f.copy.preview({ ...options, newCopy: true }); assert.notEqual(extra.path, preview.path);
  await f.copy.confirm(extra.id); await f.copy.confirm(extra.id); assert.equal((await readdir(dirname(store.context.file))).length, 2);
});
test('source edits, changed checkout and replaced existing destination parent reject confirmation', async t => {
  const f = await fixture(t), options = { folder: 'maps', includeResearch: true, newCopy: false };
  await mkdir(join(f.checkout, 'maps')); const preview = await f.copy.preview(options);
  f.change(f.source() + '\n'); await assert.rejects(f.copy.confirm(preview.id), /source|changed/i);
  assert.deepEqual(await readdir(join(f.checkout, 'maps')), []);
  f.change(JSON.stringify(f.doc)); const next = await f.copy.preview(options);
  await rename(join(f.checkout, 'maps'), join(f.checkout, 'old')); await mkdir(join(f.checkout, 'maps'));
  await assert.rejects(f.copy.confirm(next.id), /identity|changed/i); assert.deepEqual(await readdir(join(f.checkout, 'maps')), []);
  const last = await f.copy.preview(options); f.cwd(f.root); await assert.rejects(f.copy.confirm(last.id), /project|repository|changed/i);
});
test('copy rejects malformed selections, unknown content and invalid paths without writing', async t => {
  const f = await fixture(t), options = { folder: 'maps', includeResearch: true, newCopy: false };
  for (const changes of [{ includeResearch: 'yes' }, { newCopy: 1 }, { folder: '../outside' }, { folder: null }]) await assert.rejects(f.copy.preview({ ...options, ...changes }));
  f.change(JSON.stringify({ ...f.doc, privateThing: 'never omit silently' })); await assert.rejects(f.copy.preview(options), /unsupported/);
  assert.deepEqual(await readdir(f.checkout), ['.git']);
  f.change(JSON.stringify({ ...f.doc, copyOrigin: { kind: 'personal-copy', sourceId: 'x', sourceDigest: 'bad' } })); await assert.rejects(f.copy.preview(options), /origin|lineage/i);
});
test('failed destination write preserves original and retries the same prepared identity with retained history', async t => {
  const f = await fixture(t), source = f.source(), preview = await f.copy.preview({ folder: 'maps', includeResearch: true, newCopy: false });
  const create = f.repository.createSelected.bind(f.repository);
  f.repository.createSelected = async (document, selected, options) => {
    await f.repository.prepareParents(selected);
    const context = await projectStorageContext({ ...selected, journeyId: document.id });
    return new ProjectJourney(context, { write: async () => { throw Error('Injected write failure'); } }).create(document, options);
  };
  await assert.rejects(f.copy.confirm(preview.id), /Injected write failure/);
  assert.equal(f.source(), source); assert.deepEqual(await readdir(join(f.checkout, 'maps')), []);
  f.repository.createSelected = create; await f.copy.confirm(preview.id);
  assert.equal(await readFile(join(f.checkout, preview.path), 'utf8'), preview.content);
});
test('accepted artifacts retain historical evidence and references when node research is omitted', async t => {
  const f = await fixture(t), sections = JSON.stringify({ goal: [], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] });
  f.doc.brief = acceptBrief(parseBrief(sections, prepareBrief(f.doc)), []);
  f.doc.handoff = acceptHandoff(parseHandoff(sections, prepareHandoff(f.doc, { nodeIds: [f.doc.nodes[1].id], format: 'plan', includeEvidence: true })), []);
  f.change(JSON.stringify(f.doc)); const preview = await f.copy.preview({ folder: 'maps', includeResearch: false, newCopy: false });
  const copied = JSON.parse(preview.content).journey;
  assert.deepEqual(copied.brief, f.doc.brief); assert.deepEqual(copied.handoff, f.doc.handoff);
  assert.equal(copied.nodes[1].research, null); assert.equal(copied.handoff.evidence[0].nodeId, copied.nodes[1].id);
  assert.equal(briefFreshness(copied.brief, copied), 'stale'); await f.copy.confirm(preview.id);
});
test('existing identical formatting is previewed exactly and subsequent byte changes require another preview', async t => {
  const f = await fixture(t), options = { folder: 'maps', includeResearch: true, newCopy: false };
  const first = await f.copy.preview(options); await f.copy.confirm(first.id);
  const file = join(f.checkout, first.path), reformatted = JSON.stringify(JSON.parse(first.content)); await writeFile(file, reformatted);
  const reviewed = await f.copy.preview(options); assert.equal(reviewed.content, reformatted); await f.copy.confirm(reviewed.id);
  await writeFile(file, reformatted + '\n'); await assert.rejects(f.copy.confirm(reviewed.id), /bytes changed/);
  assert.equal(await readFile(file, 'utf8'), reformatted + '\n');
});
test('controller rejects stale previews and switched sources while preserving personal files and drafts', async t => {
  const f = await fixture(t), library = new Library(f.local), personal = await library.import(f.doc);
  const e = await new Explorer({ library, binding: 'copy-controller', projectRoot: async () => f.checkout }).load(); t.after(() => e.close());
  await e.command('open', { key: personal.key });
  const request = input => e.projectCopyRequest({ journey: e.activeKey, revision: e.doc.revision, ...input });
  const preview = await request({ action: 'preview', folder: 'maps', includeResearch: true, newCopy: false });
  await e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: 'New committed answer' });
  const original = await readFile(e.file);
  await assert.rejects(request({ action: 'confirm', id: preview.id }), /source changed/i); assert.deepEqual(await readFile(e.file), original);
  const other = await library.import(createDocument('Another journey'));
  await e.command('open', { key: other.key, revision: e.doc.revision });
  await assert.rejects(request({ action: 'confirm', id: preview.id }), /expired/i);
  assert.deepEqual(await readdir(f.checkout), ['.git']);
});
test('ordinary copies into distinct folders have independent identities and private state', async t => {
  const f = await fixture(t), options = { includeResearch: true, newCopy: false };
  const a = await f.copy.preview({ ...options, folder: 'maps-a' }); await f.copy.confirm(a.id);
  const b = await f.copy.preview({ ...options, folder: 'maps-b' }); await f.copy.confirm(b.id);
  const first = await f.repository.open(a.path), second = await f.repository.open(b.path);
  assert.notEqual(first.document.id, second.document.id); assert.notEqual(first.context.directory, second.context.directory);
  const edited = structuredClone(first.document); edited.nodes[1].answer = 'Edited only A'; await first.save(edited, { baseDigest: first.baseDigest });
  assert.equal((await f.repository.open(b.path)).document.nodes[1].answer, f.doc.nodes[1].answer);
  const retry = await f.copy.preview({ ...options, folder: 'maps-b' }); assert.equal(retry.path, b.path);
});
