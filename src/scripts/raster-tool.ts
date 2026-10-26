import { zipSync } from 'fflate';
import { formatBytes, formatPages } from '../lib/format';
import { element } from './pdf-list';
import { SinglePdf } from './single-pdf';

type Rendered = { page: number; name: string; blob: Blob; url: string };

const root = document.querySelector<HTMLElement>('#raster-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const actions = find<HTMLElement>('[data-actions]');
const summary = find<HTMLElement>('[data-summary]');
const convertButton = find<HTMLButtonElement>('[data-convert]');
const progress = find<HTMLElement>('[data-progress]');
const progressBar = find<HTMLElement>('[data-progress-bar]');
const status = find<HTMLElement>('[data-status]');
const result = find<HTMLElement>('[data-result]');
const resultTitle = find<HTMLElement>('[data-result-title]');
const zipButton = find<HTMLButtonElement>('[data-zip]');
const imageList = find<HTMLUListElement>('[data-images]');
const options = root.querySelectorAll<HTMLInputElement>('input[name="format"], input[name="dpi"]');

let busy = false;
let rendered: Rendered[] = [];
let zipUrl: string | undefined;

const pdf = new SinglePdf({
  root,
  isBusy: () => busy,
  onOpen: () => update(),
  onReset: () => clearResult(),
  onChange: () => update(),
});

function chosen(name: string) {
  return [...options].find((input) => input.name === name && input.checked)!.value;
}

function update() {
  const ready = pdf.doc !== undefined;
  const pages = pdf.doc?.pageCount ?? 0;
  count.textContent = ready ? formatPages(pages) : pdf.file ? '1 Datei' : 'Keine Datei';
  actions.hidden = !ready;
  summary.textContent = ready ? `${formatPages(pages)} → ${pages === 1 ? '1 Bild' : `${pages} Bilder`} als ${chosen('format').toUpperCase()}` : '';
  convertButton.disabled = busy || !ready;
  zipButton.disabled = busy;
  for (const input of options) input.disabled = busy;
  pdf.setBusy(busy);
}

function clearResult() {
  for (const image of rendered) URL.revokeObjectURL(image.url);
  if (zipUrl) URL.revokeObjectURL(zipUrl);
  rendered = [];
  zipUrl = undefined;
  imageList.replaceChildren();
  result.hidden = true;
  status.textContent = '';
}

async function convert() {
  const doc = pdf.doc;
  if (!doc || busy) return;
  const format = chosen('format');
  const dpi = Number(chosen('dpi'));
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  // Führende Nullen, damit die Bilder im Ordner in der richtigen Reihenfolge stehen: seite-02
  // vor seite-10, nicht dahinter.
  const digits = String(doc.pageCount).length;
  busy = true;
  clearResult();
  progress.hidden = false;
  update();

  try {
    // Seite für Seite, nicht alle auf einmal: Eine Seite bei 300 dpi ist ein Bild mit rund neun
    // Millionen Pixeln, zwanzig davon gleichzeitig sprengten am Handy den Speicher.
    for (let n = 1; n <= doc.pageCount; n++) {
      status.textContent = `Seite ${n} von ${doc.pageCount} …`;
      progressBar.style.width = `${((n - 1) / doc.pageCount) * 100}%`;
      const canvas = await doc.renderAtDpi(n, dpi);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((image) => (image ? resolve(image) : reject(new Error('Bild nicht erzeugt'))), type, 0.92),
      );
      // Leinwand sofort freigeben, sonst hält der Browser alle Seiten im Speicher, bis er aufräumt.
      canvas.width = 0;
      canvas.height = 0;
      if (pdf.doc !== doc) return;
      const name = `${pdf.baseName}-seite-${String(n).padStart(digits, '0')}.${format}`;
      rendered.push({ page: n, name, blob, url: URL.createObjectURL(blob) });
    }
  } catch {
    status.textContent = 'Beim Umwandeln ist etwas schiefgegangen.';
    return;
  } finally {
    busy = false;
    progress.hidden = true;
    progressBar.style.width = '0%';
    update();
  }

  status.textContent = '';
  resultTitle.textContent = `${rendered.length === 1 ? '1 Bild' : `${rendered.length} Bilder`} fertig`;
  zipButton.hidden = rendered.length < 2;
  imageList.replaceChildren(
    ...rendered.map((image) => {
      const row = element('li', 'flex items-center gap-3 rounded-lg bg-sheet p-2');
      const preview = element('img', 'h-14 w-11 shrink-0 rounded border border-rule object-cover object-top');
      preview.src = image.url;
      preview.alt = '';
      const text = element('div', 'min-w-0 flex-1');
      // "Seite 3" statt des Dateinamens: In zwei Spalten würde der Name abgeschnitten, und gerade
      // die Seitennummer am Ende wäre nicht mehr zu sehen. Beim Herunterladen gilt der volle Name.
      text.append(
        element('p', 'text-sm font-medium text-ink', `Seite ${image.page}`),
        element('p', 'truncate font-mono text-[11px] tracking-wide text-graphite', `${formatBytes(image.blob.size)} · ${image.name}`),
      );
      text.title = image.name;
      const link = element(
        'a',
        'shrink-0 rounded-md bg-signal px-2.5 py-1 text-xs font-medium text-on-signal transition hover:bg-signal-strong',
        'Herunterladen',
      );
      link.href = image.url;
      link.download = image.name;
      row.append(preview, text, link);
      return row;
    }),
  );
  result.hidden = false;
}

// Erst beim Klick packen, nicht schon nach dem Umwandeln: Wer nur ein Bild braucht, soll nicht
// auf ein ZIP aller Seiten warten.
async function downloadZip() {
  if (busy || rendered.length === 0) return;
  if (!zipUrl) {
    busy = true;
    status.textContent = 'Packe das ZIP …';
    update();
    const files: Record<string, Uint8Array> = {};
    for (const image of rendered) files[image.name] = new Uint8Array(await image.blob.arrayBuffer());
    // Ohne Kompression: JPG und PNG sind schon gepackt, noch einmal packen kostet nur Zeit.
    const zipped = zipSync(files, { level: 0 });
    zipUrl = URL.createObjectURL(new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
    busy = false;
    status.textContent = '';
    update();
  }
  const link = document.createElement('a');
  link.href = zipUrl;
  link.download = `${pdf.baseName}-bilder.zip`;
  link.click();
}

for (const input of options) {
  input.addEventListener('change', () => {
    // Anderes Format oder andere Auflösung: Die fertigen Bilder passen nicht mehr.
    clearResult();
    update();
  });
}
convertButton.addEventListener('click', () => convert());
zipButton.addEventListener('click', () => downloadZip());
