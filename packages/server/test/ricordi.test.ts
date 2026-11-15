import { encryptItem, utf8 } from '@memoriae/crypto';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { memoriesReminders } from '../src/jobs/ricordi';
import { MemoryMailer } from '../src/mail/mailer';
import { MemoryBlobStore } from '../src/storage/blobs';
import { DevKeyCustody } from '../src/storage/custody';
import { createFakePasskeys, createTestDatabase } from './helpers';
import { createWorld, type TestUser } from './world';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance;
const mailer = new MemoryMailer();
const { utente } = createWorld(() => app, mailer);
const DAY = 24 * 3600 * 1000;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  app = buildApp({ db, custody: new DevKeyCustody(db, new Uint8Array(32).fill(7)), appOrigin: 'http://x', passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), mailer, cookieSecure: false, logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await close();
});
const req = (u: TestUser, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie: u.session }, payload: payload as never });

describe('intervista dei ricordi', () => {
  it('le risposte sono voci cifrate di tipo «ricordo»; il promemoria è facoltativo e settimanale', async () => {
    const ida = await utente('Ida Rossi', 'ida.r@example.ch');
    const id = randomUUID();
    const { item } = await encryptItem(ida.vaultKey, id, utf8(JSON.stringify({ titolo: 'Come hai conosciuto il nonno?', note: '' })));
    expect((await req(ida, 'POST', '/v1/cassaforte/voci', { id, tipo: 'ricordo', chiaveVoceCifrata: item.wrappedItemKey, contenuto: item.content })).statusCode).toBe(201);

    expect((await req(ida, 'GET', '/v1/ricordi/promemoria')).json()).toEqual({ attivo: false });
    const t0 = new Date();
    expect(await memoriesReminders(db, mailer, 'http://x', t0)).toBe(0);

    await req(ida, 'PUT', '/v1/ricordi/promemoria', { attivo: true });
    // Il primo promemoria arriva una settimana dopo l'accensione, poi uno alla settimana.
    expect(await memoriesReminders(db, mailer, 'http://x', new Date(t0.getTime() + 2 * DAY))).toBe(0);
    expect(await memoriesReminders(db, mailer, 'http://x', new Date(t0.getTime() + 8 * DAY))).toBe(1);
    expect(mailer.sent.at(-1)).toMatchObject({ to: 'ida.r@example.ch', subject: 'MEMORIAE – la domanda della settimana' });
    expect(mailer.sent.at(-1)!.text).not.toContain('nonno');
    expect(await memoriesReminders(db, mailer, 'http://x', new Date(t0.getTime() + 10 * DAY))).toBe(0);
    expect(await memoriesReminders(db, mailer, 'http://x', new Date(t0.getTime() + 16 * DAY))).toBe(1);

    await req(ida, 'PUT', '/v1/ricordi/promemoria', { attivo: false });
    expect(await memoriesReminders(db, mailer, 'http://x', new Date(t0.getTime() + 40 * DAY))).toBe(0);
  });
});
