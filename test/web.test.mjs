import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument, contextFor } from '../com.github.copilot/extensions/explorer/model.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { layout, branchView, revealPath } from '../com.github.copilot/extensions/explorer/web/layout.mjs';
import { attachVoice } from '../com.github.copilot/extensions/explorer/web/voice.mjs';
import { DraftClient } from '../com.github.copilot/extensions/explorer/web/drafts.mjs';
import { CleanupClient } from '../com.github.copilot/extensions/explorer/web/cleanup.mjs';
import { QuestionHelpClient } from '../com.github.copilot/extensions/explorer/web/question-help-client.mjs';
import { attachNavigation } from '../com.github.copilot/extensions/explorer/web/navigation.mjs';
import { NavigationPreferences } from '../com.github.copilot/extensions/explorer/navigation-preferences.mjs';
import { draftHash } from '../com.github.copilot/extensions/explorer/drafts.mjs';
import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus } from '../com.github.copilot/extensions/explorer/web/answer-state.mjs';

const findings = { basis: 'reasoning', summary: 'Two possible ways forward.', options: [
  { title: 'One block', description: 'Start with the nearest neighbors.', pros: ['Easy handovers'], cons: ['Fewer tools'] },
  { title: 'Whole neighborhood', description: 'Invite everyone nearby.', pros: ['More tools'], cons: ['More coordination'] },
], recommendation: 'Try a small pilot.', uncertainty: 'No external sources consulted.', sources: [] };

async function until(read, label) {
  for (let i = 0; i < 250; i++) { const result = read(); if (result) return result; await delay(10); }
  assert.fail('Timed out: ' + label);
}

async function fixture(t, width = 1100, voice = { status: async () => ({ ready: false, error: 'Voice test fixture disabled.' }), close() {} }, useLibrary = false, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-dom-'));
  let resolveResearch;
  const explorer = await new Explorer({ file: join(dir, 'map.explore.json'), ...(useLibrary ? { library: new Library(dir), binding: 'dom' } : {}), send: async () => {}, target: { instanceId: 'dom-test' },
    cleaner: options.cleaner,
    questionHelper: options.questionHelper,
    researcher: { run: (_, { signal }) => new Promise((resolve, reject) => { resolveResearch = resolve; signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }); }) },
  }).load();
  await explorer.command('start', { topic: 'A tool library' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: options.questions ?? [
    { category: 'People', question: 'Who should borrow first?' }, { category: 'Trust', question: 'What if a tool breaks?' },
  ] });
  if (!options.preview) await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: explorer.preview.questions.map((q, index) => ({ index, question: q.question })) });
  await options.before?.(explorer);
  const server = await startServer(explorer, voice);
  const dom = new JSDOM(await (await fetch(server.url)).text(), { url: server.url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  const guidanceDialog = document.getElementById('guidance-dialog');
  guidanceDialog.showModal = () => { guidanceDialog.open = true; };
  guidanceDialog.close = () => { guidanceDialog.open = false; };
  const historyDialog = document.getElementById('history-dialog');
  historyDialog.showModal = () => { historyDialog.open = true; };
  historyDialog.close = () => { historyDialog.open = false; };
  const navigationDialog = document.getElementById('navigation-dialog');
  navigationDialog.showModal = () => { navigationDialog.open = true; };
  navigationDialog.close = () => { navigationDialog.open = false; };
  const requests = new Set();
  t.after(async () => {
    window.dispatchEvent(new window.Event('pagehide'));
    await Promise.allSettled([...requests]); await delay(0);
    dom.window.close(); await server.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true });
  });
  const map = document.getElementById('map');
  // jsdom has no visual layout. Only geometry inputs are stubbed; DOM events,
  // the shipped app, HTTP server, controller, persistence and callbacks are real.
  let height = 720;
  map.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height });
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { get() { return parseFloat(this.style.width) || (this.id === 'map' ? width : 220); } },
    offsetHeight: { get() { return this.id === 'node-workspace' ? Math.min(540, parseFloat(this.style.maxHeight) || 540) : 110; } },
  });
  let captures = 0, holdAnswer = null, holdState = null, holdAdd = null, holdDraftRead = options.holdDraftRead, holdDraftWrite = null, holdHistory = null, holdNavigationRead = null, holdReferencesRead = options.holdReferencesRead, holdVoiceCancel = options.holdVoiceCancel, holdVoicePoll;
  const captured = new Set(), observers = new Map();
  map.setPointerCapture = id => { captures++; captured.add(id); };
  map.hasPointerCapture = id => captured.has(id);
  map.releasePointerCapture = id => captured.delete(id);
  window.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe(element) { observers.set(element.id, this.callback); } disconnect() {} };
  const motionListeners = new Set(), motionMedia = { matches: true, addEventListener: (_, fn) => motionListeners.add(fn) };
  window.matchMedia = () => motionMedia;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() });
  window.fetch = (path, options) => {
    const request = (async () => {
      if (holdAnswer && options?.body && JSON.parse(options.body).action === 'answer') await holdAnswer();
      if (holdAdd && options?.body && JSON.parse(options.body).action === 'add-direction') await holdAdd();
      if (holdDraftWrite && path === 'api/drafts' && options?.method === 'POST') await holdDraftWrite();
      if (options?.method === 'POST') options = { ...options, headers: { ...options.headers, Origin: new URL(server.url).origin } };
      const response = await fetch(new URL(path, server.url), options);
      const body = await response.arrayBuffer();
      if (path === 'api/voice' && options?.body && JSON.parse(options.body).action === 'cancel' && holdVoiceCancel) await holdVoiceCancel();
      if (path === 'api/voice' && options?.body && JSON.parse(options.body).action === 'poll' && holdVoicePoll) await holdVoicePoll();
      if (holdState && path === 'api/state') await holdState();
      if (holdDraftRead && path.startsWith('api/drafts?')) await holdDraftRead();
      if (holdHistory && path.startsWith('api/history?')) await holdHistory();
      if (holdNavigationRead && path === 'api/navigation-settings' && options?.method !== 'POST') await holdNavigationRead();
      if (holdReferencesRead && path.startsWith('api/references?')) await holdReferencesRead();
      return new Response(body, { status: response.status, headers: response.headers });
    })();
    requests.add(request); request.then(() => requests.delete(request), () => requests.delete(request));
    return request;
  };
  window.layout = layout;
  window.branchView = branchView;
  window.revealPath = revealPath;
  window.attachVoice = attachVoice;
  window.DraftClient = DraftClient;
  window.CleanupClient = CleanupClient;
  window.QuestionHelpClient = QuestionHelpClient;
  window.attachNavigation = attachNavigation;
  Object.assign(window, { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus });
  const script = await readFile(new URL('../com.github.copilot/extensions/explorer/web/app.mjs', import.meta.url), 'utf8');
  window.eval(script.replace("import { CleanupClient } from './cleanup.mjs';", '').replace("import { QuestionHelpClient } from './question-help-client.mjs';", '').replace("import { layout, branchView, revealPath } from './layout.mjs';", '').replace("import { attachVoice } from './voice.mjs';", '').replace("import { DraftClient } from './drafts.mjs';", '').replace("import { attachNavigation } from './navigation.mjs';", '').replace("import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus } from './answer-state.mjs';", ''));
  await until(() => width && !options.preview ? document.querySelectorAll('#nodes button').length >= 3 : document.getElementById('map-title').textContent, 'initial map');
  const open = id => {
    const question = explorer.doc.nodes.find(n => n.id === id).question;
    const button = [...document.querySelectorAll('#nodes button')].find(b => b.title === question);
    assert.ok(button, 'compact node exists: ' + question); button.click();
  };
  const type = (id, value) => { const e = document.getElementById(id); assert.ok(e, id); e.value = value; e.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = text => { const b = [...document.querySelectorAll('#node-workspace button')].find(e => e.textContent === text); assert.ok(b, text); b.click(); };
  return { explorer, window, document, open, type, click, resolveResearch: value => resolveResearch(value), captures: () => captures, motion: value => { motionMedia.matches = value; for (const fn of motionListeners) fn(); }, pauseAnswer: fn => { holdAnswer = fn; },
    resize: (w, h = height) => { width = w; height = h; observers.get('map')(); }, pauseState: fn => { holdState = fn; }, pauseAdd: fn => { holdAdd = fn; },
    pauseHistory: fn => { holdHistory = fn; }, pauseDraftRead: fn => { holdDraftRead = fn; }, pauseDraftWrite: fn => { holdDraftWrite = fn; }, pauseVoicePoll: fn => { holdVoicePoll = fn; }, pauseNavigationRead: fn => { holdNavigationRead = fn; }, pauseReferencesRead: fn => { holdReferencesRead = fn; } };
}

test('historical question rationale is disclosed near expanded question without changing drafts or voice', async t => {
  const explanation = '<img src=x onerror=alert(1)> Unclear audience affects the pilot.';
  const f = await fixture(t, 340, undefined, false, { questions: [{ question: 'Who should borrow first?', category: 'People', rationale: explanation }] });
  f.open(f.explorer.doc.nodes[1].id);
  const $ = id => f.document.getElementById(id);
  assert.equal($('question-rationale').open, false);
  assert.equal($('question-rationale').textContent.includes(explanation), true);
  assert.equal($('question-rationale').querySelector('img'), null);
  f.type('answer', 'Local draft'); $('answer').focus(); $('answer').setSelectionRange(5, 5);
  $('answer-state').value = 'assumption'; $('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  $('references').open = true;
  $('question-rationale').open = true;
  const changed = structuredClone(f.explorer.doc); changed.objective = 'Changed goal'; changed.nodes[1].review = true;
  await f.explorer.save(changed, 'Guidance changed');
  await until(() => $('question-rationale')?.open && /An earlier answer changed/.test(f.document.querySelector('.note')?.textContent ?? ''), 'historical rationale rerender');
  assert.match($('question-rationale').textContent, /original suggested wording and context/i);
  assert.equal($('answer').value, 'Local draft'); assert.equal($('answer').selectionStart, 5);
  assert.equal($('answer').selectionEnd, 5); assert.equal($('answer-state').value, 'assumption');
  assert.equal($('references').open, true); assert.ok($('voice-status'));
  const composingAnswer = $('answer'); composingAnswer.dispatchEvent(new f.window.Event('compositionstart', { bubbles: true }));
  const newer = structuredClone(f.explorer.doc); newer.objective = 'Another goal'; await f.explorer.save(newer, 'Guidance changed');
  await until(() => f.explorer.doc.objective === 'Another goal', 'saved during composition');
  assert.equal($('answer'), composingAnswer); composingAnswer.dispatchEvent(new f.window.Event('compositionend', { bubbles: true }));
  await until(() => $('answer') !== composingAnswer, 'composition-safe rerender');
  assert.equal($('answer').value, 'Local draft'); assert.equal($('question-rationale').open, true);
  assert.equal(f.explorer.pending, null);
});

test('focusing the rationale summary cancels synthetic recording without late insertion', async t => {
  const voice = voiceFixture(); let id;
  voice.start = recordingId => { id = recordingId; return { id, phase: 'listening' }; };
  voice.poll = () => ({ id, phase: voice.counts().cancels ? 'done' : 'listening', text: 'late dictated words' });
  const f = await fixture(t, 340, voice, false, { questions: [{ question: 'Who starts?', category: 'People', rationale: 'The first audience matters.' }] });
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep this draft');
  await until(() => !f.document.getElementById('voice-record').disabled, 'record ready');
  f.document.getElementById('answer').focus(); f.document.getElementById('voice-record').click();
  await until(() => !f.document.getElementById('voice-stop').disabled, 'recording');
  f.document.getElementById('question-rationale-summary').focus();
  await until(() => voice.counts().cancels === 1, 'rationale focus cancels recording');
  await delay(250);
  assert.equal(f.document.activeElement.id, 'question-rationale-summary');
  assert.equal(f.document.getElementById('answer').value, 'Keep this draft');
  assert.equal(f.explorer.doc.nodes[1].answer, '');
});

test('question help actions keep the draft and question intact and discard late node results', async t => {
  const runs = [];
  const helper = { run: (operation, context, options) => new Promise(resolve => {
    runs.push({ operation, context, ...options, resolve }); options.signal.addEventListener('abort', () => resolve('late'));
  }), close() {} };
  const f = await fixture(t, 340, undefined, false, { questionHelper: helper }), [node, other] = f.explorer.doc.nodes.slice(1);
  f.open(node.id); f.type('answer', 'Unsent draft'); chooseState(f, 'assumption');
  const $ = id => f.document.getElementById(id);
  $('question-help').open = true;
  assert.equal($('question-help-summary').textContent, 'Help with this question');
  $('help-rephrase').click(); await until(() => runs.length === 1, 'rephrase starts');
  assert.equal(runs[0].operation, 'rephrase'); assert.ok(!JSON.stringify(runs[0].context).includes('Unsent draft'));
  assert.equal($('help-example').disabled, true); assert.equal($('clean-answer').disabled, true);
  f.type('answer', 'Edited while helping');
  const editor = $('answer'); editor.focus(); editor.setSelectionRange(5, 5);
  editor.dispatchEvent(new f.window.Event('compositionstart', { bubbles: true }));
  runs[0].resolve('<img src=x onerror=alert(1)> λ');
  await until(() => /λ/.test($('question-help-results').textContent), 'rephrase result');
  assert.equal($('answer'), editor); assert.equal(editor.selectionStart, 5);
  editor.dispatchEvent(new f.window.Event('compositionend', { bubbles: true }));
  assert.equal($('question-help-results').querySelector('img'), null);
  assert.equal($('answer').value, 'Edited while helping'); assert.equal($('answer-state').value, 'assumption');
  $('help-example').click(); await until(() => runs.length === 2, 'example starts');
  runs[1].resolve('For illustration only.'); await until(() => /For illustration only/.test($('question-help-results').textContent), 'example result');
  assert.match($('question-help-results').textContent, /Illustrative example/);
  const next = structuredClone(f.explorer.doc); next.nodes[2].answer = 'Other branch changed'; next.nodes[2].answerState = 'tentative'; await f.explorer.save(next, 'Other branch');
  await until(() => $('question-help')?.open && /For illustration only/.test($('question-help-results').textContent), 'same-node results survive polling');
  const relevant = structuredClone(f.explorer.doc); relevant.objective = 'New saved objective';
  await f.explorer.save(relevant, 'Objective changed');
  await until(() => $('question-help-results')?.textContent === '', 'completed help clears after relevant saved edit');
  assert.equal($('answer').value, 'Edited while helping'); assert.equal($('answer-state').value, 'assumption');
  $('help-terms').click(); await until(() => runs.length === 3, 'terms starts');
  f.open(other.id); await until(() => runs[2].signal.aborted, 'node change cancels help');
  f.open(node.id); assert.equal($('question-help-results').textContent, '');
  assert.equal(f.explorer.doc.nodes[1].answer, ''); assert.equal(f.explorer.doc.nodes[1].question, node.question);
});

test('question help shows a bounded error and permits explicit keyboard retry', async t => {
  let count = 0;
  const helper = { async run() { return ++count === 1 ? ' ' : 'A plain-language explanation.'; }, close() {} };
  const f = await fixture(t, 340, undefined, false, { questionHelper: helper }); f.open(f.explorer.doc.nodes[1].id);
  const $ = id => f.document.getElementById(id);
  $('question-help').open = true;
  $('help-terms').focus(); $('help-terms').click();
  await until(() => /nonblank text/.test($('question-help-results').textContent), 'help error');
  assert.equal($('answer').value, ''); assert.equal($('question-help-results').querySelector('a'), null);
  $('help-terms').focus(); $('help-terms').click();
  await until(() => /A plain-language explanation/.test($('question-help-results').textContent), 'explicit retry');
  assert.equal(count, 2);
  assert.equal($('question-help-results').querySelector('p.cleanup-text').tabIndex, 0);
  assert.equal($('question-help-summary').closest('#node-workspace') !== null, true);
});

test('question help refreshes an external source change before explicit retry', async t => {
  let resolveFirst; const runs = [];
  const helper = { run: (operation, context) => {
    runs.push({ operation, context });
    return runs.length === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve('Explanation for the refreshed goal.');
  }, close() {} };
  const f = await fixture(t, 340, undefined, false, { questionHelper: helper });
  const node = f.explorer.doc.nodes[1]; f.open(node.id); f.type('answer', 'Unsent draft'); chooseState(f, 'assumption');
  const $ = id => f.document.getElementById(id); $('question-help').open = true;
  $('help-rephrase').click(); await until(() => runs.length === 1, 'help starts on old source');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: 'A new saved goal', successCriteria: '' });
  resolveFirst('Explanation for old goal.');
  await until(() => $('refresh-question-help'), 'external change offers refresh');
  assert.doesNotMatch($('question-help-results').textContent, /Explanation for old goal/);
  $('refresh-question-help').click();
  await until(() => f.explorer.doc.objective === 'A new saved goal' && $('help-rephrase'), 'saved journey refreshed');
  assert.equal(runs.length, 1, 'refresh does not start inference');
  assert.equal($('answer').value, 'Unsent draft'); assert.equal($('answer-state').value, 'assumption');
  assert.equal($('question-help').open, true);
  $('help-rephrase').click();
  await until(() => /Explanation for the refreshed goal/.test($('question-help-results').textContent), 'explicit retry succeeds');
  assert.equal(runs.length, 2); assert.equal(runs[1].context.objective, 'A new saved goal');
});

test('ordinary polling removes externally stale completed help but retains unrelated edits', async t => {
  const helper = { async run() { return 'Retained explanation.'; }, close() {} };
  const f = await fixture(t, 340, undefined, false, { questionHelper: helper });
  const [node, unrelated] = f.explorer.doc.nodes.slice(1); f.open(node.id);
  const $ = id => f.document.getElementById(id); $('question-help').open = true;
  $('help-rephrase').click(); await until(() => /Retained explanation/.test($('question-help-results').textContent), 'completed help');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('answer', { revision: other.doc.revision, nodeId: unrelated.id, answer: 'Another branch', answerState: 'tentative' });
  await delay(1400);
  assert.match($('question-help-results').textContent, /Retained explanation/, 'unrelated committed branch preserves help');
  await other.command('guidance', { revision: other.doc.revision, objective: 'Changed saved goal', successCriteria: '' });
  await until(() => !$('question-help-results').textContent.includes('Retained explanation'), 'poll removes stale completed help');
  assert.equal(f.explorer.doc.objective, '', 'freshness check does not refresh or save the canvas');
});

test('stale start error immediately suppresses multiple retained help results', async t => {
  const runs = [];
  const helper = { async run(operation) { runs.push(operation); return `Explanation for ${operation}.`; }, close() {} };
  const f = await fixture(t, 340, undefined, false, { questionHelper: helper });
  const node = f.explorer.doc.nodes[1]; f.open(node.id);
  const $ = id => f.document.getElementById(id); $('question-help').open = true;
  $('help-rephrase').click(); await until(() => /Explanation for rephrase/.test($('question-help-results').textContent), 'first result');
  $('help-example').click(); await until(() => /Explanation for example/.test($('question-help-results').textContent), 'second result');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: 'New committed guidance', successCriteria: '' });
  $('help-terms').click();
  await until(() => $('refresh-question-help'), 'stale source error');
  assert.doesNotMatch($('question-help-results').textContent, /Explanation for (rephrase|example)/);
  await until(() => f.explorer.helpContexts.size === 0, 'obsolete retained context IDs forgotten');
  assert.deepEqual(runs, ['rephrase', 'example'], 'stale error does not start inference');
});

