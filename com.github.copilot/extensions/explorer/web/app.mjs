import { layout } from './layout.mjs';

const $ = id => document.getElementById(id);
const colors = ['#628e9b', '#b58c4c', '#7a8e62', '#947b9a', '#697fb0', '#ad7669'];
let state = { document: null, pending: null, error: '' };
let selected = null, signature = '', positions = new Map(), busy = false;
let view = { x: 0, y: 0, zoom: 1 }, firstFit = true;
const drafts = new Map();
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
function apply(next) {
  const stamp = JSON.stringify(next);
  if (stamp === signature) return;
  const firstQuestions = (state.document?.nodes.length ?? 0) <= 1 && (next.document?.nodes.length ?? 0) > 1;
  signature = stamp; state = next;
  const doc = state.document;
  if (doc && !doc.nodes.some(n => n.id === selected)) selected = doc.rootId;
  $('welcome').hidden = !!doc; $('workspace').hidden = !doc;
  $('save-file').hidden = !doc; $('finish').hidden = !doc;
  $('finish').disabled = !!state.pending;
  notice(state.error);
  if (!doc) return;
  $('map-title').textContent = doc.topic;
  const answered = doc.nodes.filter(n => n.answer).length;
  $('progress').textContent = `${answered} answered · ${doc.nodes.length - 1 - answered} open · Saved locally`;
  positions = layout(doc.nodes, doc.rootId);
  renderMap(); renderInspector(); renderOutline();
  if (firstFit || firstQuestions) { requestAnimationFrame(fit); firstFit = false; }
}
function select(id, center = false) {
  selected = id; renderMap(); renderInspector();
  if (center) {
    const p = positions.get(id), rect = $('map').getBoundingClientRect();
    view.x = rect.width / 2 - (p.x + 110) * view.zoom; view.y = rect.height / 2 - (p.y + 55) * view.zoom; transform();
  }
}
function renderMap() {
  const doc = state.document;
  const fragment = document.createDocumentFragment();
  $('edges').replaceChildren();
  for (const n of doc.nodes) {
    const p = positions.get(n.id), root = n.id === doc.rootId;
    const node = button('', () => select(n.id), { class: `node ${root ? 'root' : ''} ${n.answer ? 'done' : ''} ${selected === n.id ? 'selected' : ''} ${n.review ? 'needs-review' : ''}`,
      title: n.question, 'aria-pressed': String(selected === n.id), 'aria-label': `${n.category}: ${n.question}. ${n.answer ? 'Answered' : root ? 'Central idea' : 'Open'}` });
    node.style.left = `${p.x}px`; node.style.top = `${p.y}px`; node.style.setProperty('--branch', colors[p.branch % colors.length]);
    node.append(el('span', { class: 'category' }, n.category), el('span', { class: 'question' }, n.question), el('span', { class: 'status' }, root ? `${doc.nodes.length - 1} questions` : n.review ? 'Needs review' : n.answer ? 'Answered' : 'Open question'));
    fragment.append(node);
    if (!root) {
      const parent = positions.get(n.parentId), left = p.side < 0;
      const x1 = parent.x + (left ? 0 : 220), y1 = parent.y + 55, x2 = p.x + (left ? 220 : 0), y2 = p.y + 55;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`);
      $('edges').append(path);
    }
  }
  $('nodes').replaceChildren(fragment); transform();
}
function transform() { $('world').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.zoom})`; $('zoom-level').textContent = `${Math.round(view.zoom * 100)}%`; }
function fit() {
  if (!positions.size) return;
  const values = [...positions.values()], rect = $('map').getBoundingClientRect();
  const minX = Math.min(...values.map(p => p.x)), maxX = Math.max(...values.map(p => p.x + 220));
  const minY = Math.min(...values.map(p => p.y)), maxY = Math.max(...values.map(p => p.y + 110));
  view.zoom = Math.max(.12, Math.min(1, (rect.width - 70) / (maxX - minX), (rect.height - 70) / (maxY - minY)));
  view.x = rect.width / 2 - (minX + maxX) / 2 * view.zoom; view.y = rect.height / 2 - (minY + maxY) / 2 * view.zoom; transform();
}
function zoom(factor) {
  const rect = $('map').getBoundingClientRect(), next = Math.max(.12, Math.min(1.6, view.zoom * factor)), ratio = next / view.zoom;
  view.x = rect.width / 2 - (rect.width / 2 - view.x) * ratio; view.y = rect.height / 2 - (rect.height / 2 - view.y) * ratio; view.zoom = next; transform();
}
function renderInspector() {
  const doc = state.document, node = doc.nodes.find(n => n.id === selected);
  const panel = $('inspector'), root = node.id === doc.rootId, pending = !!state.pending;
  const focus = document.activeElement?.id === 'answer' ? { start: $('answer').selectionStart, end: $('answer').selectionEnd } : null;
  panel.replaceChildren();
  const path = [], byId = new Map(doc.nodes.map(n => [n.id, n]));
  for (let n = node; n; n = byId.get(n.parentId)) path.push(n);
  const crumbs = el('div', { class: 'crumbs', 'aria-label': 'Question ancestors' });
  for (const n of path.toReversed().slice(-4)) { if (crumbs.childNodes.length) crumbs.append(el('span', {}, '/')); crumbs.append(button(n.id === doc.rootId ? 'Your idea' : n.category, () => select(n.id, true))); }
  panel.append(crumbs, el('span', { class: 'category-label' }, node.category), el('h2', { class: 'question-title' }, node.question));
  if (pending) {
    const workNode = byId.get(state.pending.nodeId);
    panel.append(el('div', { class: 'pending', role: 'status' },
      el('strong', {}, state.pending.kind === 'research' ? 'Copilot is researching…' : 'Copilot is finding the next questions…'),
      el('div', {}, workNode?.id === node.id ? 'Watch this node for the result. You can continue browsing the map.' : `Working on: ${workNode?.category}. You can continue browsing.`),
      button('Cancel request', () => api('cancel')), el('div', { class: 'quiet' }, 'Cancelling discards the result; the chat turn may still finish.')));
  }
  if (node.review) panel.append(el('p', { class: 'note' }, 'An earlier answer changed. Review this question and save your answer again when it still fits.'));
  if (root) {
    panel.append(el('p', { class: 'empty-detail' }, 'There is no required route through this map. Pick a question, make a decision, and go deeper where it matters. Leave the other branches open.'),
      button(doc.nodes.length > 1 ? 'Find more directions' : 'Generate questions', () => api('questions', { nodeId: node.id }), { disabled: pending }));
  } else {
    const form = el('form', { class: 'answer-form' });
    const answer = el('textarea', { id: 'answer', rows: '6', maxlength: '20000', placeholder: 'Your answer can be a decision, a hunch, or what you know so far.' });
    answer.value = drafts.get(node.id) ?? node.answer;
    answer.addEventListener('input', () => drafts.set(node.id, answer.value));
    const save = async expand => {
      if (!answer.value.trim()) return notice('Write an answer before saving.');
      const value = answer.value;
      if (await api('answer', { nodeId: node.id, answer: value, expand })) { drafts.delete(node.id); renderInspector(); if (expand) notice('Answer saved. Copilot will add follow-up questions to this branch.'); }
    };
    form.addEventListener('submit', event => { event.preventDefault(); void save(true); });
    form.append(el('label', { for: 'answer' }, 'Your answer'), answer, el('div', { class: 'actions' },
      el('button', { type: 'submit', class: 'primary', disabled: pending }, 'Save & explore deeper'), button('Save answer', () => save(false), { disabled: pending })));
    panel.append(form);
    panel.append(el('div', { class: 'research-header' }, el('h3', {}, 'Think it through'), button(node.research ? 'Research again' : 'Research options', () => api('research', { nodeId: node.id }), { disabled: pending })));
    if (node.research) panel.append(renderResearch(node.research));
    else panel.append(el('p', { class: 'quiet' }, 'Ask Copilot to compare options, explain trade-offs, and recommend a direction before you answer.'));
  }
  const details = el('details');
  const manual = el('form');
  const category = el('input', { id: 'manual-category', required: '', maxlength: '60', value: root ? '' : node.category });
  const question = el('textarea', { id: 'manual-question', required: '', rows: '2', maxlength: '600' });
  manual.append(el('label', { for: 'manual-category' }, 'Category'), category, el('label', { for: 'manual-question' }, 'Question'), question, el('button', { type: 'submit', disabled: pending }, 'Add question'));
  manual.addEventListener('submit', async event => { event.preventDefault(); if (await api('add', { nodeId: node.id, question: question.value, category: category.value })) fit(); });
  details.append(el('summary', {}, 'Add your own question'), manual); panel.append(details);
  if (focus && $('answer')) { $('answer').focus({ preventScroll: true }); $('answer').setSelectionRange(focus.start, focus.end); }
}
function renderResearch(r) {
  const section = el('div', { class: 'research' }, el('span', { class: 'basis' }, r.basis === 'sources' ? 'Based on consulted sources' : 'Model reasoning · not externally verified'), el('p', {}, r.summary));
  for (const o of r.options) section.append(el('section', { class: 'option' }, el('h3', {}, o.title), el('p', {}, o.description), el('strong', { class: 'pro' }, 'Pros'), el('ul', {}, o.pros.map(v => el('li', {}, v))), el('strong', { class: 'con' }, 'Cons'), el('ul', {}, o.cons.map(v => el('li', {}, v)))));
  section.append(el('h3', {}, 'Recommendation'), el('p', {}, r.recommendation), el('h3', {}, 'What is still uncertain'), el('p', {}, r.uncertainty));
  if (r.sources.length) section.append(el('div', { class: 'sources' }, el('h3', {}, 'Sources'), r.sources.map(s => el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title))));
  return section;
}
function renderOutline() {
  if (!state.document) return;
  const query = $('search').value.toLowerCase();
  const nodes = state.document.nodes.filter(n => `${n.question} ${n.answer} ${n.category}`.toLowerCase().includes(query));
  $('outline-list').replaceChildren(...nodes.map(n => button([n.question, el('small', {}, `${n.category} · ${n.answer ? 'Answered' : 'Open'}`)], () => { select(n.id, true); $('outline').hidden = true; $('outline-toggle').setAttribute('aria-expanded', 'false'); })));
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
  try {
    const document = JSON.parse(await file.text());
    if (await api('import', { document })) { drafts.clear(); firstFit = false; selected = state.document.rootId; renderInspector(); fit(); }
  } catch (error) { notice(`Could not open that file: ${error.message}`); }
});
$('finish').addEventListener('click', async () => {
  const dirty = dirtyNodes();
  if (dirty.length) { select(dirty[0].id, true); return notice('Save your draft answer before finishing.'); }
  if (await api('finish')) $('export-dialog').showModal();
});
$('save-file').addEventListener('click', event => { if (dirtyNodes().length) { event.preventDefault(); notice('Save your draft answers before downloading the map.'); } });
$('close-export').addEventListener('click', () => $('export-dialog').close());
$('outline-toggle').addEventListener('click', () => { $('outline').hidden = !$('outline').hidden; $('outline-toggle').setAttribute('aria-expanded', String(!$('outline').hidden)); if (!$('outline').hidden) $('search').focus(); });
$('search').addEventListener('input', renderOutline);
$('fit').addEventListener('click', fit); $('zoom-in').addEventListener('click', () => zoom(1.2)); $('zoom-out').addEventListener('click', () => zoom(1 / 1.2));
let drag;
$('map').addEventListener('pointerdown', event => { if (event.target.closest('button')) return; drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; $('map').setPointerCapture(event.pointerId); });
$('map').addEventListener('pointermove', event => { if (drag) { view.x = drag.vx + event.clientX - drag.x; view.y = drag.vy + event.clientY - drag.y; transform(); } });
for (const name of ['pointerup', 'pointercancel']) $('map').addEventListener(name, () => { drag = null; });
$('map').addEventListener('keydown', event => { if (event.target !== $('map')) return; const direction = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key]; if (direction) { event.preventDefault(); view.x += direction[0]; view.y += direction[1]; transform(); } });
$('map').addEventListener('wheel', event => { if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1); } }, { passive: false });
window.addEventListener('beforeunload', event => { if (dirtyNodes().length) { event.preventDefault(); event.returnValue = ''; } });
new ResizeObserver(() => { if (positions.size && !drag) fit(); }).observe($('map'));
async function poll() {
  try { const response = await fetch('api/state'); if (!response.ok) throw new Error('Canvas connection lost. Reopen Explorer in Copilot.'); apply(await response.json()); }
  catch (error) { notice(error.message); }
  finally { setTimeout(poll, document.hidden ? 4000 : 1200); }
}
void poll();
