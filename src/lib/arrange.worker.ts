// Sortieren läuft wie die anderen Werkzeuge in einem eigenen Worker: pdf-lib rechnet synchron,
// und bei einem großen Scan stünde der Tab sonst still.
import { arrangePdf, type ArrangedPage } from './arrange';

export type ArrangeRequest = { bytes: Uint8Array; password?: string; pages: ArrangedPage[] };
export type ArrangeReply = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<ArrangeRequest>) => {
  const { bytes, password, pages } = event.data;
  try {
    const result = await arrangePdf(bytes, password, pages);
    const reply: ArrangeReply = { ok: true, bytes: result };
    postMessage(reply, { transfer: [result.buffer as ArrayBuffer] });
  } catch {
    const reply: ArrangeReply = { ok: false, message: 'Beim Speichern ist etwas schiefgegangen.' };
    postMessage(reply);
  }
};
