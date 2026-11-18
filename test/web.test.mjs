import { attachDashboard } from '../com.github.copilot/extensions/explorer/web/dashboard.mjs';
import { attachMinimap, projectOverview, overviewPaths } from '../com.github.copilot/extensions/explorer/web/minimap.mjs';
import { searchFilters, matchSearch, SEARCH_PAGE_SIZE } from '../com.github.copilot/extensions/explorer/web/search.mjs';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { localDate, REVISIT_FILTERS, revisitStatuses, revisitMatches } from '../com.github.copilot/extensions/explorer/web/revisit.mjs';
import { NextQuestion } from '../com.github.copilot/extensions/explorer/web/next-question.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { fixtureSpecs, makeFixture } from '../scripts/perf-fixtures.mjs';
import { parseBrief } from '../com.github.copilot/extensions/explorer/decision-brief.mjs';
import { parseHandoff } from '../com.github.copilot/extensions/explorer/implementation-handoff.mjs';
import { parseAnswerCheck } from '../com.github.copilot/extensions/explorer/answer-check.mjs';
import { Explorer } from '../com.github.copilot/extensions/explorer/controller.mjs';
import { Library } from '../com.github.copilot/extensions/explorer/library.mjs';
import { createDocument, contextFor } from '../com.github.copilot/extensions/explorer/model.mjs';
import { startServer } from '../com.github.copilot/extensions/explorer/server.mjs';
import { GeometryCache, viewportBounds, intersects, layout, branchView, revealPath } from '../com.github.copilot/extensions/explorer/web/layout.mjs';
import { attachVoice } from '../com.github.copilot/extensions/explorer/web/voice.mjs';
import { DraftClient } from '../com.github.copilot/extensions/explorer/web/drafts.mjs';
import { CleanupClient } from '../com.github.copilot/extensions/explorer/web/cleanup.mjs';
import { QuestionHelpClient } from '../com.github.copilot/extensions/explorer/web/question-help-client.mjs';
import { ResearchReviewClient } from '../com.github.copilot/extensions/explorer/web/research-review-client.mjs';
import { researchSettingsText } from '../com.github.copilot/extensions/explorer/web/research-policy.mjs';
import { attachNavigation } from '../com.github.copilot/extensions/explorer/web/navigation.mjs';
import { NavigationPreferences } from '../com.github.copilot/extensions/explorer/navigation-preferences.mjs';
import { draftHash, draftBase } from '../com.github.copilot/extensions/explorer/drafts.mjs';
import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus } from '../com.github.copilot/extensions/explorer/web/answer-state.mjs';
import { MODES, effectiveMode } from '../com.github.copilot/extensions/explorer/web/modes.mjs';

test('confirmed dependencies add and remove across branches without replacing answer drafts, and navigate both directions', async t => {
  const f = await fixture(t, 360), $ = id => f.document.getElementById(id), [a, b] = f.explorer.doc.nodes.slice(1); f.open(b.id);
  $('question-tools-toggle').click(); $('question-tab-context').click();
  assert.ok($('dependency-target')); assert.equal($('dependency-target').value, ''); assert.equal($('add-dependency').disabled, true);
  assert.equal(f.explorer.doc.dependencies, undefined); assert.match($('decision-dependencies').textContent, /separate|only listed/i);
  const editor = $('answer'); f.type('answer', '  Private answer 日本語\n'); editor.setSelectionRange(3, 7);
  f.type('dependency-target', a.id); f.type('dependency-explanation', '  Uses this result 🌱\n');
  const explanation = $('dependency-explanation'); explanation.focus(); explanation.setSelectionRange(2, 6); await f.poll();
  assert.equal($('dependency-explanation'), explanation); assert.equal(explanation.value, '  Uses this result 🌱\n'); assert.equal(explanation.selectionStart, 2);
  $('add-dependency').click(); await until(() => f.explorer.doc.dependencies?.length === 1 && $('dependency-target').value === '', 'dependency saved');
  assert.deepEqual(f.explorer.doc.dependencies[0], { dependentId: b.id, prerequisiteId: a.id, explanation: '  Uses this result 🌱\n' });
  assert.equal($('answer'), editor); assert.equal(editor.value, '  Private answer 日本語\n'); assert.equal(editor.selectionStart, 3); assert.equal(f.explorer.doc.nodes.find(n => n.id === b.id).answer, '');
  assert.match($('dependency-prerequisites').textContent, /This question depends on/);
  $('dependency-prerequisites').querySelector('[data-dependency-open]').click(); assert.equal($('node-workspace').dataset.nodeId, a.id); assert.equal(f.document.activeElement, $('expanded-title'));
  $('question-tools-toggle').click(); $('question-tab-context').click();
  assert.match($('dependency-dependents').textContent, /Questions that depend on this/);
  $('dependency-dependents').querySelector('[data-dependency-open]').click(); assert.equal($('node-workspace').dataset.nodeId, b.id); assert.equal($('answer').value, '  Private answer 日本語\n');
  $('dependency-prerequisites').querySelector('[data-dependency-remove]').click(); await until(() => !f.explorer.doc.dependencies && $('notice').textContent.includes('Dependency removed'), 'dependency removed');
  assert.equal($('answer').value, '  Private answer 日本語\n'); assert.equal(f.explorer.pending, null);
});

test('dependency failures keep the proposed relationship, plain text and answer draft for review', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), [a, b] = f.explorer.doc.nodes.slice(1); f.open(b.id);
  f.type('answer', 'Keep draft'); f.type('dependency-target', a.id); f.type('dependency-explanation', '<img src=x onerror=alert(1)>');
  await f.explorer.command('add-dependency', { revision: f.explorer.doc.revision, nodeId: a.id, prerequisiteId: b.id }); await f.poll();
  $('add-dependency').click(); await until(() => $('notice').textContent.includes('cycle'), 'cycle surfaced');
  assert.equal($('dependency-explanation').value, '<img src=x onerror=alert(1)>'); assert.equal($('answer').value, 'Keep draft');
  assert.equal(f.explorer.doc.dependencies.length, 1); assert.equal($('decision-dependencies').querySelector('img'), null);
  for (const action of ['add-dependency', 'remove-dependency']) {
    const response = await fetch(new URL('api/action', f.window.location.href), { method: 'POST', headers: { 'X-Explorer-Client': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ action, revision: f.explorer.doc.revision, nodeId: a.id, prerequisiteId: b.id }) }); assert.equal(response.status, 403);
  }
});

test('question drawer keeps secondary tools out of answering and preserves mounted drafts when toggled', async t => {
  const f = await fixture(t, 360), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id);
  const answer = $('answer'), parent = answer.parentElement, body = $('question-tools-body');
  assert.ok(body); assert.equal(body.hidden, true);
  assert.equal($('question-drawer').parentElement, $('question-stage').parentElement);
  for (const id of ['working-view', 'context-controls', 'map-title']) assert.ok($('question-stage').contains($(id)), id);
  assert.equal($('question-stage').contains($('question-drawer')), false);
  assert.equal($('node-workspace').contains(body), false);
  assert.equal($('world').contains(body), false);
  for (const id of ['answer-state', 'clean-answer', 'revisit-editor', 'question-context', 'research-summary', 'manual-question']) assert.ok(body.contains($(id)), id);
  assert.equal($('node-workspace').contains($('voice-settings')), false);
  f.type('answer', 'Keep my answer and caret'); answer.focus(); answer.setSelectionRange(3, 8);
  $('question-tools-toggle').click(); assert.equal(body.hidden, false);
  f.type('revisit-condition', 'Next month'); $('question-tools-toggle').click();
  assert.equal(body.hidden, true); assert.equal($('answer'), answer); assert.equal(answer.parentElement, parent);
  assert.equal(answer.value, 'Keep my answer and caret'); assert.equal(answer.selectionStart, 3); assert.equal(answer.selectionEnd, 8);
  $('question-tools-toggle').click(); $('revisit-condition').focus();
  $('revisit-condition').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(body.hidden, true); assert.equal(f.document.activeElement, $('question-tools-toggle')); assert.equal($('node-workspace').hidden, false);
  $('outline-toggle').click(); await f.poll(); $('outline-toggle').click();
  assert.equal($('answer'), answer); assert.equal(body.hidden, true); assert.equal($('revisit-condition').value, 'Next month');
});

test('constrained question stage reveals focused card controls without resetting user scroll on polling', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id);
  const stage = $('question-stage'), save = $('save-answer');
  Object.defineProperty(stage, 'clientHeight', { value: 180 });
  stage.getBoundingClientRect = () => ({ top: 100, bottom: 280, height: 180 });
  save.getBoundingClientRect = () => ({ top: 400 - stage.scrollTop, bottom: 436 - stage.scrollTop, height: 36 });
  save.focus(); assert.equal(stage.scrollTop, 156);
  stage.scrollTop = 72; await f.poll(); assert.equal(stage.scrollTop, 72, 'polling does not drag the reader back to the card');
});

test('Save & continue opens an existing useful question without generation', async t => {
  const f = await fixture(t, 460, undefined, false, { before: e => e.command('guidance', { revision: e.doc.revision, objective: 'Tool reliability', successCriteria: '' }) }), $ = id => f.document.getElementById(id);
  const [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  f.type('answer', 'Start with neighbors'); $('save-answer').click();
  await until(() => $('node-workspace').dataset.nodeId === b.id, 'continued to local useful question');
  assert.equal(f.explorer.doc.nodes.find(n => n.id === a.id).answer, 'Start with neighbors');
  assert.equal(f.explorer.pending, null); assert.equal(f.explorer.doc.nodes.length, 3);
});

test('Save & continue stays with the answer when there is no locally useful next question', async t => {
  const f = await fixture(t, 460, undefined, false, { questions: [{ category: 'People', question: 'Who should borrow first?' }] }), $ = id => f.document.getElementById(id), a = f.explorer.doc.nodes[1]; f.open(a.id);
  f.type('answer', 'Keep the saved answer'); $('save-answer').click();
  await until(() => $('notice').textContent.includes('No next question'), 'no-next feedback');
  assert.equal($('node-workspace').dataset.nodeId, a.id); assert.equal(f.explorer.pending, null);
});

test('Save & continue ignores stale completion after typing or navigating', async t => {
  for (const change of ['typing', 'navigation']) {
    const f = await fixture(t, 460, undefined, false, { before: e => e.command('guidance', { revision: e.doc.revision, objective: 'Tool reliability', successCriteria: '' }) }), $ = id => f.document.getElementById(id);
    const [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
    let release; f.pauseAnswer(() => new Promise(resolve => { release = resolve; }));
    f.type('answer', 'Submitted answer'); $('save-answer').click(); await until(() => release, 'save held');
    if (change === 'typing') f.type('answer', 'Newer draft');
    else { f.open(b.id); f.open(a.id); }
    release(); await until(() => f.explorer.doc.nodes.find(n => n.id === a.id).answer === 'Submitted answer', 'save delivered'); await delay(80);
    assert.equal($('node-workspace').dataset.nodeId, a.id, change);
    if (change === 'typing') assert.equal($('answer').value, 'Newer draft');
  }
});

test('question drawer tabs preserve drafts and keyboard focus across close, polling and navigation', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), [a, b] = f.explorer.doc.nodes.slice(1);
  f.open(a.id); $('question-tools-toggle').click();
  const answer = $('answer'); f.type('answer', 'Working answer'); chooseState(f, 'needs-evidence');
  $('question-tab-details').click(); f.type('revisit-condition', 'After a trial'); $('revisit-editor').open = true;
  $('question-tab-explore').click(); f.type('manual-question', 'Try another route');
  $('question-tab-research').focus(); $('question-tab-research').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal($('question-tab-details').getAttribute('aria-selected'), 'true'); assert.equal(f.document.activeElement, $('question-tab-details'));
  $('question-tools-body').scrollTop = 137; $('question-drawer-close').click();
  assert.equal(f.document.activeElement, $('question-tools-toggle')); assert.equal($('question-drawer').hidden, true);
  $('question-drawer-handle').click(); assert.equal($('question-tools-body').scrollTop, 137);
  answer.focus(); answer.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal($('question-drawer').hidden, true); assert.equal($('node-workspace').hidden, false); assert.equal(f.document.activeElement, $('question-tools-toggle'));
  await f.poll(); assert.equal($('answer'), answer); assert.equal($('answer-state').value, 'needs-evidence');
  f.open(b.id); f.open(a.id); $('question-tools-toggle').click();
  assert.equal($('question-tab-details').getAttribute('aria-selected'), 'true'); assert.equal($('revisit-condition').value, 'After a trial');
  assert.equal($('manual-question').value, 'Try another route'); assert.equal($('answer').value, 'Working answer'); assert.equal($('answer-state').value, 'needs-evidence');
});

test('Save & continue without guidance skips resolved, deferred and review questions and wraps', async t => {
  const f = await fixture(t, 460, undefined, false, { questions: ['First', 'Resolved', 'Deferred', 'Review', 'Last'].map(category => ({ category, question: `${category} question?` })), before: async e => {
    const doc = structuredClone(e.doc); doc.nodes[2].answerState = 'not-relevant'; doc.nodes[3].answerState = 'revisit-later'; doc.nodes[4].review = true;
    await e.save(doc, 'Fixture states');
  } }), $ = id => f.document.getElementById(id), [first, , , , last] = f.explorer.doc.nodes.slice(1);
  f.open(last.id); f.type('answer', 'Last answer'); $('save-answer').click();
  await until(() => $('node-workspace').dataset.nodeId === first.id, 'wrapped to first unresolved question');
  chooseState(f, 'decided'); f.type('answer', 'First answer'); $('save-answer').click();
  await until(() => $('node-workspace').dataset.nodeId === last.id, 'skipped unavailable questions');
  assert.equal(f.explorer.pending, null);
});

test('global settings gear remains available without a card and in Outline', async t => {
  const f = await fixture(t, 360), $ = id => f.document.getElementById(id);
  assert.equal($('navigation-open').getAttribute('aria-label'), 'Settings');
  assert.equal($('navigation-open').closest('.app-menu'), null); assert.equal($('navigation-open').hidden, false);
  $('navigation-open').click(); assert.equal($('navigation-dialog').open, true);
  assert.ok($('navigation-dialog').contains($('voice-settings'))); assert.ok($('navigation-dialog').contains($('palette-shortcut')));
  $('navigation-cancel').click(); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Settings must keep this');
  const answer = $('answer'); $('outline-toggle').click(); assert.equal($('navigation-open').hidden, false);
  $('navigation-open').click(); $('navigation-cancel').click();
  assert.equal($('answer'), answer); assert.equal(answer.value, 'Settings must keep this'); assert.equal(f.document.activeElement, $('navigation-open'));
});

test('Commands reveals a closed question drawer before opening a tool review', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); assert.equal($('question-tools-body').hidden, true);
  const answer = $('answer'); f.type('answer', 'Keep my private text');
  $('palette-open').click();
  const command = $('palette-commands').querySelector('[data-command="research-request"]');
  assert.equal(command.getAttribute('aria-disabled'), 'false'); command.click();
  await until(() => $('research-review-dialog').open, 'review opened');
  assert.equal($('question-tools-body').hidden, false); assert.equal($('research-summary').parentElement.open, true);
  assert.equal(f.document.querySelector('[data-tool-tab=research]').getAttribute('aria-selected'), 'true');
  assert.equal($('answer'), answer); assert.equal(answer.value, 'Keep my private text'); assert.equal(f.explorer.pending, null);
});

test('Commands cannot start a drawer operation after the question is collapsed', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id);
  $('collapse-node').click(); $('palette-open').click();
  const command = $('palette-commands').querySelector('[data-command="research-request"]');
  assert.equal(command.getAttribute('aria-disabled'), 'true'); command.click();
  assert.equal($('research-review-dialog').open, false); assert.equal(f.explorer.pending, null);
});

test('request navigation and new previews reveal the top of a scrolled question drawer', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'Start with nearby neighbors');
  $('question-tools-toggle').click(); $('question-tools-body').scrollTop = 800;
  $('question-tools-toggle').click(); $('question-tools-toggle').click();
  assert.equal($('question-tools-body').scrollTop, 800, 'ordinary toggling keeps the reader’s place');
  $('save-deeper').click(); await until(() => $('cancel-request'), 'pending controls');
  assert.equal($('question-tools-body').scrollTop, 0, 'Explore deeper reveals its request');
  $('question-tools-body').scrollTop = 800; $('question-tools-toggle').click(); $('request-status').click();
  assert.equal($('question-tools-body').hidden, false); assert.equal($('question-tools-body').scrollTop, 0);
  $('question-tools-body').scrollTop = 800; $('question-tools-toggle').click();
  await f.explorer.receive('questions', { requestId: f.explorer.pending.id, questions: [{ category: 'Next', question: 'What can we try first?' }] }); await f.poll();
  assert.equal($('question-tools-body').hidden, false); assert.equal($('question-tools-body').scrollTop, 0, 'a new preview is visible');
  $('question-tools-body').scrollTop = 200; $('question-tools-toggle').click(); await f.poll();
  assert.equal($('question-tools-body').hidden, true, 'the same preview does not force the shelf open again');
});

test('card workspace prioritizes the answer and keeps save controls outside the scrolling content', async t => {
  const f = await fixture(t, 460), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id);
  const content = $('node-workspace').querySelector('.node-content');
  assert.equal([...content.children].find(child => child.textContent.trim()).className, 'answer-form');
  assert.equal(content.contains($('save-answer')), false);
  assert.equal($('save-answer').closest('.workspace-savebar').parentElement, $('node-workspace'));
  assert.equal($('answer-state').closest('.question-tools-body').id, 'question-tools-body');
  assert.equal($('question-context').open, false);
  assert.equal($('revisit-editor').open, false);
  const answer = $('answer'), form = answer.closest('form');
  f.type('answer', 'Start with twenty neighbors.');
  $('question-context').open = true; $('revisit-editor').open = true;
  f.type('revisit-condition', 'After the first month');
  $('outline-toggle').click(); $('outline-toggle').click();
  await f.poll();
  assert.equal($('answer'), answer); assert.equal(answer.closest('form'), form);
  assert.equal(answer.value, 'Start with twenty neighbors.');
  assert.equal($('revisit-condition').value, 'After the first month');
});

test('card save shortcut commits the answer without starting an AI request', async t => {
  const f = await fixture(t, 460), $ = id => f.document.getElementById(id);
  const node = f.explorer.doc.nodes[1]; f.open(node.id);
  const commands = [], command = f.explorer.command.bind(f.explorer);
  f.explorer.command = (action, input) => { if (action === 'answer') commands.push(input.expand); return command(action, input); };
  f.type('answer', 'Use the community center.');
  $('answer').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.nodes.find(n => n.id === node.id).answer === 'Use the community center.', 'answer saved');
  assert.equal(f.explorer.pending, null, 'saving does not silently generate follow-up questions');
  assert.deepEqual(commands, [false]);
  assert.equal($('save-answer').classList.contains('primary'), true);
});

test('application menus dismiss before an action and Escape returns focus without collapsing the question', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id);
  const answer = $('answer'); f.type('answer', 'Keep my draft');
  const menu = $('tools-menu'), trigger = menu.querySelector('summary');
  menu.open = true; $('dashboard-open').click();
  assert.equal(menu.open, false); assert.equal($('dashboard-dialog').open, true);
  $('dashboard-close').click();
  menu.open = true; $('dashboard-open').focus();
  $('dashboard-open').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(menu.open, false); assert.equal(f.document.activeElement, trigger);
  assert.equal($('node-workspace').hidden, false); assert.equal($('answer'), answer); assert.equal(answer.value, 'Keep my draft');
});

test('leaving branch focus returns to visible context controls when the disclosure is closed', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id);
  $('question-tools-toggle').click();
  $('question-context').open = true; $('focus-branch').click();
  $('question-context').open = false; $('show-whole-map').focus(); $('show-whole-map').click();
  assert.equal($('focus-access').hidden, true);
  assert.equal(f.document.activeElement, $('question-context').querySelector('summary'));
  assert.equal($('node-workspace').hidden, false);
});

test('question text selection does not start map dragging and the state selector keeps the save shortcut', async t => {
  const f = await fixture(t, 360), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); const camera = JSON.stringify(f.window.__updates.scene().view);
  const down = new f.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 30, clientY: 40 });
  Object.defineProperty(down, 'pointerId', { value: 91 }); $('expanded-title').dispatchEvent(down);
  const move = new f.window.MouseEvent('pointermove', { bubbles: true, cancelable: true, buttons: 1, clientX: 100, clientY: 60 });
  Object.defineProperty(move, 'pointerId', { value: 91 }); f.window.dispatchEvent(move);
  assert.equal(down.defaultPrevented, false); assert.equal(move.defaultPrevented, false);
  assert.equal(JSON.stringify(f.window.__updates.scene().view), camera);
  chooseState(f, 'revisit-later');
  $('answer-state').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.nodes.find(n => n.id === node.id).answerState === 'revisit-later', 'state-only save');
  assert.equal(f.explorer.pending, null);
});

test('viewport height changes keep the expanded writing card anchored instead of recentering it', async t => {
  const f = await fixture(t, 460); f.open(f.explorer.doc.nodes[1].id);
  const top = () => { const scene = f.window.__updates.scene(); return scene.view.y + scene.positions.get(scene.selected).y * scene.view.zoom; };
  const before = top(); f.resize(460, 760);
  assert.equal(top(), before, 'a taller map does not move the current question away from the pointer');
});

const findings = { basis: 'reasoning', summary: 'Two possible ways forward.', options: [
  { title: 'One block', description: 'Start with the nearest neighbors.', pros: ['Easy handovers'], cons: ['Fewer tools'] },
  { title: 'Whole neighborhood', description: 'Invite everyone nearby.', pros: ['More tools'], cons: ['More coordination'] },
], recommendation: 'Try a small pilot.', uncertainty: 'No external sources consulted.', sources: [] };

test('dashboard keeps the same Outline editor and private drafts, preserves filter focus and matches chart tables', async t => {
  const f = await fixture(t, 280), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'DASHBOARD_PRIVATE_DRAFT'); f.type('revisit-condition', 'Private reminder');
  $('outline-toggle').click(); const answer = $('answer'), editor = $('node-workspace'), camera = JSON.stringify(f.window.__updates.scene().view);
  assert.ok($('dashboard-open'), 'dashboard is available inside Explorer');
  $('dashboard-open').click(); await until(() => $('dashboard-results').querySelector('svg'), 'dashboard aggregation');
  assert.equal(f.document.activeElement, $('dashboard-close'));
  assert.equal($('answer'), answer); assert.equal($('node-workspace'), editor); assert.equal(answer.value, 'DASHBOARD_PRIVATE_DRAFT');
  assert.equal($('working-view').classList.contains('outline-mode'), true); assert.equal(JSON.stringify(f.window.__updates.scene().view), camera);
  assert.ok(!$('dashboard-results').textContent.includes('DASHBOARD_PRIVATE_DRAFT'));
  for (const chart of $('dashboard-results').querySelectorAll('.dashboard-chart')) {
    const values = [...chart.querySelectorAll('svg rect[data-value]')].map(row => row.dataset.value);
    const table = [...chart.querySelectorAll('tbody td[data-value]')].map(row => row.dataset.value);
    assert.deepEqual(values, table); assert.ok(chart.querySelector('svg[role="img"][aria-label]')); assert.ok(chart.querySelector('table caption'));
  }
  $('dashboard-from').value = '2099-01-01'; $('dashboard-to').value = '2099-01-01'; $('dashboard-apply').click(); $('dashboard-from').focus();
  await until(() => $('dashboard-status').textContent.includes('Cached'), 'cached filtered dashboard');
  assert.equal(f.document.activeElement, $('dashboard-from')); assert.match($('dashboard-results').textContent, /No observed activity/);
  $('dashboard-close').click(); assert.equal($('dashboard-dialog').open, false); assert.equal(f.document.activeElement, $('dashboard-open'));
  assert.equal($('answer'), answer); assert.equal(answer.value, 'DASHBOARD_PRIVATE_DRAFT'); assert.equal($('revisit-condition').value, 'Private reminder');
});
test('dashboard explicit modal focus cancels dictation and rejects late audio without replacing drafts', async t => {
  const voice = voiceFixture(), f = await fixture(t, 280, voice), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep this draft'); $('answer').focus();
  await until(() => $('voice-status').textContent.includes('Hold Ctrl'), 'voice ready');
  const start = voice.start; let late; voice.start = id => { start(id); return new Promise(resolve => { late = () => resolve({ id, phase: 'done', text: 'LATE_DASHBOARD_AUDIO' }); }); };
  $('voice-record').click(); await until(() => voice.counts().starts === 1, 'dictation started');
  $('dashboard-open').click(); await until(() => voice.counts().cancels === 1, 'modal focus cancelled voice');
  late(); await until(() => $('dashboard-results').querySelector('svg'), 'dashboard loaded');
  assert.equal($('answer').value, 'Keep this draft'); assert.equal(f.document.activeElement, $('dashboard-close'));
  $('dashboard-close').click(); assert.equal($('answer').value, 'Keep this draft');
});

test('full Outline keeps the same editor, composition and camera through extreme zoom switches', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id), ui = f.window.__updates;
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Exact ?? private draft'); f.type('revisit-condition', 'Reminder'); f.type('manual-question', 'Direction');
  const answer = $('answer'), reminder = $('revisit-condition'), manual = $('manual-question'), panel = $('node-workspace'), parent = panel.parentNode;
  answer.focus(); answer.setSelectionRange(2, 5); answer.scrollTop = 17;
  answer.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  ui.zoom(.1 / ui.scene().view.zoom); const camera = JSON.stringify(ui.scene().view), saved = JSON.stringify(f.explorer.doc), actions = f.actions.length;
  for (let i = 0; i < 6; i++) {
    const down = new f.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true }); $('outline-toggle').dispatchEvent(down); assert.equal(down.defaultPrevented, true);
    $('outline-toggle').click();
    assert.equal($('working-view').classList.contains('outline-mode'), i % 2 === 0);
    assert.equal($('answer'), answer); assert.equal(panel.parentNode, parent); assert.equal($('revisit-condition'), reminder); assert.equal($('manual-question'), manual);
    assert.equal(f.document.activeElement, answer); assert.equal(answer.selectionStart, 2); assert.equal(answer.selectionEnd, 5); assert.equal(answer.scrollTop, 17);
    assert.equal(JSON.stringify(ui.scene().view), camera);
  }
  answer.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(JSON.stringify(f.explorer.doc), saved); assert.equal(f.actions.length, actions);
});

test('full Outline retains dictation through pointer switches and rejects late audio after keyboard departure', async t => {
  const voice = voiceFixture(), f = await fixture(t, 340, voice), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); const answer = $('answer'); answer.focus();
  await until(() => $('voice-status').textContent.includes('Hold Ctrl'), 'voice ready');
  key(f, 'keydown'); await until(() => voice.counts().starts === 1, 'voice start'); const before = voice.counts();
  $('outline-toggle').click(); $('outline-toggle').click(); $('outline-toggle').click();
  await delay(30); assert.deepEqual(voice.counts(), before); assert.equal(f.document.activeElement, answer);
  key(f, 'keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false });
  await until(() => answer.value.includes('our neighbors'), 'same dictation inserted');
  await until(() => !$('voice-record').disabled, 'first recording fully saved');
  const start = voice.start; let releaseLate; voice.start = id => { start(id); return new Promise(resolve => { releaseLate = () => resolve({ id, phase: 'done', text: 'LATE_OUTLINE_AUDIO' }); }); };
  $('voice-record').click(); await until(() => voice.counts().starts === 2, 'second recording');
  $('outline-toggle').focus(); await until(() => voice.counts().cancels > before.cancels, 'keyboard departure cancels');
  $('outline-toggle').click(); releaseLate(); await delay(30); assert.equal(answer.value, 'our neighbors');
});

test('full Outline exposes all deep nodes through bounded hierarchy, filters, pages and selected-source reveal', async t => {
  const f = await fixture(t, 280, undefined, false, { before: e => {
    const base = e.doc.nodes[1]; let parentId = e.doc.rootId;
    e.doc.nodes = [e.doc.nodes[0]];
    for (let i = 1; i <= 620; i++) { const id = `deep-${i}`; e.doc.nodes.push({ ...base, id, parentId, question: `Depth ${i}?` }); parentId = id; }
  } }), $ = id => f.document.getElementById(id), ui = f.window.__updates;
  $('outline-toggle').click(); assert.equal($('outline-list').children.length, 200); assert.equal($('outline-list').getAttribute('role'), 'list');
  assert.equal($('outline-list').lastChild.dataset.depth, '199'); assert.equal($('outline-list').lastChild.style.getPropertyValue('--depth'), '4');
  $('outline-next').click(); assert.ok($('outline-count').textContent.includes('201\u2013400'));
  assert.equal($('outline-list').firstChild.dataset.depth, '200');
  $('outline-next').click(); $('outline-next').click(); assert.equal($('outline-list').children.length, 21);
  $('outline-list').querySelector('[data-node-id="deep-620"]').click(); const answer = $('answer'); f.type('answer', 'DEEP_PRIVATE');
  assert.equal($('outline').hidden, false); assert.equal($('node-workspace').dataset.nodeId, 'deep-620');
  f.type('search', 'No match'); assert.equal($('outline-list').children.length, 0); assert.equal($('answer'), answer);
  $('outline-toggle').click(); $('outline-toggle').click(); assert.equal($('search').value, 'No match');
  $('outline-selected').click(); assert.equal($('search').value, ''); assert.equal(f.document.activeElement.dataset.nodeId, 'deep-620'); assert.equal($('outline-list').children.length, 21);
  $('outline-previous').click(); $('outline-previous').click(); $('outline-previous').click();
  const fold = $('outline-list').querySelector('[data-branch-id="deep-1"]'); fold.click(); assert.equal($('outline-list').children.length, 2); assert.equal(ui.scene().selected, 'deep-1');
  f.type('search', 'Depth 620?'); assert.equal($('outline-list').children.length, 1); assert.match($('outline-mode-hint').textContent, /including folded/); assert.match($('outline-list').textContent, /Level 621.*Parent: Depth 619/);
  $('outline-list').querySelector('[data-node-id]').click(); assert.equal($('answer').value, 'DEEP_PRIVATE'); assert.equal($('search').value, 'Depth 620?');
  $('outline-selected').click(); assert.equal(f.document.activeElement.dataset.nodeId, 'deep-620');
  $('palette-open').click(); f.type('palette-query', 'Depth 410?'); $('palette-results').querySelector('[data-node-id="deep-410"]').click();
  await until(() => $('node-workspace').dataset.nodeId === 'deep-410', 'validated source in Outline');
  assert.equal($('search').value, ''); assert.ok($('outline-list').querySelector('[data-node-id="deep-410"]')); assert.equal($('outline-list').children.length, 200);
});

test('full Outline suspends minimap gestures and hidden geometry while retaining current source and live palette commands', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id), ui = f.window.__updates;
  f.open(f.explorer.doc.nodes[1].id); $('minimap-toggle').click();
  const mini = $('minimap-map'), down = new f.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 30, clientY: 740 }); Object.defineProperty(down, 'pointerId', { value: 9 }); mini.dispatchEvent(down); assert.equal(mini.hasPointerCapture(9), true);
  $('answer').focus(); $('outline-toggle').click(); assert.equal(mini.hasPointerCapture(9), false); assert.equal($('minimap').hidden, true); assert.equal($('minimap-toggle').getAttribute('aria-expanded'), 'true');
  const camera = JSON.stringify(ui.scene().view), geometry = ui.scene().geometry, answer = $('answer'), records = [];
  const observer = new f.window.MutationObserver(rows => records.push(...rows)); observer.observe($('world'), { attributes: true, childList: true, subtree: true }); observer.observe(mini, { attributes: true, childList: true, subtree: true });
  let listeners = 0; const listen = f.window.EventTarget.prototype.addEventListener;
  f.window.EventTarget.prototype.addEventListener = function (...args) { listeners++; return listen.apply(this, args); };
  for (let i = 0; i < 10; i++) { ui.refresh(); f.observers.get('map')(); f.observers.get('minimap-map')(); ui.workspace(); }
  f.window.EventTarget.prototype.addEventListener = listen;
  $('map').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  $('map').dispatchEvent(new f.window.WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true }));
  const move = new f.window.MouseEvent('pointermove', { buttons: 1, clientX: 150, clientY: 770 }); Object.defineProperty(move, 'pointerId', { value: 9 }); f.window.dispatchEvent(move);
  const changes = [...records, ...observer.takeRecords()]; observer.disconnect();
  assert.equal(listeners, 0); assert.equal(ui.scene().geometry, geometry); assert.equal(JSON.stringify(ui.scene().view), camera); assert.equal($('answer'), answer);
  assert.equal(changes.filter(r => r.target.closest?.('#nodes,#edges,#minimap-map') || r.target.id === 'world').length, 0, 'ten hidden updates produce no map/minimap mutations');
  $('palette-open').click(); assert.equal($('palette-commands').querySelector('[data-command="fit"]').getAttribute('aria-disabled'), 'true');
  const toggle = $('palette-commands').querySelector('[data-command="outline-toggle"]'); assert.match(toggle.textContent, /Map view/); toggle.click(); assert.equal($('outline').hidden, true); assert.equal($('minimap').hidden, false); assert.ok($('minimap-nodes').getAttribute('d'));
  assert.equal(JSON.stringify(ui.scene().view), camera);
});

