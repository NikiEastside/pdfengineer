import { formatBytes, formatPages } from '../lib/format';
import { inspectImage, prepareImage, type PreparedImage } from '../lib/image-prepare';
import type { Layout, Orientation } from '../lib/images';
import type { ImagesReply, ImagesRequest } from '../lib/images.worker';
import { PdfList, type PdfEntry } from './pdf-list';

const root = document.querySelector<HTMLElement>('#image-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const actions = find<HTMLElement>('[data-actions]');
const summary = find<HTMLElement>('[data-summary]');
const hint = find<HTMLElement>('[data-hint]');
const clearButton = find<HTMLButtonElement>('[data-clear]');
const convertButton = find<HTMLButtonElement>('[data-convert]');
const status = find<HTMLElement>('[data-status]');
const result = find<HTMLElement>('[data-result]');
const resultText = find<HTMLElement>('[data-result-text]');
const download = find<HTMLAnchorElement>('[data-download]');
const layoutInputs = root.querySelectorAll<HTMLInputElement>('input[name="layout"]');
const orientationBox = find<HTMLElement>('[data-orientation]');
const orientationInputs = root.querySelectorAll<HTMLInputElement>('input[name="orientation"]');

let busy = false;
let worker: Worker | undefined;
let resultUrl: string | undefined;

// Wie bei den anderen Werkzeugen startet der Worker mit dem ersten Bild. Dann klappt das
// Umwandeln auch ohne Netz.
function imagesWorker() {
  worker ??= new Worker(new URL('../lib/images.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

async function inspect(entry: PdfEntry) {
  const info = await inspectImage(entry.file);
  if (info.ok) {
    entry.state = 'ready';
    entry.thumbnail = info.thumbnail;
    entry.detail = `${info.width} × ${info.height} px`;
  } else {
    entry.state = 'invalid';
    entry.problem = info.problem;
  }
}

const files = new PdfList({
  root,
  sortable: true,
  isBusy: () => busy,
  onFirstFile: imagesWorker,
  inspect,
  onChange: (orderChanged) => {
    // Andere Bilder oder andere Reihenfolge: Ein fertiges Ergebnis passt nicht mehr.
    if (orderChanged) clearResult();
    update();
  },
});

function layout(): Layout {
  return ([...layoutInputs].find((input) => input.checked)?.value ?? 'a4') as Layout;
}

function orientation(): Orientation {
  return ([...orientationInputs].find((input) => input.checked)?.value ?? 'auto') as Orientation;
}

function blocker(): string | undefined {
  return files.blocker() ?? (files.entries.length === 0 ? 'Füge mindestens ein Bild hinzu.' : undefined);
}

function update() {
  const { entries } = files;
  actions.hidden = entries.length === 0;
  const label = entries.length === 1 ? '1 Bild' : `${entries.length} Bilder`;
  count.textContent = label;
  summary.textContent = `${label} · ${formatPages(entries.length)} · ${formatBytes(entries.reduce((sum, entry) => sum + entry.file.size, 0))}`;
  const reason = blocker();
  hint.textContent = reason ?? '';
  convertButton.disabled = reason !== undefined || busy;
  clearButton.disabled = busy;
  for (const input of [...layoutInputs, ...orientationInputs]) input.disabled = busy;
  // Die Ausrichtung gibt es nur bei A4. Bei "Wie das Bild" folgt jede Seite ihrem Bild.
  orientationBox.hidden = layout() !== 'a4';
  files.setBusy(busy);
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  result.hidden = true;
  status.textContent = '';
}

async function convert() {
  const entries = [...files.entries];
  busy = true;
  clearResult();
  update();

  // Nacheinander vorbereiten: Zehn große Fotos gleichzeitig dekodiert, das sprengte am Handy
  // den Speicher.
  const images: PreparedImage[] = [];
  try {
    for (const [index, entry] of entries.entries()) {
      status.textContent = `Bereite Bild ${index + 1} von ${entries.length} vor …`;
      images.push(await prepareImage(entry.file));
    }
  } catch {
    busy = false;
    status.textContent = 'Ein Bild ließ sich nicht verarbeiten.';
    update();
    return;
  }
  status.textContent = 'Erstelle die PDF …';

  const current = imagesWorker();
  const request: ImagesRequest = { images, layout: layout(), orientation: orientation() };
  const reply = await new Promise<ImagesReply>((resolve) => {
    current.onmessage = (event: MessageEvent<ImagesReply>) => resolve(event.data);
    current.onerror = () => {
      current.terminate();
      worker = undefined;
      resolve({ ok: false, message: 'Beim Umwandeln ist etwas schiefgegangen.' });
    };
    current.postMessage(request);
  });
  busy = false;

  if (reply.ok) {
    const blob = new Blob([reply.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    resultUrl = URL.createObjectURL(blob);
    // Ein Bild: dessen Name. Mehrere: ein neutraler Name statt eines Namens, der nur zum
    // ersten Bild passt.
    const name = entries.length === 1 ? `${entries[0].file.name.replace(/\.[^.]+$/, '')}.pdf` : 'bilder.pdf';
    download.href = resultUrl;
    download.download = name;
    resultText.textContent = `${name} · ${formatPages(entries.length)} · ${formatBytes(blob.size)}`;
    status.textContent = '';
    result.hidden = false;
  } else {
    status.textContent = reply.message;
  }
  update();
}

for (const input of [...layoutInputs, ...orientationInputs]) {
  input.addEventListener('change', () => {
    clearResult();
    update();
  });
}

clearButton.addEventListener('click', () => files.clear());
convertButton.addEventListener('click', () => {
  if (!blocker() && !busy) convert();
});
