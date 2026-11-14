import { buildRecipientPackage, createReleaseSetup, decodePublicKey, decryptItem, encryptFile, encryptItem, fromUtf8, openPackageInner, openPackageOuter, ownerReleaseKey, utf8 } from '@memoriae/crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { items } from '../src/db/schema';
import { runJobs } from '../src/jobs/scheduler';
import { MemoryMailer } from '../src/mail/mailer';
import { MemoryBlobStore } from '../src/storage/blobs';
import { DevKeyCustody } from '../src/storage/custody';
import { createFakePasskeys, createTestDatabase } from './helpers';
import { createWorld, type TestUser } from './world';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance;
const mailer = new MemoryMailer();
const appOrigin = 'http://localhost:5173';
const { utente, inviteToken } = createWorld(() => app, mailer);
const DAY = 24 * 3600 * 1000;
const b64 = (k: Uint8Array) => Buffer.from(k).toString('base64url');

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  app = buildApp({
    db, custody: new DevKeyCustody(db, new Uint8Array(32).fill(6)), appOrigin, passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), mailer, cookieSecure: false, logLevel: 'silent',
    activation: { operatori: ['olga.l@example.ch'], chiaveDocumenti: new Uint8Array(32).fill(1), attesaMs: 1000 },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await close();
});

const req = (u: TestUser | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: u ? { cookie: u.session } : {}, payload: payload as never });

