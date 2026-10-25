import type { ArrangeReply, ArrangeRequest } from '../lib/arrange.worker';
import { formatBytes, formatPages } from '../lib/format';
import type { OpenDocument } from '../lib/preview';
import { element } from './pdf-list';
import { LazyThumbnails, SinglePdf } from './single-pdf';

// Eine Kachel: welche Seite der Vorlage (ab 1) und um wie viel Grad zusätzlich gedreht.
type Tile = { source: number; rotation: number };

const THUMB_WIDTH = 100;

// Feste Klassen je Drehung, damit Tailwind sie im Quelltext findet. Bei 90° und 270° wird
// verkleinert, sonst ragt die quergestellte Seite aus ihrer Kachel.
const TURN: Record<number, string> = {
  0: '',
  90: 'rotate-90 scale-[0.7]',
  180: 'rotate-180',
  270: '-rotate-90 scale-[0.7]',
};

const root = document.querySelector<HTMLElement>('#sort-tool')!;
const find = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;

const count = find<HTMLElement>('[data-count]');
const board = find<HTMLElement>('[data-board]');
const pages = find<HTMLOListElement>('[data-pages]');
const actions = find<HTMLElement>('[data-actions]');
const summary = find<HTMLElement>('[data-summary]');
const hint = find<HTMLElement>('[data-hint]');
const restoreButton = find<HTMLButtonElement>('[data-restore]');
const saveButton = find<HTMLButtonElement>('[data-save]');
const status = find<HTMLElement>('[data-status]');
const result = find<HTMLElement>('[data-result]');
const resultText = find<HTMLElement>('[data-result-text]');
const download = find<HTMLAnchorElement>('[data-download]');

let tiles: Tile[] = [];
let pageCount = 0;
let busy = false;
let worker: Worker | undefined;
let resultUrl: string | undefined;
const nodes = new Map<number, HTMLLIElement>();
const thumbnails = new LazyThumbnails(pages, THUMB_WIDTH);

