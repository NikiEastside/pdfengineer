import { formatBytes, formatPages } from '../lib/format';
import { openPdf, type OpenDocument } from '../lib/preview';
import { rangesFromCuts, type PageRange } from '../lib/split';
import type { SplitReply, SplitRequest } from '../lib/split.worker';
import { element } from './pdf-list';

// Gezeichnet wird für die größere Ansicht. Am Handy verkleinert das CSS das Bild nur.
const THUMB_WIDTH = 84;

const root = document.querySelector<HTMLElement>('#split-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const intake = find<HTMLElement>('[data-intake]');
const dropzone = find<HTMLElement>('[data-dropzone]');
const fileInput = find<HTMLInputElement>('[data-file-input]');
const fileBar = find<HTMLElement>('[data-file]');
const fileName = find<HTMLElement>('[data-file-name]');
const fileMeta = find<HTMLElement>('[data-file-meta]');
const resetButton = find<HTMLButtonElement>('[data-reset]');
const passwordForm = find<HTMLFormElement>('[data-password]');
const message = find<HTMLElement>('[data-message]');
const board = find<HTMLElement>('[data-board]');
const pages = find<HTMLOListElement>('[data-pages]');
const actions = find<HTMLElement>('[data-actions]');
const partList = find<HTMLUListElement>('[data-parts]');
const hint = find<HTMLElement>('[data-hint]');
const clearButton = find<HTMLButtonElement>('[data-clear]');
const splitButton = find<HTMLButtonElement>('[data-split]');
const status = find<HTMLElement>('[data-status]');
const result = find<HTMLElement>('[data-result]');
const resultTitle = find<HTMLElement>('[data-result-title]');
const downloads = find<HTMLUListElement>('[data-downloads]');

let file: File | undefined;
let bytes: Uint8Array | undefined;
let password: string | undefined;
let doc: OpenDocument | undefined;
// Eine Trennstelle n heißt: nach Seite n trennen.
const cuts = new Set<number>();
let busy = false;
let worker: Worker | undefined;
let resultUrls: string[] = [];
let observer: IntersectionObserver | undefined;

// Wie beim Zusammenfügen startet der Worker mit der Datei, nicht erst beim Klick. Dann klappt
// das Teilen auch ohne Netz.
function splitWorker() {
  worker ??= new Worker(new URL('../lib/split.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function rangeLabel(range: PageRange) {
  return range.from === range.to ? `Seite ${range.from}` : `Seiten ${range.from}–${range.to}`;
}

function baseName() {
  return (file?.name ?? 'dokument.pdf').replace(/\.pdf$/i, '');
}

// --- Datei laden ---------------------------------------------------------------------------

async function load(next: File) {
  reset();
  file = next;
  intake.hidden = true;
  fileBar.hidden = false;
  fileName.textContent = next.name;
  fileMeta.textContent = `${formatBytes(next.size)} · wird gelesen …`;
  splitWorker();
  try {
    bytes = new Uint8Array(await next.arrayBuffer());
  } catch {
    showUnreadable();
    return;
  }
  await open(undefined);
}

async function open(attempt: string | undefined) {
  if (!bytes) return;
  const current = file;
  const outcome = await openPdf(bytes, attempt);
  // Während des Lesens eine andere Datei gewählt: Dieses Ergebnis ist überholt.
  if (current !== file) {
    if (outcome.status === 'ok') await outcome.document.close();
    return;
  }
  if (outcome.status === 'ok') {
    doc = outcome.document;
    password = attempt;
    passwordForm.hidden = true;
    message.textContent = '';
    fileMeta.textContent = `${formatPages(doc.pageCount)} · ${formatBytes(file!.size)}`;
    buildBoard();
  } else if (outcome.status === 'password') {
    passwordForm.hidden = false;
    fileMeta.textContent = formatBytes(file!.size);
    message.textContent = outcome.wrongPassword ? 'Falsches Passwort' : 'Passwortgeschützt';
    passwordForm.querySelector('input')!.focus();
  } else {
    showUnreadable();
  }
  update();
}

function showUnreadable() {
  fileMeta.textContent = file ? formatBytes(file.size) : '';
  message.textContent = 'Kann nicht geöffnet werden. Keine PDF oder beschädigt?';
}

function reset() {
  observer?.disconnect();
  doc?.close();
  doc = undefined;
  file = undefined;
  bytes = undefined;
  password = undefined;
  cuts.clear();
  clearResults();
  pages.replaceChildren();
  board.hidden = true;
  passwordForm.hidden = true;
  passwordForm.reset();
  fileBar.hidden = true;
  intake.hidden = false;
  message.textContent = '';
  update();
}

// --- Seiten zeichnen -----------------------------------------------------------------------

// Höchstens zwei Seiten gleichzeitig zeichnen. Mehr macht es nicht schneller, nur den
// Speicher voller.
const queue: number[] = [];
let rendering = 0;

function enqueue(pageNumber: number) {
  queue.push(pageNumber);
  pump();
}

function pump() {
  while (rendering < 2 && queue.length > 0) {
    const pageNumber = queue.shift()!;
    const current = doc;
    if (!current) return;
    rendering++;
    current
      .render(pageNumber, THUMB_WIDTH)
      .then((canvas) => {
        // Inzwischen eine andere Datei geladen: Die Vorschau gehört nicht mehr hierher.
        if (doc !== current) return;
        canvas.className = 'max-h-full max-w-full';
        pages.querySelector(`[data-thumb="${pageNumber}"]`)?.replaceChildren(canvas);
      })
      .catch(() => {})
      .finally(() => {
        rendering--;
        pump();
      });
  }
}

function buildBoard() {
  if (!doc) return;
  queue.length = 0;
  observer?.disconnect();
  // Erst zeichnen, wenn eine Seite in die Nähe des sichtbaren Bereichs kommt.
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer!.unobserve(entry.target);
        enqueue(Number((entry.target as HTMLElement).dataset.thumb));
      }
    },
    { rootMargin: '300px' },
  );

  const items: HTMLLIElement[] = [];
  for (let n = 1; n <= doc.pageCount; n++) {
    const item = element('li', 'flex');
    const page = element('div', 'w-[72px] shrink-0 sm:w-[84px]');
    const thumb = element(
      'div',
      'grid h-[102px] w-[72px] place-items-center overflow-hidden rounded-md border border-rule bg-sheet shadow-sm sm:h-[119px] sm:w-[84px]',
    );
    thumb.dataset.thumb = String(n);
    thumb.append(element('span', 'font-mono text-xs text-graphite', String(n)));
    const stripe = element('div', 'mt-2 h-1 rounded-full');
    stripe.dataset.stripe = String(n);
    const caption = element('p', 'mt-1.5 flex justify-between font-mono text-[10px] tracking-wide text-graphite');
    const partLabel = element('span', 'font-semibold');
    partLabel.dataset.partLabel = String(n);
    caption.append(element('span', '', String(n)), partLabel);
    page.append(thumb, stripe, caption);
    item.append(page);

    if (n < doc.pageCount) {
      const gap = element(
        'button',
        'group relative mx-0.5 flex h-[102px] w-6 shrink-0 sm:h-[119px] cursor-pointer justify-center rounded focus-visible:outline-2 focus-visible:outline-signal data-active:cursor-grab data-active:touch-none data-drop:bg-mark/10',
      );
      gap.type = 'button';
      gap.dataset.cut = String(n);
      gap.setAttribute('aria-label', `Nach Seite ${n} trennen`);
      gap.title = `Nach Seite ${n} trennen`;
      gap.append(
        element(
          'span',
          'pointer-events-none absolute inset-y-1 left-1/2 -translate-x-1/2 border-l-2 border-dashed border-transparent transition group-hover:border-signal/50 group-data-active:border-solid group-data-active:border-mark',
        ),
        element(
          'span',
          'pointer-events-none relative mt-9 grid size-6 sm:mt-11 place-items-center rounded-full border border-rule bg-sheet text-xs text-graphite opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 group-data-active:border-mark group-data-active:bg-mark group-data-active:text-sheet group-data-active:opacity-100',
          '✂',
        ),
      );
      item.append(gap);
    }
    items.push(item);
  }
  pages.replaceChildren(...items);
  for (const thumb of pages.querySelectorAll('[data-thumb]')) observer.observe(thumb);
  board.hidden = false;
}

