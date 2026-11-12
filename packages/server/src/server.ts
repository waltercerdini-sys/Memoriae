import { createHash } from 'node:crypto';
import { buildApp } from './app';
import { createPasskeyService } from './auth/passkeys';
import { loadConfig, loadEnvFile } from './config';
import { createDatabase } from './db/client';
import { seedProviders } from './db/seed-providers';
import { startScheduler } from './jobs/scheduler';
import { FileMailer } from './mail/mailer';
import { LocalDiskBlobStore } from './storage/blobs';
import { DevKeyCustody, loadDevMasterKey } from './storage/custody';

loadEnvFile();
const config = loadConfig();
if (config.NODE_ENV === 'production') {
  // Le e-mail di sviluppo finiscono in un file: in produzione serve l'invio vero (SMTP), non ancora collegato.
  throw new Error('Produzione non ancora supportata: manca l\'invio e-mail via SMTP');
}
const { db, migrate, close } = createDatabase(config.DATABASE_URL);
// Database integrato (prove sul proprio computer): si prepara da solo all'avvio.
if (config.DATABASE_URL.startsWith('pglite:')) {
  await migrate();
  await seedProviders(db);
}
const masterKey = await loadDevMasterKey(config.CUSTODY_KEY_FILE);
const mailer = new FileMailer(config.MAIL_OUTBOX);
const app = buildApp({
  db,
  passkeys: createPasskeyService({ rpId: config.WEBAUTHN_RP_ID, rpName: 'MEMORIAE', origins: config.WEBAUTHN_ORIGINS }),
  blobs: new LocalDiskBlobStore(config.BLOB_DIR),
  mailer,
  custody: new DevKeyCustody(db, masterKey),
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
const stopJobs = startScheduler({ db, mailer, appOrigin: config.APP_ORIGIN }, config.JOBS_INTERVAL_SECONDS * 1000, (m) => app.log.info(m));

const shutdown = async () => {
  stopJobs();
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
