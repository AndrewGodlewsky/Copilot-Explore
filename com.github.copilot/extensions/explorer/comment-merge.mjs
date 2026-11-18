import { isDeepStrictEqual as equal } from 'node:util';
import { commentMessagesDigest } from './comments.mjs';

const ordered = (...values) => [...new Set(values.flat())];
const keyed = rows => new Map((rows ?? []).map(row => [row.id, row]));
const target = thread => [thread.nodeId, thread.source];

/** Sources are validated by the shared merge boundary; pick records explicit choices. */
export function mergeComments(base, local, incoming, pick) {
  if ([base, local, incoming].every(value => value === undefined)) return undefined;
  const maps = [base, local, incoming].map(value => keyed(value?.threads)), threads = [];
  for (const id of ordered(...maps.map(map => [...map.keys()]))) {
    const [b, l, r] = maps.map(map => map.get(id));
    if (!l || !r || !equal(target(l), target(r))) {
      const removed = !!b && !!l !== !!r, retargeted = !!l && !!r && !equal(target(l), target(r));
      const selected = pick(`comment-thread:${id}`, 'Discussion target or deletion', b, l, r, removed || retargeted);
      if (selected !== undefined) threads.push(structuredClone(selected));
      continue;
    }
    const messageMaps = [b, l, r].map(thread => keyed(thread?.messages)), messages = [];
    for (const messageId of ordered(...messageMaps.map(map => [...map.keys()]))) {
      const [bm, lm, rm] = messageMaps.map(map => map.get(messageId));
      const selected = pick(`comment-message:${id}:${messageId}`, 'Competing discussion message', bm, lm, rm, !!bm && !!lm !== !!rm);
      if (selected !== undefined) messages.push(structuredClone(selected));
    }
    const mergedDigest = commentMessagesDigest(messages), baseDigest = b && commentMessagesDigest(b.messages);
    const unreviewed = (resolved, other) => b && resolved.status.state === 'resolved' && !equal(resolved.status, b.status)
      && commentMessagesDigest(other.messages) !== baseDigest && resolved.status.messagesDigest !== mergedDigest;
    const status = pick(`comment-status:${id}`, 'Discussion resolution or reopening', b?.status, l.status, r.status,
      !equal(l.status, r.status) && !!(unreviewed(l, r) || unreviewed(r, l)));
    threads.push({ ...structuredClone(l), messages, status: structuredClone(status) });
  }
  return { version: 1, threads };
}