test('candidate rationale follows original wording through edited preview and legacy absence', async t => {
  const f = await fixture(t, 340, undefined, false, { preview: true, questions: [{ question: 'Who starts?', category: 'People', rationale: 'Uncertain first audience affects the pilot.' }] });
  const $ = id => f.document.getElementById(id);
  await until(() => $('candidate-rationale-0'), 'preview rationale');
  f.type('candidate-question-0', 'Who starts this week?');
  assert.match($('candidate-rationale-0').textContent, /Who starts\?/);
  assert.match($('candidate-rationale-0').textContent, /original suggested wording/i);
  $('accept-questions').click();
  await until(() => f.explorer.doc.nodes.length === 2, 'accepted question');
  assert.equal(f.explorer.doc.nodes[1].rationale, 'Uncertain first audience affects the pilot.');
  await until(() => [...f.document.querySelectorAll('#nodes button')].some(b => b.title === 'Who starts this week?'), 'accepted map node');
  f.open(f.explorer.doc.nodes[1].id);
  assert.match($('question-rationale').textContent, /Who starts\?/);
  assert.match($('question-rationale').textContent, /original suggested wording/i);
  const legacy = await fixture(t, 340);
  legacy.open(legacy.explorer.doc.nodes[1].id);
  assert.equal(legacy.document.getElementById('question-rationale'), null);
});

test('Clean My Answer reviews safely in a narrow pane, preserves state/polling, and applies with conditional undo', async t => {
  const runs = [];
  const f = await fixture(t, 340, undefined, false, { cleaner: { run: (text, options) => new Promise(resolve => { runs.push({ text, ...options, resolve }); options.signal.addEventListener('abort', () => resolve('Cancelled')); }), close() {} } });
  const node = f.explorer.doc.nodes[1], original = 'maybe Élodie needs 42 <unsafe>';
  f.open(node.id); f.type('answer', original);
  const $ = id => f.document.getElementById(id);
  assert.equal($('clean-answer')?.textContent, 'Clean My Answer');
  $('clean-answer').click(); await until(() => runs.length, 'cleanup starts');
  assert.equal($('answer').disabled, false); assert.equal(runs[0].text, original);
  $('answer-state').value = 'assumption'; $('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  const changed = structuredClone(f.explorer.doc); changed.nodes[1].review = true; await f.explorer.save(changed, 'Review');
  await until(() => /An earlier answer changed/.test(f.document.querySelector('.note')?.textContent ?? ''), 'same node polling');
  assert.ok($('cancel-cleanup')); assert.equal(runs[0].signal.aborted, false);
  runs[0].resolve('Maybe Élodie needs 42 <unsafe>.');
  await until(() => $('apply-cleanup'), 'proposal arrives');
  assert.equal($('answer').value, original); assert.equal($('cleanup-original').textContent, original);
  assert.equal($('cleanup-original').tabIndex, 0); assert.equal($('cleanup-proposal').tabIndex, 0);
  assert.equal($('cleanup-proposal').querySelector('unsafe'), null);
  $('apply-cleanup').focus(); $('apply-cleanup').click();
  assert.equal($('answer').value, 'Maybe Élodie needs 42 <unsafe>.'); assert.equal($('answer-state').value, 'assumption');
  assert.equal(f.document.activeElement.id, 'answer'); assert.equal(f.explorer.doc.nodes[1].answer, '');
  $('undo-cleanup').click(); assert.equal($('answer').value, original); assert.equal($('answer-state').value, 'assumption');
  $('clean-answer').click(); await until(() => runs.length === 2, 'second cleanup'); runs[1].resolve('Proposal');
  await until(() => $('apply-cleanup'), 'second proposal'); $('apply-cleanup').click();
  f.type('answer', 'New work'); f.type('answer', 'Proposal'); assert.equal($('undo-cleanup'), null);
  $('clean-answer').click(); await until(() => runs.length === 3, 'third cleanup'); runs[2].resolve('Rejected');
  await until(() => $('reject-cleanup'), 'reject control'); $('reject-cleanup').click(); assert.equal($('answer').value, 'Proposal');
});

test('Clean My Answer cancels A-B-A, navigation and replacement; late failures preserve current text and permit retry', async t => {
  const runs = [];
  const f = await fixture(t, 340, undefined, false, { cleaner: { run: (text, options) => new Promise((resolve, reject) => { runs.push({ text, ...options, resolve, reject }); options.signal.addEventListener('abort', () => resolve('Cancelled')); }), close() {} } });
  const $ = id => f.document.getElementById(id), [first, second] = f.explorer.doc.nodes.slice(1);
  f.open(first.id); f.type('answer', 'A'); $('clean-answer').click(); await until(() => runs.length, 'cleanup starts');
  f.type('answer', 'B'); f.type('answer', 'A'); await until(() => runs[0].signal.aborted, 'typing cancels'); runs[0].resolve('Late');
  await delay(50); assert.equal($('apply-cleanup'), null); assert.equal($('answer').value, 'A');
  $('clean-answer').click(); await until(() => runs.length === 2, 'retry starts');
  f.open(second.id); await until(() => runs[1].signal.aborted, 'node change cancels'); runs[1].resolve('Late second');
  f.open(first.id); assert.equal($('answer').value, 'A'); assert.equal($('apply-cleanup'), null);
  $('clean-answer').click(); await until(() => runs.length === 3, 'error starts'); runs[2].reject(new Error('Cleanup unavailable'));
  await until(() => /Cleanup unavailable/.test($('cleanup-review')?.textContent ?? ''), 'visible failure');
  assert.equal($('answer').value, 'A'); $('clean-answer').click(); await until(() => runs.length === 4, 'retry after error');
  $('cancel-cleanup').click(); runs[3].resolve('Late cancelled'); await delay(50); assert.equal($('answer').value, 'A');
});

test('Clean My Answer observes streamed dictation mutations without breaking durable acknowledgment and cancels capture when started', async t => {
  const runs = [], voice = segmentedVoiceFixture();
  const f = await fixture(t, 340, voice, false, { cleaner: { run: (text, options) => new Promise(resolve => { runs.push({ text, ...options, resolve }); options.signal.addEventListener('abort', () => resolve('Cancelled')); }), close() {} } });
  const $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !$('voice-record')?.disabled, 'voice ready');
  f.type('answer', 'Original'); $('clean-answer').click(); await until(() => runs.length === 1, 'cleanup starts');
  $('answer').focus(); $('answer').setSelectionRange(8, 8); $('voice-record').click(); await until(() => !$('voice-stop').disabled, 'listening');
  let release; f.pauseDraftWrite(() => new Promise(resolve => { release = resolve; }));
  voice.publish(1, 'new words'); await until(() => $('answer').value.includes('new words'), 'programmatic insertion');
  await until(() => runs[0].signal.aborted, 'dictation invalidates cleanup');
  await until(() => release, 'durability pending'); assert.deepEqual(voice.counts().acknowledgments, []);
  f.pauseDraftWrite(null); release(); await until(() => voice.counts().acknowledgments.length === 1, 'ack after persistence');
  assert.equal($('apply-cleanup'), null);
  $('clean-answer').click(); await until(() => runs.length === 2 && voice.counts().cancels === 1, 'cleanup explicitly cancels capture');
  assert.equal(runs[1].text, $('answer').value); runs[1].resolve('Proposed'); await until(() => $('apply-cleanup'), 'proposal');
});

test('Clean My Answer keeps original available after failed draft persistence and ends review on journey navigation', async t => {
  const f = await fixture(t, 340, undefined, true, { cleaner: { run: async () => 'Clean proposal', close() {} } });
  const $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Original');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'original recoverable');
  $('clean-answer').click(); await until(() => $('apply-cleanup'), 'proposal');
  const write = f.explorer.draftStore.write;
  f.explorer.draftStore.write = async () => { throw new Error('Disk full'); };
  $('apply-cleanup').click(); await until(() => $('answer-status').textContent === 'Draft could not be saved', 'failure shown');
  assert.equal($('answer').value, 'Clean proposal'); assert.equal(f.explorer.doc.nodes[1].answer, '');
  $('undo-cleanup').click(); assert.equal($('answer').value, 'Original');
  f.explorer.draftStore.write = write; $('retry-draft').click(); await until(() => $('answer-status').textContent === 'Draft saved locally', 'retry succeeds');
  $('clean-answer').click(); await until(() => $('apply-cleanup'), 'review again');
  $('library-toggle').click(); assert.equal($('apply-cleanup'), null);
  $('library-return').click(); assert.equal($('answer').value, 'Original'); assert.equal($('apply-cleanup'), null);
});

test('pinned references show committed text and state, remain optional, and jump through the map', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async explorer => {
    const next = structuredClone(explorer.doc), source = next.nodes[1];
    source.answer = '<unsafe> 😀 '.repeat(30); source.answerState = 'assumption'; source.review = true;
    await explorer.save(next, 'Source updated');
  } }), [source, active] = f.explorer.doc.nodes.slice(1);
  f.open(source.id);
  await until(() => f.document.getElementById('pin-reference') && !f.document.getElementById('pin-reference').disabled, 'reference controls ready');
  f.document.getElementById('pin-reference').click();
  await until(() => f.document.querySelector('.reference-row'), 'pin rendered');
  f.open(active.id); f.type('answer', 'Unsent draft stays');
  const panel = f.document.getElementById('references'); panel.open = true;
  assert.match(panel.textContent, /Assumption.*needs review/);
  assert.match(panel.textContent, /<unsafe> 😀/);
  assert.equal(panel.querySelector('unsafe'), null);
  assert.ok(panel.querySelector('.reference-full'));
  assert.equal((await f.window.fetch('export.json').then(r => r.text())).includes('nodeIds'), false);
  assert.equal(f.explorer.doc.nodes[2].answer, '');
  f.document.getElementById('focus-branch').click();
  panel.querySelector('.reference-jump').click();
  assert.equal(f.document.getElementById('expanded-title').textContent, source.question);
  f.open(active.id); assert.equal(f.document.getElementById('answer').value, 'Unsent draft stays');
  const before = f.explorer.doc.revision;
  await until(() => !f.document.querySelector('.reference-remove')?.disabled, 'pin save finished');
  f.document.querySelector('.reference-remove').click();
  assert.equal(f.explorer.doc.revision, before);
  assert.equal(f.document.activeElement.id, 'references-summary');
  await until(() => !f.document.querySelector('.reference-remove') && !f.document.getElementById('pin-reference')?.disabled, 'unpin saved');
  assert.equal((await f.explorer.readReferences(f.explorer.doc.id)).nodeIds.length, 0);
});

test('pinned reference rows refresh from committed answer changes without showing another draft', async t => {
  const f = await fixture(t), [source, active] = f.explorer.doc.nodes.slice(1);
  f.open(source.id); await until(() => !f.document.getElementById('pin-reference')?.disabled, 'references ready');
  f.document.getElementById('pin-reference').click();
  await until(() => !f.document.querySelector('.reference-remove')?.disabled, 'pin committed');
  f.open(active.id);
  const changed = structuredClone(f.explorer.doc); changed.nodes[1].answer = 'Saved revised answer'; changed.nodes[1].answerState = 'decided'; changed.nodes[1].review = true;
  await f.explorer.save(changed, 'Answer changed');
  await until(() => /Saved revised answer/.test(f.document.querySelector('.reference-row')?.textContent ?? ''), 'committed source refresh');
  assert.match(f.document.querySelector('.reference-row').textContent, /Decided.*needs review/);
  f.type('answer', 'Unsent different draft');
  assert.equal(f.document.querySelector('.reference-row').textContent.includes('Unsent different draft'), false);
});

test('delayed reference read cannot repaint a different active journey', async t => {
  let release; const waiting = new Promise(resolve => { release = resolve; }); let held = false;
  const f = await fixture(t, 340, undefined, true, { holdReferencesRead: () => { if (!held) { held = true; return waiting; } } });
  const other = await f.explorer.library.import(createDocument('Other idea'));
  await f.explorer.attach(other.key);
  await until(() => f.document.getElementById('map-title').textContent === 'Other idea', 'new journey shown');
  release();
  await until(() => !f.document.getElementById('references')?.textContent.includes('Loading references'), 'new journey references loaded');
  assert.equal(f.document.getElementById('map-title').textContent, 'Other idea');
  assert.equal(f.document.querySelector('.reference-row'), null);
});

test('pinned references keep missing sources removable and reject stale metadata writes', async t => {
  const f = await fixture(t), [source, active] = f.explorer.doc.nodes.slice(1), journey = f.explorer.doc.id;
  f.open(source.id); await until(() => !f.document.getElementById('pin-reference')?.disabled, 'reference control ready');
  f.document.getElementById('pin-reference').click();
  await until(() => f.document.querySelector('.reference-row'), 'pin saved');
  const next = structuredClone(f.explorer.doc); next.nodes = next.nodes.filter(n => n.id !== source.id); await f.explorer.save(next, 'Source removed');
  f.open(active.id);
  await until(() => /Source unavailable/.test(f.document.querySelector('.reference-row')?.textContent ?? ''), 'missing reference');
  assert.equal(f.document.querySelector('.reference-jump'), null);
  const other = await new Explorer({ file: f.explorer.file, send: async () => {} }).load();
  await other.writeReferences({ journey, revision: 1, nodeIds: [] });
  f.document.querySelector('.reference-remove').click();
  await until(() => f.document.getElementById('references-retry'), 'stale retry visible');
  f.document.getElementById('references-retry').click();
  await until(() => !f.document.getElementById('references-retry'), 'stale retry resolved');
  assert.deepEqual((await other.readReferences(journey)).nodeIds, []);
});

function chooseState(f, value) {
  const select = f.document.getElementById('answer-state'); assert.ok(select, 'labeled answer-state selector');
  select.value = value; select.dispatchEvent(new f.window.Event('change', { bubbles: true }));
}

test('answer state selection saves only on explicit commit and displays in map outline and exports', async t => {
  const f = await fixture(t, 340), node = f.explorer.doc.nodes[1]; f.open(node.id);
  chooseState(f, 'not-relevant');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'state draft persisted');
  assert.equal(f.explorer.doc.nodes[1].answerState, undefined); assert.match(f.document.getElementById('progress').textContent, /0 resolved/);
  f.document.getElementById('save-answer').click();
  await until(() => f.explorer.doc.nodes[1].answerState === 'not-relevant' && !f.document.getElementById('discard-draft'), 'state committed and draft cleared');
  assert.equal(f.explorer.doc.nodes[1].answer, ''); assert.match(f.document.getElementById('progress').textContent, /0 answered.*1 resolved.*1 unresolved/);
  assert.match(f.document.getElementById('answer-status').textContent, /saved/i);
  f.document.getElementById('collapse-node').click();
  assert.match(f.document.querySelector(`[data-node-id="${node.id}"].node`).textContent, /Not relevant/);
  f.document.getElementById('outline-toggle').click(); assert.match(f.document.getElementById('outline-list').textContent, /Not relevant/);
  const native = await (await f.window.fetch('export.json')).json(); assert.equal(native.nodes[1].answerState, 'not-relevant');
  assert.match(await (await f.window.fetch('export.md')).text(), /Not relevant/);
  f.open(f.explorer.doc.rootId); assert.equal(f.document.getElementById('answer-state'), null);
});

test('answer state draft reload and text-only research insertion preserve a deliberate choice', async t => {
  const f = await fixture(t, 340, undefined, true, { before: async e => {
    const node = e.doc.nodes[1];
    await e.writeDraft({ journey: e.activeKey, nodeId: node.id, base: node, text: '', answerState: 'needs-evidence', revision: 0 });
  } });
  const node = f.explorer.doc.nodes[1]; f.open(node.id);
  await until(() => f.document.getElementById('answer-state')?.value === 'needs-evidence', 'state-only draft reload');
  f.document.getElementById('finish').click(); await until(() => /draft/i.test(f.document.getElementById('notice').textContent), 'finish blocked by state draft');
  f.type('answer', 'A draft note'); assert.equal(f.document.getElementById('answer-state').value, 'needs-evidence');
  f.document.getElementById('research-request').click();
  await until(() => f.explorer.pending?.kind === 'research', 'research started');
  f.resolveResearch({ ...findings, proposedAnswer: 'AI proposal' });
  await until(() => f.document.getElementById('use-recommendation'), 'research rendered');
  f.document.getElementById('use-recommendation').click(); assert.equal(f.document.getElementById('answer-state').value, 'needs-evidence');
  f.document.getElementById('undo-addition').click(); assert.equal(f.document.getElementById('answer-state').value, 'needs-evidence');
  assert.equal(f.explorer.doc.nodes[1].answer, '');
  assert.ok(!(await (await f.window.fetch('export.json')).text()).includes('A draft note'));
});

test('answer state validates without losing input and defaults new text to tentative', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  f.type('answer', 'New answer'); assert.equal(f.document.getElementById('answer-state')?.value, 'tentative');
  chooseState(f, 'unanswered'); f.document.getElementById('save-answer').click();
  assert.match(f.document.getElementById('notice').textContent, /clear.*text/i); assert.equal(f.document.getElementById('answer').value, 'New answer');
  f.type('answer', ''); chooseState(f, 'decided'); f.document.getElementById('save-answer').click();
  assert.match(f.document.getElementById('notice').textContent, /requires answer text/i);
  chooseState(f, 'revisit-later'); f.document.getElementById('save-deeper').click();
  await until(() => f.explorer.doc.nodes[1].answerState === 'revisit-later' && f.explorer.pending, 'deepen without fabricated text');
  assert.equal(f.explorer.doc.nodes[1].answer, '');
});

test('answer save captures click-time state and retains later selector edits', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  let release, waiting = false;
  f.pauseDraftWrite(() => { waiting = true; return new Promise(resolve => { release = resolve; }); });
  chooseState(f, 'not-relevant'); f.document.getElementById('save-answer').click();
  await until(() => waiting, 'save waits on draft'); chooseState(f, 'revisit-later'); f.pauseDraftWrite(null); release();
  await until(() => f.explorer.doc.nodes[1].answerState === 'not-relevant' && f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'saved click-time state and later draft');
  assert.equal(f.document.getElementById('answer-state').value, 'revisit-later');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].answerState, 'revisit-later');
});

test('stale answer state save refreshes and requires explicit choice before replacing newer state', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id); chooseState(f, 'not-relevant');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('answer', { revision: other.doc.revision, nodeId: node.id, answer: '', answerState: 'revisit-later' });
  f.document.getElementById('save-answer').click();
  await until(() => f.document.getElementById('refresh-answer'), 'stale answer refresh offered');
  assert.equal(f.document.getElementById('answer-state').value, 'not-relevant');
  f.document.getElementById('refresh-answer').click();
  await until(() => f.document.getElementById('keep-draft'), 'explicit choice');
  assert.equal(f.explorer.doc.nodes[1].answerState, 'revisit-later');
  assert.match(f.document.getElementById('draft-recovery').textContent, /Revisit later/);
  f.document.getElementById('save-answer').click(); await delay(20); assert.equal(f.explorer.doc.nodes[1].answerState, 'revisit-later');
  f.document.getElementById('keep-draft').click(); await until(() => !f.document.getElementById('keep-draft'), 'choice recorded');
  f.document.getElementById('save-answer').click(); await until(() => f.explorer.doc.nodes[1].answerState === 'not-relevant', 'explicit retry');
});

test('legacy text-only draft restores text and conservative state through the real HTTP editor', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    const node = e.doc.nodes[1]; await e.writeDraft(draftInput(e, node, 'Old draft 🌿'));
    const file = join(dirname(e.file), 'drafts.json'), data = JSON.parse(await readFile(file, 'utf8'));
    delete data.entries[0].answerState; data.entries[0].base = draftHash(JSON.stringify([node.question, node.answer]));
    await writeFile(file, JSON.stringify(data));
  } });
  await until(() => f.document.getElementById('draft-summary').textContent.includes('Local drafts'), 'old draft read');
  f.open(f.explorer.doc.nodes[1].id);
  assert.equal(f.document.getElementById('answer').value, 'Old draft 🌿');
  assert.equal(f.document.getElementById('answer-state').value, 'tentative');
  assert.equal(f.document.getElementById('recover-draft'), null);
});

test('recovered automatic empty state defaults new text while explicit Unanswered remains a choice', async t => {
  for (const stateSelected of [false, true]) {
    const f = await fixture(t, 340, undefined, false, { before: async e => {
      await e.writeDraft({ ...draftInput(e, e.doc.nodes[1], ''), answerState: 'unanswered' });
      const file = join(dirname(e.file), 'drafts.json'), data = JSON.parse(await readFile(file, 'utf8'));
      data.entries[0].stateSelected = stateSelected; await writeFile(file, JSON.stringify(data));
    } });
    await until(() => f.document.getElementById('draft-summary').textContent.includes('Local drafts'), 'draft read');
    f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'New text');
    assert.equal(f.document.getElementById('answer-state').value, stateSelected ? 'unanswered' : 'tentative');
  }
});

