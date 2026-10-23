import { outputName, type Level } from '../lib/compress';
import type { CompressReply, CompressRequest } from '../lib/compress.worker';
import { formatBytes, formatSaving } from '../lib/format';
import { element, PdfList, type PdfEntry } from './pdf-list';

type Result =
  | { status: 'queued' }
  | { status: 'working'; page: number; pages: number }
  | { status: 'done'; url: string; size: number }
  // Das Ergebnis wäre nicht kleiner geworden. Dann gibt es nichts herunterzuladen.
  | { status: 'kept' }
  | { status: 'failed'; message: string };

const root = document.querySelector<HTMLElement>('#compress-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const actions = find<HTMLElement>('[data-actions]');
const summary = find<HTMLElement>('[data-summary]');
const hint = find<HTMLElement>('[data-hint]');
const clearButton = find<HTMLButtonElement>('[data-clear]');
const compressButton = find<HTMLButtonElement>('[data-compress]');
const status = find<HTMLElement>('[data-status]');
const levelInputs = root.querySelectorAll<HTMLInputElement>('input[name="level"]');

const results = new Map<number, Result>();
let busy = false;
let worker: Worker | undefined;

// Wie beim Zusammenfügen startet der Worker mit der ersten Datei. Hier lohnt es sich doppelt:
// Er lädt und übersetzt gleich Ghostscript, und das sind gut 10 MB. Bis jemand die Stärke
// gewählt hat, ist das meist erledigt.
function compressWorker() {
  worker ??= new Worker(new URL('../lib/compress.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function level(): Level {
  return ([...levelInputs].find((input) => input.checked)?.value ?? 'mittel') as Level;
}

function decorate(entry: PdfEntry, body: HTMLElement) {
  const result = results.get(entry.id);
  if (!result) return;
  const line = 'mt-1.5 font-mono text-[11px] tracking-wide';

  if (result.status === 'queued') {
    body.append(element('p', `${line} text-graphite`, 'wartet …'));
  } else if (result.status === 'working') {
    const share = result.pages > 0 ? result.page / result.pages : 0;
    const track = element('div', 'mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-sunken');
    const bar = element('div', 'h-full rounded-full bg-signal transition-[width] duration-300');
    // Über das CSSOM, nicht als style-Attribut: Das verbietet die Content-Security-Policy.
    bar.style.width = `${Math.max(4, share * 100)}%`;
    track.append(bar);
    const label = result.pages > 0 ? `Seite ${result.page} von ${result.pages}` : 'wird komprimiert …';
    body.append(track, element('p', `${line} text-graphite`, label));
  } else if (result.status === 'done') {
    const row = element('div', 'mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5');
    const numbers = element('p', `${line} mt-0 text-ink`);
    numbers.append(
      `${formatBytes(entry.file.size)} → ${formatBytes(result.size)} `,
      element('span', 'font-semibold text-ok', formatSaving(entry.file.size, result.size)),
    );
    if (entry.password) numbers.append(' · ohne Passwort');
    const link = element(
      'a',
      'inline-flex items-center gap-1.5 rounded-md bg-signal px-2.5 py-1 text-xs font-medium text-on-signal transition hover:bg-signal-strong',
      'Herunterladen',
    );
    link.href = result.url;
    link.download = outputName(entry.file.name);
    row.append(numbers, link);
    body.append(row);
  } else if (result.status === 'kept') {
    body.append(element('p', `${line} text-graphite`, 'Schon so klein wie möglich, hier gibt es nichts zu holen.'));
  } else {
    body.append(element('p', `${line} text-danger`, result.message));
  }
}

const files = new PdfList({
  root,
  sortable: false,
  isBusy: () => busy,
  onFirstFile: compressWorker,
  onChange: (orderChanged) => {
    // Entfernte Dateien: ihre Ergebnisse und deren Speicher freigeben.
    if (orderChanged) {
      for (const id of results.keys()) {
        if (!files.entries.some((entry) => entry.id === id)) dropResult(id);
      }
    }
    update();
  },
  decorate,
});

function dropResult(id: number) {
  const result = results.get(id);
  if (result?.status === 'done') URL.revokeObjectURL(result.url);
  results.delete(id);
}

function blocker(): string | undefined {
  return files.blocker() ?? (files.entries.length === 0 ? 'Füge mindestens eine PDF hinzu.' : undefined);
}

function update() {
  const { entries } = files;
  actions.hidden = entries.length === 0;
  const label = entries.length === 1 ? '1 Datei' : `${entries.length} Dateien`;
  count.textContent = label;

  const before = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  const finished = entries.filter((entry) => {
    const status = results.get(entry.id)?.status;
    return status === 'done' || status === 'kept';
  });
  if (finished.length === entries.length && entries.length > 0) {
    const after = entries.reduce((sum, entry) => {
      const result = results.get(entry.id)!;
      return sum + (result.status === 'done' ? result.size : entry.file.size);
    }, 0);
    summary.textContent = `${label} · ${formatBytes(before)} → ${formatBytes(after)} · ${formatSaving(before, after)}`;
  } else {
    summary.textContent = `${label} · ${formatBytes(before)}`;
  }

  const reason = blocker();
  hint.textContent = reason ?? '';
  compressButton.disabled = reason !== undefined || busy;
  clearButton.disabled = busy;
  for (const input of levelInputs) input.disabled = busy;
  files.setBusy(busy);
}

function run(request: CompressRequest, onProgress: (page: number, pages: number) => void) {
  const current = compressWorker();
  return new Promise<CompressReply>((resolve) => {
    current.onmessage = (event: MessageEvent<CompressReply>) => {
      const reply = event.data;
      if (reply.id !== request.id) return;
      if (reply.type === 'progress') onProgress(reply.page, reply.pages);
      else resolve(reply);
    };
    current.onerror = () => {
      // Meist ist der Speicher ausgegangen. Ein abgestürzter Worker nimmt keine Aufträge mehr
      // an, also für die nächste Datei einen neuen starten.
      current.terminate();
      worker = undefined;
      resolve({ id: request.id, type: 'error', message: 'Zu groß für den Speicher dieses Geräts.' });
    };
    current.postMessage(request);
  });
}

async function compressAll() {
  busy = true;
  status.textContent = '';
  const chosen = level();
  const queue = files.entries.filter((entry) => entry.state === 'ready');
  for (const entry of queue) {
    dropResult(entry.id);
    results.set(entry.id, { status: 'queued' });
    files.touch(entry);
  }

  for (const entry of queue) {
    if (!files.entries.includes(entry)) continue;
    results.set(entry.id, { status: 'working', page: 0, pages: 0 });
    files.touch(entry);
    const reply = await run({ id: entry.id, bytes: entry.bytes!, password: entry.password, level: chosen }, (page, pages) => {
      results.set(entry.id, { status: 'working', page, pages });
      files.touch(entry);
    });
    if (reply.type === 'done' && reply.bytes.length < entry.file.size) {
      const blob = new Blob([reply.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
      results.set(entry.id, { status: 'done', url: URL.createObjectURL(blob), size: blob.size });
    } else if (reply.type === 'done') {
      results.set(entry.id, { status: 'kept' });
    } else if (reply.type === 'error') {
      results.set(entry.id, { status: 'failed', message: reply.message });
    }
    files.touch(entry);
  }

  busy = false;
  update();
}

// Eine andere Stärke macht die bisherigen Ergebnisse ungültig. Wer umschaltet, will neu rechnen.
for (const input of levelInputs) {
  input.addEventListener('change', () => {
    for (const entry of files.entries) {
      if (results.has(entry.id)) {
        dropResult(entry.id);
        entry.dirty = true;
      }
    }
    if (files.entries[0]) files.touch(files.entries[0]);
  });
}

clearButton.addEventListener('click', () => files.clear());
compressButton.addEventListener('click', () => {
  if (!blocker() && !busy) compressAll();
});
