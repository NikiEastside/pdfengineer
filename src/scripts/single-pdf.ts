// Gemeinsamer Teil der Werkzeuge, die mit genau einer PDF arbeiten (Teilen, Sortieren): Datei
// aufnehmen (Auswahl oder Ziehen, auch neben das Feld), mit pdf.js öffnen, nach dem Passwort
// fragen, und die Seitenvorschauen erst zeichnen, wenn sie ins Bild kommen.
import { formatBytes, formatPages } from '../lib/format';
import { openPdf, type OpenDocument } from '../lib/preview';

type Options = {
  root: HTMLElement;
  isBusy: () => boolean;
  // Eine Datei ist geöffnet und bereit.
  onOpen: (doc: OpenDocument) => void;
  // Die Datei ist weg (andere gewählt oder „Andere Datei“). Das Werkzeug räumt seinen Stand ab.
  onReset: () => void;
  // Nach jeder Änderung, damit das Werkzeug Knöpfe und Hinweise nachzieht.
  onChange: () => void;
  // Sobald eine Datei kommt, noch bevor sie gelesen ist. Gut, um den Worker vorzuwärmen.
  onFile?: () => void;
};

export class SinglePdf {
  file: File | undefined;
  bytes: Uint8Array | undefined;
  password: string | undefined;
  doc: OpenDocument | undefined;

  private readonly options: Options;
  private readonly intake: HTMLElement;
  private readonly dropzone: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly fileBar: HTMLElement;
  private readonly fileName: HTMLElement;
  private readonly fileMeta: HTMLElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly passwordForm: HTMLFormElement;
  private readonly message: HTMLElement;

  constructor(options: Options) {
    this.options = options;
    const find = <T extends Element>(selector: string) => options.root.querySelector<T>(selector)!;
    this.intake = find('[data-intake]');
    this.dropzone = find('[data-dropzone]');
    this.fileInput = find('[data-file-input]');
    this.fileBar = find('[data-file]');
    this.fileName = find('[data-file-name]');
    this.fileMeta = find('[data-file-meta]');
    this.resetButton = find('[data-reset]');
    this.passwordForm = find('[data-password]');
    this.message = find('[data-message]');

    this.fileInput.addEventListener('change', () => {
      const next = this.fileInput.files?.[0];
      if (next && !options.isBusy()) this.load(next);
      // Sonst löst dieselbe Datei ein zweites Mal kein "change" mehr aus.
      this.fileInput.value = '';
    });
    this.resetButton.addEventListener('click', () => {
      if (!options.isBusy()) this.reset();
    });
    this.passwordForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const attempt = (this.passwordForm.elements.namedItem('password') as HTMLInputElement).value;
      if (attempt === '') return;
      this.message.textContent = '';
      this.open(attempt);
    });
    this.acceptDropsAnywhere();
  }

  get baseName() {
    return (this.file?.name ?? 'dokument.pdf').replace(/\.pdf$/i, '');
  }

  setBusy(busy: boolean) {
    this.fileInput.disabled = busy;
    this.resetButton.disabled = busy;
  }

  reset() {
    this.doc?.close();
    this.doc = undefined;
    this.file = undefined;
    this.bytes = undefined;
    this.password = undefined;
    this.passwordForm.hidden = true;
    this.passwordForm.reset();
    this.fileBar.hidden = true;
    this.intake.hidden = false;
    this.message.textContent = '';
    this.options.onReset();
    this.options.onChange();
  }

  private async load(next: File) {
    this.reset();
    this.file = next;
    this.intake.hidden = true;
    this.fileBar.hidden = false;
    this.fileName.textContent = next.name;
    this.fileMeta.textContent = `${formatBytes(next.size)} · wird gelesen …`;
    this.options.onFile?.();
    try {
      this.bytes = new Uint8Array(await next.arrayBuffer());
    } catch {
      this.showUnreadable();
      return;
    }
    await this.open(undefined);
  }

  private async open(attempt: string | undefined) {
    if (!this.bytes) return;
    const current = this.file;
    const outcome = await openPdf(this.bytes, attempt);
    // Während des Lesens eine andere Datei gewählt: Dieses Ergebnis ist überholt.
    if (current !== this.file) {
      if (outcome.status === 'ok') await outcome.document.close();
      return;
    }
    if (outcome.status === 'ok') {
      this.doc = outcome.document;
      this.password = attempt;
      this.passwordForm.hidden = true;
      this.message.textContent = '';
      this.fileMeta.textContent = `${formatPages(this.doc.pageCount)} · ${formatBytes(this.file!.size)}`;
      this.options.onOpen(this.doc);
    } else if (outcome.status === 'password') {
      this.passwordForm.hidden = false;
      this.fileMeta.textContent = formatBytes(this.file!.size);
      this.message.textContent = outcome.wrongPassword ? 'Falsches Passwort' : 'Passwortgeschützt';
      this.passwordForm.querySelector('input')!.focus();
    } else {
      this.showUnreadable();
    }
    this.options.onChange();
  }

  private showUnreadable() {
    this.fileMeta.textContent = this.file ? formatBytes(this.file.size) : '';
    this.message.textContent = 'Kann nicht geöffnet werden. Keine PDF oder beschädigt?';
    this.options.onChange();
  }

  // Eine PDF darf überall auf der Seite landen. Verfehlt man das Feld, würde der Browser sie
  // sonst selbst öffnen, und der bisherige Stand wäre weg.
  private acceptDropsAnywhere() {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    window.addEventListener('dragover', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      this.dropzone.dataset.active = '';
    });
    window.addEventListener('dragleave', (event) => {
      if (event.relatedTarget === null) delete this.dropzone.dataset.active;
    });
    window.addEventListener('drop', (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      delete this.dropzone.dataset.active;
      const next = event.dataTransfer!.files[0];
      if (next && !this.options.isBusy()) this.load(next);
    });
  }
}

