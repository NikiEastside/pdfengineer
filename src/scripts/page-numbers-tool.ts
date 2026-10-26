import { formatBytes, formatPages } from '../lib/format';
import { FONT_SIZE, pageLabel, placeLabel, type Format, type PageNumberOptions, type Position } from '../lib/page-numbers-layout';
import type { PageNumbersReply, PageNumbersRequest } from '../lib/page-numbers.worker';
import { SinglePdf } from './single-pdf';

const PREVIEW_WIDTH = 240;
const FONT = 'Helvetica, Arial, sans-serif';

const root = document.querySelector<HTMLElement>('#page-numbers-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const form = find<HTMLFormElement>('[data-options]');
const fromInput = find<HTMLInputElement>('input[name="fromPage"]');
const caption = find<HTMLElement>('[data-preview-caption]');
const pageCanvas = find<HTMLCanvasElement>('[data-preview-page]');
const markCanvas = find<HTMLCanvasElement>('[data-preview-mark]');
const actions = find<HTMLElement>('[data-actions]');
const summary = find<HTMLElement>('[data-summary]');
const applyButton = find<HTMLButtonElement>('[data-apply]');
const status = find<HTMLElement>('[data-status]');
const result = find<HTMLElement>('[data-result]');
const resultText = find<HTMLElement>('[data-result-text]');
const download = find<HTMLAnchorElement>('[data-download]');

let busy = false;
let worker: Worker | undefined;
let resultUrl: string | undefined;
// Welche Seite die Vorschau gerade zeigt und wie groß sie angezeigt wird.
let preview: { page: number; width: number; height: number } | undefined;

// Wie bei den anderen Werkzeugen startet der Worker mit der Datei. Dann klappt das Einfügen
// auch ohne Netz.
function pageNumbersWorker() {
  worker ??= new Worker(new URL('../lib/page-numbers.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

const pdf = new SinglePdf({
  root,
  isBusy: () => busy,
  onFile: pageNumbersWorker,
  onOpen: (doc) => {
    fromInput.max = String(doc.pageCount);
    fromInput.value = '1';
    form.hidden = false;
    showPreview();
  },
  onReset: () => {
    preview = undefined;
    clearResult();
    form.hidden = true;
  },
  onChange: () => update(),
});

// Direkt aus den Feldern statt über FormData: Gesperrte Felder fehlen dort, und während der
// Arbeit sind alle gesperrt.
const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | RadioNodeList).value;

// Ungültige Eingaben (leer, zu groß, negativ) werden zurechtgerückt, statt einen Fehler zu
// zeigen. Wer "Ab Seite 50" bei zehn Seiten tippt, meint die letzte.
function options(): PageNumberOptions {
  const pageCount = pdf.doc?.pageCount ?? 1;
  const fromPage = Math.min(Math.max(1, Math.round(Number(field('fromPage')) || 1)), pageCount);
  const startNumber = Math.max(0, Math.round(Number(field('startNumber')) || 0));
  return { position: field('position') as Position, format: field('format') as Format, fromPage, startNumber };
}

// Die Vorschau zeigt die erste Seite, die eine Zahl bekommt. Ändert sich "Ab Seite", wird eine
// andere Seite gezeichnet.
async function showPreview() {
  const doc = pdf.doc;
  if (!doc) return;
  const page = options().fromPage;
  if (preview?.page === page) return drawLabel();
  const [canvas, size] = await Promise.all([doc.render(page, PREVIEW_WIDTH), doc.pageSize(page)]);
  if (pdf.doc !== doc || options().fromPage !== page) return;
  pageCanvas.width = canvas.width;
  pageCanvas.height = canvas.height;
  pageCanvas.getContext('2d')!.drawImage(canvas, 0, 0);
  markCanvas.width = canvas.width;
  markCanvas.height = canvas.height;
  preview = { page, ...size };
  caption.textContent = `Vorschau · Seite ${page}`;
  drawLabel();
}

function drawLabel() {
  const context = markCanvas.getContext('2d')!;
  context.clearRect(0, 0, markCanvas.width, markCanvas.height);
  if (!preview || !pdf.doc) return;
  const current = options();
  const label = pageLabel(preview.page, pdf.doc.pageCount, current);
  if (!label) return;
  const scale = markCanvas.width / preview.width;
  context.font = `${FONT_SIZE}px ${FONT}`;
  const spot = placeLabel(preview.width, preview.height, context.measureText(label).width, current.position);
  // In der Vorschau etwas kräftiger als im PDF, sonst ist die kleine Zahl kaum zu erkennen.
  context.font = `bold ${FONT_SIZE * scale}px ${FONT}`;
  // Farbe aus den Variablen der Seite, damit sie zum hellen wie zum dunklen Modus passt.
  context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-mark').trim() || 'red';
  context.fillText(label, spot.x * scale, (preview.height - spot.y) * scale);
}

function update() {
  for (const element of form.elements) (element as HTMLInputElement).disabled = busy;
  const doc = pdf.doc;
  count.textContent = doc ? formatPages(doc.pageCount) : pdf.file ? '1 Datei' : 'Keine Datei';
  actions.hidden = !doc;
  if (doc) {
    const current = options();
    const first = pageLabel(current.fromPage, doc.pageCount, current);
    const last = pageLabel(doc.pageCount, doc.pageCount, current);
    const numbered = doc.pageCount - current.fromPage + 1;
    summary.textContent = `${formatPages(numbered)} nummeriert · „${first}“${numbered > 1 ? ` bis „${last}“` : ''}`;
  }
  applyButton.disabled = busy || !doc;
  pdf.setBusy(busy);
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  result.hidden = true;
  status.textContent = '';
}

async function apply() {
  if (!pdf.bytes || busy) return;
  const request: PageNumbersRequest = { bytes: pdf.bytes, password: pdf.password, options: options() };
  busy = true;
  clearResult();
  status.textContent = 'Füge die Seitenzahlen ein …';
  update();

  const current = pageNumbersWorker();
  const reply = await new Promise<PageNumbersReply>((resolve) => {
    current.onmessage = (event: MessageEvent<PageNumbersReply>) => resolve(event.data);
    current.onerror = () => {
      current.terminate();
      worker = undefined;
      resolve({ ok: false, message: 'Beim Einfügen ist etwas schiefgegangen.' });
    };
    current.postMessage(request);
  });
  busy = false;

  if (reply.ok) {
    const blob = new Blob([reply.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    resultUrl = URL.createObjectURL(blob);
    const name = `${pdf.baseName}-seitenzahlen.pdf`;
    download.href = resultUrl;
    download.download = name;
    resultText.textContent = `${name} · ${formatBytes(blob.size)}${pdf.password ? ' · ohne Passwort' : ''}`;
    status.textContent = '';
    result.hidden = false;
  } else {
    status.textContent = reply.message;
  }
  update();
}

form.addEventListener('input', () => {
  clearResult();
  showPreview();
  update();
});
form.addEventListener('submit', (event) => event.preventDefault());
applyButton.addEventListener('click', () => apply());
