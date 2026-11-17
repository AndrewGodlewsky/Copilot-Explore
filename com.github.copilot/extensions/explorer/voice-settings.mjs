import { opendir, open, access, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const families = [
  { alias: 'nemotron-speech-streaming-en-0.6b', label: 'Nemotron English', variant: 'nemotron-speech-streaming-en-0.6b-generic-cpu' },
  { alias: 'nemotron-speech-streaming-es-0.6b', label: 'Nemotron Spanish', variant: 'nemotron-speech-streaming-es-0.6b-ft-generic-cpu' },
  { alias: 'nemotron-3.5-asr-streaming-0.6b', label: 'Nemotron 3.5 Multilingual', variant: 'nemotron-3.5-asr-streaming-0.6b-generic-cpu' },
];
export function parseVoiceSettings(value) {
  if (value?.version !== 1 || !value.state) throw new Error('Copilot voice settings format is not supported.');
  const s = value.state;
  const parts = s.shortcut?.keys?.split('+');
  if (s.shortcut?.useKeyCode !== true || !parts || parts.length > 5) throw new Error('Copilot’s voice shortcut format is not supported.');
  const code = parts.pop(), modifiers = ['ctrl', 'alt', 'shift', 'meta'];
  if (!/^(Space|Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4]))$/.test(code) || parts.some(p => !modifiers.includes(p)) || new Set(parts).size !== parts.length) throw new Error('Copilot’s voice shortcut is not supported by Explorer.');
  if (!['push_to_talk', 'toggle'].includes(s.recordingMode)) throw new Error('Copilot’s recording mode is not supported.');
  if (typeof s.dictationLanguage !== 'string' || !/^(auto|[a-z]{2,3}(?:-[A-Za-z]{2})?)$/.test(s.dictationLanguage)) throw new Error('Copilot’s dictation language is not supported.');
  if (typeof s.selectedModelId !== 'string' || !/^[a-zA-Z0-9./_-]{1,200}$/.test(s.selectedModelId)) throw new Error('Copilot’s selected voice model is invalid.');
  const shortcut = { code, ...Object.fromEntries(modifiers.map(m => [m, parts.includes(m)])) };
  const names = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };
  return { shortcut, label: [...parts.map(p => names[p]), code.replace(/^(Key|Digit)/, '')].join(' + '), mode: s.recordingMode, language: s.dictationLanguage, selectedModel: s.selectedModelId.replace(/^nvidia\//, '') };
}

const limitError = () => Object.assign(new Error('Voice inspection reached its source limit. Existing files are preserved.'), { code: 'DIAGNOSTIC_LIMIT' });
export async function readVoiceJson(file, max = 65536) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Voice metadata is not a regular file.');
    if (info.size > max) throw limitError();
    const buffer = Buffer.alloc(max + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > max) throw limitError();
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await handle.close(); }
}
async function digest(file, budget) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    budget.bytes -= chunk.length;
    if (budget.bytes < 0) throw limitError();
    hash.update(chunk);
  }
  return hash.digest('hex');
}
const json = readVoiceJson;
let installed;
async function dependencies(local) {
  const budget = { entries: 500, bytes: 512 * 1024 * 1024 };
  const libraryPath = join(local, 'Programs', 'GitHub Copilot');
  const desktopHash = await digest(join(libraryPath, 'foundry_local.dll'), budget);
  const packages = join(local, 'copilot', 'pkg', 'win32-x64');
  for (const entry of (await directories(packages, budget)).filter(name => !name.startsWith('.')).reverse()) {
    const base = join(packages, entry);
    const sdk = join(base, 'foundry-local-sdk', 'node_modules', 'foundry-local-sdk');
    const recorder = join(base, 'pvrecorder', 'node_modules', '@picovoice', 'pvrecorder-node');
    try {
      // shortcut: only the inspected native ABI is supported; revalidate when Copilot updates it.
      if ((await json(join(sdk, 'package.json'))).version !== '2.2.1' || (await json(join(recorder, 'package.json'))).version !== '1.2.9') continue;
      if (await digest(join(sdk, 'prebuilds', 'win32-x64', 'foundry_local.dll'), budget) !== desktopHash) continue;
      await access(join(recorder, 'dist', 'index.js'));
      return { libraryPath, sdk: join(sdk, 'dist', 'index.js'), recorder: join(recorder, 'dist', 'index.js') };
    } catch (error) { if (error.code === 'DIAGNOSTIC_LIMIT') throw error; /* Older or incomplete package. */ }
  }
  throw Object.assign(new Error('Compatible Copilot local voice components were not found. Explorer does not download replacements.'), { code: 'VOICE_UNAVAILABLE' });
}

