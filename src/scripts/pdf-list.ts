// Dateiliste, die Zusammenfügen und Komprimieren teilen: Dateien aufnehmen (Auswahl oder
// Ziehen, auch neben das Feld), mit pdf.js prüfen und eine Vorschau zeichnen, nach dem
// Passwort fragen, entfernen und auf Wunsch sortieren. Was ein Werkzeug darüber hinaus
// anzeigt, etwa Fortschritt und Ergebnis beim Komprimieren, hängt es über `decorate` an.
import { formatBytes, formatPages } from '../lib/format';
import { inspectPdf } from '../lib/preview';

export type PdfEntry = {
  id: number;
  file: File;
  bytes?: Uint8Array;
  state: 'loading' | 'ready' | 'password' | 'invalid';
  pageCount?: number;
  thumbnail?: HTMLCanvasElement;
  password?: string;
  wrongPassword?: boolean;
  // Nur geänderte Einträge werden neu gezeichnet. Würde die Liste bei jeder Änderung komplett
  // neu aufgebaut, verlöre ein Passwortfeld mitten im Tippen den Fokus, sobald eine andere
  // Datei fertig gelesen ist.
  dirty: boolean;
};

type Options = {
  root: HTMLElement;
  sortable: boolean;
  isBusy: () => boolean;
  // Läuft nach jeder Änderung. orderChanged heißt: Dateien kamen hinzu, gingen weg oder
  // wurden umsortiert. Ein fertiges Ergebnis passt dann nicht mehr zur Auswahl.
  onChange: (orderChanged: boolean) => void;
  onFirstFile?: () => void;
  decorate?: (entry: PdfEntry, body: HTMLElement) => void;
};

const THUMBNAIL_WIDTH = 48;

const ICONS = {
  up: 'M10 15V5m0 0-4 4m4-4 4 4',
  down: 'M10 5v10m0 0-4-4m4 4 4-4',
  remove: 'M6 6l8 8M14 6l-8 8',
};

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  // Immer textContent, nie innerHTML: Dateinamen kommen vom Nutzer und dürfen kein HTML sein.
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(action: string, label: string, path: string, disabled = false) {
  const button = element(
    'button',
    'grid size-8 shrink-0 place-items-center rounded-md text-graphite transition hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-signal disabled:pointer-events-none disabled:opacity-25',
  );
  button.type = 'button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = disabled;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'size-4');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  button.append(svg);
  return button;
}

export class PdfList {
  entries: PdfEntry[] = [];
  private nextId = 1;
  private nodes = new Map<number, HTMLLIElement>();
  private draggedId: number | undefined;
  private readonly list: HTMLOListElement;
  private readonly dropzone: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
    this.list = options.root.querySelector<HTMLOListElement>('[data-list]')!;
    this.dropzone = options.root.querySelector<HTMLElement>('[data-dropzone]')!;
    const fileInput = options.root.querySelector<HTMLInputElement>('[data-file-input]')!;
    this.fileInput = fileInput;

