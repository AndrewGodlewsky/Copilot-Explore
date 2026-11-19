import { isDeepStrictEqual as equal } from 'node:util';
import { validateContributionEvent } from './contributors.mjs';
import { ADR_FILE_LIMIT, adrFilePath, adrFileMarker, adrBytesDigest, validateAdrFile, validateAdrFiles } from './adr-file.mjs';

const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const invalid = () => { throw Error('Invalid ADR lifecycle or relationship. Preserve existing decisions and review their status, dates and reciprocal references.'); };
const empty = () => ({ version: 1, events: [], predecessor: null, successors: [], supersededBy: null });
const ref = record => ({ id: record.id, path: record.path });
const reachedAcceptance = record => !!record.lifecycle?.events.some(event => event.to === 'accepted');
const allowed = (from, to, accepted) => from === 'proposed' && ['accepted', 'deprecated'].includes(to) || from === 'accepted' && ['deprecated', 'superseded'].includes(to) || from === 'deprecated' && accepted && to === 'superseded';
function reference(value) {
  if (!keys(value, 'id,path')) invalid(); adrFileMarker(value.id);
  return { id: value.id, path: adrFilePath(value.path) };
}
export function validateAdrLifecycle(value, status) {
  if (!keys(value, 'version,events,predecessor,successors,supersededBy') || value.version !== 1 || !Array.isArray(value.events) || value.events.length > 3 || !Array.isArray(value.successors) || value.successors.length > 49) invalid();
  let previous = 'proposed', accepted = false, at = null;
  const events = value.events.map(event => {
    if (!keys(event, 'from,to,actor,at') || event.from !== previous || !allowed(previous, event.to, accepted)) invalid();
    const stamp = validateContributionEvent({ actor: event.actor, at: event.at });
    if (at !== null && stamp.at < at) invalid();
    previous = event.to; accepted ||= previous === 'accepted'; at = stamp.at;
    return { from: event.from, to: event.to, ...stamp };
  });
  if (previous !== status || (status === 'superseded') !== (value.supersededBy !== null)) invalid();
  const successors = value.successors.map(reference);
  if (new Set(successors.map(value => value.id)).size !== successors.length || new Set(successors.map(value => value.path.toLowerCase())).size !== successors.length) invalid();
  const result = { version: 1, events, predecessor: value.predecessor === null ? null : reference(value.predecessor), successors, supersededBy: value.supersededBy === null ? null : reference(value.supersededBy) };
  if (Buffer.byteLength(JSON.stringify(result)) > 32768) throw Error('ADR lifecycle metadata exceeds its 32 KiB limit. No history or relationships were dropped.');
  return result;
}
export function validateAdrRelationships(records) {
  const byId = new Map(records.map(record => [record.id, record]));
  const target = value => { const record = byId.get(value.id); if (!record || record.path !== value.path) invalid(); return record; };
  for (const record of records) {
    const lifecycle = record.lifecycle; if (!lifecycle) continue;
    if (lifecycle.predecessor) {
      const parent = target(lifecycle.predecessor);
      if (parent.id === record.id || !reachedAcceptance(parent) || !parent.lifecycle.successors.some(value => equal(value, ref(record)))) invalid();
    }
    const successors = lifecycle.successors.map(value => {
      const child = target(value);
      if (child.id === record.id || !reachedAcceptance(record) || !equal(child.lifecycle?.predecessor, ref(record))) invalid();
      return child;
    });
    const accepted = successors.filter(reachedAcceptance);
    if (accepted.length > 1 || (accepted.length === 1) !== (record.status === 'superseded')) invalid();
    if (record.status === 'superseded' && !equal(lifecycle.supersededBy, ref(accepted[0]))) invalid();
  }
  const visiting = new Set(), done = new Set();
  const visit = id => {
    if (visiting.has(id)) invalid(); if (done.has(id)) return;
    visiting.add(id); for (const child of byId.get(id).lifecycle?.successors ?? []) visit(child.id);
    visiting.delete(id); done.add(id);
  };
  for (const record of records) visit(record.id);
  return records;
}
export function changeAdrLifecycle(records, input, event) {
  if (!keys(input, 'kind,id') || !['accept', 'deprecate'].includes(input.kind)) invalid();
  const next = structuredClone(validateAdrFiles(records)), current = next.find(record => record.id === input.id), stamp = validateContributionEvent(event);
  if (!current) invalid();
  const transition = (record, to) => {
    if (!allowed(record.status, to, reachedAcceptance(record))) throw Error('This ADR status transition is not available. Refresh its lifecycle before choosing again.');
    record.lifecycle ??= empty(); record.lifecycle.events.push({ from: record.status, to, ...stamp }); record.status = to;
  };
  if (input.kind === 'accept' && current.lifecycle?.predecessor) {
    const parent = next.find(record => record.id === current.lifecycle.predecessor.id);
    transition(parent, 'superseded'); parent.lifecycle.supersededBy = ref(current);
  }
  transition(current, input.kind === 'accept' ? 'accepted' : 'deprecated');
  return validateAdrFiles(next);
}
export function linkAdrSuccessor(records, predecessorId, successor) {
  const next = structuredClone(validateAdrFiles(records)), parent = next.find(record => record.id === predecessorId), child = validateAdrFile(successor);
  if (!parent || !reachedAcceptance(parent) || parent.status === 'superseded' || child.status !== 'proposed' || child.lifecycle || next.some(record => record.id === child.id)) throw Error('Choose an accepted or previously accepted deprecated ADR and a new proposed successor. Existing decisions are preserved.');
  child.lifecycle = { ...empty(), predecessor: ref(parent) }; parent.lifecycle.successors.push(ref(child)); next.push(child);
  return validateAdrFiles(next);
}

