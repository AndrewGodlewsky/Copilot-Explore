import { attachMinimap } from '../com.github.copilot/extensions/explorer/web/minimap.mjs';
import { attachDashboard } from '../com.github.copilot/extensions/explorer/web/dashboard.mjs';
import { searchFilters, matchSearch, SEARCH_PAGE_SIZE } from '../com.github.copilot/extensions/explorer/web/search.mjs';
import { measureStateTraffic } from './perf-state-polling.mjs';
import { performance } from 'node:perf_hooks';
import { cpus, platform, release, arch, tmpdir, totalmem } from 'node:os';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { fixtureSpecs, makeFixture } from './perf-fixtures.mjs';
import { validateDocument, toMarkdown } from '../com.github.copilot/extensions/explorer/model.mjs';
import { prepareBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { prepareAnswerCheck } from '../com.github.copilot/extensions/explorer/answer-check.mjs';
import { prepareResearch } from '../com.github.copilot/extensions/explorer/research-context.mjs';
import { Explorer, atomicWrite } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { GeometryCache, viewportBounds, intersects, layout, branchView, revealPath } from '../com.github.copilot/extensions/explorer/web/layout.mjs';
import { attachVoice } from '../com.github.copilot/extensions/explorer/web/voice.mjs';
import { DraftClient } from '../com.github.copilot/extensions/explorer/web/drafts.mjs';
import { CommentsClient } from '../com.github.copilot/extensions/explorer/web/comments-client.mjs';
import { ReviewHandoffsClient } from '../com.github.copilot/extensions/explorer/web/review-handoffs-client.mjs';
import { CleanupClient } from '../com.github.copilot/extensions/explorer/web/cleanup.mjs';
import { QuestionHelpClient } from '../com.github.copilot/extensions/explorer/web/question-help-client.mjs';
import { attachNavigation } from '../com.github.copilot/extensions/explorer/web/navigation.mjs';
import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus } from '../com.github.copilot/extensions/explorer/web/answer-state.mjs';
import { MODES, effectiveMode } from '../com.github.copilot/extensions/explorer/web/modes.mjs';

import { ResearchReviewClient } from '../com.github.copilot/extensions/explorer/web/research-review-client.mjs';
import { researchSettingsText } from '../com.github.copilot/extensions/explorer/web/research-policy.mjs';
import { localDate, REVISIT_FILTERS, revisitStatuses, revisitMatches } from '../com.github.copilot/extensions/explorer/web/revisit.mjs';
import { NextQuestion } from '../com.github.copilot/extensions/explorer/web/next-question.mjs';
import { reviewQueue, reviewContext } from '../com.github.copilot/extensions/explorer/web/review-queue.mjs';
import { DecisionImpact, impactPath, decisionImpactKey, criticalPaths } from '../com.github.copilot/extensions/explorer/web/decision-impact.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.perf-baseline');
const warmups = 1, samples = 2;
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout.trim();
const errorInfo = error => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error).slice(0, 400), phaseStack: String(error?.stack ?? '').split('\n').slice(0, 4).join('\n') });
const summarize = values => { const sorted = [...values].sort((a, b) => a - b); return { medianMs: (sorted[0] + sorted[sorted.length - 1]) / 2, minMs: sorted[0], maxMs: sorted.at(-1) }; };

export async function measure(phases, name, operation, work, { count = samples, warmup = warmups, setup, dispose, report, now = () => performance.now() } = {}) {
  const values = [];
  try {
    for (let i = 0; i < warmup + count; i++) {
      const resource = await setup?.(i);
      try {
        const started = now();
        const value = await work(i, resource);
        const elapsed = now() - started;
        const operations = report ? await report(value, resource) : value;
        if (i >= warmup) values.push(elapsed);
        if (i === warmup) phases[name] = { status: 'ok', operation, operations, warmups: warmup, samples: count };
      } finally { await dispose?.(resource); }
    }
    phases[name] = { ...phases[name], ...summarize(values), sampleMs: values };
  } catch (error) { phases[name] = { status: 'failed', operation, warmups: warmup, completedSamples: values.length, error: errorInfo(error) }; }
}