    fileInput.addEventListener('change', () => {
      this.add(fileInput.files ?? []);
      // Sonst löst dieselbe Datei ein zweites Mal kein "change" mehr aus.
      fileInput.value = '';
    });
    this.list.addEventListener('click', (event) => this.onClick(event));
    this.list.addEventListener('submit', (event) => this.onPassword(event));
    if (options.sortable) this.enableSorting();
    this.acceptDropsAnywhere();
  }

  // Gemeinsame Gründe, warum ein Werkzeug noch nicht loslegen kann.
  blocker(): string | undefined {
    if (this.entries.some((entry) => entry.state === 'loading')) return 'Dateien werden noch gelesen …';
    if (this.entries.some((entry) => entry.state === 'password')) return 'Bei einer Datei fehlt noch das Passwort.';
    if (this.entries.some((entry) => entry.state === 'invalid')) return 'Entferne die Dateien, die sich nicht öffnen lassen.';
    return undefined;
  }

  // Auswahlfeld sperren, solange ein Werkzeug arbeitet. Ziehen wird in add() abgefangen.
  setBusy(busy: boolean) {
    this.fileInput.disabled = busy;
    this.dropzone.classList.toggle('pointer-events-none', busy);
    this.dropzone.classList.toggle('opacity-50', busy);
  }

  clear() {
    this.entries = [];
    this.changed(true);
  }

  // Für Werkzeuge, die an einem Eintrag etwas ändern, das `decorate` anzeigt.
  touch(entry: PdfEntry) {
    entry.dirty = true;
    this.changed(false);
  }

  async add(files: Iterable<File>) {
    // Während des Zusammenfügens oder Komprimierens passte das Ergebnis sonst nicht mehr zur
    // Liste, die man sieht.
    if (this.options.isBusy()) return;
    const added: PdfEntry[] = [];
    for (const file of files) {
      const entry: PdfEntry = { id: this.nextId++, file, state: 'loading', dirty: true };
      this.entries.push(entry);
      added.push(entry);
    }
    if (added.length === 0) return;
    this.options.onFirstFile?.();
    this.changed(true);

    // Nacheinander statt gleichzeitig: Zehn große Scans auf einmal würden den Speicher eines
    // Handys sprengen, und die Vorschauen erscheinen so trotzdem eine nach der anderen.
    for (const entry of added) await this.inspect(entry);
  }

  private async inspect(entry: PdfEntry, password?: string) {
    try {
      entry.bytes ??= new Uint8Array(await entry.file.arrayBuffer());
    } catch {
      entry.state = 'invalid';
      this.touch(entry);
      return;
    }
    const outcome = await inspectPdf(entry.bytes, password, THUMBNAIL_WIDTH);
    // Während des Lesens entfernt: Dann gibt es nichts mehr zu aktualisieren.
    if (!this.entries.includes(entry)) return;

    if (outcome.status === 'ok') {
      entry.state = 'ready';
      entry.pageCount = outcome.pageCount;
      entry.thumbnail = outcome.thumbnail;
      entry.password = password;
    } else if (outcome.status === 'password') {
      entry.state = 'password';
      entry.wrongPassword = outcome.wrongPassword;
    } else {
      entry.state = 'invalid';
    }
    this.touch(entry);
  }

  private changed(orderChanged: boolean) {
    this.render(orderChanged);
    this.options.onChange(orderChanged);
  }

  private render(orderChanged: boolean) {
    for (const [id, node] of this.nodes) {
      if (!this.entries.some((entry) => entry.id === id)) {
        node.remove();
        this.nodes.delete(id);
      }
    }
    // Ändert sich die Reihenfolge, ändern sich bei vielen Einträgen die gesperrten Pfeile.
    this.entries.forEach((entry, index) => {
      if (!entry.dirty && !orderChanged && this.nodes.has(entry.id)) return;
      const fresh = this.buildItem(entry, index);
      this.nodes.get(entry.id)?.replaceWith(fresh);
      this.nodes.set(entry.id, fresh);
      entry.dirty = false;
    });
    const wanted = this.entries.map((entry) => this.nodes.get(entry.id)!);
    const children = this.list.children;
    if (wanted.length !== children.length || wanted.some((node, i) => children[i] !== node)) {
      this.list.replaceChildren(...wanted);
    }
  }

  private buildItem(entry: PdfEntry, index: number): HTMLLIElement {
    const { sortable } = this.options;
    const item = element(
      'li',
      'group flex items-center gap-3 rounded-xl border border-rule bg-sheet p-2 pr-1.5 transition-shadow hover:border-rule-strong',
    );
    item.dataset.id = String(entry.id);
    // Ziehen zum Sortieren gibt es nur mit der Maus. Auf dem Handy kann HTML5-Drag-and-Drop
    // das nicht, dort bleiben die Pfeile. Die helfen auch mit der Tastatur.
    item.draggable = sortable;

    if (sortable) {
      // Die Nummer ist die Position im Ergebnis, nicht die Reihenfolge des Hinzufügens.
      const position = element(
        'span',
        'w-7 shrink-0 cursor-grab text-center font-mono text-xs text-graphite select-none active:cursor-grabbing',
        String(index + 1).padStart(2, '0'),
      );
      position.setAttribute('aria-hidden', 'true');
      item.append(position);
    }

    const thumb = element('div', 'grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-md border border-rule bg-sunken');
    if (entry.thumbnail) {
      entry.thumbnail.className = 'h-full w-full object-cover object-top';
      thumb.append(entry.thumbnail);
    } else if (entry.state === 'loading') {
      thumb.append(element('span', 'size-4 animate-spin rounded-full border-2 border-rule-strong border-t-signal'));
    } else {
      thumb.append(element('span', 'font-mono text-[9px] tracking-wider text-graphite', 'PDF'));
    }

    const body = element('div', 'min-w-0 flex-1');
    body.append(element('p', 'truncate text-sm font-medium text-ink', entry.file.name));

    const size = formatBytes(entry.file.size);
    const meta = 'mt-0.5 font-mono text-[11px] tracking-wide';
    if (entry.state === 'loading') {
      body.append(element('p', `${meta} text-graphite`, `${size} · wird gelesen …`));
    } else if (entry.state === 'ready') {
      body.append(element('p', `${meta} text-graphite`, `${formatPages(entry.pageCount!)} · ${size}`));
      this.options.decorate?.(entry, body);
    } else if (entry.state === 'invalid') {
      body.append(element('p', `${meta} text-danger`, 'Kann nicht geöffnet werden. Keine PDF oder beschädigt?'));
    } else {
      body.append(element('p', `${meta} text-danger`, entry.wrongPassword ? 'Falsches Passwort' : 'Passwortgeschützt'));
      body.append(this.passwordForm(entry));
    }

    item.append(thumb, body);
    if (sortable) {
      item.append(
        iconButton('up', 'Nach oben', ICONS.up, index === 0),
        iconButton('down', 'Nach unten', ICONS.down, index === this.entries.length - 1),
      );
    }
    item.append(iconButton('remove', 'Entfernen', ICONS.remove));
    return item;
  }

  private passwordForm(entry: PdfEntry) {
    const form = element('form', 'mt-2 flex max-w-xs items-center gap-2');
    form.dataset.passwordFor = String(entry.id);
    const input = element(
      'input',
      'min-w-0 flex-1 rounded-md border border-rule-strong bg-sheet px-2.5 py-1.5 text-sm text-ink placeholder:text-graphite focus:border-signal focus:outline-none',
    );
    input.type = 'password';
    input.name = 'password';
    input.autocomplete = 'off';
    input.placeholder = 'Passwort';
    input.setAttribute('aria-label', `Passwort für ${entry.file.name}`);
    const submit = element(
      'button',
      'rounded-md bg-signal px-3 py-1.5 text-xs font-medium text-on-signal transition hover:bg-signal-strong',
      'Öffnen',
    );
    submit.type = 'submit';
    form.append(input, submit);
    return form;
  }

  private move(id: number, offset: number) {
    const from = this.entries.findIndex((entry) => entry.id === id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= this.entries.length) return;
    const [entry] = this.entries.splice(from, 1);
    this.entries.splice(to, 0, entry);
    this.changed(true);
  }

  private onClick(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const item = button?.closest<HTMLLIElement>('li[data-id]');
    if (!button || !item || this.options.isBusy()) return;
    const id = Number(item.dataset.id);
    if (button.dataset.action === 'up') this.move(id, -1);
    if (button.dataset.action === 'down') this.move(id, 1);
    if (button.dataset.action === 'remove') {
      this.entries = this.entries.filter((entry) => entry.id !== id);
      this.changed(true);
    }
  }

  private onPassword(event: SubmitEvent) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const entry = this.entries.find((candidate) => candidate.id === Number(form.dataset.passwordFor));
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    if (!entry || password === '') return;
    entry.state = 'loading';
    this.touch(entry);
    this.inspect(entry, password);
  }

  // Sortieren per Ziehen. Ein Zug innerhalb der Liste trägt keine Dateien. Daran
  // unterscheidet sich das Umsortieren von neuen Dateien, die jemand aus dem Finder hereinzieht.
  private enableSorting() {
    const markers = ['shadow-[inset_0_2px_0_var(--color-signal)]', 'shadow-[inset_0_-2px_0_var(--color-signal)]'];
    const clearMarkers = () => {
      for (const node of this.nodes.values()) node.classList.remove(...markers);
    };
    const isBelow = (item: HTMLElement, event: DragEvent) => {
      const box = item.getBoundingClientRect();
      return event.clientY > box.top + box.height / 2;
    };

    this.list.addEventListener('dragstart', (event) => {
      const item = (event.target as Element).closest<HTMLLIElement>('li[data-id]');
      if (!item || this.options.isBusy()) return;
      this.draggedId = Number(item.dataset.id);
      event.dataTransfer!.effectAllowed = 'move';
      event.dataTransfer!.setData('text/plain', item.dataset.id!);
      item.classList.add('opacity-50');
    });

    this.list.addEventListener('dragover', (event) => {
      if (this.draggedId === undefined) return;
      const item = (event.target as Element).closest<HTMLLIElement>('li[data-id]');
      if (!item) return;
      event.preventDefault();
      clearMarkers();
      item.classList.add(isBelow(item, event) ? markers[1] : markers[0]);
    });

    this.list.addEventListener('drop', (event) => {
      if (this.draggedId === undefined) return;
      event.preventDefault();
      const item = (event.target as Element).closest<HTMLLIElement>('li[data-id]');
      const targetId = Number(item?.dataset.id);
      if (item && targetId !== this.draggedId) {
        const below = isBelow(item, event);
        const [entry] = this.entries.splice(this.entries.findIndex((e) => e.id === this.draggedId), 1);
        const targetIndex = this.entries.findIndex((e) => e.id === targetId);
        this.entries.splice(below ? targetIndex + 1 : targetIndex, 0, entry);
        this.changed(true);
      }
    });

    this.list.addEventListener('dragend', () => {
      this.draggedId = undefined;
      clearMarkers();
      for (const node of this.nodes.values()) node.classList.remove('opacity-50');
    });
  }

  // Dateien dürfen überall auf der Seite landen. Verfehlt man das Feld, würde der Browser die
  // PDF sonst selbst öffnen, und die bisherige Auswahl wäre weg.
  private acceptDropsAnywhere() {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    window.addEventListener('dragover', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      this.dropzone.dataset.active = '';
    });
    window.addEventListener('dragleave', (event) => {
      // relatedTarget ist nur dann leer, wenn der Zeiger das Fenster ganz verlässt.
      if (event.relatedTarget === null) delete this.dropzone.dataset.active;
    });
    window.addEventListener('drop', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      delete this.dropzone.dataset.active;
      if (!this.options.isBusy()) this.add(event.dataTransfer!.files);
    });
  }
}
