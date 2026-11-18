import { attachDashboard } from './dashboard.mjs';
import { GeometryCache, viewportBounds, intersects, branchView, revealPath } from './layout.mjs';
import { attachVoice } from './voice.mjs';
import { DraftClient } from './drafts.mjs';
import { CommentsClient } from './comments-client.mjs';
import { ReviewHandoffsClient } from './review-handoffs-client.mjs';
import { CleanupClient } from './cleanup.mjs';
import { QuestionHelpClient } from './question-help-client.mjs';
import { ResearchReviewClient } from './research-review-client.mjs';
import { researchSettingsText } from './research-policy.mjs';
import { effectiveMode, MODES } from './modes.mjs';
import { attachNavigation } from './navigation.mjs';
import { attachMinimap } from './minimap.mjs';
import { ANSWER_STATES, effectiveAnswerState, answerStateError, questionCounts, isQuestion, nodeStatus } from './answer-state.mjs';
import { localDate, REVISIT_FILTERS, revisitStatuses, revisitMatches } from './revisit.mjs';
import { NextQuestion } from './next-question.mjs';
import { reviewQueue, reviewContext } from './review-queue.mjs';
import { DecisionImpact, impactPath, decisionImpactKey, criticalPaths } from './decision-impact.mjs';
import { searchFilters, matchSearch, SEARCH_PAGE_SIZE } from './search.mjs';

const $ = id => document.getElementById(id);
attachDashboard({ document, fetch: (...args) => fetch(...args), available: () => !closed && !suspended });
let researchReviewReturn = null, reviewStarting = false;
let followupDraft = null;
const researchReview = new ResearchReviewClient({ fetch: (...args) => fetch(...args), changed: () => renderResearchReview() });
const colors = ['#628e9b', '#b58c4c', '#7a8e62', '#947b9a', '#697fb0', '#ad7669'];
let state = { document: null, pending: null, error: '' };
let selected = null, expanded = false, signature = '', positions = new Map(), busy = false, firstFit = true;
let view = { x: 0, y: 0, zoom: 1 }, drag, layoutFrame, viewportSize;
const geometryCache = new GeometryCache(), fitGeometry = new GeometryCache();
let detailTier = 'detail', fitBranches = null;
let geometryBranches = null, geometryInputs = '', fontEpoch = 0;
let workspace = null;
let suppressClick = false, restoringFocus = false, composing = null;
let actionEpoch = 0, closed = false, pollTimer;
let viewerTarget = null, viewerEpoch = 0, viewerPreview = null;
let scenarioFork = null, scenarioFlight = null;
let comparison = null, preference = null;
let stateCursor = null, pollFlight = null, pollFailures = 0, pageEpoch = 0, suspended = false, actionAbort = null;
function stopPolling() {
  clearTimeout(pollTimer); pollFlight?.abort.abort(); pollFlight = null; stateCursor = null;
}
function connectionStatus(message = '') { $('connection-status').textContent = message; $('connection-status').hidden = !message; }
let libraryView = false, libraryEpoch = 0, libraryRevision = 0, importDocument = null;
let projectGitEpoch = 0, projectGitFlight = null, projectGitResult = null, projectGitError = '';
let librarySearchTimer, librarySearchFlight = false, librarySearchQueued = false, librarySearchNext = null;
let outlinePage = 0, outlineFilterStamp = '', outlineMode = false, outlineNavigated = false;
let revisitDay = localDate();
let nextQuestion = new NextQuestion(), nextQuestionOpen = false, nextQuestionStamp = '';
let impactDocument = null, impactIndex = null, impactDisplay = false;
let criticalPrior = null, criticalDocument = null, criticalResult = null;
// Received saved snapshots are immutable. Memoize their content keys without retaining old documents.
const impactKeys = new WeakMap();
function impactKey(document) {
  if (!impactKeys.has(document)) impactKeys.set(document, decisionImpactKey(document));
  return impactKeys.get(document);
}
function currentImpact(doc = state.document) {
  const key = impactKey(doc);
  if (impactDocument !== key) { impactDocument = key; impactIndex = new DecisionImpact(doc); }
  return impactIndex;
}
function journeyDescription(doc = state.document) {
  return `${doc.forkOrigin ? 'Alternative scenario' : 'Journey'}: ${doc.topic} (${doc.id})${state.storage?.scope === 'project' ? `, project file ${state.storage.path}` : ', personal storage'}`;
}
function impactLabel(node) {
  if (!impactDisplay || !isQuestion(node)) return '';
  const value = currentImpact().bandFor(node.id);
  return `${value[0].toUpperCase()}${value.slice(1)} downstream impact`;
}
function currentCritical(doc = state.document) {
  const key = impactKey(doc);
  if (criticalDocument !== key) { criticalDocument = key; criticalResult = criticalPaths(doc, currentImpact(doc)); }
  return criticalResult;
}
function criticalLabel(node) {
  return criticalPrior ? currentCritical().highlights.get(node.id)?.join('; ') ?? 'Context for critical paths' : '';
}
function currentBranches(doc = state.document, contextId = selected) {
  if (!criticalPrior) return branchView(doc.nodes, doc.rootId, collapsed, focusId);
  const ids = new Set(currentCritical(doc).ids), byId = new Map(doc.nodes.map(node => [node.id, node]));
  for (let node = byId.get(contextId); node; node = byId.get(node.parentId)) ids.add(node.id);
  return branchView(doc.nodes.filter(node => ids.has(node.id)), doc.rootId, new Set());
}
function updateCriticalStatus() {
  $('critical-paths').setAttribute('aria-pressed', String(!!criticalPrior)); $('critical-return').hidden = $('critical-status').hidden = $('critical-details').hidden = !criticalPrior;
  if (!criticalPrior) return;
  const result = currentCritical(), count = result.highlights.size;
  $('critical-status').textContent = `${count ? `${count} highlighted decisions` : 'No matching decisions'}. Decision influence, not a scheduling or unique critical path. Folds, branch focus and Outline filters are paused; Return restores them.`;
}
function releaseCritical() {
  if (criticalPrior) for (const [control, disabled] of criticalPrior.controls) control.disabled = disabled;
  criticalPrior = null; criticalDocument = null; criticalResult = null; updateCriticalStatus();
}
function enterCritical() {
  if (!state.document || criticalPrior) return;
  captureWorkspace(); const anchor = anchorPoint();
  const controls = [...$('outline').querySelectorAll('details input, details select, details button')].map(control => [control, control.disabled]);
  criticalPrior = { journey: referenceJourney(), selected, expanded, collapsed: new Set(collapsed), focusId, wholeView, view: { ...view }, outlineMode, outlinePage, outlineFilterStamp, outlineNavigated, impactDisplay, impactLegendOpen: $('impact-legend').open, controls };
  for (const [control] of controls) control.disabled = true;
  collapsed = new Set(); focusId = null; wholeView = null; outlinePage = 0;
  branches = currentBranches(); updateCriticalStatus(); updateFocusStatus(); renderWorkspace(); refreshScene(anchor); renderOutline();
}
function exitCritical() {
  if (!criticalPrior) return;
  captureWorkspace(); const prior = criticalPrior; releaseCritical();
  if (!state.document || prior.journey !== referenceJourney()) return;
  const ids = new Set(state.document.nodes.map(node => node.id));
  if (selected !== prior.selected) voice.cancel();
  selected = ids.has(prior.selected) ? prior.selected : state.document.rootId; expanded = ids.has(prior.selected) && prior.expanded;
  collapsed = new Set([...prior.collapsed].filter(id => ids.has(id))); focusId = ids.has(prior.focusId) ? prior.focusId : null; wholeView = prior.wholeView;
  if (focusId && !withinFocus(selected)) { focusId = null; wholeView = null; }
  collapsed = revealPath(state.document.nodes, collapsed, selected);
  impactDisplay = prior.impactDisplay; $('impact-display').value = impactDisplay ? 'impact' : 'normal'; $('edges').dataset.impact = String(impactDisplay);
  $('impact-legend').hidden = !impactDisplay; $('impact-legend').open = prior.impactLegendOpen;
  outlinePage = prior.outlinePage; outlineFilterStamp = prior.outlineFilterStamp; outlineNavigated = prior.outlineNavigated;
  branches = currentBranches(); renderWorkspace(); setOutlineMode(prior.outlineMode); outlineNavigated = prior.outlineNavigated; view = prior.view;
  updateFocusStatus(); refreshScene(null); renderOutline(); $('critical-paths').focus({ preventScroll: true });
}
$('critical-paths').addEventListener('click', enterCritical);
$('critical-return').addEventListener('click', exitCritical);
$('impact-display').addEventListener('change', () => {
  const anchor = anchorPoint(); impactDisplay = $('impact-display').value === 'impact';
  $('edges').dataset.impact = String(impactDisplay); $('impact-legend').hidden = !impactDisplay;
  if (impactDisplay) $('impact-legend').open = true;
  if (state.document) { renderWorkspace(); refreshScene(anchor); renderOutline(); }
});
const revisitLabel = node => revisitStatuses(node.revisit, revisitDay).map(status => REVISIT_FILTERS[status]).join(' · ');
const importanceLabel = node => node.importance ? `${node.importance[0].toUpperCase()}${node.importance.slice(1)} importance` : 'Unranked';
const importanceBadge = node => el('span', { class: `importance importance-${node.importance ?? 'unranked'}` }, importanceLabel(node));
const importanceHistory = 'Historical model assessment for the original suggested wording and context; not confidence, answer certainty or a user decision. Not automatically reassessed after changes.';
function refreshRevisitDay() {
  const today = localDate(); if (today === revisitDay) return;
  revisitDay = today;
  if (state.document) { renderWorkspace(); renderMap(); renderOutline(); }
  if (libraryView && ($('library-search-scope').value !== 'nodes' || $('library-reminder').value !== 'all')) void refreshLibrary();
}
let collapsed = new Set(), branches = null, focusId = null, wholeView = null;
let historyEpoch = 0, historyReturn = null, historySelection = null, historyRevision = null;
let historyBranchRevision = null, branchRestoreEpoch = 0, branchRestoreView = null, branchRestoreCapture = null, branchRestoreFlight = null;
let guidanceReturn = null, guidanceBase = null, guidanceNeedsChoice = false, guidanceNeedsRefresh = false;
const showModeDescription = id => { $(`${id}-description`).textContent = MODES[$(id).value].description; };
let previewEdits = null, acceptedIds = new Set(), acceptedParentId = null;
let references = { journey: null, revision: 0, nodeIds: [], error: '', loading: false, saving: false, retryIds: null, open: false, epoch: 0 };
const drafts = new Map(), nodeUi = new Map();
const draftClient = new DraftClient({ fetch: (...args) => fetch(...args), drafts,
  changed: () => { cleanup.sync(); renderProjectGitStatus(); const node = state.document?.nodes.find(n => n.id === selected); if (node && !closed) { answerStatus(node); renderDraftRecovery(node); renderDraftSummary(); renderCleanup(); renderOutline(); } },
  restored: (id, value) => { if (id === selected && $('answer') && !composing) { $('answer').value = value; if ($('answer-state')) $('answer-state').value = draftClient.state(id); } } });
const cleanup = new CleanupClient({ fetch: (...args) => fetch(...args),
  context: () => {
    const node = state.document?.nodes.find(n => n.id === selected);
    return !closed && expanded && !libraryView && node && isQuestion(node) ? { journey: state.activeKey ?? state.document.id, nodeId: selected, mutation: draftClient.entries.get(selected)?.textGeneration ?? 0, text: drafts.get(selected) ?? node.answer } : null;
  },
  edit: text => {
    voice.cancel(); draftClient.edit(selected, text);
    const answer = $('answer'); answer.value = text; answer.focus({ preventScroll: true }); answer.setSelectionRange(text.length, text.length);
  }, changed: () => { renderCleanup(); renderQuestionHelp(); scheduleLayout(); } });
const questionHelp = new QuestionHelpClient({ fetch: (...args) => fetch(...args),
  source: () => state.document,
  context: () => {
    const node = state.document?.nodes.find(n => n.id === selected);
    return !closed && expanded && !libraryView && node && isQuestion(node) ? { journey: state.activeKey ?? state.document.id, nodeId: selected } : null;
  },
  changed: () => { renderQuestionHelp(); renderCleanup(); scheduleLayout(); } });
const voice = attachVoice({ document, window, fetch: (...args) => fetch(...args),
  context: () => `${state.document?.id}/${selected}/${expanded}/${draftClient.state(selected)}/${draftClient.entries.get(selected)?.edits}`,
  insert: (value, caret) => {
    draftClient.edit(selected, value); $('answer').value = value; $('answer').setSelectionRange(caret, caret);
    answerStatus(state.document.nodes.find(n => n.id === selected));
    return draftClient.flush(false, selected);
  }, changed: () => scheduleLayout() });
voice.mountSettings($('voice-settings-host'));
$('navigation-open').addEventListener('click', () => voice.cancel());

let contributorEpoch = 0, contributorFlight = null, contributorRevision = null;
function contributorPreview() {
  $('contributor-preview').textContent = $('contributor-name').value ? `Public name preview: ${$('contributor-name').value} (unverified)` : 'No public name chosen. Future shared contributions will be anonymous.';
}
function closeContributors(focus = true) {
  contributorEpoch++; contributorFlight?.abort(); contributorFlight = null; contributorRevision = null;
  if ($('contributor-dialog').open) { $('contributor-dialog').close(); if (focus && !closed && !suspended) $('navigation-open').focus({ preventScroll: true }); }
}
async function requestContributors(action, displayName) {
  if (closed || suspended || !$('contributor-dialog').open || contributorFlight || action === 'save' && contributorRevision === null) return;
  const epoch = ++contributorEpoch, page = pageEpoch, journey = referenceJourney(), abort = new AbortController(); contributorFlight = abort;
  const current = () => !closed && !suspended && $('contributor-dialog').open && epoch === contributorEpoch && page === pageEpoch && journey === referenceJourney();
  const input = action === 'read' ? { action } : { action, revision: contributorRevision, displayName };
  $('contributor-save').disabled = true; $('contributor-clear').disabled = true; $('contributor-refresh').disabled = true; $('contributor-name').disabled = true;
  $('contributor-status').textContent = action === 'read' ? 'Reading your local choice…' : 'Saving your local choice…';
  try {
    const response = await fetch('api/contributor-settings', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const result = await response.json(); if (!current()) return;
    if (!response.ok) throw Error(result.error || 'Contributor settings could not be saved. Refresh to check the saved choice.');
    if (!result.available) { contributorRevision = null; $('contributor-status').textContent = 'Private contributor settings are unavailable in this preview. Open the installed Explorer library.'; return; }
    contributorRevision = result.settings.revision; $('contributor-name').value = result.settings.actor?.displayName ?? ''; contributorPreview();
    $('contributor-status').textContent = action === 'read' ? 'Local choice loaded. Nothing is shared until you save a shared contribution.' : displayName === null ? 'Cleared. Future shared contributions will be anonymous.' : 'Saved. This name applies to future shared contributions.';
  } catch (error) {
    if (current()) { contributorRevision = null; $('contributor-status').textContent = `${error.message} Your typed name is retained. Refresh to check the saved choice before trying again.`; }
  } finally {
    if (contributorFlight === abort) contributorFlight = null;
    if (current()) { $('contributor-refresh').disabled = false; $('contributor-name').disabled = contributorRevision === null; $('contributor-save').disabled = contributorRevision === null; $('contributor-clear').disabled = contributorRevision === null; }
  }
}
$('contributor-open').addEventListener('click', () => { if (closed || suspended) return; voice.cancel(); closeContributors(false); $('navigation-dialog').close(); $('contributor-dialog').showModal(); contributorPreview(); void requestContributors('read'); });
$('contributor-close').addEventListener('click', () => closeContributors());
$('contributor-dialog').addEventListener('cancel', event => { event.preventDefault(); closeContributors(); });
$('contributor-dialog').addEventListener('close', () => { if (!$('contributor-dialog').open) closeContributors(false); });
$('contributor-name').addEventListener('input', contributorPreview);
$('contributor-save').addEventListener('click', () => { void requestContributors('save', $('contributor-name').value); });
$('contributor-clear').addEventListener('click', () => { void requestContributors('save', null); });
$('contributor-refresh').addEventListener('click', () => { void requestContributors('read'); });

const contributorEventText = event => event ? `${event.actor ? `${event.actor.displayName} (unverified)` : 'Anonymous contributor'} · ${event.at}` : 'Contributor unknown; time unknown';
function contributionText(record, status) {
  if (!record) return 'Contributor unknown; no recorded attribution.';
  const parts = [status === 'current' ? 'Recorded attribution matches the saved text.' : 'Historical attribution; current contributor unknown.'];
  parts.push(record.origin === 'ai' ? 'AI suggestion; no human author claimed.' : `First recorded author: ${contributorEventText(record.author)}.`);
  if (record.editor) parts.push(`Latest explicit editor: ${contributorEventText(record.editor)}.`);
  if (record.accepted) parts.push(`Accepted by: ${contributorEventText(record.accepted)}.`);
  return parts.join(' ');
}
const navigation = attachNavigation({ document, window, fetch: (...args) => fetch(...args),
  zoom: (factor, point) => zoom(factor, point),
  pan: (dx, dy) => { view.x += dx; view.y += dy; transform(); } });
const minimap = attachMinimap({ document, window,
  scene: () => !closed && !suspended && !outlineMode && !libraryView && state.document && geometryBranches === branches ?
    { geometry: geometryCache.value, selected, collapsed, focusId, view, size: $('map').getBoundingClientRect() } : null,
  navigate: point => {
    endDrag();
    const rect = $('map').getBoundingClientRect();
    view.x = rect.width / 2 - point.x * view.zoom; view.y = rect.height / 2 - point.y * view.zoom; transform();
  }, leaveEditor: () => voice.cancel() });
const uiFor = id => { if (!nodeUi.has(id)) nodeUi.set(id, { scroll: 0, researchOpen: false, rationaleOpen: false, helpOpen: false, manualOpen: false, question: '' }); return nodeUi.get(id); };
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), event => { if (node.isConnected && !closed) value(event); });
    else if (key === 'class') node.className = value;
    else if (key === 'disabled') node.disabled = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const button = (label, handler, attrs = {}) => el('button', { type: 'button', onclick: handler, ...attrs }, label);
const comments = new CommentsClient({ $, el, button, fetch: (...args) => fetch(...args), state: () => state,
  active: () => !closed && !suspended, canAct: () => !busy, apply, selected: () => selected, eventText: contributorEventText,
  begin: () => {
    busy = true; const epoch = ++actionEpoch; stateCursor = null; pollFlight?.abort.abort();
    return () => { if (actionEpoch === epoch) { busy = false; actionEpoch++; stateCursor = null; pollFlight?.abort.abort(); } };
  },
  append: async (nodeId, suggestion, current) => {
    await draftClient.ready;
    if (!current()) return;
    const node = state.document?.nodes.find(node => node.id === nodeId), entry = draftClient.entries.get(nodeId);
    if (!node || !isQuestion(node)) throw Error('This question is no longer available. The discussion stays historical.');
    if (draftClient.loadError || entry?.conflict) throw Error('Review or recover the private answer draft before adding proposed wording.');
    const before = drafts.get(nodeId) ?? node.answer, text = before ? `${before}\n\n${suggestion}` : suggestion;
    if (text.length > 20000) throw Error('This addition would exceed the 20,000-character answer limit. Your draft is unchanged.');
    voice.cancel(); cleanup.cancel(); draftClient.edit(nodeId, text);
    if (selected !== nodeId || !expanded) select(nodeId);
    if ($('answer')) { $('answer').value = text; $('answer-state').value = draftClient.state(nodeId); answerStatus(node); }
  } });
const reviewHandoffs = new ReviewHandoffsClient({ $, el, button, fetch: (...args) => fetch(...args), state: () => state,
  active: () => !closed && !suspended, canAct: () => !busy, apply, selected: () => selected, eventText: contributorEventText,
  copyText: text => navigator.clipboard.writeText(text),
  begin: () => {
    busy = true; const epoch = ++actionEpoch; stateCursor = null; pollFlight?.abort.abort();
    return () => { if (actionEpoch === epoch) { busy = false; actionEpoch++; stateCursor = null; pollFlight?.abort.abort(); } };
  } });
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
for (const id of ['library-reminder', 'revisit-filter']) $(id).append(...Object.entries(REVISIT_FILTERS).map(([value, label]) => el('option', { value }, label)));
function installSearchControls(prefix, host, changed) {
  const state = el('select', { id: `${prefix}-state` }, el('option', { value: 'all' }, 'All saved answer states'), Object.entries(ANSWER_STATES).map(([value, label]) => el('option', { value }, label)));
  host.append(el('label', { for: state.id }, 'Saved answer state'), state);
  if (prefix === 'library') host.append(el('label', { for: 'library-importance' }, 'Importance'), el('select', { id: 'library-importance' }, ['all', 'high', 'medium', 'low', 'unranked'].map(value => el('option', { value }, value === 'all' ? 'All importance levels' : value[0].toUpperCase() + value.slice(1)))));
  for (const [name, label] of [['research', 'Research available'], ['review', 'Needs review'], ['drafts', 'Has an answer draft'], ['draft-text', 'Include private answer draft text']]) host.append(el('label', {}, el('input', { type: 'checkbox', id: `${prefix}-${name}` }), ` ${label}`));
  host.append(el('p', { class: 'quiet' }, 'All filters must match. States describe saved answers. Draft text stays local and is searched only when explicitly included. Reminder edits and missing-direction drafts are excluded.'));
  host.append(button('Reset search and filters', () => {
    $(prefix === 'outline' ? 'search' : 'library-search').value = '';
    state.value = 'all'; $(prefix === 'outline' ? 'importance-filter' : 'library-importance').value = 'all';
    $(prefix === 'outline' ? 'revisit-filter' : 'library-reminder').value = 'all';
    for (const name of ['research', 'review', 'drafts', 'draft-text']) $(`${prefix}-${name}`).checked = false;
    if (prefix === 'library') $('library-archived').checked = false;
    changed();
  }, { id: `${prefix}-reset` }));
  host.addEventListener('change', changed);
}
const outlineControls = el('div', { class: 'search-filters' }); $('outline').querySelector('details').append(outlineControls);
installSearchControls('outline', outlineControls, renderOutline);
installSearchControls('library', $('library-search-filters'), () => scheduleLibrarySearch());
$('search').maxLength = 4000;
$('outline-list').before(el('p', { id: 'outline-count', role: 'status' }));
$('outline-list').after(button('Previous matches', () => { outlinePage = Math.max(0, outlinePage - 1); renderOutline(); }, { id: 'outline-previous' }), button('Next matches', () => { outlinePage++; renderOutline(); }, { id: 'outline-next' }));
function currentSearchFilters(prefix) {
  return searchFilters({ query: $(prefix === 'outline' ? 'search' : 'library-search').value,
    state: $(`${prefix}-state`).value, importance: $(prefix === 'outline' ? 'importance-filter' : 'library-importance').value,
    research: $(`${prefix}-research`).checked, review: $(`${prefix}-review`).checked, drafts: $(`${prefix}-drafts`).checked, draftText: $(`${prefix}-draft-text`).checked,
    reminder: $(prefix === 'outline' ? 'revisit-filter' : 'library-reminder').value, today: revisitDay, archived: prefix === 'library' && $('library-archived').checked });
}
function scheduleLibrarySearch() {
  libraryEpoch++; clearTimeout(librarySearchTimer);
  // Invalidate old buttons immediately, before the debounce or a slow response completes.
  $('library-search-results').replaceChildren(); $('library-search-next').disabled = true;
  librarySearchTimer = setTimeout(() => { if (!closed && !suspended && (libraryView || !state.document)) void refreshLibrary(); }, 250);
}
async function refreshLibrarySearch(cursor = null) {
  const epoch = ++libraryEpoch, page = pageEpoch;
  if (librarySearchFlight) { librarySearchQueued = true; return; }
  librarySearchFlight = true; librarySearchQueued = false;
  const current = () => epoch === libraryEpoch && page === pageEpoch && !closed && !suspended && (libraryView || !state.document) && $('library-search-scope').value === 'nodes';
  const list = $('library-search-results'), scroll = $('welcome').scrollTop, active = list.contains(document.activeElement) ? document.activeElement : null;
  const focus = active ? [active.dataset.searchKey, active.dataset.nodeId] : null;
  list.replaceChildren();
  $('library-search-next').disabled = true; $('library-search-status').textContent = 'Searching a bounded local page…';
  try {
    const response = await fetch('api/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ ...currentSearchFilters('library'), cursor }) });
    const result = await response.json(); if (!current()) return;
    if (!response.ok) throw new Error(result.error);
    librarySearchNext = result.next;
    $('library-errors').replaceChildren(...result.errors.map(error => el('p', { class: 'notice' }, error.message)), ...(result.truncated ? [el('p', { class: 'notice', role: 'alert' }, 'Incomplete discovery: only the first 2,000 directory entries in filesystem order were considered. Additional entries were NOT searched. This is not a complete library search.')] : []));
    list.replaceChildren(...result.results.map(item => button([el('strong', {}, item.question), el('small', {}, `${item.topic} · ${item.key.slice(0, 8)}`), el('small', {}, item.snippet)], async () => {
      if (!current()) return;
      if (await switchJourney('open', { key: item.key, searchResult: { key: item.key, source: item.source, nodeId: item.nodeId } }, current)) select(item.nodeId);
    }, { 'data-node-id': item.nodeId, 'data-search-key': item.key })));
    $('library-search-status').textContent = `${result.results.length} matching nodes on this page; ${result.examined} saved files examined. ${result.next ? 'More pages available.' : 'End of this discovered set.'} Counts are for this page only. Refresh from the beginning after files change.`;
    $('library-search-next').disabled = !result.next;
    if (focus && document.activeElement === document.body) [...list.querySelectorAll('[data-node-id]')].find(row => row.dataset.searchKey === focus[0] && row.dataset.nodeId === focus[1])?.focus({ preventScroll: true });
    $('welcome').scrollTop = scroll;
  } catch (error) { if (current()) { $('library-search-results').replaceChildren(); $('library-search-status').textContent = `Search could not complete: ${error.message}`; } }
  finally { librarySearchFlight = false; if (librarySearchQueued && !closed && !suspended && (libraryView || !state.document) && $('library-search-scope').value === 'nodes') void refreshLibrarySearch(); }
}
// The palette routes through mounted controls: it never owns a mutation handler.
const paletteCommands = [
  ['library-toggle', 'Library'], ['outline-toggle', 'Outline'], ['fit', 'Fit visible map'],
  ['center-question', 'Center question'], ['minimap-toggle', 'Show minimap'], ['navigation-open', 'Settings'],
  ['edit-guidance', 'Edit guidance'], ['history-open', 'History'], ['recovery-open', 'Recovery'],
  ['visual-export-open', 'Export maps'], ['decision-brief', 'Decision brief'], ['implementation-handoff', 'Implementation handoff'],
  ['adr-scope-open', 'ADR scope'],
  ['adr-questions-open', 'ADR questions'],
  ['adr-draft-open', 'ADR draft'],
  ['adr-file-open', 'Save ADR file'],
  ['adr-format-open', 'ADR format'],
  ['check-answers', 'Check answers'], ['challenge-decisions', 'Challenge decisions'], ['research-request', 'Research options'],
  ['revisit-answer', 'Revisit this answer'], ['scenario-preference-open', 'Scenario preference'],
];
let paletteEpoch = 0, paletteTimer, paletteFlight = false, paletteQueued = false, paletteNext = null;
let palettePage = 0, paletteReturn = null, paletteOrigin = '', paletteActing = false;
const paletteIdentity = () => JSON.stringify([state.activeKey ?? state.document?.id, selected]);
const paletteOpen = () => $('palette-dialog').open && !closed && !suspended;
function paletteReason(id) {
  const target = $(id);
  if (!target || !expanded && $('question-drawer').contains(target) || target.closest('[hidden]:not(#question-tools-body):not(#question-drawer):not([data-tool-panel])')) return 'Unavailable in this view. Open the relevant journey or question.';
  if (busy || draftClient.savingAnswer) return 'Wait for the current save or action to finish.';
  if (target.disabled) return state.pending ? 'Wait for or cancel the current request.' : state.preview ? 'Review or dismiss the unsaved questions first.' : 'Unavailable for the current selection.';
  return '';
}
function closePalette(restore = true) {
  paletteEpoch++; clearTimeout(paletteTimer); paletteQueued = false; paletteNext = null; paletteActing = false;
  $('palette-dialog').close(); $('palette-results').replaceChildren(); $('palette-commands').replaceChildren();
  if (restore) {
    const target = paletteReturn?.isConnected && !paletteReturn.disabled && !paletteReturn.closest('[hidden]') ? paletteReturn : $('palette-open');
    target.focus({ preventScroll: true });
  }
  paletteReturn = null;
}
function paletteCommandRows() {
  const focused = $('palette-commands').contains(document.activeElement) ? document.activeElement.dataset.command : null;
  const query = searchFilters({ query: $('palette-query').value }).query;
  const commands = paletteCommands.map(([id, label]) => [id, ['minimap-toggle', 'outline-toggle'].includes(id) ? $(id).textContent : label]);
  $('palette-commands').replaceChildren(...commands.filter(([, label]) => label.toLowerCase().includes(query)).map(([id, label]) => {
    const reason = paletteReason(id);
    return button([el('strong', {}, label), ...(reason ? [el('small', {}, reason)] : [])], () => {
      if (!paletteOpen() || paletteActing || paletteOrigin !== paletteIdentity()) return;
      const currentReason = paletteReason(id);
      if (currentReason) { $('palette-status').textContent = currentReason; paletteCommandRows(); return; }
      paletteActing = true; const target = $(id);
      closePalette(false); revealQuestionTool(target); target.focus({ preventScroll: true }); target.click();
    }, { 'data-command': id, 'aria-disabled': String(!!reason) });
  }));
  if (focused) [...$('palette-commands').children].find(row => row.dataset.command === focused)?.focus({ preventScroll: true });
}
function paletteFilters() {
  return searchFilters({ query: $('palette-query').value, draftText: $('palette-draft-text').checked, archived: $('palette-archived').checked });
}
function refreshPalette(cursor = null) {
  paletteActing = false; clearTimeout(paletteTimer); const epoch = ++paletteEpoch, page = pageEpoch, identity = paletteIdentity();
  $('palette-results').replaceChildren(); $('palette-next').disabled = true; paletteNext = null;
  if (!paletteOpen()) return;
  paletteCommandRows();
  const current = () => paletteOpen() && epoch === paletteEpoch && page === pageEpoch && identity === paletteIdentity();
  if ($('palette-scope').value === 'library') {
    paletteTimer = setTimeout(() => { if (current()) void searchPaletteLibrary(cursor, current); }, 250); return;
  }
  const doc = state.document, filters = paletteFilters(), rows = [];
  let count = 0;
  for (const node of doc?.nodes ?? []) {
    const draft = drafts.has(node.id) ? drafts.get(node.id) : draftClient.entries.get(node.id)?.conflict?.text;
    const match = matchSearch(node, filters, { topic: doc.topic, draft });
    if (!match) continue;
    if (count >= palettePage * SEARCH_PAGE_SIZE && rows.length < SEARCH_PAGE_SIZE) rows.push({ node, match });
    count++;
  }
  const revision = doc?.revision;
  $('palette-results').replaceChildren(...rows.map(({ node, match }) => button([el('strong', {}, node.question), el('small', {}, match.snippet)], () => {
    if (!current() || paletteActing || revision !== state.document?.revision || !state.document.nodes.some(n => n.id === node.id)) return;
    paletteActing = true; closePalette(false); select(node.id);
  }, { 'data-node-id': node.id })));
  $('palette-status').textContent = `${count} matching nodes; page ${palettePage + 1}. At most ${SEARCH_PAGE_SIZE} results are displayed.`;
  paletteNext = count > (palettePage + 1) * SEARCH_PAGE_SIZE ? true : null; $('palette-next').disabled = !paletteNext;
}
async function searchPaletteLibrary(cursor, current) {
  if (paletteFlight) { paletteQueued = true; return; }
  paletteFlight = true; paletteQueued = false; $('palette-status').textContent = 'Searching a bounded local page...';
  try {
    const response = await fetch('api/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ ...paletteFilters(), cursor }) });
    const result = await response.json(); if (!current()) return;
    if (!response.ok) throw Error(result.error);
    paletteNext = result.next; $('palette-next').disabled = !result.next;
    $('palette-results').replaceChildren(...result.results.map(item => button([el('strong', {}, item.question), el('small', {}, item.topic), el('small', {}, item.snippet)], async () => {
      if (!current() || paletteActing) return;
      paletteActing = true;
      const activationEpoch = paletteEpoch, sourceJourney = state.activeKey ?? state.document?.id, revision = state.document?.revision;
      const valid = () => current() && sourceJourney === (state.activeKey ?? state.document?.id) && revision === state.document?.revision && switchAllowed();
      try {
        const opened = await switchJourney('open', { key: item.key, searchResult: { key: item.key, source: item.source, nodeId: item.nodeId } }, valid);
        if (opened && state.activeKey === item.key) { closePalette(false); select(item.nodeId); }
      } finally { if (activationEpoch === paletteEpoch) paletteActing = false; }
    }, { 'data-node-id': item.nodeId, 'data-search-key': item.key })));
    $('palette-status').textContent = `${result.results.length} matching nodes on this page; ${result.examined} files examined. ${result.next ? 'More pages available.' : 'End of discovered set.'} Refresh after files change. ${result.truncated ? 'Incomplete discovery: only the first 2,000 directory entries were considered; this is NOT the whole library. ' : ''}${result.errors.map(e => e.message).join(' ')}`;
  } catch (error) { if (current()) $('palette-status').textContent = `Search could not complete: ${error.message}`; }
  finally { paletteFlight = false; if (paletteQueued && paletteOpen() && $('palette-scope').value === 'library') { paletteQueued = false; refreshPalette(); } }
}
function openPalette() {
  if (closed || suspended || composing || document.querySelector('dialog[open]')) return;
  voice.cancel(); paletteReturn = document.activeElement; paletteOrigin = paletteIdentity(); palettePage = 0; paletteActing = false;
  $('palette-query').value = ''; $('palette-draft-text').checked = false; $('palette-archived').checked = false;
  $('palette-scope').value = state.document ? 'current' : 'library';
  $('palette-dialog').showModal(); refreshPalette(); $('palette-query').focus({ preventScroll: true });
}
$('palette-open').addEventListener('click', openPalette);
$('palette-close').addEventListener('click', () => closePalette());
$('palette-dialog').addEventListener('cancel', event => { event.preventDefault(); closePalette(); });
for (const id of ['palette-query', 'palette-scope', 'palette-draft-text', 'palette-archived']) $(id).addEventListener(id === 'palette-query' ? 'input' : 'change', () => { palettePage = 0; refreshPalette(); });
$('palette-refresh').addEventListener('click', () => { palettePage = 0; refreshPalette(); });
$('palette-next').addEventListener('click', () => { const cursor = paletteNext; if (!cursor) return; palettePage++; refreshPalette($('palette-scope').value === 'library' ? cursor : null); });
$('palette-dialog').addEventListener('keydown', event => {
  if (!paletteOpen() || event.isComposing || event.defaultPrevented) return;
  if (event.key === 'Escape') { event.preventDefault(); closePalette(); return; }
  const rows = [...$('palette-dialog').querySelectorAll('#palette-commands button, #palette-results button')];
  if (['ArrowDown', 'ArrowUp'].includes(event.key) && (event.target === $('palette-query') || rows.includes(event.target))) {
    event.preventDefault(); const index = rows.indexOf(document.activeElement);
    const target = rows[index < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return;
  }
  if (event.key === 'Enter' && (event.target === $('palette-query') || rows.includes(event.target))) {
    event.preventDefault(); if (!event.repeat) (rows.includes(event.target) ? event.target : rows[0])?.click(); return;
  }
  if (event.key === 'Tab') {
    const controls = [...$('palette-dialog').querySelectorAll('input,select,button')].filter(e => !e.disabled && !e.closest('[hidden]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
document.addEventListener('keydown', event => {
  if (!$('palette-shortcut').checked || event.defaultPrevented || event.repeat || event.isComposing || composing || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.code !== 'KeyP' ||
      event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || document.querySelector('dialog[open]') || !voice.allowsShortcut(event)) return;
  event.preventDefault(); openPalette();
});
window.addEventListener('pagehide', () => { if ($('palette-dialog').open) closePalette(false); });

let answerChange = null;
const answerChangeWork = () => JSON.stringify([state.pending && [state.pending.id, state.pending.kind, state.pending.nodeId], state.preview, state.followup]);
async function answerChangeRequest(input) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
  try {
    const response = await fetch('api/answer-change', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const value = await response.json(); if (!response.ok) throw Error(value.error); return value;
  } finally { clearTimeout(timer); }
}
function closeAnswerChange(accept = false, message = '') {
  const review = answerChange; if (!review) return;
  answerChange = null; if ($('answer-change-dialog').open) $('answer-change-dialog').close();
  if (!accept) void answerChangeRequest({ action: 'discard', token: review.value.token }).catch(() => {});
  review.resolve(accept ? review.value : null);
  if (review.focus?.isConnected) review.focus.focus({ preventScroll: true });
  if (message) notice(message);
}
function renderAnswerChange() {
  const p = answerChange?.value; if (!p) return;
  const restart = p.operation === 'restart-branch';
  $('answer-change-title').textContent = restart ? 'Restart this branch' : 'Review this answer change';
  $('answer-change-intention').textContent = restart ? 'Remove only the selected question’s tree descendants after preserving a checkpoint. Outside branches survive. No new questions will be generated.' : 'These are recorded reasoning relationships, not a prediction of real-world damage. Affected answers are retained and marked for review.';
  $('answer-change-intention').prepend(`${answerChange.destination}. `);
  $('answer-change-summary').textContent = `${p.acknowledgment ? 'This acknowledges current review causes without changing answer text or state. Captured work still needs reconsideration. ' : ''}${p.counts.total} affected questions: ${p.counts.structural} reachable through the tree, ${p.counts.confirmed} through explicit dependencies, ${p.counts.mixedOnly} through mixed paths only. Tree and dependency counts may overlap. ${p.directions} structural directions also need review.`;
  $('answer-change-confirm').textContent = p.acknowledgment ? 'Acknowledge review and update captured work' : 'Save and mark affected items for review';
  if (p.reviewResolution) {
    const r = p.reviewResolution;
    $('answer-change-summary').prepend(p.operation === 'reaffirm-review' ? `Acknowledge only the selected cause against the current saved sources; ${r.remaining} other cause groups remain. Your saved answer, state and private draft stay unchanged. This is not external verification. ` : `Saving acknowledges all ${r.total} current review cause groups for this answer, including any earlier/legacy remainder. Review each cause in Review affected answers before confirming. `);
    if (p.operation === 'reaffirm-review') { $('answer-change-title').textContent = 'Reaffirm this answer for one cause'; $('answer-change-confirm').textContent = 'Reaffirm for this cause only'; }
    if (p.operation === 'clear-review-answer') { $('answer-change-title').textContent = 'Clear this saved answer'; $('answer-change-confirm').textContent = 'Clear saved answer and acknowledge all causes'; }
  }
  if (restart) {
    $('answer-change-summary').prepend(`${p.removed} descendants will be removed, including ${p.removedResearch} research results. ${p.removedReferences} local reference selections will remain unavailable until restored. ${p.checkpoint ? `Protected checkpoint: ${p.checkpoint}.` : 'No saved change; no checkpoint or revision will be created.'} Surviving reasoning: `);
    $('answer-change-confirm').textContent = `Restart and remove ${p.removed} descendants`;
  }
  $('answer-change-old-label').textContent = `Saved answer (${ANSWER_STATES[p.current.state]})`; $('answer-change-old').textContent = p.current.answer || '(No answer text)';
  $('answer-change-new-label').textContent = `Proposed answer (${ANSWER_STATES[p.proposed.state]})`; $('answer-change-new').textContent = p.proposed.answer || '(No answer text)';
  $('answer-change-artifacts').textContent = `${p.research} retained research results need reconsideration; ${p.generated} accepted generated questions need review. Saved research does not retain complete context dependencies, so all retained results are conservatively flagged, even without a recorded path. ${p.staged ? 'The unsaved question proposal becomes stale. ' : ''}${p.running ? 'Active research will be discarded and only its owned helper stopped. ' : ''}${p.followup ? 'The research conversation becomes historical. ' : ''}Answers and research are preserved; research is not automatically refreshed.`;
  const artifactNames = { brief: 'decision brief', handoff: 'implementation handoff', adrDraft: 'proposed ADR draft', 'answer-check': 'answer check', 'challenge-review': 'challenge review' };
  if (restart) $('answer-change-artifacts').textContent = `${p.research} surviving research results need reconsideration; ${p.generated} surviving generated questions need review. Removed content is recoverable from History. Private drafts remain recoverable; selected local references to removed questions remain unavailable. ${p.followup ? 'The research conversation becomes historical. ' : ''}Research is not automatically refreshed.`;
  for (const artifact of p.artifacts) $('answer-change-artifacts').append(` The ${artifact.state === 'saved' ? 'saved' : artifact.state === 'pending' ? 'running' : 'unsaved'} ${artifactNames[artifact.kind]} becomes stale${artifact.state === 'pending' ? ' and its owned helper stops' : ''}.`);
  $('answer-change-adr').textContent = p.adr;
  $('answer-change-items').replaceChildren(...p.items.map(n => el('option', { value: n.id }, `${n.removed ? 'REMOVE: ' : ''}${n.question} (${n.direction ? 'direction' : ANSWER_STATES[n.state]}${n.structural ? '; tree exposure' : ''}${n.confirmed ? '; explicit dependency' : ''}${n.review && !n.structural && !n.confirmed ? '; mixed exposure' : ''}${!n.review && n.research ? '; research reconsideration only' : ''}${n.research ? '; retained research' : ''}${n.generated ? '; generated question' : ''}${n.removed && n.referenced ? '; local reference becomes unavailable' : ''})`)));
  $('answer-change-items').value = p.targetId ?? ''; $('answer-change-items').disabled = !p.items.length;
  $('answer-change-page').textContent = p.total ? `Items ${p.page * 50 + 1}-${Math.min((p.page + 1) * 50, p.total)} of ${p.total}` : 'No downstream items. Context-bound work listed above may still become stale.';
  $('answer-change-prev').disabled = p.page === 0; $('answer-change-next').disabled = (p.page + 1) * 50 >= p.total;
  $('answer-change-path').replaceChildren(...p.path.map(step => el('li', {}, `${step.via === null ? 'Starting question' : step.via === 'tree' ? 'Possible tree exposure' : 'Recorded dependency'}: ${step.question}`)));
  $('answer-change-path').start = p.pathPage * 30 + 1;
  $('answer-change-path-page').textContent = p.pathTotal ? `Path steps ${p.pathPage * 30 + 1}-${Math.min((p.pathPage + 1) * 30, p.pathTotal)} of ${p.pathTotal}. A path with a tree step is possible exposure.` : 'No recorded path. Research context dependencies are unknown; no decision relationship has been inferred.';
  $('answer-change-path-prev').disabled = p.pathPage === 0; $('answer-change-path-next').disabled = (p.pathPage + 1) * 30 >= p.pathTotal;
  $('answer-change-links').hidden = !restart;
  $('answer-change-link-list').replaceChildren(...p.links.map(link => el('li', {}, `${link.dependent} depends on ${link.prerequisite}${link.external ? ' (crosses removed branch boundary)' : ' (inside removed branch)'}.${link.explanation ? ` ${link.explanation}` : ''}`)));
  $('answer-change-link-page').textContent = p.linkTotal ? `Links ${p.linkPage * 25 + 1}-${Math.min((p.linkPage + 1) * 25, p.linkTotal)} of ${p.linkTotal}. All listed links will be removed; outside questions remain.` : 'No dependency links will be removed.';
  $('answer-change-link-prev').disabled = p.linkPage === 0; $('answer-change-link-next').disabled = (p.linkPage + 1) * 25 >= p.linkTotal;
  $('answer-change-confirm').disabled = false; $('answer-change-error').textContent = '';
}
async function pageAnswerChange(page, targetId = null, pathPage = 0, linkPage = answerChange?.value.linkPage ?? 0) {
  const review = answerChange; if (!review) return;
  const sequence = ++review.sequence; $('answer-change-confirm').disabled = true;
  try {
    const value = await answerChangeRequest({ action: 'page', token: review.value.token, page, targetId, pathPage, linkPage });
    if (answerChange !== review || sequence !== review.sequence) return;
    if (!review.current()) return closeAnswerChange(false, 'The answer or its sources changed. Review again; your draft is retained.');
    review.value = value; renderAnswerChange();
  } catch (error) { if (answerChange === review && sequence === review.sequence) { $('answer-change-error').textContent = error.message; $('answer-change-confirm').disabled = true; } }
}
async function reviewAnswerChange(input, generation, stillCurrent) {
  const journey = referenceJourney(), page = pageEpoch, base = JSON.stringify(state.document), destination = journeyDescription(), work = answerChangeWork(), focus = document.activeElement;
  const savedCurrent = () => !closed && !suspended && page === pageEpoch && journey === referenceJourney() && (stillCurrent ? stillCurrent() : selected === input.nodeId) && JSON.stringify(state.document) === base && answerChangeWork() === work;
  const current = () => savedCurrent() && (!!stillCurrent || draftClient.entries.get(input.nodeId)?.edits === generation);
  const value = await answerChangeRequest({ action: 'prepare', journey, revision: state.document.revision, ...input });
  if (!savedCurrent() || value.requiresConfirmation && !current()) { void answerChangeRequest({ action: 'discard', token: value.token }).catch(() => {}); notice('The answer or its sources changed. Save again to review the current edit.'); return null; }
  if (!value.requiresConfirmation) return value;
  return new Promise(resolve => {
    answerChange = { value, current, resolve, focus, destination, sequence: 0 }; renderAnswerChange();
    $('answer-change-dialog').showModal(); $('answer-change-cancel').focus();
  });
}
let reviewPanel = null;
const reviewPanelCurrent = () => reviewPanel && !closed && !suspended && reviewPanel.page === pageEpoch && reviewPanel.journey === referenceJourney() && reviewPanel.base === JSON.stringify(state.document);
const queueCauses = node => [...(node?.reviewCauses?.changes ?? []), ...(node && (!node.reviewCauses || node.reviewCauses.earlier) ? ['earlier'] : [])];
function closeReviewQueue(force = false) {
  if (reviewPanel?.committing && force !== true) return;
  const focus = reviewPanel?.focus; reviewPanel = null; if ($('review-queue-dialog').open) $('review-queue-dialog').close();
  if (focus?.isConnected) focus.focus({ preventScroll: true });
}
function refreshReviewQueue(nodeId = reviewPanel?.nodes[reviewPanel.index]?.id) {
  if (!state.document) return closeReviewQueue();
  const nodes = reviewQueue(state.document), previous = reviewPanel;
  reviewPanel = { doc: state.document, base: JSON.stringify(state.document), nodes, index: Math.max(0, nodes.some(n => n.id === nodeId) ? nodes.findIndex(n => n.id === nodeId) : Math.min(previous?.index ?? 0, nodes.length - 1)), cause: 0, journey: referenceJourney(), page: pageEpoch, focus: previous?.focus ?? document.activeElement, busy: false };
  renderReviewQueue();
}
function openReviewQueue(nodeId) {
  refreshReviewQueue(nodeId); if (!reviewPanel) return;
  if (!$('review-queue-dialog').open) $('review-queue-dialog').showModal(); $('review-queue-close').focus();
}
function syncReviewQueue() {
  if (!reviewPanel) return;
  const fresh = reviewPanelCurrent(), node = reviewPanel.nodes[reviewPanel.index], blocked = !fresh || reviewPanel.busy || !!state.pending;
  for (const name of ['reaffirm', 'clear', 'revise', 'cause']) $(`review-queue-${name}`).disabled = blocked || !node;
  $('review-queue-prev').disabled = blocked || reviewPanel.index === 0; $('review-queue-next').disabled = blocked || reviewPanel.index + 1 >= reviewPanel.nodes.length;
  $('review-queue-refresh').disabled = reviewPanel.busy;
  $('review-queue-close').disabled = !!reviewPanel.committing;
  $('review-queue-status').textContent = reviewPanel.committing ? 'Saving the reviewed answer. Keep this dialog open until the response is applied; your private draft is preserved.' : !fresh ? 'Saved sources changed. Refresh the review queue before acting. Your editor draft is retained.' : state.pending ? 'Wait for or cancel the current request before changing a reviewed answer.' : node ? `Question ${reviewPanel.index + 1} of ${reviewPanel.nodes.length}. Tree order; each affected answer appears once. Explicit dependencies may cross this order.` : 'No answers currently need review. Structural directions have separate review controls.';
}
function renderReviewQueue() {
  const p = reviewPanel, node = p.nodes[p.index], causes = queueCauses(node), cause = causes[p.cause];
  $('review-queue-content').hidden = !node;
  if (node) {
    $('review-queue-question').textContent = node.question;
    $('review-queue-answer-label').textContent = `Saved answer (${ANSWER_STATES[effectiveAnswerState(node)]})`;
    $('review-queue-answer').textContent = node.answer || '(No saved answer text)';
    $('review-queue-cause').replaceChildren(...causes.map((c, i) => el('option', { value: i }, c === 'earlier' ? 'Earlier / legacy causes without retained details' : `${i + 1}. ${c.kind === 'dependency-added' ? 'Dependency added' : c.kind === 'dependency-removed' ? 'Dependency removed' : 'Upstream answer or branch changed'} — before revision ${c.revision}`)));
    $('review-queue-cause').value = String(p.cause);
    const context = reviewContext(p.doc, node.id, cause);
    $('review-queue-provenance').textContent = context.legacy ? 'Historical details are unavailable for these legacy or earlier causes. Acknowledging this remainder does not acknowledge separately retained causes.' : `Saved base before this change: revision ${cause.revision}, fingerprint ${cause.baseDigest}. This identifies the recorded pre-change map; previous answer text is not retained here. Local History may contain that version; revision numbers alone do not prove a match across collaborators.`;
    $('review-queue-source').textContent = context.source ? `Current upstream question: ${context.source.question}\nCurrent saved answer (${ANSWER_STATES[effectiveAnswerState(context.source)]}): ${context.source.answer || '(No answer text)'}${context.source.review ? '\nThis upstream answer also still needs review.' : ''}` : context.legacy ? 'No specific upstream source can be reconstructed.' : `Upstream source ${cause.sourceId} is no longer in this map. Its current answer cannot be reviewed here.`;
    $('review-queue-path').textContent = context.legacy ? 'No relationship history has been invented.' : `${context.structural ? 'Current tree path: possible exposure. ' : ''}${context.confirmed ? 'Current explicit dependency path. ' : ''}${context.mixed ? 'Current mixed tree/dependency path: possible exposure. ' : ''}${!context.structural && !context.confirmed && !context.mixed ? 'No current path; the historical cause remains until acknowledged. ' : ''}${cause.dependentId ? `Recorded dependency: ${context.dependent?.question ?? cause.dependentId} depends on ${context.source?.question ?? cause.sourceId}. This direct link is ${context.linkPresent ? 'present' : 'absent'} in the current map.` : ''}`;
    $('review-queue-research').textContent = node.research ? `${node.researchStale ? 'Saved research is marked stale.' : 'Saved research may not cover the changed premise.'} Reaffirming does not refresh or verify it. Use the question’s Research tab for an explicit new request.` : 'No research is saved for this answer. Review does not start research automatically.';
  }
  syncReviewQueue();
}
async function applyQueueReview(operation) {
  const p = reviewPanel, node = p?.nodes[p.index], cause = node && queueCauses(node)[p.cause];
  if (!node || !reviewPanelCurrent() || p.busy || state.pending) return;
  p.busy = true; syncReviewQueue();
  const clearing = operation === 'clear-review-answer', generation = draftClient.entries.get(node.id)?.edits;
  const current = () => reviewPanel === p && reviewPanelCurrent() && (!clearing || draftClient.entries.get(node.id)?.edits === generation);
  try {
    if (clearing) {
      await draftClient.flush(false, node.id);
      if (!current()) return notice('The draft or saved sources changed while preserving the draft. Review Clear again; your editor text is retained.');
    }
    const input = { nodeId: node.id, operation, answer: operation === 'reaffirm-review' ? node.answer : '', answerState: operation === 'reaffirm-review' ? effectiveAnswerState(node) : 'unanswered', ...(operation === 'reaffirm-review' ? { reviewCause: cause } : {}) };
    const proof = await reviewAnswerChange(input, null, current); if (!proof || !current()) return;
    p.committing = true; syncReviewQueue();
    const result = await api(operation, { ...input, answerPreview: proof.token, confirmConsequences: true });
    if (result && reviewPanel === p && p.journey === referenceJourney() && p.page === pageEpoch) refreshReviewQueue(node.id);
  } catch (error) { notice(error.message); }
  finally { if (reviewPanel === p) { p.busy = false; p.committing = false; syncReviewQueue(); } }
}
$('review-affected').addEventListener('click', () => openReviewQueue(selected));
$('review-queue-close').addEventListener('click', () => closeReviewQueue());
$('review-queue-dialog').addEventListener('cancel', event => { event.preventDefault(); closeReviewQueue(); });
$('review-queue-refresh').addEventListener('click', () => refreshReviewQueue());
for (const [id, direction] of [['prev', -1], ['next', 1]]) $(`review-queue-${id}`).addEventListener('click', () => { if (reviewPanelCurrent() && !reviewPanel.busy) { reviewPanel.index += direction; reviewPanel.cause = 0; renderReviewQueue(); } });
$('review-queue-cause').addEventListener('change', () => { if (reviewPanelCurrent() && !reviewPanel.busy) { reviewPanel.cause = Number($('review-queue-cause').value); renderReviewQueue(); } });
$('review-queue-reaffirm').addEventListener('click', () => void applyQueueReview('reaffirm-review'));
$('review-queue-clear').addEventListener('click', () => void applyQueueReview('clear-review-answer'));
$('review-queue-revise').addEventListener('click', () => {
  if (!reviewPanelCurrent() || reviewPanel.busy) return;
  const id = reviewPanel.nodes[reviewPanel.index]?.id; if (!id) return;
  closeReviewQueue(); select(id); $('answer')?.focus({ preventScroll: true }); notice('Edit your retained draft. Saving explicitly confirms all current review causes; cancel keeps the draft.');
});
$('answer-change-cancel').addEventListener('click', () => closeAnswerChange());
$('answer-change-dialog').addEventListener('cancel', event => { event.preventDefault(); closeAnswerChange(); });
$('answer-change-confirm').addEventListener('click', () => { if (!answerChange?.current()) closeAnswerChange(false, 'The answer or its sources changed. Review again; your draft is retained.'); else closeAnswerChange(true); });
$('answer-change-prev').addEventListener('click', () => void pageAnswerChange(answerChange.value.page - 1));
$('answer-change-next').addEventListener('click', () => void pageAnswerChange(answerChange.value.page + 1));
$('answer-change-items').addEventListener('change', () => void pageAnswerChange(answerChange.value.page, $('answer-change-items').value));
$('answer-change-path-prev').addEventListener('click', () => void pageAnswerChange(answerChange.value.page, answerChange.value.targetId, answerChange.value.pathPage - 1));
$('answer-change-path-next').addEventListener('click', () => void pageAnswerChange(answerChange.value.page, answerChange.value.targetId, answerChange.value.pathPage + 1));
$('answer-change-link-prev').addEventListener('click', () => void pageAnswerChange(answerChange.value.page, answerChange.value.targetId, answerChange.value.pathPage, answerChange.value.linkPage - 1));
$('answer-change-link-next').addEventListener('click', () => void pageAnswerChange(answerChange.value.page, answerChange.value.targetId, answerChange.value.pathPage, answerChange.value.linkPage + 1));
async function api(action, input = {}) {
  if (busy || closed || suspended) return null;
  busy = true; actionEpoch++; stateCursor = null; pollFlight?.abort.abort();
  const epoch = actionEpoch, page = pageEpoch, abort = new AbortController(); actionAbort = abort;
  const timeout = setTimeout(() => abort.abort(), 10000);
  try {
    const response = await fetch('api/action', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, revision: state.document?.revision, scope: action === 'start' ? $('start-scope').value : $('context-scope').value, ...input }) });
    const result = await response.json();
    if (closed || suspended || page !== pageEpoch || epoch !== actionEpoch) return null;
    if (!response.ok) throw new Error(result.error);
    if (!result.importConflict && action !== 'context-coverage') apply(result, ['start', 'open', 'open-project', 'open-project-entry', 'open-project-copy', 'open-compared-source', 'open-preferred-source', 'import'].includes(action)); return result;
  } catch (error) {
    if (!closed && !suspended && page === pageEpoch && epoch === actionEpoch) notice(abort.signal.aborted ? 'The action response timed out. Refresh the saved map before retrying; it may have been saved. Your draft is still here.' : error.message);
    return null;
  } finally { clearTimeout(timeout); if (actionAbort === abort) { actionAbort = null; busy = false; } }
}
function anchorPoint(id = selected) {
  const p = positions.get(id);
  return p ? { id, x: view.x + (p.x + p.width / 2) * view.zoom, y: view.y + p.y * view.zoom } : null;
}
function captureWorkspace() {
  const panel = $('node-workspace'), content = panel.querySelector('.node-content');
  if (content && !panel.hidden) {
    const ui = uiFor(panel.dataset.nodeId);
    ui.scroll = content.scrollTop;
    ui.researchOpen = $('question-drawer').querySelector('.research-disclosure')?.open ?? false;
    ui.rationaleOpen = $('question-drawer').querySelector('#question-rationale')?.open ?? false;
    ui.importanceOpen = $('question-drawer').querySelector('#question-importance')?.open ?? false;
    ui.helpOpen = $('question-drawer').querySelector('#question-help')?.open ?? false;
    ui.manualOpen = $('question-drawer').querySelector('.manual')?.open ?? false;
    ui.contextOpen = $('question-drawer').querySelector('#question-context')?.open ?? false;
    ui.revisitOpen = $('question-drawer').querySelector('#revisit-editor')?.open ?? false;
    ui.toolsOpen = $('question-tools-toggle')?.getAttribute('aria-expanded') === 'true';
    ui.toolsScroll = $('question-drawer').querySelector('#question-tools-body')?.scrollTop ?? 0;
    if (!references.error) references.open = $('question-drawer').querySelector('#references')?.open ?? references.open;
  }
}
function apply(next, reset = false) {
  const stamp = JSON.stringify(next);
  if (stamp === signature && !reset) return;
  captureWorkspace();
  const workspaceFocused = ($('node-workspace').contains(document.activeElement) || $('question-drawer').contains(document.activeElement));
  const compactFocused = $('nodes').contains(document.activeElement);
  const previousSelection = selected;
  const changedDocument = reset || state.document?.id !== next.document?.id || state.activeKey !== next.activeKey;
  if (briefOperation === 'adrDraft' && !changedDocument && (JSON.stringify(state.document) !== JSON.stringify(next.document) || JSON.stringify(state.scenario) !== JSON.stringify(next.scenario))) { adrDraftReview.close(); adrDraftReview.error = 'Saved inputs or scenario changed. Review current ADR input before generating.'; invalidateAdrReadiness('Saved inputs changed. Check readiness again; manual wording is retained.'); renderAdrDraftReview(); }
  if ($('adr-questions-dialog').open && !changedDocument && (JSON.stringify(state.document) !== JSON.stringify(next.document) || JSON.stringify(state.scenario) !== JSON.stringify(next.scenario))) invalidateAdrQuestions('Saved inputs or scenario changed. Refresh and review again.');
  if (adrFormat && (adrFormat.value || adrFormat.action === 'prepare') && !changedDocument && JSON.stringify(state.document) !== JSON.stringify(next.document)) invalidateAdrFormat('Saved journey changed. Review the format again before saving.');
  if (adrFile && !changedDocument && (JSON.stringify(state.document) !== JSON.stringify(next.document) || JSON.stringify(state.scenario) !== JSON.stringify(next.scenario))) invalidateAdrFile('Saved inputs changed. Refresh status and review again.');
  if ($('adr-scope-dialog').open && !changedDocument && (JSON.stringify(state.document) !== JSON.stringify(next.document) || JSON.stringify(state.scenario) !== JSON.stringify(next.scenario))) {
    invalidateAdrPreview('Saved inputs or scenario changed. Review the current selection again.');
    $('adr-scope-status').textContent = 'Saved inputs changed. Refresh scope status before relying on the previous check.';
  }
  if ($('project-merge-dialog').open && (changedDocument || state.document?.revision !== next.document?.revision || next.projectChange)) closeProjectMerge();
  if (!!state.projectChange !== !!next.projectChange) { cancelProjectGitStatus(); projectGitResult = null; projectGitError = ''; }
  if (viewerTarget && (changedDocument || viewerTarget.journey !== (next.activeKey ?? next.document?.id) || viewerTarget.revision !== next.document?.revision)) {
    invalidateViewer('The journey changed. Reopen Export maps and preview again.');
    viewerTarget = null; $('viewer-preview').disabled = true;
  }
  const firstQuestions = (state.document ? questionCounts(state.document).total : 0) === 0 && (next.document ? questionCounts(next.document).total : 0) > 0;
  const anchor = changedDocument ? null : anchorPoint();
  if (changedDocument) {
    closeContributors(false);
    comments.close(false);
    reviewHandoffs.close(false);
    closePreference(true);
    releaseCritical();
    if ($('project-reconcile-dialog').open) closeProjectReconciliation();
    cancelProjectGitStatus(); projectGitResult = null; projectGitError = '';
    if ($('project-copy-dialog').open) closeProjectCopy();
    if ($('scenario-fork-dialog').open) closeScenarioFork(true);
    outlineNavigated = false;
    minimap.reset();
    if (state.document?.id !== next.document?.id || state.activeKey !== next.activeKey) nextQuestion = new NextQuestion();
    nextQuestionOpen = false; nextQuestionStamp = ''; $('next-question').hidden = true;
    closeResearchReview();
    closeBrief();
    closeAdrScope();
    closeAdrFormat();
    closeAdrFile();
    closeAdrQuestions();
    closeCheck();
    lastCoverage = ''; $('context-coverage').textContent = 'Check the selected node or start a request to see coverage.';
    cleanup.cancel();
    questionHelp.sync();
    voice.cancel();
    geometryCache.clear(); fitGeometry.clear(); fitBranches = null; geometryBranches = null; geometryInputs = '';
    $('nodes').replaceChildren(); $('edges').replaceChildren();
    workspace = null; composing = null; drafts.clear(); nodeUi.clear(); positions.clear(); collapsed.clear(); branches = null; focusId = null; wholeView = null; $('node-workspace').replaceChildren(); $('question-drawer').replaceChildren();
    selected = next.document?.rootId ?? null; expanded = next.document?.nodes.length === 1; firstFit = true;
    $('start-objective').value = ''; $('start-criteria').value = ''; $('start-mode').value = 'understand'; showModeDescription('start-mode'); $('start-guidance').open = false;
    if ($('history-dialog').open) closeHistory();
    if ($('recovery-dialog').open) closeRecovery();
    if ($('guidance-dialog').open) $('guidance-dialog').close();
    acceptedIds.clear(); acceptedParentId = null;
  }
  signature = stamp; state = next;
  comments.update();
  reviewHandoffs.update();
  if ($('adr-questions-dialog').open) renderAdrQuestions();
  syncReviewQueue();
  syncComparison();
  syncBranchRestore();
  if (answerChange && !answerChange.current()) closeAnswerChange(false, 'Saved sources changed. Review the answer change again; your draft is retained.');
  if (paletteOpen() && (changedDocument || !state.document?.nodes.some(n => n.id === selected))) { closePalette(false); $('palette-open').focus({ preventScroll: true }); }
  for (const [id, ui] of nodeUi) {
    if (ui.comparison && ui.researchKey !== JSON.stringify(state.document?.nodes.find(node => node.id === id)?.research)) {
      ui.comparison = null; ui.researchKey = null; ui.selectedDetails = new Set();
    }
  }
  if (changedDocument) switchReferences();
  if (state.preview?.id !== previewEdits?.id) previewEdits = state.preview ? { id: state.preview.id, questions: state.preview.questions.map(q => ({ question: q.question, selected: true, rationaleOpen: false })) } : null;
  if (next.acceptedIds) {
    acceptedIds = new Set(next.acceptedIds); acceptedParentId = next.acceptedParentId;
    collapsed = revealPath(state.document.nodes, collapsed, next.acceptedIds[0]);
  }
  if (changedDocument) draftClient.reset(state.activeKey ?? state.document?.id, state.document?.nodes ?? []);
  else draftClient.updateNodes(state.document?.nodes ?? []);
  if (state.library && !state.document && $('library-search-scope').value !== 'nodes') void refreshLibrary();
  const doc = state.document;
  if (doc) {
    const ids = new Set(doc.nodes.map(node => node.id));
    if (!ids.has(selected)) { voice.cancel(); composing = null; workspace = null; $('node-workspace').replaceChildren(); $('question-drawer').replaceChildren(); selected = doc.rootId; expanded = false; focusId = null; wholeView = null; }
    else if (focusId && !ids.has(focusId)) { focusId = null; wholeView = null; }
    collapsed = new Set([...collapsed].filter(id => ids.has(id)));
    branches = currentBranches(doc);
  }
  updateFocusStatus();
  updateCriticalStatus();
  showView();
  renderPreferenceBanner(); syncPreference();
  $('decision-brief').hidden = !doc;
  $('review-affected').hidden = !doc;
  $('implementation-handoff').hidden = !doc;
  $('adr-scope-open').hidden = !doc;
  $('adr-questions-open').hidden = !doc;
  $('adr-draft-open').hidden = !doc;
  $('adr-file-open').hidden = !doc;
  $('adr-format-open').hidden = !doc;
  $('check-answers').hidden = !doc; $('challenge-decisions').hidden = !doc;
  $('save-file').hidden = !doc; $('finish').hidden = !doc; $('finish').disabled = !!state.pending;
  $('visual-export-open').hidden = !doc;
  $('project-copy-open').hidden = !doc || !state.library || state.storage?.scope === 'project';
  $('project-reconcile-open').hidden = !doc || state.storage?.scope !== 'project';
  $('project-merge-open').hidden = !doc || state.storage?.scope !== 'project';
  $('project-change').hidden = !state.projectChange; $('project-change-text').textContent = state.projectChange?.message ?? '';
  $('edit-guidance').disabled = !!state.pending;
  if (state.contextCoverage && JSON.stringify(state.contextCoverage) !== lastCoverage) { lastCoverage = JSON.stringify(state.contextCoverage); showCoverage(state.contextCoverage, 'Prepared'); }
  notice(state.error || state.recoveryNotice?.message || (['failed', 'interrupted'].includes(state.exportObservation?.status) ? 'Export did not finish. Open Recovery to explicitly retry. Browser file saving is unknown.' : ''));
  if (!doc) return;
  if (firstQuestions && selected === doc.rootId) expanded = false;
  $('map-title').textContent = doc.forkOrigin ? `Alternative scenario: ${doc.topic}` : doc.topic;
  $('journey-storage').textContent = state.storage?.scope === 'project' ? `Project: ${state.storage.path}. Saved locally; commit and share through Git for teammates to receive changes. Drafts, history and usage stay private.` : 'Personal library: Saved on this computer.';
  renderProjectGitStatus();
  $('current-mode').textContent = `Mode: ${MODES[effectiveMode(doc)].label}`;
  const { answered, resolved, deferred, unresolved } = questionCounts(doc);
  $('progress').textContent = `${answered} answered · ${resolved} resolved · ${deferred} deferred · ${unresolved} unresolved · Saved locally`;
  $('request-status').hidden = !state.pending && !state.preview;
  if (state.preview) $('request-status').textContent = `${state.preview.questions.length} questions to review (not saved)`;
  if (state.pending) {
    const work = doc.nodes.find(n => n.id === state.pending.nodeId);
    $('request-status').textContent = `${['research', 'research-follow-up'].includes(state.pending.kind) ? 'Researching' : 'Finding questions for'} ${work?.category ?? 'this map'}…`;
  }
  renderWorkspace(); refreshScene(anchor); renderOutline();
  if (compactFocused && changedDocument) $('map').focus({ preventScroll: true });
  if (workspaceFocused && (changedDocument || previousSelection !== selected)) {
    const target = expanded ? $('expanded-title') : outlineMode ? [...$('outline-list').querySelectorAll('[data-node-id]')].find(e => e.dataset.nodeId === selected) ?? $('outline-selected') : [...$('nodes').children].find(e => e.dataset.nodeId === selected) ?? $('map');
    target.focus({ preventScroll: true });
    if (outlineMode) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  renderQuestionFeedback();
  renderDraftSummary();
  renderNextQuestion();
  if (!outlineMode && (firstFit || firstQuestions)) {
    const rect = $('map').getBoundingClientRect(); firstFit = !rect.width || !rect.height;
    if (!firstFit) expanded ? centerSelected() : fit();
  }
}
function referenceJourney() { return state.activeKey ?? state.document?.id; }
function renderNextQuestion() {
  if (!state.document) return;
  nextQuestion.sync(state.document, referenceJourney());
  if (!nextQuestionOpen) return;
  const result = nextQuestion.suggest(state.document, referenceJourney());
  const stamp = JSON.stringify(result);
  if (stamp === nextQuestionStamp) return;
  nextQuestionStamp = stamp;
  const panel = $('next-question'), focused = panel.contains(document.activeElement), focusId = document.activeElement.id;
  panel.hidden = false;
  const messages = {
    'no-goal': 'Save an objective in Edit guidance for literal matching. No eligible question currently has medium/high impact or needs review; no goal is inferred from your topic.',
    empty: 'There are no existing questions to prioritize. Review your goal and decide whether this map is useful enough to finish; more questions are not necessarily progress.',
    resolved: 'All recorded questions are decided or marked not relevant, with no needs-review flags. Review your conclusions and remaining uncertainty; finishing is your choice.',
    excluded: 'The remaining questions are explicitly deferred. Review them in Outline when appropriate; this does not mean the uncertainty is resolved.',
    dismissed: 'The matching questions are dismissed in this canvas. Other unresolved questions may still matter.',
    'no-match': 'No eligible question has medium/high impact, needs review, or shares supported literal words with current guidance. Useful work may remain: review the map or refine your guidance. This is not a conclusion that the map is complete.',
  };
  const { candidate, counts } = result;
  panel.replaceChildren(el('h2', { id: 'next-question-title', tabindex: '-1' }, 'A useful next question?'));
  if (candidate) {
    const impact = candidate.impact, affected = impact.counts;
    panel.append(el('p', {}, candidate.question), el('p', {}, `Why it may help: ${ANSWER_STATES[candidate.state]}${candidate.review ? '; needs review' : ''}. ${impact.band[0].toUpperCase() + impact.band.slice(1)} downstream impact: ${affected.total} affected questions, ${affected.structural} through the tree, ${affected.confirmed} through explicit dependencies, ${affected.mixedOnly} through mixed paths only. Counts may overlap; tree paths describe possible exposure. ${affected.states.unanswered} unanswered and ${affected.review} needing review among affected questions.`),
      el('p', {}, `${candidate.constraintTerms.length ? `Literal constraint words: ${candidate.constraintTerms.join(', ')}. ` : ''}${candidate.goalTerms.length ? `Literal objective / success-criteria words: ${candidate.goalTerms.join(', ')}.` : ''}${!candidate.constraintTerms.length && !candidate.goalTerms.length ? 'No literal guidance matches; the recommendation uses saved impact or review status.' : ''}`),
      el('p', { class: 'quiet' }, 'Local heuristic: impact band first, then assumptions needing review, other needs-review questions, constraint matches, objective / success-criteria matches, historical importance, then stable ID. This is not semantic reasoning or an optimal next action.'),
      el('p', { class: 'quiet' }, impact.rules),
      el('p', {}, `Recorded importance: ${candidate.importance ?? 'Unranked'}.`));
    if (candidate.importance || candidate.rationale) panel.append(el('details', {}, el('summary', {}, 'Historical explanation'),
      el('p', {}, importanceHistory), el('p', {}, `Original suggested wording: ${candidate.originalQuestion}`),
      ...(candidate.importanceReason ? [el('p', {}, candidate.importanceReason)] : []), ...(candidate.rationale ? [el('p', {}, candidate.rationale)] : [])));
    panel.append(el('div', { class: 'actions' }, button('Open question', () => {
      const current = nextQuestion.suggest(state.document, referenceJourney()).candidate;
      if (current?.id !== candidate.id) return renderNextQuestion();
      select(candidate.id);
    }, { id: 'open-next-question' }), button('Dismiss', () => {
      nextQuestion.dismiss(state.document, candidate.id, referenceJourney());
      nextQuestionOpen = false; nextQuestionStamp = '';
      panel.replaceChildren(el('h2', { id: 'next-question-title' }, 'Suggestion dismissed'), el('p', {}, 'Suggestion dismissed. Request another only when useful. Dismissal lasts in this canvas until this source, review causes, impact band or saved guidance changes, the journey switches, or the page reloads.'));
      $('suggest-next').focus({ preventScroll: true });
    }, { id: 'dismiss-next-question' })));
  } else panel.append(el('p', {}, messages[result.status]));
  panel.append(el('p', { class: 'quiet' }, `${counts.questions} questions scanned: ${counts.resolved} resolved, ${counts.deferred} deferred, ${counts.review} need source review; ${counts.eligible} eligible, ${counts.matched} qualify by impact, review or guidance, ${counts.dismissed} qualifying dismissals. Review overlaps other counts. Reminder urgency is separate.`),
    el('details', {}, el('summary', {}, 'Scope and limits'), el('p', {}, 'Uses all saved questions and complete objective, success criteria and constraints (up to 5,000 nodes and 16,000 guidance characters). Case-normalized Unicode word matching excludes words shorter than three characters and common English stop words; no stemming, synonyms or language understanding. Current question wording is matched, not historical rationale. Historical importance is not reassessed for current guidance. Selection uses saved answer states; saved answer changes reset dismissal but their words are not matched. Drafts, research, project files and private references are not consulted. No model calls or map changes.'),
      el('p', {}, 'Medium/high impact or a review flag can qualify without guidance matches. Decided and not-relevant questions qualify only when needing review; explicit Revisit later remains excluded even with review flags. Dismissal lasts until the question’s saved source, review causes, impact band or guidance changes, the journey switches, or the page reloads. Same-band topology changes and unrelated answer wording do not reset it. Opening a question is your choice; nothing is answered or generated.')),
    button('Close suggestion', () => { nextQuestionOpen = false; panel.hidden = true; nextQuestionStamp = ''; $('suggest-next').focus({ preventScroll: true }); }));
  if (focused) ($(focusId) ?? $('next-question-title')).focus({ preventScroll: true });
}
$('suggest-next').addEventListener('click', () => { nextQuestionOpen = true; nextQuestionStamp = ''; renderNextQuestion(); $('next-question-title').focus({ preventScroll: true }); });
function switchReferences() {
  const epoch = references.epoch + 1;
  references = { journey: referenceJourney(), revision: 0, nodeIds: [], error: '', loading: !!state.document, saving: false, retryIds: null, open: false, epoch };
  if (state.document) void loadReferences(epoch);
}
async function loadReferences(epoch = references.epoch, retry = false) {
  const journey = references.journey;
  references.loading = true;
  try {
    const response = await fetch(`api/references?${new URLSearchParams({ journey })}`), result = await response.json();
    if (closed || epoch !== references.epoch || journey !== referenceJourney()) return;
    if (!response.ok) throw new Error(result.error);
    references.revision = result.revision;
    references.error = result.error ?? '';
    if (references.error) references.open = true;
    if (!result.error) {
      if (!retry) references.nodeIds = result.nodeIds;
      else if (references.retryIds) {
        const desired = references.retryIds; references.retryIds = null;
        references.loading = false;
        return void saveReferences(desired);
      }
    }
  } catch (error) { if (!closed && epoch === references.epoch) { references.error = error.message; references.open = true; } }
  finally { if (!closed && epoch === references.epoch) { references.loading = false; if (expanded) { renderWorkspace(); refreshScene(); } } }
}
async function saveReferences(nodeIds) {
  if (references.loading || references.saving || references.error) return;
  const journey = references.journey, epoch = references.epoch, revision = references.revision;
  references.nodeIds = nodeIds; references.saving = true; if (expanded) { renderWorkspace(); refreshScene(); }
  try {
    const response = await fetch('api/references', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ journey, revision, nodeIds }) });
    const result = await response.json();
    if (closed || epoch !== references.epoch) return;
    if (!response.ok) throw new Error(result.error);
    references.revision = result.revision; references.retryIds = null; references.error = '';
  } catch (error) {
    if (!closed && epoch === references.epoch) { references.error = error.message; references.retryIds = nodeIds; references.open = true; }
  } finally { if (!closed && epoch === references.epoch) { references.saving = false; if (expanded) { renderWorkspace(); refreshScene(); } } }
}
function renderReferences(active) {
  const section = el('section', { class: 'references-area', 'aria-label': 'Question references' });
  section.append(el('p', { class: 'quiet' }, isQuestion(active) ? 'Active editable question' : active.parentId === null ? 'Active idea' : 'Active direction'));
  if (isQuestion(active)) section.append(button(references.nodeIds.includes(active.id) ? 'Pinned as reference' : 'Pin this question as a reference', () => void saveReferences([...references.nodeIds, active.id]),
    { id: 'pin-reference', disabled: references.loading || references.saving || !!references.error || references.nodeIds.includes(active.id) || references.nodeIds.length >= 3 }));
  const details = el('details', { id: 'references' }, el('summary', { id: 'references-summary' }, `References (${references.nodeIds.length}/3)`));
  details.open = references.open;
  details.addEventListener('toggle', () => { if (details.isConnected) references.open = details.open; });
  if (references.loading) details.append(el('p', { class: 'quiet' }, 'Loading references…'));
  for (const id of references.nodeIds) {
    const node = state.document.nodes.find(n => n.id === id && isQuestion(n));
    const row = el('div', { class: 'reference-row' });
    if (!node) row.append(el('p', {}, 'Source unavailable in this saved journey.'));
    else {
      row.append(el('p', { class: 'reference-question' }, node.question), el('p', { class: 'quiet' }, `${nodeStatus(node)}${node.review ? ' · needs review' : ''}`));
      const characters = Array.from(node.answer);
      if (characters.length > 160 || node.answer.split('\n').length > 4) {
        const summary = node.answer.split('\n').length > 4 ? node.answer.split('\n').slice(0, 4).join('\n') : characters.slice(0, 160).join('');
        row.append(el('p', { class: 'reference-answer reference-summary' }, `${Array.from(summary).slice(0, 160).join('')}…`), el('details', { class: 'reference-full' }, el('summary', {}, 'Read full saved answer'), el('p', {}, node.answer)));
      } else row.append(el('p', { class: 'reference-answer' }, node.answer || 'No saved answer.'));
      row.append(button('Go to source', () => select(node.id), { class: 'reference-jump' }));
    }
    row.append(button('Remove reference', () => {
      const next = references.nodeIds.filter(value => value !== id);
      void saveReferences(next);
      $('references').open = true; references.open = true;
      $('references-summary')?.focus({ preventScroll: true });
    }, { class: 'reference-remove', disabled: references.saving || references.loading || !!references.error }));
    details.append(row);
  }
  if (references.error) details.append(el('p', { class: 'notice', role: 'alert' }, references.error), button(references.retryIds ? 'Refresh & retry references' : 'Refresh references', () => {
    references.error = ''; void loadReferences(references.epoch, !!references.retryIds);
  }, { id: 'references-retry' }));
  section.append(details);
  return section;
}
function showView() {
  cleanup.sync();
  questionHelp.sync();
  const home = !state.document || libraryView;
  $('storage-home').hidden = !home;
  $('welcome').hidden = !home; $('workspace').hidden = home;
  $('library-toggle').hidden = !state.library;
  $('library-home').hidden = !state.library;
  for (const id of ['start-storage-fields', 'project-open', 'project-open-form']) $(id).hidden = !state.library;
  $('library-return').hidden = !state.document;
  document.body.classList.toggle('has-library', !!state.library);
}
async function refreshLibrary() {
  const project = $('library-scope').value === 'project';
  $('personal-library').hidden = project; $('project-library').hidden = !project;
  if (project) { libraryEpoch++; return refreshProjectLibrary(); }
  clearProjectListing();
  const nodeSearch = $('library-search-scope').value === 'nodes';
  $('library-node-search').hidden = !nodeSearch; $('library-list').hidden = nodeSearch;
  if (nodeSearch) return refreshLibrarySearch();
  const epoch = ++libraryEpoch;
  try {
    const query = new URLSearchParams({ search: $('library-search').value, archived: String($('library-archived').checked), reminder: $('library-reminder').value, today: localDate() });
    const response = await fetch(`api/library?${query}`), result = await response.json();
    if (epoch !== libraryEpoch || closed) return;
    if (!response.ok) throw new Error(result.error);
    libraryRevision = result.revision;
    $('library-errors').replaceChildren(...result.errors.map(error => el('p', { class: 'notice' }, error.message)));
    const list = $('library-list'), scroll = $('welcome').scrollTop, active = document.activeElement;
    const oldRows = [...list.querySelectorAll('.library-entry')], focusedRow = active.closest('.library-entry');
    const focusedIndex = oldRows.indexOf(focusedRow), focusedAction = active.dataset.action;
    const rows = new Map(oldRows.map(row => [row.dataset.key, row]));
    for (const empty of list.querySelectorAll(':scope > p')) empty.remove();
    result.entries.forEach((entry, index) => {
      let row = rows.get(entry.key); rows.delete(entry.key);
      if (!row) {
        row = el('article', { class: 'library-entry', 'data-key': entry.key }, el('h2'), el('p', { class: 'quiet library-meta' }), el('p', { class: 'quiet library-reminders' }), el('p', { class: 'quiet library-ambiguous' }));
        const change = async field => {
          const value = !row.entry[field];
          if (await api('library-update', { key: row.entry.key, patch: { [field]: value }, metadataRevision: libraryRevision })) {
            await refreshLibrary();
            notice(`${row.entry.topic}: ${field === 'pinned' ? value ? 'pinned' : 'unpinned' : value ? 'archived' : 'unarchived'}.`);
          }
        };
        row.append(el('div', { class: 'library-actions' }, button('Open', () => switchJourney('open', { key: row.entry.key }), { 'data-action': 'open' }),
          button('Compare with current', () => openComparison({ scope: 'personal', key: row.entry.key }, `${row.entry.topic} (${row.entry.id}), personal storage`), { 'data-action': 'compare' }),
          button('Revisit', async () => {
            const filter = $('library-reminder').value === 'all' ? 'any' : $('library-reminder').value;
            if (await switchJourney('open', { key: row.entry.key })) {
              $('revisit-filter').value = filter;
              const source = state.document.nodes.find(n => revisitMatches(n.revisit, filter, localDate()));
              if (source) select(source.id);
              else notice('No reminder now matches this filter. Open the question list to choose another filter.');
            }
          }, { 'data-action': 'revisit' }),
          button('', () => change('pinned'), { 'data-action': 'pin' }), button('', () => change('archived'), { 'data-action': 'archive' })));
      }
      row.entry = entry;
      row.querySelector('[data-action="compare"]').disabled = !state.document;
      row.querySelector('h2').textContent = entry.scenario ? `Alternative scenario: ${entry.topic}` : entry.topic;
      row.querySelector('.library-meta').textContent = `${entry.pinned ? 'Pinned · ' : ''}${entry.questionCount} questions · ${entry.lastOpenedAt ? 'Opened' : 'Edited'} ${new Date(entry.lastOpenedAt ?? entry.updatedAt).toLocaleString()}${entry.scenario ? ` · Scenario ID: ${entry.id}` : ''}`;
      const reminders = entry.revisit;
      row.querySelector('.library-reminders').textContent = reminders?.counts.any ? `${reminders.counts.any} reminder(s); ${reminders.counts.attention} need attention${reminders.nextDate ? `; earliest active date ${reminders.nextDate}` : ''}. ${Object.entries(reminders.counts).filter(([key, count]) => !['any', 'attention'].includes(key) && count).map(([key, count]) => `${REVISIT_FILTERS[key]}: ${count}`).join('; ')}. Status counts can overlap.` : 'No revisit reminders.';
      row.querySelector('[data-action="revisit"]').hidden = !reminders?.counts.any;
      row.querySelector('.library-ambiguous').hidden = !entry.ambiguous;
      row.querySelector('.library-ambiguous').textContent = entry.ambiguous ? `Multiple saved versions share this identity. Version ${entry.key.slice(0, 8)} is preserved separately.` : '';
      const pin = row.querySelector('[data-action="pin"]'); pin.textContent = entry.pinned ? 'Unpin' : 'Pin'; pin.setAttribute('aria-pressed', String(entry.pinned));
      row.querySelector('[data-action="archive"]').textContent = entry.archived ? 'Unarchive' : 'Archive';
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    });
    for (const row of rows.values()) row.remove();
    if (focusedIndex >= 0) {
      const target = focusedRow.isConnected ? focusedRow : list.children[Math.min(focusedIndex, list.children.length - 1)];
      (target?.querySelector(`[data-action="${focusedAction}"]`) ?? $('library-search')).focus({ preventScroll: true });
    }
    $('welcome').scrollTop = scroll;
    if (!result.entries.length) $('library-list').append(el('p', { class: 'quiet' }, $('library-search').value ? 'No journeys match this search.' : $('library-archived').checked ? 'No archived journeys.' : 'No saved journeys yet. Start an exploration below, or open a saved file.'));
  } catch (error) { if (epoch === libraryEpoch && !closed) $('library-errors').textContent = `Could not load the library: ${error.message}`; }
}
let projectListingEpoch = 0, projectListingFlight = null;
function clearProjectListing(message = '') {
  projectListingEpoch++; projectListingFlight?.abort(); projectListingFlight = null;
  $('project-library-refresh').disabled = false; $('project-library-list').replaceChildren(); $('project-library-errors').replaceChildren();
  $('project-library-status').textContent = message;
}
async function refreshProjectLibrary(input = { action: 'refresh', folder: $('project-library-folder').value }) {
  const active = document.activeElement, focusedKey = active.closest('#project-library-list .library-entry')?.dataset.key, focusedAction = active.dataset.action;
  clearProjectListing('Reading the selected project folder...');
  const epoch = projectListingEpoch, page = pageEpoch, abort = new AbortController(); projectListingFlight = abort;
  const current = () => !closed && !suspended && (libraryView || !state.document) && pageEpoch === page && epoch === projectListingEpoch && $('library-scope').value === 'project';
  const timer = setTimeout(() => abort.abort(), 20000); $('project-library-refresh').disabled = true;
  try {
    const response = await fetch('api/project-library', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const result = await response.json(); if (!current()) return;
    if (!response.ok) throw Error(result.error);
    $('project-library-status').textContent = `${result.missing ? 'Folder not created yet. ' : ''}${result.examined}/${result.discovered} shared files examined. Limits: ${result.limits.entries} folder entries, ${result.limits.files} files, ${result.limits.bytes / 1024 / 1024} MiB per refresh. ${result.coverage}`;
    $('project-library-errors').replaceChildren(...result.errors.map(error => el('p', { class: 'notice' }, `${error.path ? `${error.path}: ` : ''}${error.message}`)));
    $('project-library-list').replaceChildren(...result.entries.map(entry => {
      const disabled = result.partial || entry.duplicate || result.metadataUnavailable;
      return el('article', { class: 'library-entry', 'data-key': entry.key }, el('h2', {}, entry.topic), el('p', { class: 'quiet' }, `Project: ${entry.path}`),
        el('p', { class: 'quiet' }, `${entry.questionCount} questions. ${entry.lastOpenedAt ? `Opened ${new Date(entry.lastOpenedAt).toLocaleString()}` : 'Not opened on this checkout.'}`),
        ...(entry.duplicate ? [el('p', { class: 'notice' }, 'Duplicate journey identity. Resolve the duplicate files and refresh before opening.')] : []),
        el('div', { class: 'library-actions' }, button('Open', () => { if (current()) void switchJourney('open-project-entry', { listing: result.listing, key: entry.key }, current); }, { 'data-action': 'open', disabled }),
          button('Compare with current', () => { if (current()) openComparison({ scope: 'project', listing: result.listing, key: entry.key }, `${entry.topic} (${entry.id}), project file ${entry.path}`); }, { 'data-action': 'compare', disabled: disabled || !state.document }),
          button(entry.pinned ? 'Unpin' : 'Pin', () => { if (current()) void refreshProjectLibrary({ action: 'pin', listing: result.listing, key: entry.key, pinned: !entry.pinned, revision: result.revision }); }, { 'data-action': 'pin', 'aria-pressed': String(entry.pinned), disabled })));
    }));
    if (!result.entries.length && !result.errors.length) $('project-library-list').append(el('p', { class: 'quiet' }, 'No shared journeys in this folder. Start a Project exploration below or choose another relative folder.'));
    if (focusedKey && document.activeElement === document.body) {
      const row = [...$('project-library-list').children].find(item => item.dataset.key === focusedKey);
      const control = [...row?.querySelectorAll('button') ?? []].find(item => item.dataset.action === focusedAction && !item.disabled);
      (control ?? $('project-library-folder')).focus({ preventScroll: true });
    }
  } catch (error) {
    if (current()) {
      $('project-library-status').textContent = `${abort.signal.aborted ? 'Project refresh timed out.' : error.message} Current map and drafts are preserved; refresh from the intended checkout.`;
      if (focusedKey && document.activeElement === document.body) $('project-library-folder').focus({ preventScroll: true });
    }
  }
  finally { clearTimeout(timer); if (projectListingFlight === abort) { projectListingFlight = null; $('project-library-refresh').disabled = false; } }
}
function switchAllowed(reason = 'opening another journey') {
  if (busy || closed || draftClient.savingAnswer) return false;
  if (state.pending) { notice(`Cancel the current Copilot request before ${reason}.`); return false; }
  if (state.preview) { notice('Dismiss the unsaved question preview before switching journeys or restoring. Return to the map to review it.'); return false; }
  if ([...nodeUi.values()].some(ui => ui.question.length)) { notice(`Add or clear your missing-direction drafts before ${reason}. Back to current map keeps your drafts.`); return false; }
  if (orphanReminderDrafts().length) {
    notice('Copy or discard removed-question reminder drafts before switching or restoring.');
    $('notice').append(button('Review removed reminders', revealOrphanReminders, { id: 'review-orphan-reminders' })); return false;
  }
  if ([...nodeUi.values()].some(ui => ui.revisitDraft)) { notice(`Save your reminder edits or choose Use saved reminder before ${reason}.`); return false; }
  return true;
}
function syncComparison() {
  const c = comparison; if (!c || c.navigating) return;
  if (c.observed !== state.document) { c.stale ||= c.base !== JSON.stringify(state.document); c.observed = state.document; }
  c.stale ||= c.page !== pageEpoch || c.journey !== state.activeKey;
  const unavailable = !!c.flight || c.stale || busy;
  $('comparison-start').disabled = unavailable;
  $('comparison-rows').disabled = unavailable;
  $('comparison-prev').disabled = unavailable || !c.value || c.value.page === 0;
  $('comparison-next').disabled = unavailable || !c.value || c.value.page + 1 >= c.value.pages;
  for (const side of ['left', 'right']) $(`comparison-open-${side}`).disabled = unavailable || !c.value?.selected[side] || !!state.pending || !!state.preview || draftClient.savingAnswer;
  if (c.stale) $('comparison-status').textContent = c.error || 'Saved context changed. Close comparison, refresh the sources and select them again. Your draft is retained.';
  else if (!c.flight && (state.pending || state.preview)) $('comparison-status').textContent = 'Comparison is read-only. Finish or cancel pending work and accept or dismiss staged questions before source navigation.';
}
function renderPreferenceBanner() {
  const value = state.scenario, available = !!state.document && !!state.library;
  $('scenario-preference-open').hidden = !available;
  $('scenario-preference-banner').hidden = !available;
  const classification = value?.hypothetical ? 'hypothetical alternative' : value?.status ?? 'not checked';
  $('scenario-preference-text').textContent = `Last checked ${value?.scope ?? state.storage?.scope ?? 'personal'} scenario: ${classification}. ${value?.message ?? (value?.hypothetical ? 'Conditional context; not the current project direction.' : value?.status === 'alternative' ? 'Open the preferred source or explicitly allow hypothetical use before AI work and decision exports.' : value?.status === 'unresolved' ? 'Reconcile the preferred source or explicitly choose or clear the selection.' : 'Refresh Scenario preference after changes from another canvas or teammate.')}`;
}
function preferenceCurrent(p = preference) {
  return !!p && preference === p && !closed && !suspended && p.page === pageEpoch && p.journey === referenceJourney() && p.base === JSON.stringify(state.document);
}
function syncPreference() {
  const p = preference; if (!p) return;
  const current = preferenceCurrent(p), locked = !current || !!p.flight || p.navigating || busy;
  const value = p.value, unavailable = locked || !value || Date.now() >= value.expiresAt;
  for (const id of ['select', 'clear', 'restore']) $(`preference-${id}`).disabled = unavailable || !!state.pending || !!state.preview || id === 'restore' && !value?.history.length;
  $('preference-open-source').disabled = unavailable || !!state.pending || !!state.preview || !value?.selection.preferred || value.selection.status === 'unresolved';
  $('preference-hypothetical').disabled = unavailable || value?.selection.status !== 'alternative';
  $('preference-hypothetical').textContent = value?.hypothetical ? 'Stop hypothetical use' : 'Use this alternative hypothetically';
  $('preference-refresh').disabled = !!p.flight || p.navigating || busy || p.journey !== referenceJourney();
  $('preference-close').disabled = !!p.navigating || !!p.flight && p.action !== 'inspect';
  if (!current) $('preference-status').textContent = 'Saved map or page changed. Refresh this preference before acting. Your draft is retained.';
}
function showPreferenceHistory() {
  const event = preference?.value?.history.find(row => String(row.revision) === $('preference-history').value);
  $('preference-history-detail').textContent = event ? `Change ${event.revision} at ${event.at}
${event.preferred ? `Preferred: ${event.preferred.identity.id}
Location: ${event.preferred.location}` : 'No preferred scenario'}
Reason: ${event.rationale || '(Not supplied)'}` : 'No recorded selection changes.';
}
function renderPreference(value) {
  $('preference-source').textContent = `Open source: ${value.source.topic} (${value.source.identity.id}). Recorded family: ${value.source.family.id}. ${value.source.scope} location: ${value.source.location}.`;
  $('preference-path').textContent = `Preference storage: ${value.preferencePath}`;
  $('preference-status').textContent = `Status: ${value.hypothetical ? 'hypothetical alternative' : value.selection.status}. Preference revision ${value.selection.revision}. ${value.selection.preferred ? `Preferred source: ${value.selection.preferred.identity.id}.` : 'No direction selected.'} ${state.pending || state.preview ? 'Finish or cancel pending work and its preview before changing the selection.' : ''}`;
  $('preference-history').replaceChildren(...value.history.map(event => el('option', { value: event.revision }, `Change ${event.revision}: ${event.preferred?.identity.id ?? 'cleared'}`)));
  $('preference-history-coverage').textContent = `${value.history.length} retained change(s); ${value.omittedHistory} earlier change(s) omitted. Restoring records a new change and never merges answers.`;
  showPreferenceHistory();
}
function closePreference(force = false) {
  const p = preference; if (!force && (p?.navigating || p?.flight && p.action !== 'inspect')) return;
  preference = null; p?.flight?.abort();
  if ($('preference-dialog').open) $('preference-dialog').close();
  if (p?.value) void fetch('api/scenario-preference', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'discard', journey: p.journey, revision: p.revision, id: p.value.id }) }).catch(() => {});
  if (!force && p?.focus?.isConnected) p.focus.focus({ preventScroll: true });
}
async function requestPreference(action) {
  const p = preference; if (!p || p.flight || p.navigating || busy || closed || suspended) return;
  if (action === 'inspect') { p.journey = referenceJourney(); p.revision = state.document.revision; p.base = JSON.stringify(state.document); p.value = null; }
  else if (!preferenceCurrent(p) || !p.value) return;
  const extra = action === 'inspect' ? {} : { id: p.value.id, ...(['select', 'clear', 'restore'].includes(action) ? { rationale: $('preference-rationale').value } : {}), ...(action === 'restore' ? { eventRevision: Number($('preference-history').value) } : {}), ...(action === 'hypothetical' ? { enabled: !p.value.hypothetical } : {}) };
  const abort = new AbortController(); p.flight = abort; p.action = action; actionEpoch++; stateCursor = null; pollFlight?.abort.abort();
  syncPreference(); $('preference-status').textContent = action === 'inspect' ? 'Reading saved preference...' : 'Saving this explicit choice...';
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch('api/scenario-preference', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, journey: p.journey, revision: p.revision, ...extra }) });
    const value = await response.json(); if (!preferenceCurrent(p)) return;
    if (!response.ok) throw Error(value.error);
    p.value = value; renderPreference(value);
    state = { ...state, scenario: { journey: p.journey, scope: value.source.scope, status: value.selection.status, hypothetical: value.hypothetical, revision: value.selection.revision } };
    renderPreferenceBanner(); stateCursor = null;
  } catch (error) {
    if (preferenceCurrent(p)) { p.value = null; $('preference-status').textContent = `${abort.signal.aborted ? 'Preference response timed out.' : error.message} Refresh to inspect the saved result before retrying. A submitted change may have completed. Your map and draft are retained.`; }
  } finally { clearTimeout(timer); p.flight = null; if (preference === p) syncPreference(); }
}
function openPreference() {
  if (!state.library || !state.document || busy || closed || suspended) return;
  closePreference(true); voice.cancel();
  preference = { journey: referenceJourney(), revision: state.document.revision, base: JSON.stringify(state.document), page: pageEpoch, focus: document.activeElement, value: null };
  $('preference-rationale').value = ''; $('preference-source').textContent = journeyDescription(); $('preference-path').textContent = ''; $('preference-history').replaceChildren(); $('preference-history-detail').textContent = ''; $('preference-history-coverage').textContent = '';
  $('preference-dialog').showModal(); $('preference-refresh').focus(); void requestPreference('inspect');
}
for (const id of ['scenario-preference-open', 'scenario-preference-manage']) $(id).addEventListener('click', openPreference);
for (const action of ['select', 'clear', 'restore', 'hypothetical']) $(`preference-${action}`).addEventListener('click', () => { if (!$(`preference-${action}`).disabled) void requestPreference(action); });
$('preference-refresh').addEventListener('click', () => void requestPreference('inspect'));
$('preference-history').addEventListener('change', showPreferenceHistory);
$('preference-close').addEventListener('click', () => closePreference());
$('preference-dialog').addEventListener('cancel', event => { event.preventDefault(); closePreference(); });
$('preference-open-source').addEventListener('click', async () => {
  const p = preference; if (!preferenceCurrent(p) || $('preference-open-source').disabled) return;
  p.navigating = true; syncPreference();
  try {
    const result = await switchJourney('open-preferred-source', { journey: p.journey, revision: p.revision, id: p.value.id }, () => preferenceCurrent(p));
    if (result) closePreference(true);
    else if (preferenceCurrent(p)) $('preference-status').textContent = $('notice').textContent || 'Could not open the preferred source. Your draft is retained.';
  } finally { p.navigating = false; syncPreference(); }
});
function closeComparison(force = false) {
  const c = comparison; if (c?.navigating && !force) return;
  comparison = null; c?.flight?.abort();
  if ($('comparison-dialog').open) $('comparison-dialog').close();
  if (c?.value) void fetch('api/scenario-compare', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'discard', journey: c.journey, revision: c.revision, id: c.value.id }) }).catch(() => {});
  if (!force && c?.focus?.isConnected) c.focus.focus({ preventScroll: true });
}
function openComparison(target, label) {
  if (!state.document || busy || closed || suspended) return;
  closeComparison(); voice.cancel();
  comparison = { target, journey: state.activeKey, revision: state.document.revision, base: JSON.stringify(state.document), observed: state.document, page: pageEpoch, focus: document.activeElement, value: null, stale: false };
  $('comparison-identities').textContent = `Left: ${journeyDescription()}. Right: ${label}.`;
  $('comparison-status').textContent = 'Review both source identities, then compare their saved content.';
  $('comparison-results').hidden = true; $('comparison-detail').replaceChildren(); $('comparison-rows').replaceChildren();
  $('comparison-close').disabled = false; syncComparison(); $('comparison-dialog').showModal(); $('comparison-start').focus({ preventScroll: true });
}
function renderScenarioComparison(value) {
  const counts = value.counts;
  $('scenario-comparison-summary').textContent = `${counts.paired} comparable nodes (${counts.changed} with differences), ${counts.onlyLeft} only on Left, ${counts.onlyRight} only on Right; ${counts.ambiguous} unpaired nodes have ambiguous identity claims. Ordinary questions: ${counts.questionsLeft} Left / ${counts.questionsRight} Right. Review warnings: ${counts.reviewLeft} Left / ${counts.reviewRight} Right.`;
  $('comparison-coverage').textContent = value.coverage;
  $('comparison-context').replaceChildren(...Object.entries(value.context).map(([field, content]) => el('section', {}, el('h3', {}, `${field}: ${content.same ? 'same recorded context' : 'different recorded context'}`), el('pre', {}, `Left: ${typeof content.left === 'string' ? content.left : JSON.stringify(content.left, null, 2)}\nRight: ${typeof content.right === 'string' ? content.right : JSON.stringify(content.right, null, 2)}`))));
  $('comparison-rows').replaceChildren(...value.items.map(row => el('option', { value: row.index }, `${row.index + 1}. ${row.relation}${row.ambiguous ? ' (ambiguous)' : ''}: ${row.label}`)));
  $('comparison-rows').value = String(value.selectedIndex); $('comparison-page').textContent = `Page ${value.page + 1} of ${value.pages}; ${value.total} saved-node rows.`;
  const row = value.selected;
  $('comparison-detail').replaceChildren(el('h3', {}, row.relation === 'paired' ? `Observed differences: ${row.differences.join(', ') || 'none in compared fields'}` : `${row.relation === 'only-left' ? 'Left only' : 'Right only'}: no unique matching origin${row.ambiguous ? ' (ambiguous claims)' : ''}`));
  for (const side of ['left', 'right']) {
    const node = row[side], title = side === 'left' ? 'Left' : 'Right';
    if (!node) { $('comparison-detail').append(el('p', {}, `${title}: no comparable saved node. This does not establish when or why it is absent.`)); continue; }
    const article = el('article', {}, el('h4', {}, `${title}: ${node.question}`), el('p', { class: 'quiet' }, `${node.id} · ${node.kind} · ${node.category}`),
      el('p', {}, `Answer state: ${ANSWER_STATES[node.answerState]}. ${node.review ? 'Needs review; retained reasoning is unresolved.' : 'No recorded review warning.'}`), el('pre', {}, node.answer || '(No saved answer)'),
      el('p', {}, node.parent ? `Parent: ${node.parent.question} (${node.parent.id})` : 'Root context'),
      el('p', {}, `Research: ${node.research ? node.research.basis === 'sources' ? 'sourced evidence' : 'model reasoning' : 'none retained'}. ${node.researchStale ? 'Marked stale; revisit before relying on it.' : 'No stale marker; this does not verify freshness.'}`));
    if (node.research) article.append(el('details', {}, el('summary', {}, 'Complete recorded research and source provenance'), el('pre', {}, JSON.stringify(node.research, null, 2))));
    if (node.reviewCauses) article.append(el('details', {}, el('summary', {}, 'Recorded review causes'), el('pre', {}, JSON.stringify(node.reviewCauses, null, 2))));
    article.append(el('p', {}, `${node.dependencies.length} of ${node.dependencyCount} upstream dependency details shown.`), el('ul', {}, ...node.dependencies.map(link => el('li', {}, `${link.prerequisite.question} (${link.prerequisite.id})${link.explanation ? `: ${link.explanation}` : ''}`))));
    $('comparison-detail').append(article);
  }
  $('comparison-results').hidden = false;
}
async function requestComparison(action, page = 0, selected = page * 25) {
  const c = comparison; if (!c || c.flight || c.navigating) return; syncComparison(); if (c.stale || busy) return;
  const abort = new AbortController(); c.flight = abort; syncComparison(); $('comparison-status').textContent = 'Reading and comparing saved sources…';
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch('api/scenario-compare', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, journey: c.journey, revision: c.revision, ...(action === 'preview' ? { target: c.target } : { id: c.value.id, page, selected }) }) });
    const value = await response.json(); if (comparison !== c || c.page !== pageEpoch || closed || suspended) return;
    syncComparison(); if (c.stale) return;
    if (!response.ok) throw Error(value.error);
    c.value = value; renderScenarioComparison(value); $('comparison-status').textContent = 'Recorded differences only. No scenario has been selected as a winner.';
  } catch (error) {
    if (comparison === c && c.page === pageEpoch) { c.stale = true; c.error = `${abort.signal.aborted ? 'Comparison timed out.' : error.message} Close and select refreshed sources to retry; your draft is retained.`; }
  } finally { clearTimeout(timer); c.flight = null; if (comparison === c) syncComparison(); }
}
async function openComparedSource(side) {
  const c = comparison; if (!c || c.flight || c.navigating) return; syncComparison();
  const node = c.value?.selected[side]; if (!node || $(`comparison-open-${side}`).disabled) return;
  c.navigating = true; $('comparison-close').disabled = true;
  try {
    const result = await switchJourney('open-compared-source', { journey: c.journey, revision: c.revision, id: c.value.id, side, nodeId: node.id }, () => comparison === c && c.page === pageEpoch && c.base === JSON.stringify(state.document));
    if (comparison !== c || c.page !== pageEpoch) return;
    if (result) { closeComparison(true); select(result.comparedNodeId); }
    else $('comparison-status').textContent = $('notice').textContent || 'Source navigation could not finish. Your current map and draft remain available.';
  } finally { c.navigating = false; if (comparison === c) { $('comparison-close').disabled = false; syncComparison(); } }
}
$('comparison-start').addEventListener('click', () => void requestComparison('preview'));
$('comparison-prev').addEventListener('click', () => { if (comparison?.value) void requestComparison('page', comparison.value.page - 1); });
$('comparison-next').addEventListener('click', () => { if (comparison?.value) void requestComparison('page', comparison.value.page + 1); });
$('comparison-rows').addEventListener('change', () => { if (comparison?.value) void requestComparison('page', comparison.value.page, Number($('comparison-rows').value)); });
for (const side of ['left', 'right']) $(`comparison-open-${side}`).addEventListener('click', () => void openComparedSource(side));
$('comparison-close').addEventListener('click', () => closeComparison());
$('comparison-dialog').addEventListener('cancel', event => { event.preventDefault(); closeComparison(); });
function closeScenarioFork(force = false) {
  if (scenarioFlight && !force) return;
  const prior = scenarioFork; scenarioFork = null;
  scenarioFlight?.abort(); scenarioFlight = null;
  if ($('scenario-fork-dialog').open) $('scenario-fork-dialog').close();
  if (prior?.preview && !prior.saved) void fetch('api/scenario-fork', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'discard', journey: prior.journey, revision: prior.revision, id: prior.preview.id }) }).catch(() => {});
  if (!force) prior?.focus?.focus({ preventScroll: true });
}
function resetScenarioPreview() {
  if (!scenarioFork || scenarioFlight) return;
  scenarioFork.preview = null; scenarioFork.saved = null;
  $('scenario-fork-review').hidden = true; $('scenario-fork-content').value = '';
  $('scenario-fork-confirm').hidden = true; $('scenario-fork-open').hidden = true;
  $('scenario-fork-status').textContent = 'Preview this alternative before saving.';
}
function renderScenarioLinks(page) {
  scenarioFork.links = page;
  $('scenario-fork-links').replaceChildren(...page.items.map(link => el('li', {}, `${link.dependent} (${link.dependentId}) depends on ${link.prerequisite} (${link.prerequisiteId})${link.explanation ? `: ${link.explanation}` : ''}. Omitted from this scenario.`)));
  $('scenario-fork-link-page').textContent = page.total ? `${page.offset + 1}–${page.offset + page.items.length} of ${page.total} omitted cross-path links.` : 'No dependency links cross outside the copied path.';
  $('scenario-fork-prev').disabled = page.offset === 0; $('scenario-fork-next').disabled = page.offset + page.items.length >= page.total;
}
async function openScenarioFork(node, answer, answerState) {
  if (!state.library || !switchAllowed('forking an alternative')) return;
  voice.cancel(); cleanup.cancel();
  const journey = referenceJourney(), source = JSON.stringify(state.document), page = pageEpoch, focus = $('answer');
  const edits = draftClient.entries.get(node.id)?.edits;
  try {
    await draftClient.flush();
    if (closed || suspended || page !== pageEpoch || journey !== referenceJourney() || selected !== node.id || source !== JSON.stringify(state.document) || edits !== draftClient.entries.get(node.id)?.edits) return notice('The editor or saved source changed. Review it before forking.');
    scenarioFork = { journey, revision: state.document.revision, source, nodeId: node.id, page, focus };
    $('scenario-fork-question').textContent = node.question; $('scenario-fork-answer').value = answer;
    $('scenario-fork-state').replaceChildren(...Object.entries(ANSWER_STATES).filter(([value]) => value !== 'unanswered').map(([value, label]) => el('option', { value }, label)));
    $('scenario-fork-state').value = answerState === 'unanswered' ? 'tentative' : answerState;
    for (const id of ['scenario-fork-answer', 'scenario-fork-state', 'scenario-fork-preview', 'scenario-fork-confirm', 'scenario-fork-close', 'scenario-fork-open', 'scenario-fork-prev', 'scenario-fork-next']) $(id).disabled = false;
    resetScenarioPreview();
    $('scenario-fork-dialog').showModal(); $('scenario-fork-answer').focus();
  } catch (error) { notice(`Draft could not be preserved. ${error.message}`); }
}
async function requestScenarioFork(action, offset) {
  const context = scenarioFork;
  if (!context || scenarioFlight || closed || suspended) return;
  if (context.journey !== referenceJourney() || context.source !== JSON.stringify(state.document) || state.pending || state.preview) { $('scenario-fork-status').textContent = 'The saved source changed or work is active. Close and preview again after resolving it.'; return; }
  const current = () => scenarioFork === context && context.page === pageEpoch && !closed && !suspended;
  const abort = new AbortController(); scenarioFlight = abort; const timer = setTimeout(() => abort.abort(), 15000);
  for (const id of ['scenario-fork-answer', 'scenario-fork-state', 'scenario-fork-preview', 'scenario-fork-confirm', 'scenario-fork-close', 'scenario-fork-open', 'scenario-fork-prev', 'scenario-fork-next']) $(id).disabled = true;
  $('scenario-fork-status').textContent = action === 'confirm' ? 'Saving the reviewed scenario…' : 'Reading saved context…';
  try {
    const input = { action, journey: context.journey, revision: context.revision, ...(action === 'preview' ? { nodeId: context.nodeId, answer: $('scenario-fork-answer').value, answerState: $('scenario-fork-state').value } : { id: context.preview.id }), ...(action === 'links' ? { offset } : {}) };
    const response = await fetch('api/scenario-fork', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) }), result = await response.json();
    if (!current()) return;
    if (!response.ok) throw Error(result.error);
    if (action === 'preview') {
      context.preview = result; context.saved = null;
      $('scenario-fork-review').hidden = false; $('scenario-fork-content').value = result.content;
      $('scenario-fork-summary').textContent = `${result.copiedNodes} copied path nodes; ${result.omittedNodes} other nodes remain only in the original. Destination: personal library. Scenario ID: ${result.scenarioId}.`;
      renderScenarioLinks(result.links); $('scenario-fork-confirm').hidden = false; $('scenario-fork-open').hidden = true;
      $('scenario-fork-status').textContent = result.existing ? 'An identical scenario already exists. Confirm to verify and reopen it.' : 'Review the exact copied answers and omissions, then save.';
      $('scenario-fork-content').focus();
    } else if (action === 'links') { renderScenarioLinks(result); $('scenario-fork-status').textContent = 'Review the omitted dependency links.'; }
    else {
      context.saved = result; $('scenario-fork-confirm').hidden = true; $('scenario-fork-open').hidden = false;
      $('scenario-fork-status').textContent = 'Scenario saved in your personal library. The original is still open. Open the scenario explicitly to continue or use Save project copy there to share it.';
    }
  } catch (error) { if (current()) $('scenario-fork-status').textContent = abort.signal.aborted ? 'Response timed out. A save may have completed. Retry the same confirmation to verify the same scenario.' : error.message; }
  finally {
    clearTimeout(timer);
    if (scenarioFlight === abort) {
      scenarioFlight = null;
      for (const id of ['scenario-fork-answer', 'scenario-fork-state', 'scenario-fork-preview', 'scenario-fork-confirm', 'scenario-fork-close', 'scenario-fork-open']) $(id).disabled = false;
      if (current() && context.links) renderScenarioLinks(context.links);
    }
  }
}
$('scenario-fork-preview').addEventListener('click', () => { void requestScenarioFork('preview'); });
$('scenario-fork-confirm').addEventListener('click', () => { void requestScenarioFork('confirm'); });
$('scenario-fork-prev').addEventListener('click', () => { void requestScenarioFork('links', scenarioFork.links.offset - 25); });
$('scenario-fork-next').addEventListener('click', () => { void requestScenarioFork('links', scenarioFork.links.offset + 25); });
for (const id of ['scenario-fork-answer', 'scenario-fork-state']) $(id).addEventListener('input', resetScenarioPreview);
$('scenario-fork-close').addEventListener('click', () => closeScenarioFork());
$('scenario-fork-dialog').addEventListener('cancel', event => { event.preventDefault(); closeScenarioFork(); });
$('scenario-fork-open').addEventListener('click', async () => {
  const context = scenarioFork;
  if (!context?.saved || scenarioFlight) return;
  if (await switchJourney('open', { key: context.saved.key }, () => scenarioFork === context && context.page === pageEpoch)) closeScenarioFork(true);
});
function cancelProjectGitStatus() { projectGitEpoch++; projectGitFlight?.abort(); projectGitFlight = null; }
function renderProjectGitStatus() {
  $('project-git-panel').hidden = state.storage?.scope !== 'project';
  $('project-editor-status').textContent = draftClient.uncommitted() ? 'Private answer drafts are not in the project file. Save answers when ready; recovered conflicts need review.' : 'No unsaved answer drafts in this canvas.';
  $('project-git-refresh').disabled = !!projectGitFlight;
  const result = $('project-git-result');
  if (projectGitFlight) { result.textContent = 'Reading selected-file and branch status locally…'; return; }
  if (projectGitError) { result.textContent = projectGitError; return; }
  if (!projectGitResult) { result.textContent = 'Refresh to inspect this journey’s saved file and Git state.'; return; }
  const status = projectGitResult, git = status.git, lines = [];
  lines.push(`Observed ${new Date(status.checkedAt).toLocaleTimeString()}. This is a snapshot; refresh after Git or file changes.`);
  if (status.revision !== state.document?.revision || state.projectChange) lines.push('The map or checkout changed since this observation. Review project changes and refresh.');
  lines.push({ saved: 'Saved file matches the displayed map at the time of this observation.', review: 'File or checkout differs from the displayed base. Review project changes before editing.', missing: 'The selected project file is missing. Preserve the displayed version or recover through Git.', unavailable: 'Saved-file status is unknown.' }[status.source]);
  if (git.state !== 'available') lines.push(status.message);
  else {
    lines.push(`Selected file: ${ { untracked: 'Untracked — add it through your Git workflow to share it.', ignored: 'Ignored — review repository ignore rules if this file should be shared.', committed: 'Committed in the current local HEAD; selected file has no staged or unstaged changes.', modified: 'Has local Git changes; review them before committing.', conflicted: 'Unresolved Git conflict; resolve it before reopening.', missing: 'Missing and not reported as tracked by Git.' }[git.file] }`);
    const labels = { '.': 'none', M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged', T: 'type changed' };
    lines.push(`Staged: ${labels[git.index]}. Unstaged: ${labels[git.worktree]}. Other repository files are outside this view.`);
    lines.push(git.detached ? `Repository: detached HEAD ${git.head.slice(0, 12)}. Choose a branch in Git before sharing.` : `Repository branch: ${git.branch}${git.unborn ? ' (no commits yet)' : ''}.`);
    lines.push(!git.upstream ? 'No upstream configured. Configure one in your Git workflow to compare branches.' : git.ahead === null ? `Upstream ${git.upstream}: comparison unavailable from local refs.` : `Local comparison with ${git.upstream}: ${git.ahead} ahead, ${git.behind} behind. Counts describe the whole branch, not just this file.`);
  }
  lines.push('Remote freshness is unknown. Local tracking refs may be stale; Explorer does not fetch or verify GitHub. Use your Git workflow to fetch, review, commit and share.');
  result.replaceChildren(...lines.filter(Boolean).map(line => el('p', {}, line)));
}
$('project-git-refresh').addEventListener('click', async () => {
  cancelProjectGitStatus(); const epoch = projectGitEpoch, page = pageEpoch, journey = state.activeKey, abort = new AbortController();
  projectGitFlight = abort; projectGitError = ''; renderProjectGitStatus();
  const current = () => !closed && !suspended && epoch === projectGitEpoch && page === pageEpoch && journey === state.activeKey;
  const timeout = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch('api/project-git-status', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ journey }) });
    const result = await response.json(); if (!response.ok) throw Error(result.error ?? 'Status unavailable.');
    if (current()) projectGitResult = result;
  } catch (error) { if (current()) { projectGitResult = null; projectGitError = abort.signal.aborted ? 'Status check timed out. Refresh to retry.' : error.message; } }
  finally { clearTimeout(timeout); if (current()) { projectGitFlight = null; renderProjectGitStatus(); } }
});
let projectReconcileEpoch = 0, projectReconcilePreview = null, projectReconcileFlight = null;
function closeProjectReconciliation() {
  projectReconcileEpoch++; projectReconcileFlight?.abort(); projectReconcileFlight = null; projectReconcilePreview = null;
  $('project-reconcile-dialog').close(); $('project-reconcile-content').value = ''; $('project-reconcile-review').hidden = true; $('project-reconcile-reload').hidden = true;
  $($('project-reconcile-open').hidden ? 'library-toggle' : 'project-reconcile-open').focus({ preventScroll: true });
}
async function requestProjectReconciliation(action = 'inspect') {
  projectReconcileFlight?.abort(); const abort = new AbortController(); projectReconcileFlight = abort;
  const epoch = ++projectReconcileEpoch, page = pageEpoch, journey = state.activeKey, revision = state.document?.revision;
  const current = () => !closed && !suspended && page === pageEpoch && epoch === projectReconcileEpoch && $('project-reconcile-dialog').open && journey === state.activeKey;
  projectReconcilePreview = null; $('project-reconcile-review').hidden = true; $('project-reconcile-reload').hidden = true; $('project-reconcile-content').value = '';
  $('project-reconcile-status').textContent = action === 'inspect' ? 'Checking current project content and checkout…' : 'Preserving the displayed committed version privately…';
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch('api/project-reconciliation', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, journey, revision }) });
    const result = await response.json(); if (!current()) return;
    if (!response.ok) throw Error(result.error);
    if (action === 'preserve') $('project-reconcile-status').textContent = 'Displayed committed version preserved privately. Use File → Recovery to inspect it. Your drafts remain separate and unchanged.';
    else if (result.status === 'current') $('project-reconcile-status').textContent = 'The project file and checkout still match the displayed base. No reload is needed.';
    else {
      projectReconcilePreview = result; $('project-reconcile-review').hidden = false; $('project-reconcile-reload').hidden = false;
      $('project-reconcile-path').textContent = `${result.path} · ${result.nodes} nodes`; $('project-reconcile-content').value = result.content;
      $('project-reconcile-status').textContent = result.changed ? 'Incoming content differs. Review it before reloading. Your previous map and draft bases will be retained.' : 'File content is unchanged, but file identity or checkout context changed. Review before attaching to this current source.';
      $('project-reconcile-content').focus();
    }
  } catch (error) { if (current()) $('project-reconcile-status').textContent = abort.signal.aborted ? 'Review timed out. Retry explicitly; no project file was rewritten.' : `${error.message} The displayed map and private drafts remain available. You can preserve the displayed version or resolve the file through Git, then refresh.`; }
  finally { clearTimeout(timer); if (projectReconcileFlight === abort) projectReconcileFlight = null; }
}
for (const id of ['project-reconcile-open', 'project-change-review']) $(id).addEventListener('click', () => { voice.cancel(); $('project-reconcile-dialog').showModal(); $('project-reconcile-close').focus(); void requestProjectReconciliation(); });
$('project-reconcile-refresh').addEventListener('click', () => { void requestProjectReconciliation(); });
$('project-reconcile-preserve').addEventListener('click', () => { void requestProjectReconciliation('preserve'); });
$('project-reconcile-reload').addEventListener('click', async () => {
  const preview = projectReconcilePreview, epoch = projectReconcileEpoch;
  if (!preview || busy) return;
  voice.cancel(); $('workspace').inert = true;
  try {
    await draftClient.flush();
    if (preview === projectReconcilePreview && epoch === projectReconcileEpoch && $('project-reconcile-dialog').open) {
      const result = await api('project-reload', { id: preview.id, journey: state.activeKey });
      if (result) closeProjectReconciliation(); else $('project-reconcile-status').textContent = 'Reload did not complete. Refresh this preview to inspect the current source; your original map and drafts are retained.';
    }
  } catch (error) { $('project-reconcile-status').textContent = `Draft persistence failed: ${error.message}. Retry or recover the draft before reloading.`; }
  finally { $('workspace').inert = false; }
});
$('project-reconcile-close').addEventListener('click', closeProjectReconciliation);
$('project-reconcile-dialog').addEventListener('cancel', event => { event.preventDefault(); closeProjectReconciliation(); });
let projectMergeEpoch = 0, projectMergeFlight = null, projectMergeData = null, projectMergePlan = null, projectMergeChoices = {};
function invalidateProjectMergeResult() {
  projectMergeEpoch++; projectMergeFlight?.abort(); projectMergeFlight = null;
  if (projectMergePlan) projectMergePlan.token = null;
  $('project-merge-result').value = ''; $('project-merge-ack').checked = false; $('project-merge-save').disabled = true;
  $('project-merge-consequences').textContent = ''; $('project-merge-preview').disabled = false; $('project-merge-resolve').disabled = false;
}
function clearProjectMerge() {
  invalidateProjectMergeResult(); projectMergeData = null; projectMergePlan = null; projectMergeChoices = {};
  $('project-merge-review').hidden = true; $('project-merge-conflict').replaceChildren();
  for (const id of ['project-merge-source-content', 'project-merge-local', 'project-merge-incoming']) $(id).value = '';
}
function closeProjectMerge() {
  const previous = projectMergeData; clearProjectMerge(); $('project-merge-dialog').close();
  if (previous) void fetch('api/project-merge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'cancel', id: previous.id, journey: previous.journey, revision: previous.revision }) }).catch(() => {});
  $($('project-merge-open').hidden ? 'library-toggle' : 'project-merge-open').focus({ preventScroll: true });
}
function renderProjectMergeCandidate() {
  const id = $('project-merge-conflict').value;
  for (const side of ['local', 'incoming']) {
    const doc = projectMergeData?.documents[side]; let value;
    if (doc && id.startsWith('node:')) value = doc.journey.nodes.find(node => node.id === id.slice(5));
    else if (doc && id.startsWith('field:')) value = doc.journey[id.slice(6)];
    else if (doc && id.startsWith('handoff-record:')) value = doc.journey.reviewHandoffs?.records.find(row => row.id === id.slice('handoff-record:'.length));
    else if (doc && id.startsWith('comment-')) {
      const [kind, threadId, messageId] = id.split(':'), thread = doc.journey.comments?.threads.find(row => row.id === threadId);
      value = kind === 'comment-thread' ? thread : kind === 'comment-message' ? thread?.messages.find(row => row.id === messageId) : kind === 'comment-status' && thread ? { status: thread.status, messages: thread.messages } : undefined;
    }
    else if (doc && id === 'order') value = doc.journey.nodes.map(node => node.id);
    else if (doc && id === 'extensions') value = doc.extensions;
    else if (doc && id === 'graph') value = doc;
    $(`project-merge-${side}`).value = value === undefined ? '(Absent / deleted)' : JSON.stringify(value, null, 2);
  }
  $('project-merge-choice').value = projectMergeChoices[id] ?? '';
}
function renderProjectMergePlan(plan) {
  projectMergePlan = plan; const selectedConflict = $('project-merge-conflict').value;
  $('project-merge-conflicts').hidden = !plan?.conflicts.length;
  $('project-merge-conflict').replaceChildren(...(plan?.conflicts ?? []).map((row, index) => el('option', { value: row.id }, `${index + 1}. ${row.label.slice(0, 160)}`)));
  if (plan?.conflicts.some(row => row.id === selectedConflict)) $('project-merge-conflict').value = selectedConflict;
  renderProjectMergeCandidate(); $('project-merge-result').value = plan?.content ?? ''; $('project-merge-ack').checked = false;
  $('project-merge-save').disabled = true; $('project-merge-resolve').disabled = !plan;
  const affected = plan?.affected ?? [];
  $('project-merge-consequences').textContent = affected.length ? `${affected.length} questions or directions will remain marked for review: ${affected.map(id => projectMergeData.documents.local.journey.nodes.find(n => n.id === id)?.question ?? projectMergeData.documents.incoming.journey.nodes.find(n => n.id === id)?.question ?? id).join('; ')}` : 'No additional downstream review flags.';
  if (plan) $('project-merge-status').textContent = plan.error ? `These choices do not form a valid map: ${plan.error} Adjust the choices; saving is disabled.` : plan.unresolved.length ? `${plan.unresolved.length} conflicts need explicit choices. Both original candidates remain available.` : 'Review the proposed result, then acknowledge its consequences to save.';
}
async function requestProjectMerge(action) {
  if (closed || suspended || busy) return;
  invalidateProjectMergeResult(); const epoch = projectMergeEpoch, page = pageEpoch, journey = state.activeKey, revision = state.document?.revision;
  const abort = new AbortController(); projectMergeFlight = abort;
  const current = () => !closed && !suspended && page === pageEpoch && epoch === projectMergeEpoch && journey === state.activeKey && revision === state.document?.revision && $('project-merge-dialog').open;
  const timer = setTimeout(() => abort.abort(), 30000);
  $('project-merge-preview').disabled = true; $('project-merge-resolve').disabled = true; $('project-merge-status').textContent = action === 'preview' ? 'Reading local Git sources and their common base…' : 'Validating the selected result and its consequences…';
  try {
    const input = { action, journey, revision, ...(action === 'preview' ? { ref: $('project-merge-ref').value } : { id: projectMergeData.id, choices: projectMergeChoices }) };
    const response = await fetch('api/project-merge', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const result = await response.json(); if (!current()) return; if (!response.ok) throw Error(result.error);
    if (action === 'preview') {
      projectMergeChoices = {}; projectMergeData = { ...result, journey, revision, documents: Object.fromEntries(Object.entries(result.sources).map(([key, source]) => [key, source ? JSON.parse(source.replace(/^\uFEFF/, '')) : null])) };
      $('project-merge-review').hidden = false; $('project-merge-source').value = 'local'; $('project-merge-source-content').value = result.sources.local;
      renderProjectMergePlan(result.plan);
      if (!result.plan) $('project-merge-status').textContent = result.message;
    } else renderProjectMergePlan(result);
  } catch (error) { if (current()) $('project-merge-status').textContent = abort.signal.aborted ? 'Comparison timed out. Retry explicitly. No project file was rewritten by this preview.' : error.message; }
  finally { clearTimeout(timer); if (projectMergeFlight === abort) { projectMergeFlight = null; $('project-merge-preview').disabled = false; $('project-merge-resolve').disabled = !projectMergePlan; } }
}
$('project-merge-open').addEventListener('click', () => { clearProjectMerge(); voice.cancel(); $('project-merge-status').textContent = ''; $('project-merge-dialog').showModal(); $('project-merge-ref').focus(); });
$('project-merge-ref').addEventListener('input', () => { clearProjectMerge(); $('project-merge-status').textContent = 'Source changed. Compare again.'; });
$('project-merge-preview').addEventListener('click', () => { void requestProjectMerge('preview'); });
$('project-merge-resolve').addEventListener('click', () => { void requestProjectMerge('resolve'); });
$('project-merge-conflict').addEventListener('change', renderProjectMergeCandidate);
$('project-merge-choice').addEventListener('change', () => {
  const id = $('project-merge-conflict').value, choice = $('project-merge-choice').value; if (!id) return;
  if (id !== 'graph') delete projectMergeChoices.graph;
  if (choice) projectMergeChoices[id] = choice; else delete projectMergeChoices[id];
  invalidateProjectMergeResult(); $('project-merge-status').textContent = 'Choices changed. Preview the chosen result again.';
});
$('project-merge-source').addEventListener('change', () => { $('project-merge-source-content').value = projectMergeData?.sources[$('project-merge-source').value] ?? 'No compatible common base available.'; });
$('project-merge-copy').addEventListener('click', async () => {
  const content = projectMergeData?.sources[$('project-merge-source').value]; if (!content) return;
  try { await navigator.clipboard.writeText(content); $('project-merge-status').textContent = 'Selected source copied. Save it separately to retain a recovery copy.'; }
  catch { $('project-merge-source-content').focus(); $('project-merge-source-content').select(); $('project-merge-status').textContent = 'Copy was unavailable. Copy the selected source text manually.'; }
});
$('project-merge-ack').addEventListener('change', () => { $('project-merge-save').disabled = !projectMergePlan?.token || !$('project-merge-ack').checked; });
$('project-merge-save').addEventListener('click', async () => {
  const preview = projectMergeData, plan = projectMergePlan, epoch = projectMergeEpoch;
  if (!preview || !plan?.token || !$('project-merge-ack').checked || busy) return;
  voice.cancel(); $('workspace').inert = true; $('project-merge-review').inert = true; $('project-merge-ref').disabled = true; $('project-merge-preview').disabled = true; $('project-merge-close').disabled = true; $('project-merge-save').disabled = true;
  try {
    await draftClient.flush();
    if (preview === projectMergeData && plan === projectMergePlan && epoch === projectMergeEpoch && $('project-merge-dialog').open) {
      const result = await api('project-merge-accept', { id: preview.id, token: plan.token, journey: preview.journey, acknowledged: true });
      if (result) closeProjectMerge(); else { invalidateProjectMergeResult(); $('project-merge-status').textContent = 'Merge did not complete or its response was lost. Refresh the saved map before comparing again. Your private drafts are retained.'; }
    }
  } catch (error) { $('project-merge-status').textContent = `Draft persistence failed: ${error.message}. Retry or recover the draft before merging.`; }
  finally { $('workspace').inert = false; $('project-merge-review').inert = false; $('project-merge-ref').disabled = false; $('project-merge-preview').disabled = false; $('project-merge-close').disabled = false; }
});
$('project-merge-close').addEventListener('click', closeProjectMerge);
$('project-merge-dialog').addEventListener('cancel', event => { event.preventDefault(); if (!$('project-merge-close').disabled) closeProjectMerge(); });
let projectCopyEpoch = 0, projectCopyPreview = null, projectCopyFlight = null;
function clearProjectCopy(message = '') {
  projectCopyEpoch++; projectCopyFlight?.abort(); projectCopyFlight = null; projectCopyPreview = null;
  $('project-copy-review').hidden = true; $('project-copy-content').value = '';
  $('project-copy-confirm').hidden = true; $('project-copy-continue').hidden = true;
  $('project-copy-status').textContent = message; $('project-copy-preview').disabled = false;
}
function closeProjectCopy() {
  clearProjectCopy(); $('project-copy-dialog').close();
  $($('project-copy-open').hidden ? 'library-toggle' : 'project-copy-open').focus({ preventScroll: true });
}
async function requestProjectCopy(action) {
  const preview = projectCopyPreview;
  if (action === 'confirm' && !preview) return;
  if (action === 'preview') clearProjectCopy();
  projectCopyFlight?.abort(); const abort = new AbortController(); projectCopyFlight = abort;
  const epoch = ++projectCopyEpoch, page = pageEpoch, journey = state.activeKey, revision = state.document?.revision;
  const current = () => !closed && !suspended && page === pageEpoch && epoch === projectCopyEpoch && $('project-copy-dialog').open && journey === state.activeKey;
  const timer = setTimeout(() => abort.abort(), 20000);
  $('project-copy-preview').disabled = true; $('project-copy-confirm').disabled = true;
  $('project-copy-status').textContent = action === 'preview' ? 'Preparing exact committed content…' : 'Verifying and saving reviewed content…';
  try {
    const input = { action, journey, revision, ...(action === 'preview' ? { folder: $('project-copy-folder').value, includeResearch: $('project-copy-research').checked, newCopy: $('project-copy-additional').checked } : { id: preview.id }) };
    const response = await fetch('api/project-copy', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const result = await response.json(); if (!current()) return;
    if (!response.ok) throw Error(result.error);
    if (action === 'preview') {
      projectCopyPreview = result; $('project-copy-review').hidden = false; $('project-copy-path').textContent = `Destination: ${result.path}`;
      $('project-copy-content').value = result.content; $('project-copy-confirm').hidden = false;
      $('project-copy-confirm').textContent = result.existing ? 'Confirm existing identical copy' : 'Save reviewed copy';
      $('project-copy-status').textContent = `${result.existing ? 'Identical copy already exists. ' : ''}${result.researchCount} question research records ${result.researchIncluded ? 'included' : 'omitted'}. Review the file, then confirm. Personal content and drafts remain unchanged.`;
      $('project-copy-content').focus();
    } else {
      $('project-copy-confirm').hidden = true; $('project-copy-continue').hidden = false;
      $('project-copy-status').textContent = `Verified project copy: ${result.path}. Your personal journey is still open. Commit and share this file through Git when ready.`;
      $('project-copy-continue').focus();
    }
  } catch (error) { if (current()) $('project-copy-status').textContent = abort.signal.aborted ? action === 'preview' ? 'Preview timed out. Retry preparing the preview; no copy was saved by this preview request.' : 'Response timed out. The copy may be saved. Retry this same confirmation to verify it without creating another copy.' : error.message; }
  finally { clearTimeout(timer); if (projectCopyFlight === abort) { projectCopyFlight = null; $('project-copy-preview').disabled = false; $('project-copy-confirm').disabled = false; } }
}
$('project-copy-open').addEventListener('click', () => { clearProjectCopy(); $('project-copy-dialog').showModal(); $('project-copy-folder').focus(); });
$('project-copy-preview').addEventListener('click', () => { void requestProjectCopy('preview'); });
$('project-copy-confirm').addEventListener('click', () => { void requestProjectCopy('confirm'); });
$('project-copy-continue').addEventListener('click', async () => {
  const preview = projectCopyPreview, epoch = projectCopyEpoch;
  if (preview && await switchJourney('open-project-copy', { id: preview.id }, () => projectCopyPreview === preview && epoch === projectCopyEpoch && $('project-copy-dialog').open)) closeProjectCopy();
});
for (const id of ['project-copy-folder', 'project-copy-research', 'project-copy-additional']) $(id).addEventListener('input', () => clearProjectCopy('Selection changed. Preview again.'));
$('project-copy-close').addEventListener('click', closeProjectCopy);
$('project-copy-dialog').addEventListener('cancel', event => { event.preventDefault(); closeProjectCopy(); });
async function switchJourney(action, input, current = () => true) {
  if (!switchAllowed()) return null;
  voice.cancel();
  $('workspace').inert = true; $('welcome').inert = true;
  let result;
  try { await draftClient.flush(); if (current()) result = await api(action, input); }
  catch (error) { notice(`Draft could not be saved. ${error.message} Return to the map to retry or explicitly discard the draft.`); }
  finally { $('workspace').inert = false; $('welcome').inert = false; }
  if (result?.importConflict) {
    importDocument = input.document;
    $('import-existing').replaceChildren(...result.importConflict.entries.map(entry => button(`Open saved: ${entry.topic} (${entry.key.slice(0, 8)})`, async () => {
      if (await switchJourney('open', { key: entry.key })) { importDocument = null; $('import-conflict').close(); }
    })));
    $('import-conflict').showModal(); return null;
  }
  if (result) { libraryView = false; showView(); refreshScene(null); fit(); $('map').focus({ preventScroll: true }); }
  return result;
}
function focusTop(id, height) {
  // Reserve room for writing before making space for the surrounding branch.
  const node = state.document.nodes.find(n => n.id === id);
  const parent = state.document.nodes.find(n => n.id === node?.parentId);
  return Math.max(16, Math.min(parent ? compactSize(parent, 'detail').height + 96 : 24, height - 480));
}
function select(id, { outlineRow = false } = {}) {
  if (paletteOpen() && id !== selected) closePalette(false);
  if (!state.document?.nodes.some(n => n.id === id)) return;
  if (outlineMode) outlineNavigated = true;
  endDrag();
  voice.cancel();
  if (focusId && !withinFocus(id)) { focusId = null; wholeView = null; }
  collapsed = revealPath(state.document.nodes, collapsed, id);
  branches = currentBranches(state.document, id);
  updateFocusStatus();
  const rect = $('map').getBoundingClientRect(), width = Math.min(560, rect.width - 32), old = anchorPoint(id);
  const anchor = { id, x: Math.max(width / 2 + 16, Math.min(rect.width - width / 2 - 16, old?.x ?? rect.width / 2)), y: focusTop(id, rect.height) };
  captureWorkspace(); selected = id; expanded = true; view.zoom = 1;
  renderWorkspace(); refreshScene(anchor); if (outlineMode && !outlineRow) revealOutlineSelection(false); else renderOutline(); $('expanded-title').focus({ preventScroll: true });
}
function toggleBranch(id, source) {
  if (criticalPrior) return;
  const node = state.document?.nodes.find(n => n.id === id);
  if (!node || !branches.parentIds.has(id)) return;
  if (outlineMode) outlineNavigated = true;
  endDrag();
  const folding = !collapsed.has(id), anchor = anchorPoint(id);
  if (folding && focusId && id !== focusId && focusAncestor(id)) { focusId = null; wholeView = null; updateFocusStatus(); }
  if (folding) collapsed.add(id); else collapsed.delete(id);
  let moved = false;
  if (folding && selected !== id) {
    const parents = new Map(state.document.nodes.map(n => [n.id, n.parentId]));
    for (let parent = parents.get(selected); parent != null; parent = parents.get(parent)) {
      if (parent !== id) continue;
      voice.cancel(); captureWorkspace(); selected = id; expanded = false; moved = true; break;
    }
  }
  branches = currentBranches();
  renderWorkspace(); refreshScene(anchor); renderOutline();
  if (moved) revealNode(id);
  const focus = moved && outlineMode ? [...$('outline-list').querySelectorAll('[data-node-id]')].find(e => e.dataset.nodeId === id) : moved ? [...$('nodes').children].find(e => e.dataset.nodeId === id) :
    source === 'outline' ? [...$('outline-list').querySelectorAll('[data-branch-id]')].find(e => e.dataset.branchId === id) :
    expanded && selected === id ? $('branch-workspace') :
      [...$('nodes').children].find(e => e.dataset.branchId === id);
  focus?.focus({ preventScroll: true });
  if (outlineMode) focus?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function hiddenSummary(id) {
  const count = branches.nodeCounts.get(id), questions = branches.descendants.get(id);
  return `${count} hidden ${count === 1 ? 'node' : 'nodes'} · ${questions.total} questions · ${questions.unresolved} unresolved`;
}
function branchButton(node, workspace = false) {
  if (!branches.parentIds.has(node.id)) return null;
  const folded = collapsed.has(node.id), label = `${folded ? 'Expand' : 'Collapse'} branch`;
  return button(label, event => toggleBranch(node.id, event.currentTarget.closest('.outline') ? 'outline' : 'map'), { ...(workspace ? { id: 'branch-workspace' } : {}),
    class: workspace ? 'workspace-branch-toggle' : 'branch-toggle', 'data-branch-id': node.id,
    'aria-label': `${label}: ${node.question}`, 'aria-expanded': String(!folded), disabled: !!criticalPrior });
}
function focusAncestor(id) {
  const byId = new Map(state.document.nodes.map(node => [node.id, node]));
  for (let node = byId.get(focusId); node; node = byId.get(node.parentId)) if (node.id === id) return true;
  return false;
}
function withinFocus(id) {
  if (focusAncestor(id)) return true;
  const byId = new Map(state.document.nodes.map(node => [node.id, node]));
  for (let node = byId.get(id); node; node = byId.get(node.parentId)) if (node.id === focusId) return true;
  return false;
}
function updateFocusStatus() {
  const node = state.document?.nodes.find(n => n.id === focusId);
  $('focus-access').hidden = !node;
  $('show-whole-map').hidden = !node;
  $('focus-status').textContent = node ? `Focusing branch: ${node.question}` : '';
  $('focus-branch')?.setAttribute('aria-pressed', String(!!node && selected === node.id));
}
function showWholeMap() {
  if (criticalPrior) return;
  if (!focusId) return;
  if (outlineMode) outlineNavigated = true;
  endDrag();
  focusId = null;
  collapsed = revealPath(state.document.nodes, collapsed, selected);
  branches = currentBranches();
  if (wholeView) view = wholeView;
  wholeView = null;
  updateFocusStatus();
  refreshScene(null);
  revealNode(selected);
  const focusTarget = expanded ? ($('question-tools-body').hidden ? $('question-tools-toggle') : $('question-context').open ? $('focus-branch') : $('question-context').querySelector('summary')) : $('map');
  if ($('question-drawer').contains(focusTarget)) setQuestionToolTab('context');
  focusTarget.focus({ preventScroll: true });
}
function focusBranch(id) {
  if (criticalPrior) return;
  if (id === state.document.rootId) { showWholeMap(); return; }
  if (outlineMode) outlineNavigated = true;
  if (!wholeView) wholeView = { ...view };
  focusId = id;
  branches = currentBranches();
  updateFocusStatus();
  refreshScene(anchorPoint(id));
}
function collapseNode(focus = true) {
  if (outlineMode) outlineNavigated = true;
  endDrag();
  voice.cancel();
  const anchor = anchorPoint(); captureWorkspace(); expanded = false;
  renderWorkspace(); refreshScene(anchor);
  if (focus) revealNode(selected);
  if (focus && outlineMode) revealOutlineSelection();
  else if (focus) [...$('nodes').children].find(e => e.dataset.nodeId === selected)?.focus({ preventScroll: true });
}
function zoomDetail(zoom, previous) {
  if (zoom < .35 || previous === 'schematic' && zoom < .4) return 'schematic';
  if (zoom <= .55 || ['schematic', 'overview'].includes(previous) && zoom < .65) return 'overview';
  if (zoom < .9 || previous !== 'detail' && zoom < 1) return 'question';
  return 'detail';
}
function compactSize(node, tier = detailTier) {
  return tier === 'overview' || tier === 'schematic' ? { width: 280, height: 200 } :
    { width: 220, height: tier === 'question' ? 144 : node.answer ? 176 : 136 };
}
function refreshScene(anchor = anchorPoint()) {
  if (closed || outlineMode || !state.document) return;
  const panel = $('node-workspace'), rect = $('map').getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  viewportSize ??= { width: rect.width, height: rect.height };
  detailTier = zoomDetail(view.zoom, detailTier);
  $('world').dataset.detail = detailTier;
  const width = Math.min(560, Math.max(100, rect.width - 32));
  // Panel size must not change merely because the user pans it up or down.
  const height = Math.max(80, rect.height - focusTop(selected, rect.height) - 16);
  panel.style.width = `${width}px`; panel.style.maxHeight = `${height}px`;
  panel.classList.toggle('short-pane', height < 320);
  panel.classList.toggle('scroll-pane', height < 160);
  if (height >= 160) panel.scrollTop = 0;
  panel.style.transform = `scale(${1 / view.zoom})`;
  panel.style.setProperty('--heading-limit', `${Math.max(112, Math.min(180, height * .35))}px`);
  const measuredHeight = expanded ? panel.offsetHeight / view.zoom : 0, logicalWidth = expanded ? width / view.zoom : 0;
  if (fitBranches !== branches) {
    // A compact upper bound, independent of zoom and the counter-scaled editor.
    fitGeometry.get(branches.nodes, state.document.rootId, new Map(branches.nodes.map(n => [n.id, { width: 280, height: 200 }])), [state.activeKey, state.document.id]);
    fitBranches = branches;
  }
  const inputs = JSON.stringify([state.activeKey, state.document.id, rect.width, rect.height, fontEpoch, expanded ? selected : null, logicalWidth, measuredHeight, detailTier === 'schematic' ? 'overview' : detailTier]);
  if (geometryBranches !== branches || geometryInputs !== inputs) {
    const sizes = new Map(branches.nodes.map(n => [n.id, compactSize(n)]));
    if (expanded) sizes.set(selected, { width: logicalWidth, height: measuredHeight });
    positions = geometryCache.get(branches.nodes, state.document.rootId, sizes, [state.activeKey, state.document.id, rect.width, rect.height, fontEpoch, expanded ? selected : null]).positions;
    geometryBranches = branches; geometryInputs = inputs;
  }
  if (anchor && positions.has(anchor.id)) {
    const p = positions.get(anchor.id);
    view.x = anchor.x - (p.x + p.width * (anchor.relativeX ?? .5)) * view.zoom;
    view.y = anchor.y - (p.y + p.height * (anchor.relativeY ?? 0)) * view.zoom;
  }
  if (expanded) { const p = positions.get(selected); panel.style.left = `${p.x}px`; panel.style.top = `${p.y}px`; }
  transform();
}
function scheduleLayout() { if (!closed && !outlineMode) { cancelAnimationFrame(layoutFrame); layoutFrame = requestAnimationFrame(() => refreshScene()); } }
function renderMap() {
  // Workspace focus can fire between visibility replacement and its synchronous scene refresh.
  if (closed || outlineMode || !geometryCache.value || geometryBranches !== branches) return;
  const viewport = viewportBounds(view, $('map').getBoundingClientRect());
  const active = document.activeElement, owner = $('nodes').contains(active) ? active.closest('[data-node-id],[data-branch-id]') : null;
  const activeId = owner?.dataset.nodeId ?? owner?.dataset.branchId;
  const doc = state.document, nodes = $('nodes'), edges = $('edges');
  const cards = new Map([...nodes.querySelectorAll('[data-node-id]')].map(e => [e.dataset.nodeId, e]));
  const toggles = new Map([...nodes.querySelectorAll('[data-branch-id]')].map(e => [e.dataset.branchId, e]));
  const paths = new Map([...edges.querySelectorAll('path')].map(e => [e.dataset.edgeId, e]));
  $('map-hint').hidden = expanded && detailTier !== 'schematic';
  $('map-hint').textContent = detailTier === 'schematic' ? 'Map overview. Zoom in or use Outline to read and open any question.' : 'Drag to move. Scroll to zoom. Select a question to expand it.';
  const total = questionCounts(doc).total;
  for (const n of branches.nodes) {
    const p = positions.get(n.id), root = n.id === doc.rootId;
    if ((!expanded || n.id !== selected) && (n.id === activeId || intersects(p, viewport))) {
      const hidden = collapsed.has(n.id) ? hiddenSummary(n.id) : '';
      let card = cards.get(n.id); cards.delete(n.id);
      if (!card) {
        card = button('', () => select(n.id), { 'data-node-id': n.id, 'aria-expanded': 'false' });
        card.addEventListener('focus', () => { if (!restoringFocus && card.isConnected) revealNode(n.id); });
        nodes.append(card);
      }
      card.className = `node ${acceptedIds.has(n.id) ? 'new-question' : ''} ${root ? 'root' : ''} ${n.answer ? 'done' : ''} ${selected === n.id ? 'selected' : ''} ${n.review ? 'needs-review' : ''} ${branches.parentIds.has(n.id) ? 'has-branch' : ''}`;
      card.title = criticalPrior ? `${n.question} — ${criticalLabel(n)}` : n.question; card.dataset.state = effectiveAnswerState(n);
      if (criticalPrior) card.dataset.critical = currentCritical().highlights.has(n.id) ? 'highlight' : 'context'; else delete card.dataset.critical;
      card.setAttribute('aria-label', `${n.category}: ${n.question}. ${nodeStatus(n)}${isQuestion(n) ? `; ${importanceLabel(n)}` : ''}${impactDisplay && isQuestion(n) ? `; ${impactLabel(n)}` : ''}${n.review ? '; needs review' : ''}${hidden ? `; ${hidden}` : ''}${n.revisit ? `; reminder: ${revisitLabel(n)}` : ''}${n.answer ? `; Answer: ${n.answer}` : ''}; ${branches.nodeCounts.get(n.id)} descendant nodes`);
      if (criticalPrior) card.setAttribute('aria-label', `${card.getAttribute('aria-label')}; ${criticalLabel(n)}`);
      card.style.left = `${p.x}px`; card.style.top = `${p.y}px`; card.style.width = `${p.width}px`; card.style.height = `${p.height}px`; card.style.setProperty('--branch', colors[p.branch % colors.length]);
      const summary = detailTier === 'overview' || detailTier === 'schematic';
      const status = (hidden || (root ? `${total} questions` : `${nodeStatus(n)}${n.review ? '; needs review' : ''}`)) + (summary && !hidden ? ` \u00b7 ${branches.nodeCounts.get(n.id)} below` : '') + (n.revisit ? ` · ${revisitLabel(n)}` : '');
      const stamp = JSON.stringify([n.category, n.question, n.answer, status, n.importance, detailTier]);
      if (card.renderStamp !== stamp) {
        card.renderStamp = stamp;
        card.replaceChildren(el('span', { class: 'category' }, el('span', { class: 'category-text' }, n.category), ...(isQuestion(n) ? [importanceBadge(n)] : [])), el('span', { class: 'question' }, summary && [...n.question].length > 48 ? [...n.question].slice(0, 48).join('') + '\u2026' : n.question),
          ...(detailTier === 'detail' && n.answer ? [el('span', { class: 'answer-preview' }, n.answer)] : []), el('span', { class: 'status', title: status }, status));
      }
      if (branches.parentIds.has(n.id) && (detailTier !== 'schematic' || active?.dataset.branchId === n.id)) {
        let toggle = toggles.get(n.id); toggles.delete(n.id);
        if (!toggle) { toggle = branchButton(n); nodes.append(toggle); }
        const label = `${collapsed.has(n.id) ? 'Expand' : 'Collapse'} branch`;
        toggle.textContent = label; toggle.setAttribute('aria-label', `${label}: ${n.question}`); toggle.setAttribute('aria-expanded', String(!collapsed.has(n.id)));
        toggle.disabled = !!criticalPrior;
        toggle.style.left = `${p.x + p.width - 8}px`; toggle.style.top = `${p.y + p.height - 8}px`;
      }
    }
    const edge = geometryCache.value.edges.get(n.id);
    if (edge && intersects(edge.bounds, viewport)) {
      let path = paths.get(n.id); paths.delete(n.id);
      if (!path) { path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.dataset.edgeId = n.id; edges.append(path); }
      path.setAttribute('d', edge.path);
      path.setAttribute('class', n.id === selected || n.parentId === selected ? 'current' : '');
      if (impactDisplay) path.dataset.impact = isQuestion(n) ? currentImpact(doc).bandFor(n.id) : 'structural';
      else delete path.dataset.impact;
    }
  }
  for (const stale of [...cards.values(), ...toggles.values(), ...paths.values()]) {
    if (stale === active || stale.contains(active)) $('map').focus({ preventScroll: true });
    stale.remove();
  }
}
function bounds() { return geometryCache.value.bounds; }
function fitScale() {
  if (!positions.size) return 1;
  const b = fitGeometry.value.bounds, rect = $('map').getBoundingClientRect();
  return Math.min(1, Math.max(1, rect.width - 60) / (b.right - b.left), Math.max(1, rect.height - 60) / (b.bottom - b.top));
}
function transform() {
  if (outlineMode || !positions.size) return;
  const rect = $('map').getBoundingClientRect(), b = bounds();
  if (!rect.width || !rect.height) return;
  const reachX = Math.min(64, rect.width / 2, (b.right - b.left) * view.zoom);
  const reachY = Math.min(64, rect.height / 2, (b.bottom - b.top) * view.zoom);
  view.x = Math.min(rect.width - reachX - b.left * view.zoom, Math.max(reachX - b.right * view.zoom, view.x));
  view.y = Math.min(rect.height - reachY - b.top * view.zoom, Math.max(reachY - b.bottom * view.zoom, view.y));
  $('world').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`;
  $('zoom-level').textContent = `${Number((view.zoom * 100).toPrecision(3))}%`;
  $('zoom-in').disabled = view.zoom >= 3;
  $('zoom-out').disabled = view.zoom <= Math.min(.1, fitScale());
  renderMap();
  minimap.update();
}
function fit() {
  if (outlineMode) return;
  endDrag();
  if (!positions.size) return;
  const rect = $('map').getBoundingClientRect();
  view.zoom = fitScale();
  refreshScene(null);
  if (expanded) { revealNode(selected); return; }
  const b = bounds();
  view.x = rect.width / 2 - (b.left + b.right) / 2 * view.zoom; view.y = rect.height / 2 - (b.top + b.bottom) / 2 * view.zoom; transform();
}
function centerSelected() {
  if (outlineMode || !selected || !positions.has(selected)) return;
  endDrag();
  const rect = $('map').getBoundingClientRect(); view.zoom = 1;
  refreshScene({ id: selected, x: rect.width / 2, y: focusTop(selected, rect.height) });
}
function zoom(factor, point) {
  if (outlineMode || !positions.size || drag) return;
  const rect = $('map').getBoundingClientRect(), next = Math.max(Math.min(.1, fitScale()), Math.min(3, view.zoom * factor)), ratio = next / view.zoom;
  const x = point?.x ?? rect.width / 2, y = point?.y ?? rect.height / 2;
  const worldX = (x - view.x) / view.zoom, worldY = (y - view.y) / view.zoom;
  const contains = p => p && worldX >= p.x && worldX <= p.x + p.width && worldY >= p.y && worldY <= p.y + p.height;
  let owner = expanded && contains(positions.get(selected)) ? selected : null;
  if (!owner) for (const [id, box] of positions) if (contains(box)) { owner = id; break; }
  const box = positions.get(owner), anchor = box ? { id: owner, x, y, relativeX: (worldX - box.x) / box.width, relativeY: (worldY - box.y) / box.height } : null;
  view.x = x - (x - view.x) * ratio; view.y = y - (y - view.y) * ratio; view.zoom = next;
  refreshScene(anchor);
}
function revealNode(id) {
  if (outlineMode) return;
  let p = positions.get(id); if (!p) return;
  const rect = $('map').getBoundingClientRect();
  if (!expanded || id !== selected) {
    const next = Math.max(Math.min(.1, fitScale()), Math.min(view.zoom, (rect.width - 32) / p.width, (rect.height - 32) / p.height));
    if (next !== view.zoom) { view.zoom = next; refreshScene(null); p = positions.get(id); }
  }
  const left = view.x + p.x * view.zoom, top = view.y + p.y * view.zoom;
  view.x += Math.max(16 - left, Math.min(0, rect.width - 16 - left - p.width * view.zoom));
  view.y += Math.max(16 - top, Math.min(0, rect.height - 16 - top - p.height * view.zoom));
  transform();
}
function answerStatus(node) {
  const entry = draftClient.entries.get(node.id);
  if ($('answer-state')) $('answer-state').value = draftClient.state(node.id);
  if ($('answer-status')) $('answer-status').textContent = draftClient.loadError ? 'Draft could not be saved' : entry?.status || (node.answer ? 'Answer saved' : effectiveAnswerState(node) !== 'unanswered' ? 'State saved' : 'No answer yet');
  const undo = $('undo-addition'), addition = uiFor(node.id).addition;
  if (undo) { undo.hidden = !addition; undo.disabled = !addition || (drafts.get(node.id) ?? node.answer) !== addition.after; }
}
function renderDraftRecovery(node) {
  const area = $('draft-recovery'); if (!area) return;
  const entry = draftClient.entries.get(node.id), conflict = entry?.conflict;
  const choose = choice => { voice.cancel(); void draftClient.choose(node.id, choice, node).catch(error => notice(error.message)); };
  const stamp = JSON.stringify([node.answer, node.answerState, conflict, entry?.dirty, entry?.error, draftClient.loadError, drafts.has(node.id), uiFor(node.id).refreshAnswer]);
  if (area.renderStamp === stamp) return;
  area.renderStamp = stamp; area.replaceChildren();
  $('draft-actions')?.replaceChildren();
  if (uiFor(node.id).refreshAnswer) area.append(button('Refresh saved journey', async () => {
    voice.cancel();
    if (await api('refresh-answer')) { uiFor(node.id).refreshAnswer = false; renderDraftRecovery(state.document.nodes.find(n => n.id === node.id)); }
  }, { id: 'refresh-answer' }));
  if (draftClient.loadError || entry?.error) area.append(el('p', { class: 'notice' }, draftClient.loadError || entry.error));
  if (conflict) {
    area.append(el('p', {}, `Saved state: ${ANSWER_STATES[effectiveAnswerState(node)]}. Saved answer: ${node.answer || '(no text)'}`));
    area.append(el('p', {}, conflict.text === null ? 'Another canvas cleared this draft. Your editor text is still here.' : 'A saved draft needs review. Your committed answer and editor text have been kept.'));
    if (conflict.text !== null) {
      const recovered = el('textarea', { readonly: '', rows: '4', 'aria-label': 'Recovered draft' }); recovered.value = conflict.text;
      area.append(el('p', {}, `Recovered state: ${ANSWER_STATES[effectiveAnswerState({ answer: conflict.text, answerState: conflict.answerState })]}`), recovered, button('Use recovered draft', () => choose('recover'), { id: 'recover-draft' }));
    }
    area.append(button('Keep editor draft', () => choose('keep'), { id: 'keep-draft' }));
  }
  if ((entry?.dirty || draftClient.loadError) && !conflict) area.append(button('Retry saving draft', () => { void draftClient.retry().catch(error => notice(error.message)); }, { id: 'retry-draft' }));
  if (entry?.dirty && (entry.error || draftClient.loadError)) area.append(button('Discard unsaved editor text', () => {
    voice.cancel(); void draftClient.discardUnsaved(node.id, node).catch(error => notice(error.message));
  }, { id: 'discard-unsaved-draft' }));
  if (drafts.has(node.id) || conflict) ($('draft-actions') ?? area).append(button('Discard draft', () => choose('discard'), { id: 'discard-draft' }));
}
function orphanReminderDrafts() {
  const questions = new Set(state.document?.nodes.filter(isQuestion).map(node => node.id));
  return [...nodeUi].filter(([id, ui]) => ui.revisitDraft && !questions.has(id));
}
function revealOrphanReminders() {
  if ($('history-dialog').open) closeHistory();
  libraryView = false; showView(); renderDraftSummary();
  const text = $('orphan-drafts').querySelector('[data-orphan-reminder] textarea');
  text?.focus({ preventScroll: true }); text?.scrollIntoView({ block: 'nearest' });
}
function renderDraftSummary() {
  const summary = $('draft-summary'), area = $('orphan-drafts');
  if (!summary || !area) return;
  const entries = [...draftClient.entries.values()];
  summary.textContent = draftClient.loadError || entries.some(e => e.error) ? 'Draft could not be saved. Open the question to retry or discard unsaved editor text.' :
    entries.some(e => e.dirty || e.saving) ? 'Saving drafts locally…' : draftClient.uncommitted() ? 'Local drafts are separate from saved answers and exports.' : '';
  const reminders = orphanReminderDrafts();
  const stamp = JSON.stringify([entries.filter(e => e.orphaned), reminders.map(([id, ui]) => [id, ui.revisitDraft])]);
  if (area.renderStamp === stamp) return;
  area.renderStamp = stamp; area.replaceChildren();
  for (const [id, orphan] of draftClient.entries) {
    if (!orphan.orphaned || orphan.conflict?.text == null) continue;
    const text = el('textarea', { readonly: '', rows: '3', 'aria-label': 'Draft for a removed question' }); text.value = orphan.conflict.text;
    area.append(el('p', {}, `Saved draft state: ${ANSWER_STATES[effectiveAnswerState({ answer: orphan.conflict.text, answerState: orphan.conflict.answerState })]}`));
    area.append(el('p', {}, 'Draft for a removed question. Copy the text to keep it elsewhere.'), text,
      button('Discard removed-question draft', () => { void draftClient.choose(id, 'discard').catch(error => notice(error.message)); }));
  }
  for (const [, ui] of reminders) {
    const draft = ui.revisitDraft, text = el('textarea', { readonly: '', rows: '3', 'aria-label': 'Reminder condition for a removed question' }); text.value = draft.condition;
    area.append(el('section', { 'data-orphan-reminder': '' }, el('p', {}, `Unsaved reminder for a removed question: ${draft.question}`),
      el('p', {}, `Review date: ${draft.date || 'Not set'}. Copy the date and condition to keep them elsewhere before discarding. This draft stays only in this canvas.`), text,
      button('Discard removed-question reminder', () => { delete ui.revisitDraft; renderDraftSummary(); notice('Removed-question reminder draft discarded.'); $('map').focus({ preventScroll: true }); })));
  }
}
function setQuestionToolTab(name) {
  const body = $('question-tools-body'); if (!body) return;
  const ui = uiFor(selected), previousFocus = document.activeElement;
  ui.toolScrolls ??= {};
  if (body.dataset.activeTab) ui.toolScrolls[body.dataset.activeTab] = body.scrollTop;
  body.dataset.activeTab = name;
  ui.toolsTab = name;
  if (name === 'research' && $('research-summary')) $('research-summary').parentElement.open = true;
  if (name === 'context' && $('question-context')) $('question-context').open = true;
  for (const tab of $('question-drawer').querySelectorAll('[data-tool-tab]')) {
    const active = tab.dataset.toolTab === name;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  }
  for (const panel of body.querySelectorAll('[data-tool-panel]')) panel.hidden = panel.dataset.toolPanel !== name;
  body.scrollTop = ui.toolScrolls[name] ?? 0;
  if (body.contains(previousFocus) && previousFocus.closest('[data-tool-panel]')?.hidden) $(`question-tab-${name}`).focus({ preventScroll: true });
}
function revealQuestionStage(target = $('node-workspace')) {
  const stage = $('question-stage');
  if (!expanded || !target?.isConnected || !stage.clientHeight) return;
  const rect = target.getBoundingClientRect(), bounds = stage.getBoundingClientRect();
  if (rect.top < bounds.top || rect.height > stage.clientHeight) stage.scrollTop += rect.top - bounds.top;
  else if (rect.bottom > bounds.bottom) stage.scrollTop += rect.bottom - bounds.bottom;
}
function setQuestionTools(open) {
  const drawer = $('question-drawer'), body = $('question-tools-body'), toggle = $('question-tools-toggle');
  if (!body || !toggle) return;
  const opening = open && drawer.hidden;
  if (!open && !drawer.hidden && drawer.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  drawer.hidden = !open; body.hidden = !open; $('question-drawer-handle').hidden = open || !expanded;
  toggle.setAttribute('aria-expanded', String(open));
  uiFor(selected).toolsOpen = open;
  scheduleLayout();
  if (opening) requestAnimationFrame(() => { if (!closed && !drawer.hidden) revealQuestionStage(); });
}
function revealQuestionTool(target) {
  if (!target || !$('question-tools-body')?.contains(target)) return;
  setQuestionTools(true);
  const tab = target.closest('[data-tool-panel]')?.dataset.toolPanel;
  if (tab) setQuestionToolTab(tab);
  for (let parent = target.parentElement; parent && parent !== $('question-tools-body'); parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  const body = $('question-tools-body'), rect = target.getBoundingClientRect(), bounds = body.getBoundingClientRect();
  if (rect.top < bounds.top || rect.bottom > bounds.bottom) body.scrollTop += rect.top - bounds.top;
}
function revealQuestionWork() {
  setQuestionTools(true);
  setQuestionToolTab(['research', 'research-follow-up'].includes(state.pending?.kind) ? 'research' : 'explore');
  if ($('question-tools-body')) $('question-tools-body').scrollTop = 0;
  uiFor(selected).toolsScroll = 0;
}
function renderWorkspace() {
  cleanup.sync();
  questionHelp.sync();
  const panel = $('node-workspace'); captureWorkspace(); panel.hidden = !expanded;
  if (!expanded) { $('question-drawer').hidden = true; $('question-drawer-handle').hidden = true; return; }
  const next = state.document.nodes.find(n => n.id === selected);
  const identity = `${referenceJourney()}/${next.id}/${next.kind ?? 'question'}`;
  if (workspace?.identity === identity && panel.firstChild) { setQuestionTools(!!uiFor(next.id).toolsOpen); workspace.update(); return; }
  voice.cancel(); composing = null;
  let doc, node, pending, byId;
  const owner = { identity, update: () => {} };
  const ui = uiFor(next.id), root = next.id === state.document.rootId;
  const current = () => !closed && expanded && !libraryView && workspace === owner && panel.isConnected && selected === next.id;
  const refresh = () => { doc = state.document; node = doc.nodes.find(n => n.id === next.id); pending = !!state.pending; byId = new Map(doc.nodes.map(n => [n.id, n])); };
  refresh();
  panel.dataset.nodeId = node.id; panel.replaceChildren(); panel.scrollTop = 0;
  const headingArea = el('div', { class: 'workspace-region' }), content = el('div', { class: 'node-content' });
  const workspaceImpact = el('p', { id: 'workspace-impact', class: 'quiet', hidden: true });
  const workspaceCritical = el('p', { id: 'workspace-critical', class: 'quiet', hidden: true });
  panel.append(headingArea, workspaceImpact, workspaceCritical, content);
  const drawer = $('question-drawer'); drawer.replaceChildren(); drawer.dataset.expanded = String(!!ui.toolsExpanded);
  const toolsBody = el('div', { id: 'question-tools-body', class: 'question-tools-body' });
  const toolsToggle = button('More options', () => setQuestionTools(drawer.hidden), { id: 'question-tools-toggle', 'aria-expanded': String(!!ui.toolsOpen), 'aria-controls': 'question-drawer' });
  toolsToggle.addEventListener('pointerdown', event => { if (event.button === 0 && content.contains(document.activeElement)) event.preventDefault(); });
  const size = button(ui.toolsExpanded ? 'Reduce' : 'Expand', () => {
    ui.toolsExpanded = !ui.toolsExpanded; drawer.dataset.expanded = String(ui.toolsExpanded);
    size.textContent = ui.toolsExpanded ? 'Reduce' : 'Expand'; size.setAttribute('aria-expanded', String(ui.toolsExpanded)); scheduleLayout();
  }, { id: 'question-drawer-size', 'aria-expanded': String(!!ui.toolsExpanded), 'aria-label': 'Expand or reduce question tools' });
  drawer.append(el('header', { class: 'question-drawer-header' }, el('div', { class: 'question-drawer-heading' }, el('h2', { id: 'question-drawer-title' }, 'Question tools'), el('p', { id: 'question-drawer-context' }, node.question)), el('div', { class: 'actions' }, size, button('Close', () => setQuestionTools(false), { id: 'question-drawer-close', 'aria-label': 'Close question tools' }))));
  const tabs = el('div', { class: 'question-tool-tabs', role: 'tablist', 'aria-label': 'Question tools' }), toolPanels = {};
  for (const [name, label] of [['explore', 'Explore'], ['research', 'Research'], ['details', 'Answer details'], ['context', 'Context']]) {
    const tab = button(label, () => setQuestionToolTab(name), { id: `question-tab-${name}`, role: 'tab', 'data-tool-tab': name, 'aria-controls': `question-tools-${name}` });
    tab.addEventListener('keydown', event => {
      const buttons = [...tabs.children], index = buttons.indexOf(tab);
      const target = event.key === 'ArrowRight' ? buttons[(index + 1) % buttons.length] : event.key === 'ArrowLeft' ? buttons[(index + buttons.length - 1) % buttons.length] : event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1) : null;
      if (target) { event.preventDefault(); target.click(); target.focus({ preventScroll: true }); }
    });
    tabs.append(tab); toolPanels[name] = el('section', { id: `question-tools-${name}`, role: 'tabpanel', 'data-tool-panel': name, 'aria-labelledby': tab.id, tabindex: '0' }); toolsBody.append(toolPanels[name]);
  }
  drawer.append(tabs, toolsBody);
  const regions = new Map();
  // Named regions own their children; the answer form is never moved during an update.
  const region = (name, parent = toolPanels.explore) => { const area = el('div', { class: 'workspace-region' }); parent.append(area); regions.set(name, { area, stamp: null }); };
  regions.set('heading', { area: headingArea, stamp: null });
  const update = (name, value, build) => {
    const part = regions.get(name), stamp = JSON.stringify(value);
    if (part.stamp === stamp) return;
    const focused = part.area.contains(document.activeElement) ? document.activeElement.id : null;
    part.stamp = stamp; part.area.replaceChildren(...[build()].flat().filter(Boolean));
    if (focused) ($(focused) ?? $('expanded-title'))?.focus({ preventScroll: true });
  };
  workspace = owner;
  const context = el('details', { id: 'question-context', class: 'question-context' }, el('summary', {}, 'Context & navigation'));
  context.open = ui.contextOpen ?? false;
  context.addEventListener('toggle', () => { if (context.isConnected) ui.contextOpen = context.open; });
  region('navigation', context);
  region('rationale', context);
  region('importance', context);
  let updateRevisit = () => {};
  if (!root && isQuestion(node)) {
    const help = el('details', { id: 'question-help', class: 'question-help' }, el('summary', { id: 'question-help-summary' }, 'Help with this question'),
      el('p', { class: 'quiet' }, 'Model help explains this saved question. Your question and answer stay unchanged. For sourced or current information, use the Research tab.'),
      el('div', { class: 'actions help-actions' },
        button('Rephrase', () => { voice.cancel(); void questionHelp.start('rephrase'); }, { id: 'help-rephrase' }),
        button('Give an example', () => { voice.cancel(); void questionHelp.start('example'); }, { id: 'help-example' }),
        button('Explain terms', () => { voice.cancel(); void questionHelp.start('terms'); }, { id: 'help-terms' })),
      el('div', { id: 'question-help-results', 'aria-live': 'polite' }));
    help.open = ui.helpOpen;
    help.addEventListener('toggle', () => { if (help.isConnected) ui.helpOpen = help.open; });
    context.append(help);
  }
  region('references', toolPanels.context);
  for (const name of ['pending', 'preview', 'retry']) region(name);
  region('review', content);
  region('contributors', toolPanels.details);
  toolPanels.details.append(button('Review comments on this node', () => { if (current()) comments.open(node.id); }, { id: 'comments-node-open', 'aria-haspopup': 'dialog' }));
  toolPanels.details.append(button('Review handoffs for this branch', () => { if (current()) reviewHandoffs.open(node.id); }, { id: 'review-handoffs-node-open', 'aria-haspopup': 'dialog' }));
  if (root) {
    content.append(el('p', { class: 'quiet' }, 'Pick a connected question to explore it. Each question opens into its own workspace on the map.'), button(doc.nodes.length > 1 ? 'Find more directions' : 'Generate questions', () => api('questions', { nodeId: node.id }), { id: 'generate-questions', disabled: pending || !!state.preview }));
  } else if (!isQuestion(node)) {
    content.append(el('p', { class: 'quiet' }, 'Your original direction guides the next questions. It is not an answer or a decision.'), button('Explore this direction', () => api('questions', { nodeId: node.id }), { id: 'generate-questions', disabled: pending || !!state.preview }));
  } else {
    const form = el('form', { id: 'answer-form', class: 'answer-form' }), answer = el('textarea', { id: 'answer', rows: '4', maxlength: '20000', placeholder: 'A decision, a hunch, or what you know so far…' });
    answer.value = drafts.get(node.id) ?? node.answer;
    const answerState = el('select', { id: 'answer-state', 'aria-describedby': 'answer-state-help' }, Object.entries(ANSWER_STATES).map(([value, label]) => el('option', { value }, label)));
    answerState.value = draftClient.state(node.id);
    answerState.addEventListener('focus', () => { if (current()) draftClient.touch(node.id); });
    answerState.addEventListener('change', () => { if (!current()) return; draftClient.selectState(node.id, answerState.value, answer.value); answerStatus(node); });
    answer.addEventListener('input', () => { if (!current()) return; draftClient.edit(node.id, answer.value); answerStatus(node); });
    answer.addEventListener('focus', () => { if (current()) draftClient.touch(node.id); });
    answer.addEventListener('compositionstart', () => { if (current()) draftClient.touch(node.id); });
    const save = async (deepen, restart = false) => {
      if (!current()) return;
      if (restart && !switchAllowed('restarting this branch')) return;
      if (deepen && state.preview) return notice('Accept or dismiss the unsaved question preview before generating again.');
      voice.cancel();
      cleanup.cancel();
      const error = answerStateError(answer.value, draftClient.state(node.id));
      if (error) return notice(error);
      if (deepen && draftClient.state(node.id) === 'unanswered') return notice('Choose a state or write an answer before exploring deeper.');
      if (ui.refreshAnswer) return notice('Refresh the saved journey before retrying.');
      if (deepen) revealQuestionWork();
      let restartCheckpoint = null;
      try {
        if (!drafts.has(node.id)) draftClient.edit(node.id, answer.value);
        const generation = draftClient.entries.get(node.id).edits;
        if (restart) {
          await draftClient.flush();
          if (!current() || draftClient.entries.get(node.id)?.edits !== generation) return notice('The draft changed while preserving it. Review the current edit before restarting.');
        }
        if (await draftClient.save(node.id, async (value, draftRevision, draftJourney, answerState) => {
          const input = { nodeId: node.id, answer: value, answerState, expand: deepen, draftRevision, draftJourney, ...(restart ? { operation: 'restart-branch' } : {}) };
          let proof;
          try { proof = await reviewAnswerChange(input, generation); }
          catch (error) { if (/Another canvas|map changed|journey changed on disk/i.test(error.message)) { ui.refreshAnswer = true; if (current()) renderDraftRecovery(node); } throw error; }
          if (!proof) return null;
          restartCheckpoint = proof.checkpoint;
          const result = await api(restart ? 'restart-branch' : 'answer', { ...input, answerPreview: proof.token, confirmConsequences: proof.requiresConfirmation });
          if (!result && /Another canvas|map changed/.test($('notice').textContent)) { ui.refreshAnswer = true; if (current()) renderDraftRecovery(node); }
          return result;
        }, () => state.document.nodes.find(n => n.id === node.id))) {
          if (!current()) return;
          renderWorkspace(); refreshScene();
          if (restart) notice(restartCheckpoint ? 'Branch restart completed. History preserves removed content; private drafts remain recoverable. Use Regenerate follow-ups to review corrected context when ready.' : 'The branch already matches this answer. Nothing changed; no checkpoint or revision was created.');
          else if (deepen) notice('Answer saved. Copilot will propose follow-up questions for your review.');
          else if (draftClient.entries.get(node.id)?.edits === generation && !draftClient.entries.get(node.id)?.conflict && !drafts.has(node.id)) {
            const result = nextQuestion.suggest(state.document, referenceJourney());
            const nodes = state.document.nodes, index = nodes.findIndex(n => n.id === node.id);
            const ordered = [...nodes.slice(index + 1), ...nodes.slice(0, index)];
            const next = result.candidate?.id !== node.id && result.candidate || ordered.find(n => isQuestion(n) && !n.review && !['decided', 'not-relevant', 'revisit-later'].includes(effectiveAnswerState(n)));
            if (next) { select(next.id); notice('Answer saved. Opened an existing unresolved question.'); }
            else notice('Answer saved. No next question is ready to answer. You can keep working here or review the map.');
          }
        }
      } catch (error) { notice(error.message); }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void save(false); });
    const saveKey = event => { if (current() && !event.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(false); } };
    form.addEventListener('keydown', saveKey);
    const voiceStatus = el('div', { class: 'voice-controls' });
    answer.setAttribute('aria-describedby', 'voice-status');
    voice.bind(answer, voiceStatus);
    form.append(el('div', { class: 'answer-label' }, el('label', { for: 'answer' }, 'Your answer')), answer, voiceStatus, el('span', { id: 'answer-status', class: 'quiet answer-status' }));
    toolPanels.details.append(el('div', { class: 'answer-state-field' }, el('label', { for: 'answer-state' }, 'Answer state'), answerState),
      el('p', { id: 'answer-state-help', class: 'quiet' }, 'Text and state stay a draft until you save. Decided, Tentative and Assumption need text; other states can have no note.'),
      button('Clean My Answer', () => { voice.cancel(); void cleanup.start(); }, { id: 'clean-answer', disabled: !answer.value.trim() }),
      el('div', { id: 'cleanup-review', 'aria-live': 'polite' }));
    const savebar = el('div', { class: 'workspace-savebar' }, toolsToggle,
      button('Save & continue', () => { voice.cancel(); void save(false); }, { id: 'save-answer', class: 'primary', 'aria-label': 'Save & continue', title: 'Save and open an existing useful question; Ctrl/Command + Enter', disabled: pending && !['research', 'research-follow-up'].includes(state.pending.kind) }));
    toolPanels.explore.append(el('p', { class: 'quiet' }, 'Save this answer and ask Copilot for follow-up questions to review.'), button('Explore deeper', () => { voice.cancel(); void save(true); }, { id: 'save-deeper', title: 'Save this answer and ask Copilot for follow-up questions', 'aria-label': 'Save answer and explore deeper', disabled: pending }));
    toolPanels.explore.append(button('Regenerate follow-ups', () => {
      if (!current() || !switchAllowed('reviewing replacement questions')) return;
      const saved = state.document.nodes.find(n => n.id === node.id);
      if (state.pending || state.preview) return notice('Finish or dismiss the current request or question preview first.');
      if (saved.review || effectiveAnswerState(saved) === 'unanswered') return notice('Review and save the corrected answer or state first. Your draft stays in the editor.');
      openResearchReview(node.id, undefined, 'question-regeneration');
    }, { id: 'regenerate-followups' }), el('p', { class: 'quiet' }, 'After correcting an answer, review its saved context and choose existing questions to reuse as coverage. This uses the committed answer; unsaved editor text stays private. Removed questions remain in History.'));
    const revisitChooser = el('section', { id: 'answer-revisit', class: 'answer-revisit', hidden: true, 'aria-labelledby': 'answer-revisit-title' });
    let revisitBase = null, revisitObserved = null, revisitStale = false, revisitPage = null, routing = false;
    const choice = () => ui.revisitChoice ?? 'retain';
    const blocked = () => routing || busy || draftClient.savingAnswer ? 'Wait for the current save or review to finish.' :
      revisitStale ? 'Saved context changed or the page resumed. Refresh choices before continuing; your proposed answer stays in the editor.' :
      state.pending ? 'Cancel or finish the current Copilot request before revisiting this answer.' : state.preview ? 'Accept or dismiss the unsaved question preview before revisiting this answer.' :
      choice() === 'fork' && !state.library ? 'Alternative scenarios require the installed personal library. Retain or restart is available here.' : '';
    updateRevisit = () => {
      if (revisitChooser.hidden) return;
      if (revisitObserved !== state.document || revisitPage !== pageEpoch) {
        revisitStale = revisitPage !== pageEpoch || revisitBase !== JSON.stringify(state.document); revisitObserved = state.document;
      }
      $('answer-revisit-status').textContent = blocked() || 'Edit the proposed answer and state in the existing editor. Continue opens the selected workflow; it never generates questions.';
      $('revisit-continue').disabled = !!blocked(); $('revisit-refresh').disabled = routing;
      $('revisit-cancel').disabled = routing;
      for (const value of ['retain', 'fork', 'restart']) { $(`revisit-${value}`).disabled = routing || value === 'fork' && !state.library; $(`revisit-${value}`).checked = choice() === value; }
    };
    const refreshRevisit = () => {
      if (!current() || routing) return;
      refresh(); revisitBase = JSON.stringify(doc); revisitObserved = doc; revisitPage = pageEpoch; revisitStale = false;
      const impact = currentImpact(doc).analyze(node.id);
      $('revisit-destination').textContent = `${journeyDescription(doc)}. Retain and restart modify this saved journey; fork leaves it intact and saves a separate personal scenario.`;
      $('revisit-impact').textContent = `${impact.counts.total} affected questions if this answer changes: ${impact.counts.structural} through the tree, ${impact.counts.confirmed} through explicit dependencies, ${impact.counts.mixedOnly} through mixed paths only. Counts can overlap; they describe recorded relationships. The next preview shows exact retained or removed items and research consequences.`;
      updateRevisit();
    };
    const closeRevisit = () => { if (!current() || routing) return; revisitChooser.hidden = true; revisitBase = revisitObserved = null; $('revisit-answer').setAttribute('aria-expanded', 'false'); answer.focus({ preventScroll: true }); };
    const choices = el('fieldset', {}, el('legend', {}, 'What should happen to this answer?'));
    for (const [value, title, description] of [
      ['retain', 'Change and retain descendants', 'Save the proposed answer here; keep affected descendants and flag their reasoning for review.'],
      ['fork', 'Explore an alternative scenario', 'Copy ancestor context and the alternative to a separate personal journey. Keep this original intact.'],
      ['restart', 'Change and restart below this question', 'Confirm exact descendant removals and preserve a protected History checkpoint before saving here.'],
    ]) {
      const radio = el('input', { id: `revisit-${value}`, type: 'radio', name: 'answer-revisit-choice', value, 'aria-describedby': `revisit-${value}-help` });
      radio.addEventListener('change', () => { if (!current() || routing) return; ui.revisitChoice = value; updateRevisit(); });
      choices.append(el('label', { class: 'revisit-choice', for: `revisit-${value}` }, radio, el('span', {}, title)), el('p', { id: `revisit-${value}-help`, class: 'quiet' }, description + (value === 'fork' && !state.library ? ' Unavailable in this file-only preview: open the installed personal library to fork.' : '')));
    }
    const continueRevisit = async () => {
      if (!current()) return; updateRevisit(); if (blocked()) return;
      const selectedChoice = choice(); routing = true; updateRevisit(); voice.cancel();
      try { if (selectedChoice === 'fork') await openScenarioFork(node, answer.value, draftClient.state(node.id)); else await save(false, selectedChoice === 'restart'); }
      finally { routing = false; if (current()) updateRevisit(); }
    };
    revisitChooser.append(el('h3', { id: 'answer-revisit-title' }, 'Revisit this answer'), el('p', { id: 'revisit-destination' }), el('p', { id: 'revisit-impact' }), choices,
      el('p', { id: 'answer-revisit-status', role: 'status', 'aria-live': 'polite' }), el('div', { class: 'actions' }, button('Back to editing', closeRevisit, { id: 'revisit-cancel' }), button('Refresh choices', refreshRevisit, { id: 'revisit-refresh' }), button('Continue to review…', () => { void continueRevisit(); }, { id: 'revisit-continue' })));
    toolPanels.explore.append(button('Revisit this answer', () => { if (!current()) return; revisitChooser.hidden = false; $('revisit-answer').setAttribute('aria-expanded', 'true'); refreshRevisit(); revealQuestionTool(revisitChooser); $(`revisit-${choice()}`).focus({ preventScroll: true }); }, { id: 'revisit-answer', 'aria-expanded': 'false', 'aria-controls': 'answer-revisit' }), revisitChooser);
    toolPanels.explore.append(el('p', { class: 'quiet' }, 'Correct an assumption and restart below this question. Review exact removals first; a protected History checkpoint keeps the old branch recoverable.'), button('Restart branch…', () => { voice.cancel(); void save(false, true); }, { id: 'restart-branch', disabled: pending || !!state.preview }));
    if (state.library) toolPanels.explore.append(el('p', { class: 'quiet' }, 'Try an alternative in a separate saved scenario. Review copied ancestor context; the original stays intact.'), button('Fork alternative…', () => { void openScenarioFork(node, answer.value, draftClient.state(node.id)); }, { id: 'fork-scenario', disabled: pending || !!state.preview }));
    panel.append(savebar);
    savebar.addEventListener('keydown', saveKey); toolsBody.addEventListener('keydown', saveKey);
    const researchNote = el('p', { id: 'research-save-note', class: 'quiet' }, 'Save is available during research. Saving its source context discards that research. Wait or cancel research before Explore deeper.'); toolPanels.explore.append(researchNote);
    toolPanels.details.append(button('Undo addition', () => {
      const addition = ui.addition;
      if (!addition || (drafts.get(node.id) ?? node.answer) !== addition.after) return;
      voice.cancel(); draftClient.edit(node.id, addition.before); answer.value = addition.before; ui.addition = null;
      answerStatus(node); answer.focus({ preventScroll: true }); notice('Addition undone. Your earlier draft is restored.');
    }, { id: 'undo-addition', class: 'undo-addition' }));
    toolPanels.details.append(el('div', { id: 'draft-actions' }));
    form.append(el('div', { id: 'draft-recovery', 'aria-live': 'polite' }));
    content.append(form);
    const revisit = el('details', { id: 'revisit-editor', class: 'revisit-editor' }, el('summary', { id: 'revisit-title' }, 'Revisit this question'),
      el('p', { id: 'revisit-status', role: 'status' }), el('p', { class: 'quiet' }, 'Optional local-calendar date or condition you evaluate yourself. No monitoring or notifications. Acknowledging records a review; it does not change your answer, certainty or ancestor review flag.'));
    revisit.open = ui.revisitOpen ?? !!(node.revisit || ui.revisitDraft);
    revisit.addEventListener('toggle', () => { if (revisit.isConnected) ui.revisitOpen = revisit.open; });
    const date = el('input', { id: 'revisit-date', type: 'date', min: '0001-01-01', max: '9999-12-31' }), condition = el('textarea', { id: 'revisit-condition', maxlength: '1000', rows: '2' });
    const edit = event => {
      ui.revisitDraft = { question: ui.revisitDraft?.question ?? node.question, date: date.value, condition: event.target === condition ? condition.value : ui.revisitDraft?.condition ?? node.revisit?.condition ?? '', base: ui.revisitDraft?.base ?? JSON.stringify(node.revisit ?? null) };
      workspace.update();
    };
    date.addEventListener('input', edit); condition.addEventListener('input', edit);
    const saveReminder = async action => {
      if (!current()) return;
      if (ui.revisitDraft && ui.revisitDraft.base !== JSON.stringify(node.revisit ?? null)) return notice('This reminder changed elsewhere. Use saved reminder or explicitly keep your edits before saving.');
      const draft = ui.revisitDraft;
      const result = await api(action, { nodeId: node.id, ...(action === 'set-revisit' ? { date: draft ? draft.date || null : node.revisit?.date ?? null, condition: draft?.condition ?? node.revisit?.condition ?? '' } : {}) });
      if (result && current()) { if (ui.revisitDraft === draft) delete ui.revisitDraft; workspace.update(); notice(action === 'acknowledge-revisit' ? 'Review acknowledged. Answer and certainty unchanged.' : action === 'clear-revisit' ? 'Reminder cleared. Earlier schedules remain in History.' : 'Reminder saved. Conditions are checked manually.'); }
    };
    revisit.append(el('label', { for: 'revisit-date' }, 'Review date (local calendar)'), date, el('label', { for: 'revisit-condition' }, 'Manual revisit condition'), condition,
      el('p', { id: 'revisit-conflict', class: 'notice' }), el('div', { class: 'actions' },
        button('Save reminder', () => void saveReminder('set-revisit'), { id: 'save-revisit' }),
        button('Acknowledge review', () => void saveReminder('acknowledge-revisit'), { id: 'acknowledge-revisit' }),
        button('Clear reminder', () => void saveReminder('clear-revisit'), { id: 'clear-revisit' }),
        button('Use saved reminder', () => { delete ui.revisitDraft; workspace.update(); date.focus(); }, { id: 'reset-revisit' }),
        button('Keep my reminder edits', () => { if (ui.revisitDraft) { ui.revisitDraft.base = JSON.stringify(node.revisit ?? null); workspace.update(); } }, { id: 'keep-revisit' })));
    const answerDetails = el('div', { class: 'answer-details-main' }, [...toolPanels.details.childNodes]);
    toolPanels.details.append(answerDetails, revisit);
  }
  toolPanels.context.append(context);
  let updateDependencies = () => {}, updateImpact = () => {};
  owner.refreshRevisit = () => { if (current()) updateRevisit(); };
  if (isQuestion(node)) {
    const section = el('section', { id: 'decision-dependencies', 'aria-labelledby': 'dependency-title' }, el('h3', { id: 'dependency-title' }, 'Confirmed decision dependencies'),
      el('p', { class: 'quiet' }, 'B depends on A means changing A may affect B. Tree ancestors and children show navigation and possible impact; only listed links are confirmed dependencies. Pinned references are separate.'));
    toolPanels.context.append(section); region('dependencies', section);
    const form = el('form'), target = el('select', { id: 'dependency-target', required: '' }), explanation = el('textarea', { id: 'dependency-explanation', maxlength: '1000', rows: '2' });
    explanation.value = ui.dependencyExplanation ?? '';
    const add = el('button', { type: 'submit', id: 'add-dependency' }, 'Add dependency');
    form.append(el('label', { for: target.id }, 'This question depends on'), target, el('label', { for: explanation.id }, 'Why it depends on this question (optional)'), explanation, add); section.append(form);
    let rosterStamp = '', busy = false;
    target.addEventListener('input', () => { ui.dependencyTarget = target.value; updateDependencies(); });
    explanation.addEventListener('input', () => { ui.dependencyExplanation = explanation.value; });
    const change = async (action, dependentId, prerequisiteId) => {
      if (!current() || pending || busy) return;
      const proposed = explanation.value, selectedTarget = target.value; busy = true; updateDependencies();
      try {
        const result = await api(action, { nodeId: dependentId, prerequisiteId, ...(action === 'add-dependency' && proposed ? { explanation: proposed } : {}) });
        if (result && current()) {
          if (action === 'add-dependency' && target.value === selectedTarget && explanation.value === proposed) { ui.dependencyTarget = ''; ui.dependencyExplanation = ''; target.value = ''; explanation.value = ''; }
          notice(action === 'add-dependency' ? 'Dependency saved. Answers and tree navigation are unchanged.' : 'Dependency removed. The earlier relationship remains in History.');
        }
      } finally { busy = false; if (current()) updateDependencies(); }
    };
    form.addEventListener('submit', event => { event.preventDefault(); if (target.value) void change('add-dependency', node.id, target.value); });
    updateDependencies = () => {
      const links = doc.dependencies ?? [], roster = doc.nodes.filter(n => isQuestion(n) && n.id !== node.id), stamp = JSON.stringify(roster.map(n => [n.id, n.question]));
      if (stamp !== rosterStamp) { rosterStamp = stamp; target.replaceChildren(el('option', { value: '' }, 'Choose a saved question'), ...roster.map(n => el('option', { value: n.id }, n.question))); target.value = ui.dependencyTarget ?? ''; }
      target.disabled = explanation.disabled = !!pending || busy;
      add.disabled = !!pending || busy || !target.value || links.some(link => link.dependentId === node.id && link.prerequisiteId === target.value);
      update('dependencies', [links, links.map(link => [byId.get(link.dependentId)?.question, byId.get(link.prerequisiteId)?.question]), !!pending, busy], () => {
        return [['prerequisites', 'This question depends on', 'dependentId', 'prerequisiteId'], ['dependents', 'Questions that depend on this', 'prerequisiteId', 'dependentId']].map(([name, title, own, other]) => {
          const group = el('div', { id: `dependency-${name}` }, el('h4', {}, title));
          const matching = links.flatMap((link, index) => link[own] === node.id ? [{ link, index }] : []);
          if (!matching.length) group.append(el('p', { class: 'quiet' }, 'None confirmed.'));
          for (const { link, index } of matching) {
            const question = byId.get(link[other]);
            group.append(el('div', {}, button(question.question, () => { if (current()) select(question.id); }, { id: `dependency-open-${name}-${index}`, 'data-dependency-open': '', 'aria-label': `Open question: ${question.question}` }),
              link.explanation ? el('p', { class: 'dependency-explanation' }, link.explanation) : null,
              button('Remove dependency', () => void change('remove-dependency', link.dependentId, link.prerequisiteId), { id: `dependency-remove-${index}`, 'data-dependency-remove': '', disabled: !!pending || busy, 'aria-label': `Remove dependency: ${byId.get(link.dependentId).question} depends on ${byId.get(link.prerequisiteId).question}` })));
          }
          return group;
        });
      });
    };
  }
  if (isQuestion(node)) {
    const section = el('details', { id: 'decision-impact' }, el('summary', {}, 'Downstream decision impact'));
    section.open = ui.impactOpen ?? false;
    const summary = el('p', { id: 'impact-summary', role: 'status' }), counts = el('p', { id: 'impact-counts' }), states = el('p', { id: 'impact-states' }), adr = el('p', { id: 'impact-adr', class: 'quiet' }), rules = el('p', { class: 'quiet' });
    const target = el('select', { id: 'impact-affected' }), kind = el('select', { id: 'impact-path-kind' }), pageLabel = el('p', { id: 'impact-page' }), pathLabel = el('p', { id: 'impact-path-page' }), path = el('ol', { id: 'impact-path' });
    let source = null, result = null, page = 0, pathPage = 0;
    const open = button('Open affected question', () => { if (current() && target.value) select(target.value); }, { id: 'impact-open-question' });
    const previousPath = button('Previous path steps', () => { pathPage--; showPath(); }, { id: 'impact-path-previous' }), nextPath = button('Next path steps', () => { pathPage++; showPath(); }, { id: 'impact-path-next' });
    const showPath = () => {
      const steps = result ? impactPath(result, target.value, kind.value) : [], offset = pathPage * 30;
      const focused = path.contains(document.activeElement) ? document.activeElement.id : null;
      path.replaceChildren(...steps.slice(offset, offset + 30).map((step, index) => el('li', {}, el('span', {}, step.via === null ? 'Starting question: ' : step.via === 'tree' ? 'Possible tree exposure: ' : 'Confirmed dependency step: '),
        button(byId.get(step.id).question, () => { if (current()) select(step.id); }, { id: `impact-step-${offset + index}` }))));
      path.start = offset + 1; pathLabel.textContent = steps.length ? `Path steps ${offset + 1}–${Math.min(offset + 30, steps.length)} of ${steps.length}. A path containing a tree step is possible exposure, not confirmed dependence.` : 'No affected question path.';
      previousPath.disabled = pathPage === 0; nextPath.disabled = offset + 30 >= steps.length;
      if (focused) ($(focused) ?? target).focus({ preventScroll: true });
    };
    const choose = () => {
      const item = result?.affected.find(item => item.id === target.value), prior = kind.value;
      const options = [...(item?.confirmed ? [['dependency', 'Confirmed dependency path']] : []), ...(item?.structural ? [['tree', 'Possible tree path']] : []), ...(item ? [['combined', 'Shortest path across recorded relationships']] : [])];
      kind.replaceChildren(...options.map(([value, label]) => el('option', { value }, label))); kind.value = options.some(([value]) => value === prior) ? prior : options[0]?.[0] ?? '';
      kind.disabled = open.disabled = !item; pathPage = 0; showPath();
    };
    const previous = button('Previous affected questions', () => { page--; showAffected(); }, { id: 'impact-previous' }), next = button('Next affected questions', () => { page++; showAffected(); }, { id: 'impact-next' });
    const showAffected = () => {
      const items = result?.affected ?? [], prior = target.value, offset = page * 50;
      target.replaceChildren(...items.slice(offset, offset + 50).map(item => el('option', { value: item.id }, `${byId.get(item.id).question} — ${ANSWER_STATES[item.state]}${item.review ? '; needs review' : ''}`)));
      if (items.slice(offset, offset + 50).some(item => item.id === prior)) target.value = prior;
      target.disabled = !items.length; previous.disabled = page === 0; next.disabled = offset + 50 >= items.length;
      pageLabel.textContent = items.length ? `Affected questions ${offset + 1}–${Math.min(offset + 50, items.length)} of ${items.length}. Each question is counted once.` : 'No other saved questions are reachable from this decision.';
      choose();
    };
    target.addEventListener('change', choose); kind.addEventListener('change', () => { pathPage = 0; showPath(); });
    section.append(summary, counts, states, adr, el('details', {}, el('summary', {}, 'How impact is calculated'), rules,
      el('p', {}, 'Uses the complete saved map. Tree-only paths are possible structural exposure; explicit-only paths are confirmed recorded dependence. Mixed paths remain possible exposure. Counts can overlap between tree and confirmed categories. Historical model importance is separate. Drafts, folds and viewport do not affect this calculation.')),
      el('label', { for: target.id }, 'Inspect an affected question'), target, pageLabel, el('div', { class: 'actions' }, previous, next, open), el('label', { for: kind.id }, 'Relationship explanation'), kind, pathLabel, path, el('div', { class: 'actions' }, previousPath, nextPath));
    toolPanels.context.append(section);
    updateImpact = () => {
      if (!section.open) return;
      const key = impactKey(doc); if (source === key) return;
      source = key; result = currentImpact(doc).analyze(node.id);
      const selectedIndex = result.affected.findIndex(item => item.id === target.value); page = selectedIndex < 0 ? 0 : Math.floor(selectedIndex / 50);
      summary.textContent = `${result.band[0].toUpperCase()}${result.band.slice(1)} recorded impact — ${result.counts.total} affected questions.`;
      counts.textContent = `${result.counts.structural} possible through tree paths; ${result.counts.confirmed} confirmed dependents; ${result.counts.mixedOnly} mixed-path-only. ${result.counts.assumptions} unverified assumptions; ${result.counts.review} need review.`;
      states.textContent = Object.entries(result.counts.states).map(([state, count]) => `${ANSWER_STATES[state]}: ${count}`).join(' · ');
      adr.textContent = result.adrAssociations.reason; rules.textContent = result.rules; showAffected();
    };
    section.addEventListener('toggle', () => { if (current()) { ui.impactOpen = section.open; updateImpact(); } });
  }
  region('research', toolPanels.research);
  region('followup', toolPanels.research);
  region('children', toolPanels.context);
  if (root || !isQuestion(node)) {
    panel.append(el('div', { class: 'workspace-savebar' }, toolsToggle));
    toolPanels.details.append(el('p', { class: 'quiet' }, 'Answer details are available when you open a question.'));
    toolPanels.research.append(el('p', { class: 'quiet' }, 'Open a question to research options using its saved context.'));
    toolPanels.explore.append($('generate-questions'));
  }
  const details = el('details', { class: 'manual' }, el('summary', { id: 'manual-summary' }, 'Missing a direction?')); details.open = ui.manualOpen;
  details.addEventListener('toggle', () => { if (details.isConnected) { ui.manualOpen = details.open; scheduleLayout(); } });
  const manual = el('form'), question = el('textarea', { id: 'manual-question', required: '', rows: '2', maxlength: '600' });
  question.value = ui.question;
  question.addEventListener('input', () => { if (!current()) return; ui.question = question.value; });
  manual.append(el('label', { for: 'manual-question' }, 'A direction to explore in this branch'), question, el('button', { type: 'submit', id: 'add-direction', disabled: pending || !!state.preview }, 'Add & explore'));
  manual.addEventListener('submit', async event => {
    event.preventDefault(); if (!current()) return; const value = question.value;
    if (!value.trim()) return notice('Enter a direction to explore.');
    voice.cancel();
    const result = await api('add-direction', { nodeId: node.id, direction: value });
    if (result) {
      if (ui.question === value) ui.question = '';
      collapsed = revealPath(state.document.nodes, collapsed, result.directionId);
      branches = currentBranches();
      renderWorkspace(); refreshScene();
      notice('Direction saved. Copilot will propose questions beneath it for your review.');
    }
  });
  details.append(manual); toolPanels.explore.append(details);
  setQuestionToolTab(ui.toolsTab ?? 'explore'); setQuestionTools(!!ui.toolsOpen);
  workspace.update = () => {
    const focused = panel.contains(document.activeElement) || drawer.contains(document.activeElement) ? document.activeElement : null;
    refresh();
    update('contributors', [node.attribution, state.contributions?.nodes[node.id]], () => el('section', { id: 'workspace-contributors' },
      el('h3', {}, 'Contributions'), el('p', { class: 'quiet' }, `Question: ${contributionText(node.attribution?.question, state.contributions?.nodes[node.id]?.question)}`),
      isQuestion(node) && !root ? el('p', { class: 'quiet' }, `Saved answer: ${contributionText(node.attribution?.answer, state.contributions?.nodes[node.id]?.answer)}`) : null));
    workspaceImpact.hidden = !impactDisplay || !isQuestion(node); workspaceImpact.textContent = impactLabel(node);
    workspaceCritical.hidden = !criticalPrior; workspaceCritical.textContent = criticalLabel(node);
    updateDependencies();
    updateImpact();
    updateRevisit();
    $('question-drawer-context').textContent = node.question;
    const pendingParent = ['research', 'research-follow-up'].includes(state.pending?.kind) ? toolPanels.research : toolPanels.explore;
    if (state.pending && regions.get('pending').area.parentElement !== pendingParent) pendingParent.prepend(regions.get('pending').area);
    const ancestors = [];
    for (let n = byId.get(node.parentId); n; n = byId.get(n.parentId)) ancestors.push([n.id, n.category, n.question]);
    update('navigation', [node.question, focusId, !!criticalPrior, collapsed.has(node.id), branches.parentIds.has(node.id), ancestors], () => {
      const path = [], byId = new Map(doc.nodes.map(n => [n.id, n]));
      for (let n = node; n; n = byId.get(n.parentId)) path.push(n);
      const crumbs = el('nav', { class: 'crumbs', 'aria-label': 'Question ancestors' });
      for (const n of path.toReversed().slice(0, -1).slice(-3)) {
        if (crumbs.childNodes.length) crumbs.append(el('span', {}, '/'));
        crumbs.append(button(n.id === doc.rootId ? 'Your idea' : n.category, () => select(n.id), { id: `ancestor-${n.id}`, title: n.question }));
      }
      return [crumbs, el('div', { class: 'node-head-actions' }, button('Focus branch', () => focusBranch(node.id), { id: 'focus-branch', disabled: !!criticalPrior, 'aria-pressed': String(focusId === node.id), 'aria-label': `Focus branch: ${node.question}` }), branchButton(node, true))];
    });
    update('heading', [node.question, node.category, node.kind, collapsed.has(node.id), collapsed.has(node.id) ? hiddenSummary(node.id) : ''], () => {
      const heading = el('header', { class: 'node-head' }, el('div', { class: 'node-meta' }, el('span', { class: 'category-label' }, node.kind === 'direction' ? nodeStatus(node) : node.category), button('Close question', () => collapseNode(), { id: 'collapse-node' })), el('h2', { id: 'expanded-title', class: 'question-title', tabindex: '-1' }, node.question));
      if (collapsed.has(node.id)) heading.append(el('p', { class: 'branch-count' }, hiddenSummary(node.id)));
      return heading;
    });
    update('importance', [node.importance, node.importanceReason, node.generation], () => {
      if (!isQuestion(node)) return;
      if (!node.importance) return el('p', { class: 'quiet' }, 'Importance: Unranked. No assessment recorded.');
      const why = el('details', { id: 'question-importance', class: 'question-rationale' }, el('summary', { id: 'question-importance-summary' }, importanceBadge(node), ' — Why?'),
        el('p', { class: 'quiet' }, importanceHistory), el('p', { class: 'quiet' }, 'Original suggested wording: ', node.generation.originalQuestion), el('p', {}, node.importanceReason));
      why.open = ui.importanceOpen ?? false;
      why.addEventListener('toggle', () => { if (why.isConnected) ui.importanceOpen = why.open; });
      return why;
    });
    update('rationale', [node.rationale, node.generation], () => {
      if (node.rationale) {
        const why = el('details', { id: 'question-rationale', class: 'question-rationale' }, el('summary', { id: 'question-rationale-summary' }, 'Why this question?'),
          el('p', { class: 'quiet' }, 'Historical model explanation for the original suggested wording and context. It is not a user fact, decision, or confidence score.'),
          node.generation?.adjusted ? el('p', { class: 'quiet' }, 'Original suggested wording: ', node.generation.originalQuestion) : null,
          el('p', {}, node.rationale));
        why.open = ui.rationaleOpen;
        why.addEventListener('toggle', () => { if (why.isConnected) ui.rationaleOpen = why.open; });
        return why;
      }
    });
    update('references', [references.journey, references.revision, references.loading, references.saving, references.error, references.retryIds, references.nodeIds.map(id => { const n = byId.get(id); return [id, n?.question, n?.answer, n?.answerState, n?.review, n?.kind]; }), isQuestion(node)], () => renderReferences(node));
    update('pending', [state.pending, byId.get(state.pending?.nodeId)?.category], () => {
      if (pending) {
        const workNode = byId.get(state.pending.nodeId);
        return el('div', { class: 'pending', role: 'status' }, el('strong', {}, ['research', 'research-follow-up'].includes(state.pending.kind) ? `${state.pending.progress ?? 'Researching'}…` : 'Copilot is finding the next questions…'), el('div', {}, workNode?.id === node.id ? 'The result will appear in this node. You can keep writing or browse the map.' : `Working on: ${workNode?.category}. You can continue browsing.`), button('Cancel request', () => api('cancel'), { id: 'cancel-request' }), el('div', { class: 'quiet' }, ['research', 'research-follow-up'].includes(state.pending.kind) ? 'Research runs separately from your chat. Cancelling stops its helper.' : 'Cancelling discards the result; the chat turn may still finish.'));
      }
    });
    update('review', [node.review, isQuestion(node), pending], () => node.review ? el('div', { class: 'note' },
      el('p', {}, isQuestion(node) ? 'Saved reasoning changed or this answer has an earlier review flag. Inspect each cause before reaffirming or revising.' : 'Earlier reasoning changed. Review this direction and generate fresh questions when needed.'),
      isQuestion(node) ? button('Review affected answers', () => openReviewQueue(node.id), { id: 'review-this-answer' }) : null,
      node.kind === 'direction' ? button('Mark direction reviewed', () => { if (current()) void api('acknowledge-direction', { nodeId: node.id }); }, { id: 'acknowledge-direction', disabled: pending }) : null) : null);
    if ($('revisit-date')) {
      const draft = ui.revisitDraft, conflict = draft && draft.base !== JSON.stringify(node.revisit ?? null);
      if (conflict) {
        $('revisit-editor').open = true;
        const version = JSON.stringify(node.revisit ?? null);
        if (ui.revisitConflict !== version) { ui.revisitConflict = version; revealQuestionTool($('revisit-editor')); }
      } else ui.revisitConflict = null;
      if (!draft) { $('revisit-date').value = node.revisit?.date ?? ''; $('revisit-condition').value = node.revisit?.condition ?? ''; }
      else { if ($('revisit-date').value !== draft.date) $('revisit-date').value = draft.date; if ($('revisit-condition').value !== draft.condition) $('revisit-condition').value = draft.condition; }
      $('revisit-status').textContent = node.revisit ? `${revisitLabel(node)}${node.revisit.date ? ` · ${node.revisit.date}` : ''}${node.revisit.acknowledgedAt ? ` · Reviewed ${new Date(node.revisit.acknowledgedAt).toLocaleString()}` : ''}` : 'No reminder saved.';
      $('save-revisit').textContent = node.revisit?.acknowledgedAt ? 'Reschedule and reactivate' : 'Save reminder';
      $('revisit-conflict').textContent = conflict ? 'The saved reminder changed. Your edits are retained; choose the saved version or explicitly keep your edits.' : '';
      $('revisit-conflict').hidden = !conflict;
      $('keep-revisit').hidden = !conflict; $('reset-revisit').hidden = !draft;
      for (const id of ['save-revisit', 'acknowledge-revisit', 'clear-revisit']) $(id).disabled = pending || !!conflict;
      $('acknowledge-revisit').disabled ||= !!draft; $('clear-revisit').disabled ||= !!draft;
      $('acknowledge-revisit').hidden = !node.revisit; $('clear-revisit').hidden = !node.revisit;
    }
    const preview = state.preview && (state.preview.nodeId === node.id || root && !byId.has(state.preview.nodeId)) ? state.preview : null;
    toolsToggle.textContent = 'More options';
    if (preview && ui.toolsPreview !== preview.id) { ui.toolsPreview = preview.id; revealQuestionWork(); }
    update('preview', preview?.id ?? null, () => preview ? renderQuestionPreview() : null);
    if (preview) {
      $('preview-stale').hidden = !preview.stale;
      $('accept-questions').disabled = preview.stale || !previewEdits.questions.some(q => q.selected);
      if (preview.stale) $('preview-retry').hidden = false;
    }
    update('retry', [!!state.preview, pending, state.error, state.questionRetry], () => !state.preview && !pending && /saved question context changed/.test(state.error) ? button('Refresh saved journey & generate again', async () => {
      const retry = state.questionRetry;
      if (!await api('refresh-answer') || !current()) return;
      if (retry?.purpose === 'adr-questions') openAdrQuestions();
      else await api('questions', { nodeId: retry?.nodeId ?? node.id });
    }, { id: 'refresh-question-context' }) : null);
    update('research', node.research ?? null, () => {
      if (root || !isQuestion(node)) return;
      const research = el('details', { class: 'research-disclosure' }, el('summary', { id: 'research-summary' }, 'Research options')); research.open = ui.researchOpen;
      research.addEventListener('toggle', () => { if (research.isConnected) { ui.researchOpen = research.open; scheduleLayout(); } });
      research.append(el('p', { class: 'quiet' }, 'A separate researcher compares possibilities using your saved answers and states. Review its context before starting. Suggestions stay separate from your answer; normal Copilot usage applies.'), button(node.research ? 'Research again' : 'Research options', () => { research.open = true; ui.researchOpen = true; openResearchReview(node.id); }, { id: 'research-request', disabled: pending }));
      research.append(el('p', { id: 'research-stale-warning', class: 'review-warning', hidden: !node.researchStale }, 'Retained research needs reconsideration after saved reasoning changed. It has not been refreshed.'));
      if (node.research) research.append(renderResearch(node));
      return research;
    });
    if ($('research-stale-warning')) $('research-stale-warning').hidden = !node.researchStale;
    update('children', doc.nodes.filter(n => n.parentId === node.id).map(n => [n.id, n.question]), () => {
      const children = doc.nodes.filter(n => n.parentId === node.id);
      if (children.length) return el('div', { class: 'followups' }, el('h3', {}, root ? 'Explore a direction' : 'Explore this branch'), el('p', { class: 'quiet' }, 'Connected below this node.'), children.map(child => button(child.question, () => select(child.id), { id: `followup-${child.id}`, class: 'followup' })));
    });
    update('followup', !!node.research, () => node.research ? renderFollowup(node) : null);
    updateFollowupHistory(node);
    for (const id of ['research-request', 'followup-review', 'save-deeper', 'regenerate-followups']) if ($(id)) $(id).disabled = pending;
    if ($('research-save-note')) $('research-save-note').hidden = !['research', 'research-follow-up'].includes(state.pending?.kind);
    if ($('save-answer')) $('save-answer').disabled = pending && !['research', 'research-follow-up'].includes(state.pending.kind);
    for (const id of ['generate-questions', 'add-direction', 'restart-branch', 'fork-scenario']) if ($(id)) $(id).disabled = pending || !!state.preview;
    if (root && $('generate-questions')) $('generate-questions').textContent = doc.nodes.length > 1 ? 'Find more directions' : 'Generate questions';
    if ($('manual-question').value !== ui.question) $('manual-question').value = ui.question;
    const answer = $('answer'), value = drafts.get(node.id) ?? node.answer;
    if (answer && answer !== composing && answer.value !== value) answer.value = value;
    if (answer) { answerStatus(node); renderDraftRecovery(node); renderCleanup(); renderQuestionHelp(); }
    if (focused?.isConnected && focused.disabled) { const target = $('cancel-request') ?? $('expanded-title'); revealQuestionTool(target); target.focus({ preventScroll: true }); }
  };
  workspace.update();
  content.scrollTop = ui.scroll;
  toolsBody.scrollTop = ui.toolsScroll ?? 0;
}
function renderCleanup() {
  const area = $('cleanup-review'), start = $('clean-answer'); if (!area || !start) return;
  start.disabled = !cleanup.context()?.text.trim() || !!composing || questionHelp.work?.status === 'pending';
  const work = cleanup.work, signature = JSON.stringify(work);
  if (area.dataset.signature === signature) return;
  const focus = area.contains(document.activeElement) ? document.activeElement.id : null;
  area.dataset.signature = signature; area.replaceChildren();
  if (work?.status === 'pending') area.append(el('p', { role: 'status' }, `${work.progress ?? 'Cleaning your answer'}… You can keep editing.`), button('Cancel cleanup', () => { cleanup.cancel(); $('answer')?.focus({ preventScroll: true }); }, { id: 'cancel-cleanup' }));
  else if (work?.status === 'proposal') area.append(
    el('p', {}, 'Review the meaning before applying. Text and answer state remain drafts until you save.'),
    el('h3', {}, 'Original'), el('p', { id: 'cleanup-original', class: 'cleanup-text', tabindex: '0' }, work.original),
    el('h3', {}, 'Proposed'), el('p', { id: 'cleanup-proposal', class: 'cleanup-text', tabindex: '0' }, work.proposed),
    el('div', { class: 'actions' }, button('Apply', () => cleanup.apply(), { id: 'apply-cleanup' }), button('Reject', () => { cleanup.cancel(); $('answer')?.focus({ preventScroll: true }); }, { id: 'reject-cleanup' })));
  else if (work?.status === 'undo') area.append(button('Undo cleanup', () => cleanup.undo(), { id: 'undo-cleanup' }));
  else if (work?.status === 'error') area.append(el('p', { role: 'status' }, `${work.error} Your current draft is unchanged. Use Clean My Answer to retry.`));
  if (focus) ($(focus) ?? $('answer'))?.focus({ preventScroll: true });
}
function renderQuestionHelp() {
  const area = $('question-help-results'); if (!area) return;
  const running = questionHelp.work?.status === 'pending';
  for (const id of ['help-rephrase', 'help-example', 'help-terms']) if ($(id)) $(id).disabled = running || cleanup.work?.status === 'pending';
  const stamp = JSON.stringify({ work: questionHelp.work, cleanupPending: cleanup.work?.status === 'pending', results: [...questionHelp.results] });
  if (area.dataset.signature === stamp) return;
  const focus = area.contains(document.activeElement) ? document.activeElement.id : null;
  area.dataset.signature = stamp; area.replaceChildren();
  if (running) area.append(el('p', { role: 'status' }, `${questionHelp.work.progress ?? 'Helping with the question'}… Your draft stays editable. Cancel this before Clean My Answer.`),
    button('Cancel question help', () => { questionHelp.cancel(); $('question-help-summary')?.focus({ preventScroll: true }); }, { id: 'cancel-question-help' }));
  else if (cleanup.work?.status === 'pending') area.append(el('p', { role: 'status' }, 'Cancel answer cleanup before starting question help.'));
  else if (questionHelp.work?.status === 'error') {
    const changedSource = /saved question context changed|saved journey changed|another canvas updated/i.test(questionHelp.work.error);
    area.append(el('p', { role: 'status' }, changedSource ? questionHelp.work.error : `${questionHelp.work.error} Choose an action to try again.`));
    if (changedSource) area.append(button('Refresh saved journey', () => { void api('refresh-answer'); }, { id: 'refresh-question-help' }));
  }
  const labels = { rephrase: 'Rephrase', example: 'Illustrative example', terms: 'Explain terms' };
  for (const [operation, value] of questionHelp.results) area.append(el('section', { class: 'help-result' },
    el('h3', {}, labels[operation]), el('p', { class: 'cleanup-text', tabindex: '0' }, value.text)));
  if (focus) ($(focus) ?? $('question-help-summary'))?.focus({ preventScroll: true });
}
function renderQuestionFeedback() {
  let feedback = $('question-feedback');
  if (!feedback) { feedback = el('div', { id: 'question-feedback', role: 'status' }); $('request-status').after(feedback); }
  const ids = [...acceptedIds].filter(id => state.document.nodes.some(n => n.id === id));
  const stamp = JSON.stringify([ids, acceptedParentId]);
  if (feedback.renderStamp === stamp) return;
  feedback.renderStamp = stamp; feedback.replaceChildren();
  if (ids.length) feedback.append(button(`${ids.length} question${ids.length === 1 ? '' : 's'} added — show in branch`, () => {
    select(acceptedParentId); collapsed.delete(acceptedParentId);
    branches = currentBranches(); refreshScene();
  }));
}
function renderQuestionPreview() {
  const batch = state.preview, edits = previewEdits.questions;
  const section = el('section', { id: 'question-preview', class: 'question-preview', 'aria-labelledby': 'preview-title' },
    el('h3', { id: 'preview-title' }, batch.purpose === 'adr-questions' ? 'Review ADR questions' : batch.purpose === 'question-regeneration' ? 'Review new follow-up questions' : 'Review suggested questions'),
    el('p', { class: 'quiet' }, 'Not saved. Select questions and optionally adjust their wording. Closing or restarting this canvas discards this preview.'));
  const stale = el('p', { id: 'preview-stale', class: 'notice' }, 'Saved context changed. Dismiss and generate again.'); stale.hidden = !batch.stale; section.append(stale);
  edits.forEach((edit, index) => {
    const check = el('input', { id: `candidate-select-${index}`, type: 'checkbox' }); check.checked = edit.selected;
    check.addEventListener('change', () => { if (!check.isConnected || state.preview?.id !== batch.id) return; edit.selected = check.checked; $('accept-questions').disabled = state.preview?.stale || !edits.some(q => q.selected); });
    const wording = el('textarea', { id: `candidate-question-${index}`, rows: '2', maxlength: '600', 'aria-label': `Question ${index + 1} wording` }); wording.value = edit.question;
    wording.addEventListener('input', () => { if (!wording.isConnected || state.preview?.id !== batch.id) return; edit.question = wording.value; });
    const row = el('div', { class: 'candidate' }, el('label', { for: check.id }, check, `Include ${batch.questions[index].category} question`), wording);
    const candidate = batch.questions[index];
    if (candidate.importance) {
      const why = el('details', { id: `candidate-importance-${index}`, class: 'candidate-rationale' }, el('summary', {}, importanceBadge(candidate), ' — Why?'),
        el('p', { class: 'quiet' }, importanceHistory), el('p', { class: 'quiet' }, 'Original suggested wording: ', candidate.question), el('p', {}, candidate.importanceReason));
      why.open = edit.importanceOpen ?? false;
      why.addEventListener('toggle', () => { if (why.isConnected) edit.importanceOpen = why.open; }); row.append(why);
    } else row.append(importanceBadge(candidate));
    if (batch.questions[index].rationale) {
      const why = el('details', { id: `candidate-rationale-${index}`, class: 'candidate-rationale' }, el('summary', {}, 'Why suggested?'),
        el('p', { class: 'quiet' }, 'Historical model explanation for the original suggested wording and context. It will stay with this question if you accept an adjusted version.'),
        el('p', { class: 'quiet' }, 'Original suggested wording: ', batch.questions[index].question),
        el('p', {}, batch.questions[index].rationale));
      why.open = edit.rationaleOpen;
      why.addEventListener('toggle', () => { if (why.isConnected) edit.rationaleOpen = why.open; });
      row.append(why);
    }
    section.append(row);
  });
  section.append(el('div', { class: 'actions' }, button('Accept selected', async () => {
    const result = await api('accept-questions', { batchId: batch.id, selected: edits.flatMap((q, index) => q.selected ? [{ index, question: q.question }] : []) });
    if (!result) { const retry = $('preview-retry'); if (retry) retry.hidden = false; }
  }, { id: 'accept-questions', disabled: batch.stale || !edits.some(q => q.selected) }),
  button('Dismiss all', () => api('dismiss-questions', { batchId: batch.id }), { id: 'dismiss-questions' })));
  const retry = button('Dismiss, refresh & generate again', async () => {
    if (!await api('dismiss-questions', { batchId: batch.id })) return;
    if (await api('refresh-answer')) {
      if (batch.purpose === 'adr-questions') openAdrQuestions();
      else if (batch.purpose === 'question-regeneration') {
        if (state.document.nodes.some(n => n.id === batch.nodeId)) openResearchReview(batch.nodeId, undefined, batch.purpose);
        else notice('The corrected question is no longer saved. Select another question to review.');
      } else await api('questions', { nodeId: state.document.nodes.some(n => n.id === batch.nodeId) ? batch.nodeId : state.document.rootId });
    }
  }, { id: 'preview-retry' }); retry.hidden = !batch.stale; section.append(retry);
  if (batch.purpose === 'question-regeneration') { retry.textContent = 'Dismiss, refresh & review context'; section.prepend(el('p', { class: 'quiet' }, 'These are new candidates. Existing questions remain saved; accepting adds selected candidates without replacing old branches.')); }
  if (batch.purpose === 'adr-questions') {
    retry.textContent = 'Dismiss, refresh & review ADR context';
    section.prepend(el('p', { class: 'quiet' }, batch.questions.length ? 'Optional questions about missing ADR reasoning. Accepting adds questions below the saved focal decision; your answers and decision rationale remain yours.' : 'The AI found no material gaps in the supplied context. This is not a readiness judgment or approval of an ADR. No questions were added.'));
  }
  return section;
}
function openResearchReview(nodeId, followup, purpose) {
  voice.cancel(); researchReviewReturn = document.activeElement;
  $('research-review-content').replaceChildren();
  $('research-review-dialog').showModal(); $('research-review-close').focus();
  researchReview.open({ journey: state.activeKey ?? state.document.id, nodeId, scope: purpose === 'challenge-review' ? 'decisions' : $('context-scope').value, ...(purpose ? { purpose } : {}), ...(followup ? { followup } : {}) });
}
function closeResearchReview() {
  researchReview.close();
  if ($('research-review-dialog').open) { $('research-review-dialog').close(); if (researchReviewReturn?.isConnected) researchReviewReturn.focus({ preventScroll: true }); }
}
function renderResearchReview() {
  const area = $('research-review-content'), value = researchReview.value;
  const focusedId = area.contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
  const focusedSetting = area.contains(document.activeElement) ? document.activeElement.dataset.setting : null;
  const challenge = researchReview.context?.purpose === 'challenge-review';
  const regeneration = researchReview.context?.purpose === 'question-regeneration';
  $('research-review-title').textContent = regeneration ? 'Regenerate follow-ups: review saved context' : challenge ? 'Challenge decisions: review selected inputs' : 'Review research context';
  $('research-review-description').textContent = regeneration ? 'Review the exact Explorer input for new questions from the corrected saved answer. Nothing runs until you choose Generate reviewed follow-ups. The attached chat retains its own history and can read the committed map; this preview shows only Explorer-supplied input.' : challenge ? 'Select saved answers for one tool-free hypothesis review. This does not change exploration mode. No new evidence is retrieved from the web; selected project excerpts are unverified inputs. Prior research and claims are excluded. References identify your inputs, not evidence support.' : 'Review the Explorer-supplied input for the isolated research helper. Choices apply only to this request. Viewing or excluding context starts no inference.';
  $('research-review-start').textContent = regeneration ? 'Generate reviewed follow-ups' : challenge ? 'Start reviewed challenge' : 'Start reviewed research';
  $('research-review-start').disabled = !value || researchReview.loading || reviewStarting || researchReview.projectDirty || (challenge && !value.prepared.canStart);
  $('research-review-refresh').disabled = researchReview.loading || reviewStarting;
  $('research-review-status').textContent = researchReview.loading ? 'Preparing context locally. No inference has started.' : researchReview.error || '';
  const projectControls = el('section', { class: 'review-record' }, el('h3', {}, 'Optional project files for this challenge only'));
  if (challenge) {
    const input = el('textarea', { id: 'project-paths', rows: '3', maxlength: '1204', 'aria-label': 'Project file paths, one relative path per line' }); input.value = researchReview.projectDraft; input.disabled = researchReview.loading || reviewStarting;
    input.addEventListener('input', () => { researchReview.projectDraft = input.value; researchReview.projectDirty = true; $('research-review-start').disabled = true; });
    projectControls.append(el('p', {}, 'Enter up to five text/source file paths relative to the attached session working directory, one per line (forward slashes, 240 characters each). Read/refresh approves these local reads; nothing is sent until Start reviewed challenge. Hidden paths, secret defaults and linked files are excluded. 64 KiB per file / 128 KiB total; UTF-8 prefix excerpts up to 8 KiB each / 32 KiB total.'), input,
      button('Read / refresh selected files', () => { void researchReview.prepare({ action: 'refresh', paths: researchReview.projectDraft.split(/\r?\n/).map(path => path.trim()).filter(Boolean) }); }, { id: 'project-read', disabled: researchReview.loading || reviewStarting }),
      button('Remove all files', () => { researchReview.projectDraft = ''; void researchReview.prepare({ action: 'refresh', paths: [] }); }, { id: 'project-clear', disabled: researchReview.loading || reviewStarting }),
      el('p', { class: 'quiet' }, 'Only this tool-free challenge receives the reviewed excerpts. Questions, web research, follow-ups, other helpers and exports omit them. File instructions are untrusted data, not decisions or verified evidence. Explorer retains them in this transient review/result; closing the preview, replacing/cancelling the result or closing the canvas clears them. Native helper journals/logs may retain model input; no zero-log guarantee is available.'));
  }
  const retainedControls = () => {
    const children = state.document.nodes.filter(node => node.parentId === researchReview.context.nodeId && isQuestion(node) && !node.review);
    const select = el('select', { id: 'regeneration-retained', multiple: '', size: '6', 'data-setting': 'retained', disabled: reviewStarting || researchReview.loading });
    for (const node of children) { const option = el('option', { value: node.id }, node.question); option.selected = researchReview.context.retained.includes(node.id); select.append(option); }
    select.addEventListener('change', () => { if (!select.isConnected || researchReview.context?.purpose !== 'question-regeneration') return; researchReview.retain([...select.selectedOptions].map(option => option.value)); });
    return el('section', { class: 'review-record' }, el('label', { for: 'regeneration-retained' }, 'Existing current questions to reuse as coverage (up to 50)'), select,
      el('p', { class: 'quiet' }, `${children.length} current child questions available. Select none or several using your platform's multiple-selection keys. Selected and unselected questions both remain saved. Questions needing review cannot be reused. Removed questions stay in History; they are excluded from this request.`));
  };
  if (!value) {
    if (!researchReview.loading || !area.children.length) area.replaceChildren(...(challenge ? [projectControls] : regeneration ? [retainedControls()] : []));
    if (researchReview.loading) for (const id of ['project-paths', 'project-read', 'project-clear', 'regeneration-retained']) { const control = $(id); if (control) control.disabled = true; }
    return;
  }
  const { context, coverage, bytes, limit, prompt, instructions, settings } = value.prepared;
  const display = (label, item) => el('section', { class: 'review-record' }, el('h3', {}, label), el('pre', {}, JSON.stringify(item, null, 2)));
  const { topic, objective, successCriteria, mode, pins } = context;
  const controls = el('section', { class: 'review-record research-preferences' }, el('h3', {}, 'Research preferences'));
  for (const [key, label, choices] of (challenge || regeneration ? [] : [
    ['depth', 'Depth', [['quick', 'Quick - 60 seconds / 8 tool attempts'], ['standard', 'Standard - 180 seconds / 24 tool attempts'], ['deeper', 'Deeper - 300 seconds / 40 tool attempts']]],
    ['sourceFocus', 'Source focus', [['balanced', 'Balanced evidence'], ['primary', 'Prefer primary sources']]],
    ['recency', 'Recency', [['any', 'No recency preference'], ['recent', 'Prefer recent sources when relevant']]],
  ])) {
    const select = el('select', { 'data-setting': key, id: `research-${key}` }, ...choices.map(([id, title]) => el('option', { value: id }, title)));
    select.value = settings[key]; select.disabled = reviewStarting;
    select.addEventListener('change', () => researchReview.settings({ ...researchReview.context.settings, [key]: select.value }));
    controls.append(el('label', {}, label, select));
  }
    const rows = [...(challenge ? [el('p', {}, 'One owned helper; 180 seconds operation allowance; zero tools; up to 12 findings. Shutdown/accounting may continue afterward. Usage is retained as Explorer Challenge Review; no price estimate is available.'), ...(value.prepared.canStart ? [] : [el('p', { class: 'notice' }, 'Select at least one saved nonempty answer to challenge. Tentative answers remain tentative; guidance alone is not a decision.')])] : regeneration ? [el('p', {}, 'Question generation is queued in the attached chat. Cancellation rejects its result but does not stop the chat turn. No isolated research helper or web retrieval is started by this action.')] : [controls, el('p', { id: 'research-settings-summary' }, researchSettingsText(settings))]), el('p', {}, `${bytes.toLocaleString()} / ${limit.toLocaleString()} UTF-8 bytes for actual instructions plus prompt. Omitted ${coverage.omitted.path} ancestors and ${coverage.omitted.decisionsElsewhere} other answers: ${coverage.omitted.budget} for size, ${coverage.omitted.scope} by scope, ${coverage.omitted.excluded ?? 0} excluded. ${regeneration ? 'Needs-review answer text is withheld; required prerequisites and selected coverage are shown below.' : 'Saved journey records are complete; project prefixes are labeled separately.'}`),
    display('Required: committed journey guidance and mode', { topic, objective, successCriteria, mode, pins }),
      display(challenge ? 'Required: journey root' : 'Required: selected question and committed answer state', context.path.at(-1))];
  if (challenge) {
    rows.unshift(projectControls);
    if (!context.projectSources?.length) rows.push(el('p', { id: 'project-empty' }, researchReview.projectDraft.trim() ? 'No files are attached to this preview. Read/refresh the entered paths or remove them before starting.' : 'No project files selected.'));
    if (!value.prepared.projectFresh) rows.push(el('p', { id: 'project-stale', class: 'notice' }, 'Project files or working root changed or are unavailable. These are the previously reviewed excerpts. Explicitly read/refresh files and review again before starting.'));
    for (const source of context.projectSources ?? []) rows.push(el('section', { class: 'review-record' }, el('h3', {}, `Project source: ${source.name}`), el('p', {}, `${source.excerptBytes} / ${source.bytes} UTF-8 bytes included${source.truncated ? ' (prefix excerpt)' : ' (complete file)'}. ${value.prepared.projectFresh ? 'Current at last check.' : 'Stale or unavailable.'} Source ${source.id}; SHA-256 ${source.fingerprint}`), el('pre', {}, source.excerpt)));
  } else if (!regeneration) rows.unshift(el('p', { class: 'quiet' }, 'Project files are excluded from web research and follow-ups. Selected files are available only in an explicit Challenge decisions review.'));
  if (regeneration) {
    rows.unshift(retainedControls());
    rows.push(display('Required: current prerequisites and selected retained coverage', context.regeneration));
  }
  if (value.prepared.followup) rows.push(display('Follow-up: exact question, hypothetical status, original recommendation, complete optional evidence and exchanges', value.prepared.followup), display('Bounded source tracking across this history', coverage.followupTracking));
  for (const [kind, records] of [['Ancestor', context.path.slice(0, -1)], ['Other answer', context.decisionsElsewhere]]) for (const record of records) {
    const input = el('input', { type: 'checkbox', 'data-node-id': record.id }); input.checked = true;
    input.addEventListener('change', () => researchReview.exclude(record.id, !input.checked));
    rows.push(el('section', { class: 'review-record' }, el('label', {}, input, ` Include optional ${kind.toLowerCase()}: ${record.question}`), el('pre', {}, JSON.stringify(record, null, 2))));
  }
  for (const id of value.excluded) {
    const input = el('input', { type: 'checkbox', 'data-node-id': id });
    input.addEventListener('change', () => researchReview.exclude(id, !input.checked));
    rows.push(el('label', {}, input, ` Re-include excluded record ${id}`));
  }
  rows.push(el('details', {}, el('summary', {}, 'Exact Explorer input strings'), el('h3', {}, 'Instructions'), el('pre', { id: 'research-review-instructions' }, instructions), el('h3', {}, 'Prompt'), el('pre', { id: 'research-review-prompt' }, prompt)));
  area.replaceChildren(...rows);
  if (focusedId) [...area.querySelectorAll('input')].find(input => input.dataset.nodeId === focusedId)?.focus({ preventScroll: true });
  if (focusedSetting) [...area.querySelectorAll('select')].find(select => select.dataset.setting === focusedSetting)?.focus({ preventScroll: true });
}
$('research-review-close').addEventListener('click', closeResearchReview);
$('research-review-dialog').addEventListener('cancel', event => { event.preventDefault(); closeResearchReview(); });
$('research-review-refresh').addEventListener('click', () => { void researchReview.prepare(); });
$('research-review-start').addEventListener('click', async () => {
  const value = researchReview.value;
  if (!value || reviewStarting || researchReview.loading) return;
  reviewStarting = true; renderResearchReview();
  const sequence = researchReview.sequence;
  if (value.prepared.operation === 'challenge-review') {
    const result = await requestCheck('start', undefined, value.token);
    reviewStarting = false;
    if (sequence !== researchReview.sequence) { if (researchReview.context) renderResearchReview(); return; }
    if (result) { closeResearchReview(); $('check-dialog').showModal(); $('cancel-check').focus({ preventScroll: true }); }
    else { researchReview.value = null; researchReview.error = $('check-status').textContent; renderResearchReview(); }
    return;
  }
  const result = await api(value.prepared.operation === 'question-regeneration' ? 'regenerate-questions' : value.prepared.followup ? 'research-follow-up' : 'research', { journey: value.journey, nodeId: value.nodeId, token: value.token });
  reviewStarting = false;
  if (sequence !== researchReview.sequence) { if (researchReview.context) renderResearchReview(); return; }
  if (result) { closeResearchReview(); $('cancel-request')?.focus({ preventScroll: true }); }
  else { researchReview.value = null; researchReview.error = $('notice').textContent || 'Refresh and review context before starting.'; renderResearchReview(); }
});

function renderFollowup(node) {
  const journey = state.activeKey ?? state.document.id;
  const draft = followupDraft?.journey === journey && followupDraft.nodeId === node.id ? followupDraft : null;
  const question = el('textarea', { id: 'followup-question', rows: '3', maxlength: '4000' }); question.value = draft?.question ?? '';
  const hypothetical = el('input', { id: 'followup-hypothetical', type: 'checkbox' }); hypothetical.checked = draft?.hypothetical ?? false;
  const remember = () => { followupDraft = { journey, nodeId: node.id, question: question.value, hypothetical: hypothetical.checked }; };
  question.addEventListener('input', remember); hypothetical.addEventListener('change', remember);
  return el('section', { class: 'research-followup' }, el('h3', {}, 'Ask about this research'),
    el('p', { class: 'quiet' }, 'Ask why, clarify a recommendation, or explore a changed assumption. Changes described here are hypothetical; saved answers and guidance stay unchanged. Up to four complete exchanges (64 KiB) stay in this canvas until it closes or restarts. Navigation hides this history; asking on another node replaces it. Reload clears the typed question but can reconnect to history while this canvas remains open. Started work continues until it finishes or you cancel; a reload never starts another request.'),
    el('label', { for: 'followup-question' }, 'Follow-up question (4,000 characters maximum)'), question,
    el('label', {}, hypothetical, ' Explore a hypothetical assumption'),
    button('Review follow-up context', () => { remember(); if (!question.value.trim()) return notice('Enter a follow-up question.'); openResearchReview(node.id, { question: question.value, hypothetical: hypothetical.checked }); }, { id: 'followup-review' }),
    el('div', { id: 'followup-history', 'aria-live': 'polite' }));
}
function updateFollowupHistory(node) {
  const area = $('followup-history'); if (!area) return;
  const value = state.followup?.nodeId === node.id && state.followup.journey === (state.activeKey ?? state.document.id) ? state.followup : null;
  const signature = JSON.stringify(value); if (area.dataset.value === signature) return; area.dataset.value = signature;
  const rows = [];
  if (value) {
    rows.push(el('p', { class: 'quiet' }, value.historical ? 'Historical follow-ups: saved source context or original research changed. A new request starts a fresh history.' : 'Follow-ups to this original research; saved answers are unchanged.'));
    if (value.dropped) rows.push(el('p', { class: 'quiet' }, `${value.dropped} older complete exchanges omitted by the four-exchange / 64 KiB retention limit.`));
    for (const exchange of value.exchanges) {
      const result = exchange.result, block = el('section', { class: 'research-claim' }, el('h4', {}, exchange.hypothetical ? 'Hypothetical follow-up' : 'Follow-up question'), el('p', {}, exchange.question), el('p', {}, result.answer), el('p', {}, `Uncertainty: ${result.uncertainty}`));
      for (const claim of result.claims) {
        const detail = el('details', {}, el('summary', {}, `${claim.text} (${claim.basis === 'sources' ? 'source-linked model interpretation' : claim.basis})`), el('p', {}, `Limitations: ${claim.limitations}`));
        for (const reference of claim.evidence) {
          const source = result.sources.find(item => item.id === reference.sourceId);
          detail.append(el('p', {}, reference.paraphrase), el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.title), el('p', { class: 'quiet' }, `${source.evidenceOrigin.origin === 'current' ? 'Newly consulted in this exchange' : 'Prior evidence from ' + source.evidenceOrigin.origin + '/' + source.evidenceOrigin.sourceId}. ${source.provenance === 'imported' ? 'Imported metadata; not observed by this installation' : 'Recorded successful read of requested URL'}: ${source.retrievedAt ?? 'Retrieval time unknown'}. Redirect destination and publication date unknown.`));
        }
        block.append(detail);
      }
      if (result.sources.length) block.append(el('details', {}, el('summary', {}, 'All response sources'), ...result.sources.map(source => el('div', {}, el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, `${source.id}: ${source.title}`), el('p', { class: 'quiet' }, `${source.evidenceOrigin.origin === 'current' ? 'Newly consulted in this exchange' : 'Prior evidence from ' + source.evidenceOrigin.origin + '/' + source.evidenceOrigin.sourceId}; ${source.provenance}; ${source.retrievedAt ?? 'Retrieval time unknown'}.`)))));
      rows.push(block);
    }
  }
  area.replaceChildren(...rows);
}

function renderComparison(r, ui, selectDetail, addSelected) {
  const criteria = [{ label: 'Description', field: 'description' }, { label: 'Pros', field: 'pros' }, { label: 'Cons', field: 'cons' }];
  const labels = new Set(r.options.flatMap(option => (option.details ?? []).map(detail => detail.label)));
  for (const label of labels) criteria.push({ label });
  ui.comparison ??= { open: false, selected: criteria.map(() => true), priorities: criteria.map(() => 'normal') };
  const preferences = ui.comparison;
  const comparison = el('details', { id: 'option-comparison', class: 'option-comparison' }, el('summary', { id: 'comparison-summary' }, 'Compare options'));
  comparison.open = preferences.open;
  comparison.addEventListener('toggle', () => { if (comparison.isConnected) { preferences.open = comparison.open; scheduleLayout(); } });
  comparison.append(el('p', { class: 'quiet' }, 'Compare saved model judgments. Cell source support is unknown: the separate Claims and evidence section does not establish support for these values. Unknown means no saved value, not a zero score.'),
    el('p', { class: 'quiet' }, 'Choose criteria and your priorities. High rows appear first, then Normal, then Low. Priorities express your preferences, not evidence quality. Tradeoffs remain yours to judge; no score or winner is calculated. The saved recommendation stays unchanged.'),
    el('p', { class: 'quiet' }, 'These choices and selected details stay in this panel through node navigation. Changing journeys, reloading, or replacing saved research or sources resets them. Exact detail labels are matched; duplicate values are kept separately. Hiding a criterion does not clear selected details.'));
  const controls = el('fieldset', { class: 'comparison-controls' }, el('legend', {}, 'Criteria and personal priorities'));
  const body = el('tbody'), table = el('table', { id: 'comparison-table' }, el('caption', {}, 'Saved option comparison'),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Criterion / your priority'), r.options.map(option => el('th', { scope: 'col' }, option.title)))), body);
  const priorities = { high: 'High', normal: 'Normal', low: 'Low' };
  const renderRows = () => {
    const rows = criteria.map((criterion, index) => ({ ...criterion, index })).filter(criterion => preferences.selected[criterion.index]);
    rows.sort((a, b) => Object.keys(priorities).indexOf(preferences.priorities[a.index]) - Object.keys(priorities).indexOf(preferences.priorities[b.index]));
    body.replaceChildren(...rows.map(criterion => el('tr', {}, el('th', { scope: 'row' }, `${criterion.label}${criterion.field ? ' (model judgment)' : ' (detail)'} · ${priorities[preferences.priorities[criterion.index]]}`), r.options.map((option, optionIndex) => {
      const cell = el('td');
      const values = criterion.field ? (Array.isArray(option[criterion.field]) ? option[criterion.field] : [option[criterion.field]]).filter(Boolean) : (option.details ?? []).map((detail, index) => ({ ...detail, index })).filter(detail => detail.label === criterion.label);
      if (!values.length) return el('td', {}, 'Unknown — no saved value.');
      cell.append(el('p', { class: 'quiet' }, 'Model judgment · Cell source support unknown'));
      for (const value of values) {
        if (criterion.field) cell.append(el('p', {}, value));
        else {
          const detailId = `detail-${optionIndex}-${value.index}`, id = `comparison-${detailId}`, checkbox = el('input', { type: 'checkbox', id, 'aria-label': `Select ${criterion.label} from ${option.title}: ${value.value}` });
          checkbox.checked = ui.selectedDetails.has(detailId);
          checkbox.addEventListener('change', () => { if (checkbox.isConnected) selectDetail(detailId, checkbox.checked); });
          cell.append(el('label', { class: 'research-detail', for: id }, checkbox, el('span', {}, value.value)));
        }
      }
      return cell;
    }))));
    if (!rows.length) body.append(el('tr', {}, el('td', { colspan: String(r.options.length + 1) }, 'Select at least one criterion to compare.')));
    scheduleLayout();
  };
  criteria.forEach((criterion, index) => {
    const id = `comparison-criterion-${index}`, checkbox = el('input', { type: 'checkbox', id }); checkbox.checked = preferences.selected[index];
    checkbox.addEventListener('change', () => { if (checkbox.isConnected) { preferences.selected[index] = checkbox.checked; renderRows(); } });
    const priorityId = `comparison-priority-${index}`, priority = el('select', { id: priorityId }, Object.entries(priorities).map(([value, label]) => el('option', { value }, label))); priority.value = preferences.priorities[index];
    priority.addEventListener('change', () => { if (priority.isConnected && Object.hasOwn(priorities, priority.value)) { preferences.priorities[index] = priority.value; renderRows(); } });
    controls.append(el('div', {}, el('label', { class: 'research-detail', for: id }, checkbox, `${criterion.label}${criterion.field ? ' (model judgment)' : ' (detail)'}`), el('label', { for: priorityId }, `Your priority: ${criterion.label}`), priority));
  });
  comparison.append(controls, el('div', { class: 'comparison-scroll', role: 'region', tabindex: '0', 'aria-label': 'Option comparison, scroll horizontally to read all options' }, table));
  if (labels.size) comparison.append(button('Add selected details to draft', addSelected, { id: 'comparison-add-details', disabled: !ui.selectedDetails.size }));
  renderRows(); return comparison;
}

function renderResearch(node) {
  const r = node.research, ui = uiFor(node.id), key = JSON.stringify(r);
  if (ui.researchKey !== key) { ui.researchKey = key; ui.selectedDetails = new Set(); ui.comparison = null; }
  const add = suggestion => {
    const live = state.document?.nodes.find(n => n.id === node.id);
    if (!live || selected !== node.id || !expanded || libraryView || JSON.stringify(live.research) !== key) return;
    node = live;
    const previous = drafts.get(node.id) ?? node.answer, value = previous ? `${previous}\n\n${suggestion}` : suggestion;
    if (value.length > 20000) return notice('Your answer is too long to add this suggestion. Shorten it first.');
    voice.cancel(); ui.addition = { before: previous, after: value };
    draftClient.edit(node.id, value); $('answer').value = value; answerStatus(node);
    const answer = $('answer');
    answer.focus({ preventScroll: true }); answer.setSelectionRange(value.length, value.length);
    notice('Added to your draft. Edit it before saving, or undo the addition.');
    if (!outlineMode) refreshScene();
    const content = !outlineMode && $('node-workspace').classList.contains('scroll-pane') ? $('node-workspace') : answer.closest('.node-content');
    // Scroll only the editor, never an ancestor of the transformed map.
    content.scrollTop += answer.getBoundingClientRect().top - content.getBoundingClientRect().top - 40;
  };
  const section = el('div', { class: 'research' }, el('span', { class: 'basis' }, r.basis === 'sources' ? 'Based on consulted sources' : 'Model reasoning · not externally verified'), el('p', { class: 'quiet' }, researchSettingsText(r.settings)), el('p', {}, r.summary));
  const retrieval = source => !source.retrievedAt ? 'Retrieval time unknown.' : `${source.provenance === 'imported' ? 'Imported read metadata; not observed by this installation' : 'Recorded successful read of requested URL'}: ${source.retrievedAt}. Redirect destination and publication date unknown.`;
  const sourceLink = source => el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, `${source.id ? source.id + ': ' : ''}${source.title}`);
  if (r.claims) {
    section.append(el('h3', {}, 'Claims and evidence'), el('p', { class: 'quiet' }, 'Selected model assertions, not an exhaustive check of this comparison. A page read does not verify a claim; supporting paraphrases are model interpretations.'));
    for (const claim of r.claims) {
      const block = el('section', { class: 'research-claim', id: `claim-${claim.id}` }, el('h4', {}, `${claim.id}: ${claim.text}`), el('p', { class: 'basis' }, claim.basis === 'sources' ? 'Source-linked model interpretation' : claim.basis === 'reasoning' ? 'Model reasoning' : 'Unknown support'));
      const disclosure = el('details', {}, el('summary', {}, claim.evidence.length ? 'Inspect supporting evidence and limitations' : 'Inspect limitations'), el('p', {}, `Limitations: ${claim.limitations}`));
      for (const item of claim.evidence) {
        const source = r.sources.find(s => s.id === item.sourceId);
        disclosure.append(el('p', {}, item.paraphrase), sourceLink(source), el('p', { class: 'quiet' }, retrieval(source)));
      }
      block.append(disclosure); section.append(block);
    }
  } else section.append(el('p', { class: 'quiet' }, 'Claim-level support and historical retrieval times unknown for this legacy result.'));
  section.append(el('div', { class: 'recommendation' }, el('h3', {}, 'Recommendation'), el('p', {}, r.recommendation), button('Use recommendation', () => add(r.proposedAnswer ?? r.recommendation), { id: 'use-recommendation' })));
  const details = r.options.flatMap((option, index) => (option.details ?? []).map((detail, i) => ({ id: `detail-${index}-${i}`, ...detail })));
  const selectDetail = (id, checked) => {
    checked ? ui.selectedDetails.add(id) : ui.selectedDetails.delete(id);
    for (const control of [$(id), $(`comparison-${id}`)]) if (control) control.checked = checked;
    for (const control of [$('add-details'), $('comparison-add-details')]) if (control) control.disabled = !ui.selectedDetails.size;
  };
  const addSelected = () => {
    const selected = details.filter(detail => ui.selectedDetails.has(detail.id));
    if (selected.length) add(selected.map(detail => `${detail.label}: ${detail.value}`).join('\n'));
  };
  section.append(renderComparison(r, ui, selectDetail, addSelected));
  for (const [index, o] of r.options.entries()) {
    const option = el('section', { class: 'option' }, el('h3', {}, o.title), el('p', {}, o.description), el('strong', { class: 'pro' }, 'Pros'), el('ul', {}, o.pros.map(v => el('li', {}, v))), el('strong', { class: 'con' }, 'Cons'), el('ul', {}, o.cons.map(v => el('li', {}, v))), button('Use this option', () => add(o.proposedAnswer ?? `${o.title}: ${o.description}`), { id: `add-option-${index}` }));
    for (const [i, detail] of (o.details ?? []).entries()) {
      const id = `detail-${index}-${i}`, checkbox = el('input', { type: 'checkbox', id });
      checkbox.checked = ui.selectedDetails.has(id);
      checkbox.addEventListener('change', () => { if (checkbox.isConnected) selectDetail(id, checkbox.checked); });
      option.append(el('label', { class: 'research-detail', for: id }, checkbox, el('span', {}, el('strong', {}, detail.label), ': ', detail.value)));
    }
    section.append(option);
  }
  if (details.length) section.append(button('Add selected details', addSelected, { id: 'add-details', disabled: !ui.selectedDetails.size }));
  section.append(el('h3', {}, 'What is still uncertain'), el('p', {}, r.uncertainty));
  if (r.sources.length) section.append(el('div', { class: 'sources' }, el('h3', {}, 'Consulted sources'), el('p', { class: 'quiet' }, 'Reading a page does not establish claim support.'), r.sources.map((s, index) => el('div', { id: `source-${index}` }, sourceLink(s), el('p', { class: 'quiet' }, retrieval(s))))));
  return section;
}
function setOutlineMode(value) {
  if (outlineMode === value) return;
  const active = document.activeElement, editorFocus = $('node-workspace').contains(active) || $('question-drawer').contains(active);
  endDrag(); suppressClick = false; cancelAnimationFrame(layoutFrame); if (value) outlineNavigated = false; outlineMode = value;
  $('working-view').classList.toggle('outline-mode', value);
  if (value) $('node-workspace').scrollTop = 0;
  $('outline').hidden = !value;
  $('outline-toggle').setAttribute('aria-expanded', String(value));
  $('outline-toggle').textContent = value ? 'Map view' : 'Outline view';
  for (const id of ['nodes', 'edges']) $(id).hidden = value;
  $('edges').style.display = value ? 'none' : '';
  $('map-controls').hidden = value;
  $('map-hint').hidden = value;
  $('map').setAttribute('aria-label', value ? 'Selected outline node' : 'Question map. Drag the background, a card, or a question heading to pan. Wheel or plus and minus keys zoom; zero resets zoom; Home fits the map. Arrow keys pan. Escape collapses a question.');
  $('map').tabIndex = value ? -1 : 0;
  if (value) { minimap.suspend(true); renderOutline(); }
  else {
    minimap.suspend(false); refreshScene(null);
    if (firstFit) { expanded ? centerSelected() : fit(); firstFit = false; }
    else if (outlineNavigated) expanded ? centerSelected() : revealNode(selected);
  }
  if (!editorFocus && active !== $('outline-toggle')) (value ? $('outline-selected') : $('outline-toggle')).focus({ preventScroll: true });
}
function outlineEntries() {
  const filters = currentSearchFilters('outline');
  const filtered = !criticalPrior && !!(filters.query || filters.state !== 'all' || filters.importance !== 'all' || filters.research || filters.review || filters.drafts || filters.reminder !== 'all');
  const nodes = criticalPrior ? branches.nodes : state.document.nodes;
  const children = new Map(nodes.map(n => [n.id, []])), byId = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) if (n.parentId) children.get(n.parentId).push(n);
  const entries = [], stack = [{ node: byId.get(state.document.rootId), depth: 0 }];
  while (stack.length) {
    const item = stack.pop(), n = item.node;
    const draft = drafts.get(n.id) ?? draftClient.entries.get(n.id)?.conflict?.text ?? null;
    const match = criticalPrior ? { snippet: '', hasDraft: !!draft } : matchSearch(n, filters, { draft });
    if (match) entries.push({ ...item, ...match, parent: byId.get(n.parentId)?.question });
    if (criticalPrior || filtered || !collapsed.has(n.id)) for (const node of children.get(n.id).toReversed()) stack.push({ node, depth: item.depth + 1 });
  }
  return { entries, filtered, filters };
}
function revealOutlineSelection(focus = true) {
  if (!outlineMode || !selected) return;
  outlineNavigated = true;
  $('outline-reset').click();
  collapsed = revealPath(state.document.nodes, collapsed, selected);
  branches = currentBranches();
  outlinePage = Math.floor(Math.max(0, outlineEntries().entries.findIndex(item => item.node.id === selected)) / SEARCH_PAGE_SIZE);
  renderOutline();
  const row = [...$('outline-list').querySelectorAll('[data-node-id]')].find(e => e.dataset.nodeId === selected);
  if (focus) row?.focus({ preventScroll: true });
  row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function renderOutline() {
  if (!state.document || $('outline').hidden) return;
  const { entries: matches, filtered, filters } = outlineEntries(), filterStamp = JSON.stringify([referenceJourney(), filters]);
  if (outlineFilterStamp !== filterStamp) { outlinePage = 0; outlineFilterStamp = filterStamp; }
  outlinePage = Math.min(outlinePage, Math.max(0, Math.ceil(matches.length / SEARCH_PAGE_SIZE) - 1));
  const stamp = JSON.stringify([filterStamp, outlinePage, selected, impactDisplay || criticalPrior ? impactKey(state.document) : null, !!criticalPrior, matches.map(({ node: n, parent, depth, snippet, hasDraft }) => [n.id, n.question, n.category, nodeStatus(n), n.review, !!n.research, n.revisit, n.importance, parent, depth, snippet, hasDraft, collapsed.has(n.id) ? hiddenSummary(n.id) : ''])]);
  if ($('outline-list').renderStamp === stamp) return;
  $('outline-list').renderStamp = stamp;
  const scroll = $('outline-list').scrollTop;
  const focused = $('outline-list').contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
  const focusedBranch = $('outline-list').contains(document.activeElement) ? document.activeElement.dataset.branchId : null;
  const page = matches.slice(outlinePage * SEARCH_PAGE_SIZE, (outlinePage + 1) * SEARCH_PAGE_SIZE);
  $('outline-mode-hint').textContent = filtered ? 'Filtered results across the full journey, including folded branches. Levels and parents show original ancestry.' : 'Journey hierarchy. Fold branches to hide descendants. Search includes folded nodes. The selected editor remains available even when its row is hidden.';
  if (criticalPrior) $('outline-mode-hint').textContent = 'Critical paths: highlighted decisions and their context. All qualifying ties and recorded dependency components remain reachable. Local filters and folds resume when you return to the previous view.';
  $('outline-count').textContent = `${matches.length} matching nodes${matches.length ? `; showing ${outlinePage * SEARCH_PAGE_SIZE + 1}\u2013${outlinePage * SEARCH_PAGE_SIZE + page.length}` : '. No nodes match these filters.'}`;
  $('outline-previous').disabled = outlinePage === 0; $('outline-next').disabled = (outlinePage + 1) * SEARCH_PAGE_SIZE >= matches.length;
  $('outline-list').replaceChildren(...page.map(item => {
    const n = item.node;
    return el('div', { class: 'outline-row', role: 'listitem', style: `--depth:${filtered ? 0 : Math.min(item.depth, 4)}`, 'data-depth': item.depth },
      button([n.question, el('small', {}, `Level ${item.depth + 1}${item.parent ? ` \u00b7 Parent: ${item.parent}` : ' \u00b7 Journey root'}`), el('small', {}, `${n.category} \u00b7 ${nodeStatus(n)}${n.review ? '; needs review' : ''}${n.research ? ' \u00b7 Research available' : ''}${collapsed.has(n.id) ? ` \u00b7 ${hiddenSummary(n.id)}` : ''}${n.revisit ? ` \u00b7 Reminder: ${revisitLabel(n)}` : ''}`), ...(criticalPrior ? [el('small', { class: 'critical-reason' }, criticalLabel(n))] : []), ...(isQuestion(n) ? [importanceBadge(n), ...(impactDisplay ? [el('small', { class: 'outline-impact' }, impactLabel(n))] : [])] : [])], () => select(n.id, { outlineRow: true }), { 'data-node-id': n.id, 'aria-current': String(n.id === selected) }),
      ...(filtered ? [el('small', { class: 'search-snippet' }, item.snippet)] : []), branchButton(n));
  }));
  $('outline-list').scrollTop = scroll;
  if (focused || focusedBranch) {
    const row = focused ? [...$('outline-list').querySelectorAll('[data-node-id]')].find(e => e.dataset.nodeId === focused) : [...$('outline-list').querySelectorAll('[data-branch-id]')].find(e => e.dataset.branchId === focusedBranch);
    const target = row ?? $('outline-selected');
    target.focus({ preventScroll: true });
    if (!row) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

let diagnosticsEpoch = 0, diagnosticsAbort = null;
function closeDiagnostics() {
  diagnosticsEpoch++; diagnosticsAbort?.abort(); diagnosticsAbort = null;
  $('diagnostics-dialog').close(); $('diagnostics-open').focus({ preventScroll: true });
}
async function loadDiagnostics(action) {
  if (diagnosticsAbort) return;
  const epoch = ++diagnosticsEpoch, page = pageEpoch, abort = new AbortController(); diagnosticsAbort = abort;
  const current = () => !closed && !suspended && epoch === diagnosticsEpoch && page === pageEpoch && $('diagnostics-dialog').open;
  const timer = setTimeout(() => abort.abort(), 15000);
  $('diagnostics-retry').disabled = $('diagnostics-export').disabled = true;
  $('diagnostics-status').textContent = action === 'export' ? 'Preparing the approved support fields…' : 'Checking prerequisites without recording or inference…';
  try {
    const response = await fetch(action === 'export' ? 'api/support' : 'api/diagnostics', { signal: abort.signal,
      ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(action === 'export' ? {} : { action: 'retry' }) } : {}) });
    if (!response.ok) throw new Error('Diagnostics request failed.');
    if (action === 'export') {
      const blob = await response.blob(); if (!current()) return;
      const url = URL.createObjectURL(blob), link = el('a', { href: url, download: 'explorer-support.json' });
      try { document.body.append(link); link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      $('diagnostics-status').textContent = 'Support download requested. Explorer cannot confirm that your browser saved it.';
    } else {
      const value = await response.json(); if (!current()) return;
      const rows = [
        ['Explorer', value.pluginVersion], ['Desktop version', value.desktopVersion], ['Installed runtime', value.host.runtime],
        ['SDK helper API', value.host.sdk], ['SDK protocol', value.host.protocol ?? 'unknown'], ['Account prerequisite', value.host.account], ['Selected model prerequisite', value.host.model],
        ['Speech runtime', value.speech.runtime], ['Voice model assets', value.speech.model], ['Selected microphone discovery', value.speech.microphone],
        ['Discovered speech models / devices', `${value.speech.modelCount} / ${value.speech.deviceCount}`], ['Speech inspection', value.speech.error],
        ['Research prerequisites', value.helpers.research], ['Tool-free helper prerequisites', value.helpers.toolFree],
        ['Research release', value.helpers.researchRelease], ['Tool-free helper release', value.helpers.toolFreeRelease],
        ['Save recovery observation', value.recovery.save], ['Export response observation', value.recovery.export],
      ];
      $('diagnostics-results').replaceChildren(...rows.map(([label, result]) => el('div', {}, el('dt', {}, label), el('dd', {}, String(result)))));
      $('diagnostics-status').textContent = 'Prerequisite results are cached until Retry checks. Current helper-release blockers are checked on every read and export.';
    }
  } catch {
    if (current()) $('diagnostics-status').textContent = action === 'export' ? 'Support export failed. Retry diagnostics, then explicitly export again. No private paths or logs were collected.' : 'Diagnostics could not complete. Retry when Copilot and local storage are available.';
  } finally {
    clearTimeout(timer); if (diagnosticsAbort === abort) diagnosticsAbort = null;
    if (current()) $('diagnostics-retry').disabled = $('diagnostics-export').disabled = false;
  }
}
$('diagnostics-open').addEventListener('click', () => {
  $('diagnostics-dialog').showModal(); $('diagnostics-close').focus(); void loadDiagnostics();
});
$('diagnostics-close').addEventListener('click', closeDiagnostics);
$('diagnostics-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDiagnostics(); });
$('diagnostics-retry').addEventListener('click', () => void loadDiagnostics('retry'));
$('diagnostics-export').addEventListener('click', () => void loadDiagnostics('export'));
$('diagnostics-voice').addEventListener('click', () => {
  closeDiagnostics();
  if (!$('navigation-dialog').open) $('navigation-open').click();
  voice.openSettings();
});
$('diagnostics-recovery').addEventListener('click', () => { closeDiagnostics(); $('navigation-dialog').close(); $('recovery-open').click(); });

let storageEpoch = 0, storageBusy = false, storagePreview = null, storageRevision = 0, storageSettingsError = false, storageReturn = null;
function closeStorage() {
  if (storageBusy) return;
  storageEpoch++; $('storage-dialog').close(); storageReturn?.focus({ preventScroll: true });
}
async function storageRequest(action) {
  if (storageBusy) return;
  storageBusy = true; const epoch = storageEpoch, page = pageEpoch;
  const buttons = ['storage-save', 'storage-refresh', 'storage-preview', 'storage-confirm', 'storage-keep'];
  for (const id of buttons) $(id).disabled = true;
  const current = () => !closed && !suspended && pageEpoch === page && storageEpoch === epoch && $('storage-dialog').open;
  const input = { action, ...(action === 'settings' || action === 'preview' ? { keepHistory: Number($('storage-keep').value) } : {}),
    ...(action === 'settings' ? { revision: storageRevision } : {}), ...(action === 'clean' ? { id: storagePreview.id } : {}) };
  if (action === 'preview') { storagePreview = null; $('storage-confirm').hidden = true; $('storage-candidates').replaceChildren(); $('storage-results').replaceChildren(); }
  $('storage-status').textContent = action === 'clean' ? 'Removing only captured candidates. Close is available when the request finishes.' : 'Inspecting owned storage…';
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30000);
  try {
    const response = await fetch('api/storage', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const value = await response.json(); if (!current()) return;
    if (!response.ok) throw new Error(value.error);
    if (action === 'inspect') {
      storageRevision = value.settings.revision; storageSettingsError = !!value.error; $('storage-keep').value = String(storagePreview?.keepHistory ?? value.settings.keepHistory);
      const inventory = value.inventory;
      const labels = { journeys: 'Journeys', exports: 'Saved Markdown files', library: 'Library metadata', drafts: 'Drafts and tombstones', history: 'History files and manifests', recovery: 'Recovery, staging and locks', usage: 'Usage receipts and lifecycle', analytics: 'Bounded local observations (protected)', preferences: 'Preferences and references', unknown: 'Unknown files (protected)' };
      $('storage-inventory').replaceChildren(el('dl', {}, ...Object.entries(inventory.categories).map(([key, row]) => el('div', {}, el('dt', {}, labels[key]), el('dd', {}, `${row.files} files · ${row.apparentBytes.toLocaleString()} bytes`)))),
        el('p', {}, `${inventory.apparentBytes.toLocaleString()} apparent bytes; ${inventory.uniqueBytes.toLocaleString()} bytes after known file-identity deduplication; ${inventory.duplicateBytes.toLocaleString()} duplicate hardlink bytes. These are file lengths, not allocated disk blocks.`),
        el('p', {}, `${inventory.manifestDeclaredHistoryBytes.toLocaleString()} retained snapshot bytes declared by ${inventory.manifests} readable manifests. File totals also include metadata and unreferenced staging; declared bytes do not verify snapshot health.`),
        el('p', {}, `Inspection limits: ${inventory.limits.entries.toLocaleString()} entries, depth ${inventory.limits.depth}; preview at most ${inventory.limits.candidates} snapshots and 256 MiB of validation reads. Nothing outside the owned root or behind recovery pointers is scanned.`),
        ...inventory.issues.map(issue => el('p', { class: 'notice' }, `${issue.path}: ${issue.message}`)));
      $('storage-status').textContent = `${inventory.partial ? 'Partial inventory: unscanned or unreadable data is excluded from totals and remains protected.' : 'Inventory complete within known owned directories.'} ${value.error ?? ''}`;
    } else if (action === 'settings') {
      storageRevision = value.settings.revision; $('storage-status').textContent = 'Preview preference saved. No files were deleted.';
    } else if (action === 'preview') {
      storagePreview = value;
      $('storage-candidates').replaceChildren(el('h3', {}, 'Exact cleanup candidates'), el('p', {}, `${value.candidates.length} snapshots · ${value.bytes.toLocaleString()} bytes. Preview expires in 15 minutes. Changes to files or protection may make candidates ineligible.`),
        el('ol', {}, ...value.candidates.map(row => el('li', {}, `${row.topic} · revision ${row.revision} · ${row.bytes.toLocaleString()} bytes · ${row.hash}`))),
        ...value.issues.map(issue => el('p', { class: 'notice' }, issue)));
      $('storage-status').textContent = value.candidates.length ? 'Review the exact list, then explicitly remove these history versions.' : 'No eligible history versions. Protected data and unknown files remain untouched.';
      $('storage-confirm').hidden = !value.candidates.length; $('storage-confirm').textContent = 'Remove listed history versions';
      if (value.candidates.length) $('storage-confirm').focus();
    } else {
      $('storage-results').replaceChildren(el('h3', {}, 'Cleanup outcomes'), el('ol', {}, ...value.results.map(row => el('li', {}, `Revision ${row.revision} · ${row.hash} · ${row.status}: ${row.message}`))), ...value.issues.map(issue => el('p', { class: 'notice' }, issue)));
      $('storage-status').textContent = `${value.results.filter(row => row.status === 'removed').length} confirmed removed; ${value.results.filter(row => row.status === 'failed').length} failed; ${value.results.filter(row => row.status === 'ineligible').length} ineligible; ${value.results.filter(row => row.status === 'absent').length} already absent with unknown deletion outcome.`;
      $('storage-confirm').hidden = !value.results.some(row => row.status === 'failed'); $('storage-confirm').textContent = 'Retry original failed candidates';
      $('storage-close').focus();
    }
  } catch (error) {
    if (current()) $('storage-status').textContent = action === 'clean' ? `${error.message || 'Cleanup response was unavailable.'} Some operations may have completed. Retry the original captured candidates to inspect their outcomes; an expired preview requires a fresh explicit preview.` : error.message || 'Storage inspection failed. Other settings and diagnostics remain available.';
  } finally {
    clearTimeout(timer); storageBusy = false;
    for (const id of buttons) $(id).disabled = false;
    $('storage-save').disabled = storageSettingsError;
    if (current() && action === 'preview' && storagePreview?.candidates.length) $('storage-confirm').focus();
  }
}
for (const id of ['storage-open', 'storage-home']) $(id).addEventListener('click', () => { storageReturn = $(id); storageEpoch++; $('storage-dialog').showModal(); $('storage-close').focus(); void storageRequest('inspect'); });
$('storage-close').addEventListener('click', closeStorage);
$('storage-dialog').addEventListener('cancel', event => { event.preventDefault(); closeStorage(); });
$('storage-refresh').addEventListener('click', () => void storageRequest('inspect'));
$('storage-save').addEventListener('click', () => void storageRequest('settings'));
$('storage-preview').addEventListener('click', () => void storageRequest('preview'));
$('storage-confirm').addEventListener('click', () => { if (storagePreview) void storageRequest('clean'); });
$('storage-keep').addEventListener('change', () => { storagePreview = null; $('storage-confirm').hidden = true; $('storage-candidates').replaceChildren(); $('storage-results').replaceChildren(); });

let recoveryEpoch = 0, recoverySelection = null, recoveryContext = null, recoveryReturn = null;
function closeRecovery() {
  recoveryEpoch++; $('recovery-dialog').close();
  if (recoveryReturn?.isConnected) recoveryReturn.focus({ preventScroll: true });
}
async function readRecovery(input, epoch) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000), page = pageEpoch;
  try {
    const response = await fetch('api/recovery', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const value = await response.json();
    if (closed || suspended || page !== pageEpoch || epoch !== recoveryEpoch || !$('recovery-dialog').open) return null;
    if (!response.ok) throw new Error(value.error); return value;
  } finally { clearTimeout(timer); }
}
async function loadRecovery() {
  const epoch = ++recoveryEpoch; recoverySelection = null; recoveryContext = null;
  $('recovery-copy').disabled = true; $('recovery-retry').disabled = true;
  $('recovery-list').replaceChildren(); $('recovery-preview').replaceChildren(); $('recovery-operations').replaceChildren();
  $('recovery-status').textContent = 'Inspecting local recovery evidence...';
  try {
    const value = await readRecovery({ action: 'list' }, epoch); if (!value) return;
    recoveryContext = { journey: value.journey, revision: value.revision }; $('recovery-retry').disabled = false;
    $('recovery-status').textContent = [value.notice?.message, value.entries.length ? 'Choose a validated saved version to inspect.' : 'No validated recoverable versions found.', value.unavailable ? 'Some files could not be validated; they remain untouched.' : ''].filter(Boolean).join(' ');
    for (const row of value.entries) $('recovery-list').append(button(`Inspect revision ${row.revision} | ${new Date(row.time).toLocaleString()}`, async () => {
      const selectedEpoch = ++recoveryEpoch; recoverySelection = null; $('recovery-copy').disabled = true;
      try {
        const preview = await readRecovery({ action: 'inspect', ...recoveryContext, candidate: row.hash }, selectedEpoch); if (!preview) return;
        recoverySelection = row.hash;
        $('recovery-preview').replaceChildren(el('h3', {}, preview.document.topic), el('p', {}, 'Preview only. The active journey has not changed.'),
          ...preview.document.nodes.slice(0, 100).map(node => el('p', {}, `${node.question}\n${node.answer ?? ''}`)),
          ...(preview.document.nodes.length > 100 ? [el('p', {}, 'Preview shows the first 100 nodes. The recovery copy contains the complete validated version.')] : []));
        $('recovery-copy').disabled = false;
      } catch { if (selectedEpoch === recoveryEpoch) $('recovery-status').textContent = 'This version could not be inspected. Refresh recovery; originals are preserved.'; }
    }));
    renderRecoveryOperations(value);
  } catch { if (epoch === recoveryEpoch) $('recovery-status').textContent = 'Recovery inspection could not complete. Refresh and retry when storage is available; originals are preserved.'; }
}
function renderRecoveryOperations(value) {
  if (value.operationsUnavailable) $('recovery-operations').append(el('p', {}, 'Helper evidence could not be inspected. Its operation state is unknown; saved-version recovery remains available.'));
  $('recovery-operations').append(el('p', {}, value.operation.status === 'active' ? `${value.operation.kind}: still active in this canvas.` : 'No active operation is recorded in this canvas. Earlier unrecorded work is unknown.'));
  for (const operation of value.operations ?? []) {
    const row = el('p', {}, `${operation.kind}: ${operation.status}. Receipts and recovery files are retained.`);
    if (['interrupted', 'failed'].includes(operation.status)) row.append(button('Dismiss this notice', async () => {
      try { await readRecovery({ action: 'dismiss', operation: operation.id }, recoveryEpoch); await loadRecovery(); }
      catch { $('recovery-status').textContent = 'Could not dismiss this notice. Recovery evidence is preserved.'; }
    }));
    $('recovery-operations').append(row);
  }
  if (value.export) $('recovery-operations').append(el('p', {}, `Export: ${value.export.status}. Browser file saving is unknown.`),
    el('a', { href: value.export.route, download: '' }, 'Retry export'));
}
$('recovery-open').addEventListener('click', () => {
  recoveryReturn = document.activeElement; voice.cancel(); $('recovery-dialog').showModal(); $('recovery-close').focus(); void loadRecovery();
});
$('recovery-close').addEventListener('click', closeRecovery);
$('recovery-dialog').addEventListener('cancel', event => { event.preventDefault(); closeRecovery(); });
$('recovery-refresh').addEventListener('click', loadRecovery);
$('recovery-retry').addEventListener('click', async () => {
  if (!recoveryContext || busy) return; const epoch = recoveryEpoch;
  const result = await api('recovery-retry', recoveryContext);
  if (epoch !== recoveryEpoch) return;
  if (result) await loadRecovery(); else $('recovery-status').textContent = $('notice').textContent;
});
$('recovery-copy').addEventListener('click', async () => {
  if (!recoverySelection || !recoveryContext || busy || !switchAllowed()) return;
  const epoch = recoveryEpoch, input = { ...recoveryContext, candidate: recoverySelection };
  $('workspace').inert = true;
  try {
    await draftClient.flush(); if (epoch !== recoveryEpoch) return;
    if (await api('recover-copy', input)) { closeRecovery(); $('map').focus({ preventScroll: true }); } else $('recovery-status').textContent = $('notice').textContent;
  } catch { $('recovery-status').textContent = 'Drafts could not be preserved. Retry saving the draft before opening a recovery copy.'; }
  finally { $('workspace').inert = false; }
});

function historyJourney() { return state.activeKey ?? state.document?.id; }
function closeHistory(force = false) {
  if (!force && branchRestoreFlight?.kind === 'commit') return;
  historyEpoch++; historySelection = null; resetBranchRestore(true); $('history-dialog').close();
  if (historyReturn?.isConnected) historyReturn.focus({ preventScroll: true });
}
async function historyRead(snapshotRevision, epoch, journey) {
  const query = new URLSearchParams({ journey });
  if (snapshotRevision !== undefined) query.set('snapshotRevision', snapshotRevision);
  const response = await fetch(`api/history?${query}`), result = await response.json();
  if (closed || epoch !== historyEpoch || journey !== historyJourney() || !$('history-dialog').open) return null;
  if (!response.ok) throw new Error(result.error);
  return result;
}
async function previewHistory(revision) {
  if (busy || branchRestoreFlight?.kind === 'commit') return;
  resetBranchRestore(true);
  const epoch = ++historyEpoch, journey = historyJourney(); historySelection = null;
  $('history-restore').disabled = true; $('history-preview').replaceChildren(); $('history-status').textContent = 'Loading saved version...';
  try {
    const result = await historyRead(revision, epoch, journey); if (!result) return;
    historyRevision = result.revision; historySelection = result.preview.matchesCurrent ? null : revision;
    const preview = result.preview;
    const content = el('textarea', { readonly: '', rows: '8', 'aria-label': 'Saved snapshot content' }); content.value = JSON.stringify(result.document, null, 2);
    $('history-preview').replaceChildren(el('h3', {}, `Restore revision ${revision}`), el('p', {}, `${result.label} | ${new Date(result.time).toLocaleString()}`),
      el('p', {}, `Compared with current revision ${result.revision} (${result.current.label}): ${preview.changed} changed, ${preview.added} restored and ${preview.removed} removed nodes. ${preview.guidanceChanged ? 'Guidance will change.' : 'Guidance is unchanged.'} ${preview.dependenciesChanged ? 'Confirmed decision dependencies will change.' : 'Confirmed decision dependencies are unchanged.'} Answers, answer states and research will come from this version. Local drafts will be preserved for review.`),
      el('details', {}, el('summary', {}, 'Inspect saved content'), content));
    $('history-status').textContent = result.pending ? 'Cancel the current Copilot request before restoring.' : result.preview.matchesCurrent ? 'This version already matches the saved journey. No restore is needed.' : 'Review the preview, then explicitly restore this version.';
    $('history-restore').disabled = historySelection === null || result.pending;
    historyBranchRevision = revision;
    $('history-branch-select').replaceChildren(el('option', { value: '' }, 'Choose a historical branch'));
    for (const node of result.document.nodes) if (node.id !== result.document.rootId) $('history-branch-select').append(el('option', { value: node.id }, `${node.question.slice(0, 100)} [${node.id}]`));
    $('history-branch').hidden = false; syncBranchRestore();
  } catch (error) { if (epoch === historyEpoch) $('history-status').textContent = error.message; }
}
async function loadHistory(undo = false) {
  if (busy || branchRestoreFlight?.kind === 'commit') return;
  resetBranchRestore(true);
  const epoch = ++historyEpoch, journey = historyJourney(); historySelection = null;
  $('history-list').replaceChildren(); $('history-preview').replaceChildren(); $('history-restore').disabled = true;
  $('checkpoint-save').disabled = true; $('history-status').textContent = 'Loading history...';
  try {
    const result = await historyRead(undefined, epoch, journey); if (!result) return;
    historyRevision = result.revision; $('checkpoint-save').disabled = result.pending;
    $('history-status').textContent = result.entries.length ? `Current revision ${result.revision} | ${result.current.label} | ${new Date(result.current.time).toLocaleString()}. Select a saved version to preview.` : 'No earlier committed versions yet. The first change preserves the current saved version.';
    $('history-retention').textContent = `Up to 50 snapshots / 128 MiB and 10 named checkpoints. Oldest available: ${result.oldestRevision === null ? 'none yet' : `revision ${result.oldestRevision}`}. Unnamed older versions are pruned first.`;
    for (const row of result.entries) $('history-list').append(el('article', { class: 'history-entry' },
      button(`Revision ${row.revision} | ${row.label} | ${new Date(row.time).toLocaleString()}${row.checkpoints.length ? ` | ${row.checkpoints.join(', ')}` : ''}`, () => previewHistory(row.revision), { 'data-history-revision': row.revision }),
      ...row.checkpoints.map(name => button(`Remove checkpoint "${name}"`, async () => {
        if (await api('remove-checkpoint', { journey, revision: historyRevision, snapshotRevision: row.revision, name })) await loadHistory();
        else $('history-status').textContent = $('notice').textContent;
      }))));
    if (undo && result.undoRevision !== null) await previewHistory(result.undoRevision);
    else if (undo) $('history-status').textContent = 'There is no retained committed change to undo.';
  } catch (error) { if (epoch === historyEpoch) $('history-status').textContent = error.message; }
}
function openHistory(undo) {
  if (busy || !state.document) return;
  historyReturn = undo ? $('undo-change') : $('history-open'); voice.cancel();
  $('history-dialog').showModal(); $('history-close').focus(); void loadHistory(undo);
}
$('history-open').addEventListener('click', () => openHistory(false));
$('undo-change').addEventListener('click', () => openHistory(true));
$('history-close').addEventListener('click', () => closeHistory());
$('history-dialog').addEventListener('cancel', event => { event.preventDefault(); closeHistory(); });
$('history-refresh').addEventListener('click', async () => { if (await api('refresh-answer')) await loadHistory(); else $('history-status').textContent = $('notice').textContent; });
$('checkpoint-form').addEventListener('submit', async event => {
  event.preventDefault(); const epoch = historyEpoch, journey = historyJourney();
  if (await api('checkpoint', { journey, revision: historyRevision, snapshotRevision: historyRevision, name: $('checkpoint-name').value })) {
    if (epoch === historyEpoch && journey === historyJourney()) { $('checkpoint-name').value = ''; await loadHistory(); }
  } else if (epoch === historyEpoch && journey === historyJourney()) $('history-status').textContent = $('notice').textContent;
});
$('history-restore').addEventListener('click', async () => {
  if (historySelection === null || busy || branchRestoreCapture) return;
  if (!switchAllowed()) {
    $('history-status').textContent = $('notice').textContent;
    if (orphanReminderDrafts().length) $('history-status').append(button('Review removed reminders', revealOrphanReminders, { id: 'review-orphan-reminders-history' }));
    return;
  }
  const epoch = historyEpoch, journey = historyJourney(), revision = historyRevision, snapshotRevision = historySelection;
  voice.cancel(); $('history-restore').disabled = true; $('workspace').inert = true;
  try {
    await draftClient.flush();
    if (epoch !== historyEpoch || journey !== historyJourney()) return;
    if (await api('restore', { journey, revision, snapshotRevision })) closeHistory();
    else $('history-status').textContent = $('notice').textContent;
  } catch (error) { $('history-status').textContent = `Drafts could not be preserved. ${error.message}`; }
  finally { $('workspace').inert = false; if (epoch === historyEpoch) $('history-restore').disabled = false; }
});

const branchDraftStamp = () => JSON.stringify([...draftClient.entries].map(([id, entry]) => [id, entry.textGeneration]));
const branchRestoreCurrent = () => {
  const c = branchRestoreCapture;
  return c && !closed && !suspended && $('history-dialog').open && c.epoch === branchRestoreEpoch && c.history === historyEpoch && c.page === pageEpoch &&
    c.journey === historyJourney() && c.nodeId === $('history-branch-select').value && c.document === JSON.stringify(state.document) && c.drafts === branchDraftStamp() && !state.pending && !state.preview;
};
async function branchRestoreRequest(input, abort = new AbortController()) {
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch('api/branch-restore', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const value = await response.json(); if (!response.ok) throw Error(value.error); return value;
  } finally { clearTimeout(timer); }
}
function resetBranchRestore(hide = false) {
  const token = branchRestoreView?.token;
  branchRestoreEpoch++; branchRestoreFlight?.abort?.abort(); branchRestoreFlight = null; branchRestoreView = null; branchRestoreCapture = null;
  if (token) void branchRestoreRequest({ action: 'discard', token }).catch(() => {});
  $('history-branch-review').hidden = true; $('history-branch-confirm').disabled = true; $('history-branch-status').textContent = '';
  $('history-restore').disabled = historySelection === null || !!state.pending || !!state.preview;
  $('history-close').disabled = false; $('history-refresh').disabled = false; $('workspace').inert = false;
  if (hide) { historyBranchRevision = null; $('history-branch').hidden = true; }
  syncBranchRestore();
}
function syncBranchRestore() {
  const current = branchRestoreCurrent(), commit = branchRestoreFlight?.kind === 'commit';
  $('history-branch-select').disabled = !!branchRestoreFlight;
  $('history-branch-preview').disabled = !!branchRestoreFlight || busy || !historyBranchRevision && historyBranchRevision !== 0 || !$('history-branch-select').value || !!state.pending || !!state.preview;
  $('history-branch-confirm').disabled = !!branchRestoreFlight || !current || !branchRestoreView?.canRestore;
  $('history-branch-items').disabled = !!branchRestoreFlight || !current || !branchRestoreView;
  $('history-branch-prev').disabled = !!branchRestoreFlight || !current || !branchRestoreView || branchRestoreView.page === 0;
  $('history-branch-next').disabled = !!branchRestoreFlight || !current || !branchRestoreView || (branchRestoreView.page + 1) * 50 >= branchRestoreView.total;
  $('history-close').disabled = commit; $('history-refresh').disabled = commit;
  if (branchRestoreCapture) $('history-restore').disabled = true;
  if (branchRestoreCapture && !current && !commit) $('history-branch-status').textContent = 'Saved sources or drafts changed. Refresh history and preview again; private drafts are retained.';
}
function renderBranchRestore(value) {
  branchRestoreView = value; $('history-branch-review').hidden = false;
  $('history-branch-status').textContent = `${value.added} restored, ${value.removed} removed, ${value.reviewed} needing review; ${value.removedReferences} removed private reference(s). ${value.research} restored research result(s) remain historical. ${value.conflicts ? `${value.conflicts} conflict(s) block restoration.` : value.changed ? 'Inspect every change, then explicitly restore this branch.' : 'This branch already matches; no restoration is needed.'}${value.artifacts.length ? ` ${value.artifacts.map(a => `${a.state} ${a.kind}`).join(', ')} will become stale.` : ''}`;
  $('history-branch-items').replaceChildren(...value.items.map(item => el('option', { value: item.index }, item.label)));
  if (value.selected) $('history-branch-items').value = String(value.selected.index);
  $('history-branch-detail').value = value.selected ? JSON.stringify(value.selected.data, null, 2) : '';
  $('history-branch-page').textContent = `${value.total ? value.page * 50 + 1 : 0}–${Math.min((value.page + 1) * 50, value.total)} of ${value.total}`;
  $('history-branch-prev').disabled = value.page === 0; $('history-branch-next').disabled = (value.page + 1) * 50 >= value.total;
  syncBranchRestore();
}
async function prepareBranchRestore() {
  if (busy || branchRestoreFlight || !$('history-branch-select').value) return;
  if (!switchAllowed()) { $('history-branch-status').textContent = $('notice').textContent; return; }
  resetBranchRestore();
  const capture = { epoch: branchRestoreEpoch, history: historyEpoch, page: pageEpoch, journey: historyJourney(), revision: historyRevision, snapshotRevision: historyBranchRevision,
    nodeId: $('history-branch-select').value, document: JSON.stringify(state.document), drafts: branchDraftStamp() };
  branchRestoreCapture = capture; const abort = new AbortController(); branchRestoreFlight = { kind: 'prepare', abort };
  $('history-branch-status').textContent = 'Preserving private drafts and preparing branch preview…'; syncBranchRestore(); voice.cancel();
  try {
    await draftClient.flush(); if (!branchRestoreCurrent()) throw Error('Sources or drafts changed. Refresh history and preview again.');
    const value = await branchRestoreRequest({ action: 'prepare', journey: capture.journey, revision: capture.revision, snapshotRevision: capture.snapshotRevision, nodeId: capture.nodeId }, abort);
    if (!branchRestoreCurrent()) return; renderBranchRestore(value);
  } catch (error) {
    if (capture.epoch === branchRestoreEpoch) { branchRestoreCapture = null; $('history-branch-status').textContent = `Drafts could not be preserved or preview could not complete. ${error.message}`; }
  } finally { if (capture.epoch === branchRestoreEpoch) { branchRestoreFlight = null; syncBranchRestore(); } }
}
async function pageBranchRestore(page, selected = null) {
  if (!branchRestoreCurrent() || branchRestoreFlight || !branchRestoreView) return;
  const epoch = branchRestoreEpoch, abort = new AbortController(); branchRestoreFlight = { kind: 'page', abort }; syncBranchRestore();
  try { const value = await branchRestoreRequest({ action: 'page', token: branchRestoreView.token, page, selected }, abort); if (branchRestoreCurrent()) renderBranchRestore(value); }
  catch (error) { if (epoch === branchRestoreEpoch) { branchRestoreView.canRestore = false; $('history-branch-status').textContent = error.message; } }
  finally { if (epoch === branchRestoreEpoch) { branchRestoreFlight = null; syncBranchRestore(); } }
}
$('history-branch-select').addEventListener('change', () => resetBranchRestore());
$('history-branch-preview').addEventListener('click', () => void prepareBranchRestore());
$('history-branch-cancel').addEventListener('click', () => { if (branchRestoreFlight?.kind !== 'commit') { resetBranchRestore(); $('history-restore').disabled = historySelection === null || !!state.pending; } });
$('history-branch-prev').addEventListener('click', () => { if (branchRestoreView) void pageBranchRestore(branchRestoreView.page - 1); });
$('history-branch-next').addEventListener('click', () => { if (branchRestoreView) void pageBranchRestore(branchRestoreView.page + 1); });
$('history-branch-items').addEventListener('change', () => { if (branchRestoreView) void pageBranchRestore(branchRestoreView.page, Number($('history-branch-items').value)); });
$('history-branch-confirm').addEventListener('click', async () => {
  if (!branchRestoreCurrent() || branchRestoreFlight || busy || !branchRestoreView?.canRestore) return;
  if (!switchAllowed()) { $('history-branch-status').textContent = $('notice').textContent; return; }
  const epoch = branchRestoreEpoch, capture = branchRestoreCapture, token = branchRestoreView.token; branchRestoreFlight = { kind: 'commit' }; voice.cancel(); syncBranchRestore(); $('workspace').inert = true;
  try {
    await draftClient.flush(); if (!branchRestoreCurrent()) throw Error('Sources or drafts changed. Preview again.');
    if (await api('restore-branch', { journey: capture.journey, revision: capture.revision, token, confirm: true })) { if (epoch === branchRestoreEpoch) closeHistory(true); }
    else if (epoch === branchRestoreEpoch) { branchRestoreView.canRestore = false; $('history-branch-status').textContent = $('notice').textContent; }
  } catch (error) { if (epoch === branchRestoreEpoch) { branchRestoreView.canRestore = false; $('history-branch-status').textContent = `Drafts could not be preserved. ${error.message}`; } }
  finally { if (epoch === branchRestoreEpoch) { branchRestoreFlight = null; $('workspace').inert = false; syncBranchRestore(); } }
});

function dirtyNodes() { return state.document?.nodes.filter(n => drafts.has(n.id) || draftClient.entries.get(n.id)?.conflict) ?? []; }
$('start-form').addEventListener('submit', async event => { event.preventDefault(); await switchJourney('start', { topic: $('topic').value, objective: $('start-objective').value, successCriteria: $('start-criteria').value, mode: $('start-mode').value, storageScope: $('start-storage').value, projectFolder: $('project-folder').value }); });
$('start-storage').addEventListener('change', () => { $('project-folder-fields').hidden = $('start-storage').value !== 'project'; });
$('project-open').addEventListener('click', () => { voice.cancel(); libraryView = true; $('library-scope').value = 'project'; showView(); void refreshLibrary(); $('project-open-path').focus(); });
$('project-open-form').addEventListener('submit', async event => { event.preventDefault(); await switchJourney('open-project', { path: $('project-open-path').value }); });
$('start-mode').addEventListener('change', () => showModeDescription('start-mode'));
$('edit-mode').addEventListener('change', () => showModeDescription('edit-mode'));
let lastCoverage = '';
function showCoverage(value, label) {
  $('context-coverage').textContent = `${label} ${value.kind} context: ${value.bytes.toLocaleString()} / ${value.limit.toLocaleString()} UTF-8 bytes. Included ${value.included.pins} user constraints, ${value.included.path} path records and ${value.included.decisionsElsewhere} additional decisions and ${value.included.generationContext ?? 0} generation cues. Omitted ${value.omitted.path} ancestors and ${value.omitted.decisionsElsewhere} additional decisions and ${value.omitted.generationContext ?? 0} generation cues (${value.omitted.budget} for size; ${value.omitted.scope} by scope). No text was truncated.`;
}
$('context-scope').addEventListener('change', () => { $('context-coverage').textContent = 'Scope changed for the next request. Check context or continue your current action; no inference has started.'; });
for (const kind of ['questions', 'research']) $(`check-${kind === 'questions' ? 'question' : kind}-context`).addEventListener('click', async () => {
  if (!state.document || !selected) return;
  const result = await api('context-coverage', { kind, nodeId: selected });
  if (result) showCoverage(result.contextCoverage, 'Preview of saved');
});
function readPins() { return [...$('constraint-list').children].map(row => ({ id: row.dataset.pinId, text: row.querySelector('textarea').value === row.originalPinText.replace(/\r\n?/g, '\n') ? row.originalPinText : row.querySelector('textarea').value })); }
function addPinRow(pin) {
  const row = el('div', { 'data-pin-id': pin.id }); row.originalPinText = pin.text;
  const input = el('textarea', { id: `constraint-${pin.id}`, maxlength: '1000', rows: '2', required: '' }); input.value = pin.text;
  row.append(el('label', { for: input.id }, 'Constraint (user supplied)'), input, button('Remove constraint', () => { row.remove(); $('add-constraint').disabled = false; $('add-constraint').focus(); }));
  $('constraint-list').append(row); $('add-constraint').disabled = $('constraint-list').children.length >= 10;
  return input;
}
function renderPins(pins) { $('constraint-list').replaceChildren(); $('add-constraint').disabled = false; for (const pin of pins) addPinRow(pin); }
$('add-constraint').addEventListener('click', () => { if ($('constraint-list').children.length < 10) addPinRow({ id: crypto.randomUUID(), text: '' }).focus(); });
function closeGuidance() {
  $('guidance-dialog').close(); $('guidance-error').hidden = true; $('guidance-error').textContent = '';
  if (guidanceReturn?.nodeId === selected && $('answer')) {
    $('answer').setSelectionRange(guidanceReturn.start, guidanceReturn.end, guidanceReturn.direction);
  }
  $('edit-guidance').focus({ preventScroll: true });
  guidanceReturn = null; guidanceBase = null; guidanceNeedsChoice = false; guidanceNeedsRefresh = false;
}
$('edit-guidance').addEventListener('click', () => {
  if (!state.document || state.pending) return notice('Wait for Copilot or cancel the current request before editing guidance.');
  const answer = expanded && $('answer');
  guidanceReturn = answer ? { nodeId: selected, start: answer.selectionStart, end: answer.selectionEnd, direction: answer.selectionDirection } : null;
  guidanceBase = { objective: state.document.objective ?? '', successCriteria: state.document.successCriteria ?? '', mode: effectiveMode(state.document), pins: (state.document.pins ?? []).map(pin => ({ ...pin })) };
  guidanceNeedsChoice = false; guidanceNeedsRefresh = false;
  renderPins(state.document.pins ?? []);
  $('edit-objective').value = state.document.objective ?? '';
  $('edit-criteria').value = state.document.successCriteria ?? '';
  $('edit-mode').value = effectiveMode(state.document);
  showModeDescription('edit-mode');
  $('guidance-error').hidden = true; $('guidance-error').textContent = '';
  $('refresh-guidance').hidden = true; $('guidance-conflict').hidden = true; $('save-guidance').disabled = false;
  $('guidance-dialog').showModal(); $('edit-objective').focus();
});
$('cancel-guidance').addEventListener('click', closeGuidance);
$('guidance-dialog').addEventListener('cancel', event => { event.preventDefault(); closeGuidance(); });
$('refresh-guidance').addEventListener('click', async () => {
  if (busy || !guidanceNeedsRefresh) return;
  const result = await api('refresh-guidance');
  if (!result) { $('guidance-error').textContent = $('notice').textContent || 'Could not refresh the saved journey.'; $('guidance-error').hidden = false; return; }
  const latest = { objective: result.document.objective, successCriteria: result.document.successCriteria, mode: effectiveMode(result.document), pins: (result.document.pins ?? []).map(pin => ({ ...pin })) };
  guidanceNeedsChoice = latest.objective !== guidanceBase.objective || latest.successCriteria !== guidanceBase.successCriteria || latest.mode !== guidanceBase.mode || JSON.stringify(latest.pins) !== JSON.stringify(guidanceBase.pins);
  guidanceBase = latest; guidanceNeedsRefresh = false; $('refresh-guidance').hidden = true;
  $('guidance-conflict').hidden = !guidanceNeedsChoice;
  $('save-guidance').disabled = guidanceNeedsChoice;
  $('guidance-latest').textContent = `Saved mode: ${MODES[latest.mode].label}\nSaved objective: ${latest.objective || '(empty)'}\nSaved success criteria: ${latest.successCriteria || '(empty)'}\nSaved constraints: ${latest.pins.map(pin => pin.text).join(' / ') || '(none)'}`;
  $('guidance-error').textContent = guidanceNeedsChoice ? 'The saved guidance changed. Choose a version below.' : 'Saved journey refreshed. Review and save your guidance.';
  $('guidance-error').hidden = false;
});
function chooseGuidance(choice) {
  if (!guidanceNeedsChoice) return;
  if (choice === 'latest') { renderPins(guidanceBase.pins); $('edit-objective').value = guidanceBase.objective; $('edit-criteria').value = guidanceBase.successCriteria; $('edit-mode').value = guidanceBase.mode; showModeDescription('edit-mode'); }
  guidanceNeedsChoice = false; $('guidance-conflict').hidden = true; $('save-guidance').disabled = false;
  $('guidance-error').hidden = true; $('guidance-error').textContent = '';
  $('edit-objective').focus();
}
$('use-latest-guidance').addEventListener('click', () => chooseGuidance('latest'));
$('keep-guidance-edits').addEventListener('click', () => chooseGuidance('local'));
$('guidance-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || guidanceNeedsChoice || guidanceNeedsRefresh) return;
  $('save-guidance').disabled = true;
  try {
    const modeChanged = $('edit-mode').value !== effectiveMode(state.document);
    const hadHelp = questionHelp.work?.status === 'pending' || questionHelp.results.size > 0;
    const result = await api('guidance', { objective: $('edit-objective').value, successCriteria: $('edit-criteria').value, mode: $('edit-mode').value, pins: readPins() });
    if (!result) {
      const message = $('notice').textContent || 'Could not save guidance. Try again.';
      guidanceNeedsRefresh = /Another canvas|map changed/.test(message);
      $('refresh-guidance').hidden = !guidanceNeedsRefresh;
      $('guidance-error').textContent = message; $('guidance-error').hidden = false;
      return;
    }
    closeGuidance();
    if (modeChanged && hadHelp) notice('Exploration mode saved. Question help from the earlier mode was cleared. Choose a help action to try again.');
  } finally { $('save-guidance').disabled = guidanceNeedsChoice || guidanceNeedsRefresh; }
});
$('library-toggle').addEventListener('click', () => { voice.cancel(); libraryView = true; showView(); void refreshLibrary(); $($('library-scope').value === 'project' ? 'project-library-folder' : 'library-search').focus(); });
$('library-scope').addEventListener('change', () => { void refreshLibrary(); });
$('project-library-refresh').addEventListener('click', () => { void refreshProjectLibrary(); });
$('project-library-folder').addEventListener('input', () => clearProjectListing('Folder changed. Refresh to inspect it.'));
$('library-return').addEventListener('click', () => { libraryEpoch++; clearProjectListing(); libraryView = false; showView(); refreshScene(); $('map').focus({ preventScroll: true }); });
$('library-search').addEventListener('input', scheduleLibrarySearch);
$('library-search-scope').addEventListener('change', () => { libraryEpoch++; void refreshLibrary(); });
$('library-search-next').addEventListener('click', () => { if (librarySearchNext) void refreshLibrarySearch(librarySearchNext); });
$('library-reminder').addEventListener('change', refreshLibrary);
$('library-archived').addEventListener('change', refreshLibrary);
$('library-refresh').addEventListener('click', refreshLibrary);
$('library-new').addEventListener('click', () => $('topic').focus());
$('import-copy').addEventListener('click', async () => { if (importDocument && await switchJourney('import', { document: importDocument, asCopy: true })) { importDocument = null; $('import-conflict').close(); } });
$('import-cancel').addEventListener('click', () => { importDocument = null; $('import-conflict').close(); });
$('import-conflict').addEventListener('cancel', () => { importDocument = null; });
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; $('file').value = '';
  if (!file) return;
  if (!switchAllowed()) return;
  if (file.size > 10 * 1024 * 1024) return notice('The file exceeds the 10 MiB POC limit.');
  if (!state.library && state.document && !confirm('Replace the map in this preview? Download Save file first to keep it.')) return;
  try { const document = JSON.parse(await file.text()); await switchJourney('import', { document }); }
  catch (error) { notice(`Could not open that file: ${error.message}`); }
});
let adrQuestionsEpoch = 0, adrQuestionsStarting = false;
const adrQuestionReview = new ResearchReviewClient({ fetch: (...args) => fetch(...args), changed: renderAdrQuestions });
function renderAdrQuestions() {
  const value = adrQuestionReview.value, context = value?.prepared.context;
  $('adr-questions-start').disabled = adrQuestionsStarting || busy || !!state.pending || !!state.preview || adrQuestionReview.loading || !value || Date.now() >= value.expiresAt;
  $('adr-questions-refresh').disabled = adrQuestionsStarting || adrQuestionReview.loading || !!state.pending || !!state.preview;
  $('adr-questions-preview').hidden = !value;
  const texts = {
    'adr-questions-status': adrQuestionsStarting ? 'Processing request…' : adrQuestionReview.error || (adrQuestionReview.loading ? 'Preparing exact saved ADR input…' : value ? `${value.prepared.coverage.included} selected records; ${value.prepared.coverage.omitted} omitted. ${value.prepared.bytes}/${value.prepared.limit} UTF-8 bytes. Review before generating optional questions.` : 'Refresh saved context to prepare a new review.'),
    'adr-questions-summary': context ? `Focal question: ${context.records.find(node => node.id === context.focalId)?.question}. Template sections: ${context.format.sections.map(section => section.label).join(', ')}. The AI will check drivers, options, rejection reasons, outcome reasons, consequences and revisit conditions.` : '',
    'adr-questions-input': value ? `${value.prepared.instructions}\n\n${value.prepared.prompt}` : '',
  };
  for (const [id, value] of Object.entries(texts)) if ($(id).textContent !== value) $(id).textContent = value;
}
function invalidateAdrQuestions(message) { adrQuestionReview.close(); adrQuestionReview.error = message; renderAdrQuestions(); }
function closeAdrQuestions(focus = false) {
  adrQuestionsEpoch++; adrQuestionsStarting = false; adrQuestionReview.close();
  if ($('adr-questions-dialog').open) $('adr-questions-dialog').close();
  if (focus) $('adr-questions-open').focus();
}
function prepareAdrQuestionsReview() {
  adrQuestionReview.open({ purpose: 'adr-questions', journey: state.activeKey ?? state.document.id, nodeId: state.document.rootId });
}
function openAdrQuestions() {
  if (!state.document || suspended || !switchAllowed('reviewing ADR questions')) return;
  voice.cancel(); closeAdrQuestions(); $('adr-questions-dialog').showModal(); prepareAdrQuestionsReview(); $('adr-questions-close').focus();
}
$('adr-questions-open').addEventListener('click', openAdrQuestions);
$('adr-questions-close').addEventListener('click', () => closeAdrQuestions(true));
$('adr-questions-dialog').addEventListener('cancel', event => { event.preventDefault(); closeAdrQuestions(true); });
$('adr-questions-dialog').addEventListener('close', () => { if (adrQuestionReview.context) closeAdrQuestions(); });
$('adr-questions-refresh').addEventListener('click', async () => {
  if (adrQuestionsStarting || adrQuestionReview.loading || !$('adr-questions-dialog').open) return;
  const epoch = adrQuestionsEpoch; adrQuestionsStarting = true; renderAdrQuestions();
  const result = await api('refresh-answer');
  if (epoch !== adrQuestionsEpoch) return;
  adrQuestionsStarting = false;
  if (result) prepareAdrQuestionsReview(); else invalidateAdrQuestions($('notice').textContent || 'Refresh saved context before reviewing again.');
});
$('adr-questions-start').addEventListener('click', async () => {
  const value = adrQuestionReview.value, epoch = adrQuestionsEpoch, sequence = adrQuestionReview.sequence;
  if (!value || adrQuestionsStarting || adrQuestionReview.loading || busy || closed || suspended || state.pending || state.preview || !$('adr-questions-dialog').open) return;
  if (Date.now() >= value.expiresAt) return invalidateAdrQuestions('This review expired. Refresh and review before generating.');
  adrQuestionsStarting = true; renderAdrQuestions();
  const result = await api('adr-questions', { journey: value.journey, nodeId: value.nodeId, token: value.token });
  if (epoch !== adrQuestionsEpoch) return;
  adrQuestionsStarting = false;
  if (sequence !== adrQuestionReview.sequence) return renderAdrQuestions();
  if (result) { closeAdrQuestions(); $('cancel-request')?.focus({ preventScroll: true }); }
  else invalidateAdrQuestions($('notice').textContent || 'Refresh and review before generating again.');
});

let adrFile = null;
const adrFileCurrent = f => !!f && adrFile === f && !closed && !suspended && f.page === pageEpoch && f.journey === (state.activeKey ?? state.document?.id) && $('adr-file-dialog').open;
const adrFileWrites = action => ['save', 'reconcile', 'discard-operation'].includes(action);
function adrFileControls() {
  const f = adrFile, locked = !adrFileCurrent(f) || !!f.flight || busy;
  for (const name of ['selection', 'number', 'review', 'refresh']) $(`adr-file-${name}`).disabled = locked;
  $('adr-file-number').disabled = locked || $('adr-file-selection').value !== 'new' || f?.format?.naming === 'slug';
  $('adr-file-save').disabled = locked || !f.value || Date.now() >= f.value.expiresAt;
  $('adr-file-retry').hidden = !f?.recovery?.canReconcile; $('adr-file-retry').disabled = locked;
  $('adr-file-discard').hidden = !f?.recovery?.canDiscard; $('adr-file-discard').disabled = locked;
}
function invalidateAdrFile(message = 'Destination changed. Preview the current Markdown and path again.') {
  const f = adrFile;
  if (f) {
    f.epoch++; f.value = null; clearTimeout(f.expiry);
    if (!adrFileWrites(f.action)) { f.flight?.abort(); f.flight = null; f.action = null; }
    void fetch('api/adr-file', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'cancel', journey: f.journey, clientId: f.clientId, sequence: ++f.sequence }) }).catch(() => {});
  }
  $('adr-file-preview').hidden = true; $('adr-file-status').textContent = message; adrFileControls();
}
function closeAdrFile(focus = false) {
  invalidateAdrFile('Reopen to inspect saved status and review again.'); adrFile = null;
  if ($('adr-file-dialog').open) $('adr-file-dialog').close(); adrFileControls();
  if (focus) $('adr-file-open').focus();
}
function renderAdrFileStatus(result) {
  const f = adrFile; f.format = result.format; f.recovery = result.recovery; f.revision = result.revision;
  const selection = $('adr-file-selection'), selected = selection.value;
  selection.replaceChildren(new Option('New ADR file', 'new'));
  for (const record of result.entries) selection.append(new Option(`Update proposed: ${record.path}`, record.id));
  if ([...selection.options].some(option => option.value === selected)) selection.value = selected;
  const recovery = result.recovery, part = value => value === true ? 'saved' : value === false ? 'not saved' : 'unknown';
  $('adr-file-status').textContent = [result.error, recovery ? `ADR file: ${part(recovery.fileSaved)}. Exploration association: ${part(recovery.associationSaved)}. ${recovery.message}` : result.hasDraft ? 'Saved proposed wording is available. Preview the exact Markdown and destination before saving.' : 'Accept proposed ADR wording into the exploration first.'].filter(Boolean).join(' ');
  $('adr-file-recovery').hidden = !recovery?.content;
  $('adr-file-recovery-path').textContent = recovery?.path ?? ''; $('adr-file-recovery-content').textContent = recovery?.content ?? '';
}
async function requestAdrFile(action) {
  const f = adrFile; if (!adrFileCurrent(f) || f.flight || busy) return;
  const writes = adrFileWrites(action), review = f.value;
  if (action === 'save' && (!review || Date.now() >= review.expiresAt)) return invalidateAdrFile('Preview expired. Review again before saving.');
  if (action === 'reconcile' && !f.recovery?.canReconcile || action === 'discard-operation' && !f.recovery?.canDiscard) return;
  const sequence = ++f.sequence, generation = ++f.epoch, abort = new AbortController(); f.flight = abort; f.action = action;
  const input = { action, journey: f.journey, ...(action === 'prepare' ? { clientId: f.clientId, sequence, selection: $('adr-file-selection').value === 'new' ? { kind: 'new', number: f.format?.naming === 'slug' ? null : Number($('adr-file-number').value) } : { kind: 'update', id: $('adr-file-selection').value } } : action === 'save' ? { token: review.token, revision: f.revision } : writes ? { operationId: f.recovery.id, revision: f.revision } : {}) };
  if (writes) { busy = true; actionEpoch++; stateCursor = null; pollFlight?.abort.abort(); }
  const mapEpoch = actionEpoch, timer = setTimeout(() => abort.abort(), 10000);
  f.value = null; clearTimeout(f.expiry); $('adr-file-preview').hidden = true; adrFileControls();
  $('adr-file-status').textContent = writes ? 'Saving or recovering the confirmed ADR operation…' : action === 'prepare' ? 'Checking current sources and reading the exact destination…' : 'Checking saved wording and any confirmed operation…';
  try {
    const response = await fetch('api/adr-file', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!adrFileCurrent(f) || !writes && generation !== f.epoch || writes && mapEpoch !== actionEpoch) return;
    if (!response.ok) throw Error(result.error);
    if (result.journey !== f.journey || action === 'prepare' && (result.clientId !== f.clientId || result.sequence !== sequence)) throw Error('ADR file response changed. Refresh and review again.');
    if (action === 'prepare') {
      f.value = result; $('adr-file-preview').hidden = false; $('adr-file-path').textContent = result.path; $('adr-file-content').textContent = result.content;
      $('adr-file-old').textContent = result.oldContent ?? ''; $('adr-file-before').hidden = result.oldContent === null; $('adr-file-notes').textContent = result.message;
      const report = result.readiness; $('adr-file-readiness').textContent = `${report.blockers} correctness blockers. ${report.items.filter(item => item.severity === 'advisory').length} advisory gaps. ${report.items.map(item => item.reason).join(' ')}`;
      $('adr-file-status').textContent = 'Read the complete proposed Markdown and path. Save ADR confirms exactly this file.';
      f.expiry = setTimeout(() => { if (adrFileCurrent(f) && f.value === result) invalidateAdrFile('Preview expired. Review again.'); }, Math.max(0, result.expiresAt - Date.now()));
    } else {
      if (writes) { busy = false; await api('refresh-answer'); if (!adrFileCurrent(f)) return; }
      renderAdrFileStatus(result);
    }
  } catch (error) {
    if (adrFileCurrent(f) && (writes || generation === f.epoch)) $('adr-file-status').textContent = `${abort.signal.aborted ? 'Request timed out.' : error.message} ${writes ? 'Refresh status to check which parts saved before retrying.' : 'Review again after correcting the problem.'}`;
  } finally {
    clearTimeout(timer); if (writes && mapEpoch === actionEpoch) busy = false;
    if (adrFileCurrent(f) && f.flight === abort) { f.flight = null; f.action = null; adrFileControls(); }
  }
}
$('adr-file-open').addEventListener('click', () => {
  if (!state.document || !switchAllowed('saving an ADR file')) return;
  closeAdrFile(); adrFile = { journey: state.activeKey ?? state.document.id, page: pageEpoch, clientId: crypto.randomUUID(), sequence: 0, epoch: 0, value: null, recovery: null, flight: null, revision: state.document.revision };
  $('adr-file-selection').replaceChildren(new Option('New ADR file', 'new')); $('adr-file-number').value = '1'; $('adr-file-recovery').hidden = true;
  $('adr-file-dialog').showModal(); void requestAdrFile('status');
});
$('adr-file-from-draft').addEventListener('click', () => { if (!adrDraftSavePending && !briefBusy) { hideBrief(); $('adr-file-open').click(); } });
for (const name of ['selection', 'number']) for (const event of ['input', 'change']) $(`adr-file-${name}`).addEventListener(event, () => { if (adrFileCurrent(adrFile) && !adrFile.flight) invalidateAdrFile(); });
for (const [name, action] of [['review', 'prepare'], ['save', 'save'], ['retry', 'reconcile'], ['discard', 'discard-operation']]) $(`adr-file-${name}`).addEventListener('click', () => void requestAdrFile(action));
$('adr-file-refresh').addEventListener('click', async () => { const f = adrFile; if (adrFileCurrent(f) && !f.flight && await api('refresh-answer') && adrFileCurrent(f)) { invalidateAdrFile(); await requestAdrFile('status'); } });
$('adr-file-close').addEventListener('click', () => closeAdrFile(true));
$('adr-file-dialog').addEventListener('cancel', event => { event.preventDefault(); closeAdrFile(true); });
$('adr-file-dialog').addEventListener('close', () => { if (adrFile) closeAdrFile(); });

let adrFormat = null;
const adrFormatCurrent = f => !!f && adrFormat === f && !closed && !suspended && f.page === pageEpoch && f.journey === (state.activeKey ?? state.document?.id) && $('adr-format-dialog').open;
function adrFormatControls() {
  const f = adrFormat, locked = !adrFormatCurrent(f) || !!f.flight;
  for (const id of ['directory', 'naming', 'digits', 'template', 'path', 'review', 'refresh']) $(`adr-format-${id}`).disabled = locked;
  $('adr-format-digits').disabled = locked || $('adr-format-naming').value === 'slug';
  $('adr-format-path-fields').hidden = $('adr-format-template').value !== 'repository';
  $('adr-format-save').disabled = locked || busy || !f.value || Date.now() >= f.value.expiresAt;
}
function cancelAdrFormat(f) {
  if (!f) return;
  f.sequence++; f.flight?.abort(); f.value = null;
  void fetch('api/adr-format', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'cancel', journey: f.journey, clientId: f.clientId, sequence: f.sequence }) }).catch(() => {});
}
function invalidateAdrFormat(message = 'Preferences changed. Review the format again before saving.') {
  cancelAdrFormat(adrFormat); $('adr-format-preview').hidden = true; $('adr-format-status').textContent = message; adrFormatControls();
}
function closeAdrFormat(focus = false) {
  const f = adrFormat; adrFormat = null; cancelAdrFormat(f);
  $('adr-format-preview').hidden = true;
  if ($('adr-format-dialog').open) $('adr-format-dialog').close();
  if (focus) $('adr-format-open').focus();
}
function loadAdrFormat(format) {
  $('adr-format-directory').value = format.directory; $('adr-format-naming').value = format.naming; $('adr-format-digits').value = format.digits;
  $('adr-format-template').value = format.template.kind; $('adr-format-path').value = format.template.path ?? '';
}
async function requestAdrFormat(action) {
  const f = adrFormat; if (!adrFormatCurrent(f) || f.flight || action === 'save' && busy) return;
  const writes = action === 'save', reviewed = f.value;
  if (writes && (!reviewed || Date.now() >= reviewed.expiresAt)) return invalidateAdrFormat('The format preview expired. Read and review again.');
  const abort = new AbortController(), sequence = ++f.sequence; f.flight = abort; f.action = action;
  if (writes) { busy = true; actionEpoch++; stateCursor = null; pollFlight?.abort.abort(); }
  const epoch = actionEpoch, timer = setTimeout(() => abort.abort(), 10000);
  const input = { action, journey: f.journey, ...(writes ? { token: reviewed.token, revision: state.document.revision } : action === 'prepare' ? { clientId: f.clientId, sequence, selection: {
    directory: $('adr-format-directory').value, naming: $('adr-format-naming').value, digits: Number($('adr-format-digits').value), templatePath: $('adr-format-template').value === 'repository' ? $('adr-format-path').value : '',
  } } : {}) };
  f.value = null; $('adr-format-preview').hidden = true; adrFormatControls();
  $('adr-format-status').textContent = writes ? 'Saving reviewed preferences…' : action === 'prepare' ? 'Reading and reviewing the selected format…' : 'Loading saved preferences; no template file is read…';
  try {
    const response = await fetch('api/adr-format', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!adrFormatCurrent(f) || sequence !== f.sequence || writes && epoch !== actionEpoch) return;
    if (!response.ok) throw Error(result.error);
    if (result.journey !== f.journey || action === 'prepare' && (result.clientId !== f.clientId || result.sequence !== sequence)) throw Error('ADR format response changed. Review again.');
    if (writes) { apply(result.snapshot); $('adr-format-status').textContent = 'Preferences saved. No ADR file was written. A new review is required before replacing these preferences.'; }
    else if (action === 'status') { loadAdrFormat(result.format); $('adr-format-status').textContent = `${result.saved ? 'Saved preferences' : 'Bundled defaults'}. ${result.templateState === 'not-checked' ? 'The saved template reference has not been read or checked in this session. Review explicitly to read it.' : 'No repository template selected.'}`; }
    else {
      f.value = result; $('adr-format-preview').hidden = false; $('adr-format-preview-notes').textContent = result.notes;
      $('adr-format-example').textContent = `Example path: ${result.pathExample}`;
      const template = result.format.template, layout = result.format.layout;
      $('adr-format-structure').textContent = `${template.kind === 'repository' ? `Selected: ${template.path}\nSHA-256: ${template.sha256}\n${result.templateBytes}/32768 bytes` : 'Bundled simple MADR format'}\nMetadata: ${layout.metadata.join(', ') || '(none)'}\n# Title\n${layout.sections.map(s => `${'#'.repeat(s.level)} ${s.label}`).join('\n')}`;
      $('adr-format-sample').textContent = result.sample; $('adr-format-status').textContent = 'Format reviewed. Check the structure and sample, then save these preferences if they fit.';
    }
  } catch (error) {
    if (adrFormatCurrent(f) && sequence === f.sequence) $('adr-format-status').textContent = abort.signal.aborted ? 'Request timed out. Reload saved preferences to check whether a save completed.' : error.message;
  } finally {
    clearTimeout(timer); if (writes && epoch === actionEpoch) busy = false;
    if (adrFormatCurrent(f) && f.flight === abort) { f.flight = null; f.action = null; adrFormatControls(); }
  }
}
$('adr-format-open').addEventListener('click', () => {
  if (!state.document || !switchAllowed('choosing ADR formatting')) return;
  closeAdrFormat(); adrFormat = { journey: state.activeKey ?? state.document.id, page: pageEpoch, clientId: crypto.randomUUID(), sequence: 0, value: null, flight: null, action: null };
  $('adr-format-dialog').showModal(); void requestAdrFormat('status');
});
for (const id of ['directory', 'naming', 'digits', 'template', 'path']) for (const event of ['input', 'change']) $(`adr-format-${id}`).addEventListener(event, () => { if (adrFormatCurrent(adrFormat) && !adrFormat.flight) invalidateAdrFormat(); });
$('adr-format-review').addEventListener('click', () => void requestAdrFormat('prepare'));
$('adr-format-save').addEventListener('click', () => void requestAdrFormat('save'));
$('adr-format-refresh').addEventListener('click', async () => { const f = adrFormat; if (adrFormatCurrent(f) && !f.flight && await api('refresh-answer') && adrFormatCurrent(f)) { invalidateAdrFormat(); await requestAdrFormat('status'); } });
$('adr-format-close').addEventListener('click', () => closeAdrFormat(true));
$('adr-format-dialog').addEventListener('cancel', event => { event.preventDefault(); closeAdrFormat(true); });
$('adr-format-dialog').addEventListener('close', () => { if (adrFormat) closeAdrFormat(); });

let adrEpoch = 0, adrJourney = null, adrBusy = false, adrAbort = null, adrSelected = new Set(), adrSaved = null, adrPreviewMessage = '';
const adrReview = new ResearchReviewClient({ fetch: (...args) => fetch(...args), changed: renderAdrPreview });
const adrCurrent = (epoch = adrEpoch) => epoch === adrEpoch && !closed && !suspended && $('adr-scope-dialog').open && adrJourney === (state.activeKey ?? state.document?.id);
function adrControls() {
  const focal = $('adr-scope-focal').value;
  for (const name of ['adr-scope-focal', 'adr-scope-evidence', 'adr-scope-refresh']) $(name).disabled = adrBusy;
  for (const name of ['adr-scope-ancestors', 'adr-scope-branch']) $(name).disabled = adrBusy || !focal;
  $('adr-scope-review').disabled = adrBusy || adrReview.loading || !focal || !adrSelected.size;
  $('adr-scope-save').disabled = adrBusy || !adrReview.value || Date.now() >= adrReview.value.expiresAt;
  for (const input of $('adr-scope-sources').querySelectorAll('input')) { input.checked = adrSelected.has(input.dataset.adrNode); input.disabled = adrBusy || input.dataset.adrNode === focal; }
  const missing = [...adrSelected].filter(id => !state.document?.nodes.some(node => node.id === id)).length;
  $('adr-scope-count').textContent = `${adrSelected.size}/100 records selected. The focal question is required. ${missing ? `${missing} unavailable saved sources: uncheck them or choose a new focal question before reviewing.` : 'Ancestors and other branches are included only when selected.'}`;
}
function renderAdrPreview() {
  const value = adrReview.value;
  $('adr-scope-preview').hidden = !value;
  $('adr-scope-preview-text').textContent = value ? `${value.prepared.instructions}\n\n${value.prepared.prompt}` : '';
  if (value) $('adr-scope-preview').open = true;
  $('adr-scope-preview-status').textContent = adrReview.error || (adrReview.loading ? 'Preparing exact saved input…' : value ? `${value.prepared.coverage.included} explicit records; ${value.prepared.coverage.omitted} omitted. All global guidance is included. ${value.prepared.bytes}/${value.prepared.limit} UTF-8 bytes. Saving records a scope reference only.` : adrPreviewMessage || 'Choose the context, then preview its exact saved input.');
  adrControls();
}
function invalidateAdrPreview(message = 'Selection changed. Preview exact input again before saving.') {
  adrReview.close(); adrReview.error = ''; adrPreviewMessage = message; renderAdrPreview();
}
function closeAdrScope(focus = false) {
  adrEpoch++; adrAbort?.abort(); adrAbort = null; adrJourney = null; adrBusy = false; adrReview.close();
  if ($('adr-scope-dialog').open) $('adr-scope-dialog').close();
  if (focus) $('adr-scope-open').focus();
}
function adrChoices(chosen) {
  const epoch = adrEpoch, nodes = state.document.nodes.filter(node => isQuestion(node) || node.kind === 'direction'), byId = new Map(nodes.map(node => [node.id, node]));
  adrSelected = new Set(chosen?.nodeIds ?? []);
  $('adr-scope-focal').replaceChildren(el('option', { value: '' }, 'Choose a focal question'), ...nodes.filter(isQuestion).map(node => el('option', { value: node.id }, node.question)));
  if (chosen?.focalId && !byId.has(chosen.focalId)) $('adr-scope-focal').append(el('option', { value: chosen.focalId }, 'Unavailable saved focal question — choose a current question'));
  $('adr-scope-focal').value = chosen?.focalId ?? ''; $('adr-scope-evidence').checked = chosen?.includeEvidence ?? false;
  $('adr-scope-sources').replaceChildren();
  const unavailable = [...adrSelected].filter(id => !byId.has(id)).map(id => ({ id, missing: true, question: adrSaved?.dependencies.records.find(node => node.id === id)?.question ?? id }));
  for (const node of [...nodes, ...unavailable]) {
    const input = el('input', { type: 'checkbox', 'data-adr-node': node.id });
    input.addEventListener('change', () => {
      if (!adrCurrent(epoch) || adrBusy || !input.isConnected) return;
      input.checked ? adrSelected.add(node.id) : adrSelected.delete(node.id); invalidateAdrPreview();
    });
    $('adr-scope-sources').append(el('label', {}, input, `${node.question} · ${node.missing ? 'unavailable saved source' : node.kind === 'direction' ? 'user direction' : effectiveAnswerState(node)}${node.review ? '; needs review' : ''}`));
  }
  adrControls();
}
async function requestAdrScope(action, initialize = false) {
  if (!adrCurrent() || adrBusy || action === 'save' && busy) return;
  const reviewed = adrReview.value;
  if (action === 'save' && (!reviewed || Date.now() >= reviewed.expiresAt)) return invalidateAdrPreview('Review the current selection again before saving.');
  const epoch = adrEpoch, journey = adrJourney, writes = action === 'save', abort = new AbortController(); adrAbort = abort;
  if (writes) { busy = true; actionEpoch++; stateCursor = null; pollFlight?.abort.abort(); }
  const mapEpoch = actionEpoch, timer = setTimeout(() => abort.abort(), 10000);
  adrBusy = true; adrControls(); $('adr-scope-status').textContent = writes ? 'Saving reviewed scope…' : 'Checking saved scope and scenario…';
  try {
    const response = await fetch('api/adr-scope', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' },
      body: JSON.stringify({ action, journey, ...(writes ? { token: reviewed.token, revision: state.document.revision } : {}) }) });
    const result = await response.json();
    if (!adrCurrent(epoch) || writes && mapEpoch !== actionEpoch) return;
    if (!response.ok) throw Error(result.error);
    if (result.journey !== journey) throw Error('ADR scope response belongs to a different journey.');
    if (result.snapshot) apply(result.snapshot);
    adrSaved = result.scope;
    if (initialize) adrChoices(result.scope?.selection);
    else if (!writes) adrChoices({ focalId: $('adr-scope-focal').value, nodeIds: [...adrSelected], includeEvidence: $('adr-scope-evidence').checked });
    $('adr-scope-status').textContent = result.scope ? `Saved scope is ${result.freshness} at this check. Selected ${result.scope.selectedAt}. ${result.message ?? ''}` : `No saved ADR scope. ${result.message ?? ''}`;
    if (writes) invalidateAdrPreview('Scope saved. A new exact review is required before replacing it or later drafting.');
  } catch (error) {
    if (adrCurrent(epoch)) { $('adr-scope-status').textContent = `${abort.signal.aborted ? 'Request timed out; refresh to check whether the scope saved.' : error.message} Scope freshness is unknown until checked.`; if (writes) invalidateAdrPreview(); }
  } finally {
    clearTimeout(timer); if (writes && mapEpoch === actionEpoch) busy = false;
    if (adrCurrent(epoch)) { adrBusy = false; adrAbort = null; adrControls(); }
  }
}
$('adr-scope-open').addEventListener('click', () => {
  if (!state.document || !switchAllowed('selecting ADR scope')) return;
  closeAdrScope(); adrJourney = state.activeKey ?? state.document.id; adrSaved = null; adrPreviewMessage = ''; adrReview.error = '';
  adrChoices(); renderAdrPreview(); $('adr-scope-dialog').showModal(); void requestAdrScope('status', true);
});
$('adr-scope-focal').addEventListener('change', () => { if (adrCurrent() && !adrBusy) { if ($('adr-scope-focal').value) adrSelected.add($('adr-scope-focal').value); invalidateAdrPreview(); } });
$('adr-scope-evidence').addEventListener('change', () => { if (adrCurrent() && !adrBusy) invalidateAdrPreview(); });
function addAdrRelated(branch) {
  if (!adrCurrent() || adrBusy) return;
  const nodes = state.document.nodes, byId = new Map(nodes.map(node => [node.id, node])), focal = byId.get($('adr-scope-focal').value), ids = new Set();
  if (!focal) return;
  if (branch) { ids.add(focal.id); const children = new Map(nodes.map(node => [node.id, []])); for (const node of nodes) children.get(node.parentId)?.push(node.id); const queue = [focal.id]; for (let i = 0; i < queue.length; i++) for (const id of children.get(queue[i]) ?? []) if (!ids.has(id)) { ids.add(id); queue.push(id); } }
  else for (let node = byId.get(focal.parentId); node?.parentId !== null && node && !ids.has(node.id); node = byId.get(node.parentId)) ids.add(node.id);
  const combined = new Set([...adrSelected, ...ids]);
  if (combined.size > 100) { invalidateAdrPreview('This selection would exceed 100 records. Choose supporting questions individually.'); return; }
  adrSelected = combined; invalidateAdrPreview();
}
$('adr-scope-ancestors').addEventListener('click', () => addAdrRelated(false));
$('adr-scope-branch').addEventListener('click', () => addAdrRelated(true));
$('adr-scope-review').addEventListener('click', () => {
  if (!adrCurrent() || adrBusy) return;
  adrReview.open({ purpose: 'adr-scope', journey: adrJourney, nodeId: state.document.rootId, selection: { focalId: $('adr-scope-focal').value, nodeIds: [...adrSelected], includeEvidence: $('adr-scope-evidence').checked } });
});
$('adr-scope-save').addEventListener('click', () => void requestAdrScope('save'));
$('adr-scope-refresh').addEventListener('click', async () => { const epoch = adrEpoch; if (adrCurrent(epoch) && !adrBusy && await api('refresh-answer') && adrCurrent(epoch)) { invalidateAdrPreview(); await requestAdrScope('status'); } });
$('adr-scope-close').addEventListener('click', () => closeAdrScope(true));
$('adr-scope-dialog').addEventListener('cancel', event => { event.preventDefault(); closeAdrScope(true); });
$('adr-scope-dialog').addEventListener('close', () => { if (adrJourney) closeAdrScope(); });

let briefOperation = 'brief';
const handoffReview = new ResearchReviewClient({ fetch: (...args) => fetch(...args), changed: renderHandoffPreview });
const adrDraftReview = new ResearchReviewClient({ fetch: (...args) => fetch(...args), changed: renderAdrDraftReview });
const briefRoute = () => briefOperation === 'adrDraft' ? 'adr-draft' : briefOperation;
const briefReview = () => briefOperation === 'adrDraft' ? adrDraftReview : handoffReview;
const briefReviewReady = () => briefOperation === 'brief' || !!briefReview().value && !briefReview().loading && Date.now() < briefReview().value.expiresAt;
let adrDraftProposal = null, adrDraftTitleEdit = null, adrDraftSavePending = false;
let adrReadinessReport = null, adrReadinessBase = null, adrReadinessKey = null, adrReadinessEpoch = 0, adrReadinessFlight = null, adrReadinessMessage = '', adrReadinessStamp = '', adrReadinessAcks = new Set();
let briefView = null, briefId = null, briefJourney = null, briefEpoch = 0, briefBusy = false, briefAbort = null, briefStamp = '', briefEdits = new Map();
const adrWordingEdits = () => adrDraftProposal ? { title: adrDraftTitleEdit ?? adrDraftProposal.title, statements: [...briefEdits].map(([id, text]) => ({ id, text })) } : null;
const adrWordingKey = () => JSON.stringify(adrWordingEdits());
const currentAdrReadiness = () => adrReadinessReport && !adrReadinessFlight && adrReadinessKey === adrWordingKey();
function invalidateAdrReadiness(message = 'Wording changed. Check readiness again before accepting.') {
  adrReadinessEpoch++; adrReadinessFlight?.abort(); adrReadinessFlight = null;
  adrReadinessReport = null; adrReadinessKey = null; adrReadinessAcks.clear(); adrReadinessMessage = message; adrReadinessStamp = '';
  renderAdrReadiness();
}
function updateAdrReadiness(report) {
  if (briefOperation !== 'adrDraft') return;
  if ((report?.digest ?? null) !== adrReadinessBase) invalidateAdrReadiness('Draft inputs changed. Check edited wording again; manual edits are retained.');
  adrReadinessBase = report?.digest ?? null;
  if (report && !adrReadinessFlight && adrDraftTitleEdit === null && !briefEdits.size) {
    if (adrReadinessReport?.digest !== report.digest) { adrReadinessAcks = new Set(report.acknowledged); adrReadinessStamp = ''; }
    adrReadinessReport = report; adrReadinessKey = adrWordingKey(); adrReadinessMessage = '';
  }
  renderAdrReadiness();
}
function renderAdrReadiness() {
  const adr = briefOperation === 'adrDraft', valid = !!currentAdrReadiness(), report = valid ? adrReadinessReport : null, editable = !!adrDraftProposal;
  $('adr-readiness').hidden = !adr; $('adr-readiness').dataset.current = String(adr && valid);
  const locked = briefBusy || adrDraftSavePending || !!adrReadinessFlight || briefView?.status === 'pending';
  $('check-adr-readiness').disabled = !adr || locked || !(adrDraftProposal || briefView?.accepted);
  if (adr) $('accept-brief').disabled = locked || briefView?.status !== 'proposal' || !valid || !!report.blockers;
  const receipt = !editable ? briefView?.accepted?.readiness : null;
  $('adr-readiness-status').textContent = adrReadinessFlight ? 'Checking exact wording and current saved sources…' : report ? `${report.blockers} correctness blockers; ${report.advisories} advisory gaps. ${report.blockers ? 'Stale or invalid references prevent acceptance.' : 'Proposed wording may retain honest unknowns; acknowledgments are optional.'}${receipt ? receipt.digest === report.digest ? ` Saved judgments checked against this wording and input (${receipt.reviewedAt}).` : ' Saved acknowledgment is historical: wording or inputs changed.' : ''}` : adrReadinessMessage || 'Readiness is unavailable until a draft is shown.';
  const stamp = JSON.stringify([report?.digest, editable, receipt?.digest]);
  if (stamp !== adrReadinessStamp) {
    adrReadinessStamp = stamp; $('adr-readiness-items').replaceChildren();
    for (const severity of ['blocker', 'advisory']) {
      const rows = report?.items.filter(item => item.severity === severity) ?? []; if (!rows.length) continue;
      const list = el('ul'); $('adr-readiness-items').append(el('h4', {}, severity === 'blocker' ? 'Correctness blockers' : 'Advisory gaps'), list);
      for (const item of rows) {
        const row = el('li', { 'data-adr-gap': item.code }, el('p', {}, item.reason)), epoch = adrReadinessEpoch;
        const current = () => epoch === adrReadinessEpoch && adrReadinessReport?.digest === report.digest && row.isConnected && briefOperation === 'adrDraft' && $('brief-dialog').open;
        const target = item.target;
        if (target.kind === 'node') {
          const node = state.document?.nodes.find(node => node.id === target.id);
          const captured = (adrDraftProposal ?? briefView?.accepted)?.dependencies.records.find(source => source.id === target.id);
          if (node) row.append(button(`Open saved question: ${node.question}`, () => { if (!current() || briefBusy || adrDraftSavePending) return; hideBrief(); select(target.id); }));
          else row.append(el('p', { class: 'quiet' }, `Source unavailable: ${captured?.question ?? target.id}`));
        } else if (target.kind === 'section') row.append(button('Go to draft section', () => {
          if (!current() || adrDraftSavePending) return;
          const area = [...$('brief-content').querySelectorAll('[data-adr-section]')].find(area => area.dataset.adrSection === target.section);
          const input = target.statementId ? [...area?.querySelectorAll('[data-brief-statement]') ?? []].find(input => input.dataset.briefStatement === target.statementId) : area?.querySelector('textarea');
          (input ?? area)?.focus(); (input ?? area)?.scrollIntoView({ block: 'nearest' });
        }));
        else if (['adr-scope-open', 'adr-format-open'].includes(target.id)) row.append(button(target.id === 'adr-scope-open' ? 'Open ADR scope' : 'Open ADR format', () => { if (!current() || adrDraftSavePending) return; hideBrief(); $(target.id).click(); }));
        if (severity === 'advisory' && editable) {
          const input = el('input', { type: 'checkbox' }); input.checked = adrReadinessAcks.has(item.id);
          input.addEventListener('change', () => { if (!current() || briefBusy || adrDraftSavePending || adrReadinessFlight) return; input.checked ? adrReadinessAcks.add(item.id) : adrReadinessAcks.delete(item.id); });
          row.append(el('label', {}, input, ' Acknowledge this gap for this wording and input'));
        } else if (report.acknowledged.includes(item.id)) row.append(el('p', { class: 'quiet' }, 'Recorded acknowledgment; the source facts and gap are unchanged.'));
        list.append(row);
      }
    }
  }
  for (const input of $('adr-readiness-items').querySelectorAll('input')) input.disabled = locked;
}
async function checkAdrReadiness() {
  if (briefOperation !== 'adrDraft' || !briefId || briefBusy || adrDraftSavePending || adrReadinessFlight || briefView?.status === 'pending' || closed || suspended || !$('brief-dialog').open) return;
  invalidateAdrReadiness();
  const epoch = adrReadinessEpoch, brief = briefEpoch, id = briefId, journey = briefJourney, edits = adrWordingEdits(), key = JSON.stringify(edits), base = adrReadinessBase;
  const abort = new AbortController(); adrReadinessFlight = abort;
  const current = () => epoch === adrReadinessEpoch && brief === briefEpoch && id === briefId && base === adrReadinessBase && key === adrWordingKey() && !closed && !suspended && $('brief-dialog').open;
  const timer = setTimeout(() => abort.abort(), 5000); renderAdrReadiness();
  try {
    const response = await fetch('api/adr-draft', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'readiness', id, journey, edits }) });
    const result = await response.json(); if (!current()) return;
    if (!response.ok) throw Error(result.error); if (result.id !== id) throw Error('Readiness response did not match this draft.');
    adrReadinessReport = result.readiness; adrReadinessKey = key; adrReadinessAcks = new Set(result.readiness.acknowledged); adrReadinessMessage = ''; adrReadinessStamp = '';
  } catch (error) { if (current()) adrReadinessMessage = `${error.message} Check again before accepting.`; }
  finally { clearTimeout(timer); if (current()) { adrReadinessFlight = null; renderAdrReadiness(); } }
}
$('check-adr-readiness').addEventListener('click', () => void checkAdrReadiness());
function closeBrief() {
  invalidateAdrReadiness(''); adrReadinessBase = null;
  briefEpoch++; briefAbort?.abort(); briefAbort = null; handoffReview.close(); adrDraftReview.close();
  if (briefId && briefJourney) void fetch(`api/${briefRoute()}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'discard', id: briefId, journey: briefJourney }) }).catch(() => {});
  briefId = null; briefJourney = null; briefView = null; briefStamp = ''; briefEdits.clear(); briefBusy = false;
  adrDraftProposal = null; adrDraftTitleEdit = null; adrDraftSavePending = false;
  if ($('brief-dialog').open) $('brief-dialog').close();
  briefOperation = 'brief';
}
async function requestBrief(action) {
  if (briefOperation === 'adrDraft' && adrDraftSavePending && ['start', 'accept'].includes(action)) return;
  if (briefOperation === 'adrDraft' && action === 'accept' && (!currentAdrReadiness() || adrReadinessReport.blockers)) return;
  if (action === 'start' && !briefReviewReady()) { $(briefOperation === 'adrDraft' ? 'adr-draft-review-status' : 'handoff-preview-status').textContent = 'Review current saved input again before starting.'; return; }
  if (!briefId || briefBusy || closed || suspended || action === 'accept' && busy) return;
  const writesMap = action === 'accept';
  const readiness = briefOperation === 'adrDraft' && writesMap ? { digest: adrReadinessReport.digest, acknowledged: [...adrReadinessAcks] } : null;
  if (briefOperation === 'adrDraft' && ['start', 'accept', 'discard'].includes(action)) invalidateAdrReadiness('Check the resulting draft before accepting.');
  if (writesMap) { busy = true; actionEpoch++; stateCursor = null; pollFlight?.abort.abort(); }
  const mapEpoch = actionEpoch;
  const epoch = briefEpoch, id = briefId, journey = briefJourney, abort = new AbortController(); briefAbort = abort;
  const readinessEpoch = adrReadinessEpoch;
  const timer = setTimeout(() => abort.abort(), 5000);
  briefBusy = true;
  if (briefOperation === 'adrDraft' && writesMap) {
    adrDraftSavePending = true;
    $('brief-status').textContent = 'Saving ADR wording. The wording is read-only until the save outcome is checked; it can still be selected and copied.';
  }
  renderAdrDraftReview();
  for (const name of ['generate-brief', 'accept-brief', 'discard-brief']) $(name).disabled = true;
  try {
    const response = await fetch(`api/${briefRoute()}`, { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' },
      body: JSON.stringify({ action, id, journey, ...(briefOperation !== 'brief' && action === 'start' ? { token: briefReview().value.token } : {}), ...(action === 'accept' ? { revision: state.document.revision, edits: briefOperation === 'adrDraft' ? adrWordingEdits() : [...briefEdits].map(([id, text]) => ({ id, text })), ...(readiness ? { readiness } : {}) } : {}) }) });
    const result = await response.json();
    if (epoch !== briefEpoch || id !== briefId || closed || writesMap && mapEpoch !== actionEpoch) return;
    if (!response.ok) throw new Error(result.error);
    if (result.id !== id) throw new Error('Decision brief response did not match this request.');
    const readinessCurrent = readinessEpoch === adrReadinessEpoch && !suspended && $('brief-dialog').open;
    if (result.snapshot) apply(result.snapshot);
    if (briefOperation === 'adrDraft') {
      adrDraftSavePending = false;
      if (result.status === 'proposal') { if (briefView?.status !== 'proposal') briefStamp = ''; adrDraftProposal = result.proposal; }
      if (action === 'accept' || action === 'discard') { adrDraftProposal = null; adrDraftTitleEdit = null; }
      if (action === 'accept') { result.accepted = state.document.adrDraft; result.freshness = 'current'; }
    }
    briefView = result;
    if (briefOperation === 'handoff' && action === 'start') { handoffReview.close(); renderHandoffPreview(); }
    if (briefOperation === 'adrDraft' && action === 'start') { adrDraftReview.close(); renderAdrDraftReview(); }
    if (action === 'discard') { briefStamp = ''; briefEdits.clear(); }
    renderBrief();
    if (briefOperation === 'adrDraft' && readinessCurrent) updateAdrReadiness(result.readiness);
  } catch (error) {
    if (epoch === briefEpoch && !closed) { $('brief-status').textContent = `${error.message} Brief freshness is unknown until the saved journey can be checked.${adrDraftSavePending ? ' ADR wording remains read-only and copyable until its save outcome is checked; use Refresh to check again.' : ''}`; $('accept-brief').hidden = true; }
  } finally { clearTimeout(timer); if (writesMap && mapEpoch === actionEpoch) busy = false; if (epoch === briefEpoch) { briefBusy = false; $('generate-brief').disabled = briefView?.status === 'pending' || !briefReviewReady(); $('accept-brief').disabled = briefOperation === 'adrDraft' && (adrDraftSavePending || briefView?.status !== 'proposal'); $('discard-brief').disabled = false; renderAdrDraftReview(); } }
}
function renderBrief() {
  const value = briefView, adr = briefOperation === 'adrDraft', liveProposal = value?.status === 'proposal' ? value.proposal : null;
  const proposal = liveProposal ?? (adr && ['pending', 'stale', 'error'].includes(value?.status) ? adrDraftProposal : null), brief = proposal ?? value?.accepted;
  const acceptance = !proposal && value?.accepted?.acceptance;
  $('brief-contributors').hidden = !brief || !!proposal;
  $('brief-contributors').textContent = acceptance ? `${state.contributions?.artifacts[briefOperation] === 'current' && JSON.stringify(value.accepted) === JSON.stringify(state.document?.[briefOperation]) ? 'Recorded acceptance matches this saved wording.' : 'Historical acceptance; current accepter unknown.'} Accepted wording by: ${contributorEventText(acceptance)}. This records acceptance of AI synthesis, not decision approval or human authorship of every statement.` : 'Accepter unknown; no recorded acceptance attribution. This wording is AI synthesis reviewed by a user, not decision approval.';
  $('discard-brief').hidden = !['pending', 'proposal', 'stale', 'error'].includes(value?.status);
  $('accept-brief').hidden = !liveProposal;
  $('generate-brief').disabled = value?.status === 'pending' || !briefReviewReady();
  $('export-brief').hidden = adr || !value?.accepted;
  $('copy-handoff').hidden = briefOperation !== 'handoff' || !value?.accepted;
  $('adr-file-from-draft').hidden = !adr || !state.document?.adrDraft;
  const coverage = brief?.coverage ?? value?.coverage;
  $('brief-status').textContent = [value?.error, value?.status === 'pending' ? `${value.progress}… Cancel this before using cleanup or question help.` : proposal ? 'Proposal only — review and edit, then explicitly accept.' : value?.accepted ? `Accepted brief — ${value.freshness}.` : 'No accepted brief yet.',
    coverage ? `${briefOperation === 'handoff' ? 'Selected handoff scope' : 'Journey summary'}: ${coverage.included} records included${coverage.omitted !== undefined ? `; ${coverage.omitted} omitted (not examined); ${coverage.bytes}/${coverage.limit} UTF-8 bytes` : ''}.` : '',
    'User constraints are statements, not verified facts. User edits keep original source links; edited wording is not automatically reverified.'].filter(Boolean).join(' ');
  if (adr) $('brief-status').textContent = [value?.error, 'ADR status: proposed. Accepting wording does not approve the decision or write a project file.', value?.status === 'pending' ? `${value.progress}… Cancel to stop this owned helper.` : liveProposal ? 'Review and edit this optional draft.' : proposal ? 'Edited wording is retained for copying; review current input and regenerate before acceptance.' : value?.accepted ? `Saved draft wording is ${value.freshness} at this check.` : 'No saved ADR draft yet.', coverage ? `${coverage.included} selected records; ${coverage.omitted} omitted. ${coverage.bytes}/${coverage.limit} UTF-8 input bytes.` : '', 'Source states describe user intent, not verified facts. Edits retain original references without automatic verification.'].filter(Boolean).join(' ');
  const unavailable = proposal ? [] : value?.unavailableSources ?? [];
  const stamp = JSON.stringify([proposal ? briefId : 'accepted', brief, adr ? [] : unavailable, adr ? [] : brief?.dependencies.records.filter(source => !state.document.nodes.some(node => node.id === source.id)).map(source => source.id)]);
  if (stamp === briefStamp) return;
  briefStamp = stamp; briefEdits.clear(); adrDraftTitleEdit = null; $('brief-content').replaceChildren();
  if (adr) invalidateAdrReadiness('Check the current draft wording.');
  if (!brief) return;
  const titles = { goal: brief.format === 'prompt' ? 'Instructions to the implementer' : 'Goal', decisions: brief.format === 'specification' ? 'Selected requirements' : 'Decisions and rationale', constraints: 'Constraints', assumptions: 'Assumptions', unresolved: 'Unresolved questions and conflicts', nextSteps: brief.format === 'tasks' ? 'Proposed tasks (in order)' : brief.format === 'plan' ? 'Proposed sequence' : brief.format === 'specification' ? 'Suggested validation' : 'Next steps' };
  if (adr) {
    Object.assign(titles, { context: 'Context', drivers: 'Decision drivers', alternatives: 'Considered options', outcome: 'Decision and rationale', consequences: 'Consequences', confirmation: 'Confirmation', optionDetails: 'Pros and cons of options' }, Object.fromEntries(brief.format.layout.sections.map(section => [section.key, section.label])));
    if (proposal) {
      const input = el('input', { id: 'adr-draft-title', type: 'text', maxlength: '200' }); input.value = brief.title;
      input.addEventListener('input', () => { adrDraftTitleEdit = input.value; invalidateAdrReadiness(); });
      $('brief-content').append(el('label', { for: 'adr-draft-title' }, 'Draft title'), input);
    } else $('brief-content').append(el('h3', {}, brief.title), el('p', { class: 'quiet' }, brief.titleEdited ? 'Title edited by the user.' : 'Title is AI synthesis reviewed by the user.'));
  }
  for (const [key, statements] of Object.entries(brief.sections)) {
    const area = el('section', {}, el('h3', {}, titles[key]));
    if (adr) { area.dataset.adrSection = key; area.tabIndex = -1; }
    if (!statements.length) area.append(el('p', { class: 'quiet' }, adr ? brief.format.layout.sections.some(section => section.key === key) ? 'Unspecified in this draft.' : 'Not in the selected template; remains unspecified.' : 'Unspecified in this brief.'));
    for (const statement of statements) {
      const label = el('p', { class: 'quiet' }, `${statement.certainty} · ${statement.edited ? 'User edited' : 'AI synthesis'}`);
      if (proposal) {
        const input = el('textarea', { rows: '3', 'aria-label': `${titles[key]} statement`, 'data-brief-statement': statement.id }); input.value = statement.text;
        input.addEventListener('input', () => { briefEdits.set(statement.id, input.value); label.textContent = `${statement.certainty} · ${input.value === statement.text ? 'AI synthesis' : 'User edited; original source links not reverified'}`; if (adr) invalidateAdrReadiness(); });
        area.append(label, input);
      } else area.append(label, el('p', { class: 'brief-text' }, statement.text));
      for (const ref of statement.sources) {
        if (ref.kind === 'guidance') area.append(el('p', { class: 'quiet' }, `Source: global user guidance (${ref.field})`));
        else if (ref.kind === 'evidence') {
          const source = brief.evidence.find(item => item.nodeId === ref.nodeId)?.sources.find(item => item.id === ref.sourceId);
          area.append(el('p', { class: 'quiet' }, `Recorded research: ${ref.nodeId} / ${ref.sourceId}: ${source?.title}. ${source?.provenance}; retrieved ${source?.retrievedAt ?? 'unknown'}. Consultation alone does not establish support.`));
        } else {
          const source = brief.dependencies.records.find(source => source.id === ref.id), available = !unavailable.includes(ref.id) && state.document.nodes.some(node => node.id === ref.id);
          area.append(el('p', { class: 'quiet' }, `Source state: ${source.state}${source.review ? '; needs review' : ''}`), adr ? el('p', { class: 'quiet' }, `Source at capture: ${source.question} (${ref.id}).`) : available ? button(`Reveal: ${source.question}`, () => { $('brief-dialog').close(); select(ref.id); }, { class: 'brief-source' }) : el('p', { class: 'quiet' }, `Historical source unavailable: ${source.question} (${ref.id})`));
        }
      }
    }
    $('brief-content').append(area);
  }
  if (briefOperation === 'handoff' || adr) {
    const appendix = el('details', {}, el('summary', {}, 'Captured guidance, constraints and recorded research'));
    appendix.append(el('pre', { class: 'handoff-appendix' }, JSON.stringify({ guidance: brief.guidance, includeEvidence: brief.includeEvidence, evidence: brief.evidence }, null, 2))); $('brief-content').append(appendix);
  }
}
$('decision-brief').addEventListener('click', () => {
  voice.cancel();
  if (briefOperation !== 'brief') closeBrief();
  briefOperation = 'brief'; configureBriefDialog();
  if (!briefId) { briefId = crypto.randomUUID(); briefJourney = state.activeKey ?? state.document.id; briefEpoch++; }
  $('brief-dialog').showModal(); void requestBrief('view');
});
$('generate-brief').addEventListener('click', () => { voice.cancel(); void requestBrief('start'); });
$('discard-brief').addEventListener('click', () => void requestBrief('discard'));
$('accept-brief').addEventListener('click', () => void requestBrief('accept'));
$('refresh-brief').addEventListener('click', async () => { if (await api('refresh-answer')) await requestBrief('poll'); });
function hideBrief() { if (briefOperation === 'adrDraft') { adrDraftReview.close(); invalidateAdrReadiness('Recheck readiness when returning to edited wording.'); } $('brief-dialog').close(); $(briefOperation === 'adrDraft' ? 'adr-draft-open' : briefOperation === 'handoff' ? 'implementation-handoff' : 'decision-brief').focus(); }
$('close-brief').addEventListener('click', hideBrief);
$('brief-dialog').addEventListener('cancel', event => { if (briefOperation === 'adrDraft') { event.preventDefault(); hideBrief(); } });
$('brief-dialog').addEventListener('close', () => { if (briefOperation === 'adrDraft' && !$('brief-dialog').open) { adrDraftReview.close(); invalidateAdrReadiness('Recheck readiness when returning to edited wording.'); } });
function configureBriefDialog() {
  const handoff = briefOperation === 'handoff';
  $('brief-title').textContent = handoff ? 'Reviewed implementation handoff' : 'Reviewed decision brief';
  $('brief-description').textContent = handoff ? 'Choose only the saved decisions, tentative answers or open questions to include. Topic, guidance and all user constraints are mandatory. Excluded: unselected nodes, implicit ancestors/root records, drafts, private references, project excerpts/file references/snapshots, previous briefs/handoffs/checks, research summaries/recommendations/proposed answers and follow-up prose. Only explicitly included recorded sources and structured claims are an exception. Review exact input before generation. No code, tasks or chat messages are sent or executed.' : 'Generate a bounded journey summary from saved answers, open questions, directions and guidance. Drafts, private references, research and previous briefs are excluded. Review uncertainty and source coverage before accepting.';
  $('handoff-selection').hidden = !handoff;
  $('generate-brief').textContent = handoff ? 'Generate from reviewed input' : 'Generate decision brief';
  $('accept-brief').textContent = handoff ? 'Accept reviewed handoff' : 'Accept reviewed brief';
  $('export-brief').textContent = handoff ? 'Export accepted handoff' : 'Export reviewed brief';
  $('export-brief').href = handoff ? 'handoff.md' : 'brief.md';
  $('copy-handoff').hidden = true;
  $('adr-draft-review').hidden = briefOperation !== 'adrDraft';
  $('adr-readiness').hidden = briefOperation !== 'adrDraft';
  if (briefOperation === 'adrDraft') {
    $('brief-title').textContent = 'Proposed ADR draft';
    $('brief-description').textContent = 'Review the current saved ADR scope and template layout, then generate an optional draft with an isolated helper that has no tools. Missing reasons and alternatives remain unspecified. Edit the wording and explicitly accept it into this exploration. The decision stays proposed; this does not approve it or write a project file. Close hides the draft; Discard proposal / cancel stops it. Native SDK journals may retain inputs and output.';
    $('generate-brief').textContent = 'Generate reviewed ADR draft'; $('accept-brief').textContent = 'Accept draft wording'; $('export-brief').hidden = true;
  }
}
function renderAdrDraftReview() {
  const value = adrDraftReview.value;
  $('adr-draft-preview').hidden = !value;
  const text = value ? `${value.prepared.instructions}\n\n${value.prepared.prompt}` : '';
  if ($('adr-draft-input').textContent !== text) $('adr-draft-input').textContent = text;
  $('adr-draft-review-status').textContent = adrDraftReview.error || (adrDraftReview.loading ? 'Preparing exact saved ADR input…' : value ? `${value.prepared.coverage.included} selected records; ${value.prepared.bytes}/${value.prepared.limit} UTF-8 bytes. Review before generating.` : 'Review current saved scope and template input before generating.');
  $('review-adr-draft').disabled = briefBusy || adrDraftSavePending || briefView?.status === 'pending' || adrDraftReview.loading;
  if (briefOperation === 'adrDraft') {
    $('generate-brief').disabled = briefBusy || adrDraftSavePending || briefView?.status === 'pending' || !briefReviewReady();
    for (const input of $('brief-content').querySelectorAll('#adr-draft-title, [data-brief-statement]')) input.readOnly = adrDraftSavePending;
    renderAdrReadiness();
  }
}
$('adr-draft-open').addEventListener('click', () => {
  if (!state.document || closed || suspended || !switchAllowed('drafting an ADR')) return;
  voice.cancel(); if (briefOperation !== 'adrDraft') closeBrief(); briefOperation = 'adrDraft'; configureBriefDialog();
  if (!briefId) { briefId = crypto.randomUUID(); briefJourney = state.activeKey ?? state.document.id; briefEpoch++; }
  $('brief-dialog').showModal(); renderAdrDraftReview(); void requestBrief('view');
});
$('review-adr-draft').addEventListener('click', () => {
  if (briefOperation !== 'adrDraft' || !briefId || briefBusy || adrDraftSavePending || briefView?.status === 'pending' || closed || suspended || !$('brief-dialog').open) return;
  adrDraftReview.open({ purpose: 'adr-draft', journey: briefJourney, nodeId: state.document.rootId });
});
function renderHandoffPreview() {
  const value = handoffReview.value;
  $('handoff-preview').hidden = !value;
  $('handoff-preview-text').textContent = value ? `${value.prepared.instructions}\n\n${value.prepared.prompt}` : '';
  $('handoff-preview-status').textContent = handoffReview.error || (handoffReview.loading ? 'Preparing exact input preview…' : value ? `${value.prepared.context.records.length} explicit records, ${value.prepared.context.includeEvidence ? 'recorded research included' : 'research evidence omitted'}; ${value.prepared.bytes}/${value.prepared.limit} UTF-8 bytes. Review the exact instructions and input below before generating.` : 'Choose sources and preview exact input. Changing selection requires another preview.');
  if (briefOperation === 'handoff') $('generate-brief').disabled = !value || briefView?.status === 'pending';
}
function invalidateHandoffPreview() { handoffReview.close(); renderHandoffPreview(); }
$('implementation-handoff').addEventListener('click', () => {
  voice.cancel();
  if (briefOperation !== 'handoff') {
    closeBrief(); briefOperation = 'handoff';
    $('handoff-format').value = 'brief'; $('handoff-evidence').checked = false;
    $('handoff-sources').replaceChildren();
    for (const node of state.document.nodes.filter(node => isQuestion(node) || node.kind === 'direction')) {
      const input = el('input', { type: 'checkbox', 'data-handoff-node': node.id });
      input.addEventListener('change', invalidateHandoffPreview);
      $('handoff-sources').append(el('label', {}, input, `${node.question} · ${node.kind === 'direction' ? 'user direction' : effectiveAnswerState(node)}${node.review ? '; needs review' : ''}`));
    }
  }
  configureBriefDialog(); renderHandoffPreview();
  if (!briefId) { briefId = crypto.randomUUID(); briefJourney = state.activeKey ?? state.document.id; briefEpoch++; }
  $('brief-dialog').showModal(); void requestBrief('view');
});
$('handoff-format').addEventListener('change', invalidateHandoffPreview);
$('handoff-evidence').addEventListener('change', invalidateHandoffPreview);
$('review-handoff').addEventListener('click', () => {
  handoffReview.open({ journey: briefJourney, nodeId: state.document.rootId, purpose: 'implementation-handoff', selection: {
    nodeIds: [...$('handoff-sources').querySelectorAll('input:checked')].map(input => input.dataset.handoffNode), format: $('handoff-format').value, includeEvidence: $('handoff-evidence').checked,
  } });
});
$('copy-handoff').addEventListener('click', async () => {
  const epoch = briefEpoch;
  try {
    const response = await fetch('handoff.md');
    if (!response.ok) throw Error('Could not read the accepted handoff.');
    const text = await response.text();
    if (epoch !== briefEpoch || briefOperation !== 'handoff' || closed) return;
    await navigator.clipboard.writeText(text);
    if (epoch === briefEpoch) $('brief-status').textContent = 'Accepted handoff copied with freshness, source references and review labels.';
  } catch { if (epoch === briefEpoch) $('brief-status').textContent = 'Copy unavailable. Use Export accepted handoff to save the same portable text.'; }
});
let checkView = null, checkId = null, checkJourney = null, checkEpoch = 0, checkBusy = false, checkAbort = null;
function closeCheck() {
  checkEpoch++; checkAbort?.abort(); checkAbort = null;
  if (checkId && checkJourney) void fetch('api/check-answers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'cancel', id: checkId, journey: checkJourney }) }).catch(() => {});
  checkId = null; checkJourney = null; checkView = null; checkBusy = false;
  if ($('check-dialog').open) $('check-dialog').close();
}
async function requestCheck(action, findingId, token) {
  if (checkBusy || closed || suspended || !state.document) return;
  const previous = { id: checkId, journey: checkJourney, view: checkView };
  if (action === 'start' || !checkId) { checkId = crypto.randomUUID(); checkJourney = state.activeKey ?? state.document.id; checkEpoch++; checkView = null; renderCheck(); }
  const epoch = checkEpoch, id = checkId, journey = checkJourney, abort = new AbortController(); checkAbort = abort;
  const timer = setTimeout(() => abort.abort(), 5000);
  checkBusy = true; $('run-check').disabled = true; $('cancel-check').disabled = true;
  try {
    const response = await fetch('api/check-answers', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' },
      body: JSON.stringify({ action, id, journey, ...(token ? { token, operation: 'challenge-review' } : {}), ...(findingId ? { findingId } : {}) }) });
    const result = await response.json();
    if (epoch !== checkEpoch || id !== checkId || closed) return;
    if (!response.ok) {
      if (action === 'start') { checkId = previous.id; checkJourney = previous.journey; checkView = previous.view; renderCheck(); }
      throw new Error(result.error);
    }
    if (result.id !== id) throw new Error('Answer check response did not match this request.');
    checkView = result; renderCheck();
    if (action === 'dismiss') [...$('check-content').querySelectorAll('[data-dismissed-finding]')].find(node => node.dataset.dismissedFinding === findingId)?.focus({ preventScroll: true });
    return true;
  } catch (error) {
    if (epoch === checkEpoch && !closed) $('check-status').textContent = `${error.message} Refresh the saved journey and run the check again if needed.`;
  } finally { clearTimeout(timer); if (epoch === checkEpoch) { checkBusy = false; $('run-check').disabled = checkView?.status === 'pending'; $('cancel-check').disabled = false; } }
}
const ordinaryCheckDescription = $('check-description').textContent;
function renderCheck() {
  const challenge = checkView?.operation === 'challenge-review';
  $('check-title').textContent = challenge ? 'Challenge decisions' : 'Check answers';
  $('check-description').textContent = challenge ? 'Tool-free model hypotheses for user review. No new evidence is retrieved from the web; selected project excerpts are unverified inputs. Prior research is excluded. Input references are user statements, not proof. Inspect existing sourced research at an original answer separately. Suggestions never change decisions. Findings and dismissals are transient; replacement, reload, journey switch or relevant source changes clear or invalidate them.' : ordinaryCheckDescription;
  const result = checkView, coverage = result?.coverage, active = result?.status === 'result';
  $('cancel-check').hidden = result?.status !== 'pending';
  $('run-check').disabled = result?.status === 'pending';
  $('check-status').textContent = [result?.error, result?.status === 'pending' ? `${result.progress}… Cancel this before using another helper.` :
    result?.status === 'stale' ? 'These findings are stale because a sent source changed. Run the check again.' :
    active ? result.findings.length ? `${result.findings.length} possible finding${result.findings.length === 1 ? '' : 's'} for review.` : challenge ? 'No useful hypotheses returned for these selected inputs; this is not proof that the choices are sound.' : 'No possible issues found in the reviewed context; the whole map is not proven consistent.' : 'Run an explicit check to review saved inputs.',
    coverage ? `Journey summary: ${coverage.included} records included; ${coverage.omitted} omitted (not examined); ${coverage.bytes}/${coverage.limit} UTF-8 bytes.` : ''].filter(Boolean).join(' ');
  $('check-content').replaceChildren();
  if (!active) return;
  const dismissed = new Set(result.dismissed);
  for (const finding of result.findings) {
    const area = el('section', { class: 'check-finding' }, el('h3', {}, ({ assumption: 'Assumption', counterargument: 'Counterargument', alternative: 'Overlooked alternative', 'evidence-gap': 'Evidence gap', 'possible-tension': 'Possible tension', 'unresolved-choice': 'Unresolved choice', 'untested-assumption': 'Untested assumption' })[finding.category]), ...(challenge ? [el('p', { class: 'quiet' }, 'Model hypothesis; no new evidence')] : []),
      el('p', {}, finding.explanation), el('p', {}, `What may help: ${finding.resolution}`));
    for (const [index, ref] of finding.sources.entries()) {
      if (ref.kind === 'guidance') area.append(el('p', { class: 'quiet' }, `Source: global user guidance (${ref.field})`));
      else if (ref.kind === 'project') {
        const captured = finding.sourceStates[index], source = captured.source;
        area.append(el('details', {}, el('summary', {}, `Project source: ${source.name}`), el('p', {}, `Quoted untrusted input; ${captured.freshness}. Source ${source.id}; SHA-256 ${source.fingerprint}. ${source.excerptBytes} / ${source.bytes} UTF-8 bytes included.`), el('pre', {}, source.excerpt)));
      }
      else {
        const source = state.document.nodes.find(node => node.id === ref.id), captured = finding.sourceStates[index];
        area.append(el('p', { class: 'quiet' }, `Captured source: ${captured.state}${captured.review ? '; needs review' : ''} · ${ref.id}`));
        if (source) area.append(button(`Go to source: ${source.question}`, () => { $('check-dialog').close(); select(ref.id); }, { class: 'reference-jump' }));
        else area.append(el('p', { class: 'quiet' }, 'Source unavailable in this map. Run the check again.'));
      }
    }
    area.append(dismissed.has(finding.id) ? el('p', { class: 'quiet', tabindex: '-1', 'data-dismissed-finding': finding.id }, 'Dismissed in this canvas.') : button('Dismiss', () => void requestCheck('dismiss', finding.id)));
    $('check-content').append(area);
  }
}
$('check-answers').addEventListener('click', () => { voice.cancel(); $('check-dialog').showModal(); void requestCheck('poll'); });
$('run-check').addEventListener('click', () => { voice.cancel(); void requestCheck('start'); });
$('review-challenge').addEventListener('click', () => { $('check-dialog').close(); openResearchReview(state.document.rootId, undefined, 'challenge-review'); });
$('challenge-decisions').addEventListener('click', () => openResearchReview(state.document.rootId, undefined, 'challenge-review'));
$('cancel-check').addEventListener('click', () => void requestCheck('cancel'));
$('refresh-check').addEventListener('click', async () => { if (await api('refresh-answer')) await requestCheck('poll'); });
$('close-check').addEventListener('click', () => { $('check-dialog').close(); $('check-answers').focus(); });
let visualExportTarget = null, visualExportEpoch = 0;
function openVisualExport() {
  if (!state.document) return;
  visualExportEpoch++;
  visualExportTarget = { journey: state.activeKey ?? state.document.id, revision: state.document.revision, nodeId: selected };
  $('visual-export-scope').value = 'whole';
  $('visual-export-target').textContent = `Selected branch: ${state.document.nodes.find(n => n.id === selected)?.question ?? 'Unavailable'}`;
  $('visual-export-status').textContent = 'Exports contain saved answers only; local drafts are unchanged.';
  $('visual-export-download').disabled = false;
  openViewerSelection();
  $('export-dialog').showModal();
}
function invalidateViewer(message = 'Selection changed. Preview the included content before downloading.') {
  viewerEpoch++; viewerPreview = null;
  $('viewer-download').disabled = true; $('viewer-preview').disabled = false;
  $('viewer-preview-content').textContent = ''; $('viewer-status').textContent = message;
}
function openViewerSelection() {
  viewerTarget = { journey: state.activeKey ?? state.document.id, revision: state.document.revision };
  invalidateViewer('Choose saved nodes, including recorded importance and reasons, then optionally include their answers and research. Preview before downloading.');
  $('viewer-selection').replaceChildren();
  for (const node of state.document.nodes) {
    const row = el('fieldset', { 'data-node-id': node.id }), include = el('input', { type: 'checkbox', 'data-field': 'node' });
    const answer = el('input', { type: 'checkbox', 'data-field': 'answer', disabled: true }), research = el('input', { type: 'checkbox', 'data-field': 'research', disabled: true });
    row.append(el('legend', {}, node.question), el('label', {}, include, ' Include node'), el('label', {}, answer, ' Include saved answer'), el('label', {}, research, ' Include saved research (AI suggestions)'));
    include.addEventListener('change', () => {
      answer.disabled = !include.checked || !isQuestion(node); research.disabled = !include.checked || !node.research;
      if (!include.checked) answer.checked = research.checked = false;
    });
    $('viewer-selection').append(row);
  }
}
function viewerSelection() {
  return [...$('viewer-selection').querySelectorAll('fieldset')].filter(row => row.querySelector('[data-field="node"]').checked).map(row => ({ nodeId: row.dataset.nodeId, answer: row.querySelector('[data-field="answer"]').checked, research: row.querySelector('[data-field="research"]').checked }));
}
$('viewer-selection').addEventListener('change', () => invalidateViewer());
async function requestViewer(action) {
  if (!viewerTarget || (action === 'download' && !viewerPreview)) return;
  const target = { ...viewerTarget }, selection = viewerSelection(), selectionKey = JSON.stringify(selection), proof = viewerPreview;
  const epoch = ++viewerEpoch, page = pageEpoch;
  const owns = () => !closed && !suspended && page === pageEpoch && epoch === viewerEpoch && $('export-dialog').open;
  const current = () => owns() && target.journey === (state.activeKey ?? state.document?.id) && target.revision === state.document?.revision && selectionKey === JSON.stringify(viewerSelection());
  viewerPreview = null; $('viewer-download').disabled = true; $('viewer-preview').disabled = true;
  $('viewer-status').textContent = action === 'preview' ? 'Preparing exact saved content…' : 'Checking the previewed saved version…';
  try {
    if (action === 'preview') $('viewer-preview-content').textContent = '';
    const response = await fetch('api/viewer-export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ ...target, selection, action, digest: action === 'download' ? proof.digest : null }) });
    if (!response.ok) throw Error((await response.json()).error || 'Viewer export failed. Preview again.');
    if (action === 'preview') {
      const value = await response.json(); if (!current()) return;
      viewerPreview = { digest: value.digest };
      $('viewer-preview-content').textContent = JSON.stringify(value.snapshot, null, 2);
      $('viewer-status').textContent = `Preview: ${value.snapshot.nodes.length} saved nodes. Review all included text below before downloading. Research is recorded AI suggestion and interpretation, not a user decision or verified fact. Importance is a historical model assessment, not confidence or certainty.`;
      $('viewer-download').disabled = false;
    } else {
      const blob = await response.blob(); if (!current()) return;
      if (response.headers.get('Content-Disposition') !== 'attachment; filename="exploration-viewer.html"') throw Error('Invalid viewer download response. Preview again.');
      const url = URL.createObjectURL(blob), link = el('a', { href: url, download: 'exploration-viewer.html' });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      viewerPreview = proof; $('viewer-download').disabled = false;
      $('viewer-status').textContent = 'Download requested. Browser file saving is unknown. Open exploration-viewer.html in Brave to read offline.';
    }
  } catch (error) { if (owns()) invalidateViewer(error.message || 'Viewer export failed. Preview again.'); }
  finally { if (owns()) { $('viewer-preview').disabled = false; if (!current()) invalidateViewer('The journey changed. Reopen Export maps and preview again.'); } }
}
$('viewer-preview').addEventListener('click', () => void requestViewer('preview'));
$('viewer-download').addEventListener('click', () => void requestViewer('download'));
$('visual-export-open').addEventListener('click', openVisualExport);
$('visual-export-download').addEventListener('click', async () => {
  if (!visualExportTarget) return;
  const epoch = ++visualExportEpoch, target = { ...visualExportTarget };
  const current = () => !closed && epoch === visualExportEpoch && $('export-dialog').open;
  $('visual-export-download').disabled = true; $('visual-export-status').textContent = 'Preparing saved map…';
  try {
    const scope = $('visual-export-scope').value;
    const response = await fetch('api/visual-export', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ ...target, scope, nodeId: scope === 'whole' ? null : target.nodeId, format: $('visual-export-format').value }) });
    if (!response.ok) throw new Error((await response.json()).error || 'Export failed. Reopen Export maps to retry.');
    const blob = await response.blob();
    if (!current()) return;
    if (target.journey !== (state.activeKey ?? state.document?.id) || target.revision !== state.document?.revision) throw new Error('The journey changed. Reopen Export maps to select the scope again.');
    const filename = response.headers.get('Content-Disposition')?.match(/filename="(exploration-(?:whole|branch)\.(?:mmd|canvas|svg|html))"/)?.[1];
    if (!filename) throw new Error('Export response was invalid. Reopen Export maps to retry.');
    const url = URL.createObjectURL(blob), link = el('a', { href: url, download: filename });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    $('visual-export-status').textContent = 'Download requested. Browser file saving is unknown. For PDF, open the downloaded HTML in Brave and use Print → Save as PDF.';
  } catch (error) { if (current()) $('visual-export-status').textContent = error.message || 'Export failed. Reopen Export maps to retry.'; }
  finally { if (current()) $('visual-export-download').disabled = false; }
});
$('finish').addEventListener('click', async () => {
  await draftClient.ready;
  if (draftClient.loadError) return notice('Draft recovery is unavailable. Retry recovery before finishing.');
  const dirty = dirtyNodes();
  if (draftClient.uncommitted()) { if (dirty.length) select(dirty[0].id); return notice('Save your draft answer before finishing. Recover or discard drafts for removed questions.'); }
  if (await api('finish')) openVisualExport();
});
$('save-file').addEventListener('click', () => { notice('This download contains saved answers and states only. Local answer drafts are not included.'); });
$('close-export').addEventListener('click', () => { visualExportEpoch++; invalidateViewer(); viewerTarget = null; $('export-dialog').close(); $('visual-export-open').focus(); });
$('export-dialog').addEventListener('cancel', () => { visualExportEpoch++; invalidateViewer(); viewerTarget = null; });
$('outline-toggle').addEventListener('pointerdown', event => { if (($('node-workspace').contains(document.activeElement) || $('question-drawer').contains(document.activeElement))) event.preventDefault(); });
$('outline-toggle').addEventListener('click', () => setOutlineMode(!outlineMode));
$('outline-selected').addEventListener('click', () => revealOutlineSelection());
$('outline').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing) return;
  event.preventDefault(); setOutlineMode(false); $('outline-toggle').focus({ preventScroll: true });
});
$('search').addEventListener('input', renderOutline);
$('revisit-filter').addEventListener('change', renderOutline);
$('importance-filter').addEventListener('change', renderOutline);
$('request-status').addEventListener('click', () => {
  if (state.pending || state.preview) {
    const id = (state.pending ?? state.preview).nodeId;
    select(state.document.nodes.some(n => n.id === id) ? id : state.document.rootId);
    revealQuestionWork();
  }
});
for (const menu of document.querySelectorAll('.app-menu')) {
  menu.addEventListener('click', event => {
    if (event.target.closest('summary')) {
      for (const other of document.querySelectorAll('.app-menu')) if (other !== menu) other.open = false;
    } else if (menu.open && event.target.closest('button,a')) {
      // Dismiss before opening a dialog so native focus returns to its visible launcher.
      menu.open = false; menu.querySelector('summary').focus({ preventScroll: true });
    }
  }, true);
  menu.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menu.open) return;
    event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector('summary').focus({ preventScroll: true });
  });
}
document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.app-menu[open]')) if (!menu.contains(event.target)) menu.open = false;
});
$('question-drawer-handle').addEventListener('click', () => { setQuestionTools(true); $('question-drawer-close').focus({ preventScroll: true }); });
$('workspace').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || $('question-drawer').hidden) return;
  if ($('answer-revisit') && !$('answer-revisit').closest('[hidden]')) { event.preventDefault(); event.stopPropagation(); $('revisit-cancel').click(); return; }
  event.preventDefault(); event.stopPropagation(); setQuestionTools(false); $('question-tools-toggle').focus({ preventScroll: true });
}, true);
$('fit').addEventListener('click', () => { collapseNode(false); fit(); }); $('center-question').addEventListener('click', centerSelected);
$('show-whole-map').addEventListener('click', showWholeMap);
$('zoom-in').addEventListener('click', () => zoom(1.2)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
$('zoom-level').addEventListener('click', () => zoom(1 / view.zoom));
function endDrag(event) {
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.id)) return;
  const id = drag.id; drag = null; $('map').classList.remove('dragging');
  if ($('map').hasPointerCapture(id)) $('map').releasePointerCapture(id);
}
$('map').addEventListener('pointerdown', event => {
  if (outlineMode || drag || event.isPrimary === false || ![0, 1].includes(event.button)) return;
  suppressClick = false;
  const card = event.target.closest('.node'), control = event.target.closest('button,a,input,textarea,select,summary');
  if (event.button === 0 && ((control && control !== card) || event.target.closest('.question-title') || (event.target.closest('.expanded-node') && !event.target.closest('.node-head')))) return;
  event.preventDefault();
  if (!card && !event.target.closest('.expanded-node')) $('map').focus({ preventScroll: true });
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
});
window.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  if (!event.buttons) return endDrag(event);
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.active && Math.hypot(dx, dy) < 4) return;
  if (!drag.active) {
    drag.active = true; suppressClick = true;
    $('map').setPointerCapture(event.pointerId); $('map').classList.add('dragging'); $('map').focus({ preventScroll: true });
    const selection = window.getSelection();
    if ($('map').contains(selection?.anchorNode)) selection.removeAllRanges();
  }
  event.preventDefault();
  view.x += dx; view.y += dy; drag.x = event.clientX; drag.y = event.clientY; transform();
});
for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, endDrag);
$('map').addEventListener('lostpointercapture', event => { if (event.target === $('map')) endDrag(event); });
window.addEventListener('blur', () => endDrag());
document.addEventListener('visibilitychange', () => { if (document.hidden) { endDrag(); void draftClient.flush(true).catch(() => {}); } else refreshRevisitDay(); });
$('map').addEventListener('click', event => {
  if (suppressClick && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
}, true);
$('map').addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
$('map').addEventListener('dragstart', event => { if (event.target.closest('.node,.node-head') || drag?.active) event.preventDefault(); });
$('nodes').addEventListener('focusout', () => queueMicrotask(() => { if (!closed) renderMap(); }));
$('node-workspace').addEventListener('focusin', event => { if (expanded && !restoringFocus) { revealNode(selected); revealQuestionStage(event.target); } });
$('node-workspace').addEventListener('compositionstart', event => { composing = event.target; renderCleanup(); });
$('node-workspace').addEventListener('compositionend', () => {
  composing = null;
  renderCleanup();
});
$('map').addEventListener('keydown', event => {
  if (outlineMode || event.isComposing || event.defaultPrevented || event.target.matches('select')) return;
  if (event.key === 'Escape' && expanded) { event.preventDefault(); collapseNode(); return; }
  if (event.target !== $('map')) return;
  const direction = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
  if (direction) { event.preventDefault(); view.x += direction[0]; view.y += direction[1]; transform(); }
  if (['+', '=', '-', '0', 'Home'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'Home') { collapseNode(false); fit(); }
    else zoom(event.key === '0' ? 1 / view.zoom : event.key === '-' ? 1 / 1.2 : 1.2);
  }
});
$('map').addEventListener('wheel', event => {
  if (!outlineMode) navigation.wheel(event, $('map').getBoundingClientRect());
}, { passive: false });
window.addEventListener('beforeunload', event => { if (draftClient.pending()) { void draftClient.flush(true).catch(() => {}); event.preventDefault(); event.returnValue = ''; } });
const mapObserver = new ResizeObserver(() => {
  if (outlineMode) return;
  const rect = $('map').getBoundingClientRect();
  if (!state.document || !rect.width || !rect.height) return;
  if (firstFit) { viewportSize = { width: rect.width, height: rect.height }; refreshScene(null); expanded ? centerSelected() : fit(); firstFit = false; return; }
  if (viewportSize && rect.width === viewportSize.width && rect.height === viewportSize.height) return;
  endDrag();
  if (viewportSize) {
    view.x += (rect.width - viewportSize.width) / 2;
    if (!expanded) view.y += (rect.height - viewportSize.height) / 2;
  }
  viewportSize = { width: rect.width, height: rect.height };
  refreshScene();
  if (expanded) revealNode(selected);
});
mapObserver.observe($('map'));
const workspaceObserver = new ResizeObserver(() => { if (expanded) scheduleLayout(); });
workspaceObserver.observe($('node-workspace'));
const fontsChanged = () => { fontEpoch++; scheduleLayout(); };
document.fonts?.addEventListener('loadingdone', fontsChanged);
window.addEventListener('pagehide', event => {
  closeContributors(false);
  comments.close(false);
  reviewHandoffs.close(false);
  if ($('history-dialog').open) closeHistory(true);
  closeAnswerChange();
  closeReviewQueue(true);
  closeScenarioFork(true);
  closePreference(true);
  closeComparison(true);
  if ($('project-merge-dialog').open) closeProjectMerge();
  if ($('project-reconcile-dialog').open) closeProjectReconciliation();
  if ($('project-copy-dialog').open) closeProjectCopy();
  clearProjectListing('Page suspended. Refresh project journeys before selecting.');
  if (viewerTarget) { invalidateViewer('The page was suspended. Reopen Export maps and preview again.'); viewerTarget = null; $('viewer-preview').disabled = true; }
  closeResearchReview();
  suspended = true; pageEpoch++; actionEpoch++; stopPolling(); actionAbort?.abort(); actionAbort = null; busy = false;
  cancelProjectGitStatus(); renderProjectGitStatus();
  minimap.reset();
  if ($('diagnostics-dialog').open) closeDiagnostics();
  cleanup.cancel();
  closeBrief();
  closeCheck();
  closeAdrScope();
  closeAdrFormat();
  closeAdrFile();
  closeAdrQuestions();
  questionHelp.dispose();
  void draftClient.flush(true).catch(() => {});
  if (event.persisted) return;
  closed = true; clearTimeout(pollTimer); cancelAnimationFrame(layoutFrame); endDrag();
  minimap.dispose();
  mapObserver.disconnect(); workspaceObserver.disconnect(); document.fonts?.removeEventListener('loadingdone', fontsChanged);
  geometryCache.clear(); fitGeometry.clear(); fitBranches = null; geometryBranches = null; geometryInputs = ''; positions.clear(); branches = null;
});
window.addEventListener('pageshow', event => {
  if (!event.persisted || closed || !suspended) return;
  suspended = false; pageEpoch++; pollFailures = 0; stateCursor = null; workspace?.refreshRevisit?.(); void (poll());
  minimap.update();
});
async function poll() {
  if (closed || suspended || pollFlight) return;
  refreshRevisitDay();
  clearTimeout(pollTimer);
  const epoch = actionEpoch, page = pageEpoch, abort = new AbortController(), flight = { abort };
  pollFlight = flight;
  const current = () => !closed && !suspended && page === pageEpoch && !busy && epoch === actionEpoch && pollFlight === flight;
  const timeout = setTimeout(() => abort.abort(), 8000);
  try {
    if (busy) return;
    const cursor = stateCursor;
    const response = await fetch('api/state', { signal: abort.signal, headers: cursor ? { 'X-Explorer-State': cursor } : {} });
    if (!response.ok) throw new Error('Canvas connection lost.');
    const nextCursor = response.headers.get('X-Explorer-State');
    if (response.status === 204 && (!cursor || nextCursor !== cursor)) throw new Error('Canvas state needs a full refresh.');
    const next = response.status === 204 ? null : await response.json();
    if (!current()) return;
    if (next) apply(next);
    stateCursor = nextCursor; pollFailures = 0; connectionStatus();
    await questionHelp.checkRetained();
    if (current() && $('brief-dialog').open) await requestBrief('poll');
    if (current() && $('check-dialog').open) await requestCheck('poll');
  } catch {
    if (current()) { stateCursor = null; pollFailures = Math.min(pollFailures + 1, 4); connectionStatus('Reconnecting... Your draft stays here. Reopen Explorer if the connection does not recover.'); }
  } finally {
    clearTimeout(timeout);
    if (pollFlight === flight) {
      pollFlight = null;
      if (!closed && !suspended && page === pageEpoch) pollTimer = setTimeout(poll, pollFailures ? Math.min(15000, 1200 * 2 ** pollFailures) : document.hidden ? 4000 : 1200);
    }
  }
}
void poll();