// Wie bei den anderen Werkzeugen startet der Worker mit der Datei. Dann klappt das Speichern
// auch ohne Netz.
function arrangeWorker() {
  worker ??= new Worker(new URL('../lib/arrange.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

const pdf = new SinglePdf({
  root,
  isBusy: () => busy,
  onFile: arrangeWorker,
  onOpen: build,
  onReset: () => {
    thumbnails.stop();
    tiles = [];
    pageCount = 0;
    nodes.clear();
    clearResult();
    pages.replaceChildren();
    board.hidden = true;
  },
  onChange: () => update(),
});

function changed() {
  return tiles.length !== pageCount || tiles.some((tile, index) => tile.source !== index + 1 || tile.rotation !== 0);
}

// --- Kacheln -------------------------------------------------------------------------------

function iconButton(action: string, label: string, symbol: string) {
  const button = element(
    'button',
    'grid size-6 place-items-center rounded text-xs text-graphite transition hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-30',
    symbol,
  );
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

function build(doc: OpenDocument) {
  pageCount = doc.pageCount;
  tiles = Array.from({ length: pageCount }, (_, i) => ({ source: i + 1, rotation: 0 }));
  nodes.clear();
  for (const tile of tiles) {
    const item = element(
      'li',
      // select-none und touch-callout: Langes Drücken am Handy soll ziehen, nicht Text markieren
      // oder das Kontextmenü öffnen.
      'relative w-[88px] cursor-grab touch-manipulation rounded-lg p-1 transition select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-signal data-dragging:z-10 data-dragging:scale-105 data-dragging:cursor-grabbing data-dragging:bg-signal/10 data-dragging:shadow-lg sm:w-[100px]',
    );
    item.dataset.source = String(tile.source);
    item.tabIndex = 0;
    const position = element('span', 'absolute top-2 left-2 z-[1] rounded bg-ink/75 px-1 font-mono text-[10px] text-sheet');
    position.dataset.position = '';
    const box = element(
      'div',
      'grid h-[110px] w-full place-items-center overflow-hidden rounded-md border border-rule bg-sheet shadow-sm sm:h-[124px]',
    );
    const turn = element('div', 'grid size-full place-items-center transition-transform');
    turn.dataset.thumb = String(tile.source);
    turn.append(element('span', 'font-mono text-xs text-graphite', String(tile.source)));
    box.append(turn);
    const caption = element('div', 'mt-1.5 flex items-center justify-between');
    caption.append(
      element('span', 'pl-0.5 font-mono text-[10px] tracking-wide whitespace-nowrap text-graphite', `S. ${tile.source}`),
      (() => {
        const tools = element('span', 'flex');
        tools.append(iconButton('rotate', `Seite ${tile.source} drehen`, '↻'), iconButton('remove', `Seite ${tile.source} entfernen`, '✕'));
        return tools;
      })(),
    );
    item.append(position, box, caption);
    nodes.set(tile.source, item);
  }
  render();
  thumbnails.start(doc);
  board.hidden = false;
}

// Bringt die Kacheln im DOM in die Reihenfolge von `tiles`. Vorhandene Knoten werden nur
// verschoben, nicht neu gebaut, damit die gezeichneten Vorschauen erhalten bleiben.
function render() {
  const wanted = tiles.map((tile) => nodes.get(tile.source)!);
  wanted.forEach((node, index) => {
    if (pages.children[index] !== node) pages.insertBefore(node, pages.children[index] ?? null);
  });
  while (pages.children.length > wanted.length) pages.lastElementChild!.remove();

  tiles.forEach((tile, index) => {
    const node = nodes.get(tile.source)!;
    node.querySelector<HTMLElement>('[data-position]')!.textContent = String(index + 1).padStart(2, '0');
    node.querySelector<HTMLElement>('[data-thumb]')!.className = `grid size-full place-items-center transition-transform ${TURN[tile.rotation]}`;
    node.setAttribute(
      'aria-label',
      `Seite ${tile.source}, an Stelle ${index + 1}${tile.rotation ? `, um ${tile.rotation}° gedreht` : ''}. Pfeiltasten verschieben, R dreht, Entf entfernt.`,
    );
  });
  update();
}

function update() {
  const ready = pdf.doc !== undefined;
  count.textContent = ready ? formatPages(pageCount) : pdf.file ? '1 Datei' : 'Keine Datei';
  actions.hidden = !ready;

  const rotated = tiles.filter((tile) => tile.rotation !== 0).length;
  const removed = pageCount - tiles.length;
  const moved = tiles.some((tile, index) => tile.source !== index + 1 + countRemovedBefore(tile.source));
  const parts = [formatPages(tiles.length)];
  if (moved) parts.push('neu sortiert');
  if (rotated) parts.push(`${rotated} gedreht`);
  if (removed) parts.push(`${removed} entfernt`);
  summary.textContent = parts.join(' · ');

  if (tiles.length === 0 && ready) hint.textContent = 'Mindestens eine Seite muss bleiben.';
  else if (ready && !changed()) hint.textContent = 'Zieh eine Seite an eine neue Stelle, dreh oder entferne sie.';
  else hint.textContent = '';

  saveButton.disabled = busy || !changed() || tiles.length === 0;
  restoreButton.disabled = busy || !changed();
  for (const button of pages.querySelectorAll<HTMLButtonElement>('button[data-action]')) button.disabled = busy;
  pdf.setBusy(busy);
}

// Wie viele Seiten mit kleinerer Nummer entfernt wurden. Ohne das gälte eine Liste, aus der
// nur Seite 1 entfernt wurde, als "neu sortiert", weil jede Seite eine Stelle aufrückt.
function countRemovedBefore(source: number) {
  let missing = 0;
  for (let n = 1; n < source; n++) if (!tiles.some((tile) => tile.source === n)) missing++;
  return missing;
}

function clearResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  result.hidden = true;
  status.textContent = '';
}

// Jede Änderung macht ein fertiges Ergebnis ungültig.
function edited() {
  clearResult();
  render();
}

function move(source: number, offset: number) {
  const from = tiles.findIndex((tile) => tile.source === source);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= tiles.length) return;
  const [tile] = tiles.splice(from, 1);
  tiles.splice(to, 0, tile);
  edited();
}

function rotate(source: number) {
  const tile = tiles.find((candidate) => candidate.source === source);
  if (!tile) return;
  tile.rotation = (tile.rotation + 90) % 360;
  edited();
}

function remove(source: number) {
  tiles = tiles.filter((tile) => tile.source !== source);
  edited();
}

// --- Speichern -----------------------------------------------------------------------------

async function save() {
  if (!pdf.bytes || busy || !changed() || tiles.length === 0) return;
  const request: ArrangeRequest = { bytes: pdf.bytes, password: pdf.password, pages: tiles.map((tile) => ({ ...tile })) };
  busy = true;
  clearResult();
  status.textContent = 'Speichere …';
  update();

  const current = arrangeWorker();
  const reply = await new Promise<ArrangeReply>((resolve) => {
    current.onmessage = (event: MessageEvent<ArrangeReply>) => resolve(event.data);
    current.onerror = () => {
      current.terminate();
      worker = undefined;
      resolve({ ok: false, message: 'Beim Speichern ist etwas schiefgegangen.' });
    };
    current.postMessage(request);
  });
  busy = false;

  if (reply.ok) {
    const blob = new Blob([reply.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    resultUrl = URL.createObjectURL(blob);
    download.href = resultUrl;
    download.download = `${pdf.baseName}-sortiert.pdf`;
    resultText.textContent = `${pdf.baseName}-sortiert.pdf · ${formatPages(request.pages.length)} · ${formatBytes(blob.size)}${pdf.password ? ' · ohne Passwort' : ''}`;
    status.textContent = '';
    result.hidden = false;
  } else {
    status.textContent = reply.message;
  }
  update();
}

// --- Bedienung -----------------------------------------------------------------------------

pages.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
  const item = button?.closest<HTMLLIElement>('li[data-source]');
  if (!button || !item || busy) return;
  const source = Number(item.dataset.source);
  if (button.dataset.action === 'rotate') rotate(source);
  if (button.dataset.action === 'remove') remove(source);
});

// Tastatur: Wer nicht ziehen kann, verschiebt mit den Pfeiltasten.
pages.addEventListener('keydown', (event) => {
  const item = (event.target as Element).closest<HTMLLIElement>('li[data-source]');
  if (!item || event.target !== item || busy) return;
  const source = Number(item.dataset.source);
  const keys: Record<string, () => void> = {
    ArrowLeft: () => move(source, -1),
    ArrowUp: () => move(source, -1),
    ArrowRight: () => move(source, 1),
    ArrowDown: () => move(source, 1),
    r: () => rotate(source),
    R: () => rotate(source),
    Delete: () => remove(source),
    Backspace: () => remove(source),
  };
  const action = keys[event.key];
  if (!action) return;
  event.preventDefault();
  action();
  // Nach dem Verschieben soll der Fokus auf der Kachel bleiben, damit man weiterdrücken kann.
  if (nodes.get(source)?.isConnected) nodes.get(source)!.focus();
});

restoreButton.addEventListener('click', () => {
  tiles = Array.from({ length: pageCount }, (_, i) => ({ source: i + 1, rotation: 0 }));
  edited();
});

saveButton.addEventListener('click', () => save());

// Ziehen über Zeigerereignisse, mit Maus und Finger. Die Kachel springt beim Ziehen sofort an
// die Stelle unter dem Zeiger, so sieht man, wo sie landet. Mit der Maus beginnt das Ziehen
// nach ein paar Pixeln Bewegung. Am Handy erst nach kurzem Halten, sonst ließe sich über die
// Kacheln hinweg nicht mehr scrollen.
let drag: { source: number; x: number; y: number; active: boolean; timer?: number } | undefined;

function startDrag() {
  if (!drag) return;
  drag.active = true;
  nodes.get(drag.source)?.setAttribute('data-dragging', '');
}

function endDrag() {
  if (!drag) return;
  window.clearTimeout(drag.timer);
  nodes.get(drag.source)?.removeAttribute('data-dragging');
  drag = undefined;
}

pages.addEventListener('pointerdown', (event) => {
  const item = (event.target as Element).closest<HTMLLIElement>('li[data-source]');
  if (!item || busy || (event.target as Element).closest('button') || event.button > 0) return;
  drag = { source: Number(item.dataset.source), x: event.clientX, y: event.clientY, active: false };
  if (event.pointerType === 'touch') drag.timer = window.setTimeout(startDrag, 300);
});

window.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const distance = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
  if (!drag.active) {
    if (event.pointerType === 'touch') {
      // Vor Ablauf der Haltezeit bewegt: Das ist Scrollen, kein Ziehen.
      if (distance > 8) endDrag();
      return;
    }
    if (distance < 6) return;
    startDrag();
  }

  // Am Rand mitscrollen, damit sich Seiten auch weit nach oben oder unten tragen lassen.
  if (event.clientY < 80) window.scrollBy(0, -12);
  else if (event.clientY > window.innerHeight - 80) window.scrollBy(0, 12);

  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLLIElement>('#sort-tool li[data-source]');
  if (!target || Number(target.dataset.source) === drag.source) return;
  const from = tiles.findIndex((tile) => tile.source === drag!.source);
  const over = tiles.findIndex((tile) => tile.source === Number(target.dataset.source));
  const box = target.getBoundingClientRect();
  // Linke Hälfte der Zielkachel: davor einsortieren, rechte Hälfte: dahinter.
  const after = event.clientX > box.left + box.width / 2;
  let to = after ? over + 1 : over;
  if (from < to) to--;
  if (to === from) return;
  const [tile] = tiles.splice(from, 1);
  tiles.splice(to, 0, tile);
  edited();
});

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// Am Handy verhindert das, dass die Seite beim Ziehen mitscrollt. Nur während eines Zugs, sonst
// bliebe das Scrollen über die Kacheln hinweg gesperrt.
pages.addEventListener(
  'touchmove',
  (event) => {
    if (drag?.active) event.preventDefault();
  },
  { passive: false },
);
