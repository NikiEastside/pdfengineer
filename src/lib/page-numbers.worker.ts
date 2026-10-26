// Seitenzahlen kommen im Worker auf die Seiten: pdf-lib rechnet synchron, und bei vielen Seiten
// stünde der Tab sonst still.
import { addPageNumbers } from './page-numbers';
import type { PageNumberOptions } from './page-numbers-layout';

export type PageNumbersRequest = { bytes: Uint8Array; password?: string; options: PageNumberOptions };
export type PageNumbersReply = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<PageNumbersRequest>) => {
  const { bytes, password, options } = event.data;
  try {
    const result = await addPageNumbers(bytes, password, options);
    const reply: PageNumbersReply = { ok: true, bytes: result };
    postMessage(reply, { transfer: [result.buffer as ArrayBuffer] });
  } catch {
    const reply: PageNumbersReply = { ok: false, message: 'Beim Einfügen ist etwas schiefgegangen.' };
    postMessage(reply);
  }
};
