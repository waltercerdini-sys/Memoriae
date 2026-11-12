import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Sostituisce {{chiave}} con i dati di azienda.json; i valori ancora da completare restano evidenziati. */
function datiAzienda() {
  const dati = JSON.parse(readFileSync(resolve(import.meta.dirname, 'azienda.json'), 'utf8'));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return {
    name: 'dati-azienda',
    transformIndexHtml(html) {
      return html.replace(/\{\{(\w+)\}\}/g, (_, k) => {
        if (!(k in dati)) throw new Error(`azienda.json: manca «${k}»`);
        const v = String(dati[k]);
        return v.startsWith('[') ? `<mark class="da-completare">${esc(v)}</mark>` : esc(v);
      });
    },
  };
}

export default defineConfig({
  plugins: [datiAzienda()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        condizioni: resolve(import.meta.dirname, 'condizioni.html'),
        privacy: resolve(import.meta.dirname, 'privacy.html'),
        noteLegali: resolve(import.meta.dirname, 'note-legali.html'),
      },
    },
  },
});
