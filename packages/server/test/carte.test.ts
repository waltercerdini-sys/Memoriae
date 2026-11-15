import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { simulaLettura } from '../src/cards/sun';
import type { Database } from '../src/db/client';
import { MemoryMailer } from '../src/mail/mailer';
import { MemoryBlobStore } from '../src/storage/blobs';
import { DevKeyCustody } from '../src/storage/custody';
import { createFakePasskeys, createTestDatabase } from './helpers';
import { createWorld, type TestUser } from './world';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance;
const mailer = new MemoryMailer();
const chiaveCarte = new Uint8Array(32).fill(9);
const { utente, inviteToken } = createWorld(() => app, mailer);

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  app = buildApp({ db, custody: new DevKeyCustody(db, new Uint8Array(32).fill(7)), appOrigin: 'http://x', passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), mailer, cookieSecure: false, logLevel: 'silent', chiaveCarte });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await close();
});
const req = (u: TestUser | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: u ? { cookie: u.session } : {}, payload: payload as never });
const tocco = (u: TestUser | null, uid: string, ctr: number) => {
  const l = simulaLettura(Buffer.from(chiaveCarte), uid, ctr);
  return req(u, 'GET', `/v1/carta?picc=${l.picc}&cmac=${l.cmac}`).then((r) => ({ ...r.json(), l }));
};