const imports = [
  "import { reviewQueue, reviewContext } from './review-queue.mjs';",
  "import { attachDashboard } from './dashboard.mjs';",
  "import { attachMinimap } from './minimap.mjs';",
  "import { searchFilters, matchSearch, SEARCH_PAGE_SIZE } from './search.mjs';",
  "import { ResearchReviewClient } from './research-review-client.mjs';",
  "import { researchSettingsText } from './research-policy.mjs';",
  "import { localDate, REVISIT_FILTERS, revisitStatuses, revisitMatches } from './revisit.mjs';",
  "import { NextQuestion } from './next-question.mjs';",
  "import { DecisionImpact, impactPath, decisionImpactKey, criticalPaths } from './decision-impact.mjs';",

  "import { CleanupClient } from './cleanup.mjs';", "import { QuestionHelpClient } from './question-help-client.mjs';",
  "import { GeometryCache, viewportBounds, intersects, branchView, revealPath } from './layout.mjs';", "import { attachVoice } from './voice.mjs';",
  "import { DraftClient } from './drafts.mjs';", "import { attachNavigation } from './navigation.mjs';",
  "import { CommentsClient } from './comments-client.mjs';",
  "import { ReviewHandoffsClient } from './review-handoffs-client.mjs';",
  "import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus } from './answer-state.mjs';",
  "import { effectiveMode, MODES } from './modes.mjs';",
];
let html, appScript;
export async function domFixture(document) {
  html ??= await readFile(resolve(root, 'com.github.copilot/extensions/explorer/web/index.html'), 'utf8');
  appScript ??= await readFile(resolve(root, 'com.github.copilot/extensions/explorer/web/app.mjs'), 'utf8');
  const dom = new JSDOM(html.replace('{{EXPLORER_VERSION}}', 'benchmark'), { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  try {
  const { window } = dom, map = window.document.getElementById('map');
  map.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1100, bottom: 720, width: 1100, height: 720 });
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { get() { return parseFloat(this.style.width) || 220; } },
    offsetHeight: { get() { return this.id === 'node-workspace' ? 540 : 110; } },
  });
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() });
  window.AbortController = AbortController;
  let polls = 0;
  const snapshot = () => ({ document, pending: null, error: `benchmark-poll-${polls++}` });
  window.fetch = async path => {
    const url = String(path);
    const value = url === 'api/state' ? snapshot() : url.startsWith('api/drafts?') ? { entries: [] } :
      url.startsWith('api/references?') ? { revision: 0, nodeIds: [] } :
      url === 'api/voice' ? { ready: false, error: 'Disabled in synthetic benchmark.' } : {};
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  };
  Object.assign(window, { DecisionImpact, impactPath, decisionImpactKey, criticalPaths, searchFilters, matchSearch, SEARCH_PAGE_SIZE, attachMinimap, attachDashboard, ResearchReviewClient, researchSettingsText, localDate, REVISIT_FILTERS, revisitStatuses, revisitMatches, NextQuestion, GeometryCache, viewportBounds, intersects, layout, branchView, revealPath, attachVoice, DraftClient, CleanupClient, QuestionHelpClient, attachNavigation,
    ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus, MODES, effectiveMode });
  Object.assign(window, { reviewQueue, reviewContext, CommentsClient, ReviewHandoffsClient });
  const source = imports.reduce((text, statement) => text.replace(statement, ''), appScript)
    .replace('void poll();', 'window.__perf = { renderMap, renderWorkspace, renderOutline, poll, select, zoom, pan: (dx, dy) => { view.x += dx; view.y += dy; transform(); }, geometry: () => geometryCache.value, stopPoll: () => clearTimeout(pollTimer) }; void poll();');
  window.eval(source);
  for (let i = 0; i < 100 && !window.document.querySelector('#nodes [data-node-id]'); i++) await new Promise(resolve => setTimeout(resolve, 10));
  window.__perf.stopPoll();
  if (!window.document.querySelector('#nodes [data-node-id]')) throw new Error('The shipped app did not render its initial map.');
  return { window, close() { window.dispatchEvent(new window.Event('pagehide')); window.__perf.stopPoll(); dom.window.close(); } };
  } catch (error) { dom.window.close(); throw error; }
}

