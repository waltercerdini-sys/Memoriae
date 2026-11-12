import { open, seal, type Envelope } from '@memoriae/crypto';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/client';
import { activationCases, auditLog, items, persons, recipientPackages, users, vaults } from '../db/schema';
import {
  ActivationError,
  approve,
  blockByOwner,
  mayReleaseMemoriaeHalf,
  reject,
  startReview,
  type ActivationCase,
  type ActivationStatus,
  type ReleaseScope,
} from '../domain/activation';
import type { Mailer } from '../mail/mailer';
import { blobKey, type BlobStore } from '../storage/blobs';
import type { KeyCustody } from '../storage/custody';
import { requireUser } from './auth';
import { isFiduciary } from './persons';

/**
 * Attivazione: richiesta del fiduciario → verifica dell'operatore → attesa (il proprietario può bloccare)
 * → rilascio della metà MEMORIAE → apertura dei pacchetti nel browser del fiduciario → consegna ai destinatari.
 *
 * Il server non apre mai nulla: consegna la sua metà della chiave solo a caso rilasciato,
 * e solo a chi possiede l'altra metà (una persona di fiducia).
 */
export interface ActivationOptions {
  /** E-mail degli operatori. Vuoto = modalità prova: chiunque può fare da operatore, mai sui propri casi. */
  operatori: string[];
  /** Chiave con cui il server cifra i documenti caricati dai fiduciari (certificati). */
  chiaveDocumenti: Uint8Array;
  /** Solo prove: attesa accorciata. */
  attesaMs?: number;
}

