import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toMarkdown } from './model.mjs';
import { VoiceService } from './voice.mjs';
import { NavigationPreferences, defaultNavigationSettings } from './navigation-preferences.mjs';

const assets = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['layout.mjs', ['layout.mjs', 'text/javascript; charset=utf-8']],
  ['voice.mjs', ['voice.mjs', 'text/javascript; charset=utf-8']],
  ['answer-state.mjs', ['answer-state.mjs', 'text/javascript; charset=utf-8']],
  ['drafts.mjs', ['drafts.mjs', 'text/javascript; charset=utf-8']],
  ['cleanup.mjs', ['cleanup.mjs', 'text/javascript; charset=utf-8']],
  ['question-help-client.mjs', ['question-help-client.mjs', 'text/javascript; charset=utf-8']],
  ['question-help-context.mjs', ['question-help-context.mjs', 'text/javascript; charset=utf-8']],
  ['navigation.mjs', ['navigation.mjs', 'text/javascript; charset=utf-8']],
  ['style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const MAX_BODY = 10 * 1024 * 1024;
async function body(req, limit = MAX_BODY) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request exceeds the size limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function startServer(explorer, voice = new VoiceService({ preferencesFile: explorer.library ? join(explorer.library.directory, 'voice-settings.json') : explorer.file ? join(dirname(explorer.file), 'voice-settings.json') : undefined })) {
  const navigation = new NavigationPreferences(explorer.library ? join(explorer.library.directory, 'navigation-settings.json') : explorer.file ? join(dirname(explorer.file), 'navigation-settings.json') : undefined);
  const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const token = randomBytes(24).toString('hex');
  const prefix = `/${token}/`;
  let origin;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'");
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== new URL(origin).host) return json(403, { error: 'Invalid host.' });
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith(prefix)) return json(404, { error: 'Not found.' });
      const route = url.pathname.slice(prefix.length);
      if (req.method === 'GET' && route === 'api/navigation-settings') {
        try { return json(200, { settings: await navigation.read() }); }
        catch (error) { return json(200, { settings: defaultNavigationSettings(), error: error.message }); }
      }
      if (req.method === 'POST' && route === 'api/navigation-settings') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const input = await body(req, 1024);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'motion,revision,sensitivity,wheelMode') throw new Error('Invalid navigation settings.');
        return json(200, { settings: await navigation.save(input, input.revision) });
      }
      if (req.method === 'GET' && route === 'api/voice') return json(200, await voice.status());
      if (req.method === 'GET' && route === 'api/voice/settings') return json(200, await voice.options());
      if (req.method === 'POST' && route === 'api/voice/settings') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const input = await body(req, 4096);
        if (!input || Object.keys(input).some(k => !['microphone', 'model', 'revision'].includes(k)) || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error('Invalid voice settings.');
        return json(200, await voice.configure(input));
      }
      if (req.method === 'POST' && route === 'api/voice') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const input = await body(req, 1024);
        if (!['start', 'poll', 'finish', 'cancel', 'ack'].includes(input.action) || typeof input.id !== 'string' || !/^[a-zA-Z0-9-]{20,80}$/.test(input.id) || Object.keys(input).some(k => !['action', 'id', ...(input.action === 'ack' ? ['sequence'] : [])].includes(k)) || (input.action === 'ack' && (!Number.isSafeInteger(input.sequence) || input.sequence < 1))) throw new Error('Invalid voice request.');
        return json(200, voice[input.action](input.id, input.sequence));
      }
      if (req.method === 'GET' && route === 'api/state') return json(200, explorer.uiSnapshot());
      if (req.method === 'POST' && route === 'api/cleanup') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.cleanupRequest(await body(req, 128 * 1024)));
      }
      if (req.method === 'POST' && route === 'api/question-help') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.helpRequest(await body(req, 2048)));
      }
      if (req.method === 'GET' && route === 'api/history') {
        const selected = url.searchParams.get('snapshotRevision');
        if (selected !== null && !/^(0|[1-9][0-9]*)$/.test(selected)) throw new Error('Invalid history revision.');
        return json(200, await explorer.readHistory(url.searchParams.get('journey'), selected === null ? undefined : Number(selected)));
      }
      if (req.method === 'GET' && route === 'api/drafts') return json(200, await explorer.readDrafts(url.searchParams.get('journey')));
      if (req.method === 'GET' && route === 'api/references') return json(200, await explorer.readReferences(url.searchParams.get('journey')));
      if (req.method === 'POST' && route === 'api/references') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.writeReferences(await body(req, 1024)));
      }
      if (req.method === 'POST' && route === 'api/drafts') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.writeDraft(await body(req, 160 * 1024)));
      }
      if (req.method === 'GET' && route === 'api/library') {
        if (!explorer.library) return json(200, { revision: 0, entries: [], errors: [] });
        return json(200, await explorer.library.list({ search: url.searchParams.get('search') ?? '', archived: url.searchParams.get('archived') === 'true' }));
      }
      if (req.method === 'POST' && route === 'api/action') {
        if (req.headers['x-explorer-client'] !== '1' || (req.headers.origin && req.headers.origin !== origin)) return json(403, { error: 'Invalid request origin.' });
        const input = await body(req);
        if (['restore', 'checkpoint', 'remove-checkpoint'].includes(input.action) && req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.command(input.action, input));
      }
      if (req.method === 'GET' && ['export.json', 'export.md'].includes(route)) {
        const doc = explorer.snapshot().document;
        if (!doc) return json(400, { error: 'Start an exploration first.' });
        const filename = `exploration-${doc.id.slice(0, 8)}${route.endsWith('.md') ? '.md' : '.explore.json'}`;
        res.writeHead(200, { 'Content-Type': route.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` });
        return res.end(route.endsWith('.md') ? toMarkdown(doc) : JSON.stringify(doc, null, 2));
      }
      if (req.method === 'GET' && assets.has(route)) {
        const [name, type] = assets.get(route);
        let content = await readFile(fileURLToPath(new URL(`./web/${name}`, import.meta.url)));
        if (name === 'index.html') content = content.toString('utf8').replace('{{EXPLORER_VERSION}}', version);
        res.writeHead(200, { 'Content-Type': type }); return res.end(content);
      }
      json(404, { error: 'Not found.' });
    } catch (error) { json(400, { error: error.message || 'The action could not be completed.' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { url: origin + prefix, async close() {
    voice.close();
    await explorer.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}