async function benchmark(spec) {
  const { document, definition } = makeFixture(spec), phases = {};
  await measure(phases, 'validate', 'validateDocument', () => { validateDocument(document); return { documents: 1, nodes: definition.nodes }; });
  await measure(phases, 'contextResearch', 'prepareResearch root decisions', () => { const result = prepareResearch(document, document.rootId, { scope: 'decisions' }); return { includedRecords: result.dependencies.records.length, bytes: result.bytes }; });
  await measure(phases, 'contextBrief', 'prepareBrief', () => { const result = prepareBrief(document); return { includedRecords: result.dependencies.records.length, bytes: result.bytes }; });
  await measure(phases, 'contextCheck', 'prepareAnswerCheck', () => { const result = prepareAnswerCheck(document); return { includedRecords: result.dependencies.records.length, bytes: result.bytes }; });
  await measure(phases, 'markdown', 'toMarkdown', () => ({ outputBytes: Buffer.byteLength(toMarkdown(document)) }));
  await measure(phases, 'nativeExport', 'JSON.stringify indent 2', () => ({ outputBytes: Buffer.byteLength(JSON.stringify(document, null, 2)) }));
  await measure(phases, 'branchView', 'branchView full', () => { const view = branchView(document.nodes, document.rootId, new Set()); return { visibleNodes: view.nodes.length, edges: view.edges.length }; });
  await measure(phases, 'layout', 'layout full', () => { const positions = layout(document.nodes, document.rootId); return { positionedNodes: positions.size }; });
  const tempResource = async () => ({ dir: await mkdtemp(join(tmpdir(), 'explorer-perf-')) });
  const disposeTemp = async resource => { await rm(resource.dir, { recursive: true, force: true }); };
  await measure(phases, 'atomicWrite', 'atomicWrite saved native document', async (_, resource) =>
    atomicWrite(resource.file, resource.payload),
  { setup: async () => {
    const resource = await tempResource();
    try { return { ...resource, file: join(resource.dir, 'map.explore.json'), payload: JSON.stringify(document, null, 2) }; }
    catch (error) { await disposeTemp(resource); throw error; }
  },
    report: (_, resource) => ({ bytes: Buffer.byteLength(resource.payload), files: 1 }), dispose: disposeTemp });
  await measure(phases, 'controllerHistoryWrite', 'Explorer.save with history and atomic replacement', async (_, resource) =>
    resource.explorer.save(resource.next, 'Synthetic benchmark update'),
  { setup: async () => {
    const resource = await tempResource();
    try {
      const file = join(resource.dir, 'map.explore.json');
      await atomicWrite(file, JSON.stringify(document, null, 2));
      resource.explorer = await new Explorer({ file, send: async () => {}, target: { instanceId: 'perf' } }).load();
      resource.next = structuredClone(resource.explorer.doc);
      resource.next.objective = 'Choose a bounded pilot with accountable owners.';
      return resource;
    } catch (error) { await disposeTemp(resource); throw error; }
  }, report: (committed, resource) => {
    if (!committed) throw new Error('The controller did not commit the measured update.');
    return { writes: 1, historyCommits: 1, bytes: Buffer.byteLength(JSON.stringify(resource.explorer.doc, null, 2)) };
  }, dispose: async resource => { await resource.explorer.close(); await disposeTemp(resource); } });
  const closeDom = resource => { resource.close(); global.gc?.(); };
  const researchDom = async () => { const resource = await domFixture(document); try { resource.window.__perf.select(document.nodes.find(node => node.research).id); return resource; } catch (error) { closeDom(resource); throw error; } };
  await measure(phases, 'renderMap', 'shipped app renderMap in jsdom', (_, resource) => {
    const { window } = resource; window.__perf.renderMap();
    return { nodeButtons: window.document.querySelectorAll('#nodes [data-node-id]').length, svgPaths: window.document.querySelectorAll('#edges path').length };
  }, { setup: () => domFixture(document), dispose: closeDom });
  await measure(phases, 'renderWorkspace', 'shipped app renderWorkspace in jsdom', (_, resource) => {
    const { window } = resource; window.__perf.renderWorkspace();
    return { workspaceElements: window.document.querySelectorAll('#node-workspace *').length };
  }, { setup: researchDom, dispose: closeDom });
  await measure(phases, 'renderOutline', 'shipped app renderOutline in jsdom', (_, resource) => {
    const { window } = resource; window.__perf.renderOutline();
    return { outlineRows: window.document.querySelectorAll('#outline-list .outline-row').length };
  }, { setup: researchDom, dispose: closeDom });
  await measure(phases, 'poll', 'shipped app poll with synthetic state response in jsdom', async (_, resource) => {
    const { window } = resource; await window.__perf.poll(); window.__perf.stopPoll();
    return { stateRequests: 1, nodes: window.document.querySelectorAll('#nodes [data-node-id]').length };
  }, { setup: researchDom, dispose: closeDom });
  const steadyState = {};
  const countedDom = async () => {
    const resource = await researchDom(), { window } = resource;
    let createdElements = 0, addedListeners = 0;
    const create = window.document.createElement.bind(window.document), listen = window.EventTarget.prototype.addEventListener;
    window.document.createElement = (...args) => { createdElements++; return create(...args); };
    window.EventTarget.prototype.addEventListener = function (...args) { addedListeners++; return listen.apply(this, args); };
    const answer = window.document.getElementById('answer');
    const mutations = [], observer = new window.MutationObserver(records => mutations.push(...records)); observer.observe(window.document.getElementById('node-workspace'), { childList: true, subtree: true });
    resource.counts = () => ({ updates: 10, createdElements, addedListeners, sameEditor: window.document.getElementById('answer') === answer,
      editorRemovals: [...mutations, ...observer.takeRecords()].filter(record => [...record.removedNodes].some(node => node === answer || node.contains?.(answer))).length,
      outlineRows: window.document.querySelectorAll('#outline-list .outline-row').length });
    return resource;
  };
  await measure(steadyState, 'workspaceUpdates', 'additional: ten same-selection workspace updates', (_, resource) => {
    for (let i = 0; i < 10; i++) resource.window.__perf.renderWorkspace();
  }, { setup: countedDom, report: (_, resource) => resource.counts(), dispose: closeDom });
  await measure(steadyState, 'hiddenOutlineUpdates', 'additional: ten hidden Outline calls', (_, resource) => {
    for (let i = 0; i < 10; i++) resource.window.__perf.renderOutline();
  }, { setup: countedDom, report: (_, resource) => resource.counts(), dispose: closeDom });
  const viewInteractions = {};
  await measure(viewInteractions, 'panZoom', 'additional: ten pan/zoom pairs at selected research workspace', (_, resource) => {
    const { window } = resource, app = window.__perf;
    let previous = app.geometry(), layoutReplacements = 0;
    for (let i = 0; i < 10; i++) {
      app.pan(i % 2 ? -40 : 40, i % 2 ? -20 : 20);
      if (app.geometry() !== previous) layoutReplacements++;
      previous = app.geometry();
      app.zoom(i % 2 ? 1 / .9 : .9);
      if (app.geometry() !== previous) layoutReplacements++;
      previous = app.geometry();
    }
    return { panUpdates: 10, zoomUpdates: 10, layoutReplacements, positionedNodes: previous.positions.size,
      mountedNodes: window.document.querySelectorAll('#nodes [data-node-id]').length,
      mountedEdges: window.document.querySelectorAll('#edges path').length,
      sameEditor: window.document.getElementById('answer') === resource.editor };
  }, { setup: async () => { const resource = await researchDom(); resource.editor = resource.window.document.getElementById('answer'); return resource; }, dispose: closeDom });
  return { fixture: definition, phases, steadyState, viewInteractions, stateTraffic: await measureStateTraffic(document) };
}