test('failed state draft or answer writes retain both fields for retry', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  await f.explorer.readDrafts(f.explorer.doc.id);
  const write = f.explorer.draftStore.write; f.explorer.draftStore.write = async () => { throw new Error('Disk full'); };
  chooseState(f, 'revisit-later'); f.document.getElementById('save-answer').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft could not be saved', 'draft failure');
  assert.equal(f.document.getElementById('answer-state').value, 'revisit-later'); assert.equal(f.explorer.doc.nodes[1].answerState, undefined);
  f.explorer.draftStore.write = write; f.document.getElementById('retry-draft').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'draft retry');
  const save = f.explorer.save; f.explorer.save = async () => { throw new Error('Map disk full'); };
  f.type('answer', 'Optional note'); f.document.getElementById('save-answer').click();
  await until(() => /Map disk full/.test(f.document.getElementById('notice').textContent), 'answer failure');
  assert.equal(f.document.getElementById('answer').value, 'Optional note'); assert.equal(f.document.getElementById('answer-state').value, 'revisit-later');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].answerState, 'revisit-later');
  f.explorer.save = save; f.document.getElementById('save-answer').click();
  await until(() => f.explorer.doc.nodes[1].answerState === 'revisit-later', 'answer retry');
});

test('library opens, searches, pins and archives journeys at narrow pane width', async t => {
  const f = await fixture(t, 340, undefined, true);
  const second = await f.explorer.library.import(createDocument('Another saved journey'));
  assert.ok(f.document.getElementById('library-toggle'), 'header offers Library');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'two library entries');
  f.type('library-search', 'Another');
  await until(() => f.document.querySelectorAll('.library-entry').length === 1, 'library search');
  f.document.querySelector('.library-entry [data-action="pin"]').click();
  await until(() => f.document.querySelector('.library-entry [data-action="pin"]')?.textContent === 'Unpin', 'pin saved');
  f.document.querySelector('.library-entry [data-action="archive"]').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 0, 'archived hidden');
  const archived = f.document.getElementById('library-archived'); archived.checked = true; archived.dispatchEvent(new f.window.Event('change'));
  await until(() => f.document.querySelectorAll('.library-entry').length === 1, 'archive filter');
  f.document.querySelector('.library-entry [data-action="open"]').click();
  await until(() => f.explorer.activeKey === second.key && !f.document.getElementById('workspace').hidden, 'journey opened');
  assert.equal(f.document.activeElement.id, 'map', 'keyboard focus follows the opened map');
});

test('switching blocks manual-question drafts and pending AI', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.doc.id, node = f.explorer.doc.nodes[1];
  await f.explorer.library.import(createDocument('Second journey'));
  assert.ok(f.document.getElementById('library-toggle'), 'header offers Library');
  const trySwitch = async () => {
    f.document.getElementById('library-toggle').click();
    await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library visible');
    [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('Second journey')).querySelector('[data-action="open"]').click();
    await delay(20); assert.equal(f.explorer.doc.id, first);
    f.document.getElementById('library-return').click();
  };
  f.open(node.id);
  f.type('answer', ''); f.type('manual-question', 'A manual question'); await trySwitch();
  assert.equal(f.document.getElementById('manual-question').value, 'A manual question');
  f.type('manual-question', '');
  await f.explorer.command('questions', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.rootId });
  await until(() => !f.document.getElementById('request-status').hidden, 'pending visible'); await trySwitch();
  assert.match(f.document.getElementById('notice').textContent, /cancel/i);
});

test('import conflict offers open-existing or copy and never discards a manual draft', async t => {
  const f = await fixture(t, 340, undefined, true), original = structuredClone(f.explorer.doc), key = f.explorer.activeKey;
  const dialog = f.document.getElementById('import-conflict');
  // jsdom does not implement native dialog presentation or a file-picker dialog.
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  const source = structuredClone(original); source.nodes[1].answer = 'Imported answer';
  const file = f.document.getElementById('file');
  const importFile = document => {
    Object.defineProperty(file, 'files', { configurable: true, value: [{ size: JSON.stringify(document).length, text: async () => JSON.stringify(document) }] });
    file.dispatchEvent(new f.window.Event('change'));
  };
  f.open(original.nodes[1].id); f.type('manual-question', 'Keep this unfinished question');
  importFile(source); await delay(25);
  assert.equal(dialog.open, false); assert.equal(f.document.getElementById('manual-question').value, 'Keep this unfinished question');
  f.type('manual-question', ''); importFile(source);
  await until(() => dialog.open, 'duplicate choice'); assert.equal(f.explorer.doc.nodes[1].answer, '');
  f.document.querySelector('#import-existing button').click();
  await until(() => !dialog.open, 'open saved'); assert.equal(f.explorer.activeKey, key);
  importFile(source); await until(() => dialog.open, 'duplicate choice again');
  f.document.getElementById('import-copy').click();
  await until(() => !dialog.open && f.explorer.doc.id !== original.id, 'import copy');
  assert.equal(f.explorer.doc.nodes[1].answer, 'Imported answer');
  assert.equal((await f.explorer.library.resolve(key)).document.nodes[1].answer, '');
  importFile(original); await until(() => f.explorer.activeKey === key, 'identical import opens existing');
  assert.equal((await f.explorer.library.list()).entries.length, 2);
});

test('opening a divergent legacy entry resets saved-value editor buffers even when journey IDs match', async t => {
  const f = await fixture(t, 340, undefined, true), doc = structuredClone(f.explorer.doc), node = doc.nodes[1];
  doc.nodes[1].answer = 'The other saved version';
  await writeFile(join(f.explorer.library.directory, 'legacy-other.explore.json'), JSON.stringify(doc));
  const other = (await f.explorer.library.list()).entries.find(entry => entry.key !== f.explorer.activeKey);
  f.open(node.id); f.type('answer', '');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'ambiguous entries');
  [...f.document.querySelectorAll('.library-entry')].find(entry => entry.textContent.includes(other.key.slice(0, 8))).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey === other.key && !f.document.getElementById('workspace').hidden, 'other backing file');
  const collapse = f.document.getElementById('collapse-node'); if (collapse) collapse.click();
  f.open(node.id);
  assert.equal(f.document.getElementById('answer').value, 'The other saved version');
});

test('saved direction drafts no longer block switching journeys', async t => {
  const f = await fixture(t, 340, undefined, true);
  const other = await f.explorer.library.import(createDocument('Other journey'));
  f.open(f.explorer.doc.rootId); f.type('manual-question', 'A saved question?');
  f.document.getElementById('add-direction').click();
  await until(() => f.explorer.doc.nodes.some(n => n.question === 'A saved question?') && f.document.getElementById('manual-question').value === '', 'manual question saved');
  assert.equal(f.explorer.doc.nodes.find(n => n.question === 'A saved question?').kind, 'direction');
  await until(() => f.document.getElementById('cancel-request'), 'seed generation shown');
  f.document.getElementById('cancel-request').click(); await until(() => !f.explorer.pending && !f.document.getElementById('cancel-request'), 'cancel seed generation');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library entries');
  [...f.document.querySelectorAll('.library-entry')].find(entry => entry.textContent.includes('Other journey')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey === other.key, 'switch after saved manual category');
});

test('direction edited during a save remains protected as an unsaved draft', async t => {
  const f = await fixture(t, 340, undefined, true), originalKey = f.explorer.activeKey;
  await f.explorer.library.import(createDocument('Other journey'));
  f.open(f.explorer.doc.rootId); f.type('manual-question', 'Submitted question?');
  let release, waiting = false;
  const gate = new Promise(resolve => { release = resolve; });
  f.pauseAdd(() => { waiting = true; return gate; });
  f.document.getElementById('add-direction').click();
  await until(() => waiting, 'manual save in flight');
  f.type('manual-question', 'Next direction'); release();
  await until(() => f.explorer.doc.nodes.some(n => n.question === 'Submitted question?') && f.document.getElementById('manual-question').value === 'Next direction', 'submitted question saved');
  assert.equal(f.explorer.doc.nodes.find(n => n.question === 'Submitted question?').kind, 'direction');
  await until(() => f.document.getElementById('cancel-request'), 'seed generation shown');
  f.document.getElementById('cancel-request').click(); await until(() => !f.explorer.pending && !f.document.getElementById('cancel-request'), 'cancel seed generation');
  assert.equal(f.document.getElementById('manual-question').value, 'Next direction');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library entries');
  [...f.document.querySelectorAll('.library-entry')].find(entry => entry.textContent.includes('Other journey')).querySelector('[data-action="open"]').click();
  await until(() => /draft/.test(f.document.getElementById('notice').textContent), 'new category protects switch');
  assert.equal(f.explorer.activeKey, originalKey);
  f.document.getElementById('library-return').click();
  assert.equal(f.document.getElementById('manual-question').value, 'Next direction');
});

test('clearing a non-root direction draft permits a new journey', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.doc.id;
  f.open(f.explorer.doc.nodes[1].id); f.type('manual-question', 'Unsaved direction'); f.type('manual-question', '');
  f.document.getElementById('library-toggle').click();
  f.type('topic', 'A new journey');
  f.document.getElementById('start-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.id !== first, 'new journey after cleared category');
  assert.equal(f.explorer.doc.topic, 'A new journey');
});

function viewOf(f) {
  const numbers = f.document.getElementById('world').style.transform.match(/-?[\d.]+/g).map(Number);
  return { x: numbers[0], y: numbers[1], zoom: numbers[2] };
}
function pointer(f, type, target, x, y, extra = {}) {
  const event = new f.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, ...extra });
  Object.defineProperty(event, 'pointerId', { value: extra.pointerId ?? 1 });
  target.dispatchEvent(event); return event;
}
function wheel(f, target, deltaY, extra = {}) {
  const event = new f.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX: 320, clientY: 260, ...extra });
  target.dispatchEvent(event); return event;
}

test('dragging cards pans without selecting text or opening a question; clicks still open', async t => {
  const f = await fixture(t), map = f.document.getElementById('map'), node = f.document.querySelector('.node .question');
  const before = viewOf(f);
  assert.equal(pointer(f, 'pointerdown', node, 300, 250).defaultPrevented, true, 'native text selection is suppressed');
  pointer(f, 'pointermove', map, 380, 300); pointer(f, 'pointerup', map, 380, 300);
  assert.equal(viewOf(f).x, before.x + 80); assert.equal(viewOf(f).y, before.y + 50);
  node.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  assert.ok(f.document.getElementById('node-workspace').hidden, 'drag does not activate the card');
  assert.equal(map.classList.contains('dragging'), false);
  const next = f.document.querySelector('.node');
  pointer(f, 'pointerdown', next, 380, 300); pointer(f, 'pointerup', next, 380, 300); next.click();
  assert.equal(f.document.getElementById('node-workspace').hidden, false, 'normal click still activates');
});

test('an expanded heading can pull the map back while answer selection stays native', async t => {
  const f = await fixture(t); f.open(f.explorer.doc.nodes[1].id);
  const map = f.document.getElementById('map'), title = f.document.getElementById('expanded-title'), before = viewOf(f);
  pointer(f, 'pointerdown', title, 400, 250); pointer(f, 'pointermove', map, 460, 300); pointer(f, 'pointerup', map, 460, 300);
  assert.equal(viewOf(f).x, before.x + 60);
  const answer = f.document.getElementById('answer'), after = viewOf(f);
  assert.equal(pointer(f, 'pointerdown', answer, 400, 350).defaultPrevented, false);
  pointer(f, 'pointermove', answer, 500, 400); pointer(f, 'pointerup', answer, 500, 400);
  assert.deepEqual(viewOf(f), after, 'selecting answer text never drags the map');
  pointer(f, 'pointerdown', map, 100, 100); pointer(f, 'pointermove', map, 100000, 100000); pointer(f, 'pointerup', map, 100000, 100000);
  assert.ok(Math.abs(viewOf(f).x) < 3000 && Math.abs(viewOf(f).y) < 3000, 'map cannot be thrown arbitrarily far away');
  const edge = viewOf(f);
  pointer(f, 'pointerdown', title, 100, 100); pointer(f, 'pointermove', map, 80, 80); pointer(f, 'pointerup', map, 80, 80);
  assert.equal(viewOf(f).x, edge.x - 20, 'reverse dragging responds immediately at the boundary');
});

test('pan tracks one pointer and ends on cancellation, capture loss or window blur', async t => {
  const f = await fixture(t), map = f.document.getElementById('map');
  for (const ending of ['pointercancel', 'lostpointercapture', 'blur']) {
    pointer(f, 'pointerdown', map, 200, 200);
    const start = viewOf(f);
    pointer(f, 'pointermove', map, 500, 500, { pointerId: 2 });
    assert.deepEqual(viewOf(f), start, 'another pointer cannot move the drag');
    pointer(f, 'pointerup', map, 500, 500, { pointerId: 2 });
    pointer(f, 'pointermove', map, 220, 220);
    assert.equal(viewOf(f).x, start.x + 20, 'another pointer cannot end the drag');
    if (ending === 'blur') f.window.dispatchEvent(new f.window.Event('blur'));
    else pointer(f, ending, map, 220, 220);
    const end = viewOf(f);
    pointer(f, 'pointermove', map, 250, 250);
    assert.deepEqual(viewOf(f), end); assert.equal(map.hasPointerCapture(1), false);
  }
});

test('touch or pen capture transferring from a card to the map does not cancel panning', async t => {
  const f = await fixture(t), map = f.document.getElementById('map'), label = f.document.querySelector('.node .question');
  const before = viewOf(f);
  pointer(f, 'pointerdown', label, 200, 200); pointer(f, 'pointermove', label, 220, 220);
  pointer(f, 'lostpointercapture', label, 220, 220);
  pointer(f, 'pointermove', map, 240, 240);
  assert.equal(viewOf(f).x, before.x + 40); assert.ok(map.hasPointerCapture(1));
  pointer(f, 'pointerup', map, 240, 240);
});

test('wheel zoom anchors at the pointer, reaches 300%, resets, and respects text scrolling', async t => {
  const f = await fixture(t), map = f.document.getElementById('map'), before = viewOf(f);
  assert.equal(wheel(f, map, -100).defaultPrevented, true);
  const after = viewOf(f);
  assert.ok(after.zoom > before.zoom);
  assert.ok(Math.abs((320 - after.x) / after.zoom - (320 - before.x) / before.zoom) < 1e-8);
  assert.ok(Math.abs((260 - after.y) / after.zoom - (260 - before.y) / before.zoom) < 1e-8);
  for (let i = 0; i < 20; i++) f.document.getElementById('zoom-in').click();
  assert.equal(viewOf(f).zoom, 3); assert.ok(f.document.getElementById('zoom-in').disabled);
  f.document.getElementById('zoom-level').click(); assert.equal(viewOf(f).zoom, 1);
  for (let i = 0; i < 30; i++) wheel(f, map, 120);
  assert.equal(viewOf(f).zoom, .1, 'wheel respects minimum zoom');
  f.document.getElementById('zoom-level').click();
  f.open(f.explorer.doc.nodes[1].id);
  const answer = f.document.getElementById('answer'), stable = viewOf(f);
  assert.equal(wheel(f, answer, 100).defaultPrevented, false); assert.deepEqual(viewOf(f), stable);
  assert.equal(wheel(f, answer, -100, { ctrlKey: true }).defaultPrevented, true, 'pinch/Ctrl-wheel cannot zoom the host page');
  assert.ok(viewOf(f).zoom > stable.zoom);
});

test('an expanded answer remains reachable at 300% in a narrow pane', async t => {
  const f = await fixture(t, 340); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep my draft');
  for (let i = 0; i < 20; i++) f.document.getElementById('zoom-in').click();
  const panel = f.document.getElementById('node-workspace'), v = viewOf(f);
  assert.equal(v.zoom, 3);
  const left = v.x + parseFloat(panel.style.left) * v.zoom, top = v.y + parseFloat(panel.style.top) * v.zoom;
  assert.ok(left >= 15 && left + panel.offsetWidth * v.zoom <= 325, 'editor stays inside the pane width');
  assert.ok(top >= 15 && top + panel.offsetHeight * v.zoom <= 705, 'heading and scrollable editor remain reachable');
  f.document.getElementById('save-answer').focus();
  assert.equal(f.document.activeElement.id, 'save-answer'); assert.equal(f.document.getElementById('answer').value, 'Keep my draft');
  assert.equal(viewOf(f).zoom, 3, 'focusing controls does not reset zoom');
  const map = f.document.getElementById('map');
  pointer(f, 'pointerdown', map, 100, 100); pointer(f, 'pointermove', map, 300, 200); pointer(f, 'pointerup', map, 300, 200);
  f.document.getElementById('answer').focus();
  const focused = viewOf(f), x = focused.x + parseFloat(panel.style.left) * focused.zoom;
  assert.ok(x >= 15 && x + panel.offsetWidth * focused.zoom <= 325, 'focusing the editor brings a panned-off card back');
});

test('resizing preserves manual zoom and view instead of resetting to whole map', async t => {
  const f = await fixture(t);
  f.resize(1100); f.document.getElementById('zoom-in').click(); f.document.getElementById('zoom-in').click();
  const before = viewOf(f); f.resize(1000, 680);
  const after = viewOf(f);
  assert.equal(after.zoom, before.zoom);
  assert.equal(after.x, before.x - 50); assert.equal(after.y, before.y - 20);
  f.resize(1000, 680); assert.deepEqual(viewOf(f), after, 'repeated resize notification is a no-op');
});

test('a canvas first loaded while hidden fits once it becomes visible', async t => {
  const f = await fixture(t, 0); f.resize(1100, 720);
  assert.equal(f.document.querySelectorAll('.node').length, 3);
  assert.equal(viewOf(f).zoom, 1);
  f.document.getElementById('zoom-in').click(); const before = viewOf(f);
  f.resize(0, 0); f.resize(1100, 720); assert.deepEqual(viewOf(f), before, 'hiding and revealing does not change the view');
});

test('keyboard navigation zooms, recovers the map, and reveals off-screen focused nodes', async t => {
  const f = await fixture(t), map = f.document.getElementById('map'); map.focus();
  const key = key => map.dispatchEvent(new f.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  key('+'); assert.ok(viewOf(f).zoom > 1); key('0'); assert.equal(viewOf(f).zoom, 1);
  for (let i = 0; i < 40; i++) key('ArrowLeft');
  const node = f.document.querySelector('.node'); node.focus();
  const p = viewOf(f), x = p.x + parseFloat(node.style.left) * p.zoom, y = p.y + parseFloat(node.style.top) * p.zoom;
  assert.ok(x >= 0 && x + parseFloat(node.style.width) * p.zoom <= 1100, 'focused node is horizontally visible');
  assert.ok(y >= 0 && y + parseFloat(node.style.height) * p.zoom <= 720, 'focused node is vertically visible');
  f.document.getElementById('outline-toggle').click();
  f.document.getElementById('search').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(f.document.getElementById('outline').hidden); assert.equal(f.document.activeElement.id, 'outline-toggle');
});

test('background refresh preserves text scroll, selection direction and IME composition', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  f.type('answer', 'A long draft\n'.repeat(60));
  let answer = f.document.getElementById('answer'); answer.focus(); answer.setSelectionRange(12, 40, 'backward'); answer.scrollTop = 200;
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Shared fund' });
  await until(() => f.document.getElementById('progress').textContent.startsWith('1 answered'), 'background answer');
  answer = f.document.getElementById('answer');
  assert.equal(answer.scrollTop, 200); assert.equal(answer.selectionDirection, 'backward');
  answer.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Different fund' });
  await delay(1350);
  assert.equal(f.document.getElementById('answer'), answer, 'composition target stays mounted');
  answer.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
  await delay(50); assert.equal(f.explorer.doc.nodes[1].answer, '', 'confirming an IME candidate does not submit an answer');
  f.type('answer', 'My completed composition');
  answer.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  await delay(50); assert.equal(f.document.getElementById('answer').value, 'My completed composition');
});

