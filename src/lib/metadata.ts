import { PDFDocument, PDFHexString, PDFName } from '@cantoo/pdf-lib';
import { TEXT_FIELDS, type Metadata, type TextField } from './metadata-fields';

// Gelesen werden die Metadaten über pdf.js (src/lib/preview.ts), geschrieben hier mit pdf-lib.
// Getrennt aus gutem Grund: pdf-lib liefert bei verschlüsselten PDFs, auch solchen, die nur
// gegen Drucken gesperrt sind, leere Metadaten. pdf.js liest sie korrekt.
export async function writeMetadata(bytes: Uint8Array, password: string | undefined, metadata: Metadata): Promise<Uint8Array> {
  // updateMetadata: false, sonst trägt pdf-lib sich selbst als Erzeuger ein und setzt das
  // Änderungsdatum auf jetzt. Hier sollen genau die Werte stehen, die der Nutzer will.
  const doc = await PDFDocument.load(bytes, { password: password ?? '', updateMetadata: false });

  // Der Info-Bereich wird neu aufgebaut, nicht nachgebessert. Bei verschlüsselten Vorlagen stünden
  // darin sonst Reste, die nach dem Entschlüsseln nur noch Zeichensalat sind. Und Zusatzeinträge,
  // die Programme gern hinterlassen ("Company", "SourceModified"), verschwinden gleich mit. Die
  // Oberfläche zeigt sie vorher an.
  const info = doc.context.obj({});
  doc.context.trailerInfo.Info = doc.context.register(info);

  for (const [field, { key }] of Object.entries(TEXT_FIELDS) as [TextField, { key: string }][]) {
    const value = metadata[field].trim();
    // Direkt als Text setzen statt über setKeywords & Co.: setKeywords verbindet eine Liste mit
    // Leerzeichen und würde aus "Vertrag, befristet" etwas anderes machen, als dasteht.
    if (value) info.set(PDFName.of(key), PDFHexString.fromText(value));
  }
  if (metadata.created) doc.setCreationDate(new Date(metadata.created));
  if (metadata.modified) doc.setModificationDate(new Date(metadata.modified));

  // Das XMP-Paket fliegt raus. Es enthält meist dieselben Angaben noch einmal, und Programme wie
  // Acrobat zeigen es bevorzugt an. Bliebe es, sähe man dort weiter den alten Autor, auch nach
  // "Alle entfernen". Nachteil: Eine PDF/A-Kennzeichnung steckt ebenfalls darin und geht mit.
  doc.catalog.delete(PDFName.of('Metadata'));
  return doc.save();
}
