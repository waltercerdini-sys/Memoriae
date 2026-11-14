import type { Fornitore, Persona } from './api';
import { documentoChiave, funzioneErede } from './contattoErede';
import type { Voce } from './vault';

/**
 * Quanto è pronta l'eredità digitale, da 0 a 100: un numero solo, come la batteria del telefono.
 * Si calcola nel browser, perché il contenuto delle voci è cifrato.
 *
 * Una sola regola decide se una voce è completa: la stessa per la spunta nell'elenco,
 * il filtro «Da completare» e la percentuale.
 */
export interface StatoVoce {
  completa: boolean;
  /** Cosa manca, in poche parole («a chi va», «chiave del contatto erede»…). */
  manca: string[];
}

export type AzioneAvviso = 'persone' | 'controllo';
export interface Avviso {
  testo: string;
  pulsante: string;
  azione: AzioneAvviso;
}

export interface Prontezza {
  percento: number;
  /** Voci ancora da completare. */
  daCompletare: number;
  /** Le poche cose che non riguardano le voci, da mostrare solo quando servono. */
  avvisi: Avviso[];
  abbonamentiAnno: number;
}

export function statoVoce(v: Voce, fornitori: Fornitore[]): StatoVoce {
  const manca: string[] = [];
  const destinatari = v.tipo === 'lettera' ? (v.remota.lettera?.destinatari ?? v.contenuto.destinatari ?? []) : (v.contenuto.destinatari ?? []);
  if (v.tipo === 'lettera') {
    if (destinatari.length === 0) manca.push('per chi è');
    return { completa: manca.length === 0, manca };
  }
  if (v.tipo === 'account') {
    if (!v.contenuto.azione) manca.push('cosa fare dell\'account');
    if (destinatari.length === 0) manca.push(v.contenuto.azione ? 'chi se ne occupa' : 'a chi va');
  } else if (destinatari.length === 0) {
    manca.push('a chi va');
  }
  const f = fornitori.find((x) => x.slug === v.contenuto.fornitore);
  if (f && f.daVivi.length > 0) {
    const fz = funzioneErede(v);
    const contatti = v.contenuto.erede?.contatti ?? [];
    if (!v.contenuto.impostatoDaVivo && contatti.length === 0) manca.push('funzione d\'eredità da impostare');
    else if (fz && contatti.length === 0) manca.push(`chi è il ${fz.singolare}`);
    else if (fz?.chiave && !documentoChiave(v)) manca.push(`${fz.chiave.nome} del ${fz.singolare}`);
  }
  return { completa: manca.length === 0, manca };
}

export function calcolaProntezza(voci: Voce[], persone: Persona[], fornitori: Fornitore[], controlloAttivo: boolean): Prontezza {
  const fiducia = persone.filter((p) => p.ruolo !== 'destinatario' && p.statoInvito === 'accettato').length;
  const complete = voci.filter((v) => statoVoce(v, fornitori).completa).length;

  let punti = 0;
  if (fiducia > 0) punti += 25;
  if (controlloAttivo) punti += 10;
  if (voci.length > 0) punti += 65 * (complete / voci.length);

  const avvisi: Avviso[] = [];
  // La cassaforte vuota ha già il suo invito a cominciare («Trova tutto»), nell'elenco.
  if (fiducia === 0) {
    avvisi.push({
      testo: persone.some((p) => p.ruolo !== 'destinatario')
        ? 'Nessuna persona di fiducia ha ancora accettato l\'invito: finché non accetta, nessuno potrà ricevere le tue voci.'
        : 'Non hai ancora una persona di fiducia: senza, nessuno potrà ricevere le tue voci.',
      pulsante: 'Vai alle persone',
      azione: 'persone',
    });
  }
  if (!controlloAttivo) avvisi.push({ testo: 'Il controllo «sono qui» è spento.', pulsante: 'Riattiva', azione: 'controllo' });

  const abbonamentiAnno = Math.round(voci.reduce((s, v) => s + (v.contenuto.abbonamento?.chfMese ?? 0), 0) * 12);
  return { percento: Math.round(punti), daCompletare: voci.length - complete, avvisi, abbonamentiAnno };
}