test('whole map fits a wide or deep tree instead of stopping at an unreadable zoom limit', async t => {
  const f = await fixture(t, 340), template = structuredClone(f.explorer.doc);
  for (const deep of [false, true]) {
    const doc = structuredClone(template);
    for (let i = 0; i < 100; i++) doc.nodes.push({ ...template.nodes[1], id: `large-${i}`, parentId: deep && i ? `large-${i - 1}` : doc.rootId });
    await f.explorer.command('import', { revision: f.explorer.doc.revision, document: doc });
    await until(() => f.document.querySelectorAll('.node').length === doc.nodes.length &&
      (deep ? Math.max(...[...f.document.querySelectorAll('.node')].map(e => parseFloat(e.style.top))) > 10000 : true), 'large map rendered');
    f.document.getElementById('fit').click(); const v = viewOf(f);
    assert.ok(v.zoom < .1, 'map can fit below 10%');
    for (const node of f.document.querySelectorAll('.node')) {
      const left = v.x + parseFloat(node.style.left) * v.zoom, top = v.y + parseFloat(node.style.top) * v.zoom;
      assert.ok(left >= 0 && left + parseFloat(node.style.width) * v.zoom <= 340, 'whole width fits');
      assert.ok(top >= 0 && top + parseFloat(node.style.height) * v.zoom <= 720, 'whole height fits');
    }
    f.document.getElementById('zoom-in').click(); assert.ok(viewOf(f).zoom > v.zoom);
  }
});

test('late background reads cannot undo a completed save in the UI', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  let release, started = false;
  f.pauseState(() => { started = true; return new Promise(resolve => { release = resolve; }); });
  await until(() => started, 'old state response held');
  f.type('answer', 'The saved answer'); f.click('Save answer');
  await until(() => f.document.getElementById('answer-status').textContent === 'Answer saved', 'saved response applied');
  f.pauseState(null); release(); await delay(50);
  assert.equal(f.document.getElementById('answer').value, 'The saved answer');
  assert.equal(f.document.getElementById('progress').textContent.startsWith('1 answered'), true);
});

test('adding research scrolls only the answer pane, without native scrolling of the map', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options');
  await until(() => f.explorer.pending?.kind === 'research', 'research request'); f.resolveResearch(findings);
  await until(() => f.document.getElementById('use-recommendation'), 'research rendered');
  const answer = f.document.getElementById('answer'), pane = f.document.querySelector('.node-content'), before = viewOf(f);
  answer.scrollIntoView = () => assert.fail('scrollIntoView can scroll hidden ancestors of the map');
  pane.scrollTop = 400; pane.getBoundingClientRect = () => ({ top: 240 }); answer.getBoundingClientRect = () => ({ top: 0 });
  f.click('Use recommendation');
  assert.deepEqual(viewOf(f), before); assert.ok(pane.scrollTop < 400); assert.equal(f.document.activeElement, answer);
});

test('installed questions expand inside the map, preserve drafts, and collapse to saved previews', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1);
  f.open(a.id);
  assert.ok(f.document.querySelector('#world #node-workspace #answer'), 'answer lives in the expanded map node');
  assert.equal(f.document.querySelector('aside'), null, 'no separate inspector');
  const parent = f.document.querySelector(`[data-node-id="${f.explorer.doc.rootId}"]`);
  const worldY = Number(f.document.getElementById('world').style.transform.match(/translate\([^,]+,([^p]+)px\)/)[1]);
  assert.ok(worldY + parseFloat(parent.style.top) >= 16, 'the parent remains visible above the expanded question');
  f.type('answer', 'Neighbors on our block'); f.open(b.id); f.open(a.id);
  assert.equal(f.document.getElementById('answer').value, 'Neighbors on our block');
  f.click('Save answer'); await until(() => f.explorer.doc.nodes[1].answer, 'answer saved');
  await until(() => f.document.getElementById('answer-status')?.textContent === 'Answer saved', 'save rendered');
  f.click('Collapse node');
  assert.ok(f.document.getElementById('node-workspace').hidden);
  assert.match(f.document.getElementById('nodes').textContent, /Neighbors on our block/);
  f.open(a.id); assert.equal(f.document.getElementById('answer').value, 'Neighbors on our block');
  f.document.getElementById('fit').click(); assert.ok(f.document.getElementById('node-workspace').hidden);
});

