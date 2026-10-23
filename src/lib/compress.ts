export const LEVELS = {
  klein: { label: 'Klein', dpi: 72, note: 'Für E-Mail und Bildschirm. Scans können unscharf werden.' },
  mittel: { label: 'Mittel', dpi: 150, note: 'Gut lesbar und deutlich kleiner. Passt fast immer.' },
  hoch: { label: 'Hoch', dpi: 300, note: 'Gut zum Drucken. Spart dafür weniger.' },
} as const;

export type Level = keyof typeof LEVELS;

// Bewusst nicht nur die Voreinstellungen /screen, /ebook und /printer: Mit ihnen lieferte
// "klein" größere Dateien als "mittel". Ghostscript wählt pro Bild selbst zwischen JPEG und
// verlustfreier Kompression und nahm bei 72 dpi die verlustfreie, die dort mehr Platz braucht.
// Deshalb hier feste Auflösung und immer JPEG für Farb- und Graustufenbilder.
// Schwarzweißbilder (typisch: Textscans) bleiben bei mindestens 300 dpi, sonst wird Schrift
// unleserlich. Sie sind ohnehin klein.
export function ghostscriptArgs(level: Level, password?: string): string[] {
  const { dpi } = LEVELS[level];
  return [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    '-dPDFSETTINGS=/ebook',
    '-dNOPAUSE',
    '-dBATCH',
    '-dSAFER',
    '-dDownsampleColorImages=true',
    '-dDownsampleGrayImages=true',
    '-dDownsampleMonoImages=true',
    `-dColorImageResolution=${dpi}`,
    `-dGrayImageResolution=${dpi}`,
    `-dMonoImageResolution=${Math.max(dpi * 2, 300)}`,
    // Ab 1,0 wird jedes Bild über der Zielauflösung verkleinert, nicht erst ab 1,5-fach.
    '-dColorImageDownsampleThreshold=1.0',
    '-dGrayImageDownsampleThreshold=1.0',
    '-dMonoImageDownsampleThreshold=1.0',
    '-dColorImageDownsampleType=/Bicubic',
    '-dGrayImageDownsampleType=/Bicubic',
    '-dAutoFilterColorImages=false',
    '-dAutoFilterGrayImages=false',
    '-dColorImageFilter=/DCTEncode',
    '-dGrayImageFilter=/DCTEncode',
    '-dDetectDuplicateImages=true',
    ...(password ? [`-sPDFPassword=${password}`] : []),
    '-sOutputFile=/out.pdf',
    '/in.pdf',
  ];
}

export function outputName(name: string) {
  return `${name.replace(/\.pdf$/i, '')}-komprimiert.pdf`;
}
