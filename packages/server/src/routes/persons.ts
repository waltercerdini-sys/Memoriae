import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/client';
import { auditLog, persons, recipientPackages, users, vaults } from '../db/schema';
import type { Mailer } from '../mail/mailer';
import type { KeyCustody } from '../storage/custody';
import { requireUser } from './auth';

/**
 * Persone della cassaforte (fiduciari e destinatari), inviti, impostazione del rilascio e pacchetti.
 * Il server non vede mai a chi va cosa: le assegnazioni stanno nelle voci cifrate e nei pacchetti cifrati.
 */

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const Envelope = z.object({
  v: z.literal(1),
  alg: z.literal('xchacha20poly1305-ietf'),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  ct: z.string().regex(/^[A-Za-z0-9_-]+$/).max(400_000),
});
const Key32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const Role = z.enum(['fiduciario', 'destinatario', 'fiduciario-destinatario']);
const CreatePerson = z.object({
  id: z.string().uuid(),
  ruolo: Role,
  nome: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
const IdParam = z.object({ id: z.string().uuid() });
const Token = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const SealedHalf = z.object({ personaId: z.string().uuid(), sigillata: z.string().regex(/^[A-Za-z0-9_-]+$/).max(500) });
const ReleaseSetup = z.object({
  copiaProprietario: Envelope,
  metaMemoriae: z.object({ decesso: Key32, emergenza: Key32 }),
  metaFiduciari: z.array(SealedHalf).min(1).max(20),
});
const Packages = z.object({
  /** Nonce della copia del proprietario con cui i pacchetti sono stati costruiti: evita pacchetti costruiti su un rilascio superato. */
  riferimentoRilascio: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  pacchetti: z
    .array(
      z.object({
        destinatarioId: z.string().uuid(),
        ambito: z.enum(['decesso', 'emergenza']),
        tipo: z.enum(['sealed-to-recipient', 'release-only']),
        esterno: Envelope,
      }),
    )
    .max(200),
});

export const isFiduciary = (role: string) => role === 'fiduciario' || role === 'fiduciario-destinatario';

export interface PersonRouteOptions {
  db: Database;
  mailer: Mailer;
  custody: KeyCustody;
  appOrigin: string;
}

export async function personRoutes(app: FastifyInstance, opts: PersonRouteOptions) {
  const { db, mailer, custody, appOrigin } = opts;
  const auth = requireUser(db);

  async function ownVault(userId: string) {
    const [v] = await db.select().from(vaults).where(eq(vaults.ownerId, userId)).limit(1);
    return v ?? null;
  }
  async function ownPerson(userId: string, personId: string) {
    const v = await ownVault(userId);
    if (!v) return null;
    const [p] = await db.select().from(persons).where(and(eq(persons.id, personId), eq(persons.vaultId, v.id))).limit(1);
    return p ? { vault: v, person: p } : null;
  }

  // ---- Persone ----------------------------------------------------------------

  app.get('/v1/cassaforte/persone', { preHandler: auth }, async (req, reply) => {
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    const rows = await db.select().from(persons).where(eq(persons.vaultId, v.id));
    return {
      persone: rows.map((p) => ({
        id: p.id,
        ruolo: p.role,
        nome: p.name,
        email: p.email,
        statoInvito: p.inviteStatus,
        chiavePubblica: p.inviteStatus === 'accettato' ? p.publicKey : null,
        haMetaFiduciario: !!p.sealedFiduciaryHalf,
      })),
    };
  });

  app.post('/v1/cassaforte/persone', { preHandler: auth }, async (req, reply) => {
    const body = CreatePerson.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Dati della persona non validi' });
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    if (body.data.email && body.data.email === req.user!.email) return reply.code(400).send({ errore: 'Non puoi nominare te stesso' });
    await db.insert(persons).values({ id: body.data.id, vaultId: v.id, role: body.data.ruolo, name: body.data.nome, email: body.data.email ?? null });
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'persona-aggiunta', vaultId: v.id, details: { persona: body.data.id, ruolo: body.data.ruolo } });
    return reply.code(201).send({ id: body.data.id });
  });

  app.delete('/v1/cassaforte/persone/:id', { preHandler: auth }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const found = await ownPerson(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'Persona non trovata' });
    await db.delete(persons).where(eq(persons.id, p.data.id));
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'persona-rimossa', vaultId: found.vault.id, details: { persona: p.data.id } });
    return { ok: true };
  });

  // ---- Inviti -----------------------------------------------------------------

  app.post('/v1/cassaforte/persone/:id/invito', { preHandler: auth }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const found = await ownPerson(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'Persona non trovata' });
    if (!found.person.email) return reply.code(400).send({ errore: 'Serve l\'e-mail della persona' });
    if (found.person.inviteStatus === 'accettato') return reply.code(409).send({ errore: 'Invito già accettato' });

    const token = randomBytes(32).toString('base64url');
    await db
      .update(persons)
      .set({ inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS), inviteStatus: 'invitato', updatedAt: new Date() })
      .where(eq(persons.id, p.data.id));
    const owner = req.user!;
    const ruolo = isFiduciary(found.person.role) ? 'persona di fiducia' : 'destinatario';
    await mailer.send({
      to: found.person.email,
      subject: `${owner.name} ti ha scelto su MEMORIAE`,
      text:
        `Ciao ${found.person.name},\n${owner.name} ti ha indicato come ${ruolo} nella sua cassaforte digitale MEMORIAE.\n` +
        `Per accettare apri questo collegamento entro 14 giorni:\n${appOrigin}/?invito=${token}\n\n` +
        `Non vedrai nulla del contenuto finché non sarà necessario.`,
    });
    await db.insert(auditLog).values({ actor: owner.id, action: 'invito-inviato', vaultId: found.vault.id, details: { persona: p.data.id } });
    return { ok: true };
  });

  async function personByToken(token: string) {
    const [p] = await db.select().from(persons).where(eq(persons.inviteTokenHash, sha256(token))).limit(1);
    if (!p || p.inviteStatus !== 'invitato' || !p.inviteExpiresAt || p.inviteExpiresAt < new Date()) return null;
    return p;
  }

  app.get('/v1/inviti/:token', async (req, reply) => {
    const t = Token.safeParse(req.params);
    if (!t.success) return reply.code(404).send({ errore: 'Invito non valido o scaduto' });
    const p = await personByToken(t.data.token);
    if (!p) return reply.code(404).send({ errore: 'Invito non valido o scaduto' });
    const [owner] = await db.select({ nome: users.name }).from(vaults).innerJoin(users, eq(users.id, vaults.ownerId)).where(eq(vaults.id, p.vaultId));
    return { proprietario: owner?.nome, ruolo: p.role, nome: p.name };
  });

  app.post('/v1/inviti/accetta', { preHandler: auth }, async (req, reply) => {
    const t = Token.safeParse(req.body);
    if (!t.success) return reply.code(400).send({ errore: 'Invito non valido' });
    const p = await personByToken(t.data.token);
    if (!p) return reply.code(404).send({ errore: 'Invito non valido o scaduto' });
    const [me] = await db.select().from(users).where(eq(users.id, req.user!.id));
    if (!me?.publicKey) return reply.code(409).send({ errore: 'Prima crea la tua cassaforte: serve per ricevere in modo sicuro' });
    const [v] = await db.select().from(vaults).where(eq(vaults.id, p.vaultId));
    if (v?.ownerId === me.id) return reply.code(400).send({ errore: 'Non puoi accettare un invito della tua cassaforte' });

    await db
      .update(persons)
      .set({ userId: me.id, publicKey: me.publicKey, inviteStatus: 'accettato', inviteTokenHash: null, inviteExpiresAt: null, updatedAt: new Date() })
      .where(eq(persons.id, p.id));
    await db.insert(auditLog).values({ actor: me.id, action: 'invito-accettato', vaultId: p.vaultId, details: { persona: p.id } });
    const [owner] = await db.select().from(users).where(eq(users.id, v!.ownerId));
    if (owner) {
      await mailer.send({
        to: owner.email,
        subject: `${p.name} ha accettato il tuo invito`,
        text: `${p.name} ha accettato di essere ${isFiduciary(p.role) ? 'persona di fiducia' : 'destinatario'} nella tua cassaforte MEMORIAE.\nApri l'app per completare: le chiavi vengono preparate sul tuo dispositivo.`,
      });
    }
    return { ok: true, proprietario: owner?.name };
  });

  app.post('/v1/inviti/rifiuta', async (req, reply) => {
    const t = Token.safeParse(req.body);
    if (!t.success) return reply.code(400).send({ errore: 'Invito non valido' });
    const p = await personByToken(t.data.token);
    if (!p) return reply.code(404).send({ errore: 'Invito non valido o scaduto' });
    await db.update(persons).set({ inviteStatus: 'rifiutato', inviteTokenHash: null, updatedAt: new Date() }).where(eq(persons.id, p.id));
    await db.insert(auditLog).values({ actor: 'invitato', action: 'invito-rifiutato', vaultId: p.vaultId, details: { persona: p.id } });
    return { ok: true };
  });

  // ---- Rilascio ---------------------------------------------------------------

  app.get('/v1/cassaforte/rilascio', { preHandler: auth }, async (req, reply) => {
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    return { configurato: !!v.releaseOwnerCopy, copiaProprietario: v.releaseOwnerCopy };
  });

  /** Prima impostazione del rilascio: le metà MEMORIAE vanno in custodia, quelle dei fiduciari alle persone. */
  app.put('/v1/cassaforte/rilascio', { preHandler: auth }, async (req, reply) => {
    const body = ReleaseSetup.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Dati del rilascio non validi' });
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    // Una sola impostazione: cambiare le metà richiederà una rotazione esplicita (non ancora prevista).
    if (v.releaseOwnerCopy) return reply.code(409).send({ errore: 'Rilascio già impostato' });
    const ids = body.data.metaFiduciari.map((m) => m.personaId);
    const ps = await db.select().from(persons).where(and(eq(persons.vaultId, v.id), inArray(persons.id, ids)));
    if (ps.length !== ids.length || ps.some((p) => !isFiduciary(p.role) || p.inviteStatus !== 'accettato')) {
      return reply.code(400).send({ errore: 'Le metà vanno solo a persone di fiducia che hanno accettato' });
    }
    const dec = new Uint8Array(Buffer.from(body.data.metaMemoriae.decesso, 'base64url'));
    const em = new Uint8Array(Buffer.from(body.data.metaMemoriae.emergenza, 'base64url'));
    const refDec = await custody.store(v.id, 'decesso', dec);
    const refEm = await custody.store(v.id, 'emergenza', em);
    dec.fill(0);
    em.fill(0);
    const oldRefs = [v.kmsRefDecesso, v.kmsRefEmergenza].filter((r): r is string => !!r);

    await db.transaction(async (tx) => {
      await tx.update(vaults).set({ releaseOwnerCopy: body.data.copiaProprietario, kmsRefDecesso: refDec, kmsRefEmergenza: refEm, updatedAt: new Date() }).where(eq(vaults.id, v.id));
      // Nuove metà: tutte le precedenti decadono, e con esse i vecchi pacchetti.
      await tx.update(persons).set({ sealedFiduciaryHalf: null }).where(and(eq(persons.vaultId, v.id), isNotNull(persons.sealedFiduciaryHalf)));
      for (const m of body.data.metaFiduciari) {
        await tx.update(persons).set({ sealedFiduciaryHalf: m.sigillata }).where(eq(persons.id, m.personaId));
      }
      await tx.delete(recipientPackages).where(eq(recipientPackages.vaultId, v.id));
      await tx.insert(auditLog).values({ actor: req.user!.id, action: 'rilascio-impostato', vaultId: v.id, details: { fiduciari: ids.length } });
    });
    for (const r of oldRefs) await custody.destroy(r);
    return { ok: true };
  });

  /** Aggiunge un fiduciario a un rilascio già impostato (stessa metà, cifrata per lui). */
  app.put('/v1/cassaforte/persone/:id/meta', { preHandler: auth }, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    const body = z.object({ sigillata: SealedHalf.shape.sigillata }).safeParse(req.body);
    if (!p.success || !body.success) return reply.code(400).send({ errore: 'Richiesta non valida' });
    const found = await ownPerson(req.user!.id, p.data.id);
    if (!found) return reply.code(404).send({ errore: 'Persona non trovata' });
    if (!found.vault.releaseOwnerCopy) return reply.code(409).send({ errore: 'Rilascio non ancora impostato' });
    if (!isFiduciary(found.person.role) || found.person.inviteStatus !== 'accettato') {
      return reply.code(400).send({ errore: 'Solo una persona di fiducia che ha accettato' });
    }
    await db.update(persons).set({ sealedFiduciaryHalf: body.data.sigillata }).where(eq(persons.id, p.data.id));
    await db.insert(auditLog).values({ actor: req.user!.id, action: 'fiduciario-aggiunto-al-rilascio', vaultId: found.vault.id, details: { persona: p.data.id } });
    return { ok: true };
  });

  /** Sostituisce tutti i pacchetti destinatario (il browser li ricostruisce a ogni modifica). */
  app.put('/v1/cassaforte/pacchetti', { preHandler: auth }, async (req, reply) => {
    const body = Packages.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ errore: 'Pacchetti non validi' });
    const v = await ownVault(req.user!.id);
    if (!v) return reply.code(404).send({ errore: 'Nessuna cassaforte' });
    if (!v.releaseOwnerCopy) return reply.code(409).send({ errore: 'Rilascio non ancora impostato' });
    if ((v.releaseOwnerCopy as { nonce?: string }).nonce !== body.data.riferimentoRilascio) {
      return reply.code(409).send({ errore: 'Pacchetti costruiti su un rilascio superato: ricarica' });
    }
    const ps = await db.select().from(persons).where(eq(persons.vaultId, v.id));
    const byId = new Map(ps.map((p) => [p.id, p]));
    const seen = new Set<string>();
    for (const k of body.data.pacchetti) {
      const p = byId.get(k.destinatarioId);
      if (!p) return reply.code(400).send({ errore: 'Destinatario sconosciuto' });
      if (k.tipo === 'sealed-to-recipient' && p.inviteStatus !== 'accettato') return reply.code(400).send({ errore: 'Destinatario senza chiave' });
      const key = `${k.destinatarioId}:${k.ambito}`;
      if (seen.has(key)) return reply.code(400).send({ errore: 'Pacchetto duplicato' });
      seen.add(key);
    }
    await db.transaction(async (tx) => {
      await tx.delete(recipientPackages).where(eq(recipientPackages.vaultId, v.id));
      if (body.data.pacchetti.length > 0) {
        await tx.insert(recipientPackages).values(
          body.data.pacchetti.map((k) => ({ vaultId: v.id, recipientId: k.destinatarioId, scope: k.ambito, kind: k.tipo, outer: k.esterno })),
        );
      }
      await tx.insert(auditLog).values({ actor: req.user!.id, action: 'pacchetti-aggiornati', vaultId: v.id, details: { numero: body.data.pacchetti.length } });
    });
    return { ok: true, numero: body.data.pacchetti.length };
  });
}
