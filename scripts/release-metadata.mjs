import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readJson(root, file) {
  try {
    return JSON.parse(await readFile(join(root, file), 'utf8'));
  } catch (error) {
    throw new Error(`${file}: cannot read valid JSON: ${error.message}`, { cause: error });
  }
}

function matchVersion(actual, version, file, field) {
  if (actual !== version) throw new Error(`${file} ${field}: expected ${version}, found ${JSON.stringify(actual)}. Update all current release metadata together.`);
}

function readmeSection(readme, name) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const first = readme.indexOf(start);
  const last = readme.indexOf(end);
  if (first < 0 || last < first + start.length || readme.indexOf(start, first + start.length) !== -1 || readme.indexOf(end, last + end.length) !== -1) {
    throw new Error(`README.md ${name}: expected exactly one ordered start/end marker pair.`);
  }
  return readme.slice(first + start.length, last);
}

function checkReadmeVersions(readme, name, version) {
  const section = readmeSection(readme, name);
  const found = [...section.matchAll(/\bv?(\d+\.\d+\.\d+)\b/g)].map(match => match[1]);
  if (found.length === 0 || found.some(value => value !== version)) {
    throw new Error(`README.md ${name}: expected every current version reference to be v${version}; found ${found.length ? found.map(value => `v${value}`).join(', ') : 'none'}.`);
  }
}

export async function checkReleaseMetadata(root) {
  const plugin = await readJson(root, 'plugin.json');
  const version = plugin.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`plugin.json version: expected a numeric major.minor.patch version, found ${JSON.stringify(version)}.`);
  }
  const files = [
    ['package.json', 'version', data => data.version],
    ['package-lock.json', 'version', data => data.version],
    ['package-lock.json', 'packages[""].version', data => data.packages?.['']?.version],
    ['.github/plugin/marketplace.json', 'plugins[0].version', data => data.plugins?.[0]?.version],
    ['com.github.copilot/extensions/explorer/package.json', 'version', data => data.version],
    ['release-notes.json', '[0].version', data => data[0]?.version],
  ];
  const cache = new Map();
  for (const [file, field, select] of files) {
    if (!cache.has(file)) cache.set(file, await readJson(root, file));
    matchVersion(select(cache.get(file)), version, file, field);
  }
  const notes = cache.get('release-notes.json');
  for (const [index, note] of notes.entries()) {
    if (typeof note?.summary !== 'string' || !note.summary.trim() || note.summary.length > 400) {
      throw new Error(`release-notes.json [${index}].summary: expected 1–400 non-whitespace characters.`);
    }
  }
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  checkReadmeVersions(readme, 'explorer-current-version', version);
  checkReadmeVersions(readme, 'explorer-install-check', version);
  return version;
}
