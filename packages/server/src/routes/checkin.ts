import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/client';
import { auditLog, checkinSchedules, vaults } from '../db/schema';
import { evaluateCheckin } from '../domain/checkin';
import { requireUser } from './auth';

/** Intervalli proposti all'utente, in giorni. */
export const CHECKIN_INTERVALS = [7, 14, 30, 60, 90, 180] as const;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const checkinTokenHash = (token: string) => sha256(`memoriae-sono-qui:${token}`);

/** Registra un «sono qui»: azzera promemoria e avvisi. */
export async function registraSonoQui(db: Database, vaultId: string, actor: string, via: string, now = new Date()): Promise<void> {
  await db
    .update(checkinSchedules)
    .set({ lastCheckinAt: now, remindersSent: 0, lastReminderAt: null, missedNotifiedAt: null, checkinTokenHash: null })
    .where(eq(checkinSchedules.vaultId, vaultId));
  await db.insert(auditLog).values({ actor, action: 'sono-qui', vaultId, details: { via } });
}

const Settings = z.object({
  intervalloGiorni: z.number().int().refine((n) => (CHECKIN_INTERVALS as readonly number[]).includes(n), 'Intervallo non previsto'),
  inPausa: z.boolean().optional(),
});

export async function checkinRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const auth = requireUser(db);

  async function scheduleOf(userId: string) {
    const [row] = await db
      .select({ s: checkinSchedules, vaultId: vaults.id })
      .from(vaults)
      .innerJoin(checkinSchedules, eq(checkinSchedules.vaultId, vaults.id))
      .where(eq(vaults.ownerId, userId))
      .limit(1);
    return row ?? null;
  }

  app.get('/v1/cassaforte/controllo', { preHandler: auth }, async (req, reply) => {
    const row = await scheduleOf(req.user!.id);
    if (!row) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    const s = row.s;
    const stato = evaluateCheckin(s, new Date());
    return {
      intervalloGiorni: s.intervalDays,
      ultimoSonoQui: s.lastCheckinAt,
      prossimaScadenza: new Date(s.lastCheckinAt.getTime() + s.intervalDays * 24 * 3600 * 1000),
      inPausa: s.paused,
      promemoriaInviati: s.remindersSent,
      stato: stato.state,
    };
  });

  app.put('/v1/cassaforte/controllo', { preHandler: auth }, async (req, reply) => {
    const body = Settings.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Impostazione non valida' });
    const row = await scheduleOf(req.user!.id);
    if (!row) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    await db
      .update(checkinSchedules)
      .set({ intervalDays: body.data.intervalloGiorni, ...(body.data.inPausa !== undefined ? { paused: body.data.inPausa } : {}) })
      .where(eq(checkinSchedules.vaultId, row.vaultId));
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'controllo-impostato', vaultId: row.vaultId, details: body.data });
    return { ok: true };
  });

  app.post('/v1/cassaforte/sono-qui', { preHandler: auth }, async (req, reply) => {
    const row = await scheduleOf(req.user!.id);
    if (!row) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    await registraSonoQui(db, row.vaultId, req.user!.id, 'app');
    return { ok: true };
  });

  /** Collegamento nell'e-mail di promemoria: un clic, senza accedere. Registra solo il «sono qui». */
  app.post('/v1/sono-qui/:token', async (req, reply) => {
    const t = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).safeParse(req.params);
    if (!t.success) return reply.code(404).send({ errore: 'Collegamento non valido o già usato' });
    const [s] = await db.select().from(checkinSchedules).where(eq(checkinSchedules.checkinTokenHash, checkinTokenHash(t.data.token))).limit(1);
    if (!s) return reply.code(404).send({ errore: 'Collegamento non valido o già usato' });
    await registraSonoQui(db, s.vaultId, 'collegamento-email', 'email');
    return { ok: true };
  });
}
