import { attachDashboard } from './dashboard.mjs';
import { GeometryCache, viewportBounds, intersects, branchView, revealPath } from './layout.mjs';
import { attachVoice } from './voice.mjs';
import { DraftClient } from './drafts.mjs';
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
let stateCursor = null, pollFlight = null, pollFailures = 0, pageEpoch = 0, suspended = false, actionAbort = null;
function stopPolling() {
  clearTimeout(pollTimer); pollFlight?.abort.abort(); pollFlight = null; stateCursor = null;
}
function connectionStatus(message = '') { $('connection-status').textContent = message; $('connection-status').hidden = !message; }
let libraryView = false, libraryEpoch = 0, libraryRevision = 0, importDocument = null;
let librarySearchTimer, librarySearchFlight = false, librarySearchQueued = false, librarySearchNext = null;
let outlinePage = 0, outlineFilterStamp = '', outlineMode = false, outlineNavigated = false;
let revisitDay = localDate();
let nextQuestion = new NextQuestion(), nextQuestionOpen = false, nextQuestionStamp = '';
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
let guidanceReturn = null, guidanceBase = null, guidanceNeedsChoice = false, guidanceNeedsRefresh = false;
const showModeDescription = id => { $(`${id}-description`).textContent = MODES[$(id).value].description; };
let previewEdits = null, acceptedIds = new Set(), acceptedParentId = null;
let references = { journey: null, revision: 0, nodeIds: [], error: '', loading: false, saving: false, retryIds: null, open: false, epoch: 0 };
const drafts = new Map(), nodeUi = new Map();
const draftClient = new DraftClient({ fetch: (...args) => fetch(...args), drafts,
  changed: () => { cleanup.sync(); const node = state.document?.nodes.find(n => n.id === selected); if (node && !closed) { answerStatus(node); renderDraftRecovery(node); renderDraftSummary(); renderCleanup(); renderOutline(); } },
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
  ['center-question', 'Center question'], ['minimap-toggle', 'Show minimap'], ['navigation-open', 'Map settings'],
  ['edit-guidance', 'Edit guidance'], ['history-open', 'History'], ['recovery-open', 'Recovery'],
  ['visual-export-open', 'Export maps'], ['decision-brief', 'Decision brief'], ['implementation-handoff', 'Implementation handoff'],
  ['check-answers', 'Check answers'], ['challenge-decisions', 'Challenge decisions'], ['research-request', 'Research options'],
];
let paletteEpoch = 0, paletteTimer, paletteFlight = false, paletteQueued = false, paletteNext = null;
let palettePage = 0, paletteReturn = null, paletteOrigin = '', paletteActing = false;
const paletteIdentity = () => JSON.stringify([state.activeKey ?? state.document?.id, selected]);
const paletteOpen = () => $('palette-dialog').open && !closed && !suspended;
function paletteReason(id) {
  const target = $(id);
  if (!target || target.closest('[hidden]')) return 'Unavailable in this view. Open the relevant journey or question.';
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
      closePalette(false); target.focus({ preventScroll: true }); target.click();
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
    if (!result.importConflict && action !== 'context-coverage') apply(result, ['start', 'open', 'import'].includes(action)); return result;
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
    ui.researchOpen = panel.querySelector('.research-disclosure')?.open ?? false;
    ui.rationaleOpen = panel.querySelector('#question-rationale')?.open ?? false;
    ui.importanceOpen = panel.querySelector('#question-importance')?.open ?? false;
    ui.helpOpen = panel.querySelector('#question-help')?.open ?? false;
    ui.manualOpen = panel.querySelector('.manual')?.open ?? false;
    if (!references.error) references.open = panel.querySelector('#references')?.open ?? references.open;
  }
}
function apply(next, reset = false) {
  const stamp = JSON.stringify(next);
  if (stamp === signature && !reset) return;
  captureWorkspace();
  const workspaceFocused = $('node-workspace').contains(document.activeElement);
  const compactFocused = $('nodes').contains(document.activeElement);
  const previousSelection = selected;
  const changedDocument = reset || state.document?.id !== next.document?.id || state.activeKey !== next.activeKey;
  if (viewerTarget && (changedDocument || viewerTarget.journey !== (next.activeKey ?? next.document?.id) || viewerTarget.revision !== next.document?.revision)) {
    invalidateViewer('The journey changed. Reopen Export maps and preview again.');
    viewerTarget = null; $('viewer-preview').disabled = true;
  }
  const firstQuestions = (state.document ? questionCounts(state.document).total : 0) === 0 && (next.document ? questionCounts(next.document).total : 0) > 0;
  const anchor = changedDocument ? null : anchorPoint();
  if (changedDocument) {
    outlineNavigated = false;
    minimap.reset();
    if (state.document?.id !== next.document?.id || state.activeKey !== next.activeKey) nextQuestion = new NextQuestion();
    nextQuestionOpen = false; nextQuestionStamp = ''; $('next-question').hidden = true;
    closeResearchReview();
    closeBrief();
    closeCheck();
    lastCoverage = ''; $('context-coverage').textContent = 'Check the selected node or start a request to see coverage.';
    cleanup.cancel();
    questionHelp.sync();
    voice.cancel();
    geometryCache.clear(); fitGeometry.clear(); fitBranches = null; geometryBranches = null; geometryInputs = '';
    $('nodes').replaceChildren(); $('edges').replaceChildren();
    workspace = null; composing = null; drafts.clear(); nodeUi.clear(); positions.clear(); collapsed.clear(); branches = null; focusId = null; wholeView = null; $('node-workspace').replaceChildren();
    selected = next.document?.rootId ?? null; expanded = next.document?.nodes.length === 1; firstFit = true;
    $('start-objective').value = ''; $('start-criteria').value = ''; $('start-mode').value = 'understand'; showModeDescription('start-mode'); $('start-guidance').open = false;
    if ($('history-dialog').open) closeHistory();
    if ($('recovery-dialog').open) closeRecovery();
    if ($('guidance-dialog').open) $('guidance-dialog').close();
    acceptedIds.clear(); acceptedParentId = null;
  }
  signature = stamp; state = next;
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
    if (!ids.has(selected)) { voice.cancel(); composing = null; workspace = null; $('node-workspace').replaceChildren(); selected = doc.rootId; expanded = false; focusId = null; wholeView = null; }
    else if (focusId && !ids.has(focusId)) { focusId = null; wholeView = null; }
    collapsed = new Set([...collapsed].filter(id => ids.has(id)));
    branches = branchView(doc.nodes, doc.rootId, collapsed, focusId);
  }
  updateFocusStatus();
  showView();
  $('decision-brief').hidden = !doc;
  $('implementation-handoff').hidden = !doc;
  $('check-answers').hidden = !doc; $('challenge-decisions').hidden = !doc;
  $('save-file').hidden = !doc; $('finish').hidden = !doc; $('finish').disabled = !!state.pending;
  $('visual-export-open').hidden = !doc;
  $('edit-guidance').disabled = !!state.pending;
  if (state.contextCoverage && JSON.stringify(state.contextCoverage) !== lastCoverage) { lastCoverage = JSON.stringify(state.contextCoverage); showCoverage(state.contextCoverage, 'Prepared'); }
  notice(state.error || state.recoveryNotice?.message || (['failed', 'interrupted'].includes(state.exportObservation?.status) ? 'Export did not finish. Open Recovery to explicitly retry. Browser file saving is unknown.' : ''));
  if (!doc) return;
  if (firstQuestions && selected === doc.rootId) expanded = false;
  $('map-title').textContent = doc.topic;
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
    'no-goal': 'Save an objective in Edit guidance before requesting a suggestion. No goal is inferred from your topic.',
    empty: 'There are no existing questions to prioritize. Review your goal and decide whether this map is useful enough to finish; more questions are not necessarily progress.',
    resolved: 'All recorded questions are decided or marked not relevant, with no needs-review flags. Review your conclusions and remaining uncertainty; finishing is your choice.',
    excluded: 'The remaining questions are deferred or need source review. Review them in Outline when appropriate; this does not mean the uncertainty is resolved.',
    dismissed: 'The matching questions are dismissed in this canvas. Other unresolved questions may still matter.',
    'no-match': 'No eligible question shares the supported literal words with current guidance. Useful work may remain: review the map or refine your guidance. This is not a conclusion that the map is complete.',
  };
  const { candidate, counts } = result;
  panel.replaceChildren(el('h2', { id: 'next-question-title', tabindex: '-1' }, 'A useful next question?'));
  if (candidate) {
    panel.append(el('p', {}, candidate.question), el('p', {}, `Why it may help: this ${ANSWER_STATES[candidate.state].toLowerCase()} question shares ${candidate.constraintTerms.length ? `constraint words: ${candidate.constraintTerms.join(', ')}. ` : ''}${candidate.goalTerms.length ? `objective / success-criteria words: ${candidate.goalTerms.join(', ')}.` : ''}`),
      el('p', { class: 'quiet' }, 'Local heuristic: distinct constraint matches first, then objective / success-criteria matches, then historical importance (high, medium, low, unranked), then stable question ID. This is not semantic reasoning or an optimal next action.'),
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
      panel.replaceChildren(el('h2', { id: 'next-question-title' }, 'Suggestion dismissed'), el('p', {}, 'Suggestion dismissed. Request another only when useful. Dismissal lasts in this canvas until this source or saved guidance changes, the journey switches, or the page reloads.'));
      $('suggest-next').focus({ preventScroll: true });
    }, { id: 'dismiss-next-question' })));
  } else panel.append(el('p', {}, messages[result.status]));
  panel.append(el('p', { class: 'quiet' }, `${counts.questions} questions scanned: ${counts.resolved} resolved, ${counts.deferred} deferred, ${counts.review} need source review; ${counts.eligible} eligible, ${counts.matched} literal matches, ${counts.dismissed} matching dismissals. Reminder urgency is separate.`),
    el('details', {}, el('summary', {}, 'Scope and limits'), el('p', {}, 'Uses all saved questions and complete objective, success criteria and constraints (up to 5,000 nodes and 16,000 guidance characters). Case-normalized Unicode word matching excludes words shorter than three characters and common English stop words; no stemming, synonyms or language understanding. Current question wording is matched, not historical rationale. Historical importance is not reassessed for current guidance. Selection uses saved answer states; saved answer changes reset dismissal but their words are not matched. Drafts, research, project files and private references are not consulted. No model calls or map changes.'),
      el('p', {}, 'Dismissal lasts in this canvas until that question’s saved source or guidance changes, the journey switches, or the page reloads. Other questions and reminders do not reset it. Opening a question is your choice; nothing is answered or generated.')),
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
  $('library-return').hidden = !state.document;
  document.body.classList.toggle('has-library', !!state.library);
}
async function refreshLibrary() {
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
      row.querySelector('h2').textContent = entry.topic;
      row.querySelector('.library-meta').textContent = `${entry.pinned ? 'Pinned · ' : ''}${entry.questionCount} questions · ${entry.lastOpenedAt ? 'Opened' : 'Edited'} ${new Date(entry.lastOpenedAt ?? entry.updatedAt).toLocaleString()}`;
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
function switchAllowed() {
  if (busy || closed || draftClient.savingAnswer) return false;
  if (state.pending) { notice('Cancel the current Copilot request before opening another journey.'); return false; }
  if (state.preview) { notice('Dismiss the unsaved question preview before switching journeys or restoring. Return to the map to review it.'); return false; }
  if ([...nodeUi.values()].some(ui => ui.question.length)) { notice('Add or clear your missing-direction drafts before opening another journey. Back to current map keeps your drafts.'); return false; }
  if (orphanReminderDrafts().length) {
    notice('Copy or discard removed-question reminder drafts before switching or restoring.');
    $('notice').append(button('Review removed reminders', revealOrphanReminders, { id: 'review-orphan-reminders' })); return false;
  }
  if ([...nodeUi.values()].some(ui => ui.revisitDraft)) { notice('Save your reminder edits or choose Use saved reminder before opening another journey.'); return false; }
  return true;
}
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
  const node = state.document.nodes.find(n => n.id === id);
  const parent = state.document.nodes.find(n => n.id === node?.parentId);
  return Math.max(16, Math.min(parent ? (parent.answer ? 150 : 110) + 72 + 24 : 24, height - 320));
}
function select(id, { outlineRow = false } = {}) {
  if (paletteOpen() && id !== selected) closePalette(false);
  if (!state.document?.nodes.some(n => n.id === id)) return;
  if (outlineMode) outlineNavigated = true;
  endDrag();
  voice.cancel();
  if (focusId && !withinFocus(id)) { focusId = null; wholeView = null; }
  collapsed = revealPath(state.document.nodes, collapsed, id);
  branches = branchView(state.document.nodes, state.document.rootId, collapsed, focusId);
  updateFocusStatus();
  const rect = $('map').getBoundingClientRect(), width = Math.min(560, rect.width - 32), old = anchorPoint(id);
  const anchor = { id, x: Math.max(width / 2 + 16, Math.min(rect.width - width / 2 - 16, old?.x ?? rect.width / 2)), y: focusTop(id, rect.height) };
  captureWorkspace(); selected = id; expanded = true; view.zoom = 1;
  renderWorkspace(); refreshScene(anchor); if (outlineMode && !outlineRow) revealOutlineSelection(false); else renderOutline(); $('expanded-title').focus({ preventScroll: true });
}
function toggleBranch(id, source) {
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
  branches = branchView(state.document.nodes, state.document.rootId, collapsed, focusId);
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
    'aria-label': `${label}: ${node.question}`, 'aria-expanded': String(!folded) });
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
  if (!focusId) return;
  if (outlineMode) outlineNavigated = true;
  endDrag();
  focusId = null;
  collapsed = revealPath(state.document.nodes, collapsed, selected);
  branches = branchView(state.document.nodes, state.document.rootId, collapsed);
  if (wholeView) view = wholeView;
  wholeView = null;
  updateFocusStatus();
  refreshScene(null);
  revealNode(selected);
  (expanded ? $('focus-branch') : $('map')).focus({ preventScroll: true });
}
function focusBranch(id) {
  if (id === state.document.rootId) { showWholeMap(); return; }
  if (outlineMode) outlineNavigated = true;
  if (!wholeView) wholeView = { ...view };
  focusId = id;
  branches = branchView(state.document.nodes, state.document.rootId, collapsed, focusId);
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
function compactSize(node) {
  return detailTier === 'overview' || detailTier === 'schematic' ? { width: 280, height: 200 } :
    { width: 220, height: detailTier === 'question' ? 128 : node.answer ? 150 : 110 };
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
  panel.style.transform = `scale(${1 / view.zoom})`;
  panel.style.setProperty('--heading-limit', `${Math.min(190, height * .42)}px`);
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
      card.title = n.question; card.dataset.state = effectiveAnswerState(n);
      card.setAttribute('aria-label', `${n.category}: ${n.question}. ${nodeStatus(n)}${isQuestion(n) ? `; ${importanceLabel(n)}` : ''}${n.review ? '; needs review' : ''}${hidden ? `; ${hidden}` : ''}${n.revisit ? `; reminder: ${revisitLabel(n)}` : ''}${n.answer ? `; Answer: ${n.answer}` : ''}; ${branches.nodeCounts.get(n.id)} descendant nodes`);
      card.style.left = `${p.x}px`; card.style.top = `${p.y}px`; card.style.width = `${p.width}px`; card.style.height = `${p.height}px`; card.style.setProperty('--branch', colors[p.branch % colors.length]);
      const summary = detailTier === 'overview' || detailTier === 'schematic';
      const status = (hidden || (root ? `${total} questions` : `${nodeStatus(n)}${n.review ? '; needs review' : ''}`)) + (summary && !hidden ? ` \u00b7 ${branches.nodeCounts.get(n.id)} below` : '') + (n.revisit ? ` · ${revisitLabel(n)}` : '');
      const stamp = JSON.stringify([n.category, n.question, n.answer, status, n.importance, detailTier]);
      if (card.renderStamp !== stamp) {
        card.renderStamp = stamp;
        card.replaceChildren(el('span', { class: 'category' }, el('span', { class: 'category-text' }, n.category), ...(isQuestion(n) ? [importanceBadge(n)] : [])), el('span', { class: 'question' }, summary && [...n.question].length > 48 ? [...n.question].slice(0, 48).join('') + '\u2026' : n.question),
          ...(detailTier === 'detail' && n.answer ? [el('span', { class: 'answer-preview' }, n.answer)] : []), el('span', { class: 'status' }, status));
      }
      if (branches.parentIds.has(n.id) && (detailTier !== 'schematic' || active?.dataset.branchId === n.id)) {
        let toggle = toggles.get(n.id); toggles.delete(n.id);
        if (!toggle) { toggle = branchButton(n); nodes.append(toggle); }
        const label = `${collapsed.has(n.id) ? 'Expand' : 'Collapse'} branch`;
        toggle.textContent = label; toggle.setAttribute('aria-label', `${label}: ${n.question}`); toggle.setAttribute('aria-expanded', String(!collapsed.has(n.id)));
        toggle.style.left = `${p.x + p.width - (summary ? 126 : 106)}px`; toggle.style.top = `${p.y + p.height - (summary ? 66 : detailTier === 'question' ? 50 : 36)}px`;
      }
    }
    const edge = geometryCache.value.edges.get(n.id);
    if (edge && intersects(edge.bounds, viewport)) {
      let path = paths.get(n.id); paths.delete(n.id);
      if (!path) { path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.dataset.edgeId = n.id; edges.append(path); }
      path.setAttribute('d', edge.path);
      path.setAttribute('class', n.id === selected || n.parentId === selected ? 'current' : '');
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
  if (drafts.has(node.id) || conflict) area.append(button('Discard draft', () => choose('discard'), { id: 'discard-draft' }));
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
function renderWorkspace() {
  cleanup.sync();
  questionHelp.sync();
  const panel = $('node-workspace'); captureWorkspace(); panel.hidden = !expanded;
  if (!expanded) return;
  const next = state.document.nodes.find(n => n.id === selected);
  const identity = `${referenceJourney()}/${next.id}/${next.kind ?? 'question'}`;
  if (workspace?.identity === identity && panel.firstChild) { workspace.update(); return; }
  voice.cancel(); composing = null;
  let doc, node, pending, byId;
  const owner = { identity, update: () => {} };
  const ui = uiFor(next.id), root = next.id === state.document.rootId;
  const current = () => !closed && expanded && !libraryView && workspace === owner && panel.isConnected && selected === next.id;
  const refresh = () => { doc = state.document; node = doc.nodes.find(n => n.id === next.id); pending = !!state.pending; byId = new Map(doc.nodes.map(n => [n.id, n])); };
  refresh();
  panel.dataset.nodeId = node.id; panel.replaceChildren();
  const headingArea = el('div', { class: 'workspace-region' }), content = el('div', { class: 'node-content' });
  panel.append(headingArea, content);
  const regions = new Map();
  // Named regions own their children; the answer form is never moved during an update.
  const region = (name, parent = content) => { const area = el('div', { class: 'workspace-region' }); parent.append(area); regions.set(name, { area, stamp: null }); };
  regions.set('heading', { area: headingArea, stamp: null });
  const update = (name, value, build) => {
    const part = regions.get(name), stamp = JSON.stringify(value);
    if (part.stamp === stamp) return;
    const focused = part.area.contains(document.activeElement) ? document.activeElement.id : null;
    part.stamp = stamp; part.area.replaceChildren(...[build()].flat().filter(Boolean));
    if (focused) ($(focused) ?? $('expanded-title'))?.focus({ preventScroll: true });
  };
  workspace = owner;
  region('rationale');
  region('importance');
  if (!root && isQuestion(node)) {
    const help = el('details', { id: 'question-help', class: 'question-help' }, el('summary', { id: 'question-help-summary' }, 'Help with this question'),
      el('p', { class: 'quiet' }, 'Model help explains this saved question. Your question and answer stay unchanged. For sourced or current information, use Explore options.'),
      el('div', { class: 'actions help-actions' },
        button('Rephrase', () => { voice.cancel(); void questionHelp.start('rephrase'); }, { id: 'help-rephrase' }),
        button('Give an example', () => { voice.cancel(); void questionHelp.start('example'); }, { id: 'help-example' }),
        button('Explain terms', () => { voice.cancel(); void questionHelp.start('terms'); }, { id: 'help-terms' })),
      el('div', { id: 'question-help-results', 'aria-live': 'polite' }));
    help.open = ui.helpOpen;
    help.addEventListener('toggle', () => { if (help.isConnected) ui.helpOpen = help.open; });
    content.append(help);
  }
  for (const name of ['references', 'pending', 'review', 'preview', 'retry']) region(name);
  if (root) {
    content.append(el('p', { class: 'quiet' }, 'Pick a connected question to explore it. Each question opens into its own workspace on the map.'), button(doc.nodes.length > 1 ? 'Find more directions' : 'Generate questions', () => api('questions', { nodeId: node.id }), { id: 'generate-questions', disabled: pending || !!state.preview }));
  } else if (!isQuestion(node)) {
    content.append(el('p', { class: 'quiet' }, 'Your original direction guides the next questions. It is not an answer or a decision.'), button('Explore this direction', () => api('questions', { nodeId: node.id }), { id: 'generate-questions', disabled: pending || !!state.preview }));
  } else {
    const form = el('form', { class: 'answer-form' }), answer = el('textarea', { id: 'answer', rows: '4', maxlength: '20000', placeholder: 'A decision, a hunch, or what you know so far…' });
    answer.value = drafts.get(node.id) ?? node.answer;
    const answerState = el('select', { id: 'answer-state', 'aria-describedby': 'answer-state-help' }, Object.entries(ANSWER_STATES).map(([value, label]) => el('option', { value }, label)));
    answerState.value = draftClient.state(node.id);
    answerState.addEventListener('focus', () => { if (current()) draftClient.touch(node.id); });
    answerState.addEventListener('change', () => { if (!current()) return; draftClient.selectState(node.id, answerState.value, answer.value); answerStatus(node); });
    answer.addEventListener('input', () => { if (!current()) return; draftClient.edit(node.id, answer.value); answerStatus(node); });
    answer.addEventListener('focus', () => { if (current()) draftClient.touch(node.id); });
    answer.addEventListener('compositionstart', () => { if (current()) draftClient.touch(node.id); });
    const save = async deepen => {
      if (!current()) return;
      if (deepen && state.preview) return notice('Accept or dismiss the unsaved question preview before generating again.');
      voice.cancel();
      cleanup.cancel();
      const error = answerStateError(answer.value, draftClient.state(node.id));
      if (error) return notice(error);
      if (deepen && draftClient.state(node.id) === 'unanswered') return notice('Choose a state or write an answer before exploring deeper.');
      if (ui.refreshAnswer) return notice('Refresh the saved journey before retrying.');
      try {
        if (!drafts.has(node.id)) draftClient.edit(node.id, answer.value);
        if (await draftClient.save(node.id, async (value, draftRevision, draftJourney, answerState) => {
          const result = await api('answer', { nodeId: node.id, answer: value, answerState, expand: deepen, draftRevision, draftJourney });
          if (!result && /Another canvas|map changed/.test($('notice').textContent)) { ui.refreshAnswer = true; if (current()) renderDraftRecovery(node); }
          return result;
        }, () => state.document.nodes.find(n => n.id === node.id))) {
          renderWorkspace(); refreshScene();
          if (deepen) notice('Answer saved. Copilot will propose follow-up questions for your review.');
        }
      } catch (error) { notice(error.message); }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void save(true); });
    form.addEventListener('keydown', event => { if (!event.isComposing && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(true); } });
    const voiceStatus = el('div', { class: 'voice-controls' });
    answer.setAttribute('aria-describedby', 'voice-status');
    voice.bind(answer, voiceStatus);
    form.append(el('div', { class: 'answer-label' }, el('label', { for: 'answer' }, 'Your answer'), el('span', { id: 'answer-status', class: 'quiet' })), answer, voiceStatus,
      button('Clean My Answer', () => { voice.cancel(); void cleanup.start(); }, { id: 'clean-answer', disabled: !answer.value.trim() }),
      el('div', { id: 'cleanup-review', 'aria-live': 'polite' }),
      el('div', { class: 'answer-state-field' }, el('label', { for: 'answer-state' }, 'Answer state'), answerState), el('p', { id: 'answer-state-help', class: 'quiet' }, 'Text and state stay a draft until you save. Decided, Tentative and Assumption need text; other states can have no note.'),
      el('div', { class: 'actions' }, button('Save answer', () => { voice.cancel(); void save(false); }, { id: 'save-answer', disabled: pending && !['research', 'research-follow-up'].includes(state.pending.kind) }), el('button', { type: 'submit', id: 'save-deeper', class: 'primary', disabled: pending }, 'Save & explore deeper')));
    const researchNote = el('p', { id: 'research-save-note', class: 'quiet' }, 'Save answer is available during research. Saving its source context discards that research. Wait or cancel research before Save & explore deeper.'); form.append(researchNote);
    form.append(button('Undo addition', () => {
      const addition = ui.addition;
      if (!addition || (drafts.get(node.id) ?? node.answer) !== addition.after) return;
      voice.cancel(); draftClient.edit(node.id, addition.before); answer.value = addition.before; ui.addition = null;
      answerStatus(node); answer.focus({ preventScroll: true }); notice('Addition undone. Your earlier draft is restored.');
    }, { id: 'undo-addition', class: 'undo-addition' }));
    form.append(el('div', { id: 'draft-recovery', 'aria-live': 'polite' }));
    content.append(form); answerStatus(node); renderDraftRecovery(node); renderCleanup(); renderQuestionHelp();
    const revisit = el('section', { class: 'revisit-editor', 'aria-labelledby': 'revisit-title' }, el('h3', { id: 'revisit-title' }, 'Revisit this question'),
      el('p', { id: 'revisit-status', role: 'status' }), el('p', { class: 'quiet' }, 'Optional local-calendar date or condition you evaluate yourself. No monitoring or notifications. Acknowledging records a review; it does not change your answer, certainty or ancestor review flag.'));
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
    content.append(revisit);
  }
  region('research');
  region('followup');
  region('children');
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
      branches = branchView(state.document.nodes, state.document.rootId, collapsed, focusId);
      renderWorkspace(); refreshScene();
      notice('Direction saved. Copilot will propose questions beneath it for your review.');
    }
  });
  details.append(manual); content.append(details);
  workspace.update = () => {
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    refresh();
    const ancestors = [];
    for (let n = byId.get(node.parentId); n; n = byId.get(n.parentId)) ancestors.push([n.id, n.category, n.question]);
    update('heading', [node.question, node.category, node.kind, focusId, collapsed.has(node.id), branches.parentIds.has(node.id), collapsed.has(node.id) ? hiddenSummary(node.id) : '', ancestors], () => {
      const path = [], byId = new Map(doc.nodes.map(n => [n.id, n]));
      for (let n = node; n; n = byId.get(n.parentId)) path.push(n);
      const crumbs = el('nav', { class: 'crumbs', 'aria-label': 'Question ancestors' });
      for (const n of path.toReversed().slice(0, -1).slice(-3)) {
        if (crumbs.childNodes.length) crumbs.append(el('span', {}, '/'));
        crumbs.append(button(n.id === doc.rootId ? 'Your idea' : n.category, () => select(n.id), { id: `ancestor-${n.id}`, title: n.question }));
      }
      const heading = el('header', { class: 'node-head' }, el('div', { class: 'node-meta' }, el('span', { class: 'category-label' }, node.kind === 'direction' ? nodeStatus(node) : node.category), el('div', { class: 'node-head-actions' }, button('Focus branch', () => focusBranch(node.id), { id: 'focus-branch', 'aria-pressed': String(focusId === node.id), 'aria-label': `Focus branch: ${node.question}` }), branchButton(node, true), button('Collapse node', () => collapseNode(), { id: 'collapse-node' }))), crumbs, el('h2', { id: 'expanded-title', class: 'question-title', tabindex: '-1' }, node.question));
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
    update('review', [node.review, isQuestion(node)], () => node.review ? el('p', { class: 'note' }, isQuestion(node) ? 'An earlier answer changed. Review this question and save your answer again when it still fits.' : 'An earlier answer changed. Review this direction and generate fresh questions when needed.') : null);
    if ($('revisit-date')) {
      const draft = ui.revisitDraft, conflict = draft && draft.base !== JSON.stringify(node.revisit ?? null);
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
    update('preview', preview?.id ?? null, () => preview ? renderQuestionPreview() : null);
    if (preview) {
      $('preview-stale').hidden = !preview.stale;
      $('accept-questions').disabled = preview.stale || !previewEdits.questions.some(q => q.selected);
      if (preview.stale) $('preview-retry').hidden = false;
    }
    update('retry', [!!state.preview, pending, state.error], () => !state.preview && !pending && /saved question context changed/.test(state.error) ? button('Refresh saved journey & generate again', async () => {
      if (await api('refresh-answer') && current()) await api('questions', { nodeId: node.id });
    }, { id: 'refresh-question-context' }) : null);
    update('research', node.research ?? null, () => {
      if (root || !isQuestion(node)) return;
      const research = el('details', { class: 'research-disclosure' }, el('summary', { id: 'research-summary' }, 'Explore options')); research.open = ui.researchOpen;
      research.addEventListener('toggle', () => { if (research.isConnected) { ui.researchOpen = research.open; scheduleLayout(); } });
      research.append(el('p', { class: 'quiet' }, 'A separate researcher compares possibilities using your saved answers and states. Review its context before starting. Suggestions stay separate from your answer; normal Copilot usage applies.'), button(node.research ? 'Research again' : 'Research options', () => { research.open = true; ui.researchOpen = true; openResearchReview(node.id); }, { id: 'research-request', disabled: pending }));
      if (node.research) research.append(renderResearch(node));
      return research;
    });
    update('children', doc.nodes.filter(n => n.parentId === node.id).map(n => [n.id, n.question]), () => {
      const children = doc.nodes.filter(n => n.parentId === node.id);
      if (children.length) return el('div', { class: 'followups' }, el('h3', {}, root ? 'Explore a direction' : 'Explore this branch'), el('p', { class: 'quiet' }, 'Connected below this node.'), children.map(child => button(child.question, () => select(child.id), { id: `followup-${child.id}`, class: 'followup' })));
    });
    update('followup', !!node.research, () => node.research ? renderFollowup(node) : null);
    updateFollowupHistory(node);
    for (const id of ['research-request', 'followup-review', 'save-deeper']) if ($(id)) $(id).disabled = pending;
    if ($('research-save-note')) $('research-save-note').hidden = !['research', 'research-follow-up'].includes(state.pending?.kind);
    if ($('save-answer')) $('save-answer').disabled = pending && !['research', 'research-follow-up'].includes(state.pending.kind);
    for (const id of ['generate-questions', 'add-direction']) if ($(id)) $(id).disabled = pending || !!state.preview;
    if (root && $('generate-questions')) $('generate-questions').textContent = doc.nodes.length > 1 ? 'Find more directions' : 'Generate questions';
    if ($('manual-question').value !== ui.question) $('manual-question').value = ui.question;
    const answer = $('answer'), value = drafts.get(node.id) ?? node.answer;
    if (answer && answer !== composing && answer.value !== value) answer.value = value;
    if (answer) { answerStatus(node); renderDraftRecovery(node); renderCleanup(); renderQuestionHelp(); }
    if (focused?.isConnected && focused.disabled) ($('cancel-request') ?? $('expanded-title')).focus({ preventScroll: true });
  };
  workspace.update();
  content.scrollTop = ui.scroll;
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
    branches = branchView(state.document.nodes, state.document.rootId, collapsed, focusId); refreshScene();
  }));
}
function renderQuestionPreview() {
  const batch = state.preview, edits = previewEdits.questions;
  const section = el('section', { id: 'question-preview', class: 'question-preview', 'aria-labelledby': 'preview-title' },
    el('h3', { id: 'preview-title' }, 'Review suggested questions'),
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
    if (await api('refresh-answer')) await api('questions', { nodeId: state.document.nodes.some(n => n.id === batch.nodeId) ? batch.nodeId : state.document.rootId });
  }, { id: 'preview-retry' }); retry.hidden = !batch.stale; section.append(retry);
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
  $('research-review-title').textContent = challenge ? 'Challenge decisions: review selected inputs' : 'Review research context';
  $('research-review-description').textContent = challenge ? 'Select saved answers for one tool-free hypothesis review. This does not change exploration mode. No new evidence is retrieved from the web; selected project excerpts are unverified inputs. Prior research and claims are excluded. References identify your inputs, not evidence support.' : 'Review the Explorer-supplied input for the isolated research helper. Choices apply only to this request. Viewing or excluding context starts no inference.';
  $('research-review-start').textContent = challenge ? 'Start reviewed challenge' : 'Start reviewed research';
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
  if (!value) {
    if (!researchReview.loading || !area.children.length) area.replaceChildren(...(challenge ? [projectControls] : []));
    if (researchReview.loading) for (const id of ['project-paths', 'project-read', 'project-clear']) { const control = $(id); if (control) control.disabled = true; }
    return;
  }
  const { context, coverage, bytes, limit, prompt, instructions, settings } = value.prepared;
  const display = (label, item) => el('section', { class: 'review-record' }, el('h3', {}, label), el('pre', {}, JSON.stringify(item, null, 2)));
  const { topic, objective, successCriteria, mode, pins } = context;
  const controls = el('section', { class: 'review-record research-preferences' }, el('h3', {}, 'Research preferences'));
  for (const [key, label, choices] of (challenge ? [] : [
    ['depth', 'Depth', [['quick', 'Quick - 60 seconds / 8 tool attempts'], ['standard', 'Standard - 180 seconds / 24 tool attempts'], ['deeper', 'Deeper - 300 seconds / 40 tool attempts']]],
    ['sourceFocus', 'Source focus', [['balanced', 'Balanced evidence'], ['primary', 'Prefer primary sources']]],
    ['recency', 'Recency', [['any', 'No recency preference'], ['recent', 'Prefer recent sources when relevant']]],
  ])) {
    const select = el('select', { 'data-setting': key, id: `research-${key}` }, ...choices.map(([id, title]) => el('option', { value: id }, title)));
    select.value = settings[key]; select.disabled = reviewStarting;
    select.addEventListener('change', () => researchReview.settings({ ...researchReview.context.settings, [key]: select.value }));
    controls.append(el('label', {}, label, select));
  }
    const rows = [...(challenge ? [el('p', {}, 'One owned helper; 180 seconds operation allowance; zero tools; up to 12 findings. Shutdown/accounting may continue afterward. Usage is retained as Explorer Challenge Review; no price estimate is available.'), ...(value.prepared.canStart ? [] : [el('p', { class: 'notice' }, 'Select at least one saved nonempty answer to challenge. Tentative answers remain tentative; guidance alone is not a decision.')])] : [controls, el('p', { id: 'research-settings-summary' }, researchSettingsText(settings))]), el('p', {}, `${bytes.toLocaleString()} / ${limit.toLocaleString()} UTF-8 bytes for actual instructions plus prompt. Omitted ${coverage.omitted.path} ancestors and ${coverage.omitted.decisionsElsewhere} other answers: ${coverage.omitted.budget} for size, ${coverage.omitted.scope} by scope, ${coverage.omitted.excluded ?? 0} excluded. Saved journey records are complete; project prefixes are labeled separately.`),
    display('Required: committed journey guidance and mode', { topic, objective, successCriteria, mode, pins }),
      display(challenge ? 'Required: journey root' : 'Required: selected question and committed answer state', context.path.at(-1))];
  if (challenge) {
    rows.unshift(projectControls);
    if (!context.projectSources?.length) rows.push(el('p', { id: 'project-empty' }, researchReview.projectDraft.trim() ? 'No files are attached to this preview. Read/refresh the entered paths or remove them before starting.' : 'No project files selected.'));
    if (!value.prepared.projectFresh) rows.push(el('p', { id: 'project-stale', class: 'notice' }, 'Project files or working root changed or are unavailable. These are the previously reviewed excerpts. Explicitly read/refresh files and review again before starting.'));
    for (const source of context.projectSources ?? []) rows.push(el('section', { class: 'review-record' }, el('h3', {}, `Project source: ${source.name}`), el('p', {}, `${source.excerptBytes} / ${source.bytes} UTF-8 bytes included${source.truncated ? ' (prefix excerpt)' : ' (complete file)'}. ${value.prepared.projectFresh ? 'Current at last check.' : 'Stale or unavailable.'} Source ${source.id}; SHA-256 ${source.fingerprint}`), el('pre', {}, source.excerpt)));
  } else rows.unshift(el('p', { class: 'quiet' }, 'Project files are excluded from web research and follow-ups. Selected files are available only in an explicit Challenge decisions review.'));
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
  const result = await api(value.prepared.followup ? 'research-follow-up' : 'research', { journey: value.journey, nodeId: value.nodeId, token: value.token });
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
    const answer = $('answer'), content = answer.closest('.node-content');
    answer.focus({ preventScroll: true }); answer.setSelectionRange(value.length, value.length);
    // Scroll only the editor, never an ancestor of the transformed map.
    content.scrollTop += (answer.getBoundingClientRect().top - content.getBoundingClientRect().top) / view.zoom - 40;
    notice('Added to your draft. Edit it before saving, or undo the addition.');
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
  const active = document.activeElement, editorFocus = $('node-workspace').contains(active);
  endDrag(); suppressClick = false; cancelAnimationFrame(layoutFrame); if (value) outlineNavigated = false; outlineMode = value;
  $('working-view').classList.toggle('outline-mode', value);
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
  const filtered = !!(filters.query || filters.state !== 'all' || filters.importance !== 'all' || filters.research || filters.review || filters.drafts || filters.reminder !== 'all');
  const children = new Map(state.document.nodes.map(n => [n.id, []])), byId = new Map(state.document.nodes.map(n => [n.id, n]));
  for (const n of state.document.nodes) if (n.parentId) children.get(n.parentId).push(n);
  const entries = [], stack = [{ node: byId.get(state.document.rootId), depth: 0 }];
  while (stack.length) {
    const item = stack.pop(), n = item.node;
    const draft = drafts.get(n.id) ?? draftClient.entries.get(n.id)?.conflict?.text ?? null;
    const match = matchSearch(n, filters, { draft });
    if (match) entries.push({ ...item, ...match, parent: byId.get(n.parentId)?.question });
    if (filtered || !collapsed.has(n.id)) for (const node of children.get(n.id).toReversed()) stack.push({ node, depth: item.depth + 1 });
  }
  return { entries, filtered, filters };
}
function revealOutlineSelection(focus = true) {
  if (!outlineMode || !selected) return;
  outlineNavigated = true;
  $('outline-reset').click();
  collapsed = revealPath(state.document.nodes, collapsed, selected);
  branches = branchView(state.document.nodes, state.document.rootId, collapsed, focusId);
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
  const stamp = JSON.stringify([filterStamp, outlinePage, selected, matches.map(({ node: n, parent, depth, snippet, hasDraft }) => [n.id, n.question, n.category, nodeStatus(n), n.review, !!n.research, n.revisit, n.importance, parent, depth, snippet, hasDraft, collapsed.has(n.id) ? hiddenSummary(n.id) : ''])]);
  if ($('outline-list').renderStamp === stamp) return;
  $('outline-list').renderStamp = stamp;
  const scroll = $('outline-list').scrollTop;
  const focused = $('outline-list').contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
  const focusedBranch = $('outline-list').contains(document.activeElement) ? document.activeElement.dataset.branchId : null;
  const page = matches.slice(outlinePage * SEARCH_PAGE_SIZE, (outlinePage + 1) * SEARCH_PAGE_SIZE);
  $('outline-mode-hint').textContent = filtered ? 'Filtered results across the full journey, including folded branches. Levels and parents show original ancestry.' : 'Journey hierarchy. Fold branches to hide descendants. Search includes folded nodes. The selected editor remains available even when its row is hidden.';
  $('outline-count').textContent = `${matches.length} matching nodes${matches.length ? `; showing ${outlinePage * SEARCH_PAGE_SIZE + 1}\u2013${outlinePage * SEARCH_PAGE_SIZE + page.length}` : '. No nodes match these filters.'}`;
  $('outline-previous').disabled = outlinePage === 0; $('outline-next').disabled = (outlinePage + 1) * SEARCH_PAGE_SIZE >= matches.length;
  $('outline-list').replaceChildren(...page.map(item => {
    const n = item.node;
    return el('div', { class: 'outline-row', role: 'listitem', style: `--depth:${filtered ? 0 : Math.min(item.depth, 4)}`, 'data-depth': item.depth },
      button([n.question, el('small', {}, `Level ${item.depth + 1}${item.parent ? ` \u00b7 Parent: ${item.parent}` : ' \u00b7 Journey root'}`), el('small', {}, `${n.category} \u00b7 ${nodeStatus(n)}${n.review ? '; needs review' : ''}${n.research ? ' \u00b7 Research available' : ''}${collapsed.has(n.id) ? ` \u00b7 ${hiddenSummary(n.id)}` : ''}${n.revisit ? ` \u00b7 Reminder: ${revisitLabel(n)}` : ''}`), ...(isQuestion(n) ? [importanceBadge(n)] : [])], () => select(n.id, { outlineRow: true }), { 'data-node-id': n.id, 'aria-current': String(n.id === selected) }),
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
  const settings = $('voice-settings');
  if (!settings) { $('diagnostics-status').textContent = 'Expand a question, then open Voice settings beside its answer editor.'; return; }
  closeDiagnostics(); $('navigation-dialog').close(); settings.open = true; settings.querySelector('summary').focus();
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
function closeHistory() {
  historyEpoch++; historySelection = null; $('history-dialog').close();
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
  const epoch = ++historyEpoch, journey = historyJourney(); historySelection = null;
  $('history-restore').disabled = true; $('history-preview').replaceChildren(); $('history-status').textContent = 'Loading saved version...';
  try {
    const result = await historyRead(revision, epoch, journey); if (!result) return;
    historyRevision = result.revision; historySelection = result.preview.matchesCurrent ? null : revision;
    const preview = result.preview;
    const content = el('textarea', { readonly: '', rows: '8', 'aria-label': 'Saved snapshot content' }); content.value = JSON.stringify(result.document, null, 2);
    $('history-preview').replaceChildren(el('h3', {}, `Restore revision ${revision}`), el('p', {}, `${result.label} | ${new Date(result.time).toLocaleString()}`),
      el('p', {}, `Compared with current revision ${result.revision} (${result.current.label}): ${preview.changed} changed, ${preview.added} restored and ${preview.removed} removed nodes. ${preview.guidanceChanged ? 'Guidance will change.' : 'Guidance is unchanged.'} Answers, answer states and research will come from this version. Local drafts will be preserved for review.`),
      el('details', {}, el('summary', {}, 'Inspect saved content'), content));
    $('history-status').textContent = result.pending ? 'Cancel the current Copilot request before restoring.' : result.preview.matchesCurrent ? 'This version already matches the saved journey. No restore is needed.' : 'Review the preview, then explicitly restore this version.';
    $('history-restore').disabled = historySelection === null || result.pending;
  } catch (error) { if (epoch === historyEpoch) $('history-status').textContent = error.message; }
}
async function loadHistory(undo = false) {
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
$('history-close').addEventListener('click', closeHistory);
$('history-dialog').addEventListener('cancel', event => { event.preventDefault(); closeHistory(); });
$('history-refresh').addEventListener('click', async () => { if (await api('refresh-answer')) await loadHistory(); else $('history-status').textContent = $('notice').textContent; });
$('checkpoint-form').addEventListener('submit', async event => {
  event.preventDefault(); const epoch = historyEpoch, journey = historyJourney();
  if (await api('checkpoint', { journey, revision: historyRevision, snapshotRevision: historyRevision, name: $('checkpoint-name').value })) {
    if (epoch === historyEpoch && journey === historyJourney()) { $('checkpoint-name').value = ''; await loadHistory(); }
  } else if (epoch === historyEpoch && journey === historyJourney()) $('history-status').textContent = $('notice').textContent;
});
$('history-restore').addEventListener('click', async () => {
  if (historySelection === null || busy) return;
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

function dirtyNodes() { return state.document?.nodes.filter(n => drafts.has(n.id) || draftClient.entries.get(n.id)?.conflict) ?? []; }
$('start-form').addEventListener('submit', async event => { event.preventDefault(); await switchJourney('start', { topic: $('topic').value, objective: $('start-objective').value, successCriteria: $('start-criteria').value, mode: $('start-mode').value }); });
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
$('library-toggle').addEventListener('click', () => { voice.cancel(); libraryView = true; showView(); void refreshLibrary(); $('library-search').focus(); });
$('library-return').addEventListener('click', () => { libraryEpoch++; libraryView = false; showView(); refreshScene(); $('map').focus({ preventScroll: true }); });
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
let briefOperation = 'brief';
const handoffReview = new ResearchReviewClient({ fetch: (...args) => fetch(...args), changed: renderHandoffPreview });
let briefView = null, briefId = null, briefJourney = null, briefEpoch = 0, briefBusy = false, briefAbort = null, briefStamp = '', briefEdits = new Map();
function closeBrief() {
  briefEpoch++; briefAbort?.abort(); briefAbort = null; handoffReview.close();
  if (briefId && briefJourney) void fetch(`api/${briefOperation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action: 'discard', id: briefId, journey: briefJourney }) }).catch(() => {});
  briefId = null; briefJourney = null; briefView = null; briefStamp = ''; briefEdits.clear(); briefBusy = false;
  if ($('brief-dialog').open) $('brief-dialog').close();
  briefOperation = 'brief';
}
async function requestBrief(action) {
  if (briefOperation === 'handoff' && action === 'start' && (!handoffReview.value || Date.now() >= handoffReview.value.expiresAt)) { $('handoff-preview-status').textContent = 'Preview the current selection again before starting.'; return; }
  if (!briefId || briefBusy || closed || suspended || action === 'accept' && busy) return;
  const writesMap = action === 'accept';
  if (writesMap) { busy = true; actionEpoch++; stateCursor = null; pollFlight?.abort.abort(); }
  const mapEpoch = actionEpoch;
  const epoch = briefEpoch, id = briefId, journey = briefJourney, abort = new AbortController(); briefAbort = abort;
  const timer = setTimeout(() => abort.abort(), 5000);
  briefBusy = true;
  for (const name of ['generate-brief', 'accept-brief', 'discard-brief']) $(name).disabled = true;
  try {
    const response = await fetch(`api/${briefOperation}`, { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' },
      body: JSON.stringify({ action, id, journey, ...(briefOperation === 'handoff' && action === 'start' ? { token: handoffReview.value.token } : {}), ...(action === 'accept' ? { revision: state.document.revision, edits: [...briefEdits].map(([id, text]) => ({ id, text })) } : {}) }) });
    const result = await response.json();
    if (epoch !== briefEpoch || id !== briefId || closed || writesMap && mapEpoch !== actionEpoch) return;
    if (!response.ok) throw new Error(result.error);
    if (result.id !== id) throw new Error('Decision brief response did not match this request.');
    if (result.snapshot) apply(result.snapshot);
    briefView = result;
    if (briefOperation === 'handoff' && action === 'start') { handoffReview.close(); renderHandoffPreview(); }
    if (action === 'discard') { briefStamp = ''; briefEdits.clear(); }
    renderBrief();
  } catch (error) {
    if (epoch === briefEpoch && !closed) { $('brief-status').textContent = `${error.message} Brief freshness is unknown until the saved journey can be checked.`; $('accept-brief').hidden = true; }
  } finally { clearTimeout(timer); if (writesMap && mapEpoch === actionEpoch) busy = false; if (epoch === briefEpoch) { briefBusy = false; $('generate-brief').disabled = briefView?.status === 'pending' || briefOperation === 'handoff' && !handoffReview.value; $('accept-brief').disabled = false; $('discard-brief').disabled = false; } }
}
function renderBrief() {
  const value = briefView, proposal = value?.status === 'proposal' ? value.proposal : null, brief = proposal ?? value?.accepted;
  $('discard-brief').hidden = !['pending', 'proposal', 'stale', 'error'].includes(value?.status);
  $('accept-brief').hidden = !proposal;
  $('generate-brief').disabled = value?.status === 'pending' || briefOperation === 'handoff' && !handoffReview.value;
  $('export-brief').hidden = !value?.accepted;
  $('copy-handoff').hidden = briefOperation !== 'handoff' || !value?.accepted;
  const coverage = brief?.coverage ?? value?.coverage;
  $('brief-status').textContent = [value?.error, value?.status === 'pending' ? `${value.progress}… Cancel this before using cleanup or question help.` : proposal ? 'Proposal only — review and edit, then explicitly accept.' : value?.accepted ? `Accepted brief — ${value.freshness}.` : 'No accepted brief yet.',
    coverage ? `${briefOperation === 'handoff' ? 'Selected handoff scope' : 'Journey summary'}: ${coverage.included} records included${coverage.omitted !== undefined ? `; ${coverage.omitted} omitted (not examined); ${coverage.bytes}/${coverage.limit} UTF-8 bytes` : ''}.` : '',
    'User constraints are statements, not verified facts. User edits keep original source links; edited wording is not automatically reverified.'].filter(Boolean).join(' ');
  const unavailable = proposal ? [] : value?.unavailableSources ?? [];
  const stamp = JSON.stringify([proposal ? briefId : 'accepted', brief, unavailable, brief?.dependencies.records.filter(source => !state.document.nodes.some(node => node.id === source.id)).map(source => source.id)]);
  if (stamp === briefStamp) return;
  briefStamp = stamp; briefEdits.clear(); $('brief-content').replaceChildren();
  if (!brief) return;
  const titles = { goal: brief.format === 'prompt' ? 'Instructions to the implementer' : 'Goal', decisions: brief.format === 'specification' ? 'Selected requirements' : 'Decisions and rationale', constraints: 'Constraints', assumptions: 'Assumptions', unresolved: 'Unresolved questions and conflicts', nextSteps: brief.format === 'tasks' ? 'Proposed tasks (in order)' : brief.format === 'plan' ? 'Proposed sequence' : brief.format === 'specification' ? 'Suggested validation' : 'Next steps' };
  for (const [key, statements] of Object.entries(brief.sections)) {
    const area = el('section', {}, el('h3', {}, titles[key]));
    if (!statements.length) area.append(el('p', { class: 'quiet' }, 'Unspecified in this brief.'));
    for (const statement of statements) {
      const label = el('p', { class: 'quiet' }, `${statement.certainty} · ${statement.edited ? 'User edited' : 'AI synthesis'}`);
      if (proposal) {
        const input = el('textarea', { rows: '3', 'aria-label': `${titles[key]} statement`, 'data-brief-statement': statement.id }); input.value = statement.text;
        input.addEventListener('input', () => { briefEdits.set(statement.id, input.value); label.textContent = `${statement.certainty} · ${input.value === statement.text ? 'AI synthesis' : 'User edited; original source links not reverified'}`; });
        area.append(label, input);
      } else area.append(label, el('p', { class: 'brief-text' }, statement.text));
      for (const ref of statement.sources) {
        if (ref.kind === 'guidance') area.append(el('p', { class: 'quiet' }, `Source: global user guidance (${ref.field})`));
        else if (ref.kind === 'evidence') {
          const source = brief.evidence.find(item => item.nodeId === ref.nodeId)?.sources.find(item => item.id === ref.sourceId);
          area.append(el('p', { class: 'quiet' }, `Recorded research: ${ref.nodeId} / ${ref.sourceId}: ${source?.title}. ${source?.provenance}; retrieved ${source?.retrievedAt ?? 'unknown'}. Consultation alone does not establish support.`));
        } else {
          const source = brief.dependencies.records.find(source => source.id === ref.id), available = !unavailable.includes(ref.id) && state.document.nodes.some(node => node.id === ref.id);
          area.append(el('p', { class: 'quiet' }, `Source state: ${source.state}${source.review ? '; needs review' : ''}`), available ? button(`Reveal: ${source.question}`, () => { $('brief-dialog').close(); select(ref.id); }, { class: 'brief-source' }) : el('p', { class: 'quiet' }, `Historical source unavailable: ${source.question} (${ref.id})`));
        }
      }
    }
    $('brief-content').append(area);
  }
  if (briefOperation === 'handoff') {
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
$('close-brief').addEventListener('click', () => { $('brief-dialog').close(); $(briefOperation === 'handoff' ? 'implementation-handoff' : 'decision-brief').focus(); });
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
}
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
$('outline-toggle').addEventListener('pointerdown', event => { if ($('node-workspace').contains(document.activeElement)) event.preventDefault(); });
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
  }
});
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
  if (event.button === 0 && ((control && control !== card) || (event.target.closest('.expanded-node') && !event.target.closest('.node-head')))) return;
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
$('node-workspace').addEventListener('focusin', () => { if (expanded && !restoringFocus) revealNode(selected); });
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
  if (viewportSize) { view.x += (rect.width - viewportSize.width) / 2; view.y += (rect.height - viewportSize.height) / 2; }
  viewportSize = { width: rect.width, height: rect.height };
  refreshScene();
});
mapObserver.observe($('map'));
const workspaceObserver = new ResizeObserver(() => { if (expanded) scheduleLayout(); });
workspaceObserver.observe($('node-workspace'));
const fontsChanged = () => { fontEpoch++; scheduleLayout(); };
document.fonts?.addEventListener('loadingdone', fontsChanged);
window.addEventListener('pagehide', event => {
  if (viewerTarget) { invalidateViewer('The page was suspended. Reopen Export maps and preview again.'); viewerTarget = null; $('viewer-preview').disabled = true; }
  closeResearchReview();
  suspended = true; pageEpoch++; actionEpoch++; stopPolling(); actionAbort?.abort(); actionAbort = null; busy = false;
  minimap.reset();
  if ($('diagnostics-dialog').open) closeDiagnostics();
  cleanup.cancel();
  closeBrief();
  closeCheck();
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
  suspended = false; pageEpoch++; pollFailures = 0; stateCursor = null; void (poll());
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
