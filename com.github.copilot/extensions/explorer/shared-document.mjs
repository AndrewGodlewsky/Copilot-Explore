import { createHash } from 'node:crypto';
import { FORMAT, MAX_DOCUMENT_BYTES, validateDocument } from './model.mjs';

export const SHARED_FORMAT = 'copilot-explorer-shared';
export const SHARED_VERSION = 1;
export const MAX_SHARED_BYTES = MAX_DOCUMENT_BYTES;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => new Error(`Cannot edit this shared exploration: ${message}`);
function canonical(value) {
  // Legacy accepted artifacts hash these subtrees with order-sensitive JSON.
  // Keep those hash inputs intact, including stale historical guidance/evidence.
  const retained = new Set([value.journey?.pins, value.journey?.handoff?.guidance, value.journey?.handoff?.evidence, value.journey?.adrDraft?.guidance, value.journey?.adrDraft?.evidence]);
  const order = (item, preserve = false) => {
    if (!item || typeof item !== 'object') return item;
    preserve ||= retained.has(item);
    if (Array.isArray(item)) return item.map(value => order(value, preserve));
    const keys = Object.keys(item);
    return Object.fromEntries((preserve ? keys : keys.sort()).map(key => [key, order(item[key], preserve)]));
  };
  return JSON.stringify(order(value), null, 2) + '\n';
}

function checkSize(content) {
  if (Buffer.byteLength(content) > MAX_SHARED_BYTES) throw fail('the file exceeds the 9 MiB size limit. Keep the original and reduce a separate copy.');
  return content;
}

function jsonTree(value) {
  const seen = new Set(), queue = [{ value, depth: 0 }];
  for (let i = 0; i < queue.length; i++) {
    const { value: item, depth } = queue[i];
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) continue;
    if (!item || typeof item !== 'object' || depth > 64 || seen.has(item)) throw fail('invalid JSON tree (unsupported value, cycle or excessive depth).');
    seen.add(item);
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw fail('only plain JSON data is supported.');
    const keys = Reflect.ownKeys(item).filter(key => !(Array.isArray(item) && key === 'length'));
    if (Array.isArray(item) && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) throw fail('arrays must contain only ordered JSON entries.');
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')) throw fail('hidden fields, symbols and accessors are unsupported.');
      queue.push({ value: field.value, depth: depth + 1 });
    }
  }
}

function parse(source) {
  if (!Buffer.isBuffer(source) && typeof source !== 'string') throw fail('read the original UTF-8 file bytes before editing.');
  checkSize(source);
  let content;
  try {
    if (typeof source === 'string' && !source.isWellFormed()) throw new Error();
    content = typeof source === 'string' ? source : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
  } catch { throw fail('invalid UTF-8 encoding. The original bytes must be preserved.'); }
  let value;
  try { value = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw fail('invalid JSON. The original bytes must be preserved.'); }
  // JSON.parse keeps only the last duplicate key; reject that silent data loss.
  const stack = [];
  for (const token of content.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    const text = token[0];
    if (text === '{') stack.push(new Set());
    else if (text === '[') stack.push(null);
    else if (text === '}' || text === ']') stack.pop();
    else {
      let next = token.index + text.length;
      while (/\s/.test(content[next] ?? '') && next < content.length) next++;
      if (content[next] !== ':') continue;
      const key = JSON.parse(text), keys = stack.at(-1);
      if (keys?.has(key)) throw fail('duplicate JSON keys cannot be preserved safely.');
      keys?.add(key);
    }
  }
  jsonTree(value);
  return { content, value, baseDigest: digest(content) };
}

// Other versioned repository records share the lossless JSON boundary; each
// caller still validates its own schema and any smaller byte limit.
export { parse as parseDocumentJson };

