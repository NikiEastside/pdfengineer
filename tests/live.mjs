// Gesamttest gegen die Live-Seite oder die lokale Vorschau, in Chromium und WebKit
// (Safari-Engine): alle Seiten, beide Werkzeuge samt Passwort- und Fehlerfällen, Offline,
// schmale Bildschirme, fremde Verbindungen, CSP-Verstöße, Umleitungen und Header.
//
//   npm run test:browser                       einmalig: Testbrowser laden (ca. 900 MB)
//   npm run test:live                          gegen https://pdfengineer.de
//   BASE=http://localhost:4322 npm run test:live   gegen npm run preview
//   SCREENSHOTS=pfad npm run test:live         zusätzlich Bilder aller Seiten
//
// Screenshots sind abschaltbar, weil Playwright dafür ein Inline-Stylesheet einschleust. Die
// CSP blockt es korrekt, WebKit meldet das aber als Fehler, und der Test würde rot, ohne dass
// die Seite etwas falsch macht.
import { chromium, webkit } from 'playwright';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'https://pdfengineer.de';
const LIVE = BASE === 'https://pdfengineer.de';
const SHOTS = process.env.SCREENSHOTS;
const FILES = 'testdateien';
const DOWNLOADS = join(tmpdir(), 'pdfengineer-test');
mkdirSync(DOWNLOADS, { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (!existsSync(join(FILES, '6-zehn-seiten.pdf'))) execFileSync('node', ['scripts/make-test-pdfs.mjs'], { stdio: 'inherit' });

const pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const PAGES = ['/', '/pdf-zusammenfuegen/', '/pdf-komprimieren/', '/pdf-teilen/', '/sicherheit/', '/impressum/', '/datenschutz/'];
const MISSING = '/gibt-es-nicht/';

let failed = 0;
const check = (name, condition, detail = '') => {
  if (!condition) failed++;
  console.log(`${condition ? 'ok  ' : 'FEHLER'} ${name}${detail ? ` · ${detail}` : ''}`);
};

async function pdfTexts(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    texts.push((await (await doc.getPage(i)).getTextContent()).items.map((item) => item.str).join(' '));
  }
  return texts;
}

// Sammelt alles, was nicht passieren darf: Konsolenfehler, CSP-Verstöße, Skriptfehler und
// Anfragen an fremde Server. Der 404 der absichtlich falschen Adresse ist erwartet.
function watch(page, problems) {
  const host = new URL(BASE).host;
  // Fehlende Dateien über die Antworten erkennen, nicht über die Konsole: WebKit meldet den
  // 404 dort teils, solange page.url() noch auf die vorige Seite zeigt.
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().includes(MISSING)) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error' || message.text().startsWith('Failed to load resource')) return;
    problems.push(`Konsole (${new URL(page.url()).pathname}): ${message.text().slice(0, 160)}`);
  });
  page.on('pageerror', (error) => problems.push(`Skriptfehler: ${error.message.slice(0, 160)}`));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.host !== host) problems.push(`fremde Verbindung: ${request.url()}`);
  });
}

const waitRead = (page) =>
  page.waitForFunction(() => !document.querySelector('[data-list]')?.textContent?.includes('wird gelesen'), null, { timeout: 60000 });
const item = (page, index) => page.locator('[data-list] > li').nth(index);

async function unlock(page, index, password) {
  await item(page, index).locator('input[name=password]').fill(password);
  await item(page, index).locator('button[type=submit]').click();
}

