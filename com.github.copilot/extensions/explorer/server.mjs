import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VoiceService } from './voice.mjs';
import { NavigationPreferences, defaultNavigationSettings } from './navigation-preferences.mjs';
import { Diagnostics, supportBundle } from './diagnostics.mjs';
import { STORAGE_LIMITS } from './storage-management.mjs';

const assets = new Map([
  ['', ['index.html', 'text/html; charset=utf-8']],
  ['dashboard.mjs', ['dashboard.mjs', 'text/javascript; charset=utf-8']],
  ['app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['layout.mjs', ['layout.mjs', 'text/javascript; charset=utf-8']],
  ['minimap.mjs', ['minimap.mjs', 'text/javascript; charset=utf-8']],
  ['voice.mjs', ['voice.mjs', 'text/javascript; charset=utf-8']],
  ['answer-state.mjs', ['answer-state.mjs', 'text/javascript; charset=utf-8']],
  ['revisit.mjs', ['revisit.mjs', 'text/javascript; charset=utf-8']],
  ['search.mjs', ['search.mjs', 'text/javascript; charset=utf-8']],
  ['next-question.mjs', ['next-question.mjs', 'text/javascript; charset=utf-8']],
  ['decision-impact.mjs', ['decision-impact.mjs', 'text/javascript; charset=utf-8']],
  ['review-queue.mjs', ['review-queue.mjs', 'text/javascript; charset=utf-8']],
  ['drafts.mjs', ['drafts.mjs', 'text/javascript; charset=utf-8']],
  ['cleanup.mjs', ['cleanup.mjs', 'text/javascript; charset=utf-8']],
  ['question-help-client.mjs', ['question-help-client.mjs', 'text/javascript; charset=utf-8']],
  ['research-review-client.mjs', ['research-review-client.mjs', 'text/javascript; charset=utf-8']],
  ['research-policy.mjs', ['research-policy.mjs', 'text/javascript; charset=utf-8']],
  ['question-help-context.mjs', ['question-help-context.mjs', 'text/javascript; charset=utf-8']],
  ['modes.mjs', ['modes.mjs', 'text/javascript; charset=utf-8']],
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
export async function startServer(explorer, voice = new VoiceService({ preferencesFile: explorer.library ? join(explorer.library.directory, 'voice-settings.json') : explorer.file ? join(dirname(explorer.file), 'voice-settings.json') : undefined }), { readHost } = {}) {
  const navigation = new NavigationPreferences(explorer.library ? join(explorer.library.directory, 'navigation-settings.json') : explorer.file ? join(dirname(explorer.file), 'navigation-settings.json') : undefined);
  const { version } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  const diagnostics = new Diagnostics({ version, explorer, voice, readHost });
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
      if (req.method === 'POST' && route === 'api/dashboard') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        try {
          const value = await explorer.dashboardRequest(await body(req, 1024));
          if (Buffer.byteLength(JSON.stringify(value)) > 512 * 1024) throw new Error();
          return json(200, value);
        } catch { return json(400, { error: 'Dashboard could not load. Check the date range and refresh; original files are preserved.' }); }
      }
      if (req.method === 'POST' && route === 'api/storage') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const value = await explorer.storageRequest(await body(req, 1024));
        if (Buffer.byteLength(JSON.stringify(value)) > STORAGE_LIMITS.responseBytes) throw new Error('Storage response limit reached. Files are preserved.');
        return json(200, value);
      }
      if (req.method === 'POST' && route === 'api/research-review') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.reviewResearch(await body(req, 512 * 1024)));
      }
      if (['api/diagnostics', 'api/support'].includes(route) && (req.method === 'POST' || route === 'api/diagnostics' && req.method === 'GET')) {
        if (req.method === 'POST' && (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin)) return json(403, { error: 'Invalid request origin.' });
        try {
          if (req.method === 'POST') {
            const input = await body(req, 1024);
            if (!input || typeof input !== 'object' || Array.isArray(input) || (route === 'api/support' ? Object.keys(input).length !== 0 : Object.keys(input).join(',') !== 'action' || input.action !== 'retry')) throw new Error('Invalid diagnostics request.');
          }
          const value = await diagnostics.inspect(req.method === 'POST' && route === 'api/diagnostics');
          if (route === 'api/diagnostics') return json(200, value);
          const content = supportBundle(value);
          if (Buffer.byteLength(content) > 4096) throw new Error('Support size limit.');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="explorer-support.json"' });
          return res.end(content);
        } catch {
          return json(400, { error: route === 'api/support' ? 'Support export failed. Retry diagnostics, then explicitly export again. No private paths or logs were collected.' : 'Diagnostics inspection failed. Retry when Copilot and local storage are available.' });
        }
      }
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
      if (req.method === 'GET' && route === 'api/state') {
        await explorer.observeProject();
        const cursor = req.headers['x-explorer-state'];
        const state = explorer.pollSnapshot(typeof cursor === 'string' && /^[0-9a-f-]{36}$/.test(cursor) ? cursor : undefined);
        res.setHeader('X-Explorer-State', state.cursor);
        if (!state.snapshot) { res.writeHead(204); return res.end(); }
        return json(200, state.snapshot);
      }
      if (req.method === 'POST' && route === 'api/cleanup') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.cleanupRequest(await body(req, 128 * 1024)));
      }
      if (req.method === 'POST' && route === 'api/question-help') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.helpRequest(await body(req, 2048)));
      }
      if (req.method === 'POST' && ['api/brief', 'api/handoff'].includes(route)) {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.briefRequest(await body(req, 256 * 1024), route === 'api/handoff' ? 'handoff' : 'brief'));
      }
      if (req.method === 'POST' && route === 'api/check-answers') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.checkRequest(await body(req, 2048)));
      }
      if (req.method === 'GET' && route === 'api/history') {
        const selected = url.searchParams.get('snapshotRevision');
        if (selected !== null && !/^(0|[1-9][0-9]*)$/.test(selected)) throw new Error('Invalid history revision.');
        return json(200, await explorer.readHistory(url.searchParams.get('journey'), selected === null ? undefined : Number(selected)));
      }
      if (req.method === 'POST' && route === 'api/recovery') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        try { return json(200, await explorer.recoveryRequest(await body(req, 2048))); }
        catch { return json(400, { error: 'Recovery inspection could not complete. Refresh and retry; original files are preserved.' }); }
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
      if (req.method === 'POST' && route === 'api/search') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        if (!explorer.library) throw new Error('Library search is unavailable.');
        return json(200, await explorer.library.search(await body(req, 24 * 1024)));
      }
      if (req.method === 'POST' && route === 'api/answer-change') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const result = await explorer.answerChangeRequest(await body(req, 128 * 1024));
        // Exact answers, 50 question labels and 30 path steps can exceed 512 KiB after JSON escaping.
        if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw Error('Answer preview response limit reached.');
        return json(200, result);
      }
      if (req.method === 'POST' && route === 'api/project-library') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.projectLibraryRequest(await body(req, 4096)));
      }
      if (req.method === 'POST' && route === 'api/project-copy') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.projectCopyRequest(await body(req, 4096)));
      }
      if (req.method === 'POST' && route === 'api/scenario-preference') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.scenarioPreferenceRequest(await body(req, 16 * 1024)));
      }
      if (req.method === 'POST' && route === 'api/scenario-compare') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const result = await explorer.scenarioCompareRequest(await body(req, 4096));
        if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw Error('Comparison response limit reached.');
        return json(200, result);
      }
      if (req.method === 'POST' && route === 'api/scenario-fork') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const result = await explorer.scenarioForkRequest(await body(req, 128 * 1024));
        if (Buffer.byteLength(JSON.stringify(result)) > 20 * 1024 * 1024) throw Error('Scenario preview response limit reached.');
        return json(200, result);
      }
      if (req.method === 'POST' && route === 'api/project-reconciliation') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.projectReconciliationRequest(await body(req, 4096)));
      }
      if (req.method === 'POST' && route === 'api/project-git-status') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.projectGitStatusRequest(await body(req, 1024)));
      }
      if (req.method === 'POST' && route === 'api/project-merge') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.projectMergeRequest(await body(req, 768 * 1024)));
      }
      if (req.method === 'GET' && route === 'api/library') {
        if (!explorer.library) return json(200, { revision: 0, entries: [], errors: [] });
        return json(200, await explorer.library.list({ search: url.searchParams.get('search') ?? '', archived: url.searchParams.get('archived') === 'true', reminder: url.searchParams.get('reminder') ?? 'all', ...(url.searchParams.has('today') ? { today: url.searchParams.get('today') } : {}) }));
      }
      if (req.method === 'POST' && route === 'api/action') {
        if (req.headers['x-explorer-client'] !== '1' || (req.headers.origin && req.headers.origin !== origin)) return json(403, { error: 'Invalid request origin.' });
        const input = await body(req);
        if ((input.answerPreview || ['research', 'research-follow-up', 'restore', 'restart-branch', 'reaffirm-review', 'clear-review-answer', 'checkpoint', 'remove-checkpoint', 'recover-copy', 'recovery-retry', 'project-merge-accept', 'add-dependency', 'remove-dependency'].includes(input.action)) && req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        return json(200, await explorer.command(input.action, input));
      }
      if (req.method === 'POST' && route === 'api/viewer-export') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const input = await body(req, 128 * 1024), result = await explorer.exportViewer(input);
        if (input.action === 'preview') return json(200, result);
        res.writeHead(200, { 'Content-Type': result.type, 'Content-Disposition': `attachment; filename="${result.filename}"` });
        return res.end(result.content);
      }
      if (req.method === 'POST' && route === 'api/visual-export') {
        if (req.headers['x-explorer-client'] !== '1' || req.headers.origin !== origin) return json(403, { error: 'Invalid request origin.' });
        const result = await explorer.exportVisual(await body(req, 2048));
        res.writeHead(200, { 'Content-Type': result.type, 'Content-Disposition': `attachment; filename="${result.filename}"` });
        return res.end(result.content);
      }
      if (req.method === 'GET' && ['export.json', 'export.md', 'brief.md', 'handoff.md'].includes(route)) {
        const id = randomUUID();
        const observe = status => { if (explorer.exportObservation?.id === id) explorer.exportObservation = { id, route, status, downloadSaved: 'unknown' }; };
        explorer.exportObservation = { id, route, status: 'active', downloadSaved: 'unknown' };
        res.once('finish', () => { if (res.statusCode === 200) observe('response-finished'); });
        res.once('close', () => { if (!res.writableFinished) observe('interrupted'); });
        try {
          const { doc, content } = await explorer.exportDocument(route);
          const filename = `${route === 'handoff.md' ? 'implementation-handoff' : route === 'brief.md' ? 'decision-brief' : 'exploration'}-${doc.id.slice(0, 8)}${route.endsWith('.md') ? '.md' : '.explore.json'}`;
          res.writeHead(200, { 'Content-Type': route.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` });
          return res.end(content);
        } catch {
          observe('failed'); return json(400, { error: 'Export generation failed. Check Scenario preference and retry the saved read in Recovery, then explicitly retry this export. Browser file saving cannot be confirmed.' });
        }
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