const identityField = key => /(^id$|Id$)/.test(key) || ['format', 'version', 'mode', 'kind', 'answerState', 'origin', 'basis', 'provenance', 'url', 'createdAt', 'updatedAt', 'finishedAt', 'retrievedAt'].includes(key);
function preservable(original, normalized, path = 'journey', key = '') {
  if (original !== null && typeof original === 'object') {
    if (!normalized || typeof normalized !== 'object' || Array.isArray(original) !== Array.isArray(normalized)) throw fail(`invalid field at ${path}.`);
    if (Array.isArray(original) && original.length !== normalized.length) throw fail(`cannot preserve array entries at ${path}.`);
    for (const name of Object.keys(original)) {
      if (!Object.hasOwn(normalized, name)) throw fail(`unsupported field at ${path}.${name}; use a client that understands it.`);
      preservable(original[name], normalized[name], `${path}.${name}`, name);
    }
  } else if (original !== normalized && !(typeof original === 'string' && normalized === original.trim() && !identityField(key))) {
    throw fail(`cannot preserve the meaning or identity of ${path}.`);
  }
}

function personal(value) {
  if (value?.format !== FORMAT || value.version !== 1) throw fail('only supported personal v1 files can be explicitly migrated.');
  const normalized = validateDocument(value);
  preservable(value, normalized);
  return normalized;
}

function validate(value) {
  jsonTree(value);
  if (value?.format !== SHARED_FORMAT || value.version !== SHARED_VERSION) throw fail('unsupported shared format/version. Personal v1 files require explicit migration.');
  for (const key of Object.keys(value)) if (!['format', 'version', 'journey', 'extensions'].includes(key)) throw fail(`unsupported field ${key}.`);
  if (!value.journey || typeof value.journey !== 'object' || Array.isArray(value.journey)) throw fail('invalid journey.');
  for (const key of ['format', 'version', 'revision']) if (Object.hasOwn(value.journey, key)) throw fail(`journey.${key} is not part of the shared content.`);
  if (Object.hasOwn(value, 'extensions') && (!value.extensions || typeof value.extensions !== 'object' || Array.isArray(value.extensions) || Object.keys(value.extensions).length)) throw fail('unsupported extensions; preserve this file with a compatible client.');
  const normalized = validateDocument({ ...value.journey, format: FORMAT, version: 1, revision: 0 });
  preservable(value.journey, normalized);
  return value;
}
export { validate as validateSharedDocument };

/** Validation only: compatibility defaults may be checked but are never written. */
export function validateExplorationSource(source) {
  const parsed = parse(source);
  if (parsed.value?.format === SHARED_FORMAT) { validate(parsed.value); return { format: SHARED_FORMAT, version: SHARED_VERSION, id: parsed.value.journey.id, nodes: parsed.value.journey.nodes.length }; }
  const doc = personal(parsed.value);
  return { format: doc.format, version: doc.version, id: doc.id, nodes: doc.nodes.length };
}

/** Pure read: retains original text and never inserts model defaults into shared content. */
export function readSharedDocument(source) {
  const parsed = parse(source), document = validate(parsed.value);
  const serialized = canonical(document);
  return { document, content: parsed.content, baseDigest: parsed.baseDigest, contentDigest: digest(serialized) };
}

/** The storage caller must reread under its lock and pass that current file here. */
export function prepareSharedWrite(currentSource, nextDocument, expectedBaseDigest) {
  if (typeof expectedBaseDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedBaseDigest)) throw fail('a valid original base digest is required.');
  const current = readSharedDocument(currentSource);
  if (current.baseDigest !== expectedBaseDigest) throw fail('the base file changed. Refresh and resolve the changes before saving.');
  const document = validate(nextDocument), serialized = canonical(document), contentDigest = digest(serialized);
  const changed = contentDigest !== current.contentDigest;
  if (changed) checkSize(serialized);
  return { changed, baseDigest: current.baseDigest, contentDigest, content: changed ? serialized : current.content };
}

/** Prepare a separate shared copy; no personal file, history or revision is rewritten. */
export function prepareSharedMigration(personalSource) {
  const parsed = parse(personalSource); personal(parsed.value);
  const { format, version, revision, ...journey } = parsed.value;
  const document = validate({ format: SHARED_FORMAT, version: SHARED_VERSION, journey, extensions: {} });
  const content = checkSize(canonical(document));
  return { sourceDigest: parsed.baseDigest, document, content, contentDigest: digest(content) };
}
