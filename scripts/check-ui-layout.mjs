// Real layout checks need an existing Playwright installation and the owner's Brave browser.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createDocument, addQuestions, answerNode, validateDocument } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';

if (!process.env.EXPLORER_PLAYWRIGHT_PATH) throw Error('Set EXPLORER_PLAYWRIGHT_PATH to an installed playwright/index.mjs; this check downloads nothing.');
const { chromium } = await import(pathToFileURL(resolve(process.env.EXPLORER_PLAYWRIGHT_PATH)).href);
const browserPath = process.env.BRAVE_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const output = resolve(process.argv[2] || '.preview-data/ui-layout');
const screenshots = process.argv.includes('--screenshots');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'explorer-ui-layout-')), file = join(directory, 'layout.explore.json');
const doc = createDocument('I want to build a neighborhood tool-sharing library');
const [parent, answered, leaf] = addQuestions(doc, doc.rootId, [
  { category: 'Long category for neighborhood logistics', question: 'Where will the tools be physically kept between loans, and who will open the storage room?', importance: 'high', importanceReason: 'Storage controls access.' },
  { category: 'Trust', question: 'How should neighbors handle a broken tool when repairs are expensive and replacement takes time?' },
  { category: 'Access', question: 'How can a neighbor arrange a collection when they cannot visit during normal opening hours?' },
]);
parent.generation = { requestId: 'layout-fixture', originalQuestion: parent.question, originalCategory: parent.category, adjusted: false };
for (const node of [parent, answered]) addQuestions(doc, node.id, [
  { category: 'Time', question: `When can we try the first step for ${node.category}?` },
  { category: 'People', question: `Who can help with ${node.category}?` },
]);
answerNode(doc, answered.id, 'Use the community center cupboard. Keep a spare key with two nearby neighbors and review this arrangement after the first month.', 'needs-evidence');
answered.review = true;
answered.revisit = { date: '2020-01-01', condition: 'After the first month', acknowledgedAt: null };
validateDocument(doc); await writeFile(file, JSON.stringify(doc));
let requests = 0, voiceReady = false, voiceJob;
const explorer = await new Explorer({ file, target: { instanceId: 'ui-layout-check' }, send: async () => { requests++; } }).load();
const server = await startServer(explorer, {
  status: async () => ({ ready: voiceReady, error: voiceReady ? '' : 'Dictation is disabled in this layout fixture.', shortcut: { code: 'Space', ctrl: true, alt: false, shift: false, meta: false }, label: 'Ctrl + Space', mode: 'push_to_talk' }),
  start(id) { return voiceJob = { id, phase: 'loading' }; },
  poll() { return voiceJob; },
  finish() { return voiceJob = { ...voiceJob, phase: 'transcribing' }; },
  cancel() { return voiceJob = { ...voiceJob, phase: 'cancelled' }; },
  close() {},
});
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const failures = [], samples = [];
const settle = page => page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
const expect = (condition, message, detail) => { if (!condition) failures.push({ message, detail }); };
async function inspectWorkspace(page, label, { scroll = false, answer = false } = {}) {
  const panel = await page.locator('#node-workspace').evaluate(el => ({ height: el.clientHeight, contentHeight: el.scrollHeight, overflow: getComputedStyle(el).overflowY }));
  expect(panel.contentHeight <= panel.height + 1 || ['auto', 'scroll'].includes(panel.overflow), `${label}: overflowing workspace is manually scrollable`, panel);
  const selectors = ['#save-answer', '#question-tools-toggle', ...(answer ? ['#answer'] : [])];
  for (const selector of selectors) {
    if (scroll) await page.locator(selector).scrollIntoViewIfNeeded();
    const bounds = await page.locator(selector).evaluate(el => {
      const r = el.getBoundingClientRect(), panel = document.getElementById('node-workspace').getBoundingClientRect(), map = document.getElementById('map').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, panelTop: panel.top, panelBottom: panel.bottom, mapTop: map.top, mapBottom: map.bottom, mapLeft: map.left, mapRight: map.right };
    });
    expect(bounds.top >= Math.max(bounds.panelTop, bounds.mapTop) && bounds.bottom <= Math.min(bounds.panelBottom, bounds.mapBottom) + 1 && bounds.left >= bounds.mapLeft && bounds.right <= bounds.mapRight, `${label}: ${selector} is reachable`, bounds);
  }
}
async function inspectCards(page, label) {
  const cards = await page.evaluate(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    return [...document.querySelectorAll('#nodes .node')].map(card => {
      const toggle = [...document.querySelectorAll('#nodes .branch-toggle')].find(t => t.dataset.branchId === card.dataset.nodeId);
      const scale = card.getBoundingClientRect().width / card.offsetWidth;
      const parts = ['.category', '.question', '.answer-preview', '.status'].map(selector => {
        const el = card.querySelector(selector);
        return el && getComputedStyle(el).display !== 'none' ? { selector, ...rect(el), line: parseFloat(getComputedStyle(el).lineHeight) * scale, lines: Math.min(2, Math.round(el.scrollHeight / parseFloat(getComputedStyle(el).lineHeight))) } : null;
      }).filter(Boolean);
      const foreground = luminance(getComputedStyle(card.querySelector('.status')).color), background = luminance(getComputedStyle(card).backgroundColor);
      return { id: card.dataset.nodeId, title: card.title, tier: document.getElementById('world').dataset.detail, card: rect(card), scale, parts, statusContrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05), toggle: toggle ? rect(toggle) : null };
    });
  });
  for (const sample of cards) {
    samples.push({ label, ...sample });
    if (sample.tier === 'schematic') continue;
    expect(sample.statusContrast >= 4.5, `${label}: small status text is readable`, { id: sample.id, contrast: sample.statusContrast });
    const { card, parts, toggle, scale } = sample;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], name = `${label}: ${sample.title}: ${p.selector}`;
      expect(p.x >= card.x && p.right <= card.right + .5 && p.y >= card.y && p.bottom <= card.bottom + .5, `${name} stays inside card`, sample);
      if (i) expect(p.y >= parts[i - 1].bottom - .5, `${name} does not overlap previous text`, sample);
      if (p.selector === '.question' || p.selector === '.answer-preview') {
        expect(p.height >= p.line * p.lines - 1, `${name} has complete visible lines`, sample);
      }
      if (toggle) {
        const overlaps = Math.min(p.right, toggle.right) - Math.max(p.x, toggle.x) > .5 && Math.min(p.bottom, toggle.bottom) - Math.max(p.y, toggle.y) > .5;
        expect(!overlaps, `${name} does not overlap branch button`, sample);
        if (p.selector === '.question' || p.selector === '.answer-preview') expect(p.bottom <= toggle.y - 4 * scale + .5, `${name} leaves space above branch controls`, sample);
      }
    }
    if (toggle) expect(toggle.x >= card.x && toggle.right <= card.right + .5 && toggle.y >= card.y && toggle.bottom <= card.bottom + .5, `${label}: branch button stays inside card`, sample);
  }
}
try {
  for (const scenario of [{ name: 'wide', width: 1200, height: 900, colorScheme: 'dark' }, { name: 'narrow', width: 460, height: 780, colorScheme: 'light' }, { name: 'short', width: 360, height: 640, colorScheme: 'dark' }, { name: 'minimum', width: 280, height: 640, colorScheme: 'light' }]) {
    voiceReady = false;
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, colorScheme: scenario.colorScheme });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => failures.push({ message: `${scenario.name}: page error`, detail: error.message }));
    try {
      await page.goto(server.url); await page.locator('#nodes .node.root').waitFor(); await settle(page);
      const topbar = await page.evaluate(() => {
        const brand = document.querySelector('.brand').getBoundingClientRect(), nav = document.querySelector('.topbar nav').getBoundingClientRect();
        return { brandRight: brand.right, brandBottom: brand.bottom, navX: nav.x, navY: nav.y, navRight: nav.right, width: innerWidth };
      });
      expect(topbar.navRight <= topbar.width && (topbar.brandRight <= topbar.navX || topbar.brandBottom <= topbar.navY), `${scenario.name}: top navigation fits without overlap`, topbar);
      for (const menu of ['file-menu', 'tools-menu']) {
        await page.locator(`#${menu} > summary`).click();
        const bounds = await page.locator(`#${menu} .menu-items`).boundingBox();
        expect(bounds.x >= 0 && bounds.x + bounds.width <= scenario.width + 1, `${scenario.name}: ${menu} fits viewport`, bounds);
        await page.keyboard.press('Escape');
      }
      for (const id of [doc.rootId, parent.id, answered.id, leaf.id]) {
        await page.locator('#outline-toggle').click(); await page.locator(`#outline-list [data-node-id="${id}"]`).click();
        await page.locator('#collapse-node').click(); await page.locator('#outline-toggle').click();
        await page.locator('#zoom-level').click(); await page.locator('#center-question').click(); await settle(page);
        if (screenshots && scenario.name === 'wide' && id === doc.rootId) await page.screenshot({ path: join(output, 'root-map.png') });
        await inspectCards(page, `${scenario.name}/detail/${id}`);
        const toggle = page.locator(`#nodes [data-branch-id="${id}"]`);
        if (await toggle.count()) {
          await toggle.click(); await settle(page); await inspectCards(page, `${scenario.name}/folded/${id}`);
          await toggle.click();
        }
        for (let step = 1; step <= 7; step++) {
          await page.locator('#zoom-out').click(); await settle(page);
          if ([1, 4, 7].includes(step)) await inspectCards(page, `${scenario.name}/zoom-${step}/${id}`);
          if (screenshots && scenario.name === 'wide' && id === answered.id && step === 4) await page.screenshot({ path: join(output, 'overview-map.png') });
        }
      }
      // The same writing controls remain usable after zoom and navigation.
      await page.locator('#outline-toggle').click(); await page.locator(`#outline-list [data-node-id="${parent.id}"]`).click();
      await page.locator('#outline-toggle').click(); await settle(page);
      const writing = await page.evaluate(() => {
        const answer = document.getElementById('answer').getBoundingClientRect(), content = document.querySelector('.node-content').getBoundingClientRect(), map = document.getElementById('map').getBoundingClientRect();
        return { visible: Math.max(0, Math.min(answer.bottom, content.bottom, map.bottom) - Math.max(answer.y, content.y, map.y)), saveBottom: document.getElementById('save-answer').getBoundingClientRect().bottom, shelfBottom: document.getElementById('question-tools-toggle').getBoundingClientRect().bottom, mapBottom: map.bottom };
      });
      expect(writing.visible >= (scenario.width < 320 ? 48 : 80), `${scenario.name}: unavailable voice leaves room to write`, writing);
      expect(writing.saveBottom <= writing.mapBottom + 1 && writing.shelfBottom <= writing.mapBottom + 1, `${scenario.name}: Save and shelf remain reachable`, writing);
      const editor = await page.locator('#answer').elementHandle(); await page.locator('#answer').fill('Keep this private draft');
      voiceReady = true;
      await page.locator('#answer').blur(); await page.locator('#answer').focus();
      await page.waitForFunction(() => !document.getElementById('voice-record').disabled);
      await page.locator('#voice-record').click();
      for (const phase of ['loading', 'listening', 'transcribing']) {
        voiceJob = { ...voiceJob, phase, elapsedMs: 1500, levels: [.2, .5, .8] };
        await page.waitForFunction(phase => document.getElementById('voice-feedback').dataset.phase === phase, phase); await settle(page);
        const feedback = await page.evaluate(() => {
          const answer = document.getElementById('answer').getBoundingClientRect(), label = document.querySelector('.answer-label').getBoundingClientRect(), actions = document.querySelector('.voice-actions').getBoundingClientRect(), feedback = document.getElementById('voice-feedback').getBoundingClientRect();
          return { answerTop: answer.top, answerBottom: answer.bottom, labelRight: label.right, actionsLeft: actions.left, actionsBottom: actions.bottom, feedbackTop: feedback.top, labelHeight: label.height };
        });
        expect(feedback.feedbackTop >= feedback.answerBottom && feedback.actionsBottom <= feedback.answerTop && feedback.actionsLeft >= feedback.labelRight && feedback.labelHeight < 40, `${scenario.name}/${phase}: voice controls and feedback leave writing unobscured`, feedback);
        await inspectWorkspace(page, `${scenario.name}/${phase}`);
      }
      await page.locator('#voice-cancel').click();
      await page.locator('#question-tools-toggle').click();
      await settle(page); await inspectWorkspace(page, `${scenario.name}/open-shelf`);
      await page.locator('#revisit-editor > summary').click(); await page.locator('#revisit-condition').fill('After our pilot');
      await page.locator('#revisit-condition').press('Escape'); await page.locator('#navigation-open').click(); await page.locator('#navigation-cancel').click();
      expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: editor and draft survive`, {});
      expect(await page.locator('#revisit-condition').inputValue() === 'After our pilot', `${scenario.name}: reminder draft survives`, {});
      if (screenshots && scenario.name === 'minimum') await page.screenshot({ path: join(output, 'minimum-pane.png') });
      // Error banners reduce the space available to the editor. Fixture content, no user data.
      await page.evaluate(() => { const notice = document.getElementById('notice'); notice.textContent = 'The saved journey changed in another window. Your answer draft is still here. Refresh the saved journey before trying to save this answer again.'; notice.hidden = false; });
      await settle(page);
      if (await page.locator('#node-workspace.scroll-pane').count()) {
        await page.locator('#node-workspace').evaluate(el => { el.scrollTop = 0; });
        const bounds = await page.locator('#node-workspace').boundingBox(), zoom = await page.locator('#zoom-level').innerText();
        await page.mouse.move(bounds.x + 4, bounds.y + bounds.height / 2); await page.mouse.wheel(0, 200);
        await page.waitForFunction(() => document.getElementById('node-workspace').scrollTop > 0);
        expect(await page.locator('#zoom-level').innerText() === zoom, `${scenario.name}: scrolling the short card does not zoom the map`, {});
      }
      await inspectWorkspace(page, `${scenario.name}/notice`, { scroll: true, answer: true });
      await page.locator('#question-tools-toggle').click(); await settle(page);
      await inspectWorkspace(page, `${scenario.name}/notice-open-shelf`, { scroll: true });
      if (screenshots && scenario.name === 'minimum') await page.screenshot({ path: join(output, 'minimum-notice.png') });
      if (scenario.name === 'minimum') {
        await page.locator('#save-deeper').click(); await page.locator('#cancel-request').waitFor(); await settle(page);
        await page.locator('#node-workspace').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await page.locator('#request-status').click(); await settle(page);
        const reveal = await page.locator('#question-tools-body').evaluate(el => {
          const body = el.getBoundingClientRect(), panel = document.getElementById('node-workspace').getBoundingClientRect();
          return { top: body.top, panelTop: panel.top, panelBottom: panel.bottom };
        });
        expect(reveal.top >= reveal.panelTop && reveal.top < reveal.panelBottom - 36, 'minimum: request navigation reveals the shelf beginning in the outer scroller', reveal);
        await page.locator('#node-workspace').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ category: 'Next', question: 'What can we try first?' }] });
        await page.locator('#question-preview').waitFor(); await settle(page);
        const preview = await page.locator('#preview-title').evaluate(el => {
          const title = el.getBoundingClientRect(), panel = document.getElementById('node-workspace').getBoundingClientRect();
          return { top: title.top, bottom: title.bottom, panelTop: panel.top, panelBottom: panel.bottom };
        });
        expect(preview.top >= preview.panelTop && preview.bottom <= preview.panelBottom, 'minimum: a new preview reveals its heading in the outer scroller', preview);
        const child = doc.nodes.find(n => n.parentId === parent.id);
        await page.locator(`#followup-${child.id}`).click(); await settle(page);
        expect(await page.locator('#node-workspace').evaluate(el => el.scrollTop) === 0, 'minimum: a different question starts at its heading', {});
      }
      console.log(`${scenario.name}: checked cards, four zoom tiers, folding, menus and editor retention`);
    } catch (error) {
      await page.screenshot({ path: join(output, `${scenario.name}-failure.png`) });
      console.log(await page.locator('body').innerText()); throw error;
    } finally { await context.close(); }
  }
  assert.equal(requests, 1, 'only the explicit Explore deeper check reaches the local send fixture; no provider is called');
  await writeFile(join(output, 'layout-results.json'), JSON.stringify({ samples, failures }, null, 2));
  console.log(`${samples.length} card samples; ${failures.length} layout failures. Evidence: ${output}`);
  for (const failure of failures.slice(0, 16)) console.log(failure.message);
  assert.equal(failures.length, 0, 'UI layout must not obscure text or controls; see layout-results.json');
} finally {
  await browser.close(); await server.close(); await explorer.close();
  assert.equal(dirname(directory), resolve(tmpdir())); await rm(directory, { recursive: true, force: true });
}