test('full Outline keeps research and private cleanup previews on their captured source and saves through the same actions', async t => {
  let resolveClean;
  const f = await fixture(t, 340, undefined, false, { cleaner: { run: () => new Promise(resolve => { resolveClean = resolve; }), close() {} } }), $ = id => f.document.getElementById(id), id = f.explorer.doc.nodes[1].id;
  f.open(id); f.type('answer', 'OUTLINE_PRIVATE'); $('clean-answer').click(); await until(() => resolveClean, 'private cleanup starts');
  const answer = $('answer'); $('outline-toggle').click(); resolveClean('PRIVATE_PROPOSAL'); await until(() => $('apply-cleanup'), 'private proposal retained');
  const proposal = $('apply-cleanup'); $('outline-toggle').click(); $('outline-toggle').click(); assert.equal($('apply-cleanup'), proposal); assert.equal($('answer'), answer); assert.equal(answer.value, 'OUTLINE_PRIVATE');
  assert.doesNotMatch(await (await fetch(new URL('export.json', f.window.location.href))).text(), /OUTLINE_PRIVATE|PRIVATE_PROPOSAL/);
  $('research-request').click(); await startReviewedResearch(f); await until(() => f.explorer.pending?.kind === 'research', 'research pending');
  const request = f.explorer.pending.id; $('outline-toggle').click(); $('outline-toggle').click(); assert.equal(f.explorer.pending.id, request);
  f.resolveResearch(findings); await until(() => f.explorer.doc.nodes[1].research, 'research completed'); await f.poll();
  assert.equal($('answer'), answer); assert.equal(answer.value, 'OUTLINE_PRIVATE'); assert.equal(f.explorer.doc.nodes[1].answer, ''); assert.match($('outline-list').textContent, /Research available/);
  chooseState(f, 'tentative'); const count = f.actions.filter(a => a.action === 'answer').length; f.click('Save & continue');
  await until(() => f.explorer.doc.nodes[1].answer === 'OUTLINE_PRIVATE', 'same save action'); assert.equal(f.explorer.doc.nodes[1].answerState, 'tentative'); assert.equal(f.actions.filter(a => a.action === 'answer').length, count + 1);
  assert.equal(f.actions.filter(a => a.action === 'research').length, 1);
});

test('full Outline recovers a removed selected draft and moves focus to a reachable row', async t => {
  const f = await fixture(t, 280), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'REMOVED_OUTLINE_DRAFT'); f.type('revisit-condition', 'REMOVED_REMINDER');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'durable draft'); $('answer').focus(); $('outline-toggle').click();
  const next = structuredClone(f.explorer.doc); next.nodes = next.nodes.filter(n => n.id !== node.id); await f.explorer.save(next, 'Remove selected question'); await f.poll();
  assert.equal($('answer'), null); assert.equal(f.document.activeElement.dataset.nodeId, next.rootId); assert.equal(f.document.activeElement.closest('#outline-list'), $('outline-list'));
  await until(() => $('orphan-drafts').querySelector('textarea')?.value === 'REMOVED_OUTLINE_DRAFT', 'recoverable orphan'); assert.equal($('orphan-drafts').querySelector('[data-orphan-reminder] textarea').value, 'REMOVED_REMINDER');
});

test('full Outline layout rules neutralize the counter-scaled editor and keep narrow scroll owners', async t => {
  const f = await fixture(t, 280), $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id);
  const css = await (await fetch(new URL('style.css', f.window.location.href))).text(), style = f.document.createElement('style'); style.textContent = css; f.document.head.append(style);
  f.window.__updates.zoom(.1); $('outline-toggle').click();
  assert.equal(f.window.getComputedStyle($('map')).overflow, 'auto'); assert.equal(f.window.getComputedStyle($('map')).touchAction || 'auto', 'auto');
  assert.equal(f.window.getComputedStyle($('world')).position, 'static');
  assert.equal(f.window.getComputedStyle($('node-workspace')).position, 'relative');
  assert.equal(f.window.getComputedStyle(f.document.querySelector('.node-content')).overflow, 'auto');
  const rules = [...style.sheet.cssRules], world = rules.find(rule => rule.selectorText === '.outline-mode #world'), editor = rules.find(rule => rule.selectorText === '.outline-mode #node-workspace');
  assert.equal(world.style.getPropertyValue('transform'), 'none'); assert.equal(world.style.getPropertyPriority('transform'), 'important');
  for (const [property, expected] of [['transform', 'none'], ['left', 'auto'], ['top', 'auto'], ['width', '100%'], ['max-height', '100%']]) { assert.equal(editor.style.getPropertyValue(property), expected); assert.equal(editor.style.getPropertyPriority(property), 'important'); }
  const narrow = rules.find(rule => rule.conditionText === '(max-width:660px)' && rule.cssText.includes('.outline-mode'));
  assert.ok(narrow.cssText.includes('minmax(150px,35%) minmax(340px,1fr)')); assert.equal($('map-controls').hidden, true); assert.equal($('nodes').hidden, true); assert.equal($('edges').style.display, 'none');
  $('outline-toggle').click(); assert.equal(f.window.getComputedStyle($('map')).overflow, 'clip'); assert.equal($('map-controls').hidden, false);
});

test('selected Outline question and metadata keep readable contrast in both themes and on hover', async t => {
  const f = await fixture(t, 280), $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id); $('outline-toggle').click();
  const style = f.document.createElement('style'); style.textContent = await (await fetch(new URL('style.css', f.window.location.href))).text(); f.document.head.append(style);
  const rules = [...style.sheet.cssRules], row = $('outline-list').querySelector('[aria-current="true"]');
  const inheritedColor = element => {
    const color = f.window.getComputedStyle(element).color;
    return color === 'inherit' || !color ? inheritedColor(element.parentElement) : color;
  };
  const luminance = color => {
    assert.match(color, /^rgb\(/, `resolved opaque CSS color: ${color}`);
    const channels = color.match(/[\d.]+/g).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const theme of ['dark', 'light']) {
    // jsdom does not evaluate color-scheme media, CSS variables or inherit. Select only
    // the actual theme rules, resolve their root variables, and retain cascade order.
    const active = rules.flatMap(rule => rule.conditionText ? rule.conditionText === '(prefers-color-scheme:dark)' && theme === 'dark' ? [...rule.cssRules] : [] : [rule]);
    const vars = new Map();
    for (const rule of active) if (rule.selectorText === ':root') for (let i = 0; i < rule.style.length; i++) { const name = rule.style[i]; if (name.startsWith('--')) vars.set(name, rule.style.getPropertyValue(name)); }
    style.textContent = active.map(rule => rule.cssText).join('\n').replace(/var\((--[\w-]+)\)/g, (original, name) => vars.get(name) ?? original).replaceAll(':hover', '[data-theme-test-hover]');
    for (const hover of [false, true]) {
      row.toggleAttribute('data-theme-test-hover', hover);
      const background = luminance(f.window.getComputedStyle(row).backgroundColor);
      for (const [label, element] of [['question', row], ['metadata', row.querySelector('small')]]) {
        const foreground = luminance(inheritedColor(element));
        const ratio = (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
        assert.ok(ratio >= 4.5, `${theme} ${hover ? 'hover' : 'rest'} ${label}: ${ratio.toFixed(2)}:1 contrast`);
      }
    }
  }
});

test('full Outline falls back from a removed focused row without clearing the search or changing the editor', async t => {
  const f = await fixture(t, 280), $ = id => f.document.getElementById(id), [removed, selected] = f.explorer.doc.nodes.slice(1);
  f.open(selected.id); const answer = $('answer'); $('outline-toggle').click(); f.type('search', 'borrow');
  $('outline-list').querySelector('[data-node-id]').focus();
  const next = structuredClone(f.explorer.doc); next.nodes = next.nodes.filter(n => n.id !== removed.id); await f.explorer.save(next, 'Remove focused row'); await f.poll();
  assert.equal($('outline-list').children.length, 0); assert.equal(f.document.activeElement, $('outline-selected'));
  assert.equal($('search').value, 'borrow'); assert.equal($('answer'), answer); assert.equal($('node-workspace').dataset.nodeId, selected.id);
});

test('full Outline same-node navigation reveals the editor on Map return after extreme zoom', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id), ui = f.window.__updates, id = f.explorer.doc.nodes[1].id;
  f.open(id); const answer = $('answer'); ui.zoom(.1 / ui.scene().view.zoom);
  $('outline-toggle').click(); $('outline-list').querySelector(`[data-node-id="${id}"]`).click(); $('outline-toggle').click();
  const { positions, view } = ui.scene(), box = positions.get(id);
  assert.equal(view.zoom, 1); assert.equal($('answer'), answer);
  assert.ok(view.x + box.x * view.zoom >= 15, 'same-node explicit selection reveals the editor left edge');
  assert.ok(view.x + (box.x + box.width) * view.zoom <= 325, 'same-node explicit selection reveals the editor right edge');
  assert.ok(view.y + box.y * view.zoom >= 15, 'same-node explicit selection reveals the heading');
  const camera = JSON.stringify(view); $('outline-toggle').click(); $('outline-toggle').click(); assert.equal(JSON.stringify(ui.scene().view), camera, 'the marker resets on the next pure toggle');
});

test('command palette keeps the same drafts and editor, traps focus and activates a command once', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'PRIVATE_PALETTE'); f.type('revisit-condition', 'Keep reminder'); f.type('manual-question', 'Keep direction');
  const answer = $('answer'), reminder = $('revisit-condition'), manual = $('manual-question'), saved = JSON.stringify(f.explorer.doc), actions = f.actions.length;
  answer.focus(); answer.setSelectionRange(2, 5);
  assert.ok($('palette-open'), 'visible palette entry'); $('palette-open').click();
  assert.equal($('palette-dialog').open, true); assert.equal(f.document.activeElement, $('palette-query'));
  paletteKey(f, $('palette-query'), { key: 'ArrowUp', code: 'ArrowUp', ctrlKey: false, shiftKey: false }); assert.equal(f.document.activeElement, $('palette-results').lastChild);
  f.type('palette-query', 'PRIVATE_PALETTE'); assert.equal($('palette-results').children.length, 0);
  $('palette-draft-text').click(); assert.equal($('palette-results').children.length, 1); assert.match($('palette-results').textContent, /PRIVATE_PALETTE/);
  await f.poll(); assert.equal($('answer'), answer); assert.equal($('revisit-condition'), reminder); assert.equal($('manual-question'), manual);
  $('palette-close').focus(); $('palette-close').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); assert.equal(f.document.activeElement, $('palette-query'));
  $('palette-query').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(f.document.activeElement, answer); assert.equal(answer.selectionStart, 2); assert.equal(answer.selectionEnd, 5);
  assert.equal(JSON.stringify(f.explorer.doc), saved); assert.equal(f.actions.length, actions);
  for (let i = 0; i < 5; i++) { $('palette-open').click(); $('palette-close').click(); }
  $('palette-open').click(); f.type('palette-query', 'Show minimap');
  $('palette-query').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  $('palette-query').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal($('minimap').hidden, false); assert.equal($('palette-dialog').open, false); assert.equal($('answer'), answer);
  $('palette-open').click(); f.type('palette-query', 'Hide minimap'); assert.equal($('palette-commands').children.length, 1); $('palette-commands').firstChild.click(); assert.equal($('minimap').hidden, true);
});

test('command palette arrows reveal the last row and rows beyond the viewport edge', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id);
  $('palette-open').click();
  const dialog = $('palette-dialog'), rows = [...dialog.querySelectorAll('#palette-commands button, #palette-results button')], reveals = [];
  // jsdom cannot scroll or paint. Synthetic bounds identify off-screen targets;
  // verify the real handler delegates their reveal to the browser, not visibility.
  dialog.getBoundingClientRect = () => ({ top: 0, bottom: 160, height: 160 });
  rows.forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: index * 40, bottom: (index + 1) * 40, height: 40 });
    row.scrollIntoView = options => reveals.push({ row, block: options.block, inline: options.inline });
  });
  const arrow = key => paletteKey(f, f.document.activeElement, { key, code: key, ctrlKey: false, shiftKey: false });
  arrow('ArrowUp');
  assert.equal(f.document.activeElement, rows.at(-1));
  assert.ok(rows.at(-1).getBoundingClientRect().top > dialog.getBoundingClientRect().bottom);
  assert.deepEqual(reveals, [{ row: rows.at(-1), block: 'nearest', inline: 'nearest' }], 'ArrowUp from query reveals its far-away destination');
  reveals.length = 0; $('palette-query').focus();
  for (let i = 0; i < 5; i++) arrow('ArrowDown');
  assert.equal(f.document.activeElement, rows[4]);
  assert.equal(rows[3].getBoundingClientRect().bottom, dialog.getBoundingClientRect().bottom);
  assert.ok(rows[4].getBoundingClientRect().bottom > dialog.getBoundingClientRect().bottom);
  assert.deepEqual(reveals.map(({ row }) => row), rows.slice(0, 5), 'every arrow-selected row asks to remain visible, including the edge crossing');
  assert.ok(reveals.every(({ block, inline }) => block === 'nearest' && inline === 'nearest'));
});

test('command palette saved search rejects a closed selection after awaited draft flush', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id);
  await f.explorer.library.import(createDocument('Palette target')); const original = f.explorer.activeKey;
  f.open(f.explorer.doc.nodes[1].id); let release; const held = new Promise(resolve => { release = resolve; }); f.pauseDraftWrite(() => held);
  f.type('answer', 'KEEP_PALETTE_DRAFT'); assert.ok($('palette-open')); $('palette-open').click();
  $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); f.type('palette-query', 'Palette target');
  await until(() => $('palette-results').querySelector('[data-node-id]'), 'palette target');
  const row = $('palette-results').querySelector('[data-node-id]'); row.click(); row.click(); $('palette-close').click(); release();
  await until(() => !$('workspace').inert, 'flush finished'); assert.equal(f.explorer.activeKey, original);
  assert.equal(f.actions.filter(a => a.action === 'open').length, 0); assert.equal($('answer').value, 'KEEP_PALETTE_DRAFT');
});

const paletteKey = (f, target, props = {}) => {
  const event = new f.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, ...props }); target.dispatchEvent(event); return event;
};
test('command palette shortcut is opt-in, fails closed on unknown or conflicting voice settings and skips editors and composition', async t => {
  const voice = voiceFixture(); let configured = { ...(await voice.status()) };
  voice.status = async () => configured;
  const f = await fixture(t, 340, voice), $ = id => f.document.getElementById(id);
  assert.equal(paletteKey(f, $('palette-open')).defaultPrevented, false);
  $('palette-open').click(); $('palette-shortcut').click(); $('palette-close').click();
  assert.equal(paletteKey(f, $('palette-open')).defaultPrevented, false, 'voice settings are unknown before binding an editor');
  f.open(f.explorer.doc.nodes[1].id); await until(() => !$('voice-record').disabled, 'voice settings known');
  assert.equal(paletteKey(f, $('answer')).defaultPrevented, false, 'editing is never intercepted');
  assert.equal(paletteKey(f, $('palette-open'), { isComposing: true }).defaultPrevented, false);
  assert.equal(paletteKey(f, $('palette-open'), { repeat: true }).defaultPrevented, false);
  $('answer').dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  assert.equal(paletteKey(f, $('palette-open')).defaultPrevented, false); $('palette-open').click(); assert.equal($('palette-dialog').open, false);
  $('answer').dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(paletteKey(f, $('palette-open')).defaultPrevented, true); assert.equal($('palette-dialog').open, true); $('palette-close').click();
  configured = { ...configured, shortcut: { code: 'KeyP', ctrl: true, shift: true, meta: false, alt: false }, label: 'Ctrl + Shift + P' };
  $('answer').focus(); await until(() => /Shift/.test($('voice-status').textContent), 'new configured shortcut');
  $('palette-open').focus(); assert.equal(paletteKey(f, $('palette-open')).defaultPrevented, false); assert.equal($('palette-dialog').open, false);
  $('answer').focus(); paletteKey(f, $('answer')); await until(() => voice.counts().starts === 1, 'configured voice shortcut still owns answer');
  $('palette-open').click(); await until(() => voice.counts().cancels === 1, 'opening cancels dictation'); assert.equal($('palette-dialog').open, true);
});

test('command palette cancels owned voice and ignores its late response without changing editor state', async t => {
  const voice = voiceFixture(), f = await fixture(t, 340, voice), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep exact text'); const answer = $('answer');
  await until(() => !$('voice-record').disabled, 'voice ready'); answer.focus(); key(f, 'keydown'); await until(() => voice.counts().starts === 1, 'recording');
  let release; f.pauseVoicePoll(() => new Promise(resolve => { release = resolve; })); await until(() => release, 'late poll held');
  $('palette-open').click(); await until(() => voice.counts().cancels === 1, 'cancelled once'); voice.finish(); f.pauseVoicePoll(null); release(); await delay(240);
  assert.equal($('answer'), answer); assert.equal(answer.value, 'Keep exact text'); assert.equal($('palette-query').value, '');
  $('palette-close').click(); assert.equal(f.document.activeElement, answer); assert.equal(f.explorer.doc.nodes[1].answer, '');
});

test('command palette shows current eligibility, preserves previews and opens helper review without inference', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id);
  $('palette-open').click(); f.type('palette-query', 'Research options'); const research = $('palette-commands').firstChild;
  research.click(); research.click(); assert.equal($('palette-dialog').open, false); await until(() => !$('research-review-start').disabled, 'explicit review');
  assert.equal(f.actions.filter(a => a.action === 'research').length, 0); $('research-review-close').click();
  await f.explorer.command('questions', { nodeId: f.explorer.doc.rootId, revision: f.explorer.doc.revision }); await f.poll();
  $('palette-open').click();
  const unavailable = $('palette-commands').querySelector('[data-command="research-request"]'); assert.equal(unavailable.getAttribute('aria-disabled'), 'true'); assert.match(unavailable.textContent, /request/);
  assert.equal($('palette-commands').querySelector('[data-command="minimap-toggle"]').getAttribute('aria-disabled'), 'false');
  unavailable.focus(); unavailable.click(); assert.equal(f.document.activeElement.dataset.command, 'research-request'); assert.equal($('palette-dialog').open, true); assert.equal(f.actions.filter(a => a.action === 'research').length, 0);
  $('palette-close').click(); await f.explorer.receive('questions', { requestId: f.explorer.pending.id, questions: [{ category: 'Next', question: 'Preview still here?' }] }); await f.poll();
  $('palette-open').click(); f.type('palette-query', 'Check answers'); $('palette-commands').firstChild.click();
  await until(() => $('check-dialog').open, 'check dialog'); assert.ok(f.explorer.preview); assert.equal(f.explorer.pending, null);
});

test('command palette falls back to its button when its origin is removed and stale rows never retarget', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1]; f.open(node.id); $('answer').focus(); $('palette-open').click();
  const stale = $('palette-commands').querySelector('[data-command="research-request"]');
  const next = structuredClone(f.explorer.snapshot()); next.document.nodes = next.document.nodes.filter(n => n.id !== node.id); next.document.revision++;
  f.window.__updates.apply(next); assert.equal($('palette-dialog').open, false); assert.equal(f.document.activeElement, $('palette-open'));
  stale.click(); assert.equal($('research-review-dialog').open, false);
});

test('command palette saved result rechecks pending eligibility after its delayed draft flush', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id); await f.explorer.library.import(createDocument('Pending target'));
  const original = f.explorer.activeKey, node = f.explorer.doc.nodes[1]; f.open(node.id);
  let release; const held = new Promise(resolve => { release = resolve; }); f.pauseDraftWrite(() => held); f.type('answer', 'Pending keeps draft');
  $('palette-open').click(); $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); f.type('palette-query', 'Pending target');
  await until(() => $('palette-results').firstChild, 'target found'); $('palette-results').firstChild.click();
  await f.explorer.command('questions', { nodeId: f.explorer.doc.rootId, revision: f.explorer.doc.revision }); await f.poll(); release();
  await until(() => !$('workspace').inert, 'flush completed'); assert.equal(f.explorer.activeKey, original); assert.equal(f.actions.filter(a => a.action === 'open').length, 0);
  assert.match($('notice').textContent, /Cancel the current/); assert.equal($('answer').value, 'Pending keeps draft');
});

test('command palette search bounds DOM, renders source text safely and leaves hidden scans stopped', async t => {
  const f = await fixture(t, 340, undefined, true, { before: async e => { const { document } = makeFixture(fixtureSpecs.find(spec => spec.name === 'medium-wide')); await e.command('import', { revision: e.doc.revision, document }); } }), $ = id => f.document.getElementById(id);
  $('palette-open').click(); assert.equal($('palette-results').children.length, 200); assert.match($('palette-status').textContent, /640 matching nodes/);
  $('palette-next').click(); assert.equal($('palette-results').children.length, 200);
  $('palette-next').click(); $('palette-next').click(); assert.equal($('palette-results').children.length, 40); assert.equal($('palette-next').disabled, true);
  let scans = 0, release; const originalFetch = f.window.fetch, held = new Promise(resolve => { release = resolve; });
  f.window.fetch = async (...args) => { const response = await originalFetch(...args); if (args[0] === 'api/search') { scans++; await held; } return response; };
  $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); await until(() => scans === 1, 'held search');
  f.type('palette-query', 'replacement'); await delay(300); $('palette-close').click(); release(); await delay(320);
  assert.equal(scans, 1); assert.equal($('palette-results').children.length, 0); await f.poll(); assert.equal(scans, 1);
  $('palette-open').click(); $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); $('palette-close').click(); await delay(300); assert.equal(scans, 1, 'close cancels debounce');
});

test('command palette shares faithful excerpts, source validation and one guarded successful activation', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id), original = f.explorer.activeKey;
  const doc = structuredClone(f.explorer.doc); doc.id = 'palette-exact-source'; doc.topic = doc.nodes[0].question = 'Destination';
  doc.nodes[1].answer = 'Context' + ' '.repeat(300) + 'TaRGeT <img src=x onerror=alert(1)>';
  const target = await f.explorer.library.import(doc); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Private preserved');
  $('palette-open').click(); $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); f.type('palette-query', 'target');
  await until(() => $('palette-results').firstChild, 'source found'); assert.match($('palette-results').textContent, /TaRGeT <img/); assert.equal($('palette-results').querySelector('img'), null);
  let stale = $('palette-results').firstChild; doc.nodes[1].answer += ' changed'; await writeFile(target.file, JSON.stringify(doc)); stale.click();
  await until(() => /search result changed/.test($('notice').textContent), 'source identity rejected'); assert.equal(f.explorer.activeKey, original); assert.equal($('answer').value, 'Private preserved');
  $('palette-refresh').click(); await until(() => $('palette-results').firstChild && $('palette-results').firstChild !== stale, 'refreshed exact source');
  const opens = f.actions.filter(a => a.action === 'open').length, row = $('palette-results').firstChild;
  row.focus(); paletteKey(f, row, { key: 'Enter', code: 'Enter', ctrlKey: false, shiftKey: false }); row.click();
  await until(() => f.explorer.activeKey === target.key && !$('palette-dialog').open, 'one deliberate navigation');
  assert.equal(f.actions.filter(a => a.action === 'open').length - opens, 1); assert.equal(f.window.__updates.scene().selected, doc.nodes[1].id);
  assert.equal($('answer').value, doc.nodes[1].answer);
});

for (const change of ['query', 'journey']) test(`command palette invalidates awaited navigation after ${change} changes`, async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id); await f.explorer.library.import(createDocument('Other destination'));
  const original = f.explorer.activeKey; f.open(f.explorer.doc.nodes[1].id);
  let release; const held = new Promise(resolve => { release = resolve; }); f.pauseDraftWrite(() => held); f.type('answer', 'Do not lose draft');
  $('palette-open').click(); $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); f.type('palette-query', 'Other destination');
  await until(() => $('palette-results').firstChild, 'destination found'); $('palette-results').firstChild.click();
  if (change === 'query') f.type('palette-query', 'Invalidated');
  else { const next = f.explorer.snapshot(); next.activeKey = 'replacement-identity'; f.window.__updates.apply(next); }
  release(); await until(() => !$('workspace').inert, 'flush finishes'); assert.equal(f.actions.filter(a => a.action === 'open').length, 0); assert.equal(f.explorer.activeKey, original);
  if (change === 'query') { $('palette-scope').value = 'current'; $('palette-scope').dispatchEvent(new f.window.Event('change')); f.type('palette-query', 'Show minimap'); $('palette-commands').firstChild.click(); assert.equal($('palette-dialog').open, false); assert.equal($('minimap').hidden, false); assert.equal($('answer').value, 'Do not lose draft'); }
  else assert.equal($('palette-dialog').open, false);
});

test('command palette respects missing directions, reminder conflicts and removed reminders without rebuilding controls', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id); await f.explorer.library.import(createDocument('Guarded destination'));
  const node = f.explorer.doc.nodes[1], original = f.explorer.activeKey; f.open(node.id); f.type('revisit-condition', 'Keep reminder'); f.type('manual-question', 'Keep direction');
  const reminder = $('revisit-condition'), manual = $('manual-question'), answer = $('answer');
  const edited = f.explorer.snapshot(); edited.document.nodes[1].revisit = { date: '2030-01-01', condition: 'Saved replacement', acknowledgedAt: null }; edited.document.revision++;
  f.window.__updates.apply(edited); const conflict = $('keep-revisit'); assert.ok(conflict && !conflict.hidden);
  $('palette-open').click(); $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); f.type('palette-query', 'Guarded destination');
  await until(() => $('palette-results').firstChild, 'guarded destination'); $('palette-results').firstChild.click(); assert.match($('notice').textContent, /missing-direction drafts/);
  $('palette-close').click(); assert.equal($('answer'), answer); assert.equal($('revisit-condition'), reminder); assert.equal($('manual-question'), manual); assert.equal($('keep-revisit'), conflict);
  f.type('manual-question', ''); $('palette-open').click(); $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); f.type('palette-query', 'Guarded destination');
  await until(() => $('palette-results').firstChild, 'reminder destination'); $('palette-results').firstChild.click(); assert.match($('notice').textContent, /reminder edits/); $('palette-close').click();
  const removed = structuredClone(edited); removed.document.nodes = removed.document.nodes.filter(n => n.id !== node.id); removed.document.revision++; f.window.__updates.apply(removed);
  $('palette-open').click(); $('palette-scope').value = 'library'; $('palette-scope').dispatchEvent(new f.window.Event('change')); f.type('palette-query', 'Guarded destination');
  await until(() => $('palette-results').firstChild, 'orphan destination'); $('palette-results').firstChild.click(); assert.match($('notice').textContent, /removed-question reminder drafts/);
  assert.equal(f.explorer.activeKey, original); assert.equal(f.actions.filter(a => a.action === 'open').length, 0);
});

test('combined Outline search is private by default and preserves editor and query across polling', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'PRIVATE_SEARCH_CANARY 🌱');
  const answer = $('answer'); answer.setSelectionRange(3, 7);
  $('outline-toggle').click();
  assert.ok($('outline-state'), 'combined saved-state filters are available');
  f.type('search', 'PRIVATE_SEARCH_CANARY');
  assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 0);
  $('outline-draft-text').click();
  assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 1);
  assert.match($('outline-list').textContent, /Private draft: PRIVATE_SEARCH_CANARY/);
  $('outline-drafts').click(); $('outline-state').value = 'decided'; $('outline-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 0, 'native select change reaches the delegated filter listener');
  $('outline-state').value = 'unanswered'; $('outline-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 1, 'state matches saved state, independent from tentative draft');
  $('search').focus(); const row = $('outline-list').firstChild; $('outline-list').scrollTop = 23;
  await f.poll(); await f.poll();
  assert.equal($('search').value, 'PRIVATE_SEARCH_CANARY'); assert.equal(f.document.activeElement, $('search'));
  assert.equal($('outline-list').firstChild, row); assert.equal($('outline-list').scrollTop, 23); assert.equal($('answer'), answer);
  $('outline-list').querySelector('[data-node-id]').click(); assert.equal($('answer'), answer); assert.equal(answer.value, 'PRIVATE_SEARCH_CANARY 🌱');
  $('outline-toggle').click(); $('outline-reset').click();
  assert.equal($('search').value, ''); assert.equal($('outline-draft-text').checked, false);
});

test('library node search uses one guarded open, preserves reminder drafts and rejects stale results', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id);
  const doc = structuredClone(f.explorer.doc); doc.id = 'destination-search'; doc.topic = doc.nodes[0].question = 'Search destination';
  const destination = await f.explorer.library.import(doc);
  f.open(f.explorer.doc.nodes[1].id); f.type('revisit-condition', 'Keep this reminder');
  $('library-toggle').click();
  assert.ok($('library-search-scope'), 'library node search is discoverable');
  $('library-search-scope').value = 'nodes'; $('library-search-scope').dispatchEvent(new f.window.Event('change'));
  f.type('library-search', 'Search destination');
  await until(() => $('library-search-results').querySelector('[data-node-id]'), 'bounded node matches');
  const button = $('library-search-results').querySelector('[data-node-id]'); button.click();
  assert.match($('notice').textContent, /reminder edits/); assert.notEqual(f.explorer.activeKey, destination.key);
  $('library-return').click(); $('reset-revisit').click(); $('library-toggle').click();
  await until(() => $('library-search-results').querySelector('[data-node-id]'), 'refreshed matches');
  const stale = $('library-search-results').querySelector('[data-node-id]');
  const changed = structuredClone(destination.document); changed.nodes[1].answer = 'External edit';
  await writeFile(destination.file, JSON.stringify(changed)); stale.click();
  await until(() => /search result changed/.test($('notice').textContent), 'stale source rejected');
  assert.notEqual(f.explorer.activeKey, destination.key);
  $('library-refresh').click();
  await until(() => { const row = $('library-search-results').querySelector('[data-node-id]'); return row && row !== stale; }, 'fresh search');
  const opens = f.actions.filter(a => a.action === 'open').length;
  $('library-search-results').querySelector('[data-node-id]').click();
  await until(() => f.explorer.activeKey === destination.key && $('welcome').hidden, 'search result opens');
  assert.equal(f.actions.filter(a => a.action === 'open').length - opens, 1);
});

test('search results cannot navigate after query changes during the awaited answer-draft flush', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id);
  const doc = createDocument('Delayed target'), target = await f.explorer.library.import(doc), original = f.explorer.activeKey;
  f.open(f.explorer.doc.nodes[1].id);
  let release; const held = new Promise(resolve => { release = resolve; }); f.pauseDraftWrite(() => held);
  f.type('answer', 'KEEP_DELAYED_DRAFT');
  $('library-toggle').click(); $('library-search-scope').value = 'nodes'; $('library-search-scope').dispatchEvent(new f.window.Event('change'));
  f.type('library-search', 'Delayed target');
  await until(() => $('library-search-results').querySelector('[data-node-id]'), 'delayed target found');
  $('library-search-results').querySelector('[data-node-id]').click(); f.type('library-search', 'Other query');
  release(); await until(() => !$('welcome').inert, 'draft flush completed');
  assert.equal(f.explorer.activeKey, original, 'invalidated search selection must not attach its old target after a delayed guard');
  assert.notEqual(f.explorer.activeKey, target.key);
  $('library-return').click(); assert.equal($('answer').value, 'KEEP_DELAYED_DRAFT');
});

