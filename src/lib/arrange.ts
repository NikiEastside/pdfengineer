import { degrees, PDFDocument } from '@cantoo/pdf-lib';

// Eine Seite im Ergebnis: welche Seite der Vorlage (ab 1 gezählt) und um wie viel Grad sie
// zusätzlich gedreht wird. Entfernte Seiten tauchen einfach nicht auf.
export type ArrangedPage = { source: number; rotation: number };

export async function arrangePdf(bytes: Uint8Array, password: string | undefined, pages: ArrangedPage[]): Promise<Uint8Array> {
  // Leeres Passwort ausdrücklich, wie bei den anderen Werkzeugen: Sonst lehnt pdf-lib PDFs ab,
  // die nur gegen Drucken oder Kopieren gesperrt sind.
  const source = await PDFDocument.load(bytes, { password: password ?? '' });
  const result = await PDFDocument.create();
  const copied = await result.copyPages(
    source,
    pages.map((page) => page.source - 1),
  );
  copied.forEach((page, index) => {
    // Zur vorhandenen Drehung addieren: Eine Seite, die in der Vorlage schon quer steht, soll
    // nach einem Klick auf "drehen" nicht wieder hochkant stehen.
    const rotation = (page.getRotation().angle + pages[index].rotation) % 360;
    page.setRotation(degrees(rotation));
    result.addPage(page);
  });
  result.setProducer('pdfengineer.de');
  result.setCreator('pdfengineer.de');
  return result.save();
}
