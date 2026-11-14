/**
 * Documenti da stampare o salvare in PDF (lettere di richiesta, fascicolo per il notaio).
 * Si aprono in una nuova finestra con il comando di stampa: da lì «Salva come PDF» o la stampante.
 * Tutto resta nel browser: niente passa dal server.
 */

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STILE = `
  @page { size: A4; margin: 22mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.5; color: #1b1b1b; margin: 0; padding: 24px; }
  .barra { font-family: Arial, sans-serif; background: #e9eee8; padding: 12px 16px; margin: -24px -24px 24px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .barra button { font: 700 16px Arial, sans-serif; padding: 10px 18px; border-radius: 10px; border: 0; background: #2f6b57; color: #fff; cursor: pointer; }
  .barra span { font-size: 15px; color: #23362f; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  h2 { font-size: 13pt; margin: 18pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 2pt; }
  h3 { font-size: 12pt; margin: 12pt 0 2pt; }
  p { margin: 0 0 8pt; }
  .mittente { margin-bottom: 18pt; }
  .destinatario { margin: 0 0 18pt 55%; min-height: 70pt; }
  .riga { display: inline-block; min-width: 55mm; border-bottom: 1px solid #555; }
  .oggetto { font-weight: bold; margin: 18pt 0 12pt; }
  .firma { margin-top: 28pt; display: flex; gap: 20mm; }
  .firma div { flex: 1; border-top: 1px solid #555; padding-top: 3pt; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th, td { text-align: left; vertical-align: top; border-bottom: 1px solid #ccc; padding: 4pt 6pt 4pt 0; }
  th { font-size: 9.5pt; text-transform: uppercase; letter-spacing: .5px; color: #444; }
  .nota { font-size: 10pt; color: #444; }
  .riquadro { border: 1px solid #999; padding: 8pt 10pt; margin: 10pt 0; }
  @media print { .barra { display: none; } body { padding: 0; } }
`;

/** Apre il documento pronto da stampare. Se il browser blocca la finestra, lo scarica come file. */
export function apriPerStampa(titolo: string, corpoHtml: string): void {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titolo)}</title><style>${STILE}</style></head><body>
<div class="barra"><button onclick="window.print()">Stampa o salva come PDF</button><span>Nella finestra di stampa scegli «Salva come PDF» per avere il file.</span></div>
${corpoHtml}
</body></html>`;
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${titolo.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'documento'}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface DatiLettera {
  /** A chi va (nome dell'ente); l'indirizzo lo completa chi scrive. */
  destinatario: string;
  oggetto: string;
  defunto: string;
  mittente: string;
  /** Paragrafi del testo, dopo l'annuncio del decesso. */
  richiesta: string[];
  /** Riferimento del cliente, se lo conosciamo (per esempio l'indirizzo e-mail dell'account). */
  riferimento?: string;
  allegati: string[];
}

/** Una lettera formale, con gli spazi da completare a mano (indirizzi, date, firma). */
export function htmlLettera(d: DatiLettera): string {
  const r = (s: string) => `<p>${esc(s)}</p>`;
  return `
<div class="mittente">${esc(d.mittente)}<br><span class="riga">&nbsp;</span> (indirizzo)<br><span class="riga">&nbsp;</span> (telefono o e-mail)</div>
<div class="destinatario">${esc(d.destinatario)}<br><span class="riga">&nbsp;</span><br><span class="riga">&nbsp;</span></div>
<p>Luogo e data: <span class="riga">&nbsp;</span></p>
<p class="oggetto">Oggetto: ${esc(d.oggetto)}</p>
<p>Gentili signore e signori,</p>
<p>vi comunico il decesso di <strong>${esc(d.defunto)}</strong>, avvenuto il <span class="riga">&nbsp;</span>.</p>
<p>Riferimento del cliente (numero, conto o indirizzo e-mail): ${d.riferimento ? `<strong>${esc(d.riferimento)}</strong>` : '<span class="riga">&nbsp;</span>'}</p>
${d.richiesta.map(r).join('\n')}
<p>Vi chiedo una conferma scritta all'indirizzo indicato sopra. Resto a disposizione per ogni domanda.</p>
<p>Distinti saluti</p>
<div class="firma"><div>${esc(d.mittente)}</div><div>Firma</div></div>
<h3>Allegati</h3>
<ul>${d.allegati.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
`;
}

export const ALLEGATI_DI_BASE = [
  'Copia del certificato di morte (atto di morte)',
  'Certificato ereditario, oppure procura degli eredi',
  'Copia di un mio documento d\'identità',
];
