// Speichern der Metadaten im eigenen Worker: pdf-lib muss die ganze Datei einlesen und neu
// schreiben, und bei einem großen Scan stünde der Tab sonst still.
import type { Metadata } from './metadata-fields';
import { writeMetadata } from './metadata';

export type MetadataRequest = { bytes: Uint8Array; password?: string; metadata: Metadata };
export type MetadataReply = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<MetadataRequest>) => {
  const { bytes, password, metadata } = event.data;
  try {
    const result = await writeMetadata(bytes, password, metadata);
    const reply: MetadataReply = { ok: true, bytes: result };
    postMessage(reply, { transfer: [result.buffer as ArrayBuffer] });
  } catch {
    const reply: MetadataReply = { ok: false, message: 'Beim Speichern ist etwas schiefgegangen.' };
    postMessage(reply);
  }
};
