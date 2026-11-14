import { createHash } from 'node:crypto';
import { buildApp } from './app';
import { createPasskeyService } from './auth/passkeys';
import { loadConfig, loadEnvFile } from './config';
import { createDatabase } from './db/client';
import { seedProviders } from './db/seed-providers';
import { startScheduler } from './jobs/scheduler';
import { fetchPage } from './jobs/catalogo';
import { DevMailer, FileMailer, SmtpMailer, type Mailer } from './mail/mailer';
import { StripeProvider } from './payments/provider';
import { LocalDiskBlobStore } from './storage/blobs';
import { DevKeyCustody, loadDevMasterKey } from './storage/custody';

loadEnvFile();
const config = loadConfig();
const { db, migrate, close } = createDatabase(config.DATABASE_URL);
// Database integrato (prove sul proprio computer): si prepara da solo all'avvio.
if (config.DATABASE_URL.startsWith('pglite:')) {
  try {
    await migrate();
  } catch (e) {
    const cartella = config.DATABASE_URL.slice('pglite:'.length);
    console.error(
      `\n✖ Il database delle prove non si apre (${cartella}).\n` +
        `  Succede di solito se è stato copiato mentre MEMORIAE era ancora accesa, o se il computer si è spento di colpo.\n` +
        `  1. Controlla che non ci sia un'altra MEMORIAE accesa (chiudi gli altri Terminali, oppure riavvia il Mac).\n` +
        `  2. Riprova con npm run prova.\n` +
        `  3. Se l'errore resta, metti da parte i dati e riparti da zero:\n` +
        `       mv "${cartella.replace(/\/db$/, '')}" "${cartella.replace(/\/db$/, '')}-guasta"\n` +
        `     poi npm run prova (e nell'app Password cancella le passkey di «localhost»).\n` +
        `  Dettaglio tecnico: ${(e as Error).cause instanceof Error ? ((e as Error).cause as Error).message : (e as Error).message}\n`,
    );
    process.exit(1);
  }
  await seedProviders(db);
}
const masterKey = await loadDevMasterKey(config.CUSTODY_KEY_FILE);
const smtp = config.SMTP_HOST
  ? new SmtpMailer({ host: config.SMTP_HOST, port: config.SMTP_PORT, user: config.SMTP_USER!, password: config.SMTP_PASSWORD!, from: config.MAIL_FROM ?? `MEMORIAE <${config.SMTP_USER}>` })
  : null;
const mailer: Mailer = config.NODE_ENV === 'production' ? smtp! : new DevMailer(new FileMailer(config.MAIL_OUTBOX), smtp);
console.log(smtp ? `✉️  E-mail: invio vero attivo da ${config.SMTP_USER} (${config.SMTP_HOST})` : '✉️  E-mail: solo nel terminale (per l\'invio vero: npm run posta)');
const app = buildApp({
  db,
  passkeys: createPasskeyService({ rpId: config.WEBAUTHN_RP_ID, rpName: 'MEMORIAE', origins: config.WEBAUTHN_ORIGINS }),
  blobs: new LocalDiskBlobStore(config.BLOB_DIR),
  mailer,
  custody: new DevKeyCustody(db, masterKey),
  payments:
    config.PAYMENTS_PROVIDER === 'stripe'
      ? new StripeProvider({
          secretKey: config.STRIPE_SECRET_KEY!,
          webhookSecret: config.STRIPE_WEBHOOK_SECRET!,
          prices: { essenziale: config.STRIPE_PRICE_ESSENZIALE!, famiglia: config.STRIPE_PRICE_FAMIGLIA! },
        })
      : undefined,
  activation: {
    operatori: config.OPERATOR_EMAILS,
    chiaveDocumenti: createHash('sha256').update('memoriae-documenti-operatore:').update(masterKey).digest(),
    attesaMs: config.ATTESA_PROVA_SECONDI ? config.ATTESA_PROVA_SECONDI * 1000 : undefined,
  },
  appOrigin: config.APP_ORIGIN,
  cookieSecure: config.COOKIE_SECURE,
  logLevel: config.LOG_LEVEL,
});

// Lavori periodici (promemoria, avvisi, rilasci a fine attesa).
const stopJobs = startScheduler(
  {
    db,
    mailer,
    appOrigin: config.APP_ORIGIN,
    // Una volta alla settimana si ricontrollano le pagine ufficiali del catalogo.
    ...(config.CATALOGO_CONTROLLO ? { catalogo: { fetchPage, operatori: config.OPERATOR_EMAILS } } : {}),
  },
  config.JOBS_INTERVAL_SECONDS * 1000,
  (m) => app.log.info(m),
);

const shutdown = async () => {
  stopJobs();
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
