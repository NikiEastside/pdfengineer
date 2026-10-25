// Felder der Metadaten, getrennt von metadata.ts, damit die Oberfläche sie nutzen kann, ohne
// pdf-lib mitzuladen. Das braucht nur der Worker beim Speichern.

export const TEXT_FIELDS = {
  title: { key: 'Title', label: 'Titel' },
  author: { key: 'Author', label: 'Autor' },
  subject: { key: 'Subject', label: 'Thema' },
  keywords: { key: 'Keywords', label: 'Stichwörter' },
  creator: { key: 'Creator', label: 'Erstellt mit' },
  producer: { key: 'Producer', label: 'Erzeugt von' },
} as const;

export const DATE_FIELDS = {
  created: { key: 'CreationDate', label: 'Erstellt am' },
  modified: { key: 'ModDate', label: 'Geändert am' },
} as const;

export type TextField = keyof typeof TEXT_FIELDS;
export type DateField = keyof typeof DATE_FIELDS;
// Leerer Text heißt: Feld nicht vorhanden. Daten im Format von <input type="datetime-local">,
// also "2026-03-12T09:14" in Ortszeit.
export type Metadata = Record<TextField | DateField, string>;

export const EMPTY: Metadata = { title: '', author: '', subject: '', keywords: '', creator: '', producer: '', created: '', modified: '' };

export function toLocalInput(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