test('branch controls hide only descendants, preserve active draft and reveal from the full outline', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    const a = e.doc.nodes[1];
    await e.command('add', { revision: e.doc.revision, nodeId: a.id, category: 'People', question: 'Invite nearby?' });
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes.at(-1).id, category: 'People', question: 'Send a letter?' });
  } });
  const [root, a, b, child, grandchild] = f.explorer.doc.nodes;
  f.open(grandchild.id); f.type('answer', 'Private draft'); chooseState(f, 'assumption');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'draft stored');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries.find(e => e.nodeId === grandchild.id).stateSelected, true);
  f.document.querySelector('.manual summary').click(); f.type('manual-question', 'Private follow-up');
  const revision = f.explorer.doc.revision;
  const toggle = f.document.querySelector(`[data-branch-id="${a.id}"]`);
  assert.equal(toggle?.getAttribute('aria-label'), 'Collapse branch: Who should borrow first?');
  toggle.focus(); toggle.click();
  assert.equal(f.document.getElementById('node-workspace').hidden, true, 'hidden descendant editor closes');
  assert.equal(f.document.activeElement.dataset.nodeId, a.id, 'focus moves to visible ancestor');
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`), null);
  assert.equal(f.document.querySelectorAll('#edges path').length, 2);
  assert.match(f.document.querySelector(`[data-node-id="${a.id}"]`).textContent, /2 hidden.*2 unresolved/);
  assert.equal(f.document.querySelector(`[data-branch-id="${a.id}"]`).getAttribute('aria-expanded'), 'false');
  assert.equal(f.explorer.doc.revision, revision);
  await delay(1350);
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`), null, 'poll retains fold');
  f.document.getElementById('outline-toggle').click();
  const row = [...f.document.querySelectorAll('#outline-list [data-node-id]')].find(e => e.dataset.nodeId === grandchild.id);
  assert.ok(row, 'hidden question is discoverable'); row.click();
  assert.equal(f.document.getElementById('expanded-title').textContent, grandchild.question);
  assert.equal(f.document.getElementById('answer').value, 'Private draft');
  assert.equal(f.document.getElementById('answer-state').value, 'assumption');
  assert.equal(f.document.getElementById('manual-question').value, 'Private follow-up');
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`), 'ancestor path revealed');
  assert.equal(f.explorer.doc.revision, revision);
  assert.equal(f.document.querySelector(`[data-branch-id="${b.id}"]`), null, 'unrelated leaf stays unchanged');
  assert.ok(f.document.querySelector(`[data-branch-id="${root.id}"]`));
});

test('folded research completion and root folding keep saved content and full exports', async t => {
  const f = await fixture(t, 340, undefined, false, { before: e => e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, category: 'People', question: 'Invite nearby?' }) });
  const [root, a, , child] = f.explorer.doc.nodes;
  f.open(child.id); f.document.querySelector('.research-disclosure summary').click(); f.click('Research options');
  await until(() => f.explorer.pending?.kind === 'research', 'research started');
  f.document.querySelector(`[data-branch-id="${a.id}"]`).click();
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`), null);
  f.resolveResearch(findings);
  await until(() => !!f.explorer.doc.nodes.find(n => n.id === child.id).research, 'research saved');
  await until(() => f.document.getElementById('request-status').hidden, 'research completion applied to canvas');
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`), null, 'completion does not reveal branch');
  const revision = f.explorer.doc.revision;
  f.document.querySelector(`[data-branch-id="${root.id}"]`).click();
  assert.equal(f.document.querySelectorAll('#nodes .node').length, 1);
  assert.equal(f.document.querySelectorAll('#edges path').length, 0);
  assert.equal(f.explorer.doc.revision, revision, 'view fold does not save');
  f.document.querySelector(`[data-branch-id="${root.id}"]`).click();
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${a.id}"]`));
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`), null, 'nested fold remains');
  const saved = await (await f.window.fetch('export.json')).json();
  assert.equal(saved.nodes.find(n => n.id === child.id).research.summary, findings.summary);
  assert.match(await (await f.window.fetch('export.md')).text(), /Invite nearby\?/);
});

test('folding the expanded node keeps its editor while outline branch focus stays in the outline', async t => {
  const f = await fixture(t, 340, undefined, false, { before: e => e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, category: 'People', question: 'Invite nearby?' }) });
  const a = f.explorer.doc.nodes[1], child = f.explorer.doc.nodes.at(-1);
  f.open(a.id); f.type('answer', 'Keep editing');
  f.document.getElementById('branch-workspace').click();
  assert.equal(f.document.getElementById('node-workspace').hidden, false);
  assert.equal(f.document.getElementById('answer').value, 'Keep editing');
  assert.equal(f.document.activeElement.id, 'branch-workspace');
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`), null);
  f.document.getElementById('outline-toggle').click();
  const outlineToggle = f.document.querySelector(`#outline-list [data-branch-id="${a.id}"]`);
  outlineToggle.focus(); outlineToggle.click();
  assert.equal(f.document.activeElement.closest('#outline-list')?.id, 'outline-list');
  assert.equal(f.document.activeElement.getAttribute('aria-expanded'), 'true');
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`));
});

test('research callbacks and follow-ups work inside a narrow expanded node without replacing a draft', async t => {
  const f = await fixture(t, 340), a = f.explorer.doc.nodes[1];
  f.open(a.id); f.type('answer', 'My own thought');
  f.document.querySelector('.research-disclosure summary').click();
  assert.ok(f.document.querySelector('.research-disclosure').open);
  f.click('Research options');
  await until(() => f.explorer.pending?.kind === 'research', 'research requested');
  f.type('answer', 'My own thought, still editing');
  f.resolveResearch(findings);
  await until(() => f.document.querySelector('#node-workspace .option'), 'research delivered');
  assert.equal(f.document.getElementById('answer').value, 'My own thought, still editing');
  assert.match(f.document.getElementById('node-workspace').textContent, /not externally verified/);
  f.click('Use this option');
  assert.match(f.document.getElementById('answer').value, /^My own thought, still editing\n\nOne block/);
  assert.equal(f.explorer.doc.nodes[1].answer, '');
  f.click('Save & explore deeper'); await until(() => f.explorer.pending?.kind === 'questions', 'follow-ups requested');
  await f.explorer.receive('questions', { requestId: f.explorer.pending.id, questions: [{ category: 'People', question: 'How will you invite them?' }] });
  await until(() => f.document.getElementById('accept-questions'), 'review follow-ups'); f.document.getElementById('accept-questions').click();
  await until(() => [...f.document.querySelectorAll('#node-workspace .followup')].length, 'follow-up link');
  f.document.querySelector('#node-workspace .followup').click();
  assert.equal(f.document.getElementById('expanded-title').textContent, 'How will you invite them?');
  assert.ok(parseFloat(f.document.getElementById('node-workspace').style.width) <= 308);
});

test('typing while saving survives the response and editing does not drag the canvas', async t => {
  const f = await fixture(t), a = f.explorer.doc.nodes[1]; f.open(a.id);
  const input = f.document.getElementById('answer');
  input.dispatchEvent(new f.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  assert.equal(f.captures(), 0, 'text editing is not canvas panning');
  let release, started = false;
  f.pauseAnswer(() => { started = true; return new Promise(resolve => { release = resolve; }); });
  f.type('answer', 'Submitted answer'); f.click('Save answer'); await until(() => started, 'save held');
  f.type('answer', 'Newer unsaved thought'); release();
  await until(() => f.explorer.doc.nodes[1].answer === 'Submitted answer', 'save delivered');
  await delay(80);
  assert.equal(f.document.getElementById('answer').value, 'Newer unsaved thought');
  assert.match(f.document.getElementById('answer-status').textContent, /Saving draft|Draft saved locally/);
});

test('recommendations and selected details append to editable drafts with safe undo', async t => {
  const f = await fixture(t, 340), a = f.explorer.doc.nodes[1]; f.open(a.id);
  f.type('answer', 'My own words');
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options');
  await until(() => f.explorer.pending?.kind === 'research', 'research requested');
  const richer = structuredClone(findings); richer.proposedAnswer = 'I will run a pilot.';
  richer.options[0].proposedAnswer = 'I will start on my block.';
  richer.options[0].details = [{ label: 'Pilot size', value: 'Ten neighbors' }, { label: 'Duration', value: 'One month' }];
  f.resolveResearch(richer);
  await until(() => f.document.getElementById('use-recommendation'), 'new controls');
  f.click('Use recommendation');
  assert.equal(f.document.getElementById('answer').value, 'My own words\n\nI will run a pilot.');
  assert.equal(f.explorer.doc.nodes[1].answer, '');
  f.click('Undo addition'); assert.equal(f.document.getElementById('answer').value, 'My own words');
  const check = f.document.getElementById('detail-0-0'); check.click(); check.focus();
  // A map refresh retains both the checkbox selection and its focus.
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.nodes[2].id, answer: 'Shared fund' });
  await until(() => f.document.getElementById('progress').textContent.startsWith('1 answered'), 'background refresh');
  assert.equal(f.document.getElementById('detail-0-0').checked, true); assert.equal(f.document.activeElement.id, 'detail-0-0');
  f.click('Add selected details');
  assert.equal(f.document.getElementById('answer').value, 'My own words\n\nPilot size: Ten neighbors');
  f.type('answer', f.document.getElementById('answer').value + '\nNew typing');
  assert.equal(f.document.getElementById('undo-addition').disabled, true, 'undo cannot erase newer typing');
  f.click('Use this option'); f.click('Undo addition');
  assert.match(f.document.getElementById('answer').value, /New typing$/);
  f.type('answer', 'x'.repeat(19999)); f.click('Use recommendation');
  assert.equal(f.document.getElementById('answer').value.length, 19999); assert.match(f.document.getElementById('notice').textContent, /too long/);
  await delay(50); // Let the voice-status refresh from the background render settle before closing jsdom.
});

test('pending work remains reachable from the whole map and cancellation preserves drafts', async t => {
  const f = await fixture(t), a = f.explorer.doc.nodes[1]; f.open(a.id);
  f.type('answer', 'Keep this while researching');
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options');
  await until(() => !f.document.getElementById('request-status').hidden, 'request status');
  f.document.getElementById('fit').click();
  f.document.getElementById('request-status').click();
  assert.equal(f.document.getElementById('expanded-title').textContent, a.question);
  f.click('Cancel request'); await until(() => !f.explorer.pending, 'cancelled');
  await until(() => !f.document.querySelector('#node-workspace .pending'), 'cancellation rendered');
  assert.equal(f.document.getElementById('answer').value, 'Keep this while researching');
});

test('manual question drafts survive navigation and unsaved answers block finish', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  f.document.querySelector('.manual summary').click();
  f.type('manual-question', 'How should we invite people?');
  f.open(b.id); f.open(a.id);
  assert.ok(f.document.querySelector('.manual').open, 'disclosure state survives immediate navigation');
  assert.equal(f.document.getElementById('manual-question').value, 'How should we invite people?');
  f.document.querySelector('.manual form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.nodes.length === 4, 'manual question added');
  await until(() => f.document.getElementById('manual-question').value === '', 'manual input cleared');
  assert.equal(f.explorer.doc.nodes[3].parentId, a.id);
  await until(() => f.document.getElementById('cancel-request'), 'seed generation shown');
  f.document.getElementById('cancel-request').click(); await until(() => !f.explorer.pending && !f.document.getElementById('cancel-request'), 'cancel seed generation');
  f.type('answer', 'Not saved yet'); f.document.getElementById('finish').click();
  await until(() => f.document.getElementById('notice').textContent.includes('Save your draft'), 'finish guard');
  assert.match(f.document.getElementById('notice').textContent, /Save your draft/);
  assert.equal(f.explorer.doc.finishedAt, null);
});

test('a rejected stale save keeps the answer draft available', async t => {
  const f = await fixture(t), a = f.explorer.doc.nodes[1]; f.open(a.id);
  f.type('answer', 'My unsaved change');
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: a.id, answer: 'A separately saved change' });
  f.click('Save answer');
  await until(() => f.document.getElementById('notice').textContent.includes('The map changed'), 'stale save error');
  assert.equal(f.document.getElementById('answer').value, 'My unsaved change');
  assert.equal(f.explorer.doc.nodes[1].answer, 'A separately saved change');
});

test('keyboard focus survives research, cancellation, and background map updates', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  f.document.querySelector('.research-disclosure summary').click();
  const research = [...f.document.querySelectorAll('#node-workspace button')].find(e => e.textContent === 'Research options');
  research.focus(); research.click();
  await until(() => f.document.querySelector('#node-workspace .pending'), 'pending controls');
  assert.equal(f.document.activeElement.textContent, 'Cancel request');
  f.click('Cancel request'); await until(() => !f.document.querySelector('#node-workspace .pending'), 'cancellation rendered');
  assert.equal(f.document.activeElement.id, 'expanded-title');
  f.document.getElementById('fit').click();
  f.document.querySelector(`[data-node-id="${a.id}"]`).focus();
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Repairs from a shared fund' });
  await until(() => f.document.getElementById('nodes').textContent.includes('Repairs from a shared fund'), 'background update');
  assert.equal(f.document.activeElement.dataset.nodeId, a.id);
});

function voiceFixture(mode = 'push_to_talk') {
  let job, starts = 0, finishes = 0, cancels = 0;
  return {
    status: async () => ({ ready: true, shortcut: { code: 'Space', ctrl: true, alt: false, shift: false, meta: false }, label: 'Ctrl + Space', mode }),
    start(id) { starts++; job = { id, phase: 'listening' }; return job; },
    poll() { return job; },
    finish() { finishes++; job = { ...job, phase: 'done', text: 'our neighbors' }; return job; },
    cancel() { cancels++; job = { ...job, phase: 'cancelled' }; return job; },
    close() {},
    counts: () => ({ starts, finishes, cancels }),
  };
}
const key = (f, type, props = {}) => f.document.getElementById('answer').dispatchEvent(new f.window.KeyboardEvent(type, { bubbles: true, cancelable: true, key: ' ', code: 'Space', ctrlKey: true, ...props }));
function activateButtonWithKeyboard(f, button) {
  button.focus();
  const down = new f.window.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
  button.dispatchEvent(down);
  if (!down.defaultPrevented) button.click(); // jsdom does not synthesize native button activation.
  button.dispatchEvent(new f.window.KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
}
function segmentedVoiceFixture() {
  const voice = voiceFixture(); let job, acknowledgments = [], cancels = 0;
  return { ...voice,
    start(id) { return job = { id, phase: 'listening' }; }, poll() { return job; },
    finish() { return job = { ...job, phase: 'done' }; },
    cancel() { cancels++; return job = { ...job, phase: 'cancelled', segment: undefined }; },
    ack(id, sequence) { acknowledgments.push(sequence); if (job.segment?.sequence === sequence) job = { ...job, segment: undefined }; return job; },
    publish(sequence, text) { job = { ...job, segment: { sequence, text } }; },
    fail() { job = { ...job, phase: 'error', error: 'Model failed after partial speech.' }; },
    counts: () => ({ acknowledgments, cancels }),
  };
}

const draftInput = (e, node = e.doc.nodes[1], text = 'Recovered 🌿\n  exact  ') => ({ journey: e.activeKey ?? e.doc.id, nodeId: node.id, text, base: { question: node.question, answer: node.answer }, revision: 0 });

test('draft recovery does not overwrite typing, selection or IME while its read is pending', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, 340, undefined, false, { before: e => e.writeDraft(draftInput(e)), holdDraftRead: () => gate });
  t.after(release);
  const node = f.explorer.doc.nodes[1]; f.open(node.id);
  const editor = f.document.getElementById('answer'); editor.focus();
  editor.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  f.type('answer', 'New text 日本語'); editor.setSelectionRange(2, 4);
  release();
  await until(() => f.document.getElementById('recover-draft'), 'explicit recovery choice');
  assert.equal(editor.value, 'New text 日本語'); assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 4);
  assert.equal(f.document.querySelector('[aria-label="Recovered draft"]').value, 'Recovered 🌿\n  exact  ');
  editor.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  f.document.getElementById('keep-draft').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'chosen local text persisted');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'New text 日本語');
});

test('matching draft recovery and discard are explicit and survive journey reopen', async t => {
  const f = await fixture(t, 340, undefined, true, { before: e => e.writeDraft(draftInput(e)) });
  await delay(50); const node = f.explorer.doc.nodes[1]; f.open(node.id);
  assert.equal(f.document.getElementById('answer').value, 'Recovered 🌿\n  exact  ');
  assert.equal(node.answer, '');
  f.document.getElementById('discard-draft').click();
  await until(() => f.document.getElementById('answer').value === '', 'discard restored committed answer');
  const first = f.explorer.activeKey;
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelector('.library-entry [data-action="open"]'), 'library entry');
  f.document.querySelector('.library-entry [data-action="open"]').click();
  await until(() => !f.document.getElementById('workspace').hidden, 'reopen'); await delay(50);
  f.open(node.id); assert.equal(f.explorer.activeKey, first); assert.equal(f.document.getElementById('answer').value, '');
});

test('draft writes debounce, preserve exact whitespace and flush before switching journeys', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.activeKey, node = f.explorer.doc.nodes[1];
  await f.explorer.library.import(createDocument('Second with drafts'));
  f.open(node.id); f.type('answer', ' first '); f.type('answer', '  final 🌿\n ');
  await delay(100); assert.equal((await f.explorer.readDrafts(first)).entries.length, 0);
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'entries');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('Second with drafts')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey !== first && f.document.getElementById('map-title').textContent === 'Second with drafts' && !f.document.getElementById('workspace').hidden, 'flushed switch');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'entries reopened');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('A tool library')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey === first && f.document.getElementById('map-title').textContent === 'A tool library' && !f.document.getElementById('workspace').hidden, 'first journey'); await delay(50);
  f.open(node.id); assert.equal(f.document.getElementById('answer').value, '  final 🌿\n ');
});

test('failed draft flush blocks switching and keeps text available for retry', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.activeKey, node = f.explorer.doc.nodes[1];
  await f.explorer.library.import(createDocument('Second draft failure'));
  await f.explorer.readDrafts(first); const write = f.explorer.draftStore.write;
  f.explorer.draftStore.write = async () => { throw new Error('Disk full'); };
  f.open(node.id); f.type('answer', 'Do not lose this');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library visible');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('Second draft failure')).querySelector('[data-action="open"]').click();
  await until(() => f.document.getElementById('notice').textContent.includes('Disk full'), 'failed flush');
  assert.equal(f.explorer.activeKey, first); f.document.getElementById('library-return').click();
  assert.equal(f.document.getElementById('answer').value, 'Do not lose this');
  f.explorer.draftStore.write = write; f.document.getElementById('retry-draft').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'retried');
});

test('changed committed base keeps answer and recovered draft separate until chosen', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.writeDraft(draftInput(e));
    await e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: 'New committed decision' });
  } });
  await delay(40); f.open(f.explorer.doc.nodes[1].id);
  assert.equal(f.document.getElementById('answer').value, 'New committed decision');
  assert.equal(f.document.querySelector('[aria-label="Recovered draft"]').value, 'Recovered 🌿\n  exact  ');
  f.document.getElementById('recover-draft').click();
  await until(() => f.document.getElementById('answer').value.startsWith('Recovered'), 'chosen recovery');
  assert.equal(f.explorer.doc.nodes[1].answer, 'New committed decision');
});

test('answer save captures the click text while a draft flush is still pending', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  let release, started; const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  f.pauseDraftWrite(() => { started(); return gate; }); t.after(release);
  f.type('answer', 'Clicked save'); f.click('Save answer'); await entered;
  f.type('answer', 'Typed after click'); release(); f.pauseDraftWrite(null);
  await until(() => f.explorer.doc.nodes[1].answer, 'committed captured text');
  assert.equal(f.explorer.doc.nodes[1].answer, 'Clicked save');
  assert.equal(f.document.getElementById('answer').value, 'Typed after click');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'later typing saved locally');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'Typed after click');
});

test('initial draft storage failure can be retried without losing editor text', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.readDrafts(e.doc.id); const read = e.draftStore.read.bind(e.draftStore); let fail = true;
    e.draftStore.read = () => { if (fail) { fail = false; throw new Error('Temporary read failure'); } return read(); };
  } });
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Typed despite read failure');
  await until(() => f.document.getElementById('retry-draft'), 'retry available');
  f.document.getElementById('retry-draft').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'recovery retried');
  assert.equal(f.document.getElementById('answer').value, 'Typed despite read failure');
});

test('another canvas draft stays separate and explicit conflict choices use revision checks', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; await delay(30); f.open(node.id);
  const remote = await f.explorer.writeDraft(draftInput(f.explorer, node, 'Remote writer'));
  f.type('answer', 'Local writer');
  await until(() => f.document.getElementById('keep-draft'), 'conflict discovered');
  assert.equal(f.document.getElementById('answer').value, 'Local writer');
  assert.equal(f.document.querySelector('[aria-label="Recovered draft"]').value, 'Remote writer');
  await f.explorer.writeDraft({ ...draftInput(f.explorer, node, 'Remote writer newer'), revision: remote.revision });
  f.document.getElementById('keep-draft').click();
  await until(() => f.document.getElementById('notice').textContent.includes('Another canvas'), 'stale explicit choice refused');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'Remote writer newer');
  assert.equal(f.document.getElementById('answer').value, 'Local writer');
});

test('keyboard answer save clears its draft without treating restored focus as typing', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id); const editor = f.document.getElementById('answer');
  editor.focus(); f.type('answer', 'Committed keyboard answer');
  editor.dispatchEvent(new f.window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter', ctrlKey: true }));
  await until(() => f.explorer.pending?.kind === 'questions', 'keyboard answer saved');
  await delay(100);
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, null);
  assert.equal(f.document.getElementById('answer-status').textContent, 'Answer saved');
});

test('recovery based on an older state read cannot replace a newer committed answer', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, 340, undefined, false, { before: e => e.writeDraft(draftInput(e)), holdDraftRead: () => gate }); t.after(release);
  const node = f.explorer.doc.nodes[1]; f.open(node.id);
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: node.id, answer: 'Committed during recovery' });
  await until(() => f.document.getElementById('answer').value === 'Committed during recovery', 'new state');
  release(); await until(() => f.document.getElementById('recover-draft'), 'stale read choice');
  assert.equal(f.document.getElementById('answer').value, 'Committed during recovery');
});

test('failed writes permit explicit loss of unsaved editor text before a switch', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.activeKey;
  await f.explorer.library.import(createDocument('After discard'));
  await f.explorer.readDrafts(first); f.explorer.draftStore.write = async () => { throw new Error('Disk full'); };
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Explicitly abandon me');
  await until(() => f.document.getElementById('discard-unsaved-draft'), 'discard unsaved option');
  f.document.getElementById('discard-unsaved-draft').click(); await until(() => f.document.getElementById('answer').value === '', 'local discard');
  f.document.getElementById('library-toggle').click(); await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'entries');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('After discard')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey !== first, 'switch after explicit discard');
});
test('optional creation guidance is saved without carrying settings into another journey', async t => {
  const f = await fixture(t, 340, undefined, true);
  f.document.getElementById('library-toggle').click();
  const details = f.document.getElementById('start-guidance');
  assert.equal(details.open, false);
  details.open = true;
  f.type('topic', 'A shared orchard');
  f.type('start-objective', 'Decide where to plant 🌳');
  f.type('start-criteria', 'Neighbors can reach it');
  f.document.getElementById('start-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc?.topic === 'A shared orchard', 'guided journey created');
  await until(() => !f.document.getElementById('workspace').hidden && f.document.getElementById('start-objective').value === '', 'new journey rendered');
  assert.equal(f.explorer.doc.objective, 'Decide where to plant 🌳');
  assert.equal(f.explorer.doc.successCriteria, 'Neighbors can reach it');
  await f.explorer.command('cancel');
  f.document.getElementById('library-toggle').click();
  await until(() => !f.document.getElementById('welcome').hidden, 'library visible');
  assert.equal(f.document.getElementById('start-objective').value, '');
  assert.equal(f.document.getElementById('start-criteria').value, '');
});
test('guidance edit, cancel, and stale retry preserve the expanded answer draft and caret', async t => {
  const f = await fixture(t, 340), node = f.explorer.doc.nodes[1];
  f.open(node.id);
  f.type('answer', 'A local draft 🌿');
  const answer = f.document.getElementById('answer'); answer.focus(); answer.setSelectionRange(4, 4);
  f.document.getElementById('edit-guidance').click();
  assert.equal(f.document.activeElement.id, 'edit-objective');
  f.type('edit-objective', 'Discard me');
  f.document.getElementById('cancel-guidance').click();
  assert.equal(f.explorer.doc.objective, '');
  assert.equal(f.document.activeElement.id, 'edit-guidance');
  assert.equal(f.document.getElementById('answer').selectionStart, 4);
  f.document.getElementById('edit-guidance').click();
  f.type('edit-objective', 'Understand the neighbors');
  f.type('edit-criteria', 'A usable plan');
  f.document.getElementById('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.objective === 'Understand the neighbors' && !f.document.getElementById('guidance-dialog').open, 'guidance saved');
  assert.equal(f.document.getElementById('answer').value, 'A local draft 🌿');
  assert.equal(f.document.getElementById('answer').selectionStart, 4);
  assert.equal(f.document.activeElement.id, 'edit-guidance');
  assert.equal(f.document.getElementById('node-workspace').hidden, false);
  f.document.getElementById('edit-guidance').click();
  f.type('edit-objective', 'Keep this on failure');
  const second = await new Explorer({ file: f.explorer.file }).load();
  await second.command('guidance', { revision: second.doc.revision, objective: 'Another canvas', successCriteria: 'A usable plan' });
  f.document.getElementById('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => /Another canvas/.test(f.document.getElementById('guidance-error').textContent), 'stale edit rejected');
  assert.equal(f.document.getElementById('edit-objective').value, 'Keep this on failure');
  assert.equal(f.document.getElementById('guidance-dialog').open, true);
});
test('stale guidance retry refreshes an unrelated answer and preserves the local draft', async t => {
  const f = await fixture(t, 340), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'My unsaved answer');
  f.document.getElementById('edit-guidance').click();
  f.type('edit-objective', 'My objective');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('answer', { revision: other.doc.revision, nodeId: node.id, answer: 'Other saved answer' });
  const form = f.document.getElementById('guidance-form');
  form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !f.document.getElementById('refresh-guidance').hidden, 'refresh offered');
  f.document.getElementById('refresh-guidance').click();
  await until(() => f.explorer.doc.nodes[1].answer === 'Other saved answer' && f.document.getElementById('refresh-guidance').hidden, 'latest answer loaded');
  assert.equal(f.document.getElementById('edit-objective').value, 'My objective');
  assert.equal(f.document.getElementById('guidance-conflict').hidden, true);
  form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.objective === 'My objective' && !f.document.getElementById('guidance-dialog').open, 'retry saved');
  assert.equal(f.explorer.doc.nodes[1].answer, 'Other saved answer');
  assert.equal(f.document.getElementById('answer').value, 'My unsaved answer');
});
test('stale guidance retry requires an explicit choice before replacing changed guidance', async t => {
  const f = await fixture(t, 340);
  f.document.getElementById('edit-guidance').click();
  f.type('edit-objective', 'My objective');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: 'Other objective', successCriteria: 'Other criterion' });
  const form = f.document.getElementById('guidance-form');
  form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !f.document.getElementById('refresh-guidance').hidden, 'refresh offered');
  f.document.getElementById('refresh-guidance').click();
  await until(() => !f.document.getElementById('guidance-conflict').hidden, 'conflict choice shown');
  assert.equal(f.document.getElementById('edit-objective').value, 'My objective');
  assert.equal(f.explorer.doc.objective, 'Other objective');
  assert.equal(f.document.getElementById('save-guidance').disabled, true);
  f.document.getElementById('keep-guidance-edits').click();
  assert.equal(f.document.getElementById('save-guidance').disabled, false);
  form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.objective === 'My objective' && !f.document.getElementById('guidance-dialog').open, 'explicit overwrite saved');
  assert.equal(f.explorer.doc.successCriteria, '');
});

test('one conflicting node does not prevent other nodes from saving drafts', async t => {
  const f = await fixture(t), [first, second] = f.explorer.doc.nodes.slice(1); await delay(30);
  await f.explorer.writeDraft(draftInput(f.explorer, first, 'Other canvas'));
  f.open(first.id); f.type('answer', 'Conflicting local text');
  await until(() => f.document.getElementById('keep-draft'), 'first conflict');
  f.open(second.id); f.type('answer', 'Independent draft');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'second persisted independently');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries.find(e => e.nodeId === second.id).text, 'Independent draft');
});

test('discarding failed editor changes keeps the previous persisted draft visible', async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id); f.type('answer', 'Previously persisted');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'initial save');
  f.explorer.draftStore.write = async () => { throw new Error('Disk full'); }; f.type('answer', 'Failed later edit');
  await until(() => f.document.getElementById('discard-unsaved-draft'), 'failure option');
  f.document.getElementById('discard-unsaved-draft').click();
  await until(() => f.document.querySelector('[aria-label="Recovered draft"]'), 'previous persisted draft still visible');
  assert.equal(f.document.getElementById('answer').value, '');
  assert.equal(f.document.querySelector('[aria-label="Recovered draft"]').value, 'Previously persisted');
  f.document.getElementById('finish').click();
  await until(() => f.document.getElementById('notice').textContent.includes('Save your draft'), 'finish still honest');
  assert.equal(f.explorer.doc.finishedAt, null);
});

test('dictated text and recommendation undo persist without committing an answer', async t => {
  const f = await fixture(t, 340, voiceFixture()), node = f.explorer.doc.nodes[1]; f.open(node.id); chooseState(f, 'needs-evidence');
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'voice ready');
  f.document.getElementById('answer').focus(); key(f, 'keydown');
  await until(() => /^Listening/.test(f.document.getElementById('voice-status').textContent), 'listening'); key(f, 'keyup');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'dictation persisted');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'our neighbors');
  f.click('Research options'); await until(() => f.explorer.pending?.kind === 'research', 'research pending');
  f.resolveResearch(findings); await until(() => f.document.getElementById('use-recommendation'), 'recommendation ready');
  f.document.getElementById('use-recommendation').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'addition persisted');
  assert.match((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, /Try a small pilot/);
  f.document.getElementById('undo-addition').click();
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'undo persisted');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'our neighbors');
  assert.equal(f.explorer.doc.nodes[1].answer, '');
  assert.equal(f.document.getElementById('answer-state').value, 'needs-evidence');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].answerState, 'needs-evidence');
});

test('Ctrl+Space dictates only into a focused answer, at the selection, without saving', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice), node = f.explorer.doc.nodes[1];
  f.open(node.id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'voice settings');
  key(f, 'keydown'); await delay(20); assert.equal(voice.counts().starts, 0, 'answer must own focus');
  const answer = f.document.getElementById('answer'); answer.focus();
  f.type('answer', 'For everyone nearby.'); answer.setSelectionRange(4, 12);
  key(f, 'keydown', { altKey: true }); await delay(10); assert.equal(voice.counts().starts, 0, 'exact modifiers');
  key(f, 'keydown'); key(f, 'keydown', { repeat: true });
  await until(() => /^Listening/.test(f.document.getElementById('voice-status').textContent), 'listening');
  assert.equal(voice.counts().starts, 1);
  key(f, 'keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false });
  await until(() => answer.value.includes('our neighbors'), 'dictated draft');
  assert.equal(answer.value, 'For our neighbors nearby.'); assert.equal(node.answer, '');
  assert.match(f.document.getElementById('answer-status').textContent, /Saving draft|Draft saved locally/);
  assert.equal(voice.counts().finishes, 1);
});

test('typing, Escape and focus loss cancel dictation without overwriting a draft', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'settings');
  const answer = f.document.getElementById('answer'); answer.focus();
  key(f, 'keydown'); await until(() => voice.counts().starts === 1, 'start');
  f.type('answer', 'Keep my edit'); await until(() => voice.counts().cancels === 1, 'edit cancels');
  key(f, 'keyup'); await delay(30); assert.equal(answer.value, 'Keep my edit');
  key(f, 'keydown'); await until(() => voice.counts().starts === 2, 'restart');
  key(f, 'keydown', { key: 'Escape', code: 'Escape', ctrlKey: false });
  await until(() => voice.counts().cancels === 2, 'escape cancels');
  assert.equal(f.document.getElementById('node-workspace').hidden, false, 'escape cancels before collapsing');
  key(f, 'keydown'); await until(() => voice.counts().starts === 3, 'restart');
  answer.blur(); await until(() => voice.counts().cancels === 3, 'blur cancels');
  assert.equal(voice.counts().finishes, 0);
});

test('toggle dictation ignores key release and finishes with the same configured shortcut', async t => {
  const voice = voiceFixture('toggle'), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Press Ctrl'), 'toggle settings');
  const answer = f.document.getElementById('answer'); answer.focus(); key(f, 'keydown');
  await until(() => /^Listening/.test(f.document.getElementById('voice-status').textContent), 'listening');
  key(f, 'keyup'); await delay(20); assert.equal(voice.counts().finishes, 0);
  key(f, 'keydown'); await until(() => answer.value === 'our neighbors', 'toggle finish');
});

test('Record and Stop preserve the answer selection and state without committing', async t => {
  const voice = voiceFixture(), f = await fixture(t, 340, voice), node = f.explorer.doc.nodes[1]; f.open(node.id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  chooseState(f, 'needs-evidence');
  const answer = f.document.getElementById('answer'); answer.focus(); f.type('answer', 'For everyone nearby.'); answer.setSelectionRange(4, 12);
  const record = f.document.getElementById('voice-record'); record.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true })); record.focus();
  assert.equal(voice.counts().cancels, 0, 'moving to Record keeps the answer workspace active');
  answer.setSelectionRange(0, 0); // A pointer activation must use its pre-focus capture.
  record.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true, detail: 1 })); await until(() => f.document.getElementById('voice-stop')?.disabled === false, 'Stop ready');
  key(f, 'keyup'); assert.equal(voice.counts().finishes, 0, 'shortcut release cannot stop button recording');
  f.document.getElementById('voice-stop').click();
  await until(() => answer.value === 'For our neighbors nearby.', 'transcript inserted at captured selection');
  assert.equal(f.document.getElementById('answer-state').value, 'needs-evidence');
  assert.equal(node.answer, ''); assert.equal(voice.counts().starts, 1); assert.equal(voice.counts().finishes, 1);
});

test('aborted Record pointer capture does not replace a later keyboard caret', async t => {
  const voice = voiceFixture(), f = await fixture(t, 340, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  const answer = f.document.getElementById('answer'), record = f.document.getElementById('voice-record');
  answer.focus(); f.type('answer', 'One two three'); answer.setSelectionRange(0, 3);
  record.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true }));
  answer.setSelectionRange(4, 7); record.focus(); record.click();
  await until(() => !f.document.getElementById('voice-stop').disabled, 'listening');
  f.document.getElementById('voice-stop').click();
  await until(() => answer.value.includes('our neighbors'), 'dictated');
  assert.equal(answer.value, 'One our neighbors three');
});

test('streamed token chunks preserve exact words Unicode and order with durable draft acknowledgments', async t => {
  const voice = segmentedVoiceFixture(), f = await fixture(t, 340, voice), node = f.explorer.doc.nodes[1]; f.open(node.id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'ready');
  chooseState(f, 'needs-evidence'); const answer = f.document.getElementById('answer');
  answer.focus(); f.type('answer', 'For everyone nearby.'); answer.setSelectionRange(4, 12);
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'original draft persisted');
  f.document.getElementById('voice-record').click(); await until(() => !f.document.getElementById('voice-stop').disabled, 'listening');
  let release; f.pauseDraftWrite(() => new Promise(resolve => { release = resolve; }));
  voice.publish(1, 'our neigh'); await until(() => answer.value === 'For our neigh nearby.', 'first visible chunk');
  await until(() => release, 'draft write pending'); assert.deepEqual(voice.counts().acknowledgments, []);
  f.pauseDraftWrite(null); release(); await until(() => voice.counts().acknowledgments.length === 1, 'durable ack');
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'For our neigh nearby.');
  voice.publish(1, 'our neigh'); await delay(250); assert.equal(answer.value, 'For our neigh nearby.', 'duplicate ignored');
  voice.publish(2, 'bors café 🌱 again again'); await until(() => voice.counts().acknowledgments.includes(2), 'second durable ack');
  assert.equal(answer.value, 'For our neighbors café 🌱 again again nearby.');
  assert.equal(f.document.getElementById('answer-state').value, 'needs-evidence'); assert.equal(node.answer, '');
  voice.fail(); await until(() => /Model failed/.test(f.document.getElementById('voice-status').textContent), 'partial failure');
  assert.match(f.document.getElementById('voice-status').textContent, /2.*chunk|retained/i);
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, answer.value);
});

test('voice draft failure preserves visible partial text and stops without acknowledging a save', async t => {
  const voice = segmentedVoiceFixture(), f = await fixture(t, 340, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'ready');
  f.document.getElementById('answer').focus(); f.document.getElementById('voice-record').click();
  await until(() => !f.document.getElementById('voice-stop').disabled, 'listening');
  f.explorer.draftStore.write = async () => { throw new Error('Disk full'); };
  voice.publish(1, 'Keep these words');
  await until(() => voice.counts().cancels === 1, 'capture stopped after save failure');
  assert.equal(f.document.getElementById('answer').value, 'Keep these words');
  assert.deepEqual(voice.counts().acknowledgments, []);
  assert.equal(f.document.getElementById('answer-status').textContent, 'Draft could not be saved');
  assert.ok(f.document.getElementById('retry-draft')); assert.match(f.document.getElementById('voice-status').textContent, /not saved|could not be saved/);
});

test('voice caret changes and out-of-order chunks cannot overwrite accepted partial text', async t => {
  const voice = segmentedVoiceFixture(), f = await fixture(t, 340, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'ready');
  const answer = f.document.getElementById('answer'); answer.focus(); f.document.getElementById('voice-record').click();
  await until(() => !f.document.getElementById('voice-stop').disabled, 'listening');
  voice.publish(1, 'Keep'); await until(() => voice.counts().acknowledgments.length === 1, 'first chunk');
  answer.setSelectionRange(0, 0); voice.publish(2, ' stale');
  await until(() => voice.counts().cancels === 1, 'caret move cancels'); assert.equal(answer.value, 'Keep');
  f.document.getElementById('voice-record').click(); await until(() => !f.document.getElementById('voice-stop').disabled, 'retry');
  voice.publish(2, 'out of order'); await until(() => voice.counts().cancels === 2, 'out of order cancels');
  assert.equal(answer.value, 'Keep');
});

test('streamed dictation accepts the exact answer limit and rejects a whole exceeding chunk', async t => {
  const voice = segmentedVoiceFixture(), f = await fixture(t, 340, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'ready');
  const answer = f.document.getElementById('answer'); answer.focus(); f.type('answer', 'x'.repeat(19996) + ' '); answer.setSelectionRange(19997, 19997);
  f.document.getElementById('voice-record').click(); await until(() => !f.document.getElementById('voice-stop').disabled, 'listening');
  voice.publish(1, 'abc'); await until(() => voice.counts().acknowledgments.length === 1, 'exact limit persisted');
  assert.equal(answer.value.length, 20000);
  voice.publish(2, 'd'); await until(() => voice.counts().cancels === 1, 'over limit stopped');
  assert.equal(answer.value.length, 20000); assert.ok(answer.value.endsWith(' abc'));
  assert.match(f.document.getElementById('voice-status').textContent, /answer limit/);
});

test('Stop shortcut and Cancel keep accepted voice chunks as recoverable drafts', async t => {
  const voice = segmentedVoiceFixture(), f = await fixture(t, 340, voice), node = f.explorer.doc.nodes[1]; f.open(node.id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'ready');
  const answer = f.document.getElementById('answer'); answer.focus(); f.document.getElementById('voice-record').click();
  await until(() => !f.document.getElementById('voice-stop').disabled, 'listening');
  voice.publish(1, 'First'); await until(() => voice.counts().acknowledgments.length === 1, 'first chunk');
  key(f, 'keyup'); assert.equal(f.document.getElementById('voice-stop').disabled, false, 'button capture ignores key release');
  key(f, 'keydown'); await until(() => !f.document.getElementById('voice-record').disabled, 'shortcut finished');
  assert.equal(answer.value, 'First'); assert.equal(node.answer, '');
  f.document.getElementById('voice-record').click(); await until(() => !f.document.getElementById('voice-stop').disabled, 'second recording');
  voice.publish(1, 'Second'); await until(() => voice.counts().acknowledgments.length === 2, 'second draft chunk');
  f.document.getElementById('voice-cancel').click(); await until(() => voice.counts().cancels === 1, 'cancel');
  assert.equal(answer.value, 'First Second'); assert.match(f.document.getElementById('voice-status').textContent, /1 chunk retained/);
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, 'First Second'); assert.equal(node.answer, '');
  voice.publish(2, 'stale'); await delay(250); assert.equal(answer.value, 'First Second');
});

test('a stale listening poll cannot regress the stopped dictation phase', async t => {
  const voice = voiceFixture(); let id, release, phase = 'listening';
  voice.start = value => ({ id: id = value, phase: 'listening' });
  voice.poll = () => ({ id, phase });
  voice.finish = () => ({ id, phase: phase = 'transcribing' });
  const f = await fixture(t, 340, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'ready');
  f.pauseVoicePoll(() => new Promise(resolve => { release = resolve; }));
  f.document.getElementById('voice-record').click(); await until(() => release, 'old poll pending');
  f.document.getElementById('voice-stop').click();
  await until(() => f.document.getElementById('voice-feedback').dataset.phase === 'transcribing', 'capture stopped');
  f.pauseVoicePoll(null); release(); await delay(30);
  assert.equal(f.document.getElementById('voice-feedback').dataset.phase, 'transcribing');
  f.document.getElementById('voice-cancel').click();
});

test('button recording can finish once by deliberate shortcut and can cancel from its controls', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  const answer = f.document.getElementById('answer'); answer.focus(); f.document.getElementById('voice-record').focus();
  f.document.getElementById('voice-record').click(); await until(() => voice.counts().starts === 1, 'button start');
  f.document.getElementById('voice-cancel').focus(); assert.equal(voice.counts().cancels, 0);
  f.document.getElementById('voice-cancel').click(); await until(() => voice.counts().cancels === 1, 'button cancel');
  assert.equal(f.document.activeElement, answer, 'focus returns to answer');
  f.document.getElementById('voice-record').click(); await until(() => voice.counts().starts === 2, 'retry');
  answer.focus(); key(f, 'keydown'); key(f, 'keydown', { repeat: true }); key(f, 'keyup');
  await until(() => voice.counts().finishes === 1, 'shortcut finish');
  assert.equal(voice.counts().starts, 2); assert.equal(answer.value, 'our neighbors');
});

test('leaving voice controls cancels while focus moving within them does not', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  const answer = f.document.getElementById('answer'); answer.focus(); f.document.getElementById('voice-record').click();
  await until(() => voice.counts().starts === 1, 'start');
  f.document.getElementById('voice-cancel').focus(); assert.equal(voice.counts().cancels, 0);
  f.document.getElementById('answer-state').focus(); await until(() => voice.counts().cancels === 1, 'workspace exit cancels');
  assert.equal(f.document.activeElement.id, 'answer-state', 'outside navigation keeps its intended focus');
  assert.equal(answer.value, '');
});

test('loading cannot be stopped as recorded audio and Cancel works through transcription', async t => {
  const voice = voiceFixture(); let id, phase = 'loading', cancelCount = 0, finishCount = 0, starts = 0;
  voice.start = recordingId => { starts++; id = recordingId; phase = 'loading'; return { id, phase }; };
  voice.poll = recordingId => ({ id: recordingId, phase: recordingId === id ? phase : 'cancelled', text: phase === 'done' ? 'late words' : undefined });
  voice.finish = () => { finishCount++; phase = 'transcribing'; return { id, phase }; };
  voice.cancel = recordingId => { cancelCount++; if (recordingId === id) phase = 'cancelled'; return { id: recordingId, phase: 'cancelled' }; };
  const f = await fixture(t, 340, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  f.document.getElementById('voice-record').click(); await until(() => starts === 1, 'loading start');
  assert.equal(f.document.getElementById('voice-stop').disabled, true);
  assert.equal(f.document.getElementById('voice-cancel').disabled, false);
  assert.match(f.document.getElementById('voice-status').textContent, /Wait for/);
  f.document.getElementById('voice-cancel').click(); await until(() => cancelCount === 1, 'loading cancelled');
  f.document.getElementById('voice-record').click(); await until(() => starts === 2, 'retry started'); phase = 'listening';
  await until(() => !f.document.getElementById('voice-stop').disabled, 'listening');
  f.document.getElementById('voice-stop').click(); await until(() => phase === 'transcribing', 'transcribing');
  assert.equal(f.document.getElementById('voice-stop').disabled, true);
  assert.equal(f.document.getElementById('voice-cancel').disabled, false);
  f.document.getElementById('voice-cancel').click(); phase = 'done';
  await delay(250); assert.equal(f.document.getElementById('answer').value, '');
  assert.equal(cancelCount, 2); assert.equal(finishCount, 1);
});

test('cancelled pending start cannot replace a rapidly retried recording', async t => {
  const voice = voiceFixture(); let release, starts = 0, id;
  voice.start = recordingId => { starts++; if (starts === 1) return new Promise(resolve => { release = () => resolve({ id: recordingId, phase: 'done', text: 'stale words' }); }); id = recordingId; return { id, phase: 'listening' }; };
  voice.poll = () => ({ id, phase: 'listening' });
  const f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  f.document.getElementById('voice-record').click(); await until(() => starts === 1, 'first pending start');
  f.document.getElementById('voice-cancel').click(); f.document.getElementById('voice-record').click();
  await until(() => starts === 2, 'second start'); release(); await delay(30);
  assert.equal(f.document.getElementById('answer').value, '');
  assert.equal(f.document.getElementById('voice-stop').disabled, false, 'new recording remains active');
  f.document.getElementById('voice-cancel').click();
});

test('rapid retry waits for cancellation to release the previous microphone owner', async t => {
  const voice = voiceFixture(); let release, starts = 0, id;
  const gate = new Promise(resolve => { release = resolve; });
  voice.start = recordingId => { starts++; id = recordingId; return { id, phase: 'listening' }; };
  voice.poll = () => ({ id, phase: 'listening' });
  t.after(release);
  const f = await fixture(t, 1100, voice, false, { holdVoiceCancel: () => gate }); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  f.document.getElementById('voice-record').click(); await until(() => starts === 1, 'first start');
  f.document.getElementById('voice-cancel').click(); await until(() => voice.counts().cancels === 1, 'cancel pending');
  f.document.getElementById('voice-record').click(); await delay(40);
  assert.equal(starts, 1, 'a retry must wait for owner release');
  release(); await until(() => starts === 2, 'retry begins after release');
});

test('same-question rerender keeps an active Stop control and its recording', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  f.document.getElementById('voice-record').click(); await until(() => !f.document.getElementById('voice-stop').disabled, 'Stop ready');
  f.document.getElementById('voice-stop').focus();
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Background change' });
  await until(() => f.document.getElementById('nodes').textContent.includes('Background change'), 'rerender');
  assert.equal(f.document.activeElement.id, 'voice-stop'); assert.equal(voice.counts().cancels, 0);
  f.document.getElementById('voice-stop').click();
  await until(() => f.document.getElementById('answer').value === 'our neighbors', 'final result');
  assert.equal(voice.counts().starts, 1); assert.equal(voice.counts().finishes, 1);
});

test('keyboard Record keeps usable control focus across phases and same-question rerenders', async t => {
  const voice = voiceFixture(); let id, phase = 'loading';
  voice.start = recordingId => { id = recordingId; return { id, phase }; };
  voice.poll = () => ({ id, phase });
  voice.finish = () => { phase = 'transcribing'; return { id, phase }; };
  const f = await fixture(t, 340, voice), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  f.type('answer', 'For everyone nearby.');
  f.document.getElementById('answer').setSelectionRange(4, 12);
  activateButtonWithKeyboard(f, f.document.getElementById('voice-record'));
  assert.equal(f.document.getElementById('voice-record').disabled, true);
  assert.equal(f.document.activeElement.id, 'voice-cancel', 'Loading focuses enabled Cancel');
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Loading update' });
  await until(() => f.document.getElementById('nodes').textContent.includes('Loading update'), 'loading rerender');
  assert.equal(f.document.activeElement.id, 'voice-cancel'); assert.equal(voice.counts().cancels, 0);
  phase = 'listening'; await until(() => !f.document.getElementById('voice-stop').disabled, 'Listening');
  assert.equal(f.document.activeElement.id, 'voice-stop', 'Listening focuses enabled Stop');
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Listening update' });
  await until(() => f.document.getElementById('nodes').textContent.includes('Listening update'), 'listening rerender');
  assert.equal(f.document.activeElement.id, 'voice-stop'); assert.equal(voice.counts().cancels, 0);
  activateButtonWithKeyboard(f, f.document.getElementById('voice-stop'));
  await until(() => f.document.getElementById('voice-feedback').dataset.phase === 'transcribing', 'Transcribing');
  assert.equal(f.document.activeElement.id, 'answer', 'Stop returns focus to the answer');
  assert.equal(f.document.getElementById('answer').selectionStart, 4); assert.equal(f.document.getElementById('answer').selectionEnd, 12);
  f.document.getElementById('voice-cancel').focus();
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Transcribing update' });
  await until(() => f.document.getElementById('nodes').textContent.includes('Transcribing update'), 'transcribing rerender');
  assert.equal(f.document.activeElement.id, 'voice-cancel'); assert.equal(voice.counts().cancels, 0);
  activateButtonWithKeyboard(f, f.document.getElementById('voice-cancel'));
  await until(() => voice.counts().cancels === 1, 'Cancel activated');
});

test('unavailable local dictation leaves settings accessible for recovery', async t => {
  const voice = { ...voiceFixture(), status: async () => ({ ready: false, error: 'Microphone unavailable. Check access and refresh devices.' }) };
  const f = await fixture(t, 340, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => /Microphone unavailable/.test(f.document.getElementById('voice-status')?.textContent ?? ''), 'unavailable reason');
  assert.equal(f.document.getElementById('voice-record').disabled, true);
  assert.equal(f.document.getElementById('voice-settings').hidden, false);
  f.document.getElementById('voice-settings').open = true;
  assert.ok(f.document.getElementById('voice-refresh'));
});

test('no speech and worker errors keep the draft intact for another attempt', async t => {
  const voice = voiceFixture(); let id, finishCount = 0;
  voice.start = recordingId => { id = recordingId; return { id, phase: 'listening' }; };
  voice.poll = () => ({ id, phase: 'listening' });
  voice.finish = () => ++finishCount === 1 ? { id, phase: 'done', text: '  ' } : { id, phase: 'error', error: 'Local voice timed out. Try again.' };
  const f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  f.type('answer', 'Keep this draft');
  f.document.getElementById('voice-record').click(); await until(() => !f.document.getElementById('voice-stop').disabled, 'first listening');
  f.document.getElementById('voice-stop').click(); await until(() => /No speech/.test(f.document.getElementById('voice-status').textContent), 'no speech');
  assert.equal(f.document.getElementById('answer').value, 'Keep this draft');
  f.document.getElementById('voice-record').click(); await until(() => !f.document.getElementById('voice-stop').disabled, 'retry listening');
  f.document.getElementById('voice-stop').click(); await until(() => /timed out/.test(f.document.getElementById('voice-status').textContent), 'worker error');
  assert.equal(f.document.getElementById('answer').value, 'Keep this draft');
  assert.equal(f.document.getElementById('voice-record').disabled, false);
});

test('window blur and pagehide cancel button recordings', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => !f.document.getElementById('voice-record')?.disabled, 'Record ready');
  f.document.getElementById('voice-record').click(); await until(() => voice.counts().starts === 1, 'first start');
  f.window.dispatchEvent(new f.window.Event('blur')); await until(() => voice.counts().cancels === 1, 'window blur cancel');
  f.document.getElementById('voice-record').click(); await until(() => voice.counts().starts === 2, 'second start');
  f.window.dispatchEvent(new f.window.Event('pagehide')); await until(() => voice.counts().cancels === 2, 'pagehide cancel');
});

test('a late dictation result cannot cross into another question', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice), [a, b] = f.explorer.doc.nodes.slice(1);
  f.open(a.id); await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'settings');
  f.document.getElementById('answer').focus(); key(f, 'keydown'); await until(() => voice.counts().starts === 1, 'start');
  f.open(b.id); f.type('answer', 'Another answer'); voice.finish();
  await delay(400); assert.equal(f.document.getElementById('answer').value, 'Another answer');
  f.open(a.id); assert.equal(f.document.getElementById('answer').value, '');
});

test('dictation respects the answer length limit without losing the existing draft', async t => {
  const voice = voiceFixture(), f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'settings');
  const answer = f.document.getElementById('answer'), previous = 'a'.repeat(20000);
  answer.focus(); f.type('answer', previous); answer.setSelectionRange(previous.length, previous.length);
  key(f, 'keydown'); await until(() => /^Listening/.test(f.document.getElementById('voice-status').textContent), 'listening');
  key(f, 'keyup'); await until(() => f.document.getElementById('voice-status').textContent.includes('exceed'), 'limit explained');
  assert.equal(answer.value, previous); assert.equal(f.explorer.doc.nodes[1].answer, '');
});

test('voice settings list local choices, save independently and retain unsaved choices across nodes', async t => {
  const voice = voiceFixture(); let saved, reads = 0;
  const options = { ...(await voice.status()), preferences: { revision: 0, microphone: 'Disconnected mic', model: 'copilot' }, copilotModel: 'Nemotron English',
    microphones: [{ name: 'USB microphone', supported: true }],
    models: [{ id: 'english', label: 'Nemotron English', supported: true }, { id: 'whisper', label: 'Whisper', supported: false, reason: 'Unsupported format' }] };
  voice.options = async () => { reads++; return options; };
  voice.configure = async input => { saved = input; options.preferences = { ...input, revision: input.revision + 1 }; return options; };
  const f = await fixture(t, 340, voice), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  const disclosure = f.document.getElementById('voice-settings'); assert.ok(disclosure);
  disclosure.open = true;
  await until(() => f.document.querySelector('#voice-microphone option[value="USB microphone"]'), 'device choices');
  assert.match(f.document.querySelector('#voice-microphone option:checked').textContent, /Unavailable/);
  assert.equal(f.document.querySelector('#voice-model option[value="whisper"]').disabled, true);
  const mic = f.document.getElementById('voice-microphone'); mic.value = 'USB microphone'; mic.dispatchEvent(new f.window.Event('change'));
  f.open(b.id);
  assert.equal(f.document.getElementById('voice-settings').open, true);
  assert.equal(f.document.getElementById('voice-microphone').value, 'USB microphone');
  f.click('Save voice settings'); await until(() => saved, 'saved settings');
  assert.deepEqual(saved, { microphone: 'USB microphone', model: 'copilot', revision: 0 });
  await until(() => !f.document.getElementById('voice-refresh').disabled, 'save finishes');
  f.click('Refresh devices and models'); await until(() => reads === 2, 'refresh');
  assert.equal(f.explorer.doc.nodes.every(n => !n.answer), true, 'settings do not submit an answer');
});

test('voice bar distinguishes loading, measured audio, silence, transcription and cancellation', async t => {
  const voice = voiceFixture(); let phase = 'loading', levels = [], elapsedMs = 0, id;
  voice.start = recordingId => { id = recordingId; return { id, phase }; };
  voice.poll = () => ({ id, phase, levels, elapsedMs });
  voice.finish = () => { phase = 'transcribing'; return { id, phase }; };
  const f = await fixture(t, 1100, voice); f.open(f.explorer.doc.nodes[1].id);
  await until(() => f.document.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'settings');
  const bar = f.document.getElementById('voice-feedback'); assert.ok(bar); assert.equal(bar.hidden, true);
  f.document.getElementById('answer').focus(); key(f, 'keydown');
  await until(() => bar.dataset.phase === 'loading', 'loading'); assert.equal(bar.hidden, false);
  phase = 'listening'; levels = [0, .5, 1]; elapsedMs = 2100;
  await until(() => bar.dataset.phase === 'listening', 'listening');
  const bars = [...bar.querySelectorAll('.voice-level')]; assert.equal(bars.length, 24);
  await until(() => bars.at(-1).style.height === '28px', 'measured levels arrive');
  assert.equal(bars.at(-1).style.height, '28px'); assert.equal(bars.at(-2).style.height, '15px');
  assert.equal(bar.querySelector('.voice-elapsed').textContent, '0:02');
  levels = [0, 0];
  await until(() => [...bar.querySelectorAll('.voice-level')].every(b => b.style.height === '2px'), 'silence is flat');
  key(f, 'keyup'); await until(() => bar.dataset.phase === 'transcribing', 'transcription');
  key(f, 'keydown', { key: 'Escape', code: 'Escape', ctrlKey: false }); assert.equal(bar.hidden, true);
});
test('history dialog previews undo, preserves stale drafts and names checkpoints without revisions', async t => {
  const f = await fixture(t, 340), node = f.explorer.doc.nodes[1]; f.open(node.id);
  f.type('answer', 'Committed'); f.document.getElementById('save-answer').click();
  await until(() => f.explorer.doc.nodes[1].answer === 'Committed' && !f.document.getElementById('discard-draft'), 'answer saved');
  f.type('answer', 'Local draft'); chooseState(f, 'needs-evidence');
  const undo = f.document.getElementById('undo-change'); assert.ok(undo, 'Undo access'); undo.click();
  await until(() => !f.document.getElementById('history-restore').disabled, 'undo preview');
  assert.match(f.document.getElementById('history-preview').textContent, /changed|restore/i);
  f.document.getElementById('history-restore').click();
  await until(() => f.explorer.doc.nodes[1].answer === '' && !f.document.getElementById('history-dialog').open, 'undo committed');
  assert.equal(f.document.getElementById('answer').value, 'Local draft');
  assert.match(f.document.getElementById('draft-recovery').textContent, /changed|recovered/i);
  const saved = await f.explorer.readDrafts(f.explorer.doc.id); assert.equal(saved.entries.find(r => r.nodeId === node.id).answerState, 'needs-evidence');
  assert.equal(saved.entries.find(r => r.nodeId === node.id).stale, true);
  f.document.getElementById('history-open').click();
  await until(() => f.document.getElementById('history-list').children.length, 'history rows');
  const revision = f.explorer.doc.revision; f.document.getElementById('checkpoint-name').value = 'Before next choice';
  f.document.getElementById('checkpoint-save').click();
  await until(() => f.document.getElementById('history-list').textContent.includes('Before next choice'), 'checkpoint persisted');
  assert.equal(f.explorer.doc.revision, revision);
  f.document.getElementById('history-dialog').dispatchEvent(new f.window.Event('cancel', { cancelable: true }));
  assert.equal(f.document.getElementById('history-dialog').open, false); assert.equal(f.document.activeElement.id, 'history-open');
});
test('history restore preserves removed-node state-only drafts with a visible saved state label', async t => {
  const f = await fixture(t, 340), baseline = f.explorer.doc.revision;
  await f.explorer.command('add', { revision: baseline, nodeId: f.explorer.doc.rootId, question: 'Temporary question?', category: 'Scope' });
  await until(() => f.document.querySelectorAll('#nodes .node').length === 4, 'new question polling');
  const node = f.explorer.doc.nodes.at(-1); f.open(node.id); chooseState(f, 'not-relevant');
  f.document.getElementById('history-open').click();
  await until(() => f.document.querySelector(`[data-history-revision="${baseline}"]`), 'baseline history');
  f.document.querySelector(`[data-history-revision="${baseline}"]`).click();
  await until(() => !f.document.getElementById('history-restore').disabled, 'restore preview');
  f.document.getElementById('history-restore').click();
  await until(() => f.document.getElementById('orphan-drafts').textContent.includes('Not relevant'), 'visible orphan state');
  const records = await f.explorer.readDrafts(f.explorer.doc.id), orphan = records.entries.find(r => r.nodeId === node.id);
  assert.equal(orphan.text, ''); assert.equal(orphan.answerState, 'not-relevant'); assert.equal(orphan.orphaned, true);
  assert.ok(!f.explorer.doc.nodes.some(n => n.id === node.id));
});
test('history rejects stale preview and undo after refresh targets the latest unrelated committed edit', async t => {
  const f = await fixture(t, 340), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'Keep this answer'); f.document.getElementById('save-answer').click();
  await until(() => f.explorer.doc.nodes[1].answer === 'Keep this answer' && !f.document.getElementById('discard-draft'), 'saved answer');
  f.document.getElementById('undo-change').click(); await until(() => !f.document.getElementById('history-restore').disabled, 'undo preview');
  const other = await new Explorer({ file: f.explorer.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: 'Other change', successCriteria: '' });
  f.document.getElementById('history-restore').click();
  await until(() => /canvas|changed/i.test(f.document.getElementById('history-status').textContent), 'stale restore rejection');
  assert.equal(other.doc.nodes[1].answer, 'Keep this answer');
  f.document.getElementById('history-refresh').click();
  await until(() => f.explorer.doc.objective === 'Other change' && f.document.getElementById('history-list').children.length, 'refresh newer history');
  f.document.getElementById('history-close').click(); f.document.getElementById('undo-change').click();
  await until(() => !f.document.getElementById('history-restore').disabled, 'latest undo preview');
  f.document.getElementById('history-restore').click();
  await until(() => f.explorer.doc.objective === '' && !f.document.getElementById('history-dialog').open, 'latest unrelated edit undone');
  assert.equal(f.explorer.doc.nodes[1].answer, 'Keep this answer');
});

test('map settings save, cancel, reset and stale retry keep documents and drafts separate', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id);
  const original = JSON.stringify(f.explorer.doc), revision = f.explorer.doc.revision;
  const context = JSON.stringify(contextFor(f.explorer.doc, f.explorer.doc.nodes[1].id));
  const history = JSON.stringify(await f.explorer.readHistory(f.explorer.activeKey));
  $('navigation-open').click(); await until(() => $('navigation-dialog').open, 'settings dialog');
  assert.equal($('navigation-wheel').value, 'zoom');
  $('navigation-wheel').value = 'pan'; $('navigation-cancel').click();
  assert.equal(f.document.activeElement, $('navigation-open'));
  $('navigation-open').click(); await until(() => $('navigation-wheel').value === 'zoom', 'cancel did not persist');
  $('navigation-wheel').value = 'pan'; $('navigation-sensitivity').value = '2'; $('navigation-motion').value = 'full';
  $('navigation-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !$('navigation-dialog').open, 'settings saved');
  assert.match($('navigation-hint').textContent, /pan/);
  assert.equal(f.document.documentElement.dataset.motion, 'full');
  const file = join(f.explorer.library.directory, 'navigation-settings.json'), store = new NavigationPreferences(file);
  assert.equal((await store.read()).sensitivity, 2);
  $('navigation-open').click(); await until(() => $('navigation-wheel').value === 'pan', 'saved settings reload');
  $('navigation-reset').click(); assert.equal($('navigation-wheel').value, 'zoom');
  assert.equal((await store.read()).wheelMode, 'pan', 'reset requires Save');
  $('navigation-cancel').click(); $('navigation-open').click(); await until(() => $('navigation-wheel').value === 'pan', 'cancelled reset');
  const external = await store.save({ wheelMode: 'zoom', sensitivity: .5, motion: 'reduce' }, 1);
  assert.equal(external.revision, 2);
  $('navigation-sensitivity').value = '3';
  $('navigation-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => /another canvas/i.test($('navigation-error').textContent), 'stale writer warning');
  assert.equal($('navigation-sensitivity').value, '3'); assert.equal((await store.read()).sensitivity, .5);
  $('navigation-refresh').click(); await until(() => !$('navigation-refresh').hidden && $('navigation-error').hidden, 'refreshed revision');
  assert.equal($('navigation-sensitivity').value, '3', 'choices retained for deliberate retry');
  $('navigation-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !$('navigation-dialog').open, 'deliberate retry');
  assert.equal((await store.read()).sensitivity, 3);
  assert.equal(f.explorer.doc.revision, revision); assert.equal(JSON.stringify(f.explorer.doc), original);
  assert.equal(JSON.stringify(contextFor(f.explorer.doc, f.explorer.doc.nodes[1].id)), context);
  assert.equal(JSON.stringify(await f.explorer.readHistory(f.explorer.activeKey)), history);
  await f.explorer.command('start', { topic: 'A second journey', revision });
  await until(() => $('map-title').textContent === 'A second journey', 'new journey shown');
  assert.match($('navigation-hint').textContent, /pan/, 'navigation preference survives journey change');
  $('navigation-open').click(); await until(() => $('navigation-dialog').open, 'reset dialog');
  $('navigation-reset').click();
  $('navigation-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !$('navigation-dialog').open, 'reset saved');
  assert.deepEqual(await store.read(), { version: 1, revision: 4, wheelMode: 'zoom', sensitivity: 1, motion: 'system' });
});

test('navigation refresh keeps edits made while its GET is pending after a stale save', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id);
  const store = new NavigationPreferences(join(dirname(f.explorer.file), 'navigation-settings.json'));
  $('navigation-open').click(); await until(() => $('navigation-dialog').open && !$('navigation-save').disabled, 'navigation settings loaded');
  $('navigation-wheel').value = 'pan'; $('navigation-save').click();
  await until(() => !$('navigation-dialog').open, 'first preference saved');
  $('navigation-open').click(); await until(() => $('navigation-dialog').open && !$('navigation-save').disabled, 'saved preference loaded');
  await store.save({ wheelMode: 'zoom', sensitivity: .5, motion: 'reduce' }, 1);
  $('navigation-sensitivity').value = '3'; $('navigation-save').click();
  await until(() => /another canvas/i.test($('navigation-error').textContent), 'stale save rejected');
  let release, waiting = false;
  f.pauseNavigationRead(() => { waiting = true; return new Promise(resolve => { release = resolve; }); });
  $('navigation-refresh').click(); await until(() => waiting, 'refresh GET pending');
  $('navigation-wheel').value = 'pan'; $('navigation-wheel').dispatchEvent(new f.window.Event('input', { bubbles: true }));
  $('navigation-sensitivity').value = '1.1'; $('navigation-sensitivity').dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.pauseNavigationRead(null); release();
  await until(() => $('navigation-error').hidden, 'refreshed revision available');
  assert.equal($('navigation-wheel').value, 'pan');
  assert.equal($('navigation-sensitivity').value, '1.1', 'latest input survives delayed refresh');
  $('navigation-save').click(); await until(() => !$('navigation-dialog').open, 'deliberate retry saved');
  assert.equal((await store.read()).sensitivity, 1.1);
});

test('navigation sensitivity accepts and saves any in-range fractional value', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id);
  $('navigation-open').click(); await until(() => $('navigation-dialog').open && !$('navigation-save').disabled, 'navigation settings loaded');
  $('navigation-sensitivity').value = '0.3';
  assert.equal($('navigation-sensitivity').checkValidity(), true, 'HTML control accepts a valid non-quarter sensitivity');
  $('navigation-save').click(); await until(() => !$('navigation-dialog').open, 'fractional preference saved');
  const store = new NavigationPreferences(join(dirname(f.explorer.file), 'navigation-settings.json'));
  assert.equal((await store.read()).sensitivity, .3);
});

test('pan wheel normalizes deltas, keeps answer scrolling and follows motion overrides', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), map = $('map');
  $('navigation-open').click(); await until(() => $('navigation-dialog').open, 'settings dialog');
  $('navigation-wheel').value = 'pan'; $('navigation-sensitivity').value = '2';
  $('navigation-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !$('navigation-dialog').open, 'pan saved');
  const first = viewOf(f);
  wheel(f, map, .01, { deltaMode: 2 });
  const page = viewOf(f); assert.equal(page.x, first.x); assert.ok(Math.abs(page.y - first.y + 14.4) < 1e-7, 'page mode uses viewport height');
  assert.equal(wheel(f, map, 2, { deltaX: 3, deltaMode: 1 }).defaultPrevented, true);
  const second = viewOf(f);
  assert.equal(second.x, page.x - 96); assert.equal(second.y, page.y - 64); assert.equal(second.zoom, page.zoom);
  wheel(f, map, 3, { shiftKey: true, deltaMode: 1 });
  const third = viewOf(f); assert.equal(third.x, second.x - 96); assert.equal(third.y, second.y);
  wheel(f, map, 2, { deltaX: 1, shiftKey: true, deltaMode: 1 });
  const fourth = viewOf(f); assert.equal(fourth.x, third.x - 32); assert.equal(fourth.y, third.y - 64);
  wheel(f, map, -20, { ctrlKey: true }); assert.ok(viewOf(f).zoom > fourth.zoom, 'modifier anchors zoom in pan mode');
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Selected text stays selected');
  const answer = $('answer'); answer.setSelectionRange(2, 8); const beforeAnswer = viewOf(f);
  assert.equal(wheel(f, answer, 3).defaultPrevented, false); assert.deepEqual(viewOf(f), beforeAnswer);
  assert.deepEqual([answer.selectionStart, answer.selectionEnd], [2, 8]);
  assert.equal(wheel(f, answer, -10, { metaKey: true }).defaultPrevented, true);
  assert.equal(f.document.documentElement.dataset.motion, 'reduce', 'system follows OS');
  f.motion(false); assert.equal(f.document.documentElement.dataset.motion, 'full');
  $('navigation-open').click(); await until(() => $('navigation-dialog').open, 'motion settings');
  $('navigation-motion').value = 'reduce'; $('navigation-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !$('navigation-dialog').open, 'motion override saved');
  f.motion(true); f.motion(false); assert.equal(f.document.documentElement.dataset.motion, 'reduce');
});

test('corrupt navigation file leaves map usable and requires repair then refresh', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async explorer => {
    await writeFile(join(dirname(explorer.file), 'navigation-settings.json'), '{broken');
  } }), $ = id => f.document.getElementById(id);
  await until(() => $('navigation-open'), 'settings control');
  assert.equal(wheel(f, $('map'), -20).defaultPrevented, true, 'default map navigation remains usable');
  $('navigation-open').click();
  await until(() => /preserved/i.test($('navigation-error').textContent), 'corrupt settings explanation');
  assert.equal($('navigation-save').disabled, true);
  const file = join(dirname(f.explorer.file), 'navigation-settings.json');
  assert.equal(await readFile(file, 'utf8'), '{broken');
  await writeFile(file, JSON.stringify({ version: 1, revision: 0, wheelMode: 'zoom', sensitivity: 1, motion: 'system' }));
  $('navigation-refresh').click();
  await until(() => $('navigation-error').hidden && !$('navigation-save').disabled, 'repaired settings refreshed');
});

test('focus branch keeps drafts and folds, fits visible nodes, and whole map retains the editor', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, category: 'People', question: 'Invite nearby?' });
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[2].id, category: 'Trust', question: 'Repair tools?' });
  } });
  const [root, a, b, a1, b1] = f.explorer.doc.nodes;
  f.document.querySelector(`[data-branch-id="${b.id}"]`).click();
  f.open(a.id); f.type('answer', 'A private draft'); chooseState(f, 'assumption');
  const answer = f.document.getElementById('answer'); answer.focus(); answer.setSelectionRange(2, 7);
  const revision = f.explorer.doc.revision, updatedAt = f.explorer.doc.updatedAt;
  const beforeHistory = await f.explorer.readHistory(f.explorer.doc.id);
  assert.ok(f.document.getElementById('focus-branch'), 'leaves and branches share a focus control');
  f.document.getElementById('focus-branch').click();
  assert.equal(f.document.getElementById('focus-branch').getAttribute('aria-pressed'), 'true');
  assert.match(f.document.getElementById('focus-status').textContent, /Focusing.*Who should borrow first/);
  assert.equal(f.document.getElementById('show-whole-map').hidden, false);
  assert.deepEqual([...f.document.querySelectorAll('#nodes .node')].map(e => e.dataset.nodeId), [root.id, a1.id]);
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${b.id}"]`), null);
  assert.equal(f.document.getElementById('answer').value, 'A private draft');
  assert.equal(f.document.getElementById('answer-state').value, 'assumption');
  assert.deepEqual([f.document.getElementById('answer').selectionStart, f.document.getElementById('answer').selectionEnd], [2, 7]);
  f.document.getElementById('show-whole-map').click();
  assert.equal(f.document.getElementById('show-whole-map').hidden, true);
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${b.id}"]`));
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${b1.id}"]`), null, 'unrelated fold restored');
  assert.equal(f.document.getElementById('answer').value, 'A private draft');
  assert.equal(f.document.getElementById('answer-state').value, 'assumption');
  assert.equal(f.explorer.doc.revision, revision); assert.equal(f.explorer.doc.updatedAt, updatedAt);
  assert.deepEqual(await f.explorer.readHistory(f.explorer.doc.id), beforeHistory);
  assert.equal((await (await f.window.fetch('export.json')).json()).nodes.length, 5);
  assert.match(await (await f.window.fetch('export.md')).text(), /Repair tools\?/);
  f.document.getElementById('focus-branch').click(); f.document.getElementById('fit').click();
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${b.id}"]`), null, 'Fit stays inside focus');
  const view = viewOf(f);
  for (const node of f.document.querySelectorAll('#nodes .node')) {
    const left = view.x + parseFloat(node.style.left) * view.zoom, top = view.y + parseFloat(node.style.top) * view.zoom;
    assert.ok(left >= 0 && left + parseFloat(node.style.width) * view.zoom <= 340, 'focused width fits');
    assert.ok(top >= 0 && top + parseFloat(node.style.height) * view.zoom <= 720, 'focused height fits');
  }
});

