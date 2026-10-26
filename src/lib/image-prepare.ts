// Bereitet Bilder im Browser für das PDF vor. Hier und nicht im Worker, weil nur das
// <img>-Element alle Formate öffnet, die der Browser kennt (HEIC etwa nur Safari), und dabei
// die Drehung aus den EXIF-Daten von Handyfotos gleich mit anwendet.

export type PreparedImage = { kind: 'jpg' | 'png'; bytes: Uint8Array; width: number; height: number };

export type ImageInfo =
  | { ok: true; width: number; height: number; thumbnail: HTMLImageElement }
  | { ok: false; problem: string };

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      // Das Bild bleibt nach dem Freigeben sichtbar, es ist bereits dekodiert.
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('nicht lesbar'));
    };
    image.src = url;
  });
}

export async function inspectImage(file: File): Promise<ImageInfo> {
  try {
    const image = await load(file);
    return { ok: true, width: image.naturalWidth, height: image.naturalHeight, thumbnail: image };
  } catch {
    if (/\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type)) {
      return { ok: false, problem: 'HEIC kann nur Safari öffnen. Am iPhone geht es direkt, sonst vorher als JPG sichern.' };
    }
    return { ok: false, problem: 'Kann nicht geöffnet werden. Kein Bild oder ein Format, das dein Browser nicht kennt.' };
  }
}

// EXIF-Ausrichtung aus einem JPEG lesen. 1 heißt: steht schon richtig. Andere Werte heißen,
// das Bild liegt gedreht oder gespiegelt in der Datei, und Betrachter drehen es erst beim
// Anzeigen. Ein PDF tut das nicht, dort stünde das Foto auf der Seite.
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 1;
    const marker = view.getUint8(offset + 1);
    const length = view.getUint16(offset + 2);
    // APP1 mit "Exif\0\0"
    if (marker === 0xe1 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
      return 1;
    }
    // Start of Scan: Danach kommen keine Metadaten mehr.
    if (marker === 0xda) return 1;
    offset += 2 + length;
  }
  return 1;
}

function kindOf(bytes: Uint8Array): 'jpg' | 'png' | 'other' {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  return 'other';
}

// Stichprobe statt jedes Pixels: Ob ein Bild Transparenz hat, zeigt sich auch an jedem
// sechzehnten Bildpunkt, und bei 12-Megapixel-Fotos spart das viel Zeit.
function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number) {
  const data = context.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4 * 16) if (data[i] < 255) return true;
  return false;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = kindOf(bytes);
  const image = await load(file);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  // JPG und PNG gehen unverändert ins PDF, ohne Qualitätsverlust. Ausnahme: JPGs mit
  // EXIF-Drehung. Die werden über die Leinwand neu gespeichert, denn das <img> hat die Drehung
  // dabei schon angewendet.
  if (kind === 'png' || (kind === 'jpg' && jpegOrientation(bytes) === 1)) return { kind, bytes, width, height };

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  // Mit Transparenz als PNG, sonst als JPG. Fotos als PNG wären ein Vielfaches größer.
  const transparent = kind !== 'jpg' && hasTransparency(context, width, height);
  const type = transparent ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Umwandlung fehlgeschlagen'))), type, 0.92),
  );
  return { kind: transparent ? 'png' : 'jpg', bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}
