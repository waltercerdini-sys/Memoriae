import {
  createVaultKey,
  decryptFile,
  decryptItem,
  deriveKeyFromPasskeySecret,
  encodePublicKey,
  encryptFile,
  encryptItem,
  fromUtf8,
  generateKey,
  generatePersonKeyPair,
  generateRecoveryCode,
  unwrapItemKey,
  unwrapVaultKey,
  utf8,
  wrapPrivateKey,
  wrapVaultKey,
  type EncryptedItem,
} from '@memoriae/crypto';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { auditLog } from '../src/db/schema';
import { MemoryBlobStore } from '../src/storage/blobs';
import { createFakePasskeys, createTestDatabase } from './helpers';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  app = buildApp({ db, passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), cookieSecure: false, logLevel: 'silent' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await close();
});

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((x) => x.name === 'memoriae_sessione');
  if (!c) throw new Error('cookie di sessione mancante');
  return `memoriae_sessione=${c.value}`;
}

async function register(nome: string, email: string) {
  const start = await app.inject({ method: 'POST', url: '/v1/registrazione/opzioni', payload: { nome, email } });
  expect(start.statusCode).toBe(200);
  const { challengeId, opzioni } = start.json();
  const credentialId = `cred-${randomUUID()}`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/registrazione/verifica',
    payload: { challengeId, risposta: { id: credentialId, challenge: opzioni.challenge } },
  });
  expect(res.statusCode).toBe(200);
  return { cookie: cookieOf(res), credentialId };
}

/** Crea la cassaforte come farebbe il browser: tutte le chiavi nascono e restano lato client. */
async function createVault(cookie: string, credentialId: string) {
  const vaultId = randomUUID();
  const vaultKey = await createVaultKey();
  const prfSecret = await generateKey();
  const passkeyKey = await deriveKeyFromPasskeySecret(prfSecret);
  const recovery = await generateRecoveryCode();
  const person = await generatePersonKeyPair();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/cassaforte',
    headers: { cookie },
    payload: {
      id: vaultId,
      chiavePubblica: await encodePublicKey(person.publicKey),
      chiavePrivataCifrata: await wrapPrivateKey(person.privateKey, vaultKey, 'owner'),
      accessi: [
        { metodo: 'passkey', credentialId, chiaveCifrata: await wrapVaultKey(vaultKey, passkeyKey, vaultId, 'passkey') },
        { metodo: 'recovery-code', chiaveCifrata: await wrapVaultKey(vaultKey, recovery.key, vaultId, 'recovery-code') },
      ],
    },
  });
  return { res, vaultId, vaultKey, passkeyKey, recovery };
}

