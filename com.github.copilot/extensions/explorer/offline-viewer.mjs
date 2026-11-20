import { createHash } from 'node:crypto';
import { effectiveKind, nodeStatus } from './web/answer-state.mjs';
import { renderOfflineViewer } from './offline-viewer-runtime.mjs';

export const VIEWER_LIMITS = Object.freeze({ nodes: 500, inputBytes: 1024 * 1024, outputBytes: 4 * 1024 * 1024 });
const limitMessage = 'Offline viewer exceeds its size limit. Select fewer nodes or omit answers/research.';
function bounded(values, max, convert) {
  if (!Array.isArray(values) || values.length > max) throw Error(limitMessage);
  return values.map(convert);
}
function text(value, max = 20000) {
  if (typeof value !== 'string' || value.length > max) throw Error(limitMessage);
  return value;
}
function researchProjection(r, nodeIds) {
  const sourceIds = new Map();
  const optionIds = new Map(r.options.map((option, i) => [option.id, `o${i}`]));
  const sources = bounded(r.sources, 15, (s, i) => {
    let url;
    try { url = new URL(text(s.url, 2000)); } catch { throw Error('Invalid research source URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid research source URL.');
    const id = `s${i}`; if (s.id !== undefined) sourceIds.set(s.id, id);
    return { id, title: text(s.title, 300), url: url.href, retrievedAt: s.retrievedAt === undefined || s.retrievedAt === null ? null : text(s.retrievedAt, 24), provenance: ['recorded-read', 'imported'].includes(s.provenance) ? s.provenance : 'unknown' };
  });
  const claims = r.claims === undefined ? null : bounded(r.claims, 12, (c, i) => ({ id: `c${i}`, text: text(c.text, 1000), basis: c.basis, limitations: text(c.limitations, 1000),
    evidence: bounded(c.evidence, 3, e => { const sourceId = sourceIds.get(e.sourceId); if (!sourceId) throw Error('Unknown research source.'); return { sourceId, paraphrase: text(e.paraphrase, 1000) }; }) }));
  return { basis: r.basis, summary: text(r.summary, 5000),
    ...(r.optionsVersion === 1 ? { optionsVersion: 1, ...(r.optionsLimit ? { optionsLimit: text(r.optionsLimit, 600) } : {}) } : {}),
    options: bounded(r.options, 4, (o, i) => ({ ...(r.optionsVersion === 1 ? { id: `o${i}`, fit: text(o.fit, 400) } : {}), title: text(o.title, 150), description: text(o.description, 3000), pros: bounded(o.pros, 6, p => text(p, 1000)), cons: bounded(o.cons, 6, c => text(c, 1000)),
      details: bounded(o.details ?? [], 8, d => ({ label: text(d.label, 80), value: text(d.value, 1000) })), proposedAnswer: o.proposedAnswer === undefined ? null : text(o.proposedAnswer, 5000) })),
    recommendation: text(r.recommendation, 5000),
    ...(r.recommendationAssessment ? { recommendationAssessment: {
      optionId: r.recommendationAssessment.optionId === null ? null : optionIds.get(r.recommendationAssessment.optionId),
      mainTradeoff: text(r.recommendationAssessment.mainTradeoff, 600), reconsiderIf: text(r.recommendationAssessment.reconsiderIf, 600),
      decisionRefs: bounded(r.recommendationAssessment.decisionRefs, 8, ref => ({ nodeId: nodeIds.get(ref.nodeId) ?? null, reason: text(ref.reason, 400), answerState: ref.answerState, review: ref.review })),
    } } : {}), proposedAnswer: r.proposedAnswer === undefined ? null : text(r.proposedAnswer, 5000), uncertainty: text(r.uncertainty, 3000), sources, claims };
}

export function canonicalViewerSelection(selection) {
  const ids = new Set();
  const result = bounded(selection, VIEWER_LIMITS.nodes, s => {
    if (!s || Object.keys(s).sort().join(',') !== 'answer,nodeId,research' || typeof s.nodeId !== 'string' || !s.nodeId || s.nodeId.length > 100 || typeof s.answer !== 'boolean' || typeof s.research !== 'boolean' || ids.has(s.nodeId)) throw Error('Invalid offline viewer selection.');
    ids.add(s.nodeId); return { nodeId: s.nodeId, answer: s.answer, research: s.research };
  });
  if (!result.length) throw Error('Select at least one saved node.');
  return result.sort((a, b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0);
}
export function viewerSnapshot(doc, selection, scenarioNote) {
  const choices = new Map(canonicalViewerSelection(selection).map(s => [s.nodeId, s]));
  const selected = doc.nodes.filter(n => choices.has(n.id));
  if (selected.length !== choices.size) throw Error('Selected nodes are unavailable. Reopen Export maps.');
  const ids = new Map(selected.map((n, i) => [n.id, `n${i}`]));
  let bytes = 0;
  const nodes = selected.map(n => {
    const choice = choices.get(n.id), role = effectiveKind(n);
    const result = { id: ids.get(n.id), parentId: ids.get(n.parentId) ?? null, role, question: text(n.question, 4000), category: text(n.category, 60), status: nodeStatus(n), review: n.review === true,
      ...(role === 'question' && n.importance ? { importance: n.importance, importanceReason: text(n.importanceReason, 600), originalQuestion: text(n.generation.originalQuestion, 600) } : {}),
      answer: choice.answer && role === 'question' ? text(n.answer) : null,
      research: choice.research && n.research ? researchProjection(n.research, ids) : null,
      ...(choice.research && n.researchStale ? { researchStale: true } : {}) };
    bytes += Buffer.byteLength(JSON.stringify(result)); if (bytes > VIEWER_LIMITS.inputBytes) throw Error(limitMessage);
    return result;
  });
  const snapshot = { nodes, ...(scenarioNote ? { scenarioNote } : {}) };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > VIEWER_LIMITS.inputBytes) throw Error(limitMessage);
  return snapshot;
}
export function viewerDigest(input, snapshot) {
  // Freshness proof, not a secret or authorization token. Original identities
  // bind the preview but never enter the shared HTML file.
  return createHash('sha256').update(JSON.stringify({ journey: input.journey, revision: input.revision, selection: canonicalViewerSelection(input.selection), snapshot })).digest('hex');
}
const style = `:root{font:16px/1.5 system-ui,sans-serif;color:#263238;background:#f6f5f0}*{box-sizing:border-box}body{margin:0}header,main{padding:1rem;max-width:80rem;margin:auto}h1,h2,h3,h4,p{overflow-wrap:anywhere}p{white-space:pre-wrap}a{color:#175a75}button,input{font:inherit;border:1px solid #6b777b;border-radius:4px;padding:.55rem;background:#fff;color:inherit}button{cursor:pointer;text-align:left;overflow-wrap:anywhere}button:disabled{opacity:.55;cursor:default}:focus-visible{outline:3px solid #11647b;outline-offset:3px}.layout{display:grid;grid-template-columns:minmax(14rem,1fr) minmax(0,3fr);gap:1.5rem}aside{min-width:0}input{width:100%}ol{list-style:none;padding:0;max-height:65vh;overflow:auto}li{margin:.4rem 0}li button{width:100%}[aria-current=true]{border-width:3px;background:#e1eef1}#detail{padding:1rem;background:white;border:1px solid #c4cbcc;min-width:0}#detail section{border-top:1px solid #c4cbcc;margin-top:1rem;padding-top:.5rem}#detail button{display:block;margin:.5rem 0;max-width:100%}.paging{display:flex;gap:.5rem;margin:1rem 0} @media(max-width:650px){.layout{display:block}ol{max-height:14rem}header,main{padding:.75rem}#detail{padding:.75rem}}`;
// HTML parsers normalize CRLF; hash the same LF bytes even from a Windows checkout.
const script = `(${renderOfflineViewer.toString()})(JSON.parse(document.getElementById('viewer-data').textContent));`.replace(/\r\n?/g, '\n');
const digest = value => createHash('sha256').update(value).digest('base64');
export function viewerArtifact(snapshot) {
  const data = JSON.stringify(snapshot).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const csp = `default-src 'none'; script-src 'sha256-${digest(script)}'; style-src 'sha256-${digest(style)}'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const content = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Explorer offline viewer</title><style>${style}</style></head><body><header><h1>Explorer — offline, read-only journey</h1><p>This file contains only the previewed selection. It cannot edit a journey, run AI or refresh research. No Copilot account or plugin is needed. Search and navigation stay local. Source links open the web only when you choose them.</p><p>Answer states describe user intent, not verification: Assumption is unverified, Tentative is provisional, Decided is a user decision. Needs review means recheck the answer. Importance, when recorded, is a historical model assessment of impact, not confidence or certainty. Unranked means no assessment was recorded.</p><p>Downstream impact unavailable in this export. This selection omits the complete relationship graph; historical importance is separate from the live map's computed impact.</p></header><main><div class="layout"><aside aria-label="Selected nodes"><label for="search">Search included content</label><input id="search" type="search" maxlength="1000"><p id="results" role="status" aria-live="polite"></p><ol id="node-list"></ol></aside><div><nav class="paging" aria-label="Read selected nodes"><button id="previous" type="button">Previous</button><button id="next" type="button">Next</button></nav><article id="detail" aria-label="Selected node"></article></div></div><noscript>Enable JavaScript to navigate this self-contained viewer. No network connection is required.</noscript></main><script id="viewer-data" type="application/json">${data}</script><script>${script}</script></body></html>`;
  if (Buffer.byteLength(content) > VIEWER_LIMITS.outputBytes) throw Error(limitMessage);
  return { content, type: 'text/html; charset=utf-8', filename: 'exploration-viewer.html' };
}
