import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client';
import { auditLog, subscriptions, trialCheckouts } from '../db/schema';
import type { Mailer } from '../mail/mailer';
import { PLANS, type PaymentProvider } from '../payments/provider';
import { applyPaymentEvent, ensureSubscription, planStatus } from '../payments/subscriptions';
import { requireUser } from './auth';

const PlanBody = z.object({ piano: z.enum(['essenziale', 'famiglia']) });
const FamilyBody = z.object({ email: z.string().trim().toLowerCase().email().max(254).nullable() });
const Uuid = z.object({ id: z.string().uuid() });

export async function billingRoutes(app: FastifyInstance, opts: { db: Database; mailer: Mailer; payments: PaymentProvider; appOrigin: string }) {
  const { db, mailer, payments, appOrigin } = opts;
  const auth = requireUser(db);

  /** Prezzi pubblici. */
  app.get('/v1/piani', async () => ({
    piani: Object.entries(PLANS).map(([id, p]) => ({ id, nome: p.nome, chfAnno: p.chfAnno, descrizione: p.descrizione })),
    pagamentoDiProva: payments.name === 'prova',
  }));

  app.get('/v1/abbonamento', { preHandler: auth }, async (req) => planStatus(db, req.user!));

  app.post('/v1/abbonamento/checkout', { preHandler: auth }, async (req, reply) => {
    const body = PlanBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Piano non valido' });
    const st = await planStatus(db, req.user!);
    if ((st.stato === 'attivo' || st.stato === 'in-ritardo') && !st.copertoDa) {
      return reply.code(409).send({ errore: 'Hai già un piano attivo: per cambiarlo usa «Gestisci pagamento»' });
    }
    const s = await ensureSubscription(db, req.user!.id);
    const { url } = await payments.createCheckout({
      userId: req.user!.id,
      email: req.user!.email,
      plan: body.data.piano,
      customerId: s.providerCustomerId,
      successUrl: `${appOrigin}/?pagato=1`,
      cancelUrl: `${appOrigin}/?pagato=0`,
    });
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'pagamento-iniziato', details: { piano: body.data.piano, fornitore: payments.name } });
    return { url };
  });

  app.post('/v1/abbonamento/gestisci', { preHandler: auth }, async (req, reply) => {
    const s = await ensureSubscription(db, req.user!.id);
    if (!s.providerCustomerId) return reply.code(409).send({ errore: 'Nessun pagamento da gestire' });
    return payments.createPortal(s.providerCustomerId, appOrigin);
  });

  /** Piano Famiglia: indica (o togli) il secondo adulto. Avrà la sua cassaforte, separata dalla tua. */
  app.put('/v1/abbonamento/famiglia', { preHandler: auth }, async (req, reply) => {
    const body = FamilyBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Indirizzo e-mail non valido' });
    const st = await planStatus(db, req.user!);
    if (st.piano !== 'famiglia' || st.copertoDa || (st.stato !== 'attivo' && st.stato !== 'in-ritardo')) {
      return reply.code(409).send({ errore: 'Serve un piano Famiglia attivo' });
    }
    if (body.data.email === req.user!.email.toLowerCase()) return reply.code(400).send({ errore: 'Indica l\'e-mail dell\'altra persona' });
    await db.update(subscriptions).set({ familyMemberEmail: body.data.email, updatedAt: new Date() }).where(eq(subscriptions.userId, req.user!.id));
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'famiglia-aggiornata', details: { impostata: !!body.data.email } });
    if (body.data.email) {
      await mailer.send({
        to: body.data.email,
        subject: `${req.user!.name} ti ha incluso nel piano Famiglia di MEMORIAE`,
        text: `Ciao,\n${req.user!.name} ha incluso il tuo indirizzo nel suo piano Famiglia: puoi creare la tua cassaforte MEMORIAE senza pagare nulla.\nUsa questo indirizzo e-mail: ${appOrigin}\nLe vostre cassaforti restano separate: nessuno dei due vede quella dell'altro.`,
      });
    }
    return { ok: true };
  });

  // ---- Avvisi firmati del fornitore (Stripe) --------------------------------
  app.register(async (hook) => {
    // Serve il testo esatto ricevuto per verificare la firma.
    hook.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));
    hook.post('/v1/pagamenti/avvisi', async (req, reply) => {
      let ev;
      try {
        ev = await payments.parseWebhook(String(req.body), req.headers['stripe-signature'] as string | undefined);
      } catch {
        return reply.code(400).send({ errore: 'Avviso non valido' });
      }
      const esito = await applyPaymentEvent(db, mailer, ev);
      return { ricevuto: true, esito };
    });
  });

  // ---- Pagamento di prova (solo con il fornitore «prova») -------------------
  if (payments.name === 'prova') {
    app.get('/v1/pagamenti/prova/:id', { preHandler: auth }, async (req, reply) => {
      const p = Uuid.safeParse(req.params);
      const [c] = p.success ? await db.select().from(trialCheckouts).where(and(eq(trialCheckouts.id, p.data.id), eq(trialCheckouts.userId, req.user!.id))) : [];
      if (!c) return reply.code(404).send({ errore: 'Pagamento non trovato' });
      return { piano: c.plan, nome: PLANS[c.plan].nome, chf: c.amountChf, pagato: !!c.paidAt };
    });

    app.post('/v1/pagamenti/prova/:id/paga', { preHandler: auth }, async (req, reply) => {
      const p = Uuid.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ errore: 'Pagamento non trovato' });
      const now = new Date();
      const [c] = await db
        .update(trialCheckouts)
        .set({ paidAt: now })
        .where(and(eq(trialCheckouts.id, p.data.id), eq(trialCheckouts.userId, req.user!.id), isNull(trialCheckouts.paidAt)))
        .returning();
      if (!c) return reply.code(404).send({ errore: 'Pagamento non trovato o già fatto' });
      const paidUntil = new Date(now);
      paidUntil.setFullYear(paidUntil.getFullYear() + 1);
      // Stesso percorso degli avvisi veri: così la prova esercita il codice di produzione.
      await applyPaymentEvent(db, mailer, { id: `prova-checkout-${c.id}`, kind: 'checkout-completato', userId: c.userId, customerId: `prova-${c.userId}`, subscriptionId: `prova-${c.id}`, plan: c.plan });
      await applyPaymentEvent(db, mailer, {
        id: `prova-abbonamento-${c.id}`,
        kind: 'abbonamento',
        userId: c.userId,
        customerId: `prova-${c.userId}`,
        subscriptionId: `prova-${c.id}`,
        plan: c.plan,
        status: 'attivo',
        paidUntil,
        cancelAtPeriodEnd: false,
      });
      return { ok: true };
    });
  }
}

/** Crea il «pagamento» per la pagina di prova. */
export function trialCheckoutFactory(db: Database) {
  return async (req: { userId: string; plan: 'essenziale' | 'famiglia' }) => {
    const [c] = await db.insert(trialCheckouts).values({ userId: req.userId, plan: req.plan, amountChf: PLANS[req.plan].chfAnno }).returning({ id: trialCheckouts.id });
    return c!.id;
  };
}