test('long Outline search pages bound DOM and polling leaves hidden results untouched', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    const { document: doc } = makeFixture(fixtureSpecs.find(spec => spec.name === 'medium-wide')); await e.command('import', { revision: e.doc.revision, document: doc });
  } }), $ = id => f.document.getElementById(id);
  $('outline-toggle').click(); assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 200); assert.match($('outline-count').textContent, /640 matching nodes/);
  $('outline-next').click(); assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 200); assert.match($('outline-count').textContent, /201–400/);
  $('outline-next').click(); $('outline-next').click(); assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 40); assert.equal($('outline-next').disabled, true);
  const first = $('outline-list').firstChild; $('outline-toggle').click(); await f.poll(); assert.equal($('outline-list').firstChild, first);
});

test('library search discards delayed responses and does no node scans during repeated polling', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id), originalFetch = f.window.fetch;
  let release, first = true, scans = 0; const held = new Promise(resolve => { release = resolve; });
  f.window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (args[0] === 'api/search') { scans++; if (first) { first = false; await held; } }
    return response;
  };
  $('library-toggle').click(); $('library-search-scope').value = 'nodes'; $('library-search-scope').dispatchEvent(new f.window.Event('change'));
  await until(() => scans === 1, 'first search held'); f.type('library-search', 'ABSENT_QUERY'); release();
  await until(() => /0 matching nodes/.test($('library-search-status').textContent), 'only latest search renders');
  assert.equal($('library-search-results').children.length, 0);
  $('library-search').focus(); const count = scans; await f.poll(); await f.poll();
  assert.equal(scans, count); assert.equal($('library-search').value, 'ABSENT_QUERY'); assert.equal(f.document.activeElement, $('library-search'));
  f.type('library-search', 'Do not search after leaving'); $('library-return').click(); await delay(350);
  assert.equal(scans, count, 'leaving Library before its debounce expires must not start hidden file work');
});

test('minimap is optional, navigates without saving and preserves the expanded editor in narrow panes', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id), ui = f.window.__updates;
  assert.ok($('minimap-toggle'), 'discoverable minimap toggle');
  assert.equal($('minimap').hidden, true); assert.equal($('minimap-toggle').getAttribute('aria-expanded'), 'false');
  const asset = await fetch(new URL('minimap.mjs', f.window.location.href)); assert.equal(asset.status, 200);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Exact \u{1f331} draft'); f.type('revisit-condition', 'Keep reminder'); f.type('manual-question', 'Keep manual');
  const answer = $('answer'), reminder = $('revisit-condition'), saved = JSON.stringify(f.explorer.doc), actions = f.actions.length;
  answer.focus(); answer.setSelectionRange(2, 5); answer.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  $('minimap-toggle').click();
  assert.equal($('minimap').hidden, false); assert.equal($('minimap-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal($('map').contains($('minimap')), false, 'overview is outside editor viewport');
  const geometry = ui.scene().geometry, selected = ui.scene().selected, zoom = ui.scene().view.zoom;
  $('minimap-map').focus(); const before = ui.scene().view;
  $('minimap-map').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  assert.equal(ui.scene().view.x, before.x - 340 / 4); assert.equal(ui.scene().view.zoom, zoom); assert.equal(ui.scene().selected, selected); assert.equal(ui.scene().geometry, geometry);
  assert.equal($('answer'), answer); assert.equal($('revisit-condition'), reminder); assert.equal(answer.value, 'Exact \u{1f331} draft'); assert.equal(answer.selectionStart, 2); assert.equal(reminder.value, 'Keep reminder');
  answer.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  $('minimap-map').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal($('minimap').hidden, true); assert.equal(f.document.activeElement, $('minimap-toggle'));
  $('minimap-toggle').click(); f.resize(280, 460);
  assert.equal($('answer'), answer); assert.equal($('minimap').hidden, false);
  assert.equal(JSON.stringify(f.explorer.doc), saved); assert.deepEqual(f.actions.slice(actions), []);
  const css = await (await fetch(new URL('style.css', f.window.location.href))).text();
  assert.doesNotMatch(css, /#map-hint\s*\{\s*display\s*:\s*none/);
  assert.equal($('map').contains($('map-hint')), false, 'recovery guidance cannot overlay an editor');
  const style = f.document.createElement('style'); style.textContent = css; f.document.head.append(style);
  f.resize(280, 120); $('minimap-toggle').click();
  const section = $('map').parentElement;
  assert.equal(f.window.getComputedStyle(section).overflow, 'auto', 'hiding in a short pane retains a scroll owner for the editor and recovery controls');
  assert.equal(f.window.getComputedStyle($('map')).overflow, 'clip', 'map still owns canvas clipping');
  assert.equal(f.window.getComputedStyle($('node-workspace')).overflowY, 'auto', 'very short editor keeps a manually scrollable workspace');
  assert.equal(f.window.getComputedStyle(f.document.querySelector('.node-content')).overflow, 'visible', 'answer flows into the whole-card scroll area');
  assert.equal(f.window.getComputedStyle($('map')).minHeight, '120px');
  $('minimap-toggle').focus(); $('minimap-toggle').click(); assert.equal(f.window.getComputedStyle(section).overflow, 'auto');
  assert.equal(f.window.getComputedStyle($('minimap')).height, '96px'); assert.equal(f.window.getComputedStyle($('minimap-map')).height, '80px');
  ui.zoom(.00001); assert.equal($('map-hint').hidden, false); assert.notEqual(f.window.getComputedStyle($('map-hint')).display, 'none');
  assert.equal(f.window.getComputedStyle($('map-hint')).maxHeight, '40px');
  $('center-question').click(); $('answer').focus(); assert.equal($('answer'), answer); assert.equal(answer.value, 'Exact \u{1f331} draft');
});

function miniPointer(f, target, type, values = {}) {
  const event = new f.window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 71, isPrimary: true, button: 0, buttons: 1, clientX: 100, clientY: 760, ...values });
  target.dispatchEvent(event); return event;
}

function assertOverview(f) {
  const d = f.document, ui = f.window.__updates, scene = ui.scene(), svg = d.getElementById('minimap-map'), rect = svg.getBoundingClientRect();
  const projection = projectOverview(scene.geometry.bounds, rect.width, rect.height);
  const expected = overviewPaths(scene.positions, projection, scene.selected, new Set(), null);
  assert.equal(d.getElementById('minimap-nodes').getAttribute('d'), expected.nodes, 'overview projects every actual scene position');
  assert.equal(d.getElementById('minimap-selected').getAttribute('d'), expected.selected, 'selected marker uses actual editor dimensions');
  const viewport = projection.viewport(scene.view, d.getElementById('map').getBoundingClientRect());
  for (const [name, value] of Object.entries(viewport)) assert.equal(Number(d.getElementById('minimap-viewport').getAttribute(name)), value);
  assert.equal(svg.querySelectorAll('path').length, 4); assert.equal(svg.querySelectorAll('rect').length, 1); assert.equal(svg.querySelectorAll('[tabindex]').length, 0);
  return projection;
}

test('minimap pointer ownership acts once, cancels stale gestures and clamps through main map rules', async t => {
  const f = await fixture(t, 340), d = f.document, $ = id => d.getElementById(id), ui = f.window.__updates;
  $('minimap-toggle').click(); const svg = $('minimap-map');
  f.open(f.explorer.doc.nodes[1].id);
  const selected = ui.scene().selected, geometry = ui.scene().geometry, before = { ...ui.scene().view };
  miniPointer(f, svg, 'pointerdown'); assert.deepEqual({ ...ui.scene().view }, before, 'down only takes ownership');
  miniPointer(f, f.window, 'pointerup', { pointerId: 72 }); assert.deepEqual({ ...ui.scene().view }, before, 'another pointer cannot activate');
  miniPointer(f, f.window, 'pointerup'); const clicked = { ...ui.scene().view }; assert.notDeepEqual(clicked, before);
  svg.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true, detail: 1 })); assert.deepEqual({ ...ui.scene().view }, clicked, 'synthetic click after up is not a second action');
  assert.equal(ui.scene().geometry, geometry); assert.equal(ui.scene().selected, selected); assert.equal(ui.scene().expanded, true);
  for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'hide', 'resize', 'zoom', 'suspend']) {
    miniPointer(f, svg, 'pointerdown');
    if (reason === 'hide') { $('minimap-toggle').click(); $('minimap-toggle').click(); }
    else if (reason === 'resize') f.resize(280, 500);
    else if (reason === 'zoom') ui.zoom(.5);
    else if (reason === 'suspend') { const event = new f.window.Event('pagehide'); Object.defineProperty(event, 'persisted', { value: true }); f.window.dispatchEvent(event); }
    else miniPointer(f, reason === 'lostpointercapture' ? svg : f.window, reason);
    const stopped = { ...ui.scene().view };
    miniPointer(f, f.window, 'pointerup', { clientX: 15, clientY: 510 }); assert.deepEqual({ ...ui.scene().view }, stopped, `late up after ${reason} is inert`);
    if (reason === 'suspend') { const event = new f.window.Event('pageshow'); Object.defineProperty(event, 'persisted', { value: true }); f.window.dispatchEvent(event); }
  }
  miniPointer(f, svg, 'pointerdown'); miniPointer(f, f.window, 'pointermove', { clientX: -1e9, clientY: 1e9 });
  const dragged = { ...ui.scene().view }; miniPointer(f, f.window, 'pointerup', { clientX: 1e9, clientY: -1e9 }); assert.deepEqual({ ...ui.scene().view }, dragged, 'drag up does not add a recenter');
  const { bounds } = ui.scene().geometry, rect = $('map').getBoundingClientRect(), v = ui.scene().view;
  assert.ok(v.x + bounds.right * v.zoom >= Math.min(64, rect.width / 2, (bounds.right - bounds.left) * v.zoom) - 1e-7);
  assert.ok(v.y + bounds.top * v.zoom <= rect.height - Math.min(64, rect.height / 2, (bounds.bottom - bounds.top) * v.zoom) + 1e-7);
  assertOverview(f);
});

test('minimap reflects folds, focus, history removal and source reveal without losing drafts', async t => {
  const f = await fixture(t, 340, undefined, true, { before: async e => {
    await e.command('guidance', { revision: e.doc.revision, objective: 'breaks', successCriteria: '' });
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, category: 'Tools', question: 'Tool failures in winter?' });
  } }), d = f.document, $ = id => d.getElementById(id), ui = f.window.__updates;
  $('minimap-toggle').click(); assertOverview(f);
  const [root, first, target] = f.explorer.doc.nodes; f.open(first.id); f.type('answer', 'Keep answer'); f.type('revisit-condition', 'Keep reminder');
  const editor = $('answer'); $('branch-workspace').click(); assert.match($('minimap-status').textContent, /3 shown; 1 folded; whole map/); assert.ok($('minimap-folded').getAttribute('d')); assertOverview(f);
  $('focus-branch').click(); assert.match($('minimap-status').textContent, /2 shown; 1 folded; branch focus/); assert.ok($('minimap-focus').getAttribute('d')); assertOverview(f); assert.equal($('answer'), editor);
  $('suggest-next').click(); $('open-next-question').click(); assert.equal(ui.scene().selected, target.id); assert.match($('minimap-status').textContent, /whole map/); assertOverview(f);
  ui.select(first.id); assert.equal($('answer').value, 'Keep answer'); assert.equal($('revisit-condition').value, 'Keep reminder');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'draft before history removal');
  await f.explorer.command('add', { revision: f.explorer.doc.revision, nodeId: root.id, category: 'History', question: 'Temporary history question?' }); await f.poll();
  const temporary = f.explorer.doc.nodes.at(-1), revision = f.explorer.doc.revision;
  ui.select(temporary.id); f.type('revisit-condition', 'Removed reminder retained');
  await f.explorer.command('restore', { revision, journey: f.explorer.activeKey, snapshotRevision: revision - 1 }); await f.poll();
  assert.equal(ui.scene().positions.has(temporary.id), false); assertOverview(f);
  assert.equal($('orphan-drafts').querySelector('[data-orphan-reminder] textarea').value, 'Removed reminder retained');
  const oldPath = $('minimap-nodes').getAttribute('d');
  miniPointer(f, $('minimap-map'), 'pointerdown');
  const replacement = createDocument('Replacement'); replacement.nodes.push({ ...f.explorer.doc.nodes[1], id: 'new-question', parentId: replacement.rootId });
  ui.apply({ document: replacement, error: '', pending: null }, true);
  assert.equal($('minimap').hidden, false); assert.notEqual($('minimap-nodes').getAttribute('d'), oldPath); assertOverview(f);
  const after = { ...ui.scene().view }; miniPointer(f, f.window, 'pointerup'); assert.deepEqual({ ...ui.scene().view }, after, 'journey reset rejects old pointer');
});

test('minimap uses extreme actual editor geometry with constant DOM and no path rebuild on pan', async t => {
  const source = makeFixture(fixtureSpecs.find(spec => spec.name === 'near5000-wide')).document;
  const f = await fixture(t, 340, undefined, false, { before: e => { e.doc = structuredClone(source); } }), $ = id => f.document.getElementById(id), ui = f.window.__updates;
  $('minimap-toggle').click(); assertOverview(f);
  const initialZoom = ui.scene().view.zoom; ui.select('node-4949'); const answer = $('answer');
  ui.zoom(.00000001); assert.equal(ui.scene().view.zoom, initialZoom); assert.ok(ui.scene().positions.get('node-4949').width > 308); assertOverview(f);
  const geometry = ui.scene().geometry, mutations = [];
  const observer = new f.window.MutationObserver(records => mutations.push(...records)); observer.observe($('minimap-map'), { attributes: true, subtree: true, childList: true });
  $('minimap-map').focus();
  for (let i = 0; i < 10; i++) $('minimap-map').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: i % 2 ? 'ArrowRight' : 'ArrowLeft', bubbles: true }));
  mutations.push(...observer.takeRecords()); observer.disconnect();
  assert.equal(ui.scene().geometry, geometry); assert.equal($('answer'), answer);
  assert.equal(mutations.filter(m => m.attributeName === 'd').length, 0, 'ten pans rebuild zero overview paths');
  assert.equal(mutations.filter(m => m.type === 'childList').length, 0, 'ten pans create zero overview DOM');
  assert.equal(mutations.filter(m => m.target.id === 'minimap-viewport').length, 40, 'only four viewport attributes per pan');
  for (const zoom of [.1, 1, 3]) { ui.zoom(zoom / ui.scene().view.zoom); assertOverview(f); assert.equal($('answer'), answer); }
  $('fit').click(); assert.equal(ui.scene().expanded, false); assertOverview(f); assert.equal(ui.scene().view.zoom, initialZoom);
  $('outline-toggle').click(); f.type('search', 'Question 4949:'); f.document.querySelector('#outline-list [data-node-id="node-4949"]').click(); assert.equal($('answer'), answer); assert.equal($('minimap').hidden, true); $('outline-toggle').click(); assertOverview(f);
  $('minimap-toggle').click(); assert.equal($('minimap-nodes').getAttribute('d'), '');
  $('minimap-toggle').click(); assertOverview(f);
  f.resize(280, 420); f.observers.get('minimap-map')(); assertOverview(f); assert.equal($('answer'), answer);
});

test('minimap focus cancels voice and rejects a late transcript while passive updates retain ownership', async t => {
  const voice = voiceFixture(); let recording;
  voice.start = id => { recording = id; return { id, phase: 'listening' }; };
  voice.poll = () => ({ id: recording, phase: voice.counts().cancels ? 'done' : 'listening', text: 'late words must not insert' });
  const f = await fixture(t, 340, voice), $ = id => f.document.getElementById(id), ui = f.window.__updates;
  $('minimap-toggle').click(); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep exact draft');
  const answer = $('answer'); answer.focus(); await until(() => !$('voice-record').disabled, 'voice ready'); $('voice-record').click(); await until(() => !$('voice-stop').disabled, 'listening');
  const counts = voice.counts(); ui.zoom(.5); ui.refresh(); assertOverview(f); assert.deepEqual(voice.counts(), counts, 'passive overview refresh does not cancel');
  $('minimap-map').focus(); await until(() => voice.counts().cancels === 1, 'overview focus cancels'); await delay(250);
  assert.equal($('answer'), answer); assert.equal(answer.value, 'Keep exact draft'); assert.equal(f.explorer.doc.nodes[1].answer, '');
});

async function until(read, label, attempts = 250) {
  for (let i = 0; i < attempts; i++) { const result = read(); if (result) return result; await delay(10); }
  assert.fail('Timed out: ' + label);
}

test('project storage controls create and explicitly reopen a repository journey with a relative location', async t => {
  const project = await mkdtemp(join(tmpdir(), 'explorer-project-controls-')); t.after(() => rm(project, { recursive: true, force: true }));
  await promisify(execFile)('git', ['-C', project, 'init', '-q'], { windowsHide: true });
  const f = await fixture(t, 340, undefined, true, { projectRoot: async () => project }), $ = id => f.document.getElementById(id);
  const personalKey = f.explorer.activeKey;
  $('library-toggle').click();
  assert.equal($('start-storage').value, 'personal');
  $('start-storage').value = 'project'; $('start-storage').dispatchEvent(new f.window.Event('change'));
  assert.equal($('project-folder-fields').hidden, false);
  f.type('topic', 'Project journey'); f.type('project-folder', 'decisions/maps');
  $('start-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => $('journey-storage').textContent.includes('Project: decisions/maps/'), 'project creation response rendered');
  const path = f.explorer.snapshot().storage.path;
  assert.match($('journey-storage').textContent, /Project.*decisions\/maps/);
  assert.ok(!$('journey-storage').textContent.includes(project)); assert.match($('journey-storage').textContent, /Git/);
  await f.explorer.command('cancel');
  await f.explorer.command('open', { revision: f.explorer.doc.revision, key: personalKey }); await f.poll();
  $('project-open').click(); assert.equal(f.document.activeElement, $('project-open-path'));
  f.type('project-open-path', path); $('project-open-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !$('workspace').hidden && $('journey-storage').textContent.includes('Project: decisions/maps/'), 'project reopening response rendered');
  assert.equal(f.explorer.doc.topic, 'Project journey');
  assert.equal($('workspace').hidden, false); assert.match($('journey-storage').textContent, /Project/);
});
test('project library refresh and pin preserve an answer draft, and listed opening uses the current canvas', async t => {
  const project = await mkdtemp(join(tmpdir(), 'explorer-project-list-ui-')); t.after(() => rm(project, { recursive: true, force: true }));
  await promisify(execFile)('git', ['-C', project, 'init', '-q'], { windowsHide: true });
  const f = await fixture(t, 340, undefined, true, { projectRoot: async () => project, before: async e => { await e.projectRepository.create(createDocument('Shared from teammate')); } });
  const $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'Keep my personal draft'); const editor = $('answer');
  $('library-toggle').click(); $('library-scope').value = 'project'; $('library-scope').dispatchEvent(new f.window.Event('change'));
  await until(() => $('project-library-list').querySelector('[data-action="open"]'), 'shared listing');
  assert.match($('project-library-status').textContent, /direct shared files/); assert.match($('project-library-list').textContent, /Shared from teammate/);
  $('project-library-list').querySelector('[data-action="pin"]').focus(); $('project-library-list').querySelector('[data-action="pin"]').click();
  await until(() => $('project-library-list').querySelector('[data-action="pin"]')?.textContent === 'Unpin', 'private pin');
  assert.equal(f.document.activeElement, $('project-library-list').querySelector('[data-action="pin"]'));
  $('library-return').click(); assert.equal($('answer'), editor); assert.equal(editor.value, 'Keep my personal draft');
  $('library-toggle').click(); $('library-scope').value = 'project'; $('library-scope').dispatchEvent(new f.window.Event('change'));
  await until(() => $('project-library-list').querySelector('[data-action="open"]') && !$('project-library-refresh').disabled, 'fresh project listing');
  $('project-library-list').querySelector('[data-action="open"]').click();
  await until(() => !$('workspace').hidden && $('map-title').textContent === 'Shared from teammate', 'listed opening response rendered');
  assert.equal(f.explorer.pending, null); assert.equal($('workspace').hidden, false);
});

test('reviewed project copy shows exact content, excludes drafts, saves once and continues only by choice', async t => {
  const project = await mkdtemp(join(tmpdir(), 'explorer-copy-ui-')); t.after(() => rm(project, { recursive: true, force: true }));
  await promisify(execFile)('git', ['-C', project, 'init', '-q'], { windowsHide: true });
  const f = await fixture(t, 340, undefined, true, { projectRoot: async () => project }), $ = id => f.document.getElementById(id);
  const key = f.explorer.activeKey, file = f.explorer.file, original = await readFile(file), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'PRIVATE draft must stay here'); const editor = $('answer');
  assert.equal($('project-copy-open').hidden, false); $('project-copy-open').click();
  $('project-copy-preview').click(); await until(() => !$('project-copy-confirm').hidden && !$('project-copy-confirm').disabled, 'copy preview');
  assert.equal(f.document.activeElement, $('project-copy-content')); assert.ok(!$('project-copy-content').value.includes('PRIVATE draft'));
  const content = $('project-copy-content').value, path = f.explorer.projectCopy.selection.selected.relativePath;
  $('project-copy-confirm').click(); await until(() => !$('project-copy-continue').hidden, 'copy saved');
  assert.equal(f.explorer.activeKey, key); assert.equal($('answer'), editor); assert.equal(editor.value, 'PRIVATE draft must stay here');
  assert.equal(await readFile(join(project, path), 'utf8'), content); assert.deepEqual(await readFile(file), original);
  $('project-copy-continue').click(); await until(() => !$('project-copy-dialog').open && f.explorer.snapshot().storage.scope === 'project', 'explicit continue');
  assert.equal(f.explorer.pending, null); assert.equal($('project-copy-open').hidden, true);
  assert.deepEqual((await f.explorer.readDrafts(f.explorer.activeKey)).entries, []);
  await f.explorer.command('open', { key, revision: f.explorer.doc.revision }); await f.poll();
  assert.equal((await f.explorer.readDrafts(key)).entries[0].text, 'PRIVATE draft must stay here');
  $('project-copy-open').click(); $('project-copy-preview').click(); await until(() => !$('project-copy-confirm').hidden && !$('project-copy-confirm').disabled, 'existing preview');
  assert.match($('project-copy-status').textContent, /Identical copy/);
  f.type('project-copy-folder', 'changed'); assert.equal($('project-copy-confirm').hidden, true); assert.equal($('project-copy-content').value, '');
  $('project-copy-close').click(); assert.equal(f.document.activeElement, $('project-copy-open'));
  const denied = await fetch(new URL('api/project-copy', f.window.location.href), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: '{}' }); assert.equal(denied.status, 403);
});

test('Git status refresh separates private drafts from file and Git state without replacing editors or pending work', async t => {
  const project = await mkdtemp(join(tmpdir(), 'explorer-git-ui-')); t.after(() => rm(project, { recursive: true, force: true }));
  await promisify(execFile)('git', ['-C', project, 'init', '-q'], { windowsHide: true });
  const f = await fixture(t, 340, undefined, true, { projectRoot: async () => project, before: async e => {
    const store = await e.projectRepository.create(e.doc); await e.command('open-project', { revision: e.doc.revision, path: store.context.relativePath });
  } }), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', '  Private draft 日本語  '); const editor = $('answer'); editor.focus(); editor.setSelectionRange(2, 8);
  await f.explorer.command('questions', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.rootId }); const pending = f.explorer.pending.id;
  assert.equal($('project-git-panel').hidden, false); $('project-git-panel').open = true; $('project-git-refresh').click();
  await until(() => $('project-git-result').textContent.includes('Untracked'), 'Git status returned');
  assert.match($('project-editor-status').textContent, /Private.*not in the project file/); assert.match($('project-git-result').textContent, /Saved file matches/);
  assert.match($('project-git-result').textContent, /Remote freshness is unknown/); assert.equal(f.explorer.pending.id, pending);
  assert.equal($('answer'), editor); assert.equal(editor.value, '  Private draft 日本語  '); assert.equal(editor.selectionStart, 2); assert.equal(editor.selectionEnd, 8); assert.equal(f.document.activeElement, editor);
  assert.ok(!$('project-git-result').textContent.includes(project));
  const denied = await fetch(new URL('api/project-git-status', f.window.location.href), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: '{}' }); assert.equal(denied.status, 403);
  await f.explorer.command('cancel');
  await promisify(execFile)('git', ['-C', project, 'symbolic-ref', 'HEAD', 'refs/heads/status-other'], { windowsHide: true });
  f.explorer.projectObservedAt = 0; await f.poll(); assert.ok(f.explorer.projectChange);
  assert.match($('project-git-result').textContent, /Refresh to inspect/);
  $('project-change-review').click(); await until(() => !$('project-reconcile-reload').hidden, 'same-byte branch preview'); $('project-reconcile-reload').click();
  await until(() => !$('project-reconcile-dialog').open, 'same-byte branch reload');
  assert.match($('project-git-result').textContent, /Refresh to inspect/); assert.equal($('answer'), editor); assert.equal(editor.value, '  Private draft 日本語  ');
});

test('project merge requires candidate review and acknowledgment, saves through history and preserves private drafts', async t => {
  const project = await mkdtemp(join(tmpdir(), 'explorer-merge-ui-')); t.after(() => rm(project, { recursive: true, force: true }));
  const git = (...args) => promisify(execFile)('git', ['-C', project, ...args], { windowsHide: true });
  await git('init', '-qb', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
  const f = await fixture(t, 340, undefined, true, { projectRoot: async () => project, before: async e => {
    const store = await e.projectRepository.create(e.doc); await git('add', '.'); await git('commit', '-qm', 'Base'); await git('switch', '-qc', 'incoming');
    const incoming = JSON.parse(await readFile(store.context.file)); incoming.journey.nodes[1].answer = 'Incoming decision';
    await writeFile(store.context.file, JSON.stringify(incoming)); await git('add', '.'); await git('commit', '-qm', 'Incoming'); await git('switch', '-q', 'main');
    await e.command('open-project', { revision: e.doc.revision, path: store.context.relativePath });
    await e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, answer: 'Local decision', answerState: 'tentative' });
  } }), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  assert.ok($('project-merge-open'), 'project merge entry is available');
  f.open(node.id); f.type('answer', '  Private draft 日本語  '); const editor = $('answer'); editor.focus(); editor.setSelectionRange(3, 8);
  $('project-merge-open').click(); f.type('project-merge-ref', 'incoming'); $('project-merge-preview').click();
  await until(() => $('project-merge-conflict').options.length === 1, 'merge conflict preview', 2000);
  assert.match($('project-merge-local').value, /Local decision/); assert.match($('project-merge-incoming').value, /Incoming decision/);
  assert.equal($('project-merge-save').disabled, true); $('project-merge-choice').value = 'incoming'; $('project-merge-choice').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  $('project-merge-resolve').click(); await until(() => $('project-merge-result').value.includes('Incoming decision'), 'resolved merge preview', 2000);
  assert.equal($('project-merge-save').disabled, true); $('project-merge-ack').checked = true; $('project-merge-ack').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.equal($('project-merge-save').disabled, false); $('project-merge-save').click();
  await until(() => !$('project-merge-dialog').open && f.explorer.doc.nodes[1].answer === 'Incoming decision', 'merge saved', 2000);
  assert.equal($('answer'), editor); assert.equal(editor.value, '  Private draft 日本語  ');
  const draft = (await f.explorer.readDrafts(f.explorer.activeKey)).entries.find(entry => entry.nodeId === node.id); assert.equal(draft.text, editor.value); assert.equal(draft.base, draftBase(node)); assert.equal(draft.stale, true);
  const denied = await fetch(new URL('api/project-merge', f.window.location.href), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: '{}' }); assert.equal(denied.status, 403);
});

test('project reconciliation reload keeps exact draft text and source bases while preserving incoming bytes', async t => {
  const project = await mkdtemp(join(tmpdir(), 'explorer-reconcile-ui-')); t.after(() => rm(project, { recursive: true, force: true }));
  await promisify(execFile)('git', ['-C', project, 'init', '-q'], { windowsHide: true });
  const f = await fixture(t, 340, undefined, true, { projectRoot: async () => project, before: async e => {
    const store = await e.projectRepository.create(e.doc); await e.command('open-project', { revision: e.doc.revision, path: store.context.relativePath });
  } }), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1], key = f.explorer.activeKey;
  f.open(node.id); f.type('answer', '  Keep my unsent 日本語 draft  '); const editor = $('answer');
  const incoming = JSON.parse(await readFile(f.explorer.file)); incoming.journey.nodes[1].answer = 'Teammate answer'; const text = JSON.stringify(incoming);
  await writeFile(f.explorer.file, text); f.explorer.projectObservedAt = 0; await f.poll();
  assert.equal($('project-change').hidden, false); assert.equal($('answer'), editor); assert.equal(editor.value, '  Keep my unsent 日本語 draft  ');
  $('project-change-review').click(); await until(() => !$('project-reconcile-reload').hidden, 'reconciliation preview');
  assert.equal($('project-reconcile-content').value, text); $('project-reconcile-reload').click();
  await until(() => !$('project-reconcile-dialog').open && f.explorer.doc.nodes[1].answer === 'Teammate answer', 'reconciliation reload');
  assert.equal($('project-change').hidden, true); assert.equal($('answer'), editor); assert.equal(editor.value, '  Keep my unsent 日本語 draft  ');
  const record = (await f.explorer.readDrafts(key)).entries.find(entry => entry.nodeId === node.id);
  assert.equal(record.text, '  Keep my unsent 日本語 draft  '); assert.equal(record.stale, true); assert.equal(await readFile(f.explorer.file, 'utf8'), text);
  const removed = JSON.parse(text); removed.journey.nodes = removed.journey.nodes.filter(item => item.id !== node.id);
  await writeFile(f.explorer.file, JSON.stringify(removed)); f.explorer.projectObservedAt = 0; await f.poll();
  $('project-change-review').click(); await until(() => !$('project-reconcile-reload').hidden, 'removed-node preview'); $('project-reconcile-reload').click();
  await until(() => !$('project-reconcile-dialog').open && !f.explorer.doc.nodes.some(item => item.id === node.id), 'removed-node reload');
  const orphan = (await f.explorer.readDrafts(key)).entries.find(entry => entry.nodeId === node.id); assert.equal(orphan.orphaned, true); assert.equal(orphan.text, record.text);
  const denied = await fetch(new URL('api/project-reconciliation', f.window.location.href), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: '{}' }); assert.equal(denied.status, 403);
});

test('closing or suspending a merge preview rejects late responses and keeps the current draft', async t => {
  const project = await mkdtemp(join(tmpdir(), 'explorer-merge-late-')); t.after(() => rm(project, { recursive: true, force: true }));
  await promisify(execFile)('git', ['-C', project, 'init', '-q'], { windowsHide: true });
  const f = await fixture(t, 340, undefined, true, { projectRoot: async () => project, before: async e => {
    const store = await e.projectRepository.create(e.doc); await e.command('open-project', { revision: e.doc.revision, path: store.context.relativePath });
  } }), $ = id => f.document.getElementById(id);
  const content = JSON.stringify(f.explorer.projectStore.shared), reply = { id: 'preview', plan: { token: 'token', conflicts: [], unresolved: [], affected: [], content }, sources: { local: content, incoming: content, base: content } };
  let release; f.explorer.projectMergeRequest = input => input.action === 'preview' ? new Promise(resolve => { release = () => resolve(reply); }) : Promise.resolve({ status: 'cancelled' });
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep private draft'); const editor = $('answer');
  $('project-merge-open').click(); f.type('project-merge-ref', 'incoming'); $('project-merge-preview').click(); await until(() => release, 'preview held');
  $('project-merge-dialog').dispatchEvent(new f.window.Event('cancel', { cancelable: true })); assert.equal(f.document.activeElement, $('project-merge-open'));
  release(); await delay(60); assert.equal($('project-merge-dialog').open, false); assert.equal($('project-merge-result').value, '');
  release = null; $('project-merge-open').click(); $('project-merge-preview').click(); await until(() => release, 'second preview held');
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pagehide', { persisted: true })); release(); await delay(60);
  assert.equal($('project-merge-dialog').open, false); assert.equal($('project-merge-result').value, ''); assert.equal($('answer'), editor); assert.equal(editor.value, 'Keep private draft');
});

