// This function is embedded verbatim in the offline artifact. Keep it independent
// of the live panel, server and host; untrusted data only enters textContent.
export function renderOfflineViewer(snapshot) {
  const $ = id => document.getElementById(id);
  const el = (tag, text) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
  if (snapshot.scenarioNote) document.querySelector('header').append(el('p', snapshot.scenarioNote));
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
    const limitations = (container, predicate) => {
      for (const entry of (r.limitations ?? []).filter(predicate)) {
        const detail = el('details'); detail.setAttribute('data-research-limitation', entry.id);
        detail.append(el('summary', `${entry.kind.replace(/-/g, ' ')} · ${entry.blocksRecommendation ? 'recommendation withheld' : 'qualified conclusion'}`),
          el('p', entry.summary), el('p', 'Model-identified limitation, not an independently verified finding. Your answer remains independent.'), el('p', `Next step: ${entry.nextStep}`));
        detail.append(el('p', `Affected options: ${entry.optionIds.map(id => r.options.find(o => o.id === id).title).join('; ') || 'None specified'}. Claims: ${entry.claimIds.join(', ') || 'None specified'}.`));
        for (const id of entry.decisionIds) {
          const ref = r.recommendationAssessment.decisionRefs.find(ref => ref.id === id);
          detail.append(el('p', `Historical user intent (${ref.answerState}${ref.review ? '; needed review' : ''} at research time): ${ref.reason}`));
        }
        if (!entry.optionIds.length && !entry.claimIds.length && !entry.decisionIds.length) detail.append(el('p', 'Scope: the whole question.'));
        container.append(detail);
      }
    };
    const statementSupport = (container, optionId, field, text) => {
      const support = r.support?.find(item => item.optionId === optionId && item.field === field && item.text === text);
      const claims = (support?.claimIds ?? []).map(id => r.claims.find(claim => claim.id === id));
      const decisions = (support?.decisionIds ?? []).map(id => r.recommendationAssessment.decisionRefs.find(ref => ref.id === id));
      const label = claims.some(claim => claim.basis === 'sources') ? 'Source-linked interpretation · not verified' : decisions.length ? 'User context · not factual verification' : claims.some(claim => claim.basis === 'reasoning') ? 'Model reasoning · no external support' : 'Support unknown';
      const detail = el('details'); detail.setAttribute('data-statement-support', 'true'); detail.append(el('summary', label));
      detail.append(el('p', 'These recorded associations are model interpretations. A page read confirms retrieval, not relevance, entailment or truth.'));
      if (!claims.length && !decisions.length) detail.append(el('p', 'No claim or prior-context reference was recorded for this statement. Factual support is unknown.'));
      for (const claim of claims) {
        detail.append(el('p', `${claim.id}: ${claim.text}`), el('p', claim.basis === 'sources' ? 'Source-linked model interpretation; not independently verified.' : claim.basis === 'reasoning' ? 'Model reasoning; factual support not established.' : 'Unknown support.'), el('p', `Limitations: ${claim.limitations}`));
        for (const evidence of claim.evidence) {
          const source = r.sources.find(item => item.id === evidence.sourceId);
          detail.append(el('p', `Model paraphrase of ${evidence.sourceId}: ${evidence.paraphrase}`));
          const link = el('a', `${source.id}: ${source.title}`);
          try { const url = new URL(source.url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error(); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; const row = el('p'); row.append(link); detail.append(row); }
          catch { detail.append(el('p', 'Source URL unavailable.')); }
          detail.append(el('p', `${source.provenance === 'imported' ? 'Imported read metadata; not observed by this installation.' : source.provenance === 'recorded-read' ? 'Recorded successful read of requested URL; not claim verification.' : 'Read provenance unknown.'} Retrieval time: ${source.retrievedAt ?? 'Unknown'}.`));
        }
      }
      for (const ref of decisions) detail.append(el('p', `Historical user context (${ref.answerState}${ref.review ? '; needed review' : ''} at research time): ${ref.reason}`), el('p', 'User intent, not verified facts or current state.'));
      container.append(detail);
    };
    section.append(el('p', r.basis === 'sources' ? 'Consulted sources. A recorded read does not establish claim support or truth.' : 'Model reasoning; not externally verified.'));
    paragraph(section, 'Summary', r.summary);
    if (r.optionsLimit) paragraph(section, 'Limited options', r.optionsLimit);
    for (const option of r.options) {
      const article = el('section'); article.append(el('h3', option.title), el('p', option.description));
      if (r.recommendationAssessment && r.recommendationAssessment.optionId === option.id) article.append(el('p', 'Recommended option — historical model judgment, not a user decision.'));
      if (r.optionsVersion === 1) paragraph(article, 'Fits when', option.fit);
      limitations(article, entry => entry.optionIds.includes(option.id));
      for (const [field, label] of [['pros', 'Model-stated pros'], ['cons', 'Model-stated cons']]) {
        article.append(el('h3', label));
        if (!option[field].length) article.append(el('p', 'None recorded'));
        for (const value of option[field]) { article.append(el('p', value)); statementSupport(article, option.id, field, value); }
      }
      for (const detail of option.details) paragraph(article, detail.label, detail.value);
      if (option.proposedAnswer !== null) paragraph(article, 'AI suggested answer for this option', option.proposedAnswer);
      section.append(article);
    }
    paragraph(section, 'AI recommendation', r.recommendation);
    statementSupport(section, null, 'recommendation', r.recommendation);
    if (r.recommendationAssessment) {
      const assessment = r.recommendationAssessment;
      if (assessment.optionId === null) {
        section.append(el('p', 'No recommendation is justified by the recorded context.'));
        for (const entry of (r.limitations ?? []).filter(item => item.blocksRecommendation)) {
          const next = el('p', `Next step: ${entry.nextStep}`); next.setAttribute('data-recommendation-next-step', entry.id); section.append(next);
        }
      }
      section.append(el('p', 'Contextual model judgment. Referenced states describe user intent at research time, not verified facts or current state.'));
      paragraph(section, 'Main tradeoff', assessment.mainTradeoff); statementSupport(section, null, 'mainTradeoff', assessment.mainTradeoff);
      paragraph(section, 'Reconsider if', assessment.reconsiderIf); statementSupport(section, null, 'reconsiderIf', assessment.reconsiderIf);
      for (const [i, ref] of assessment.decisionRefs.entries()) {
        paragraph(section, `Prior context ${i + 1} (${ref.answerState}${ref.review ? '; needed review' : ''} at research time)`, ref.reason);
        if (ref.nodeId && byId.has(ref.nodeId)) jump(section, ref.nodeId, `Review included prior question ${i + 1}`);
        else section.append(el('p', 'This prior question is outside the exported selection.'));
      }
    } else section.append(el('p', 'Legacy recommendation: no linked option was recorded.'));
    if (r.proposedAnswer !== null) paragraph(section, 'AI suggested answer', r.proposedAnswer);
    paragraph(section, 'Uncertainty', r.uncertainty);
    section.append(el('h3', 'Model-identified limitations'));
    if (!r.limitations?.length) section.append(el('p', r.limitations ? 'No structured limitations were identified. This is not proof that evidence is complete.' : 'Structured limitation coverage unknown for this older result.'));
    limitations(section, () => true);
    section.append(el('h3', 'Recorded claims and model interpretation'));
    if (r.claims === null) section.append(el('p', 'Legacy research: claim support unknown.'));
    for (const claim of r.claims ?? []) {
      section.append(el('h4', `${claim.id}: ${claim.text}`), el('p', claim.basis === 'sources' ? 'Source-linked model interpretation; not independently verified.' : claim.basis === 'reasoning' ? 'Model reasoning.' : 'Unknown support.'));
      paragraph(section, 'Limitations', claim.limitations);
      limitations(section, entry => entry.claimIds.includes(claim.id));
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
