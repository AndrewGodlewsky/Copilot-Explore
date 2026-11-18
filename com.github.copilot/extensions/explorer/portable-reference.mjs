import { validateProjectPath } from './project-repository.mjs';
import { savedDigest } from './review-causes.mjs';
import { effectiveAnswerState, effectiveKind } from './web/answer-state.mjs';

export const PORTABLE_REFERENCE_LIMIT = 8192;
const heading = 'Explorer reference: use Tools > Open reference in the target checkout.';
const prefix = `${heading}\n\n\`\`\`explorer-reference\n`, suffix = '\n```';
const invalid = () => { throw Error('Invalid portable reference. Copy a supported Explorer reference with an exact saved-file location and target identity.'); };
const identity = value => typeof value === 'string' && value.isWellFormed() && value.length <= 100 && !!value.trim() && value.trim() === value;

function validate(value) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) ||
    keys.sort().join(',') !== (Object.hasOwn(value, 'fingerprint') ? 'fingerprint,format,journeyId,nodeId,path,version' : 'format,journeyId,nodeId,path,version') ||
    value.format !== 'explorer-reference' || value.version !== 1 || !identity(value.journeyId) || !identity(value.nodeId)) invalid();
  if (typeof value.path !== 'string' || !value.path.isWellFormed() || !value.path.endsWith('.explore.json')) throw Error('Use a valid project-relative shared .explore.json reference path.');
  validateProjectPath(value.path);
  if (Object.hasOwn(value, 'fingerprint') && (typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint))) invalid();
  return { format: 'explorer-reference', version: 1, path: value.path, journeyId: value.journeyId, nodeId: value.nodeId, ...(Object.hasOwn(value, 'fingerprint') ? { fingerprint: value.fingerprint } : {}) };
}

export function parsePortableReference(text) {
  if (typeof text !== 'string' || !text.isWellFormed() || Buffer.byteLength(text, 'utf8') > PORTABLE_REFERENCE_LIMIT) throw Error('Portable reference text must be valid Unicode within the 8 KiB limit.');
  let source = text.replaceAll('\r\n', '\n').trim();
  if (source.startsWith(prefix) && source.endsWith(suffix)) source = source.slice(prefix.length, -suffix.length);
  let value; try { value = JSON.parse(source); } catch { invalid(); }
  return validate(value);
}

export function formatPortableReference(reference) {
  return `${prefix}${JSON.stringify(validate(reference), null, 2)}${suffix}`;
}

export function portableNodeFingerprint(doc, nodeId) {
  const node = doc.nodes.find(node => node.id === nodeId);
  if (!node) throw Error('The referenced target is missing or removed. No other node was selected.');
  return savedDigest({ journeyId: doc.id, node: { id: node.id, parentId: node.parentId, kind: effectiveKind(node), question: node.question, category: node.category, answer: node.answer, answerState: effectiveAnswerState(node), review: node.review, reviewCauses: node.reviewCauses ?? null },
    ...(nodeId === doc.rootId ? { direction: { topic: doc.topic, objective: doc.objective ?? '', successCriteria: doc.successCriteria ?? '', mode: doc.mode ?? 'understand', pins: doc.pins ?? [] } } : {}) });
}

export function createPortableReference(doc, path, nodeId) {
  return validate({ format: 'explorer-reference', version: 1, path, journeyId: doc.id, nodeId, fingerprint: portableNodeFingerprint(doc, nodeId) });
}

export function portableReferenceStatus(reference, doc) {
  const ref = validate(reference);
  if (ref.journeyId !== doc.id) throw Error('The file contains a different journey identity. No journey was opened.');
  const current = portableNodeFingerprint(doc, ref.nodeId);
  return ref.fingerprint === undefined ? 'unchecked' : ref.fingerprint === current ? 'current' : 'changed';
}