async function startReviewedResearch(f) {
  await until(() => !f.document.getElementById('research-review-start').disabled, 'review ready');
  f.document.getElementById('research-review-start').click();
}

test('next question is optional, opens a folded source and preserves independent drafts without model work', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.command('guidance', { revision: e.doc.revision, objective: 'Understand tool failures', successCriteria: '' });
  } }), $ = id => f.document.getElementById(id);
  const [root, first, target] = f.explorer.doc.nodes;
  let modelCalls = 0;
  f.explorer.send = async () => { modelCalls++; };
  f.explorer.researcher.run = async () => { modelCalls++; throw Error('Unexpected helper'); };
  const asset = await fetch(new URL('next-question.mjs', f.window.location.href));
  assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /javascript/);
  f.open(first.id); f.type('answer', 'Uncommitted answer'); f.type('revisit-condition', 'Uncommitted reminder'); f.type('manual-question', 'Uncommitted direction');
  $('focus-branch').click();
  assert.ok($('suggest-next'), 'optional next-question action exists');
  assert.equal($('next-question').hidden, true);
  const before = JSON.stringify(f.explorer.doc), actions = f.actions.length;
  $('suggest-next').click();
  assert.equal($('node-workspace').dataset.nodeId, first.id, 'suggesting does not navigate');
  assert.match($('next-question').textContent, /What if a tool breaks/);
  assert.match($('next-question').textContent, /literal|word/i);
  $('open-next-question').click();
  assert.equal($('node-workspace').dataset.nodeId, target.id);
  assert.equal(f.document.activeElement.id, 'expanded-title');
  assert.equal($('show-whole-map').hidden, true, 'explicit source link exits unrelated focus');
  f.open(first.id);
  assert.equal($('answer').value, 'Uncommitted answer'); assert.equal($('revisit-condition').value, 'Uncommitted reminder'); assert.equal($('manual-question').value, 'Uncommitted direction');
  f.open(root.id); $('branch-workspace').click(); $('open-next-question').click();
  assert.equal($('node-workspace').dataset.nodeId, target.id, 'source link reveals folded ancestors');
  $('dismiss-next-question').click();
  assert.equal($('open-next-question'), null);
  await f.poll(); assert.equal($('open-next-question'), null, 'poll does not replace a dismissed suggestion');
  $('suggest-next').click(); assert.equal($('open-next-question'), null, 'same source remains dismissed');
  assert.match($('next-question').textContent, /dismissed/i);
  assert.equal(JSON.stringify(f.explorer.doc), before); assert.deepEqual(f.actions.slice(actions), []); assert.equal(f.explorer.pending, null); assert.equal(modelCalls, 0);
});

test('next question refresh drops stale sources, preserves orphan drafts and renders historical text safely', async t => {
  const f = await fixture(t, 340, undefined, false, { questions: [
    { question: 'Tool ownership?', category: 'Scope', importance: 'high', importanceReason: '<script>Historical consequence</script>', rationale: 'Original uncertainty' },
    { question: 'Other question?', category: 'Scope' },
  ] }), $ = id => f.document.getElementById(id), target = f.explorer.doc.nodes[1];
  $('suggest-next').click(); assert.match($('next-question').textContent, /Save an objective/); assert.equal($('open-next-question'), null);
  await f.explorer.command('guidance', { revision: f.explorer.doc.revision, objective: 'Tool ownership', successCriteria: '' }); await f.poll();
  assert.ok($('open-next-question')); assert.match($('next-question').textContent, /Historical consequence/); assert.match($('next-question').textContent, /Original uncertainty/); assert.equal($('next-question').querySelector('script'), null);
  $('dismiss-next-question').click();
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.nodes[2].id, answer: 'Unrelated', answerState: 'tentative' }); await f.poll();
  $('suggest-next').click(); assert.equal($('open-next-question'), null); assert.match($('next-question').textContent, /dismissed/);
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: target.id, answer: 'Changed source', answerState: 'tentative' }); await f.poll(); assert.ok($('open-next-question'));
  const reviewed = structuredClone(f.explorer.doc); reviewed.nodes[1].review = true; await f.explorer.command('import', { revision: f.explorer.doc.revision, document: reviewed }); await f.poll();
  assert.equal($('open-next-question'), null); assert.match($('next-question').textContent, /1 need source review/);
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: target.id, answer: 'Changed source', answerState: 'tentative' }); await f.poll();
  $('open-next-question').click(); f.type('answer', 'Keep removed answer'); f.type('revisit-condition', 'Keep removed reminder');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'answer draft saved before removal');
  const removed = structuredClone(f.explorer.doc); removed.nodes = removed.nodes.filter(n => n.id !== target.id);
  await f.explorer.command('import', { revision: f.explorer.doc.revision, document: removed }); await f.poll();
  await until(() => !$('open-next-question'), 'removed source no longer actionable'); assert.match($('next-question').textContent, /No eligible question/);
  assert.match($('draft-summary').textContent, /draft/i);
  assert.equal($('orphan-drafts').querySelector('[data-orphan-reminder] textarea').value, 'Keep removed reminder');
  assert.match($('orphan-drafts').textContent, /Tool ownership/);
});

test('next question dismissal survives reopening the same journey but clears on page reload', async t => {
  const f = await fixture(t, 340, undefined, true, { before: e => e.command('guidance', { revision: e.doc.revision, objective: 'Tool reliability', successCriteria: '' }) }), $ = id => f.document.getElementById(id);
  $('suggest-next').click(); $('dismiss-next-question').click();
  const key = f.explorer.activeKey;
  $('library-toggle').click();
  await until(() => f.document.querySelector(`[data-key="${key}"] [data-action="open"]`), 'current journey in Library');
  f.document.querySelector(`[data-key="${key}"] [data-action="open"]`).click();
  await until(() => $('welcome').hidden, 'same journey reopened');
  $('suggest-next').click(); assert.equal($('open-next-question'), null); assert.match($('next-question').textContent, /dismissed/);
  const reloaded = await fixture(t, 340, undefined, true, { explorer: f.explorer });
  reloaded.document.getElementById('suggest-next').click(); assert.ok(reloaded.document.getElementById('open-next-question'));
});

test('revisit UI saves independently, preserves answer and reminder drafts, and provides filtered archived source navigation', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'UNCOMMITTED ANSWER 🌱'); const answer = $('answer'); answer.focus(); answer.setSelectionRange(3, 7);
  assert.ok($('revisit-date'), 'question offers a date-only reminder');
  f.type('revisit-date', '2026-11-17'); f.type('revisit-condition', '  Manual <script>condition</script> 🌱\n');
  $('revisit-condition').focus(); $('revisit-condition').setSelectionRange(2, 8);
  await f.explorer.command('guidance', { revision: f.explorer.doc.revision, objective: 'Another saved change', successCriteria: '' }); await f.poll();
  assert.equal($('revisit-condition').value, '  Manual <script>condition</script> 🌱\n'); assert.equal(f.document.activeElement, $('revisit-condition')); assert.equal($('revisit-condition').selectionStart, 2);
  $('save-revisit').click(); await until(() => f.explorer.doc.nodes[1].revisit, 'saved reminder'); await until(() => $('revisit-status').textContent.includes('Manual condition'), 'rendered reminder');
  assert.equal($('answer'), answer); assert.equal(answer.value, 'UNCOMMITTED ANSWER 🌱'); assert.equal(f.explorer.doc.nodes[1].answer, '');
  assert.equal($('node-workspace').querySelector('script'), null);
  $('acknowledge-revisit').focus(); $('acknowledge-revisit').click(); await until(() => f.explorer.doc.nodes[1].revisit.acknowledgedAt, 'acknowledged');
  await until(() => $('save-revisit').textContent.includes('reactivate'), 'reactivate label'); assert.equal(f.document.activeElement.id, 'acknowledge-revisit');
  $('save-revisit').click(); await until(() => f.explorer.doc.nodes[1].revisit.acknowledgedAt === null && $('revisit-status').textContent.includes('Manual condition'), 'reactivated');
  $('outline-toggle').click(); $('revisit-filter').value = 'manual-condition'; $('revisit-filter').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 1); $('outline-list').querySelector('[data-node-id]').click(); assert.equal($('node-workspace').dataset.nodeId, node.id);
  $('library-toggle').click(); await until(() => f.document.querySelector('[data-action="revisit"]'), 'library reminder');
  $('library-reminder').value = 'manual-condition'; $('library-reminder').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await until(() => f.document.querySelector('.library-reminders').textContent.includes('1'), 'library counts');
  f.document.querySelector('[data-action="archive"]').click(); await until(() => !f.document.querySelector('.library-entry'), 'archived');
  $('library-archived').checked = true; $('library-archived').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await until(() => f.document.querySelector('[data-action="revisit"]'), 'archived reminder access'); f.document.querySelector('[data-action="revisit"]').click();
  await until(() => !$('node-workspace').hidden && $('node-workspace').dataset.nodeId === node.id && $('welcome').hidden, 'source opened');
  assert.equal((await f.explorer.library.list({ archived: true })).entries.length, 1); assert.equal($('answer').value, 'UNCOMMITTED ANSWER 🌱');
  $('clear-revisit').click(); await until(() => !f.explorer.doc.nodes[1].revisit && $('revisit-status').textContent === 'No reminder saved.', 'cleared'); assert.equal($('answer').value, 'UNCOMMITTED ANSWER 🌱');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'answer draft persisted');
  assert.deepEqual(f.actions.filter(a => ['questions', 'research', 'answer'].includes(a.action)), []);
});

test('revisit UI refreshes local-day statuses on unchanged polls and retains conflicts without silent rebase', async t => {
  const f = await fixture(t, 340, undefined, true, { before: e => e.command('set-revisit', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, date: '2026-11-17', condition: '' }) }), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.window.localDate = () => '2026-11-17'; f.open(node.id); await f.poll(); assert.match($('revisit-status').textContent, /Due today/);
  const revision = f.explorer.doc.revision; f.type('answer', 'Remain a draft'); $('answer').focus(); $('answer').setSelectionRange(2, 5);
  f.window.localDate = () => '2026-11-18'; await f.poll(); assert.match($('revisit-status').textContent, /Overdue/); assert.equal(f.explorer.doc.revision, revision); assert.equal(f.document.activeElement.id, 'answer'); assert.equal($('answer').selectionStart, 2);
  f.type('revisit-condition', 'MY REMINDER EDIT'); $('revisit-condition').focus(); $('revisit-condition').setSelectionRange(3, 6);
  await f.explorer.command('set-revisit', { revision, nodeId: node.id, date: '2026-11-19', condition: 'OTHER SAVED CONDITION' }); await f.poll();
  assert.equal($('revisit-condition').value, 'MY REMINDER EDIT'); assert.equal($('revisit-condition').selectionStart, 3); assert.match($('revisit-conflict').textContent, /changed/); assert.equal($('save-revisit').disabled, true);
  $('keep-revisit').click(); $('save-revisit').click(); await until(() => f.explorer.doc.nodes[1].revisit.condition === 'MY REMINDER EDIT', 'explicit reminder overwrite');
  assert.equal($('answer').value, 'Remain a draft'); assert.equal(f.explorer.doc.nodes[1].answer, '');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'answer draft persisted');
});

test('revisit UI untouched save preserves imported CRLF condition bytes and creates no revision', async t => {
  const condition = '  Exact 🌱\r\ncondition\r\n';
  const f = await fixture(t, 340, undefined, false, { before: e => e.command('set-revisit', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, date: '2026-11-17', condition }) }), $ = id => f.document.getElementById(id);
  const before = structuredClone(f.explorer.doc); f.open(before.nodes[1].id); $('save-revisit').click();
  await until(() => $('notice').textContent.includes('Reminder saved'), 'unchanged save');
  assert.deepEqual(f.explorer.doc, before);
  f.type('revisit-date', '2026-11-18'); $('save-revisit').click();
  await until(() => f.explorer.doc.nodes[1].revisit.date === '2026-11-18' && $('reset-revisit').hidden, 'date rescheduled');
  assert.equal(f.explorer.doc.nodes[1].revisit.condition, condition);
});

test('orphan revisit drafts survive external History removal until explicit discard permits restore and switching', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id);
  const originalKey = f.explorer.activeKey, priorRevision = f.explorer.doc.revision;
  const destination = await f.explorer.library.import(createDocument('Another reminder journey'));
  await f.explorer.command('add', { revision: priorRevision, nodeId: f.explorer.doc.rootId, question: 'Temporary reminder question', category: 'Review' });
  await f.poll(); const node = f.explorer.doc.nodes.at(-1), addedRevision = f.explorer.doc.revision;
  f.open(node.id); f.type('revisit-date', '2026-12-20'); f.type('revisit-condition', '  KEEP THIS <script>REMINDER</script> 🌱\n');
  const other = await new Explorer({ library: f.explorer.library, binding: 'orphan-reminder-test' }).load(); t.after(() => other.close());
  await other.attach(originalKey);
  await other.command('restore', { revision: other.doc.revision, journey: other.activeKey, snapshotRevision: priorRevision });
  $('history-open').click(); $('history-refresh').click();
  await until(() => !f.explorer.doc.nodes.some(n => n.id === node.id) && !$('revisit-condition'), 'external restore refreshed through HTTP');
  $('history-close').click();
  const orphan = $('orphan-drafts').querySelector('[data-orphan-reminder]');
  assert.ok(orphan, 'removed reminder has a reachable recovery area');
  assert.match(orphan.textContent, /Temporary reminder question/); assert.match(orphan.textContent, /2026-12-20/);
  const retained = orphan.querySelector('textarea'); assert.equal(retained.value, '  KEEP THIS <script>REMINDER</script> 🌱\n'); assert.equal(retained.readOnly, true); assert.equal(orphan.querySelector('script'), null);
  retained.focus(); retained.setSelectionRange(2, 6); await f.poll(); assert.equal(retained.isConnected, true); assert.equal(f.document.activeElement, retained); assert.equal(retained.selectionStart, 2);
  $('library-toggle').click(); await until(() => f.document.querySelector(`[data-key="${destination.key}"] [data-action="open"]`), 'library target');
  f.document.querySelector(`[data-key="${destination.key}"] [data-action="open"]`).click(); assert.equal(f.explorer.activeKey, originalKey); assert.match($('notice').textContent, /removed-question reminder/);
  $('review-orphan-reminders').click(); assert.equal($('welcome').hidden, true); assert.equal(f.document.activeElement, retained); assert.equal(retained.value, '  KEEP THIS <script>REMINDER</script> 🌱\n');
  $('history-open').click(); await until(() => f.document.querySelector(`[data-history-revision="${addedRevision}"]`), 'restore removed source');
  f.document.querySelector(`[data-history-revision="${addedRevision}"]`).click(); await until(() => !$('history-restore').disabled, 'restoration preview');
  $('history-restore').click(); assert.match($('history-status').textContent, /removed-question reminder/); assert.equal(f.explorer.doc.nodes.some(n => n.id === node.id), false);
  $('review-orphan-reminders-history').click(); assert.equal($('history-dialog').open, false); assert.equal(f.document.activeElement, retained);
  orphan.querySelector('button').click(); assert.equal($('orphan-drafts').querySelector('[data-orphan-reminder]'), null); assert.equal(f.document.activeElement.id, 'map');
  $('history-open').click(); await until(() => f.document.querySelector(`[data-history-revision="${addedRevision}"]`), 'source history after discard');
  f.document.querySelector(`[data-history-revision="${addedRevision}"]`).click(); await until(() => !$('history-restore').disabled, 'restoration after discard'); $('history-restore').click();
  await until(() => !$('history-dialog').open && f.explorer.doc.nodes.some(n => n.id === node.id), 'restore permitted');
  $('library-toggle').click(); await until(() => f.document.querySelector(`[data-key="${destination.key}"] [data-action="open"]`), 'switch target after discard');
  f.document.querySelector(`[data-key="${destination.key}"] [data-action="open"]`).click(); await until(() => f.explorer.activeKey === destination.key && $('welcome').hidden, 'switch permitted');
});

test('visual export UI explicitly captures full or selected scope despite folding/focus and excludes answer drafts', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, category: 'People', question: 'Folded child?' });
  } }), $ = id => f.document.getElementById(id);
  const node = f.explorer.doc.nodes[1]; f.open(node.id); f.type('answer', 'VISUAL_DRAFT_CANARY');
  $('focus-branch').click();
  f.document.querySelector(`[data-branch-id="${node.id}"]`).click();
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${f.explorer.doc.nodes[3].id}"]`), null);
  let downloaded;
  f.window.URL.createObjectURL = blob => { downloaded = blob; return 'blob:export-fixture'; };
  f.window.URL.revokeObjectURL = () => {};
  f.window.HTMLAnchorElement.prototype.click = function () {};
  assert.ok($('visual-export-open'), 'map exports are available before finishing');
  $('visual-export-open').click(); assert.equal($('export-dialog').open, true);
  assert.equal($('visual-export-scope').value, 'whole');
  $('visual-export-format').value = 'canvas'; $('visual-export-download').click();
  await until(() => downloaded, 'whole map download');
  let value = JSON.parse(await downloaded.text()); assert.equal(value.nodes.length, 4); assert.ok(!JSON.stringify(value).includes('VISUAL_DRAFT_CANARY'));
  downloaded = null; $('visual-export-scope').value = 'branch'; $('visual-export-download').click();
  await until(() => downloaded, 'branch download'); value = JSON.parse(await downloaded.text()); assert.equal(value.nodes.length, 2); assert.match(value.nodes[0].text, /Who should borrow first\\\?/); assert.match(value.nodes[1].text, /Folded child/);
  assert.ok(!$('export-dialog').textContent.includes('download saved'));
  $('close-export').click(); assert.equal($('answer').value, 'VISUAL_DRAFT_CANARY');
  $('visual-export-open').click();
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: node.id, answer: 'Changed saved revision' });
  downloaded = null; $('visual-export-download').click();
  await until(() => /changed|Reopen/.test($('visual-export-status').textContent), 'stale captured revision'); assert.equal(downloaded, null);
  assert.deepEqual(f.actions.filter(a => a.action === 'finish'), []);
});

test('offline viewer UI requires a fresh exact preview, defaults private fields off and discards stale responses', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => { const doc = structuredClone(e.doc); doc.nodes[1].research = structuredClone(findings); await e.command('import', { revision: e.doc.revision, document: doc }); } }), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'VIEWER_DRAFT_CANARY');
  let downloaded;
  f.window.URL.createObjectURL = blob => { downloaded = blob; return 'blob:viewer-fixture'; }; f.window.URL.revokeObjectURL = () => {}; f.window.HTMLAnchorElement.prototype.click = function () {};
  $('visual-export-open').click(); assert.ok($('viewer-preview'), 'viewer export has a separate explicit preview');
  assert.equal($('viewer-download').disabled, true);
  const rows = [...$('viewer-selection').querySelectorAll('fieldset')]; assert.equal(rows.length, 3);
  for (const row of rows) for (const field of ['node', 'answer', 'research']) assert.equal(row.querySelector(`[data-field="${field}"]`).checked, false);
  const select = (field, checked = true) => { const control = rows[1].querySelector(`[data-field="${field}"]`); control.checked = checked; control.dispatchEvent(new f.window.Event('change', { bubbles: true })); };
  select('node'); select('research'); $('viewer-preview').click();
  await until(() => !$('viewer-download').disabled, 'viewer preview');
  assert.match($('viewer-preview-content').textContent, /Two possible ways forward/); assert.ok(!$('viewer-preview-content').textContent.includes('VIEWER_DRAFT_CANARY'));
  assert.equal($('viewer-preview-content').querySelector('script,iframe'), null);
  $('viewer-download').click(); await until(() => downloaded, 'viewer file'); assert.ok(!(await downloaded.text()).includes('VIEWER_DRAFT_CANARY'));
  downloaded = null; select('answer'); assert.equal($('viewer-download').disabled, true); assert.equal($('viewer-preview-content').textContent, '');
  const original = f.window.fetch; let release;
  f.window.fetch = async (path, options) => { const response = await original(path, options); if (path === 'api/viewer-export') return new Promise(resolve => { release = () => resolve(response); }); return response; };
  $('viewer-preview').click(); await until(() => release, 'held preview'); select('research', false); release();
  await delay(30); assert.equal($('viewer-download').disabled, true); assert.equal($('viewer-preview-content').textContent, '');
  f.window.fetch = original; $('viewer-preview').click(); await until(() => !$('viewer-download').disabled, 'refreshed preview');
  release = null; f.window.fetch = async (path, options) => { const response = await original(path, options); if (path === 'api/viewer-export') return new Promise(resolve => { release = () => resolve(response); }); return response; };
  $('viewer-download').click(); await until(() => release, 'held download'); $('close-export').click(); release(); await delay(30); assert.equal(downloaded, null);
  assert.equal($('answer').value, 'VIEWER_DRAFT_CANARY');
  f.window.fetch = original; $('visual-export-open').click();
  const node = $('viewer-selection').querySelectorAll('[data-field="node"]')[1]; node.checked = true; node.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  $('viewer-preview').click(); await until(() => !$('viewer-download').disabled, 'second fresh preview');
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.nodes[1].id, answer: 'Changed saved answer' });
  $('viewer-download').click(); await until(() => /changed|Reopen/.test($('viewer-status').textContent), 'stale saved version'); assert.equal(downloaded, null); assert.equal($('viewer-download').disabled, true);
  await f.poll(); $('close-export').click(); $('visual-export-open').click();
  const freshNode = $('viewer-selection').querySelectorAll('[data-field="node"]')[1]; freshNode.checked = true; freshNode.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  $('viewer-preview').click(); await until(() => !$('viewer-download').disabled, 'preview before poll update');
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.nodes[1].id, answer: 'Another saved version' });
  await f.poll(); assert.equal($('viewer-download').disabled, true, 'a published state update invalidates the preview immediately'); assert.equal($('viewer-preview-content').textContent, '');
  $('close-export').click(); $('visual-export-open').click();
  const restoredNode = $('viewer-selection').querySelectorAll('[data-field="node"]')[1]; restoredNode.checked = true; restoredNode.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  $('viewer-preview').click(); await until(() => !$('viewer-download').disabled, 'preview before page suspension');
  release = null; f.window.fetch = async (path, options) => { const response = await original(path, options); if (path === 'api/viewer-export') return new Promise(resolve => { release = () => resolve(response); }); return response; };
  $('viewer-download').click(); await until(() => release, 'download before page suspension');
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pagehide', { persisted: true }));
  f.window.dispatchEvent(new f.window.PageTransitionEvent('pageshow', { persisted: true })); release(); await delay(30);
  assert.equal(downloaded, null, 'a response from before page suspension cannot trigger a download after restore');
  assert.equal($('viewer-download').disabled, true);
});

test('option comparison preserves exact duplicate values, unknowns, subjective priorities and draft-only actions', async t => {
  const r = structuredClone(findings);
  r.options[0].details = [{ label: 'Cost', value: 'Lower <script>🌿</script>' }, { label: 'Cost', value: 'Setup extra' }, { label: 'Speed', value: 'Slower' }];
  r.options[1].details = [{ label: 'Speed', value: 'Faster' }, { label: 'cost', value: 'Different label' }];
  const f = await fixture(t, 340, undefined, false, { before: async e => { const doc = structuredClone(e.doc); doc.nodes[1].research = r; await e.command('import', { revision: e.doc.revision, document: doc }); } });
  const $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1]; f.open(node.id);
  const summary = $('comparison-summary'); assert.ok(summary); summary.focus(); summary.click(); assert.equal($('option-comparison').open, true);
  const table = $('comparison-table'); assert.equal(table.querySelectorAll('thead th[scope=col]').length, 3);
  assert.equal(table.querySelectorAll('tbody th[scope=row]').length, 6, 'three built-ins and three exact labels');
  assert.match(table.textContent, /Lower <script>🌿<\/script>/); assert.match(table.textContent, /Setup extra/); assert.equal(table.querySelector('script'), null);
  assert.match(table.textContent, /Unknown/); assert.match(table.textContent, /Model judgment/); assert.match(table.textContent, /Cell source support unknown/);
  assert.equal(table.querySelectorAll('a').length, 0, 'no invented evidence relation');
  assert.equal(table.parentElement.tabIndex, 0); assert.equal(table.parentElement.getAttribute('role'), 'region');
  const answer = $('answer'), question = $('followup-question'); f.type('answer', 'My words'); f.type('followup-question', 'Keep this question');
  $('answer-state').value = 'assumption'; $('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  const priority = $('comparison-priority-4'); priority.focus(); priority.value = 'high'; priority.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  const arrow = new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }); priority.dispatchEvent(arrow); assert.equal(arrow.defaultPrevented, false, 'native select keys are not intercepted by the canvas');
  assert.match(table.querySelector('tbody th').textContent, /Speed.*High/); assert.equal(f.document.activeElement, priority);
  assert.equal($('answer'), answer); assert.equal($('followup-question'), question); assert.equal(question.value, 'Keep this question');
  $('comparison-detail-0-0').click(); assert.equal($('detail-0-0').checked, true);
  $('comparison-detail-0-0').focus(); const space = new f.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }); $('comparison-detail-0-0').dispatchEvent(space); assert.equal(space.defaultPrevented, false, 'native checkbox keys remain available');
  $('comparison-add-details').click(); assert.equal(answer.value, 'My words\n\nCost: Lower <script>🌿</script>');
  assert.equal($('answer-state').value, 'assumption'); assert.equal(f.explorer.doc.nodes[1].answer, '');
  $('undo-addition').click(); assert.equal(answer.value, 'My words');
  $('detail-0-1').click(); assert.equal($('comparison-detail-0-1').checked, true);
  $('comparison-criterion-4').click(); assert.equal(table.querySelectorAll('tbody th').length, 5);
  priority.focus(); await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.nodes[2].id, answer: 'Unrelated' }); await f.poll();
  assert.equal($('comparison-priority-4'), priority); assert.equal(f.document.activeElement, priority); assert.equal(priority.value, 'high');
  assert.equal($('comparison-criterion-4').checked, false); assert.equal($('detail-0-1').checked, true);
  f.open(f.explorer.doc.nodes[2].id); f.open(node.id); assert.equal($('comparison-priority-4').value, 'high'); assert.equal($('option-comparison').open, true);
  assert.equal($('comparison-criterion-4').checked, false); assert.equal($('comparison-detail-0-1').checked, true);
  assert.equal(f.explorer.pending, null); assert.equal(f.actions.filter(a => ['research', 'research-follow-up'].includes(a.action)).length, 0);
});

test('option comparison bounds all 35 criteria, renders complete values and rejects malformed replacement', async t => {
  const r = structuredClone(findings);
  r.options = Array.from({ length: 4 }, (_, i) => ({ ...r.options[0], title: `Option ${i}`, details: Array.from({ length: 8 }, (_, j) => ({ label: `${i}-${j}<img>中文`.padEnd(80, 'x'), value: `${i}-${j}🌿<script>`.padEnd(1000, '文') })) }));
  const f = await fixture(t, 340, undefined, false, { before: async e => { const doc = structuredClone(e.doc); doc.nodes[1].research = r; await e.command('import', { revision: e.doc.revision, document: doc }); } });
  f.open(f.explorer.doc.nodes[1].id); const $ = id => f.document.getElementById(id), table = $('comparison-table');
  assert.equal(table.querySelectorAll('thead th').length, 5); assert.equal(table.querySelectorAll('tbody tr').length, 35);
  assert.equal(table.querySelectorAll('input').length, 32); assert.equal(table.querySelector('img,script'), null);
  assert.equal($('comparison-detail-3-7').nextSibling.textContent, r.options[3].details[7].value);
  for (const checkbox of f.document.querySelectorAll('.comparison-controls input')) checkbox.click();
  assert.match(table.textContent, /Select at least one criterion/); $('comparison-criterion-34').click();
  const invalid = structuredClone(f.explorer.doc); invalid.nodes[1].research.options[0].details.push({ label: 'ninth', value: 'invalid' });
  await assert.rejects(f.explorer.command('import', { revision: f.explorer.doc.revision, document: invalid }), /detail/i);
  await f.poll(); assert.equal($('comparison-table'), table); assert.equal(table.querySelectorAll('tbody th').length, 1);
  assert.equal(f.explorer.doc.nodes[1].research.options[0].details.length, 8);
});

test('option comparison resets on observed research replacement even off-node and on panel reload', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => { const doc = structuredClone(e.doc); doc.nodes[1].research = findings; await e.command('import', { revision: e.doc.revision, document: doc }); } });
  const node = f.explorer.doc.nodes[1], $ = id => f.document.getElementById(id); f.open(node.id);
  const priority = $('comparison-priority-0'); assert.ok(priority); priority.value = 'high'; priority.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  const original = structuredClone(f.explorer.doc); f.open(f.explorer.doc.nodes[2].id);
  const changed = structuredClone(original); changed.nodes[1].research.sources = [{ title: 'New source', url: 'https://example.com/new' }];
  await f.explorer.command('import', { revision: f.explorer.doc.revision, document: changed }); await f.poll();
  await f.explorer.command('import', { revision: f.explorer.doc.revision, document: original }); await f.poll();
  f.open(node.id); assert.equal($('comparison-priority-0').value, 'normal');
  $('comparison-priority-0').value = 'low'; $('comparison-priority-0').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  const reloaded = await fixture(t, 340, undefined, false, { explorer: f.explorer }); reloaded.open(node.id);
  assert.equal(reloaded.document.getElementById('comparison-priority-0').value, 'normal');
  assert.equal(reloaded.document.getElementById('comparison-table').querySelectorAll('tbody tr').length, 3, 'no-details legacy research still compares judgments');
  const css = await readFile(new URL('../com.github.copilot/extensions/explorer/web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.comparison-scroll\s*\{[^}]*overflow-x:\s*auto/);
});

