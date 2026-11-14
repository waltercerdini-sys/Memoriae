import type { Fornitore, Persona } from './api';
import { IMPORTANTI, type Categoria } from './trovatutto';
import type { Voce } from './vault';

/**
 * Quanto è pronta l'eredità digitale, da 0 a 100: un numero solo, come la batteria del telefono.
 * Si calcola nel browser, perché il contenuto delle voci è cifrato.
 */
export interface Prontezza {
  percento: number;
  passi: string[];
  abbonamentiAnno: number;
}

export function voceImportante(v: Voce): boolean {
  if (v.tipo !== 'account') return true; // documenti, istruzioni, crypto, dispositivi, ricordi
  const c = v.contenuto.categoria as Categoria | undefined;
  return !c || IMPORTANTI.includes(c) || !!v.contenuto.fornitore;
}

export function calcolaProntezza(voci: Voce[], persone: Persona[], fornitori: Fornitore[], controlloAttivo: boolean): Prontezza {
  const fiducia = persone.filter((p) => p.ruolo !== 'destinatario' && p.statoInvito === 'accettato').length;
  const importanti = voci.filter(voceImportante);
  const conVolonta = importanti.filter((v) => (v.contenuto.destinatari?.length ?? 0) > 0 || !!v.contenuto.azione);
  const daImpostare = voci.filter((v) => (fornitori.find((f) => f.slug === v.contenuto.fornitore)?.daVivi.length ?? 0) > 0);
  const impostati = daImpostare.filter((v) => v.contenuto.impostatoDaVivo);

  let punti = 0;
  if (fiducia > 0) punti += 25;
  if (controlloAttivo) punti += 10;
  if (importanti.length > 0) punti += 40 * (conVolonta.length / importanti.length);
  if (daImpostare.length > 0) punti += 25 * (impostati.length / daImpostare.length);
  else if (voci.length > 0) punti += 25;

  const passi: string[] = [];
  if (voci.length === 0) passi.push('Trova i tuoi account con «Trova tutto», oppure aggiungi le prime voci a mano.');
  if (fiducia === 0) passi.push('Scegli almeno una persona di fiducia e aspetta che accetti l\'invito.');
  if (importanti.length > conVolonta.length) {
    passi.push(`Decidi a chi vanno ${importanti.length - conVolonta.length === 1 ? '1 voce importante' : `${importanti.length - conVolonta.length} voci importanti`} (apri la voce › Le tue volontà).`);
  }
  if (daImpostare.length > impostati.length) {
    const n = daImpostare.length - impostati.length;
    passi.push(`Imposta la funzione d'eredità di ${n === 1 ? '1 servizio' : `${n} servizi`} (per esempio il contatto erede di Apple o Google).`);
  }
  if (!controlloAttivo) passi.push('Riattiva il controllo periodico «sono qui».');

  const abbonamentiAnno = Math.round(voci.reduce((s, v) => s + (v.contenuto.abbonamento?.chfMese ?? 0), 0) * 12);
  return { percento: Math.round(punti), passi, abbonamentiAnno };
}
