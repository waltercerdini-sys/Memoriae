import { and, eq, gt, lt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'memoriae_sessione';
/** Una sessione dura al massimo 12 ore: la cassaforte va riaperta con la passkey. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Database, userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ tokenHash: hash(token), userId, expiresAt });
  // Pulizia occasionale delle sessioni scadute.
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  return { token, expiresAt };
}

export async function findSessionUser(db: Database, token: string | undefined, now = new Date()) {
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  return row ?? null;
}

export async function deleteSession(db: Database, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));
}
