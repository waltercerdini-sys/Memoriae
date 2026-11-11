import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';

const config = loadConfig();
const { db, close } = createDatabase(config.DATABASE_URL);
const app = buildApp({ db, logLevel: config.LOG_LEVEL });

const shutdown = async () => {
  await app.close();
  await close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
