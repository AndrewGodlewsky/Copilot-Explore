import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { validateContributionEvent, nodeAttributionDigest } from './contributors.mjs';
import { effectiveKind, isQuestion } from './web/answer-state.mjs';

export const COMMENT_LIMITS = Object.freeze({ threads: 64, perThread: 32, messages: 256, text: 4000, suggestion: 5000, bytes: 512 * 1024 });
const invalid = () => { throw Error('Invalid discussion data or comment limit exceeded.'); };
function fields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => ![...required, ...optional].includes(key))) invalid();
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(); }
}
function text(value, max) { if (typeof value !== 'string' || !value.isWellFormed() || !value.trim() || value.length > max) invalid(); return value; }
function uuid(value) { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) invalid(); return value; }
function nodeId(value) { text(value, 100); if (value.trim() !== value) invalid(); return value; }
function digest(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(); }
function array(value, max, nonempty = false) {
  if (!Array.isArray(value) || value.length > max || nonempty && !value.length || Reflect.ownKeys(value).length !== value.length + 1 || Object.keys(value).some((key, index) => key !== String(index))) invalid();
  for (let i = 0; i < value.length; i++) { const descriptor = Object.getOwnPropertyDescriptor(value, String(i)); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(); }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function commentMessagesDigest(messages) {
  return createHash('sha256').update(JSON.stringify(canonical([...messages].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))).digest('hex');
}
export function commentSource(node) {
  if (!node) throw Error('That discussion source no longer exists.');
  return { question: node.question, kind: effectiveKind(node), answerDigest: nodeAttributionDigest(node, 'answer') };
}
export function validateComments(value) {
  fields(value, ['version', 'threads']); if (value.version !== 1) invalid(); array(value.threads, COMMENT_LIMITS.threads);
  const threadIds = new Set(), messageIds = new Set();
  for (const thread of value.threads) {
    fields(thread, ['id', 'nodeId', 'source', 'messages', 'status']); uuid(thread.id); nodeId(thread.nodeId);
    if (threadIds.has(thread.id)) invalid(); threadIds.add(thread.id);
    fields(thread.source, ['question', 'kind', 'answerDigest']); text(thread.source.question, 4000); digest(thread.source.answerDigest);
    if (!['idea', 'question', 'direction'].includes(thread.source.kind)) invalid();
    array(thread.messages, COMMENT_LIMITS.perThread, true);
    for (const message of thread.messages) {
      fields(message, ['id', 'text', 'event'], ['suggestion']); uuid(message.id); text(message.text, COMMENT_LIMITS.text); validateContributionEvent(message.event);
      if (messageIds.has(message.id)) invalid(); messageIds.add(message.id);
      if (Object.hasOwn(message, 'suggestion')) { text(message.suggestion, COMMENT_LIMITS.suggestion); if (thread.source.kind !== 'question') invalid(); }
    }
    fields(thread.status, ['state', 'event', 'messagesDigest']);
    if (!['open', 'resolved'].includes(thread.status.state)) invalid(); validateContributionEvent(thread.status.event); digest(thread.status.messagesDigest);
  }
  if (messageIds.size > COMMENT_LIMITS.messages || Buffer.byteLength(JSON.stringify(value, null, 2)) > COMMENT_LIMITS.bytes) invalid();
  return structuredClone(value);
}
export function commentStatuses(doc) {
  const nodes = new Map((doc?.nodes ?? []).map(node => [node.id, node]));
  return Object.fromEntries((doc?.comments?.threads ?? []).map(thread => {
    const node = nodes.get(thread.nodeId), historical = thread.status.state === 'resolved' && thread.status.messagesDigest !== commentMessagesDigest(thread.messages);
    return [thread.id, { context: !node ? 'orphaned' : equal(commentSource(node), thread.source) ? 'current' : 'changed', state: historical ? 'open' : thread.status.state, resolution: historical ? 'historical' : 'current', messageCount: thread.messages.length, canSuggest: !!node && isQuestion(node) }];
  }));
}
/** Submission IDs identify retries only. The caller supplies the trusted event. */
export function changeComments(document, action, input, event) {
  event = validateContributionEvent(event);
  if (!['create', 'reply', 'resolve', 'reopen'].includes(action)) invalid();
  const posting = action === 'create' || action === 'reply';
  fields(input, [...(action === 'create' ? ['nodeId'] : []), 'threadId', ...(posting ? ['messageId', 'text'] : [])], posting ? ['suggestion'] : []);
  uuid(input.threadId);
  if (action === 'create') nodeId(input.nodeId);
  if (posting) { uuid(input.messageId); text(input.text, COMMENT_LIMITS.text); if (Object.hasOwn(input, 'suggestion')) text(input.suggestion, COMMENT_LIMITS.suggestion); }
  const result = structuredClone(document), comments = result.comments ? validateComments(result.comments) : { version: 1, threads: [] };
  let thread = comments.threads.find(thread => thread.id === input.threadId);
  const sameMessage = message => message?.text === input.text && message?.suggestion === input.suggestion;
  const reused = () => { throw Error('That comment submission ID was already used for different content. Keep your draft and start a new submission.'); };
  if (action === 'create' && thread) {
    if (thread.nodeId !== input.nodeId || !sameMessage(thread.messages.find(message => message.id === input.messageId))) reused();
    return result;
  }
  if (action !== 'create' && !thread) throw Error('That discussion no longer exists. Refresh and preserve your draft.');
  if (posting) {
    const prior = comments.threads.flatMap(thread => thread.messages).find(message => message.id === input.messageId);
    if (prior) { if (action !== 'reply' || !thread.messages.includes(prior) || !sameMessage(prior)) reused(); return result; }
    if (action === 'reply' && thread.status.state === 'resolved' && thread.status.messagesDigest === commentMessagesDigest(thread.messages)) throw Error('Reopen this resolved discussion before replying.');
    const message = { id: input.messageId, text: input.text, event, ...(Object.hasOwn(input, 'suggestion') ? { suggestion: input.suggestion } : {}) };
    if (action === 'create') {
      const source = commentSource(result.nodes.find(node => node.id === input.nodeId));
      thread = { id: input.threadId, nodeId: input.nodeId, source, messages: [message], status: { state: 'open', event: structuredClone(event), messagesDigest: commentMessagesDigest([message]) } };
      comments.threads.push(thread);
    } else thread.messages.push(message);
  } else {
    const state = action === 'resolve' ? 'resolved' : 'open', messagesDigest = commentMessagesDigest(thread.messages);
    if (thread.status.state === state && (state === 'open' || thread.status.messagesDigest === messagesDigest)) return result;
    thread.status = { state, event, messagesDigest };
  }
  result.comments = validateComments(comments);
  return result;
}