const md = value => String(value).replace(/[\\`*_{}[\]<>#+!|()&.:=~-]/g, '\\$&').replace(/\r\n?/g, '\n');
const footerMarker = id => `<!-- copilot-explorer-lifecycle:v1:${id} -->`;
const notice = status => `> Status: ${status}. ${status === 'proposed' ? 'Accepting wording is not decision approval.' : 'This decision status was explicitly set by the user.'} Source statements and AI synthesis retain their uncertainty.\n`;
export function adrLifecycleFooter(value) {
  const record = validateAdrFile(value), lifecycle = record.lifecycle; if (!lifecycle) return '';
  const lines = ['', footerMarker(record.id), '## Decision lifecycle', '', `Current decision status: ${record.status}.`, '',
    'Status changes do not verify source evidence or resolve its uncertainty. Contributor names are optional and self-declared. Recorded times were fixed in the explicitly confirmed preview.', ''];
  for (const event of lifecycle.events) lines.push(`- ${event.from} to ${event.to}: ${md(event.at)}; ${event.actor ? `self-declared contributor ${md(event.actor.displayName)} (${md(event.actor.id)})` : 'contributor unspecified'}.`, '');
  if (!lifecycle.events.length) lines.push('No decision acceptance or other status transition is recorded.', '');
  const relation = (label, value) => { if (value) lines.push(`${label}: ${md(value.id)} — ${md(value.path)} (original working-directory relative).`, ''); };
  relation('Predecessor', lifecycle.predecessor);
  for (const successor of lifecycle.successors) relation('Successor proposal or decision', successor);
  relation('Superseded by', lifecycle.supersededBy);
  return lines.join('\n');
}
function bodyOf(content, record) {
  if (typeof content !== 'string' || !content.isWellFormed() || adrBytesDigest(content) !== record.sha256 || !content.endsWith(adrFileMarker(record.id) + '\n')) throw Error('ADR file bytes or identity changed. Review the original file before changing its lifecycle.');
  return content.slice(0, -(adrFileMarker(record.id).length + 1));
}
function finish(body, record) {
  const result = body + adrLifecycleFooter(record) + adrFileMarker(record.id) + '\n';
  if (Buffer.byteLength(result) > ADR_FILE_LIMIT) throw Error('ADR lifecycle Markdown exceeds the 64 KiB file limit. Nothing was clipped or overwritten.');
  return result;
}
export function appendAdrLifecycle(content, value) {
  const record = validateAdrFile(value), body = bodyOf(content, record);
  if (body.includes(footerMarker(record.id))) throw Error('ADR lifecycle metadata is already present. Review the existing file instead of appending another footer.');
  return finish(body, record);
}
export function transitionAdrMarkdown(content, original, updated) {
  const before = validateAdrFile(original), after = validateAdrFile(updated);
  const immutable = ({ status, lifecycle, sha256, writtenAt, ...value }) => value;
  if (!equal(immutable(before), immutable(after))) throw Error('A lifecycle transition cannot replace ADR decision text, identity or captured sources. Create a successor proposal for changed reasoning.');
  let body = bodyOf(content, before);
  if (before.lifecycle) {
    const footer = adrLifecycleFooter(before); if (!body.endsWith(footer)) throw Error('ADR lifecycle footer differs from the recorded version. Preserve the file and review it.');
    body = body.slice(0, -footer.length);
  }
  if (!body.includes(notice(before.status))) throw Error('ADR status notice differs from the recorded version. Preserve the file and review it.');
  body = body.replace(notice(before.status), notice(after.status));
  body = body.replace(/^---\n([\s\S]*?)\n---\n/, (whole, metadata) => `---\n${metadata.replace(/^status: .+$/m, line => {
    if (line !== `status: ${JSON.stringify(before.status)}`) invalid(); return `status: ${JSON.stringify(after.status)}`;
  })}\n---\n`);
  body = body.replace(/^(#{2,3} status\n\n)([^\n]*)\n/gim, (_, heading, status) => {
    if (status !== before.status) invalid(); return heading + after.status + '\n';
  });
  return finish(body, after);
}
