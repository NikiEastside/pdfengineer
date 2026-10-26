// Wo ein Wasserzeichen auf einer Seite steht. Gemeinsam für die Vorschau (Leinwand) und das
// fertige PDF (pdf-lib), damit die Vorschau genau zeigt, was herauskommt. Gerechnet wird in der
// Seite, wie man sie sieht: Ursprung unten links, y nach oben, Einheit PDF-Punkte, Winkel gegen
// den Uhrzeigersinn.

export type WatermarkMode = 'diagonal' | 'tiled';

export const COLORS = {
  grau: { label: 'Grau', rgb: [0.42, 0.45, 0.5] },
  rot: { label: 'Rot', rgb: [0.78, 0.16, 0.14] },
  blau: { label: 'Blau', rgb: [0.11, 0.36, 0.84] },
} as const;
export type WatermarkColor = keyof typeof COLORS;

export type WatermarkOptions = {
  text: string;
  mode: WatermarkMode;
  color: WatermarkColor;
  opacity: number; // 0 bis 1
  size: number; // 1 bis 5, wie groß der Schriftzug wirkt
};

export type Placement = { x: number; y: number; fontSize: number; angle: number };

// Höhe der Großbuchstaben bei Helvetica, im Verhältnis zur Schriftgröße. Damit sitzt die Mitte
// des Schriftzugs wirklich in der Mitte und nicht auf seiner Grundlinie.
const CAP_HEIGHT = 0.72;

// widthAt1: Breite des Textes bei Schriftgröße 1. Die liefert pdf-lib aus den echten
// Schriftmaßen, die Vorschau misst sie auf der Leinwand.
export function placeWatermark(width: number, height: number, widthAt1: number, options: WatermarkOptions): Placement[] {
  if (widthAt1 <= 0) return [];
  const cx = width / 2;
  const cy = height / 2;

  if (options.mode === 'diagonal') {
    // Von unten links nach oben rechts, und je nach Größe 40 bis 90 % der Diagonale lang.
    const angle = (Math.atan2(height, width) * 180) / Math.PI;
    const diagonal = Math.hypot(width, height);
    const share = 0.4 + (options.size - 1) * 0.125;
    // Begrenzt, damit ein sehr kurzer Text wie "A" nicht höher wird als die Seite.
    const fontSize = Math.min((diagonal * share) / widthAt1, Math.min(width, height) * 0.4);
    return [centered(cx, cy, widthAt1 * fontSize, fontSize, angle)];
  }

  // Gekachelt: kleiner Text, schräg, in versetzten Reihen über die ganze Seite. So lässt er sich
  // kaum wegretuschieren, das ist der Sinn bei Ausweiskopien.
  const angle = 30;
  const fontSize = Math.min(width, height) * (0.025 + options.size * 0.01);
  const textWidth = widthAt1 * fontSize;
  const stepAlong = textWidth + fontSize * 3;
  const stepAcross = fontSize * 4.5;
  const reach = Math.hypot(width, height) / 2 + textWidth;
  const rad = (angle * Math.PI) / 180;
  const placements: Placement[] = [];
  let row = 0;
  for (let v = -reach; v <= reach; v += stepAcross, row++) {
    // Jede zweite Reihe um einen halben Schritt versetzt, wie ein Mauerwerk.
    const offset = row % 2 === 0 ? 0 : stepAlong / 2;
    for (let u = -reach + offset; u <= reach; u += stepAlong) {
      const x = cx + u * Math.cos(rad) - v * Math.sin(rad);
      const y = cy + u * Math.sin(rad) + v * Math.cos(rad);
      // Nur, was die Seite wenigstens berühren kann.
      if (x < -textWidth || x > width + textWidth || y < -textWidth || y > height + textWidth) continue;
      placements.push(centered(x, y, textWidth, fontSize, angle));
    }
  }
  return placements;
}

// Startpunkt eines Schriftzugs (links auf der Grundlinie), dessen Mitte bei (cx, cy) liegt.
function centered(cx: number, cy: number, textWidth: number, fontSize: number, angle: number): Placement {
  const rad = (angle * Math.PI) / 180;
  const halfWidth = textWidth / 2;
  const halfHeight = (fontSize * CAP_HEIGHT) / 2;
  return {
    x: cx - Math.cos(rad) * halfWidth + Math.sin(rad) * halfHeight,
    y: cy - Math.sin(rad) * halfWidth - Math.cos(rad) * halfHeight,
    fontSize,
    angle,
  };
}
