import { degrees, PDFDocument, rgb, StandardFonts } from '@cantoo/pdf-lib';
import { unsupportedCharacter, visualFrame } from './pdf-stamp';
import { COLORS, placeWatermark, type WatermarkOptions } from './watermark-layout';

export class UnsupportedCharacter extends Error {
  readonly character: string;

  constructor(character: string) {
    super(`Zeichen nicht darstellbar: ${character}`);
    this.character = character;
  }
}

export async function addWatermark(bytes: Uint8Array, password: string | undefined, options: WatermarkOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password: password ?? '' });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = options.text.trim();

  // Die Standardschrift kennt nur westeuropäische Zeichen. Alles andere ersetzt pdf-lib still
  // durch "?", aus "Łódź" würde "?ód?". Deshalb vorher selbst prüfen und das Zeichen nennen.
  const unsupported = unsupportedCharacter(font, text);
  if (unsupported) throw new UnsupportedCharacter(unsupported);

  const widthAt1 = font.widthOfTextAtSize(text, 1);
  const [r, g, b] = COLORS[options.color].rgb;
  for (const page of doc.getPages()) {
    const frame = visualFrame(page);
    for (const placement of placeWatermark(frame.width, frame.height, widthAt1, options)) {
      const point = frame.toPage(placement.x, placement.y, placement.angle);
      page.drawText(text, {
        x: point.x,
        y: point.y,
        size: placement.fontSize,
        font,
        color: rgb(r, g, b),
        opacity: options.opacity,
        rotate: degrees(point.angle),
      });
    }
  }
  return doc.save();
}