test('outline selection exits focus and reveals only the selected path', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, category: 'People', question: 'Invite nearby?' });
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[2].id, category: 'Trust', question: 'Repair tools?' });
  } });
  const [root, a, b, a1, b1] = f.explorer.doc.nodes;
  f.document.querySelector(`[data-branch-id="${b.id}"]`).click();
  f.open(a1.id); f.document.getElementById('focus-branch').click();
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${b.id}"]`), null);
  f.document.getElementById('outline-toggle').click();
  const target = [...f.document.querySelectorAll('#outline-list [data-node-id]')].find(e => e.dataset.nodeId === b1.id);
  assert.ok(target); target.click();
  assert.equal(f.document.getElementById('show-whole-map').hidden, true);
  assert.equal(f.document.getElementById('expanded-title').textContent, b1.question);
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${a.id}"]`));
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${a1.id}"]`));
  assert.equal(f.document.querySelector(`[data-branch-id="${b.id}"]`).getAttribute('aria-expanded'), 'true');
  f.open(root.id); f.document.getElementById('focus-branch').click();
  assert.equal(f.document.getElementById('show-whole-map').hidden, true, 'root focus means whole map');
});

test('collapsing an ancestor exits focus safely and hidden research does not retarget it', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, category: 'People', question: 'Invite nearby?' });
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[2].id, category: 'Trust', question: 'Repair tools?' });
  } });
  const [root, a, b, a1, b1] = f.explorer.doc.nodes;
  f.open(b1.id); f.document.querySelector('.research-disclosure summary').click(); f.click('Research options');
  await until(() => f.explorer.pending?.kind === 'research', 'research started');
  f.open(a1.id); f.type('answer', 'Keep this draft'); chooseState(f, 'needs-evidence');
  f.document.getElementById('focus-branch').click();
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${b.id}"]`), null);
  f.resolveResearch(findings);
  await until(() => !!f.explorer.doc.nodes.find(n => n.id === b1.id).research, 'hidden research saved');
  await until(() => f.document.getElementById('request-status').hidden, 'completion polled');
  assert.equal(f.document.getElementById('show-whole-map').hidden, false, 'poll retains focus');
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${b.id}"]`), null);
  assert.equal(f.document.getElementById('answer').value, 'Keep this draft');
  f.document.getElementById('outline-toggle').click();
  f.document.querySelector(`#outline-list [data-branch-id="${root.id}"]`).click();
  assert.equal(f.document.getElementById('show-whole-map').hidden, true);
  assert.equal(f.document.getElementById('node-workspace').hidden, true);
  assert.equal(f.document.activeElement.dataset.nodeId, root.id);
  assert.equal(f.document.querySelectorAll('#nodes .node').length, 1);
  f.document.querySelector(`[data-branch-id="${root.id}"]`).click();
  f.open(a1.id);
  assert.equal(f.document.getElementById('answer').value, 'Keep this draft');
  assert.equal(f.document.getElementById('answer-state').value, 'needs-evidence');
  assert.equal(f.explorer.doc.nodes.find(n => n.id === b1.id).research.summary, findings.summary);
});

