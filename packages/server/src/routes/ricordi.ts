import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import { requireUser } from './auth';

/** Intervista dei ricordi: il promemoria settimanale per e-mail lo sceglie l'utente (spento all'inizio). */
export async function ricordiRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const auth = requireUser(db);

  app.get('/v1/ricordi/promemoria', { preHandler: auth }, async (req) => {
    const [u] = await db.select({ attivo: users.memoriesReminder }).from(users).where(eq(users.id, req.user!.id)).limit(1);
    return { attivo: u?.attivo ?? false };
  });

  app.put('/v1/ricordi/promemoria', { preHandler: auth }, async (req, reply) => {
    const body = z.object({ attivo: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    // Accendendolo, il primo promemoria arriva fra una settimana: oggi la domanda la vede già nell'app.
    await db
      .update(users)
      .set({ memoriesReminder: body.data.attivo, ...(body.data.attivo ? { memoriesReminderSentAt: new Date() } : {}) })
      .where(eq(users.id, req.user!.id));
    return { attivo: body.data.attivo };
  });
}
