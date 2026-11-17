import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const pages = new Map(await Promise.all(['expanded-node', 'connected-workspace', 'question-placement', 'research-directions'].map(async name => [
  `/${name}.html`, await readFile(new URL(`../docs/prototypes/${name}.html`, import.meta.url)),
])));
const server = createServer((request, response) => {
  const path = request.url.split('?')[0];
  const html = pages.get(path === '/' ? '/expanded-node.html' : path);
  if (request.method !== 'GET' || !html) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(html);
});
server.listen(0, '127.0.0.1', () => {
  console.log(`Explorer expanding-node prototype: http://127.0.0.1:${server.address().port}/`);
  console.log('Earlier studies: /connected-workspace.html, /question-placement.html and /research-directions.html');
  console.log('Open this URL in Brave yourself. Example data only; Ctrl+C stops the preview.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
