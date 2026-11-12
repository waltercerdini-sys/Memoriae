import { buildApp } from './app';
import { createPasskeyService } from './auth/passkeys';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { LocalDiskBlobStore } from './storage/blobs';

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const app = buildApp({
  db,
  passkeys: createPasskeyService({ rpId: config.WEBAUTHN_RP_ID, rpName: 'MEMORIAE', origins: config.WEBAUTHN_ORIGINS }),
  blobs: new LocalDiskBlobStore(config.BLOB_DIR),
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
