// This function is embedded verbatim in the offline artifact. Keep it independent
// of the live panel, server and host; untrusted data only enters textContent.
export function renderOfflineViewer(snapshot) {
  const $ = id => document.getElementById(id);
  const el = (tag, text) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
  const nodes = snapshot.nodes, byId = new Map(nodes.map(n => [n.id, n]));
  let selected = nodes[0].id, filtered = nodes;
  const searchable = new Map(nodes.map(n => [n.id, JSON.stringify(n).toLocaleLowerCase()]));
  function paragraph(parent, label, value) { parent.append(el('h3', label), el('p', value)); }
  function jump(parent, id, label) {
    const button = el('button', label); button.type = 'button';
    button.addEventListener('click', () => { selected = id; show(); $('node-title').focus(); }); parent.append(button);
  }
  function research(parent, r) {
    const section = el('section'); section.append(el('h2', 'Recorded AI suggestions — not user decisions'));
    section.append(el('p', r.basis === 'sources' ? 'Consulted sources. A recorded read does not establish claim support or truth.' : 'Model reasoning; not externally verified.'));
    paragraph(section, 'Summary', r.summary);
    for (const option of r.options) {
      const article = el('section'); article.append(el('h3', option.title), el('p', option.description));
      paragraph(article, 'Model-stated pros', option.pros.join('\n') || 'None recorded');
      paragraph(article, 'Model-stated cons', option.cons.join('\n') || 'None recorded');
      for (const detail of option.details) paragraph(article, detail.label, detail.value);
      if (option.proposedAnswer !== null) paragraph(article, 'AI suggested answer for this option', option.proposedAnswer);
      section.append(article);
    }
    paragraph(section, 'AI recommendation', r.recommendation);
    if (r.proposedAnswer !== null) paragraph(section, 'AI suggested answer', r.proposedAnswer);
    paragraph(section, 'Uncertainty', r.uncertainty);
    section.append(el('h3', 'Recorded claims and model interpretation'));
    if (r.claims === null) section.append(el('p', 'Legacy research: claim support unknown.'));
    for (const claim of r.claims ?? []) {
      section.append(el('h4', `${claim.id}: ${claim.text}`), el('p', claim.basis === 'sources' ? 'Source-linked model interpretation; not independently verified.' : claim.basis === 'reasoning' ? 'Model reasoning.' : 'Unknown support.'));
      paragraph(section, 'Limitations', claim.limitations);
      for (const evidence of claim.evidence) paragraph(section, `Model paraphrase of ${evidence.sourceId}`, evidence.paraphrase);
    }
    section.append(el('h3', 'Sources — opening a link leaves the offline viewer'));
    for (const source of r.sources) {
      const row = el('p'), link = el('a', `${source.id}: ${source.title}`);
      // Defense in depth for a modified data block. Never activate non-web URLs.
      try { const url = new URL(source.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error(); link.href = url.href; } catch { row.append(el('span', `${source.id}: ${source.title} (unavailable URL)`)); section.append(row); continue; }
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; row.append(link);
      row.append(el('span', `\n${source.url}\n${source.provenance === 'imported' ? 'Imported read metadata; not observed by this installation.' : source.provenance === 'recorded-read' ? 'Recorded successful read of requested URL; redirect destination and publication date unknown.' : 'Legacy source; read provenance unknown.'}\nRetrieval time: ${source.retrievedAt ?? 'Unknown'}`)); section.append(row);
    }
    parent.append(section);
  }
  function show() {
    const n = byId.get(selected), detail = $('detail'); detail.replaceChildren();
    const title = el('h2', n.question); title.id = 'node-title'; title.tabIndex = -1;
    detail.append(title, el('p', `${n.id} · ${n.role === 'direction' ? 'Direction (user supplied; not an answer)' : n.role === 'idea' ? 'Idea' : 'Question'} · ${n.category}`), el('p', `State: ${n.status}${n.review ? ' · Needs review' : ''}`));
    if (n.role === 'question') detail.append(el('p', `Importance: ${n.importance ?? 'Unranked'}`));
    if (n.importance) {
      const assessment = el('details'); assessment.append(el('summary', 'Why this importance?'), el('p', 'Historical model assessment for original wording and context; not confidence, certainty or a user decision. Not automatically reassessed after changes.'), el('p', `Original suggested wording: ${n.originalQuestion}`), el('p', n.importanceReason)); detail.append(assessment);
    }
    if (n.parentId) jump(detail, n.parentId, `Parent: ${byId.get(n.parentId).question}`);
    else detail.append(el('p', 'Root of this exported selection.'));
    paragraph(detail, 'Saved user answer', n.answer === null ? 'Not included in this export.' : n.answer || '(No answer text)');
    if (n.researchStale) detail.append(el('p', 'Retained research needs reconsideration after saved reasoning changed. It has not been refreshed.'));
    if (n.research) research(detail, n.research); else detail.append(el('p', 'Research not included.'));
    const children = nodes.filter(child => child.parentId === n.id);
    if (children.length) { detail.append(el('h3', 'Selected children')); for (const child of children) jump(detail, child.id, child.question); }
    const index = nodes.findIndex(node => node.id === selected);
    $('previous').disabled = index === 0; $('next').disabled = index === nodes.length - 1;
    for (const button of $('node-list').querySelectorAll('button')) button.setAttribute('aria-current', String(button.dataset.id === selected));
  }
  function search() {
    const query = $('search').value.toLocaleLowerCase(); filtered = nodes.filter(n => searchable.get(n.id).includes(query));
    $('node-list').replaceChildren(); $('results').textContent = `${filtered.length} of ${nodes.length} selected nodes`;
    for (const n of filtered) { const li = el('li'), button = el('button', `${n.id} · ${n.question}`); button.type = 'button'; button.dataset.id = n.id; button.setAttribute('aria-current', String(n.id === selected)); button.addEventListener('click', () => { selected = n.id; show(); $('node-title').focus(); }); li.append(button); $('node-list').append(li); }
  }
  $('search').addEventListener('input', search);
  $('search').addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); $('search').value = ''; search(); } });
  for (const [id, step] of [['previous', -1], ['next', 1]]) $(id).addEventListener('click', () => { const index = nodes.findIndex(n => n.id === selected) + step; if (nodes[index]) { selected = nodes[index].id; show(); $('node-title').focus(); } });
  search(); show();
}
