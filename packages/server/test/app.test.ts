import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { auditLog, providers } from '../src/db/schema';
import { PROVIDER_SEED, seedProviders } from '../src/db/seed-providers';
import { loadConfig } from '../src/config';
import { MemoryBlobStore } from '../src/storage/blobs';
import { MemoryMailer } from '../src/mail/mailer';
import { createFakePasskeys, createTestDatabase } from './helpers';

const appFor = (db: Database) =>
  buildApp({ db, passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), mailer: new MemoryMailer(), cookieSecure: false, logLevel: 'silent' });

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  await seedProviders(db);
});

afterAll(async () => {
  await close();
});

describe('server', () => {
  it('risponde sullo stato di salute', async () => {
    const app = appFor(db);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stato: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('pubblica il catalogo fornitori', async () => {
    const app = appFor(db);
    const res = await app.inject({ method: 'GET', url: '/v1/fornitori' });
    const body = res.json() as { fornitori: { slug: string; verificatoIl: string | null }[] };
    expect(body.fornitori).toHaveLength(PROVIDER_SEED.length);
    expect(body.fornitori.map((f) => f.slug)).toContain('infomaniak');
    // Nessuna voce è ancora verificata: è una bozza.
    expect(body.fornitori.every((f) => f.verificatoIl === null)).toBe(true);
    await app.close();
  });
});

describe('database', () => {
  it('il catalogo si può ricaricare senza doppioni', async () => {
    await seedProviders(db);
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(providers);
    expect(row!.n).toBe(PROVIDER_SEED.length);
  });

  it('il registro eventi non si può modificare né cancellare', async () => {
    await db.insert(auditLog).values({ actor: 'test', action: 'prova' });
    await expect(db.execute(sql`update audit_log set action = 'altro'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_log`)).rejects.toThrow();
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
    expect(row!.n).toBe(1);
  });
});

describe('configurazione', () => {
  it('si ferma se manca il database', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('usa valori predefiniti sensati', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://x' });
    expect(c.PORT).toBe(3000);
    expect(c.NODE_ENV).toBe('development');
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.WEBAUTHN_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('in produzione impone cookie sicuri', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production' }).COOKIE_SECURE).toBe(true);
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(/HTTPS/);
  });
});
