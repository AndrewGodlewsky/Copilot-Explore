import { layout } from './web/layout.mjs';
import { effectiveKind, nodeStatus } from './web/answer-state.mjs';

export const VISUAL_LIMITS = Object.freeze({ nodes: 500, inputBytes: 1024 * 1024, outputBytes: 4 * 1024 * 1024, axis: 100000 });
const limitsMessage = 'Visual export exceeds its size limit. Select a smaller branch or use the complete native/Markdown export.';
const formats = { mermaid: ['mmd', 'text/plain; charset=utf-8'], canvas: ['canvas', 'application/json'], svg: ['svg', 'image/svg+xml; charset=utf-8'], print: ['html', 'text/html; charset=utf-8'] };
// XML cannot represent these controls or lone surrogates. Keep an explicit visible
// replacement across formats instead of silently dropping characters.
const portableText = value => String(value).toWellFormed().replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, '\ufffd');
const xml = value => portableText(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const markdown = value => portableText(value).replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '\\$&');
const scopeLabel = scope => scope === 'whole' ? 'Whole journey' : 'Selected branch';

export function visualSnapshot(doc, { scope, nodeId }, scenarioNote) {
  if (!['whole', 'branch'].includes(scope) || (scope === 'whole' ? nodeId !== null : typeof nodeId !== 'string')) throw new Error('Select a whole journey or a saved branch.');
  const rootId = scope === 'whole' ? doc.rootId : nodeId;
  const byId = new Map(doc.nodes.map(n => [n.id, n])), children = new Map(doc.nodes.map(n => [n.id, []]));
  if (!byId.has(rootId)) throw new Error('The selected branch is unavailable. Reopen Export maps.');
  for (const node of doc.nodes) if (node.parentId !== null) children.get(node.parentId).push(node.id);
  const order = [rootId];
  for (let i = 0; i < order.length; i++) {
    order.push(...children.get(order[i]));
    if (order.length > VISUAL_LIMITS.nodes) throw new Error(limitsMessage);
  }
  const ids = new Map(order.map((id, i) => [id, `n${i}`]));
  const nodes = order.map(id => {
    const n = byId.get(id), role = effectiveKind(n);
    return { id: ids.get(id), parentId: id === rootId ? null : ids.get(n.parentId), role,
      question: portableText(n.question), category: portableText(n.category), answer: role === 'question' ? portableText(n.answer) : '',
      ...(role === 'question' && n.importance ? { importance: n.importance, importanceReason: portableText(n.importanceReason), originalQuestion: portableText(n.generation.originalQuestion) } : {}),
      status: nodeStatus(n), review: n.review === true };
  });
  if (scenarioNote) nodes[0].scenarioNote = portableText(scenarioNote);
  const snapshot = { scope, rootId: 'n0', nodes };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > VISUAL_LIMITS.inputBytes) throw new Error(limitsMessage);
  return snapshot;
}