const OPEN_STATES: ActivationStatus[] = ['richiesta', 'in-verifica', 'in-attesa'];
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const MAX_DOCS = 5;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const blockTokenHash = (t: string) => sha256(`memoriae-blocca:${t}`);
const newToken = () => randomBytes(32).toString('base64url');
const nome1 = (n: string) => n.split(' ')[0];
const dataIt = (d: Date) => d.toLocaleString('it-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
const AMBITO: Record<ReleaseScope, string> = { decesso: 'decesso', emergenza: 'emergenza' };

interface DocMeta {
  id: string;
  nome: string;
  tipo: string;
  byte: number;
  caricatoIl: string;
}

const Uuid = z.object({ id: z.string().uuid() });
const VaultParam = z.object({ vaultId: z.string().uuid() });
const TokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const NewRequest = z.object({ ambito: z.enum(['decesso', 'emergenza']), motivo: z.string().trim().min(10).max(2000) });
const Note = z.object({ nota: z.string().trim().max(2000).optional() });
const Delivery = z.object({ destinatarioId: z.string().uuid(), interno: z.string().min(1).max(200_000) });

type CaseRow = typeof activationCases.$inferSelect;
const asDomain = (c: CaseRow): ActivationCase => ({
  scope: c.scope,
  status: c.status,
  reviewedBy: c.reviewedBy,
  reviewNote: c.reviewNote,
  waitingUntil: c.waitingUntil,
  releasedAt: c.releasedAt,
  accessExpiresAt: c.accessExpiresAt,
});

export async function activationRoutes(
  app: FastifyInstance,
  opts: { db: Database; mailer: Mailer; custody: KeyCustody; blobs: BlobStore; appOrigin: string } & ActivationOptions,
) {
  const { db, mailer, custody, blobs, appOrigin, operatori, chiaveDocumenti } = opts;
  const auth = requireUser(db);
  const modalitaProva = operatori.length === 0;

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_DOC_BYTES }, (_req, body, done) => done(null, body));

  const log = (actor: string, action: string, vaultId: string | null, details: Record<string, unknown> = {}) =>
    db.insert(auditLog).values({ actor, action, vaultId, details });

  async function ownerOf(vaultId: string) {
    const [o] = await db.select({ id: users.id, name: users.name, email: users.email }).from(vaults).innerJoin(users, eq(users.id, vaults.ownerId)).where(eq(vaults.id, vaultId));
    return o!;
  }

  /** La mia scheda persona (accettata) in quella cassaforte. */
  async function myPerson(userId: string, vaultId: string) {
    const [p] = await db
      .select()
      .from(persons)
      .where(and(eq(persons.userId, userId), eq(persons.vaultId, vaultId), eq(persons.inviteStatus, 'accettato')))
      .limit(1);
    return p ?? null;
  }

  async function caseById(id: string) {
    const [c] = await db.select().from(activationCases).where(eq(activationCases.id, id)).limit(1);
    return c ?? null;
  }

  async function saveCase(id: string, next: ActivationCase, extra: Partial<CaseRow> = {}) {
    await db
      .update(activationCases)
      .set({
        status: next.status,
        reviewedBy: next.reviewedBy ?? null,
        reviewNote: next.reviewNote ?? null,
        waitingUntil: next.waitingUntil ?? null,
        releasedAt: next.releasedAt ?? null,
        accessExpiresAt: next.accessExpiresAt ?? null,
        updatedAt: new Date(),
        ...extra,
      })
      .where(eq(activationCases.id, id));
  }

  const domainError = (reply: FastifyReply, e: unknown) => {
    if (e instanceof ActivationError) return reply.code(409).send({ errore: e.message });
    throw e;
  };

  async function avvisaFiduciari(vaultId: string, subject: string, text: (nome: string) => string) {
    const rows = await db
      .select({ nome: persons.name, email: users.email })
      .from(persons)
      .innerJoin(users, eq(users.id, persons.userId))
      .where(and(eq(persons.vaultId, vaultId), eq(persons.inviteStatus, 'accettato'), inArray(persons.role, ['fiduciario', 'fiduciario-destinatario'])));
    for (const r of rows) await mailer.send({ to: r.email, subject, text: text(r.nome) });
  }

  async function bloccaCaso(c: CaseRow, actor: string, reply: FastifyReply) {
    let next: ActivationCase;
    try {
      next = blockByOwner(asDomain(c));
    } catch (e) {
      return domainError(reply, e);
    }
    await saveCase(c.id, next, { blockTokenHash: null });
    await log(actor, 'attivazione-bloccata', c.vaultId, { caso: c.id });
    const owner = await ownerOf(c.vaultId);
    await avvisaFiduciari(c.vaultId, `MEMORIAE – ${owner.name} ha bloccato la richiesta`, (n) =>
      `Ciao ${nome1(n)},\n${owner.name} ha risposto e ha bloccato la richiesta di apertura (${AMBITO[c.scope]}). Non succede nulla.`,
    );
    return { ok: true };
  }

  const caseForList = (c: CaseRow, richiedente: string, mine: boolean) => ({
    id: c.id,
    ambito: c.scope,
    stato: c.status,
    richiedente,
    richiestoDaMe: mine,
    motivo: c.reason,
    creatoIl: c.createdAt,
    attesaFinoAl: c.waitingUntil,
    rilasciatoIl: c.releasedAt,
    accessoFinoAl: c.accessExpiresAt,
    nota: c.status === 'respinta' ? c.reviewNote : null,
    apribile: mayReleaseMemoriaeHalf(asDomain(c), new Date()),
  });

  // ---- Persone di fiducia ------------------------------------------------------

  /** Le cassaforti in cui sono persona di fiducia o destinatario, con le richieste aperte. */
  app.get('/v1/fiducia', { preHandler: auth }, async (req) => {
    const rows = await db
      .select({ p: persons, proprietario: users.name })
      .from(persons)
      .innerJoin(vaults, eq(vaults.id, persons.vaultId))
      .innerJoin(users, eq(users.id, vaults.ownerId))
      .where(and(eq(persons.userId, req.user!.id), eq(persons.inviteStatus, 'accettato')));
    const out = [];
    for (const { p, proprietario } of rows) {
      const casi = isFiduciary(p.role)
        ? await db
            .select({ c: activationCases, richiedente: persons.name })
            .from(activationCases)
            .innerJoin(persons, eq(persons.id, activationCases.requestedBy))
            .where(eq(activationCases.vaultId, p.vaultId))
            .orderBy(desc(activationCases.createdAt))
            .limit(10)
        : [];
      out.push({
        vaultId: p.vaultId,
        personaId: p.id,
        ruolo: p.role,
        proprietario,
        casi: casi.map(({ c, richiedente }) => caseForList(c, richiedente, c.requestedBy === p.id)),
      });
    }
    return { cassaforti: out };
  });

  app.post('/v1/fiducia/:vaultId/richieste', { preHandler: auth }, async (req, reply) => {
    const v = VaultParam.safeParse(req.params);
    const body = NewRequest.safeParse(req.body);
    if (!v.success) return reply.code(404).send({ errore: 'Cassaforte non trovata' });
    if (!body.success) return reply.code(400).send({ errore: 'Spiega in poche righe che cosa è successo (almeno 10 caratteri).' });
    const me = await myPerson(req.user!.id, v.data.vaultId);
    if (!me || !isFiduciary(me.role)) return reply.code(403).send({ errore: 'Solo una persona di fiducia può chiedere l\'apertura' });
    const aperti = await db
      .select({ id: activationCases.id })
      .from(activationCases)
      .where(and(eq(activationCases.vaultId, v.data.vaultId), eq(activationCases.scope, body.data.ambito), inArray(activationCases.status, OPEN_STATES)));
    if (aperti.length) return reply.code(409).send({ errore: 'C\'è già una richiesta in corso per questa cassaforte' });

    const token = newToken();
    const [c] = await db
      .insert(activationCases)
      .values({ vaultId: v.data.vaultId, scope: body.data.ambito, requestedBy: me.id, reason: body.data.motivo, blockTokenHash: blockTokenHash(token) })
      .returning();
    await log(req.user!.id, 'attivazione-richiesta', v.data.vaultId, { caso: c!.id, ambito: body.data.ambito });

    const owner = await ownerOf(v.data.vaultId);
    await mailer.send({
      to: owner.email,
      subject: `MEMORIAE – ${me.name} ha chiesto di aprire la tua cassaforte`,
      text:
        `Ciao ${nome1(owner.name)},\n${me.name} ha chiesto l'apertura della tua cassaforte per ${AMBITO[body.data.ambito]}.\n` +
        `Se stai bene e non sei d'accordo, blocca subito la richiesta con un clic:\n${appOrigin}/?blocca=${token}\n\n` +
        `Prima di qualsiasi apertura un operatore MEMORIAE verifica la richiesta, e poi c'è un periodo d'attesa.`,
    });
    if (!modalitaProva) {
      for (const op of operatori) {
        await mailer.send({ to: op, subject: 'MEMORIAE – nuova richiesta da verificare', text: `Nuova richiesta di apertura (${body.data.ambito}). Aprire il pannello operatore: ${appOrigin}` });
      }
    }
    return reply.code(201).send({ id: c!.id });
  });

  /** Documento a sostegno della richiesta (certificato di morte, attestazione medica). Lo legge solo l'operatore. */
  app.put('/v1/fiducia/casi/:id/documenti', { preHandler: auth }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ errore: 'Richiesta non trovata' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(415).send({ errore: 'Atteso un file' });
    const q = z.object({ nome: z.string().trim().min(1).max(200), tipo: z.string().max(100).default('application/octet-stream') }).safeParse(req.query);
    if (!q.success) return reply.code(400).send({ errore: 'Nome del file mancante' });
    const c = await caseById(p.data.id);
    const me = c && (await myPerson(req.user!.id, c.vaultId));
    if (!c || !me || c.requestedBy !== me.id) return reply.code(404).send({ errore: 'Richiesta non trovata' });
    if (c.status !== 'richiesta' && c.status !== 'in-verifica') return reply.code(409).send({ errore: 'La verifica è già conclusa' });
    const docs = c.documents as DocMeta[];
    if (docs.length >= MAX_DOCS) return reply.code(409).send({ errore: `Al massimo ${MAX_DOCS} documenti` });

    const docId = randomUUID();
    const env = await seal(chiaveDocumenti, new Uint8Array(req.body), `documento:${c.id}:${docId}`);
    await blobs.put(blobKey(c.id, docId), new TextEncoder().encode(JSON.stringify(env)));
    const meta: DocMeta = { id: docId, nome: q.data.nome, tipo: q.data.tipo, byte: req.body.length, caricatoIl: new Date().toISOString() };
    await db.update(activationCases).set({ documents: [...docs, meta], updatedAt: new Date() }).where(eq(activationCases.id, c.id));
    await log(req.user!.id, 'documento-caricato', c.vaultId, { caso: c.id, byte: req.body.length });
    return { ok: true, id: docId };
  });

  // ---- Il proprietario può sempre bloccare -------------------------------------

  app.get('/v1/blocca/:token', async (req, reply) => {
    const t = TokenParam.safeParse(req.params);
    if (!t.success) return reply.code(404).send({ errore: 'Collegamento non valido o già usato' });
    const [row] = await db
      .select({ c: activationCases, richiedente: persons.name })
      .from(activationCases)
      .innerJoin(persons, eq(persons.id, activationCases.requestedBy))
      .where(eq(activationCases.blockTokenHash, blockTokenHash(t.data.token)))
      .limit(1);
    if (!row || !OPEN_STATES.includes(row.c.status)) return reply.code(404).send({ errore: 'Collegamento non valido o già usato' });
    return { richiedente: row.richiedente, ambito: row.c.scope, stato: row.c.status, attesaFinoAl: row.c.waitingUntil };
  });

  app.post('/v1/blocca/:token', async (req, reply) => {
    const t = TokenParam.safeParse(req.params);
    if (!t.success) return reply.code(404).send({ errore: 'Collegamento non valido o già usato' });
    const [c] = await db.select().from(activationCases).where(eq(activationCases.blockTokenHash, blockTokenHash(t.data.token))).limit(1);
    if (!c) return reply.code(404).send({ errore: 'Collegamento non valido o già usato' });
    return bloccaCaso(c, 'collegamento-email', reply);
  });

  async function ownVaultId(userId: string) {
    const [v] = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.ownerId, userId)).limit(1);
    return v?.id ?? null;
  }

  app.get('/v1/cassaforte/casi', { preHandler: auth }, async (req, reply) => {
    const vaultId = await ownVaultId(req.user!.id);
    if (!vaultId) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    const rows = await db
      .select({ c: activationCases, richiedente: persons.name })
      .from(activationCases)
      .innerJoin(persons, eq(persons.id, activationCases.requestedBy))
      .where(eq(activationCases.vaultId, vaultId))
      .orderBy(desc(activationCases.createdAt))
      .limit(20);
    return { casi: rows.map(({ c, richiedente }) => caseForList(c, richiedente, false)) };
  });

  app.post('/v1/cassaforte/casi/:id/blocca', { preHandler: auth }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const vaultId = await ownVaultId(req.user!.id);
    const c = p.success ? await caseById(p.data.id) : null;
    if (!c || c.vaultId !== vaultId) return reply.code(404).send({ errore: 'Richiesta non trovata' });
    return bloccaCaso(c, req.user!.id, reply);
  });

  /** Il proprietario chiude in anticipo un accesso d'emergenza già concesso (per esempio, è guarito). */
  app.post('/v1/cassaforte/casi/:id/chiudi', { preHandler: auth }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const vaultId = await ownVaultId(req.user!.id);
    const c = p.success ? await caseById(p.data.id) : null;
    if (!c || c.vaultId !== vaultId) return reply.code(404).send({ errore: 'Richiesta non trovata' });
    if (c.scope !== 'emergenza' || c.status !== 'rilasciata') return reply.code(409).send({ errore: 'Si può chiudere solo un accesso d\'emergenza in corso' });
    await db.update(activationCases).set({ accessExpiresAt: new Date(), updatedAt: new Date() }).where(eq(activationCases.id, c.id));
    await log(req.user!.id, 'emergenza-chiusa', c.vaultId, { caso: c.id });
    return { ok: true };
  });

  // ---- Operatore MEMORIAE --------------------------------------------------------

  const requireOperator = async (req: FastifyRequest, reply: FastifyReply) => {
    await auth(req, reply);
    if (reply.sent) return;
    if (!modalitaProva && !operatori.includes(req.user!.email.toLowerCase())) return reply.code(403).send({ errore: 'Riservato agli operatori' });
  };

  /** Un operatore non decide mai su una cassaforte in cui è coinvolto. */
  async function conflitto(userId: string, c: CaseRow) {
    if ((await ownVaultId(userId)) === c.vaultId) return true;
    return !!(await myPerson(userId, c.vaultId));
  }

  app.get('/v1/operatore', { preHandler: requireOperator }, async () => ({ operatore: true, prova: modalitaProva }));

  app.get('/v1/operatore/casi', { preHandler: requireOperator }, async (req) => {
    const rows = await db
      .select({ c: activationCases, richiedente: persons.name, richiedenteEmail: persons.email, ruolo: persons.role })
      .from(activationCases)
      .innerJoin(persons, eq(persons.id, activationCases.requestedBy))
      .orderBy(asc(activationCases.createdAt));
    const out = [];
    for (const { c, richiedente, richiedenteEmail, ruolo } of rows) {
      if (await conflitto(req.user!.id, c)) continue;
      const owner = await ownerOf(c.vaultId);
      out.push({
        id: c.id,
        ambito: c.scope,
        stato: c.status,
        proprietario: { nome: owner.name, email: owner.email },
        richiedente: { nome: richiedente, email: richiedenteEmail, ruolo },
        motivo: c.reason,
        documenti: (c.documents as DocMeta[]).map(({ id, nome, tipo, byte }) => ({ id, nome, tipo, byte })),
        creatoIl: c.createdAt,
        attesaFinoAl: c.waitingUntil,
        rilasciatoIl: c.releasedAt,
        verificatoDaMe: c.reviewedBy === req.user!.id,
        nota: c.reviewNote,
      });
    }
    return { casi: out };
  });

  async function operatorCase(req: FastifyRequest, reply: FastifyReply) {
    const p = Uuid.safeParse(req.params);
    const c = p.success ? await caseById(p.data.id) : null;
    if (!c) {
      reply.code(404).send({ errore: 'Richiesta non trovata' });
      return null;
    }
    if (await conflitto(req.user!.id, c)) {
      reply.code(403).send({ errore: 'Sei coinvolto in questa cassaforte: la verifica spetta a un altro operatore' });
      return null;
    }
    return c;
  }

  app.get('/v1/operatore/casi/:id/documenti/:docId', { preHandler: requireOperator }, async (req, reply) => {
    const d = z.object({ id: z.string().uuid(), docId: z.string().uuid() }).safeParse(req.params);
    if (!d.success) return reply.code(404).send({ errore: 'Documento non trovato' });
    const c = await operatorCase(req, reply);
    if (!c) return;
    const meta = (c.documents as DocMeta[]).find((x) => x.id === d.data.docId);
    const raw = meta && (await blobs.get(blobKey(c.id, meta.id)));
    if (!meta || !raw) return reply.code(404).send({ errore: 'Documento non trovato' });
    const bytes = await open(chiaveDocumenti, JSON.parse(new TextDecoder().decode(raw)) as Envelope, `documento:${c.id}:${meta.id}`);
    await log(req.user!.id, 'documento-letto', c.vaultId, { caso: c.id, documento: meta.id });
    return reply
      .type(meta.tipo)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(meta.nome)}`)
      .send(Buffer.from(bytes));
  });

  app.post('/v1/operatore/casi/:id/avvia', { preHandler: requireOperator }, async (req, reply) => {
    const c = await operatorCase(req, reply);
    if (!c) return;
    try {
      await saveCase(c.id, startReview(asDomain(c), req.user!.id));
    } catch (e) {
      return domainError(reply, e);
    }
    await log(req.user!.id, 'verifica-avviata', c.vaultId, { caso: c.id });
    return { ok: true };
  });

  app.post('/v1/operatore/casi/:id/approva', { preHandler: requireOperator }, async (req, reply) => {
    const body = Note.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ errore: 'Nota non valida' });
    const c = await operatorCase(req, reply);
    if (!c) return;
    let next: ActivationCase;
    try {
      next = approve(asDomain(c), req.user!.id, new Date(), opts.attesaMs);
    } catch (e) {
      return domainError(reply, e);
    }
    // Nuovo collegamento «blocca» per il proprietario, valido fino al rilascio.
    const token = newToken();
    await saveCase(c.id, { ...next, reviewNote: body.data.nota ?? null }, { blockTokenHash: blockTokenHash(token) });
    await log(req.user!.id, 'verifica-approvata', c.vaultId, { caso: c.id, attesaFinoAl: next.waitingUntil });
    const owner = await ownerOf(c.vaultId);
    await mailer.send({
      to: owner.email,
      subject: 'MEMORIAE – la tua cassaforte sarà aperta se non rispondi',
      text:
        `Ciao ${nome1(owner.name)},\nla richiesta di apertura (${AMBITO[c.scope]}) è stata verificata da un operatore.\n` +
        `Sarà aperta dopo il ${dataIt(next.waitingUntil!)}. Se stai bene, bloccala subito:\n${appOrigin}/?blocca=${token}`,
    });
    await avvisaFiduciari(c.vaultId, 'MEMORIAE – richiesta verificata, inizia l\'attesa', (n) =>
      `Ciao ${nome1(n)},\nla richiesta di apertura della cassaforte di ${owner.name} è stata verificata.\n` +
      `Se ${nome1(owner.name)} non la blocca, potrai aprirla dall'app dopo il ${dataIt(next.waitingUntil!)}.`,
    );
    return { ok: true, attesaFinoAl: next.waitingUntil };
  });

  app.post('/v1/operatore/casi/:id/respingi', { preHandler: requireOperator }, async (req, reply) => {
    const body = Note.safeParse(req.body ?? {});
    if (!body.success || !body.data.nota) return reply.code(400).send({ errore: 'Indica il motivo del rifiuto' });
    const c = await operatorCase(req, reply);
    if (!c) return;
    try {
      await saveCase(c.id, reject(asDomain(c), req.user!.id, body.data.nota), { blockTokenHash: null });
    } catch (e) {
      return domainError(reply, e);
    }
    await log(req.user!.id, 'verifica-respinta', c.vaultId, { caso: c.id });
    const [req0] = await db.select({ nome: persons.name, email: users.email }).from(persons).innerJoin(users, eq(users.id, persons.userId)).where(eq(persons.id, c.requestedBy));
    if (req0) {
      await mailer.send({
        to: req0.email,
        subject: 'MEMORIAE – richiesta non accolta',
        text: `Ciao ${nome1(req0.nome)},\nla richiesta di apertura non è stata accolta. Motivo: ${body.data.nota}\nPuoi rispondere a questa e-mail o fare una nuova richiesta con i documenti mancanti.`,
      });
    }
    return { ok: true };
  });

  // ---- Dopo il rilascio: apertura nel browser del fiduciario ----------------------

  /** Caso rilasciato e valido, visto da una persona di fiducia di quella cassaforte. */
  async function releasedForFiduciary(req: FastifyRequest, reply: FastifyReply) {
    const p = Uuid.safeParse(req.params);
    const c = p.success ? await caseById(p.data.id) : null;
    const me = c && (await myPerson(req.user!.id, c.vaultId));
    if (!c || !me || !isFiduciary(me.role)) {
      reply.code(404).send({ errore: 'Richiesta non trovata' });
      return null;
    }
    if (!mayReleaseMemoriaeHalf(asDomain(c), new Date())) {
      reply.code(403).send({ errore: c.status === 'rilasciata' ? 'L\'accesso d\'emergenza è scaduto' : 'La cassaforte non è ancora apribile' });
      return null;
    }
    return { c, me };
  }

  app.get('/v1/fiducia/casi/:id/rilascio', { preHandler: auth }, async (req, reply) => {
    const r = await releasedForFiduciary(req, reply);
    if (!r) return;
    const { c, me } = r;
    if (!me.sealedFiduciaryHalf) return reply.code(409).send({ errore: 'La tua metà della chiave non è ancora pronta: il proprietario non ha aperto l\'app dopo il tuo sì' });
    const [v] = await db.select().from(vaults).where(eq(vaults.id, c.vaultId));
    const ref = c.scope === 'decesso' ? v!.kmsRefDecesso : v!.kmsRefEmergenza;
    if (!ref) return reply.code(409).send({ errore: 'Rilascio non impostato per questa cassaforte' });
    const half = await custody.reveal(ref);
    const pkgs = await db
      .select({ k: recipientPackages, nome: persons.name, haAccount: persons.userId, ruolo: persons.role })
      .from(recipientPackages)
      .innerJoin(persons, eq(persons.id, recipientPackages.recipientId))
      .where(and(eq(recipientPackages.vaultId, c.vaultId), eq(recipientPackages.scope, c.scope)));
    await log(req.user!.id, 'meta-memoriae-consegnata', c.vaultId, { caso: c.id });
    const owner = await ownerOf(c.vaultId);
    return {
      vaultId: c.vaultId,
      ambito: c.scope,
      proprietario: owner.name,
      accessoFinoAl: c.accessExpiresAt,
      metaMemoriae: Buffer.from(half).toString('base64url'),
      metaFiduciario: { personaId: me.id, sigillata: me.sealedFiduciaryHalf },
      mioPersonaId: me.id,
      pacchetti: pkgs.map(({ k, nome, haAccount }) => ({
        destinatarioId: k.recipientId,
        nome,
        haAccount: !!haAccount,
        tipo: k.kind,
        esterno: k.outer,
        consegnato: !!k.deliveredAt,
      })),
    };
  });

  /** Voci cifrate della cassaforte: senza le chiavi dei pacchetti non si leggono. In emergenza solo quelle d'emergenza. */
  async function sharedItems(vaultId: string, scope: ReleaseScope) {
    const where = scope === 'emergenza' ? and(eq(items.vaultId, vaultId), eq(items.isEmergency, true)) : eq(items.vaultId, vaultId);
    const rows = await db.select().from(items).where(where).orderBy(asc(items.createdAt));
    return rows.map((r) => ({ id: r.id, tipo: r.type, contenuto: r.content, haFile: !!r.blobKey }));
  }

  async function sharedFile(vaultId: string, scope: ReleaseScope, itemId: string, reply: FastifyReply) {
    const [it] = await db.select().from(items).where(and(eq(items.id, itemId), eq(items.vaultId, vaultId))).limit(1);
    if (!it?.blobKey || (scope === 'emergenza' && !it.isEmergency)) return reply.code(404).send({ errore: 'File non trovato' });
    const bytes = await blobs.get(it.blobKey);
    if (!bytes) return reply.code(404).send({ errore: 'File non trovato' });
    return reply.type('application/octet-stream').send(Buffer.from(bytes));
  }

  app.get('/v1/fiducia/casi/:id/voci', { preHandler: auth }, async (req, reply) => {
    const r = await releasedForFiduciary(req, reply);
    if (!r) return;
    return { voci: await sharedItems(r.c.vaultId, r.c.scope) };
  });

  app.get('/v1/fiducia/casi/:id/voci/:itemId/file', { preHandler: auth }, async (req, reply) => {
    const q = z.object({ itemId: z.string().uuid() }).safeParse(req.params);
    if (!q.success) return reply.code(404).send({ errore: 'File non trovato' });
    const r = await releasedForFiduciary(req, reply);
    if (!r) return;
    return sharedFile(r.c.vaultId, r.c.scope, q.data.itemId, reply);
  });

  /** Il browser del fiduciario ha tolto lo strato esterno: lo strato interno (cifrato per il destinatario) va a lui. */
  app.post('/v1/fiducia/casi/:id/consegne', { preHandler: auth }, async (req, reply) => {
    const body = Delivery.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Consegna non valida' });
    const r = await releasedForFiduciary(req, reply);
    if (!r) return;
    const [k] = await db
      .select({ k: recipientPackages, userId: persons.userId, nome: persons.name })
      .from(recipientPackages)
      .innerJoin(persons, eq(persons.id, recipientPackages.recipientId))
      .where(and(eq(recipientPackages.vaultId, r.c.vaultId), eq(recipientPackages.scope, r.c.scope), eq(recipientPackages.recipientId, body.data.destinatarioId)))
      .limit(1);
    if (!k || k.k.kind !== 'sealed-to-recipient' || !k.userId) return reply.code(404).send({ errore: 'Pacchetto non trovato' });
    if (k.k.deliveredAt) return { ok: true, giaConsegnato: true };
    await db
      .update(recipientPackages)
      .set({ deliveredInner: body.data.interno, deliveredAt: new Date(), activationCaseId: r.c.id, updatedAt: new Date() })
      .where(eq(recipientPackages.id, k.k.id));
    await log(req.user!.id, 'pacchetto-consegnato', r.c.vaultId, { caso: r.c.id, destinatario: body.data.destinatarioId });
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, k.userId));
    const owner = await ownerOf(r.c.vaultId);
    if (u) {
      await mailer.send({
        to: u.email,
        subject: `MEMORIAE – ${owner.name} ti ha lasciato qualcosa`,
        text: `Ciao ${nome1(k.nome)},\n${owner.name} aveva preparato per te alcune informazioni. Entra nell'app per vederle: ${appOrigin}`,
      });
    }
    return { ok: true };
  });

  // ---- Destinatari -------------------------------------------------------------

  async function myDelivery(userId: string, pkgId: string) {
    const [row] = await db
      .select({ k: recipientPackages, c: activationCases })
      .from(recipientPackages)
      .innerJoin(persons, eq(persons.id, recipientPackages.recipientId))
      .innerJoin(activationCases, eq(activationCases.id, recipientPackages.activationCaseId))
      .where(and(eq(recipientPackages.id, pkgId), eq(persons.userId, userId), isNotNull(recipientPackages.deliveredInner)))
      .limit(1);
    if (!row || !mayReleaseMemoriaeHalf(asDomain(row.c), new Date())) return null;
    return row;
  }

  app.get('/v1/ricevuti', { preHandler: auth }, async (req) => {
    const rows = await db
      .select({ k: recipientPackages, c: activationCases })
      .from(recipientPackages)
      .innerJoin(persons, eq(persons.id, recipientPackages.recipientId))
      .innerJoin(activationCases, eq(activationCases.id, recipientPackages.activationCaseId))
      .where(and(eq(persons.userId, req.user!.id), isNotNull(recipientPackages.deliveredInner)));
    const out = [];
    for (const { k, c } of rows) {
      if (!mayReleaseMemoriaeHalf(asDomain(c), new Date())) continue;
      const owner = await ownerOf(k.vaultId);
      out.push({ id: k.id, vaultId: k.vaultId, proprietario: owner.name, ambito: k.scope, interno: k.deliveredInner, consegnatoIl: k.deliveredAt, accessoFinoAl: c.accessExpiresAt });
    }
    return { ricevuti: out };
  });

  app.get('/v1/ricevuti/:id/voci', { preHandler: auth }, async (req, reply) => {
    const p = Uuid.safeParse(req.params);
    const row = p.success ? await myDelivery(req.user!.id, p.data.id) : null;
    if (!row) return reply.code(404).send({ errore: 'Non trovato' });
    return { voci: await sharedItems(row.k.vaultId, row.k.scope) };
  });

  app.get('/v1/ricevuti/:id/voci/:itemId/file', { preHandler: auth }, async (req, reply) => {
    const q = z.object({ id: z.string().uuid(), itemId: z.string().uuid() }).safeParse(req.params);
    const row = q.success ? await myDelivery(req.user!.id, q.data.id) : null;
    if (!row || !q.success) return reply.code(404).send({ errore: 'Non trovato' });
    return sharedFile(row.k.vaultId, row.k.scope, q.data.itemId, reply);
  });
}
