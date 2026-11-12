import { and, eq, isNull, lte, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/client';
import { auditLog, paymentEvents, subscriptions, users } from '../db/schema';
import type { Mailer } from '../mail/mailer';
import { PLANS, type PaymentEvent, type Plan } from './provider';

/**
 * Regole dell'abbonamento:
 * - 30 giorni di prova con tutte le funzioni, senza dare dati di pagamento;
 * - dopo, senza piano, la cassaforte resta com'è: si legge, si cancella, si riceve, si fa da persona
 *   di fiducia, e tutto ciò che è pronto per gli eredi resta valido. Non si aggiungono né si modificano voci e persone;
 * - il mancato pagamento non blocca MAI un'apertura, un rilascio o un recupero.
 */
export const TRIAL_DAYS = 30;
/** Pagamento non riuscito: il fornitore riprova; nel frattempo tutto continua a funzionare. */
const DAY = 24 * 3600 * 1000;

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type PlanState = 'prova' | 'attivo' | 'in-ritardo' | 'scaduto';

export interface PlanStatus {
  stato: PlanState;
  piano: Plan | null;
  provaFinoAl: Date;
  validoFinoAl: Date | null;
  rinnovoAutomatico: boolean;
  famiglia: string | null;
  copertoDa: string | null;
  puoScrivere: boolean;
  haPortale: boolean;
}

export async function ensureSubscription(db: Database, userId: string): Promise<SubscriptionRow> {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (row) return row;
  const [u] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  const start = u?.createdAt ?? new Date();
  await db
    .insert(subscriptions)
    .values({ userId, trialEndsAt: new Date(start.getTime() + TRIAL_DAYS * DAY) })
    .onConflictDoNothing();
  const [created] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  return created!;
}

const paid = (s: SubscriptionRow, now: Date) =>
  (s.status === 'attivo' || s.status === 'in-ritardo' || s.status === 'annullato') && !!s.paidUntil && s.paidUntil.getTime() > now.getTime();

export async function planStatus(db: Database, user: { id: string; email: string }, now = new Date()): Promise<PlanStatus> {
  const s = await ensureSubscription(db, user.id);
  const base = {
    piano: s.plan,
    provaFinoAl: s.trialEndsAt,
    validoFinoAl: s.paidUntil,
    rinnovoAutomatico: s.status === 'attivo' && !s.cancelAtPeriodEnd,
    famiglia: s.plan === 'famiglia' ? s.familyMemberEmail : null,
    copertoDa: null as string | null,
    haPortale: !!s.providerCustomerId,
  };
  if (paid(s, now)) {
    return { ...base, stato: s.status === 'in-ritardo' ? 'in-ritardo' : 'attivo', puoScrivere: true };
  }
  // Secondo adulto del piano Famiglia di qualcun altro.
  const [fam] = await db
    .select({ s: subscriptions, nome: users.name })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(and(eq(subscriptions.plan, 'famiglia'), eq(subscriptions.familyMemberEmail, user.email.toLowerCase())));
  if (fam && fam.s.userId !== user.id && paid(fam.s, now)) {
    return { ...base, stato: 'attivo', piano: 'famiglia', validoFinoAl: fam.s.paidUntil, rinnovoAutomatico: false, famiglia: null, copertoDa: fam.nome, puoScrivere: true };
  }
  if (now.getTime() < s.trialEndsAt.getTime()) return { ...base, stato: 'prova', puoScrivere: true };
  return { ...base, stato: 'scaduto', puoScrivere: false };
}

/** preHandler per le rotte che aggiungono o modificano contenuti (dopo requireUser). */
export function requireWritablePlan(db: Database) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ errore: 'Accesso richiesto' });
    const st = await planStatus(db, req.user);
    if (!st.puoScrivere) {
      return reply.code(402).send({
        errore: 'La prova gratuita è finita: per aggiungere o modificare scegli un piano. Ciò che hai già preparato resta valido per i tuoi cari.',
        codice: 'piano-richiesto',
      });
    }
  };
}

