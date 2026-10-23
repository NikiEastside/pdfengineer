// Kopiert die Hilfsdateien von pdf.js (WASM-Decoder, Farbprofile, Standardschriften, CMaps)
// nach public/vendor/pdfjs-<version>/. pdf.js lädt sie zur Laufzeit über eine Basis-URL nach,
// deshalb können sie nicht wie der Rest durch den Build laufen und bekommen keinen Hash im
// Namen. Die Version im Pfad übernimmt dessen Rolle: Nach einem Update ändert sich der Pfad,
// und die .htaccess darf die Dateien trotzdem ein Jahr lang cachen lassen.
import { cpSync, readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('node_modules/pdfjs-dist/package.json', 'utf8'));
const ziel = `public/vendor/pdfjs-${version}`;

// Alte Versionen mit abräumen, sonst wandern sie bei jedem Deploy mit auf den Server.
rmSync('public/vendor', { recursive: true, force: true });
for (const ordner of ['wasm', 'iccs', 'standard_fonts', 'cmaps']) {
  cpSync(`node_modules/pdfjs-dist/${ordner}`, `${ziel}/${ordner}`, { recursive: true });
}
console.log(`pdf.js-Hilfsdateien nach ${ziel} kopiert.`);
