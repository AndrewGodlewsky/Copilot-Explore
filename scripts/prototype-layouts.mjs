import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../docs/prototypes/question-placement.html', import.meta.url));
const server = createServer((request, response) => {
  const path = request.url.split('?')[0];
  if (request.method !== 'GET' || !['/', '/question-placement.html'].includes(path)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(html);
});
server.listen(0, '127.0.0.1', () => {
  console.log(`Explorer layout prototypes: http://127.0.0.1:${server.address().port}/?variant=inline`);
  console.log('Open this URL in Brave yourself. Example data only; Ctrl+C stops the preview.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
