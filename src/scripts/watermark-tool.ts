import { formatBytes, formatPages } from '../lib/format';
import type { OpenDocument } from '../lib/preview';
import { COLORS, placeWatermark, type WatermarkColor, type WatermarkMode, type WatermarkOptions } from '../lib/watermark-layout';
import type { WatermarkReply, WatermarkRequest } from '../lib/watermark.worker';
import { SinglePdf } from './single-pdf';

// Breite der Vorschau in CSS-Pixeln. Gezeichnet wird für die Bildschirmdichte.
const PREVIEW_WIDTH = 240;
const FONT = 'Helvetica, Arial, sans-serif';

const root = document.querySelector<HTMLElement>('#watermark-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const form = find<HTMLFormElement>('[data-options]');
const opacityValue = find<HTMLElement>('[data-opacity-value]');
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
// Größe der ersten Seite, wie sie angezeigt wird, für die Vorschau.
let previewSize: { width: number; height: number } | undefined;

// Wie bei den anderen Werkzeugen startet der Worker mit der Datei. Dann klappt das Einfügen
// auch ohne Netz.
function watermarkWorker() {
  worker ??= new Worker(new URL('../lib/watermark.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

const pdf = new SinglePdf({
  root,
  isBusy: () => busy,
  onFile: watermarkWorker,
  onOpen: (doc) => showPreview(doc),
  onReset: () => {
    previewSize = undefined;
    clearResult();
    form.hidden = true;
  },
  onChange: () => update(),
});

// Direkt aus den Feldern statt über FormData: Gesperrte Felder fehlen dort, und während der
// Arbeit sind alle gesperrt.
const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | RadioNodeList).value;

function options(): WatermarkOptions {
  return {
    text: field('text').trim(),
    mode: field('mode') as WatermarkMode,
    color: field('color') as WatermarkColor,
    opacity: Number(field('opacity')) / 100,
    size: Number(field('size')),
  };
}

async function showPreview(doc: OpenDocument) {
  form.hidden = false;
  const [canvas, size] = await Promise.all([doc.render(1, PREVIEW_WIDTH), doc.pageSize(1)]);
  if (pdf.doc !== doc) return;
  pageCanvas.width = canvas.width;
  pageCanvas.height = canvas.height;
  pageCanvas.getContext('2d')!.drawImage(canvas, 0, 0);
  markCanvas.width = canvas.width;
  markCanvas.height = canvas.height;
  previewSize = size;
  drawMark();
  update();
}

// Zeichnet das Wasserzeichen mit derselben Anordnung, die auch ins PDF kommt. Nur die
// Schriftbreite misst die Leinwand selbst, die Abweichung zur PDF-Schrift ist gering.
function drawMark() {
  const context = markCanvas.getContext('2d')!;
  context.clearRect(0, 0, markCanvas.width, markCanvas.height);
  const current = options();
  if (!previewSize || !current.text) return;
  context.font = `bold 100px ${FONT}`;
  const widthAt1 = context.measureText(current.text).width / 100;
  const scale = markCanvas.width / previewSize.width;
  const [r, g, b] = COLORS[current.color].rgb;
  context.fillStyle = `rgb(${r * 255} ${g * 255} ${b * 255} / ${current.opacity})`;
  for (const placement of placeWatermark(previewSize.width, previewSize.height, widthAt1, current)) {
    context.save();
    // Die Leinwand zählt y von oben nach unten, die Seite von unten nach oben.
    context.translate(placement.x * scale, (previewSize.height - placement.y) * scale);
    context.rotate((-placement.angle * Math.PI) / 180);
    context.font = `bold ${placement.fontSize * scale}px ${FONT}`;
    context.fillText(current.text, 0, 0);
    context.restore();
  }
}

function update() {
  for (const element of form.elements) (element as HTMLInputElement).disabled = busy;
  const ready = pdf.doc !== undefined;
  count.textContent = ready ? formatPages(pdf.doc!.pageCount) : pdf.file ? '1 Datei' : 'Keine Datei';
  actions.hidden = !ready;
  const current = options();
  opacityValue.textContent = `${Math.round(current.opacity * 100)} %`;
  summary.textContent = ready ? `„${current.text || '…'}“ auf ${pdf.doc!.pageCount === 1 ? 'einer Seite' : `allen ${pdf.doc!.pageCount} Seiten`}` : '';
  applyButton.disabled = busy || !ready || !current.text;
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
  const request: WatermarkRequest = { bytes: pdf.bytes, password: pdf.password, options: options() };
  busy = true;
  clearResult();
  status.textContent = 'Füge das Wasserzeichen ein …';
  update();

  const current = watermarkWorker();
  const reply = await new Promise<WatermarkReply>((resolve) => {
    current.onmessage = (event: MessageEvent<WatermarkReply>) => resolve(event.data);
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
    const name = `${pdf.baseName}-wasserzeichen.pdf`;
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
  drawMark();
  update();
});
form.addEventListener('submit', (event) => event.preventDefault());
applyButton.addEventListener('click', () => apply());
