// Erzeugt die Testdateien für beide Werkzeuge nach testdateien/ (nicht versioniert).
// Erzeugt statt kopiert, weil das Repo öffentlich ist und echte Dokumente nie hineingehören.
//
//   npm run testdateien
import { PDFDocument, PDFHexString, PDFName, StandardFonts, rgb } from '@cantoo/pdf-lib';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const dir = 'testdateien';
mkdirSync(dir, { recursive: true });

async function colored(file, label, pages, color, encryption) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(...color) });
    page.drawText(label, { x: 60, y: 480, font, size: 64, color: rgb(1, 1, 1) });
    page.drawText(`Seite ${i} von ${pages}`, { x: 60, y: 400, font, size: 32, color: rgb(1, 1, 1) });
  }
  if (encryption) doc.encrypt({ ...encryption, permissions: { printing: 'lowResolution' } });
  writeFileSync(`${dir}/${file}`, await doc.save());
}

// PNG von Hand, damit es ohne Bildbibliothek geht: Farbverlauf mit Rauschen, das sich wie ein
// Foto schlecht verlustfrei packen lässt. Genau so etwas soll das Komprimieren verkleinern.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function noisyPng(width, height, seed) {
  const row = width * 3 + 1;
  const raw = Buffer.alloc(row * height);
  let s = seed;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const noise = (s >> 16) % 40;
      const i = y * row + 1 + x * 3;
      raw[i] = Math.min(255, (x / width) * 200 + noise);
      raw[i + 1] = Math.min(255, (y / height) * 180 + noise);
      raw[i + 2] = Math.min(255, 120 + Math.sin((x + y) / 60) * 60 + noise);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function images(file) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 3; p++) {
    const image = await doc.embedPng(noisyPng(2400, 3200, p + 1));
    const page = doc.addPage([595, 842]);
    page.drawImage(image, { x: 40, y: 200, width: 515, height: 600 });
    page.drawText(`Testseite ${p + 1}: markierbarer Text bleibt erhalten`, { x: 40, y: 150, font, size: 14 });
  }
  writeFileSync(`${dir}/${file}`, await doc.save());
}

await colored('1-blau.pdf', 'Blau', 2, [0.12, 0.37, 0.82]);
await colored('2-gruen-gesperrt.pdf', 'Grün', 1, [0.1, 0.55, 0.3], { userPassword: '', ownerPassword: 'besitzer' });
await colored('3-rot-passwort-geheim.pdf', 'Rot', 3, [0.75, 0.2, 0.2], { userPassword: 'geheim', ownerPassword: 'besitzer' });
writeFileSync(`${dir}/4-keine-pdf.pdf`, 'Das ist nur Text.');
await images('5-bilder-gross.pdf');
// Zum Teilen: zehn Seiten in wechselnden Farben, jede mit ihrer Nummer, damit sich die Teile
// am Ergebnis eindeutig prüfen lassen.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const colors = [[0.12, 0.37, 0.82], [0.1, 0.55, 0.3], [0.75, 0.2, 0.2], [0.45, 0.3, 0.7], [0.85, 0.5, 0.1]];
  for (let i = 1; i <= 10; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(...colors[(i - 1) % colors.length]) });
    page.drawText(`Seite ${i}`, { x: 60, y: 420, font, size: 96, color: rgb(1, 1, 1) });
  }
  writeFileSync(`${dir}/6-zehn-seiten.pdf`, await doc.save());
}
// Für die Metadaten: alle Felder gefüllt und dazu ein XMP-Paket, wie es Word oder Acrobat
// schreiben. Das Werkzeug muss beides los werden.
{
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595, 842]).drawText('Dokument mit Metadaten', { x: 60, y: 760, font, size: 24 });
  doc.setTitle('Arbeitsvertrag 2026');
  doc.setAuthor('Max Mustermann');
  doc.setSubject('Befristung');
  doc.setKeywords(['Vertrag,', 'befristet']);
  doc.setCreator('Microsoft Word');
  doc.setProducer('macOS Quartz PDFContext');
  doc.setCreationDate(new Date('2026-03-12T09:14:00'));
  doc.setModificationDate(new Date('2026-10-20T16:02:00'));
  // Wie Word ihn hinterlässt. Steht in keinem Standardfeld und soll trotzdem sichtbar werden.
  doc.getInfoDict().set(PDFName.of('Company'), PDFHexString.fromText('Muster GmbH'));
  const xmp = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Max Mustermann</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
  const stream = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  writeFileSync(`${dir}/7-mit-metadaten.pdf`, await doc.save());
}
console.log(`Testdateien in ${dir}/ erzeugt.`);
