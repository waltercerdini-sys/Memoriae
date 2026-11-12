import {
  buildRecipientPackage,
  createReleaseSetup,
  createVaultKey,
  decodePublicKey,
  decryptItem,
  deriveKeyFromPasskeySecret,
  deriveReleaseKeyAtActivation,
  encodePublicKey,
  encryptItem,
  fromUtf8,
  generateKey,
  generatePersonKeyPair,
  generateRecoveryCode,
  openPackageInner,
  openPackageOuter,
  ownerReleaseKey,
  recoveryVerifier,
  utf8,
  wrapPrivateKey,
  wrapVaultKey,
  type PersonKeyPair,
  type RecipientPackage,
} from '@memoriae/crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { custodyKeys, persons, recipientPackages, vaults } from '../src/db/schema';
import { MemoryMailer } from '../src/mail/mailer';
import { MemoryBlobStore } from '../src/storage/blobs';
import { DevKeyCustody } from '../src/storage/custody';
import { createFakePasskeys, createTestDatabase } from './helpers';
import { createWorld } from './world';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance;
let custody: DevKeyCustody;
const mailer = new MemoryMailer();

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  custody = new DevKeyCustody(db, new Uint8Array(32).fill(9));
  app = buildApp({ db, custody, appOrigin: 'http://localhost:5173', passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), mailer, cookieSecure: false, logLevel: 'silent' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await close();
});

const { utente, inviteToken } = createWorld(() => app, mailer);