test('research follow-up keeps typing and focus during polling, renders prior evidence and retains node-scoped history on navigation', async t => {
  let finish;
  const f = await fixture(t, 340, undefined, false, { before: async e => { const doc = structuredClone(e.doc); doc.nodes[1].research = findings; await e.command('import', { revision: e.doc.revision, document: doc }); }, runFollowup: () => new Promise(resolve => { finish = resolve; }) });
  const node = f.explorer.doc.nodes[1]; f.open(node.id);
  const question = f.document.getElementById('followup-question'); assert.ok(question);
  question.value = 'What if <script>cost</script> doubles?'; question.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.document.getElementById('followup-hypothetical').click(); f.document.getElementById('followup-review').click();
  await until(() => !f.document.getElementById('research-review-start').disabled, 'follow-up review');
  assert.match(f.document.getElementById('research-review-prompt').textContent, /What if <script>cost<\/script> doubles/);
  await startReviewedResearch(f); await until(() => finish, 'follow-up started');
  question.value = 'Next question 🌿'; question.dispatchEvent(new f.window.Event('input', { bubbles: true })); question.focus(); question.setSelectionRange(2, 5);
  const answer = f.document.getElementById('answer'); answer.value = 'Uncommitted answer'; answer.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  finish({ answer: 'Consider a pilot <script>literal</script>', uncertainty: 'Hypothetical', claims: [{ id: 'c1', text: 'Prior reasoning', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Prior paraphrase' }], limitations: 'Old evidence' }], sources: [{ id: 's1', title: 'Prior source', url: 'https://example.com/prior', retrievedAt: '2020-01-01T00:00:00.000Z', provenance: 'imported', evidenceOrigin: { origin: 'original', sourceId: 's1' } }] });
  await until(() => f.document.getElementById('followup-history').textContent.includes('Consider a pilot'), 'follow-up result');
  assert.equal(f.document.getElementById('followup-question'), question); assert.equal(question.value, 'Next question 🌿'); assert.equal(f.document.activeElement, question); assert.equal(question.selectionStart, 2);
  assert.equal(f.document.getElementById('answer'), answer); assert.equal(answer.value, 'Uncommitted answer'); assert.equal(f.explorer.doc.nodes[1].answer, '');
  const history = f.document.getElementById('followup-history'); assert.equal(history.querySelector('script'), null); assert.match(history.textContent, /Prior evidence/); assert.match(history.textContent, /2020-01-01/);
  const historyResult = history.firstChild, priority = f.document.getElementById('comparison-priority-0'); priority.value = 'high'; priority.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.equal(history.firstChild, historyResult); assert.equal(f.document.getElementById('followup-question'), question); assert.equal(f.document.getElementById('answer'), answer);
  const link = history.querySelector('a'); assert.equal(link.href, 'https://example.com/prior'); assert.equal(link.rel, 'noopener noreferrer');
  f.open(f.explorer.doc.nodes[2].id); f.open(node.id); assert.match(f.document.getElementById('followup-history').textContent, /Consider a pilot/); assert.equal(f.document.getElementById('followup-question').value, 'Next question 🌿');
});

test('follow-up panel reload reconnects to one pending operation and history without adopting old-page polling', async t => {
  let finish, runs = 0;
  const f = await fixture(t, 340, undefined, false, { before: async e => { const doc = structuredClone(e.doc); doc.nodes[1].research = findings; await e.command('import', { revision: e.doc.revision, document: doc }); }, runFollowup: () => { runs++; return new Promise(resolve => { finish = resolve; }); } });
  const id = f.explorer.doc.nodes[1].id; f.open(id); f.type('followup-question', 'Why this?'); f.document.getElementById('followup-review').click(); await startReviewedResearch(f); await until(() => finish, 'started');
  let release, arrived; const held = new Promise(resolve => { release = resolve; }), pending = new Promise(resolve => { arrived = resolve; });
  f.pauseState(async () => { arrived(); await held; }); const oldPoll = f.poll(); await pending;
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  const reloaded = await fixture(t, 340, undefined, false, { explorer: f.explorer }); reloaded.open(id);
  assert.equal(reloaded.document.getElementById('followup-question').value, ''); assert.equal(runs, 1); assert.ok(reloaded.document.getElementById('cancel-request'));
  finish({ answer: 'One completed follow-up', uncertainty: 'No external evidence', sources: [], claims: [{ id: 'c1', text: 'Reasoning', basis: 'reasoning', evidence: [], limitations: 'Fixture' }] });
  await until(() => reloaded.document.getElementById('followup-history').textContent.includes('One completed'), 'reconnected result');
  release(); await oldPoll; assert.equal(runs, 1); assert.equal(f.document.getElementById('followup-history').textContent.includes('One completed'), false);
  assert.equal(reloaded.explorer.followup.exchanges.length, 1);
});

test('claim evidence disclosure shows literal support, source navigation and imported provenance beside the claim', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    const doc = structuredClone(e.doc);
    doc.nodes[1].research = { ...findings, basis: 'sources', sources: [{ id: 's1', title: '<img src=x onerror=alert(1)>', url: 'https://example.com/source?q=1', retrievedAt: '2026-11-17T12:00:00.000Z', provenance: 'recorded-read' }], claims: [
      { id: 'c1', text: '<script>Claim</script>', basis: 'sources', evidence: [{ sourceId: 's1', paraphrase: 'Source paraphrase <script>plain</script>' }], limitations: 'Applies only in the source setting.' },
      { id: 'c2', text: 'Personal judgment', basis: 'reasoning', evidence: [], limitations: 'No external support.' },
      { id: 'c3', text: 'Unknown local costs', basis: 'unknown', evidence: [], limitations: 'No data.' },
    ] };
    await e.command('import', { revision: e.doc.revision, document: doc });
  } });
  f.open(f.explorer.doc.nodes[1].id);
  const claim = f.document.getElementById('claim-c1'); assert.ok(claim);
  assert.match(claim.textContent, /<script>Claim<\/script>/); assert.equal(claim.querySelector('script'), null);
  const disclosure = claim.querySelector('details'); assert.ok(disclosure); assert.equal(disclosure.open, false);
  const summary = disclosure.querySelector('summary'); summary.focus(); assert.equal(f.document.activeElement, summary); summary.click(); assert.equal(disclosure.open, true);
  assert.match(disclosure.textContent, /Source paraphrase/); assert.match(disclosure.textContent, /Imported read metadata; not observed by this installation/); assert.match(disclosure.textContent, /2026-11-17T12:00:00.000Z/);
  const link = disclosure.querySelector('a'); assert.equal(link.href, 'https://example.com/source?q=1'); assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer'); assert.equal(link.querySelector('img'), null);
  assert.equal(f.document.getElementById('comparison-table').querySelector('a'), null); assert.match(f.document.getElementById('comparison-table').textContent, /Cell source support unknown/);
  assert.match(f.document.getElementById('claim-c2').textContent, /Model reasoning/); assert.match(f.document.getElementById('claim-c3').textContent, /Unknown support/);
  assert.match(f.document.querySelector('.research').textContent, /Selected model assertions/);
  const savedAnswer = f.explorer.doc.nodes[1].answer; f.document.getElementById('use-recommendation').click();
  assert.equal(f.document.getElementById('answer').value, findings.recommendation); assert.equal(f.explorer.doc.nodes[1].answer, savedAnswer);
  f.open(f.explorer.doc.nodes[2].id); f.open(f.explorer.doc.nodes[1].id); assert.ok(f.document.getElementById('claim-c1'));
});

async function fixture(t, width = 1100, voice = { status: async () => ({ ready: false, error: 'Voice test fixture disabled.' }), close() {} }, useLibrary = false, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'explorer-dom-'));
  let resolveResearch;
  let explorer = options.explorer ?? await new Explorer({ file: join(dir, 'map.explore.json'), ...(useLibrary ? { library: new Library(dir), binding: 'dom' } : {}), send: async () => {}, target: { instanceId: 'dom-test' },
    cleaner: options.cleaner, briefHelper: options.briefHelper, checkHelper: options.checkHelper, projectRoot: options.projectRoot,
    questionHelper: options.questionHelper,
    researcher: { runFollowup: options.runFollowup, run: (_, { signal }) => new Promise((resolve, reject) => { resolveResearch = resolve; signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }); }) },
  }).load();
  if (!options.explorer) {
  await explorer.command('start', { topic: 'A tool library' });
  await explorer.receive('questions', { requestId: explorer.pending.id, questions: options.questions ?? [
    { category: 'People', question: 'Who should borrow first?' }, { category: 'Trust', question: 'What if a tool breaks?' },
  ] });
  if (!options.preview) await explorer.command('accept-questions', { revision: explorer.doc.revision, batchId: explorer.preview.id, selected: explorer.preview.questions.map((q, index) => ({ index, question: q.question })) });
  }
  await options.before?.(explorer);
  if (options.cold) { await explorer.close(); explorer = await new Explorer({ library: new Library(dir), binding: 'dom' }).load(); }
  const server = await startServer(explorer, voice);
  const dom = new JSDOM(await (await fetch(server.url)).text(), { url: server.url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, document = window.document;
  const exportDialog = document.getElementById('export-dialog');
  exportDialog.showModal = () => { exportDialog.open = true; };
  exportDialog.close = () => { exportDialog.open = false; };
  const storageDialog = document.getElementById('storage-dialog');
  const copyDialog = document.getElementById('project-copy-dialog');
  const reconcileDialog = document.getElementById('project-reconcile-dialog');
  const mergeDialog = document.getElementById('project-merge-dialog');
  mergeDialog.showModal = () => { mergeDialog.open = true; };
  mergeDialog.close = () => { mergeDialog.open = false; };
  reconcileDialog.showModal = () => { reconcileDialog.open = true; };
  reconcileDialog.close = () => { reconcileDialog.open = false; };
  copyDialog.showModal = () => { copyDialog.open = true; };
  copyDialog.close = () => { copyDialog.open = false; };
  storageDialog.showModal = () => { storageDialog.open = true; };
  storageDialog.close = () => { storageDialog.open = false; };
  const dashboardDialog = document.getElementById('dashboard-dialog');
  dashboardDialog.showModal = () => { dashboardDialog.open = true; };
  dashboardDialog.close = () => { dashboardDialog.open = false; };
  const scriptErrors = []; window.addEventListener('error', event => scriptErrors.push(event.error));
  const briefDialog = document.getElementById('brief-dialog');
  briefDialog.showModal = () => { briefDialog.open = true; };
  briefDialog.close = () => { briefDialog.open = false; };
  const checkDialog = document.getElementById('check-dialog');
  checkDialog.showModal = () => { checkDialog.open = true; };
  checkDialog.close = () => { checkDialog.open = false; };
  const guidanceDialog = document.getElementById('guidance-dialog');
  guidanceDialog.showModal = () => { guidanceDialog.open = true; };
  guidanceDialog.close = () => { guidanceDialog.open = false; };
  const historyDialog = document.getElementById('history-dialog');
  historyDialog.showModal = () => { historyDialog.open = true; };
  historyDialog.close = () => { historyDialog.open = false; };
  const recoveryDialog = document.getElementById('recovery-dialog');
  if (recoveryDialog) { recoveryDialog.showModal = () => { recoveryDialog.open = true; }; recoveryDialog.close = () => { recoveryDialog.open = false; }; }
  const diagnosticsDialog = document.getElementById('diagnostics-dialog');
  if (diagnosticsDialog) { diagnosticsDialog.showModal = () => { diagnosticsDialog.open = true; }; diagnosticsDialog.close = () => { diagnosticsDialog.open = false; }; }
  const reviewDialog = document.getElementById('research-review-dialog');
  if (reviewDialog) { reviewDialog.showModal = () => { reviewDialog.open = true; }; reviewDialog.close = () => { reviewDialog.open = false; }; }
  const navigationDialog = document.getElementById('navigation-dialog');
  navigationDialog.showModal = () => { navigationDialog.open = true; };
  navigationDialog.close = () => { navigationDialog.open = false; };
  const paletteDialog = document.getElementById('palette-dialog');
  if (paletteDialog) { paletteDialog.showModal = () => { paletteDialog.open = true; }; paletteDialog.close = () => { paletteDialog.open = false; }; }
  const requests = new Set(), actions = [];
  t.after(async () => {
    window.dispatchEvent(new window.Event('pagehide'));
    await Promise.allSettled([...requests]); await delay(0);
    dom.window.close(); await server.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true });
    assert.deepEqual(scriptErrors, [], 'no uncaught app event errors');
  });
  const map = document.getElementById('map');
  // jsdom has no visual layout. Only geometry inputs are stubbed; DOM events,
  // the shipped app, HTTP server, controller, persistence and callbacks are real.
  let height = 720, workspaceHeight = 540;
  map.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height });
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetWidth: { get() { return parseFloat(this.style.width) || (this.id === 'map' ? width : 220); } },
    offsetHeight: { get() { return this.id === 'node-workspace' ? Math.min(workspaceHeight, parseFloat(this.style.maxHeight) || 540) : 110; } },
  });
  let captures = 0, holdAnswer = null, holdState = null, holdAdd = null, holdDraftRead = options.holdDraftRead, holdDraftWrite = null, holdHistory = null, holdNavigationRead = null, holdReferencesRead = options.holdReferencesRead, holdVoiceCancel = options.holdVoiceCancel, holdVoicePoll;
  const captured = new Set(), observers = new Map();
  map.setPointerCapture = id => { captures++; captured.add(id); };
  map.hasPointerCapture = id => captured.has(id);
  map.releasePointerCapture = id => captured.delete(id);
  window.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe(element) { observers.set(element.id, this.callback); } disconnect() { for (const [id, fn] of observers) if (fn === this.callback) observers.delete(id); } };
  const motionListeners = new Set(), motionMedia = { matches: true, addEventListener: (_, fn) => motionListeners.add(fn) };
  window.matchMedia = () => motionMedia;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve() });
  window.AbortController = AbortController; // The fixture uses Node fetch, which requires its own AbortSignal brand.
  window.fetch = (path, options) => {
    if (path === 'api/action' && options?.body) actions.push(JSON.parse(options.body));
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
      return new Response(response.status === 204 ? null : body, { status: response.status, headers: response.headers });
    })();
    requests.add(request); request.then(() => requests.delete(request), () => requests.delete(request));
    return request;
  };
  Object.assign(window, { GeometryCache, viewportBounds, intersects });
  Object.defineProperty(document, 'fonts', { value: new window.EventTarget() });
  window.layout = layout;
  window.branchView = branchView;
  window.revealPath = revealPath;
  window.attachVoice = attachVoice;
  window.DraftClient = DraftClient;
  window.CleanupClient = CleanupClient;
  window.QuestionHelpClient = QuestionHelpClient;
  window.ResearchReviewClient = ResearchReviewClient;
  window.researchSettingsText = researchSettingsText;
  window.attachDashboard = attachDashboard; window.attachNavigation = attachNavigation; window.attachMinimap = attachMinimap;
  const mini = document.getElementById('minimap-map');
  mini.getBoundingClientRect = () => ({ left: 12, top: height + 8, width: Math.min(180, (width - 24) * .4), height: 80 });
  mini.setPointerCapture = id => captured.add(id); mini.hasPointerCapture = id => captured.has(id); mini.releasePointerCapture = id => captured.delete(id);
  Object.assign(window, { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus, MODES, effectiveMode });
  Object.assign(window, { localDate, REVISIT_FILTERS, revisitStatuses, revisitMatches });
  window.NextQuestion = NextQuestion;
  Object.assign(window, { searchFilters, matchSearch, SEARCH_PAGE_SIZE });
  options.beforeApp?.(window);
  const script = (await readFile(new URL('../com.github.copilot/extensions/explorer/web/app.mjs', import.meta.url), 'utf8')).replace('void poll();', 'window.__updates = { workspace: renderWorkspace, zoom, fit, scene: () => ({ detail: typeof detailTier === "undefined" ? null : detailTier, positions, geometry: typeof geometryCache === "undefined" ? null : geometryCache.value, view: { ...view }, selected, expanded }), setView: next => { view = { ...next }; refreshScene(null); }, reveal: revealNode, select, refresh: refreshScene, apply, poll: () => { clearTimeout(pollTimer); return poll(); } }; void poll();');
  window.eval(script.replace("import { attachDashboard } from './dashboard.mjs';", '').replace("import { searchFilters, matchSearch, SEARCH_PAGE_SIZE } from './search.mjs';", '').replace("import { attachMinimap } from './minimap.mjs';", '').replace("import { NextQuestion } from './next-question.mjs';", '').replace("import { localDate, REVISIT_FILTERS, revisitStatuses, revisitMatches } from './revisit.mjs';", '').replace("import { researchSettingsText } from './research-policy.mjs';", '').replace("import { ResearchReviewClient } from './research-review-client.mjs';", '').replace("import { layout, branchView, revealPath } from './layout.mjs';", '').replace("import { CleanupClient } from './cleanup.mjs';", '').replace("import { QuestionHelpClient } from './question-help-client.mjs';", '').replace("import { GeometryCache, viewportBounds, intersects, branchView, revealPath } from './layout.mjs';", '').replace("import { attachVoice } from './voice.mjs';", '').replace("import { DraftClient } from './drafts.mjs';", '').replace("import { attachNavigation } from './navigation.mjs';", '').replace("import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus } from './answer-state.mjs';", '').replace("import { effectiveMode, MODES } from './modes.mjs';", ''));
  await until(() => options.cold ? document.getElementById('notice').textContent : width && !options.preview ? document.querySelectorAll('#nodes button').length >= 3 : document.getElementById('map-title').textContent, 'initial map');
  const open = id => {
    const question = explorer.doc.nodes.find(n => n.id === id).question;
    const button = [...document.querySelectorAll('#nodes button')].find(b => b.title === question);
    assert.ok(button, 'compact node exists: ' + question); button.click();
  };
  const type = (id, value) => { const e = document.getElementById(id); assert.ok(e, id); e.value = value; e.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const click = text => { const b = [...document.querySelectorAll('#node-workspace button, #question-drawer button')].find(e => (e.getAttribute('aria-label') ?? e.textContent) === text || e.textContent === text); assert.ok(b, text); b.click(); };
  return { explorer, window, document, open, type, click, actions, observers, resizeWorkspace: value => { workspaceHeight = value; observers.get('node-workspace')(); }, poll: () => window.__updates.poll(), resolveResearch: value => resolveResearch(value), captures: () => captures, motion: value => { motionMedia.matches = value; for (const fn of motionListeners) fn(); }, pauseAnswer: fn => { holdAnswer = fn; },
    resize: (w, h = height) => { width = w; height = h; observers.get('map')(); }, pauseState: fn => { holdState = fn; }, pauseAdd: fn => { holdAdd = fn; },
    pauseHistory: fn => { holdHistory = fn; }, pauseDraftRead: fn => { holdDraftRead = fn; }, pauseDraftWrite: fn => { holdDraftWrite = fn; }, pauseVoicePoll: fn => { holdVoicePoll = fn; }, pauseNavigationRead: fn => { holdNavigationRead = fn; }, pauseReferencesRead: fn => { holdReferencesRead = fn; } };
}

test('storage preview-confirm uses real HTTP, keeps draft editors and returns keyboard focus', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    for (let i = 0; i < 8; i++) await e.command('guidance', { revision: e.doc.revision, objective: `Version ${i}`, successCriteria: '' });
  } });
  const $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'Unsaved exact draft 🌿'); const editor = $('answer'); editor.focus(); editor.setSelectionRange(3, 8);
  $('navigation-open').click(); $('storage-open').click();
  await until(() => $('storage-inventory').textContent.includes('apparent bytes') && !$('storage-preview').disabled, 'storage inventory');
  assert.match($('storage-inventory').textContent, /Drafts and tombstones/);
  assert.equal($('storage-confirm').hidden, true);
  $('storage-keep').value = '5'; $('storage-keep').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  $('storage-save').click(); await until(() => $('storage-status').textContent.includes('preference saved'), 'save preview policy');
  const before = await f.explorer.readHistory(f.explorer.doc.id);
  $('storage-preview').click(); await until(() => !$('storage-confirm').hidden && !$('storage-confirm').disabled, 'explicit preview');
  assert.equal(f.document.activeElement, $('storage-confirm'));
  assert.equal((await f.explorer.readHistory(f.explorer.doc.id)).entries.length, before.entries.length);
  assert.equal($('answer'), editor); assert.equal(editor.value, 'Unsaved exact draft 🌿'); assert.equal(editor.selectionStart, 3);
  assert.ok($('storage-candidates').querySelectorAll('li').length > 0);
  $('storage-confirm').click(); await until(() => $('storage-results').textContent.includes('Snapshot removed'), 'confirmed cleanup');
  assert.equal(f.document.activeElement, $('storage-close'));
  assert.equal((await f.explorer.readHistory(f.explorer.doc.id)).entries.length, 5);
  assert.equal(f.explorer.doc.nodes[1].answer, ''); assert.equal($('answer'), editor); assert.equal(editor.value, 'Unsaved exact draft 🌿');
  $('storage-dialog').dispatchEvent(new f.window.Event('cancel', { cancelable: true }));
  assert.equal($('storage-dialog').open, false); assert.equal(f.document.activeElement, $('storage-open'));
  $('navigation-cancel').click();
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'draft retained after cleanup');
  const saved = await f.explorer.readDrafts(f.explorer.doc.id);
  assert.equal(saved.entries.find(row => row.nodeId === node.id).text, 'Unsaved exact draft 🌿');
});

test('local storage stays reachable before a damaged bound journey loads', async t => {
  const f = await fixture(t, 340, undefined, true, { cold: true, before: async e => { await writeFile(e.file, '{damaged'); } });
  const $ = id => f.document.getElementById(id);
  assert.equal($('storage-home').hidden, false); $('storage-home').click();
  await until(() => !$('storage-preview').disabled && $('storage-inventory').textContent.includes('apparent bytes'), 'cold storage inspection');
  $('storage-preview').click(); await until(() => $('storage-status').textContent.includes('No eligible'), 'damaged journey preserved');
  assert.match($('storage-candidates').textContent, /unreadable journey/);
  $('storage-close').click(); assert.equal(f.document.activeElement, $('storage-home'));
});

test('research review preserves draft state, caret and composition, sends only the explicitly reviewed context', async t => {
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    await e.command('answer', { revision: e.doc.revision, nodeId: e.doc.nodes[2].id, answer: 'OPTIONAL-SECRET<script>\ud83c\udf3f' });
  } }), $ = id => f.document.getElementById(id);
  const target = f.explorer.doc.nodes[1]; f.open(target.id); f.type('answer', 'RAW-DRAFT-CANARY');
  $('answer-state').value = 'assumption'; $('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  const answer = $('answer'); answer.focus(); answer.setSelectionRange(2, 6);
  answer.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  $('research-request').focus(); $('research-request').click();
  await until(() => $('research-review-start') && !$('research-review-start').disabled, 'context reviewed without inference');
  assert.equal(f.explorer.pending, null); assert.equal($('answer'), answer); assert.equal(answer.value, 'RAW-DRAFT-CANARY');
  assert.equal(answer.selectionStart, 2); assert.equal(answer.selectionEnd, 6); assert.equal($('answer-state').value, 'assumption');
  assert.ok(!$('research-review-content').textContent.includes('RAW-DRAFT-CANARY'));
  assert.match($('research-review-dialog').textContent, /No project files/);
  assert.equal($('research-review-content').querySelectorAll('script').length, 0);
  for (const [key, value] of [['depth', 'deeper'], ['sourceFocus', 'primary'], ['recency', 'recent']]) {
    const select = $(`research-${key}`); select.focus(); select.value = value; select.dispatchEvent(new f.window.Event('change', { bubbles: true }));
    assert.equal($('research-review-start').disabled, true);
    await until(() => !$('research-review-start').disabled, 'preference review updated');
    assert.equal(f.document.activeElement.id, `research-${key}`); assert.equal(f.explorer.pending, null);
  }
  assert.match($('research-settings-summary').textContent, /Deeper: 300 seconds.*40 tool attempts/);
  assert.match($('research-review-instructions').textContent, /Prioritize original studies/);
  assert.match($('research-review-instructions').textContent, /Prefer recently published/);
  const optional = [...$('research-review-content').querySelectorAll('input[type=checkbox]')].find(n => n.dataset.nodeId === f.explorer.doc.nodes[2].id);
  optional.checked = false; optional.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await until(() => !$('research-review-start').disabled && !$('research-review-prompt').textContent.includes('OPTIONAL-SECRET'), 'excluded exact bytes');
  const prompt = $('research-review-prompt').textContent;
  $('research-review-close').click(); assert.equal(f.explorer.pending, null); assert.equal(f.document.activeElement.id, 'research-request');
  assert.equal($('answer'), answer); assert.equal(answer.selectionStart, 2);
  answer.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  $('research-request').click(); await until(() => !$('research-review-start').disabled, 'new review resets choices');
  assert.ok($('research-review-prompt').textContent.includes('OPTIONAL-SECRET'));
  assert.notEqual($('research-review-prompt').textContent, prompt);
  $('research-review-start').click(); await until(() => f.explorer.pending?.kind === 'research', 'explicit reviewed start');
  assert.equal($('research-review-dialog').open, false); assert.equal($('answer'), answer); f.resolveResearch(findings);
});

test('research review cancels voice and ignores late HTTP preview and start responses after replacement or dismissal', async t => {
  const voice = voiceFixture(), f = await fixture(t, 340, voice), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Private draft');
  await until(() => !$('voice-record').disabled, 'voice ready'); $('voice-record').click();
  await until(() => voice.counts().starts === 1, 'voice running');
  const original = f.window.fetch, held = []; let holdPrepare = true, holdStart = false;
  f.window.fetch = async (path, options) => {
    const response = await original(path, options), input = options?.body ? JSON.parse(options.body) : null;
    if (holdPrepare && path === 'api/research-review' && input.action === 'prepare' || holdStart && path === 'api/action' && input?.action === 'research') await new Promise(resolve => held.push(resolve));
    return response;
  };
  t.after(() => { for (const release of held) release(); });
  $('research-request').click(); await until(() => held.length === 1, 'held first preview');
  await until(() => voice.counts().cancels === 1, 'review cancels voice');
  $('research-review-close').click(); holdPrepare = false;
  $('research-request').click(); await until(() => !$('research-review-start').disabled, 'new preview');
  const newest = f.explorer.researchReview.current.token; held[0](); await delay(20);
  assert.equal(f.explorer.researchReview.current.token, newest); assert.equal($('research-review-dialog').open, true); assert.equal(f.explorer.pending, null);
  holdStart = true; $('research-review-start').click(); await until(() => held.length === 2, 'held start response');
  $('research-review-close').click(); held[1](); await delay(20);
  assert.equal($('research-review-dialog').open, false); assert.equal($('answer').value, 'Private draft');
  await f.explorer.command('cancel');
});

test('late failed research start does not leave a replacement review disabled', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id), target = f.explorer.doc.nodes[1]; f.open(target.id);
  $('research-request').click(); await until(() => !$('research-review-start').disabled, 'first review');
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: target.id, answer: 'Changed committed source' });
  const original = f.window.fetch; let release;
  f.window.fetch = async (path, options) => {
    const response = await original(path, options);
    if (path === 'api/action' && JSON.parse(options.body).action === 'research') await new Promise(resolve => { release = resolve; });
    return response;
  };
  t.after(() => release?.());
  $('research-review-start').click(); await until(() => release, 'held failed start');
  $('research-review-close').click(); $('research-request').click();
  await until(() => $('research-review-prompt')?.textContent.includes('Changed committed source'), 'replacement review');
  release(); await until(() => !$('research-review-start').disabled, 'replacement review enabled');
  assert.equal($('research-review-dialog').open, true); assert.equal(f.explorer.pending, null);
  $('research-review-close').click();
});

test('diagnostics settings disclosure previews support categories, retries and downloads without changing drafts', async t => {
  let reads = 0;
  const voice = { status: async () => ({ ready: false }), diagnostics: async () => { reads++; return { runtime: 'ready', model: 'unavailable', microphone: 'unknown', error: 'none' }; }, close() {} };
  const f = await fixture(t, 340, voice), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Draft stays private');
  $('answer-state').value = 'assumption'; $('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'saved draft');
  const answer = $('answer'); answer.focus(); answer.setSelectionRange(3, 8);
  const before = JSON.stringify(f.explorer.doc);
  $('navigation-open').click();
  assert.ok($('diagnostics-open'), 'diagnostics reachable from settings');
  $('diagnostics-open').focus(); $('diagnostics-open').click();
  await until(() => $('diagnostics-results').textContent.includes('Voice model assets'), 'diagnostics results');
  assert.equal($('diagnostics-dialog').open, true); assert.equal(reads, 1);
  assert.match($('diagnostics-dialog').textContent, /Versions, readiness categories, capability states, bounded counts and recovery states/);
  assert.match($('diagnostics-dialog').textContent, /loadability and live capture remain unknown/);
  assert.ok(!$('diagnostics-results').textContent.includes('Draft stays private'));
  $('diagnostics-retry').click(); await until(() => reads === 2 && !$('diagnostics-retry').disabled, 'explicit retry');
  let downloaded = null, revoked = false;
  f.window.URL.createObjectURL = () => 'blob:support-fixture'; f.window.URL.revokeObjectURL = () => { revoked = true; };
  f.window.HTMLAnchorElement.prototype.click = function () { downloaded = { filename: this.download, href: this.href }; };
  $('diagnostics-export').click(); await until(() => downloaded, 'explicit support download');
  assert.deepEqual(downloaded, { filename: 'explorer-support.json', href: 'blob:support-fixture' });
  assert.match($('diagnostics-status').textContent, /cannot confirm.*saved/i);
  assert.equal(JSON.stringify(f.explorer.doc), before); assert.equal($('answer').value, 'Draft stays private'); assert.equal(reads, 2);
  assert.equal($('answer'), answer); assert.equal(answer.selectionStart, 3); assert.equal(answer.selectionEnd, 8); assert.equal($('answer-state').value, 'assumption');
  f.window.URL.createObjectURL = () => { throw new Error('PRIVATE-CANARY\nC:/Users/private'); };
  $('diagnostics-export').click(); await until(() => /Support export failed/.test($('diagnostics-status').textContent), 'safe download failure');
  assert.ok(!$('diagnostics-status').textContent.includes('PRIVATE-CANARY'));
  $('diagnostics-close').click(); assert.equal($('diagnostics-dialog').open, false); assert.equal(f.document.activeElement.id, 'diagnostics-open');
  await until(() => revoked, 'blob release');
});

test('diagnostics ignores held responses after closing or hiding the page and reports real HTTP export failure', async t => {
  const f = await fixture(t, 340), $ = id => f.document.getElementById(id), originalFetch = f.window.fetch;
  $('navigation-open').click();
  let release, observedAbort = false;
  f.window.fetch = async (path, options) => {
    const response = await originalFetch(path, options);
    if (path === 'api/diagnostics') { options.signal.addEventListener('abort', () => { observedAbort = true; }); await new Promise(resolve => { release = resolve; }); }
    return response;
  };
  $('diagnostics-open').click(); await until(() => release, 'held readiness');
  $('diagnostics-close').click(); release(); await delay(20);
  assert.equal(observedAbort, true); assert.equal($('diagnostics-results').textContent, '');
  release = null; $('diagnostics-open').click(); await until(() => release, 'held reopened readiness');
  const hide = new f.window.Event('pagehide'); Object.defineProperty(hide, 'persisted', { value: true }); f.window.dispatchEvent(hide);
  release(); await delay(20); assert.equal($('diagnostics-results').textContent, ''); assert.equal($('diagnostics-dialog').open, false, 'page restoration cannot strand a disabled dialog');
  const show = new f.window.Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true }); f.window.dispatchEvent(show);
  $('diagnostics-close').click(); f.window.fetch = originalFetch; $('diagnostics-open').click();
  await until(() => $('diagnostics-results').textContent.includes('Voice model assets'), 'fresh view');
  Object.defineProperty(f.explorer, 'unconfirmedResearchRelease', { configurable: true, get() { throw new Error('PRIVATE-CANARY\nC:/Users/private'); } });
  $('diagnostics-export').click(); await until(() => /Support export failed/.test($('diagnostics-status').textContent), 'real HTTP export failure');
  assert.ok(!$('diagnostics-status').textContent.includes('PRIVATE-CANARY'));
  Object.defineProperty(f.explorer, 'unconfirmedResearchRelease', { value: null, writable: true });
});