describe('lettere nel tempo', () => {
  it('chiuse fino al giorno scelto, poi avviso e apertura', async () => {
    const rosa = await utente('Rosa Bianchi', 'rosa.l@example.ch');
    const anna = await utente('Anna Verdi', 'anna.l@example.ch');
    const marco = await utente('Marco Bianchi', 'marco.l@example.ch');
    const olga = await utente('Olga Operatrice', 'olga.l@example.ch');
    const [annaId, marcoId, giuliaId] = [randomUUID(), randomUUID(), randomUUID()];
    await req(rosa, 'POST', '/v1/cassaforte/persone', { id: annaId, ruolo: 'fiduciario', nome: 'Anna Verdi', email: anna.email });
    await req(rosa, 'POST', '/v1/cassaforte/persone', { id: marcoId, ruolo: 'destinatario', nome: 'Marco Bianchi', email: marco.email });
    await req(rosa, 'POST', '/v1/cassaforte/persone', { id: giuliaId, ruolo: 'destinatario', nome: 'Giulia' });
    for (const [id, u] of [[annaId, anna], [marcoId, marco]] as const) {
      await req(rosa, 'POST', `/v1/cassaforte/persone/${id}/invito`);
      await req(u, 'POST', '/v1/inviti/accetta', { token: inviteToken(u.email) });
    }
    const list = (await req(rosa, 'GET', '/v1/cassaforte/persone')).json().persone as { id: string; chiavePubblica: string }[];
    const pk = async (id: string) => decodePublicKey(list.find((p) => p.id === id)!.chiavePubblica);
    const setup = await createReleaseSetup(rosa.vaultId, rosa.vaultKey, [{ personId: annaId, publicKey: await pk(annaId) }]);
    await req(rosa, 'PUT', '/v1/cassaforte/rilascio', {
      copiaProprietario: setup.ownerCopy,
      metaMemoriae: { decesso: b64(setup.memoriaeHalves.decesso), emergenza: b64(setup.memoriaeHalves.emergenza) },
      metaFiduciari: [{ personaId: annaId, sigillata: setup.sealedFiduciaryHalves[0]!.sealed }],
    });

    // Tre lettere: per Marco subito, per Marco fra due anni (con un audio), per Giulia fra due anni.
    const futuro = new Date(Date.now() + 730 * DAY).toISOString();
    const lettera = async (titolo: string, destinatarioId: string, consegnaIl: string | null) => {
      const id = randomUUID();
      const { item, itemKey } = await encryptItem(rosa.vaultKey, id, utf8(JSON.stringify({ titolo, note: `Testo: ${titolo}` })));
      const r = await req(rosa, 'POST', '/v1/cassaforte/voci', { id, tipo: 'lettera', chiaveVoceCifrata: item.wrappedItemKey, contenuto: item.content, lettera: { destinatarioId, consegnaIl } });
      expect(r.statusCode).toBe(201);
      return { id, itemKey, item };
    };
    // Una lettera senza destinatario, o con un destinatario di un'altra cassaforte, è rifiutata.
    const { item: x } = await encryptItem(rosa.vaultKey, randomUUID(), utf8('{}'));
    expect((await req(rosa, 'POST', '/v1/cassaforte/voci', { id: randomUUID(), tipo: 'lettera', chiaveVoceCifrata: x.wrappedItemKey, contenuto: x.content })).statusCode).toBe(400);
    expect((await req(rosa, 'POST', '/v1/cassaforte/voci', { id: randomUUID(), tipo: 'lettera', chiaveVoceCifrata: x.wrappedItemKey, contenuto: x.content, lettera: { destinatarioId: randomUUID(), consegnaIl: null } })).statusCode).toBe(400);

    const subito = await lettera('Per Marco, adesso', marcoId, null);
    const diciotto = await lettera('Per i tuoi 30 anni', marcoId, futuro);
    const perGiulia = await lettera('Per Giulia, quando sarai grande', giuliaId, futuro);
    const audioId = randomUUID();
    await app.inject({
      method: 'PUT', url: `/v1/cassaforte/voci/${diciotto.id}/file/${audioId}`,
      headers: { cookie: rosa.session, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(await encryptFile(diciotto.itemKey, `${diciotto.id}/${audioId}`, utf8('audio della nonna'))),
    });
    const mie = (await req(rosa, 'GET', '/v1/cassaforte/voci')).json().voci;
    expect(mie.find((v: { id: string }) => v.id === diciotto.id).lettera).toMatchObject({ destinatarioId: marcoId, consegnaIl: futuro });

    const kDec = await ownerReleaseKey(rosa.vaultId, rosa.vaultKey, setup.ownerCopy, 'decesso');
    const pMarco = await buildRecipientPackage({ vaultId: rosa.vaultId, packageId: `${marcoId}:decesso`, scope: 'decesso', releaseKey: kDec, recipientId: marcoId, recipientPublicKey: await pk(marcoId), items: [subito, diciotto].map((l) => ({ itemId: l.id, itemKey: l.itemKey })) });
    const pGiulia = await buildRecipientPackage({ vaultId: rosa.vaultId, packageId: `${giuliaId}:decesso`, scope: 'decesso', releaseKey: kDec, recipientId: giuliaId, items: [{ itemId: perGiulia.id, itemKey: perGiulia.itemKey }] });
    await req(rosa, 'PUT', '/v1/cassaforte/pacchetti', { riferimentoRilascio: setup.ownerCopy.nonce, pacchetti: [pMarco, pGiulia].map((p) => ({ destinatarioId: p.recipientId, ambito: p.scope, tipo: p.kind, esterno: p.outer })) });

    // Il giorno della lettera arriva mentre Rosa è in vita: nessun avviso.
    await db.update(items).set({ deliverAt: new Date(Date.now() - 1000) }).where(eq(items.id, perGiulia.id));
    expect((await runJobs({ db, mailer, appOrigin }, new Date())).lettere).toBe(0);
    await db.update(items).set({ deliverAt: new Date(futuro) }).where(eq(items.id, perGiulia.id));

    // Apertura per decesso.
    const caso = (await req(anna, 'POST', `/v1/fiducia/${rosa.vaultId}/richieste`, { ambito: 'decesso', motivo: 'Rosa è mancata il 3 novembre.' })).json().id;
    await req(olga, 'POST', `/v1/operatore/casi/${caso}/avvia`);
    await req(olga, 'POST', `/v1/operatore/casi/${caso}/approva`, {});
    await runJobs({ db, mailer, appOrigin }, new Date(Date.now() + 2000));
    // Il browser di Anna consegna il pacchetto a Marco (qui lo simuliamo con la chiave di rilascio).
    const interno = await openPackageOuter(rosa.vaultId, pMarco, kDec);
    expect((await req(anna, 'POST', `/v1/fiducia/casi/${caso}/consegne`, { destinatarioId: marcoId, interno })).statusCode).toBe(200);

    const ric = (await req(marco, 'GET', '/v1/ricevuti')).json().ricevuti[0];
    const chiavi = await openPackageInner('sealed-to-recipient', ric.interno, marco.keyPair);
    const voci = (await req(marco, 'GET', `/v1/ricevuti/${ric.id}/voci`)).json().voci;
    const v1 = voci.find((v: { id: string }) => v.id === subito.id);
    const v2 = voci.find((v: { id: string }) => v.id === diciotto.id);
    // La lettera «subito» si legge; quella con la data no: si sa solo quando arriverà.
    const k1 = chiavi.find((k) => k.itemId === subito.id)!.itemKey;
    expect(JSON.parse(fromUtf8(await decryptItem(k1, { itemId: subito.id, wrappedItemKey: v1.contenuto, content: v1.contenuto }))).titolo).toBe('Per Marco, adesso');
    expect(v2).toMatchObject({ contenuto: null, file: [], lettera: { aperta: false, consegnaIl: futuro } });
    expect((await req(marco, 'GET', `/v1/ricevuti/${ric.id}/voci/${diciotto.id}/file/${audioId}`)).statusCode).toBe(404);
    // Nemmeno la persona di fiducia può leggerla prima.
    expect((await req(anna, 'GET', `/v1/fiducia/casi/${caso}/voci`)).json().voci.find((v: { id: string }) => v.id === perGiulia.id).contenuto).toBeNull();

    // Il giorno arriva: avviso a Marco e alle persone di fiducia per Giulia (che non ha un account).
    await db.update(items).set({ deliverAt: new Date(Date.now() - 1000) }).where(eq(items.id, diciotto.id));
    await db.update(items).set({ deliverAt: new Date(Date.now() - 1000) }).where(eq(items.id, perGiulia.id));
    expect((await runJobs({ db, mailer, appOrigin }, new Date())).lettere).toBe(2);
    expect((await runJobs({ db, mailer, appOrigin }, new Date())).lettere).toBe(0);
    expect(mailer.sent.some((m) => m.to === marco.email && m.subject.includes('oggi si apre una lettera'))).toBe(true);
    expect(mailer.sent.some((m) => m.to === anna.email && m.subject.includes('per Giulia'))).toBe(true);

    const dopo = (await req(marco, 'GET', `/v1/ricevuti/${ric.id}/voci`)).json().voci.find((v: { id: string }) => v.id === diciotto.id);
    expect(dopo.lettera.aperta).toBe(true);
    const k2 = chiavi.find((k) => k.itemId === diciotto.id)!.itemKey;
    expect(JSON.parse(fromUtf8(await decryptItem(k2, { itemId: diciotto.id, wrappedItemKey: dopo.contenuto, content: dopo.contenuto }))).titolo).toBe('Per i tuoi 30 anni');
    expect((await req(marco, 'GET', `/v1/ricevuti/${ric.id}/voci/${diciotto.id}/file/${audioId}`)).statusCode).toBe(200);
  });
});
