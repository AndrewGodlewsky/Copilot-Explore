import { readFile, readdir, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const alias = 'nemotron-speech-streaming-en-0.6b';
export function parseVoiceSettings(value) {
  if (value?.version !== 1 || !value.state) throw new Error('Copilot voice settings format is not supported.');
  const s = value.state;
  if (s.selectedModelId !== alias) throw new Error('Explorer currently supports the downloaded Nemotron English model.');
  if (s.selectedInputDeviceId !== 'default') throw new Error('Explorer currently supports Copilot’s default microphone setting.');
  const parts = s.shortcut?.keys?.split('+');
  if (s.shortcut?.useKeyCode !== true || !parts || parts.length > 5) throw new Error('Copilot’s voice shortcut format is not supported.');
  const code = parts.pop(), modifiers = ['ctrl', 'alt', 'shift', 'meta'];
  if (!/^(Space|Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(code) || parts.some(p => !modifiers.includes(p)) || new Set(parts).size !== parts.length) throw new Error('Copilot’s voice shortcut is not supported by Explorer.');
  if (!['push_to_talk', 'toggle'].includes(s.recordingMode)) throw new Error('Copilot’s recording mode is not supported.');
  if (!['auto', 'en'].includes(s.dictationLanguage)) throw new Error('Explorer’s Nemotron adapter currently supports English dictation.');
  const shortcut = { code, ...Object.fromEntries(modifiers.map(m => [m, parts.includes(m)])) };
  const names = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };
  return { shortcut, label: [...parts.map(p => names[p]), code.replace(/^(Key|Digit)/, '')].join(' + '), mode: s.recordingMode, language: s.dictationLanguage };
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const json = async file => JSON.parse(await readFile(file, 'utf8'));
let installed;
async function dependencies(local) {
  const libraryPath = join(local, 'Programs', 'GitHub Copilot');
  const desktopHash = await digest(join(libraryPath, 'foundry_local.dll'));
  const packages = join(local, 'copilot', 'pkg', 'win32-x64');
  for (const entry of (await readdir(packages, { withFileTypes: true })).filter(e => e.isDirectory() && !e.name.startsWith('.')).reverse()) {
    const base = join(packages, entry.name);
    const sdk = join(base, 'foundry-local-sdk', 'node_modules', 'foundry-local-sdk');
    const recorder = join(base, 'pvrecorder', 'node_modules', '@picovoice', 'pvrecorder-node');
    try {
      // shortcut: only the inspected native ABI is supported; revalidate when Copilot updates it.
      if ((await json(join(sdk, 'package.json'))).version !== '2.2.1' || (await json(join(recorder, 'package.json'))).version !== '1.2.9') continue;
      if (await digest(join(sdk, 'prebuilds', 'win32-x64', 'foundry_local.dll')) !== desktopHash) continue;
      await access(join(recorder, 'dist', 'index.js'));
      return { libraryPath, sdk: join(sdk, 'dist', 'index.js'), recorder: join(recorder, 'dist', 'index.js') };
    } catch { /* An older or incomplete installed package is not a candidate. */ }
  }
  throw new Error('Compatible Copilot local voice components were not found. Explorer does not download replacements.');
}

export async function discoverVoice() {
  if (process.env.COPILOT_EXTENSION_SANDBOXED === '1') throw new Error('Local dictation is not available in a sandboxed Explorer session.');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Explorer local dictation currently supports Windows x64.');
  let settings;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'data.db'), { readOnly: true });
    try { settings = parseVoiceSettings(JSON.parse(db.prepare("SELECT value FROM app_state WHERE key = 'voice-mode-settings'").get()?.value || 'null')); }
    finally { db.close(); }
  } catch (error) {
    if (error.code || error instanceof SyntaxError) throw new Error('Could not read Copilot’s voice settings. Set up Voice dictation in Copilot and reopen Explorer.');
    throw error;
  }
  let modelPath;
  const cache = join(homedir(), '.github-copilot-cli', 'cache', 'models', 'Microsoft');
  try {
    const candidates = (await readdir(cache, { withFileTypes: true })).filter(e => e.isDirectory() && new RegExp(`^${alias.replaceAll('.', '\\.')}\\-generic-cpu-\\d+$`).test(e.name)).sort((a,b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    for (const candidate of candidates) {
      const versions = (await readdir(join(cache, candidate.name), { withFileTypes: true })).filter(e => e.isDirectory() && /^v\d+$/.test(e.name)).sort((a,b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
      for (const version of versions) {
        const folder = join(cache, candidate.name, version.name);
        const config = await json(join(folder, 'genai_config.json'));
        if (config.model?.type === 'nemotron_speech') { modelPath = folder; break; }
      }
      if (modelPath) break;
    }
  } catch { /* Missing or partial download is reported below. */ }
  if (!modelPath) throw new Error('Download the Nemotron English model in Copilot’s Voice dictation settings first.');
  if (!installed) installed = dependencies(process.env.LOCALAPPDATA).catch(error => { installed = null; throw error; });
  return { ready: true, ...settings, ...await installed, modelPath };
}