describe('persone, inviti, rilascio e pacchetti', () => {
  it('percorso completo, fino alla prova che il rilascio funzionerebbe davvero', async () => {
    const rosa = await utente('Rosa Bianchi', 'rosa.p@example.ch');
    const anna = await utente('Anna Verdi', 'anna.p@example.ch');
    const marco = await utente('Marco Bianchi', 'marco.p@example.ch');

    // Rosa nomina Anna (fiducia), Marco (destinatario) e Giulia (destinataria senza account).
    const annaId = randomUUID();
    const marcoId = randomUUID();
    const giuliaId = randomUUID();
    for (const [id, ruolo, nome, email] of [
      [annaId, 'fiduciario', 'Anna Verdi', anna.email],
      [marcoId, 'destinatario', 'Marco Bianchi', marco.email],
      [giuliaId, 'destinatario', 'Giulia', undefined],
    ] as const) {
      const r = await app.inject({ method: 'POST', url: '/v1/cassaforte/persone', headers: { cookie: rosa.session }, payload: { id, ruolo, nome, email } });
      expect(r.statusCode).toBe(201);
    }

    // Inviti.
    expect((await app.inject({ method: 'POST', url: `/v1/cassaforte/persone/${annaId}/invito`, headers: { cookie: rosa.session } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/v1/cassaforte/persone/${marcoId}/invito`, headers: { cookie: rosa.session } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/v1/cassaforte/persone/${giuliaId}/invito`, headers: { cookie: rosa.session } })).statusCode).toBe(400);
    const tAnna = inviteToken(anna.email)!;
    const tMarco = inviteToken(marco.email)!;

    const info = await app.inject({ method: 'GET', url: `/v1/inviti/${tAnna}` });
    expect(info.json()).toEqual({ proprietario: 'Rosa Bianchi', ruolo: 'fiduciario', nome: 'Anna Verdi' });
    expect((await app.inject({ method: 'POST', url: '/v1/inviti/accetta', headers: { cookie: rosa.session }, payload: { token: tAnna } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/inviti/accetta', headers: { cookie: anna.session }, payload: { token: tAnna } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/inviti/accetta', headers: { cookie: marco.session }, payload: { token: tMarco } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/v1/inviti/${tAnna}` })).statusCode).toBe(404); // usato
    expect(mailer.sent.some((m) => m.to === rosa.email && m.subject.includes('Anna Verdi ha accettato'))).toBe(true);
    const fiducia = (await app.inject({ method: 'GET', url: '/v1/fiducia', headers: { cookie: anna.session } })).json();
    expect(fiducia.cassaforti).toEqual([{ ruolo: 'fiduciario', proprietario: 'Rosa Bianchi' }]);

    // Il browser di Rosa vede le chiavi pubbliche di chi ha accettato.
    const list = (await app.inject({ method: 'GET', url: '/v1/cassaforte/persone', headers: { cookie: rosa.session } })).json().persone;
    const pkAnna = await decodePublicKey(list.find((p: { id: string }) => p.id === annaId).chiavePubblica);
    const pkMarco = await decodePublicKey(list.find((p: { id: string }) => p.id === marcoId).chiavePubblica);
    expect(pkAnna).toEqual(anna.keyPair.publicKey);
    expect(list.find((p: { id: string }) => p.id === giuliaId).chiavePubblica).toBeNull();

    // Impostazione del rilascio (nel browser di Rosa).
    const setup = await createReleaseSetup(rosa.vaultId, rosa.vaultKey, [{ personId: annaId, publicKey: pkAnna }]);
    const b64 = (k: Uint8Array) => Buffer.from(k).toString('base64url');
    const badSetup = await app.inject({
      method: 'PUT',
      url: '/v1/cassaforte/rilascio',
      headers: { cookie: rosa.session },
      payload: { copiaProprietario: setup.ownerCopy, metaMemoriae: { decesso: b64(setup.memoriaeHalves.decesso), emergenza: b64(setup.memoriaeHalves.emergenza) }, metaFiduciari: [{ personaId: marcoId, sigillata: setup.sealedFiduciaryHalves[0]!.sealed }] },
    });
    expect(badSetup.statusCode).toBe(400); // Marco non è persona di fiducia
    const okSetup = await app.inject({
      method: 'PUT',
      url: '/v1/cassaforte/rilascio',
      headers: { cookie: rosa.session },
      payload: { copiaProprietario: setup.ownerCopy, metaMemoriae: { decesso: b64(setup.memoriaeHalves.decesso), emergenza: b64(setup.memoriaeHalves.emergenza) }, metaFiduciari: [{ personaId: annaId, sigillata: setup.sealedFiduciaryHalves[0]!.sealed }] },
    });
    expect(okSetup.statusCode).toBe(200);

    // Le metà MEMORIAE non stanno in chiaro nel database: solo riferimenti alla custodia.
    const [v] = await db.select().from(vaults).where(eq(vaults.id, rosa.vaultId));
    expect(v!.kmsRefDecesso).toMatch(/^[0-9a-f-]{36}$/);
    const custodyRows = await db.select().from(custodyKeys).where(eq(custodyKeys.vaultId, rosa.vaultId));
    expect(JSON.stringify(custodyRows)).not.toContain(b64(setup.memoriaeHalves.decesso));

    // Voci e pacchetti (nel browser di Rosa).
    const foto = await encryptItem(rosa.vaultKey, 'foto', utf8('Foto di famiglia'));
    const lettera = await encryptItem(rosa.vaultKey, 'lettera', utf8('Cara Giulia'));
    const banca = await encryptItem(rosa.vaultKey, 'banca', utf8('Banca: chiamare il consulente'));
    const kDec = await ownerReleaseKey(rosa.vaultId, rosa.vaultKey, setup.ownerCopy, 'decesso');
    const kEm = await ownerReleaseKey(rosa.vaultId, rosa.vaultKey, setup.ownerCopy, 'emergenza');
    const pk = (p: RecipientPackage) => ({ destinatarioId: p.recipientId, ambito: p.scope, tipo: p.kind, esterno: p.outer });
    const pMarco = await buildRecipientPackage({ vaultId: rosa.vaultId, packageId: `${marcoId}:decesso`, scope: 'decesso', releaseKey: kDec, recipientId: marcoId, recipientPublicKey: pkMarco, items: [{ itemId: 'foto', itemKey: foto.itemKey }] });
    const pGiulia = await buildRecipientPackage({ vaultId: rosa.vaultId, packageId: `${giuliaId}:decesso`, scope: 'decesso', releaseKey: kDec, recipientId: giuliaId, items: [{ itemId: 'lettera', itemKey: lettera.itemKey }] });
    const pAnnaEm = await buildRecipientPackage({ vaultId: rosa.vaultId, packageId: `${annaId}:emergenza`, scope: 'emergenza', releaseKey: kEm, recipientId: annaId, recipientPublicKey: pkAnna, items: [{ itemId: 'banca', itemKey: banca.itemKey }] });
    const stale = await app.inject({ method: 'PUT', url: '/v1/cassaforte/pacchetti', headers: { cookie: rosa.session }, payload: { riferimentoRilascio: 'A'.repeat(32), pacchetti: [pk(pMarco)] } });
    expect(stale.statusCode).toBe(409);
    const put = await app.inject({ method: 'PUT', url: '/v1/cassaforte/pacchetti', headers: { cookie: rosa.session }, payload: { riferimentoRilascio: setup.ownerCopy.nonce, pacchetti: [pk(pMarco), pk(pGiulia), pk(pAnnaEm)] } });
    expect(put.json()).toEqual({ ok: true, numero: 3 });

    // Una seconda impostazione (per esempio da due schede aperte insieme) viene rifiutata.
    const again = await app.inject({
      method: 'PUT',
      url: '/v1/cassaforte/rilascio',
      headers: { cookie: rosa.session },
      payload: { copiaProprietario: setup.ownerCopy, metaMemoriae: { decesso: b64(setup.memoriaeHalves.decesso), emergenza: b64(setup.memoriaeHalves.emergenza) }, metaFiduciari: [{ personaId: annaId, sigillata: setup.sealedFiduciaryHalves[0]!.sealed }] },
    });
    expect(again.statusCode).toBe(409);

    // ---- Prova del rilascio (quello che farà il blocco 6, dopo verifica e attesa) ----
    const [anaRow] = await db.select().from(persons).where(eq(persons.id, annaId));
    const stored = await db.select().from(recipientPackages).where(eq(recipientPackages.vaultId, rosa.vaultId));
    const asPkg = (r: (typeof stored)[number]): RecipientPackage => ({ packageId: `${r.recipientId}:${r.scope}`, scope: r.scope, recipientId: r.recipientId, kind: r.kind, outer: r.outer as RecipientPackage['outer'] });
    const releaseKey = await deriveReleaseKeyAtActivation({
      vaultId: rosa.vaultId,
      scope: 'decesso',
      memoriaeHalf: await custody.reveal(v!.kmsRefDecesso!),
      sealedFiduciaryHalf: { personId: annaId, sealed: anaRow!.sealedFiduciaryHalf! },
      fiduciaryKeyPair: anna.keyPair,
    });
    const forMarco = stored.find((r) => r.recipientId === marcoId)!;
    const inner = await openPackageOuter(rosa.vaultId, asPkg(forMarco), releaseKey);
    const keys = await openPackageInner('sealed-to-recipient', inner, marco.keyPair);
    expect(fromUtf8(await decryptItem(keys[0]!.itemKey, foto.item))).toBe('Foto di famiglia');
    // Il pacchetto d'emergenza non si apre con la chiave del decesso.
    await expect(openPackageOuter(rosa.vaultId, asPkg(stored.find((r) => r.scope === 'emergenza')!), releaseKey)).rejects.toThrow();
  });

  it('un estraneo non vede né modifica le persone di altri', async () => {
    const a = await utente('Ada', 'ada.p@example.ch');
    const b = await utente('Bruno', 'bruno.p@example.ch');
    const id = randomUUID();
    await app.inject({ method: 'POST', url: '/v1/cassaforte/persone', headers: { cookie: a.session }, payload: { id, ruolo: 'fiduciario', nome: 'X', email: 'x@example.ch' } });
    expect((await app.inject({ method: 'DELETE', url: `/v1/cassaforte/persone/${id}`, headers: { cookie: b.session } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/v1/cassaforte/persone/${id}/invito`, headers: { cookie: b.session } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/cassaforte/persone', headers: { cookie: b.session } })).json().persone).toEqual([]);
  });

  it('pacchetti rifiutati prima di impostare il rilascio o per destinatari senza chiave', async () => {
    const a = await utente('Carla', 'carla.p@example.ch');
    const id = randomUUID();
    await app.inject({ method: 'POST', url: '/v1/cassaforte/persone', headers: { cookie: a.session }, payload: { id, ruolo: 'destinatario', nome: 'Y' } });
    const fakeEnv = { v: 1, alg: 'xchacha20poly1305-ietf', nonce: 'A'.repeat(32), ct: 'AAAA' };
    const res = await app.inject({ method: 'PUT', url: '/v1/cassaforte/pacchetti', headers: { cookie: a.session }, payload: { riferimentoRilascio: 'A'.repeat(32), pacchetti: [{ destinatarioId: id, ambito: 'decesso', tipo: 'release-only', esterno: fakeEnv }] } });
    expect(res.statusCode).toBe(409);
  });
});
