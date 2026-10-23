// Dezimale Einheiten wie im Finder: Eine Datei, die dort 3,4 MB hat, soll hier nicht
// plötzlich 3,2 MB haben.
const oneDecimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const noDecimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${noDecimal.format(Math.max(1, bytes / 1000))} KB`;
  return `${oneDecimal.format(bytes / 1_000_000)} MB`;
}

// Auf ganze Prozent gerundet zeigten 62,2 MB → 253 KB "−100 %", als wäre nichts übrig.
// Über 99 % deshalb mit einer Nachkommastelle, und nie mehr als 99,9 %.
export function formatSaving(before: number, after: number): string {
  const saved = (1 - after / before) * 100;
  if (saved >= 99) return `−${oneDecimal.format(Math.min(99.9, Math.floor(saved * 10) / 10))} %`;
  return `−${noDecimal.format(Math.max(1, Math.round(saved)))} %`;
}

export function formatPages(count: number): string {
  return count === 1 ? '1 Seite' : `${count} Seiten`;
}
