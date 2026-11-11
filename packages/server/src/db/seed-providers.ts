import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { providers } from './schema';

/**
 * Prima bozza del catalogo fornitori.
 * Tutte le voci hanno `verifiedAt` vuoto: i percorsi nei menu vanno ricontrollati sul sito
 * di ogni fornitore prima di mostrarli agli utenti (blocco 7 del piano).
 * Fonti della bozza: RSI «La consulenza» 20.01.2026, Beobachter, pagine dei fornitori.
 */
export const PROVIDER_SEED = [
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
] as const;

/** Inserisce o aggiorna il catalogo; si può rieseguire senza creare doppioni. */
export async function seedProviders(db: Database): Promise<number> {
  for (const p of PROVIDER_SEED) {
    await db
      .insert(providers)
      .values({ ...p, livingSteps: [...p.livingSteps], heirSteps: [...p.heirSteps] })
      .onConflictDoUpdate({
        target: providers.slug,
        set: {
          name: p.name,
          category: p.category,
          livingSteps: [...p.livingSteps],
          heirSteps: [...p.heirSteps],
          updatedAt: sql`now()`,
        },
      });
  }
  return PROVIDER_SEED.length;
}
