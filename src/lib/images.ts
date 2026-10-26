import { PDFDocument } from '@cantoo/pdf-lib';
import type { PreparedImage } from './image-prepare';

export type Layout = 'a4' | 'image';
// Nur für A4: automatisch je Bild, oder für alle Seiten fest.
export type Orientation = 'auto' | 'portrait' | 'landscape';

const A4 = { short: 595.28, long: 841.89 };
// 10 mm in PDF-Punkten (1 Punkt = 1/72 Zoll)
const MARGIN = 28.35;
// Bildschirmpixel zu Punkten bei 96 dpi. So groß erscheint ein Bild auch im Browser.
const POINTS_PER_PIXEL = 0.75;

export async function imagesToPdf(images: PreparedImage[], layout: Layout, orientation: Orientation = 'auto'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const image of images) {
    const embedded = image.kind === 'jpg' ? await doc.embedJpg(image.bytes) : await doc.embedPng(image.bytes);
    const naturalWidth = image.width * POINTS_PER_PIXEL;
    const naturalHeight = image.height * POINTS_PER_PIXEL;

    if (layout === 'image') {
      doc.addPage([naturalWidth, naturalHeight]).drawImage(embedded, { x: 0, y: 0, width: naturalWidth, height: naturalHeight });
      continue;
    }

    // Automatisch: Querbilder auf eine Querseite. Sonst so, wie es gewählt wurde. Ein Querbild
    // auf einer Hochformatseite wird dann eben kleiner eingepasst.
    const landscape = orientation === 'auto' ? image.width > image.height : orientation === 'landscape';
    const pageWidth = landscape ? A4.long : A4.short;
    const pageHeight = landscape ? A4.short : A4.long;
    // Einpassen, aber nie größer als das Bild bei 96 dpi. Ein kleines Symbol würde sonst auf
    // Seitenbreite aufgeblasen und unscharf.
    const scale = Math.min((pageWidth - 2 * MARGIN) / naturalWidth, (pageHeight - 2 * MARGIN) / naturalHeight, 1);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    doc.addPage([pageWidth, pageHeight]).drawImage(embedded, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
    });
  }
  doc.setProducer('pdfengineer.de');
  doc.setCreator('pdfengineer.de');
  return doc.save();
}
