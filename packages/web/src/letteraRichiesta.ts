import type { Fornitore } from './api';
import { ALLEGATI_DI_BASE, apriPerStampa, htmlLettera } from './stampa';
import type { ContenutoVoce } from './vault';

/** La lettera da mandare al fornitore di una voce, secondo la volontà indicata. */
export function letteraPerVoce(c: ContenutoVoce, fornitore: Fornitore | undefined, defunto: string, mittente: string) {
  const ente = fornitore?.nome.split(' (')[0] ?? c.titolo;
  const riferimento = c.accessi?.[0];
  const testi: Record<string, { oggetto: string; richiesta: string[] }> = {
    cancellare: {
      oggetto: `Chiusura e cancellazione dell'account di ${defunto}`,
      richiesta: [
        'Come previsto dalle sue volontà, vi chiedo di chiudere l\'account e di cancellare i dati personali collegati.',
        'Vi chiedo inoltre di interrompere eventuali addebiti e abbonamenti e di rimborsare agli eredi gli importi già pagati per il periodo successivo al decesso.',
      ],
    },
    conservare: {
      oggetto: `Account di ${defunto}: richiesta di commemorazione`,
      richiesta: [
        'Come previsto dalle sue volontà, vi chiedo di trasformare l\'account in account commemorativo (o di conservarlo come ricordo), senza che altri possano accedervi.',
        'Vi chiedo inoltre di interrompere eventuali addebiti e abbonamenti.',
      ],
    },
    trasmettere: {
      oggetto: `Account di ${defunto}: richiesta di accesso degli eredi`,
      richiesta: [
        'Come previsto dalle sue volontà, vi chiedo di consentire agli eredi l\'accesso ai dati dell\'account, o di consegnarne una copia, secondo le vostre procedure per i casi di decesso.',
        'Vi chiedo inoltre di interrompere eventuali addebiti e abbonamenti.',
      ],
    },
  };
  const t = testi[c.azione ?? 'cancellare'] ?? testi.cancellare!;
  apriPerStampa(`Lettera a ${ente}`, htmlLettera({ destinatario: ente, oggetto: t.oggetto, defunto, mittente, richiesta: t.richiesta, riferimento, allegati: ALLEGATI_DI_BASE }));
}

/** Testo del pulsante «Fatto» secondo la volontà. */
export function etichettaFatto(azione?: string): string {
  if (azione === 'cancellare') return 'Fatto: account chiuso';
  if (azione === 'conservare') return 'Fatto: chiesta la commemorazione';
  return 'Fatto';
}
