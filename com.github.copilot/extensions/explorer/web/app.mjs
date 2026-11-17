import { layout } from './layout.mjs';
import { attachVoice } from './voice.mjs';

const $ = id => document.getElementById(id);
const colors = ['#628e9b', '#b58c4c', '#7a8e62', '#947b9a', '#697fb0', '#ad7669'];
let state = { document: null, pending: null, error: '' };
let selected = null, expanded = false, signature = '', positions = new Map(), busy = false, firstFit = true;
let view = { x: 0, y: 0, zoom: 1 }, drag, layoutFrame;
const drafts = new Map(), nodeUi = new Map();
const voice = attachVoice({ document, window, fetch: (...args) => fetch(...args),
  context: () => `${state.document?.id}/${selected}/${expanded}`,
  insert: (value, caret) => {
    drafts.set(selected, value); $('answer').value = value; $('answer').setSelectionRange(caret, caret);
    answerStatus(state.document.nodes.find(n => n.id === selected));
  }, changed: () => scheduleLayout() });
const uiFor = id => { if (!nodeUi.has(id)) nodeUi.set(id, { scroll: 0, researchOpen: false, manualOpen: false, category: null, question: '' }); return nodeUi.get(id); };
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else if (key === 'disabled') node.disabled = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const button = (label, handler, attrs = {}) => el('button', { type: 'button', onclick: handler, ...attrs }, label);
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
async function api(action, input = {}) {
  if (busy) return null;
  busy = true;
  try {
    const response = await fetch('api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Explorer-Client': '1' }, body: JSON.stringify({ action, revision: state.document?.revision, ...input }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    apply(result); return result;
  } catch (error) { notice(error.message); return null; }
  finally { busy = false; }
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
    ui.manualOpen = panel.querySelector('.manual')?.open ?? false;
  }
}
function apply(next) {
  const stamp = JSON.stringify(next);
  if (stamp === signature) return;
  captureWorkspace();
  const changedDocument = state.document?.id !== next.document?.id;
  const firstQuestions = (state.document?.nodes.length ?? 0) <= 1 && (next.document?.nodes.length ?? 0) > 1;
  const anchor = changedDocument ? null : anchorPoint();
  if (changedDocument) {
    voice.cancel();
    drafts.clear(); nodeUi.clear(); positions.clear(); $('node-workspace').replaceChildren();
    selected = next.document?.rootId ?? null; expanded = next.document?.nodes.length === 1; firstFit = true;
  }
  signature = stamp; state = next;
  const doc = state.document;
  if (doc && !doc.nodes.some(n => n.id === selected)) { selected = doc.rootId; expanded = false; }
  $('welcome').hidden = !!doc; $('workspace').hidden = !doc;
  $('save-file').hidden = !doc; $('finish').hidden = !doc; $('finish').disabled = !!state.pending;
  notice(state.error);
  if (!doc) return;
  if (firstQuestions && selected === doc.rootId) expanded = false;
  $('map-title').textContent = doc.topic;
  const answered = doc.nodes.filter(n => n.answer).length;
  $('progress').textContent = `${answered} answered · ${doc.nodes.length - 1 - answered} open · Saved locally`;
  $('request-status').hidden = !state.pending;
  if (state.pending) {
    const work = doc.nodes.find(n => n.id === state.pending.nodeId);
    $('request-status').textContent = `${state.pending.kind === 'research' ? 'Researching' : 'Finding questions for'} ${work?.category ?? 'this map'}…`;
  }
  renderWorkspace(); refreshScene(anchor); renderOutline();
  if (firstFit || firstQuestions) { expanded ? centerSelected() : fit(); firstFit = false; }
}
function focusTop(id, height) {
  const node = state.document.nodes.find(n => n.id === id);
  const parent = state.document.nodes.find(n => n.id === node?.parentId);
  return Math.max(16, Math.min(parent ? (parent.answer ? 150 : 110) + 72 + 24 : 24, height - 320));
}
function select(id) {
  if (!state.document?.nodes.some(n => n.id === id)) return;
  voice.cancel();
  const rect = $('map').getBoundingClientRect(), width = Math.min(560, rect.width - 32), old = anchorPoint(id);
  const anchor = { id, x: Math.max(width / 2 + 16, Math.min(rect.width - width / 2 - 16, old?.x ?? rect.width / 2)), y: focusTop(id, rect.height) };
  captureWorkspace(); selected = id; expanded = true; view.zoom = 1;
  renderWorkspace(); refreshScene(anchor); $('expanded-title').focus({ preventScroll: true });
}
function collapseNode(focus = true) {
  voice.cancel();
  const anchor = anchorPoint(); captureWorkspace(); expanded = false;
  renderWorkspace(); refreshScene(anchor);
  if (focus) [...$('nodes').children].find(e => e.dataset.nodeId === selected)?.focus({ preventScroll: true });
}
function refreshScene(anchor = anchorPoint()) {
  if (!state.document) return;
  const panel = $('node-workspace'), rect = $('map').getBoundingClientRect();
  const width = Math.min(560, Math.max(180, rect.width - 32));
  const top = Math.max(16, Math.min(rect.height - 160, anchor?.y ?? 24));
  const height = Math.max(140, rect.height - top - 16);
  panel.style.width = `${width}px`; panel.style.maxHeight = `${height}px`;
  panel.style.setProperty('--heading-limit', `${Math.max(64, Math.min(190, height * .42))}px`);
  const sizes = new Map(state.document.nodes.map(n => [n.id, { width: 220, height: n.answer ? 150 : 110 }]));
  if (expanded) sizes.set(selected, { width, height: panel.offsetHeight });
  positions = layout(state.document.nodes, state.document.rootId, sizes);
  if (anchor && positions.has(anchor.id)) {
    const p = positions.get(anchor.id);
    view.x = anchor.x - (p.x + p.width / 2) * view.zoom; view.y = anchor.y - p.y * view.zoom;
  }
  if (expanded) { const p = positions.get(selected); panel.style.left = `${p.x}px`; panel.style.top = `${p.y}px`; }
  renderMap(); transform();
}
function scheduleLayout() { cancelAnimationFrame(layoutFrame); layoutFrame = requestAnimationFrame(() => refreshScene()); }
function renderMap() {
  const doc = state.document, fragment = document.createDocumentFragment();
  const focused = $('nodes').contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
  $('edges').replaceChildren(); $('map-hint').hidden = expanded;
  for (const n of doc.nodes) {
    const p = positions.get(n.id), root = n.id === doc.rootId;
    if (!expanded || n.id !== selected) {
      const node = button('', () => select(n.id), { class: `node ${root ? 'root' : ''} ${n.answer ? 'done' : ''} ${selected === n.id ? 'selected' : ''} ${n.review ? 'needs-review' : ''}`,
        title: n.question, 'data-node-id': n.id, 'aria-expanded': 'false', 'aria-label': `${n.category}: ${n.question}. ${n.answer ? 'Answered' : root ? 'Central idea' : 'Open'}` });
      node.style.left = `${p.x}px`; node.style.top = `${p.y}px`; node.style.width = `${p.width}px`; node.style.height = `${p.height}px`; node.style.setProperty('--branch', colors[p.branch % colors.length]);
      node.append(el('span', { class: 'category' }, n.category), el('span', { class: 'question' }, n.question));
      if (n.answer) node.append(el('span', { class: 'answer-preview' }, n.answer));
      node.append(el('span', { class: 'status' }, root ? `${doc.nodes.length - 1} questions` : n.review ? 'Needs review' : n.answer ? 'Answered' : 'Open question'));
      fragment.append(node);
    }
    if (!root) {
      const parent = positions.get(n.parentId), x1 = parent.x + parent.width / 2, y1 = parent.y + parent.height, x2 = p.x + p.width / 2, y2 = p.y;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`);
      if (n.id === selected || n.parentId === selected) path.setAttribute('class', 'current');
      $('edges').append(path);
    }
  }
  $('nodes').replaceChildren(fragment);
  if (focused) [...$('nodes').children].find(e => e.dataset.nodeId === focused)?.focus({ preventScroll: true });
}
function transform() { $('world').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`; $('zoom-level').textContent = `${Math.round(view.zoom * 100)}%`; }
function fit() {
  voice.cancel();
  if (!positions.size) return;
  const values = [...positions.values()], rect = $('map').getBoundingClientRect();
  const minX = Math.min(...values.map(p => p.x)), maxX = Math.max(...values.map(p => p.x + p.width));
  const minY = Math.min(...values.map(p => p.y)), maxY = Math.max(...values.map(p => p.y + p.height));
  view.zoom = Math.max(.12, Math.min(1, (rect.width - 60) / (maxX - minX), (rect.height - 60) / (maxY - minY)));
  view.x = rect.width / 2 - (minX + maxX) / 2 * view.zoom; view.y = rect.height / 2 - (minY + maxY) / 2 * view.zoom; transform();
}
function centerSelected() {
  if (!selected || !positions.has(selected)) return;
  const rect = $('map').getBoundingClientRect(); view.zoom = 1;
  refreshScene({ id: selected, x: rect.width / 2, y: focusTop(selected, rect.height) });
}
function zoom(factor) {
  const rect = $('map').getBoundingClientRect(), next = Math.max(.12, Math.min(1.6, view.zoom * factor)), ratio = next / view.zoom;
  view.x = rect.width / 2 - (rect.width / 2 - view.x) * ratio; view.y = rect.height / 2 - (rect.height / 2 - view.y) * ratio; view.zoom = next; transform();
}
function answerStatus(node) {
  const dirty = drafts.has(node.id) && drafts.get(node.id).trim() !== node.answer;
  if ($('answer-status')) $('answer-status').textContent = dirty ? 'Unsaved draft' : node.answer ? 'Answer saved' : 'No answer yet';
  const undo = $('undo-addition'), addition = uiFor(node.id).addition;
  if (undo) { undo.hidden = !addition; undo.disabled = !addition || (drafts.get(node.id) ?? node.answer) !== addition.after; }
}
function renderWorkspace() {
  const panel = $('node-workspace'); captureWorkspace(); panel.hidden = !expanded;
  if (!expanded) return;
  const doc = state.document, node = doc.nodes.find(n => n.id === selected), ui = uiFor(node.id), root = node.id === doc.rootId, pending = !!state.pending;
  const active = document.activeElement, sameNode = panel.dataset.nodeId === node.id;
  const focus = sameNode && active?.id && panel.contains(active) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  panel.dataset.nodeId = node.id; panel.replaceChildren();
  const path = [], byId = new Map(doc.nodes.map(n => [n.id, n]));
  for (let n = node; n; n = byId.get(n.parentId)) path.push(n);
  const crumbs = el('nav', { class: 'crumbs', 'aria-label': 'Question ancestors' });
  for (const n of path.toReversed().slice(0, -1).slice(-3)) {
    if (crumbs.childNodes.length) crumbs.append(el('span', {}, '/'));
    crumbs.append(button(n.id === doc.rootId ? 'Your idea' : n.category, () => select(n.id), { id: `ancestor-${n.id}`, title: n.question }));
  }
  const heading = el('header', { class: 'node-head' }, el('div', { class: 'node-meta' }, el('span', { class: 'category-label' }, node.category), button('Collapse node', () => collapseNode(), { id: 'collapse-node' })), crumbs, el('h2', { id: 'expanded-title', class: 'question-title', tabindex: '-1' }, node.question));
  const content = el('div', { class: 'node-content' }); panel.append(heading, content);
  if (pending) {
    const workNode = byId.get(state.pending.nodeId);
    content.append(el('div', { class: 'pending', role: 'status' }, el('strong', {}, state.pending.kind === 'research' ? `${state.pending.progress ?? 'Researching'}…` : 'Copilot is finding the next questions…'), el('div', {}, workNode?.id === node.id ? 'The result will appear in this node. You can keep writing or browse the map.' : `Working on: ${workNode?.category}. You can continue browsing.`), button('Cancel request', () => api('cancel'), { id: 'cancel-request' }), el('div', { class: 'quiet' }, state.pending.kind === 'research' ? 'Research runs separately from your chat. Cancelling stops its helper.' : 'Cancelling discards the result; the chat turn may still finish.')));
  }
  if (node.review) content.append(el('p', { class: 'note' }, 'An earlier answer changed. Review this question and save your answer again when it still fits.'));
  if (root) {
    content.append(el('p', { class: 'quiet' }, 'Pick a connected question to explore it. Each question opens into its own workspace on the map.'), button(doc.nodes.length > 1 ? 'Find more directions' : 'Generate questions', () => api('questions', { nodeId: node.id }), { id: 'generate-questions', disabled: pending }));
  } else {
    const form = el('form', { class: 'answer-form' }), answer = el('textarea', { id: 'answer', rows: '4', maxlength: '20000', placeholder: 'A decision, a hunch, or what you know so far…' });
    answer.value = drafts.get(node.id) ?? node.answer;
    answer.addEventListener('input', () => { drafts.set(node.id, answer.value); answerStatus(node); });
    const save = async deepen => {
      voice.cancel();
      if (!answer.value.trim()) return notice('Write an answer before saving.');
      const value = answer.value;
      if (await api('answer', { nodeId: node.id, answer: value, expand: deepen })) {
        if (drafts.get(node.id) === value) drafts.delete(node.id);
        renderWorkspace(); refreshScene();
        if (deepen) notice('Answer saved. Copilot will add follow-up questions to this branch.');
      }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void save(true); });
    form.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(true); } });
    const voiceStatus = el('div', { class: 'voice-controls' });
    answer.setAttribute('aria-describedby', 'voice-status');
    voice.bind(answer, voiceStatus);
    form.append(el('div', { class: 'answer-label' }, el('label', { for: 'answer' }, 'Your answer'), el('span', { id: 'answer-status', class: 'quiet' })), answer, voiceStatus, el('div', { class: 'actions' }, button('Save answer', () => { voice.cancel(); void save(false); }, { id: 'save-answer', disabled: pending }), el('button', { type: 'submit', id: 'save-deeper', class: 'primary', disabled: pending }, 'Save & explore deeper')));
    form.append(button('Undo addition', () => {
      const addition = ui.addition;
      if (!addition || (drafts.get(node.id) ?? node.answer) !== addition.after) return;
      voice.cancel(); drafts.set(node.id, addition.before); answer.value = addition.before; ui.addition = null;
      answerStatus(node); answer.focus({ preventScroll: true }); notice('Addition undone. Your earlier draft is restored.');
    }, { id: 'undo-addition', class: 'undo-addition' }));
    content.append(form); answerStatus(node);
    const research = el('details', { class: 'research-disclosure' }, el('summary', { id: 'research-summary' }, 'Explore options')); research.open = ui.researchOpen;
    research.addEventListener('toggle', () => { if (research.isConnected) { ui.researchOpen = research.open; scheduleLayout(); } });
    research.append(el('p', { class: 'quiet' }, 'A separate researcher compares possibilities using your saved decisions. Suggestions stay separate from your answer; normal Copilot usage applies.'), button(node.research ? 'Research again' : 'Research options', () => { research.open = true; ui.researchOpen = true; void api('research', { nodeId: node.id }); }, { id: 'research-request', disabled: pending }));
    if (node.research) research.append(renderResearch(node));
    content.append(research);
  }
  const children = doc.nodes.filter(n => n.parentId === node.id);
  if (children.length) content.append(el('div', { class: 'followups' }, el('h3', {}, root ? 'Explore a direction' : 'Follow-up questions'), el('p', { class: 'quiet' }, 'Connected below this node.'), children.map(child => button(child.question, () => select(child.id), { id: `followup-${child.id}`, class: 'followup' }))));
  const details = el('details', { class: 'manual' }, el('summary', { id: 'manual-summary' }, 'Add your own question')); details.open = ui.manualOpen;
  details.addEventListener('toggle', () => { if (details.isConnected) { ui.manualOpen = details.open; scheduleLayout(); } });
  const manual = el('form'), category = el('input', { id: 'manual-category', required: '', maxlength: '60' }), question = el('textarea', { id: 'manual-question', required: '', rows: '2', maxlength: '600' });
  category.value = ui.category ?? (root ? '' : node.category); question.value = ui.question;
  category.addEventListener('input', () => { ui.category = category.value; }); question.addEventListener('input', () => { ui.question = question.value; });
  manual.append(el('label', { for: 'manual-category' }, 'Category'), category, el('label', { for: 'manual-question' }, 'Question'), question, el('button', { type: 'submit', id: 'add-question', disabled: pending }, 'Add question'));
  manual.addEventListener('submit', async event => { event.preventDefault(); const value = question.value; if (await api('add', { nodeId: node.id, question: value, category: category.value })) { if (ui.question === value) ui.question = ''; renderWorkspace(); refreshScene(); } });
  details.append(manual); content.append(details); content.scrollTop = ui.scroll;
  if (focus) {
    const target = $(focus.id);
    const restored = target && !target.disabled ? target : $('cancel-request') ?? $('expanded-title');
    restored.focus({ preventScroll: true });
    if (restored === target && typeof focus.start === 'number') restored.setSelectionRange(focus.start, focus.end);
  }
}
function renderResearch(node) {
  const r = node.research, ui = uiFor(node.id), key = JSON.stringify(r);
  if (ui.researchKey !== key) { ui.researchKey = key; ui.selectedDetails = new Set(); }
  const add = suggestion => {
    const previous = drafts.get(node.id) ?? node.answer, value = previous ? `${previous}\n\n${suggestion}` : suggestion;
    if (value.length > 20000) return notice('Your answer is too long to add this suggestion. Shorten it first.');
    voice.cancel(); ui.addition = { before: previous, after: value };
    drafts.set(node.id, value); $('answer').value = value; answerStatus(node);
    $('answer').focus({ preventScroll: true }); $('answer').setSelectionRange(value.length, value.length); $('answer').scrollIntoView({ block: 'nearest' });
    notice('Added to your draft. Edit it before saving, or undo the addition.');
  };
  const section = el('div', { class: 'research' }, el('span', { class: 'basis' }, r.basis === 'sources' ? 'Based on consulted sources' : 'Model reasoning · not externally verified'), el('p', {}, r.summary));
  section.append(el('div', { class: 'recommendation' }, el('h3', {}, 'Recommendation'), el('p', {}, r.recommendation), button('Use recommendation', () => add(r.proposedAnswer ?? r.recommendation), { id: 'use-recommendation' })));
  const details = [];
  for (const [index, o] of r.options.entries()) {
    const option = el('section', { class: 'option' }, el('h3', {}, o.title), el('p', {}, o.description), el('strong', { class: 'pro' }, 'Pros'), el('ul', {}, o.pros.map(v => el('li', {}, v))), el('strong', { class: 'con' }, 'Cons'), el('ul', {}, o.cons.map(v => el('li', {}, v))), button('Use this option', () => add(o.proposedAnswer ?? `${o.title}: ${o.description}`), { id: `add-option-${index}` }));
    for (const [i, detail] of (o.details ?? []).entries()) {
      const id = `detail-${index}-${i}`, checkbox = el('input', { type: 'checkbox', id });
      checkbox.checked = ui.selectedDetails.has(id); details.push({ id, ...detail });
      checkbox.addEventListener('change', () => { checkbox.checked ? ui.selectedDetails.add(id) : ui.selectedDetails.delete(id); $('add-details').disabled = !ui.selectedDetails.size; });
      option.append(el('label', { class: 'research-detail', for: id }, checkbox, el('span', {}, el('strong', {}, detail.label), ': ', detail.value)));
    }
    section.append(option);
  }
  if (details.length) section.append(button('Add selected details', () => {
    const selected = details.filter(d => ui.selectedDetails.has(d.id));
    if (selected.length) add(selected.map(d => `${d.label}: ${d.value}`).join('\n'));
  }, { id: 'add-details', disabled: !ui.selectedDetails.size }));
  section.append(el('h3', {}, 'What is still uncertain'), el('p', {}, r.uncertainty));
  if (r.sources.length) section.append(el('div', { class: 'sources' }, el('h3', {}, 'Sources'), r.sources.map((s, index) => el('a', { id: `source-${index}`, href: s.url, target: '_blank', rel: 'noopener noreferrer' }, `[${index + 1}] ${s.title}`))));
  return section;
}
function renderOutline() {
  if (!state.document) return;
  const focused = $('outline-list').contains(document.activeElement) ? document.activeElement.dataset.nodeId : null;
  const query = $('search').value.toLowerCase();
  const nodes = state.document.nodes.filter(n => `${n.question} ${n.answer} ${n.category}`.toLowerCase().includes(query));
  $('outline-list').replaceChildren(...nodes.map(n => button([n.question, el('small', {}, `${n.category} · ${n.answer ? 'Answered' : 'Open'}`)], () => { select(n.id); $('outline').hidden = true; $('outline-toggle').setAttribute('aria-expanded', 'false'); }, { 'data-node-id': n.id })));
  if (focused) [...$('outline-list').children].find(e => e.dataset.nodeId === focused)?.focus({ preventScroll: true });
}
function dirtyNodes() { return state.document?.nodes.filter(n => drafts.has(n.id) && drafts.get(n.id).trim() !== n.answer) ?? []; }
$('start-form').addEventListener('submit', async event => { event.preventDefault(); await api('start', { topic: $('topic').value }); });
$('import').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const file = $('file').files[0]; $('file').value = '';
  if (!file) return;
  if (state.pending) return notice('Cancel the current Copilot request before opening another map.');
  if (file.size > 10 * 1024 * 1024) return notice('The file exceeds the 10 MiB POC limit.');
  if (state.document && !confirm('Replace the map in this canvas? Download Save file first if you want to keep the current map. Unsaved answer drafts will be discarded.')) return;
  try { const document = JSON.parse(await file.text()); if (await api('import', { document })) { drafts.clear(); nodeUi.clear(); selected = state.document.rootId; expanded = false; renderWorkspace(); refreshScene(null); fit(); } }
  catch (error) { notice(`Could not open that file: ${error.message}`); }
});
$('finish').addEventListener('click', async () => { const dirty = dirtyNodes(); if (dirty.length) { select(dirty[0].id); return notice('Save your draft answer before finishing.'); } if (await api('finish')) $('export-dialog').showModal(); });
$('save-file').addEventListener('click', event => { if (dirtyNodes().length) { event.preventDefault(); notice('Save your draft answers before downloading the map.'); } });
$('close-export').addEventListener('click', () => $('export-dialog').close());
$('outline-toggle').addEventListener('click', () => { $('outline').hidden = !$('outline').hidden; $('outline-toggle').setAttribute('aria-expanded', String(!$('outline').hidden)); if (!$('outline').hidden) $('search').focus(); });
$('search').addEventListener('input', renderOutline);
$('request-status').addEventListener('click', () => { if (state.pending) select(state.pending.nodeId); });
$('fit').addEventListener('click', () => { collapseNode(false); fit(); }); $('center-question').addEventListener('click', centerSelected);
$('zoom-in').addEventListener('click', () => zoom(1.2)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
$('map').addEventListener('pointerdown', event => { if (event.button !== 0 || event.target.closest('button,a,input,textarea,select,summary,.expanded-node')) return; drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; $('map').setPointerCapture(event.pointerId); });
$('map').addEventListener('pointermove', event => { if (drag) { view.x = drag.vx + event.clientX - drag.x; view.y = drag.vy + event.clientY - drag.y; transform(); } });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('map').addEventListener(name, () => { drag = null; });
$('map').addEventListener('keydown', event => {
  if (event.key === 'Escape' && expanded) { event.preventDefault(); collapseNode(); return; }
  if (event.target !== $('map')) return;
  const direction = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
  if (direction) { event.preventDefault(); view.x += direction[0]; view.y += direction[1]; transform(); }
});
$('map').addEventListener('wheel', event => { if (event.target.closest('.expanded-node')) return; if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });
window.addEventListener('beforeunload', event => { if (dirtyNodes().length) { event.preventDefault(); event.returnValue = ''; } });
new ResizeObserver(() => { if (positions.size && !drag) { expanded ? centerSelected() : fit(); } }).observe($('map'));
new ResizeObserver(() => { if (expanded) scheduleLayout(); }).observe($('node-workspace'));
async function poll() {
  try { const response = await fetch('api/state'); if (!response.ok) throw new Error('Canvas connection lost. Reopen Explorer in Copilot.'); apply(await response.json()); }
  catch (error) { notice(error.message); }
  finally { setTimeout(poll, document.hidden ? 4000 : 1200); }
}
void poll();
