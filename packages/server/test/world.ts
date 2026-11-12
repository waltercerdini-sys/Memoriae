import {
  createVaultKey,
  deriveKeyFromPasskeySecret,
  encodePublicKey,
  generateKey,
  generatePersonKeyPair,
  generateRecoveryCode,
  recoveryVerifier,
  wrapPrivateKey,
  wrapVaultKey,
  type PersonKeyPair,
} from '@memoriae/crypto';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { MemoryMailer } from '../src/mail/mailer';

export interface TestUser {
  session: string;
  vaultId: string;
  vaultKey: Uint8Array;
  keyPair: PersonKeyPair;
  email: string;
  credentialId: string;
}

/** Utente di prova con passkey finta e cassaforte già creata. */
export function createWorld(getApp: () => FastifyInstance, mailer: MemoryMailer) {
  async function utente(nome: string, email: string): Promise<TestUser> {
    const app = getApp();
    const start = (await app.inject({ method: 'POST', url: '/v1/registrazione/opzioni', payload: { nome, email } })).json();
    const credentialId = `cred-${randomUUID()}`;
    const reg = await app.inject({
      method: 'POST',
      url: '/v1/registrazione/verifica',
      payload: { challengeId: start.challengeId, risposta: { id: credentialId, challenge: start.opzioni.challenge } },
    });
    const c = reg.cookies.find((x) => x.name === 'memoriae_sessione')!;
    const session = `memoriae_sessione=${c.value}`;
    const vaultId = randomUUID();
    const vaultKey = await createVaultKey();
    const recovery = await generateRecoveryCode();
    const keyPair = await generatePersonKeyPair();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cassaforte',
      headers: { cookie: session },
      payload: {
        id: vaultId,
        chiavePubblica: await encodePublicKey(keyPair.publicKey),
        chiavePrivataCifrata: await wrapPrivateKey(keyPair.privateKey, vaultKey, 'owner'),
        accessi: [
          { metodo: 'passkey', credentialId, chiaveCifrata: await wrapVaultKey(vaultKey, await deriveKeyFromPasskeySecret(await generateKey()), vaultId, 'passkey') },
          { metodo: 'recovery-code', chiaveCifrata: await wrapVaultKey(vaultKey, recovery.key, vaultId, 'recovery-code') },
        ],
        verificaRecupero: await recoveryVerifier(recovery.key),
      },
    });
    if (res.statusCode !== 201) throw new Error(`cassaforte non creata: ${res.body}`);
    return { session, vaultId, vaultKey, keyPair, email, credentialId };
  }

  /** Ultimo collegamento con quel parametro (invito, sonoqui, blocca) inviato a quell'indirizzo. */
  const linkToken = (to: string, param: string) => {
    const re = new RegExp(`\\?${param}=([A-Za-z0-9_-]{43})`);
    const m = [...mailer.sent].reverse().find((x) => x.to === to && re.test(x.text));
    return m?.text.match(re)?.[1];
  };

  return { utente, linkToken, inviteToken: (to: string) => linkToken(to, 'invito') };
}