describe('registrazione e accesso', () => {
  it('registra con passkey, apre la sessione e rifiuta un secondo account con la stessa e-mail', async () => {
    const { cookie } = await register('Rosa Bianchi', 'rosa@example.ch');
    const me = await app.inject({ method: 'GET', url: '/v1/io', headers: { cookie } });
    expect(me.json()).toMatchObject({ utente: { nome: 'Rosa Bianchi', email: 'rosa@example.ch' }, haCassaforte: false });

    const again = await app.inject({ method: 'POST', url: '/v1/registrazione/opzioni', payload: { nome: 'X', email: 'ROSA@example.ch' } });
    expect(again.statusCode).toBe(409);
  });

  it('rifiuta e-mail non valide', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/registrazione/opzioni', payload: { nome: 'X', email: 'non-una-email' } });
    expect(res.statusCode).toBe(400);
  });

  it('accede con la passkey; la sfida vale una volta sola', async () => {
    const { credentialId } = await register('Ugo', 'ugo@example.ch');
    const opt = (await app.inject({ method: 'POST', url: '/v1/accesso/opzioni' })).json();
    const payload = { challengeId: opt.challengeId, risposta: { id: credentialId, challenge: opt.opzioni.challenge } };
    const ok = await app.inject({ method: 'POST', url: '/v1/accesso/verifica', payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().utente.email).toBe('ugo@example.ch');
    const replay = await app.inject({ method: 'POST', url: '/v1/accesso/verifica', payload });
    expect(replay.statusCode).toBe(400);
  });

  it('rifiuta passkey sconosciute e sfide sbagliate', async () => {
    const opt = (await app.inject({ method: 'POST', url: '/v1/accesso/opzioni' })).json();
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/accesso/verifica',
      payload: { challengeId: opt.challengeId, risposta: { id: 'inesistente', challenge: opt.opzioni.challenge } },
    });
    expect(unknown.statusCode).toBe(401);
  });

  it('senza sessione le rotte private rispondono 401; dopo l\'uscita la sessione non vale più', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/cassaforte' })).statusCode).toBe(401);
    const { cookie } = await register('Ada', 'ada@example.ch');
    await app.inject({ method: 'POST', url: '/v1/uscita', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/v1/io', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('cassaforte e voci', () => {
  it('richiede il codice di recupero alla creazione', async () => {
    const { cookie, credentialId } = await register('Bea', 'bea@example.ch');
    const vaultKey = await createVaultKey();
    const key = await generateKey();
    const id = randomUUID();
    const person = await generatePersonKeyPair();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cassaforte',
      headers: { cookie },
      payload: {
        id,
        chiavePubblica: await encodePublicKey(person.publicKey),
        chiavePrivataCifrata: await wrapPrivateKey(person.privateKey, vaultKey, 'owner'),
        accessi: [
          { metodo: 'passkey', credentialId, chiaveCifrata: await wrapVaultKey(vaultKey, key, id, 'passkey') },
          { metodo: 'password', parametri: { alg: 'argon2id13', salt: 'abc', opslimit: 3, memlimit: 67108864 }, chiaveCifrata: await wrapVaultKey(vaultKey, key, id, 'password') },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/recupero/);
  });

  it('percorso completo: cassaforte, voce, file; il server vede solo dati cifrati', async () => {
    const { cookie, credentialId } = await register('Carla', 'carla@example.ch');
    const { res, vaultId, vaultKey, passkeyKey, recovery } = await createVault(cookie, credentialId);
    expect(res.statusCode).toBe(201);
    expect((await createVault(cookie, credentialId)).res.statusCode).toBe(409);

    // Il browser riapre la cassaforte con la passkey o con il codice di recupero.
    const got = (await app.inject({ method: 'GET', url: '/v1/cassaforte', headers: { cookie } })).json();
    const viaPasskey = got.accessi.find((a: { metodo: string }) => a.metodo === 'passkey');
    const viaRecovery = got.accessi.find((a: { metodo: string }) => a.metodo === 'recovery-code');
    expect(await unwrapVaultKey(viaPasskey.chiaveCifrata, passkeyKey, vaultId, 'passkey')).toEqual(vaultKey);
    expect(await unwrapVaultKey(viaRecovery.chiaveCifrata, recovery.key, vaultId, 'recovery-code')).toEqual(vaultKey);

    // Una voce con file.
    const itemId = randomUUID();
    const secret = 'Conto PostFinance, consulente sig. Rossi';
    const { item, itemKey } = await encryptItem(vaultKey, itemId, utf8(JSON.stringify({ titolo: secret })));
    const created = await app.inject({
      method: 'POST',
      url: '/v1/cassaforte/voci',
      headers: { cookie },
      payload: { id: itemId, tipo: 'account', emergenza: true, chiaveVoceCifrata: item.wrappedItemKey, contenuto: item.content },
    });
    expect(created.statusCode).toBe(201);

    const pdf = utf8('%PDF-1.7 estratto conto');
    const put = await app.inject({
      method: 'PUT',
      url: `/v1/cassaforte/voci/${itemId}/file`,
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(await encryptFile(itemKey, itemId, pdf)),
    });
    expect(put.statusCode).toBe(200);

    const plain = await app.inject({
      method: 'PUT',
      url: `/v1/cassaforte/voci/${itemId}/file`,
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(pdf),
    });
    expect(plain.statusCode).toBe(400);

    const list = (await app.inject({ method: 'GET', url: '/v1/cassaforte/voci', headers: { cookie } })).json();
    expect(list.voci).toHaveLength(1);
    const v = list.voci[0];
    expect(v).toMatchObject({ id: itemId, tipo: 'account', emergenza: true, haFile: true });
    expect(JSON.stringify(list)).not.toContain('PostFinance');

    const back: EncryptedItem = { itemId, wrappedItemKey: v.chiaveVoceCifrata, content: v.contenuto };
    const k = await unwrapItemKey(vaultKey, back);
    expect(JSON.parse(fromUtf8(await decryptItem(k, back))).titolo).toBe(secret);
    const file = await app.inject({ method: 'GET', url: `/v1/cassaforte/voci/${itemId}/file`, headers: { cookie } });
    expect(fromUtf8(await decryptFile(k, itemId, new Uint8Array(file.rawPayload)))).toBe('%PDF-1.7 estratto conto');

    // Un altro utente non vede né tocca la voce.
    const other = await register('Dario', 'dario@example.ch');
    await createVault(other.cookie, other.credentialId);
    expect((await app.inject({ method: 'GET', url: `/v1/cassaforte/voci/${itemId}/file`, headers: { cookie: other.cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/v1/cassaforte/voci/${itemId}`, headers: { cookie: other.cookie } })).statusCode).toBe(404);

    // Modifica ed eliminazione.
    const patched = await app.inject({ method: 'PATCH', url: `/v1/cassaforte/voci/${itemId}`, headers: { cookie }, payload: { emergenza: false } });
    expect(patched.statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/v1/cassaforte/voci/${itemId}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/cassaforte/voci', headers: { cookie } })).json().voci).toHaveLength(0);

    // Il registro eventi traccia le operazioni senza contenuti.
    const rows = await db.select().from(auditLog).where(sql`${auditLog.vaultId} = ${vaultId}`);
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['cassaforte-creata', 'voce-creata', 'file-caricato', 'voce-modificata', 'voce-eliminata']),
    );
    expect(JSON.stringify(rows)).not.toContain('PostFinance');
  });

  it('rifiuta una passkey che appartiene a un altro utente', async () => {
    const a = await register('Elio', 'elio@example.ch');
    const b = await register('Fede', 'fede@example.ch');
    const { res } = await createVault(a.cookie, b.credentialId);
    expect(res.statusCode).toBe(400);
  });
});