// ---------- Umleitungen und Header (nur live, die Vorschau kennt keine Umleitungen) ----------
if (LIVE) {
  const head = (url) => fetch(url, { redirect: 'manual' });
  const http = await head('http://pdfengineer.de/sicherheit/');
  check('http → https', http.status === 301 && http.headers.get('location') === 'https://pdfengineer.de/sicherheit/', `${http.status} ${http.headers.get('location')}`);
  const www = await head('https://www.pdfengineer.de/sicherheit/');
  check('www → ohne www', www.status === 301 && www.headers.get('location') === 'https://pdfengineer.de/sicherheit/', `${www.status} ${www.headers.get('location')}`);
  const home = await head(BASE + '/');
  check('Content-Security-Policy gesetzt', (home.headers.get('content-security-policy') ?? '').includes("connect-src 'self'"));
  check('HSTS gesetzt', (home.headers.get('strict-transport-security') ?? '').includes('max-age='));
  for (const asset of ['/favicon.ico', '/apple-touch-icon.png', '/og-bild.png', '/robots.txt', '/sitemap-index.xml']) {
    const response = await head(BASE + asset);
    check(`${asset} vorhanden`, response.status === 200, String(response.status));
  }
}

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  console.log(`\n— ${engineName} —`);
  const browser = await engine.launch();
  const problems = [];

  // ---------- Seiten in hell/dunkel, Desktop/Handy/iPhone SE ----------
  for (const scheme of ['light', 'dark']) {
    for (const [device, viewport] of [['desktop', { width: 1280, height: 900 }], ['handy', { width: 390, height: 844 }], ['se', { width: 320, height: 640 }]]) {
      const context = await browser.newContext({ colorScheme: scheme, viewport });
      const page = await context.newPage();
      watch(page, problems);
      for (const path of [...PAGES, MISSING]) {
        const response = await page.goto(BASE + path, { waitUntil: 'networkidle' });
        if (scheme === 'light' && device === 'desktop') {
          const expected = path === MISSING ? 404 : 200;
          check(`${engineName} ${path}`, response.status() === expected && (await page.locator('h1').count()) === 1, `${response.status()} · ${await page.title()}`);
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (overflow) problems.push(`seitlicher Überlauf: ${path} bei ${viewport.width} px (${scheme})`);
        if (SHOTS) await page.screenshot({ path: join(SHOTS, `${engineName}-${scheme}-${device}${path.replaceAll('/', '_')}.png`), fullPage: true });
      }
      await context.close();
    }
  }

  // ---------- Zusammenfügen ----------
  {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    watch(page, problems);
    await page.goto(BASE + '/pdf-zusammenfuegen/', { waitUntil: 'networkidle' });
    await page.setInputFiles('[data-file-input]', ['1-blau.pdf', '2-gruen-gesperrt.pdf', '3-rot-passwort-geheim.pdf', '4-keine-pdf.pdf'].map((f) => join(FILES, f)));
    await waitRead(page);
    check(`${engineName} zusammenfügen: kaputte Datei erkannt`, (await item(page, 3).textContent()).includes('Kann nicht geöffnet werden'));
    check(`${engineName} zusammenfügen: Passwort verlangt`, (await item(page, 2).textContent()).includes('Passwortgeschützt'));
    check(`${engineName} zusammenfügen: gesperrte PDF ohne Nachfrage`, (await item(page, 1).textContent()).includes('1 Seite'));
    check(`${engineName} zusammenfügen: Knopf gesperrt`, await page.locator('[data-merge]').isDisabled());

    await unlock(page, 2, 'falsch');
    await page.waitForFunction(() => document.querySelectorAll('[data-list] > li')[2]?.textContent.includes('Falsches Passwort'), null, { timeout: 30000 });
    await unlock(page, 2, 'geheim');
    await page.waitForFunction(() => document.querySelectorAll('[data-list] > li')[2]?.textContent.includes('3 Seiten'), null, { timeout: 30000 });
    check(`${engineName} zusammenfügen: Passwort falsch, dann richtig`, true);

    await item(page, 3).locator('[data-action=remove]').click();
    await item(page, 0).locator('[data-action=down]').click();
    await page.locator('[data-merge]').click();
    await page.locator('[data-result]').waitFor({ state: 'visible', timeout: 60000 });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-download]').click()]);
    const merged = join(DOWNLOADS, `${engineName}-zusammengefuegt.pdf`);
    await download.saveAs(merged);
    const texts = await pdfTexts(merged);
    check(
      `${engineName} zusammenfügen: Ergebnis in richtiger Reihenfolge`,
      texts.length === 6 && texts[0].includes('Grün') && texts[1].includes('Blau') && texts[3].includes('Rot'),
      `${texts.length} Seiten`,
    );
    check(`${engineName} zusammenfügen: Hinweis „ohne Passwort“`, (await page.locator('[data-result-text]').textContent()).includes('ohne Passwort'));
    await item(page, 0).locator('[data-action=down]').click();
    check(`${engineName} zusammenfügen: Umsortieren verwirft Ergebnis`, await page.locator('[data-result]').isHidden());
    await page.locator('[data-clear]').click();

    // Offline: Dateien hinzufügen, Netz weg, zusammenfügen (der Selbsttest auf /sicherheit/)
    await page.setInputFiles('[data-file-input]', ['1-blau.pdf', '2-gruen-gesperrt.pdf'].map((f) => join(FILES, f)));
    await waitRead(page);
    await context.setOffline(true);
    const before = problems.length;
    let offline = false;
    try {
      await page.locator('[data-merge]').click();
      await page.locator('[data-result]').waitFor({ state: 'visible', timeout: 30000 });
      const [offlineDownload] = await Promise.all([page.waitForEvent('download'), page.locator('[data-download]').click()]);
      await offlineDownload.saveAs(join(DOWNLOADS, `${engineName}-offline.pdf`));
      offline = (await pdfTexts(join(DOWNLOADS, `${engineName}-offline.pdf`))).length === 3;
    } catch {}
    problems.splice(before);
    check(`${engineName} zusammenfügen: klappt offline`, offline);
    await context.close();
  }

  // ---------- Komprimieren ----------
  {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    watch(page, problems);
    await page.goto(BASE + '/pdf-komprimieren/', { waitUntil: 'networkidle' });
    const wasmEarly = await page.evaluate(() => performance.getEntriesByType('resource').some((entry) => entry.name.endsWith('.wasm')));
    check(`${engineName} komprimieren: Ghostscript erst bei Bedarf`, !wasmEarly);
    await page.setInputFiles('[data-file-input]', ['5-bilder-gross.pdf', '1-blau.pdf', '3-rot-passwort-geheim.pdf'].map((f) => join(FILES, f)));
    await waitRead(page);
    await unlock(page, 2, 'geheim');
    await page.waitForFunction(() => document.querySelectorAll('[data-list] > li')[2]?.textContent.includes('3 Seiten'), null, { timeout: 30000 });

    const finished = () =>
      page.waitForFunction(
        () => [...document.querySelectorAll('[data-list] > li')].every((li) => /Herunterladen|Schon so klein|nicht geklappt|Speicher/.test(li.textContent)),
        null,
        { timeout: 180000 },
      );
    const started = Date.now();
    await page.locator('[data-compress]').click();
    check(`${engineName} komprimieren: Auswahl während der Arbeit gesperrt`, await page.locator('[data-file-input]').isDisabled());
    await finished();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const rows = (await page.locator('[data-list] > li').allTextContents()).map((text) => text.replace(/\s+/g, ' '));
    check(`${engineName} komprimieren: Bilder-PDF verkleinert`, rows[0].includes('→'), `${rows[0].match(/[\d,]+ MB → [\d,]+ [KM]B −[\d,]+ %/)?.[0]} · ${seconds} s`);
    check(`${engineName} komprimieren: Ersparnis nie „100 %“`, !rows.join(' ').includes('−100'));
    check(`${engineName} komprimieren: Text-PDF ehrlich nicht verkleinert`, rows[1].includes('Schon so klein'));
    check(`${engineName} komprimieren: Passwort-PDF`, /Herunterladen|Schon so klein/.test(rows[2]));
    check(`${engineName} komprimieren: Auswahl danach wieder frei`, !(await page.locator('[data-file-input]').isDisabled()));

    const [download] = await Promise.all([page.waitForEvent('download'), item(page, 0).locator('a[download]').click()]);
    const medium = join(DOWNLOADS, `${engineName}-mittel.pdf`);
    await download.saveAs(medium);
    const texts = await pdfTexts(medium);
    check(`${engineName} komprimieren: Ergebnis gültig, Text erhalten`, texts.length === 3 && texts[0].includes('markierbarer Text'));

    await page.locator('label:has(input[value=klein])').click();
    check(`${engineName} komprimieren: Stufenwechsel verwirft Ergebnisse`, !(await item(page, 0).textContent()).includes('Herunterladen'));
    await page.locator('[data-compress]').click();
    await finished();
    const [smallDownload] = await Promise.all([page.waitForEvent('download'), item(page, 0).locator('a[download]').click()]);
    const small = join(DOWNLOADS, `${engineName}-klein.pdf`);
    await smallDownload.saveAs(small);
    check(`${engineName} komprimieren: klein kleiner als mittel`, readFileSync(small).length < readFileSync(medium).length);
    await context.close();
  }


  // ---------- Teilen ----------
  {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    watch(page, problems);
    await page.goto(BASE + '/pdf-teilen/', { waitUntil: 'networkidle' });
    await page.setInputFiles('#split-tool [data-file-input]', join(FILES, '6-zehn-seiten.pdf'));
    await page.locator('#split-tool [data-board]').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('#split-tool [data-thumb] canvas').length > 0, null, { timeout: 30000 });
    const cut = (n) => page.locator(`#split-tool [data-cut="${n}"]`);
    const parts = () => page.locator('#split-tool [data-parts] li').allTextContents();
    check(`${engineName} teilen: 10 Seiten, 9 Trennstellen`, (await page.locator('#split-tool [data-thumb]').count()) === 10 && (await page.locator('#split-tool [data-cut]').count()) === 9);
    check(`${engineName} teilen: ohne Marke gesperrt`, await page.locator('#split-tool [data-split]').isDisabled());

    await cut(3).click();
    await cut(7).click();
    check(`${engineName} teilen: zwei Marken, drei Teile`, (await parts()).join(' | ') === 'Teil 1 · Seiten 1–3 | Teil 2 · Seiten 4–7 | Teil 3 · Seiten 8–10', (await parts()).join(' | '));
    await cut(7).click();
    check(`${engineName} teilen: Marke wieder entfernt`, (await parts()).length === 2);
    await cut(7).click();
    await cut(7).dragTo(cut(8));
    check(`${engineName} teilen: Marke verschieben`, (await parts()).join(' | ').includes('Seiten 4–8'), (await parts()).join(' | '));
    await cut(8).dragTo(cut(7));
    check(`${engineName} teilen: Ziehen entfernt die Marke nicht`, (await parts()).length === 3);

    await page.locator('#split-tool [data-split]').click();
    await page.locator('#split-tool [data-result]').waitFor({ state: 'visible', timeout: 60000 });
    const links = page.locator('#split-tool [data-downloads] a[download]');
    const expected = [['Seite 1', 'Seite 3'], ['Seite 4', 'Seite 7'], ['Seite 8', 'Seite 10']];
    let allRight = (await links.count()) === 3;
    for (let i = 0; i < 3 && allRight; i++) {
      const [download] = await Promise.all([page.waitForEvent('download'), links.nth(i).click()]);
      const target = join(DOWNLOADS, `${engineName}-teil-${i + 1}.pdf`);
      await download.saveAs(target);
      const texts = await pdfTexts(target);
      allRight = texts[0].includes(expected[i][0]) && texts.at(-1).includes(expected[i][1]) && download.suggestedFilename() === `6-zehn-seiten-teil-${i + 1}.pdf`;
    }
    check(`${engineName} teilen: drei richtige Teile mit richtigen Namen`, allRight);
    await cut(5).click();
    check(`${engineName} teilen: neue Marke verwirft Ergebnis`, await page.locator('#split-tool [data-result]').isHidden());

    await page.setInputFiles('#split-tool [data-file-input]', join(FILES, '3-rot-passwort-geheim.pdf'));
    await page.locator('#split-tool [data-password]').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('#split-tool [data-password] input').fill('geheim');
    await page.locator('#split-tool [data-password] button').click();
    await page.locator('#split-tool [data-board]').waitFor({ state: 'visible', timeout: 30000 });
    check(`${engineName} teilen: Passwort-PDF öffnet`, (await page.locator('#split-tool [data-thumb]').count()) === 3);

    await page.setInputFiles('#split-tool [data-file-input]', join(FILES, '4-keine-pdf.pdf'));
    await page.waitForFunction(() => document.querySelector('#split-tool [data-message]')?.textContent.includes('Kann nicht geöffnet werden'), null, { timeout: 30000 });
    check(`${engineName} teilen: kaputte Datei gemeldet`, true);

    // Offline: Datei laden, Netz weg, teilen
    await page.setInputFiles('#split-tool [data-file-input]', join(FILES, '6-zehn-seiten.pdf'));
    await page.locator('#split-tool [data-board]').waitFor({ state: 'visible', timeout: 30000 });
    await cut(5).click();
    await context.setOffline(true);
    const before = problems.length;
    let offline = false;
    try {
      await page.locator('#split-tool [data-split]').click();
      await page.locator('#split-tool [data-result]').waitFor({ state: 'visible', timeout: 30000 });
      offline = (await links.count()) === 2;
    } catch {}
    problems.splice(before);
    check(`${engineName} teilen: klappt offline`, offline);
    await context.close();
  }

  check(`${engineName}: keine Fehler, CSP-Verstöße oder fremden Verbindungen`, problems.length === 0, problems.slice(0, 6).join(' | '));
  await browser.close();
}

console.log(failed === 0 ? '\nAlles in Ordnung.' : `\n${failed} Prüfung(en) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