describe('Carta MEMORIAE (NFC)', () => {
  it('ordine, spedizione, attivazione, avviso alle persone di fiducia, disattivazione', async () => {
    const rosa = await utente('Rosa Bianchi', 'rosa.c@example.ch');
    const anna = await utente('Anna Verdi', 'anna.c@example.ch');
    const annaId = randomUUID();
    await req(rosa, 'POST', '/v1/cassaforte/persone', { id: annaId, ruolo: 'fiduciario', nome: 'Anna Verdi', email: anna.email });
    await req(rosa, 'POST', `/v1/cassaforte/persone/${annaId}/invito`);
    await req(anna, 'POST', '/v1/inviti/accetta', { token: inviteToken(anna.email) });

    // Ordine: 2 carte da CHF 25, pagamento di prova con l'indirizzo di spedizione.
    const ord = await req(rosa, 'POST', '/v1/carte/ordina', { quantita: 2, regalo: true });
    expect(ord.statusCode).toBe(200);
    const orderId = new URL(ord.json().url).searchParams.get('ordine-carte')!;
    expect((await req(rosa, 'GET', `/v1/carte/ordini/${orderId}`)).json()).toMatchObject({ quantita: 2, chf: 50, pagato: false });
    expect((await req(rosa, 'POST', `/v1/carte/ordini/${orderId}/paga-prova`, { nome: 'Rosa Bianchi', riga1: 'Via Lunga 1', cap: '123', citta: 'Arogno', paese: 'CH' })).statusCode).toBe(400);
    expect((await req(rosa, 'POST', `/v1/carte/ordini/${orderId}/paga-prova`, { nome: 'Rosa Bianchi', presso: 'Casa anziani Al Lago', riga1: 'Via Lunga 1', cap: '6822', citta: 'Arogno', paese: 'CH' })).statusCode).toBe(200);
    expect(mailer.sent.at(-1)).toMatchObject({ to: rosa.email, subject: expect.stringContaining('in preparazione') });
    expect(mailer.sent.at(-1)!.text).toContain('c/o Casa anziani Al Lago');

    // Operatore (in prova: chiunque): abbina le carte e spedisce.
    const ordini = (await req(anna, 'GET', '/v1/operatore/carte/ordini')).json().ordini as { id: string; indirizzo: { citta: string; presso: string | null } }[];
    expect(ordini.find((o) => o.id === orderId)!.indirizzo).toMatchObject({ citta: 'Arogno', presso: 'Casa anziani Al Lago' });
    const prog = (await req(anna, 'GET', '/v1/operatore/carte/programma?uid=04de5f1eacc041')).json();
    expect(prog.chiaveFile).toMatch(/^[0-9A-F]{32}$/);
    expect(prog.collegamento).toContain('/c?picc=');
    expect((await req(anna, 'POST', `/v1/operatore/carte/ordini/${orderId}/spedito`, {})).statusCode).toBe(409);
    await req(anna, 'POST', `/v1/operatore/carte/ordini/${orderId}/carte`, { uid: '04DE5F1EACC041' });
    expect((await req(anna, 'POST', `/v1/operatore/carte/ordini/${orderId}/carte`, { uid: '04DE5F1EACC041' })).statusCode).toBe(409);
    await req(anna, 'POST', `/v1/operatore/carte/ordini/${orderId}/carte`, { uid: '04DE5F1EACC042' });
    expect((await req(anna, 'POST', `/v1/operatore/carte/ordini/${orderId}/spedito`, { tracking: '99.00.123456.78901234' })).statusCode).toBe(200);
    expect(mailer.sent.at(-1)!.text).toContain('99.00.123456.78901234');

    // Prima dell'attivazione la carta non avvisa nessuno; la attiva solo la proprietaria.
    expect((await tocco(null, '04DE5F1EACC041', 1)).esito).toBe('da-attivare');
    expect((await tocco(anna, '04DE5F1EACC041', 2)).esito).toBe('da-attivare');
    expect((await tocco(rosa, '04DE5F1EACC041', 3)).esito).toBe('attivata');

    // Chi la trova: vede il nome abbreviato e può avvisare.
    const t = await tocco(null, '04DE5F1EACC041', 4);
    expect(t).toMatchObject({ esito: 'valida', nome: 'Rosa B.', tua: false, fiducia: false });
    // Lo stesso collegamento una seconda volta (copiato o fotografato): non vale.
    expect((await req(null, 'GET', `/v1/carta?picc=${t.l.picc}&cmac=${t.l.cmac}`)).json().esito).toBe('ripetuta');
    // Codice di controllo sbagliato: non valida.
    const l5 = simulaLettura(Buffer.from(chiaveCarte), '04DE5F1EACC041', 5);
    expect((await req(null, 'GET', `/v1/carta?picc=${l5.picc}&cmac=0000000000000000`)).json().esito).toBe('non-valida');
    // La persona di fiducia, se ha l'accesso, può chiedere l'apertura.
    expect((await tocco(anna, '04DE5F1EACC041', 6)).fiducia).toBe(true);

    const prima = mailer.sent.length;
    const av = await req(null, 'POST', '/v1/carta/avvisa', { token: t.token, messaggio: 'Trovata sul treno per Lugano', contatto: '079 000 00 00' });
    expect(av.json()).toEqual({ avvisati: 1 });
    const nuove = mailer.sent.slice(prima);
    expect(nuove.map((m) => m.to).sort()).toEqual([anna.email, rosa.email].sort());
    expect(nuove.find((m) => m.to === anna.email)!.text).toContain('Trovata sul treno per Lugano');
    expect((await req(null, 'POST', '/v1/carta/avvisa', { token: t.token })).statusCode).toBe(409);
    // Al massimo 3 avvisi al giorno per carta.
    for (const ctr of [7, 8]) expect((await req(null, 'POST', '/v1/carta/avvisa', { token: (await tocco(null, '04DE5F1EACC041', ctr)).token })).statusCode).toBe(200);
    expect((await req(null, 'POST', '/v1/carta/avvisa', { token: (await tocco(null, '04DE5F1EACC041', 9)).token })).statusCode).toBe(429);

    // Carta persa: disattivata dalla proprietaria.
    const carte = (await req(rosa, 'GET', '/v1/carte')).json();
    expect(carte.carte).toHaveLength(2);
    expect(carte.ordini[0]).toMatchObject({ quantita: 2, chf: 50, stato: 'spedito', regalo: true });
    const attiva = carte.carte.find((c: { stato: string }) => c.stato === 'attiva');
    expect((await req(anna, 'POST', `/v1/carte/${attiva.id}/disattiva`)).statusCode).toBe(404);
    expect((await req(rosa, 'POST', `/v1/carte/${attiva.id}/disattiva`)).statusCode).toBe(200);
    expect((await tocco(null, '04DE5F1EACC041', 10)).esito).toBe('disattivata');
    // Carta sconosciuta.
    expect((await tocco(null, '04AAAAAAAAAAAA', 1)).esito).toBe('non-valida');
  });
});
