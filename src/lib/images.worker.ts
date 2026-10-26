// Das PDF aus den vorbereiteten Bildern entsteht im Worker: pdf-lib rechnet synchron, und bei
// vielen großen Fotos stünde der Tab sonst still.
import type { PreparedImage } from './image-prepare';
import { imagesToPdf, type Layout, type Orientation } from './images';

export type ImagesRequest = { images: PreparedImage[]; layout: Layout; orientation: Orientation };
export type ImagesReply = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<ImagesRequest>) => {
  try {
    const bytes = await imagesToPdf(event.data.images, event.data.layout, event.data.orientation);
    const reply: ImagesReply = { ok: true, bytes };
    postMessage(reply, { transfer: [bytes.buffer as ArrayBuffer] });
  } catch {
    const reply: ImagesReply = { ok: false, message: 'Beim Umwandeln ist etwas schiefgegangen.' };
    postMessage(reply);
  }
};
