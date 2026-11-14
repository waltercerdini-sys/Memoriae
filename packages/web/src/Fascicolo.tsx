import { useState } from 'react';
import type { Fornitore, Persona } from './api';
import { NOME_RUOLO } from './Persone';
import { statoVoce } from './prontezza';
import { apriPerStampa, esc } from './stampa';
import { documentiDi, type Voce } from './vault';

const VOLONTA: Record<string, string> = {
  cancellare: 'Chiudere e cancellare',
  conservare: 'Conservare come ricordo',
  trasmettere: 'Consegnare ai destinatari',
};
const TIPO: Record<string, string> = {
  account: 'Account',
  documento: 'Documento',
  istruzione: 'Istruzione',
  dispositivo: 'Dispositivo',
  crypto: 'Criptovalute',
  cartella: 'Cartella',
  lettera: 'Lettera',
};
const giorno = (s: string | Date) => new Date(s).toLocaleDateString('it-CH', { day: 'numeric', month: 'long', year: 'numeric' });

/** Il fascicolo per il notaio: cosa c'è, a chi va e cosa fare, senza password né contenuti riservati. */
export function htmlFascicolo(d: { proprietario: string; voci: Voce[]; persone: Persona[]; fornitori: Fornitore[]; conNote: boolean }): string {
  const nomi = (ids: string[]) => ids.map((id) => d.persone.find((p) => p.id === id)?.nome).filter(Boolean).join(', ') || '—';
  const account = d.voci.filter((v) => v.tipo === 'account');
  const altre = d.voci.filter((v) => v.tipo !== 'account' && v.tipo !== 'lettera');
  const lettere = d.voci.filter((v) => v.tipo === 'lettera');
  const abbonamenti = Math.round(d.voci.reduce((s, v) => s + (v.contenuto.abbonamento?.chfMese ?? 0), 0) * 12);
  const nota = (v: Voce) => (d.conNote && v.contenuto.note ? `<br><span class="nota">${esc(v.contenuto.note)}</span>` : '');
  const fornitore = (v: Voce) => d.fornitori.find((f) => f.slug === v.contenuto.fornitore);
  const eredita = (v: Voce) => {
    const f = fornitore(v);
    if (!f || f.daVivi.length === 0) return '—';
    const contatti = v.contenuto.erede?.contatti ?? [];
    if (contatti.length) return `Impostata: ${esc(contatti.join(', '))}`;
    return v.contenuto.impostatoDaVivo ? 'Impostata' : 'Non ancora impostata';
  };
  const incomplete = d.voci.filter((v) => !statoVoce(v, d.fornitori).completa).length;

  return `
<h1>Eredità digitale di ${esc(d.proprietario)}</h1>
<p>Fascicolo per il notaio, preparato con MEMORIAE il ${giorno(new Date())}.</p>
<div class="riquadro">
<p><strong>Cos'è questo fascicolo.</strong> L'elenco dei profili digitali, dei documenti e delle volontà registrati da ${esc(d.proprietario)} in MEMORIAE. Non contiene password né il contenuto delle voci, che restano cifrati.</p>
<p><strong>Cosa non è.</strong> Non è un testamento e non lo sostituisce: per disposizioni giuridicamente vincolanti valgono le forme previste dalla legge (testamento olografo, interamente scritto a mano, datato e firmato, o testamento pubblico).</p>
<p><strong>Come si apre la cassaforte.</strong> In caso di decesso una persona di fiducia chiede l'apertura; un operatore MEMORIAE verifica la richiesta con i documenti; dopo 14 giorni d'attesa ognuno riceve solo ciò che gli è stato assegnato.</p>
</div>

<h2>Persone indicate</h2>
<table><tr><th>Nome</th><th>Ruolo</th><th>E-mail</th><th>Invito</th></tr>
${d.persone
  .map(
    (p) =>
      `<tr><td>${esc(p.nome)}</td><td>${p.soloLettere ? 'Riceve solo lettere' : NOME_RUOLO[p.ruolo]}</td><td>${esc(p.email ?? '—')}</td><td>${p.statoInvito === 'accettato' ? 'Ha accettato' : 'Non ancora'}</td></tr>`,
  )
  .join('')}
</table>

${account.length ? `<h2>Account e servizi (${account.length})</h2>
<table><tr><th>Account</th><th>Volontà</th><th>A chi va</th><th>Funzione d'eredità del servizio</th></tr>
${account
  .map(
    (v) =>
      `<tr><td><strong>${esc(v.contenuto.titolo)}</strong>${fornitore(v) ? `<br><span class="nota">${esc(fornitore(v)!.nome)}</span>` : ''}${v.contenuto.abbonamento ? `<br><span class="nota">Abbonamento: CHF ${v.contenuto.abbonamento.chfMese.toFixed(2)} al mese</span>` : ''}${nota(v)}</td><td>${v.contenuto.azione ? VOLONTA[v.contenuto.azione] : 'Non indicata'}</td><td>${esc(nomi(v.contenuto.destinatari ?? []))}</td><td>${eredita(v)}</td></tr>`,
  )
  .join('')}
</table>` : ''}
${abbonamenti > 0 ? `<p>Abbonamenti in elenco: circa <strong>CHF ${abbonamenti.toLocaleString('de-CH')} all'anno</strong>, da disdire.</p>` : ''}

${
  altre.length
    ? `<h2>Documenti, istruzioni e altri beni (${altre.length})</h2>
<table><tr><th>Voce</th><th>Tipo</th><th>A chi va</th><th>Allegati</th></tr>
${altre
  .map(
    (v) =>
      `<tr><td><strong>${esc(v.contenuto.titolo)}</strong>${v.emergenza ? '<br><span class="nota">Serve anche in caso di emergenza</span>' : ''}${nota(v)}</td><td>${TIPO[v.tipo] ?? v.tipo}</td><td>${esc(nomi(v.contenuto.destinatari ?? []))}</td><td>${documentiDi(v.id, v.contenuto).length || '—'}</td></tr>`,
  )
  .join('')}
</table>`
    : ''
}

${
  lettere.length
    ? `<h2>Lettere per il futuro (${lettere.length})</h2>
<p class="nota">Il testo delle lettere resta chiuso e cifrato: qui solo a chi vanno e quando si aprono.</p>
<table><tr><th>Per</th><th>Si apre</th></tr>
${lettere
  .map((v) => `<tr><td>${esc(nomi(v.remota.lettera?.destinatari ?? []))}</td><td>${v.remota.lettera?.consegnaIl ? giorno(v.remota.lettera.consegnaIl) : 'Con l\'apertura della cassaforte'}</td></tr>`)
  .join('')}
</table>`
    : ''
}

<h2>Proposta di clausola per il testamento</h2>
<div class="riquadro">
<p>«Per i miei account, i miei dati e i miei beni digitali valgono le volontà che ho registrato nel servizio MEMORIAE e che risulteranno alla data della mia morte. Chiedo ai miei eredi e all'esecutore testamentario di rispettarle e di collaborare con le persone di fiducia che vi ho indicato.»</p>
<p class="nota">Testo indicativo, da far valutare al notaio prima di inserirlo nel testamento.</p>
</div>
${incomplete ? `<p class="nota">Al momento della stampa ${incomplete === 1 ? '1 voce era' : `${incomplete} voci erano`} ancora da completare in MEMORIAE.</p>` : ''}
<p class="nota">Le volontà possono cambiare dopo questa stampa: fa fede quanto registrato in MEMORIAE.</p>
`;
}

export function Fascicolo(p: { proprietario: string; voci: Voce[]; persone: Persona[]; fornitori: Fornitore[]; onIndietro: () => void }) {
  const [conNote, setConNote] = useState(false);
  return (
    <section className="passo">
      <button className="link indietro" onClick={p.onIndietro}>
        ‹ Torna all'elenco
      </button>
      <p className="etichetta">Da allegare al testamento</p>
      <h1>Fascicolo per il notaio</h1>
      <p>
        Un documento ordinato con i tuoi account, i documenti, le persone e le tue volontà, <strong>senza password</strong>. Il notaio lo può
        conservare con il testamento e i tuoi cari sanno da dove partire.
      </p>
      <div className="riquadro">
        <p>
          Una nota in un'app non sostituisce un testamento. Il fascicolo collega MEMORIAE al tuo testamento e contiene una proposta di clausola
          da far valutare al notaio.
        </p>
      </div>
      <label className="spunta">
        <input type="checkbox" checked={conNote} onChange={(e) => setConNote(e.target.checked)} />
        <span>
          Includi le note delle voci
          <br />
          <span className="tenue">Di solito no: le note possono contenere informazioni riservate, che è meglio lasciare cifrate in MEMORIAE.</span>
        </span>
      </label>
      <button
        className="primario"
        disabled={p.voci.length === 0}
        onClick={() => apriPerStampa(`Fascicolo eredità digitale – ${p.proprietario}`, htmlFascicolo({ ...p, conNote }))}
      >
        Prepara il fascicolo (PDF)
      </button>
      {p.voci.length === 0 && <p className="tenue">Aggiungi prima qualche voce alla cassaforte.</p>}
      <p className="tenue">Si apre una pagina pronta da stampare: scegli «Salva come PDF» per avere il file.</p>
    </section>
  );
}