export const phaseNames = ['validate', 'contextResearch', 'contextBrief', 'contextCheck', 'markdown', 'nativeExport', 'branchView', 'layout', 'atomicWrite', 'controllerHistoryWrite', 'renderMap', 'renderWorkspace', 'renderOutline', 'poll'];
export function validResult(result, { cases = fixtureSpecs.map(spec => spec.name), phases = phaseNames } = {}) {
  const finite = value => Number.isFinite(value) && value >= 0;
  const failure = phase => phase?.status === 'failed' && typeof phase.error?.message === 'string' && phase.error.message.length > 0 && phase.error.message.length <= 400;
  const validPhase = phase => failure(phase) || phase?.status === 'ok' && Array.isArray(phase.sampleMs) && phase.sampleMs.length === samples &&
    phase.sampleMs.every(finite) && [phase.minMs, phase.medianMs, phase.maxMs].every(finite) && phase.minMs <= phase.medianMs && phase.medianMs <= phase.maxMs;
  return result?.schema === 1 && result.config?.warmups === warmups && result.config?.samples === samples &&
    cases.length > 0 && phases.length > 0 && Array.isArray(result.cases) && result.cases.length === cases.length &&
    new Set(result.cases.map(item => item.fixture?.name)).size === cases.length && result.cases.every(item =>
      cases.includes(item.fixture?.name) && (failure(item.phases?.fixture) && Object.keys(item.phases).length === 1 ||
      !!item.fixture?.fingerprint && item.phases && Object.keys(item.phases).length === phases.length && phases.every(name => validPhase(item.phases[name]))) &&
      (!item.steadyState || ['workspaceUpdates', 'hiddenOutlineUpdates'].every(name => validPhase(item.steadyState[name]))) &&
      (!item.viewInteractions || validPhase(item.viewInteractions.panZoom)));
}

