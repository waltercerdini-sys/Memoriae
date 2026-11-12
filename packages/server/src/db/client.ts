import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as schema from './schema';

/** Qualunque database Postgres con lo schema di MEMORIAE (server vero o PGlite). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * - `postgres://…`  → PostgreSQL vero (produzione, docker compose, Postgres.app);
 * - `pglite:<cartella>` → Postgres integrato in un file locale, senza installare nulla (solo prove sul proprio computer).
 */
export function createDatabase(databaseUrl: string) {
  if (databaseUrl.startsWith('pglite:')) {
    const dir = resolve(databaseUrl.slice('pglite:'.length) || './data/db');
    mkdirSync(dir, { recursive: true });
    const client = new PGlite(dir);
    const db = drizzlePglite(client, { schema });
    return {
      db: db as unknown as Database,
      migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      close: () => client.close(),
    };
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzlePg(pool, { schema });
  return {
    db: db as unknown as Database,
    migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => pool.end(),
  };
}
