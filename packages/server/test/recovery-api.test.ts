import {
  createVaultKey,
  deriveKeyFromPasskeySecret,
  encodePublicKey,
  generateKey,
  generatePersonKeyPair,
  generateRecoveryCode,
  recoveryKeyFromCode,
  recoveryVerifier,
  unwrapVaultKey,
  wrapPrivateKey,
  wrapVaultKey,
} from '@memoriae/crypto';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';
import { MemoryMailer } from '../src/mail/mailer';
import { MemoryBlobStore } from '../src/storage/blobs';
import { DevKeyCustody } from '../src/storage/custody';
import { createFakePasskeys, createTestDatabase } from './helpers';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance;
const mailer = new MemoryMailer();

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  app = buildApp({ db, custody: new DevKeyCustody(db, new Uint8Array(32).fill(7)), appOrigin: 'http://localhost:5173', passkeys: createFakePasskeys(), blobs: new MemoryBlobStore(), mailer, cookieSecure: false, logLevel: 'silent' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await close();
});

const cookie = (res: { cookies: { name: string; value: string }[] }, name: string) => {
  const c = res.cookies.find((x) => x.name === name);
  if (!c) throw new Error(`cookie ${name} mancante`);
  return `${name}=${c.value}`;
};

/** Utente con cassaforte (passkey + codice di recupero), come lo crea il browser. */
async function utenteConCassaforte(email: string) {
  const start = (await app.inject({ method: 'POST', url: '/v1/registrazione/opzioni', payload: { nome: 'Rosa', email } })).json();
  const credentialId = `cred-${randomUUID()}`;
  const reg = await app.inject({
    method: 'POST',
    url: '/v1/registrazione/verifica',
    payload: { challengeId: start.challengeId, risposta: { id: credentialId, challenge: start.opzioni.challenge } },
  });
  const session = cookie(reg, 'memoriae_sessione');
  const vaultId = randomUUID();
  const vaultKey = await createVaultKey();
  const recovery = await generateRecoveryCode();
  const person = await generatePersonKeyPair();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/cassaforte',
    headers: { cookie: session },
    payload: {
      id: vaultId,
      chiavePubblica: await encodePublicKey(person.publicKey),
      chiavePrivataCifrata: await wrapPrivateKey(person.privateKey, vaultKey, 'owner'),
      accessi: [
        { metodo: 'passkey', credentialId, chiaveCifrata: await wrapVaultKey(vaultKey, await deriveKeyFromPasskeySecret(await generateKey()), vaultId, 'passkey') },
        { metodo: 'recovery-code', chiaveCifrata: await wrapVaultKey(vaultKey, recovery.key, vaultId, 'recovery-code') },
      ],
      verificaRecupero: await recoveryVerifier(recovery.key),
    },
  });
  expect(res.statusCode).toBe(201);
  return { session, credentialId, vaultId, vaultKey, recovery };
}

const lastCode = (to: string) => {
  const m = [...mailer.sent].reverse().find((x) => x.to === to && /codice è (\d{6})/.test(x.text));
  return m?.text.match(/codice è (\d{6})/)?.[1];
};

