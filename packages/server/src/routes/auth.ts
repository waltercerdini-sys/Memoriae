import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PasskeyService } from '../auth/passkeys';
import { createSession, deleteSession, findSessionUser, SESSION_COOKIE, SESSION_TTL_MS } from '../auth/sessions';
import type { Database } from '../db/client';
import { auditLog, authChallenges, passkeyCredentials, users, vaults } from '../db/schema';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface AuthRouteOptions {
  db: Database;
  passkeys: PasskeyService;
  cookieSecure: boolean;
}

export type SessionUser = { id: string; name: string; email: string };

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

/** Da usare come preHandler sulle rotte che richiedono un accesso. */
export function requireUser(db: Database) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await findSessionUser(db, req.cookies[SESSION_COOKIE]);
    if (!user) return reply.code(401).send({ errore: 'Accesso richiesto' });
    req.user = user;
  };
}

const RegistrationStart = z.object({
  nome: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
});
const Verify = z.object({ challengeId: z.string().uuid(), risposta: z.record(z.string(), z.unknown()) });

export async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const { db, passkeys, cookieSecure } = opts;

  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'strict',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });

  async function takeChallenge(challengeId: string, purpose: string) {
    const [row] = await db
      .delete(authChallenges)
      .where(and(eq(authChallenges.id, challengeId), eq(authChallenges.purpose, purpose), gt(authChallenges.expiresAt, new Date())))
      .returning();
    return row ?? null;
  }

  app.post('/v1/registrazione/opzioni', async (req, reply) => {
    const body = RegistrationStart.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Nome o e-mail non validi' });
    const { nome, email } = body.data;

    let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (user) {
      const creds = await db.select({ id: passkeyCredentials.id }).from(passkeyCredentials).where(eq(passkeyCredentials.userId, user.id)).limit(1);
      if (creds.length > 0) return reply.code(409).send({ errore: 'Esiste già un account con questa e-mail: accedi' });
      [user] = await db.update(users).set({ name: nome }).where(eq(users.id, user.id)).returning();
    } else {
      [user] = await db.insert(users).values({ name: nome, email }).returning();
    }
    const u = user!;
    const options = await passkeys.registrationOptions({ id: u.id, email: u.email, name: u.name }, []);
    const [ch] = await db
      .insert(authChallenges)
      .values({ challenge: options.challenge, purpose: 'registrazione', userId: u.id, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) })
      .returning({ id: authChallenges.id });
    return { challengeId: ch!.id, opzioni: options };
  });

  app.post('/v1/registrazione/verifica', async (req, reply) => {
    const body = Verify.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const ch = await takeChallenge(body.data.challengeId, 'registrazione');
    if (!ch?.userId) return reply.code(400).send({ errore: 'Richiesta scaduta: riprova' });

    const verified = await passkeys.verifyRegistration(body.data.risposta as unknown as RegistrationResponseJSON, ch.challenge);
    if (!verified) return reply.code(400).send({ errore: 'Passkey non verificata' });

    await db.insert(passkeyCredentials).values({
      id: verified.id,
      userId: ch.userId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: verified.transports,
      deviceType: verified.deviceType,
      backedUp: verified.backedUp,
    });
    await db.insert(auditLog).values({ actor: ch.userId, action: 'passkey-registrata', details: { credentialId: verified.id } });
    const { token } = await createSession(db, ch.userId);
    setSessionCookie(reply, token);
    const [u] = await db.select({ id: users.id, nome: users.name, email: users.email }).from(users).where(eq(users.id, ch.userId));
    return { utente: u, credentialId: verified.id, haCassaforte: false };
  });

  app.post('/v1/accesso/opzioni', async () => {
    const options = await passkeys.authenticationOptions();
    const [ch] = await db
      .insert(authChallenges)
      .values({ challenge: options.challenge, purpose: 'accesso', expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) })
      .returning({ id: authChallenges.id });
    return { challengeId: ch!.id, opzioni: options };
  });

  app.post('/v1/accesso/verifica', async (req, reply) => {
    const body = Verify.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const ch = await takeChallenge(body.data.challengeId, 'accesso');
    if (!ch) return reply.code(400).send({ errore: 'Richiesta scaduta: riprova' });

    const response = body.data.risposta as unknown as AuthenticationResponseJSON;
    const [cred] = await db.select().from(passkeyCredentials).where(eq(passkeyCredentials.id, String(response.id))).limit(1);
    if (!cred) return reply.code(401).send({ errore: 'Passkey sconosciuta' });

    const ok = await passkeys.verifyAuthentication(response, ch.challenge, {
      id: cred.id,
      publicKey: cred.publicKey,
      counter: cred.counter,
      transports: cred.transports as string[],
    });
    if (!ok) return reply.code(401).send({ errore: 'Accesso non riuscito' });

    await db.update(passkeyCredentials).set({ counter: ok.newCounter, lastUsedAt: new Date() }).where(eq(passkeyCredentials.id, cred.id));
    await db.insert(auditLog).values({ actor: cred.userId, action: 'accesso', details: { credentialId: cred.id } });
    const { token } = await createSession(db, cred.userId);
    setSessionCookie(reply, token);
    const [u] = await db.select({ id: users.id, nome: users.name, email: users.email }).from(users).where(eq(users.id, cred.userId));
    const v = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.ownerId, cred.userId)).limit(1);
    return { utente: u, credentialId: cred.id, haCassaforte: v.length > 0 };
  });

  app.post('/v1/uscita', async (req, reply) => {
    await deleteSession(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/v1/io', { preHandler: requireUser(db) }, async (req) => {
    const v = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.ownerId, req.user!.id)).limit(1);
    return { utente: { id: req.user!.id, nome: req.user!.name, email: req.user!.email }, haCassaforte: v.length > 0 };
  });
}
