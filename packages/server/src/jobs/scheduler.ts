import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Database } from '../db/client';
import { auditLog, checkinSchedules, persons, users, vaults } from '../db/schema';
import { evaluateCheckin, recordReminderSent } from '../domain/checkin';
import type { Mailer } from '../mail/mailer';
import { checkinTokenHash } from '../routes/checkin';

/**
 * Lavori periodici: promemoria «sono qui», avviso ai fiduciari, rilasci a fine attesa.
 * Nessun lavoro periodico apre da solo una cassaforte: il controllo mancato si limita ad avvisare.
 */
export interface JobContext {
  db: Database;
  mailer: Mailer;
  appOrigin: string;
}

export interface JobReport {
  promemoria: number;
  avvisiFiduciari: number;
  rilasci: number;
}

type ExtraJob = (ctx: JobContext, now: Date) => Promise<Partial<JobReport>>;
const extraJobs: ExtraJob[] = [];
/** Permette ad altri moduli (attivazione) di aggiungere i propri lavori periodici. */
export function registerJob(job: ExtraJob) {
  extraJobs.push(job);
}

export async function runJobs(ctx: JobContext, now = new Date()): Promise<JobReport> {
  const report: JobReport = { promemoria: 0, avvisiFiduciari: 0, rilasci: 0 };
  const { db, mailer, appOrigin } = ctx;

  const rows = await db
    .select({ s: checkinSchedules, owner: users })
    .from(checkinSchedules)
    .innerJoin(vaults, eq(vaults.id, checkinSchedules.vaultId))
    .innerJoin(users, eq(users.id, vaults.ownerId));

  for (const { s, owner } of rows) {
    const stato = evaluateCheckin(s, now);
    if (stato.state === 'promemoria-da-inviare') {
      const token = randomBytes(32).toString('base64url');
      const next = recordReminderSent(s, now);
      await db
        .update(checkinSchedules)
        .set({ remindersSent: next.remindersSent, lastReminderAt: next.lastReminderAt, checkinTokenHash: checkinTokenHash(token) })
        .where(eq(checkinSchedules.vaultId, s.vaultId));
      await mailer.send({
        to: owner.email,
        subject: `MEMORIAE – tutto bene? (promemoria ${stato.reminderNumber} di ${s.maxReminders})`,
        text:
          `Ciao ${owner.name.split(' ')[0]},\nè il momento del controllo periodico. Se stai bene, premi qui:\n${appOrigin}/?sonoqui=${token}\n\n` +
          `Se non rispondi a ${s.maxReminders} promemoria, avviseremo le tue persone di fiducia. Nessuno potrà aprire la tua cassaforte senza una verifica.`,
      });
      await db.insert(auditLog).values({ actor: 'sistema', action: 'promemoria-inviato', vaultId: s.vaultId, details: { numero: stato.reminderNumber } });
      report.promemoria++;
    } else if (stato.state === 'mancato' && !s.missedNotifiedAt) {
      const fiduciari = await db
        .select({ nome: persons.name, email: users.email })
        .from(persons)
        .innerJoin(users, eq(users.id, persons.userId))
        .where(and(eq(persons.vaultId, s.vaultId), eq(persons.inviteStatus, 'accettato'), inArray(persons.role, ['fiduciario', 'fiduciario-destinatario'])));
      for (const f of fiduciari) {
        await mailer.send({
          to: f.email,
          subject: `MEMORIAE – ${owner.name} non risponde ai controlli`,
          text:
            `Ciao ${f.nome.split(' ')[0]},\n${owner.name} non ha risposto agli ultimi controlli periodici.\n` +
            `Può essere una dimenticanza: prova prima a contattarla.\n` +
            `Se sai che le è successo qualcosa, puoi chiedere l'apertura dall'app: ${appOrigin}\n` +
            `Ogni richiesta viene verificata da una persona e ${owner.name.split(' ')[0]} potrà sempre bloccarla.`,
        });
      }
      await db.update(checkinSchedules).set({ missedNotifiedAt: now }).where(eq(checkinSchedules.vaultId, s.vaultId));
      await db.insert(auditLog).values({ actor: 'sistema', action: 'controllo-mancato', vaultId: s.vaultId, details: { fiduciariAvvisati: fiduciari.length } });
      report.avvisiFiduciari += fiduciari.length;
    }
  }

  for (const job of extraJobs) {
    const r = await job(ctx, now);
    report.rilasci += r.rilasci ?? 0;
  }
  return report;
}

/** Avvia i lavori periodici nel processo del server (sviluppo e prime installazioni). */
export function startScheduler(ctx: JobContext, intervalMs: number, log: (msg: string) => void): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runJobs(ctx);
      if (r.promemoria || r.avvisiFiduciari || r.rilasci) log(`Lavori periodici: ${JSON.stringify(r)}`);
    } catch (e) {
      log(`Errore nei lavori periodici: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}
