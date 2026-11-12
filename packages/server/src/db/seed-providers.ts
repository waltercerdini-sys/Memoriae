import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { providers } from './schema';

/**
 * Catalogo fornitori: cosa fare da vivi e cosa dovranno fare gli eredi.
 *
 * Ogni voce dice quanto è affidabile:
 * - «verificato»: indicazioni lette sulla pagina ufficiale indicata, alla data `verifiedAt`;
 * - «parziale»: la pagina ufficiale copre solo una parte (il resto è indicato nella nota);
 * - «da-verificare»: nessuna pagina ufficiale raggiunta; indicazioni generali, da confermare col fornitore.
 *
 * Le procedure cambiano: le voci verificate da più di 6 mesi vanno ricontrollate
 * (`npm run catalogo:da-ricontrollare -w @memoriae/server`).
 */
export type Verification = 'verificato' | 'parziale' | 'da-verificare';

export interface ProviderSeed {
  slug: string;
  name: string;
  category: string;
  livingSteps: string[];
  heirSteps: string[];
  sourceUrl?: string;
  verification: Verification;
  /** Data della verifica (AAAA-MM-GG). Obbligatoria se verificato o parziale. */
  verifiedAt?: string;
  note?: string;
}

const VERIFICA = '2026-11-12';

export const PROVIDER_SEED: ProviderSeed[] = [
  // --- Servizi internazionali ---------------------------------------------------
  {
    slug: 'apple',
    name: 'Apple (iCloud, iPhone, Mac)',
    category: 'cloud e dispositivi',
    livingSteps: [
      'iPhone: Impostazioni › il tuo nome › Accesso e sicurezza › Contatto erede › Aggiungi contatto erede (Mac: Impostazioni di Sistema, stesso percorso)',
      'Consegna la chiave d\'accesso: via iMessage oppure stampata (conservala anche con i documenti dell\'eredità)',
      'Serve l\'autenticazione a due fattori; il contatto erede non deve avere un dispositivo Apple',
    ],
    heirSteps: [
      'Con contatto erede: richiesta su digital-legacy.apple.com con la chiave d\'accesso e il certificato di morte',
      'L\'account resta accessibile 3 anni dall\'approvazione, poi viene cancellato: scaricare subito ciò che serve',
      'Senza contatto erede: si può chiedere la cancellazione; per accedere ai dati Apple chiede di norma un\'ordinanza del tribunale',
    ],
    sourceUrl: 'https://support.apple.com/102678',
    verification: 'verificato',
    verifiedAt: VERIFICA,
    note: 'Gli eredi ricevono foto, messaggi, note, file e backup; non film, musica, libri e abbonamenti acquistati, né il portachiavi iCloud (password, passkey, carte).',
  },
  {
    slug: 'google',
    name: 'Google (Gmail, Drive, Foto, Android)',
    category: 'cloud e dispositivi',
    livingSteps: [
      'Apri myaccount.google.com/inactive (Gestione account inattivo)',
      'Scegli dopo quanto tempo di inattività agire e fino a 10 persone da avvisare, con i dati da condividere',
    ],
    heirSteps: [
      'Le persone indicate ricevono un\'e-mail con il messaggio e, se previsto, il link per scaricare i dati',
      'Se non era impostato nulla: modulo di Google per chiudere l\'account, chiedere fondi o (in certi casi) ottenere dati',
      'Google non consegna mai le password; ogni richiesta viene esaminata; dopo la chiusura i dati non si possono più chiedere',
    ],
    sourceUrl: 'https://support.google.com/accounts/troubleshooter/6357590',
    verification: 'verificato',
    verifiedAt: VERIFICA,
    note: 'Senza piano impostato Google può cancellare un account inattivo da almeno 2 anni.',
  },
  {
    slug: 'microsoft',
    name: 'Microsoft (Outlook.com, OneDrive, Windows)',
    category: 'cloud e posta',
    livingSteps: ['Microsoft non ha un contatto erede: annota nell\'inventario indirizzo e abbonamenti (per esempio Microsoft 365)'],
    heirSteps: [
      'Disdire gli abbonamenti Microsoft (o bloccarli dalla banca o dalla carta)',
      'Con le credenziali si può chiudere l\'account; dopo 60 giorni è cancellato con i dati',
      'Senza credenziali: Outlook.com e OneDrive si bloccano dopo 1 anno di inattività, l\'account si chiude dopo 2 anni',
      'Per accedere ai dati serve un\'ordinanza del tribunale notificata formalmente (Europa: Microsoft Ireland Operations Ltd)',
    ],
    sourceUrl: 'https://support.microsoft.com/office/ebbd2860-917e-4b39-9913-212362da6b2f',
    verification: 'verificato',
    verifiedAt: VERIFICA,
  },
  {
    slug: 'facebook',
    name: 'Facebook',
    category: 'social',
    livingSteps: [
      'Centro gestione account › Dettagli personali › Proprietà e controllo dell\'account › Commemorazione',
      'Scegli un contatto erede oppure la cancellazione dell\'account dopo il decesso',
    ],
    heirSteps: [
      'Richiesta di commemorazione o di rimozione con la prova del decesso',
      'Il contatto erede può scrivere un post in evidenza, cambiare foto del profilo e di copertina, accettare richieste di amicizia',
      'Il contatto erede non può accedere all\'account né leggere i messaggi privati',
    ],
    sourceUrl: 'https://about.fb.com/news/2015/02/adding-a-legacy-contact/',
    verification: 'parziale',
    verifiedAt: VERIFICA,
    note: 'Fonte ufficiale Meta del 2015 sul contatto erede; il percorso nei menu va ricontrollato nell\'app, perché Meta lo cambia spesso.',
  },
  {
    slug: 'instagram',
    name: 'Instagram',
    category: 'social',
    livingSteps: ['Instagram non ha un contatto erede: indica nelle volontà se preferisci la commemorazione o la cancellazione'],
    heirSteps: [
      'Familiari e amici possono chiedere la commemorazione dell\'account con una prova del decesso (per esempio un necrologio)',
      'Solo i familiari stretti possono chiedere la rimozione, con documenti che provano il legame',
    ],
    sourceUrl: 'https://transparency.meta.com/en-gb/policies/community-standards/memorialization/',
    verification: 'da-verificare',
    note: 'Il centro assistenza di Instagram non era consultabile da qui: indicazioni da confermare sulla pagina «Segnalare l\'account di una persona deceduta».',
  },
  {
    slug: 'linkedin',
    name: 'LinkedIn',
    category: 'social',
    livingSteps: ['Indica nelle volontà se il profilo va chiuso'],
    heirSteps: ['Modulo di LinkedIn per segnalare il decesso di un membro, con nome, link al profilo, data del decesso e un necrologio o certificato'],
    verification: 'da-verificare',
    note: 'Pagina d\'aiuto di LinkedIn non consultabile da qui: da confermare.',
  },
  {
    slug: 'paypal',
    name: 'PayPal',
    category: 'pagamenti',
    livingSteps: ['Annota nell\'inventario l\'indirizzo e-mail del conto e se c\'è un saldo'],
    heirSteps: [
      'Scrivere a PayPal che il titolare è deceduto e che l\'esecutore chiede la chiusura, con un recapito',
      'Allegare: certificato di morte, documento che prova i poteri dell\'esecutore (in Svizzera: certificato ereditario o attestazione dell\'esecutore testamentario), documento d\'identità con foto',
      'Dopo la verifica il saldo viene trasferito sul conto bancario collegato',
    ],
    sourceUrl: 'https://www.paypal.com/za/cshelp/article/how-do-i-close-the-paypal-account-of-a-deceased-relative-help220',
    verification: 'parziale',
    verifiedAt: VERIFICA,
    note: 'Pagina verificata in una versione regionale di PayPal; l\'indirizzo e-mail per le successioni cambia da paese a paese: chiedere al servizio clienti PayPal Svizzera.',
  },
  {
    slug: 'bitwarden',
    name: 'Bitwarden',
    category: 'password manager',
    livingSteps: [
      'Serve un piano Premium (o Famiglie/aziendale): Impostazioni › Accesso d\'emergenza › aggiungi un contatto di fiducia',
      'Scegli il tipo di accesso (Visualizza oppure Subentro) e il tempo d\'attesa',
    ],
    heirSteps: [
      'Il contatto di fiducia chiede l\'accesso dalla sua app Bitwarden',
      'Se il titolare non rifiuta entro il tempo d\'attesa, l\'accesso è concesso automaticamente',
      '«Visualizza» mostra tutte le voci in sola lettura; «Subentro» richiede una nuova password principale',
    ],
    sourceUrl: 'https://bitwarden.com/help/emergency-access/',
    verification: 'verificato',
    verifiedAt: VERIFICA,
  },
  {
    slug: 'infomaniak',
    name: 'Infomaniak (kSuite, kDrive, e-mail)',
    category: 'cloud e posta',
    livingSteps: [
      'Infomaniak non pubblica una procedura per il decesso: annota indirizzi e servizi, e conserva una copia locale dei file importanti',
    ],
    heirSteps: ['Contattare l\'assistenza Infomaniak con certificato di morte e certificato ereditario e chiedere la procedura'],
    verification: 'da-verificare',
    note: 'Nessuna pagina ufficiale trovata: da chiedere direttamente a Infomaniak.',
  },
  // --- Servizi svizzeri -----------------------------------------------------------
  {
    slug: 'swissid',
    name: 'SwissID (La Posta)',
    category: 'identità digitale',
    livingSteps: ['Annota l\'indirizzo e-mail usato per SwissID: serve a Posta, FFS e a molti servizi svizzeri'],
    heirSteps: ['Compilare e firmare il modulo «Richiesta di cancellazione di un conto SwissID» e spedirlo all\'indirizzo indicato sul modulo'],
    sourceUrl: 'https://www.swissid.ch/en/faq/swissid-konto.html',
    verification: 'verificato',
    verifiedAt: VERIFICA,
  },
  {
    slug: 'twint',
    name: 'TWINT',
    category: 'pagamenti',
    livingSteps: [
      'Annota quale app TWINT usi (quella della tua banca o TWINT Prepaid) e il numero di telefono collegato',
      'L\'app TWINT di una banca è legata al conto: per gli eredi conta il conto bancario',
    ],
    heirSteps: [
      'L\'account resta attivo finché qualcuno non lo chiude: la chiusura si chiede all\'emittente dell\'app (la banca o TWINT Prepaid)',
      'TWINT Prepaid: il rapporto si chiude da solo dopo 4 anni senza movimenti',
    ],
    sourceUrl: 'https://www.twint.ch/en/faq/inactive-users/',
    verification: 'parziale',
    verifiedAt: VERIFICA,
    note: 'La pagina di TWINT non parla esplicitamente del decesso: vale la procedura della banca che ha emesso l\'app.',
  },
  {
    slug: 'postfinance',
    name: 'PostFinance',
    category: 'banca',
    livingSteps: ['Annota i conti e le procure (restano valide dopo il decesso, ma possono essere limitate)'],
    heirSteps: [
      'Inviare il prima possibile una copia del certificato di morte: PostFinance SA, Scan Center, 3002 Berna, oppure nachlass@postfinance.ch (centro successioni: +41 58 667 98 65)',
      'Carta PostFinance ed e-finance del defunto vengono disattivati automaticamente',
      'Per agire sui conti: certificato ereditario e copie dei documenti d\'identità di tutti gli eredi',
      'I primi 12 mesi di amministrazione della successione sono gratuiti, poi CHF 30 ogni tre mesi se il conto non è chiuso',
    ],
    sourceUrl: 'https://www.postfinance.ch/it/assistenza/servizi/caso-di-decesso/informazioni-superstiti.html',
    verification: 'verificato',
    verifiedAt: VERIFICA,
  },
  {
    slug: 'ubs',
    name: 'UBS (incl. ex Credit Suisse)',
    category: 'banca',
    livingSteps: ['Annota conti, cassette di sicurezza e procure; una procura UBS attiva il giorno del decesso continua a dare accesso'],
    heirSteps: [
      'Chiunque può annunciare il decesso con il modulo online di UBS, allegando il certificato di morte',
      'Per l\'accesso: certificato ereditario autenticato (per posta) e documento d\'identità di ogni erede; l\'esecutore testamentario presenta la sua attestazione',
      'Conto cointestato: il cointestatario superstite di norma continua a disporne',
      'Estratti alla data del decesso: si ordinano dal consulente (quelli patrimoniali sono a pagamento)',
    ],
    sourceUrl: 'https://www.ubs.com/ch/it/help/account/case-of-death.html',
    verification: 'verificato',
    verifiedAt: VERIFICA,
    note: 'Vale per clienti domiciliati in Svizzera. Carte ed e-banking non sono descritti sulla pagina: chiedere al consulente.',
  },
  {
    slug: 'raiffeisen',
    name: 'Raiffeisen',
    category: 'banca',
    livingSteps: [
      'Annota conti, cassette di sicurezza e procure',
      'Raiffeisen consiglia: elenco dei fornitori con gli accessi, volontà digitali nel testamento, accessi importanti nel mandato precauzionale',
    ],
    heirSteps: [
      'Annunciare il decesso alla propria banca Raiffeisen con il certificato di morte',
      'Fino alla divisione gli eredi dispongono dei beni solo insieme (comunione ereditaria)',
      'Raiffeisen può fare da rappresentante degli eredi (pagamenti, estratti, inventario), su accordo',
    ],
    sourceUrl: 'https://raiffeisen.ch/content/dam/www/rch/pdf/privatkunden/vorsorgen-und-absichern/merkblaetter/merkblatt-digitale-nachlass-it.pdf',
    verification: 'parziale',
    verifiedAt: VERIFICA,
    note: 'I promemoria Raiffeisen non descrivono la procedura per e-banking e carte: ogni banca Raiffeisen è autonoma, chiedere alla propria.',
  },
  {
    slug: 'bancastato',
    name: 'Banca dello Stato del Cantone Ticino',
    category: 'banca',
    livingSteps: ['Annota conti, cassette di sicurezza e procure'],
    heirSteps: [
      'Annunciare il decesso alla banca con il certificato di morte',
      'Per disporre del patrimonio serve di norma il certificato ereditario con i documenti d\'identità degli eredi',
    ],
    verification: 'da-verificare',
    note: 'Nessuna pagina pubblica trovata: indicazioni basate sulla prassi delle banche svizzere, da confermare con BancaStato.',
  },
  {
    slug: 'swisscom',
    name: 'Swisscom (mobile, Internet, TV, rete fissa)',
    category: 'telefonia',
    livingSteps: ['Annota numeri di contratto e quali abbonamenti un familiare vorrà rilevare (per esempio il numero di telefono)'],
    heirSteps: [
      'Disdire per iscritto o per telefono: subito, senza termini di disdetta né costi; servono nome, data di nascita, indirizzi dei collegamenti e certificato di morte',
      'Rilevare il mobile: appuntamento in uno Swisscom Shop con documento d\'identità del nuovo titolare e certificato di morte',
      'Rete fissa, Internet, TV: per telefono o in negozio; non servono nuovi apparecchi',
      'Prepagato: niente da disdire; il credito resta, ma il numero si disattiva dopo 12 mesi senza uso',
    ],
    sourceUrl: 'https://www.swisscom.ch/it/clienti-privati/aiuto/fattura-e-contratto/decesso.html',
    verification: 'verificato',
    verifiedAt: VERIFICA,
  },
  {
    slug: 'ffs',
    name: 'FFS / SwissPass (AG, metà-prezzo)',
    category: 'trasporti',
    livingSteps: ['Annota il numero cliente stampato sulla SwissPass'],
    heirSteps: [
      'Disdire tutti gli abbonamenti intestati al defunto con il modulo online delle FFS',
      'AG e metà-prezzo vengono rimborsati su un conto IBAN (del defunto, della comunione ereditaria o di un erede); gli altri abbonamenti sul mezzo di pagamento originale',
      'Documenti: certificato di morte, certificato ereditario, IBAN e titolare del conto; se gli eredi sono più di uno, conferma scritta firmata da tutti',
    ],
    sourceUrl: 'https://www.sbb.ch/it/aiuto-e-contatto/i-miei-abbonamenti/procedura-in-caso-di-decesso.html',
    verification: 'verificato',
    verifiedAt: VERIFICA,
  },
];

/** Voci verificate da più di `mesi` mesi, o mai verificate. */
export function providersToRecheck(now = new Date(), mesi = 6): ProviderSeed[] {
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - mesi);
  return PROVIDER_SEED.filter((p) => !p.verifiedAt || new Date(p.verifiedAt) < limit);
}

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
      verification: p.verification,
      verifiedAt: p.verifiedAt ? new Date(`${p.verifiedAt}T12:00:00Z`) : null,
      note: p.note ?? null,
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
