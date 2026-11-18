import { api } from './api';
import { aggiungiVoce } from './vault';

/**
 * Solo in anteprima: riempie una cassaforte vuota con un esempio realistico (persone senza e-mail,
 * quindi nessun invito parte), per far vedere subito MEMORIAE a tester e giornalisti.
 * Le persone sono inventate; i servizi sono quelli reali del catalogo, senza nessun dato vero.
 */
export async function riempiEsempio(vaultKey: Uint8Array): Promise<void> {
  const giulia = crypto.randomUUID();
  const marco = crypto.randomUUID();
  await api.aggiungiPersona({ id: giulia, ruolo: 'fiduciario', nome: 'Giulia (figlia, esempio)' });
  await api.aggiungiPersona({ id: marco, ruolo: 'destinatario', nome: 'Marco (nipote, esempio)' });

  const voci: Parameters<typeof aggiungiVoce>[1][] = [
    {
      tipo: 'account',
      emergenza: false,
      titolo: 'Conto privato PostFinance',
      note: 'I documenti del conto sono nel raccoglitore blu, nello studio.',
      fornitore: 'postfinance',
      extra: { azione: 'cancellare', destinatari: [giulia] },
    },
    {
      tipo: 'account',
      emergenza: false,
      titolo: 'Abbonamento mobile Swisscom',
      note: 'Marco vorrebbe tenere il numero: rilevarlo, non disdirlo.',
      fornitore: 'swisscom',
      extra: { azione: 'trasmettere', destinatari: [marco], abbonamento: { chfMese: 39 } },
    },
    {
      tipo: 'account',
      emergenza: false,
      titolo: 'Posta e foto Google',
      note: 'Le foto dei nipoti sono tutte qui.',
      fornitore: 'google',
      extra: { azione: 'conservare', destinatari: [giulia, marco] },
    },
    {
      tipo: 'account',
      emergenza: false,
      titolo: 'Profilo Facebook',
      note: 'Trasformarlo in profilo commemorativo, non cancellarlo.',
      fornitore: 'facebook',
    },
    {
      tipo: 'cartella',
      emergenza: false,
      titolo: 'Foto di famiglia 1990–2025',
      note: 'Una copia è sul disco esterno nel cassetto della scrivania.',
      extra: { destinatari: [giulia, marco] },
    },
    {
      tipo: 'istruzione',
      emergenza: true,
      titolo: 'Cassetta di sicurezza',
      note: 'In banca. La chiave è nella scatola di latta in camera, sul ripiano alto dell\'armadio.',
      extra: { destinatari: [giulia] },
    },
    {
      tipo: 'documento',
      emergenza: true,
      titolo: 'Cassa malati e assicurazioni',
      note: 'Polizze nel raccoglitore verde. Tessera della cassa malati nel portafoglio.',
      extra: { destinatari: [giulia] },
    },
    {
      tipo: 'lettera',
      emergenza: false,
      titolo: 'Per Giulia',
      note:
        'Cara Giulia,\n\nse leggi queste righe vuol dire che ho fatto in tempo a mettere un po\' d\'ordine. ' +
        'Non preoccuparti delle pratiche: in MEMORIAE trovi tutto, passo per passo.\n\n' +
        'Ricordati delle domeniche al lago e di quanto ridevamo.\n\nTi voglio bene,\nla mamma\n\n(Lettera d\'esempio)',
      extra: { destinatari: [giulia] },
      lettera: { destinatari: [giulia], consegnaIl: null },
    },
  ];
  for (const v of voci) await aggiungiVoce(vaultKey, v);
}