test('history removal of the focused selection returns to whole map and keeps surviving folds', async t => {
  const f = await fixture(t, 340, undefined, false, { before: e => e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[2].id, category: 'Trust', question: 'Repair tools?' }) });
  const [root, a, b, b1] = f.explorer.doc.nodes;
  f.document.querySelector(`[data-branch-id="${b.id}"]`).click();
  const baseline = f.explorer.doc.revision;
  await f.explorer.command('add', { revision: baseline, nodeId: a.id, category: 'People', question: 'Temporary focus?' });
  await until(() => [...f.document.querySelectorAll('#nodes .node')].some(node => node.title === 'Temporary focus?'), 'temporary question polled');
  const removed = f.explorer.doc.nodes.at(-1);
  f.open(removed.id); chooseState(f, 'not-relevant'); f.document.getElementById('focus-branch').click();
  f.document.getElementById('history-open').click();
  await until(() => f.document.querySelector(`[data-history-revision="${baseline}"]`), 'baseline history');
  f.document.querySelector(`[data-history-revision="${baseline}"]`).click();
  await until(() => !f.document.getElementById('history-restore').disabled, 'restore preview');
  f.document.getElementById('history-restore').click();
  await until(() => f.document.getElementById('orphan-drafts').textContent.includes('Not relevant'), 'orphan state retained');
  assert.equal(f.document.getElementById('show-whole-map').hidden, true);
  assert.equal(f.document.getElementById('node-workspace').hidden, true);
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${root.id}"]`));
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${a.id}"]`));
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${b.id}"]`));
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${b1.id}"]`), null, 'surviving fold retained');
  assert.equal(f.document.querySelector(`[data-branch-id="${b.id}"]`).getAttribute('aria-expanded'), 'false');
  assert.equal(f.document.querySelector('#nodes .node.selected')?.dataset.nodeId, root.id, 'removed selection falls back to root');
});

