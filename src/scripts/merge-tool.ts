import { formatBytes, formatPages } from '../lib/format';
import type { MergeReply } from '../lib/merge.worker';
import { PdfList } from './pdf-list';

const root = document.querySelector<HTMLElement>('#merge-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const actions = find<HTMLElement>('[data-actions]');
const summary = find<HTMLElement>('[data-summary]');
const hint = find<HTMLElement>('[data-hint]');
const clearButton = find<HTMLButtonElement>('[data-clear]');
const mergeButton = find<HTMLButtonElement>('[data-merge]');
const status = find<HTMLElement>('[data-status]');
const result = find<HTMLElement>('[data-result]');
const resultText = find<HTMLElement>('[data-result-text]');
const download = find<HTMLAnchorElement>('[data-download]');

let merging = false;
let resultUrl: string | undefined;
let worker: Worker | undefined;

// Der Worker startet schon mit der ersten Datei, nicht erst beim Klick auf "Zusammenfügen".
// Dann ist sein Skript geladen, bevor es gebraucht wird, und das Zusammenfügen klappt auch
// ohne Netz. Darauf baut der Selbsttest auf /sicherheit: Dateien hinzufügen, WLAN aus,
// zusammenfügen.
function mergeWorker() {
  worker ??= new Worker(new URL('../lib/merge.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

const files = new PdfList({
  root,
  sortable: true,
  isBusy: () => merging,
  onFirstFile: mergeWorker,
  onChange: (orderChanged) => {
    // Jede Änderung an der Auswahl macht ein fertiges Ergebnis ungültig. Sonst lädt man nach
    // dem Umsortieren noch die alte Reihenfolge herunter.
    if (orderChanged) clearResult();
    update();
  },
});

function blocker(): string | undefined {
  return files.blocker() ?? (files.entries.length < 2 ? 'Füge mindestens zwei PDFs hinzu.' : undefined);
}

function update() {
  const { entries } = files;
  actions.hidden = entries.length === 0;
  const pages = entries.reduce((sum, entry) => sum + (entry.pageCount ?? 0), 0);
  const bytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);
  const label = entries.length === 1 ? '1 Datei' : `${entries.length} Dateien`;
  count.textContent = label;
  summary.textContent = `${label} · ${formatPages(pages)} · ${formatBytes(bytes)}`;

  const reason = blocker();
  hint.textContent = reason ?? '';
  mergeButton.disabled = reason !== undefined || merging;
  clearButton.disabled = merging;
  files.setBusy(merging);
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  result.hidden = true;
  status.textContent = '';
}

async function merge() {
  const sources = files.entries.map((entry) => ({
    name: entry.file.name,
    bytes: entry.bytes!,
    password: entry.password,
  }));
  merging = true;
  clearResult();
  status.textContent = 'Füge zusammen …';
  update();

  const current = mergeWorker();
  const reply = await new Promise<MergeReply>((resolve) => {
    current.onmessage = (event: MessageEvent<MergeReply>) => resolve(event.data);
    current.onerror = () => {
      // Ein abgestürzter Worker nimmt keine Aufträge mehr an. Beim nächsten Versuch startet
      // ein neuer.
      current.terminate();
      worker = undefined;
      resolve({ ok: false, message: 'Beim Zusammenfügen ist etwas schiefgegangen.' });
    };
    current.postMessage(sources);
  });
  merging = false;

  if (reply.ok) {
    const blob = new Blob([reply.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    resultUrl = URL.createObjectURL(blob);
    download.href = resultUrl;
    download.download = 'zusammengefuegt.pdf';
    const pages = files.entries.reduce((sum, entry) => sum + (entry.pageCount ?? 0), 0);
    resultText.textContent = `zusammengefuegt.pdf · ${formatPages(pages)} · ${formatBytes(blob.size)}`;
    if (files.entries.some((entry) => entry.password)) {
      resultText.textContent += ' · ohne Passwort';
    }
    status.textContent = '';
    result.hidden = false;
  } else {
    status.textContent = reply.message;
  }
  update();
}

clearButton.addEventListener('click', () => files.clear());
mergeButton.addEventListener('click', () => {
  if (!blocker() && !merging) merge();
});
