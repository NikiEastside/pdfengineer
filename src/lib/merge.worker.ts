// Zusammenfügen läuft in einem eigenen Worker. pdf-lib rechnet synchron, und bei einem
// großen Scan stünde der Tab sonst sekundenlang still, ohne dass sich etwas anzeigen ließe.
import { mergePdfs, MergeError, type MergeSource } from './merge';

export type MergeReply = { ok: true; bytes: Uint8Array } | { ok: false; message: string };

self.onmessage = async (event: MessageEvent<MergeSource[]>) => {
  let reply: MergeReply;
  try {
    const bytes = await mergePdfs(event.data);
    reply = { ok: true, bytes };
    // Übergeben statt kopieren: Das Ergebnis kann so groß sein wie alle Eingaben zusammen.
    postMessage(reply, { transfer: [bytes.buffer as ArrayBuffer] });
    return;
  } catch (error) {
    reply = {
      ok: false,
      message: error instanceof MergeError ? error.message : 'Beim Zusammenfügen ist etwas schiefgegangen.',
    };
  }
  postMessage(reply);
};
