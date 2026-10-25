import type { PDFWorker } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type PdfJs = typeof import('pdfjs-dist');

export type InspectResult =
  | { status: 'ok'; pageCount: number; thumbnail: HTMLCanvasElement }
  | { status: 'password'; wrongPassword: boolean }
  | { status: 'invalid' };

// pdf.js ist rund ein halbes Megabyte groß und wird erst gebraucht, wenn die erste Datei
// kommt. Wer die Seite nur öffnet und wieder geht, lädt es nie.
let pdfjsReady: Promise<{ lib: PdfJs; worker: PDFWorker }> | undefined;

function loadPdfJs() {
  pdfjsReady ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    // Ein gemeinsamer Worker für alle Dateien. Ohne ihn startet pdf.js für jede Datei einen
    // eigenen und parst dafür jedes Mal sein Worker-Skript neu.
    return { lib, worker: new lib.PDFWorker() };
  });
  return pdfjsReady;
}

// Gemeinsame Einstellungen für jedes Dokument, das pdf.js öffnet.
function documentOptions(lib: PdfJs, worker: PDFWorker, bytes: Uint8Array, password: string | undefined) {
  const assets = `/vendor/pdfjs-${lib.version}/`;
  return {
    // pdf.js übergibt die Daten an seinen Worker und macht das Original dabei unbrauchbar.
    // Die Bytes werden später aber noch zum Zusammenfügen oder Teilen gebraucht.
    data: bytes.slice(),
    password,
    worker,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    cMapUrl: `${assets}cmaps/`,
    verbosity: 0,
  };
}

async function renderPage(doc: import('pdfjs-dist').PDFDocumentProxy, pageNumber: number, width: number) {
  const page = await doc.getPage(pageNumber);
  const unscaled = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (width * window.devicePixelRatio) / unscaled.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

function failure(lib: PdfJs, error: unknown): Exclude<InspectResult, { status: 'ok' }> {
  if (error instanceof lib.PasswordException) {
    return { status: 'password', wrongPassword: error.code === lib.PasswordResponses.INCORRECT_PASSWORD };
  }
  return { status: 'invalid' };
}

export async function inspectPdf(
  bytes: Uint8Array,
  password: string | undefined,
  thumbnailWidth: number,
): Promise<InspectResult> {
  const { lib, worker } = await loadPdfJs();
  const task = lib.getDocument(documentOptions(lib, worker, bytes, password));
  try {
    const doc = await task.promise;
    return { status: 'ok', pageCount: doc.numPages, thumbnail: await renderPage(doc, 1, thumbnailWidth) };
  } catch (error) {
    return failure(lib, error);
  } finally {
    // Gibt den Speicher der Datei im Worker frei. Der gemeinsame Worker selbst läuft weiter.
    await task.destroy();
  }
}

export type OpenDocument = {
  pageCount: number;
  render: (pageNumber: number, width: number) => Promise<HTMLCanvasElement>;
  close: () => Promise<void>;
};

// Für das Teilen: Das Dokument bleibt offen, und Seiten werden erst gezeichnet, wenn sie ins
// Bild kommen. Bei 300 Seiten alle Vorschauen auf einmal zu zeichnen, hielte den Browser
// minutenlang auf und kostete viel Speicher.
export async function openPdf(
  bytes: Uint8Array,
  password: string | undefined,
): Promise<{ status: 'ok'; document: OpenDocument } | Exclude<InspectResult, { status: 'ok' }>> {
  const { lib, worker } = await loadPdfJs();
  const task = lib.getDocument(documentOptions(lib, worker, bytes, password));
  try {
    const doc = await task.promise;
    return {
      status: 'ok',
      document: {
        pageCount: doc.numPages,
        render: (pageNumber, width) => renderPage(doc, pageNumber, width),
        close: () => task.destroy(),
      },
    };
  } catch (error) {
    await task.destroy();
    return failure(lib, error);
  }
}
