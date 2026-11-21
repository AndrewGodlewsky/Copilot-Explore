import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument, addQuestions } from '../com.github.copilot/extensions/explorer/model.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { fixtureResearchModels } from '../test/helpers/research-model.mjs';

export async function checkConversationsUI(browser, inspectDrawer, output) {
  const directory = await mkdtemp(join(tmpdir(), 'explorer-conversation-ui-')), library = new Library(directory);
  const doc = createDocument('Synthetic private conversation recovery'), questions = addQuestions(doc, doc.rootId, [{ question: 'First private question?', category: 'Choice' }, { question: 'Second private question?', category: 'Choice' }]);
  const claims = [{ id: 'c1', text: 'A small pilot is an option.', basis: 'reasoning', evidence: [], limitations: 'Synthetic judgment; no provider used.' }];
  for (const node of questions) node.research = { basis: 'reasoning', summary: 'Synthetic comparison', options: [{ title: 'Pilot', description: 'Small', pros: [], cons: [] }, { title: 'Launch', description: 'Larger', pros: [], cons: [] }], recommendation: 'Consider a pilot.', uncertainty: 'Unverified fixture.', sources: [], claims };
  const record = await library.import(doc), context = await browser.newContext({ viewport: { width: 720, height: 800 } });
  const errors = []; context.on('page', value => value.on('pageerror', error => errors.push(error.message)));
  let explorer, server, page, calls = 0;
  const open = async () => {
    explorer = await new Explorer({ library, binding: 'private-conversation-ui', researcher: { models: fixtureResearchModels, runFollowup: async (_, { prepared }) => {
      calls++; return { answer: 'Private fixture reply: ' + prepared.followup.question, uncertainty: 'No external evidence.', claims, sources: [] };
    } } }).load();
    await explorer.attach(record.key);
    server = await startServer(explorer, { status: async () => ({ ready: false }), close() {} });
    page = await context.newPage(); await page.goto(server.url); await page.locator('#map-title').filter({ hasText: doc.topic }).waitFor();
  };
  const select = async node => {
    if (!await page.locator('#outline-list').isVisible()) await page.locator('#outline-toggle').click();
    await page.locator(`#outline-list [data-node-id="${node.id}"]`).click();
    if (!await page.locator('#question-drawer').isVisible()) await page.locator('#question-tools-toggle').click();
    await page.locator('[data-tool-tab="research"]').click();
    await page.waitForFunction(() => /Draft saved privately/.test(document.getElementById('conversation-save-status')?.textContent));
  };
  const waitDraft = text => page.waitForFunction(expected => document.getElementById('followup-question')?.value === expected && /Draft saved privately/.test(document.getElementById('conversation-save-status')?.textContent), text);
  try {
    await open();
    for (const [index, node] of questions.entries()) {
      await select(node);
      await page.locator('#followup-question').fill(`PRIVATE_BROWSER_${index} 日本語 🌿`); await waitDraft(`PRIVATE_BROWSER_${index} 日本語 🌿`);
      await page.locator('#followup-review').click(); await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      await page.locator('#research-review-start').click(); await page.waitForFunction(index => document.getElementById('followup-history').textContent.includes(`Private fixture reply: PRIVATE_BROWSER_${index}`), index);
    }
    assert.equal(calls, 2);
    const composer = page.locator('#followup-question');
    await composer.focus(); await composer.evaluate(el => el.setSelectionRange(2, 8));
    const refresh = page.waitForResponse(response => response.url().endsWith('/api/research-conversations') && response.request().postDataJSON()?.action === 'read');
    const changed = structuredClone(explorer.doc); changed.nodes[0].category = 'Updated fixture category'; await explorer.save(changed);
    await refresh;
    await page.waitForFunction(() => !/Loading/.test(document.getElementById('conversation-save-status').textContent));
    assert.deepEqual(await composer.evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el })), { start: 2, end: 8, focused: true });
    await select(questions[0]); await waitDraft('PRIVATE_BROWSER_0 日本語 🌿');
    assert.match(await page.locator('#followup-history').innerText(), /PRIVATE_BROWSER_0/); assert.doesNotMatch(await page.locator('#followup-history').innerText(), /PRIVATE_BROWSER_1/);
    await inspectDrawer(page, 'private-conversation/navigation');
    await page.close(); await server.close(); await explorer.close();
    await open();
    for (const [index, node] of questions.entries()) {
      await select(node); await waitDraft(`PRIVATE_BROWSER_${index} 日本語 🌿`);
      assert.match(await page.locator('#followup-history').innerText(), new RegExp(`PRIVATE_BROWSER_${index}`));
    }
    assert.equal(calls, 2, 'controller restart and text recovery start no model request');
    assert.equal((await readFile(explorer.file, 'utf8')).includes('PRIVATE_BROWSER'), false);
    const native = await explorer.nativeSnapshot(); assert.equal(native.document.id, explorer.doc.id);
    assert.equal(JSON.stringify([native, explorer.snapshot()]).includes('PRIVATE_BROWSER'), false);
    await page.waitForFunction(() => !document.getElementById('followup-clear')?.disabled);
    await page.locator('#followup-clear').focus(); await page.keyboard.press('Enter'); await page.locator('#followup-clear').waitFor({ state: 'detached' });
    await waitDraft('PRIVATE_BROWSER_1 日本語 🌿');
    assert.equal((await explorer.conversations.binding(explorer).store.read(explorer.conversations.key(explorer, explorer.doc, questions[1].id))).entry.history, null);
    await page.locator('#conversation-delete').focus(); await page.keyboard.press('Enter'); await waitDraft('');
    await page.reload(); await select(questions[1]); await waitDraft('');
    assert.equal(await page.locator('#followup-history').innerText(), ''); assert.equal(calls, 2);
    const nodeId = questions[1].id, oldKey = explorer.conversations.key(explorer, explorer.doc, nodeId);
    let releaseDraft, heldDraft; const held = new Promise(resolve => { heldDraft = resolve; });
    await page.route('**/api/research-conversations', async route => {
      const input = route.request().postDataJSON();
      if (!releaseDraft && input.action === 'draft' && input.research === oldKey.research) {
        await new Promise(resolve => { releaseDraft = resolve; heldDraft(); });
      }
      await route.continue();
    });
    const earlierText = 'PRIVATE_EARLIER_DRAFT ' + 'long-reference-'.repeat(40);
    await page.locator('#followup-question').fill(earlierText); await held;
    const replacement = structuredClone(explorer.doc); replacement.nodes.find(node => node.id === nodeId).research.summary = 'Changed while earlier draft was saving'; await explorer.save(replacement);
    await page.waitForFunction(() => document.querySelector('.research')?.textContent.includes('Changed while earlier draft was saving'));
    await waitDraft(earlierText); releaseDraft();
    const localRecovery = page.locator('#conversation-local-recovery'); await localRecovery.waitFor({ state: 'visible' });
    assert.ok((await localRecovery.innerText()).includes(earlierText));
    for (const width of [340, 720]) {
      await page.setViewportSize({ width, height: 600 });
      await localRecovery.getByRole('button', { name: 'Save this earlier draft' }).focus();
      await inspectDrawer(page, `private-conversation/recovery-${width}`);
    }
    const recoveredDraft = page.waitForResponse(response => response.url().endsWith('/api/research-conversations') && response.request().postDataJSON()?.action === 'draft' && response.request().postDataJSON().research === oldKey.research);
    await page.keyboard.press('Enter'); assert.equal((await recoveredDraft).status(), 200); await localRecovery.waitFor({ state: 'hidden' });
    assert.equal((await explorer.conversations.binding(explorer).store.read(oldKey)).entry.draft.question, earlierText);
    assert.equal(await page.locator('#followup-question').inputValue(), earlierText); assert.equal(calls, 2);
    await page.unroute('**/api/research-conversations');
    await page.waitForFunction(() => document.activeElement.id === 'followup-question');
    const store = explorer.conversations.binding(explorer).store;
    let index = 1;
    while ((await store.list()).length < 128) {
      const key = { ...oldKey, research: (index++).toString(16).padStart(64, '0') };
      await store.saveDraft(key, { question: 'Capacity fixture', hypothetical: false, sourceMode: 'existing' }, (await store.read(key)).guard);
    }
    const atCapacity = structuredClone(explorer.doc); atCapacity.nodes.find(node => node.id === nodeId).research.summary = 'New research at private storage capacity'; await explorer.save(atCapacity);
    await page.waitForFunction(() => document.getElementById('conversation-save-status').textContent.includes('storage is full'));
    assert.equal(await page.locator('#followup-question').inputValue(), earlierText);
    await page.getByText('Manage private conversations', { exact: true }).click();
    await page.locator('#conversation-inventory-load').click();
    const inventory = page.locator('#conversation-inventory'); await inventory.getByText('128 of 128 records.', { exact: false }).waitFor();
    const deleteOther = inventory.locator('.research-claim').filter({ hasText: 'question ' + questions[0].id.slice(0, 8) }).getByRole('button', { name: 'Delete this saved record' });
    await deleteOther.focus(); await page.keyboard.press('Enter'); await inventory.getByText('Deleted.', { exact: false }).waitFor();
    const savedAfterCleanup = page.waitForResponse(response => response.url().endsWith('/api/research-conversations') && response.request().postDataJSON()?.action === 'draft');
    await page.locator('#conversation-keep').click(); assert.equal((await savedAfterCleanup).status(), 200); await waitDraft(earlierText);
    assert.equal((await store.list()).length, 128); assert.equal(calls, 2, 'capacity cleanup and draft recovery use no inference');
    await inspectDrawer(page, 'private-conversation/capacity-recovery');
    assert.deepEqual(errors, [], 'private conversation pages have no unhandled errors');
    console.log('Private conversations: two questions restored across controller restart, scoped drafts/history, explicit clear/delete, caret preservation, visible older-draft CAS recovery, full-capacity cleanup/retry and no additional inference passed.');
  } catch (error) {
    if (page && !page.isClosed()) { if (output) await page.screenshot({ path: join(output, 'private-conversation-failure.png') }); console.log(await page.locator('body').innerText()); }
    throw error;
  } finally {
    await context.close(); await server?.close(); await explorer?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); await rm(directory, { recursive: true, force: true });
  }
}
