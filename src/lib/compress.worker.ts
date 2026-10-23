// Ghostscript im eigenen Worker: Es rechnet synchron, bei großen Scans mehrere Sekunden, und
// der Tab bliebe so lange stehen.
import loadGhostscript from '@okathira/ghostpdl-wasm';
import wasmUrl from '@okathira/ghostpdl-wasm/gs.wasm?url';
import { ghostscriptArgs, type Level } from './compress';

export type CompressRequest = { id: number; bytes: Uint8Array; password?: string; level: Level };
export type CompressReply =
  | { id: number; type: 'progress'; page: number; pages: number }
  | { id: number; type: 'done'; bytes: Uint8Array }
  | { id: number; type: 'error'; message: string };

// Übersetzt wird die WASM-Datei nur einmal, gleich beim Start des Workers. Jeder Auftrag
// braucht zwar eine frische Ghostscript-Instanz, weil sich callMain nicht zweimal aufrufen
// lässt. Aber 15 MB Code jedes Mal neu zu übersetzen, würde jedes Mal Sekunden kosten.
const compiled = WebAssembly.compileStreaming(fetch(wasmUrl));
// Ohne diesen Fang meldete der Browser einen Ladefehler als unbehandelt, noch bevor der
// erste Auftrag ihn abholen und sauber zurückmelden kann.
compiled.catch(() => {});

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const { id, bytes, password, level } = event.data;
  const reply = (message: CompressReply, transfer: Transferable[] = []) => postMessage(message, { transfer });

  try {
    const module = await compiled;
    let pages = 0;
    let lastPage = 0;
    const gs = await loadGhostscript({
      instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance) => void) {
        WebAssembly.instantiate(module, imports).then(receive);
        return {};
      },
      // Ghostscript meldet "Processing pages 1 through 12." und dann "Page 1", "Page 2" …
      // Daraus entsteht die Fortschrittsanzeige.
      print(line: string) {
        const total = line.match(/^Processing pages \d+ through (\d+)/);
        if (total) pages = Number(total[1]);
        const page = line.match(/^Page (\d+)$/);
        if (page && pages > 0) {
          lastPage = Number(page[1]);
          reply({ id, type: 'progress', page: lastPage, pages });
        }
      },
      printErr() {},
    });

    gs.FS.writeFile('/in.pdf', bytes);
    const code = gs.callMain(ghostscriptArgs(level, password));
    // Der Rückgabewert allein reicht nicht. Bei einem falschen Passwort meldet Ghostscript 0
    // und schreibt eine leere PDF, die dann verdächtig klein aussähe. Gültig ist ein Ergebnis
    // nur, wenn jede Seite durchgelaufen ist.
    if (code !== 0 || pages === 0 || lastPage !== pages) throw new Error('Ghostscript unvollständig');
    const output = gs.FS.readFile('/out.pdf');
    reply({ id, type: 'done', bytes: output }, [output.buffer as ArrayBuffer]);
  } catch {
    reply({ id, type: 'error', message: 'Das hat bei dieser Datei leider nicht geklappt.' });
  }
};
