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
parent.research = { optionsVersion: 1, basis: 'reasoning', summary: 'Synthetic saved options for layout checks.', options: [
  { id: 'cupboard', title: 'A small shared cupboard', description: '日本語 🌿 A long explanation with an unbroken reference: ' + 'abcdefghλ'.repeat(32), fit: 'When one location can serve the neighborhood.', proposedAnswer: 'I will try a shared cupboard.', pros: ['Simple handovers'], cons: ['Limited availability'], details: [{ label: 'Review', value: 'Review access after one month.' }] },
  { id: 'distributed', title: 'Several storage locations', description: 'Compare another approach while keeping a private answer draft.', fit: 'When nearby access matters more than simple coordination.', proposedAnswer: 'I will arrange several nearby storage locations.', pros: ['Nearby access'], cons: ['More coordination'] },
], recommendation: 'Consider a small pilot first; the shared location still needs evidence.', recommendationAssessment: { optionId: 'cupboard', mainTradeoff: 'A single location makes access depend on its key holders.', reconsiderIf: 'If neighbors cannot reliably reach one location, consider distributed storage.', decisionRefs: [{ nodeId: answered.id, reason: 'The earlier cupboard answer is unresolved and needs review; confirm access before committing. 中文 🌿', answerState: 'needs-evidence', review: true }] }, uncertainty: 'Synthetic fixture; no external verification.', sources: [], claims: [{ id: 'access', text: 'Local access is unconfirmed.', basis: 'unknown', evidence: [], limitations: 'Synthetic fixture; no real evidence.' }] };
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
async function revealMapControl(page, control) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const direction = await control.evaluate(el => {
      const r = el.getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect();
      if (r.bottom > Math.min(m.bottom, innerHeight) - 2) return 'ArrowDown';
      if (r.top < Math.max(m.top, 0) + 2) return 'ArrowUp';
      if (r.right > Math.min(m.right, innerWidth) - 2) return 'ArrowRight';
      if (r.left < Math.max(m.left, 0) + 2) return 'ArrowLeft';
      return null;
    });
    if (!direction) return;
    await page.locator('#map').focus(); await page.keyboard.press(direction); await settle(page);
  }
  throw Error('Map control could not be reached with bounded keyboard panning.');
}
async function inspectDrawer(page, label) {
  const layout = await page.locator('#question-drawer').evaluate(drawer => {
    const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const body = document.getElementById('question-tools-body');
    return { drawer: rect(drawer), host: rect(drawer.parentElement), viewport: { width: innerWidth, height: innerHeight },
      insideCard: !!drawer.closest('#node-workspace'), insideWorld: !!drawer.closest('#world'),
      body: rect(body), scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, overflow: getComputedStyle(body).overflowY,
      controls: ['#question-drawer-close', '#question-drawer-size', '[data-tool-tab][aria-selected="true"]', ...(document.getElementById('research-answer-draft')?.hidden === false ? ['#research-answer-draft'] : [])].map(s => ({ selector: s, ...rect(document.querySelector(s)) })) };
  });
  expect(!layout.insideCard && !layout.insideWorld, `${label}: drawer is outside the card and zoomed map`, layout);
  expect(layout.drawer.left >= -1 && layout.drawer.right <= layout.viewport.width + 1 && layout.drawer.width >= layout.host.width - 2, `${label}: drawer uses the full available screen width`, layout);
  expect(layout.drawer.bottom <= Math.min(layout.host.bottom, layout.viewport.height) + 1, `${label}: drawer stays above the footer`, layout);
  for (const control of layout.controls) expect(control.top >= layout.drawer.top && control.bottom <= layout.drawer.bottom && control.left >= layout.drawer.left && control.right <= layout.drawer.right, `${label}: ${control.selector} remains reachable`, layout);
  expect(layout.clientHeight > 40 && (layout.scrollHeight <= layout.clientHeight + 1 || ['auto', 'scroll'].includes(layout.overflow)), `${label}: tools have a usable scrolling area`, layout);
}
async function inspectWorkspace(page, label, { scroll = false, answer = false } = {}) {
  const panel = await page.locator('#node-workspace').evaluate(el => ({ height: el.clientHeight, contentHeight: el.scrollHeight, overflow: getComputedStyle(el).overflowY, scrollPane: el.classList.contains('scroll-pane'), children: [...el.children].map(child => ({ class: child.className, height: child.getBoundingClientRect().height, scrollHeight: child.scrollHeight, overflow: getComputedStyle(child).overflowY })) }));
  expect(panel.contentHeight <= panel.height + 1 || ['auto', 'scroll'].includes(panel.overflow), `${label}: overflowing workspace is manually scrollable`, panel);
  const selectors = ['#save-answer', '#question-tools-toggle', '#question-help-open', ...(answer ? ['#answer'] : [])];
  for (const selector of selectors) {
    if (scroll || panel.scrollPane) await page.locator(selector).scrollIntoViewIfNeeded();
    const bounds = await page.locator(selector).evaluate(el => {
      const r = el.getBoundingClientRect(), panel = document.getElementById('node-workspace').getBoundingClientRect(), map = document.getElementById('map').getBoundingClientRect(), view = document.getElementById('working-view').getBoundingClientRect(), stage = (document.getElementById('question-stage') ?? document.querySelector('.map-section')).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, panelTop: panel.top, panelBottom: panel.bottom, mapTop: Math.max(map.top, view.top, stage.top), mapBottom: Math.min(map.bottom, view.bottom, stage.bottom), mapLeft: Math.max(map.left, view.left, stage.left), mapRight: Math.min(map.right, view.right, stage.right) };
    });
    const top = Math.max(bounds.panelTop, bounds.mapTop), bottom = Math.min(bounds.panelBottom, bounds.mapBottom);
    const visible = Math.min(bounds.bottom, bottom) - Math.max(bounds.top, top);
    const vertical = selector === '#answer' ? visible >= Math.min(48, bottom - top - 4) : bounds.top >= top && bounds.bottom <= bottom + 1;
    expect(vertical && bounds.left >= bounds.mapLeft && bounds.right <= bounds.mapRight, `${label}: ${selector} is reachable`, bounds);
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
  for (const scenario of [{ name: 'wide', width: 1200, height: 900, colorScheme: 'dark' }, { name: 'narrow', width: 460, height: 780, colorScheme: 'light' }, { name: 'short', width: 360, height: 640, colorScheme: 'dark' }, { name: 'low-height', width: 720, height: 480, colorScheme: 'light' }, { name: 'minimum', width: 280, height: 640, colorScheme: 'light' }]) {
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
          await revealMapControl(page, toggle);
          await toggle.click(); await settle(page); await inspectCards(page, `${scenario.name}/folded/${id}`);
          await revealMapControl(page, toggle);
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
      if (await page.locator('#node-workspace.scroll-pane').count()) await page.locator('#answer').scrollIntoViewIfNeeded();
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-writing.png`) });
      const writing = await page.evaluate(() => {
        const answer = document.getElementById('answer').getBoundingClientRect(), content = document.querySelector('.node-content').getBoundingClientRect(), map = document.getElementById('map').getBoundingClientRect();
        return { visible: Math.max(0, Math.min(answer.bottom, content.bottom, map.bottom) - Math.max(answer.y, content.y, map.y)), scrollPane: document.getElementById('node-workspace').classList.contains('scroll-pane') };
      });
      expect(writing.visible >= (scenario.width < 320 || writing.scrollPane ? 48 : 80), `${scenario.name}: unavailable voice leaves room to write`, writing);
      await inspectWorkspace(page, `${scenario.name}/writing`);
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
      const assistanceCalls = [], observeAssistance = request => {
        if (request.method() === 'POST' && /\/api\/(action|question-help|research-review)$/.test(new URL(request.url()).pathname)) assistanceCalls.push(request.url());
      };
      page.on('request', observeAssistance);
      await page.locator('#question-help-open').focus(); await page.keyboard.press('Enter'); await settle(page);
      expect(await page.locator('#research-workspace-question').evaluate(el => el === document.activeElement), `${scenario.name}: keyboard help entry focuses the Research question`, {});
      expect(await page.locator('#question-tab-research').getAttribute('aria-selected') === 'true', `${scenario.name}: one help action opens Research`, {});
      await page.keyboard.press('Escape'); await settle(page);
      const helpReturn = await page.locator('#question-help-open').evaluate(el => {
        const rect = el.getBoundingClientRect(); let top = 0, bottom = innerHeight;
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowY)) {
            const bounds = parent.getBoundingClientRect(); top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
          }
        }
        return { focused: document.activeElement === el, top: rect.top, bottom: rect.bottom, clipTop: top, clipBottom: bottom };
      });
      expect(helpReturn.focused && helpReturn.top >= helpReturn.clipTop - 1 && helpReturn.bottom <= helpReturn.clipBottom + 1, `${scenario.name}: Escape visibly returns focus to Help me answer without test scrolling`, helpReturn);
      await page.keyboard.press('Enter'); await settle(page);
      expect(assistanceCalls.length === 0, `${scenario.name}: help entry and return start no operation or request review`, assistanceCalls);
      page.off('request', observeAssistance);
      await inspectDrawer(page, `${scenario.name}/drawer`);
      await inspectWorkspace(page, `${scenario.name}/drawer-card`, { scroll: true });
      await page.locator('[data-tool-tab="research"]').click();
      await settle(page); await inspectDrawer(page, `${scenario.name}/research-compact`);
      const researchGeometry = await page.evaluate(() => {
        const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        const body = document.getElementById('question-tools-body');
        return { results: rect('research-results-region'), conversation: rect('research-conversation-region'), scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth };
      });
      expect(researchGeometry.scrollWidth <= researchGeometry.clientWidth + 1 && researchGeometry.pageWidth <= researchGeometry.viewport + 1, `${scenario.name}: long Unicode research stays within the drawer and page`, researchGeometry);
      expect(scenario.width >= 760 ? researchGeometry.conversation.left >= researchGeometry.results.right && Math.abs(researchGeometry.conversation.top - researchGeometry.results.top) < 1 : researchGeometry.conversation.top >= researchGeometry.results.bottom, `${scenario.name}: conversation uses the approved responsive placement`, researchGeometry);
      await page.locator('#question-drawer-size').click(); await settle(page); await inspectDrawer(page, `${scenario.name}/research-expanded`);
      const optionOrder = await page.evaluate(() => {
        const options = [...document.querySelectorAll('.research .option')], findings = document.getElementById('research-findings');
        return { ids: options.map(o => o.dataset.optionId), first: !!(options.at(-1).compareDocumentPosition(findings) & Node.DOCUMENT_POSITION_FOLLOWING), deepOpen: findings.open, text: options[0].textContent };
      });
      expect(optionOrder.ids.join(',') === 'cupboard,distributed' && optionOrder.first && !optionOrder.deepOpen && optionOrder.text.includes('Fits when'), `${scenario.name}: concise identified options precede closed deeper findings`, optionOrder);
      const badges = page.locator('[data-recommendation-badge]');
      expect(await badges.count() === 1 && await badges.evaluate(el => el.closest('.option').dataset.optionId) === 'cupboard', `${scenario.name}: exactly one passive recommended option is identified`, {});
      const recommendation = page.locator('.recommendation');
      await recommendation.scrollIntoViewIfNeeded(); await settle(page);
      const recommendationText = await recommendation.innerText();
      expect(recommendationText.includes(parent.research.recommendationAssessment.mainTradeoff) && recommendationText.includes('Need evidence') && recommendationText.includes('needs review'), `${scenario.name}: recommendation explains tradeoff and historical prior-context state`, {});
      await page.locator('#research-prior-decision-0').focus();
      expect(await page.locator('#research-prior-decision-0').evaluate(el => el === document.activeElement), `${scenario.name}: prior-context control can receive keyboard focus`, {});
      await inspectDrawer(page, `${scenario.name}/recommendation`);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-recommendation.png`) });
      // The previous viewport's explicit answer save makes research historical. Supply a fresh synthetic result for draft-action checks.
      const freshDraftResult = structuredClone(explorer.doc), freshDraftNode = freshDraftResult.nodes.find(n => n.id === parent.id), savedBeforeDraft = freshDraftNode.answer;
      freshDraftNode.research = structuredClone(parent.research); delete freshDraftNode.researchStale; await explorer.save(freshDraftResult);
      await page.waitForFunction(() => !document.getElementById('replace-option-distributed').disabled);
      await page.locator('#replace-option-distributed').focus(); await page.keyboard.press('Enter'); await settle(page);
      expect(await page.locator('#research-draft-preview').isVisible() && await page.locator('#research-draft-preview-text').textContent() === parent.research.options[1].proposedAnswer, `${scenario.name}: replacement previews the exact option without editing`, {});
      expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: preview preserves the original editor and text`, {});
      const previewFocus = await page.evaluate(() => {
        const focused = document.activeElement, f = focused.getBoundingClientRect(), b = document.getElementById('question-tools-body').getBoundingClientRect();
        return { id: focused.id, top: f.top, bottom: f.bottom, bodyTop: b.top, bodyBottom: b.bottom, visible: f.bottom > b.top && f.top < b.bottom };
      });
      expect(previewFocus.visible, `${scenario.name}: replacement focus is visible inside the drawer`, previewFocus);
      await inspectDrawer(page, `${scenario.name}/draft-preview`);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-draft-preview.png`) });
      await page.keyboard.press('Escape');
      expect(await page.locator('#research-draft-preview').isHidden() && await page.locator('#replace-option-distributed').evaluate(el => el === document.activeElement), `${scenario.name}: Escape cancels replacement and restores its trigger`, {});
      await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
      expect(await page.locator('#research-draft-preview-text').evaluate(el => el === document.activeElement), `${scenario.name}: keyboard review reaches the scrollable replacement text`, {});
      await page.keyboard.press('Tab');
      const confirmFocus = await page.locator('#research-draft-confirm').evaluate(el => {
        const r = el.getBoundingClientRect(), b = document.getElementById('question-tools-body').getBoundingClientRect();
        return { focused: document.activeElement === el, visible: r.top >= b.top - 1 && r.bottom <= b.bottom + 1 };
      });
      expect(confirmFocus.focused && confirmFocus.visible, `${scenario.name}: keyboard confirmation is visible after reviewing text`, confirmFocus);
      await page.keyboard.press('Enter'); await settle(page);
      expect(await editor.evaluate((el, expected) => el === document.activeElement && el === document.getElementById('answer') && el.value === expected, parent.research.options[1].proposedAnswer), `${scenario.name}: confirmed replacement changes only the existing editor`, {});
      expect(explorer.doc.nodes.find(n => n.id === parent.id).answer === savedBeforeDraft, `${scenario.name}: replacement does not save an answer`, {});
      await page.locator('#research-draft-undo').click(); await settle(page);
      expect(await editor.evaluate(el => el.value === 'Keep this private draft' && el === document.activeElement), `${scenario.name}: reachable Research undo restores exact prior text`, {});
      await page.locator('#question-drawer-size').click(); await settle(page);
      await page.locator('#option-details-cupboard-summary').focus(); await page.keyboard.press('Enter');
      expect(await page.locator('#option-details-cupboard').evaluate(el => el.open), `${scenario.name}: option details open by keyboard`, {});
      await page.keyboard.press('Enter');
      await page.locator('#question-tools-body').evaluate(el => { el.scrollTop = 0; }); await settle(page);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-answer-options.png`) });
      await page.locator('#research-option-cupboard').scrollIntoViewIfNeeded(); await settle(page);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-option-content.png`) });
      const composer = await page.locator('#followup-question').elementHandle();
      await page.locator('#followup-question').fill('Keep my question 日本語 🌿');
      await page.locator('#followup-question').press('Home'); await page.locator('#followup-question').press('Shift+ArrowRight');
      const composerSelection = await composer.evaluate(el => [el.selectionStart, el.selectionEnd]);
      await page.locator('[data-tool-tab="details"]').click(); await page.locator('[data-tool-tab="research"]').click();
      expect(await composer.evaluate(el => el.isConnected && el === document.getElementById('followup-question') && el.value === 'Keep my question 日本語 🌿'), `${scenario.name}: tab changes retain the follow-up composer`, {});
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-research-workspace.png`) });
      await page.locator('#research-answer-draft').click(); await settle(page);
      expect(await editor.evaluate(el => el === document.activeElement && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: Answer draft focuses the original editor`, {});
      expect(await page.locator('#question-drawer').getAttribute('data-expanded') === 'false', `${scenario.name}: Answer draft reduces the drawer`, {});
      expect(JSON.stringify(await composer.evaluate(el => [el.selectionStart, el.selectionEnd])) === JSON.stringify(composerSelection), `${scenario.name}: Answer draft retains follow-up selection`, {});
      const returnedEditor = await editor.evaluate(el => {
        const answer = el.getBoundingClientRect(); let top = 0, bottom = innerHeight;
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowY)) {
            const rect = parent.getBoundingClientRect(); top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom);
          }
        }
        return { visible: Math.min(answer.bottom, bottom) - Math.max(answer.top, top), top, bottom };
      });
      expect(returnedEditor.visible >= 48, `${scenario.name}: Answer draft reveals writing space before any test-assisted scrolling`, returnedEditor);
      await inspectWorkspace(page, `${scenario.name}/research-answer-return`, { answer: true, scroll: true });
      await page.locator('#research-request').click();
      await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      expect((await page.locator('#research-selection-policy').innerText()).includes('pinned constraints'), `${scenario.name}: research selection policy is inspectable`, {});
      const optional = page.locator(`#research-review-content input[data-node-id="${answered.id}"]`);
      await optional.uncheck();
      const omissions = page.locator('#research-review-content .review-record').filter({ has: page.locator('h3', { hasText: 'Omitted saved records:' }) });
      await omissions.waitFor();
      await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      const omissionText = await omissions.locator('pre').innerText(), omitted = JSON.parse(omissionText);
      expect(omitted.entries.some(item => item.id === answered.id && item.reason === 'excluded' && !Object.hasOwn(item, 'answer')), `${scenario.name}: omitted questions retain reason without answer text`, omitted);
      expect(!omissionText.includes(answered.answer) && !(await page.locator('#research-review-prompt').textContent()).includes(answered.answer), `${scenario.name}: excluded answer stays out of the sample and prompt`, {});
      for (const block of [page.locator('#research-selection-policy'), omissions]) {
        await block.scrollIntoViewIfNeeded(); await settle(page);
        const geometry = await block.evaluate(el => {
          const dialog = document.getElementById('research-review-dialog'), d = dialog.getBoundingClientRect(), r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, dialogLeft: d.left, dialogRight: d.right, dialogTop: d.top, dialogBottom: d.bottom, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, width: innerWidth, height: innerHeight };
        });
        expect(geometry.dialogLeft >= 0 && geometry.dialogRight <= geometry.width + 1 && geometry.dialogTop >= 0 && geometry.dialogBottom <= geometry.height + 1 && geometry.scrollWidth <= geometry.clientWidth + 1, `${scenario.name}: research review fits the viewport without horizontal overflow`, geometry);
        expect(geometry.left >= geometry.dialogLeft && geometry.right <= geometry.dialogRight + 1 && Math.min(geometry.bottom, geometry.dialogBottom) - Math.max(geometry.top, geometry.dialogTop) >= 24, `${scenario.name}: research policy and omission sample can be reached by scrolling`, geometry);
      }
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-research-review.png`) });
      await page.keyboard.press('Escape');
      expect(await page.locator('#research-review-dialog').evaluate(el => !el.open) && await page.locator('#research-request').evaluate(el => el === document.activeElement), `${scenario.name}: cancelling review restores its trigger focus`, {});
      expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: research review preserves the same draft editor`, {});
      expect(explorer.pending === null, `${scenario.name}: context review starts no model operation`, {});
      await page.locator('#replace-option-distributed').click();
      expect(await page.locator('#research-draft-preview').isVisible(), `${scenario.name}: pending replacement is visible before a source change`, {});
      const stale = structuredClone(explorer.doc); stale.nodes.find(n => n.id === parent.id).researchStale = true; await explorer.save(stale);
      await page.waitForFunction(() => document.getElementById('research-draft-preview').hidden);
      expect(await editor.evaluate(el => el.value === 'Keep this private draft'), `${scenario.name}: a stale preview is discarded without changing authored text`, {});
      await page.waitForFunction(() => document.querySelector('[data-recommendation-badge]').textContent.includes('needs review'));
      expect(await page.locator('#use-recommendation').isDisabled() && await editor.evaluate(el => el.isConnected && el.value === 'Keep this private draft'), `${scenario.name}: a late stale marker labels the recommendation and preserves the draft`, {});
      for (const count of [2, 0, 1]) {
        const next = structuredClone(explorer.doc), limited = structuredClone(parent.research);
        limited.options.length = count; if (count < 2) limited.optionsLimit = 'Local access is unconfirmed; additional choices would be speculative.';
        limited.recommendationAssessment.optionId = null; limited.recommendation = 'Confirm local access before choosing.';
        const target = next.nodes.find(n => n.id === parent.id); target.research = limited; delete target.researchStale; await explorer.save(next);
        await page.waitForFunction(count => document.querySelectorAll('.research .option').length === count && document.querySelector('.recommendation h3').textContent === 'No recommendation yet', count);
        expect(await page.locator('#option-comparison').count() === Number(count > 1) && await page.locator('#use-recommendation').count() === 0 && await badges.count() === 0, `${scenario.name}: limited evidence never invents a winner and keeps viable alternatives`, { count });
        expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: sparse result keeps the same authored draft`, { count });
        await page.locator(count < 2 ? '#research-options-limit' : '.recommendation').scrollIntoViewIfNeeded(); await inspectDrawer(page, `${scenario.name}/limited-${count}`);
        if (screenshots && count === 2) await page.screenshot({ path: join(output, `${scenario.name}-no-recommendation.png`) });
        if (screenshots && !count) await page.screenshot({ path: join(output, `${scenario.name}-limited-options.png`) });
      }
      const legacy = structuredClone(explorer.doc), legacyResult = structuredClone(parent.research); delete legacyResult.recommendationAssessment;
      legacy.nodes.find(n => n.id === parent.id).research = legacyResult; await explorer.save(legacy);
      await page.locator('#recommendation-compatibility').waitFor();
      expect(await badges.count() === 0 && (await page.locator('#recommendation-compatibility').innerText()).includes('no linked option'), `${scenario.name}: older results retain text without a guessed winner`, {});
      const restored = structuredClone(explorer.doc); restored.nodes.find(n => n.id === parent.id).research = structuredClone(parent.research); await explorer.save(restored);
      await page.waitForFunction(() => document.querySelectorAll('.research .option').length === 2 && document.querySelectorAll('[data-recommendation-badge]').length === 1);
      await page.locator('[data-tool-tab="details"]').click();
      await page.locator('#revisit-editor > summary').click(); await page.locator('#revisit-condition').fill('After our pilot');
      await page.locator('#revisit-condition').press('Escape'); await page.locator('#navigation-open').click(); await page.locator('#navigation-cancel').click();
      expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: editor and draft survive`, {});
      expect(await page.locator('#revisit-condition').inputValue() === 'After our pilot', `${scenario.name}: reminder draft survives`, {});
      await page.locator('#question-tools-toggle').click();
      await page.locator('[data-tool-tab="context"]').click(); await page.locator('[data-tool-tab="details"]').click();
      expect(await page.locator('#revisit-condition').inputValue() === 'After our pilot', `${scenario.name}: tab changes preserve reminder draft`, {});
      await page.locator('#question-drawer-size').click(); await settle(page);
      await inspectDrawer(page, `${scenario.name}/expanded-drawer`);
      await page.locator('#question-drawer-size').click(); await settle(page);
      // Drawer dimensions do not follow the transformed map's zoom.
      const drawerWidth = (await page.locator('#question-drawer').boundingBox()).width;
      await page.locator('#zoom-in').click(); await page.locator('#zoom-in').click(); await settle(page);
      expect(Math.abs((await page.locator('#question-drawer').boundingBox()).width - drawerWidth) < 1, `${scenario.name}: map zoom leaves drawer at screen scale`, {});
      await page.locator('#zoom-level').click();
      await page.locator('[data-tool-tab="explore"]').click();
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-drawer.png`) });
      await page.locator('#outline-toggle').click(); await settle(page);
      await inspectDrawer(page, `${scenario.name}/outline-drawer`);
      expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer')), `${scenario.name}: Outline keeps the same editor`, {});
      await page.locator('#outline-toggle').click();
      await page.locator('#question-drawer-close').click();
      // Error banners reduce space without moving the drawer into the card.
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
      await inspectDrawer(page, `${scenario.name}/notice-open-drawer`);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-notice-drawer.png`) });
      await page.locator('#question-drawer-size').click(); await settle(page);
      await inspectDrawer(page, `${scenario.name}/notice-expanded-drawer`);
      await page.locator('#question-drawer-size').click(); await settle(page);
      await page.locator('#question-drawer-close').click();
      await page.evaluate(() => { document.getElementById('notice').hidden = true; });
      // Successful ordinary saves continue locally, without asking a model.
      const beforeSaveRequests = requests;
      await page.locator('#save-answer').click();
      await page.waitForFunction(id => document.getElementById('answer-change-dialog').open || document.getElementById('node-workspace').dataset.nodeId !== id, parent.id);
      const needsConfirmation = await page.locator('#answer-change-dialog').evaluate(el => el.open);
      if (scenario.name === 'wide') expect(needsConfirmation, 'wide: changing an ancestor answer requires consequence review', {});
      if (needsConfirmation) await page.locator('#answer-change-confirm').click();
      await page.waitForFunction(id => document.getElementById('node-workspace').dataset.nodeId !== id, parent.id);
      expect(requests === beforeSaveRequests, `${scenario.name}: Save & continue makes no model request`, {});
      await page.locator('#outline-toggle').click(); await page.locator(`#outline-list [data-node-id="${parent.id}"]`).click(); await page.locator('#outline-toggle').click();
      if (scenario.name === 'minimum') {
        if (await page.locator('#question-tools-body').isHidden()) await page.locator('#question-tools-toggle').click();
        await page.locator('[data-tool-tab="explore"]').click();
        await page.locator('#save-deeper').click(); await page.locator('#cancel-request').waitFor(); await settle(page);
        await page.locator('#question-drawer-close').click();
        await page.locator('#request-status').click(); await settle(page);
        await inspectDrawer(page, 'minimum/request-navigation');
        expect(await page.locator('[data-tool-tab="explore"]').getAttribute('aria-selected') === 'true', 'minimum: request navigation reveals Explore', {});
        await page.locator('#question-tools-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await explorer.receive('questions', { requestId: explorer.pending.id, questions: [{ category: 'Next', question: 'What can we try first?' }] });
        await page.locator('#question-preview').waitFor(); await settle(page);
        const preview = await page.locator('#preview-title').evaluate(el => {
          const title = el.getBoundingClientRect(), body = document.getElementById('question-tools-body').getBoundingClientRect();
          return { top: title.top, bottom: title.bottom, bodyTop: body.top, bodyBottom: body.bottom };
        });
        expect(preview.top >= preview.bodyTop && preview.bottom <= preview.bodyBottom, 'minimum: new preview heading is visible in drawer', preview);
        await page.locator('#question-drawer-close').click();
        const child = doc.nodes.find(n => n.parentId === parent.id);
        await page.locator('#outline-toggle').click(); await page.locator(`#outline-list [data-node-id="${child.id}"]`).click();
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
