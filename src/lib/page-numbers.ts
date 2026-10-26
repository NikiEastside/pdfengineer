import { degrees, PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import { FONT_SIZE, pageLabel, placeLabel, type PageNumberOptions } from './page-numbers-layout';
import { visualFrame } from './pdf-stamp';

export async function addPageNumbers(bytes: Uint8Array, password: string | undefined, options: PageNumberOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password: password ?? '' });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const label = pageLabel(index + 1, pages.length, options);
    if (!label) return;
    // Nach der Seite, wie man sie sieht, nicht nach ihrer gespeicherten Lage. Sonst stünde die
    // Zahl auf quer angezeigten Seiten am Rand und hochkant.
    const frame = visualFrame(page);
    const spot = placeLabel(frame.width, frame.height, font.widthOfTextAtSize(label, FONT_SIZE), options.position);
    const point = frame.toPage(spot.x, spot.y, 0);
    page.drawText(label, {
      x: point.x,
      y: point.y,
      size: FONT_SIZE,
      font,
      // Dunkelgrau statt Schwarz: lesbar, aber zurückhaltender als der eigentliche Text.
      color: rgb(0.25, 0.27, 0.3),
      rotate: degrees(point.angle),
    });
  });
  return doc.save();
}