test('history removal of focus keeps a surviving selected ancestor editor and draft', async t => {
  const f = await fixture(t, 340), [root, ancestor] = f.explorer.doc.nodes;
  const baseline = f.explorer.doc.revision;
  await f.explorer.command('add', { revision: baseline, nodeId: ancestor.id, category: 'People', question: 'Temporary focused child?' });
  await until(() => [...f.document.querySelectorAll('#nodes .node')].some(node => node.title === 'Temporary focused child?'), 'temporary child polled');
  const child = f.explorer.doc.nodes.at(-1);
  f.open(child.id); f.document.getElementById('focus-branch').click();
  f.document.getElementById(`ancestor-${ancestor.id}`).click();
  assert.match(f.document.getElementById('focus-status').textContent, /Temporary focused child/);
  assert.equal(f.document.getElementById('expanded-title').textContent, ancestor.question);
  f.type('answer', 'Keep ancestor draft'); chooseState(f, 'assumption');
  await until(() => f.document.getElementById('answer-status').textContent === 'Draft saved locally', 'ancestor draft stored');
  const answer = f.document.getElementById('answer'); answer.focus(); answer.setSelectionRange(2, 8, 'backward');
  f.document.getElementById('history-open').click();
  await until(() => f.document.querySelector(`[data-history-revision="${baseline}"]`), 'baseline history');
  f.document.querySelector(`[data-history-revision="${baseline}"]`).click();
  await until(() => !f.document.getElementById('history-restore').disabled, 'restore preview');
  f.document.getElementById('history-restore').click();
  await until(() => !f.document.getElementById('history-dialog').open && !f.explorer.doc.nodes.some(node => node.id === child.id), 'focused child removed');
  assert.equal(f.document.getElementById('show-whole-map').hidden, true);
  assert.equal(f.document.getElementById('node-workspace').hidden, false, 'surviving editor stays open');
  assert.equal(f.document.getElementById('expanded-title').textContent, ancestor.question);
  assert.equal(f.document.getElementById('answer').value, 'Keep ancestor draft');
  assert.equal(f.document.getElementById('answer-state').value, 'assumption');
  assert.deepEqual([f.document.getElementById('answer').selectionStart, f.document.getElementById('answer').selectionEnd, f.document.getElementById('answer').selectionDirection], [2, 8, 'backward']);
  assert.equal(f.document.querySelector('#nodes .node.selected'), null, 'selected ancestor is rendered as the expanded node');
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${root.id}"]`));
});

test('opening another journey clears branch focus', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.activeKey;
  await f.explorer.library.import(createDocument('Another focus journey'));
  f.open(f.explorer.doc.nodes[1].id); f.document.getElementById('focus-branch').click();
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library entries');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('Another focus journey')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey !== first && f.document.getElementById('map-title').textContent === 'Another focus journey', 'journey switch');
  assert.equal(f.document.getElementById('show-whole-map').hidden, true);
  assert.equal(f.document.getElementById('focus-status').textContent, '');
  f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library entries reopened');
  [...f.document.querySelectorAll('.library-entry')].find(e => e.textContent.includes('A tool library')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey === first && f.document.getElementById('map-title').textContent === 'A tool library', 'first journey reopened');
  assert.equal(f.document.getElementById('show-whole-map').hidden, true, 'focus is per canvas session, not saved in the journey');
});
test('late history reads never populate a different journey dialog', async t => {
  const f = await fixture(t, 340, undefined, true), first = f.explorer.activeKey;
  const copy = await f.explorer.library.import(createDocument('Another journey'));
  let release, started = false; f.pauseHistory(() => { started = true; return new Promise(resolve => { release = resolve; }); });
  f.document.getElementById('history-open').click(); await until(() => started, 'held history read');
  f.document.getElementById('history-close').click(); f.document.getElementById('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'library');
  [...f.document.querySelectorAll('.library-entry')].find(row => row.textContent.includes('Another journey')).querySelector('[data-action="open"]').click();
  await until(() => f.explorer.activeKey === copy.key, 'journey switched');
  f.pauseHistory(null); release(); await delay(30);
  assert.notEqual(f.explorer.activeKey, first); assert.equal(f.document.getElementById('history-dialog').open, false);
  f.document.getElementById('history-open').click(); await until(() => f.document.getElementById('history-status').textContent.includes('No earlier'), 'new journey history empty');
  assert.equal(f.document.getElementById('history-list').children.length, 0);
});
test('history restores block failed draft persistence and pending work, and surface missing snapshots', async t => {
  const f = await fixture(t, 340), node = f.explorer.doc.nodes[1]; f.open(node.id); f.type('answer', 'Preserve me');
  const write = f.explorer.draftStore.write.bind(f.explorer.draftStore); f.explorer.draftStore.write = async () => { throw new Error('Disk full'); };
  const revision = f.explorer.doc.revision; f.document.getElementById('undo-change').click();
  await until(() => !f.document.getElementById('history-restore').disabled, 'undo preview'); f.document.getElementById('history-restore').click();
  await until(() => /Drafts could not be preserved/.test(f.document.getElementById('history-status').textContent), 'draft failure blocks restore');
  assert.equal(f.explorer.doc.revision, revision); assert.equal(f.document.getElementById('answer').value, 'Preserve me');
  f.explorer.draftStore.write = write; f.document.getElementById('history-close').click();
  await f.explorer.command('questions', { revision, nodeId: f.explorer.doc.rootId });
  f.document.getElementById('undo-change').click(); await until(() => /Cancel the current/.test(f.document.getElementById('history-status').textContent), 'pending request blocks restore');
  assert.equal(f.document.getElementById('history-restore').disabled, true);
  await f.explorer.command('cancel'); f.document.getElementById('history-close').click();
  const history = await f.explorer.history(f.explorer.doc.id), list = await f.explorer.readHistory(f.explorer.doc.id);
  await rm(join(await history.root(), `${list.entries[0].hash}.json`));
  f.document.getElementById('history-open').click(); await until(() => /History recovery required/.test(f.document.getElementById('history-status').textContent), 'missing snapshot error');
  assert.equal(f.document.getElementById('history-restore').disabled, true);
});
test('history checkpoint errors remain readable inside the open dialog', async t => {
  const f = await fixture(t, 340), revision = f.explorer.doc.revision;
  for (let i = 0; i < 10; i++) await f.explorer.command('checkpoint', { journey: f.explorer.doc.id, revision, snapshotRevision: revision, name: `Name ${i}` });
  f.document.getElementById('history-open').click(); await until(() => !f.document.getElementById('checkpoint-save').disabled, 'checkpoint form ready');
  f.document.getElementById('checkpoint-name').value = 'Eleventh'; f.document.getElementById('checkpoint-save').click();
  await until(() => /10 named checkpoints/.test(f.document.getElementById('history-status').textContent), 'dialog limit error');
  assert.equal(f.document.getElementById('history-dialog').open, true); assert.equal(f.explorer.doc.revision, revision);
});


test('question preview controls keep edits across polls and accept a subset in a narrow root', async t => {
  const f = await fixture(t, 340, undefined, false, { preview: true }), d = f.document;
  assert.match(d.getElementById('question-preview').textContent, /not saved/i);
  assert.equal(f.explorer.doc.nodes.length, 1);
  f.type('candidate-question-0', 'Who will join? ??');
  d.getElementById('candidate-select-1').click();
  const edit = d.getElementById('candidate-question-0'); edit.focus(); edit.setSelectionRange(2, 5);
  await delay(1400);
  assert.equal(d.getElementById('candidate-question-0').value, 'Who will join? ??');
  assert.equal(d.getElementById('candidate-select-1').checked, false);
  assert.equal(d.activeElement.id, 'candidate-question-0');
  assert.equal((await (await f.window.fetch('export.json')).json()).nodes.length, 1);
  d.getElementById('accept-questions').click();
  await until(() => f.explorer.doc.nodes.length === 2 && d.getElementById('node-workspace').hidden, 'accepted subset');
  assert.equal(f.explorer.doc.nodes[1].question, 'Who will join? ??');
  assert.match(d.getElementById('question-feedback').textContent, /1 question added/);
  assert.equal(d.querySelectorAll('.new-question').length, 1);
});

test('question preview dismissal leaves an explicit retry and blocks journey switches', async t => {
  const f = await fixture(t, 340, undefined, true, { preview: true }), d = f.document, before = f.explorer.doc.revision;
  d.getElementById('library-toggle').click();
  f.type('topic', 'Other journey'); d.getElementById('start-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await delay(50); assert.match(d.getElementById('notice').textContent, /dismiss/i);
  assert.equal(f.explorer.doc.topic, 'A tool library');
  d.getElementById('library-return').click(); d.getElementById('dismiss-questions').click();
  await until(() => !f.explorer.preview && !d.getElementById('question-preview'), 'dismissed');
  assert.equal(f.explorer.doc.revision, before); assert.equal(d.getElementById('generate-questions').disabled, false);
  d.getElementById('generate-questions').click(); await until(() => f.explorer.pending, 'user retry');
  await f.explorer.command('cancel');
});

test('question preview acceptance reveals focused folded children and keeps editor drafts state caret and disclosures', async t => {
  const f = await fixture(t, 340), d = f.document, e = f.explorer, parent = e.doc.nodes[1], other = e.doc.nodes[2];
  await e.command('add', { revision: e.doc.revision, nodeId: parent.id, question: 'Existing child?', category: 'Scope' });
  await e.command('add', { revision: e.doc.revision, nodeId: other.id, question: 'Other child?', category: 'Scope' });
  await until(() => d.querySelector(`[data-branch-id="${other.id}"]`), 'branches');
  d.querySelector(`[data-branch-id="${other.id}"]`).click(); f.open(parent.id);
  d.getElementById('focus-branch').click(); d.getElementById('branch-workspace').click();
  f.type('answer', 'Saved answer'); d.getElementById('save-deeper').click(); await until(() => e.pending, 'deepen');
  await until(() => d.getElementById('save-deeper').disabled, 'pending UI');
  f.type('answer', 'New unsaved answer'); d.getElementById('answer-state').value = 'assumption'; d.getElementById('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  const answer = d.getElementById('answer'); answer.focus(); answer.setSelectionRange(2, 8, 'backward');
  d.querySelector('.manual').open = true; d.querySelector('.manual').dispatchEvent(new f.window.Event('toggle'));
  answer.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'Next generated?', category: 'Scope' }] });
  await delay(1400); assert.equal(d.getElementById('answer'), answer, 'live composition keeps the editor mounted');
  assert.equal(d.getElementById('question-preview'), null);
  answer.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  await until(() => d.getElementById('question-preview'), 'deeper preview');
  assert.equal(d.activeElement.id, 'answer'); assert.equal(d.getElementById('answer').selectionStart, 2);
  d.getElementById('accept-questions').click();
  await until(() => d.querySelector('.new-question'), 'new child revealed');
  assert.equal(d.getElementById('expanded-title').textContent, parent.question);
  assert.equal(d.getElementById('answer').value, 'New unsaved answer'); assert.equal(d.getElementById('answer-state').value, 'assumption');
  assert.equal(d.getElementById('answer').selectionStart, 2); assert.equal(d.querySelector('.manual').open, true);
  assert.equal(d.getElementById('branch-workspace').getAttribute('aria-expanded'), 'true');
  assert.match(d.getElementById('focus-status').textContent, /Who should borrow/);
  d.getElementById('show-whole-map').click(); assert.equal(d.querySelector(`[data-branch-id="${other.id}"]`).getAttribute('aria-expanded'), 'false');
});


test('question preview stale callbacks and accepted-context changes expose explicit regenerate controls', async t => {
  const f = await fixture(t, 340), e = f.explorer, d = f.document;
  f.open(e.doc.rootId); d.getElementById('generate-questions').click(); await until(() => e.pending, 'requested');
  const other = await new Explorer({ file: e.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: 'Changed on disk', successCriteria: '' });
  await assert.rejects(e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'Stale?', category: 'Scope' }] }), /context changed/);
  await until(() => d.getElementById('refresh-question-context'), 'refresh after stale callback');
  d.getElementById('refresh-question-context').click(); await until(() => e.pending, 'regenerated');
  await e.receive('questions', { requestId: e.pending.id, questions: [{ question: 'Fresh?', category: 'Scope' }] });
  await until(() => d.getElementById('candidate-question-0'), 'fresh preview');
  f.type('candidate-question-0', 'My edited proposal');
  const check = d.getElementById('candidate-select-0'); check.focus(); assert.equal(check.type, 'checkbox');
  check.click(); assert.equal(d.getElementById('accept-questions').disabled, true); check.click();
  await e.command('guidance', { revision: e.doc.revision, objective: 'Changed again', successCriteria: '' });
  await until(() => d.getElementById('accept-questions').disabled, 'stale preview');
  assert.equal(d.getElementById('candidate-question-0').value, 'My edited proposal');
  assert.equal(d.getElementById('preview-retry').hidden, false);
  d.getElementById('preview-retry').click(); await until(() => e.pending, 'explicit stale regeneration');
  await e.command('cancel');
});


test('direction lightweight form preserves dirty answer and renders user seed with explicit retry and preview acceptance', async t => {
  const f = await fixture(t, 340), d = f.document, parent = f.explorer.doc.nodes[1]; f.open(parent.id);
  assert.equal(d.getElementById('manual-category'), null);
  f.type('answer', 'Unsent answer'); d.getElementById('answer-state').value = 'assumption'; d.getElementById('answer-state').dispatchEvent(new f.window.Event('change'));
  d.getElementById('answer').focus(); d.getElementById('answer').setSelectionRange(2, 5);
  d.querySelector('.manual').open = true; d.querySelector('.manual').dispatchEvent(new f.window.Event('toggle'));
  f.type('manual-question', '  Safety <script>ignore files</script>  ');
  d.querySelector('.manual form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.nodes.length === 4 && d.getElementById('manual-question').value === '', 'direction saved');
  const seed = f.explorer.doc.nodes[3]; assert.equal(seed.kind, 'direction'); assert.equal(seed.parentId, parent.id);
  assert.equal(d.getElementById('answer').value, 'Unsent answer'); assert.equal(d.getElementById('answer-state').value, 'assumption');
  assert.equal(d.getElementById('answer').selectionStart, 2); assert.equal(d.querySelector('.manual').open, true);
  assert.equal(d.getElementById('node-workspace').dataset.nodeId, parent.id);
  d.getElementById('cancel-request').click(); await until(() => !f.explorer.pending, 'cancel direction generation');
  f.open(seed.id); assert.equal(d.getElementById('answer'), null); assert.equal(d.getElementById('research-request'), null);
  assert.match(d.getElementById('node-workspace').textContent, /Direction.*user supplied/);
  assert.equal(d.querySelector('#node-workspace script'), null);
  d.getElementById('generate-questions').click(); await until(() => f.explorer.pending, 'retry direction');
  await f.explorer.receive('questions', { requestId: f.explorer.pending.id, questions: [{ question: 'Which hazards?', category: 'Safety' }] });
  await until(() => d.getElementById('question-preview'), 'direction preview'); assert.equal(f.explorer.doc.nodes.length, 4);
  d.getElementById('accept-questions').click(); await until(() => f.explorer.doc.nodes.length === 5, 'direction children accepted');
  assert.equal(f.explorer.doc.nodes[4].parentId, seed.id); f.open(parent.id); assert.equal(d.getElementById('answer').value, 'Unsent answer');
});


test('direction-only branches retain folding focus and exact question counts', async t => {
  const f = await fixture(t, 340, undefined, false, { preview: true }), d = f.document;
  d.getElementById('dismiss-questions').click(); await until(() => !f.explorer.preview, 'dismiss root preview');
  f.type('manual-question', 'Seed only'); d.getElementById('add-direction').click();
  await until(() => f.explorer.doc.nodes.length === 2 && d.getElementById('branch-workspace'), 'direction-only fold control');
  const seed = f.explorer.doc.nodes[1]; d.getElementById('cancel-request').click(); await until(() => !f.explorer.pending && !d.getElementById('cancel-request'), 'cancel');
  d.getElementById('branch-workspace').click(); assert.match(d.getElementById('node-workspace').textContent, /1 hidden node.*0 questions/);
  f.type('manual-question', 'Second seed'); d.getElementById('add-direction').click();
  await until(() => f.explorer.doc.nodes.length === 3 && d.querySelector(`[data-node-id="${seed.id}"]`), 'seed reveals folded path');
  await until(() => d.getElementById('cancel-request'), 'second seed request shown');
  d.getElementById('cancel-request').click(); await until(() => !f.explorer.pending && !d.getElementById('cancel-request'), 'cancel second');
  f.open(seed.id); d.getElementById('focus-branch').click(); assert.equal(d.getElementById('show-whole-map').hidden, false);
  assert.equal(d.getElementById('answer'), null); assert.equal(d.getElementById('manual-question').maxLength, 600);
});
