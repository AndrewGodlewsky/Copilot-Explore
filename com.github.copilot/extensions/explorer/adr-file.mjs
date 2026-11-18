import { createHash } from 'node:crypto';
import { isDeepStrictEqual as equal } from 'node:util';
import { validateAdrDraft } from './adr-draft.mjs';
import { renderAdr } from './adr-format.mjs';
import { validateProjectPaths } from './project-context.mjs';
import { scenarioMarkdown } from './scenario-export.mjs';
import { validateAdrSources, adrSourcesMarkdown } from './adr-sources.mjs';

export const ADR_FILE_LIMIT = 65536;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const invalid = () => { throw Error('Invalid ADR file reference. Check its proposed status, relative Markdown path and bounded metadata.'); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const adrBytesDigest = value => createHash('sha256').update(value).digest('hex');
export const adrArtifactDigest = value => adrBytesDigest(JSON.stringify(canonical(validateAdrDraft(value))));
export function adrFilePath(value) {
  validateProjectPaths([value]);
  if (!/\.md$/i.test(value) || value.split('/').some(part => Buffer.byteLength(part) > 240)) invalid();
  return value;
}
export function adrFileMarker(value) { if (!id(value)) invalid(); return `<!-- copilot-explorer-adr:v1:${value}:proposed -->`; }
export function adrFileMarkdown(value, managedId, scenario = null, sources = null) {
  const draft = validateAdrDraft(value), marker = adrFileMarker(managedId);
  if (scenario !== null && (!scenario || !['hypothetical', 'unselected', 'preferred'].includes(scenario.classification) || !['personal', 'project'].includes(scenario.scope) || !Number.isSafeInteger(scenario.preferenceRevision) || scenario.preferenceRevision < 0)) throw Error('Invalid scenario label for ADR writing.');
  const labels = { 'user-decision': 'User-stated decision', 'user-statement': 'User statement', uncertain: 'Uncertain', assumption: 'Assumption', suggestion: 'Suggestion' };
  const content = { title: draft.title, ...Object.fromEntries(Object.entries(draft.sections).map(([key, statements]) => [key,
    statements.map(statement => `[${labels[statement.certainty]}; ${statement.edited ? 'user-edited wording; sources not reverified' : 'AI synthesis'}${sources ? `; source mapping: ${statement.id}` : ''}]\n${statement.text}`).join('\n\n')])) };
  if (draft.format.layout.metadata.includes('status') || draft.format.layout.sections.some(section => section.key === 'status')) content.status = 'proposed';
  const output = renderAdr(draft.format, content) + '\n> Status: proposed. Accepting wording is not decision approval. Source statements and AI synthesis retain their uncertainty.\n' +
    (draft.titleEdited ? '\n> Title wording was edited by the user.\n' : '') + (scenario ? '\n' + scenarioMarkdown('', scenario) : '\n') + (sources ? adrSourcesMarkdown(sources, managedId) + '\n' : '') + marker + '\n';
  if (Buffer.byteLength(output) > ADR_FILE_LIMIT) throw Error('Rendered ADR exceeds the 64 KiB output limit. Reduce the wording; nothing was clipped.');
  return output;
}
export function validateAdrFile(value) {
  if (!keys(value, 'version,id,path,title,status,sha256,artifactDigest,readinessDigest,writtenAt' + (Object.hasOwn(value ?? {}, 'sources') ? ',sources' : '')) || value.version !== 1 || !id(value.id) || value.status !== 'proposed' ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200 || !value.title.isWellFormed() || /[\x00-\x1f\x7f]/.test(value.title) ||
      !digest(value.sha256) || !digest(value.artifactDigest) || !digest(value.readinessDigest) || typeof value.writtenAt !== 'string' || value.writtenAt.length > 40 || !Number.isFinite(Date.parse(value.writtenAt))) invalid();
  return { version: 1, id: value.id, path: adrFilePath(value.path), title: value.title, status: 'proposed', sha256: value.sha256, artifactDigest: value.artifactDigest, readinessDigest: value.readinessDigest, writtenAt: value.writtenAt, ...(Object.hasOwn(value, 'sources') ? { sources: validateAdrSources(value.sources) } : {}) };
}
export function validateAdrFiles(value) {
  if (!Array.isArray(value) || value.length > 50) invalid();
  const records = value.map(validateAdrFile);
  if (new Set(records.map(record => record.id)).size !== records.length || new Set(records.map(record => record.path.toLowerCase())).size !== records.length) invalid();
  return records;
}
export function associateAdrFile(existing, value, expected = null) {
  const records = validateAdrFiles(existing ?? []), record = validateAdrFile(value), base = expected === null ? null : validateAdrFile(expected);
  const conflict = () => { throw Error('ADR association changed or conflicts with another path. Refresh and review; existing references are preserved.'); };
  if (base && (base.id !== record.id || base.path !== record.path)) conflict();
  const index = records.findIndex(item => item.id === record.id);
  if (index >= 0) {
    if (equal(records[index], record)) return records;
    if (!base || !equal(records[index], base)) conflict();
    records[index] = record;
  } else { if (base) conflict(); records.push(record); }
  if (new Set(records.map(item => item.path.toLowerCase())).size !== records.length) conflict();
  return validateAdrFiles(records);
}