export async function inspectVoice() {
  if (process.env.COPILOT_EXTENSION_SANDBOXED === '1') throw Object.assign(new Error('Local dictation is not available in a sandboxed Explorer session.'), { code: 'VOICE_UNSUPPORTED' });
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Object.assign(new Error('Explorer local dictation currently supports Windows x64.'), { code: 'VOICE_UNSUPPORTED' });
  let settings;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'data.db'), { readOnly: true });
    try {
      const row = db.prepare("SELECT CASE WHEN length(CAST(value AS BLOB)) <= 65536 THEN value END AS value, length(CAST(value AS BLOB)) AS bytes FROM app_state WHERE key = 'voice-mode-settings'").get();
      if (row?.bytes > 65536) throw limitError();
      try { settings = parseVoiceSettings(JSON.parse(row?.value || 'null')); }
      catch (error) { if (!(error instanceof SyntaxError)) error.code = 'VOICE_UNSUPPORTED'; throw error; }
    }
    finally { db.close(); }
  } catch (error) {
    if (['DIAGNOSTIC_LIMIT', 'VOICE_UNSUPPORTED'].includes(error.code)) throw error;
    if (error.code || error instanceof SyntaxError) throw Object.assign(new Error('Could not read Copilot’s voice settings. Set up Voice dictation in Copilot and reopen Explorer.'), { code: 'VOICE_UNAVAILABLE' });
    throw error;
  }
  let modelDiscoveryError = 'none';
  const models = await downloadedModels(join(homedir(), '.github-copilot-cli', 'cache', 'models'), category => { modelDiscoveryError = category; });
  if (!installed) installed = dependencies(process.env.LOCALAPPDATA).catch(error => { installed = null; throw error; });
  return { ...settings, ...await installed, models, modelDiscoveryError };
}

async function directories(path, budget) {
  try {
    const names = [];
    for await (const entry of await opendir(path)) {
      if (--budget.entries < 0) throw limitError();
      if (entry.isDirectory() && !entry.isSymbolicLink()) names.push(entry.name);
    }
    return names;
  }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function hasModelAssets(folder, config) {
  const names = ['encoder', 'decoder', 'joiner'].map(part => config.model[part]?.filename);
  if (names.some(name => typeof name !== 'string' || !/^[a-zA-Z0-9._-]+\.onnx$/.test(name))) return false;
  // The inspected CPU packages keep ONNX external weights beside each graph.
  const assets = [...names, ...names.map(name => name + '.data'), 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt'];
  if (config.model.vad?.filename) {
    if (!/^[a-zA-Z0-9._-]+\.onnx$/.test(config.model.vad.filename)) return false;
    assets.push(config.model.vad.filename);
  }
  try { return (await Promise.all(assets.map(name => stat(join(folder, name))))).every(file => file.isFile() && file.size > 0); }
  catch { return false; }
}
export async function downloadedModels(root, reportFailure = () => {}) {
  const result = [], budget = { entries: 500 };
  for (const publisher of await directories(root, budget)) for (const name of await directories(join(root, publisher), budget)) {
    const base = join(root, publisher, name);
    for (const folder of [base, ...(await directories(base, budget)).map(v => join(base, v))]) {
      let speech = false;
      try {
        const config = await json(join(folder, 'genai_config.json'));
        const type = config.model?.type;
        if (typeof type !== 'string' || !/speech|whisper|parakeet|asr/i.test(type)) continue;
        speech = true;
        const metadata = await json(join(folder, 'inference_model.json'));
        if (typeof metadata?.Name !== 'string' || !metadata.Name.trim()) throw new Error('Speech model identity metadata is invalid.');
        const family = families.find(f => new RegExp(`^${f.variant.replaceAll('.', '\\.')}[:-]\\d+$`).test(metadata.Name));
        const compatible = !!family && type === 'nemotron_speech' && config.model.sample_rate === 16000;
        const supported = compatible && await hasModelAssets(folder, config);
        const id = createHash('sha256').update(relative(root, folder).replaceAll('\\', '/')).digest('hex').slice(0, 24);
        result.push({ id, path: folder, type, alias: family?.alias, supported, readiness: supported ? 'ready' : compatible ? 'unavailable' : 'unsupported',
          label: family ? `${family.label} · CPU · ${metadata.Name.split(/[:-]/).at(-1)}` : String(metadata.Name).slice(0, 200),
          reason: supported ? '' : compatible ? 'This model download is incomplete or has an unfamiliar file layout. Complete it in Copilot, then refresh.' : 'This downloaded speech model is not supported by Explorer’s streaming audio engine.' });
      } catch (error) {
        if (error.code === 'DIAGNOSTIC_LIMIT') throw error;
        if (speech || error.code !== 'ENOENT') reportFailure('inspection-failed');
      }
    }
  }
  return result.sort((a, b) => b.label.localeCompare(a.label, undefined, { numeric: true }));
}

export function selectVoice(inventory, preferences = { microphone: '', model: 'copilot' }) {
  const model = preferences.model === 'copilot'
    ? inventory.models.find(m => m.alias === inventory.selectedModel && m.supported)
    : inventory.models.find(m => m.id === preferences.model);
  if (!model) throw new Error('Selected voice model is not downloaded or supported. Open Voice settings to choose an available model.');
  if (!model.supported) throw new Error(model.reason);
  return { ready: true, ...inventory, modelPath: model.path, microphoneName: preferences.microphone,
    language: model.alias === 'nemotron-3.5-asr-streaming-0.6b' ? inventory.language : undefined };
}
export async function discoverVoice(preferences) { return selectVoice(await inspectVoice(), preferences); }