export async function runBaseline({ specs = fixtureSpecs, runCase = benchmark, outputDirectory = output, expectedPhases = phaseNames, log = console.log } = {}) {
  await mkdir(outputDirectory, { recursive: true });
  const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
  const result = { schema: 1, version, commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'),
    environment: { node: process.version, platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem(), execArgv: process.execArgv },
    config: { warmups, samples, fixtureGenerator: 'scripts/perf-fixtures.mjs', measurement: 'performance.now(); sequential, no parallel cases' }, cases: [] };
  for (const spec of specs) {
    try { result.cases.push(await runCase(spec)); }
    catch (error) { result.cases.push({ fixture: { name: String(spec?.name ?? 'unknown').slice(0, 80) }, phases: { fixture: { status: 'failed', error: errorInfo(error) } } }); }
    log(`${spec.name}: ${Object.entries(result.cases.at(-1).phases).filter(([, phase]) => phase.status === 'failed').map(([name]) => name).join(', ') || 'measured'}`);
  }
  if (!validResult(result, { cases: specs.map(spec => spec.name), phases: expectedPhases })) throw new Error('Benchmark result schema is invalid.');
  const json = join(outputDirectory, 'baseline.json'), markdown = join(outputDirectory, 'baseline.md');
  await writeFile(json, JSON.stringify(result, null, 2) + '\n');
  const lines = [`# Explorer ${version} synthetic baseline`, '', `Commit: ${result.commit}; dirty: ${result.dirty}.`,
    `Node ${result.environment.node}; ${result.environment.platform} ${result.environment.release}; ${result.environment.cpu}.`,
    `Warmups: ${warmups}; measured samples: ${samples}. Times are elapsed milliseconds; median [min, max].`, '',
    '| Fixture | Nodes | Questions | Saved bytes | Failed phases |', '| --- | ---: | ---: | ---: | --- |'];
  for (const item of result.cases) lines.push(`| ${item.fixture.name} | ${item.fixture.nodes ?? '—'} | ${item.fixture.questions ?? '—'} | ${item.fixture.bytes ?? '—'} | ${Object.entries(item.phases).filter(([, p]) => p.status === 'failed').map(([n, p]) => `${n}: ${p.error.message}`).join('; ') || 'none'} |`);
  lines.push('', '| Fixture | Phase | Operations | Median [min, max] ms |', '| --- | --- | --- | ---: |');
  for (const item of result.cases) for (const [name, phase] of Object.entries(item.phases)) if (phase.status === 'ok') lines.push(`| ${item.fixture.name} | ${name} | ${JSON.stringify(phase.operations)} | ${phase.medianMs.toFixed(2)} [${phase.minMs.toFixed(2)}, ${phase.maxMs.toFixed(2)}] |`);
  lines.push('', '## Additional steady-state counters (not task23 phases)', '', '| Fixture | Update | Operations | Median ms |', '| --- | --- | --- | ---: |');
  for (const item of result.cases) for (const [name, phase] of Object.entries(item.steadyState ?? {})) if (phase.status === 'ok') lines.push(`| ${item.fixture.name} | ${name} | ${JSON.stringify(phase.operations)} | ${phase.medianMs.toFixed(2)} |`);
  lines.push('', '## Additional viewport interactions (not task23 phases)', '', '| Fixture | Update | Operations | Median ms |', '| --- | --- | --- | ---: |');
  for (const item of result.cases) for (const [name, phase] of Object.entries(item.viewInteractions ?? {})) if (phase.status === 'ok') lines.push(`| ${item.fixture.name} | ${name} | ${JSON.stringify(phase.operations)} | ${phase.medianMs.toFixed(2)} |`);
  lines.push('', '## Conditional HTTP counters (separate from full-update poll phase)', '', '| Fixture | Scenario | Actual work |', '| --- | --- | --- |');
  for (const item of result.cases) for (const [name, counts] of Object.entries(item.stateTraffic ?? {})) lines.push(`| ${item.fixture.name} | ${name} | ${JSON.stringify(counts)} |`);
  lines.push('', 'jsdom measures JavaScript and DOM mutations only. It does not measure native paint, frame rate, pointer latency, IME, or desktop embedding.',
    'Targets are informational: watch for repeatable changes above 2× the same phase and fixture on the same machine. Compare only when fixture fingerprints and procedures match.');
  await writeFile(markdown, lines.join('\n') + '\n');
  log(`Results: ${json}\nSummary: ${markdown}`);
  return { result, json, markdown, exitCode: result.cases.some(item => [...Object.values(item.phases), ...Object.values(item.steadyState ?? {}), ...Object.values(item.viewInteractions ?? {})].some(phase => phase.status === 'failed')) ? 1 : 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = (await runBaseline()).exitCode;
}
