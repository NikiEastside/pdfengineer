import { formatBytes, formatPages } from '../lib/format';
import { EMPTY, type Metadata } from '../lib/metadata-fields';
import type { MetadataReply, MetadataRequest } from '../lib/metadata.worker';
import type { DocumentMetadata, OpenDocument } from '../lib/preview';
import { element } from './pdf-list';
import { SinglePdf } from './single-pdf';

const root = document.querySelector<HTMLElement>('#meta-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const form = find<HTMLFormElement>('[data-form]');
const inputs = [...root.querySelectorAll<HTMLInputElement>('input[data-field]')];
const extra = find<HTMLElement>('[data-extra]');
const xmpNote = find<HTMLElement>('[data-xmp]');
const customBox = find<HTMLElement>('[data-custom]');
const customList = find<HTMLUListElement>('[data-custom-list]');
const actions = find<HTMLElement>('[data-actions]');
const summary = find<HTMLElement>('[data-summary]');
const hint = find<HTMLElement>('[data-hint]');
const clearButton = find<HTMLButtonElement>('[data-clear]');
const restoreButton = find<HTMLButtonElement>('[data-restore]');
const saveButton = find<HTMLButtonElement>('[data-save]');
const status = find<HTMLElement>('[data-status]');
const result = find<HTMLElement>('[data-result]');
const resultText = find<HTMLElement>('[data-result-text]');
const download = find<HTMLAnchorElement>('[data-download]');

let original: DocumentMetadata | undefined;
let busy = false;
let worker: Worker | undefined;
let resultUrl: string | undefined;

// Wie bei den anderen Werkzeugen startet der Worker mit der Datei. Dann klappt das Speichern
// auch ohne Netz.
function metadataWorker() {
  worker ??= new Worker(new URL('../lib/metadata.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

const pdf = new SinglePdf({
  root,
  isBusy: () => busy,
  onFile: metadataWorker,
  onOpen: (doc) => show(doc),
  onReset: () => {
    original = undefined;
    clearResult();
    form.hidden = true;
  },
  onChange: () => update(),
});

function current(): Metadata {
  const values = { ...EMPTY };
  for (const input of inputs) values[input.dataset.field as keyof Metadata] = input.value.trim();
  return values;
}

function changedFields() {
  if (!original) return [];
  const now = current();
  return (Object.keys(EMPTY) as (keyof Metadata)[]).filter((key) => now[key] !== original!.values[key].trim());
}

async function show(doc: OpenDocument) {
  const loaded = await doc.metadata();
  // Während des Lesens eine andere Datei gewählt: überholt.
  if (pdf.doc !== doc) return;
  original = loaded;
  fill(loaded.values);
  xmpNote.hidden = !loaded.hasXmp;
  customBox.hidden = loaded.custom.length === 0;
  customList.replaceChildren(...loaded.custom.map(([key, value]) => element('li', 'truncate', `${key}: ${value}`)));
  extra.hidden = xmpNote.hidden && customBox.hidden;
  form.hidden = false;
  update();
}

function fill(values: Metadata) {
  for (const input of inputs) input.value = values[input.dataset.field as keyof Metadata];
}

function update() {
  const ready = pdf.doc !== undefined && original !== undefined;
  count.textContent = pdf.doc ? formatPages(pdf.doc.pageCount) : pdf.file ? '1 Datei' : 'Keine Datei';
  actions.hidden = !ready;

  const changed = changedFields();
  for (const input of inputs) input.toggleAttribute('data-changed', changed.includes(input.dataset.field as keyof Metadata));
  const empty = Object.values(current()).every((value) => value === '');

  if (!ready) summary.textContent = '';
  else if (empty) summary.textContent = 'Alle Felder leer';
  else if (changed.length === 0) summary.textContent = 'Keine Änderungen';
  else summary.textContent = changed.length === 1 ? '1 Feld geändert' : `${changed.length} Felder geändert`;

  hint.textContent = ready && changed.length === 0 ? 'Ändere ein Feld oder entferne alle Angaben auf einmal.' : '';

  saveButton.disabled = busy || changed.length === 0;
  restoreButton.disabled = busy || changed.length === 0;
  clearButton.disabled = busy || empty;
  for (const input of inputs) input.disabled = busy;
  pdf.setBusy(busy);
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  result.hidden = true;
  status.textContent = '';
}

async function save() {
  if (!pdf.bytes || busy || changedFields().length === 0) return;
  const request: MetadataRequest = { bytes: pdf.bytes, password: pdf.password, metadata: current() };
  busy = true;
  clearResult();
  status.textContent = 'Speichere …';
  update();

  const active = metadataWorker();
  const reply = await new Promise<MetadataReply>((resolve) => {
    active.onmessage = (event: MessageEvent<MetadataReply>) => resolve(event.data);
    active.onerror = () => {
      active.terminate();
      worker = undefined;
      resolve({ ok: false, message: 'Beim Speichern ist etwas schiefgegangen.' });
    };
    active.postMessage(request);
  });
  busy = false;

  if (reply.ok) {
    const blob = new Blob([reply.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    resultUrl = URL.createObjectURL(blob);
    // Derselbe Dateiname wie vorher: Wer Metadaten bereinigt, will meist genau diese Datei
    // weiterschicken, nicht eine mit angehängtem Zusatz.
    const name = `${pdf.baseName}.pdf`;
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
  update();
});
// Enter in einem Feld soll nicht die Seite neu laden.
form.addEventListener('submit', (event) => event.preventDefault());

clearButton.addEventListener('click', () => {
  fill(EMPTY);
  clearResult();
  update();
});

restoreButton.addEventListener('click', () => {
  if (original) fill(original.values);
  clearResult();
  update();
});

saveButton.addEventListener('click', () => save());
