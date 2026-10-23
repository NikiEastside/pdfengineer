// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Strato liefert Unterseiten als Ordner mit index.html aus und leitet "/seite" auf "/seite/"
  // um. Mit dem Schrägstrich in jedem Link und in der canonical-URL entfällt diese Umleitung.
  trailingSlash: 'always',
  // Pflicht fuer die Sitemap: die Eintraege darin muessen absolute URLs sein.
  site: 'https://pdfengineer.de',
  integrations: [
    sitemap({
      // Dieselben Seiten, die im Layout "noindex" tragen. Eine Sitemap, die Google Seiten
      // anbietet, die es nicht aufnehmen soll, meldet die Search Console als Fehler.
      filter: (seite) => !/\/(impressum|datenschutz|404|wartung|og-bild)\/?$/.test(seite),
    }),
  ],
  build: {
    // Die .htaccess verbietet per Content-Security-Policy jedes Inline-Skript und jeden
    // Inline-Stil. Astro wuerde kleine Stylesheets sonst direkt ins HTML schreiben, und der
    // Browser verwirft sie dann kommentarlos.
    inlineStylesheets: 'never',
  },
  vite: {
    plugins: [tailwindcss()],
    // Ghostscript ist ein ES-Modul mit import.meta.url und dynamischem import(). Im
    // Standardformat "iife" lässt Vite das nicht in einen Worker bündeln.
    worker: {
      format: 'es',
    },
    build: {
      // Aus demselben Grund: kleine Skripte und Dateien nicht als Inline- oder data:-URL
      // einbetten, sondern immer als eigene Datei ausliefern.
      assetsInlineLimit: 0,
    },
  },
});
