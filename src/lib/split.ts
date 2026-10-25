import { PDFDocument } from '@cantoo/pdf-lib';

// Ein Teil als Seitenbereich, beide Grenzen eingeschlossen und ab 1 gezählt, so wie Menschen
// Seiten zählen: { from: 1, to: 3 } sind die Seiten 1, 2 und 3.
export type PageRange = { from: number; to: number };

// Aus den Trennstellen werden die Teile. Eine Trennstelle n heißt: nach Seite n trennen.
// Unsinnige Werte (0, letzte Seite, doppelt) fallen still heraus, statt leere Teile zu erzeugen.
export function rangesFromCuts(pageCount: number, cuts: Iterable<number>): PageRange[] {
  const sorted = [...new Set(cuts)].filter((cut) => cut >= 1 && cut < pageCount).sort((a, b) => a - b);
  const ranges: PageRange[] = [];
  let from = 1;
  for (const cut of sorted) {
    ranges.push({ from, to: cut });
    from = cut + 1;
  }
  ranges.push({ from, to: pageCount });
  return ranges;
}

export async function splitPdf(bytes: Uint8Array, password: string | undefined, ranges: PageRange[]): Promise<Uint8Array[]> {
  // Leeres Passwort ausdrücklich, wie beim Zusammenfügen: Sonst lehnt pdf-lib PDFs ab, die nur
  // gegen Drucken oder Kopieren gesperrt sind.
  const source = await PDFDocument.load(bytes, { password: password ?? '' });
  const parts: Uint8Array[] = [];
  for (const range of ranges) {
    const part = await PDFDocument.create();
    const indices = Array.from({ length: range.to - range.from + 1 }, (_, i) => range.from - 1 + i);
    for (const page of await part.copyPages(source, indices)) part.addPage(page);
    part.setProducer('pdfengineer.de');
    part.setCreator('pdfengineer.de');
    parts.push(await part.save());
  }
  return parts;
}