/** Applica un evento del fornitore, una sola volta per evento. */
export async function applyPaymentEvent(db: Database, mailer: Mailer, ev: PaymentEvent): Promise<'applicato' | 'già-visto' | 'ignorato'> {
  const inserted = await db.insert(paymentEvents).values({ id: ev.id, type: ev.kind }).onConflictDoNothing().returning({ id: paymentEvents.id });
  if (inserted.length === 0) return 'già-visto';

  if (ev.kind === 'ignorato') return 'ignorato';

  if (ev.kind === 'checkout-completato') {
    if (!ev.userId) return 'ignorato';
    await ensureSubscription(db, ev.userId);
    await db
      .update(subscriptions)
      .set({
        providerCustomerId: ev.customerId,
        ...(ev.subscriptionId ? { providerSubscriptionId: ev.subscriptionId } : {}),
        ...(ev.plan ? { plan: ev.plan } : {}),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, ev.userId));
    await db.insert(auditLog).values({ actor: 'fornitore-pagamenti', action: 'pagamento-avviato', details: { utente: ev.userId, piano: ev.plan } });
    return 'applicato';
  }

  if (ev.kind === 'abbonamento') {
    let userId = ev.userId;
    if (!userId) {
      const [s] = await db.select({ userId: subscriptions.userId }).from(subscriptions).where(eq(subscriptions.providerCustomerId, ev.customerId));
      userId = s?.userId ?? null;
    }
    if (!userId) return 'ignorato';
    const before = await ensureSubscription(db, userId);
    await db
      .update(subscriptions)
      .set({
        status: ev.status,
        providerCustomerId: ev.customerId,
        providerSubscriptionId: ev.subscriptionId,
        ...(ev.plan ? { plan: ev.plan } : {}),
        ...(ev.paidUntil ? { paidUntil: ev.paidUntil } : {}),
        cancelAtPeriodEnd: ev.cancelAtPeriodEnd,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.userId, userId));
    await db.insert(auditLog).values({ actor: 'fornitore-pagamenti', action: 'abbonamento-aggiornato', details: { utente: userId, stato: ev.status, piano: ev.plan } });
    if (before.status !== 'attivo' && ev.status === 'attivo') {
      const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
      const plan = ev.plan ?? before.plan;
      if (u && plan) {
        await mailer.send({
          to: u.email,
          subject: `MEMORIAE – grazie, il piano ${PLANS[plan].nome} è attivo`,
          text: `Ciao ${u.name.split(' ')[0]},\nil pagamento è andato a buon fine${ev.paidUntil ? ` e il piano vale fino al ${ev.paidUntil.toLocaleDateString('it-CH')}` : ''}.\nLa ricevuta arriva dal servizio di pagamento.`,
        });
      }
    }
    return 'applicato';
  }

  // pagamento-fallito
  const [s] = await db
    .select({ email: users.email, name: users.name })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(eq(subscriptions.providerCustomerId, ev.customerId));
  if (s) {
    await mailer.send({
      to: s.email,
      subject: 'MEMORIAE – il rinnovo non è andato a buon fine',
      text: `Ciao ${s.name.split(' ')[0]},\nnon siamo riusciti a rinnovare il tuo piano. Riproveremo nei prossimi giorni.\nPuoi aggiornare il metodo di pagamento dall'app, alla voce «Il tuo piano».\nLa tua cassaforte e ciò che hai preparato restano validi.`,
    });
  }
  return 'applicato';
}

/** Lavoro periodico: avvisi di fine prova (7 giorni prima e alla scadenza). */
export async function trialReminders(db: Database, mailer: Mailer, appOrigin: string, now: Date): Promise<number> {
  let sent = 0;
  const soon = await db
    .select({ s: subscriptions, email: users.email, name: users.name })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(
      and(
        eq(subscriptions.status, 'prova'),
        isNull(subscriptions.paidUntil),
        lte(subscriptions.trialEndsAt, new Date(now.getTime() + 7 * DAY)),
        or(isNull(subscriptions.trialReminderSentAt), isNull(subscriptions.trialEndedNoticeAt)),
      ),
    );
  for (const { s, email, name } of soon) {
    const st = await planStatus(db, { id: s.userId, email }, now);
    if (st.stato === 'attivo') continue; // coperto da un piano Famiglia
    const ended = s.trialEndsAt.getTime() <= now.getTime();
    if (!ended && !s.trialReminderSentAt) {
      await mailer.send({
        to: email,
        subject: 'MEMORIAE – la prova gratuita finisce tra pochi giorni',
        text:
          `Ciao ${name.split(' ')[0]},\nla prova gratuita finisce il ${s.trialEndsAt.toLocaleDateString('it-CH')}.\n` +
          `Per continuare ad aggiungere voci e persone scegli un piano (da CHF ${PLANS.essenziale.chfAnno} all'anno, anche con TWINT): ${appOrigin}\n` +
          `Se non scegli nulla, ciò che hai già preparato resta valido per i tuoi cari.`,
      });
      await db.update(subscriptions).set({ trialReminderSentAt: now }).where(eq(subscriptions.userId, s.userId));
      sent++;
    } else if (ended && !s.trialEndedNoticeAt) {
      await mailer.send({
        to: email,
        subject: 'MEMORIAE – la prova gratuita è finita',
        text:
          `Ciao ${name.split(' ')[0]},\nla prova gratuita è finita. La tua cassaforte resta com'è e le tue persone di fiducia restano pronte.\n` +
          `Per aggiungere o modificare voci e persone scegli un piano: ${appOrigin}`,
      });
      await db.update(subscriptions).set({ trialEndedNoticeAt: now, trialReminderSentAt: s.trialReminderSentAt ?? now }).where(eq(subscriptions.userId, s.userId));
      sent++;
    }
  }
  return sent;
}