function cardLines(n) {
  const role = { idea: 'Idea', question: 'Question', direction: 'Direction (user supplied; not an answer)' }[n.role];
  return [...(n.scenarioNote ? [n.scenarioNote, ''] : []), `${n.id} · ${role}`, `Category: ${n.category}`, `State: ${n.status}${n.review ? ' · Needs review' : ''}`, 'Downstream impact unavailable in this export.', 'Connections show tree structure only.', '', n.question,
    ...(n.role === 'question' ? [`Importance: ${n.importance ?? 'Unranked'}`, ...(n.importance ? ['Historical model assessment for original wording and context; not confidence, certainty or a user decision. Not automatically reassessed after changes.', `Original suggested wording: ${n.originalQuestion}`, n.importanceReason] : [])] : []),
    ...(n.role === 'question' ? ['', 'Saved user answer:', n.answer || '(No answer text)'] : [])];
}
function wrapped(lines) {
  return lines.flatMap(line => line.split('\n').flatMap(part => {
    const points = [...part], result = [];
    for (let i = 0; i < points.length; i += 44) result.push(points.slice(i, i + 44).join(''));
    return result.length ? result : [''];
  }));
}
export function visualLayout(snapshot) {
  const lines = new Map(snapshot.nodes.map(n => [n.id, wrapped(cardLines(n))]));
  const sizes = new Map(snapshot.nodes.map(n => [n.id, { width: 400, height: 32 + lines.get(n.id).length * 20 }]));
  const positions = layout(snapshot.nodes, snapshot.rootId, sizes);
  let left = Infinity, right = -Infinity, bottom = 0;
  for (const box of positions.values()) { left = Math.min(left, box.x); right = Math.max(right, box.x + box.width); bottom = Math.max(bottom, box.y + box.height); }
  const width = Math.ceil(right - left + 48), height = Math.ceil(bottom + 88);
  if (width > VISUAL_LIMITS.axis || height > VISUAL_LIMITS.axis) throw new Error(limitsMessage);
  for (const box of positions.values()) { box.x = Math.round(box.x - left + 24); box.y += 64; }
  return { positions, lines, width, height };
}
function svgMap(snapshot, scene) {
  const { positions, lines, width, height } = scene;
  const parts = []; let bytes = 0;
  const append = (...values) => {
    for (const value of values) {
      bytes += Buffer.byteLength(value) + 1;
      if (bytes > VISUAL_LIMITS.outputBytes) throw new Error(limitsMessage);
      parts.push(value);
    }
  };
  append(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="map-title">`,
    `<title id="map-title">Explorer — ${scopeLabel(snapshot.scope)}</title>`, '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<text x="24" y="30" font-family="sans-serif" font-size="18" fill="#222222">${scopeLabel(snapshot.scope)} · ${snapshot.nodes.length} saved nodes</text>`);
  for (const n of snapshot.nodes) if (n.parentId) {
    const box = positions.get(n.id), parent = positions.get(n.parentId), x1 = parent.x + parent.width / 2, y1 = parent.y + parent.height, x2 = box.x + box.width / 2, y2 = box.y;
    append(`<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}" fill="none" stroke="#667788" stroke-width="2"/>`);
  }
  for (const n of snapshot.nodes) {
    const box = positions.get(n.id);
    append(`<g id="${n.id}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="8" fill="${n.role === 'direction' ? '#f4f1e8' : '#edf3f5'}" stroke="#667788"/>`);
    for (const [i, line] of lines.get(n.id).entries()) {
      // Fixed text lengths keep fallback/CJK fonts inside the card. This is a
      // portable illustration, not the live panel's font metrics or typography.
      append(`<text x="${box.x + 16}" y="${box.y + 24 + i * 20}" font-family="monospace" font-size="14" fill="#202830" xml:space="preserve"${line ? ` textLength="${Math.min(368, [...line].length * 8)}" lengthAdjust="spacingAndGlyphs"` : ''}>${xml(line)}</text>`);
    }
    append('</g>');
  }
  return parts.join('\n') + '\n</svg>';
}
function printDocument(snapshot, svg) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Explorer printable map</title><style>
body{font:14px/1.5 sans-serif;color:#202830;margin:24px}svg{width:100%;height:auto;max-height:85vh}article{border-top:1px solid #667788;margin-top:24px;padding-top:16px;break-before:page}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere} @media print{.instructions{display:none}.overview{break-after:page}svg{max-height:240mm}body{margin:0}article{margin:0;border:0}} @page{size:auto;margin:15mm}
</style></head><body><div class="instructions"><h1>Print your saved map</h1><p>Open this downloaded file in Brave. Choose Print, then Save as PDF. Check paper size, scale and page preview before saving. The overview may be small; complete readable cards follow on separate pages. Large cards can span pages. Explorer cannot confirm printing or saving.</p></div><section class="overview">${svg}</section>${snapshot.nodes.map(n => `<article><h2>${n.id} — ${xml(scopeLabel(snapshot.scope))}</h2><p>${n.parentId ? `Parent: ${n.parentId}` : 'Root of exported scope'}</p><pre>${xml(cardLines(n).join('\n'))}</pre></article>`).join('')}</body></html>`;
}

export function visualExport(doc, input, scenarioNote) {
  if (!Object.hasOwn(formats, input.format)) throw new Error('Choose Mermaid, JSON Canvas, SVG or Print / PDF.');
  const snapshot = visualSnapshot(doc, input, scenarioNote);
  let content;
  if (input.format === 'mermaid') {
    // Mermaid decimal entities are its documented label escape mechanism. Encode
    // syntax punctuation, controls and newlines; never emit user IDs/directives.
    const label = value => [...value].map(c => /[\p{L}\p{N} ]/u.test(c) ? c : `#${c.codePointAt(0)};`).join('');
    content = `flowchart TD\n%% ${scopeLabel(snapshot.scope)}; saved answers only\n` + snapshot.nodes.map(n => `  ${n.id}["${label(cardLines(n).join('\n'))}"]`).join('\n') + '\n' + snapshot.nodes.filter(n => n.parentId).map(n => `  ${n.parentId} --> ${n.id}`).join('\n') + '\n';
  } else {
    const scene = visualLayout(snapshot);
    if (input.format === 'canvas') content = JSON.stringify({ nodes: snapshot.nodes.map(n => ({ id: n.id, type: 'text', ...scene.positions.get(n.id), branch: undefined, text: `${scopeLabel(snapshot.scope)}\n\n${cardLines(n).map(markdown).join('\n\n')}` })), edges: snapshot.nodes.filter(n => n.parentId).map((n, i) => ({ id: `e${i}`, fromNode: n.parentId, fromSide: 'bottom', toNode: n.id, toSide: 'top', toEnd: 'arrow' })) }, null, 2);
    else { const svg = svgMap(snapshot, scene); content = input.format === 'svg' ? svg : printDocument(snapshot, svg); }
  }
  if (Buffer.byteLength(content) > VISUAL_LIMITS.outputBytes) throw new Error(limitsMessage);
  const [extension, type] = formats[input.format];
  return { content, type, filename: `exploration-${input.scope}.${extension}` };
}
