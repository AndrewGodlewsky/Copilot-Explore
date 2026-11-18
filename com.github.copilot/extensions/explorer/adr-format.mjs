import { validateProjectPaths } from './project-context.mjs';

export const ADR_TEMPLATE_LIMIT = 32768;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === names.split(',').sort().join(',');
const invalid = () => { throw Error('Invalid ADR format. Check the supported template structure, metadata and naming settings.'); };
const aliases = {
  context: ['Context and Problem Statement', 'Context', 'Problem Statement'], drivers: ['Decision Drivers', 'Drivers'],
  alternatives: ['Considered Options', 'Alternatives', 'Options'], outcome: ['Decision Outcome', 'Decision', 'Outcome'],
  consequences: ['Consequences'], confirmation: ['Confirmation'], optionDetails: ['Pros and Cons of the Options'],
  references: ['References', 'More Information'], status: ['Status'], date: ['Date'],
};
const metadataKeys = ['status', 'date', 'decision-makers', 'consulted', 'informed'];
const keyFor = label => Object.keys(aliases).find(key => aliases[key].some(name => name.toLowerCase() === label.toLowerCase()));
const required = new Set(['context', 'outcome']);
const defaultLayout = () => ({ metadata: ['status', 'date'], sections: ['context', 'drivers', 'alternatives', 'outcome', 'consequences', 'references'].map(key => ({ key, label: aliases[key][0], level: 2 })) });
export function defaultAdrFormat() { return { version: 1, directory: 'docs/decisions', naming: 'numbered', digits: 4, template: { kind: 'bundled' }, layout: defaultLayout() }; }
function path(value, template = false) {
  if (typeof value !== 'string' || !value || value.length > 240) throw Error('Use a bounded relative ADR directory or template path.');
  validateProjectPaths([template ? value : `${value}/x.md`]);
  if (template && !/\.md$/i.test(value)) throw Error('Select a Markdown .md ADR template.');
  return value;
}
export function validateAdrSelection(value) {
  if (!keys(value, 'directory,naming,digits,templatePath') || !['numbered', 'slug'].includes(value.naming) || !Number.isInteger(value.digits) || value.digits < 2 || value.digits > 6 || typeof value.templatePath !== 'string') invalid();
  path(value.directory); if (value.templatePath) path(value.templatePath, true);
  return { directory: value.directory, naming: value.naming, digits: value.digits, templatePath: value.templatePath };
}
function validateLayout(value) {
  if (!keys(value, 'metadata,sections') || !Array.isArray(value.metadata) || value.metadata.length > metadataKeys.length || new Set(value.metadata).size !== value.metadata.length || value.metadata.some(key => !metadataKeys.includes(key)) || !Array.isArray(value.sections) || value.sections.length > Object.keys(aliases).length) invalid();
  const seen = new Set(value.metadata); let parent;
  for (const section of value.sections) {
    if (!keys(section, 'key,label,level') || typeof section.label !== 'string' || section.label.length > 80 || keyFor(section.label) !== section.key || seen.has(section.key) || ![2, 3].includes(section.level) || section.level === 3 && (parent !== 'outcome' || !['consequences', 'confirmation'].includes(section.key))) invalid();
    if (section.level === 2) parent = section.key;
    seen.add(section.key);
  }
  if ([...required].some(key => !seen.has(key))) throw Error('ADR template needs Context and Decision Outcome sections.');
  return { metadata: [...value.metadata], sections: value.sections.map(({ key, label, level }) => ({ key, label, level })) };
}
export function parseAdrTemplate(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > ADR_TEMPLATE_LIMIT) throw Error('ADR template exceeds the 32 KiB text limit.');
  if (!value.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw Error('ADR template must be ordinary UTF-8 text without control characters.');
  let text = value.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  text = text.replace(/<!--[\s\S]*?-->/g, ''); if (text.includes('<!--')) throw Error('ADR template has an unclosed comment.');
  const lines = text.split('\n'), metadata = [], sections = []; let start = 0, titles = 0, fence = null, parent;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1); if (end < 0) throw Error('ADR template has unclosed metadata.');
    for (const line of lines.slice(1, end)) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const match = /^([a-z-]+):[^\n]*$/.exec(line);
      if (!match || !metadataKeys.includes(match[1]) || metadata.includes(match[1])) throw Error('ADR template metadata supports only unique status, date, decision-makers, consulted and informed keys. Values are ignored.');
      metadata.push(match[1]);
    }
    start = end + 1;
  }
  for (const line of lines.slice(start)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) { if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null; continue; }
    if (marker) { fence = marker[1]; continue; }
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line); if (!heading) continue;
    const level = heading[1].length, label = heading[2].trim(), key = keyFor(label);
    if (level === 1) { titles++; continue; }
    // Detail-option headings name examples, never structural output or decisions.
    if (level === 3 && parent === 'optionDetails') continue;
    if (!key || level > 3) throw Error('Unsupported ADR template heading. Use the documented Context, Decision, Options, Consequences and metadata structure.');
    sections.push({ key, label, level }); if (level === 2) parent = key;
  }
  if (fence || titles !== 1) throw Error('ADR template needs exactly one title heading and closed code fences.');
  return validateLayout({ metadata, sections });
}
export function validateAdrFormat(value) {
  if (!keys(value, 'version,directory,naming,digits,template,layout') || value.version !== 1) invalid();
  const template = value.template;
  if (!(keys(template, 'kind') && template.kind === 'bundled') && !(keys(template, 'kind,path,sha256') && template.kind === 'repository' && typeof template.sha256 === 'string' && /^[a-f0-9]{64}$/.test(template.sha256))) invalid();
  validateAdrSelection({ directory: value.directory, naming: value.naming, digits: value.digits, templatePath: template.kind === 'repository' ? template.path : '' });
  const layout = validateLayout(value.layout);
  if (template.kind === 'bundled' && JSON.stringify(layout) !== JSON.stringify(defaultLayout())) invalid();
  return { version: 1, directory: value.directory, naming: value.naming, digits: value.digits, template: structuredClone(template), layout };
}
const md = value => value.replace(/[\\`*_{}[\]<>#+!|()&.:=~-]/g, '\\$&').replace(/\r\n?/g, '\n');
export function renderAdr(value, content) {
  const format = validateAdrFormat(value), allowed = new Set(['title', ...metadataKeys, ...Object.keys(aliases)]);
  if (!content || typeof content !== 'object' || Array.isArray(content) || Object.keys(content).some(key => !allowed.has(key))) throw Error('Unsupported ADR content field.');
  for (const [key, text] of Object.entries(content)) if (typeof text !== 'string' || !text.isWellFormed() || text.length > (key === 'title' ? 200 : 16384) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) || key === 'title' && /[\r\n]/.test(text)) throw Error('ADR content exceeds its text limits or contains unsupported Unicode/control characters.');
  if (content.date?.trim() && (!/^\d{4}-\d{2}-\d{2}$/.test(content.date) || !Number.isFinite(Date.parse(content.date)) || new Date(content.date).toISOString().slice(0, 10) !== content.date)) throw Error('ADR date must be a real YYYY-MM-DD date supplied explicitly.');
  const fields = new Set(['title', ...format.layout.metadata, ...format.layout.sections.map(section => section.key)]);
  for (const [key, text] of Object.entries(content)) if (text.trim() && !fields.has(key)) throw Error(`The selected template omits nonempty ${key} content. Add its supported section/metadata or choose another template.`);
  const text = key => content[key]?.trim() ? content[key] : 'Unspecified.', lines = [];
  if (format.layout.metadata.length) lines.push('---', ...format.layout.metadata.map(key => `${key}: ${JSON.stringify(text(key))}`), '---', '');
  lines.push(`# ${md(content.title?.trim() ? content.title : 'Unspecified decision')}`, '');
  for (const section of format.layout.sections) {
    if (!required.has(section.key) && !metadataKeys.includes(section.key) && !content[section.key]?.trim()) continue;
    lines.push(`${'#'.repeat(section.level)} ${section.label}`, '', md(text(section.key)), '');
  }
  const output = lines.join('\n'); if (Buffer.byteLength(output) > 65536) throw Error('Rendered ADR exceeds the 64 KiB output limit.');
  return output;
}
export function adrFilename(value, title, number) {
  const format = validateAdrFormat(value);
  if (typeof title !== 'string' || !title.isWellFormed() || !title.trim() || title.length > 200) throw Error('ADR filename needs a valid Unicode title of 1-200 characters.');
  const slug = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  if (!slug || slug.length > 100) throw Error('ADR filename needs a title producing 1-100 letters, numbers or hyphens.');
  if (format.naming === 'numbered' && (!Number.isSafeInteger(number) || number < 1 || number > 999999)) throw Error('Supply a positive ADR number up to 999999 at write time; previews reserve no number.');
  const filename = `${format.naming === 'numbered' ? String(number).padStart(format.digits, '0') + '-' : ''}${slug}.md`;
  if (Buffer.byteLength(filename) > 240) throw Error('ADR filename exceeds the portable 240-byte component limit. Use a shorter title.');
  const result = `${format.directory}/${filename}`;
  validateProjectPaths([result]); return result;
}
