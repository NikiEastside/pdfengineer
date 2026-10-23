// Lokale Vorschau von dist/ mit denselben Headern, die Strato aus public/.htaccess setzt.
// "astro dev" und "astro preview" setzen keine davon. Ein Verstoß gegen die
// Content-Security-Policy fiele lokal also nie auf, sondern erst live.
//
// Gelesen werden nur die beiden Anweisungen, auf die es dabei ankommt: AddType und
// "Header always set". Kompression und Cache-Regeln spielen für die Vorschau keine Rolle.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = 'dist';
const port = Number(process.env.PORT ?? 4322);

const htaccess = await readFile(join(root, '.htaccess'), 'utf8').catch(() => {
  console.error('dist/.htaccess fehlt. Erst "npm run build" laufen lassen.');
  process.exit(1);
});

const headers = {};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.icc': 'application/octet-stream',
};
for (const line of htaccess.split('\n').map((l) => l.trim())) {
  const header = line.match(/^Header always set (\S+) "(.*)"$/);
  if (header) headers[header[1]] = header[2];
  const type = line.match(/^AddType (\S+) (\.\S+)$/);
  if (type) types[type[2]] = type[1];
}

createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  // normalize entfernt "..", damit die Vorschau nichts außerhalb von dist/ ausliefert.
  let file = join(root, normalize(path));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, {
      ...headers,
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    // Wie "ErrorDocument 404" in der .htaccess.
    const page = await readFile(join(root, '404.html')).catch(() => 'Nicht gefunden');
    response.writeHead(404, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page);
  }
}).listen(port, () => {
  console.log(`Vorschau mit Strato-Headern: http://localhost:${port}`);
});
