import { buildApp } from './app';
import { createPasskeyService } from './auth/passkeys';
import { loadConfig, loadEnvFile } from './config';
import { createDatabase } from './db/client';
import { FileMailer } from './mail/mailer';
import { LocalDiskBlobStore } from './storage/blobs';

loadEnvFile();
const config = loadConfig();
if (config.NODE_ENV === 'production') {
  // Le e-mail di sviluppo finiscono in un file: in produzione serve l'invio vero (SMTP), non ancora collegato.
  throw new Error('Produzione non ancora supportata: manca l\'invio e-mail via SMTP');
}
const { db, close } = createDatabase(config.DATABASE_URL);
const app = buildApp({
  db,
  passkeys: createPasskeyService({ rpId: config.WEBAUTHN_RP_ID, rpName: 'MEMORIAE', origins: config.WEBAUTHN_ORIGINS }),
  blobs: new LocalDiskBlobStore(config.BLOB_DIR),
  mailer: new FileMailer(config.MAIL_OUTBOX),
  cookieSecure: config.COOKIE_SECURE,
  logLevel: config.LOG_LEVEL,
});

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