// Zeichnet Seitenvorschauen erst, wenn sie in die Nähe des sichtbaren Bereichs kommen, und
// höchstens zwei gleichzeitig. Bei 300 Seiten alles auf einmal zu zeichnen, hielte den Browser
// minutenlang auf. Ziel ist jeweils das Element mit data-thumb="Seitennummer".
export class LazyThumbnails {
  private readonly container: HTMLElement;
  private readonly width: number;
  private queue: number[] = [];
  private rendering = 0;
  private doc: OpenDocument | undefined;
  private observer: IntersectionObserver | undefined;

  constructor(container: HTMLElement, width: number) {
    this.container = container;
    this.width = width;
  }

  start(doc: OpenDocument) {
    this.stop();
    this.doc = doc;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.observer!.unobserve(entry.target);
          this.queue.push(Number((entry.target as HTMLElement).dataset.thumb));
          this.pump();
        }
      },
      { rootMargin: '300px' },
    );
    for (const thumb of this.container.querySelectorAll('[data-thumb]')) this.observer.observe(thumb);
  }

  stop() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.queue = [];
    this.doc = undefined;
  }

  private pump() {
    while (this.rendering < 2 && this.queue.length > 0) {
      const pageNumber = this.queue.shift()!;
      const current = this.doc;
      if (!current) return;
      this.rendering++;
      current
        .render(pageNumber, this.width)
        .then((canvas) => {
          // Inzwischen eine andere Datei geladen: Die Vorschau gehört nicht mehr hierher.
          if (this.doc !== current) return;
          canvas.className = 'max-h-full max-w-full';
          this.container.querySelector(`[data-thumb="${pageNumber}"]`)?.replaceChildren(canvas);
        })
        .catch(() => {})
        .finally(() => {
          this.rendering--;
          this.pump();
        });
    }
  }
}
