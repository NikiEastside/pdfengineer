// Text und Lage der Seitenzahlen, gemeinsam für Vorschau und PDF. Gerechnet wird in der Seite,
// wie man sie sieht: Ursprung unten links, y nach oben, Einheit PDF-Punkte.

export const POSITIONS = {
  'top-left': 'Oben links',
  'top-center': 'Oben mittig',
  'top-right': 'Oben rechts',
  'bottom-left': 'Unten links',
  'bottom-center': 'Unten mittig',
  'bottom-right': 'Unten rechts',
} as const;
export type Position = keyof typeof POSITIONS;

export const FORMATS = {
  plain: { label: '1', example: (n: number, _total: number) => `${n}` },
  page: { label: 'Seite 1', example: (n: number, _total: number) => `Seite ${n}` },
  pageOf: { label: 'Seite 1 von 10', example: (n: number, total: number) => `Seite ${n} von ${total}` },
  slash: { label: '1 / 10', example: (n: number, total: number) => `${n} / ${total}` },
} as const;
export type Format = keyof typeof FORMATS;

export type PageNumberOptions = {
  position: Position;
  format: Format;
  // Ab welcher Seite gezählt wird, etwa 2, wenn das Deckblatt keine Zahl bekommen soll.
  fromPage: number;
  // Welche Zahl die erste nummerierte Seite trägt.
  startNumber: number;
};

export const FONT_SIZE = 10;
// 10 mm vom Rand, wie bei Briefen und Berichten üblich.
const MARGIN = 28.35;
const CAP_HEIGHT = 0.72;

// Der Text für eine Seite (ab 1 gezählt), oder null, wenn sie keine Zahl bekommt. "von 10"
// meint die höchste vergebene Zahl, nicht die Zahl der Seiten in der Datei.
export function pageLabel(page: number, pageCount: number, options: PageNumberOptions): string | null {
  if (page < options.fromPage) return null;
  const number = options.startNumber + (page - options.fromPage);
  const last = options.startNumber + (pageCount - options.fromPage);
  return FORMATS[options.format].example(number, last);
}

// Startpunkt des Textes (links auf der Grundlinie).
export function placeLabel(width: number, height: number, textWidth: number, position: Position) {
  const [vertical, horizontal] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const x = horizontal === 'left' ? MARGIN : horizontal === 'right' ? width - MARGIN - textWidth : (width - textWidth) / 2;
  const y = vertical === 'bottom' ? MARGIN : height - MARGIN - FONT_SIZE * CAP_HEIGHT;
  return { x, y };
}
