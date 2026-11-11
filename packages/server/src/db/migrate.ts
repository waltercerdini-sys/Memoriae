import { loadConfig } from '../config';
import { createDatabase } from './client';
import { seedProviders } from './seed-providers';

const config = loadConfig();
const { db, migrate, close } = createDatabase(config.DATABASE_URL);
try {
  await migrate();
  await seedProviders(db);
  console.log('Migrazioni applicate e catalogo fornitori aggiornato');
} finally {
  await close();
}
