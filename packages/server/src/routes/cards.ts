import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { findSessionUser, SESSION_COOKIE } from '../auth/sessions';
import { chiaviCarta, decifraPicc, macValido, simulaLettura } from '../cards/sun';
import type { Database } from '../db/client';
import { auditLog, cardOrders, cards, cardTaps, persons, users, vaults } from '../db/schema';
import type { Mailer } from '../mail/mailer';
import { PREZZO_CARTA_CHF, type IndirizzoSpedizione, type PaymentProvider } from '../payments/provider';
import { applyPaymentEvent } from '../payments/subscriptions';
import { requireUser } from './auth';
import { markCardOrderPaid } from '../cards/orders';
export { markCardOrderPaid };

const MINUTI_AVVISO = 15;
const AVVISI_AL_GIORNO = 3;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const Uuid = z.object({ id: z.string().uuid() });
const Indirizzo = z.object({
  nome: z.string().trim().min(1).max(120),
  riga1: z.string().trim().min(1).max(200),
  riga2: z.string().trim().max(200).optional().nullable(),
  cap: z.string().trim().regex(/^\d{4}$/, 'NPA di 4 cifre'),
  citta: z.string().trim().min(1).max(100),
  paese: z.enum(['CH', 'LI']),
});

export async function cardRoutes(
  app: FastifyInstance,
  opts: { db: Database; mailer: Mailer; payments: PaymentProvider; appOrigin: string; operatori: string[]; chiaveMadre: Uint8Array },
) {
  const { db, mailer, payments, appOrigin, operatori } = opts;
  const auth = requireUser(db);
  const chiaveMadre = Buffer.from(opts.chiaveMadre);
  const modalitaProva = operatori.length === 0;
  const requireOperator = async (req: FastifyRequest, reply: FastifyReply) => {
    await auth(req, reply);
    if (reply.sent) return;
    if (!modalitaProva && !operatori.includes(req.user!.email.toLowerCase())) return reply.code(403).send({ errore: 'Riservato agli operatori' });
  };
  const ownVault = async (userId: string) => (await db.select().from(vaults).where(eq(vaults.ownerId, userId)).limit(1))[0] ?? null;

  // ---- Per il proprietario --------------------------------------------------

  app.get('/v1/carte', { preHandler: auth }, async (req) => {
    const v = await ownVault(req.user!.id);
    if (!v) return { prezzo: PREZZO_CARTA_CHF, carte: [], ordini: [], pagamentoDiProva: payments.name === 'prova' };
    const c = await db.select().from(cards).where(eq(cards.vaultId, v.id)).orderBy(desc(cards.createdAt));
    const o = await db
      .select()
      .from(cardOrders)
      .where(and(eq(cardOrders.vaultId, v.id), ne(cardOrders.status, 'annullato')))
      .orderBy(desc(cardOrders.createdAt));
    return {
      prezzo: PREZZO_CARTA_CHF,
      pagamentoDiProva: payments.name === 'prova',
      carte: c.map((x) => ({ id: x.id, finale: x.uid.slice(-4), stato: x.status, attivataIl: x.activatedAt, creataIl: x.createdAt })),
      ordini: o
        .filter((x) => x.status !== 'in-attesa' || Date.now() - x.createdAt.getTime() < 24 * 3600 * 1000)
        .map((x) => ({
          id: x.id,
          quantita: x.quantity,
          chf: x.amountChf,
          stato: x.status,
          regalo: x.gift,
          spedizione: x.shippingName ? `${x.shippingName}, ${x.shippingPostalCode} ${x.shippingCity}` : null,
          spedito: x.shippedAt,
          tracking: x.tracking,
          creatoIl: x.createdAt,
        })),
    };
  });

  app.post('/v1/carte/ordina', { preHandler: auth }, async (req, reply) => {
    const body = z.object({ quantita: z.number().int().min(1).max(5), regalo: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Da 1 a 5 carte per ordine' });
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Crea prima la tua cassaforte' });
    const [o] = await db
      .insert(cardOrders)
      .values({ userId: req.user!.id, vaultId: v.id, quantity: body.data.quantita, amountChf: body.data.quantita * PREZZO_CARTA_CHF, gift: body.data.regalo })
      .returning();
    const { url } = await payments.createCardCheckout({
      orderId: o!.id,
      userId: req.user!.id,
      email: req.user!.email,
      quantity: body.data.quantita,
      successUrl: `${appOrigin}/?carte=pagate`,
      cancelUrl: `${appOrigin}/?carte=annullato`,
    });
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'carte-ordinate', vaultId: v.id, details: { ordine: o!.id, quantita: body.data.quantita } });
    return { url };
  });

  app.post('/v1/carte/:id/disattiva', { preHandler: auth }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const v = await ownVault(req.user!.id);
    if (!p.success || !v) return reply.code(404).send({ errore: 'Carta non trovata' });
    const [c] = await db.update(cards).set({ status: 'disattivata' }).where(and(eq(cards.id, p.data.id), eq(cards.vaultId, v.id))).returning();
    if (!c) return reply.code(404).send({ errore: 'Carta non trovata' });
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'carta-disattivata', vaultId: v.id, details: { carta: c.id } });
    return { ok: true };
  });

  // Pagamento di prova: una pagina dell'app chiede l'indirizzo, come farebbe Stripe.
  if (payments.name === 'prova') {
    app.get('/v1/carte/ordini/:id', { preHandler: auth }, async (req, reply) => {
      const p = Uuid.safeParse(req.params);
      const [o] = p.success ? await db.select().from(cardOrders).where(and(eq(cardOrders.id, p.data.id), eq(cardOrders.userId, req.user!.id))) : [];
      if (!o) return reply.code(404).send({ errore: 'Ordine non trovato' });
      return { quantita: o.quantity, chf: o.amountChf, regalo: o.gift, pagato: o.status !== 'in-attesa' };
    });
    app.post('/v1/carte/ordini/:id/paga-prova', { preHandler: auth }, async (req, reply) => {
      const p = Uuid.safeParse(req.params);
      const body = Indirizzo.safeParse(req.body);
      if (!p.success) return reply.code(404).send({ errore: 'Ordine non trovato' });
      if (!body.success) return reply.code(400).send({ errore: body.error.issues[0]?.message ?? 'Indirizzo non valido' });
      const [o] = await db.select().from(cardOrders).where(and(eq(cardOrders.id, p.data.id), eq(cardOrders.userId, req.user!.id)));
      if (!o) return reply.code(404).send({ errore: 'Ordine non trovato' });
      // Stesso percorso degli avvisi veri del fornitore.
      await applyPaymentEvent(db, mailer, { id: `prova-carte-${o.id}`, kind: 'carte-pagate', orderId: o.id, spedizione: body.data });
      return { ok: true };
    });
  }

  // ---- La carta avvicinata a un telefono (pubblico) -------------------------

  app.get('/v1/carta', async (req, reply) => {
    const q = z.object({ picc: z.string(), cmac: z.string() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ esito: 'non-valida' });
    const { meta } = chiaviCarta(chiaveMadre);
    const lettura = decifraPicc(meta, q.data.picc);
    if (!lettura) return { esito: 'non-valida' };
    const [c] = await db.select().from(cards).where(eq(cards.uid, lettura.uid)).limit(1);
    if (!c || !macValido(chiaviCarta(chiaveMadre, lettura.uid).file!, lettura, q.data.cmac)) return { esito: 'non-valida' };
    // Ogni lettura ha un numero più alto della precedente: un collegamento copiato non vale due volte.
    const [aggiornata] = await db
      .update(cards)
      .set({ lastCounter: lettura.contatore })
      .where(and(eq(cards.id, c.id), sql`${cards.lastCounter} < ${lettura.contatore}`))
      .returning();
    if (!aggiornata) return { esito: 'ripetuta' };
    if (c.status === 'disattivata') return { esito: 'disattivata' };

    const [v] = await db.select().from(vaults).where(eq(vaults.id, c.vaultId));
    const [owner] = v ? await db.select().from(users).where(eq(users.id, v.ownerId)) : [];
    if (!owner) return { esito: 'non-valida' };
    const user = await findSessionUser(db, req.cookies[SESSION_COOKIE]);
    const tua = user?.id === owner.id;

    if (c.status === 'spedita') {
      if (!tua) return { esito: 'da-attivare' };
      await db.update(cards).set({ status: 'attiva', activatedAt: new Date() }).where(eq(cards.id, c.id));
      await db.insert(auditLog).values({ actor: owner.id, action: 'carta-attivata', vaultId: c.vaultId, details: { carta: c.id } });
      return { esito: 'attivata' };
    }

    const token = randomBytes(24).toString('base64url');
    await db.insert(cardTaps).values({ cardId: c.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + MINUTI_AVVISO * 60_000) });
    await db.insert(auditLog).values({ actor: user?.id ?? 'anonimo', action: 'carta-letta', vaultId: c.vaultId, details: { carta: c.id } });
    const parti = owner.name.trim().split(/\s+/);
    const nome = parti.length > 1 ? `${parti[0]} ${parti[parti.length - 1]![0]}.` : parti[0]!;
    let fiducia = false;
    if (user && !tua) {
      const [p] = await db
        .select({ id: persons.id })
        .from(persons)
        .where(and(eq(persons.vaultId, c.vaultId), eq(persons.userId, user.id), eq(persons.inviteStatus, 'accettato'), inArray(persons.role, ['fiduciario', 'fiduciario-destinatario'])))
        .limit(1);
      fiducia = !!p;
    }
    return { esito: 'valida', nome, token, tua, fiducia };
  });

  app.post('/v1/carta/avvisa', async (req, reply) => {
    const body = z
      .object({ token: z.string().min(10).max(100), messaggio: z.string().trim().max(1000).optional(), contatto: z.string().trim().max(200).optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const [t] = await db.select().from(cardTaps).where(eq(cardTaps.tokenHash, hash(body.data.token))).limit(1);
    if (!t || t.expiresAt < new Date()) return reply.code(410).send({ errore: 'Avvicina di nuovo la carta al telefono e riprova.' });
    if (t.alertedAt) return reply.code(409).send({ errore: 'L\'avviso è già partito. Grazie.' });
    const recenti = await db
      .select({ id: cardTaps.id })
      .from(cardTaps)
      .where(and(eq(cardTaps.cardId, t.cardId), isNotNull(cardTaps.alertedAt), gte(cardTaps.alertedAt, new Date(Date.now() - 24 * 3600 * 1000))));
    if (recenti.length >= AVVISI_AL_GIORNO) return reply.code(429).send({ errore: 'Le persone di fiducia sono già state avvisate oggi.' });
    const [c] = await db.select().from(cards).where(eq(cards.id, t.cardId));
    if (!c || c.status !== 'attiva') return reply.code(410).send({ errore: 'Questa carta non è attiva.' });
    await db.update(cardTaps).set({ alertedAt: new Date() }).where(eq(cardTaps.id, t.id));
    const [v] = await db.select().from(vaults).where(eq(vaults.id, c.vaultId));
    const [owner] = await db.select().from(users).where(eq(users.id, v!.ownerId));
    const fiduciari = await db
      .select({ nome: persons.name, email: users.email })
      .from(persons)
      .innerJoin(users, eq(users.id, persons.userId))
      .where(and(eq(persons.vaultId, c.vaultId), eq(persons.inviteStatus, 'accettato'), inArray(persons.role, ['fiduciario', 'fiduciario-destinatario'])));
    const dettagli =
      (body.data.messaggio ? `Messaggio di chi l'ha trovata:\n«${body.data.messaggio}»\n` : '') +
      (body.data.contatto ? `Recapito lasciato: ${body.data.contatto}\n` : '');
    for (const f of fiduciari) {
      await mailer.send({
        to: f.email,
        subject: `MEMORIAE – qualcuno ha trovato la carta di ${owner!.name}`,
        text:
          `Ciao ${f.nome.split(' ')[0]},\nqualcuno ha avvicinato al telefono la Carta MEMORIAE di ${owner!.name} e ha chiesto di avvisarti.\n${dettagli}\n` +
          `Prova prima a contattare ${owner!.name.split(' ')[0]}. Se sai che le è successo qualcosa, puoi chiedere l'apertura dall'app: ${appOrigin}\n` +
          `Ogni richiesta viene verificata da una persona.`,
      });
    }
    await mailer.send({
      to: owner!.email,
      subject: 'MEMORIAE – la tua carta è stata letta',
      text:
        `Ciao ${owner!.name.split(' ')[0]},\nqualcuno ha avvicinato la tua Carta MEMORIAE a un telefono e ha avvisato le tue persone di fiducia (${fiduciari.length}).\n${dettagli}\n` +
        `Se hai perso la carta, disattivala dall'app (Protezione › Carta MEMORIAE): ${appOrigin}`,
    });
    await db.insert(auditLog).values({ actor: 'anonimo', action: 'carta-avviso', vaultId: c.vaultId, details: { carta: c.id, fiduciari: fiduciari.length } });
    return { avvisati: fiduciari.length };
  });

  // ---- Operatore: preparare e spedire ----------------------------------------

  app.get('/v1/operatore/carte/ordini', { preHandler: requireOperator }, async () => {
    const o = await db.select().from(cardOrders).where(inArray(cardOrders.status, ['pagato', 'spedito'])).orderBy(desc(cardOrders.paidAt)).limit(100);
    const ids = o.map((x) => x.id);
    const carteOrdini = ids.length ? await db.select().from(cards).where(inArray(cards.orderId, ids)) : [];
    return {
      ordini: o.map((x) => ({
        id: x.id,
        stato: x.status,
        quantita: x.quantity,
        regalo: x.gift,
        pagatoIl: x.paidAt,
        speditoIl: x.shippedAt,
        tracking: x.tracking,
        indirizzo: { nome: x.shippingName, riga1: x.shippingLine1, riga2: x.shippingLine2, cap: x.shippingPostalCode, citta: x.shippingCity, paese: x.shippingCountry },
        carte: carteOrdini.filter((c) => c.orderId === x.id).map((c) => c.uid),
      })),
    };
  });

  /** Chiavi e collegamento da scrivere nel chip (per esempio con l'app NXP TagWriter o TagXplorer). */
  app.get('/v1/operatore/carte/programma', { preHandler: requireOperator }, async (req, reply) => {
    const q = z.object({ uid: z.string().regex(/^[0-9a-fA-F]{14}$/) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ errore: 'UID di 14 caratteri esadecimali (7 byte)' });
    const k = chiaviCarta(chiaveMadre, q.data.uid);
    return {
      uid: q.data.uid.toUpperCase(),
      chiaveMeta: k.meta.toString('hex').toUpperCase(),
      chiaveFile: k.file!.toString('hex').toUpperCase(),
      collegamento: `${appOrigin}/c?picc=${'0'.repeat(32)}&cmac=${'0'.repeat(16)}`,
    };
  });

  /** Solo in prova: il collegamento che scriverebbe una carta avvicinata al telefono, per provare senza carta vera. */
  if (modalitaProva) {
    app.get('/v1/operatore/carte/simula', { preHandler: requireOperator }, async (req, reply) => {
      const q = z.object({ uid: z.string().regex(/^[0-9a-fA-F]{14}$/) }).safeParse(req.query);
      if (!q.success) return reply.code(400).send({ errore: 'UID non valido' });
      const [c] = await db.select().from(cards).where(eq(cards.uid, q.data.uid.toUpperCase())).limit(1);
      if (!c) return reply.code(404).send({ errore: 'Carta non trovata' });
      const l = simulaLettura(chiaveMadre, c.uid, c.lastCounter + 1);
      return { collegamento: `${appOrigin}/c?picc=${l.picc}&cmac=${l.cmac}` };
    });
  }

  app.post('/v1/operatore/carte/ordini/:id/carte', { preHandler: requireOperator }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const body = z.object({ uid: z.string().regex(/^[0-9a-fA-F]{14}$/) }).safeParse(req.body);
    if (!p.success || !body.success) return reply.code(400).send({ errore: 'UID di 14 caratteri esadecimali (7 byte)' });
    const [o] = await db.select().from(cardOrders).where(eq(cardOrders.id, p.data.id));
    if (!o || o.status === 'in-attesa' || o.status === 'annullato') return reply.code(404).send({ errore: 'Ordine non trovato o non pagato' });
    const gia = await db.select({ id: cards.id }).from(cards).where(eq(cards.orderId, o.id));
    if (gia.length >= o.quantity) return reply.code(409).send({ errore: 'Tutte le carte di questo ordine sono già state abbinate' });
    const uid = body.data.uid.toUpperCase();
    const [c] = await db.insert(cards).values({ uid, vaultId: o.vaultId, orderId: o.id }).onConflictDoNothing().returning();
    if (!c) return reply.code(409).send({ errore: 'Questa carta è già abbinata a un altro ordine' });
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'carta-abbinata', vaultId: o.vaultId, details: { ordine: o.id, carta: c.id } });
    return { ok: true };
  });

  app.post('/v1/operatore/carte/ordini/:id/spedito', { preHandler: requireOperator }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const body = z.object({ tracking: z.string().trim().max(60).optional() }).safeParse(req.body ?? {});
    if (!p.success || !body.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const [o] = await db.select().from(cardOrders).where(eq(cardOrders.id, p.data.id));
    if (!o || o.status !== 'pagato') return reply.code(404).send({ errore: 'Ordine non trovato o già spedito' });
    const abbinate = await db.select({ id: cards.id }).from(cards).where(eq(cards.orderId, o.id));
    if (abbinate.length < o.quantity) return reply.code(409).send({ errore: `Abbina prima tutte le carte (${abbinate.length} di ${o.quantity})` });
    await db.update(cardOrders).set({ status: 'spedito', shippedAt: new Date(), tracking: body.data.tracking || null }).where(eq(cardOrders.id, o.id));
    const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, o.userId));
    if (u) {
      await mailer.send({
        to: u.email,
        subject: 'MEMORIAE – la tua Carta MEMORIAE è partita',
        text:
          `Ciao ${u.name.split(' ')[0]},\n${o.quantity === 1 ? 'la tua carta è stata spedita' : `le tue ${o.quantity} carte sono state spedite`}${body.data.tracking ? ` (numero di spedizione ${body.data.tracking})` : ''}.\n` +
          `Quando arriva, apri MEMORIAE sul telefono e avvicina la carta: si attiva da sola.`,
      });
    }
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'carte-spedite', vaultId: o.vaultId, details: { ordine: o.id } });
    return { ok: true };
  });
}
