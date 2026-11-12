import {
  buildRecipientPackage,
  createReleaseSetup,
  decodePublicKey,
  decryptItem,
  deriveReleaseKeyAtActivation,
  encryptItem,
  fromUtf8,
  openPackageInner,
  openPackageOuter,
  ownerReleaseKey,
  utf8,
  type RecipientPackage,
} from '@memoriae/crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { activationCases, auditLog } from '../src/db/schema';
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
const blobs = new MemoryBlobStore();
const { utente, linkToken, inviteToken } = createWorld(() => app, mailer);
const HOUR = 3600 * 1000;
const b64 = (k: Uint8Array) => Buffer.from(k).toString('base64url');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  app = buildApp({
    db,
    custody: new DevKeyCustody(db, new Uint8Array(32).fill(5)),
    appOrigin,
    passkeys: createFakePasskeys(),
    blobs,
    mailer,
    cookieSecure: false,
    logLevel: 'silent',
    activation: { operatori: ['oscar.a@example.ch'], chiaveDocumenti: new Uint8Array(32).fill(8) },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await close();
});

const req = (u: TestUser | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) =>
  app.inject({ method, url, headers: u ? { cookie: u.session } : {}, payload: payload as never });

describe('attivazione: richiesta, verifica, attesa, blocco, rilascio, consegna', () => {
  it('percorso completo', async () => {
    const rosa = await utente('Rosa Bianchi', 'rosa.a@example.ch');
    const anna = await utente('Anna Verdi', 'anna.a@example.ch');
    const marco = await utente('Marco Bianchi', 'marco.a@example.ch');
    const oscar = await utente('Oscar Operatore', 'oscar.a@example.ch');
    const estraneo = await utente('Ugo', 'ugo.a@example.ch');

    // --- Preparazione, come nel browser di Rosa ---
    const annaId = randomUUID();
    const marcoId = randomUUID();
    const giuliaId = randomUUID();
    await req(rosa, 'POST', '/v1/cassaforte/persone', { id: annaId, ruolo: 'fiduciario', nome: 'Anna Verdi', email: anna.email });
    await req(rosa, 'POST', '/v1/cassaforte/persone', { id: marcoId, ruolo: 'destinatario', nome: 'Marco Bianchi', email: marco.email });
    await req(rosa, 'POST', '/v1/cassaforte/persone', { id: giuliaId, ruolo: 'destinatario', nome: 'Giulia' });
    for (const [id, u] of [[annaId, anna], [marcoId, marco]] as const) {
      await req(rosa, 'POST', `/v1/cassaforte/persone/${id}/invito`);
      expect((await req(u, 'POST', '/v1/inviti/accetta', { token: inviteToken(u.email) })).statusCode).toBe(200);
    }
    const list = (await req(rosa, 'GET', '/v1/cassaforte/persone')).json().persone as { id: string; chiavePubblica: string }[];
    const pkOf = async (id: string) => decodePublicKey(list.find((p) => p.id === id)!.chiavePubblica);
    const setup = await createReleaseSetup(rosa.vaultId, rosa.vaultKey, [{ personId: annaId, publicKey: await pkOf(annaId) }]);
    expect(
      (
        await req(rosa, 'PUT', '/v1/cassaforte/rilascio', {
          copiaProprietario: setup.ownerCopy,
          metaMemoriae: { decesso: b64(setup.memoriaeHalves.decesso), emergenza: b64(setup.memoriaeHalves.emergenza) },
          metaFiduciari: [{ personaId: annaId, sigillata: setup.sealedFiduciaryHalves[0]!.sealed }],
        })
      ).statusCode,
    ).toBe(200);

    const voce = async (testo: string, emergenza: boolean) => {
      const id = randomUUID();
      const { item, itemKey } = await encryptItem(rosa.vaultKey, id, utf8(JSON.stringify({ titolo: testo })));
      await req(rosa, 'POST', '/v1/cassaforte/voci', { id, tipo: 'account', emergenza, chiaveVoceCifrata: item.wrappedItemKey, contenuto: item.content });
      return { id, itemKey };
    };
    const foto = await voce('Foto di famiglia', false);
    const lettera = await voce('Cara Giulia', false);
    const banca = await voce('Banca: chiamare il consulente', true);
    const kDec = await ownerReleaseKey(rosa.vaultId, rosa.vaultKey, setup.ownerCopy, 'decesso');
    const kEm = await ownerReleaseKey(rosa.vaultId, rosa.vaultKey, setup.ownerCopy, 'emergenza');
    const pkgs = [
      await buildRecipientPackage({ vaultId: rosa.vaultId, packageId: `${marcoId}:decesso`, scope: 'decesso', releaseKey: kDec, recipientId: marcoId, recipientPublicKey: await pkOf(marcoId), items: [{ itemId: foto.id, itemKey: foto.itemKey }] }),
      await buildRecipientPackage({ vaultId: rosa.vaultId, packageId: `${giuliaId}:decesso`, scope: 'decesso', releaseKey: kDec, recipientId: giuliaId, items: [{ itemId: lettera.id, itemKey: lettera.itemKey }] }),
      await buildRecipientPackage({ vaultId: rosa.vaultId, packageId: `${annaId}:emergenza`, scope: 'emergenza', releaseKey: kEm, recipientId: annaId, recipientPublicKey: await pkOf(annaId), items: [{ itemId: banca.id, itemKey: banca.itemKey }] }),
    ];
    const pk = (p: RecipientPackage) => ({ destinatarioId: p.recipientId, ambito: p.scope, tipo: p.kind, esterno: p.outer });
    expect((await req(rosa, 'PUT', '/v1/cassaforte/pacchetti', { riferimentoRilascio: setup.ownerCopy.nonce, pacchetti: pkgs.map(pk) })).statusCode).toBe(200);

    // --- Richiesta: solo una persona di fiducia, con una spiegazione ---
    const url = `/v1/fiducia/${rosa.vaultId}/richieste`;
    expect((await req(marco, 'POST', url, { ambito: 'decesso', motivo: 'Mia madre è mancata ieri.' })).statusCode).toBe(403);
    expect((await req(estraneo, 'POST', url, { ambito: 'decesso', motivo: 'Mia madre è mancata ieri.' })).statusCode).toBe(403);
    expect((await req(anna, 'POST', url, { ambito: 'decesso', motivo: 'corto' })).statusCode).toBe(400);
    const r1 = await req(anna, 'POST', url, { ambito: 'decesso', motivo: 'Rosa è mancata il 3 novembre.' });
    expect(r1.statusCode).toBe(201);
    expect((await req(anna, 'POST', url, { ambito: 'decesso', motivo: 'Seconda richiesta uguale.' })).statusCode).toBe(409);
    expect(mailer.sent.some((m) => m.to === oscar.email && m.subject.includes('nuova richiesta'))).toBe(true);

    // --- Rosa sta bene: blocca con il collegamento dell'e-mail ---
    const block1 = linkToken(rosa.email, 'blocca')!;
    expect((await req(null, 'GET', `/v1/blocca/${block1}`)).json()).toMatchObject({ richiedente: 'Anna Verdi', ambito: 'decesso', stato: 'richiesta' });
    expect((await req(null, 'POST', `/v1/blocca/${block1}`)).statusCode).toBe(200);
    expect((await req(null, 'POST', `/v1/blocca/${block1}`)).statusCode).toBe(404);
    expect(mailer.sent.some((m) => m.to === anna.email && m.subject.includes('ha bloccato'))).toBe(true);

    // --- Emergenza: documento, verifica dell'operatore, attesa di 72 ore ---
    const r2 = await req(anna, 'POST', url, { ambito: 'emergenza', motivo: 'Rosa è ricoverata in ospedale, non può parlare.' });
    const em = r2.json().id as string;
    const doc = await app.inject({ method: 'PUT', url: `/v1/fiducia/casi/${em}/documenti?nome=attestazione.pdf&tipo=application/pdf`, headers: { cookie: anna.session, 'content-type': 'application/octet-stream' }, payload: Buffer.from('%PDF certificato') });
    expect(doc.statusCode).toBe(200);

    expect((await req(rosa, 'GET', '/v1/operatore/casi')).statusCode).toBe(403);
    const casi = (await req(oscar, 'GET', '/v1/operatore/casi')).json().casi;
    const visto = casi.find((c: { id: string }) => c.id === em);
    expect(visto).toMatchObject({ stato: 'richiesta', proprietario: { nome: 'Rosa Bianchi' }, richiedente: { nome: 'Anna Verdi' } });
    const scaricato = await req(oscar, 'GET', `/v1/operatore/casi/${em}/documenti/${visto.documenti[0].id}`);
    expect(scaricato.body).toBe('%PDF certificato');
    expect(JSON.stringify([...(blobs as unknown as { data: Map<string, Uint8Array> }).data.values()].map((b) => Buffer.from(b).toString()))).not.toContain('certificato');

    expect((await req(anna, 'GET', `/v1/fiducia/casi/${em}/rilascio`)).statusCode).toBe(403); // non ancora
    expect((await req(oscar, 'POST', `/v1/operatore/casi/${em}/approva`, {})).statusCode).toBe(409); // prima la verifica
    expect((await req(oscar, 'POST', `/v1/operatore/casi/${em}/avvia`)).statusCode).toBe(200);
    const ok = await req(oscar, 'POST', `/v1/operatore/casi/${em}/approva`, { nota: 'Attestazione del reparto verificata al telefono' });
    expect(ok.statusCode).toBe(200);
    const until = new Date(ok.json().attesaFinoAl).getTime();
    expect(until - Date.now()).toBeGreaterThan(71 * HOUR);

    // Durante l'attesa nulla si apre.
    expect((await runJobs({ db, mailer, appOrigin }, new Date(until - HOUR))).rilasci).toBe(0);
    expect((await req(anna, 'GET', `/v1/fiducia/casi/${em}/rilascio`)).statusCode).toBe(403);
    expect((await runJobs({ db, mailer, appOrigin }, new Date(until + 1000))).rilasci).toBe(1);
    expect(mailer.sent.some((m) => m.to === anna.email && m.subject.includes('puoi aprire'))).toBe(true);

    // --- Anna apre l'emergenza nel suo browser ---
    const ril = (await req(anna, 'GET', `/v1/fiducia/casi/${em}/rilascio`)).json();
    const keyEm = await deriveReleaseKeyAtActivation({ vaultId: rosa.vaultId, scope: 'emergenza', memoriaeHalf: fromB64(ril.metaMemoriae), sealedFiduciaryHalf: { personId: annaId, sealed: ril.metaFiduciario.sigillata }, fiduciaryKeyPair: anna.keyPair });
    const mio = ril.pacchetti.find((p: { destinatarioId: string }) => p.destinatarioId === annaId);
    const asPkg = (p: { destinatarioId: string; tipo: RecipientPackage['kind']; esterno: RecipientPackage['outer'] }, scope: 'decesso' | 'emergenza'): RecipientPackage => ({ packageId: `${p.destinatarioId}:${scope}`, scope, recipientId: p.destinatarioId, kind: p.tipo, outer: p.esterno });
    const keysEm = await openPackageInner('sealed-to-recipient', await openPackageOuter(rosa.vaultId, asPkg(mio, 'emergenza'), keyEm), anna.keyPair);
    const vociEm = (await req(anna, 'GET', `/v1/fiducia/casi/${em}/voci`)).json().voci;
    expect(vociEm.map((v: { id: string }) => v.id)).toEqual([banca.id]); // in emergenza solo le voci d'emergenza
    const plain = await decryptItem(keysEm[0]!.itemKey, { itemId: banca.id, wrappedItemKey: vociEm[0].contenuto, content: vociEm[0].contenuto });
    expect(JSON.parse(fromUtf8(plain)).titolo).toBe('Banca: chiamare il consulente');

    // Rosa guarisce e chiude l'accesso.
    expect((await req(rosa, 'POST', `/v1/cassaforte/casi/${em}/chiudi`)).statusCode).toBe(200);
    expect((await req(anna, 'GET', `/v1/fiducia/casi/${em}/rilascio`)).statusCode).toBe(403);

    // --- Decesso: verifica, attesa di 14 giorni, consegna a Marco e a Giulia ---
    const dec = (await req(anna, 'POST', url, { ambito: 'decesso', motivo: 'Rosa è mancata il 3 novembre, allego il certificato.' })).json().id as string;
    await req(oscar, 'POST', `/v1/operatore/casi/${dec}/avvia`);
    const okDec = (await req(oscar, 'POST', `/v1/operatore/casi/${dec}/approva`, {})).json();
    const untilDec = new Date(okDec.attesaFinoAl).getTime();
    expect(untilDec - Date.now()).toBeGreaterThan(13.9 * 24 * HOUR);
    await runJobs({ db, mailer, appOrigin }, new Date(untilDec + 1000));

    const rd = (await req(anna, 'GET', `/v1/fiducia/casi/${dec}/rilascio`)).json();
    expect(rd.pacchetti.map((p: { nome: string }) => p.nome).sort()).toEqual(['Giulia', 'Marco Bianchi']);
    const keyDec = await deriveReleaseKeyAtActivation({ vaultId: rosa.vaultId, scope: 'decesso', memoriaeHalf: fromB64(rd.metaMemoriae), sealedFiduciaryHalf: { personId: annaId, sealed: rd.metaFiduciario.sigillata }, fiduciaryKeyPair: anna.keyPair });
    const pMarco = rd.pacchetti.find((p: { destinatarioId: string }) => p.destinatarioId === marcoId);
    const pGiulia = rd.pacchetti.find((p: { destinatarioId: string }) => p.destinatarioId === giuliaId);
    const innerMarco = await openPackageOuter(rosa.vaultId, asPkg(pMarco, 'decesso'), keyDec);
    // Anna non può leggere il pacchetto di Marco: è cifrato per lui.
    await expect(openPackageInner('sealed-to-recipient', innerMarco, anna.keyPair)).rejects.toThrow();
    expect((await req(anna, 'POST', `/v1/fiducia/casi/${dec}/consegne`, { destinatarioId: giuliaId, interno: 'x' })).statusCode).toBe(404); // Giulia non ha account
    expect((await req(anna, 'POST', `/v1/fiducia/casi/${dec}/consegne`, { destinatarioId: marcoId, interno: innerMarco })).statusCode).toBe(200);
    expect(mailer.sent.some((m) => m.to === marco.email && m.subject.includes('ti ha lasciato'))).toBe(true);

    // Giulia: il pacchetto «solo rilascio» lo apre Anna, che glielo consegnerà a mano.
    const keysGiulia = await openPackageInner('release-only', await openPackageOuter(rosa.vaultId, asPkg(pGiulia, 'decesso'), keyDec));
    const vociDec = (await req(anna, 'GET', `/v1/fiducia/casi/${dec}/voci`)).json().voci;
    const vl = vociDec.find((v: { id: string }) => v.id === lettera.id);
    expect(JSON.parse(fromUtf8(await decryptItem(keysGiulia[0]!.itemKey, { itemId: lettera.id, wrappedItemKey: vl.contenuto, content: vl.contenuto }))).titolo).toBe('Cara Giulia');

    // Marco apre il suo pacchetto con la propria chiave.
    expect((await req(estraneo, 'GET', '/v1/ricevuti')).json().ricevuti).toEqual([]);
    const ric = (await req(marco, 'GET', '/v1/ricevuti')).json().ricevuti;
    expect(ric).toHaveLength(1);
    expect(ric[0].proprietario).toBe('Rosa Bianchi');
    const keysMarco = await openPackageInner('sealed-to-recipient', ric[0].interno, marco.keyPair);
    const vm = (await req(marco, 'GET', `/v1/ricevuti/${ric[0].id}/voci`)).json().voci.find((v: { id: string }) => v.id === foto.id);
    expect(JSON.parse(fromUtf8(await decryptItem(keysMarco[0]!.itemKey, { itemId: foto.id, wrappedItemKey: vm.contenuto, content: vm.contenuto }))).titolo).toBe('Foto di famiglia');
    expect((await req(estraneo, 'GET', `/v1/ricevuti/${ric[0].id}/voci`)).statusCode).toBe(404);

    // Tutto è registrato.
    const azioni = (await db.select().from(auditLog).where(eq(auditLog.vaultId, rosa.vaultId))).map((r) => r.action);
    for (const a of ['attivazione-richiesta', 'attivazione-bloccata', 'verifica-approvata', 'attivazione-rilasciata', 'meta-memoriae-consegnata', 'pacchetto-consegnato', 'emergenza-chiusa']) {
      expect(azioni).toContain(a);
    }
  });

  it("l'operatore non decide sulle cassaforti in cui è coinvolto", async () => {
    const op = await utente('Olga', 'olga.a@example.ch');
    const amica = await utente('Bea', 'bea.a@example.ch');
    // Bea nomina Olga persona di fiducia; poi Olga diventa operatrice (stessa installazione con un'altra lista).
    const id = randomUUID();
    await req(amica, 'POST', '/v1/cassaforte/persone', { id, ruolo: 'fiduciario', nome: 'Olga', email: op.email });
    await req(amica, 'POST', `/v1/cassaforte/persone/${id}/invito`);
    await req(op, 'POST', '/v1/inviti/accetta', { token: inviteToken(op.email) });
    const c = (await req(op, 'POST', `/v1/fiducia/${amica.vaultId}/richieste`, { ambito: 'emergenza', motivo: 'Bea ha avuto un incidente.' })).json().id;
    const [row] = await db.select().from(activationCases).where(eq(activationCases.id, c));
    expect(row!.status).toBe('richiesta');
    // La stessa persona con il ruolo di operatore (modalità prova): non vede né approva il caso.
    const prova = buildApp({ db, custody: new DevKeyCustody(db, new Uint8Array(32).fill(5)), appOrigin, passkeys: createFakePasskeys(), blobs, mailer, cookieSecure: false, logLevel: 'silent' });
    await prova.ready();
    const list = await prova.inject({ method: 'GET', url: '/v1/operatore/casi', headers: { cookie: op.session } });
    expect(list.json().casi.find((x: { id: string }) => x.id === c)).toBeUndefined();
    expect((await prova.inject({ method: 'POST', url: `/v1/operatore/casi/${c}/avvia`, headers: { cookie: op.session } })).statusCode).toBe(403);
    expect((await prova.inject({ method: 'POST', url: `/v1/operatore/casi/${c}/avvia`, headers: { cookie: amica.session } })).statusCode).toBe(403);
    await prova.close();
  });
});
