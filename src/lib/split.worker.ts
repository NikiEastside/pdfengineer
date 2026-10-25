// Teilen läuft wie Zusammenfügen in einem eigenen Worker: pdf-lib rechnet synchron, und bei
// einem großen Scan stünde der Tab sonst still.
import { splitPdf, type PageRange } from './split';

export type SplitRequest = { bytes: Uint8Array; password?: string; ranges: PageRange[] };
export type SplitReply = { ok: true; parts: Uint8Array[] } | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<SplitRequest>) => {
  const { bytes, password, ranges } = event.data;
  try {
    const parts = await splitPdf(bytes, password, ranges);
    const reply: SplitReply = { ok: true, parts };
    postMessage(reply, { transfer: parts.map((part) => part.buffer as ArrayBuffer) });
  } catch {
    const reply: SplitReply = { ok: false, message: 'Beim Teilen ist etwas schiefgegangen.' };
    postMessage(reply);
  }
};
