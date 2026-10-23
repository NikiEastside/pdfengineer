// Rendert public/og-bild.png aus der Vorlage src/pages/og-bild.astro.
//
//   npm run build && npm run og-bild
//
// Braucht die Testbrowser (einmalig: npm run test:browser). Danach neu bauen und ausrollen,
// damit das neue Bild auch in dist/ landet.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

// Ein schlichter Server reicht, die Vorlage braucht nur HTML, CSS und Schriften.
const server = createServer(async (request, response) => {
  let file = join('dist', normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname)));
  if (file.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(0);
const { port } = server.address();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'light' });
await page.goto(`http://localhost:${port}/og-bild/`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.locator('[data-og]').screenshot({ path: 'public/og-bild.png' });
await browser.close();
server.close();
console.log('public/og-bild.png geschrieben.');
