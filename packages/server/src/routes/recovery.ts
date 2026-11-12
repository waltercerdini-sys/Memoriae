import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { and, desc, eq, gt, gte, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import type { PasskeyService } from '../auth/passkeys';
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from '../auth/sessions';
import type { Database } from '../db/client';
import {
  auditLog,
  authChallenges,
  passkeyCredentials,
  recoveryRequests,
  sessions,
  users,
  vaultKeyWraps,
  vaults,
} from '../db/schema';
import type { Mailer } from '../mail/mailer';

/**
 * Recupero dell'accesso quando la passkey è persa (telefono perso, cambiato, rotto).
 *
 * Servono DUE prove:
 * 1. un codice di 6 cifre inviato all'e-mail dell'account (dimostra di controllare l'e-mail);
 * 2. il codice di recupero stampato (il browser lo usa per aprire la cassaforte e manda al server
 *    solo il "verificatore", che il server confronta con l'hash salvato alla creazione).
 *
 * Al termine le vecchie passkey e le sessioni aperte vengono disattivate, e l'utente riceve un avviso.
 */

export const RECOVERY_COOKIE = 'memoriae_recupero';
const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
const RECOVERY_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_REQUESTS_PER_HOUR = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const codeHash = (requestId: string, code: string) => sha256(`${requestId}:${code}`);

export function verifierHash(verifier: string): string {
  return sha256(`memoriae-recovery-verifier:${verifier}`);
}

const Email = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const EmailCode = Email.extend({ codice: z.string().trim().regex(/^\d{6}$/) });
const Verifier = z.object({ verificaRecupero: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const Complete = Verifier.extend({ challengeId: z.string().uuid(), risposta: z.record(z.string(), z.unknown()) });

export interface RecoveryRouteOptions {
  db: Database;
  passkeys: PasskeyService;
  mailer: Mailer;
  cookieSecure: boolean;
}

export async function recoveryRoutes(app: FastifyInstance, opts: RecoveryRouteOptions) {
  const { db, passkeys, mailer, cookieSecure } = opts;
  const GENERIC = 'Codice non valido o scaduto';

  async function activeRecovery(req: FastifyRequest) {
    const token = req.cookies[RECOVERY_COOKIE];
    if (!token) return null;
    const [r] = await db
      .select()
      .from(recoveryRequests)
      .where(and(eq(recoveryRequests.tokenHash, sha256(token)), gt(recoveryRequests.tokenExpiresAt, new Date()), isNull(recoveryRequests.completedAt)))
      .limit(1);
    return r ?? null;
  }

  async function checkVerifier(userId: string, verifier: string) {
    const [v] = await db.select().from(vaults).where(eq(vaults.ownerId, userId)).limit(1);
    return !!v?.recoveryVerifierHash && v.recoveryVerifierHash === verifierHash(verifier) ? v : null;
  }

  // 1. Richiesta del codice via e-mail. Risponde sempre allo stesso modo, per non rivelare quali e-mail esistono.
  app.post('/v1/recupero/inizia', async (req, reply) => {
    const body = Email.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'E-mail non valida' });
    const [u] = await db.select().from(users).where(eq(users.email, body.data.email)).limit(1);
    const [v] = u ? await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.ownerId, u.id)).limit(1) : [];
    if (u && v) {
      const recent = await db
        .select({ id: recoveryRequests.id })
        .from(recoveryRequests)
        .where(and(eq(recoveryRequests.userId, u.id), gte(recoveryRequests.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
      if (recent.length < MAX_REQUESTS_PER_HOUR) {
        await db.delete(recoveryRequests).where(and(eq(recoveryRequests.userId, u.id), isNull(recoveryRequests.completedAt)));
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const [r] = await db
          .insert(recoveryRequests)
          .values({ userId: u.id, emailCodeHash: 'temp', expiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS) })
          .returning({ id: recoveryRequests.id });
        await db.update(recoveryRequests).set({ emailCodeHash: codeHash(r!.id, code) }).where(eq(recoveryRequests.id, r!.id));
        await db.insert(auditLog).values({ actor: u.id, action: 'recupero-richiesto', vaultId: v.id });
        await mailer.send({
          to: u.email,
          subject: 'MEMORIAE – codice per recuperare l\'accesso',
          text: `Il tuo codice è ${code}. Vale 15 minuti.\nSe non hai chiesto tu di recuperare l'accesso, ignora questo messaggio e scrivici.`,
        });
      }
    }
    return { ok: true };
  });

  // 2. Verifica del codice e-mail: apre una breve finestra di recupero.
  app.post('/v1/recupero/verifica-email', async (req, reply) => {
    const body = EmailCode.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: GENERIC });
    const [u] = await db.select().from(users).where(eq(users.email, body.data.email)).limit(1);
    if (!u) return reply.code(400).send({ errore: GENERIC });
    const [r] = await db
      .select()
      .from(recoveryRequests)
      .where(and(eq(recoveryRequests.userId, u.id), isNull(recoveryRequests.completedAt), gt(recoveryRequests.expiresAt, new Date())))
      .orderBy(desc(recoveryRequests.createdAt))
      .limit(1);
    if (!r || r.attempts >= MAX_ATTEMPTS) return reply.code(400).send({ errore: GENERIC });
    await db.update(recoveryRequests).set({ attempts: r.attempts + 1 }).where(eq(recoveryRequests.id, r.id));
    if (r.emailCodeHash !== codeHash(r.id, body.data.codice)) return reply.code(400).send({ errore: GENERIC });

    const token = randomBytes(32).toString('base64url');
    await db
      .update(recoveryRequests)
      .set({ tokenHash: sha256(token), tokenExpiresAt: new Date(Date.now() + RECOVERY_TOKEN_TTL_MS), emailCodeHash: 'usato' })
      .where(eq(recoveryRequests.id, r.id));
    reply.setCookie(RECOVERY_COOKIE, token, { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/v1/recupero', maxAge: RECOVERY_TOKEN_TTL_MS / 1000 });

    const [v] = await db.select().from(vaults).where(eq(vaults.ownerId, u.id)).limit(1);
    const [wrap] = await db
      .select()
      .from(vaultKeyWraps)
      .where(and(eq(vaultKeyWraps.vaultId, v!.id), eq(vaultKeyWraps.method, 'recovery-code')))
      .limit(1);
    return { cassaforteId: v!.id, chiaveCifrata: wrap?.wrappedVaultKey };
  });

  const recoveryGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    const r = await activeRecovery(req);
    if (!r) return reply.code(401).send({ errore: 'Il tempo per il recupero è scaduto: ricomincia' });
    (req as FastifyRequest & { recovery?: typeof r }).recovery = r;
  };
  const recoveryOf = (req: FastifyRequest) => (req as FastifyRequest & { recovery: typeof recoveryRequests.$inferSelect }).recovery;

  // 3. Opzioni per la nuova passkey, solo con il verificatore giusto.
  app.post('/v1/recupero/passkey/opzioni', { preHandler: recoveryGuard }, async (req, reply) => {
    const body = Verifier.safeParse(req.body);
    const r = recoveryOf(req);
    if (!body.success || !(await checkVerifier(r.userId, body.data.verificaRecupero))) {
      await db.insert(auditLog).values({ actor: r.userId, action: 'recupero-codice-errato' });
      return reply.code(403).send({ errore: 'Codice di recupero non valido' });
    }
    const [u] = await db.select().from(users).where(eq(users.id, r.userId));
    const options = await passkeys.registrationOptions({ id: u!.id, email: u!.email, name: u!.name }, []);
    const [ch] = await db
      .insert(authChallenges)
      .values({ challenge: options.challenge, purpose: 'recupero', userId: u!.id, expiresAt: new Date(Date.now() + 5 * 60 * 1000) })
      .returning({ id: authChallenges.id });
    return { challengeId: ch!.id, opzioni: options };
  });

  // 4. Completa: registra la nuova passkey e disattiva tutte le precedenti.
  app.post('/v1/recupero/completa', { preHandler: recoveryGuard }, async (req, reply) => {
    const body = Complete.safeParse(req.body);
    const r = recoveryOf(req);
    if (!body.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const vault = await checkVerifier(r.userId, body.data.verificaRecupero);
    if (!vault) return reply.code(403).send({ errore: 'Codice di recupero non valido' });

    const [ch] = await db
      .delete(authChallenges)
      .where(and(eq(authChallenges.id, body.data.challengeId), eq(authChallenges.purpose, 'recupero'), eq(authChallenges.userId, r.userId), gt(authChallenges.expiresAt, new Date())))
      .returning();
    if (!ch) return reply.code(400).send({ errore: 'Richiesta scaduta: riprova' });
    const verified = await passkeys.verifyRegistration(body.data.risposta as unknown as RegistrationResponseJSON, ch.challenge);
    if (!verified) return reply.code(400).send({ errore: 'Passkey non verificata' });

    await db.transaction(async (tx) => {
      await tx.delete(vaultKeyWraps).where(and(eq(vaultKeyWraps.vaultId, vault.id), eq(vaultKeyWraps.method, 'passkey')));
      await tx.delete(passkeyCredentials).where(eq(passkeyCredentials.userId, r.userId));
      await tx.delete(sessions).where(eq(sessions.userId, r.userId));
      await tx.insert(passkeyCredentials).values({
        id: verified.id,
        userId: r.userId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: verified.transports,
        deviceType: verified.deviceType,
        backedUp: verified.backedUp,
      });
      await tx.update(recoveryRequests).set({ completedAt: new Date(), tokenHash: null }).where(eq(recoveryRequests.id, r.id));
      await tx.insert(auditLog).values({ actor: r.userId, action: 'accesso-recuperato', vaultId: vault.id, details: { nuovaPasskey: verified.id } });
    });

    const [u] = await db.select().from(users).where(eq(users.id, r.userId));
    await mailer.send({
      to: u!.email,
      subject: 'MEMORIAE – accesso recuperato',
      text: 'L\'accesso alla tua cassaforte è stato recuperato con il codice di recupero e una nuova passkey.\nLe passkey precedenti sono state disattivate.\nSe non sei stato tu, contattaci subito.',
    });
    const { token } = await createSession(db, r.userId);
    reply.clearCookie(RECOVERY_COOKIE, { path: '/v1/recupero' });
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/', maxAge: SESSION_TTL_MS / 1000 });
    return { utente: { id: u!.id, nome: u!.name, email: u!.email }, credentialId: verified.id };
  });
}