test('constraint editing and scope coverage preserve active drafts, caret, help and request intent over HTTP', async t => {
  const f = await fixture(t, 340, undefined, false, { questionHelper: { run: async () => 'Helpful explanation', close() {} } }), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Unsaved draft 🌿');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'draft saved');
  $('help-rephrase').click(); await until(() => $('question-help-results').textContent.includes('Helpful explanation'), 'help result');
  const answer = $('answer'); answer.focus(); answer.setSelectionRange(2, 7);
  $('context-scope').value = 'path'; $('context-scope').dispatchEvent(new f.window.Event('change'));
  $('check-question-context').click(); await until(() => $('context-coverage').textContent.includes('Preview of saved'), 'coverage');
  assert.equal(f.explorer.pending, null); assert.equal(answer.value, 'Unsaved draft 🌿'); assert.equal(answer.selectionStart, 2); assert.equal(f.document.activeElement, $('answer')); assert.match($('question-help-results').textContent, /Helpful explanation/);
  assert.match($('context-controls').textContent, /full committed map/); assert.match($('context-coverage').textContent, /UTF-8 bytes/);
  $('edit-guidance').click(); $('add-constraint').click();
  const pinInput = $('constraint-list').querySelector('textarea'); pinInput.value = '  Keep this user statement 🌿\nexactly  ';
  $('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !f.document.getElementById('guidance-dialog').open, 'constraint saved');
  assert.equal(f.explorer.doc.pins[0].text, pinInput.value); assert.equal($('answer').value, 'Unsaved draft 🌿'); assert.equal($('answer').selectionStart, 2);
  $('check-research-context').click(); await until(() => $('context-coverage').textContent.includes('Preview of saved research'), 'research coverage');
  assert.match($('context-coverage').textContent, /Included 1 user constraints/); assert.equal(f.explorer.pending, null);
  $('research-request').click(); await startReviewedResearch(f); await until(() => f.explorer.pending?.kind === 'research', 'explicit research action');
  assert.equal(f.explorer.contextCoverage.scope, 'path'); assert.equal($('answer').value, 'Unsaved draft 🌿');
  f.resolveResearch(findings); await until(() => !f.explorer.pending, 'research completion');
});

test('constraint controls preserve untouched CRLF text and stable IDs, then edit and remove normally', async t => {
  const pin = { id: 'constraint-00000000000000', text: '  Exact\r\nuser text 🌿  ' };
  const f = await fixture(t, 340, undefined, false, { before: e => e.command('guidance', { revision: e.doc.revision, objective: '', successCriteria: '', pins: [pin] }) }), $ = id => f.document.getElementById(id);
  const revision = f.explorer.doc.revision;
  const submit = async () => { $('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })); await until(() => !$('guidance-dialog').open, 'guidance closed'); };
  $('edit-guidance').click(); await submit();
  assert.equal(f.explorer.doc.revision, revision); assert.deepEqual(f.explorer.doc.pins, [pin]);
  $('edit-guidance').click(); const input = $('constraint-list').querySelector('textarea'); input.value = 'Revised user statement'; await submit();
  assert.equal(f.explorer.doc.pins[0].id, pin.id); assert.equal(f.explorer.doc.pins[0].text, 'Revised user statement');
  $('edit-guidance').click(); $('constraint-list').querySelector('button').click(); await submit();
  assert.equal(Object.hasOwn(f.explorer.doc, 'pins'), false); assert.equal(f.explorer.doc.revision, revision + 2);
});

test('research allows independent answer save through HTTP and preserves editor controls during completion', async t => {
  const f = await fixture(t, 340, undefined, false, { questions: [
    { question: 'Research target?', category: 'Target', rationale: 'Explain the target.' },
    { question: 'Independent branch?', category: 'Other', rationale: 'Explain the other branch.' },
  ] });
  const $ = id => f.document.getElementById(id), target = f.explorer.doc.nodes[1].id, other = f.explorer.doc.nodes[2].id;
  f.open(target); $('research-request').click(); await startReviewedResearch(f); await until(() => f.explorer.pending?.kind === 'research', 'research running');
  f.open(other); f.type('answer', 'Independent saved choice 🌿');
  $('answer-state').value = 'assumption'; $('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  $('references').open = true; $('question-rationale').open = true;
  $('answer').focus(); $('answer').setSelectionRange(6, 10);
  await until(() => $('save-deeper').disabled, 'research contention reflected');
  assert.equal($('save-answer').disabled, false);
  assert.match(f.document.querySelector('#question-drawer').textContent, /Wait or cancel research before Explore deeper/);
  assert.equal($('answer').selectionStart, 6); assert.equal($('answer').selectionEnd, 10);
  assert.equal(f.document.activeElement.id, 'answer');
  assert.ok($('voice-status')); assert.ok($('help-rephrase')); assert.ok($('question-rationale'));
  $('save-answer').click(); await until(() => f.explorer.doc.nodes[2].answer === 'Independent saved choice 🌿', 'independent answer committed during research');
  assert.ok(f.explorer.pending); assert.equal(f.explorer.doc.nodes[2].answerState, 'assumption');
  await until(() => !$('answer-status').textContent.includes('Saving'), 'save finished');
  f.type('answer', 'A further unsaved draft'); $('answer').focus(); $('answer').setSelectionRange(3, 7);
  f.resolveResearch(findings); await until(() => f.explorer.doc.nodes[1].research && !$('save-deeper').disabled, 'research merged and editor refreshed');
  assert.equal(f.explorer.doc.nodes[2].answer, 'Independent saved choice 🌿');
  assert.equal($('answer').value, 'A further unsaved draft'); assert.equal($('answer-state').value, 'assumption');
  assert.equal($('answer').selectionStart, 3); assert.equal($('answer').selectionEnd, 7); assert.equal(f.document.activeElement.id, 'answer');
  assert.equal($('references').open, true); assert.equal($('question-rationale').open, true); assert.ok($('voice-status')); assert.ok($('help-rephrase'));
});

test('importance labels and composed Outline filters preserve the full map and independent editing state', async t => {
  const reason = '<img src=x onerror=alert(1)> Consequences for the goal.';
  const f = await fixture(t, 340, undefined, false, { questions: [
    { question: 'Who starts?', category: 'People', importance: 'high', importanceReason: reason },
    { question: 'When?', category: 'Time', importance: 'low', importanceReason: 'Scheduling flexibility.' },
    { question: 'Legacy?', category: 'Scope' },
    { question: 'What tools?', category: 'Tools', importance: 'medium', importanceReason: 'Budget constraint.' },
  ] }), $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  assert.match(f.document.querySelector(`[data-node-id="${node.id}"]`).textContent, /High importance/);
  const geometry = f.window.__updates.scene().geometry;
  const compact = f.document.querySelector(`#nodes [data-node-id="${node.id}"]`);
  const revised = structuredClone(f.explorer.doc); revised.nodes[1].importanceReason += ' Historical detail.';
  await f.explorer.save(revised, 'Imported assessment detail'); await f.poll();
  assert.equal(f.window.__updates.scene().geometry, geometry, 'reason-only changes do not change compact geometry');
  assert.equal(f.document.querySelector(`#nodes [data-node-id="${node.id}"]`), compact);
  $('outline-toggle').click(); assert.ok($('importance-filter'));
  for (const [rank, count] of [['high', 1], ['medium', 1], ['low', 1], ['unranked', 1], ['all', 5]]) {
    $('importance-filter').value = rank; $('importance-filter').dispatchEvent(new f.window.Event('change'));
    assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, count);
  }
  $('importance-filter').value = 'high'; $('importance-filter').dispatchEvent(new f.window.Event('change'));
  $('revisit-filter').value = 'manual-condition'; $('revisit-filter').dispatchEvent(new f.window.Event('change'));
  assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 0);
  assert.equal(f.window.__updates.scene().geometry, geometry, 'list filters do not invalidate map geometry');
  await f.explorer.command('set-revisit', { revision: f.explorer.doc.revision, nodeId: node.id, date: null, condition: 'Manual check' }); await f.poll();
  assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 1);
  f.type('search', 'When'); assert.equal($('outline-list').querySelectorAll('[data-node-id]').length, 0);
  f.window.__updates.select(node.id); assert.equal($('node-workspace').dataset.nodeId, node.id, 'hidden result remains revealable');
  assert.equal($('importance-filter').value, 'all', 'explicit source reveal resets filters');
  $('importance-filter').value = 'high'; $('revisit-filter').value = 'manual-condition'; $('revisit-filter').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.match($('question-importance').textContent, /Historical model assessment/); assert.ok($('question-importance').textContent.includes(reason)); assert.equal($('question-importance').querySelector('img'), null);
  f.type('answer', 'Independent answer draft'); f.type('revisit-condition', 'Independent reminder draft');
  $('question-importance').open = true; const answer = $('answer'), reminder = $('revisit-condition'); reminder.focus(); reminder.setSelectionRange(2, 6);
  answer.dispatchEvent(new f.window.Event('compositionstart', { bubbles: true }));
  const next = structuredClone(f.explorer.doc); next.nodes[1].importanceReason = 'Changed historical reason'; next.nodes[1].review = true;
  await f.explorer.save(next, 'Imported assessment'); await f.poll(); answer.dispatchEvent(new f.window.Event('compositionend', { bubbles: true })); await f.poll();
  assert.equal($('answer'), answer); assert.equal(answer.value, 'Independent answer draft'); assert.equal($('revisit-condition'), reminder); assert.equal(reminder.value, 'Independent reminder draft'); assert.equal(reminder.selectionStart, 2); assert.equal(reminder.selectionEnd, 6);
  assert.ok($('question-importance').open); assert.ok($('voice-status')); assert.equal(f.explorer.pending, null);
  assert.equal($('importance-filter').value, 'high'); assert.equal($('revisit-filter').value, 'manual-condition');
});

test('importance preview discloses original assessment safely and legacy questions stay Unranked', async t => {
  const f = await fixture(t, 340, undefined, false, { preview: true, questions: [{ question: 'Original?', category: 'Scope', importance: 'medium', importanceReason: '<script>model</script>' }, { question: 'Legacy?', category: 'Time' }] }), $ = id => f.document.getElementById(id);
  await until(() => $('candidate-importance-0'), 'importance preview');
  assert.match($('candidate-importance-0').textContent, /Medium importance/); assert.match($('candidate-importance-0').textContent, /Original\?/);
  assert.equal($('candidate-importance-0').querySelector('script'), null);
  assert.match($('question-preview').textContent, /Unranked/);
  f.type('candidate-question-0', 'Edited?'); $('accept-questions').click();
  await until(() => [...f.document.querySelectorAll('#nodes button')].some(b => b.title === 'Edited?'), 'accepted map question');
  f.open(f.explorer.doc.nodes[1].id);
  assert.match($('question-importance').textContent, /Original\?/); assert.equal(f.explorer.doc.nodes[1].importance, 'medium');
});

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
  await f.poll(); assert.equal($('answer'), composingAnswer, 'composition end keeps the actual editor');
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
  assert.equal($('question-help-summary').closest('#question-drawer') !== null, true);
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
  const streamAnswer = $('answer');
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: f.explorer.doc.nodes[2].id, answer: 'Independent saved answer' }); await f.poll();
  assert.equal($('answer'), streamAnswer);
  voice.publish(1, 'new words'); await until(() => $('answer').value.includes('new words'), 'programmatic insertion');
  await until(() => runs[0].signal.aborted, 'dictation invalidates cleanup');
  await until(() => release, 'durability pending'); assert.deepEqual(voice.counts().acknowledgments, []);
  f.pauseDraftWrite(null); release(); await until(() => voice.counts().acknowledgments.length === 1, 'ack after persistence');
  assert.equal($('answer'), streamAnswer); assert.equal(voice.counts().acknowledgments.length, 1);
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
  await until(() => f.document.getElementById('node-workspace').dataset.nodeId !== node.id, 'continued after state save');
  f.open(node.id); assert.match(f.document.getElementById('answer-status').textContent, /saved/i);
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
  f.document.getElementById('research-request').click(); await startReviewedResearch(f);
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
  const pin = f.document.querySelector('.library-entry [data-action="pin"]'); pin.focus(); pin.click();
  await until(() => f.document.querySelector('.library-entry [data-action="pin"]')?.textContent === 'Unpin', 'pin saved');
  assert.equal(f.document.activeElement, pin); assert.equal(f.document.getElementById('library-search').value, 'Another');
  const archive = f.document.querySelector('.library-entry [data-action="archive"]'); archive.focus(); archive.click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 0, 'archived hidden');
  assert.equal(f.document.activeElement.id, 'library-search');
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

test('empty space in an expanded heading can pull the map back while answer selection stays native', async t => {
  const f = await fixture(t); f.open(f.explorer.doc.nodes[1].id);
  const map = f.document.getElementById('map'), heading = f.document.querySelector('.node-head'), before = viewOf(f);
  pointer(f, 'pointerdown', heading, 400, 250); pointer(f, 'pointermove', map, 460, 300); pointer(f, 'pointerup', map, 460, 300);
  assert.equal(viewOf(f).x, before.x + 60);
  const answer = f.document.getElementById('answer'), after = viewOf(f);
  assert.equal(pointer(f, 'pointerdown', answer, 400, 350).defaultPrevented, false);
  pointer(f, 'pointermove', answer, 500, 400); pointer(f, 'pointerup', answer, 500, 400);
  assert.deepEqual(viewOf(f), after, 'selecting answer text never drags the map');
  pointer(f, 'pointerdown', map, 100, 100); pointer(f, 'pointermove', map, 100000, 100000); pointer(f, 'pointerup', map, 100000, 100000);
  assert.ok(Math.abs(viewOf(f).x) < 3000 && Math.abs(viewOf(f).y) < 3000, 'map cannot be thrown arbitrarily far away');
  const edge = viewOf(f);
  pointer(f, 'pointerdown', heading, 100, 100); pointer(f, 'pointermove', map, 80, 80); pointer(f, 'pointerup', map, 80, 80);
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
  f.document.getElementById('fit').click(); // Recover cards culled by pointer-anchored zoom.
  f.open(f.explorer.doc.nodes[1].id);
  const answer = f.document.getElementById('answer'), stable = viewOf(f);
  assert.equal(wheel(f, answer, 100).defaultPrevented, false); assert.deepEqual(viewOf(f), stable);
  assert.equal(wheel(f, answer, -100, { ctrlKey: true }).defaultPrevented, true, 'pinch/Ctrl-wheel cannot zoom the host page');
  assert.ok(viewOf(f).zoom > stable.zoom);
});

test('focusing an expanded answer reveals readable controls at 300% in a narrow pane', async t => {
  const f = await fixture(t, 340); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep my draft');
  for (let i = 0; i < 20; i++) f.document.getElementById('zoom-in').click();
  f.document.getElementById('save-answer').focus();
  const panel = f.document.getElementById('node-workspace'), v = viewOf(f);
  assert.equal(v.zoom, 3);
  const left = v.x + parseFloat(panel.style.left) * v.zoom, top = v.y + parseFloat(panel.style.top) * v.zoom;
  assert.ok(left >= 15 && left + panel.offsetWidth <= 325, 'editor stays inside the pane width');
  assert.ok(top >= 15 && top + panel.offsetHeight <= 705, 'heading and scrollable editor remain reachable');
  f.document.getElementById('save-answer').focus();
  assert.equal(f.document.activeElement.id, 'save-answer'); assert.equal(f.document.getElementById('answer').value, 'Keep my draft');
  assert.equal(viewOf(f).zoom, 3, 'focusing controls does not reset zoom');
  const map = f.document.getElementById('map');
  pointer(f, 'pointerdown', map, 100, 100); pointer(f, 'pointermove', map, 300, 200); pointer(f, 'pointerup', map, 300, 200);
  f.document.getElementById('answer').focus();
  const focused = viewOf(f), x = focused.x + parseFloat(panel.style.left) * focused.zoom;
  assert.ok(x >= 15 && x + panel.offsetWidth <= 325, 'focusing the editor brings a panned-off card back');
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
  assert.equal(f.document.getElementById('answer'), answer, 'ordinary polling retains the actual editor');
  assert.equal(answer.scrollTop, 200); assert.equal(answer.selectionDirection, 'backward');
  answer.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: 'Different fund' });
  await delay(1350);
  assert.equal(f.document.getElementById('answer'), answer, 'composition target stays mounted');
  answer.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
  await delay(50); assert.equal(f.explorer.doc.nodes[1].answer, '', 'confirming an IME candidate does not submit an answer');
  answer.dispatchEvent(new f.window.CompositionEvent('compositionupdate', { data: 'My completed composition', bubbles: true }));
  f.type('answer', 'My completed composition');
  answer.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  await delay(50); assert.equal(f.document.getElementById('answer'), answer, 'composition end retains editor'); assert.equal(answer.value, 'My completed composition');
});

