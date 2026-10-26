// Gemeinsames für Werkzeuge, die etwas auf jede Seite schreiben (Wasserzeichen, Seitenzahlen).
import type { PDFPage } from '@cantoo/pdf-lib';

// Umrechnung von der Seite, wie man sie sieht, in die Koordinaten, in denen pdf-lib zeichnet.
// Eine Seite mit /Rotate 90 wird im Uhrzeigersinn gedreht angezeigt. Ohne diese Umrechnung
// stünde das Wasserzeichen auf solchen Seiten quer, und dort liegen oft gerade Scans.
export function visualFrame(page: PDFPage) {
  const box = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  return {
    width: turned ? box.height : box.width,
    height: turned ? box.width : box.height,
    toPage(vx: number, vy: number, angle: number) {
      const [x, y] =
        rotation === 90 ? [box.width - vy, vx] : rotation === 180 ? [box.width - vx, box.height - vy] : rotation === 270 ? [vy, box.height - vx] : [vx, vy];
      return { x: box.x + x, y: box.y + y, angle: angle + rotation };
    },
  };
}

// Das erste Zeichen, das die Schrift nicht kennt. Erkennbar daran, dass es kodiert genauso
// aussieht wie ein Fragezeichen, ohne eines zu sein.
export function unsupportedCharacter(font: { encodeText: (text: string) => { toString(): string } }, text: string) {
  const questionMark = font.encodeText('?').toString();
  return [...text].find((char) => char !== '?' && font.encodeText(char).toString() === questionMark);
}
