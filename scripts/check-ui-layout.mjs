// Real layout checks need an existing Playwright installation and the owner's Brave browser.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createDocument, addQuestions, answerNode, validateDocument, research } from '../com.github.copilot/extensions/explorer/model.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { ResearchModelSettings } from '../com.github.copilot/extensions/explorer/research-model-settings.mjs';
import { fixtureResearchModels } from '../test/helpers/research-model.mjs';
import { parseProjectBrief, PROJECT_BRIEF_SECTIONS } from '../com.github.copilot/extensions/explorer/project-brief.mjs';
import { viewerSnapshot, viewerArtifact } from '../com.github.copilot/extensions/explorer/offline-viewer.mjs';

if (!process.env.EXPLORER_PLAYWRIGHT_PATH) throw Error('Set EXPLORER_PLAYWRIGHT_PATH to an installed playwright/index.mjs; this check downloads nothing.');
const { chromium } = await import(pathToFileURL(resolve(process.env.EXPLORER_PLAYWRIGHT_PATH)).href);
const browserPath = process.env.BRAVE_PATH || 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const output = resolve(process.argv[2] || '.preview-data/ui-layout');
const screenshots = process.argv.includes('--screenshots');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'explorer-ui-layout-')), file = join(directory, 'layout.explore.json');
await promisify(execFile)('git', ['init', '--quiet', directory], { windowsHide: true });
await writeFile(join(directory, 'README.md'), 'Synthetic project excerpt <script>literal</script> 🌿. No model request.');
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
parent.research.basis = 'sources';
parent.research.options[0].pros[0] = 'Open every Sunday';
parent.research.sources = [{ id: 'fixture-source', title: 'Synthetic office hours · 中文 🌿', url: 'https://example.com/' + 'long-reference-'.repeat(12), retrievedAt: '2026-11-20T00:00:00.000Z', provenance: 'imported' }];
parent.research.claims.push(
  { id: 'contrary', text: 'Open every Sunday', basis: 'sources', evidence: [{ sourceId: 'fixture-source', paraphrase: 'The synthetic passage says the office is closed on Sunday.' }], limitations: 'Contradictory fixture: this passage does not support Sunday access.' },
  { id: 'irrelevant', text: 'Limited availability', basis: 'sources', evidence: [{ sourceId: 'fixture-source', paraphrase: 'Synthetic office hours do not describe cupboard availability.' }], limitations: 'Irrelevant citation: actual cupboard access remains unconfirmed.' },
  { id: 'judgment', text: 'A pilot may fit the saved priorities.', basis: 'reasoning', evidence: [], limitations: 'Synthetic contextual judgment, not a verified fact.' },
);
parent.research.support = [
  { optionId: 'cupboard', field: 'pros', text: parent.research.options[0].pros[0], claimIds: ['contrary'], decisionIds: [] },
  { optionId: 'cupboard', field: 'cons', text: parent.research.options[0].cons[0], claimIds: ['irrelevant'], decisionIds: [] },
  { optionId: null, field: 'recommendation', text: parent.research.recommendation, claimIds: ['judgment'], decisionIds: [answered.id] },
  { optionId: null, field: 'mainTradeoff', text: parent.research.recommendationAssessment.mainTradeoff, claimIds: [], decisionIds: [answered.id] },
];
parent.research.limitations = [{ id: 'access-gap', kind: 'conflict', summary: '<img src=x onerror=bad()> 中文 🌿 ' + 'λ'.repeat(480), claimIds: ['contrary'], optionIds: ['cupboard'], decisionIds: [answered.id], blocksRecommendation: false, nextStep: 'Ask the host which access schedule applies; the pilot remains a provisional comparison.' }];
validateDocument(doc); await writeFile(file, JSON.stringify(doc));
const offlineDoc = structuredClone(doc), offlineFile = join(directory, 'support.html');
offlineDoc.nodes.find(node => node.id === parent.id).research.sources[0].title = 'X'.repeat(300);
await writeFile(offlineFile, viewerArtifact(viewerSnapshot(validateDocument(offlineDoc), [{ nodeId: parent.id, answer: false, research: true }])).content);
let requests = 0, comparisons = 0, briefRuns = 0, projectQuestionRuns = 0, projectQuestionDraft = '', effortRuns = 0, effortFixture = false, followupRuns = 0, followupFixture = false, voiceReady = false, voiceJob, modelCatalogError = false;
const explorer = await new Explorer({ file, projectRoot: async () => directory, projectBriefHelper: { close: async () => {}, run: async prepared => {
  briefRuns++;
  const output = Object.fromEntries(PROJECT_BRIEF_SECTIONS.map(section => [section, [{ id: section, text: `${section}: not established by this fixture.`, kind: 'unknown', sources: [] }]]));
  output.purpose = [{ id: 'purpose', text: 'Synthetic <script>literal</script> 🌿 ' + 'λ'.repeat(400), kind: 'file-backed', sources: [{ id: prepared.context.sources[0].id, quote: '<script>literal</script> 🌿' }] }];
  return parseProjectBrief(JSON.stringify(output), prepared);
} }, projectQuestionHelper: { close: async () => {}, run: async prepared => {
  assert.ok(prepared.prompt.includes('Reviewed user correction 🌿')); assert.ok(projectQuestionDraft && !prepared.prompt.includes(projectQuestionDraft)); projectQuestionRuns++;
  return [{ question: 'Should the current design change for café users 🌿?', category: 'Design', rationale: 'The future choice remains open.', importance: 'high', importanceReason: 'It affects later decisions.' }];
} }, target: { instanceId: 'ui-layout-check' }, send: async () => { requests++; }, researcher: {
  models: async () => { if (modelCatalogError) throw Error('Synthetic catalog failure'); return fixtureResearchModels(); },
  run: async (_, { prepared, onReport }) => {
    if (!effortFixture) { requests++; throw Error('Layout checks must not start inference'); }
    effortRuns++;
    const partial = structuredClone(parent.research); partial.recommendationAssessment.optionId = null;
    partial.limitations[0].blocksRecommendation = true;
    partial.summary = 'Incomplete <img src=x onerror=bad()> 中文 🌿 ' + 'long-reference-λ'.repeat(16);
    onReport({ settings: prepared.settings, reason: 'deadline', elapsedMs: 180001, toolAttempts: 3, duplicateAttempts: 0, deliveredTextUnits: 8192, truncatedResults: 1,
      assessment: { plan: [{ criterion: 'Local access', neededEvidence: 'Confirmed opening hours 中文 🌿' }], stopReason: 'in-progress', explanation: 'The current access schedule remains unconfirmed.' }, partial: prepared.followup ? { answer: partial.summary, uncertainty: 'Incomplete hypothetical judgment.', sources: [], claims: [parent.research.claims.find(claim => claim.id === 'judgment')] } : research(partial) });
    throw Error('Synthetic deadline; previous research was kept.');
  },
  runReconsideration: async (_, { prepared }) => {
    comparisons++;
    return { cells: prepared.comparison.criteria.flatMap(criterion => prepared.comparison.options.map(option => ({ criterionId: criterion.id, optionId: option.id, explanation: 'Synthetic comparison, not evidence. 中文 🌿 ' + 'long-reference-λ'.repeat(8), basis: 'unknown', claimIds: [] }))),
      recommendation: { optionId: 'distributed', reason: 'Synthetic hypothetical priorities favor nearby access.', changed: 'Volunteer coverage is explicitly prioritized.', unchanged: 'Actual participation remains unknown.' }, uncertainty: 'Fixture only. No model or new retrieval.' };
  },
} }).load();
explorer.researcher.runFollowup = async (...args) => {
  if (!followupFixture) return explorer.researcher.run(...args);
  followupRuns++;
  return { answer: 'Previous answer <img src=x onerror=bad()> 日本語 🌿. Keep the original evidence dates when considering this synthetic pilot.', uncertainty: 'Synthetic reasoning, not new verification.',
    claims: [structuredClone(parent.research.claims.find(claim => claim.id === 'judgment'))], sources: [{ ...structuredClone(parent.research.sources[0]), evidenceOrigin: { origin: 'original', sourceId: 'fixture-source' } }] };
};
const modelSettings = new ResearchModelSettings({ directory }); explorer.researchModelSettings = () => modelSettings;
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
      await page.goto(pathToFileURL(offlineFile).href); await settle(page);
      const offlineSupport = page.locator('[data-statement-support]').first(), offlineSummary = offlineSupport.locator('summary');
      await offlineSummary.focus(); await page.keyboard.press('Space');
      expect(await offlineSupport.evaluate(el => el.open), `${scenario.name}: offline support opens by keyboard`, {});
      const offlineBounds = await offlineSupport.evaluate(el => ({ viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, width: el.clientWidth, scrollWidth: el.scrollWidth }));
      expect(offlineBounds.pageWidth <= offlineBounds.viewport + 1 && offlineBounds.scrollWidth <= offlineBounds.width + 1, `${scenario.name}: offline source title wraps inside support disclosure`, offlineBounds);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-offline-support.png`) });
      await page.keyboard.press('Space');
      expect(await offlineSupport.evaluate(el => !el.open && document.activeElement === el.querySelector('summary')), `${scenario.name}: closing offline support preserves keyboard focus`, {});
      const offlineLimitation = page.locator('[data-research-limitation]').first(), offlineLimitationSummary = offlineLimitation.locator('summary');
      await offlineLimitationSummary.focus(); await page.keyboard.press('Space');
      expect(await offlineLimitation.evaluate(el => el.open && document.documentElement.scrollWidth <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1), `${scenario.name}: offline limitation expands without overflow`, {});
      expect((await offlineLimitation.innerText()).includes('Next step:') && await page.locator('#detail img').count() === 0, `${scenario.name}: offline limitation stays literal and actionable`, {});
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-offline-limitations.png`) });
      await page.keyboard.press('Space');
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
      const support = page.locator('#support-cupboard-pros-0'), supportSummary = support.locator(':scope > summary'), callsBeforeSupport = requests;
      await supportSummary.focus(); await page.keyboard.press('Enter'); await settle(page);
      expect(await support.evaluate(el => el.open) && (await support.innerText()).includes('Contradictory fixture'), `${scenario.name}: keyboard opens contrary evidence beside the tradeoff`, {});
      expect((await supportSummary.innerText()).includes('not verified') && (await support.innerText()).includes('Imported read metadata'), `${scenario.name}: receipt does not imply verified support`, {});
      expect((await page.locator('#support-cupboard-cons-0').textContent()).includes('Irrelevant citation') && (await page.locator('#support-distributed-pros-0 > summary').innerText()) === 'Support unknown', `${scenario.name}: irrelevant and unsupported claims stay honest`, {});
      expect((await page.locator('#support-mainTradeoff').textContent()).includes('Historical user context'), `${scenario.name}: prior user intent remains separate from source evidence`, {});
      await supportSummary.scrollIntoViewIfNeeded(); await inspectDrawer(page, `${scenario.name}/statement-support`);
      const supportGeometry = await support.evaluate(el => { const r = el.getBoundingClientRect(), p = el.closest('.option').getBoundingClientRect(); return { width: r.width, left: r.left, right: r.right, parentLeft: p.left, parentRight: p.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; });
      expect(supportGeometry.width > 120 && supportGeometry.left >= supportGeometry.parentLeft - 1 && supportGeometry.right <= supportGeometry.parentRight + 1 && supportGeometry.scrollWidth <= supportGeometry.clientWidth + 1, `${scenario.name}: expanded statement evidence wraps within its option`, supportGeometry);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-statement-support.png`) });
      await supportSummary.focus(); await page.keyboard.press('Enter');
      expect(await support.evaluate(el => !el.open && el.querySelector('summary') === document.activeElement) && requests === callsBeforeSupport, `${scenario.name}: closing support retains focus and starts no inference`, {});
      expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: inspecting evidence retains the answer editor and text`, {});
      const limitation = page.locator('#research-option-cupboard > [data-research-limitation="access-gap"]'), limitationSummary = limitation.locator('summary');
      await limitationSummary.focus(); await page.keyboard.press('Space'); await settle(page);
      expect(await limitation.evaluate(el => el.open && el.scrollWidth <= el.clientWidth + 1) && await page.locator('#research-option-distributed [data-research-limitation]').count() === 0, `${scenario.name}: scoped limitation expands beside only its affected option`, {});
      expect((await limitation.innerText()).includes('Next step:') && await page.locator('.research img').count() === 0, `${scenario.name}: limitation text is literal and actionable`, {});
      await limitationSummary.scrollIntoViewIfNeeded(); await inspectDrawer(page, `${scenario.name}/limitations`);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-limitations.png`) });
      await limitationSummary.focus(); await page.keyboard.press('Space');
      expect(await limitation.evaluate(el => !el.open && el.querySelector('summary') === document.activeElement) && requests === callsBeforeSupport, `${scenario.name}: limitation inspection preserves focus and starts no inference`, {});
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
      expect(await page.locator('#research-review-panel').evaluate(el => document.getElementById('question-tools-research').contains(el) && !document.getElementById('research-review-dialog').open), `${scenario.name}: review stays inside the Research drawer`, {});
      expect(await page.locator('#question-drawer').getAttribute('data-expanded') === 'true', `${scenario.name}: explicit review expands the existing drawer for reading`, {});
      expect(await page.locator('#research-review-exact').evaluate(el => !el.open) && await page.locator('#research-review-advanced').evaluate(el => !el.open), `${scenario.name}: exact inputs and preferences start collapsed`, {});
      await page.locator('#research-review-title').scrollIntoViewIfNeeded(); await settle(page);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-research-review-summary.png`) });
      await page.locator('#research-review-advanced > summary').focus(); await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');
      expect(await page.locator('#research-profile').evaluate(el => el === document.activeElement), `${scenario.name}: topic guidance is keyboard reachable`, {});
      await page.locator('#research-profile').selectOption('software-version');
      await page.waitForFunction(() => !document.getElementById('research-review-start').disabled && document.getElementById('research-review-guidance').textContent.includes('software-version v1'));
      expect(await page.locator('#research-profile').evaluate(el => el === document.activeElement), `${scenario.name}: reviewed profile retains focus`, {});
      await page.locator('#research-guidance-detail > summary').click();
      await inspectWorkspace(page, `${scenario.name}/research-guidance`, { scroll: true });
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-research-guidance.png`) });
      await page.locator('#research-guidance-detail > summary').click();
      await page.locator('#research-depth').focus();
      await page.keyboard.press('Escape');
      expect(await page.locator('#research-review-inline').evaluate(el => !el.hidden), `${scenario.name}: Escape from a preference select retains review`, {});
      await page.locator('#research-review-advanced > summary').click();
      await page.locator('#research-review-exact > summary').focus(); await page.keyboard.press('Enter');
      expect((await page.locator('#research-selection-policy').innerText()).includes('pinned constraints'), `${scenario.name}: research selection policy is inspectable`, {});
      const optional = page.locator(`#research-review-content input[data-node-id="${answered.id}"]`);
      await optional.uncheck();
      const omissions = page.locator('#research-review-content .review-record').filter({ has: page.locator('h3', { hasText: 'Omitted saved records:' }) });
      await omissions.waitFor();
      await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      const omissionText = await omissions.locator('pre').innerText(), omitted = JSON.parse(omissionText);
      expect(omitted.entries.some(item => item.id === answered.id && item.reason === 'excluded' && !Object.hasOwn(item, 'answer')), `${scenario.name}: omitted questions retain reason without answer text`, omitted);
      expect(!omissionText.includes(answered.answer) && !(await page.locator('#research-review-prompt').textContent()).includes(answered.answer), `${scenario.name}: excluded answer stays out of the sample and prompt`, {});
      for (const block of [page.locator('#research-review-question'), page.locator('#research-review-sources'), page.locator('#research-review-effort'), page.locator('#research-selection-policy'), omissions, page.locator('#research-review-close'), page.locator('#research-review-refresh'), page.locator('#research-review-start')]) {
        await block.scrollIntoViewIfNeeded(); await settle(page);
        const geometry = await block.evaluate(el => {
          const drawer = document.getElementById('question-tools-body'), d = drawer.getBoundingClientRect(), r = el.getBoundingClientRect();
          let top = 0, bottom = innerHeight;
          for (let parent = el.parentElement; parent; parent = parent.parentElement) if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowY)) { const bounds = parent.getBoundingClientRect(); top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, drawerLeft: d.left, drawerRight: d.right, visible: Math.min(r.bottom, bottom) - Math.max(r.top, top), elementHeight: r.height, scrollWidth: drawer.scrollWidth, clientWidth: drawer.clientWidth, width: innerWidth };
        });
        expect(geometry.drawerLeft >= 0 && geometry.drawerRight <= geometry.width + 1 && geometry.scrollWidth <= geometry.clientWidth + 1, `${scenario.name}: inline research review fits without horizontal overflow`, geometry);
        expect(geometry.left >= geometry.drawerLeft && geometry.right <= geometry.drawerRight + 1 && geometry.visible >= Math.min(geometry.elementHeight, 24) - 1, `${scenario.name}: review summary, exact records and actions can be reached by scrolling`, geometry);
      }
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-research-review.png`) });
      await page.keyboard.press('Escape');
      expect(await page.locator('#research-review-dialog').evaluate(el => !el.open && el.contains(document.getElementById('research-review-panel'))) && await page.locator('#research-request').evaluate(el => el === document.activeElement), `${scenario.name}: cancelling review restores its trigger focus`, {});
      expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: research review preserves the same draft editor`, {});
      expect(explorer.pending === null, `${scenario.name}: context review starts no model operation`, {});
      await page.locator('#navigation-open').click(); await page.locator('#project-mode-open').click();
      await page.waitForFunction(() => !document.getElementById('project-mode-refresh').disabled);
      expect(await page.locator('#project-mode-approve').isDisabled(), `${scenario.name}: project scope starts off`, {});
      await page.locator('#project-mode-discover').click();
      await page.waitForFunction(() => !!document.querySelector('#project-mode-candidates input'));
      expect(await page.locator('#project-mode-paths').inputValue() === '', `${scenario.name}: discovery does not select or ingest files`, {});
      await page.locator('#project-mode-candidates input[value="README.md"]').focus(); await page.keyboard.press('Space');
      await page.locator('#project-mode-prepare').click();
      await page.waitForFunction(() => !document.getElementById('project-mode-approve').disabled);
      for (const id of ['project-mode-project', 'project-mode-paths', 'project-mode-prepare', 'project-mode-approve', 'project-mode-close']) {
        const control = page.locator('#' + id); await control.scrollIntoViewIfNeeded();
        const bounds = await control.evaluate(el => { const r = el.getBoundingClientRect(), d = el.closest('dialog').getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, visible: Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top), dialogWidth: d.width, scroll: el.closest('dialog').scrollWidth, client: el.closest('dialog').clientWidth, width: innerWidth }; });
        expect(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.visible >= Math.min(bounds.height, 24) - 1 && bounds.scroll <= bounds.client + 1, `${scenario.name}: project scope controls fit and remain reachable`, bounds);
      }
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-project-scope.png`) });
      await page.locator('#project-mode-approve').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('project-mode-indicator').hidden);
      expect(await editor.evaluate(el => el.isConnected && el.value === 'Keep this private draft'), `${scenario.name}: project scope preserves answer draft`, {});
      expect(explorer.pending === null, `${scenario.name}: enabling scope starts no model operation`, {});
      await page.locator('#project-mode-read').click(); await page.waitForFunction(() => !document.getElementById('project-mode-capture').hidden);
      expect(await page.locator('#project-mode-receipt-title').evaluate(el => el === document.activeElement), `${scenario.name}: explicit read focuses local receipt`, {});
      await page.locator('#project-mode-receipt summary').click();
      const excerpt = page.locator('#project-mode-receipt pre'); await excerpt.scrollIntoViewIfNeeded();
      expect((await excerpt.textContent()).includes('<script>literal</script> 🌿') && await page.locator('#project-mode-receipt script').count() === 0, `${scenario.name}: captured text stays literal`, {});
      const captureBounds = await excerpt.evaluate(el => { const r = el.getBoundingClientRect(), d = el.closest('dialog'); return { left: r.left, right: r.right, width: innerWidth, scroll: d.scrollWidth, client: d.clientWidth }; });
      expect(captureBounds.left >= 0 && captureBounds.right <= captureBounds.width + 1 && captureBounds.scroll <= captureBounds.client + 1, `${scenario.name}: local excerpts fit the scope dialog`, captureBounds);
      expect(explorer.pending === null && await editor.inputValue() === 'Keep this private draft', `${scenario.name}: explicit read starts no model and preserves the answer draft`, {});
      const beforeBrief = briefRuns;
      await page.waitForFunction(() => !document.getElementById('project-brief-prepare').disabled);
      await page.locator('#project-brief-prepare').click(); await page.waitForFunction(() => !document.getElementById('project-brief-start').disabled);
      expect(briefRuns === beforeBrief, `${scenario.name}: reviewing brief inputs starts no inference`, {});
      await page.locator('#project-brief-review summary').click();
      expect((await page.locator('#project-brief-input').textContent()).includes('<script>literal</script> 🌿'), `${scenario.name}: exact brief inputs are reviewable`, {});
      const inputBounds = await page.locator('#project-brief-input').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(inputBounds.scroll <= inputBounds.client + 1, `${scenario.name}: exact brief inputs wrap within the dialog`, inputBounds);
      await page.locator('#project-brief-start').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !!document.querySelector('#project-brief-claims textarea'));
      expect(briefRuns === beforeBrief + 1 && !explorer.projectBrief.approval, `${scenario.name}: generated brief needs explicit approval`, {});
      const claim = page.locator('#project-brief-claims textarea').first(); await claim.fill('Reviewed user correction 🌿');
      await page.locator('#project-brief-claims details summary').first().click();
      for (const id of ['project-brief-prepare', 'project-brief-start', 'project-brief-add-section', 'project-brief-add-text', 'project-brief-save', 'project-brief-approve', 'project-brief-clear']) {
        const control = page.locator('#' + id); await control.scrollIntoViewIfNeeded();
        const bounds = await control.evaluate(el => { const r = el.getBoundingClientRect(), d = el.closest('dialog').getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, visible: Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top), scroll: el.closest('dialog').scrollWidth, client: el.closest('dialog').clientWidth, width: innerWidth }; });
        expect(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.visible >= Math.min(bounds.height, 24) - 1 && bounds.scroll <= bounds.client + 1, `${scenario.name}: brief controls and exact inputs fit and remain reachable`, bounds);
      }
      await page.locator('#project-brief-approve').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('project-mode-indicator-text').textContent.includes('brief approved'));
      expect(await claim.evaluate(el => el.readOnly) && await claim.inputValue() === 'Reviewed user correction 🌿', `${scenario.name}: approved correction is read-only`, {});
      expect(explorer.projectBrief.draft.sections.purpose[0].kind === 'user' && await editor.inputValue() === 'Keep this private draft', `${scenario.name}: correcting the brief preserves answer text and changes provenance`, {});
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-project-brief.png`) });
      await page.locator('#project-mode-close').click();
      const toolsWereOpen = await page.locator('#question-tools-toggle').getAttribute('aria-expanded') === 'true';
      const priorToolTab = await page.locator('[data-tool-tab][aria-selected="true"]').getAttribute('data-tool-tab');
      if (!toolsWereOpen) await page.locator('#question-tools-toggle').click();
      await page.locator('[data-tool-tab="explore"]').click();
      const beforeProjectQuestions = projectQuestionRuns, beforeProjectNodes = explorer.doc.nodes.length;
      projectQuestionDraft = `Unsent project-question draft ${scenario.name} 🌿`; await editor.fill(projectQuestionDraft);
      await page.locator('#project-questions').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      expect(projectQuestionRuns === beforeProjectQuestions, `${scenario.name}: project question review starts no inference`, {});
      await page.locator('#project-questions-inputs > summary').click();
      expect((await page.locator('#research-review-content').textContent()).includes('Reviewed user correction 🌿') && await page.locator('#research-depth').count() === 0, `${scenario.name}: project questions review claims without Research settings`, {});
      for (const id of ['research-review-start', 'project-questions-fallback', 'project-questions-brief']) {
        const control = page.locator('#' + id); await control.scrollIntoViewIfNeeded();
        const bounds = await control.evaluate(el => { const r = el.getBoundingClientRect(), d = el.closest('dialog').getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, visible: Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top), scroll: el.closest('dialog').scrollWidth, client: el.closest('dialog').clientWidth, width: innerWidth }; });
        expect(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.visible >= Math.min(bounds.height, 24) - 1 && bounds.scroll <= bounds.client + 1, `${scenario.name}: project question review controls fit and remain reachable`, bounds);
      }
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-project-questions.png`) });
      await page.locator('#research-review-start').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('preview-title')?.textContent === 'Review project questions');
      expect(projectQuestionRuns === beforeProjectQuestions + 1 && explorer.doc.nodes.length === beforeProjectNodes && await editor.inputValue() === projectQuestionDraft, `${scenario.name}: project suggestions require acceptance and preserve the editor`, {});
      await page.locator('#dismiss-questions').click(); await page.waitForFunction(() => !document.getElementById('question-preview'));
      await editor.fill('Keep this private draft');
      if (priorToolTab) await page.locator(`[data-tool-tab="${priorToolTab}"]`).click();
      if (!toolsWereOpen) await page.locator('#question-tools-toggle').click();
      await page.locator('#navigation-open').click(); await page.locator('#project-mode-open').click();
      await page.waitForFunction(() => !document.getElementById('project-brief-revoke').disabled);
      await page.locator('#project-brief-revoke').click(); await page.waitForFunction(() => !document.querySelector('#project-brief-claims textarea').readOnly);
      await page.locator('#project-mode-disable').click(); await page.waitForFunction(() => document.getElementById('project-mode-indicator').hidden);
      await page.keyboard.press('Escape');
      expect(await page.locator('#navigation-open').evaluate(el => el === document.activeElement), `${scenario.name}: scope dialog restores keyboard focus`, {});
      await page.locator('#navigation-open').click(); await page.locator('#research-model-open').click();
      await page.waitForFunction(() => !document.getElementById('research-model-save').disabled);
      expect(await page.locator('#research-model-choice').inputValue() === '', `${scenario.name}: model starts with selected chat default`, {});
      await page.locator('#research-model-choice').focus(); await page.keyboard.press('End');
      expect(await page.locator('#research-model-choice').inputValue() === 'fixture-dedicated', `${scenario.name}: dedicated model can be chosen by keyboard`, {});
      await page.keyboard.press('Tab'); expect(await page.locator('#research-model-refresh').evaluate(el => el === document.activeElement), `${scenario.name}: model refresh is keyboard reachable`, {});
      await page.keyboard.press('Tab'); expect(await page.locator('#research-model-save').evaluate(el => el === document.activeElement), `${scenario.name}: model save is keyboard reachable`, {});
      await page.keyboard.press('Enter'); await page.waitForFunction(() => document.getElementById('research-model-status').textContent.startsWith('Saved.'));
      for (const id of ['research-model-choice', 'research-model-effective', 'research-model-save', 'research-model-close']) {
        const control = page.locator('#' + id); await control.scrollIntoViewIfNeeded();
        const bounds = await control.evaluate(el => { const r = el.getBoundingClientRect(), d = el.closest('dialog').getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, visible: Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top), width: innerWidth, dialogLeft: d.left, dialogRight: d.right, overflow: el.closest('dialog').scrollWidth > el.closest('dialog').clientWidth + 1 }; });
        expect(bounds.left >= 0 && bounds.right <= bounds.width + 1 && bounds.visible >= Math.min(bounds.height, 24) - 1 && !bounds.overflow, `${scenario.name}: ${id} fits and is reachable`, bounds);
      }
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-research-model.png`) });
      await page.keyboard.press('Escape');
      expect(await page.locator('#navigation-open').evaluate(el => el === document.activeElement), `${scenario.name}: model settings restore focus`, {});
      expect(await editor.evaluate(el => el === document.getElementById('answer') && el.value === 'Keep this private draft') && await composer.evaluate(el => el === document.getElementById('followup-question') && el.value === 'Keep my question 日本語 🌿'), `${scenario.name}: model settings preserve draft and discussion`, {});
      await page.locator('#research-request').click(); await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      expect((await page.locator('#research-review-model').textContent()).includes('Dedicated Research model'), `${scenario.name}: review names dedicated model`, {});
      expect(await page.locator('#research-review-start').textContent() === 'Research', `${scenario.name}: action stays Research`, {});
      await page.keyboard.press('Escape');
      modelCatalogError = true;
      await page.locator('#navigation-open').click(); await page.locator('#research-model-open').click(); await page.waitForFunction(() => !document.getElementById('research-model-refresh').disabled);
      expect(await page.locator('#research-model-choice').inputValue() === 'fixture-dedicated' && (await page.locator('#research-model-status').textContent()).includes('catalog'), `${scenario.name}: unavailable choice stays visible`, {});
      await page.locator('#research-model-choice').selectOption(''); await page.locator('#research-model-save').click(); await page.waitForFunction(() => document.getElementById('research-model-status').textContent.startsWith('Saved.'));
      expect((await modelSettings.read()).modelId === null, `${scenario.name}: reset works during catalog failure`, {});
      modelCatalogError = false; await page.keyboard.press('Escape');
      await page.locator('#comparison-summary').click();
      await page.locator('#comparison-custom-label').fill('Available volunteers 日本語 🌿'); await page.locator('#comparison-add-criterion').click();
      await page.locator('#comparison-priority-1').selectOption('high');
      const priorComparisons = comparisons;
      const priorCurrent = explorer.reconsideration?.current?.id ?? null;
      expect(explorer.pending === null, `${scenario.name}: editing hypothetical priorities starts no helper`, {});
      await page.locator('#comparison-reconsider').click(); await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      expect((await page.locator('#research-review-sources').textContent()).includes('No new retrieval') && await page.locator('#research-review-content [data-setting]').count() === 0, `${scenario.name}: reconsideration review discloses zero retrieval and omits web controls`, {});
      await page.locator('#research-review-start').click(); await page.locator('#comparison-use').waitFor();
      expect(comparisons === priorComparisons + 1 && (explorer.reconsideration?.current?.id ?? null) === priorCurrent, `${scenario.name}: one explicit start produces a separate proposal`, {});
      for (const id of ['comparison-use', 'comparison-keep']) {
        await page.locator('#' + id).focus(); await page.locator('#' + id).scrollIntoViewIfNeeded();
        const bounds = await page.locator('#' + id).evaluate(el => { const r = el.getBoundingClientRect(), d = document.getElementById('question-tools-body').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, drawer: { left: d.left, right: d.right, top: d.top, bottom: d.bottom } }; });
        expect(bounds.left >= bounds.drawer.left && bounds.right <= bounds.drawer.right + 1 && bounds.top >= bounds.drawer.top - 1 && bounds.bottom <= bounds.drawer.bottom + 1, `${scenario.name}: ${id} is keyboard reachable`, bounds);
      }
      await page.locator('#comparison-proposal h3').scrollIntoViewIfNeeded();
      const comparisonGeometry = await page.locator('#comparison-proposal').evaluate(el => {
        const region = el.querySelector('.comparison-scroll'), table = region.querySelector('table'), row = table.querySelector('tbody tr');
        return { width: el.clientWidth, overflow: region.scrollWidth > region.clientWidth + 1, captionWidth: table.querySelector('caption').getBoundingClientRect().width, cellWidth: row.querySelector('td').getBoundingClientRect().width, rowDisplay: getComputedStyle(row).display, labelDisplay: getComputedStyle(row.querySelector('.comparison-option-label')).display, rows: table.querySelectorAll('tbody tr').length, cells: table.querySelectorAll('tbody td').length };
      });
      expect(comparisonGeometry.rows === 2 && comparisonGeometry.cells === 4, `${scenario.name}: complete criterion/option grid remains visible`, comparisonGeometry);
      if (comparisonGeometry.width <= 620) expect(!comparisonGeometry.overflow && comparisonGeometry.rowDisplay === 'block' && comparisonGeometry.labelDisplay === 'block' && comparisonGeometry.captionWidth >= comparisonGeometry.width - 2 && comparisonGeometry.cellWidth >= comparisonGeometry.width - 2, `${scenario.name}: narrow comparisons stack with readable full-width captions and cells`, comparisonGeometry);
      await inspectDrawer(page, `${scenario.name}/comparison`);
      if (screenshots) await page.screenshot({ path: join(output, `${scenario.name}-comparison.png`) });
      if (screenshots) { await page.locator('#comparison-proposal .comparison-scroll caption').evaluate(el => { const body = document.getElementById('question-tools-body'); body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 8; }); await page.screenshot({ path: join(output, `${scenario.name}-comparison-grid.png`) }); }
      await page.locator('#comparison-keep').click(); await page.locator('#comparison-use').waitFor({ state: 'detached' });
      expect((explorer.reconsideration.current?.id ?? null) === priorCurrent, `${scenario.name}: Keep dismisses without adoption`, {});
      await page.locator('#comparison-reconsider').click(); await page.waitForFunction(() => !document.getElementById('research-review-start').disabled); await page.locator('#research-review-start').click(); await page.locator('#comparison-use').click();
      await page.waitForFunction(() => !document.getElementById('comparison-current').hidden && !document.getElementById('comparison-use'));
      expect(comparisons === priorComparisons + 2 && await editor.evaluate(el => el === document.getElementById('answer') && el.value === 'Keep this private draft') && await composer.evaluate(el => el === document.getElementById('followup-question') && el.value === 'Keep my question 日本語 🌿'), `${scenario.name}: explicit adoption keeps both editors and their text`, {});
      expect(explorer.doc.nodes.find(n => n.id === parent.id).research.recommendationAssessment.optionId === 'cupboard', `${scenario.name}: hypothetical adoption leaves the saved recommendation unchanged`, {});
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
        limited.support = limited.support.filter(entry => entry.optionId !== null && limited.options.some(option => option.id === entry.optionId));
        limited.limitations[0].blocksRecommendation = true; limited.limitations[0].optionIds = limited.options.map(option => option.id);
        limited.limitations[0].nextStep = 'Ask the host for the current access schedule before comparing viable arrangements.';
        const target = next.nodes.find(n => n.id === parent.id); target.research = limited; delete target.researchStale; await explorer.save(next);
        await page.waitForFunction(count => document.querySelectorAll('.research .option').length === count && document.querySelector('.recommendation h3').textContent === 'No recommendation yet', count);
        expect(await page.locator('#option-comparison').count() === Number(count > 0) && await page.locator('#use-recommendation').count() === 0 && await badges.count() === 0, `${scenario.name}: limited evidence never invents a winner and keeps viable alternatives`, { count });
        expect(await editor.evaluate(el => el.isConnected && el === document.getElementById('answer') && el.value === 'Keep this private draft'), `${scenario.name}: sparse result keeps the same authored draft`, { count });
        expect((await page.locator('[data-recommendation-next-step]').innerText()).includes('Ask the host'), `${scenario.name}: abstention identifies the missing next evidence`, { count });
        await page.locator(count < 2 ? '#research-options-limit' : '.recommendation').scrollIntoViewIfNeeded(); await inspectDrawer(page, `${scenario.name}/limited-${count}`);
        if (screenshots && count === 2) await page.screenshot({ path: join(output, `${scenario.name}-no-recommendation.png`) });
        if (screenshots && !count) await page.screenshot({ path: join(output, `${scenario.name}-limited-options.png`) });
      }
      const dated = structuredClone(explorer.doc), datedResearch = structuredClone(parent.research);
      datedResearch.sources[0].retrievedAt = '2020-01-02T00:00:00.000Z';
      datedResearch.sources[0].dateObservations = [{ kind: 'published', text: 'Published: 2020-01-01' }, { kind: 'ambiguous', text: '<img src=x onerror=bad()> 中文 🌿 ' + 'λ'.repeat(100) }];
      datedResearch.claims.find(c => c.id === 'contrary').freshness = { type: 'price-availability', reason: 'Access schedules can change.', version: null };
      datedResearch.support.find(s => s.field === 'recommendation').claimIds = ['contrary'];
      dated.nodes.find(n => n.id === parent.id).research = datedResearch; await explorer.save(dated);
      await page.waitForFunction(() => document.getElementById('research-freshness')?.textContent.includes('Recommendation needs evidence review'));
      expect((await badges.innerText()).includes('needs review'), scenario.name + ': expired material evidence qualifies the old recommendation', {});
      const ageSupport = page.locator('#support-recommendation'), ageSummary = page.locator('#support-recommendation-summary');
      await ageSummary.focus(); await page.keyboard.press('Space'); await settle(page);
      expect((await ageSupport.innerText()).includes('Review needed') && (await ageSupport.innerText()).includes('Published: unknown; updated: unknown') && await page.locator('.research img').count() === 0, scenario.name + ': date ambiguity and old receipt remain distinct and literal', {});
      await ageSummary.scrollIntoViewIfNeeded(); await inspectDrawer(page, scenario.name + '/freshness');
      if (screenshots) await page.screenshot({ path: join(output, scenario.name + '-freshness.png') });
      expect(requests === callsBeforeSupport && await editor.inputValue() === 'Keep this private draft', scenario.name + ': freshness inspection preserves draft and starts no retrieval', {});
      const savedBeforeEffort = JSON.stringify(explorer.doc), effortBefore = effortRuns;
      const followupEffort = ['wide', 'minimum'].includes(scenario.name);
      effortFixture = true;
      if (followupEffort) await page.locator('#followup-hypothetical').check();
      await page.locator(followupEffort ? '#followup-review' : '#research-request').click(); await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      await page.locator('#research-review-start').click(); await page.locator('#research-attempt').waitFor(); effortFixture = false;
      expect(effortRuns === effortBefore + 1 && JSON.stringify(explorer.doc) === savedBeforeEffort, scenario.name + ': a synthetic stopped pass preserves the complete map', {});
      expect(!await page.locator('#research-partial').evaluate(el => el.open) && await page.locator('#research-attempt img').count() === 0, scenario.name + ': partial findings start collapsed and render literal text', {});
      await page.locator('#research-effort-plan-summary').focus(); await page.keyboard.press('Space');
      await page.locator('#research-partial-summary').focus(); await page.keyboard.press('Space');
      if (followupEffort) expect((await page.locator('#research-attempt').innerText()).includes('Hypothetical follow-up: Keep my question 日本語 🌿'), scenario.name + ': partial retains the captured hypothetical question', {});
      else { await page.locator('#research-partial-option-0-summary').focus(); await page.keyboard.press('Space'); }
      const partialBounds = await page.locator('#research-attempt').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth, available: document.getElementById('question-tools-research').clientWidth }));
      expect(partialBounds.scroll <= partialBounds.client + 1, scenario.name + ': expanded partial evidence stays within the drawer width', partialBounds);
      expect(partialBounds.client >= partialBounds.available - 1, scenario.name + ': partial attempt spans both comparison columns', partialBounds);
      await page.locator('#research-partial-summary').scrollIntoViewIfNeeded(); await inspectDrawer(page, scenario.name + '/partial');
      if (screenshots) await page.screenshot({ path: join(output, scenario.name + '-partial.png') });
      await page.locator('#research-deeper-review').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('research-review-start').disabled);
      expect(await page.locator('#research-depth').inputValue() === 'deeper' && effortRuns === effortBefore + 1, scenario.name + ': deeper research requires a new explicit review', {});
      await page.keyboard.press('Escape');
      expect(await editor.evaluate(el => el === document.getElementById('answer') && el.value === 'Keep this private draft') && await composer.evaluate(el => el === document.getElementById('followup-question') && el.value === 'Keep my question 日本語 🌿') && await page.locator('#research-partial').evaluate(el => el.open), scenario.name + ': effort review preserves editors and open partials', {});
      await page.locator('#research-attempt-clear').focus(); await page.keyboard.press('Enter'); await page.locator('#research-attempt').waitFor({ state: 'detached' });
      expect(JSON.stringify(explorer.doc) === savedBeforeEffort && effortRuns === effortBefore + 1, scenario.name + ': clearing attempt details changes no saved research and starts no helper', {});
      const legacy = structuredClone(explorer.doc), legacyResult = structuredClone(parent.research); delete legacyResult.recommendationAssessment; delete legacyResult.support; delete legacyResult.limitations;
      legacy.nodes.find(n => n.id === parent.id).research = legacyResult; await explorer.save(legacy);
      await page.locator('#recommendation-compatibility').waitFor();
      expect(await badges.count() === 0 && (await page.locator('#recommendation-compatibility').innerText()).includes('no linked option'), `${scenario.name}: older results retain text without a guessed winner`, {});
      const restored = structuredClone(explorer.doc); restored.nodes.find(n => n.id === parent.id).research = structuredClone(parent.research); await explorer.save(restored);
      await page.waitForFunction(() => document.querySelectorAll('.research .option').length === 2 && document.querySelectorAll('[data-recommendation-badge]').length === 1);
      const savedBeforeReuse = JSON.stringify(explorer.doc), followupsBefore = followupRuns;
      followupFixture = true;
      await page.locator('#followup-hypothetical').check(); await page.locator('#followup-review').click();
      await page.waitForFunction(() => !document.getElementById('research-review-start').disabled); await page.locator('#research-review-start').click();
      await page.waitForFunction(() => document.getElementById('followup-history').textContent.includes('Previous answer <img'));
      const exchange = explorer.followup.exchanges.at(-1), sourceDetail = await page.locator('#followup-history details').first().elementHandle();
      await page.locator('#followup-history details summary').first().focus(); await page.keyboard.press('Enter');
      await page.locator('#followup-review').click(); await page.locator('#research-review-reuse').waitFor();
      await page.locator('#research-review-reuse').scrollIntoViewIfNeeded(); await inspectDrawer(page, scenario.name + '/reuse-review');
      if (screenshots) await page.screenshot({ path: join(output, scenario.name + '-reuse-review.png') });
      await page.locator('#research-review-reuse').focus(); await page.keyboard.press('Enter');
      await page.locator('#followup-reused-' + exchange.id).waitFor();
      expect(followupRuns === followupsBefore + 1 && explorer.followup.exchanges.at(-1).id === exchange.id && JSON.stringify(explorer.doc) === savedBeforeReuse, scenario.name + ': explicit reuse starts no helper and preserves the original exchange and saved map', {});
      expect(await sourceDetail.evaluate(el => el.isConnected && el.open) && await page.locator('#followup-exchange-' + exchange.id).evaluate(el => document.activeElement === el), scenario.name + ': reuse preserves source disclosure and focuses the previous response', {});
      expect((await page.locator('#followup-history').innerText()).includes('no new model or source request') && await page.locator('#followup-history img').count() === 0, scenario.name + ': reused answer is literal and is not presented as a new check', {});
      const reusePosition = await page.locator('#followup-reused-' + exchange.id).evaluate(el => ({ label: { top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom }, body: { top: document.getElementById('question-tools-body').getBoundingClientRect().top, bottom: document.getElementById('question-tools-body').getBoundingClientRect().bottom } }));
      expect(reusePosition.label.top >= reusePosition.body.top - 1 && reusePosition.label.top + 20 <= reusePosition.body.bottom + 1, scenario.name + ': the reuse notice starts in view when returning to the previous answer', reusePosition);
      await inspectDrawer(page, scenario.name + '/reused-answer');
      if (screenshots) await page.screenshot({ path: join(output, scenario.name + '-reused-answer.png') });
      await page.locator('#followup-review').click(); await page.locator('#research-review-reuse').waitFor();
      await page.locator('#research-review-start').click(); await page.waitForFunction(() => document.querySelectorAll('#followup-history > .research-claim').length === 2);
      expect(followupRuns === followupsBefore + 2, scenario.name + ': explicit Research bypasses reuse and starts exactly one new fixture helper', {});
      await page.locator('#followup-clear').focus(); await page.keyboard.press('Enter'); await page.locator('#followup-clear').waitFor({ state: 'detached' });
      expect(followupRuns === followupsBefore + 2 && explorer.followup === null && JSON.stringify(explorer.doc) === savedBeforeReuse && await editor.evaluate(el => el === document.getElementById('answer') && el.value === 'Keep this private draft') && await composer.evaluate(el => el === document.getElementById('followup-question') && el.value === 'Keep my question 日本語 🌿' && document.activeElement === el), scenario.name + ': clear history preserves drafts, restores composer focus and starts no helper', {});
      followupFixture = false;
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
  assert.equal(effortRuns, 5, 'one explicit synthetic effort pass per viewport; no automatic deeper pass');
  assert.equal(followupRuns, 10, 'two explicit synthetic follow-ups per viewport; reuse and clear start none');
  await writeFile(join(output, 'layout-results.json'), JSON.stringify({ samples, failures }, null, 2));
  console.log(`${samples.length} card samples; ${failures.length} layout failures. Evidence: ${output}`);
  for (const failure of failures.slice(0, 16)) console.log(failure.message);
  assert.equal(failures.length, 0, 'UI layout must not obscure text or controls; see layout-results.json');
} finally {
  await browser.close(); await server.close(); await explorer.close();
  assert.equal(dirname(directory), resolve(tmpdir())); await rm(directory, { recursive: true, force: true });
}