test('whole map fits a wide or deep tree instead of stopping at an unreadable zoom limit', async t => {
  const f = await fixture(t, 340), template = structuredClone(f.explorer.doc);
  for (const deep of [false, true]) {
    const doc = structuredClone(template);
    for (let i = 0; i < 100; i++) doc.nodes.push({ ...template.nodes[1], id: `large-${i}`, parentId: deep && i ? `large-${i - 1}` : doc.rootId });
    await f.explorer.command('import', { revision: f.explorer.doc.revision, document: doc });
    await until(() => f.window.__updates.scene().positions.size === doc.nodes.length &&
      (deep ? Math.max(...[...f.window.__updates.scene().positions.values()].map(box => box.y)) > 10000 : true), 'large map laid out');
    f.document.getElementById('fit').click(); const v = viewOf(f);
    assert.equal(f.document.querySelectorAll('.node').length, doc.nodes.length, 'Fit mounts the complete visible layout');
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
  f.type('answer', 'The saved answer'); f.click('Save & continue');
  await until(() => f.document.getElementById('node-workspace').dataset.nodeId !== node.id, 'save and continuation applied');
  f.open(node.id);
  f.pauseState(null); release(); await delay(50);
  assert.equal(f.document.getElementById('answer').value, 'The saved answer');
  assert.equal(f.document.getElementById('progress').textContent.startsWith('1 answered'), true);
});

for (const wholeCard of [false, true]) test(`adding research scrolls only its editor at 300% zoom (${wholeCard ? 'whole card' : 'answer pane'})`, async t => {
  const f = await fixture(t), node = f.explorer.doc.nodes[1]; f.open(node.id);
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options'); await startReviewedResearch(f);
  await until(() => f.explorer.pending?.kind === 'research', 'research request'); f.resolveResearch(findings);
  await until(() => f.document.getElementById('use-recommendation'), 'research rendered');
  f.window.__updates.zoom(3);
  if (wholeCard) f.resize(280, 200);
  const answer = f.document.getElementById('answer'), pane = wholeCard ? f.document.getElementById('node-workspace') : f.document.querySelector('.node-content'), before = viewOf(f);
  answer.scrollIntoView = () => assert.fail('scrollIntoView can scroll hidden ancestors of the map');
  pane.scrollTop = 400; pane.getBoundingClientRect = () => ({ top: 240 }); answer.getBoundingClientRect = () => ({ top: 340 - pane.scrollTop });
  f.click('Use recommendation');
  assert.deepEqual(viewOf(f), before); assert.ok(pane.scrollTop < 400); assert.equal(f.document.activeElement, answer);
  assert.ok(answer.getBoundingClientRect().top >= pane.getBoundingClientRect().top, 'the answer is revealed in the unscaled editor');
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
  f.click('Save & continue'); await until(() => f.explorer.doc.nodes[1].answer, 'answer saved');
  await until(() => f.document.getElementById('node-workspace').dataset.nodeId !== a.id, 'save and continuation rendered');
  f.open(a.id);
  f.click('Close question');
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
  f.type('search', grandchild.question);
  const row = [...f.document.querySelectorAll('#outline-list [data-node-id]')].find(e => e.dataset.nodeId === grandchild.id);
  assert.ok(row, 'hidden question is discoverable'); row.click();
  assert.equal(f.document.getElementById('expanded-title').textContent, grandchild.question);
  assert.equal(f.document.getElementById('answer').value, 'Private draft');
  assert.equal(f.document.getElementById('answer-state').value, 'assumption');
  assert.equal(f.document.getElementById('manual-question').value, 'Private follow-up');
  f.document.getElementById('outline-toggle').click();
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`), 'ancestor path revealed on return to map');
  assert.equal(f.explorer.doc.revision, revision);
  assert.equal(f.document.querySelector(`[data-branch-id="${b.id}"]`), null, 'unrelated leaf stays unchanged');
  f.document.getElementById('fit').click();
  assert.ok(f.document.querySelector(`#nodes [data-branch-id="${root.id}"]`), 'Fit provides a public route back to the root branch');
});

test('folded research completion and root folding keep saved content and full exports', async t => {
  const f = await fixture(t, 340, undefined, false, { before: e => e.command('add', { revision: e.doc.revision, nodeId: e.doc.nodes[1].id, category: 'People', question: 'Invite nearby?' }) });
  const [root, a, , child] = f.explorer.doc.nodes;
  f.open(child.id); f.document.querySelector('.research-disclosure summary').click(); f.click('Research options'); await startReviewedResearch(f);
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
  assert.ok(f.document.querySelector(`#outline-list [data-node-id="${child.id}"]`), 'unfolded hierarchy remains available');
  f.document.getElementById('outline-toggle').click();
  assert.ok(f.document.querySelector(`#nodes [data-node-id="${child.id}"]`));
});

test('research callbacks and follow-ups work inside a narrow expanded node without replacing a draft', async t => {
  const f = await fixture(t, 340), a = f.explorer.doc.nodes[1];
  f.open(a.id); f.type('answer', 'My own thought');
  f.document.querySelector('.research-disclosure summary').click();
  assert.ok(f.document.querySelector('.research-disclosure').open);
  f.click('Research options'); await startReviewedResearch(f);
  await until(() => f.explorer.pending?.kind === 'research', 'research requested');
  f.type('answer', 'My own thought, still editing');
  f.resolveResearch(findings);
  await until(() => f.document.querySelector('#question-drawer .option'), 'research delivered');
  assert.equal(f.document.getElementById('answer').value, 'My own thought, still editing');
  assert.match(f.document.getElementById('question-drawer').textContent, /not externally verified/);
  f.click('Use this option');
  assert.match(f.document.getElementById('answer').value, /^My own thought, still editing\n\nOne block/);
  assert.equal(f.explorer.doc.nodes[1].answer, '');
  f.click('Save answer and explore deeper'); await until(() => f.explorer.pending?.kind === 'questions', 'follow-ups requested');
  await f.explorer.receive('questions', { requestId: f.explorer.pending.id, questions: [{ category: 'People', question: 'How will you invite them?' }] });
  await until(() => f.document.getElementById('accept-questions'), 'review follow-ups'); f.document.getElementById('accept-questions').click();
  await until(() => [...f.document.querySelectorAll('#question-drawer .followup')].length, 'follow-up link');
  f.document.querySelector('#question-drawer .followup').click();
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
  f.type('answer', 'Submitted answer'); f.click('Save & continue'); await until(() => started, 'save held');
  f.type('answer', 'Newer unsaved thought'); release();
  await until(() => f.explorer.doc.nodes[1].answer === 'Submitted answer', 'save delivered');
  await delay(80);
  assert.equal(f.document.getElementById('answer').value, 'Newer unsaved thought');
  assert.match(f.document.getElementById('answer-status').textContent, /Saving draft|Draft saved locally/);
});

test('recommendations and selected details append to editable drafts with safe undo', async t => {
  const f = await fixture(t, 340), a = f.explorer.doc.nodes[1]; f.open(a.id);
  f.type('answer', 'My own words');
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options'); await startReviewedResearch(f);
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
  f.document.querySelector('.research-disclosure summary').click(); f.click('Research options'); await startReviewedResearch(f);
  await until(() => !f.document.getElementById('request-status').hidden, 'request status');
  f.document.getElementById('fit').click();
  f.document.getElementById('request-status').click();
  assert.equal(f.document.getElementById('expanded-title').textContent, a.question);
  f.click('Cancel request'); await until(() => !f.explorer.pending, 'cancelled');
  await until(() => !f.document.querySelector('#question-drawer .pending'), 'cancellation rendered');
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
  f.click('Save & continue');
  await until(() => f.document.getElementById('notice').textContent.includes('The map changed'), 'stale save error');
  assert.equal(f.document.getElementById('answer').value, 'My unsaved change');
  assert.equal(f.explorer.doc.nodes[1].answer, 'A separately saved change');
});

test('keyboard focus survives research, cancellation, and background map updates', async t => {
  const f = await fixture(t), [a, b] = f.explorer.doc.nodes.slice(1); f.open(a.id);
  f.document.querySelector('.research-disclosure summary').click();
  const research = [...f.document.querySelectorAll('#node-workspace button, #question-drawer button')].find(e => e.textContent === 'Research options');
  research.focus(); research.click(); await startReviewedResearch(f);
  await until(() => f.document.querySelector('#question-drawer .pending'), 'pending controls');
  assert.equal(f.document.activeElement.textContent, 'Cancel request');
  f.click('Cancel request'); await until(() => !f.document.querySelector('#question-drawer .pending'), 'cancellation rendered');
  assert.equal(f.document.activeElement.id, 'expanded-title');
  f.document.getElementById('fit').click();
  const target = f.document.querySelector(`[data-node-id="${a.id}"]`); assert.equal(target.tagName, 'BUTTON', 'edge identity cannot shadow node controls'); target.focus();
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
  f.type('answer', 'Clicked save'); f.click('Save & continue'); await entered;
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
  await until(() => f.explorer.doc.nodes.find(n => n.id === node.id).answer === 'Committed keyboard answer', 'keyboard answer saved');
  assert.equal(f.explorer.pending, null, 'the save shortcut does not start generation');
  await delay(100);
  assert.equal((await f.explorer.readDrafts(f.explorer.doc.id)).entries[0].text, null);
  assert.notEqual(f.document.getElementById('node-workspace').dataset.nodeId, node.id);
  f.open(node.id); assert.equal(f.document.getElementById('answer-status').textContent, 'Answer saved');
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
  f.document.getElementById('start-mode').value = 'decide';
  f.type('start-criteria', 'Neighbors can reach it');
  f.document.getElementById('start-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc?.topic === 'A shared orchard', 'guided journey created');
  await until(() => !f.document.getElementById('workspace').hidden && f.document.getElementById('start-objective').value === '', 'new journey rendered');
  assert.equal(f.explorer.doc.objective, 'Decide where to plant 🌳');
  assert.equal(f.explorer.doc.successCriteria, 'Neighbors can reach it');
  assert.equal(f.explorer.doc.mode, 'decide');
  assert.equal(f.document.getElementById('current-mode').textContent, 'Mode: Decide');
  await f.explorer.command('cancel');
  f.document.getElementById('library-toggle').click();
  await until(() => !f.document.getElementById('welcome').hidden, 'library visible');
  assert.equal(f.document.getElementById('start-objective').value, '');
  assert.equal(f.document.getElementById('start-criteria').value, '');
  assert.equal(f.document.getElementById('start-mode').value, 'understand');
});
test('mode selector uses saved guidance with explicit conflict choice and preserves the answer editor', async t => {
  const f = await fixture(t, 340), d = f.document, e = f.explorer, node = e.doc.nodes[1];
  f.open(node.id); f.type('answer', 'My draft');
  d.getElementById('answer-state').value = 'assumption';
  d.getElementById('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  const answer = d.getElementById('answer'); answer.focus(); answer.setSelectionRange(3, 3);
  d.getElementById('edit-guidance').click();
  assert.equal(d.getElementById('edit-mode').value, 'understand');
  assert.match(d.getElementById('edit-mode-description').textContent, /concepts, stakeholders and unknowns/);
  d.getElementById('edit-mode').value = 'design';
  d.getElementById('edit-mode').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  assert.match(d.getElementById('edit-mode-description').textContent, /outcomes, constraints, interfaces and feasibility/);
  assert.equal(e.pending, null, 'selector changes do not start inference');
  const other = await new Explorer({ file: e.file }).load();
  await other.command('guidance', { revision: other.doc.revision, objective: '', successCriteria: '', mode: 'challenge' });
  d.getElementById('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !d.getElementById('refresh-guidance').hidden, 'mode conflict refresh');
  d.getElementById('refresh-guidance').click();
  await until(() => !d.getElementById('guidance-conflict').hidden, 'mode conflict choice');
  assert.equal(d.getElementById('edit-mode').value, 'design');
  assert.match(d.getElementById('guidance-latest').textContent, /Saved mode: Challenge/);
  d.getElementById('keep-guidance-edits').click();
  d.getElementById('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => e.doc.mode === 'design' && !d.getElementById('guidance-dialog').open, 'mode saved');
  assert.equal(d.getElementById('current-mode').textContent, 'Mode: Design');
  assert.equal(d.getElementById('answer').value, 'My draft');
  assert.equal(d.getElementById('answer-state').value, 'assumption');
  assert.equal(d.getElementById('answer').selectionStart, 3);
});
test('saving a new mode explains why completed question help disappeared', async t => {
  const f = await fixture(t, 340, undefined, false, { questionHelper: { async run() { return 'Earlier mode explanation.'; }, close() {} } });
  const d = f.document, node = f.explorer.doc.nodes[1]; f.open(node.id);
  d.getElementById('question-help').open = true;
  d.getElementById('help-rephrase').click();
  await until(() => /Earlier mode explanation/.test(d.getElementById('question-help-results').textContent), 'completed help');
  d.getElementById('edit-guidance').click();
  d.getElementById('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !d.getElementById('guidance-dialog').open, 'unchanged mode saved as no-op');
  assert.match(d.getElementById('question-help-results').textContent, /Earlier mode explanation/);
  d.getElementById('edit-guidance').click();
  d.getElementById('edit-mode').value = 'challenge';
  d.getElementById('guidance-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => f.explorer.doc.mode === 'challenge', 'new mode saved');
  await until(() => d.getElementById('question-help-results').textContent === '', 'old help cleared');
  assert.equal(d.getElementById('question-help-results').textContent, '');
  assert.match(d.getElementById('notice').textContent, /question help.*cleared/i);
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
  f.click('Research options'); await startReviewedResearch(f); await until(() => f.explorer.pending?.kind === 'research', 'research pending');
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
  f.document.getElementById('navigation-open').click();
  const disclosure = f.document.getElementById('voice-settings'); assert.ok(disclosure);
  disclosure.open = true;
  await until(() => f.document.querySelector('#voice-microphone option[value="USB microphone"]'), 'device choices');
  assert.match(f.document.querySelector('#voice-microphone option:checked').textContent, /Unavailable/);
  assert.equal(f.document.querySelector('#voice-model option[value="whisper"]').disabled, true);
  const mic = f.document.getElementById('voice-microphone'); mic.value = 'USB microphone'; mic.dispatchEvent(new f.window.Event('change'));
  f.document.getElementById('navigation-cancel').click(); f.open(b.id); f.document.getElementById('navigation-open').click();
  assert.equal(f.document.getElementById('voice-settings').open, true);
  assert.equal(f.document.getElementById('voice-microphone').value, 'USB microphone');
  f.document.querySelector('#voice-settings .voice-settings-actions button').click(); await until(() => saved, 'saved settings');
  assert.deepEqual(saved, { microphone: 'USB microphone', model: 'copilot', revision: 0 });
  await until(() => !f.document.getElementById('voice-refresh').disabled, 'save finishes');
  f.document.getElementById('voice-refresh').click(); await until(() => reads === 2, 'refresh');
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
  await until(() => f.document.getElementById('node-workspace').dataset.nodeId !== node.id, 'continued after save');
  f.open(node.id); f.type('answer', 'Local draft'); chooseState(f, 'needs-evidence');
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
  f.type('search', b1.question);
  const target = [...f.document.querySelectorAll('#outline-list [data-node-id]')].find(e => e.dataset.nodeId === b1.id);
  assert.ok(target); target.click();
  assert.equal(f.document.getElementById('show-whole-map').hidden, true);
  assert.equal(f.document.getElementById('expanded-title').textContent, b1.question);
  f.document.getElementById('outline-toggle').click();
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
  f.open(b1.id); f.document.querySelector('.research-disclosure summary').click(); f.click('Research options'); await startReviewedResearch(f);
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
  assert.equal(f.document.querySelectorAll('#outline-list .outline-row').length, 1, 'visible hierarchy contains the folded root');
  f.document.getElementById('outline-toggle').click();
  assert.equal(f.document.querySelectorAll('#nodes .node').length, 1, 'map refreshes the fold on return');
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
  assert.ok(d.getElementById('question-preview'), 'the proposal updates independently while composition stays mounted');
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
  d.getElementById('show-whole-map').click(); d.getElementById('outline-toggle').click();
  assert.equal(d.querySelector(`#outline-list [data-branch-id="${other.id}"]`).getAttribute('aria-expanded'), 'false', 'offscreen fold remains available in full Outline');
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

test('reviewed brief HTTP UI preserves draft/caret, edits, source navigation and stale accepted history', async t => {
 let held, release;
 const f = await fixture(t, 340, undefined, false, { briefHelper: { run(prepared) { return new Promise(resolve => { held = prepared; release = () => resolve(parseBrief(JSON.stringify({ goal: [{ id: 'g', text: '  AI goal <script> \u03bb\r\nExact  ', certainty: 'user-statement', sources: [{ kind: 'guidance', field: 'topic' }] }], decisions: [], constraints: [], assumptions: [], unresolved: [{ id: 'u', text: 'No answer yet.\r\nReason unknown.', certainty: 'uncertain', sources: [{ kind: 'node', id: prepared.dependencies.records[1].id }] }], nextSteps: [] }), prepared)); }); }, close() {} } }), $ = id => f.document.getElementById(id);
 f.open(f.explorer.doc.nodes[1].id);f.type('answer','Unsaved raw draft \u{1f331}');await until(()=>$('answer-status').textContent==='Draft saved locally','draft saved');
 const answer=$('answer');answer.focus();answer.setSelectionRange(3,7);
 $('decision-brief').click();await until(()=>$('brief-dialog').open&&!$('generate-brief').disabled,'brief dialog');$('generate-brief').click();await until(()=>held||$('brief-status').textContent.includes('unknown until'),'brief started');assert.ok(held,$('brief-status').textContent);assert.ok(!held.prompt.includes('Unsaved raw draft'));assert.equal(held.context.targetId,f.explorer.doc.rootId);
 assert.equal($('answer'),answer);assert.equal(answer.value,'Unsaved raw draft \u{1f331}');assert.equal(answer.selectionStart,3);
 release();await until(()=>!$('accept-brief').hidden,'proposal displayed');const statement=$('brief-content').querySelector('[data-brief-statement="g"]');statement.value='User edited <img> \u{1f331}';statement.dispatchEvent(new f.window.Event('input',{bubbles:true}));statement.focus();statement.setSelectionRange(2,5);
 await delay(1350);assert.equal($('brief-content').querySelector('[data-brief-statement="g"]'),statement);assert.equal(statement.selectionStart,2);assert.equal(statement.value,'User edited <img> \u{1f331}');assert.equal($('brief-content').querySelector('script'),null);
 $('brief-content').querySelector('.brief-source').click();assert.equal($('brief-dialog').open,false);if ($('node-workspace').dataset.nodeId !== f.explorer.doc.nodes[1].id) f.open(f.explorer.doc.nodes[1].id);assert.equal($('answer').value,'Unsaved raw draft \u{1f331}');
 $('decision-brief').click();await until(()=>!$('accept-brief').hidden&&!$('accept-brief').disabled,'review reopened');$('accept-brief').click();await until(()=>f.explorer.doc.brief,'accepted');assert.equal(f.explorer.doc.brief.sections.goal[0].text,'User edited <img> \u{1f331}');assert.equal(f.explorer.doc.brief.sections.unresolved[0].text,'No answer yet.\r\nReason unknown.');assert.equal(f.explorer.doc.brief.sections.unresolved[0].edited,false);assert.equal(f.explorer.doc.nodes[1].answer,'');assert.equal($('answer').value,'Unsaved raw draft \u{1f331}');
 await until(()=>!$('export-brief').hidden,'separate export available');assert.match($('brief-status').textContent,/current/);
 const disk=JSON.parse(await readFile(f.explorer.file,'utf8'));disk.nodes[2].answer='External uncited answer changed';disk.nodes[2].answerState='tentative';disk.revision++;await writeFile(f.explorer.file,JSON.stringify(disk));await until(()=>$('brief-status').textContent.includes('stale'),'accepted artifact stale from disk');
});

test('challenge review HTTP UI selects exact inputs without research access and preserves editor and draft', async t => {
  let captured, calls = 0;
  const f = await fixture(t, 340, undefined, false, { checkHelper: { async run(prepared) { calls++; captured = prepared; return { findings: [{ id: 'alt', category: 'alternative', explanation: 'Hypothesis <script>: another route', resolution: 'Compare it with the owner.', sources: [{ kind: 'node', id: prepared.context.decisionsElsewhere[0].id }] }] }; }, close() {} }, before: async explorer => {
    const doc = structuredClone(explorer.doc); doc.nodes[1].answer = 'Saved route A'; doc.nodes[1].answerState = 'tentative'; doc.nodes[2].answer = 'Saved route B'; doc.nodes[2].answerState = 'decided'; await explorer.save(doc);
  } }), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Private unfinished draft');
  const editor = $('answer'); editor.focus(); editor.setSelectionRange(3, 8);
  $('challenge-decisions').click(); await until(() => $('research-review-dialog').open && !$('research-review-start').disabled, 'challenge preview ready');
  assert.equal(calls, 0); assert.match($('research-review-title').textContent, /Challenge/); assert.match($('research-review-content').textContent, /180 seconds.*zero tools/);
  const omit = [...$('research-review-content').querySelectorAll('[data-node-id]')].find(input => input.dataset.nodeId === f.explorer.doc.nodes[2].id);
  omit.checked = false; omit.dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await until(() => !$('research-review-start').disabled && !$('research-review-prompt').textContent.includes('Saved route B'), 'excluded challenge context');
  const exact = $('research-review-prompt').textContent;
  assert.equal($('answer'), editor); assert.equal(editor.value, 'Private unfinished draft'); assert.equal(editor.selectionStart, 3); assert.equal(editor.selectionEnd, 8);
  $('research-review-start').click(); await until(() => $('check-content').textContent.includes('Hypothesis <script>'), 'challenge result');
  assert.equal(calls, 1); assert.equal(captured.prompt, exact); assert.ok(!exact.includes('Private unfinished draft')); assert.equal(captured.operation, 'challenge-review');
  assert.match($('check-title').textContent, /Challenge/); assert.match($('check-description').textContent, /No new evidence/); assert.equal($('check-content').querySelector('script'), null);
  assert.match($('check-content').textContent, /tentative/); assert.equal(f.explorer.doc.nodes[1].answer, 'Saved route A');
  $('check-content').querySelector('button:last-child').click(); await until(() => $('check-content').textContent.includes('Dismissed in this canvas.'), 'challenge dismissed');
  $('check-content').querySelector('.reference-jump').click(); assert.equal($('answer').value, 'Private unfinished draft');
});

test('challenge empty context explains absence locally and never starts inference', async t => {
  let calls = 0;
  const f = await fixture(t, 340, undefined, false, { checkHelper: { run() { calls++; throw Error('No inference'); }, close() {} } }), $ = id => f.document.getElementById(id);
  const mode = f.explorer.doc.mode;
  $('challenge-decisions').click(); await until(() => $('research-review-content').textContent.includes('Select at least one saved nonempty answer'), 'empty challenge explanation');
  assert.equal($('research-review-start').disabled, true); assert.equal(calls, 0); assert.equal(f.explorer.doc.mode, mode);
  assert.equal($('research-depth'), null); assert.match($('research-review-description').textContent, /No new evidence/);
  $('research-review-close').click(); assert.equal($('research-review-dialog').open, false);
});

test('selected project challenge UI requires explicit reads and refresh, reveals original source and preserves drafts', async t => {
  const project = await mkdtemp(join(tmpdir(), 'explorer-project-ui-')); t.after(() => rm(project, { recursive: true, force: true }));
  const canary = 'PROJECT-UI-CANARY <script>λ</script>'; await writeFile(join(project, 'design.md'), canary);
  let captured;
  const f = await fixture(t, 340, undefined, false, { projectRoot: async () => project, checkHelper: { async run(prepared) {
    captured = prepared; return { findings: [{ id: 'file', category: 'assumption', explanation: 'Check the quoted input.', resolution: 'Ask its owner.', sources: [{ kind: 'project', id: prepared.context.projectSources[0].id }] }] };
  }, close() {} }, before: async explorer => { const doc = structuredClone(explorer.doc); doc.nodes[1].answer = 'Saved design'; await explorer.save(doc); } });
  const $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep my draft'); const editor = $('answer');
  $('challenge-decisions').click(); await until(() => $('project-paths') && !$('project-read').disabled, 'project selector');
  assert.ok(!$('research-review-prompt').textContent.includes(canary)); assert.equal(captured, undefined);
  f.type('project-paths', 'design.md'); assert.equal($('research-review-start').disabled, true);
  $('project-read').click(); await until(() => !$('research-review-start').disabled && $('research-review-prompt').textContent.includes(canary), 'selected file preview');
  assert.match($('research-review-content').textContent, /Native helper journals/); assert.equal($('research-review-content').querySelector('script'), null);
  await writeFile(join(project, 'design.md'), 'REFRESHED-UI-CANARY'); $('research-review-refresh').click();
  await until(() => $('project-stale'), 'stale original excerpt'); assert.equal($('research-review-start').disabled, true); assert.ok($('research-review-prompt').textContent.includes(canary));
  $('project-read').click(); await until(() => !$('research-review-start').disabled && $('research-review-prompt').textContent.includes('REFRESHED-UI-CANARY'), 'explicit file refresh');
  const exact = $('research-review-prompt').textContent; $('research-review-start').click();
  await until(() => $('check-content').textContent.includes('Project source: design.md'), 'project reference reveal');
  assert.equal(captured.prompt, exact); assert.match($('check-content').textContent, /SHA-256/); assert.match($('check-content').textContent, /REFRESHED-UI-CANARY/);
  assert.equal($('answer'), editor); assert.equal(editor.value, 'Keep my draft'); assert.equal(f.explorer.doc.nodes[1].answer, 'Saved design');
  $('close-check').click(); $('challenge-decisions').click(); await until(() => $('project-paths') && !$('project-read').disabled, 'new empty selection');
  assert.equal($('project-paths').value, ''); assert.ok(!$('research-review-prompt').textContent.includes('REFRESHED-UI-CANARY'));
  $('research-review-close').click(); assert.equal(editor.value, 'Keep my draft');
});
test('challenge start rejected during an ordinary check preserves the original cancel identity', async t => {
  let release, calls = 0;
  const f = await fixture(t, 340, undefined, false, { checkHelper: { run() { calls++; return new Promise(resolve => { release = () => resolve({ findings: [] }); }); }, close() {} }, before: async explorer => {
    const doc = structuredClone(explorer.doc); doc.nodes[1].answer = 'Saved'; await explorer.save(doc);
  } }), $ = id => f.document.getElementById(id);
  $('check-answers').click(); await until(() => !$('run-check').disabled, 'ordinary check ready');
  $('run-check').click(); await until(() => f.explorer.checkWork?.status === 'pending' && !$('cancel-check').disabled, 'ordinary pending');
  try {
    const id = f.explorer.checkWork.id;
    $('review-challenge').click(); await until(() => !$('research-review-start').disabled, 'challenge selection ready');
    $('research-review-start').click(); await until(() => $('research-review-status').textContent.includes('Cancel the running'), 'start rejected');
    $('research-review-close').click(); $('check-answers').click();
    await until(() => !$('cancel-check').hidden && !$('cancel-check').disabled, 'original cancellation retained');
    $('cancel-check').click(); await until(() => f.explorer.checkWork === null, 'original request cancelled');
    assert.equal(calls, 1); assert.ok(id);
  } finally { release?.(); }
});

test('answer check HTTP UI keeps drafts, renders plain text, dismisses locally and reveals an out-of-focus source', async t => {
  let captured;
  const f = await fixture(t, 340, undefined, false, { checkHelper: { async run(prepared) {
    captured = prepared;
    return parseAnswerCheck(JSON.stringify({ findings: [{ id: 'tension', category: 'possible-tension',
      explanation: 'Possible <script> conflict; not proof.', resolution: 'Ask which saved choice applies.',
      sources: [{ kind: 'node', id: prepared.dependencies.records[1].id }, { kind: 'node', id: prepared.dependencies.records[2].id }] }] }), prepared);
  }, close() {} } }), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Unsaved answer draft');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'check draft saved');
  const first = f.explorer.doc.nodes[1].id, second = f.explorer.doc.nodes[2].id;
  $('focus-branch').click(); assert.match($('focus-status').textContent, /Focusing branch/);
  $('implementation-handoff').click(); await until(() => $('brief-dialog').open, 'handoff opened before check');
  $('close-brief').click();
  $('check-answers').click(); await until(() => $('check-dialog').open && !$('run-check').disabled, 'check dialog ready');
  $('run-check').click(); await until(() => $('check-content').textContent.includes('Possible <script> conflict'), 'check result');
  assert.match($('check-status').textContent, /Journey summary:/);
  assert.ok(!$('check-status').textContent.includes('handoff scope'));
  assert.ok(captured); assert.ok(!captured.prompt.includes('Unsaved answer draft')); assert.equal(captured.context.targetId, f.explorer.doc.rootId);
  assert.equal($('check-content').querySelector('script'), null); assert.equal(f.explorer.doc.nodes.find(node => node.id === first).answer, '');
  $('check-content').querySelector('button:last-child').click(); await until(() => $('check-content').textContent.includes('Dismissed in this canvas.'), 'dismissal');
  assert.equal(f.document.activeElement.dataset.dismissedFinding, 'tension');
  await delay(1350); assert.match($('check-content').textContent, /Dismissed in this canvas/);
  const jump = [...$('check-content').querySelectorAll('.reference-jump')].find(button => button.textContent.includes(f.explorer.doc.nodes[2].question));
  jump.click(); assert.equal($('check-dialog').open, false); assert.equal($('node-workspace').dataset.nodeId, second);
  assert.equal($('focus-status').textContent, '');
  f.open(first); assert.equal($('answer').value, 'Unsaved answer draft');
  $('check-answers').click(); await until(() => $('check-content').textContent.includes('Dismissed in this canvas.'), 'dismissal retained after navigation');
});

test('another canvas replacing historical accepted brief preserves fresh proposal editor text and caret over HTTP', async t => {
 const synthesis = prepared => parseBrief(JSON.stringify({ goal: [{ id: 'goal', text: 'Original proposal', certainty: 'user-statement', sources: [{ kind: 'guidance', field: 'topic' }] }], decisions: [], constraints: [], assumptions: [], unresolved: [{ id: 'open', text: 'Still unresolved', certainty: 'uncertain', sources: [{ kind: 'node', id: prepared.dependencies.records[1].id }] }], nextSteps: [] }), prepared);
 const helper = { async run(prepared) { return synthesis(prepared); }, close() {} };
 const { prepareBrief, acceptBrief } = await import('../com.github.copilot/extensions/explorer/decision-brief.mjs');
 const f = await fixture(t, 340, undefined, false, { briefHelper: helper, before: async explorer => {
  const historical = acceptBrief(synthesis(prepareBrief(explorer.doc)), []);
  const oldId = historical.sections.unresolved[0].sources[0].id;
  historical.sections.unresolved[0].sources[0].id = 'historical-unavailable-node';
  historical.dependencies.records.find(record => record.id === oldId).id = 'historical-unavailable-node';
  await explorer.save({ ...explorer.doc, brief: historical });
 } }), $ = id => f.document.getElementById(id);
 $('decision-brief').click(); await until(() => !$('generate-brief').disabled && $('brief-status').textContent.includes('stale'), 'historical brief loaded');
 assert.match($('brief-content').textContent, /Historical source unavailable/);
 $('generate-brief').click(); await until(() => !$('accept-brief').hidden && !$('accept-brief').disabled, 'fresh proposal');
 const editor = $('brief-content').querySelector('[data-brief-statement="goal"]');
 editor.value = 'Unsaved reviewed wording \u03bb'; editor.dispatchEvent(new f.window.Event('input', { bubbles: true }));
 editor.focus(); editor.setSelectionRange(4, 11);
 const other = await new Explorer({ file: f.explorer.file, briefHelper: helper }).load();
 const server = await startServer(other, { close() {} }); t.after(() => server.close());
 const request = { id: 'external-brief-request-00001', journey: other.doc.id };
 const post = body => fetch(server.url + 'api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1', Origin: new URL(server.url).origin }, body: JSON.stringify(body) });
 assert.equal((await post({ ...request, action: 'start' })).status, 200); await other.toolFreeTask;
 assert.equal((await post({ ...request, action: 'accept', revision: other.doc.revision, edits: [] })).status, 200);
 let observed = false; const originalFetch = f.window.fetch;
 f.window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (args[0] === 'api/brief') {
   const value = await response.clone().json();
   if (value.status === 'proposal' && value.unavailableSources?.length === 0) observed = true;
  }
  return response;
 };
 await until(() => observed && !$('accept-brief').disabled, 'fresh proposal polled after external acceptance');
 assert.equal($('brief-content').querySelector('[data-brief-statement="goal"]'), editor);
 assert.equal(editor.value, 'Unsaved reviewed wording \u03bb'); assert.equal(editor.selectionStart, 4); assert.equal(editor.selectionEnd, 11); assert.equal(f.document.activeElement, editor);
 $('refresh-brief').click(); await until(() => f.explorer.doc.revision === other.doc.revision && !$('accept-brief').disabled, 'current revision refreshed');
 assert.equal($('brief-content').querySelector('[data-brief-statement="goal"]'), editor);
 $('accept-brief').click(); await until(() => f.explorer.doc.brief.sections.goal[0].text === 'Unsaved reviewed wording \u03bb', 'retained text accepted');
 assert.equal(f.explorer.doc.brief.sections.goal[0].edited, true);
});


test('same-node updates keep connected editors and bounded listeners, and detached actions cannot target a later selection', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), [a, b] = f.explorer.doc.nodes.slice(1);
  f.open(a.id); f.type('answer', 'Recoverable draft');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'draft durable');
  await f.poll();
  const answer = $('answer'), form = answer.closest('form'), save = $('save-answer'), manual = $('manual-question');
  const sibling = [...$('nodes').children].find(e => e.dataset.nodeId === b.id);
  const mutations = [], observer = new f.window.MutationObserver(records => mutations.push(...records)); observer.observe($('node-workspace'), { childList: true, subtree: true });
  answer.focus(); answer.setSelectionRange(2, 8, 'backward'); answer.scrollTop = 90; manual.value = 'Local direction'; manual.dispatchEvent(new f.window.Event('input'));
  let listeners = 0;
  const listen = f.window.EventTarget.prototype.addEventListener;
  f.window.EventTarget.prototype.addEventListener = function (...args) { listeners++; return listen.apply(this, args); };
  for (let i = 0; i < 20; i++) f.window.__updates.workspace();
  f.window.EventTarget.prototype.addEventListener = listen;
  assert.equal(listeners, 0, 'unchanged workspace adds no listeners');
  for (let i = 0; i < 3; i++) {
    await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: b.id, answer: `Sibling ${i}` }); await f.poll();
    assert.equal($('answer'), answer); assert.equal(answer.closest('form'), form); assert.equal($('manual-question'), manual);
    assert.equal(f.document.activeElement, answer); assert.equal(answer.selectionDirection, 'backward'); assert.equal(answer.scrollTop, 90);
    assert.equal([...$('nodes').children].find(e => e.dataset.nodeId === b.id), sibling);
  }
  assert.equal([...mutations, ...observer.takeRecords()].some(record => [...record.removedNodes].some(node => node === answer || node.contains?.(answer))), false, 'editor is never detached, even temporarily'); observer.disconnect();
  const before = f.actions.filter(a => a.action === 'answer').length; save.click();
  await until(() => f.explorer.doc.nodes.find(n => n.id === a.id).answer === 'Recoverable draft', 'one save');
  assert.equal(f.actions.filter(a => a.action === 'answer').length, before + 1);
  f.open(b.id); f.open(a.id);
  const replacement = $('answer'), actionCount = f.actions.length;
  answer.value = 'Detached stale input'; answer.dispatchEvent(new f.window.Event('input')); save.click();
  form.dispatchEvent(new f.window.Event('submit', { cancelable: true }));
  await delay(30); assert.equal(f.actions.length, actionCount); assert.equal(replacement.value, 'Recoverable draft');
});

test('hidden Outline does no DOM work on selection, visible content refreshes without losing search focus or scroll', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), [a, b] = f.explorer.doc.nodes.slice(1);
  assert.equal($('outline-list').children.length, 0);
  f.open(a.id); f.open(b.id); assert.equal($('outline-list').children.length, 0);
  $('outline-toggle').click(); assert.equal($('outline-list').querySelectorAll('.outline-row').length, 3);
  f.type('search', 'borrow'); const row = $('outline-list').firstChild;
  $('search').focus(); $('outline-list').scrollTop = 40;
  await f.poll(); assert.equal($('outline-list').firstChild, row);
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: a.id, answer: 'New saved answer' }); await f.poll();
  assert.equal($('search').value, 'borrow'); assert.equal(f.document.activeElement, $('search')); assert.equal($('outline-list').scrollTop, 40);
  $('outline-toggle').click(); const hiddenRow = $('outline-list').firstChild;
  f.open(a.id); f.open(b.id); assert.equal($('outline-list').firstChild, hiddenRow);
});

test('removed selected question disposes its editor and returns focus while retaining recoverable text', async t => {
  const f = await fixture(t), $ = id => f.document.getElementById(id), a = f.explorer.doc.nodes[1];
  f.open(a.id); f.type('answer', 'Keep this removed-node draft');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'draft durable');
  const answer = $('answer'); answer.focus();
  const next = structuredClone(f.explorer.doc); next.nodes = next.nodes.filter(n => n.id !== a.id);
  await f.explorer.save(next, 'Remove a question'); await f.poll();
  assert.equal(answer.isConnected, false); assert.equal($('answer'), null);
  assert.equal(f.document.activeElement.dataset.nodeId, f.explorer.doc.rootId);
  await until(() => $('orphan-drafts').textContent.includes('Draft for a removed question'), 'recoverable removed draft');
  assert.equal($('orphan-drafts').querySelector('textarea').value, 'Keep this removed-node draft');
});


test('preview and manual composition editors remain connected across Outline switches when the current batch becomes stale', async t => {
  const f = await fixture(t, 340, undefined, false, { preview: true }), $ = id => f.document.getElementById(id);
  const candidate = $('candidate-question-0'), manual = $('manual-question');
  f.type(candidate.id, 'My adjusted wording'); candidate.focus(); candidate.setSelectionRange(3, 9, 'backward'); candidate.scrollTop = 24;
  candidate.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  $('outline-toggle').click(); $('outline-toggle').click(); $('outline-toggle').click();
  assert.equal($('candidate-question-0'), candidate); assert.equal(f.document.activeElement, candidate);
  const mutations = [], observer = new f.window.MutationObserver(records => mutations.push(...records)); observer.observe($('node-workspace'), { childList: true, subtree: true });
  const next = structuredClone(f.explorer.doc); next.objective = 'Changed objective'; await f.explorer.save(next, 'Changed objective'); await f.poll();
  assert.equal($('candidate-question-0'), candidate); assert.equal(candidate.value, 'My adjusted wording'); assert.equal(candidate.selectionDirection, 'backward'); assert.equal(candidate.scrollTop, 24);
  assert.equal($('manual-question'), manual); assert.equal(f.document.activeElement, candidate); assert.equal($('accept-questions').disabled, true);
  candidate.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  manual.focus(); manual.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true })); f.type('manual-question', 'Composed direction');
  for (let i = 0; i < 3; i++) { $('outline-toggle').click(); f.window.__updates.workspace(); }
  manual.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  assert.equal($('manual-question'), manual); assert.equal(manual.value, 'Composed direction'); assert.equal(f.document.activeElement, manual);
  assert.equal([...mutations, ...observer.takeRecords()].some(record => [...record.removedNodes].some(node => [candidate, manual].some(editor => node === editor || node.contains?.(editor)))), false); observer.disconnect();
});


test('library row moves preserve keyboard action focus and visible scroll, with a surviving-row fallback', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id);
  await f.explorer.library.import(createDocument('Second journey')); $('library-toggle').click();
  await until(() => f.document.querySelectorAll('.library-entry').length === 2, 'two journeys');
  const row = $('library-list').lastElementChild, pin = row.querySelector('[data-action="pin"]');
  $('welcome').scrollTop = 120; pin.focus(); pin.click();
  await until(() => pin.textContent === 'Unpin', 'pin moves row'); assert.equal(f.document.activeElement, pin); assert.equal($('welcome').scrollTop, 120);
  pin.click(); await until(() => pin.textContent === 'Pin', 'unpin'); assert.equal(f.document.activeElement, pin); assert.equal($('welcome').scrollTop, 120);
  const archive = row.querySelector('[data-action="archive"]'); archive.focus(); archive.click();
  await until(() => !row.isConnected, 'archive removes row');
  assert.equal(f.document.activeElement, $('library-list').querySelector('[data-action="archive"]')); assert.equal($('welcome').scrollTop, 120);
});

test('large-map culling retains the focused compact owner then releases it and reveals before focus', async t => {
  const source = makeFixture(fixtureSpecs.find(spec => spec.name === 'near5000-deep')).document;
  const f = await fixture(t, 340, undefined, false, { before: explorer => { explorer.doc = structuredClone(source); } });
  const d = f.document, ui = f.window.__updates;
  ui.setView({ x: 170, y: 16, zoom: 1 });
  const mounted = () => d.querySelectorAll('#nodes [data-node-id]').length;
  assert.ok(mounted() < 10, 'offscreen compact contents are not mounted');
  assert.equal(f.explorer.doc.nodes.length, 4950);
  const root = d.querySelector('#nodes [data-node-id="node-0"]');
  root.focus();
  const geometry = ui.scene().positions;
  ui.setView({ x: 170, y: -50000, zoom: 1 });
  assert.equal(d.activeElement, root); assert.equal(root.isConnected, true, 'focused card survives pan');
  assert.equal(ui.scene().positions, geometry, 'pan reuses geometry');
  ui.refresh(); assert.equal(ui.scene().positions, geometry, 'stable refresh reuses geometry');
  d.getElementById('map').focus(); await delay(0);
  assert.equal(root.isConnected, false, 'focus retention is bounded to the current owner');
  ui.reveal('node-1');
  const branch = d.querySelector('#nodes [data-branch-id="node-1"]'); branch.focus();
  ui.setView({ x: 170, y: -60000, zoom: 1 });
  assert.equal(d.activeElement, branch); assert.equal(branch.isConnected, true, 'branch control survives pan');
  d.getElementById('map').focus(); await delay(0);
  assert.equal(branch.isConnected, false, 'old branch control is released');
  ui.reveal('node-4949');
  const target = d.querySelector('#nodes [data-node-id="node-4949"]');
  assert.ok(target?.isConnected, 'reveal mounts synchronously before focus');
  target.focus(); assert.equal(d.activeElement, target);
  ui.select('node-4949');
  const answer = d.getElementById('answer'); answer.value = 'Unsaved answer'; answer.focus();
  ui.setView({ x: -10000, y: 16, zoom: 3 });
  assert.equal(d.getElementById('answer'), answer); assert.equal(answer.isConnected, true);
  assert.equal(answer.value, 'Unsaved answer'); assert.equal(ui.scene().selected, 'node-4949');
  assert.ok(mounted() < 10);
  ui.reveal('node-4949');
  const view = ui.scene().view, box = ui.scene().positions.get('node-4949');
  assert.ok(view.x + box.x * view.zoom >= 15);
  assert.ok(view.y + box.y * view.zoom >= 15);
  d.getElementById('outline-toggle').click();
  assert.equal(d.querySelectorAll('#outline-list .outline-row').length, 200, 'Outline mounts one bounded page despite the complete logical map');
  assert.match(d.getElementById('outline-count').textContent, /4950 matching nodes/, 'full logical count survives culling');
  f.type('search', 'Question 4949:');
  assert.ok(d.querySelector('#outline-list [data-node-id="node-4949"]'), 'distant logical node remains searchable despite map culling and result paging');
});

test('large-map geometry invalidates on resize, fonts, expansion, history and journey and releases observers', async t => {
  const source = makeFixture(fixtureSpecs.find(spec => spec.name === 'medium-wide')).document;
  const f = await fixture(t, 1100, undefined, false, { before: explorer => { explorer.doc = structuredClone(source); } });
  const d = f.document, ui = f.window.__updates;
  ui.setView({ x: 550, y: 16, zoom: 1 });
  const first = ui.scene().positions;
  f.resize(340); assert.notEqual(ui.scene().positions, first);
  let previous = ui.scene().positions;
  d.fonts.dispatchEvent(new f.window.Event('loadingdone')); await delay(30);
  assert.notEqual(ui.scene().positions, previous, 'fonts invalidate');
  previous = ui.scene().positions; ui.select('node-1');
  assert.notEqual(ui.scene().positions, previous, 'expansion changes geometry');
  const editor = d.getElementById('answer');
  previous = ui.scene().positions; f.resizeWorkspace(220); await delay(30);
  assert.notEqual(ui.scene().positions, previous, 'measured panel height invalidates geometry');
  assert.equal(ui.scene().positions.get('node-1').height, 220);
  const next = structuredClone(source); next.revision++;
  next.nodes = next.nodes.filter(n => Number(n.id.slice(5)) < 8);
  ui.apply({ document: next, error: '', pending: null });
  assert.equal(d.getElementById('answer'), editor);
  assert.equal(ui.scene().positions.size, 8, 'history replacement drops stale geometry');
  const current = ui.scene().geometry;
  ui.apply({ document: { ...structuredClone(next), id: 'replacement-journey' }, error: '', pending: null });
  assert.notEqual(ui.scene().geometry, current, 'new journey never reuses old cache');
  assert.equal(editor.isConnected, false);
  const focus = d.querySelector('#nodes [data-node-id="node-1"]'); focus.focus();
  ui.apply({ document: { ...next, id: 'replacement-journey', revision: 3, nodes: [next.nodes[0]] }, error: '', pending: null });
  assert.notEqual(d.activeElement, d.body, 'logical removal transfers keyboard focus');
  f.window.dispatchEvent(new f.window.Event('pagehide'));
  assert.equal(ui.scene().geometry, null); assert.equal(ui.scene().positions.size, 0);
  assert.equal(f.observers.size, 0, 'map and workspace observers disconnect');
  d.fonts.dispatchEvent(new f.window.Event('loadingdone')); await delay(30);
  assert.equal(ui.scene().geometry, null, 'closed scene cannot be recreated by fonts');
});

test('large-map near-limit long-text cards stay bounded through zoom, folds and full-map recovery', async t => {
  const source = makeFixture(fixtureSpecs.find(spec => spec.name === 'near9mib-wide')).document;
  const f = await fixture(t, 340, undefined, false, { before: explorer => { explorer.doc = structuredClone(source); } });
  const d = f.document, ui = f.window.__updates;
  assert.equal(d.querySelectorAll('#nodes [data-node-id]').length, 4950, 'initial Fit includes the whole valid map');
  ui.select('node-4949');
  const editor = d.getElementById('answer'), positions = ui.scene().positions;
  assert.ok(d.querySelectorAll('#nodes [data-node-id]').length < 20);
  assert.ok(d.querySelectorAll('#edges path').length < 100);
  for (const zoom of [.1, 1, 3]) {
    ui.setView({ x: -10000, y: -1000, zoom });
    assert.ok(Number.isFinite(ui.scene().positions.get('node-4949').width));
    assert.equal(d.getElementById('answer'), editor);
  }
  ui.select('node-7');
  d.getElementById('focus-branch').click();
  const focusedCount = ui.scene().positions.size;
  assert.ok(focusedCount < 4950);
  d.getElementById('branch-workspace').click();
  assert.ok(ui.scene().positions.size < focusedCount);
  d.getElementById('branch-workspace').click();
  assert.equal(ui.scene().positions.size, focusedCount);
  d.getElementById('show-whole-map').click();
  d.getElementById('collapse-node').click(); d.getElementById('fit').click();
  assert.equal(d.querySelectorAll('#nodes [data-node-id]').length, 4950);
  assert.equal(d.querySelectorAll('#edges path').length, 4949);
  const fitZoom = ui.scene().view.zoom;
  for (let i = 0; i < 3; i++) { d.getElementById('fit').click(); assert.equal(ui.scene().view.zoom, fitZoom); }
  for (const box of ui.scene().positions.values()) {
    const v = ui.scene().view;
    assert.ok(v.x + box.x * v.zoom >= 0 && v.x + (box.x + box.width) * v.zoom <= 340);
    assert.ok(v.y + box.y * v.zoom >= 0 && v.y + (box.y + box.height) * v.zoom <= 720);
  }
  ui.select('node-4949'); const reopened = d.getElementById('answer');
  ui.zoom(.00000001); const extreme = ui.scene();
  assert.equal(extreme.view.zoom, fitZoom);
  for (const box of extreme.positions.values()) for (const field of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(box[field]));
  assert.ok(Math.abs(extreme.positions.get('node-4949').width * extreme.view.zoom - 308) < 1e-7);
  ui.reveal('node-4949'); assert.equal(d.getElementById('answer'), reopened);
  d.getElementById('map').focus(); d.getElementById('map').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  assert.equal(ui.scene().expanded, false); assert.equal(ui.scene().view.zoom, fitZoom);
  assert.equal(d.querySelectorAll('#nodes [data-node-id]').length, 4950);
  d.getElementById('outline-toggle').click();
  f.type('search', 'Question 4949:');
  d.querySelector('#outline-list [data-node-id="node-4949"]').click();
  assert.equal(ui.scene().view.zoom, 1); assert.equal(d.getElementById('answer'), reopened, 'full source reveal reuses the hidden editor');
  assert.equal(d.activeElement.id, 'expanded-title');
  assert.equal(JSON.stringify(f.explorer.doc), JSON.stringify(source), 'rendering never edits logical content');
});