// --- Anzeigen ------------------------------------------------------------------------------

function update() {
  const ready = doc !== undefined;
  const pageCount = doc?.pageCount ?? 0;
  const ranges = ready ? rangesFromCuts(pageCount, cuts) : [];

  count.textContent = ready ? formatPages(pageCount) : file ? '1 Datei' : 'Keine Datei';
  actions.hidden = !ready;

  for (const gap of pages.querySelectorAll<HTMLButtonElement>('[data-cut]')) {
    const active = cuts.has(Number(gap.dataset.cut));
    gap.toggleAttribute('data-active', active);
    gap.setAttribute('aria-pressed', String(active));
    gap.disabled = busy;
  }

  // Jeder Teil bekommt abwechselnd einen farbigen und einen grauen Strich unter seinen Seiten,
  // und seine erste Seite trägt den Namen des Teils.
  ranges.forEach((range, index) => {
    for (let n = range.from; n <= range.to; n++) {
      const stripe = pages.querySelector<HTMLElement>(`[data-stripe="${n}"]`);
      if (stripe) stripe.className = `mt-2 h-1 rounded-full ${index % 2 === 0 ? 'bg-signal' : 'bg-graphite/50'}`;
      const label = pages.querySelector<HTMLElement>(`[data-part-label="${n}"]`);
      if (label) {
        label.textContent = n === range.from && ranges.length > 1 ? `Teil ${index + 1}` : '';
        label.className = `font-semibold ${index % 2 === 0 ? 'text-signal' : 'text-ink'}`;
      }
    }
  });

  partList.replaceChildren(
    ...(ranges.length > 1 ? ranges : []).map((range, index) =>
      element(
        'li',
        'rounded-full border border-rule bg-sheet px-3 py-1 font-mono text-[11px] tracking-wide text-ink',
        `Teil ${index + 1} · ${rangeLabel(range)}`,
      ),
    ),
  );

  if (pageCount === 1) hint.textContent = 'Diese PDF hat nur eine Seite, da gibt es nichts zu teilen.';
  else if (cuts.size === 0) hint.textContent = 'Setz mindestens eine Marke zwischen zwei Seiten.';
  else hint.textContent = '';

  splitButton.disabled = busy || cuts.size === 0;
  clearButton.disabled = busy || cuts.size === 0;
  resetButton.disabled = busy;
  fileInput.disabled = busy;
}

