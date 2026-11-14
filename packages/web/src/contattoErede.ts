import { documentiDi, type Voce } from './vault';

/**
 * Funzioni d'eredità dei fornitori che indicano persone precise (contatto erede di Apple e Facebook,
 * persone da avvisare di Google). MEMORIAE ne tiene traccia, così l'eredità regge anche se quelle
 * persone non ci sono più o perdono la chiave.
 */
export interface FunzioneErede {
  /** Nome della funzione presso il fornitore. */
  nome: string;
  /** Come chiamare le persone indicate (plurale e singolare). */
  persone: string;
  singolare: string;
  /** Il fornitore consegna una chiave da presentare dopo il decesso. */
  chiave?: { nome: string; comeSalvarla: string };
  /** Quante persone consigliamo di indicare (se il fornitore ne ammette più di una). */
  consigliate: number;
  perche: string;
}

export const FUNZIONI_EREDE: Record<string, FunzioneErede> = {
  apple: {
    nome: 'Contatto erede',
    persone: 'Contatti erede',
    singolare: 'contatto erede',
    chiave: {
      nome: 'chiave di accesso',
      comeSalvarla:
        'Su Mac: Impostazioni di Sistema › il tuo nome › Accesso e sicurezza › Contatto erede › scegli il contatto › Stampa una copia; nella finestra di stampa scegli «Salva come PDF».',
    },
    consigliate: 2,
    perche:
      'Senza la chiave di accesso il contatto erede non può chiedere i dati ad Apple. Se la perde o non c\'è più, serve un\'ordinanza del tribunale.',
  },
  google: {
    nome: 'Gestione account inattivo',
    persone: 'Persone da avvisare',
    singolare: 'persona da avvisare',
    consigliate: 2,
    perche: 'Google avvisa solo le persone indicate, all\'indirizzo e-mail indicato: se una casella non esiste più, l\'avviso si perde.',
  },
  facebook: {
    nome: 'Contatto erede',
    persone: 'Contatto erede',
    singolare: 'contatto erede',
    consigliate: 1,
    perche: 'Facebook ammette un solo contatto erede: se non c\'è più, gli eredi possono comunque chiedere la commemorazione o la cancellazione.',
  },
};

export interface DatiErede {
  /** Nomi delle persone indicate presso il fornitore (anche persone che non usano MEMORIAE). */
  contatti: string[];
  /** Documento della voce con la chiave di accesso (per esempio il PDF di Apple). */
  chiaveFileId?: string;
}

export function funzioneErede(v: Voce): FunzioneErede | undefined {
  return v.contenuto.fornitore ? FUNZIONI_EREDE[v.contenuto.fornitore] : undefined;
}

/** Il documento con la chiave, se è ancora tra i documenti della voce. */
export function documentoChiave(v: Voce) {
  const id = v.contenuto.erede?.chiaveFileId;
  return id ? documentiDi(v.id, v.contenuto).find((f) => f.id === id) : undefined;
}

/** Cosa manca perché la funzione d'eredità regga anche se le persone indicate non ci sono più. */
export function mancanzeErede(v: Voce, nomeServizio: string): string[] {
  const fz = funzioneErede(v);
  if (!fz) return [];
  const contatti = v.contenuto.erede?.contatti ?? [];
  if (contatti.length === 0) {
    return v.contenuto.impostatoDaVivo ? [`Scrivi chi hai indicato come ${fz.singolare} per ${nomeServizio} (apri la voce).`] : [];
  }
  const m: string[] = [];
  if (fz.chiave && !documentoChiave(v)) m.push(`Allega la ${fz.chiave.nome} del ${fz.singolare} di ${nomeServizio} (apri la voce).`);
  if (contatti.length < fz.consigliate) m.push(`Indica una seconda persona come ${fz.singolare} per ${nomeServizio}: se la prima non c'è più, la seconda può agire.`);
  return m;
}
