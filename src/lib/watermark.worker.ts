// Das Wasserzeichen kommt im Worker auf die Seiten: pdf-lib rechnet synchron, und bei vielen
// Seiten stünde der Tab sonst still.
import { addWatermark, UnsupportedCharacter } from './watermark';
import type { WatermarkOptions } from './watermark-layout';

export type WatermarkRequest = { bytes: Uint8Array; password?: string; options: WatermarkOptions };
export type WatermarkReply = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<WatermarkRequest>) => {
  const { bytes, password, options } = event.data;
  try {
    const result = await addWatermark(bytes, password, options);
    const reply: WatermarkReply = { ok: true, bytes: result };
    postMessage(reply, { transfer: [result.buffer as ArrayBuffer] });
  } catch (error) {
    const reply: WatermarkReply = {
      ok: false,
      message:
        error instanceof UnsupportedCharacter
          ? `Das Zeichen „${error.character}“ kann das Wasserzeichen nicht darstellen. Erlaubt sind westeuropäische Buchstaben, Ziffern und gängige Satzzeichen.`
          : 'Beim Einfügen ist etwas schiefgegangen.',
    };
    postMessage(reply);
  }
};