function clearResults() {
  for (const url of resultUrls) URL.revokeObjectURL(url);
  resultUrls = [];
  result.hidden = true;
  downloads.replaceChildren();
  status.textContent = '';
}

function toggleCut(cut: number) {
  if (cuts.has(cut)) cuts.delete(cut);
  else cuts.add(cut);
  // Andere Marken, andere Teile: Ein fertiges Ergebnis passt nicht mehr.
  clearResults();
  update();
}

// --- Teilen --------------------------------------------------------------------------------

async function split() {
  if (!doc || !bytes || cuts.size === 0 || busy) return;
  const ranges = rangesFromCuts(doc.pageCount, cuts);
  const request: SplitRequest = { bytes, password, ranges };
  busy = true;
  clearResults();
  status.textContent = 'Teile …';
  update();

  const current = splitWorker();
  const reply = await new Promise<SplitReply>((resolve) => {
    current.onmessage = (event: MessageEvent<SplitReply>) => resolve(event.data);
    current.onerror = () => {
      current.terminate();
      worker = undefined;
      resolve({ ok: false, message: 'Beim Teilen ist etwas schiefgegangen.' });
    };
    current.postMessage(request);
  });
  busy = false;

  if (reply.ok) {
    status.textContent = '';
    resultTitle.textContent = `${reply.parts.length} Teile fertig${password ? ' · ohne Passwort' : ''}`;
    downloads.replaceChildren(
      ...reply.parts.map((part, index) => {
        const blob = new Blob([part as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        resultUrls.push(url);
        const name = `${baseName()}-teil-${index + 1}.pdf`;
        const row = element('li', 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-sheet px-3 py-2');
        const text = element('div', 'min-w-0');
        text.append(
          element('p', 'truncate text-sm font-medium text-ink', name),
          element('p', 'font-mono text-[11px] tracking-wide text-graphite', `${rangeLabel(ranges[index])} · ${formatBytes(blob.size)}`),
        );
        const link = element(
          'a',
          'inline-flex items-center rounded-md bg-signal px-2.5 py-1 text-xs font-medium text-on-signal transition hover:bg-signal-strong',
          'Herunterladen',
        );
        link.href = url;
        link.download = name;
        row.append(text, link);
        return row;
      }),
    );
    result.hidden = false;
  } else {
    status.textContent = reply.message;
  }
  update();
}

// --- Bedienung -----------------------------------------------------------------------------

fileInput.addEventListener('change', () => {
  const next = fileInput.files?.[0];
  if (next && !busy) load(next);
  fileInput.value = '';
});

resetButton.addEventListener('click', () => {
  if (!busy) reset();
});

passwordForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const attempt = (passwordForm.elements.namedItem('password') as HTMLInputElement).value;
  if (attempt === '') return;
  message.textContent = '';
  open(attempt);
});

pages.addEventListener('click', (event) => {
  if (swallowClick) {
    swallowClick = false;
    return;
  }
  const gap = (event.target as Element).closest<HTMLButtonElement>('button[data-cut]');
  if (gap && !busy) toggleCut(Number(gap.dataset.cut));
});

clearButton.addEventListener('click', () => {
  cuts.clear();
  clearResults();
  update();
});

splitButton.addEventListener('click', () => split());

// Marken verschieben per Ziehen, mit Maus oder Finger. Bewusst über Zeigerereignisse statt
// HTML5-Drag-and-Drop: Das starten Browser bei Knöpfen teils gar nicht, und auf dem Handy gibt
// es es nicht. Erst ab ein paar Pixeln Bewegung gilt es als Ziehen, darunter bleibt es ein
// Klick, der die Marke entfernt.
let drag: { cut: number; x: number; y: number; moved: boolean } | undefined;
let swallowClick = false;

const clearDropTargets = () => {
  for (const gap of pages.querySelectorAll('[data-drop]')) gap.removeAttribute('data-drop');
};

const gapAt = (x: number, y: number) =>
  document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('#split-tool button[data-cut]') ?? undefined;

pages.addEventListener('pointerdown', (event) => {
  const gap = (event.target as Element).closest<HTMLButtonElement>('button[data-cut]');
  if (!gap || busy || !cuts.has(Number(gap.dataset.cut))) return;
  drag = { cut: Number(gap.dataset.cut), x: event.clientX, y: event.clientY, moved: false };
  gap.setPointerCapture(event.pointerId);
});

pages.addEventListener('pointermove', (event) => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
  drag.moved = true;
  clearDropTargets();
  const target = gapAt(event.clientX, event.clientY);
  if (target && !cuts.has(Number(target.dataset.cut))) target.setAttribute('data-drop', '');
});

pages.addEventListener('pointerup', (event) => {
  if (!drag) return;
  if (drag.moved) {
    // Der Klick, den der Browser nach dem Loslassen noch schickt, soll die Marke nicht entfernen.
    swallowClick = true;
    const target = Number(gapAt(event.clientX, event.clientY)?.dataset.cut);
    if (target && target !== drag.cut && !cuts.has(target)) {
      cuts.delete(drag.cut);
      cuts.add(target);
      clearResults();
      update();
    }
  }
  drag = undefined;
  clearDropTargets();
});

pages.addEventListener('pointercancel', () => {
  drag = undefined;
  clearDropTargets();
});

// Wie bei den anderen Werkzeugen: Eine PDF darf überall auf der Seite landen.
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
window.addEventListener('dragover', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dropzone.dataset.active = '';
});
window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) delete dropzone.dataset.active;
});
window.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  delete dropzone.dataset.active;
  const next = event.dataTransfer!.files[0];
  if (next && !busy) load(next);
});
