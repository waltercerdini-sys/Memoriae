import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { providers } from './schema';

/**
 * Prima bozza del catalogo fornitori.
 * Tutte le voci hanno `verifiedAt` vuoto: i percorsi nei menu vanno ricontrollati sul sito
 * di ogni fornitore prima di mostrarli agli utenti (blocco 7 del piano).
 * Fonti della bozza: RSI «La consulenza» 20.01.2026, Beobachter, pagine ufficiali dei fornitori (sourceUrl).
 * Le banche senza sourceUrl hanno solo indicazioni generali: vanno completate con le loro pagine.
 */
export interface ProviderSeed {
  slug: string;
  name: string;
  category: string;
  livingSteps: string[];
  heirSteps: string[];
  /** Pagina ufficiale da cui sono tratte le indicazioni, quando c'è. */
  sourceUrl?: string;
}

export const PROVIDER_SEED: ProviderSeed[] = [
  {
    slug: 'apple',
    name: 'Apple (iCloud, iPhone, Mac)',
    category: 'cloud e dispositivi',
    livingSteps: ['Impostazioni › il tuo nome › Accesso e sicurezza › Contatto erede', 'Aggiungi la persona e consegnale la chiave d\'accesso'],
    heirSteps: ['Il contatto erede richiede l\'accesso con la chiave d\'accesso e il certificato di morte'],
  },
  {
    slug: 'google',
    name: 'Google (Gmail, Drive, Foto, Android)',
    category: 'cloud e dispositivi',
    livingSteps: ['Account Google › Dati e privacy › Pianifica la tua eredità digitale', 'Scegli dopo quanti mesi di inattività avvisare e chi'],
    heirSteps: ['Se l\'utente non ha configurato nulla: modulo di richiesta di Google con certificato di morte'],
  },
  {
    slug: 'facebook',
    name: 'Facebook',
    category: 'social',
    livingSteps: ['Centro gestione account › Dettagli personali › Proprietà e controllo dell\'account › Commemorazione', 'Scegli un contatto erede oppure la cancellazione'],
    heirSteps: ['Modulo di richiesta di commemorazione o rimozione, con certificato di morte'],
  },
  {
    slug: 'instagram',
    name: 'Instagram',
    category: 'social',
    livingSteps: [],
    heirSteps: ['Richiesta di commemorazione o rimozione dell\'account con prova del decesso'],
  },
  {
    slug: 'linkedin',
    name: 'LinkedIn',
    category: 'social',
    livingSteps: [],
    heirSteps: ['Modulo di rimozione del profilo con data e prova del decesso'],
  },
  {
    slug: 'paypal',
    name: 'PayPal',
    category: 'pagamenti',
    livingSteps: ['Annotare nell\'inventario l\'indirizzo e-mail del conto e se c\'è un saldo'],
    heirSteps: ['Il saldo viene rimborsato agli eredi dietro presentazione del certificato ereditario'],
  },
  {
    slug: 'infomaniak',
    name: 'Infomaniak (kSuite, kDrive, e-mail)',
    category: 'cloud e posta',
    livingSteps: ['Nessuna funzione di eredità trovata nella documentazione pubblica: da verificare con Infomaniak'],
    heirSteps: ['Da verificare: contattare l\'assistenza con certificato di morte e certificato ereditario'],
  },
  {
    slug: 'bitwarden',
    name: 'Bitwarden',
    category: 'password manager',
    livingSteps: ['Impostazioni › Accesso d\'emergenza › Aggiungi contatto di fiducia', 'Scegli il periodo d\'attesa'],
    heirSteps: ['Il contatto di fiducia richiede l\'accesso; scaduta l\'attesa senza rifiuto, l\'accesso è concesso'],
  },
  // --- Servizi svizzeri ------------------------------------------------------
  {
    slug: 'twint',
    name: 'TWINT',
    category: 'pagamenti',
    livingSteps: [
      'Annotare quale app TWINT usi (quella della tua banca o TWINT Prepaid) e il numero di telefono collegato',
      'L\'app TWINT di una banca è legata al conto: per gli eredi conta il conto bancario',
    ],
    heirSteps: [
      'L\'account resta attivo finché non viene chiuso: la chiusura si chiede all\'emittente dell\'app (la banca o TWINT Prepaid)',
      'Per TWINT Prepaid: seguire la procedura indicata sul sito di TWINT',
    ],
    sourceUrl: 'https://www.twint.ch/en/faq/inactive-users/',
  },
  {
    slug: 'postfinance',
    name: 'PostFinance',
    category: 'banca',
    livingSteps: ['Annotare i conti e le eventuali procure (restano valide dopo il decesso, ma possono essere limitate)'],
    heirSteps: [
      'Inviare il certificato di morte a PostFinance (posta allo Scan Center di Berna o e-mail al servizio successioni)',
      'Carta e e-finance del defunto vengono disattivate automaticamente',
      'Per disporre del patrimonio o chiudere i conti: certificato ereditario e documenti d\'identità di tutti gli eredi',
      'Chiudere i conti entro 12 mesi: dopo, l\'amministrazione della successione costa CHF 30 ogni tre mesi',
    ],
    sourceUrl: 'https://www.postfinance.ch/it/assistenza/servizi/caso-di-decesso/informazioni-superstiti.html',
  },
  {
    slug: 'swisscom',
    name: 'Swisscom (mobile, Internet, TV, rete fissa)',
    category: 'telefonia',
    livingSteps: ['Annotare numeri di contratto e quali abbonamenti un familiare vorrà rilevare (per esempio il numero di telefono)'],
    heirSteps: [
      'Annullare: per telefono o con il modulo online, senza costi né termini di disdetta; serve il certificato di morte',
      'Rilevare l\'abbonamento: appuntamento in uno Swisscom Shop, con documento d\'identità del nuovo titolare',
      'Numeri prepagati: non serve disdire; il nuovo titolare va identificato di persona',
    ],
    sourceUrl: 'https://www.swisscom.ch/it/clienti-privati/aiuto/fattura-e-contratto/decesso.html',
  },
  {
    slug: 'ffs',
    name: 'FFS / SwissPass (AG, metà-prezzo)',
    category: 'trasporti',
    livingSteps: ['Annotare il numero cliente stampato sulla SwissPass'],
    heirSteps: [
      'Disdire tutti gli abbonamenti con il modulo online delle FFS',
      'AG e metà-prezzo vengono rimborsati su un conto IBAN (del defunto, della comunione ereditaria o dell\'erede)',
      'Documenti: certificato di morte, certificato ereditario, IBAN; procura firmata da tutti gli eredi se sono più di uno',
    ],
    sourceUrl: 'https://www.sbb.ch/it/aiuto-e-contatto/i-miei-abbonamenti/procedura-in-caso-di-decesso.html',
  },
  {
    slug: 'raiffeisen',
    name: 'Raiffeisen',
    category: 'banca',
    livingSteps: ['Annotare conti, cassette di sicurezza e procure'],
    heirSteps: ['Comunicare il decesso alla banca con il certificato di morte', 'Per disporre del patrimonio serve il certificato ereditario'],
  },
  {
    slug: 'ubs',
    name: 'UBS (incl. ex Credit Suisse)',
    category: 'banca',
    livingSteps: ['Annotare conti, cassette di sicurezza e procure'],
    heirSteps: ['Comunicare il decesso alla banca con il certificato di morte', 'Per disporre del patrimonio serve il certificato ereditario'],
  },
  {
    slug: 'bancastato',
    name: 'Banca dello Stato del Cantone Ticino',
    category: 'banca',
    livingSteps: ['Annotare conti, cassette di sicurezza e procure'],
    heirSteps: ['Comunicare il decesso alla banca con il certificato di morte', 'Per disporre del patrimonio serve il certificato ereditario'],
  },
];

/** Inserisce o aggiorna il catalogo; si può rieseguire senza creare doppioni. */
export async function seedProviders(db: Database): Promise<number> {
  for (const p of PROVIDER_SEED) {
    const values = {
      slug: p.slug,
      name: p.name,
      category: p.category,
      livingSteps: [...p.livingSteps],
      heirSteps: [...p.heirSteps],
      sourceUrl: p.sourceUrl ?? null,
    };
    await db
      .insert(providers)
      .values(values)
      .onConflictDoUpdate({
        target: providers.slug,
        set: { ...values, updatedAt: sql`now()` },
      });
  }
  return PROVIDER_SEED.length;
}