describe('recupero dell\'accesso', () => {
  it('percorso completo: e-mail + codice di recupero → nuova passkey; le vecchie vengono disattivate', async () => {
    const email = 'rosa.recupero@example.ch';
    const u = await utenteConCassaforte(email);

    // 1. Codice via e-mail.
    expect((await app.inject({ method: 'POST', url: '/v1/recupero/inizia', payload: { email } })).statusCode).toBe(200);
    const code = lastCode(email)!;
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await app.inject({ method: 'POST', url: '/v1/recupero/verifica-email', payload: { email, codice: wrong } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/v1/recupero/verifica-email', payload: { email, codice: code } });
    expect(ok.statusCode).toBe(200);
    const rec = cookie(ok, 'memoriae_recupero');

    // 2. Il browser apre la cassaforte con il codice stampato (prova locale) e manda solo il verificatore.
    const recoveryKey = await recoveryKeyFromCode(u.recovery.code);
    expect(await unwrapVaultKey(ok.json().chiaveCifrata, recoveryKey, u.vaultId, 'recovery-code')).toEqual(u.vaultKey);
    const verifier = await recoveryVerifier(recoveryKey);

    const bad = await app.inject({
      method: 'POST',
      url: '/v1/recupero/passkey/opzioni',
      headers: { cookie: rec },
      payload: { verificaRecupero: await recoveryVerifier(await generateKey()) },
    });
    expect(bad.statusCode).toBe(403);

    // 3. Nuova passkey.
    const opt = (await app.inject({ method: 'POST', url: '/v1/recupero/passkey/opzioni', headers: { cookie: rec }, payload: { verificaRecupero: verifier } })).json();
    const newCred = `nuova-${randomUUID()}`;
    const done = await app.inject({
      method: 'POST',
      url: '/v1/recupero/completa',
      headers: { cookie: rec },
      payload: { challengeId: opt.challengeId, risposta: { id: newCred, challenge: opt.opzioni.challenge }, verificaRecupero: verifier },
    });
    expect(done.statusCode).toBe(200);
    const newSession = cookie(done, 'memoriae_sessione');

    // La vecchia sessione e la vecchia passkey non valgono più.
    expect((await app.inject({ method: 'GET', url: '/v1/io', headers: { cookie: u.session } })).statusCode).toBe(401);
    const lo = (await app.inject({ method: 'POST', url: '/v1/accesso/opzioni' })).json();
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/v1/accesso/verifica',
      payload: { challengeId: lo.challengeId, risposta: { id: u.credentialId, challenge: lo.opzioni.challenge } },
    });
    expect(oldLogin.statusCode).toBe(401);

    // La nuova passkey riceve il suo accesso alla cassaforte.
    const newKey = await deriveKeyFromPasskeySecret(await generateKey());
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/cassaforte/accessi',
      headers: { cookie: newSession },
      payload: { metodo: 'passkey', credentialId: newCred, chiaveCifrata: await wrapVaultKey(u.vaultKey, newKey, u.vaultId, 'passkey') },
    });
    expect(put.statusCode).toBe(200);
    const vault = (await app.inject({ method: 'GET', url: '/v1/cassaforte', headers: { cookie: newSession } })).json();
    const passkeyWraps = vault.accessi.filter((a: { metodo: string }) => a.metodo === 'passkey');
    expect(passkeyWraps).toHaveLength(1);
    expect(passkeyWraps[0].credentialId).toBe(newCred);
    expect(await unwrapVaultKey(passkeyWraps[0].chiaveCifrata, newKey, u.vaultId, 'passkey')).toEqual(u.vaultKey);

    // Avviso all'utente; la finestra di recupero è chiusa.
    expect(mailer.sent.some((m) => m.to === email && m.subject.includes('accesso recuperato'))).toBe(true);
    const again = await app.inject({ method: 'POST', url: '/v1/recupero/passkey/opzioni', headers: { cookie: rec }, payload: { verificaRecupero: verifier } });
    expect(again.statusCode).toBe(401);
  });

  it('non rivela se un\'e-mail esiste', async () => {
    const before = mailer.sent.length;
    const res = await app.inject({ method: 'POST', url: '/v1/recupero/inizia', payload: { email: 'nessuno@example.ch' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mailer.sent.length).toBe(before);
  });

  it('dopo 5 tentativi sbagliati il codice non vale più', async () => {
    const email = 'ugo.tentativi@example.ch';
    await utenteConCassaforte(email);
    await app.inject({ method: 'POST', url: '/v1/recupero/inizia', payload: { email } });
    const code = lastCode(email)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await app.inject({ method: 'POST', url: '/v1/recupero/verifica-email', payload: { email, codice: wrong } });
    const res = await app.inject({ method: 'POST', url: '/v1/recupero/verifica-email', payload: { email, codice: code } });
    expect(res.statusCode).toBe(400);
  });

  it('senza la finestra di recupero non si registra nessuna passkey', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/recupero/passkey/opzioni', payload: { verificaRecupero: 'x'.repeat(43) } });
    expect(res.statusCode).toBe(401);
  });
});
