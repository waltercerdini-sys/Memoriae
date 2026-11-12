import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { checkinSchedules } from '../src/db/schema';
import { runJobs } from '../src/jobs/scheduler';
import { MemoryMailer } from '../src/mail/mailer';
import { MemoryBlobStore } from '../src/storage/blobs';
import { DevKeyCustody } from '../src/storage/custody';
import { createFakePasskeys, createTestDatabase } from './helpers';
import { createWorld } from './world';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance;
const mailer = new MemoryMailer();
const appOrigin = 'http://localhost:5173';
const { utente, linkToken, inviteToken } = createWorld(() => app, mailer);
const DAY = 24 * 3600 * 1000;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  app = buildApp({ db, custody: new DevKeyCustody(db, new Uint8Array(32).fill(3)), appOrigin, passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), mailer, cookieSecure: false, logLevel: 'silent' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await close();
});

const schedule = async (vaultId: string) => (await db.select().from(checkinSchedules).where(eq(checkinSchedules.vaultId, vaultId)))[0]!;

describe('controllo periodico «sono qui»', () => {
  it('promemoria, collegamento a un clic, avviso ai fiduciari e niente apertura automatica', async () => {
    const rosa = await utente('Rosa Bianchi', 'rosa.c@example.ch');
    const anna = await utente('Anna Verdi', 'anna.c@example.ch');
    const marco = await utente('Marco Bianchi', 'marco.c@example.ch');
    const jobs = (now: Date) => runJobs({ db, mailer, appOrigin }, now);

    // Rosa nomina Anna (fiducia) e Marco (solo destinatario): entrambi accettano.
    for (const [ruolo, u, nome] of [['fiduciario', anna, 'Anna Verdi'], ['destinatario', marco, 'Marco Bianchi']] as const) {
      const id = randomUUID();
      await app.inject({ method: 'POST', url: '/v1/cassaforte/persone', headers: { cookie: rosa.session }, payload: { id, ruolo, nome, email: u.email } });
      await app.inject({ method: 'POST', url: `/v1/cassaforte/persone/${id}/invito`, headers: { cookie: rosa.session } });
      expect((await app.inject({ method: 'POST', url: '/v1/inviti/accetta', headers: { cookie: u.session }, payload: { token: inviteToken(u.email) } })).statusCode).toBe(200);
    }

    // Per leggere i conteggi solo su Rosa, i controlli di Anna e Marco vanno in pausa.
    for (const u of [anna, marco]) await app.inject({ method: 'PUT', url: '/v1/cassaforte/controllo', headers: { cookie: u.session }, payload: { intervalloGiorni: 30, inPausa: true } });

    // Impostazioni: solo intervalli previsti.
    expect((await app.inject({ method: 'PUT', url: '/v1/cassaforte/controllo', headers: { cookie: rosa.session }, payload: { intervalloGiorni: 3 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/v1/cassaforte/controllo', headers: { cookie: rosa.session }, payload: { intervalloGiorni: 7 } })).statusCode).toBe(200);
    const st = (await app.inject({ method: 'GET', url: '/v1/cassaforte/controllo', headers: { cookie: rosa.session } })).json();
    expect(st).toMatchObject({ intervalloGiorni: 7, inPausa: false, stato: 'in-regola' });

    const t0 = (await schedule(rosa.vaultId)).lastCheckinAt.getTime();
    expect((await jobs(new Date(t0 + 6 * DAY))).promemoria).toBe(0);

    // Scaduto: primo promemoria con collegamento.
    expect((await jobs(new Date(t0 + 7 * DAY + 1000))).promemoria).toBe(1);
    expect((await jobs(new Date(t0 + 8 * DAY))).promemoria).toBe(0); // rispetta la distanza tra promemoria
    const token = linkToken(rosa.email, 'sonoqui')!;
    expect(token).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/v1/sono-qui/sbagliato' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/sono-qui/${token}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/v1/sono-qui/${token}` })).statusCode).toBe(404); // già usato
    const after = await schedule(rosa.vaultId);
    expect(after.remindersSent).toBe(0);

    // Nessuna risposta a 3 promemoria: avviso solo ad Anna (fiducia), una volta sola.
    const t1 = after.lastCheckinAt.getTime() + 7 * DAY + 1000;
    for (let i = 0; i < 3; i++) expect((await jobs(new Date(t1 + i * 3 * DAY))).promemoria).toBe(1);
    expect((await jobs(new Date(t1 + 9 * DAY + 1000))).avvisiFiduciari).toBe(1);
    expect((await jobs(new Date(t1 + 20 * DAY))).avvisiFiduciari).toBe(0);
    expect(mailer.sent.filter((m) => m.subject.includes('non risponde')).map((m) => m.to)).toEqual([anna.email]);

    // Entrare con la passkey vale come «sono qui».
    const opts = (await app.inject({ method: 'POST', url: '/v1/accesso/opzioni' })).json();
    const login = await app.inject({ method: 'POST', url: '/v1/accesso/verifica', payload: { challengeId: opts.challengeId, risposta: { id: rosa.credentialId, challenge: opts.opzioni.challenge } } });
    expect(login.statusCode).toBe(200);
    const reset = await schedule(rosa.vaultId);
    expect(reset.remindersSent).toBe(0);
    expect(reset.missedNotifiedAt).toBeNull();

    // In pausa: nessun promemoria.
    await app.inject({ method: 'PUT', url: '/v1/cassaforte/controllo', headers: { cookie: rosa.session }, payload: { intervalloGiorni: 7, inPausa: true } });
    expect((await jobs(new Date(Date.now() + 60 * DAY))).promemoria).toBe(0);
    await app.inject({ method: 'POST', url: '/v1/cassaforte/sono-qui', headers: { cookie: rosa.session } });
  });
});
