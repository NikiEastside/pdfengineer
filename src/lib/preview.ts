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

export async function inspectPdf(
  bytes: Uint8Array,
  password: string | undefined,
  thumbnailWidth: number,
): Promise<InspectResult> {
  const { lib, worker } = await loadPdfJs();
  const assets = `/vendor/pdfjs-${lib.version}/`;

  const task = lib.getDocument({
    // pdf.js übergibt die Daten an seinen Worker und macht das Original dabei unbrauchbar.
    // Die Bytes werden später aber noch zum Zusammenfügen gebraucht.
    data: bytes.slice(),
    password,
    worker,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    cMapUrl: `${assets}cmaps/`,
    verbosity: 0,
  });

  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = (thumbnailWidth * window.devicePixelRatio) / unscaled.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return { status: 'ok', pageCount: doc.numPages, thumbnail: canvas };
  } catch (error) {
    if (error instanceof lib.PasswordException) {
      return {
        status: 'password',
        wrongPassword: error.code === lib.PasswordResponses.INCORRECT_PASSWORD,
      };
    }
    return { status: 'invalid' };
  } finally {
    // Gibt den Speicher der Datei im Worker frei. Der gemeinsame Worker selbst läuft weiter.
    await task.destroy();
  }
}
