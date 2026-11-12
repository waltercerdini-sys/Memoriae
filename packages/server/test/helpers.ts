import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { randomBytes } from 'node:crypto';
import type { PasskeyService } from '../src/auth/passkeys';
import { MIGRATIONS_FOLDER, type Database } from '../src/db/client';
import * as schema from '../src/db/schema';

/** Database Postgres vero, in memoria (PGlite), con tutte le migrazioni applicate. */
export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Database, close: () => client.close() };
}

/**
 * Passkey finte per i test del server: la vera verifica crittografica WebAuthn è di SimpleWebAuthn
 * e viene provata nel test end-to-end con l'autenticatore virtuale del browser.
 * Qui una "risposta" è valida se riporta la sfida giusta.
 */
export function createFakePasskeys(): PasskeyService {
  const challenge = () => randomBytes(16).toString('base64url');
  return {
    async registrationOptions(user) {
      return {
        challenge: challenge(),
        rp: { name: 'MEMORIAE', id: 'localhost' },
        user: { id: user.id, name: user.email, displayName: user.name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      };
    },
    async verifyRegistration(response, expected) {
      const r = response as unknown as { id: string; challenge: string };
      if (r.challenge !== expected) return null;
      return { id: r.id, publicKey: 'pk-' + r.id, counter: 0, transports: ['internal'], deviceType: 'multiDevice', backedUp: true };
    },
    async authenticationOptions() {
      return { challenge: challenge() };
    },
    async verifyAuthentication(response, expected, credential) {
      const r = response as unknown as { id: string; challenge: string };
      if (r.challenge !== expected || r.id !== credential.id) return null;
      return { newCounter: credential.counter + 1 };
    },
  };
}
