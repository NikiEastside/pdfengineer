import { PDFDocument } from '@cantoo/pdf-lib';

export interface MergeSource {
  name: string;
  bytes: Uint8Array;
  // Leer heißt nicht "kein Passwort": Viele PDFs sind nur mit einem Besitzerpasswort
  // gesperrt (Drucken, Kopieren) und öffnen sich mit "". pdf-lib verlangt das ausdrücklich,
  // ohne die Angabe verweigert es solche Dateien ganz.
  password?: string;
}

export class MergeError extends Error {
  readonly fileName: string;

  constructor(message: string, fileName: string) {
    super(message);
    this.name = 'MergeError';
    this.fileName = fileName;
  }
}

export async function mergePdfs(sources: MergeSource[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  for (const source of sources) {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(source.bytes, { password: source.password ?? '' });
    } catch {
      throw new MergeError(`„${source.name}“ lässt sich nicht öffnen.`, source.name);
    }
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  // Ohne Angabe übernähme pdf-lib seinen eigenen Namen als Ersteller ins Ergebnis.
  merged.setProducer('pdfengineer.de');
  merged.setCreator('pdfengineer.de');
  return merged.save();
}