test('large-map journey replacement transfers a compact control focus to the new map', async t => {
  const f = await fixture(t), d = f.document, ui = f.window.__updates;
  const card = d.querySelector('#nodes [data-node-id]'); card.focus();
  const next = structuredClone(f.explorer.doc); next.id = 'new-journey';
  ui.apply({ document: next, error: '', pending: null });
  assert.equal(card.isConnected, false);
  assert.equal(d.activeElement.id, 'map', 'removed compact owner has an explicit surviving focus target');
});

test('Outline folding an offscreen ancestor reveals and mounts the moved selection before focusing it', async t => {
  const f = await fixture(t, 340, undefined, false, { before: explorer => {
    for (const [index, top] of explorer.doc.nodes.slice(1).entries()) {
      let parentId = top.id;
      for (let depth = 1; depth < 30; depth++) {
        const id = `chain-${index}-${depth}`;
        explorer.doc.nodes.push({ ...top, id, parentId, question: `Branch ${index}, depth ${depth}` });
        parentId = id;
      }
    }
  } });
  const d = f.document, ui = f.window.__updates, ancestor = f.explorer.doc.nodes[1], leaf = 'chain-0-29';
  f.open(leaf); f.type('answer', 'Keep this deep draft'); chooseState(f, 'assumption');
  await until(() => d.getElementById('answer-status').textContent === 'Draft saved locally', 'deep draft persisted');
  const logical = JSON.stringify(f.explorer.doc);
  assert.equal(d.querySelector(`#nodes [data-node-id="${ancestor.id}"]`), null, 'ancestor starts outside mounted viewport');
  const before = ui.scene(), box = before.positions.get(ancestor.id);
  assert.ok(before.view.y + (box.y + box.height) * before.view.zoom < 0, 'ancestor is above the viewport');
  d.getElementById('outline-toggle').click();
  const fold = d.querySelector(`#outline-list [data-branch-id="${ancestor.id}"]`);
  fold.focus(); fold.click();
  const target = d.querySelector(`#outline-list [data-node-id="${ancestor.id}"]`);
  assert.ok(target?.isConnected, 'fold mounts the replacement selection in Outline');
  assert.equal(d.activeElement, target, 'focus transfers to the revealed ancestor row');
  assert.equal(ui.scene().selected, ancestor.id);
  assert.equal(d.getElementById('node-workspace').hidden, true);
  assert.equal(ui.scene().positions.has('chain-1-29'), true, 'hidden map geometry is retained without rebuilding');
  assert.equal(JSON.stringify(f.explorer.doc), logical, 'fold and reveal do not change logical data');
  f.type('search', 'Branch 0, depth 29');
  d.querySelector(`#outline-list [data-node-id="${leaf}"]`).click();
  assert.equal(d.getElementById('answer').value, 'Keep this deep draft', 'unfolded path recovers the draft');
  assert.equal(d.getElementById('answer-state').value, 'assumption');
  assert.equal(d.activeElement.id, 'expanded-title');
  assert.equal(JSON.stringify(f.explorer.doc), logical, 'draft recovery remains separate from saved answers');
});

test('conditional polling skips map work but checks retained help and recovers connection gaps with a full snapshot', async t => {
  const f = await fixture(t, 340, undefined, false, { questionHelper: { run: async () => 'Retained explanation', close() {} } });
  const $ = id => f.document.getElementById(id); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Local draft');
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'draft');
  $('help-rephrase').click(); await until(() => $('question-help-results').textContent.includes('Retained explanation'), 'help');
  await f.poll();
  const original = f.window.fetch; let checks = 0, polls = [], fail = false, parsed = 0;
  f.window.fetch = async (path, options) => {
    if (path === 'api/question-help' && JSON.parse(options.body).action === 'check') checks++;
    if (path === 'api/state' && fail) throw new Error('offline');
    const response = await original(path, options);
    if (path === 'api/state') { polls.push({ cursor: options?.headers?.['X-Explorer-State'], status: response.status }); const json = response.json.bind(response); response.json = () => { parsed++; return json(); }; }
    return response;
  };
  const editor = $('answer'), geometry = f.window.__updates.scene().geometry;
  await f.poll(); assert.equal(polls.at(-1).status, 204); assert.equal(parsed, 0); assert.ok(checks > 0);
  assert.equal($('answer'), editor); assert.equal(f.window.__updates.scene().geometry, geometry);
  fail = true; await f.poll(); assert.match($('connection-status').textContent, /Reconnecting/); assert.equal(editor.value, 'Local draft');
  fail = false; f.explorer.error = 'Transient change during gap'; await f.poll();
  assert.equal(polls.at(-1).cursor, undefined); assert.equal(polls.at(-1).status, 200); assert.equal($('connection-status').hidden, true);
  assert.equal(editor.value, 'Local draft'); assert.equal($('answer'), editor); assert.match($('notice').textContent, /Transient change/);
});

test('conditional polling aborts old page epochs and resumes one full loop after persisted pagehide', async t => {
  const f = await fixture(t); await f.poll(); const original = f.window.fetch; let held, calls = 0;
  f.window.fetch = async (path, options) => {
    if (path !== 'api/state') return original(path, options);
    calls++;
    if (!held) return new Promise(resolve => { held = { resolve, signal: options?.signal }; });
    return original(path, options);
  };
  const old = f.poll(); await until(() => held, 'held state request');
  const hide = new f.window.Event('pagehide'); Object.defineProperty(hide, 'persisted', { value: true }); f.window.dispatchEvent(hide);
  assert.equal(held.signal?.aborted, true); const count = calls; await f.poll(); assert.equal(calls, count);
  f.explorer.error = 'Fresh after resume'; const show = new f.window.Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true }); f.window.dispatchEvent(show);
  await until(() => f.document.getElementById('notice').textContent === 'Fresh after resume', 'full resume');
  held.resolve(new Response(JSON.stringify({ ...f.explorer.uiSnapshot(), error: 'Obsolete response' }), { headers: { 'X-Explorer-State': '00000000-0000-4000-8000-000000000000' } })); await old;
  assert.equal(f.document.getElementById('notice').textContent, 'Fresh after resume');
  f.window.dispatchEvent(new f.window.Event('pagehide')); const closedCalls = calls; await f.poll(); f.window.dispatchEvent(show); assert.equal(calls, closedCalls);
});

test('persisted app resume restarts exactly one voice loop, saves and acknowledges chunks and rejects old audio', async t => {
  const voice = segmentedVoiceFixture(), timers = new Map(); let timerId = 0, polls = 0, starts = 0;
  const start = voice.start, poll = voice.poll;
  voice.start = id => { starts++; return start(id); };
  voice.poll = id => { polls++; return poll(id); };
  const f = await fixture(t, 340, voice, false, { beforeApp: window => {
    window.setInterval = callback => { timers.set(++timerId, callback); return timerId; };
    window.clearInterval = id => timers.delete(id);
  } }), $ = id => f.document.getElementById(id);
  const event = (name, persisted) => f.window.dispatchEvent(new f.window.PageTransitionEvent(name, { persisted }));
  const tick = async () => { await Promise.all([...timers.values()].map(callback => callback())); };
  f.open(f.explorer.doc.nodes[1].id); const answer = $('answer'); answer.focus();
  await until(() => !$('voice-record').disabled, 'voice ready');
  $('voice-record').click(); await until(() => starts === 1 && !$('voice-stop').disabled, 'old recording listening');
  await tick(); assert.equal(polls, 1);
  let held, release; const gate = new Promise(resolve => { release = resolve; });
  f.pauseVoicePoll(() => { held = true; return gate; });
  voice.publish(1, 'LATE_OLD_AUDIO'); const oldPoll = tick();
  await until(() => held, 'old segment held after HTTP response');
  event('pagehide', true); assert.equal(timers.size, 0);
  await until(() => voice.counts().cancels === 1, 'suspension cancels capture');
  f.pauseVoicePoll(null);
  try {
    event('pageshow', false); assert.equal(timers.size, 0, 'only persisted resume restarts');
    event('pageshow', true); event('pageshow', true); event('pageshow', true);
    assert.equal(timers.size, 1, 'one voice poll loop after repeated resume');
    $('outline-toggle').click(); assert.equal($('answer'), answer);
    $('voice-record').click(); await until(() => starts === 2 && !$('voice-stop').disabled, 'resumed recording listening');
    release(); await oldPoll;
    assert.equal(answer.value, ''); assert.deepEqual(voice.counts().acknowledgments, []);
    assert.equal($('voice-stop').disabled, false, 'late old response does not cancel the new capture');
    voice.publish(1, 'New resumed speech 🌱'); await tick();
    await until(() => voice.counts().acknowledgments.length === 1, 'saved segment acknowledged');
    assert.equal(answer.value, 'New resumed speech 🌱'); assert.deepEqual(voice.counts().acknowledgments, [1]);
    const drafts = await f.explorer.readDrafts(f.explorer.doc.id);
    assert.equal(drafts.entries.find(entry => entry.nodeId === f.explorer.doc.nodes[1].id).text, answer.value);
    const heartbeats = polls; await tick(); await tick(); assert.equal(polls, heartbeats + 2);
    $('voice-stop').click(); await until(() => !$('voice-record').disabled, 'resumed recording finished');
    $('voice-record').click(); await until(() => starts === 3, 'terminal capture started');
    event('pagehide', false); await until(() => voice.counts().cancels === 2, 'terminal capture cancelled');
    assert.equal(timers.size, 0); event('pageshow', true); assert.equal(timers.size, 0);
    $('voice-record').click(); await tick(); await delay(20); assert.equal(starts, 3, 'disposed owner cannot record again');
    assert.equal($('answer'), answer); assert.equal(answer.value, 'New resumed speech 🌱');
  } finally { release(); await oldPoll; }
});

test('direction review action shares the Map and Outline editor and preserves descendant drafts', async t => {
  let directionId, childId;
  const f = await fixture(t, 340, undefined, false, { before: async e => {
    const command = (action, input = {}) => e.command(action, { revision: e.doc.revision, ...input });
    const parentId = e.doc.nodes[1].id;
    await command('answer', { nodeId: parentId, answer: 'Us' });
    await command('add-direction', { nodeId: parentId, direction: 'Safety' }); await command('cancel');
    directionId = e.doc.nodes.at(-1).id;
    await command('add', { nodeId: directionId, question: 'Safe enough?', category: 'Safety' }); childId = e.doc.nodes.at(-1).id;
    await command('answer', { nodeId: parentId, answer: 'Everyone' });
  } }), $ = id => f.document.getElementById(id);
  f.window.__updates.select(childId); f.type('answer', 'Unsaved exact child 🌱'); f.type('revisit-condition', 'Keep reminder');
  f.window.__updates.select(directionId); f.type('manual-question', 'Keep direction draft');
  const panel = $('node-workspace'), manual = $('manual-question'), ack = $('acknowledge-direction');
  assert.ok(ack, 'needs-review direction exposes an explicit acknowledgment'); assert.equal($('answer'), null);
  $('outline-toggle').click(); assert.equal($('node-workspace'), panel); assert.equal($('manual-question'), manual); assert.equal($('acknowledge-direction'), ack);
  ack.click(); await until(() => !f.explorer.doc.nodes.find(n => n.id === directionId).review && !$('acknowledge-direction'), 'direction review saved');
  assert.equal(f.actions.filter(a => a.action === 'acknowledge-direction').length, 1);
  assert.equal($('manual-question'), manual); assert.equal(manual.value, 'Keep direction draft');
  assert.equal(f.explorer.doc.nodes.find(n => n.id === childId).review, true);
  $('outline-toggle').click(); assert.equal($('node-workspace'), panel); assert.equal($('acknowledge-direction'), null);
  f.window.__updates.select(childId); assert.equal($('answer').value, 'Unsaved exact child 🌱'); assert.equal($('revisit-condition').value, 'Keep reminder');
  assert.match($('node-workspace').textContent, /An earlier answer changed/);
});

test('conditional polling bounds timeouts and retry delays without replaying failed actions', async t => {
  const f = await fixture(t); await f.poll(); const original = f.window.fetch, timer = f.window.setTimeout.bind(f.window);
  let deadline, delays = [], actionCalls = 0, timedSignal;
  f.window.setTimeout = (fn, ms, ...args) => { if (ms === 8000) deadline = fn; if ([2400, 4800, 9600, 15000].includes(ms)) delays.push(ms); return timer(fn, ms, ...args); };
  f.window.fetch = (path, options) => {
    if (path === 'api/action') { actionCalls++; return Promise.reject(new Error('offline action')); }
    if (path === 'api/state') return new Promise((_, reject) => { timedSignal = options.signal; options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }); });
    return original(path, options);
  };
  for (let i = 0; i < 5; i++) { const work = f.poll(); deadline(); await work; assert.equal(timedSignal.aborted, true); }
  assert.deepEqual(delays, [2400, 4800, 9600, 15000, 15000]);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Keep this through disconnect'); f.click('Save & continue');
  await until(() => actionCalls === 1, 'explicit failed action'); await delay(0);
  f.window.fetch = async (path, options) => { if (path === 'api/action') actionCalls++; return original(path, options); };
  await f.poll(); await f.poll(); assert.equal(actionCalls, 1); assert.equal(f.document.getElementById('answer').value, 'Keep this through disconnect');
});

test('late action response from a hidden page cannot replace the reconnected map or draft', async t => {
  const f = await fixture(t); f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Explicit saved answer');
  const original = f.window.fetch; let held;
  f.window.fetch = async (path, options) => { const response = await original(path, options); if (path === 'api/action') return new Promise(resolve => { held = () => resolve(response); }); return response; };
  f.click('Save & continue'); await until(() => held, 'held action after commit');
  const hide = new f.window.Event('pagehide'); Object.defineProperty(hide, 'persisted', { value: true }); f.window.dispatchEvent(hide);
  f.explorer.error = 'Newer state after action'; const show = new f.window.Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true }); f.window.dispatchEvent(show);
  await until(() => f.document.getElementById('notice').textContent === 'Newer state after action', 'new epoch snapshot');
  held(); await delay(20); assert.equal(f.document.getElementById('notice').textContent, 'Newer state after action');
  assert.equal(f.document.getElementById('answer').value, 'Explicit saved answer');
});

test('brief acceptance rejects a pre-action poll snapshot and closes its pending read on pagehide', async t => {
  const f = await fixture(t, 340, undefined, false, { briefHelper: { async run(prepared) { return parseBrief(JSON.stringify({ goal: [{ id: 'g', text: 'Review goal', certainty: 'user-statement', sources: [{ kind: 'guidance', field: 'topic' }] }], decisions: [], constraints: [], assumptions: [], unresolved: [], nextSteps: [] }), prepared); }, close() {} } });
  const $ = id => f.document.getElementById(id); $('decision-brief').click(); await until(() => !$('generate-brief').disabled, 'brief ready'); $('generate-brief').click(); await until(() => !$('accept-brief').hidden && !$('accept-brief').disabled, 'proposal');
  const original = f.window.fetch; let held, briefRead;
  f.explorer.error = 'Before acceptance';
  f.window.fetch = async (path, options) => {
    const response = await original(path, options);
    if (path === 'api/state' && !held) return new Promise(resolve => { held = () => resolve(response); });
    if (path === 'api/brief' && JSON.parse(options.body).action === 'poll') briefRead = options.signal;
    return response;
  };
  const old = f.poll(); await until(() => held, 'old full snapshot held'); f.explorer.error = ''; assert.equal($('accept-brief').disabled, false, $('brief-status').textContent); $('accept-brief').click();
  await until(() => f.explorer.doc.brief && !$('accept-brief').disabled, 'accepted snapshot'); held(); await old;
  assert.equal($('notice').textContent, '', 'pre-acceptance state must not replace accepted snapshot');
  await f.poll(); f.window.dispatchEvent(new f.window.Event('pagehide')); assert.equal(briefRead?.aborted, true);
});


test('recovery inspection and failed retry preserve connected draft text, state and caret over HTTP', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id);
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', '  Unsaved recovery text \u{1f33f}  ');
  $('answer-state').value = 'assumption'; $('answer-state').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  await until(() => $('answer-status').textContent === 'Draft saved locally', 'local draft');
  const answer = $('answer'); answer.focus(); answer.setSelectionRange(3, 9);
  assert.ok($('recovery-open')); $('recovery-open').click();
  await until(() => $('recovery-list').querySelector('button'), 'recoverable version');
  $('recovery-list').querySelector('button').click();
  await until(() => !$('recovery-copy').disabled, 'preview ready');
  assert.equal($('answer'), answer); assert.equal(answer.value, '  Unsaved recovery text \u{1f33f}  '); assert.equal(answer.selectionStart, 3); assert.equal($('answer-state').value, 'assumption');
  const original = JSON.stringify(f.explorer.doc);
  await writeFile(f.explorer.file, '{private malformed active');
  $('recovery-retry').click();
  await until(() => $('recovery-status').textContent.includes('could not complete'), 'failed retry');
  assert.equal(JSON.stringify(f.explorer.doc), original); assert.equal($('answer'), answer); assert.equal(answer.selectionStart, 3);
  assert.doesNotMatch($('recovery-status').textContent, /private malformed/);
  $('recovery-close').click(); assert.equal(f.document.activeElement, answer); assert.equal(answer.selectionEnd, 9);
});


test('recovery copy opens only after explicit choice and keeps original saved draft', async t => {
  const f = await fixture(t, 340, undefined, true), $ = id => f.document.getElementById(id), originalKey = f.explorer.activeKey, originalFile = f.explorer.file;
  f.open(f.explorer.doc.nodes[1].id); f.type('answer', 'Preserved original draft');
  $('recovery-open').click(); await until(() => $('recovery-list').querySelector('button'), 'versions');
  $('recovery-list').querySelector('button').click(); await until(() => !$('recovery-copy').disabled, 'preview');
  assert.equal(f.explorer.activeKey, originalKey); const bytes = await readFile(originalFile, 'utf8');
  $('recovery-copy').click(); await until(() => f.explorer.activeKey !== originalKey && !$('recovery-dialog').open, 'new recovery copy');
  assert.equal(await readFile(originalFile, 'utf8'), bytes);
  const saved = JSON.parse(await readFile(join(dirname(originalFile), 'drafts.json'), 'utf8'));
  assert.ok(saved.entries.some(entry => entry.key === originalKey && entry.text === 'Preserved original draft'));
});


test('cold damaged binding reaches recovery controls with no active map and opens a validated separate copy', async t => {
  let originalFile;
  const f = await fixture(t, 340, undefined, true, { cold: true, before: async e => { originalFile = e.file; await writeFile(e.file, '{truncated private'); } }), $ = id => f.document.getElementById(id);
  assert.equal(f.explorer.doc, null); $('recovery-open').click();
  await until(() => $('recovery-list').querySelector('button'), 'cold recovery list');
  $('recovery-list').querySelector('button').click(); await until(() => !$('recovery-copy').disabled, 'cold inspected version');
  assert.equal(f.explorer.doc, null); $('recovery-copy').click();
  await until(() => f.explorer.doc && !$('recovery-dialog').open, 'cold copy opened');
  assert.equal(await readFile(originalFile, 'utf8'), '{truncated private'); assert.notEqual(f.explorer.file, originalFile);
});


test('implementation handoff HTTP UI requires exact selection review, preserves drafts and edits, and copies accepted portable text', async t => {
  let prepared, copied;
  const f = await fixture(t, 340, undefined, false, { briefHelper: { async run(value) {
    prepared = value;
    return parseHandoff(JSON.stringify({ goal: [], decisions: [{ id: 'd', text: 'Choice remains unresolved', certainty: 'user-decision', sources: [{ kind: 'node', id: value.dependencies.records[0].id }] }], constraints: [], assumptions: [], unresolved: [], nextSteps: [{ id: 't', text: 'Consider next step', certainty: 'suggestion', sources: [] }] }), value);
  }, close() {} } });
  const $ = id => f.document.getElementById(id), node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('answer', 'PRIVATE DRAFT \u03bb');
  Object.defineProperty(f.window.navigator, 'clipboard', { value: { async writeText(value) { copied = value; } }, configurable: true });
  $('implementation-handoff').click(); await until(() => $('brief-dialog').open && !$('review-handoff').disabled, 'handoff dialog');
  assert.equal($('handoff-evidence').checked, false); assert.equal($('generate-brief').disabled, true);
  assert.equal($('handoff-sources').querySelectorAll('input:checked').length, 0);
  assert.match($('brief-description').textContent, /project excerpts\/file references\/snapshots/);
  $('handoff-sources').querySelector(`[data-handoff-node="${node.id}"]`).click();
  $('handoff-format').value = 'tasks'; $('handoff-format').dispatchEvent(new f.window.Event('change', { bubbles: true }));
  $('review-handoff').click(); await until(() => !$('handoff-preview').hidden && !$('generate-brief').disabled, 'exact preview');
  const text = $('handoff-preview-text').textContent; assert.ok(text.includes(node.id)); assert.ok(!text.includes('PRIVATE DRAFT'));
  $('handoff-evidence').click(); assert.equal($('generate-brief').disabled, true);
  $('review-handoff').click(); await until(() => !$('generate-brief').disabled, 'changed exact preview');
  $('generate-brief').click(); await until(() => !$('accept-brief').hidden && !$('accept-brief').disabled, 'handoff proposal');
  assert.equal(prepared.context.format, 'tasks'); assert.deepEqual(prepared.dependencies.records.map(r => r.id), [node.id]);
  assert.equal($('answer').value, 'PRIVATE DRAFT \u03bb'); assert.match($('brief-content').textContent, /uncertain/);
  const editor = $('brief-content').querySelector('[data-brief-statement="t"]'); editor.value = 'Exact user \u03bb <img>\nTask'; editor.dispatchEvent(new f.window.Event('input', { bubbles: true })); editor.focus(); editor.setSelectionRange(2, 5);
  await delay(1300); assert.equal($('brief-content').querySelector('[data-brief-statement="t"]'), editor); assert.equal(editor.selectionStart, 2);
  $('accept-brief').click(); await until(() => f.explorer.doc.handoff, 'accepted handoff'); await until(() => !$('copy-handoff').hidden, 'copy available');
  assert.equal(f.explorer.doc.handoff.sections.nextSteps[0].text, editor.value); assert.equal($('answer').value, 'PRIVATE DRAFT \u03bb');
  $('copy-handoff').click(); await until(() => copied, 'copied handoff'); assert.match(copied, /Reviewed implementation tasks/); assert.ok(!copied.includes('<img>')); assert.ok(!copied.includes('PRIVATE DRAFT'));
  assert.equal(f.actions.some(action => ['research', 'research-follow-up'].includes(action.action)), false);
});


test('semantic zoom has hysteretic detail tiers, complete accessible text and stable compact geometry', async t => {
  const question = '\u{1f331}\u6f22\u5b57 e\u0301 <script> literal long question '.repeat(12).trim();
  const f = await fixture(t, 1100, undefined, false, { questions: [{ question, category: 'Scope', importance: 'high', importanceReason: 'Consequence' }, { question: 'Other?', category: 'Trust' }] });
  const ui = f.window.__updates, d = f.document, node = f.explorer.doc.nodes[1];
  await f.explorer.command('answer', { revision: f.explorer.doc.revision, nodeId: node.id, answer: 'Saved Unicode \u{1f33f} answer', answerState: 'tentative' }); await f.poll();
  const original = JSON.stringify(f.explorer.doc), history = JSON.stringify(await f.explorer.readHistory(f.explorer.doc.id));
  const zoomTo = value => ui.zoom(value / ui.scene().view.zoom);
  const card = () => d.querySelector(`#nodes [data-node-id="${node.id}"]`);
  zoomTo(1); ui.reveal(node.id);
  assert.equal(ui.scene().detail, 'detail'); assert.ok(card().querySelector('.answer-preview'));
  zoomTo(.9); assert.equal(ui.scene().detail, 'detail');
  zoomTo(.89); assert.equal(ui.scene().detail, 'question'); ui.reveal(node.id);
  assert.equal(card().querySelector('.answer-preview'), null);
  const geometry = ui.scene().geometry;
  for (const value of [.95, .91, .99, .7, .56]) { zoomTo(value); assert.equal(ui.scene().detail, 'question'); assert.equal(ui.scene().geometry, geometry); }
  zoomTo(.55); assert.equal(ui.scene().detail, 'overview'); ui.reveal(node.id);
  assert.ok([...card().querySelector('.question').textContent].length <= 49);
  assert.ok(card().getAttribute('aria-label').includes(node.question)); assert.ok(card().getAttribute('aria-label').includes('Saved Unicode'));
  assert.equal(card().querySelector('script'), null);
  const overview = ui.scene().geometry;
  for (const value of [.6, .64, .36]) { zoomTo(value); assert.equal(ui.scene().detail, 'overview'); assert.equal(ui.scene().geometry, overview); }
  zoomTo(.34); assert.equal(ui.scene().detail, 'schematic'); assert.equal(ui.scene().geometry, overview);
  assert.match(d.getElementById('map-hint').textContent, /Outline/);
  zoomTo(.39); assert.equal(ui.scene().detail, 'schematic'); zoomTo(.4); assert.equal(ui.scene().detail, 'overview');
  zoomTo(.65); assert.equal(ui.scene().detail, 'question'); zoomTo(1); assert.equal(ui.scene().detail, 'detail');
  zoomTo(300); assert.equal(ui.scene().view.zoom, 3); zoomTo(.00001); assert.equal(ui.scene().view.zoom, .1);
  assert.equal(JSON.stringify(f.explorer.doc), original); assert.equal(JSON.stringify(await f.explorer.readHistory(f.explorer.doc.id)), history);
});

test('semantic zoom keeps the same readable editor, composition, reminder draft and pointer coordinate', async t => {
  const f = await fixture(t, 340), d = f.document, ui = f.window.__updates, id = f.explorer.doc.nodes[1].id;
  f.open(id); f.type('answer', 'Exact \u{1f331} draft'); f.type('revisit-condition', 'Independent reminder'); f.type('manual-question', 'Independent manual text');
  const answer = d.getElementById('answer'), reminder = d.getElementById('revisit-condition'), panel = d.getElementById('node-workspace');
  answer.focus(); answer.setSelectionRange(2, 5); answer.scrollTop = 15; d.querySelector('.node-content').scrollTop = 43;
  answer.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true }));
  for (const value of [.5, .1, .8, 1, 3, .5]) {
    const scene = ui.scene(), before = scene.view, point = { x: 150, y: 250 };
    const owner = scene.positions.get(id);
    const world = { x: (point.x - before.x) / before.zoom, y: (point.y - before.y) / before.zoom };
    ui.zoom(value / before.zoom, point);
    const after = ui.scene(), box = after.positions.get(id);
    const inside = world.x >= owner.x && world.x <= owner.x + owner.width && world.y >= owner.y && world.y <= owner.y + owner.height;
    if (inside) {
      assert.ok(Math.abs(after.view.x + (box.x + box.width * (world.x - owner.x) / owner.width) * after.view.zoom - point.x) < 1e-7);
      assert.ok(Math.abs(after.view.y + (box.y + box.height * (world.y - owner.y) / owner.height) * after.view.zoom - point.y) < 1e-7);
    }
    assert.equal(panel.style.transform, `scale(${1 / after.view.zoom})`);
    assert.ok(Math.abs(box.width * after.view.zoom - panel.offsetWidth) < 1e-7);
    assert.ok(Math.abs(box.height * after.view.zoom - panel.offsetHeight) < 1e-7);
    assert.equal(d.getElementById('answer'), answer); assert.equal(d.getElementById('revisit-condition'), reminder);
    assert.equal(d.activeElement, answer); assert.equal(answer.selectionStart, 2); assert.equal(answer.selectionEnd, 5); assert.equal(answer.scrollTop, 15);
    assert.equal(d.querySelector('.node-content').scrollTop, 43); assert.equal(reminder.value, 'Independent reminder');
  }
  answer.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true }));
  f.resize(280, 560); ui.reveal(id);
  assert.equal(panel.offsetWidth, 248); assert.equal(d.getElementById('answer'), answer); assert.equal(answer.value, 'Exact \u{1f331} draft');
  ui.fit(); const fitted = ui.scene().view.zoom;
  for (let i = 0; i < 5; i++) { ui.fit(); assert.equal(ui.scene().view.zoom, fitted, 'Fit does not feed editor dimensions into its floor'); }
  assert.equal(d.getElementById('answer'), answer); assert.equal(reminder.value, 'Independent reminder');
  d.getElementById('collapse-node').click(); ui.fit();
  assert.equal(ui.scene().view.zoom, fitted, 'canonical Fit is independent of expansion');
});

test('semantic zoom and Fit retain active voice ownership and reminder conflict controls', async t => {
  const voice = voiceFixture(), f = await fixture(t, 340, voice), d = f.document, ui = f.window.__updates, node = f.explorer.doc.nodes[1];
  f.open(node.id); f.type('revisit-condition', 'Keep mine');
  await f.explorer.command('set-revisit', { revision: f.explorer.doc.revision, nodeId: node.id, date: null, condition: 'Other canvas' }); await f.poll();
  const keep = d.getElementById('keep-revisit'), reminder = d.getElementById('revisit-condition'), answer = d.getElementById('answer');
  assert.ok(keep); await until(() => d.getElementById('voice-status').textContent.includes('Hold Ctrl'), 'voice ready');
  answer.focus(); key(f, 'keydown'); await until(() => voice.counts().starts === 1, 'voice started');
  const counts = voice.counts();
  for (const value of [.5, .1, 1, 3]) ui.zoom(value / ui.scene().view.zoom);
  ui.fit();
  assert.deepEqual(voice.counts(), counts); assert.equal(d.getElementById('answer'), answer); assert.equal(d.getElementById('keep-revisit'), keep);
  assert.equal(d.getElementById('revisit-condition'), reminder); assert.equal(reminder.value, 'Keep mine');
  key(f, 'keyup', { key: 'Control', code: 'ControlLeft', ctrlKey: false }); await until(() => voice.counts().finishes === 1, 'same voice finishes');
});


test('semantic schematic tier retains the focused branch control until focus moves', async t => {
  const f = await fixture(t), ui = f.window.__updates, d = f.document, root = f.explorer.doc.rootId;
  ui.zoom(1 / ui.scene().view.zoom); ui.reveal(root);
  const toggle = d.querySelector(`#nodes [data-branch-id="${root}"]`); toggle.focus();
  ui.zoom(.1 / ui.scene().view.zoom);
  assert.equal(d.activeElement, toggle); assert.equal(toggle.isConnected, true);
  d.getElementById('map').focus(); await delay(0);
  assert.equal(toggle.isConnected, false, 'schematic only retains the active branch owner');
});


test('semantic zoom anchors the actual compact card and editor point through relayout', async t => {
  const f = await fixture(t), ui = f.window.__updates, id = f.explorer.doc.nodes[1].id;
  ui.zoom(1 / ui.scene().view.zoom); ui.reveal(id);
  function atPoint(nextZoom) {
    const before = ui.scene(), box = before.positions.get(id), fraction = { x: .35, y: .45 };
    const point = { x: before.view.x + (box.x + box.width * fraction.x) * before.view.zoom,
      y: before.view.y + (box.y + box.height * fraction.y) * before.view.zoom };
    ui.zoom(nextZoom / before.view.zoom, point);
    const after = ui.scene(), next = after.positions.get(id);
    assert.ok(Math.abs(after.view.x + (next.x + next.width * fraction.x) * after.view.zoom - point.x) < 1e-7, 'same owner point x');
    assert.ok(Math.abs(after.view.y + (next.y + next.height * fraction.y) * after.view.zoom - point.y) < 1e-7, 'same owner point y');
  }
  for (const zoom of [.5, .7, 1, .5]) atPoint(zoom);
  ui.select(id);
  for (const zoom of [.5, .1, 3, 1]) atPoint(zoom);
});
