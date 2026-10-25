# PDF Engineer

PDFs zusammenfügen und komprimieren, direkt im Browser: [pdfengineer.de](https://pdfengineer.de)

Die Dateien verlassen das Gerät nicht. Gerechnet wird mit WebAssembly im Browser, und eine
Content-Security-Policy verbietet der Seite jede Verbindung zu einem fremden Server.

## Entwickeln

```sh
npm install
npm run dev          # http://localhost:4321
npx astro check      # muss 0 Fehler und 0 Warnungen zeigen
npm run build && npm run preview   # http://localhost:4322, mit denselben Headern wie live
```

`npm run dev` setzt keine Content-Security-Policy. Was gegen sie verstößt, fällt deshalb erst
in der Vorschau auf.

## Testen

```sh
npm run test:browser                          # einmalig: Chromium und WebKit laden (ca. 900 MB)
npm run test:live                             # Gesamttest gegen https://pdfengineer.de
BASE=http://localhost:4322 npm run test:live  # gegen die laufende Vorschau
```

Der Test spielt alle Werkzeuge in Chromium und WebKit (Safari) durch, auch mit Passwort,
kaputten Dateien und ohne Netz, und prüft jede Seite hell und dunkel bis 320 px Breite. Er
schlägt fehl bei Konsolenfehlern, CSP-Verstößen und jeder Verbindung zu einem fremden Server.
Die Testdateien erzeugt `npm run testdateien`, sie liegen in `testdateien/` und nie im Repo.

Das Vorschaubild für geteilte Links (`public/og-bild.png`) wird aus `src/pages/og-bild.astro`
gerendert: `npm run build && npm run og-bild`.

## Ausliefern

Gearbeitet wird auf `dev`, veröffentlicht durch Zusammenführen nach `main`. Von dort liefert
`.github/workflows/deploy.yml` per SFTP aus. Von Hand geht es mit `npm run deploy:dry` und
`npm run deploy`, dafür braucht es eine `.env.deploy` (Vorlage: `.env.deploy.example`).

## Lizenz

[GNU AGPL v3](LICENSE). Die Seite nutzt Ghostscript, das unter der AGPL steht.

Mitgelieferte Programme und ihr Quellcode:

- **Ghostscript** 10.06.0 (AGPL-3.0) als WebAssembly aus
  [`@okathira/ghostpdl-wasm`](https://github.com/okathira/ghostpdl-wasm) 1.1.0, gebaut aus
  [ArtifexSoftware/ghostpdl](https://github.com/ArtifexSoftware/ghostpdl)
- **pdf.js** (Apache-2.0) von [Mozilla](https://github.com/mozilla/pdf.js)
- **pdf-lib** (MIT) als gepflegter Fork [`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib)
